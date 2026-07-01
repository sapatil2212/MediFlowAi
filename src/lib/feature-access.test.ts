import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  normalizePlan,
  isSubscriptionActive,
  planIncludesFeature,
  resolveFeatureAccess,
  canUseFeature,
  canOperateFeature,
  FEATURE_IDS,
  PLAN_TIERS,
  type AccountRole,
  type AccountContext,
  type FeatureId,
  type PlanTier,
} from "./feature-access";

// ---------------------------------------------------------------------------
// Shared test fixtures / arbitraries
// ---------------------------------------------------------------------------

/** Deterministic clock so any expiry comparison is reproducible. */
const NOW = new Date("2025-06-15T00:00:00.000Z");

const ROLES: AccountRole[] = ["admin", "reception", "doctor", "location"];
const CHILD_ROLES: AccountRole[] = ["reception", "doctor", "location"];

const roleArb = fc.constantFrom<AccountRole>(...ROLES);
const featureArb = fc.constantFrom<FeatureId>(...FEATURE_IDS);

/**
 * Raw plan strings: canonical tiers, legacy aliases, free-form values found in
 * the codebase, plus arbitrary junk. normalizePlan must cope with all of them.
 */
const knownPlanArb = fc.constantFrom(
  "Basic",
  "Premium",
  "Enterprise",
  "Solo",
  "Clinic",
  "Hospital",
  "Custom",
  "Pro",
  "Trial",
  "₹1,499",
);
const planArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: knownPlanArb },
  { weight: 1, arbitrary: fc.string() },
);

/** Active status in assorted casings. */
const activeStatusArb = fc.constantFrom("active", "Active", "ACTIVE", "AcTiVe");

/** A future or absent expiry (i.e. "not expired"). */
const futureOrEmptyExpiryArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant<string | null>(null),
  fc.constant(""),
  fc
    .date({ min: new Date(NOW.getTime() + 1000), max: new Date("2100-01-01T00:00:00.000Z") })
    .map((d) => d.toISOString()),
);

/** An expiry strictly in the past. */
const pastExpiryArb: fc.Arbitrary<string> = fc
  .date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date(NOW.getTime() - 1000) })
  .map((d) => d.toISOString());

/** A context with an active subscription (status active, not expired). */
const activeContextArb: fc.Arbitrary<AccountContext> = fc.record({
  role: roleArb,
  subscriptionPlan: planArb,
  subscriptionStatus: activeStatusArb,
  subscriptionExpiresAt: futureOrEmptyExpiryArb,
  isActive: fc.constant<boolean>(true),
  now: fc.constant(NOW),
});

/** A status that is NOT active (case-insensitive). */
const nonActiveStatusArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constantFrom("Cancelled", "cancelled", "expired", "Expired", "Trialing", "past_due", "", "inactive"),
  fc.constant<string | null>(null),
  fc.string().filter((s) => s.toLowerCase() !== "active"),
);

/** Fully random context (any role/plan/status/expiry/isActive). */
const anyContextArb: fc.Arbitrary<AccountContext> = fc.record({
  role: roleArb,
  subscriptionPlan: fc.oneof(planArb, fc.constant<string | null>(null)),
  subscriptionStatus: fc.oneof(activeStatusArb, nonActiveStatusArb),
  subscriptionExpiresAt: fc.oneof(
    futureOrEmptyExpiryArb,
    pastExpiryArb,
    fc.string(),
    fc.constant<string | null>(null),
  ),
  isActive: fc.oneof(fc.boolean(), fc.constant<boolean | undefined>(undefined)),
  now: fc.constant(NOW),
});

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

describe("feature-access (property-based)", () => {
  // Property 1 — availability is role-independent.
  // Validates: Requirements 1.3, 3.1, 3.5
  it("Property 1: availability is identical across all roles for a fixed plan/status/expiry/isActive", () => {
    fc.assert(
      fc.property(
        planArb,
        fc.oneof(activeStatusArb, nonActiveStatusArb),
        fc.oneof(futureOrEmptyExpiryArb, pastExpiryArb),
        fc.boolean(),
        (plan, status, expiry, isActive) => {
          const base = {
            subscriptionPlan: plan,
            subscriptionStatus: status,
            subscriptionExpiresAt: expiry,
            isActive,
            now: NOW,
          };
          const resolved = ROLES.map((role) => resolveFeatureAccess({ ...base, role }));
          for (const f of FEATURE_IDS) {
            const first = resolved[0][f].available;
            for (const r of resolved) {
              expect(r[f].available).toBe(first);
            }
          }
        },
      ),
    );
  });

  // Property 2 — child accounts inherit the parent (admin) entitlement.
  // Validates: Requirements 1.1, 1.2
  it("Property 2: child role availability equals admin availability for an active subscription", () => {
    fc.assert(
      fc.property(activeContextArb, (ctx) => {
        const adminAccess = resolveFeatureAccess({ ...ctx, role: "admin" });
        for (const role of CHILD_ROLES) {
          const childAccess = resolveFeatureAccess({ ...ctx, role });
          for (const f of FEATURE_IDS) {
            expect(childAccess[f].available).toBe(adminAccess[f].available);
          }
        }
      }),
    );
  });

  // Property 3 — legacy aliases resolve to canonical tiers, and resolution via
  // an alias equals resolution via its canonical tier.
  // Validates: Requirements 1.4
  it("Property 3: legacy aliases normalize and resolve identically to their canonical tier", () => {
    // Static alias guarantees from the design table.
    expect(normalizePlan("Solo")).toBe(normalizePlan("Basic"));
    expect(normalizePlan("Clinic")).toBe(normalizePlan("Premium"));
    expect(normalizePlan("Hospital")).toBe(normalizePlan("Enterprise"));
    expect(normalizePlan("Custom")).toBe(normalizePlan("Enterprise"));

    const aliasPairs: Array<[string, PlanTier]> = [
      ["Solo", "Basic"],
      ["Clinic", "Premium"],
      ["Hospital", "Enterprise"],
      ["Custom", "Enterprise"],
    ];

    fc.assert(
      fc.property(
        roleArb,
        fc.constantFrom(...aliasPairs),
        futureOrEmptyExpiryArb,
        (role, [alias, canonical], expiry) => {
          expect(normalizePlan(alias)).toBe(canonical);

          const common = {
            role,
            subscriptionStatus: "active",
            subscriptionExpiresAt: expiry,
            isActive: true,
            now: NOW,
          };
          const viaAlias = resolveFeatureAccess({ ...common, subscriptionPlan: alias });
          const viaCanonical = resolveFeatureAccess({ ...common, subscriptionPlan: canonical });
          for (const f of FEATURE_IDS) {
            expect(viaAlias[f].available).toBe(viaCanonical[f].available);
          }
        },
      ),
    );
  });

  // Property 4 — permission/visibility imply availability.
  // Validates: Requirements 3.2, 8.1
  it("Property 4: permission !== none implies available, and visible implies available", () => {
    fc.assert(
      fc.property(anyContextArb, (ctx) => {
        const resolved = resolveFeatureAccess(ctx);
        for (const f of FEATURE_IDS) {
          const fa = resolved[f];
          if (fa.permission !== "none") {
            expect(fa.available).toBe(true);
          }
          if (fa.visible) {
            expect(fa.available).toBe(true);
          }
        }
      }),
    );
  });

  // Property 5 — an inactive or expired subscription disables every feature.
  // Validates: Requirements 5.1, 5.2
  it("Property 5: non-active status OR past expiry disables all features for every role", () => {
    const inactiveContextArb: fc.Arbitrary<AccountContext> = fc.oneof(
      // Branch A: status is not active (any expiry).
      fc.record({
        role: roleArb,
        subscriptionPlan: planArb,
        subscriptionStatus: nonActiveStatusArb,
        subscriptionExpiresAt: fc.oneof(futureOrEmptyExpiryArb, pastExpiryArb),
        isActive: fc.constant<boolean>(true),
        now: fc.constant(NOW),
      }),
      // Branch B: active status but expiry strictly in the past.
      fc.record({
        role: roleArb,
        subscriptionPlan: planArb,
        subscriptionStatus: activeStatusArb,
        subscriptionExpiresAt: pastExpiryArb,
        isActive: fc.constant<boolean>(true),
        now: fc.constant(NOW),
      }),
    );

    fc.assert(
      fc.property(inactiveContextArb, (ctx) => {
        for (const role of ROLES) {
          const resolved = resolveFeatureAccess({ ...ctx, role });
          for (const f of FEATURE_IDS) {
            expect(resolved[f].available).toBe(false);
          }
        }
      }),
    );
  });

  // Property 6 — a deactivated child account loses all access.
  // Validates: Requirements 7.1, 7.2
  it("Property 6: isActive=false disables all features for any plan/role/status", () => {
    fc.assert(
      fc.property(
        roleArb,
        planArb,
        fc.oneof(activeStatusArb, nonActiveStatusArb),
        fc.oneof(futureOrEmptyExpiryArb, pastExpiryArb),
        (role, plan, status, expiry) => {
          const resolved = resolveFeatureAccess({
            role,
            subscriptionPlan: plan,
            subscriptionStatus: status,
            subscriptionExpiresAt: expiry,
            isActive: false,
            now: NOW,
          });
          for (const f of FEATURE_IDS) {
            expect(resolved[f].available).toBe(false);
          }
        },
      ),
    );
  });

  // Property 7 — WhatsApp availability follows the plan tier rule.
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4
  it("Property 7: with active sub, whatsapp.available iff plan is Premium or Enterprise (every role)", () => {
    fc.assert(
      fc.property(roleArb, planArb, futureOrEmptyExpiryArb, (role, plan, expiry) => {
        const resolved = resolveFeatureAccess({
          role,
          subscriptionPlan: plan,
          subscriptionStatus: "active",
          subscriptionExpiresAt: expiry,
          isActive: true,
          now: NOW,
        });
        const tier = normalizePlan(plan);
        const expected = tier === "Premium" || tier === "Enterprise";
        expect(resolved.whatsapp.available).toBe(expected);
      }),
    );
  });

  // Property 8 — entitlements are monotonic across tiers.
  // Validates: Requirements 6.2, 6.3
  it("Property 8: planIncludesFeature is non-decreasing Basic -> Premium -> Enterprise", () => {
    fc.assert(
      fc.property(featureArb, (f) => {
        const basic = planIncludesFeature("Basic", f);
        const premium = planIncludesFeature("Premium", f);
        const enterprise = planIncludesFeature("Enterprise", f);
        // non-decreasing: basic => premium => enterprise
        if (basic) expect(premium).toBe(true);
        if (premium) expect(enterprise).toBe(true);
      }),
    );
  });

  // Property 8 (equivalent) — availability is non-decreasing across tiers under
  // an active subscription, for every role and feature.
  // Validates: Requirements 6.2, 6.3
  it("Property 8 (availability form): availability is non-decreasing across tiers for every role/feature", () => {
    fc.assert(
      fc.property(roleArb, futureOrEmptyExpiryArb, (role, expiry) => {
        const common = {
          role,
          subscriptionStatus: "active",
          subscriptionExpiresAt: expiry,
          isActive: true,
          now: NOW,
        };
        const byTier: Record<PlanTier, ReturnType<typeof resolveFeatureAccess>> = {
          Basic: resolveFeatureAccess({ ...common, subscriptionPlan: "Basic" }),
          Premium: resolveFeatureAccess({ ...common, subscriptionPlan: "Premium" }),
          Enterprise: resolveFeatureAccess({ ...common, subscriptionPlan: "Enterprise" }),
        };
        for (const f of FEATURE_IDS) {
          if (byTier.Basic[f].available) expect(byTier.Premium[f].available).toBe(true);
          if (byTier.Premium[f].available) expect(byTier.Enterprise[f].available).toBe(true);
        }
        // Sanity: PLAN_TIERS is ordered least->most entitled as relied upon above.
        expect(PLAN_TIERS).toEqual(["Basic", "Premium", "Enterprise"]);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Example-based unit tests
// ---------------------------------------------------------------------------

describe("feature-access (example-based)", () => {
  const premiumActive = (role: AccountRole): AccountContext => ({
    role,
    subscriptionPlan: "Premium",
    subscriptionStatus: "active",
    subscriptionExpiresAt: null,
    isActive: true,
    now: NOW,
  });

  const basicActive = (role: AccountRole): AccountContext => ({
    role,
    subscriptionPlan: "Basic",
    subscriptionStatus: "active",
    subscriptionExpiresAt: null,
    isActive: true,
    now: NOW,
  });

  it("Premium + active: whatsapp visible+operate for admin, doctor, location", () => {
    for (const role of ["admin", "doctor", "location"] as AccountRole[]) {
      const wa = resolveFeatureAccess(premiumActive(role)).whatsapp;
      expect(wa.available).toBe(true);
      expect(wa.permission).toBe("operate");
      expect(wa.visible).toBe(true);
    }
  });

  it("Premium + active: whatsapp visible+view_only for reception", () => {
    const wa = resolveFeatureAccess(premiumActive("reception")).whatsapp;
    expect(wa.available).toBe(true);
    expect(wa.permission).toBe("view_only");
    expect(wa.visible).toBe(true);
  });

  it("Basic + active: whatsapp unavailable and hidden for ALL roles", () => {
    for (const role of ROLES) {
      const wa = resolveFeatureAccess(basicActive(role)).whatsapp;
      expect(wa.available).toBe(false);
      expect(wa.visible).toBe(false);
    }
  });

  it("canUseFeature / canOperateFeature: Premium active reception can view but not operate whatsapp", () => {
    expect(canUseFeature(premiumActive("reception"), "whatsapp")).toBe(true);
    expect(canOperateFeature(premiumActive("reception"), "whatsapp")).toBe(false);
  });

  it("canOperateFeature: Premium active doctor can operate whatsapp", () => {
    expect(canOperateFeature(premiumActive("doctor"), "whatsapp")).toBe(true);
  });

  it("isSubscriptionActive: Active + future expiry => true", () => {
    expect(
      isSubscriptionActive({
        role: "admin",
        subscriptionStatus: "Active",
        subscriptionExpiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("isSubscriptionActive: Active + past expiry => false", () => {
    expect(
      isSubscriptionActive({
        role: "admin",
        subscriptionStatus: "Active",
        subscriptionExpiresAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("isSubscriptionActive: Cancelled => false", () => {
    expect(
      isSubscriptionActive({
        role: "admin",
        subscriptionStatus: "Cancelled",
        subscriptionExpiresAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("isSubscriptionActive: active + null expiry => true", () => {
    expect(
      isSubscriptionActive({
        role: "admin",
        subscriptionStatus: "active",
        subscriptionExpiresAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });
});
