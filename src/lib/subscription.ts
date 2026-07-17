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
    const returnUrl = `${cfg.origin}${basePath}${basePath.includes("?") ? "&" : "?"}sub_id=${subscriptionRef}`;

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

    const failedRenewals = await queryOne<any>(
      "SELECT COUNT(*) as cnt FROM SubscriptionPayment WHERE status = 'FAILED'"
    );

    return {
      rows,
      summary: {
        totalCount: parseInt(summary?.totalCount || 0),
        activeCount: parseInt(summary?.activeCount || 0),
        cancelledCount: parseInt(summary?.cancelledCount || 0),
        onHoldCount: parseInt(summary?.onHoldCount || 0),
        activeMrr: parseFloat(summary?.activeMrr || 0),
        failedRenewals: parseInt(failedRenewals?.cnt || 0),
      },
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
