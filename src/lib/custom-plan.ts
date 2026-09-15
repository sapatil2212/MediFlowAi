/**
 * Custom plan domain logic — pure, isomorphic, no I/O.
 *
 * A "custom plan" is a negotiated commercial arrangement for one tenant. It is
 * deliberately NOT a fourth entitlement tier: the features a custom-plan tenant
 * receives come from a granted `PlanTier` (so `feature-access.ts` stays the
 * single source of truth for entitlements), while the negotiated price, billing
 * interval, and term live on the request record. That split is what lets sales
 * agree any price without inventing an entitlement matrix per deal.
 *
 * Both the public request form and the super-admin console import this module,
 * so the state machine and validation rules cannot diverge between them.
 */

import { PLAN_BILLING, PLAN_TIERS, type PlanTier } from "./feature-access";
import { isKnownProfession, PRACTICE_SIZE_OPTIONS } from "./tenant-provisioning";
import { validateBusinessName, type FieldError } from "./restaurant-availability";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Where a request sits in the pipeline.
 *
 * - `Pending`        — submitted from the public pricing page, awaiting review.
 * - `PaymentPending` — approved AND the workspace is provisioned, but access is
 *                      locked until payment is confirmed. The tenant can sign in
 *                      but is redirected to the paywall.
 * - `Active`         — paid (online or recorded manually); full access.
 * - `Suspended`      — tenant's subscription switched off, record retained.
 * - `Rejected`       — declined; terminal.
 *
 * Approval provisions the workspace immediately (Req: "auto create respective
 * tenant's workspace"). What approval does NOT do is grant access — that is
 * gated on payment, which is the whole point of `PaymentPending` sitting
 * between approval and access.
 */
export type CustomPlanStatus = "Pending" | "PaymentPending" | "Active" | "Suspended" | "Rejected";

/** Every status, in pipeline order. */
export const CUSTOM_PLAN_STATUSES: readonly CustomPlanStatus[] = [
  "Pending",
  "PaymentPending",
  "Active",
  "Suspended",
  "Rejected",
] as const;

/** The operations a super admin can perform on a request. */
export type CustomPlanAction =
  | "approve"
  | "reject"
  | "recordPayment"
  | "resendLink"
  | "revise"
  | "suspend"
  | "resume";

/** Every action, in the order they appear in the console. */
export const CUSTOM_PLAN_ACTIONS: readonly CustomPlanAction[] = [
  "approve",
  "recordPayment",
  "resendLink",
  "revise",
  "suspend",
  "resume",
  "reject",
] as const;

/**
 * Who collects the first payment when a request is approved.
 *
 * - `online` — the tenant pays through the gateway. Approval provisions a
 *              LOCKED workspace, emails a payment link, and access opens only
 *              once the payment is confirmed.
 * - `manual` — the super admin has already collected payment offline (cash,
 *              bank transfer, existing invoice). Approval provisions and unlocks
 *              in one step and records a manual payment for the ledger.
 */
export type PaymentCollectionMode = "online" | "manual";

/** Both collection modes, in display order. */
export const PAYMENT_COLLECTION_MODES: readonly PaymentCollectionMode[] = [
  "online",
  "manual",
] as const;

/** Parses an arbitrary value into a collection mode, defaulting to online. */
export function normalizeCollectionMode(mode?: string | null): PaymentCollectionMode {
  return (mode ?? "").trim().toLowerCase() === "manual" ? "manual" : "online";
}

/**
 * The only permitted status transitions.
 *
 * Approval lands on `PaymentPending` in the machine even when the admin marks
 * payment as already collected — the server then immediately drives the
 * `PaymentPending -> Active` edge via the same code path a real payment takes,
 * so "mark as paid" and "gateway confirmed" can never activate through
 * different, divergent logic.
 */
const TRANSITIONS: Record<CustomPlanStatus, readonly CustomPlanStatus[]> = {
  Pending: ["PaymentPending", "Rejected"],
  PaymentPending: ["Active", "Rejected"],
  Active: ["Suspended"],
  Suspended: ["Active"],
  Rejected: [],
};

/** The status an action moves a request to, or null when it changes no status. */
const ACTION_TARGET: Record<CustomPlanAction, CustomPlanStatus | null> = {
  approve: "PaymentPending",
  reject: "Rejected",
  recordPayment: "Active",
  suspend: "Suspended",
  resume: "Active",
  // Revising terms and resending the payment link re-negotiate / re-notify in
  // place; neither changes the status.
  revise: null,
  resendLink: null,
};

/** The statuses from which each action is permitted. */
const ACTION_ALLOWED_FROM: Record<CustomPlanAction, readonly CustomPlanStatus[]> = {
  approve: ["Pending"],
  reject: ["Pending", "PaymentPending"],
  // Manually confirming payment unlocks a workspace awaiting the gateway.
  recordPayment: ["PaymentPending"],
  // The emailed payment link can be re-sent while payment is outstanding.
  resendLink: ["PaymentPending"],
  suspend: ["Active"],
  resume: ["Suspended"],
  // Terms can be re-negotiated any time before the deal is dead: while under
  // review, awaiting payment, and on a live or suspended tenant (the upgrade /
  // downgrade path).
  revise: ["Pending", "PaymentPending", "Active", "Suspended"],
};

/** True when `to` is a permitted next status for `from`. */
export function canTransition(from: CustomPlanStatus, to: CustomPlanStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The statuses reachable from `from`. */
export function nextStatuses(from: CustomPlanStatus): readonly CustomPlanStatus[] {
  return TRANSITIONS[from];
}

/** True when an action is permitted on a request in the given status. */
export function canPerform(action: CustomPlanAction, from: CustomPlanStatus): boolean {
  if (!ACTION_ALLOWED_FROM[action].includes(from)) return false;
  const target = ACTION_TARGET[action];
  return target === null ? true : canTransition(from, target);
}

/** The actions permitted on a request in the given status, in console order. */
export function availableActions(from: CustomPlanStatus): CustomPlanAction[] {
  return CUSTOM_PLAN_ACTIONS.filter((action) => canPerform(action, from));
}

/**
 * The status an action produces, or the unchanged status for `revise` /
 * `resendLink`. Throws when the action is not permitted, so an illegal
 * transition can never be written to the database by accident.
 */
export function statusAfter(action: CustomPlanAction, from: CustomPlanStatus): CustomPlanStatus {
  if (!canPerform(action, from)) {
    throw new Error(`Cannot ${action} a request that is ${from}.`);
  }
  return ACTION_TARGET[action] ?? from;
}

/** True when the action needs agreed terms (plan, amount, interval, term). */
export function actionRequiresTerms(action: CustomPlanAction): boolean {
  return (
    action === "approve" || action === "recordPayment" || action === "revise" || action === "resume"
  );
}

/**
 * True when the action must be reflected onto the tenant's `User` row.
 * `approve` is included because approval now provisions the workspace; only
 * `resendLink` and a pure `revise` of a not-yet-provisioned request leave the
 * tenant untouched.
 */
export function actionTouchesTenant(action: CustomPlanAction): boolean {
  return (
    action === "approve" ||
    action === "recordPayment" ||
    action === "revise" ||
    action === "suspend" ||
    action === "resume"
  );
}

/** Parses an arbitrary value into a known status, defaulting to `Pending`. */
export function normalizeStatus(status?: string | null): CustomPlanStatus {
  const raw = (status ?? "").trim().toLowerCase();
  return CUSTOM_PLAN_STATUSES.find((candidate) => candidate.toLowerCase() === raw) ?? "Pending";
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/** Billing cadence, matching the values `User.billingInterval` already holds. */
export type BillingInterval = "monthly" | "yearly";

/** Both cadences, in display order. */
export const BILLING_INTERVALS: readonly BillingInterval[] = ["monthly", "yearly"] as const;

/** The number of months one billing cycle covers. */
export const INTERVAL_MONTHS: Record<BillingInterval, number> = { monthly: 1, yearly: 12 };

/** Inclusive bounds for a committed term, in months. */
export const TERM_MONTHS_LIMITS = { min: 1, max: 60 } as const;

/** Inclusive bounds for a negotiated amount, in INR. Zero allows free pilots. */
export const AMOUNT_LIMITS = { min: 0, max: 10_000_000 } as const;

/** The tier a custom plan is granted unless the super admin picks another. */
export const DEFAULT_GRANTED_PLAN: PlanTier = "Enterprise";

/** Parses an arbitrary value into a billing interval, defaulting to monthly. */
export function normalizeBillingInterval(interval?: string | null): BillingInterval {
  return (interval ?? "").trim().toLowerCase() === "yearly" ? "yearly" : "monthly";
}

/** Parses an arbitrary value into a granted tier, defaulting to Enterprise. */
export function normalizeGrantedPlan(plan?: string | null): PlanTier {
  const raw = (plan ?? "").trim().toLowerCase();
  return PLAN_TIERS.find((tier) => tier.toLowerCase() === raw) ?? DEFAULT_GRANTED_PLAN;
}

/** The default committed term for a cadence: one full billing cycle. */
export function defaultTermMonths(interval: BillingInterval): number {
  return INTERVAL_MONTHS[interval];
}

/**
 * The list price of a tier, used to prefill the amount field. Tiers that are not
 * self-serve have no list price, so they prefill as 0 and must be priced by hand
 * — which is the whole point of a custom plan.
 */
export function listPriceFor(plan: PlanTier): number {
  const billing = PLAN_BILLING[plan];
  return billing.selfServe ? billing.monthly : 0;
}

/**
 * Adds whole months to a date, clamping the day of month so month-end dates
 * stay inside the target month (31 Jan + 1 month => 28/29 Feb rather than
 * rolling into March, which is what naive `setMonth` arithmetic does).
 */
export function addMonths(start: Date, months: number): Date {
  const result = new Date(start.getTime());
  const targetDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(targetDay, daysInTargetMonth));
  return result;
}

/** The subscription expiry for a term starting at `start`. */
export function computeExpiry(start: Date, termMonths: number): Date {
  const months = Number.isFinite(termMonths) ? Math.trunc(termMonths) : 0;
  return addMonths(start, Math.max(TERM_MONTHS_LIMITS.min, months));
}

/**
 * The monthly-equivalent of a negotiated amount, matching how the super-admin
 * MRR query normalises yearly billing. Kept here so the figure the console
 * previews and the figure the dashboard reports are computed the same way.
 */
export function monthlyEquivalent(amount: number, interval: BillingInterval): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return interval === "yearly" ? amount / 12 : amount;
}

// ---------------------------------------------------------------------------
// Validation — request submission
// ---------------------------------------------------------------------------

/** Minimum password length, matching the signup form's `minLength`. */
export const PASSWORD_MIN_LENGTH = 6;

/** Inclusive bounds for the optional free-text requirement notes. */
export const REQUIREMENTS_MAX_LENGTH = 2000;

/** What the public request form submits. */
export interface CustomPlanRequestInput {
  name: string;
  phone: string;
  email: string;
  password: string;
  profession: string;
  businessName: string;
  practiceSize: string;
  requirements?: string;
}

/** The normalised, storage-ready form of a valid submission. */
export interface NormalisedCustomPlanRequest {
  name: string;
  phone: string;
  email: string;
  password: string;
  profession: string;
  businessName: string;
  practiceSize: string;
  requirements: string | null;
}

export const MSG_NAME_REQUIRED = "Please enter your full name";
export const MSG_PHONE_INVALID = "Please enter a valid mobile number";
export const MSG_EMAIL_INVALID = "Please enter a valid email address";
export const MSG_PASSWORD_SHORT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
export const MSG_PROFESSION_INVALID = "Please select your business type";
export const MSG_PRACTICE_SIZE_INVALID = "Please select your team size";
export const MSG_REQUIREMENTS_LONG = `Requirements must be at most ${REQUIREMENTS_MAX_LENGTH} characters`;

/**
 * Validates a public submission and returns the normalised record.
 *
 * Collects one error per offending field rather than stopping at the first, so
 * the form can mark everything that needs fixing in a single round trip. The
 * business-name rule is delegated to the shared validator so the custom-plan
 * form and the signup form enforce identical limits and wording.
 */
export function validateCustomPlanRequest(
  input: CustomPlanRequestInput,
): { ok: true; value: NormalisedCustomPlanRequest } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];

  const name = (input?.name ?? "").trim();
  if (name.length < 2 || name.length > 255) {
    errors.push({ field: "name", message: MSG_NAME_REQUIRED });
  }

  const phone = normalizePhone(input?.phone ?? "");
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 8 || phoneDigits.length > 15) {
    errors.push({ field: "phone", message: MSG_PHONE_INVALID });
  }

  const email = (input?.email ?? "").trim().toLowerCase();
  if (!isValidEmailShape(email)) {
    errors.push({ field: "email", message: MSG_EMAIL_INVALID });
  }

  const password = input?.password ?? "";
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push({ field: "password", message: MSG_PASSWORD_SHORT });
  }

  const profession = (input?.profession ?? "").trim();
  if (!isKnownProfession(profession)) {
    errors.push({ field: "profession", message: MSG_PROFESSION_INVALID });
  }

  const businessNameResult = validateBusinessName(input?.businessName, profession);
  if (!businessNameResult.ok) {
    errors.push(...businessNameResult.errors);
  }

  const practiceSize = (input?.practiceSize ?? "").trim();
  if (!PRACTICE_SIZE_OPTIONS.includes(practiceSize)) {
    errors.push({ field: "practiceSize", message: MSG_PRACTICE_SIZE_INVALID });
  }

  const requirements = (input?.requirements ?? "").trim();
  if (requirements.length > REQUIREMENTS_MAX_LENGTH) {
    errors.push({ field: "requirements", message: MSG_REQUIREMENTS_LONG });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      phone,
      email,
      password,
      profession,
      businessName: businessNameResult.ok ? businessNameResult.value : "",
      practiceSize,
      requirements: requirements || null,
    },
  };
}

/** Strips formatting noise from a phone number while keeping + and digits. */
export function normalizePhone(phone: string): string {
  const cleaned = (phone ?? "").replace(/[^\d+ ]/g, "").trim();
  return cleaned || (phone ?? "").trim();
}

/**
 * Shape check for an email address. Intentionally permissive — the address is
 * additionally proved to be reachable by the one-time code the requester has to
 * enter, so this only has to reject obvious typos.
 */
export function isValidEmailShape(email: string): boolean {
  const trimmed = (email ?? "").trim();
  return trimmed.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

// ---------------------------------------------------------------------------
// Validation — granted terms
// ---------------------------------------------------------------------------

/** The terms a super admin sets when approving, activating, or revising. */
export interface CustomPlanTermsInput {
  grantedPlan?: string | null;
  grantedAmount?: number | string | null;
  billingInterval?: string | null;
  termMonths?: number | string | null;
}

/** Normalised terms, ready to write to both the request and the tenant. */
export interface CustomPlanTerms {
  grantedPlan: PlanTier;
  grantedAmount: number;
  billingInterval: BillingInterval;
  termMonths: number;
}

export const MSG_AMOUNT_INVALID = `Amount must be a number between ${AMOUNT_LIMITS.min} and ${AMOUNT_LIMITS.max}`;
export const MSG_TERM_INVALID = `Term must be a whole number of months between ${TERM_MONTHS_LIMITS.min} and ${TERM_MONTHS_LIMITS.max}`;

/**
 * Validates negotiated terms. An amount of 0 is accepted on purpose: free
 * pilots and internal accounts are real deals, and the dashboard already treats
 * a zero amount as non-paying rather than as an error.
 */
export function validateCustomPlanTerms(
  input: CustomPlanTermsInput,
): { ok: true; value: CustomPlanTerms } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];

  const grantedPlan = normalizeGrantedPlan(input?.grantedPlan);
  const billingInterval = normalizeBillingInterval(input?.billingInterval);

  const rawAmount =
    typeof input?.grantedAmount === "string" ? Number(input.grantedAmount) : input?.grantedAmount;
  const grantedAmount =
    typeof rawAmount === "number" && Number.isFinite(rawAmount) ? rawAmount : NaN;
  if (
    !Number.isFinite(grantedAmount) ||
    grantedAmount < AMOUNT_LIMITS.min ||
    grantedAmount > AMOUNT_LIMITS.max
  ) {
    errors.push({ field: "grantedAmount", message: MSG_AMOUNT_INVALID });
  }

  const rawTerm =
    input?.termMonths === null || input?.termMonths === undefined || input?.termMonths === ""
      ? defaultTermMonths(billingInterval)
      : Number(input.termMonths);
  const termMonths = Number.isFinite(rawTerm) ? Math.trunc(rawTerm) : NaN;
  if (
    !Number.isFinite(termMonths) ||
    termMonths < TERM_MONTHS_LIMITS.min ||
    termMonths > TERM_MONTHS_LIMITS.max
  ) {
    errors.push({ field: "termMonths", message: MSG_TERM_INVALID });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      grantedPlan,
      grantedAmount: Math.round(grantedAmount * 100) / 100,
      billingInterval,
      termMonths,
    },
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** Builds the human-quotable reference for a request, e.g. `CUST-9F2A1C4B`. */
export function buildReferenceId(seed: string): string {
  const cleaned = (seed ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `CUST-${(cleaned || "00000000").slice(0, 8)}`;
}

/** `₹1,499 / mo` style label for a negotiated amount. */
export function formatTermsLabel(amount: number, interval: BillingInterval): string {
  if (!Number.isFinite(amount) || amount <= 0) return "Custom / no charge";
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
  return `${formatted} / ${interval === "yearly" ? "yr" : "mo"}`;
}

/** Sentence describing a term length. */
export function formatTermLabel(termMonths: number): string {
  if (termMonths === 12) return "12 months";
  if (termMonths === 1) return "1 month";
  return `${termMonths} months`;
}

/** Status label shown in the console (splits the camelCase status). */
export const STATUS_LABEL: Record<CustomPlanStatus, string> = {
  Pending: "Pending review",
  PaymentPending: "Awaiting payment",
  Active: "Active",
  Suspended: "Suspended",
  Rejected: "Rejected",
};

/** Tailwind tone classes per status, shared by every status badge. */
export const STATUS_TONE: Record<CustomPlanStatus, string> = {
  Pending: "border-amber-200 bg-amber-50 text-amber-700",
  PaymentPending: "border-violet-200 bg-violet-50 text-violet-700",
  Active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Suspended: "border-orange-200 bg-orange-50 text-orange-700",
  Rejected: "border-red-200 bg-red-50 text-red-700",
};

/** Button label per action. */
export const ACTION_LABEL: Record<CustomPlanAction, string> = {
  approve: "Approve & provision",
  recordPayment: "Mark as paid",
  resendLink: "Resend payment link",
  revise: "Save revised terms",
  suspend: "Suspend access",
  resume: "Resume access",
  reject: "Reject request",
};

/** One-line explanation of what each action does, shown next to the button. */
export const ACTION_HINT: Record<CustomPlanAction, string> = {
  approve: "Creates the workspace now. Access unlocks once payment is confirmed.",
  recordPayment: "Records an offline payment and unlocks the workspace immediately.",
  resendLink: "Emails the tenant a fresh payment link for the pending amount.",
  revise: "Upgrades or downgrades the granted plan and price.",
  suspend: "Blocks sign-in without deleting the workspace.",
  resume: "Restores access and extends the term from today.",
  reject: "Declines the request and notifies the requester.",
};

// ---------------------------------------------------------------------------
// Unlimited entitlement
// ---------------------------------------------------------------------------

/**
 * The plan tier a custom plan grants to make "every feature unlimited" true.
 *
 * Enterprise is the tier the rest of the app already treats as unlimited:
 * `PLAN_FEATURES.Enterprise` has every boolean on, the multi-location limit for
 * Enterprise/Custom is `null` (no cap), and the sub-user maximums for Enterprise
 * are `null` for every role. Granting Enterprise is therefore how a custom-plan
 * workspace gets unlimited locations, sub-users, and features without inventing
 * a parallel entitlement system.
 */
export const UNLIMITED_PLAN: PlanTier = "Enterprise";
