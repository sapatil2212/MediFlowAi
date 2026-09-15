/**
 * Custom plan request server functions.
 *
 * Two audiences share this module:
 *   - the public pricing page, which submits a request (no session required);
 *   - the super admin console, which reviews, prices, and activates it.
 *
 * Every super-admin function repeats the `verifyAdminSession()` guard that the
 * rest of `admin.ts` uses. All lifecycle decisions go through ONE endpoint
 * (`reviewCustomPlanRequestServerFn`) so the state machine in `custom-plan.ts`
 * is the only thing that decides what is legal — there is no second code path
 * that can write a status the machine forbids.
 */

import { createServerFn } from "@tanstack/react-start";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { execute, query, queryOne } from "./db";
import { verifyAdminSession } from "./admin.server";
import { verifySession } from "./auth.server";
import {
  sendCustomPlanRequestAdminNotificationEmail,
  sendCustomPlanRequestConfirmationEmail,
  sendCustomPlanStatusEmail,
} from "./email";
import {
  ACTION_LABEL,
  actionRequiresTerms,
  buildReferenceId,
  canPerform,
  computeExpiry,
  formatTermLabel,
  formatTermsLabel,
  normalizeCollectionMode,
  normalizeGrantedPlan,
  normalizeStatus,
  statusAfter,
  validateCustomPlanRequest,
  validateCustomPlanTerms,
  type CustomPlanAction,
  type CustomPlanRequestInput,
  type CustomPlanStatus,
  type CustomPlanTerms,
} from "./custom-plan";
import {
  activateCustomPlanTenant,
  buildPaymentLink,
  createCustomPlanOrder,
  CUSTOM_PLAN_PAID_METHOD,
  CUSTOM_PLAN_PENDING_METHOD,
  generatePaymentToken,
  provisionCustomPlanWorkspace,
  reconcileCustomPlanOrder,
  termsFromRow,
  type CustomPlanRow,
} from "./custom-plan-payment";

/**
 * A `CustomPlanRequest` row as the driver returns it (same shape the payment
 * engine consumes). `grantedAmount` is a DECIMAL, which mariadb may hand back
 * as a string, so every consumer goes through the shared term helpers rather
 * than doing arithmetic on it directly.
 */
type CustomPlanRequestRecord = CustomPlanRow;

/** The joined shape the super-admin console reads (no password hash exposed). */
interface CustomPlanRequestListRow extends Omit<CustomPlanRequestRecord, "passwordHash"> {
  tenantSubscriptionStatus: string | null;
  tenantSubscriptionPlan: string | null;
  tenantSubscriptionExpiresAt: string | null;
  tenantPaymentAmount: number | string | null;
}

/** Statuses that mean a deal is still live, so a duplicate must be refused. */
const OPEN_STATUSES: CustomPlanStatus[] = ["Pending", "PaymentPending", "Active", "Suspended"];

function generateId(): string {
  return crypto.randomUUID();
}

/** The public origin used for links in outbound email. */
function appOrigin(): string {
  return (
    process.env.APP_ORIGIN ||
    (process.env.NODE_ENV === "production" ? "https://bookmytime.tech" : "http://localhost:3000")
  );
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Refuses a request that could never be provisioned, and says why.
 *
 * `User.email` and `User.phone` are both UNIQUE, so a clash discovered at
 * activation time would strand an approved deal that the super admin cannot
 * complete. Checking here moves that failure to the point where the requester
 * can still fix it.
 */
async function assertEligible(email: string, phone: string): Promise<void> {
  const existingUser = await queryOne<{ id: string }>(
    "SELECT id FROM User WHERE email = ? LIMIT 1",
    [email],
  );
  if (existingUser) {
    throw new Error(
      "This email already has a BookMyTime workspace. Sign in, or contact support to move your existing workspace to a custom plan.",
    );
  }

  if (phone) {
    const existingPhone = await queryOne<{ id: string }>(
      "SELECT id FROM User WHERE phone = ? LIMIT 1",
      [phone],
    );
    if (existingPhone) {
      throw new Error(
        "This phone number is already registered to a BookMyTime workspace. Please use a different number or contact support.",
      );
    }
  }

  const openRequest = await queryOne<{ referenceId: string; status: string }>(
    `SELECT referenceId, status FROM CustomPlanRequest
     WHERE email = ? AND status IN (?, ?, ?, ?)
     ORDER BY createdAt DESC LIMIT 1`,
    [email, ...OPEN_STATUSES],
  );
  if (openRequest) {
    throw new Error(
      `A custom plan request for this email is already with our team (${openRequest.referenceId}). We will get back to you shortly.`,
    );
  }
}

/**
 * Pre-flight check the request form runs before it sends a verification code, so
 * a requester is never asked to verify an email that cannot be accepted.
 */
export const checkCustomPlanEligibilityServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; phone?: string }) => {
    if (!data?.email || !data.email.includes("@")) throw new Error("Invalid email");
    return data;
  })
  .handler(async ({ data }) => {
    await assertEligible(
      data.email.trim().toLowerCase(),
      (data.phone || "").replace(/[^\d+ ]/g, "").trim(),
    );
    return { eligible: true as const };
  });

// ---------------------------------------------------------------------------
// Public submission
// ---------------------------------------------------------------------------

/**
 * Verifies and consumes a one-time code for `email`.
 *
 * Verification happens inside the submit handler rather than in a separate
 * round trip so that email ownership is proved on the server for the request
 * that is actually being stored — a client that skipped a "verify" step cannot
 * create a record. Mirrors the development bypass used by `verifyOtpServerFn`.
 */
async function consumeOtp(email: string, code: string): Promise<void> {
  if (!code) throw new Error("Enter the verification code sent to your email");

  if (code === "1234" && (email.endsWith("@example.com") || email.endsWith("@bookmytime.com"))) {
    return;
  }

  const validCode = await queryOne<{ id: string }>(
    "SELECT id FROM OtpCode WHERE email = ? AND code = ? AND expiresAt > ? ORDER BY createdAt DESC LIMIT 1",
    [email, code, new Date()],
  );
  if (!validCode) {
    throw new Error("Invalid or expired verification code");
  }

  await execute("DELETE FROM OtpCode WHERE email = ?", [email]);
}

export const createCustomPlanRequestServerFn = createServerFn({ method: "POST" })
  .validator((data: CustomPlanRequestInput & { otp: string }) => {
    const result = validateCustomPlanRequest(data);
    if (!result.ok) throw new Error(result.errors[0].message);
    return { ...result.value, otp: (data.otp || "").trim() };
  })
  .handler(async ({ data }) => {
    await consumeOtp(data.email, data.otp);
    await assertEligible(data.email, data.phone);

    const id = generateId();
    const referenceId = buildReferenceId(id);
    // Only the bcrypt hash is stored. It is copied verbatim into the User row on
    // activation, so the requester signs in with the password they chose here and
    // no plaintext credential is ever persisted or emailed.
    const passwordHash = await bcrypt.hash(data.password, 10);

    await execute(
      `INSERT INTO CustomPlanRequest (
         id, referenceId, name, email, phone, businessName, profession, practiceSize,
         passwordHash, requirements, status, billingInterval, source, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'monthly', 'pricing-page', NOW(), NOW())`,
      [
        id,
        referenceId,
        data.name,
        data.email,
        data.phone,
        data.businessName,
        data.profession,
        data.practiceSize,
        passwordHash,
        data.requirements,
      ],
    );

    // The record is already durable; a mail failure must not lose the lead, so
    // delivery is reported but never thrown.
    const mailData = {
      referenceId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      businessName: data.businessName,
      profession: data.profession,
      practiceSize: data.practiceSize,
      requirements: data.requirements,
    };
    const results = await Promise.allSettled([
      sendCustomPlanRequestConfirmationEmail(mailData),
      sendCustomPlanRequestAdminNotificationEmail(mailData),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[CustomPlan] Failed to send a request email:", result.reason?.message);
      }
    }

    return { success: true as const, id, referenceId };
  });

// ---------------------------------------------------------------------------
// Super admin — read
// ---------------------------------------------------------------------------

const LIST_COLUMNS = `
  cpr.id, cpr.referenceId, cpr.name, cpr.email, cpr.phone, cpr.businessName,
  cpr.profession, cpr.practiceSize, cpr.requirements, cpr.status,
  cpr.grantedPlan, cpr.grantedAmount, cpr.billingInterval, cpr.termMonths,
  cpr.adminNotes, cpr.collectionMode, cpr.paymentToken, cpr.paymentOrderId, cpr.paidAt,
  cpr.tenantId, cpr.userId, cpr.reviewedBy, cpr.reviewedAt,
  cpr.activatedAt, cpr.source, cpr.createdAt, cpr.updatedAt`;

export const getCustomPlanRequestsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const admin = await verifyAdminSession();
  if (!admin) throw new Error("Unauthorized");

  // The tenant columns are joined in so the console can show live subscription
  // state next to the agreed terms — that is how a super admin spots a plan that
  // was changed from the Tenants tab and has drifted from the deal.
  const rows = await query<CustomPlanRequestListRow>(
    `SELECT ${LIST_COLUMNS},
            u.subscriptionStatus AS tenantSubscriptionStatus,
            u.subscriptionPlan   AS tenantSubscriptionPlan,
            u.subscriptionExpiresAt AS tenantSubscriptionExpiresAt,
            u.paymentAmount      AS tenantPaymentAmount
       FROM CustomPlanRequest cpr
       LEFT JOIN User u ON u.id = cpr.userId
      ORDER BY cpr.createdAt DESC`,
  );

  return rows.map((row) => ({
    ...row,
    grantedAmount: row.grantedAmount === null ? null : Number(row.grantedAmount),
    tenantPaymentAmount:
      row.tenantPaymentAmount === null || row.tenantPaymentAmount === undefined
        ? null
        : Number(row.tenantPaymentAmount),
    termMonths: row.termMonths === null ? null : Number(row.termMonths),
  }));
});

// ---------------------------------------------------------------------------
// Super admin — lifecycle
// ---------------------------------------------------------------------------

type ReviewPayload = {
  id: string;
  action: CustomPlanAction;
  grantedPlan?: string | null;
  grantedAmount?: number | string | null;
  billingInterval?: string | null;
  termMonths?: number | string | null;
  adminNotes?: string | null;
  /** For `approve`: who collects the first payment (online tenant vs offline admin). */
  collectionMode?: string | null;
};

const SUPPORT_FOOTER = "Reach us at bookmytime1355@gmail.com or +91 9168 08 1355.";

/** Emails the tenant the pay-to-unlock link for an awaiting-payment workspace. */
async function sendPaymentLinkEmail(
  row: CustomPlanRequestRecord,
  terms: CustomPlanTerms,
  token: string,
): Promise<void> {
  await sendCustomPlanStatusEmail({
    email: row.email,
    subject: `Complete payment to activate your workspace • ${row.referenceId}`,
    title: "Your custom plan is approved — one step left",
    message: `Hi ${row.name}, your tailored plan for ${row.businessName} is ready. Your workspace has been created but access opens only once payment is complete. Use the secure link below to pay the agreed amount.`,
    tone: "info",
    details: [
      { label: "Reference", value: row.referenceId },
      { label: "Plan", value: `${terms.grantedPlan} (custom · unlimited)` },
      { label: "Amount due", value: formatTermsLabel(terms.grantedAmount, terms.billingInterval) },
      { label: "Term", value: formatTermLabel(terms.termMonths) },
    ],
    cta: {
      label: `Pay ${formatTermsLabel(terms.grantedAmount, terms.billingInterval)} now`,
      url: buildPaymentLink(token),
    },
    footnote: `You can also sign in and complete payment from your dashboard. ${SUPPORT_FOOTER}`,
  });
}

/**
 * Applies a revision / suspension / resumption to an already-provisioned tenant.
 * Never records a payment (that only happens on genuine activation) and, for a
 * still-locked workspace, keeps it locked while updating the priced terms.
 */
async function updateTenantForAction(
  userId: string,
  action: Extract<CustomPlanAction, "revise" | "suspend" | "resume">,
  terms: CustomPlanTerms | null,
  keepLocked: boolean,
): Promise<void> {
  const previous = await queryOne<{
    subscriptionStatus: string | null;
    subscriptionPlan: string | null;
    paymentAmount: number | string | null;
    billingInterval: string | null;
  }>(
    "SELECT subscriptionStatus, subscriptionPlan, paymentAmount, billingInterval FROM User WHERE id = ? LIMIT 1",
    [userId],
  );
  if (!previous) throw new Error("The workspace linked to this request no longer exists.");

  if (action === "suspend") {
    // 'Cancelled' is the status loginServerFn refuses, so suspension actually
    // locks the workspace out rather than only relabelling it.
    await execute(
      "UPDATE User SET subscriptionStatus = 'Cancelled', updatedAt = NOW() WHERE id = ?",
      [userId],
    );
    await execute(
      `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
       VALUES (?, ?, ?, 'Cancelled', ?, ?, ?, ?, NOW(), 'SuperAdmin')`,
      [
        generateId(),
        userId,
        previous.subscriptionStatus || "Active",
        previous.subscriptionPlan || "None",
        previous.subscriptionPlan || "None",
        Number(previous.paymentAmount ?? 0),
        previous.billingInterval || "monthly",
      ],
    );
    return;
  }

  if (!terms) throw new Error("Plan terms are required for this action.");

  // A revision of a still-unpaid workspace re-prices it but must NOT grant
  // access — it stays PaymentPending with no expiry. Every other case (resume,
  // or revising a live tenant) drives an active window from today.
  const targetStatus = keepLocked ? "PaymentPending" : "Active";
  const expiresAt = keepLocked ? null : computeExpiry(new Date(), terms.termMonths);
  const method = keepLocked ? CUSTOM_PLAN_PENDING_METHOD : CUSTOM_PLAN_PAID_METHOD;

  await execute(
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
      targetStatus,
      terms.grantedPlan,
      expiresAt,
      method,
      terms.grantedAmount,
      terms.billingInterval,
      userId,
    ],
  );
  await execute(
    `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'SuperAdmin')`,
    [
      generateId(),
      userId,
      previous.subscriptionStatus || "None",
      targetStatus,
      previous.subscriptionPlan || "None",
      terms.grantedPlan,
      terms.grantedAmount,
      terms.billingInterval,
    ],
  );
}

/**
 * The single super-admin entry point for every custom plan decision.
 *
 * Approval PROVISIONS the workspace immediately (locked when payment is to be
 * collected online) so there is never a separate "activate" step to forget.
 * Every path routes through the shared state machine + payment engine, so a
 * stale console (two admins on the same row) fails cleanly rather than
 * corrupting the record, and "mark paid" cannot diverge from "gateway paid".
 */
export const reviewCustomPlanRequestServerFn = createServerFn({ method: "POST" })
  .validator((data: ReviewPayload) => {
    if (!data?.id) throw new Error("Custom plan request id is required");
    if (!data?.action) throw new Error("An action is required");
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");
    const reviewer = admin.email || admin.name || "SuperAdmin";

    const row = await queryOne<CustomPlanRequestRecord>(
      "SELECT * FROM CustomPlanRequest WHERE id = ? LIMIT 1",
      [data.id],
    );
    if (!row) throw new Error("Custom plan request not found");

    const currentStatus = normalizeStatus(row.status);
    if (!canPerform(data.action, currentStatus)) {
      throw new Error(
        `"${ACTION_LABEL[data.action]}" is not available for a request that is ${currentStatus}. Refresh and try again.`,
      );
    }

    // Resolve terms (falling back to stored values) for actions that carry them,
    // and persist them onto the row up front so provisioning / activation — which
    // read the row — always see the agreed figures.
    let terms: CustomPlanTerms | null = null;
    if (actionRequiresTerms(data.action)) {
      const result = validateCustomPlanTerms({
        grantedPlan: data.grantedPlan ?? row.grantedPlan,
        grantedAmount: data.grantedAmount ?? row.grantedAmount,
        billingInterval: data.billingInterval ?? row.billingInterval,
        termMonths: data.termMonths ?? row.termMonths,
      });
      if (!result.ok) throw new Error(result.errors[0].message);
      terms = result.value;
      row.grantedPlan = terms.grantedPlan;
      row.grantedAmount = terms.grantedAmount;
      row.billingInterval = terms.billingInterval;
      row.termMonths = terms.termMonths;
      await execute(
        `UPDATE CustomPlanRequest SET grantedPlan = ?, grantedAmount = ?, billingInterval = ?, termMonths = ?, updatedAt = NOW() WHERE id = ?`,
        [terms.grantedPlan, terms.grantedAmount, terms.billingInterval, terms.termMonths, row.id],
      );
    }
    if (data.adminNotes !== undefined) {
      const notes = data.adminNotes?.trim() || null;
      row.adminNotes = notes;
      await execute("UPDATE CustomPlanRequest SET adminNotes = ?, updatedAt = NOW() WHERE id = ?", [
        notes,
        row.id,
      ]);
    }

    let finalStatus: CustomPlanStatus = statusAfter(data.action, currentStatus);
    let paymentLink: string | null = row.paymentToken ? buildPaymentLink(row.paymentToken) : null;

    switch (data.action) {
      case "approve": {
        const collectionMode = normalizeCollectionMode(data.collectionMode);
        const provisioned = await provisionCustomPlanWorkspace(row, terms!, {
          locked: collectionMode === "online",
        });
        row.tenantId = provisioned.tenantId;
        row.userId = provisioned.userId;

        await execute(
          `UPDATE CustomPlanRequest SET tenantId = ?, userId = ?, collectionMode = ?, reviewedBy = ?, reviewedAt = NOW(), updatedAt = NOW() WHERE id = ?`,
          [provisioned.tenantId || null, provisioned.userId, collectionMode, reviewer, row.id],
        );

        if (collectionMode === "manual" || !provisioned.locked) {
          // Offline collection (or an already-active existing account): unlock now.
          await activateCustomPlanTenant(row, { via: "manual" });
          finalStatus = "Active";
        } else {
          // Online collection: keep locked, mint a pay-link token, email it.
          const token = row.paymentToken || generatePaymentToken();
          await execute(
            `UPDATE CustomPlanRequest SET status = 'PaymentPending', paymentToken = ?, paidAt = NULL, updatedAt = NOW() WHERE id = ?`,
            [token, row.id],
          );
          row.paymentToken = token;
          paymentLink = buildPaymentLink(token);
          finalStatus = "PaymentPending";
          try {
            await sendPaymentLinkEmail(row, terms!, token);
          } catch (error) {
            console.error(
              `[CustomPlan] Failed to email payment link for ${row.referenceId}:`,
              error instanceof Error ? error.message : error,
            );
          }
        }
        break;
      }

      case "recordPayment": {
        // Super admin confirms an offline payment for a workspace awaiting the
        // gateway — unlock through the same activation path a real payment takes.
        await activateCustomPlanTenant(row, { via: "manual" });
        finalStatus = "Active";
        break;
      }

      case "resendLink": {
        const token = row.paymentToken || generatePaymentToken();
        if (token !== row.paymentToken) {
          await execute("UPDATE CustomPlanRequest SET paymentToken = ? WHERE id = ?", [
            token,
            row.id,
          ]);
          row.paymentToken = token;
        }
        paymentLink = buildPaymentLink(token);
        await sendPaymentLinkEmail(row, termsFromRow(row), token);
        finalStatus = currentStatus;
        break;
      }

      case "revise": {
        if (row.userId) {
          await updateTenantForAction(
            row.userId,
            "revise",
            terms,
            currentStatus === "PaymentPending",
          );
        }
        await execute("UPDATE CustomPlanRequest SET updatedAt = NOW() WHERE id = ?", [row.id]);
        finalStatus = currentStatus;
        if (currentStatus === "Active") {
          try {
            await sendCustomPlanStatusEmail({
              email: row.email,
              subject: `Your custom plan has been updated • ${row.referenceId}`,
              title: "Your custom plan has been updated",
              message: `Hi ${row.name}, the plan for ${row.businessName} has been updated. The new terms apply from today.`,
              tone: "info",
              details: [
                { label: "Reference", value: row.referenceId },
                { label: "Plan", value: `${terms!.grantedPlan} (custom)` },
                {
                  label: "Price",
                  value: formatTermsLabel(terms!.grantedAmount, terms!.billingInterval),
                },
                { label: "Term", value: formatTermLabel(terms!.termMonths) },
              ],
              cta: { label: "Sign in to your workspace", url: `${appOrigin()}/login` },
            });
          } catch {
            /* best-effort */
          }
        }
        break;
      }

      case "suspend": {
        if (row.userId) await updateTenantForAction(row.userId, "suspend", null, false);
        await execute(
          `UPDATE CustomPlanRequest SET status = 'Suspended', reviewedBy = ?, reviewedAt = NOW(), updatedAt = NOW() WHERE id = ?`,
          [reviewer, row.id],
        );
        finalStatus = "Suspended";
        try {
          await sendCustomPlanStatusEmail({
            email: row.email,
            subject: `Your workspace access is paused • ${row.referenceId}`,
            title: "Your workspace access is paused",
            message: `Hi ${row.name}, access to ${row.businessName} has been paused. Your data is safe — get in touch and we'll restore access.`,
            tone: "warning",
            details: [{ label: "Reference", value: row.referenceId }],
            footnote: SUPPORT_FOOTER,
          });
        } catch {
          /* best-effort */
        }
        break;
      }

      case "resume": {
        if (row.userId) await updateTenantForAction(row.userId, "resume", terms, false);
        await execute(
          `UPDATE CustomPlanRequest SET status = 'Active', reviewedBy = ?, reviewedAt = NOW(), updatedAt = NOW() WHERE id = ?`,
          [reviewer, row.id],
        );
        finalStatus = "Active";
        try {
          await sendCustomPlanStatusEmail({
            email: row.email,
            subject: `Your workspace access is restored • ${row.referenceId}`,
            title: "Your workspace access is restored",
            message: `Hi ${row.name}, ${row.businessName} is active again. You can sign in right away.`,
            tone: "success",
            details: [
              { label: "Reference", value: row.referenceId },
              {
                label: "Renews on",
                value: computeExpiry(new Date(), terms!.termMonths).toISOString().slice(0, 10),
              },
            ],
            cta: { label: "Sign in to your workspace", url: `${appOrigin()}/login` },
          });
        } catch {
          /* best-effort */
        }
        break;
      }

      case "reject": {
        // Rejecting a provisioned (payment-pending) workspace locks it out too.
        if (row.userId) {
          await execute(
            "UPDATE User SET subscriptionStatus = 'Cancelled', updatedAt = NOW() WHERE id = ?",
            [row.userId],
          );
        }
        await execute(
          `UPDATE CustomPlanRequest SET status = 'Rejected', reviewedBy = ?, reviewedAt = NOW(), updatedAt = NOW() WHERE id = ?`,
          [reviewer, row.id],
        );
        finalStatus = "Rejected";
        try {
          await sendCustomPlanStatusEmail({
            email: row.email,
            subject: `Update on your custom plan request • ${row.referenceId}`,
            title: "About your custom plan request",
            message: `Hi ${row.name}, thanks for your interest in BookMyTime. We're not able to take your custom plan request forward at this time. Our standard plans remain available and our team is happy to talk through what would work for ${row.businessName}.`,
            tone: "danger",
            details: [{ label: "Reference", value: row.referenceId }],
            footnote: SUPPORT_FOOTER,
          });
        } catch {
          /* best-effort */
        }
        break;
      }
    }

    return {
      success: true as const,
      status: finalStatus,
      tenantId: row.tenantId || null,
      userId: row.userId || null,
      grantedPlan: normalizeGrantedPlan(row.grantedPlan),
      paymentLink,
    };
  });

/**
 * Removes a request record.
 *
 * Deliberately does NOT touch the tenant: once a workspace exists it is owned by
 * the Tenants tab, and deleting a deal record must never silently delete a live
 * customer. Requests that provisioned a workspace can only be deleted after the
 * link is broken by deleting that tenant first.
 */
export const deleteCustomPlanRequestServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data?.id) throw new Error("Custom plan request id is required");
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const row = await queryOne<{ userId: string | null; status: string }>(
      "SELECT userId, status FROM CustomPlanRequest WHERE id = ? LIMIT 1",
      [data.id],
    );
    if (!row) throw new Error("Custom plan request not found");

    if (row.userId) {
      const tenant = await queryOne<{ id: string }>("SELECT id FROM User WHERE id = ? LIMIT 1", [
        row.userId,
      ]);
      if (tenant) {
        throw new Error(
          "This request has an active workspace. Manage or delete the tenant from the Tenants tab first.",
        );
      }
    }

    await execute("DELETE FROM CustomPlanRequest WHERE id = ?", [data.id]);
    return { success: true as const };
  });

// ---------------------------------------------------------------------------
// Payment (tenant-facing) — unlock context, checkout, verify
// ---------------------------------------------------------------------------

/**
 * Resolves the custom plan request behind an unlock attempt.
 *
 * A `token` (from the emailed pay link) resolves the request directly and works
 * without a session. Otherwise the current session's tenant is used, so a
 * signed-in owner who lands on the paywall is matched to their own request. The
 * password hash is never selected here.
 */
async function resolveUnlockRequest(
  token?: string | null,
): Promise<{ row: CustomPlanRequestRecord | null; role: string | null }> {
  const cleanToken = (token || "").trim();
  if (cleanToken) {
    const row = await queryOne<CustomPlanRequestRecord>(
      "SELECT * FROM CustomPlanRequest WHERE paymentToken = ? LIMIT 1",
      [cleanToken],
    );
    return { row, role: null };
  }

  const session = await verifySession();
  if (!session || !session.tenantId) return { row: null, role: null };
  const row = await queryOne<CustomPlanRequestRecord>(
    `SELECT * FROM CustomPlanRequest
     WHERE tenantId = ? OR userId = ?
     ORDER BY (status = 'PaymentPending') DESC, createdAt DESC LIMIT 1`,
    [session.tenantId, session.id],
  );
  return { row, role: session.role || null };
}

/**
 * Read model for the /unlock paywall. Safe to call unauthenticated with a token.
 * Reveals only what the pay screen needs — never the password hash or notes.
 */
export const getWorkspaceUnlockContextServerFn = createServerFn({ method: "POST" })
  .validator((data: { token?: string }) => data || {})
  .handler(async ({ data }) => {
    const { row, role } = await resolveUnlockRequest(data.token);
    if (!row) {
      return { found: false as const, locked: false as const };
    }

    const status = normalizeStatus(row.status);
    const terms = termsFromRow(row);
    return {
      found: true as const,
      locked: status === "PaymentPending",
      status,
      role,
      referenceId: row.referenceId,
      businessName: row.businessName,
      name: row.name,
      email: row.email,
      planLabel: `${terms.grantedPlan} (custom · unlimited)`,
      amount: terms.grantedAmount,
      billingInterval: terms.billingInterval,
      termMonths: terms.termMonths,
      amountLabel: formatTermsLabel(terms.grantedAmount, terms.billingInterval),
      // A token is only needed by the client to round-trip the return URL; the
      // session path resolves server-side, so it is echoed only for the token path.
      token: data.token ? row.paymentToken : null,
    };
  });

/**
 * Starts a Cashfree checkout for the negotiated amount and returns the
 * payment_session_id the client hands to the Cashfree SDK. Requires either a
 * valid pay-link token or a signed-in owner; sub-users/locations cannot pay.
 */
export const createCustomPlanCheckoutServerFn = createServerFn({ method: "POST" })
  .validator((data: { token?: string }) => data || {})
  .handler(async ({ data }) => {
    const { row, role } = await resolveUnlockRequest(data.token);
    if (!row) throw new Error("We couldn't find a pending payment for this workspace.");

    // Only the workspace owner may pay from a session; the token path is owner-
    // authenticated by possession of the emailed link.
    if (!data.token && role && role !== "admin") {
      throw new Error(
        "Only the workspace owner can complete this payment. Please ask them to sign in and pay.",
      );
    }

    if (normalizeStatus(row.status) !== "PaymentPending") {
      throw new Error("This workspace is not awaiting payment.");
    }

    const returnRef = data.token || row.paymentToken || "";
    const returnPath = returnRef ? `/unlock?ref=${encodeURIComponent(returnRef)}` : "/unlock";
    const order = await createCustomPlanOrder(row, returnPath);

    return {
      success: true as const,
      payment_session_id: order.paymentSessionId,
      order_id: order.orderId,
      amount: order.amount,
      environment: order.environment,
    };
  });

/**
 * Confirms an order's status with Cashfree and unlocks the workspace when PAID.
 * Called on return from checkout; the webhook is the redundant backstop. Safe to
 * call unauthenticated — it only reveals paid/not-paid for an opaque order id.
 */
export const verifyCustomPlanCheckoutServerFn = createServerFn({ method: "POST" })
  .validator((data: { orderId: string }) => {
    if (!data?.orderId) throw new Error("Order id is required");
    return data;
  })
  .handler(async ({ data }) => {
    const result = await reconcileCustomPlanOrder(data.orderId);
    return {
      paid: result.status === "PAID",
      activated: result.activated || result.alreadyActive,
      status: result.status,
    };
  });
