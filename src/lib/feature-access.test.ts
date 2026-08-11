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
