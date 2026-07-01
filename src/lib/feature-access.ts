/**
 * feature-access.ts
 *
 * Single source of truth for plan-gated feature access.
 *
 * This module is intentionally PURE and ISOMORPHIC: it performs no I/O, has no
 * side effects, and imports nothing from the database or auth layers. It runs
 * identically on the client and the server, which makes it trivially unit- and
 * property-testable.
 *
 * It separates two distinct concepts:
 *   1. Feature availability — driven by the (inherited) subscription plan and
 *      subscription status. Independent of role.
 *   2. Action authorization — driven by the account role, layered on top of an
 *      available feature (operate | view_only | none).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canonical plan tiers. */
export type PlanTier = "Basic" | "Premium" | "Enterprise";

/** Roles as produced by verifySession. */
export type AccountRole = "admin" | "reception" | "doctor" | "location";

/** Plan-gated features (string ids match dashboard tab/sub-tab ids). */
export type FeatureId =
  | "whatsapp"
  | "analytics"
  | "scribe"
  | "users" // multi-user / sub-user management
  | "locations" // multi-location management
  | "plans"; // billing/plan management

/** Permission level for an available feature. */
export type Permission = "operate" | "view_only" | "none";

export interface AccountContext {
  role: AccountRole;
  subscriptionPlan?: string | null; // raw value, may be a legacy alias
  subscriptionStatus?: string | null; // e.g. "Active", "Cancelled", "expired"
  subscriptionExpiresAt?: string | null; // ISO string or null
  isActive?: boolean; // child-account active flag (default true)
  now?: Date; // injectable clock for tests; defaults to new Date()
}

export interface FeatureAccess {
  available: boolean; // plan + status say the feature exists for this tenant
  permission: Permission; // operate | view_only | none (role layered on top)
  visible: boolean; // dashboard should render the tab/sub-tab
}

export type ResolvedAccess = Record<FeatureId, FeatureAccess>;

// ---------------------------------------------------------------------------
// Constants for iteration
// ---------------------------------------------------------------------------

/** All plan-gated feature ids, in a stable order. */
export const FEATURE_IDS: FeatureId[] = [
  "whatsapp",
  "analytics",
  "scribe",
  "users",
  "locations",
  "plans",
];

/** All canonical plan tiers, ordered from least to most entitled. */
export const PLAN_TIERS: PlanTier[] = ["Basic", "Premium", "Enterprise"];

// ---------------------------------------------------------------------------
// Plan normalization
// ---------------------------------------------------------------------------

/**
 * Maps raw plan strings (case-insensitive) to canonical tiers, covering legacy
 * aliases and the free-form values found in the codebase. Matching is done by
 * substring so that values like "Clinic Plan", "₹1,499", or "Pro" resolve.
 *
 * Unknown/empty defaults to "Basic" (most restrictive), matching the existing
 * dashboard default behavior.
 *
 * Order matters: Enterprise and Premium aliases are checked before Basic so
 * that more entitled tiers win, and Basic is purely the fallback.
 */
export function normalizePlan(plan?: string | null): PlanTier {
  const raw = (plan ?? "").toLowerCase();

  // Enterprise aliases.
  if (raw.includes("enterprise") || raw.includes("hospital") || raw.includes("custom")) {
    return "Enterprise";
  }

  // Premium aliases.
  if (
    raw.includes("premium") ||
    raw.includes("clinic") ||
    raw.includes("pro") ||
    raw.includes("1499")
  ) {
    return "Premium";
  }

  // Basic aliases (and explicit basic markers). Everything else also falls
  // through to Basic as the safe default.
  return "Basic";
}

// ---------------------------------------------------------------------------
// Plan entitlement map
// ---------------------------------------------------------------------------

/**
 * The single source of truth for which plan tier includes which feature.
 * WhatsApp and multi-location management are the only features gated off for
 * Basic; everything else is available on all tiers.
 */
export const PLAN_FEATURES: Record<PlanTier, Record<FeatureId, boolean>> = {
  Basic: {
    whatsapp: false,
    analytics: true,
    scribe: true,
    users: true,
    locations: false,
    plans: true,
  },
  Premium: {
    whatsapp: true,
    analytics: true,
    scribe: true,
    users: true,
    locations: true,
    plans: true,
  },
  Enterprise: {
    whatsapp: true,
    analytics: true,
    scribe: true,
    users: true,
    locations: true,
    plans: true,
  },
};

/** Returns whether a plan tier's entitlement includes the given feature. */
export function planIncludesFeature(plan: PlanTier, feature: FeatureId): boolean {
  return PLAN_FEATURES[plan][feature];
}

// ---------------------------------------------------------------------------
// Role permission map
// ---------------------------------------------------------------------------

/**
 * Layers role authorization on top of availability. `admin` (parent) operates
 * everything. This map preserves existing behavior while removing role-based
 * suppression of available features.
 */
export const ROLE_PERMISSIONS: Record<FeatureId, Record<AccountRole, Permission>> = {
  whatsapp: {
    admin: "operate",
    doctor: "operate",
    reception: "view_only",
    location: "operate",
  },
  analytics: {
    admin: "operate",
    doctor: "operate",
    reception: "view_only",
    location: "operate",
  },
  scribe: {
    admin: "operate",
    doctor: "operate",
    reception: "none",
    location: "operate",
  },
  users: {
    admin: "operate",
    doctor: "none",
    reception: "none",
    location: "none",
  },
  locations: {
    admin: "operate",
    doctor: "none",
    reception: "none",
    location: "none",
  },
  plans: {
    admin: "operate",
    doctor: "none",
    reception: "none",
    location: "none",
  },
};

/** Returns the permission a role has for a given feature. */
export function rolePermission(role: AccountRole, feature: FeatureId): Permission {
  return ROLE_PERMISSIONS[feature][role];
}

// ---------------------------------------------------------------------------
// Subscription status
// ---------------------------------------------------------------------------

/**
 * True only when subscriptionStatus (case-insensitive) equals "active" AND
 * either there is no expiry date, or the expiry date is valid and not before
 * `ctx.now ?? new Date()`. Invalid/missing dates are treated as not-expired.
 */
export function isSubscriptionActive(ctx: AccountContext): boolean {
  const status = (ctx.subscriptionStatus ?? "").toLowerCase();
  if (status !== "active") {
    return false;
  }

  const expiresRaw = ctx.subscriptionExpiresAt;
  if (expiresRaw === null || expiresRaw === undefined || expiresRaw === "") {
    return true; // no expiry => not expired
  }

  const expiresAt = new Date(expiresRaw);
  if (Number.isNaN(expiresAt.getTime())) {
    return true; // invalid date => treat as not-expired
  }

  const now = ctx.now ?? new Date();
  // Expired only when expiry is strictly before now.
  return !(expiresAt.getTime() < now.getTime());
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves, for every plan-gated feature, its availability, the role's
 * permission, and whether the dashboard should render it.
 */
export function resolveFeatureAccess(ctx: AccountContext): ResolvedAccess {
  const plan = normalizePlan(ctx.subscriptionPlan);
  const active = isSubscriptionActive(ctx);
  const childOk = ctx.isActive !== false; // deactivated child => everything off

  const result = {} as ResolvedAccess;

  for (const feature of FEATURE_IDS) {
    const available = active && childOk && planIncludesFeature(plan, feature);
    const permission: Permission = available ? rolePermission(ctx.role, feature) : "none";
    const visible = available && permission !== "none";

    result[feature] = { available, permission, visible };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Convenience guards (used server-side)
// ---------------------------------------------------------------------------

/** True when the feature is available and the role may at least view it. */
export function canUseFeature(ctx: AccountContext, feature: FeatureId): boolean {
  const access = resolveFeatureAccess(ctx)[feature];
  return access.available && access.permission !== "none";
}

/** True when the feature is available and the role may operate (act on) it. */
export function canOperateFeature(ctx: AccountContext, feature: FeatureId): boolean {
  const access = resolveFeatureAccess(ctx)[feature];
  return access.available && access.permission === "operate";
}
