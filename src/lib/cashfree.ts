// ─────────────────────────────────────────────────────────────────────────────
// Cashfree low-level API client (server-only).
//
// Centralises credentials, host resolution, versioning, and the raw HTTP calls
// for the Cashfree Payment Gateway *Subscriptions* (AutoPay) product. This
// module performs NO business logic and holds NO createServerFn wrappers so it
// can be safely imported by both server functions and the webhook handler.
//
// Secrets are read exclusively from environment variables and never returned to
// the client.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";

// Cashfree API versions. Both the Plans and Subscriptions endpoints accept
// "2025-01-01" (v5). Note: "2025-08-01" is NOT a valid version for this
// account and is rejected by the gateway.
const PLAN_API_VERSION = "2025-01-01";
const SUB_API_VERSION = "2025-01-01";

export interface CashfreeConfig {
  appId: string;
  secretKey: string;
  environment: "production" | "sandbox";
  host: string;
  origin: string;
  mode: "production" | "sandbox";
}

/** Resolves Cashfree credentials/host from env. Throws if not configured. */
export function getCashfreeConfig(): CashfreeConfig {
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const environment = (process.env.CASHFREE_ENV || "production") === "production" ? "production" : "sandbox";
  if (!appId || !secretKey) {
    throw new Error("Cashfree credentials are not configured (CASHFREE_APP_ID / CASHFREE_SECRET_KEY).");
  }
  const host = environment === "production" ? "api.cashfree.com" : "sandbox.cashfree.com";
  const origin =
    process.env.APP_ORIGIN ||
    (environment === "production" ? "https://bookmytime.tech" : "http://localhost:3000");
  return { appId, secretKey, environment, host, origin, mode: environment };
}

function baseHeaders(cfg: CashfreeConfig, apiVersion: string, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "application/json",
    "x-client-id": cfg.appId,
    "x-client-secret": cfg.secretKey,
    "x-api-version": apiVersion,
  };
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  return headers;
}

async function parseJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plans
// ─────────────────────────────────────────────────────────────────────────────

export interface PeriodicPlanInput {
  planId: string;
  planName: string;
  recurringAmount: number;
  maxAmount: number;
  maxCycles: number;
  intervalType: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervals: number;
  currency?: string;
  note?: string;
}

/** GET a plan by id. Returns null on 404. */
export async function getCashfreePlan(planId: string): Promise<any | null> {
  const cfg = getCashfreeConfig();
  const res = await fetch(`https://${cfg.host}/pg/plans/${encodeURIComponent(planId)}`, {
    method: "GET",
    headers: baseHeaders(cfg, PLAN_API_VERSION),
  });
  if (res.status === 404) return null;
  const data = await parseJsonSafe(res);
  if (!res.ok) return null;
  return data;
}

/**
 * Idempotently ensures a PERIODIC plan exists in Cashfree. Safe to call on
 * every subscription creation — returns the existing plan if already present.
 */
export async function ensureCashfreePeriodicPlan(input: PeriodicPlanInput): Promise<any> {
  const existing = await getCashfreePlan(input.planId);
  if (existing) return existing;

  const cfg = getCashfreeConfig();
  const res = await fetch(`https://${cfg.host}/pg/plans`, {
    method: "POST",
    headers: baseHeaders(cfg, PLAN_API_VERSION),
    body: JSON.stringify({
      plan_id: input.planId,
      plan_name: input.planName,
      plan_type: "PERIODIC",
      plan_currency: input.currency || "INR",
      plan_recurring_amount: input.recurringAmount,
      plan_max_amount: input.maxAmount,
      plan_max_cycles: input.maxCycles,
      plan_interval_type: input.intervalType,
      plan_intervals: input.intervals,
      plan_note: input.note || input.planName,
    }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    // A concurrent create may 409 — re-fetch before giving up.
    const retry = await getCashfreePlan(input.planId);
    if (retry) return retry;
    throw new Error(data?.message || `Failed to create Cashfree plan (${res.status})`);
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSubscriptionInput {
  subscriptionId: string;
  planId: string;
  planName: string;
  customer: { name: string; email: string; phone: string };
  returnUrl: string;
  expiryTimeIso: string;
  authorizationAmount?: number;
  note?: string;
}

export async function createCashfreeSubscription(input: CreateSubscriptionInput): Promise<any> {
  const cfg = getCashfreeConfig();
  const res = await fetch(`https://${cfg.host}/pg/subscriptions`, {
    method: "POST",
    headers: baseHeaders(cfg, SUB_API_VERSION, input.subscriptionId),
    body: JSON.stringify({
      subscription_id: input.subscriptionId,
      customer_details: {
        customer_name: input.customer.name,
        customer_email: input.customer.email,
        customer_phone: input.customer.phone || "9999999999",
      },
      plan_details: { plan_id: input.planId },
      authorization_details: {
        authorization_amount: input.authorizationAmount ?? 1,
        authorization_amount_refund: true,
      },
      subscription_meta: {
        return_url: input.returnUrl,
        notification_channel: ["EMAIL", "SMS"],
      },
      subscription_expiry_time: input.expiryTimeIso,
      subscription_tags: { subscription_note: input.note || input.planName },
    }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(data?.message || `Failed to create Cashfree subscription (${res.status})`);
  }
  return data;
}

/** GET subscription details/status. Returns null on 404. */
export async function getCashfreeSubscription(subscriptionId: string): Promise<any | null> {
  const cfg = getCashfreeConfig();
  const res = await fetch(`https://${cfg.host}/pg/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "GET",
    headers: baseHeaders(cfg, SUB_API_VERSION),
  });
  if (res.status === 404) return null;
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.message || `Failed to fetch subscription (${res.status})`);
  return data;
}

export type ManageAction = "CANCEL" | "PAUSE" | "ACTIVATE";

/** Manage a subscription lifecycle: CANCEL / PAUSE / ACTIVATE. */
export async function manageCashfreeSubscription(subscriptionId: string, action: ManageAction): Promise<any> {
  const cfg = getCashfreeConfig();
  const res = await fetch(`https://${cfg.host}/pg/subscriptions/${encodeURIComponent(subscriptionId)}/manage`, {
    method: "POST",
    headers: baseHeaders(cfg, SUB_API_VERSION),
    body: JSON.stringify({ subscription_id: subscriptionId, action }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.message || `Failed to ${action} subscription (${res.status})`);
  return data;
}

/** List payments/charges made against a subscription. Returns [] on failure. */
export async function getCashfreeSubscriptionPayments(subscriptionId: string): Promise<any[]> {
  const cfg = getCashfreeConfig();
  try {
    const res = await fetch(`https://${cfg.host}/pg/subscriptions/${encodeURIComponent(subscriptionId)}/payments`, {
      method: "GET",
      headers: baseHeaders(cfg, SUB_API_VERSION),
    });
    if (!res.ok) return [];
    const data = await parseJsonSafe(res);
    return Array.isArray(data) ? data : Array.isArray(data?.payments) ? data.payments : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook signature verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies a Cashfree webhook signature.
 *
 * Cashfree signs webhooks as:
 *   base64( HMAC_SHA256( `${timestamp}${rawBody}`, secretKey ) )
 * delivered in the `x-webhook-signature` header alongside `x-webhook-timestamp`.
 *
 * Uses a constant-time comparison to resist timing attacks. Returns false on
 * any missing input rather than throwing.
 */
export function verifyCashfreeWebhookSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null
): boolean {
  if (!signature || !timestamp) return false;
  let secretKey: string;
  try {
    secretKey = getCashfreeConfig().secretKey;
  } catch {
    return false;
  }
  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(`${timestamp}${rawBody}`)
    .digest("base64");

  const a = Buffer.from(computed);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
