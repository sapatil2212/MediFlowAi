/**
 * Custom plan provisioning + payment engine (server-only, no createServerFn).
 *
 * This module is the single place that:
 *   - provisions a workspace from an approved custom plan request,
 *   - flips that workspace between locked (payment pending) and active,
 *   - talks to Cashfree for a one-time order at the negotiated (custom) amount,
 *   - and reconciles a paid order into workspace access.
 *
 * It holds NO `createServerFn` wrappers so it can be imported by both the
 * server-fn layer (`custom-plan-requests.ts`) and the raw webhook handler
 * (`subscription-webhook.ts`) without pulling RPC plumbing into either.
 *
 * "Unlimited access" is achieved by granting the Enterprise tier (see
 * UNLIMITED_PLAN in custom-plan.ts): the app already treats Enterprise as no-cap
 * for locations, sub-users, and every boolean feature, so a paid custom-plan
 * tenant inherits unlimited entitlements with no parallel limit system.
 */

import crypto from "crypto";
import { execute, query, queryOne, withTransaction } from "./db";
import { DEFAULT_SETTINGS, PROFESSION_RESTAURANT } from "./restaurant-availability";
import { generateTenantId } from "./tenant-provisioning";
import {
  computeExpiry,
  formatTermLabel,
  formatTermsLabel,
  normalizeBillingInterval,
  type CustomPlanTerms,
  type ManualPayment,
} from "./custom-plan";
import { type PlanTier } from "./feature-access";
import { sendCustomPlanStatusEmail } from "./email";
import {
  createCashfreeSubscription,
  ensureCashfreePeriodicPlan,
  getCashfreeConfig,
} from "./cashfree";

/** Payment method label written to `User.paymentMethod` for custom plans. */
export const CUSTOM_PLAN_PAID_METHOD = "Custom Plan";
/** Payment method label while a custom plan workspace is awaiting payment. */
export const CUSTOM_PLAN_PENDING_METHOD = "Custom Plan (pending)";

/** Order-id prefix for custom-plan one-time payments (kept distinct from renewals). */
export const CUSTOM_ORDER_PREFIX = "order_custom_";

function generateId(): string {
  return crypto.randomUUID();
}

/** The full CustomPlanRequest row shape used across provisioning + activation. */
export interface CustomPlanRow {
  id: string;
  referenceId: string;
  name: string;
  email: string;
  phone: string;
  businessName: string;
  profession: string;
  practiceSize: string;
  passwordHash: string;
  requirements: string | null;
  status: string;
  grantedPlan: string | null;
  grantedAmount: number | string | null;
  billingInterval: string;
  termMonths: number | null;
  adminNotes: string | null;
  collectionMode: string | null;
  paymentToken: string | null;
  paymentOrderId: string | null;
  paidAt: string | null;
  tenantId: string | null;
  userId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  activatedAt: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

/** Cashfree host + credentials + return origin, resolved from env. */
function cashfreeEnv() {
  const appId = process.env.CASHFREE_APP_ID || "";
  const secretKey = process.env.CASHFREE_SECRET_KEY || "";
  const environment = process.env.CASHFREE_ENV === "sandbox" ? "sandbox" : "production";
  const host = environment === "production" ? "api.cashfree.com" : "sandbox.cashfree.com";
  const origin =
    process.env.APP_ORIGIN ||
    (environment === "production" ? "https://bookmytime.tech" : "http://localhost:3000");
  return { appId, secretKey, environment, host, origin };
}

/** The public origin for links in email (never derives from an untrusted host). */
export function publicOrigin(): string {
  return cashfreeEnv().origin;
}

/** A cryptographically-random, URL-safe token for the emailed payment link. */
export function generatePaymentToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** The tenant-facing unlock/pay URL for a request's payment token. */
export function buildPaymentLink(token: string): string {
  return `${publicOrigin()}/unlock?ref=${encodeURIComponent(token)}`;
}

/**
 * Records a one-time payment attempt in PaymentHistory keyed by orderId.
 *
 * A local copy (rather than importing auth.ts's private helper) keeps this
 * module free of the large auth graph. Never throws — a ledger write must never
 * break a payment or activation.
 */
async function upsertPaymentHistory(fields: {
  userId?: string | null;
  tenantId?: string | null;
  orderId: string;
  cfPaymentId?: string | null;
  plan?: string | null;
  amount: number;
  status: string;
  orderStatus?: string | null;
  paymentMode?: string | null;
  gateway?: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO PaymentHistory
         (id, userId, tenantId, orderId, cfPaymentId, plan, amount, currency, status, orderStatus, paymentMode, customerName, customerEmail, customerPhone, gateway, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         userId = COALESCE(?, userId),
         tenantId = COALESCE(?, tenantId),
         cfPaymentId = COALESCE(?, cfPaymentId),
         plan = COALESCE(?, plan),
         amount = ?,
         status = ?,
         orderStatus = COALESCE(?, orderStatus),
         paymentMode = COALESCE(?, paymentMode),
         updatedAt = NOW()`,
      [
        generateId(),
        fields.userId ?? null,
        fields.tenantId ?? null,
        fields.orderId,
        fields.cfPaymentId ?? null,
        fields.plan ?? null,
        fields.amount,
        fields.status,
        fields.orderStatus ?? null,
        fields.paymentMode ?? null,
        fields.customerName ?? null,
        fields.customerEmail ?? null,
        fields.customerPhone ?? null,
        fields.gateway || "Cashfree",
        // UPDATE params
        fields.userId ?? null,
        fields.tenantId ?? null,
        fields.cfPaymentId ?? null,
        fields.plan ?? null,
        fields.amount,
        fields.status,
        fields.orderStatus ?? null,
        fields.paymentMode ?? null,
      ],
    );
  } catch (err) {
    console.warn(
      "[CustomPlan] PaymentHistory upsert failed for",
      fields.orderId,
      ":",
      err instanceof Error ? err.message : err,
    );
  }
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * Creates (or upgrades) the tenant workspace behind an approved request.
 *
 * `locked` true provisions with `subscriptionStatus = 'PaymentPending'` and NO
 * expiry, so the owner can sign in (login does not block on that status) but is
 * bounced to the paywall and every feature resolves unavailable until paid.
 * `locked` false provisions straight to Active with a term expiry.
 *
 * Runs in one transaction: owner row + restaurant defaults + subscription
 * journal all land together, so a failure never leaves a half-built workspace.
 * An existing account for the same email is upgraded in place — and if it is
 * already Active it is never downgraded to locked.
 */
export async function provisionCustomPlanWorkspace(
  row: CustomPlanRow,
  terms: CustomPlanTerms,
  opts: { locked: boolean },
): Promise<{ tenantId: string; userId: string; created: boolean; locked: boolean }> {
  return withTransaction(async (conn) => {
    const existingRows = (await conn.query(
      "SELECT id, tenantId, subscriptionStatus, subscriptionPlan FROM User WHERE email = ? LIMIT 1",
      [row.email],
    )) as Array<{
      id: string;
      tenantId: string | null;
      subscriptionStatus: string | null;
      subscriptionPlan: string | null;
    }>;
    const existing = existingRows.length > 0 ? existingRows[0] : null;

    // Never strip access from an already-active account when locking; treat it
    // as an immediate upgrade instead.
    const alreadyActive = (existing?.subscriptionStatus || "").toLowerCase() === "active";
    const applyLock = opts.locked && !alreadyActive;

    const status = applyLock ? "PaymentPending" : "Active";
    const expiresAt = applyLock ? null : computeExpiry(new Date(), terms.termMonths);
    const method = applyLock ? CUSTOM_PLAN_PENDING_METHOD : CUSTOM_PLAN_PAID_METHOD;

    if (existing) {
      await conn.query(
        `UPDATE User SET
           subscriptionStatus = ?,
           subscriptionPlan = ?,
           subscriptionExpiresAt = ?,
           paymentMethod = ?,
           paymentAmount = ?,
           billingInterval = ?,
           updatedAt = NOW()
         WHERE id = ?`,
        [
          status,
          terms.grantedPlan,
          expiresAt,
          method,
          terms.grantedAmount,
          terms.billingInterval,
          existing.id,
        ],
      );
      await conn.query(
        `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'SuperAdmin')`,
        [
          generateId(),
          existing.id,
          existing.subscriptionStatus || "None",
          status,
          existing.subscriptionPlan || "None",
          terms.grantedPlan,
          terms.grantedAmount,
          terms.billingInterval,
        ],
      );
      return {
        tenantId: existing.tenantId || "",
        userId: existing.id,
        created: false,
        locked: applyLock,
      };
    }

    // New workspace — draw a unique tenantId (User.tenantId is UNIQUE).
    let tenantId = "";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateTenantId(row.profession);
      const taken = (await conn.query("SELECT id FROM User WHERE tenantId = ? LIMIT 1", [
        candidate,
      ])) as Array<{ id: string }>;
      if (taken.length === 0) {
        tenantId = candidate;
        break;
      }
    }
    if (!tenantId) {
      throw new Error("Could not allocate a workspace id. Please retry.");
    }

    const userId = generateId();
    await conn.query(
      `INSERT INTO User (
         id, tenantId, name, email, phone, clinicName, practiceSize, password,
         subscriptionStatus, subscriptionPlan, subscriptionExpiresAt,
         paymentMethod, paymentAmount, billingInterval, profession, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        userId,
        tenantId,
        row.name,
        row.email,
        row.phone,
        row.businessName,
        row.practiceSize,
        row.passwordHash,
        status,
        terms.grantedPlan,
        expiresAt,
        method,
        terms.grantedAmount,
        terms.billingInterval,
        row.profession,
      ],
    );

    if (row.profession === PROFESSION_RESTAURANT) {
      await conn.query(
        `INSERT INTO RestaurantSettings (id, tenantId, slotInterval, turnTime, maxPartySize, advanceBookingWindow, minLeadTime, timezone, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          generateId(),
          tenantId,
          DEFAULT_SETTINGS.slotInterval,
          DEFAULT_SETTINGS.turnTime,
          DEFAULT_SETTINGS.maxPartySize,
          DEFAULT_SETTINGS.advanceBookingWindow,
          DEFAULT_SETTINGS.minLeadTime,
          DEFAULT_SETTINGS.timezone,
        ],
      );
    }

    await conn.query(
      `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
       VALUES (?, ?, 'None', ?, 'None', ?, ?, ?, NOW(), 'SuperAdmin')`,
      [generateId(), userId, status, terms.grantedPlan, terms.grantedAmount, terms.billingInterval],
    );

    return { tenantId, userId, created: true, locked: applyLock };
  });
}

// ---------------------------------------------------------------------------
// Activation (unlock)
// ---------------------------------------------------------------------------

/** Reads the granted terms off a request row into the normalised shape. */
export function termsFromRow(row: CustomPlanRow): CustomPlanTerms {
  const interval = normalizeBillingInterval(row.billingInterval);
  return {
    grantedPlan: (row.grantedPlan as CustomPlanTerms["grantedPlan"]) || "Enterprise",
    grantedAmount: Number(row.grantedAmount ?? 0),
    billingInterval: interval,
    termMonths: Number(row.termMonths ?? 1),
  };
}

/**
 * Unlocks a provisioned workspace: sets the tenant Active with a fresh term
 * expiry, journals the change, optionally records a manual payment, flips the
 * request to Active, and emails the "workspace is live" confirmation.
 *
 * Idempotent: a request already Active is left untouched and reports success,
 * so a webhook and a return-verify racing to confirm the same payment cannot
 * double-activate or double-charge the ledger.
 */
export async function activateCustomPlanTenant(
  row: CustomPlanRow,
  opts: {
    via: "manual" | "gateway";
    cfPaymentId?: string | null;
    paidAmount?: number | null;
    paymentModeLabel?: string | null;
  },
): Promise<{ activated: boolean; alreadyActive: boolean; tenantId: string | null }> {
  if (!row.userId) {
    throw new Error("This request has no provisioned workspace to activate.");
  }

  const current = await queryOne<{ subscriptionStatus: string | null }>(
    "SELECT subscriptionStatus FROM User WHERE id = ? LIMIT 1",
    [row.userId],
  );
  if (!current) {
    throw new Error("The workspace linked to this request no longer exists.");
  }

  const alreadyActive =
    (current.subscriptionStatus || "").toLowerCase() === "active" &&
    (row.status || "").toLowerCase() === "active";
  if (alreadyActive) {
    return { activated: false, alreadyActive: true, tenantId: row.tenantId };
  }

  const terms = termsFromRow(row);
  const expiresAt = computeExpiry(new Date(), terms.termMonths);
  const method =
    opts.via === "manual"
      ? `${CUSTOM_PLAN_PAID_METHOD} (offline)`
      : opts.paymentModeLabel || CUSTOM_PLAN_PAID_METHOD;

  await execute(
    `UPDATE User SET
       subscriptionStatus = 'Active',
       subscriptionPlan = ?,
       subscriptionExpiresAt = ?,
       paymentMethod = ?,
       paymentAmount = ?,
       billingInterval = ?,
       updatedAt = NOW()
     WHERE id = ?`,
    [terms.grantedPlan, expiresAt, method, terms.grantedAmount, terms.billingInterval, row.userId],
  );

  await execute(
    `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
     VALUES (?, ?, ?, 'Active', ?, ?, ?, ?, NOW(), ?)`,
    [
      generateId(),
      row.userId,
      current.subscriptionStatus || "PaymentPending",
      terms.grantedPlan,
      terms.grantedPlan,
      terms.grantedAmount,
      terms.billingInterval,
      opts.via === "manual" ? "SuperAdmin" : "Cashfree",
    ],
  );

  // A manual (offline) payment has no gateway order, so log it to the ledger
  // here. Gateway payments are already recorded by reconcileCustomPlanOrder.
  if (opts.via === "manual" && terms.grantedAmount > 0) {
    await upsertPaymentHistory({
      userId: row.userId,
      tenantId: row.tenantId,
      orderId: `manual_custom_${row.id}_${Date.now()}`,
      plan: terms.grantedPlan,
      amount: terms.grantedAmount,
      status: "SUCCESS",
      orderStatus: "PAID",
      paymentMode: "Offline / Manual",
      gateway: "Manual",
      customerName: row.name,
      customerEmail: row.email,
      customerPhone: row.phone,
    });
  }

  await execute(
    `UPDATE CustomPlanRequest SET status = 'Active', paidAt = NOW(), activatedAt = COALESCE(activatedAt, NOW()), updatedAt = NOW() WHERE id = ?`,
    [row.id],
  );

  // Best-effort confirmation — never roll back a confirmed payment on email fail.
  try {
    await sendCustomPlanStatusEmail({
      email: row.email,
      subject: `Your BookMyTime workspace is live • ${row.referenceId}`,
      title: "Payment received — your workspace is active",
      message: `Hi ${row.name}, we've received your payment and ${row.businessName} is now live on BookMyTime with your custom plan. Sign in with this email and the password you chose when you requested the plan.`,
      tone: "success",
      details: [
        { label: "Reference", value: row.referenceId },
        ...(row.tenantId ? [{ label: "Workspace ID", value: row.tenantId }] : []),
        { label: "Plan", value: `${terms.grantedPlan} (custom · unlimited)` },
        {
          label: "Amount paid",
          value: formatTermsLabel(terms.grantedAmount, terms.billingInterval),
        },
        { label: "Term", value: formatTermLabel(terms.termMonths) },
        { label: "Renews on", value: expiresAt.toISOString().slice(0, 10) },
      ],
      cta: { label: "Sign in to your workspace", url: `${publicOrigin()}/login` },
      footnote: "Forgotten your password? Use 'Forgot password' on the sign-in page.",
    });
  } catch (err) {
    console.error(
      `[CustomPlan] Failed to send activation email for ${row.referenceId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return { activated: true, alreadyActive: false, tenantId: row.tenantId };
}

// ---------------------------------------------------------------------------
// Repeatable manual (offline) payment collection
// ---------------------------------------------------------------------------

/** The outcome of recording one manual payment. */
export interface ManualPaymentResult {
  amount: number;
  method: string;
  reference: string | null;
  /** ISO date the subscription now runs through after this collection. */
  expiresAt: string;
  /** The unique ledger order id written for this collection. */
  orderId: string;
}

/**
 * Records ONE manual (offline) payment against a provisioned custom-plan
 * workspace and can be called any number of times.
 *
 * Unlike {@link activateCustomPlanTenant} (which is idempotent and no-ops once
 * the tenant is Active), this always writes a fresh, uniquely-keyed ledger
 * entry and always extends paid access. Each collection pushes the expiry one
 * term further from the LATER of "now" and the current expiry, so paying twice
 * in a row stacks the coverage instead of overwriting it, and paying after a
 * lapse restarts from today. The tenant is (re)set Active either way.
 *
 * The negotiated method and reference id (UPI txn id, card auth ref, UTR,
 * cheque no.) are stored on the ledger row — method in `paymentMode`, reference
 * in `cfPaymentId` — with `gateway = 'Manual'` so offline settlements are never
 * confused with gateway payments. Never charges anything; it only records money
 * the super admin already collected out of band.
 */
export async function recordManualCustomPlanPayment(
  row: CustomPlanRow,
  payment: ManualPayment,
): Promise<ManualPaymentResult> {
  if (!row.userId) {
    throw new Error("This request has no provisioned workspace to collect against.");
  }

  const current = await queryOne<{
    subscriptionStatus: string | null;
    subscriptionPlan: string | null;
    subscriptionExpiresAt: string | Date | null;
  }>(
    "SELECT subscriptionStatus, subscriptionPlan, subscriptionExpiresAt FROM User WHERE id = ? LIMIT 1",
    [row.userId],
  );
  if (!current) {
    throw new Error("The workspace linked to this request no longer exists.");
  }

  const terms = termsFromRow(row);
  const now = new Date();
  const currentExpiry = current.subscriptionExpiresAt
    ? new Date(current.subscriptionExpiresAt)
    : null;
  // Stack coverage: extend from the current expiry when it is still in the
  // future, otherwise restart the term from today.
  const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  const expiresAt = computeExpiry(base, terms.termMonths);

  const methodLabel = `${CUSTOM_PLAN_PAID_METHOD} · ${payment.method}`;

  await execute(
    `UPDATE User SET
       subscriptionStatus = 'Active',
       subscriptionPlan = ?,
       subscriptionExpiresAt = ?,
       paymentMethod = ?,
       paymentAmount = ?,
       billingInterval = ?,
       updatedAt = NOW()
     WHERE id = ?`,
    [terms.grantedPlan, expiresAt, methodLabel, payment.amount, terms.billingInterval, row.userId],
  );

  await execute(
    `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
     VALUES (?, ?, ?, 'Active', ?, ?, ?, ?, NOW(), 'SuperAdmin')`,
    [
      generateId(),
      row.userId,
      current.subscriptionStatus || "PaymentPending",
      current.subscriptionPlan || terms.grantedPlan,
      terms.grantedPlan,
      payment.amount,
      terms.billingInterval,
    ],
  );

  const orderId = `manual_custom_${row.id}_${Date.now()}`;
  await upsertPaymentHistory({
    userId: row.userId,
    tenantId: row.tenantId,
    orderId,
    cfPaymentId: payment.reference,
    plan: terms.grantedPlan,
    amount: payment.amount,
    status: "SUCCESS",
    orderStatus: "PAID",
    paymentMode: payment.method,
    gateway: "Manual",
    customerName: row.name,
    customerEmail: row.email,
    customerPhone: row.phone,
  });

  await execute(
    `UPDATE CustomPlanRequest SET status = 'Active', paidAt = NOW(), activatedAt = COALESCE(activatedAt, NOW()), updatedAt = NOW() WHERE id = ?`,
    [row.id],
  );

  // Best-effort receipt — a mail failure must never undo a recorded payment.
  try {
    await sendCustomPlanStatusEmail({
      email: row.email,
      subject: `Payment received • ${row.referenceId}`,
      title: "We've recorded your payment",
      message: `Hi ${row.name}, we've recorded a payment for ${row.businessName} and your BookMyTime workspace is active. A summary of this payment is below.`,
      tone: "success",
      details: [
        { label: "Reference", value: row.referenceId },
        ...(row.tenantId ? [{ label: "Workspace ID", value: row.tenantId }] : []),
        { label: "Plan", value: `${terms.grantedPlan} (custom · unlimited)` },
        {
          label: "Amount received",
          value: formatTermsLabel(payment.amount, terms.billingInterval),
        },
        { label: "Method", value: payment.method },
        ...(payment.reference ? [{ label: "Reference / txn ID", value: payment.reference }] : []),
        { label: "Active through", value: expiresAt.toISOString().slice(0, 10) },
      ],
      cta: { label: "Sign in to your workspace", url: `${publicOrigin()}/login` },
      footnote: "Keep this email as your receipt.",
    });
  } catch (err) {
    console.error(
      `[CustomPlan] Failed to send manual payment receipt for ${row.referenceId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return {
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    expiresAt: expiresAt.toISOString(),
    orderId,
  };
}

// ---------------------------------------------------------------------------
// Cashfree custom order
// ---------------------------------------------------------------------------

/**
 * Creates a Cashfree one-time order for a request's negotiated amount and
 * records a PENDING ledger row. The order id embeds the request id (hyphen-free)
 * so a webhook can map back even if the paymentOrderId write lost a race, and
 * paymentOrderId is also stored on the request as the primary linkage.
 */
export async function createCustomPlanOrder(
  row: CustomPlanRow,
  returnPath: string,
): Promise<{ paymentSessionId: string; orderId: string; amount: number; environment: string }> {
  const terms = termsFromRow(row);
  if (!(terms.grantedAmount > 0)) {
    throw new Error("This custom plan has no payable amount. Ask the team to record it as paid.");
  }

  const { appId, secretKey, environment, host, origin } = cashfreeEnv();
  if (!appId || !secretKey) {
    throw new Error("Online payments are not configured. Please contact support.");
  }

  const orderId = `${CUSTOM_ORDER_PREFIX}${row.id.replace(/-/g, "")}_${Date.now()}`;
  const safePath =
    returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/unlock";
  const returnUrl = `${origin}${safePath}${safePath.includes("?") ? "&" : "?"}order_id=${orderId}`;

  const payload = {
    order_id: orderId,
    order_amount: terms.grantedAmount,
    order_currency: "INR",
    customer_details: {
      customer_id: row.userId || row.id,
      customer_phone: row.phone || "9999999999",
      customer_email: row.email,
      customer_name: row.name,
    },
    order_meta: { return_url: returnUrl },
    order_tags: { kind: "custom_plan", reference: row.referenceId },
  };

  const response = await fetch(`https://${host}/pg/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": appId,
      "x-client-secret": secretKey,
      "x-api-version": "2023-08-01",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[CustomPlan] Cashfree create order error:", errorText);
    throw new Error("Could not start the payment. Please try again in a moment.");
  }

  const orderData = await response.json();

  await execute("UPDATE CustomPlanRequest SET paymentOrderId = ?, updatedAt = NOW() WHERE id = ?", [
    orderId,
    row.id,
  ]);

  await upsertPaymentHistory({
    userId: row.userId,
    tenantId: row.tenantId,
    orderId,
    plan: terms.grantedPlan,
    amount: terms.grantedAmount,
    status: "PENDING",
    orderStatus: "ACTIVE",
    customerName: row.name,
    customerEmail: row.email,
    customerPhone: row.phone,
  });

  return {
    paymentSessionId: orderData.payment_session_id,
    orderId,
    amount: terms.grantedAmount,
    environment,
  };
}

/** Maps a Cashfree payment_group to a readable label. */
function paymentModeLabel(group?: string): string {
  const g = (group || "").toLowerCase();
  if (g.startsWith("upi")) return "UPI";
  if (g.includes("credit")) return "Credit Card";
  if (g.includes("debit")) return "Debit Card";
  if (g === "net_banking") return "Net Banking";
  if (g === "wallet") return "Wallet";
  return "Cashfree";
}

/** Finds the request that owns a custom-plan order id. */
async function findRequestByOrderId(orderId: string): Promise<CustomPlanRow | null> {
  const byColumn = await queryOne<CustomPlanRow>(
    "SELECT * FROM CustomPlanRequest WHERE paymentOrderId = ? LIMIT 1",
    [orderId],
  );
  if (byColumn) return byColumn;

  // Fallback: recover the request id embedded in the order id
  // (order_custom_<idNoHyphens>_<ts>) and match on a hyphen-stripped id.
  const middle = orderId.slice(CUSTOM_ORDER_PREFIX.length).split("_")[0];
  if (!middle) return null;
  return queryOne<CustomPlanRow>(
    "SELECT * FROM CustomPlanRequest WHERE REPLACE(id, '-', '') = ? LIMIT 1",
    [middle],
  );
}

/**
 * Fetches the authoritative order status from Cashfree and, when PAID, records
 * the successful payment and activates the workspace. Returns the order status.
 * Idempotent and safe to call from the return-verify path AND the webhook.
 */
export async function reconcileCustomPlanOrder(
  orderId: string,
): Promise<{ status: string; activated: boolean; alreadyActive: boolean }> {
  const { appId, secretKey, host } = cashfreeEnv();
  if (!appId || !secretKey) throw new Error("Payments are not configured.");

  const response = await fetch(`https://${host}/pg/orders/${orderId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": appId,
      "x-client-secret": secretKey,
      "x-api-version": "2023-08-01",
    },
  });
  if (!response.ok) {
    throw new Error("Could not verify the payment status. Please try again.");
  }

  const orderData = await response.json();
  const orderStatus = String(orderData.order_status || "").toUpperCase();
  const orderAmount = Number(orderData.order_amount || 0);

  const row = await findRequestByOrderId(orderId);
  if (!row) {
    return { status: orderStatus, activated: false, alreadyActive: false };
  }

  if (orderStatus !== "PAID") {
    await upsertPaymentHistory({
      userId: row.userId,
      tenantId: row.tenantId,
      orderId,
      amount: orderAmount,
      status: orderStatus === "ACTIVE" ? "PENDING" : "FAILED",
      orderStatus,
    });
    return { status: orderStatus, activated: false, alreadyActive: false };
  }

  // Enrich the ledger with the actual payment mode + cf id where available.
  let cfPaymentId: string | null = null;
  let modeLabel = "Cashfree";
  try {
    const payRes = await fetch(`https://${host}/pg/orders/${orderId}/payments`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": appId,
        "x-client-secret": secretKey,
        "x-api-version": "2023-08-01",
      },
    });
    if (payRes.ok) {
      const payments = await payRes.json();
      if (Array.isArray(payments) && payments.length > 0) {
        const latest = payments[0];
        cfPaymentId = latest?.cf_payment_id ? String(latest.cf_payment_id) : null;
        modeLabel = paymentModeLabel(latest?.payment_group);
      }
    }
  } catch {
    /* mode enrichment is best-effort */
  }

  const terms = termsFromRow(row);
  await upsertPaymentHistory({
    userId: row.userId,
    tenantId: row.tenantId,
    orderId,
    cfPaymentId,
    plan: terms.grantedPlan,
    amount: orderAmount || terms.grantedAmount,
    status: "SUCCESS",
    orderStatus,
    paymentMode: modeLabel,
  });

  const result = await activateCustomPlanTenant(row, {
    via: "gateway",
    cfPaymentId,
    paidAmount: orderAmount,
    paymentModeLabel: `Cashfree · ${modeLabel}`,
  });

  return { status: orderStatus, activated: result.activated, alreadyActive: result.alreadyActive };
}

/** True when an order id belongs to the custom-plan payment flow. */
export function isCustomPlanOrder(orderId: string | null | undefined): boolean {
  return typeof orderId === "string" && orderId.startsWith(CUSTOM_ORDER_PREFIX);
}

// ---------------------------------------------------------------------------
// Recurring AutoPay for a negotiated (custom) amount
// ---------------------------------------------------------------------------

/** Deterministic Cashfree plan id for a negotiated (custom) monthly amount. */
function customPlanIdFor(amount: number): string {
  return `bmt_custom_monthly_${amount}`;
}

/**
 * Starts a recurring monthly AutoPay mandate for an ARBITRARY (negotiated)
 * amount — the custom-plan equivalent of createSubscriptionServerFn, which is
 * locked to the PLAN_BILLING list prices.
 *
 * The mandate authorises the full custom amount up front (so the first month is
 * collected immediately) and schedules the next charge one interval out. The
 * local Subscription row stores the granted tier label so every downstream
 * consumer's `normalizePlan(planTier)` keeps working.
 *
 * Lives here (a server-only module never statically imported by a client
 * component) rather than in subscription.ts — an EXPORTED server function in a
 * client-imported module cannot be stripped from the browser bundle and would
 * drag `db`/`dotenv` into the client.
 */
export async function startCustomAmountSubscription(params: {
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  phone?: string | null;
  /** The stored plan tier label (kept normalizable — use "Enterprise"). */
  tier: PlanTier;
  /** The negotiated monthly amount in INR. */
  amount: number;
  /** Same-origin return path; `sub_id=<ref>` is appended for the return verify. */
  returnPath: string;
}): Promise<{
  success: true;
  subscriptionRef: string;
  subscription_session_id: string | null;
  mode: "production" | "sandbox";
  amount: number;
}> {
  if (!(params.amount > 0)) {
    throw new Error("A custom AutoPay amount must be greater than zero.");
  }

  // One active/pending mandate per account.
  const existingActive = await queryOne<{ subscriptionRef: string }>(
    "SELECT subscriptionRef FROM Subscription WHERE userId = ? AND status IN ('ACTIVE','BANK_APPROVAL_PENDING') LIMIT 1",
    [params.userId],
  );
  if (existingActive) {
    throw new Error(
      "This workspace already has an active AutoPay mandate. Cancel it before starting a new one.",
    );
  }

  const cfg = getCashfreeConfig();
  const planId = customPlanIdFor(params.amount);

  await ensureCashfreePeriodicPlan({
    planId,
    planName: `BookMyTime Custom Monthly`,
    recurringAmount: params.amount,
    maxAmount: params.amount,
    maxCycles: 120,
    intervalType: "MONTH",
    intervals: 1,
    currency: "INR",
    note: `Custom monthly plan Rs ${params.amount}`,
  });

  const year = new Date().getFullYear();
  const uniqueId = Date.now().toString(36).toUpperCase().padStart(8, "0").slice(-8);
  const subscriptionRef = `BMT-SUB-${year}-${uniqueId}`;

  const safePath =
    params.returnPath.startsWith("/") && !params.returnPath.startsWith("//")
      ? params.returnPath
      : "/unlock";
  const origin = publicOrigin();
  const returnUrl = `${origin}${safePath}${safePath.includes("?") ? "&" : "?"}sub_id=${subscriptionRef}`;

  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 5);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const cfSub = await createCashfreeSubscription({
    subscriptionId: subscriptionRef,
    planId,
    planName: `BookMyTime Custom Monthly`,
    customer: { name: params.name, email: params.email, phone: params.phone || "9999999999" },
    returnUrl,
    expiryTimeIso: expiry.toISOString(),
    authorizationAmount: params.amount,
    note: `Custom AutoPay`,
    firstChargeTimeIso: tomorrow.toISOString(),
  });

  await execute(
    `INSERT INTO Subscription
       (id, userId, tenantId, subscriptionRef, cfSubscriptionId, cfPlanId, planTier, amount, currency, intervalType, intervals,
        status, sessionId, customerName, customerEmail, customerPhone, gateway, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'MONTH', 1, ?, ?, ?, ?, ?, 'Cashfree', NOW(), NOW())`,
    [
      generateId(),
      params.userId,
      params.tenantId,
      subscriptionRef,
      cfSub?.cf_subscription_id ? String(cfSub.cf_subscription_id) : null,
      planId,
      params.tier,
      params.amount,
      String(cfSub?.subscription_status || "INITIALIZED").toUpperCase(),
      cfSub?.subscription_session_id || null,
      params.name,
      params.email,
      params.phone || null,
    ],
  );

  return {
    success: true,
    subscriptionRef,
    subscription_session_id: cfSub?.subscription_session_id || null,
    mode: cfg.mode,
    amount: params.amount,
  };
}

// ---------------------------------------------------------------------------
// Expiry sweep — re-lock custom plans that lapsed without AutoPay
// ---------------------------------------------------------------------------

/**
 * Re-locks active custom-plan workspaces whose term has lapsed and that are NOT
 * on an AutoPay mandate. Those tenants paid once (or offline) for a fixed term;
 * when it ends with no recurring mandate to renew it, the workspace is put back
 * into `PaymentPending` (access withheld, no expiry so the owner can still sign
 * in and reach the paywall) and a fresh payment link is emailed.
 *
 * Tenants WITH an active/pending/on-hold mandate are skipped — AutoPay (and its
 * grace period) governs their renewal. Invoked from the reminder cycle.
 */
export async function sweepExpiredCustomPlans(): Promise<number> {
  const rows = await query<CustomPlanRow>(
    `SELECT cpr.* FROM CustomPlanRequest cpr
       JOIN User u ON u.id COLLATE utf8mb4_unicode_ci = cpr.userId COLLATE utf8mb4_unicode_ci
      WHERE cpr.status = 'Active'
        AND u.subscriptionStatus = 'Active'
        AND u.subscriptionExpiresAt IS NOT NULL
        AND u.subscriptionExpiresAt < NOW()
        AND NOT EXISTS (
          SELECT 1 FROM Subscription s
           WHERE s.userId COLLATE utf8mb4_unicode_ci = cpr.userId COLLATE utf8mb4_unicode_ci
             AND s.status IN ('ACTIVE','BANK_APPROVAL_PENDING','ON_HOLD')
        )`,
  );
  if (!rows || rows.length === 0) return 0;

  let locked = 0;
  for (const row of rows) {
    if (!row.userId) continue;
    const terms = termsFromRow(row);
    const token = row.paymentToken || generatePaymentToken();
    try {
      await execute(
        `UPDATE User SET subscriptionStatus = 'PaymentPending', subscriptionExpiresAt = NULL,
           paymentMethod = ?, updatedAt = NOW() WHERE id = ?`,
        [CUSTOM_PLAN_PENDING_METHOD, row.userId],
      );
      await execute(
        `UPDATE CustomPlanRequest SET status = 'PaymentPending', paymentToken = ?, paidAt = NULL, updatedAt = NOW() WHERE id = ?`,
        [token, row.id],
      );
      await execute(
        `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
         VALUES (?, ?, 'Active', 'PaymentPending', ?, ?, ?, ?, NOW(), 'System')`,
        [
          generateId(),
          row.userId,
          terms.grantedPlan,
          terms.grantedPlan,
          terms.grantedAmount,
          terms.billingInterval,
        ],
      );
      locked += 1;

      try {
        await sendCustomPlanStatusEmail({
          email: row.email,
          subject: `Renew your BookMyTime workspace • ${row.referenceId}`,
          title: "Your custom plan term has ended",
          message: `Hi ${row.name}, the term for ${row.businessName} has ended and there's no AutoPay set up to renew it. Access is paused until payment is complete — use the secure link below to renew.`,
          tone: "warning",
          details: [
            { label: "Reference", value: row.referenceId },
            {
              label: "Amount due",
              value: formatTermsLabel(terms.grantedAmount, terms.billingInterval),
            },
          ],
          cta: {
            label: `Renew ${formatTermsLabel(terms.grantedAmount, terms.billingInterval)}`,
            url: buildPaymentLink(token),
          },
          footnote: "Set up AutoPay during checkout to renew automatically next time.",
        });
      } catch (err) {
        console.error(
          `[CustomPlan] Failed to email renewal link for ${row.referenceId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    } catch (err) {
      console.error(
        `[CustomPlan] Failed to re-lock expired custom plan ${row.referenceId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return locked;
}
