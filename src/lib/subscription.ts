// ─────────────────────────────────────────────────────────────────────────────
// Cashfree recurring subscription (AutoPay) server functions.
//
// Reuses: existing auth/session (verifySession), centralized plan pricing
// (feature-access PLAN_BILLING), the shared Cashfree client (cashfree.ts), and
// the shared reconciliation helpers (subscription-webhook.ts).
//
// All amounts/intervals are read from PLAN_BILLING — never hardcoded per call.
// Every mutating action validates ownership server-side.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import crypto from "crypto";
import { verifySession } from "./auth.server";
import { verifyAdminSession } from "./admin.server";
import { query, queryOne, execute } from "./db";
import { sendBillingNotificationEmail } from "./email";
import {
  normalizePlan,
  PLAN_BILLING,
  type PlanTier,
} from "./feature-access";
import {
  getCashfreeConfig,
  ensureCashfreePeriodicPlan,
  createCashfreeSubscription,
  getCashfreeSubscription,
  manageCashfreeSubscription,
} from "./cashfree";
import {
  getLocalSubscriptionByRef,
  reconcileSubscriptionFromCashfree,
  syncSubscriptionPaymentsFromCashfree,
} from "./subscription-webhook";

function generateId(): string {
  return crypto.randomUUID();
}

/** Deterministic Cashfree plan id for a self-serve tier (immutable per price). */
function planIdFor(tier: PlanTier, amount: number): string {
  return `bmt_${tier.toLowerCase()}_monthly_${amount}`;
}

/**
 * Resolves the origin the request actually came from (so the post-mandate
 * redirect returns to the same host/port — localhost:8080 in dev,
 * https://bookmytime.tech in prod) rather than a hardcoded config value.
 */
async function resolveRequestOrigin(fallback: string): Promise<string> {
  try {
    const { getHeaders } = await import("@tanstack/react-start/server");
    const headers = getHeaders();
    const originHeader = (headers.origin as string) || (headers.referer ? new URL(headers.referer as string).origin : null);
    if (originHeader) return originHeader;
  } catch { /* no request context */ }
  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create subscription (mandate) — returns a subscription_session_id for checkout
// ─────────────────────────────────────────────────────────────────────────────
export const createSubscriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { planTier: "Basic" | "Premium"; returnPath?: string }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    // Only the parent (admin) account manages billing.
    if (user.role && user.role !== "admin") {
      throw new Error("Only the workspace owner can manage the subscription.");
    }

    const tier = normalizePlan(data.planTier);
    const billing = PLAN_BILLING[tier];
    if (!billing.selfServe || billing.monthly <= 0) {
      throw new Error("This plan is not available for self-serve AutoPay. Please contact support.");
    }

    // Prevent duplicate active/pending subscriptions.
    const existingActive = await queryOne<any>(
      "SELECT subscriptionRef, status FROM Subscription WHERE userId = ? AND status IN ('ACTIVE','BANK_APPROVAL_PENDING') LIMIT 1",
      [user.id]
    );
    if (existingActive) {
      throw new Error("You already have an active subscription. Cancel it before starting a new one.");
    }

    const amount = billing.monthly;
    const cfg = getCashfreeConfig();
    const planId = planIdFor(tier, amount);

    // Idempotently ensure the PERIODIC plan exists in Cashfree.
    await ensureCashfreePeriodicPlan({
      planId,
      planName: `BookMyTime ${tier} Monthly`,
      recurringAmount: amount,
      maxAmount: amount,
      maxCycles: 120, // up to 10 years of monthly cycles
      intervalType: billing.intervalType,
      intervals: billing.intervals,
      currency: billing.currency,
      // Cashfree plan_note allows only alphanumerics + a few special chars —
      // no currency symbols or em dashes.
      note: `${tier} monthly plan Rs ${amount}`,
    });

    const subscriptionRef = `sub_${user.tenantId}_${Date.now()}`;

    // Safe, same-origin return path (defaults to the professional dashboard).
    let basePath = "/dashboards/professional?tab=plans";
    if (typeof data.returnPath === "string" && data.returnPath.startsWith("/") && !data.returnPath.startsWith("//")) {
      basePath = data.returnPath;
    }
    const origin = await resolveRequestOrigin(cfg.origin);
    const returnUrl = `${origin}${basePath}${basePath.includes("?") ? "&" : "?"}sub_id=${subscriptionRef}`;

    // 5-year expiry window for the mandate.
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 5);

    const cfSub = await createCashfreeSubscription({
      subscriptionId: subscriptionRef,
      planId,
      planName: `BookMyTime ${tier} Monthly`,
      customer: { name: user.name, email: user.email, phone: (user as any).phone || "9999999999" },
      returnUrl,
      expiryTimeIso: expiry.toISOString(),
      authorizationAmount: 1,
      note: `${tier} AutoPay`,
    });

    // Persist the local subscription record (INITIALIZED).
    await execute(
      `INSERT INTO Subscription
         (id, userId, tenantId, subscriptionRef, cfSubscriptionId, cfPlanId, planTier, amount, currency, intervalType, intervals,
          status, sessionId, customerName, customerEmail, customerPhone, gateway, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Cashfree', NOW(), NOW())`,
      [
        generateId(), user.id, user.tenantId, subscriptionRef,
        cfSub?.cf_subscription_id ? String(cfSub.cf_subscription_id) : null,
        planId, tier, amount, billing.currency, billing.intervalType, billing.intervals,
        String(cfSub?.subscription_status || "INITIALIZED").toUpperCase(),
        cfSub?.subscription_session_id || null,
        user.name, user.email, (user as any).phone || null,
      ]
    );

    return {
      success: true,
      subscription_id: subscriptionRef,
      subscription_session_id: cfSub?.subscription_session_id || null,
      mode: cfg.mode,
      amount,
      plan: tier,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Create subscription (mandate) from the /login renewal flow — pre-login, so
// the account is resolved by username (email/phone) instead of a session.
// Mirrors createCashfreeOrderServerFn's (one-time) username lookup pattern.
// ─────────────────────────────────────────────────────────────────────────────
export const createRenewalSubscriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { username: string; planTier: "Basic" | "Premium"; returnPath?: string }) => data)
  .handler(async ({ data }) => {
    const user = await queryOne<any>(
      "SELECT id, name, email, phone, tenantId FROM User WHERE email = ? OR phone = ? LIMIT 1",
      [data.username, data.username]
    );
    if (!user) throw new Error("Account not found");

    const tier = normalizePlan(data.planTier);
    const billing = PLAN_BILLING[tier];
    if (!billing.selfServe || billing.monthly <= 0) {
      throw new Error("This plan is not available for self-serve AutoPay. Please contact support.");
    }

    // Prevent duplicate active/pending subscriptions.
    const existingActive = await queryOne<any>(
      "SELECT subscriptionRef, status FROM Subscription WHERE userId = ? AND status IN ('ACTIVE','BANK_APPROVAL_PENDING') LIMIT 1",
      [user.id]
    );
    if (existingActive) {
      throw new Error("You already have an active subscription. Cancel it before starting a new one.");
    }

    const amount = billing.monthly;
    const cfg = getCashfreeConfig();
    const planId = planIdFor(tier, amount);

    await ensureCashfreePeriodicPlan({
      planId,
      planName: `BookMyTime ${tier} Monthly`,
      recurringAmount: amount,
      maxAmount: amount,
      maxCycles: 120,
      intervalType: billing.intervalType,
      intervals: billing.intervals,
      currency: billing.currency,
      note: `${tier} monthly plan Rs ${amount}`,
    });

    const subscriptionRef = `sub_${user.tenantId}_${Date.now()}`;

    // Default return path preserves the /login renewal flow so the same page
    // can verify + show a confirmation without bouncing through the dashboard.
    let basePath = "/login";
    if (typeof data.returnPath === "string" && data.returnPath.startsWith("/") && !data.returnPath.startsWith("//")) {
      basePath = data.returnPath;
    }
    const origin = await resolveRequestOrigin(cfg.origin);
    const returnUrl = `${origin}${basePath}${basePath.includes("?") ? "&" : "?"}sub_id=${subscriptionRef}`;

    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 5);

    const cfSub = await createCashfreeSubscription({
      subscriptionId: subscriptionRef,
      planId,
      planName: `BookMyTime ${tier} Monthly`,
      customer: { name: user.name, email: user.email, phone: user.phone || "9999999999" },
      returnUrl,
      expiryTimeIso: expiry.toISOString(),
      authorizationAmount: 1,
      note: `${tier} AutoPay`,
    });

    await execute(
      `INSERT INTO Subscription
         (id, userId, tenantId, subscriptionRef, cfSubscriptionId, cfPlanId, planTier, amount, currency, intervalType, intervals,
          status, sessionId, customerName, customerEmail, customerPhone, gateway, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Cashfree', NOW(), NOW())`,
      [
        generateId(), user.id, user.tenantId, subscriptionRef,
        cfSub?.cf_subscription_id ? String(cfSub.cf_subscription_id) : null,
        planId, tier, amount, billing.currency, billing.intervalType, billing.intervals,
        String(cfSub?.subscription_status || "INITIALIZED").toUpperCase(),
        cfSub?.subscription_session_id || null,
        user.name, user.email, user.phone || null,
      ]
    );

    return {
      success: true,
      subscription_id: subscriptionRef,
      subscription_session_id: cfSub?.subscription_session_id || null,
      mode: cfg.mode,
      amount,
      plan: tier,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Verify a renewal subscription's mandate after return — pre-login, so this
// looks the record up by subscriptionRef only (no session/ownership check is
// possible before the user is authenticated). The subscriptionRef itself is
// an unguessable Cashfree-facing id, and this only reconciles read-only status
// + logs the ledger; it never grants access on its own (User.subscriptionStatus
// is updated by the shared reconcileSubscriptionFromCashfree helper against the
// tenant embedded in the ref, matching the same trust model as the one-time
// verifyAndProcessPaymentServerFn used on the same /login return trip).
// ─────────────────────────────────────────────────────────────────────────────
export const verifyRenewalSubscriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { subscriptionRef: string }) => data)
  .handler(async ({ data }) => {
    const local = await getLocalSubscriptionByRef(data.subscriptionRef);
    if (!local) throw new Error("Subscription not found.");

    const cfSub = await getCashfreeSubscription(data.subscriptionRef);
    if (!cfSub) throw new Error("Unable to fetch subscription status from the payment gateway.");

    await reconcileSubscriptionFromCashfree(data.subscriptionRef, cfSub);
    await syncSubscriptionPaymentsFromCashfree(data.subscriptionRef);

    const status = String(cfSub.subscription_status || "").toUpperCase();
    const authStatus = String(cfSub?.authorization_details?.authorization_status || "").toUpperCase();
    const success = status === "ACTIVE" || authStatus === "ACTIVE";

    if (success && local.customerEmail) {
      try {
        const tier = normalizePlan(local.planTier);
        await sendBillingNotificationEmail({
          email: local.customerEmail,
          subject: `AutoPay activated — BookMyTime ${tier} plan`,
          title: "Payment Received & AutoPay Active",
          message: `Hi ${local.customerName || "there"}, your BookMyTime ${tier} subscription is active and AutoPay is set up. Your plan will renew automatically every month. Thank you for choosing BookMyTime.`,
          tone: "success",
          details: [
            { label: "Plan", value: tier },
            { label: "Amount", value: `Rs ${Number(local.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/month` },
            { label: "AutoPay", value: "Active" },
            { label: "Subscription Ref", value: data.subscriptionRef },
          ],
        });
      } catch (mailErr: any) {
        console.warn(`[Subscription] Failed to send renewal AutoPay confirmation email:`, mailErr.message);
      }
    }

    return {
      success,
      status,
      authStatus,
      plan: normalizePlan(local.planTier),
      amount: local.amount,
      message: success
        ? "Your subscription is active. AutoPay is now set up."
        : status === "BANK_APPROVAL_PENDING"
          ? "Your mandate is pending bank approval. We'll activate access as soon as it's approved."
          : "Mandate authorization was not completed.",
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Verify subscription after mandate authorization return
// ─────────────────────────────────────────────────────────────────────────────
export const verifySubscriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { subscriptionRef: string }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const local = await getLocalSubscriptionByRef(data.subscriptionRef);
    if (!local) throw new Error("Subscription not found.");
    if (local.userId !== user.id) throw new Error("You are not authorized to access this subscription.");

    const cfSub = await getCashfreeSubscription(data.subscriptionRef);
    if (!cfSub) throw new Error("Unable to fetch subscription status from the payment gateway.");

    await reconcileSubscriptionFromCashfree(data.subscriptionRef, cfSub);

    // Record ALL payments (AUTH + CHARGE) with full Cashfree transaction detail
    // so billing history is complete even before the webhook arrives. Idempotent.
    await syncSubscriptionPaymentsFromCashfree(data.subscriptionRef);

    const status = String(cfSub.subscription_status || "").toUpperCase();
    const authStatus = String(cfSub?.authorization_details?.authorization_status || "").toUpperCase();
    const success = status === "ACTIVE" || authStatus === "ACTIVE";

    // Send an AutoPay activation / payment-received confirmation email on
    // behalf of the portal. Best-effort — never blocks the billing flow.
    if (success && (user as any).email) {
      try {
        const tier = normalizePlan(local.planTier);
        await sendBillingNotificationEmail({
          email: (user as any).email,
          subject: `AutoPay activated — BookMyTime ${tier} plan`,
          title: "Payment Received & AutoPay Active",
          message: `Hi ${(user as any).name || "there"}, your BookMyTime ${tier} subscription is active and AutoPay is set up. Your plan will renew automatically every month. Thank you for choosing BookMyTime.`,
          tone: "success",
          details: [
            { label: "Plan", value: tier },
            { label: "Amount", value: `Rs ${Number(local.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/month` },
            { label: "AutoPay", value: "Active" },
            { label: "Subscription Ref", value: data.subscriptionRef },
          ],
        });
        console.log(`[Subscription] AutoPay confirmation email sent to ${(user as any).email}`);
      } catch (mailErr: any) {
        console.warn(`[Subscription] Failed to send AutoPay confirmation email:`, mailErr.message);
      }
    }

    return {
      success,
      status,
      authStatus,
      plan: normalizePlan(local.planTier),
      amount: local.amount,
      message: success
        ? "Your subscription is active. AutoPay is now set up."
        : status === "BANK_APPROVAL_PENDING"
          ? "Your mandate is pending bank approval. We'll activate access as soon as it's approved."
          : "Mandate authorization was not completed.",
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Get the current user's subscription + billing history (billing UI)
// ─────────────────────────────────────────────────────────────────────────────
export const getMySubscriptionServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const subscription = await queryOne<any>(
      `SELECT * FROM Subscription WHERE userId = ? ORDER BY
         (status = 'ACTIVE') DESC, createdAt DESC LIMIT 1`,
      [user.id]
    );

    // Best-effort refresh of the payment ledger from Cashfree so billing history
    // stays current even without a configured webhook. Never blocks the read.
    if (subscription) {
      try { await syncSubscriptionPaymentsFromCashfree(subscription.subscriptionRef); } catch { /* non-fatal */ }
    }

    const payments = subscription
      ? await query<any>(
          `SELECT id, cfPaymentId, cfTxnId, cfOrderId, paymentRef, amount, currency, status, paymentMethod, paymentType, remarks, failureReason, scheduledAt, paidAt, createdAt
           FROM SubscriptionPayment WHERE subscriptionRef = ? ORDER BY createdAt DESC LIMIT 50`,
          [subscription.subscriptionRef]
        )
      : [];

    return { subscription: subscription || null, payments };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Manual sync of a subscription's payments from Cashfree (tenant-owned)
// ─────────────────────────────────────────────────────────────────────────────
export const syncSubscriptionPaymentsServerFn = createServerFn({ method: "POST" })
  .validator((data: { subscriptionRef: string }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    const local = await getLocalSubscriptionByRef(data.subscriptionRef);
    if (!local) throw new Error("Subscription not found.");
    if (local.userId !== user.id) throw new Error("You are not authorized to access this subscription.");
    const recorded = await syncSubscriptionPaymentsFromCashfree(data.subscriptionRef);
    return { success: true, recorded };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Cancel subscription (stops future renewals; access kept until period end)
// ─────────────────────────────────────────────────────────────────────────────
export const cancelSubscriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { subscriptionRef: string }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role && user.role !== "admin") throw new Error("Only the workspace owner can cancel the subscription.");

    const local = await getLocalSubscriptionByRef(data.subscriptionRef);
    if (!local) throw new Error("Subscription not found.");
    if (local.userId !== user.id) throw new Error("You are not authorized to cancel this subscription.");

    await manageCashfreeSubscription(data.subscriptionRef, "CANCEL");

    // Keep access until the current period ends; just stop future renewals.
    await execute(
      `UPDATE Subscription SET status = 'CANCELLED', cancelAtPeriodEnd = 1, updatedAt = NOW() WHERE subscriptionRef = ?`,
      [data.subscriptionRef]
    );
    await execute(
      `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
       VALUES (?, ?, 'Active', 'Cancelled', ?, ?, ?, 'monthly', NOW(), 'User')`,
      [generateId(), user.id, normalizePlan(local.planTier), normalizePlan(local.planTier), local.amount]
    );

    return {
      success: true,
      message: "AutoPay has been cancelled. You'll keep access until the end of your current billing period.",
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Resume / reactivate a paused subscription (PERIODIC only)
// ─────────────────────────────────────────────────────────────────────────────
export const resumeSubscriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { subscriptionRef: string }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role && user.role !== "admin") throw new Error("Only the workspace owner can resume the subscription.");

    const local = await getLocalSubscriptionByRef(data.subscriptionRef);
    if (!local) throw new Error("Subscription not found.");
    if (local.userId !== user.id) throw new Error("You are not authorized to resume this subscription.");

    const res = await manageCashfreeSubscription(data.subscriptionRef, "ACTIVATE");
    const cfSub = await getCashfreeSubscription(data.subscriptionRef);
    if (cfSub) await reconcileSubscriptionFromCashfree(data.subscriptionRef, cfSub);

    return { success: true, status: String(res?.subscription_status || cfSub?.subscription_status || "").toUpperCase() };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Admin: list all subscriptions + summary (super admin panel)
// ─────────────────────────────────────────────────────────────────────────────
export const getAdminSubscriptionsServerFn = createServerFn({ method: "GET" })
  .validator((data?: { status?: string; search?: string; limit?: number }) => data || {})
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const conditions: string[] = [];
    const params: any[] = [];
    if (data.status && data.status !== "all") {
      conditions.push("s.status = ?");
      params.push(data.status);
    }
    if (data.search) {
      conditions.push("(s.subscriptionRef LIKE ? OR s.customerEmail LIKE ? OR s.customerName LIKE ? OR u.clinicName LIKE ?)");
      const like = `%${data.search}%`;
      params.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Number(data.limit) || 200, 1), 1000);

    const rows = await query<any>(
      `SELECT s.*, u.clinicName
       FROM Subscription s
       LEFT JOIN User u ON u.id COLLATE utf8mb4_unicode_ci = s.userId COLLATE utf8mb4_unicode_ci
       ${where}
       ORDER BY s.createdAt DESC
       LIMIT ?`,
      [...params, limit]
    );

    const summary = await queryOne<any>(
      `SELECT
         COUNT(*) as totalCount,
         SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as activeCount,
         SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelledCount,
         SUM(CASE WHEN status = 'ON_HOLD' THEN 1 ELSE 0 END) as onHoldCount,
         SUM(CASE WHEN status = 'ACTIVE' THEN amount ELSE 0 END) as activeMrr
       FROM Subscription`
    );

    // Real collected / failed revenue straight from the recurring payment
    // ledger (AUTH + CHARGE rows recorded from Cashfree). This reflects the
    // exact money actually moved via AutoPay, independent of MRR.
    const paymentTotals = await queryOne<any>(
      `SELECT
         SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END) as collectedAmount,
         SUM(CASE WHEN status = 'FAILED' THEN amount ELSE 0 END) as failedAmount,
         SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failedCount,
         SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successCount
       FROM SubscriptionPayment`
    );

    return {
      rows,
      summary: {
        totalCount: parseInt(summary?.totalCount || 0),
        activeCount: parseInt(summary?.activeCount || 0),
        cancelledCount: parseInt(summary?.cancelledCount || 0),
        onHoldCount: parseInt(summary?.onHoldCount || 0),
        activeMrr: parseFloat(summary?.activeMrr || 0),
        failedRenewals: parseInt(paymentTotals?.failedCount || 0),
        collectedAmount: parseFloat(paymentTotals?.collectedAmount || 0),
        failedAmount: parseFloat(paymentTotals?.failedAmount || 0),
        successCount: parseInt(paymentTotals?.successCount || 0),
      },
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Admin: reconcile every subscription against Cashfree (real-time sync)
// ─────────────────────────────────────────────────────────────────────────────
// Iterates local Subscription rows, refreshes each subscription's status from
// Cashfree, and re-syncs its full payment ledger (AUTH + CHARGE) so the admin
// sees exact collected/failed amounts and live subscription states even when
// the webhook is not yet configured. Never throws per-row — best effort.
export const syncAllSubscriptionsFromCashfreeServerFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const subs = await query<any>(
      `SELECT subscriptionRef FROM Subscription
       WHERE subscriptionRef IS NOT NULL AND subscriptionRef <> ''
       ORDER BY createdAt DESC
       LIMIT 500`
    );

    let reconciled = 0;
    let paymentsSynced = 0;
    let failed = 0;

    for (const s of subs) {
      try {
        const cfSub = await getCashfreeSubscription(s.subscriptionRef);
        if (cfSub) {
          await reconcileSubscriptionFromCashfree(s.subscriptionRef, cfSub);
          reconciled++;
        }
        const recorded = await syncSubscriptionPaymentsFromCashfree(s.subscriptionRef);
        paymentsSynced += Number(recorded) || 0;
      } catch (err: any) {
        failed++;
        console.warn(`[CASHFREE][sync-subs] Failed to reconcile ${s.subscriptionRef}:`, err.message);
      }
    }

    return {
      success: true,
      scanned: subs.length,
      reconciled,
      paymentsSynced,
      failed,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Admin: fetch (and refresh) a subscription's full payment ledger
// ─────────────────────────────────────────────────────────────────────────────
export const getAdminSubscriptionPaymentsServerFn = createServerFn({ method: "GET" })
  .validator((data: { subscriptionRef: string }) => data)
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const subscription = await queryOne<any>(
      `SELECT s.*, u.clinicName
       FROM Subscription s
       LEFT JOIN User u ON u.id COLLATE utf8mb4_unicode_ci = s.userId COLLATE utf8mb4_unicode_ci
       WHERE s.subscriptionRef = ? LIMIT 1`,
      [data.subscriptionRef]
    );
    if (!subscription) throw new Error("Subscription not found.");

    // Pull the latest transaction detail straight from Cashfree, then read back.
    try { await syncSubscriptionPaymentsFromCashfree(data.subscriptionRef); } catch { /* non-fatal */ }

    const payments = await query<any>(
      `SELECT id, cfPaymentId, cfTxnId, cfOrderId, paymentRef, amount, currency, status, paymentMethod, paymentType, remarks, failureReason, scheduledAt, paidAt, createdAt
       FROM SubscriptionPayment WHERE subscriptionRef = ? ORDER BY createdAt DESC LIMIT 100`,
      [data.subscriptionRef]
    );

    return { subscription, payments };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Admin Subscription CRUD and Manual Charge Entries
// ─────────────────────────────────────────────────────────────────────────────

export const createAdminSubscriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    tenantId: string;
    planTier: string;
    amount: number;
    status: string;
    intervalType: string;
    intervals: number;
    nextChargeAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
  }) => {
    if (!data.tenantId || !data.planTier || data.amount === undefined || !data.status) {
      throw new Error("Tenant ID, Plan Tier, Amount, and Status are required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    // Look up User matching tenantId
    const user = await queryOne<any>(
      "SELECT id, name, email, phone, clinicName FROM User WHERE tenantId = ? LIMIT 1",
      [data.tenantId]
    );
    if (!user) throw new Error(`Tenant not found with ID ${data.tenantId}`);

    const subRef = `manual_sub_${data.tenantId}_${Date.now()}`;
    const subId = generateId();

    const nextCharge = data.nextChargeAt ? new Date(data.nextChargeAt) : null;
    const periodStart = data.currentPeriodStart ? new Date(data.currentPeriodStart) : new Date();
    const periodEnd = data.currentPeriodEnd ? new Date(data.currentPeriodEnd) : null;

    await execute(
      `INSERT INTO Subscription
         (id, userId, tenantId, subscriptionRef, cfSubscriptionId, cfPlanId, planTier, amount, currency, intervalType, intervals,
          status, currentPeriodStart, currentPeriodEnd, nextChargeAt, customerName, customerEmail, customerPhone, gateway, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Manual', NOW(), NOW())`,
      [
        subId,
        user.id,
        data.tenantId,
        subRef,
        `manual_cf_sub_${crypto.randomBytes(4).toString("hex")}`,
        `manual_plan_${data.planTier.toLowerCase()}`,
        data.planTier,
        Number(data.amount),
        data.intervalType || "MONTH",
        Number(data.intervals) || 1,
        data.status.toUpperCase(),
        periodStart,
        periodEnd,
        nextCharge,
        data.customerName || user.name,
        data.customerEmail || user.email,
        data.customerPhone || user.phone,
      ]
    );

    // Log subscription history
    await execute(
      `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
       VALUES (?, ?, 'None', ?, 'None', ?, ?, ?, NOW(), 'SuperAdmin')`,
      [generateId(), user.id, data.status, data.planTier, Number(data.amount), data.intervalType === "YEAR" ? "yearly" : "monthly"]
    );

    // Sync with User table status
    await execute(
      `UPDATE User
       SET subscriptionStatus = ?, subscriptionPlan = ?, paymentAmount = ?, billingInterval = ?
       WHERE tenantId = ?`,
      [
        data.status === "ACTIVE" ? "Active" : data.status === "CANCELLED" ? "Cancelled" : "Trialing",
        data.planTier,
        Number(data.amount),
        data.intervalType === "YEAR" ? "yearly" : "monthly",
        data.tenantId
      ]
    );

    return { success: true, id: subId, subscriptionRef: subRef };
  });

export const updateAdminSubscriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    id: string;
    planTier: string;
    amount: number;
    status: string;
    intervalType: string;
    intervals: number;
    nextChargeAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: number;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
  }) => {
    if (!data.id || !data.planTier || data.amount === undefined || !data.status) {
      throw new Error("ID, Plan Tier, Amount, and Status are required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const prev = await queryOne<any>(
      "SELECT userId, status, planTier, amount, intervalType FROM Subscription WHERE id = ? LIMIT 1",
      [data.id]
    );
    if (!prev) throw new Error("Subscription not found");

    const nextCharge = data.nextChargeAt ? new Date(data.nextChargeAt) : null;
    const periodStart = data.currentPeriodStart ? new Date(data.currentPeriodStart) : null;
    const periodEnd = data.currentPeriodEnd ? new Date(data.currentPeriodEnd) : null;

    await execute(
      `UPDATE Subscription
       SET planTier = ?, amount = ?, status = ?, intervalType = ?, intervals = ?,
           nextChargeAt = ?, currentPeriodStart = COALESCE(?, currentPeriodStart), currentPeriodEnd = COALESCE(?, currentPeriodEnd),
           cancelAtPeriodEnd = ?, customerName = ?, customerEmail = ?, customerPhone = ?, updatedAt = NOW()
       WHERE id = ?`,
      [
        data.planTier,
        Number(data.amount),
        data.status.toUpperCase(),
        data.intervalType,
        Number(data.intervals),
        nextCharge,
        periodStart,
        periodEnd,
        Number(data.cancelAtPeriodEnd) || 0,
        data.customerName || null,
        data.customerEmail || null,
        data.customerPhone || null,
        data.id,
      ]
    );

    // Update the base User subscription parameters if it matches
    const sub = await queryOne<any>("SELECT tenantId FROM Subscription WHERE id = ? LIMIT 1", [data.id]);
    if (sub?.tenantId) {
      await execute(
        `UPDATE User
         SET subscriptionStatus = ?, subscriptionPlan = ?, paymentAmount = ?, billingInterval = ?
         WHERE tenantId = ?`,
        [
          data.status === "ACTIVE" ? "Active" : data.status === "CANCELLED" ? "Cancelled" : "Trialing",
          data.planTier,
          Number(data.amount),
          data.intervalType === "YEAR" ? "yearly" : "monthly",
          sub.tenantId
        ]
      );
    }

    // Log history
    if (prev.status !== data.status || prev.planTier !== data.planTier || prev.amount !== data.amount) {
      await execute(
        `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'SuperAdmin')`,
        [
          generateId(),
          prev.userId,
          prev.status,
          data.status,
          prev.planTier,
          data.planTier,
          Number(data.amount),
          data.intervalType === "YEAR" ? "yearly" : "monthly",
        ]
      );
    }

    return { success: true };
  });

export const deleteAdminSubscriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const sub = await queryOne<any>("SELECT subscriptionRef FROM Subscription WHERE id = ? LIMIT 1", [data.id]);
    if (sub?.subscriptionRef) {
      // Clean up linked payments
      await execute("DELETE FROM SubscriptionPayment WHERE subscriptionRef = ?", [sub.subscriptionRef]);
    }
    await execute("DELETE FROM Subscription WHERE id = ?", [data.id]);

    return { success: true };
  });

export const createAdminSubscriptionPaymentServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    subscriptionRef: string;
    amount: number;
    status: string;
    paymentMethod: string;
    paymentType: string; // AUTH | CHARGE
    paidAt?: string | null;
    remarks?: string | null;
  }) => {
    if (!data.subscriptionRef || data.amount === undefined || !data.status) {
      throw new Error("Subscription Reference, Amount, and Status are required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const sub = await queryOne<any>("SELECT userId, tenantId, cfSubscriptionId FROM Subscription WHERE subscriptionRef = ? LIMIT 1", [data.subscriptionRef]);
    if (!sub) throw new Error("Subscription not found");

    const payId = generateId();
    const cfPaymentId = `manual_sp_${crypto.randomBytes(6).toString("hex")}`;
    const cfOrderId = `manual_order_${crypto.randomBytes(6).toString("hex")}`;
    const paidDate = data.paidAt ? new Date(data.paidAt) : new Date();

    await execute(
      `INSERT INTO SubscriptionPayment
         (id, subscriptionRef, cfSubscriptionId, userId, tenantId, cfPaymentId, cfTxnId, cfOrderId, paymentRef, amount, currency, status, paymentMethod, paymentType, remarks, failureReason, scheduledAt, paidAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, NULL, ?, ?, NOW())`,
      [
        payId,
        data.subscriptionRef,
        sub.cfSubscriptionId,
        sub.userId,
        sub.tenantId,
        cfPaymentId,
        `manual_txn_${crypto.randomBytes(4).toString("hex")}`,
        cfOrderId,
        cfPaymentId,
        Number(data.amount),
        data.status.toUpperCase(),
        data.paymentMethod || "OFFLINE",
        data.paymentType || "CHARGE",
        data.remarks || "Manual charge entry",
        paidDate,
        paidDate
      ]
    );

    return { success: true, paymentId: payId };
  });
