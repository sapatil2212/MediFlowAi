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
  fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(""), // invalid
);

const arbIsActive = fc.option(fc.boolean(), { nil: undefined });

// Constrain date generation to avoid arithmetic overflow (JS Date range ±100,000,000 days from epoch)
const arbNow = fc.date({
  min: new Date("1970-01-01"),
  max: new Date("2100-12-31"),
  noInvalidDate: true,
});

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

// ═══════════════════════════════════════════════════════════════════════════
// Task 2.2 additions — the profession gating dimension (`video` feature)
//
// Everything below is ADDITIVE. The 19 tests above are the concrete regression
// guard for Requirement 2.8 and are left byte-for-byte unchanged: their generic
// loops over FEATURE_IDS now include `video`, which resolves unavailable in
// every profession-less generated context.
// ═══════════════════════════════════════════════════════════════════════════

import {
  HEALTHCARE_PROFESSION,
  PROFESSION_FEATURES,
  professionAllowsFeature,
} from "./feature-access";

// ───────────────────────────────────────────────────────────────────────────
// Profession arbitraries
// ───────────────────────────────────────────────────────────────────────────

/** The four non-healthcare profession strings this codebase actually stores. */
const NON_HEALTHCARE_PROFESSIONS = [
  "Fitness Gym etc",
  "Beauty and wellness",
  "Professional services like law, consultant, real estate, CA",
  "Education institutions",
] as const;

/**
 * Near-miss values. The implementation matches EXACTLY after trimming, so
 * whitespace padding is ALLOWED while any case or wording difference is DENIED.
 */
const PADDED_HEALTHCARE_PROFESSIONS = [
  " Healthcare and medical ",
  "\tHealthcare and medical",
  "Healthcare and medical\n",
] as const;

const NEAR_MISS_PROFESSIONS = [
  "healthcare and medical", // wrong case => denied
  "HEALTHCARE AND MEDICAL",
  "Healthcare & Medical",
  "Healthcare and medical clinic", // superstring => denied
  "Medical",
  "unknown",
] as const;

const arbProfession: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.constant<string | null | undefined>(HEALTHCARE_PROFESSION),
  fc.constantFrom<string | null | undefined>(...PADDED_HEALTHCARE_PROFESSIONS),
  fc.constantFrom<string | null | undefined>(...NON_HEALTHCARE_PROFESSIONS),
  fc.constantFrom<string | null | undefined>(...NEAR_MISS_PROFESSIONS),
  fc.constant<string | null | undefined>(""),
  fc.constant<string | null | undefined>(null),
  fc.constant<string | null | undefined>(undefined),
);

/** Mirrors the implementation's rule: exact match after trimming. */
const isHealthcare = (profession: string | null | undefined): boolean =>
  (profession ?? "").trim() === HEALTHCARE_PROFESSION;

/**
 * Valid-only clock and expiry arbitraries for the tests below.
 *
 * `noInvalidDate: true` matters: fast-check can otherwise draw an Invalid Date,
 * and `new Date(NaN).toISOString()` throws a RangeError inside the generator
 * before any assertion runs. Every test here is still wall-clock independent —
 * the instant is injected through `ctx.now`.
 */
const arbValidNow = fc.date({
  min: new Date("1970-01-01"),
  max: new Date("2100-12-31"),
  noInvalidDate: true,
});

const arbValidExpiresAt = fc.oneof(
  arbValidNow.map((d) => d.toISOString()),
  fc.constant<string | null | undefined>(null),
  fc.constant<string | null | undefined>(undefined),
  fc.constant<string | null | undefined>(""), // invalid => treated as no expiry
);

/** Same shape as arbAccountContext, plus the new profession dimension. */
const arbProfessionContext: fc.Arbitrary<AccountContext> = fc.record({
  role: arbRole,
  profession: arbProfession,
  subscriptionPlan: arbRawPlan,
  subscriptionStatus: arbStatus,
  subscriptionExpiresAt: arbValidExpiresAt,
  isActive: arbIsActive,
  now: fc.option(arbValidNow, { nil: undefined }),
});

/** Plan strings (canonical + aliases) that normalize to Premium or Enterprise. */
const arbVideoEntitledPlan = fc.constantFrom(
  "Premium",
  "Enterprise",
  "Clinic",
  "Pro",
  "1499",
  "Hospital",
  "Custom",
);

// ───────────────────────────────────────────────────────────────────────────
// Property 15.1: a non-healthcare profession always closes `video`
// ───────────────────────────────────────────────────────────────────────────

test("Property 15.1: video is unavailable whenever the trimmed profession is not healthcare", () => {
  fc.assert(
    fc.property(arbProfessionContext, (ctx) => {
      const access = resolveFeatureAccess(ctx);

      if (!isHealthcare(ctx.profession)) {
        expect(access.video.available).toBe(false);
        expect(access.video.permission).toBe("none");
        expect(access.video.visible).toBe(false);
      }
    }),
    { numRuns: 300 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 15.2 (Requirement 2.8): the profession dimension is a strict no-op
// for every pre-existing feature
// ───────────────────────────────────────────────────────────────────────────

test("Property 15.2: every feature except video resolves identically with the profession key omitted", () => {
  fc.assert(
    fc.property(arbProfessionContext, (ctx) => {
      const { profession: _profession, ...ctxWithoutProfession } = ctx;
      expect("profession" in ctxWithoutProfession).toBe(false);

      const withProfession = resolveFeatureAccess(ctx);
      const withoutProfession = resolveFeatureAccess(ctxWithoutProfession);

      for (const feature of FEATURE_IDS) {
        if (feature === "video") continue;
        expect(withProfession[feature]).toEqual(withoutProfession[feature]);
      }
    }),
    { numRuns: 300 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 15.3: Property 4's invariant still holds, now covering `video`
// ───────────────────────────────────────────────────────────────────────────

test("Property 15.3: permission !== none implies available for every feature including video", () => {
  fc.assert(
    fc.property(arbProfessionContext, (ctx) => {
      const access = resolveFeatureAccess(ctx);

      for (const feature of FEATURE_IDS) {
        const fa = access[feature];
        if (fa.permission !== "none") {
          expect(fa.available).toBe(true);
        }
        if (fa.visible) {
          expect(fa.available).toBe(true);
          expect(fa.permission).not.toBe("none");
        }
      }

      if (access.video.permission !== "none") {
        expect(access.video.available).toBe(true);
        expect(isHealthcare(ctx.profession)).toBe(true);
      }
    }),
    { numRuns: 300 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 15.4: the positive direction
// ───────────────────────────────────────────────────────────────────────────

test("Property 15.4: healthcare + active Premium/Enterprise + admin/doctor => video operate", () => {
  fc.assert(
    fc.property(
      arbVideoEntitledPlan,
      fc.constantFrom<AccountRole>("admin", "doctor"),
      fc.oneof(
        fc.constant<string>(HEALTHCARE_PROFESSION),
        fc.constantFrom<string>(...PADDED_HEALTHCARE_PROFESSIONS),
      ),
      arbValidNow,
      (plan, role, profession, now) => {
        const futureExpiry = new Date(now.getTime() + 86400000).toISOString();

        const ctx: AccountContext = {
          role,
          profession,
          subscriptionPlan: plan,
          subscriptionStatus: "active",
          subscriptionExpiresAt: futureExpiry,
          isActive: true,
          now,
        };

        const access = resolveFeatureAccess(ctx);
        expect(access.video).toEqual({ available: true, permission: "operate", visible: true });
        expect(canUseFeature(ctx, "video")).toBe(true);
        expect(canOperateFeature(ctx, "video")).toBe(true);
      },
    ),
    { numRuns: 200 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Example-based tests for the video feature
// ───────────────────────────────────────────────────────────────────────────

describe("Video consultation feature (profession-gated)", () => {
  const now = new Date("2025-01-01T00:00:00Z");
  const futureExpiry = "2025-12-31T23:59:59Z";
  const allRoles: AccountRole[] = ["admin", "doctor", "reception", "location"];

  /** Builds an ACTIVE-subscription context; profession and plan vary per case. */
  const makeVideoCtx = (
    role: AccountRole,
    plan: string,
    profession: string | null | undefined,
  ): AccountContext => ({
    role,
    profession,
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionExpiresAt: futureExpiry,
    isActive: true,
    now,
  });

  describe("video role matrix at Premium for a healthcare tenant", () => {
    it("admin: operate + visible", () => {
      const access = resolveFeatureAccess(makeVideoCtx("admin", "Premium", HEALTHCARE_PROFESSION));
      expect(access.video.available).toBe(true);
      expect(access.video.permission).toBe("operate");
      expect(access.video.visible).toBe(true);
    });

    it("doctor: operate + visible", () => {
      const access = resolveFeatureAccess(makeVideoCtx("doctor", "Premium", HEALTHCARE_PROFESSION));
      expect(access.video.available).toBe(true);
      expect(access.video.permission).toBe("operate");
      expect(access.video.visible).toBe(true);
    });

    // Requirement 2.7: `none` refuses read-shaped requests too.
    it("reception: none + hidden, and canUseFeature refuses reads", () => {
      const ctx = makeVideoCtx("reception", "Premium", HEALTHCARE_PROFESSION);
      const access = resolveFeatureAccess(ctx);
      expect(access.video.available).toBe(true); // tenant is entitled…
      expect(access.video.permission).toBe("none"); // …but the role is not
      expect(access.video.visible).toBe(false);
      expect(canUseFeature(ctx, "video")).toBe(false);
      expect(canOperateFeature(ctx, "video")).toBe(false);
    });

    it("location: none + hidden, and canUseFeature refuses reads", () => {
      const ctx = makeVideoCtx("location", "Premium", HEALTHCARE_PROFESSION);
      const access = resolveFeatureAccess(ctx);
      expect(access.video.available).toBe(true);
      expect(access.video.permission).toBe("none");
      expect(access.video.visible).toBe(false);
      expect(canUseFeature(ctx, "video")).toBe(false);
      expect(canOperateFeature(ctx, "video")).toBe(false);
    });
  });

  describe("video hidden at Basic for all roles even for a healthcare tenant", () => {
    allRoles.forEach((role) => {
      it(`${role}: not available at Basic`, () => {
        const ctx = makeVideoCtx(role, "Basic", HEALTHCARE_PROFESSION);
        const access = resolveFeatureAccess(ctx);
        expect(access.video.available).toBe(false);
        expect(access.video.permission).toBe("none");
        expect(access.video.visible).toBe(false);
        expect(canUseFeature(ctx, "video")).toBe(false);
      });
    });
  });

  // Requirement 1.2: a non-healthcare tenant never sees video, whatever the plan.
  describe("video unavailable for non-healthcare tenants on Premium", () => {
    NON_HEALTHCARE_PROFESSIONS.forEach((profession) => {
      allRoles.forEach((role) => {
        it(`${profession} / ${role}: unavailable`, () => {
          const ctx = makeVideoCtx(role, "Premium", profession);
          const access = resolveFeatureAccess(ctx);
          expect(access.video.available).toBe(false);
          expect(access.video.permission).toBe("none");
          expect(access.video.visible).toBe(false);
          expect(canUseFeature(ctx, "video")).toBe(false);
          expect(canOperateFeature(ctx, "video")).toBe(false);
        });
      });
    });
  });

  describe("profession matching is exact after trimming", () => {
    it("allows a whitespace-padded healthcare value", () => {
      const access = resolveFeatureAccess(
        makeVideoCtx("admin", "Enterprise", " Healthcare and medical "),
      );
      expect(access.video.available).toBe(true);
      expect(access.video.permission).toBe("operate");
    });

    it("denies a lowercase healthcare value", () => {
      const access = resolveFeatureAccess(
        makeVideoCtx("admin", "Enterprise", "healthcare and medical"),
      );
      expect(access.video.available).toBe(false);
      expect(access.video.visible).toBe(false);
    });

    it("denies a healthcare superstring", () => {
      const access = resolveFeatureAccess(
        makeVideoCtx("admin", "Enterprise", "Healthcare and medical clinic"),
      );
      expect(access.video.available).toBe(false);
    });
  });

  describe("professionAllowsFeature", () => {
    const unrestricted = FEATURE_IDS.filter((f) => !PROFESSION_FEATURES[f]);

    it("PROFESSION_FEATURES restricts video and nothing else", () => {
      expect(Object.keys(PROFESSION_FEATURES)).toEqual(["video"]);
      expect(PROFESSION_FEATURES.video).toEqual([HEALTHCARE_PROFESSION]);
      expect(unrestricted).not.toContain("video");
    });

    it("returns true for every unrestricted feature regardless of profession", () => {
      const professions: Array<string | null | undefined> = [
        HEALTHCARE_PROFESSION,
        ...NON_HEALTHCARE_PROFESSIONS,
        ...NEAR_MISS_PROFESSIONS,
        "",
        null,
        undefined,
      ];

      for (const feature of unrestricted) {
        for (const profession of professions) {
          expect(professionAllowsFeature(profession, feature)).toBe(true);
        }
      }
    });

    it("fails closed for video on null, undefined, and empty string", () => {
      expect(professionAllowsFeature(null, "video")).toBe(false);
      expect(professionAllowsFeature(undefined, "video")).toBe(false);
      expect(professionAllowsFeature("", "video")).toBe(false);
      expect(professionAllowsFeature("   ", "video")).toBe(false);
    });

    it("allows video for the exact and trimmed healthcare profession only", () => {
      expect(professionAllowsFeature(HEALTHCARE_PROFESSION, "video")).toBe(true);
      expect(professionAllowsFeature(" Healthcare and medical ", "video")).toBe(true);
      expect(professionAllowsFeature("healthcare and medical", "video")).toBe(false);
      for (const profession of NON_HEALTHCARE_PROFESSIONS) {
        expect(professionAllowsFeature(profession, "video")).toBe(false);
      }
    });
  });

  describe("Server guard helpers for video", () => {
    it("canOperateFeature is false for a non-healthcare tenant on Enterprise as admin", () => {
      for (const profession of NON_HEALTHCARE_PROFESSIONS) {
        const ctx = makeVideoCtx("admin", "Enterprise", profession);
        expect(canOperateFeature(ctx, "video")).toBe(false);
        expect(canUseFeature(ctx, "video")).toBe(false);
      }
    });

    it("canOperateFeature is false when the profession is absent from the context", () => {
      const ctx: AccountContext = {
        role: "admin",
        subscriptionPlan: "Enterprise",
        subscriptionStatus: "active",
        subscriptionExpiresAt: futureExpiry,
        isActive: true,
        now,
      };
      expect(canOperateFeature(ctx, "video")).toBe(false);
      expect(canUseFeature(ctx, "video")).toBe(false);
      // …while a pre-existing feature is untouched by the new dimension.
      expect(canOperateFeature(ctx, "whatsapp")).toBe(true);
    });

    it("canOperateFeature is true for a healthcare doctor on Premium", () => {
      const ctx = makeVideoCtx("doctor", "Premium", HEALTHCARE_PROFESSION);
      expect(canOperateFeature(ctx, "video")).toBe(true);
      expect(canUseFeature(ctx, "video")).toBe(true);
    });

    // Requirement 2.5: an inactive/expired subscription closes video too.
    it("canUseFeature is false for a healthcare admin whose subscription expired", () => {
      const ctx: AccountContext = {
        role: "admin",
        profession: HEALTHCARE_PROFESSION,
        subscriptionPlan: "Premium",
        subscriptionStatus: "active",
        subscriptionExpiresAt: "2024-12-31T23:59:59Z", // before `now`
        isActive: true,
        now,
      };
      expect(resolveFeatureAccess(ctx).video.available).toBe(false);
      expect(canUseFeature(ctx, "video")).toBe(false);
    });

    // Requirement 1.3: a deactivated child account loses video regardless.
    it("canUseFeature is false for a deactivated healthcare doctor", () => {
      const ctx: AccountContext = {
        ...makeVideoCtx("doctor", "Premium", HEALTHCARE_PROFESSION),
        isActive: false,
      };
      expect(resolveFeatureAccess(ctx).video.available).toBe(false);
      expect(canUseFeature(ctx, "video")).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Task 6.2 additions — feature-access baseline non-regression coverage for the
// two restaurant feature ids (`restaurant_config`, `restaurant_bookings`).
//
// Everything below is ADDITIVE. The tests above are left byte-for-byte
// unchanged; their generic loops over FEATURE_IDS simply now also cover the two
// restaurant ids, which carry no PROFESSION_FEATURES entry and are entitled on
// every plan tier.
// ═══════════════════════════════════════════════════════════════════════════

import type { Permission, FeatureAccess } from "./feature-access";

/**
 * The seven feature ids that existed before the restaurant category was added.
 * Frozen here on purpose: the baseline below must not follow the module if the
 * module drifts.
 */
const PRE_EXISTING_FEATURE_IDS = [
  "whatsapp",
  "analytics",
  "scribe",
  "users",
  "locations",
  "plans",
  "video",
] as const;

type PreExistingFeatureId = (typeof PRE_EXISTING_FEATURE_IDS)[number];

/** Plan entitlement as it stood before the restaurant ids were registered. */
const BASELINE_PLAN_FEATURES: Record<PlanTier, Record<PreExistingFeatureId, boolean>> = {
  Basic: {
    whatsapp: false,
    analytics: true,
    scribe: true,
    users: true,
    locations: false,
    plans: true,
    video: false,
  },
  Premium: {
    whatsapp: true,
    analytics: true,
    scribe: true,
    users: true,
    locations: true,
    plans: true,
    video: true,
  },
  Enterprise: {
    whatsapp: true,
    analytics: true,
    scribe: true,
    users: true,
    locations: true,
    plans: true,
    video: true,
  },
};

/** Role permissions as they stood before the restaurant ids were registered. */
const BASELINE_ROLE_PERMISSIONS: Record<PreExistingFeatureId, Record<AccountRole, Permission>> = {
  whatsapp: { admin: "operate", doctor: "operate", reception: "view_only", location: "operate" },
  analytics: { admin: "operate", doctor: "operate", reception: "view_only", location: "operate" },
  scribe: { admin: "operate", doctor: "operate", reception: "none", location: "operate" },
  users: { admin: "operate", doctor: "none", reception: "none", location: "none" },
  locations: { admin: "operate", doctor: "none", reception: "none", location: "none" },
  plans: { admin: "operate", doctor: "none", reception: "none", location: "none" },
  video: { admin: "operate", doctor: "operate", reception: "none", location: "none" },
};

/** The only profession restriction that existed before the restaurant category. */
const BASELINE_PROFESSION_FEATURES: Partial<Record<PreExistingFeatureId, readonly string[]>> = {
  video: [HEALTHCARE_PROFESSION],
};

/** Independent copy of plan normalization, so drift in either side is caught. */
function baselineNormalizePlan(plan?: string | null): PlanTier {
  const raw = (plan ?? "").toLowerCase();
  if (raw.includes("enterprise") || raw.includes("hospital") || raw.includes("custom")) {
    return "Enterprise";
  }
  if (
    raw.includes("premium") ||
    raw.includes("clinic") ||
    raw.includes("pro") ||
    raw.includes("1499")
  ) {
    return "Premium";
  }
  return "Basic";
}

/** Independent copy of the subscription-active rule. */
function baselineSubscriptionActive(ctx: AccountContext): boolean {
  if ((ctx.subscriptionStatus ?? "").toLowerCase() !== "active") return false;
  const raw = ctx.subscriptionExpiresAt;
  if (raw === null || raw === undefined || raw === "") return true;
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) return true;
  return !(expiresAt.getTime() < (ctx.now ?? new Date()).getTime());
}

/** Independent copy of the resolver, restricted to the seven pre-existing ids. */
function baselineResolve(ctx: AccountContext): Record<PreExistingFeatureId, FeatureAccess> {
  const plan = baselineNormalizePlan(ctx.subscriptionPlan);
  const active = baselineSubscriptionActive(ctx);
  const childOk = ctx.isActive !== false;

  const out = {} as Record<PreExistingFeatureId, FeatureAccess>;
  for (const feature of PRE_EXISTING_FEATURE_IDS) {
    const allowedProfessions = BASELINE_PROFESSION_FEATURES[feature];
    const professionOk = allowedProfessions
      ? allowedProfessions.includes((ctx.profession ?? "").trim())
      : true;
    const available = active && childOk && BASELINE_PLAN_FEATURES[plan][feature] && professionOk;
    const permission: Permission = available
      ? BASELINE_ROLE_PERMISSIONS[feature][ctx.role]
      : "none";
    out[feature] = { available, permission, visible: available && permission !== "none" };
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Exhaustive baseline: every combination of plan, subscription status, role and
// legacy profession must still resolve exactly as it did before the two
// restaurant ids were registered.
// ───────────────────────────────────────────────────────────────────────────

describe("Restaurant feature registration is non-regressive (Requirement 12.4)", () => {
  const BASELINE_NOW = new Date("2025-06-15T12:00:00Z");

  const BASELINE_PLANS: Array<string | null | undefined> = [
    "Basic",
    "Premium",
    "Enterprise",
    "Solo",
    "Clinic",
    "Hospital",
    "Custom",
    "Pro",
    "1499",
    "₹999",
    "unknown",
    "",
    null,
    undefined,
  ];

  const BASELINE_STATUSES: Array<string | null | undefined> = [
    "Active",
    "active",
    "Cancelled",
    "Expired",
    "",
    null,
  ];

  const BASELINE_PROFESSIONS: Array<string | null | undefined> = [
    HEALTHCARE_PROFESSION,
    " Healthcare and medical ",
    "healthcare and medical",
    ...NON_HEALTHCARE_PROFESSIONS,
    "",
    null,
    undefined,
  ];

  const BASELINE_EXPIRIES: Array<string | null | undefined> = [
    null,
    "",
    "2099-01-01T00:00:00Z", // future
    "2024-01-01T00:00:00Z", // past
  ];

  const allRoles: AccountRole[] = ["admin", "reception", "doctor", "location"];

  it("resolves the seven pre-existing feature ids identically for every combination", () => {
    let combinations = 0;

    for (const subscriptionPlan of BASELINE_PLANS) {
      for (const subscriptionStatus of BASELINE_STATUSES) {
        for (const role of allRoles) {
          for (const profession of BASELINE_PROFESSIONS) {
            for (const subscriptionExpiresAt of BASELINE_EXPIRIES) {
              const ctx: AccountContext = {
                role,
                profession,
                subscriptionPlan,
                subscriptionStatus,
                subscriptionExpiresAt,
                isActive: true,
                now: BASELINE_NOW,
              };

              const actual = resolveFeatureAccess(ctx);
              const expected = baselineResolve(ctx);

              for (const feature of PRE_EXISTING_FEATURE_IDS) {
                expect(
                  actual[feature],
                  `drift for ${feature} at plan=${subscriptionPlan} status=${subscriptionStatus} role=${role} profession=${profession} expires=${subscriptionExpiresAt}`,
                ).toEqual(expected[feature]);
              }

              combinations += 1;
            }
          }
        }
      }
    }

    expect(combinations).toBe(
      BASELINE_PLANS.length *
        BASELINE_STATUSES.length *
        allRoles.length *
        BASELINE_PROFESSIONS.length *
        BASELINE_EXPIRIES.length,
    );
  });

  it("registers exactly the two restaurant ids and adds no profession restriction", () => {
    expect(FEATURE_IDS).toEqual([
      ...PRE_EXISTING_FEATURE_IDS,
      "restaurant_config",
      "restaurant_bookings",
    ]);
    expect(Object.keys(PROFESSION_FEATURES)).toEqual(["video"]);
    expect(PROFESSION_FEATURES.restaurant_config).toBeUndefined();
    expect(PROFESSION_FEATURES.restaurant_bookings).toBeUndefined();
  });

  it("entitles both restaurant ids on every plan tier", () => {
    for (const tier of PLAN_TIERS) {
      expect(planIncludesFeature(tier, "restaurant_config")).toBe(true);
      expect(planIncludesFeature(tier, "restaurant_bookings")).toBe(true);
      expect(PLAN_FEATURES[tier].restaurant_config).toBe(true);
      expect(PLAN_FEATURES[tier].restaurant_bookings).toBe(true);
    }
  });

  it("carries the documented role permission matrix", () => {
    expect(ROLE_PERMISSIONS.restaurant_config).toEqual({
      admin: "operate",
      reception: "view_only",
      doctor: "none",
      location: "operate",
    });
    expect(ROLE_PERMISSIONS.restaurant_bookings).toEqual({
      admin: "operate",
      reception: "operate",
      doctor: "view_only",
      location: "operate",
    });

    expect(rolePermission("reception", "restaurant_config")).toBe("view_only");
    expect(rolePermission("doctor", "restaurant_config")).toBe("none");
    expect(rolePermission("doctor", "restaurant_bookings")).toBe("view_only");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Feature: restaurant-table-booking, Property 28: Writes are refused server-side
// whenever the resolved permission is not operate — for any account context
// whose resolved permission for restaurant configuration is not `operate` and
// any submitted Dining_Table, Operating_Hours, or Service_Settings payload, and
// for any account context whose resolved permission for booking management is
// not `operate` and any submitted Booking_Status change or table reassignment,
// the submission is rejected with a not-authorised message and the stored
// Dining_Tables, Operating_Hours, Service_Settings, Booking_Statuses, and
// assigned Dining_Tables are unchanged.
//
// This file owns the decision half of that property: the guard the server
// functions call (`canOperateFeature`) refuses exactly when the resolved
// permission is not `operate`, and `canUseFeature` refuses exactly when it is
// `none`. The store-unchanged half is covered by the row-access suites.
// ───────────────────────────────────────────────────────────────────────────

test("Property 28: canOperateFeature refuses restaurant writes exactly when the resolved permission is not operate", () => {
  fc.assert(
    fc.property(arbProfessionContext, (ctx) => {
      const access = resolveFeatureAccess(ctx);

      for (const feature of ["restaurant_config", "restaurant_bookings"] as FeatureId[]) {
        const fa = access[feature];

        if (fa.permission !== "operate") {
          expect(canOperateFeature(ctx, feature)).toBe(false);
        } else {
          expect(fa.available).toBe(true);
          expect(canOperateFeature(ctx, feature)).toBe(true);
        }

        expect(canUseFeature(ctx, feature)).toBe(fa.available && fa.permission !== "none");
        expect(fa.visible).toBe(fa.available && fa.permission !== "none");
      }

      // A doctor-role account can never configure a restaurant, and a reception
      // account can never write configuration, whatever the plan or profession.
      if (ctx.role === "doctor") {
        expect(canUseFeature(ctx, "restaurant_config")).toBe(false);
      }
      if (ctx.role === "reception") {
        expect(canOperateFeature(ctx, "restaurant_config")).toBe(false);
      }
    }),
    { numRuns: 300 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Feature: restaurant-table-booking, Property 30: Restaurant data and the
// restaurant category change nothing for the existing categories — for any
// Tenant whose Business_Profession is not `Restaurant and dining`, the
// Booking_Slots computed for a given date and staff member are deeply equal
// whether or not arbitrary Operating_Hours, Service_Settings, and Dining_Table
// rows exist for that Tenant, and every booking created for that Tenant stores
// an empty Dining_Table reference, Party_Size, Turn_Time snapshot, and
// Table_Name snapshot; for any account context, the resolved feature
// availability and permission of every feature carrying no profession
// restriction are unchanged when only the Business_Profession varies.
//
// This file owns the final clause; the slot and booking clauses belong to the
// availability and booking-model suites.
// ───────────────────────────────────────────────────────────────────────────

test("Property 30: varying only profession leaves every unrestricted feature's available, permission and visible identical", () => {
  const unrestricted = FEATURE_IDS.filter((f) => !PROFESSION_FEATURES[f]);

  fc.assert(
    fc.property(arbProfessionContext, arbProfession, (ctx, otherProfession) => {
      const withOther: AccountContext = { ...ctx, profession: otherProfession };
      const { profession: _omitted, ...withoutProfession } = ctx;

      const base = resolveFeatureAccess(ctx);
      const varied = resolveFeatureAccess(withOther);
      const omitted = resolveFeatureAccess(withoutProfession);

      expect(unrestricted).toContain("restaurant_config");
      expect(unrestricted).toContain("restaurant_bookings");
      expect(unrestricted).not.toContain("video");

      for (const feature of unrestricted) {
        expect(varied[feature].available).toBe(base[feature].available);
        expect(varied[feature].permission).toBe(base[feature].permission);
        expect(varied[feature].visible).toBe(base[feature].visible);
        expect(omitted[feature]).toEqual(base[feature]);
      }
    }),
    { numRuns: 300 },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Task 11.4 additions — restaurant-dashboard-settings regression anchor.
//
// The Settings closures and Menu editors have NO feature ids of their own: both
// are governed entirely by `restaurant_config`, and the `Restaurant Profile`
// supersession (Profile stays visible even when `restaurant_config` is `none`)
// is a navigation decision the shell derives from the SAME resolved permission.
// This block pins the governing permission and the sub-location inheritance the
// design relies on, and proves neither depends on the tenant's profession, so
// the five non-restaurant Category_Dashboard flows are preserved.
//
// Everything below is ADDITIVE and example-based; the exhaustive resolution
// matrix and the profession/child-inheritance properties above are unchanged.
// ═══════════════════════════════════════════════════════════════════════════

describe("Restaurant Settings closures/menu governance and supersession (task 11.4)", () => {
  const NOW = new Date("2025-06-15T12:00:00Z");
  const FUTURE_EXPIRY = "2099-01-01T00:00:00Z";

  /**
   * The profession values that reach `/dashboards/restaurant` (the sixth
   * profession) and the five non-restaurant Category_Dashboards. Closures/menu
   * are unrestricted by profession, so `restaurant_config` must resolve the same
   * across every one of them.
   */
  const PROFESSION_FLOWS: Array<string | null | undefined> = [
    "Restaurant and dining",
    HEALTHCARE_PROFESSION,
    ...NON_HEALTHCARE_PROFESSIONS,
  ];

  const makeCtx = (
    role: AccountRole,
    plan: string,
    profession: string | null | undefined,
    isActive = true,
  ): AccountContext => ({
    role,
    profession,
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionExpiresAt: FUTURE_EXPIRY,
    isActive,
    now: NOW,
  });

  // Req 6.9-6.11 / 4.x: closures AND menu writes are both `restaurant_config`
  // operations, so a single permission gates them. The matrix that drives that
  // gate — and the Profile supersession — is fixed and profession-independent.
  it("gates closures and menu writes through the single restaurant_config permission for every profession", () => {
    for (const profession of PROFESSION_FLOWS) {
      // Owner and branch may change closures/menu; reception may only look;
      // a doctor-role account is refused even read-shaped requests.
      expect(canOperateFeature(makeCtx("admin", "Premium", profession), "restaurant_config")).toBe(
        true,
      );
      expect(
        canOperateFeature(makeCtx("location", "Premium", profession), "restaurant_config"),
      ).toBe(true);

      const reception = makeCtx("reception", "Premium", profession);
      expect(canUseFeature(reception, "restaurant_config")).toBe(true);
      expect(canOperateFeature(reception, "restaurant_config")).toBe(false);

      const doctor = makeCtx("doctor", "Premium", profession);
      expect(canUseFeature(doctor, "restaurant_config")).toBe(false);
      expect(resolveFeatureAccess(doctor).restaurant_config.permission).toBe("none");
    }
  });

  // Req 2.1 supersession: `Restaurant Profile` stays visible even when the
  // resolved `restaurant_config` permission is `none`/`view_only`. At the
  // resolver layer that is exactly the permission the navigation supersedes —
  // pin it so a drift toward hiding Profile is caught upstream.
  it("still resolves a concrete restaurant_config permission (never hidden) for the roles Profile supersedes", () => {
    for (const profession of PROFESSION_FLOWS) {
      expect(resolveFeatureAccess(makeCtx("doctor", "Premium", profession)).restaurant_config).toEqual(
        { available: true, permission: "none", visible: false },
      );
      expect(
        resolveFeatureAccess(makeCtx("reception", "Premium", profession)).restaurant_config,
      ).toEqual({ available: true, permission: "view_only", visible: true });
    }
  });

  // Inherited-plan behaviour for sub-locations: a Branch_Account (`location`)
  // inherits the parent plan's restaurant entitlement, identically across every
  // profession and plan tier, and loses it when deactivated.
  it("inherits the parent plan's restaurant entitlement for a sub-location across every profession and tier", () => {
    for (const tier of PLAN_TIERS) {
      for (const profession of PROFESSION_FLOWS) {
        const owner = resolveFeatureAccess(makeCtx("admin", tier, profession));
        const branch = resolveFeatureAccess(makeCtx("location", tier, profession));

        for (const feature of ["restaurant_config", "restaurant_bookings"] as FeatureId[]) {
          expect(branch[feature].available).toBe(owner[feature].available);
          // The branch role operates both restaurant features when entitled.
          expect(branch[feature].permission).toBe(owner[feature].available ? "operate" : "none");
        }
      }
    }

    // A deactivated branch loses the inherited restaurant entitlement entirely.
    const deactivated = resolveFeatureAccess(
      makeCtx("location", "Enterprise", "Restaurant and dining", false),
    );
    expect(deactivated.restaurant_config.available).toBe(false);
    expect(deactivated.restaurant_bookings.available).toBe(false);
  });
});
