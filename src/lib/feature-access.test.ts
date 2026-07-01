/**
 * Property-based and example-based tests for feature-access.ts
 *
 * These tests validate the 9 correctness properties from the design document.
 */

import { describe, it, expect, test } from "vitest";
import * as fc from "fast-check";
import {
  normalizePlan,
  isSubscriptionActive,
  planIncludesFeature,
  rolePermission,
  resolveFeatureAccess,
  canUseFeature,
  canOperateFeature,
  PLAN_FEATURES,
  ROLE_PERMISSIONS,
  FEATURE_IDS,
  PLAN_TIERS,
  type PlanTier,
  type AccountRole,
  type FeatureId,
  type AccountContext,
} from "./feature-access";

// ───────────────────────────────────────────────────────────────────────────
// Fast-check arbitraries for generating AccountContext inputs
// ───────────────────────────────────────────────────────────────────────────

const arbRole = fc.constantFrom<AccountRole>("admin", "reception", "doctor", "location");

const arbPlanTier = fc.constantFrom<PlanTier>("Basic", "Premium", "Enterprise");

// Raw plan strings including legacy aliases and unknown values
const arbRawPlan = fc.oneof(
  fc.constantFrom(
    "Basic",
    "Premium",
    "Enterprise",
    "Solo",
    "Clinic",
    "Hospital",
    "Custom",
    "Pro",
    "Trial",
    "999",
    "1499",
    "₹999",
    "₹1,499",
    "unknown",
    "",
  ),
  fc.constant(null),
  fc.constant(undefined),
);

const arbStatus = fc.oneof(
  fc.constantFrom("Active", "active", "ACTIVE", "Cancelled", "Inactive", "Expired"),
  fc.constant(null),
  fc.constant(undefined),
);

const arbExpiresAt = fc.oneof(
  fc.date().map((d) => d.toISOString()),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(""), // invalid
);

const arbIsActive = fc.option(fc.boolean(), { nil: undefined });

// Constrain date generation to avoid arithmetic overflow (JS Date range ±100,000,000 days from epoch)
const arbNow = fc.date({ min: new Date("1970-01-01"), max: new Date("2100-12-31") });

const arbAccountContext: fc.Arbitrary<AccountContext> = fc.record({
  role: arbRole,
  subscriptionPlan: arbRawPlan,
  subscriptionStatus: arbStatus,
  subscriptionExpiresAt: arbExpiresAt,
  isActive: arbIsActive,
  now: fc.option(arbNow, { nil: undefined }),
});

// ───────────────────────────────────────────────────────────────────────────
// Property 1: Availability is role-independent
// ───────────────────────────────────────────────────────────────────────────

test("Property 1: availability is role-independent for fixed plan/status/expiry/active", () => {
  fc.assert(
    fc.property(
      arbRawPlan,
      arbStatus,
      arbExpiresAt,
      arbIsActive,
      arbNow,
      arbRole,
      arbRole,
      (plan, status, expiresAt, isActive, now, role1, role2) => {
        const ctx1: AccountContext = {
          role: role1,
          subscriptionPlan: plan,
          subscriptionStatus: status,
          subscriptionExpiresAt: expiresAt,
          isActive,
          now,
        };
        const ctx2: AccountContext = { ...ctx1, role: role2 };

        const access1 = resolveFeatureAccess(ctx1);
        const access2 = resolveFeatureAccess(ctx2);

        for (const feature of FEATURE_IDS) {
          expect(access1[feature].available).toBe(access2[feature].available);
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 2: Child inherits parent entitlement
// ───────────────────────────────────────────────────────────────────────────

test("Property 2: child availability equals admin availability (active sub)", () => {
  fc.assert(
    fc.property(
      arbRawPlan,
      arbNow,
      fc.constantFrom<AccountRole>("reception", "doctor", "location"),
      (plan, now, childRole) => {
        // Active subscription with future or no expiry
        const futureExpiry = new Date(now.getTime() + 86400000).toISOString(); // +1 day

        const adminCtx: AccountContext = {
          role: "admin",
          subscriptionPlan: plan,
          subscriptionStatus: "active",
          subscriptionExpiresAt: futureExpiry,
          isActive: true,
          now,
        };
        const childCtx: AccountContext = { ...adminCtx, role: childRole };

        const adminAccess = resolveFeatureAccess(adminCtx);
        const childAccess = resolveFeatureAccess(childCtx);

        for (const feature of FEATURE_IDS) {
          expect(childAccess[feature].available).toBe(adminAccess[feature].available);
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 3: Legacy aliases are canonical
// ───────────────────────────────────────────────────────────────────────────

test("Property 3: legacy alias resolution equals canonical tier", () => {
  const aliasPairs: Array<[string, PlanTier]> = [
    ["Solo", "Basic"],
    ["999", "Basic"],
    ["Trial", "Basic"],
    ["Clinic", "Premium"],
    ["Pro", "Premium"],
    ["1499", "Premium"],
    ["Hospital", "Enterprise"],
    ["Custom", "Enterprise"],
  ];

  fc.assert(
    fc.property(
      fc.constantFrom(...aliasPairs),
      arbRole,
      arbStatus,
      arbExpiresAt,
      arbIsActive,
      arbNow,
      ([alias, canonical], role, status, expiresAt, isActive, now) => {
        const ctxAlias: AccountContext = {
          role,
          subscriptionPlan: alias,
          subscriptionStatus: status,
          subscriptionExpiresAt: expiresAt,
          isActive,
          now,
        };
        const ctxCanonical: AccountContext = {
          ...ctxAlias,
          subscriptionPlan: canonical,
        };

        const accessAlias = resolveFeatureAccess(ctxAlias);
        const accessCanonical = resolveFeatureAccess(ctxCanonical);

        for (const feature of FEATURE_IDS) {
          expect(accessAlias[feature].available).toBe(accessCanonical[feature].available);
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 4: Permission implies availability
// ───────────────────────────────────────────────────────────────────────────

test("Property 4: permission !== none implies available; visible implies available", () => {
  fc.assert(
    fc.property(arbAccountContext, (ctx) => {
      const access = resolveFeatureAccess(ctx);

      for (const feature of FEATURE_IDS) {
        const fa = access[feature];
        if (fa.permission !== "none") {
          expect(fa.available).toBe(true);
        }
        if (fa.visible) {
          expect(fa.available).toBe(true);
        }
      }
    }),
    { numRuns: 100 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 5: Inactive or expired subscription disables everything
// ───────────────────────────────────────────────────────────────────────────

test("Property 5: inactive/expired subscription => all features unavailable", () => {
  fc.assert(
    fc.property(
      arbRawPlan,
      arbRole,
      arbIsActive,
      arbNow,
      fc.oneof(
        // Either non-active status
        fc.constantFrom("Cancelled", "Inactive", "Expired", ""),
        // Or active status with past expiry
        fc.constant("active"),
      ),
      (plan, role, isActive, now, status) => {
        // Skip invalid dates to avoid arithmetic errors
        if (Number.isNaN(now.getTime())) return true;

        let expiresAt: string | null = null;
        if (status === "active") {
          // Force past expiry
          expiresAt = new Date(now.getTime() - 86400000).toISOString(); // -1 day
        }

        const ctx: AccountContext = {
          role,
          subscriptionPlan: plan,
          subscriptionStatus: status,
          subscriptionExpiresAt: expiresAt,
          isActive,
          now,
        };

        const access = resolveFeatureAccess(ctx);

        for (const feature of FEATURE_IDS) {
          expect(access[feature].available).toBe(false);
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 6: Deactivated child loses all access
// ───────────────────────────────────────────────────────────────────────────

test("Property 6: isActive=false => all features unavailable", () => {
  fc.assert(
    fc.property(
      arbRawPlan,
      arbRole,
      arbStatus,
      arbExpiresAt,
      arbNow,
      (plan, role, status, expiresAt, now) => {
        const ctx: AccountContext = {
          role,
          subscriptionPlan: plan,
          subscriptionStatus: status,
          subscriptionExpiresAt: expiresAt,
          isActive: false,
          now,
        };

        const access = resolveFeatureAccess(ctx);

        for (const feature of FEATURE_IDS) {
          expect(access[feature].available).toBe(false);
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 7: WhatsApp tier rule
// ───────────────────────────────────────────────────────────────────────────

test("Property 7: whatsapp available iff normalized plan ∈ {Premium, Enterprise} with active sub", () => {
  fc.assert(
    fc.property(arbRawPlan, arbRole, arbNow, (plan, role, now) => {
      // Skip invalid dates to avoid RangeError in arithmetic
      if (Number.isNaN(now.getTime())) return true;

      const futureExpiry = new Date(now.getTime() + 86400000).toISOString();

      const ctx: AccountContext = {
        role,
        subscriptionPlan: plan,
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      };

      const access = resolveFeatureAccess(ctx);
      const normalized = normalizePlan(plan);

      if (normalized === "Premium" || normalized === "Enterprise") {
        expect(access.whatsapp.available).toBe(true);
      } else {
        // Basic
        expect(access.whatsapp.available).toBe(false);
      }
    }),
    { numRuns: 100 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 8: Monotonic entitlements (Basic → Premium → Enterprise)
// ───────────────────────────────────────────────────────────────────────────

test("Property 8: upgrading tier never removes a feature (monotonic entitlements)", () => {
  fc.assert(
    fc.property(arbRole, arbNow, (role, now) => {
      const futureExpiry = new Date(now.getTime() + 86400000).toISOString();

      const buildCtx = (tier: PlanTier): AccountContext => ({
        role,
        subscriptionPlan: tier,
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      });

      const accessBasic = resolveFeatureAccess(buildCtx("Basic"));
      const accessPremium = resolveFeatureAccess(buildCtx("Premium"));
      const accessEnterprise = resolveFeatureAccess(buildCtx("Enterprise"));

      for (const feature of FEATURE_IDS) {
        // Basic → Premium: if available at Basic, must be available at Premium
        if (accessBasic[feature].available) {
          expect(accessPremium[feature].available).toBe(true);
        }
        // Premium → Enterprise: if available at Premium, must be available at Enterprise
        if (accessPremium[feature].available) {
          expect(accessEnterprise[feature].available).toBe(true);
        }
      }
    }),
    { numRuns: 100 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Example-based unit tests
// ───────────────────────────────────────────────────────────────────────────

describe("Example-based tests", () => {
  const now = new Date("2025-01-01T00:00:00Z");
  const futureExpiry = "2025-12-31T23:59:59Z";

  describe("WhatsApp visibility matrix at Premium", () => {
    it("admin: visible + operate", () => {
      const ctx: AccountContext = {
        role: "admin",
        subscriptionPlan: "Premium",
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      };
      const access = resolveFeatureAccess(ctx);
      expect(access.whatsapp.available).toBe(true);
      expect(access.whatsapp.permission).toBe("operate");
      expect(access.whatsapp.visible).toBe(true);
    });

    it("doctor: visible + operate", () => {
      const ctx: AccountContext = {
        role: "doctor",
        subscriptionPlan: "Premium",
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      };
      const access = resolveFeatureAccess(ctx);
      expect(access.whatsapp.available).toBe(true);
      expect(access.whatsapp.permission).toBe("operate");
      expect(access.whatsapp.visible).toBe(true);
    });

    it("location: visible + operate", () => {
      const ctx: AccountContext = {
        role: "location",
        subscriptionPlan: "Premium",
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      };
      const access = resolveFeatureAccess(ctx);
      expect(access.whatsapp.available).toBe(true);
      expect(access.whatsapp.permission).toBe("operate");
      expect(access.whatsapp.visible).toBe(true);
    });

    it("reception: visible + view_only", () => {
      const ctx: AccountContext = {
        role: "reception",
        subscriptionPlan: "Premium",
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      };
      const access = resolveFeatureAccess(ctx);
      expect(access.whatsapp.available).toBe(true);
      expect(access.whatsapp.permission).toBe("view_only");
      expect(access.whatsapp.visible).toBe(true);
    });
  });

  describe("WhatsApp hidden at Basic for all roles", () => {
    const roles: AccountRole[] = ["admin", "doctor", "reception", "location"];

    roles.forEach((role) => {
      it(`${role}: not available at Basic`, () => {
        const ctx: AccountContext = {
          role,
          subscriptionPlan: "Basic",
          subscriptionStatus: "active",
          subscriptionExpiresAt: futureExpiry,
          isActive: true,
          now,
        };
        const access = resolveFeatureAccess(ctx);
        expect(access.whatsapp.available).toBe(false);
        expect(access.whatsapp.visible).toBe(false);
      });
    });
  });

  describe("Server guard helpers", () => {
    it("canUseFeature returns false when plan excludes the feature", () => {
      const ctx: AccountContext = {
        role: "admin",
        subscriptionPlan: "Basic",
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      };
      expect(canUseFeature(ctx, "whatsapp")).toBe(false);
    });

    it("canOperateFeature returns false when permission is view_only", () => {
      const ctx: AccountContext = {
        role: "reception",
        subscriptionPlan: "Premium",
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      };
      expect(canOperateFeature(ctx, "whatsapp")).toBe(false);
      expect(canUseFeature(ctx, "whatsapp")).toBe(true); // can view, but not operate
    });

    it("canOperateFeature returns true when permission is operate", () => {
      const ctx: AccountContext = {
        role: "doctor",
        subscriptionPlan: "Premium",
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      };
      expect(canOperateFeature(ctx, "whatsapp")).toBe(true);
      expect(canUseFeature(ctx, "whatsapp")).toBe(true);
    });
  });
});
