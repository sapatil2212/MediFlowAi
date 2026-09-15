/**
 * Tenant provisioning primitives — pure, isomorphic, no I/O.
 *
 * Every code path that creates a tenant (self-serve signup, super-admin
 * provisioning, custom-plan activation) must derive the tenantId prefix from
 * here. Before this module the mapping lived inline inside `signupServerFn`,
 * which meant a second provisioning path could silently give a gym tenant a
 * `clinic-` prefix. The prefix is load-bearing: dashboards and routing key off
 * it, so a drifted prefix is not cosmetic.
 */

import { PROFESSION_RESTAURANT, TENANT_PREFIX_RESTAURANT } from "./restaurant-availability";

/** The profession assumed when none is supplied (matches signup's default). */
export const DEFAULT_PROFESSION = "Healthcare and medical";

/** The tenantId prefix used for any profession without a specific mapping. */
export const DEFAULT_TENANT_PREFIX = "clinic-";

/** A selectable business profession plus the tenantId prefix it provisions. */
export interface ProfessionOption {
  /** The value stored in `User.profession` — do not reword, it is matched on. */
  readonly value: string;
  /** Short label for form controls. */
  readonly label: string;
  /** The tenantId prefix assigned to tenants of this profession. */
  readonly tenantPrefix: string;
}

/**
 * The professions offered at signup, in display order, each paired with the
 * tenantId prefix it provisions.
 */
export const PROFESSION_OPTIONS: readonly ProfessionOption[] = [
  { value: DEFAULT_PROFESSION, label: "Healthcare & Medical", tenantPrefix: "clinic-" },
  { value: "Beauty and wellness", label: "Beauty & Wellness", tenantPrefix: "beauty-" },
  { value: "Fitness Gym etc", label: "Fitness & Gym", tenantPrefix: "gym-" },
  {
    value: "Professional services like law, consultant, real estate, CA",
    label: "Professional Services (Law, Consultant, Real Estate, CA)",
    tenantPrefix: "advisory-",
  },
  { value: "Education institutions", label: "Education Institutions", tenantPrefix: "edu-" },
  {
    value: PROFESSION_RESTAURANT,
    label: "Restaurant & Dining",
    tenantPrefix: TENANT_PREFIX_RESTAURANT,
  },
] as const;

/**
 * Team / practice size buckets. Free-form varchar in the database, so these are
 * presentation labels — kept identical in wording to the values signup already
 * writes so a custom-plan tenant is indistinguishable from a self-serve one.
 */
export const PRACTICE_SIZE_OPTIONS: readonly string[] = [
  "Solo Practice (1 provider)",
  "Small Group (2-5 providers)",
  "Growing Team (6-15 providers)",
  "Large Clinic (16-50 providers)",
  "Enterprise (50+ providers)",
] as const;

/** True when the profession is one of the recognised options. */
export function isKnownProfession(profession?: string | null): boolean {
  const trimmed = (profession ?? "").trim();
  return PROFESSION_OPTIONS.some((option) => option.value === trimmed);
}

/**
 * The tenantId prefix for a profession. Unknown, empty, and null professions
 * fall back to the healthcare prefix, which is the behaviour signup has always
 * had — this function is a pure extraction of that logic, not a change to it.
 */
export function tenantPrefixForProfession(profession?: string | null): string {
  const trimmed = (profession ?? "").trim();
  const match = PROFESSION_OPTIONS.find((option) => option.value === trimmed);
  return match ? match.tenantPrefix : DEFAULT_TENANT_PREFIX;
}

/**
 * Builds a tenantId: the profession's prefix plus a 6-digit suffix.
 *
 * `randomFn` is injectable so callers can retry on collision with a fresh draw
 * and tests can pin the output. `User.tenantId` is UNIQUE, so the caller is
 * still responsible for retrying when the drawn id is already taken.
 */
export function generateTenantId(
  profession?: string | null,
  randomFn: () => number = Math.random,
): string {
  const suffix = Math.floor(100000 + randomFn() * 900000).toString();
  return tenantPrefixForProfession(profession) + suffix;
}
