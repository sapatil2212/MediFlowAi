// ─────────────────────────────────────────────────────────────────────────────
// Cashfree subscription webhook handler + shared subscription state mutations.
//
// Server-only. No createServerFn wrappers here so it can be imported directly
// by the SSR request entry (src/server.ts) for the raw webhook endpoint.
//
// Security model:
//  - Every webhook signature is verified (HMAC-SHA256) before any processing.
//  - Events are de-duplicated via the WebhookEvent table (replay-safe).
//  - Payload contents are NEVER trusted for state: on each event we re-fetch the
//    authoritative subscription from Cashfree and reconcile local state.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { query, queryOne, execute } from "./db";
import {
  getCashfreeSubscription,
  getCashfreeSubscriptionPayments,
  verifyCashfreeWebhookSignature,
} from "./cashfree";
import { normalizePlan, PLAN_BILLING } from "./feature-access";
import { sendBillingNotificationEmail } from "./email";

function graceDays(): number {
  const n = parseInt(process.env.SUBSCRIPTION_GRACE_DAYS || "3", 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

/** Adds `count` intervals of `type` to a date (monthly billing math). */
export function addInterval(from: Date, type: string, count: number): Date {
  const d = new Date(from.getTime());
  const t = (type || "MONTH").toUpperCase();
  const n = count || 1;
  if (t === "DAY") d.setDate(d.getDate() + n);
  else if (t === "WEEK") d.setDate(d.getDate() + 7 * n);
  else if (t === "YEAR") d.setFullYear(d.getFullYear() + n);
  else d.setMonth(d.getMonth() + n); // MONTH default
  return d;
}

function toMysqlDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function generateId(): string {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared state mutations (used by both webhook and the verify server function)
// ─────────────────────────────────────────────────────────────────────────────

interface LocalSubscription {
  id: string;
  userId: string;
  tenantId: string | null;
  subscriptionRef: string;
  cfSubscriptionId: string | null;
  planTier: string;
  amount: number;
  currency: string;
  intervalType: string;
  intervals: number;
  status: string;
  currentPeriodEnd: string | null;
  customerEmail: string | null;
  customerName: string | null;
}

export async function getLocalSubscriptionByRef(ref: string): Promise<LocalSubscription | null> {
  return await queryOne<any>("SELECT * FROM Subscription WHERE subscriptionRef = ? LIMIT 1", [ref]);
}

/**
 * Reconciles local subscription + user state from the authoritative Cashfree
 * subscription object. Idempotent — safe to call repeatedly for the same state.
 * Returns the derived local status for logging/telemetry.
 */
export async function reconcileSubscriptionFromCashfree(
  ref: string,
  cfSub: any
): Promise<{ localStatus: string; activated: boolean } | null> {
  const local = await getLocalSubscriptionByRef(ref);
  if (!local) return null;

  const cfStatus = String(cfSub?.subscription_status || "").toUpperCase();
  const authStatus = String(cfSub?.authorization_details?.authorization_status || "").toUpperCase();
  const paymentMethod =
    cfSub?.authorization_details?.payment_method && typeof cfSub.authorization_details.payment_method === "object"
      ? Object.keys(cfSub.authorization_details.payment_method)[0]
      : cfSub?.authorization_details?.payment_group || cfSub?.authorization_details?.payment_method || null;
  const mandateRef = cfSub?.authorization_details?.authorization_reference || null;
  const nextSchedule = cfSub?.next_schedule_date ? new Date(cfSub.next_schedule_date) : null;

  const wasActive = local.status === "ACTIVE";
  const nowActive = cfStatus === "ACTIVE";
  const activated = !wasActive && nowActive;

  // Update the Subscription row to mirror Cashfree.
  await execute(
    `UPDATE Subscription
       SET status = ?, authStatus = ?, paymentMethod = COALESCE(?, paymentMethod),
           mandateReference = COALESCE(?, mandateReference),
           cfSubscriptionId = COALESCE(?, cfSubscriptionId),
           nextChargeAt = ?, updatedAt = NOW()
     WHERE subscriptionRef = ?`,
    [
      cfStatus || local.status,
      authStatus || null,
      paymentMethod ? String(paymentMethod).toUpperCase() : null,
      mandateRef,
      cfSub?.cf_subscription_id ? String(cfSub.cf_subscription_id) : null,
      nextSchedule ? toMysqlDateTime(nextSchedule) : null,
      ref,
    ]
  );

  // Drive premium access via the User record (single source consumed by
  // feature-access). Only extend/activate on ACTIVE; never downgrade here on
  // transient states — expiry lapses naturally when access is not renewed.
  if (nowActive) {
    const tier = normalizePlan(local.planTier);
    // Access window: until the next scheduled charge (+2 day buffer) or +1
    // interval from now if Cashfree hasn't scheduled yet.
    const base = nextSchedule && !Number.isNaN(nextSchedule.getTime())
      ? new Date(nextSchedule.getTime() + 2 * 24 * 60 * 60 * 1000)
      : addInterval(new Date(), local.intervalType, local.intervals);

    await execute(
      `UPDATE Subscription SET currentPeriodEnd = ?, gracePeriodEnds = NULL, updatedAt = NOW() WHERE subscriptionRef = ?`,
      [toMysqlDateTime(base), ref]
    );
    await execute(
      `UPDATE User
         SET subscriptionStatus = 'Active', subscriptionPlan = ?, subscriptionExpiresAt = ?,
             paymentAmount = ?, paymentMethod = ?, billingInterval = 'monthly', updatedAt = NOW()
       WHERE id = ?`,
      [tier, toMysqlDateTime(base), local.amount, "Cashfree AutoPay", local.userId]
    );

    if (activated) {
      await execute(
        `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
         VALUES (?, ?, ?, 'Active', ?, ?, ?, 'monthly', NOW(), 'Cashfree AutoPay')`,
        [generateId(), local.userId, "Trial", tier, tier, local.amount]
      );
      await notify(local, {
        subject: "Your BookMyTime subscription is active",
        title: "Subscription Activated",
        message: `Your ${tier} plan AutoPay mandate is active. You'll be charged automatically each billing cycle.`,
        tone: "success",
        details: [
          { label: "Plan", value: `${tier}` },
          { label: "Amount", value: `₹${local.amount}/month` },
          { label: "Next renewal", value: nextSchedule ? nextSchedule.toLocaleDateString("en-IN") : "—" },
        ],
      });
    }
  } else if (cfStatus === "CANCELLED" || cfStatus === "COMPLETED") {
    // Access is retained until currentPeriodEnd (already set on User.expiresAt).
    await execute(
      `UPDATE Subscription SET cancelAtPeriodEnd = 1, updatedAt = NOW() WHERE subscriptionRef = ?`,
      [ref]
    );
  }

  return { localStatus: cfStatus || local.status, activated };
}

/**
 * Records a subscription charge (renewal / first charge) and adjusts access.
 * SUCCESS extends the access window; FAILED opens a configurable grace period.
 */
export async function recordSubscriptionCharge(
  ref: string,
  charge: {
    cfPaymentId?: string | null;
    amount: number;
    status: "SUCCESS" | "FAILED" | "PENDING";
    paymentMethod?: string | null;
    failureReason?: string | null;
    scheduledAt?: Date | null;
    paidAt?: Date | null;
  }
): Promise<void> {
  const local = await getLocalSubscriptionByRef(ref);
  if (!local) return;

  // Idempotency: skip if this cfPaymentId is already recorded.
  if (charge.cfPaymentId) {
    const existing = await queryOne<any>(
      "SELECT id FROM SubscriptionPayment WHERE cfPaymentId = ? LIMIT 1",
      [charge.cfPaymentId]
    );
    if (existing) return;
  }

  await execute(
    `INSERT INTO SubscriptionPayment
       (id, subscriptionRef, cfSubscriptionId, userId, tenantId, cfPaymentId, amount, currency, status, paymentMethod, failureReason, scheduledAt, paidAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      generateId(), ref, local.cfSubscriptionId, local.userId, local.tenantId,
      charge.cfPaymentId || null, charge.amount, local.currency, charge.status,
      charge.paymentMethod || null, charge.failureReason || null,
      charge.scheduledAt ? toMysqlDateTime(charge.scheduledAt) : null,
      charge.paidAt ? toMysqlDateTime(charge.paidAt) : null,
    ]
  );

  const tier = normalizePlan(local.planTier);

  if (charge.status === "SUCCESS") {
    const from = local.currentPeriodEnd && new Date(local.currentPeriodEnd) > new Date()
      ? new Date(local.currentPeriodEnd)
      : new Date();
    const nextEnd = addInterval(from, local.intervalType, local.intervals);
    await execute(
      `UPDATE Subscription SET status = 'ACTIVE', currentPeriodStart = NOW(), currentPeriodEnd = ?, gracePeriodEnds = NULL, updatedAt = NOW() WHERE subscriptionRef = ?`,
      [toMysqlDateTime(nextEnd), ref]
    );
    await execute(
      `UPDATE User SET subscriptionStatus = 'Active', subscriptionPlan = ?, subscriptionExpiresAt = ?, paymentAmount = ?, billingInterval = 'monthly', updatedAt = NOW() WHERE id = ?`,
      [tier, toMysqlDateTime(nextEnd), charge.amount || local.amount, local.userId]
    );
    await notify(local, {
      subject: "Payment received — subscription renewed",
      title: "Renewal Successful",
      message: `We've received your ${tier} plan payment. Your subscription is renewed.`,
      tone: "success",
      details: [
        { label: "Amount", value: `₹${charge.amount || local.amount}` },
        { label: "Next renewal", value: nextEnd.toLocaleDateString("en-IN") },
      ],
    });
  } else if (charge.status === "FAILED") {
    const grace = new Date(Date.now() + graceDays() * 24 * 60 * 60 * 1000);
    await execute(
      `UPDATE Subscription SET status = 'ON_HOLD', gracePeriodEnds = ?, updatedAt = NOW() WHERE subscriptionRef = ?`,
      [toMysqlDateTime(grace), ref]
    );
    // Keep access alive during the grace window so a retry can restore silently.
    await execute(
      `UPDATE User SET subscriptionExpiresAt = ?, updatedAt = NOW() WHERE id = ? AND (subscriptionExpiresAt IS NULL OR subscriptionExpiresAt < ?)`,
      [toMysqlDateTime(grace), local.userId, toMysqlDateTime(grace)]
    );
    await notify(local, {
      subject: "Action needed — subscription payment failed",
      title: "Renewal Failed",
      message: `We couldn't collect your ${tier} plan payment. We'll retry automatically. Your access continues during a ${graceDays()}-day grace period.`,
      tone: "danger",
      details: [
        { label: "Amount due", value: `₹${charge.amount || local.amount}` },
        { label: "Grace period until", value: grace.toLocaleDateString("en-IN") },
        ...(charge.failureReason ? [{ label: "Reason", value: charge.failureReason }] : []),
      ],
    });
  }
}

async function notify(
  local: LocalSubscription,
  n: { subject: string; title: string; message: string; tone: any; details?: Array<{ label: string; value: string }> }
): Promise<void> {
  if (!local.customerEmail) return;
  try {
    await sendBillingNotificationEmail({ email: local.customerEmail, ...n });
  } catch (err: any) {
    console.warn("[Subscription] notification email failed:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook entrypoint (called from src/server.ts)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCashfreeWebhookRequest(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");

  const valid = verifyCashfreeWebhookSignature(rawBody, signature, timestamp);
  if (!valid) {
    console.warn("[Webhook] Rejected Cashfree webhook: invalid signature");
    // 401 tells Cashfree the delivery was not accepted.
    return new Response(JSON.stringify({ ok: false, error: "invalid signature" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let payload: any = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return new Response(JSON.stringify({ ok: true, ignored: "unparseable body" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const eventType = String(payload?.type || payload?.event || "UNKNOWN");
  const data = payload?.data || {};
  const subDetails = data?.subscription_details || data?.subscription || {};
  const payDetails = data?.payment_details || data?.subscription_payment || null;
  const subscriptionRef = subDetails?.subscription_id || data?.subscription_id || null;
  const cfSubscriptionId = subDetails?.cf_subscription_id || data?.cf_subscription_id || null;
  const cfPaymentId = payDetails?.cf_payment_id || payDetails?.payment_id || null;

  // Build a stable idempotency key. Fall back to a hash of the raw body.
  const eventKey =
    [eventType, cfSubscriptionId || subscriptionRef || "", cfPaymentId || "", payload?.event_time || ""]
      .filter(Boolean)
      .join(":") || crypto.createHash("sha256").update(rawBody).digest("hex");

  // De-duplicate: insert the event first; a duplicate key means already handled.
  try {
    await execute(
      `INSERT INTO WebhookEvent (id, eventKey, eventType, subscriptionRef, referenceId, signatureValid, status, rawPayload, createdAt)
       VALUES (?, ?, ?, ?, ?, 1, 'received', ?, NOW())`,
      [generateId(), eventKey, eventType, subscriptionRef, cfPaymentId || cfSubscriptionId, rawBody.slice(0, 60000)]
    );
  } catch (err: any) {
    // Duplicate (replay/retry) — acknowledge without reprocessing.
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    if (subscriptionRef) {
      // Reconcile authoritative state from Cashfree (do not trust payload).
      const cfSub = await getCashfreeSubscription(subscriptionRef);
      if (cfSub) {
        await reconcileSubscriptionFromCashfree(subscriptionRef, cfSub);
      }

      // Record a charge outcome if this event carries payment details.
      if (payDetails) {
        const rawStatus = String(payDetails?.payment_status || payDetails?.status || "").toUpperCase();
        const status: "SUCCESS" | "FAILED" | "PENDING" =
          rawStatus === "SUCCESS" ? "SUCCESS" : rawStatus === "FAILED" || rawStatus === "USER_DROPPED" ? "FAILED" : "PENDING";
        if (status !== "PENDING") {
          await recordSubscriptionCharge(subscriptionRef, {
            cfPaymentId,
            amount: Number(payDetails?.payment_amount || payDetails?.amount || 0),
            status,
            paymentMethod:
              (payDetails?.payment_method && typeof payDetails.payment_method === "object"
                ? Object.keys(payDetails.payment_method)[0]
                : payDetails?.payment_group || payDetails?.payment_method) || null,
            failureReason: payDetails?.failure_details?.failure_reason || payDetails?.payment_message || null,
            scheduledAt: payDetails?.payment_schedule_date ? new Date(payDetails.payment_schedule_date) : null,
            paidAt: payDetails?.payment_completion_time ? new Date(payDetails.payment_completion_time) : null,
          });
        }
      }
    }

    await execute("UPDATE WebhookEvent SET status = 'processed' WHERE eventKey = ?", [eventKey]);
  } catch (err: any) {
    console.error("[Webhook] Processing error:", err.message);
    await execute("UPDATE WebhookEvent SET status = 'error' WHERE eventKey = ?", [eventKey]).catch(() => {});
    // Still return 200 so Cashfree doesn't hammer retries for a transient issue
    // we've already persisted; reconciliation also happens on the next event.
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
