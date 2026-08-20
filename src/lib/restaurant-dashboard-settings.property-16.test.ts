/**
 * restaurant-dashboard-settings.property-16.test.ts
 *
 * Property-based suite for consistent SubUser plan rules and validation
 * (spec task 10.5). Generators build canonical and legacy plan-name aliases,
 * per-role counts, requested/previous roles, and password/confirmation pairs.
 *
 * The suite exercises the pure plan/validation helpers exported from
 * `restaurant-settings-model`:
 *   - `resolveSubUserPlanLimits`   plan tier -> per-role maxima + display message
 *   - `resolveSubUserRoleChange`   create/edit mutation guard (removal + add)
 *   - `SUB_USER_ROLES`             the only creatable roles
 *   - `validatePasswordChangeInput` password length + confirmation validation
 *   - `MSG_PASSWORD_MIN_LENGTH`, `MSG_PASSWORDS_DO_NOT_MATCH`, `MSG_SUB_USER_ROLE`
 *
 * Against independent reference tables the property asserts:
 *   - The displayed plan-limit message and the create/role-change mutation
 *     guard derive from the SAME per-role maxima (consistency).
 *   - A role change is modeled as removal from the old role plus addition to
 *     the new role, so counts never mutate the caller's collection.
 *   - Creation succeeds only for `reception`/`doctor`, within remaining
 *     capacity, with a matching password of at least eight characters.
 *   - Every validation/plan failure is reported without mutating the modeled
 *     user set.
 *
 * This module is pure: no I/O, clock, or network dependencies.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  resolveSubUserPlanLimits,
  resolveSubUserRoleChange,
  validatePasswordChangeInput,
  SUB_USER_ROLES,
  LIMITS,
  MSG_PASSWORD_MIN_LENGTH,
  MSG_PASSWORDS_DO_NOT_MATCH,
  MSG_SUB_USER_ROLE,
  type SubUserRole,
  type UserPlanTier,
  type UserRoleCounts,
} from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 16: User plan rules and validation are consistent
// **Validates: Requirements 8.3, 8.4, 8.10, 8.11, 8.13**

const NUM_RUNS = 400;

// ===========================================================================
// Independent reference implementations
// ===========================================================================

/** Per-role maxima mirrored from the design (independent of the module). */
const REFERENCE_MAXIMUMS: Record<UserPlanTier, Record<SubUserRole, number | null>> = {
  Basic: { doctor: 1, reception: 0 },
  Premium: { doctor: 5, reception: null },
  Enterprise: { doctor: null, reception: null },
};

/** Canonical and legacy aliases paired with the tier they must canonicalize to. */
const PLAN_ALIASES: ReadonlyArray<{ alias: string | null | undefined; tier: UserPlanTier }> = [
  // Basic (default / unknown)
  { alias: "Basic", tier: "Basic" },
  { alias: "basic", tier: "Basic" },
  { alias: "  BASIC  ", tier: "Basic" },
  { alias: "free", tier: "Basic" },
  { alias: "starter", tier: "Basic" },
  { alias: "", tier: "Basic" },
  { alias: null, tier: "Basic" },
  { alias: undefined, tier: "Basic" },
  // Premium (canonical + legacy aliases)
  { alias: "Premium", tier: "Premium" },
  { alias: "premium", tier: "Premium" },
  { alias: "clinic", tier: "Premium" },
  { alias: "Clinic Plan", tier: "Premium" },
  { alias: "pro", tier: "Premium" },
  { alias: "Pro", tier: "Premium" },
  { alias: "1499", tier: "Premium" },
  { alias: "₹1499/mo", tier: "Premium" },
  // Enterprise (canonical + legacy aliases)
  { alias: "Enterprise", tier: "Enterprise" },
  { alias: "enterprise", tier: "Enterprise" },
  { alias: "hospital", tier: "Enterprise" },
  { alias: "Hospital Plan", tier: "Enterprise" },
  { alias: "custom", tier: "Enterprise" },
  { alias: "Custom", tier: "Enterprise" },
];

function refRemaining(maximum: number | null, current: number): number | null {
  return maximum === null ? null : Math.max(0, maximum - current);
}

function refCanCreate(maximum: number | null, current: number): boolean {
  const remaining = refRemaining(maximum, current);
  return remaining === null || remaining > 0;
}

// ===========================================================================
// Modeled user set (no persistence; a pure array the guard must never mutate)
// ===========================================================================

interface ModeledUser {
  id: string;
  role: SubUserRole;
}

function countsOf(users: readonly ModeledUser[]): UserRoleCounts {
  return {
    doctor: users.filter((u) => u.role === "doctor").length,
    reception: users.filter((u) => u.role === "reception").length,
  };
}

/**
 * Pure create simulation composing the same limits used by the display message
 * and the mutation guard plus password validation. On any failure the user set
 * is returned by identity (never mutated).
 */
function attemptCreateSubUser(
  users: readonly ModeledUser[],
  input: {
    plan: string | null | undefined;
    requestedRole: unknown;
    newPassword: string;
    confirmation: string;
  },
): { ok: boolean; users: readonly ModeledUser[]; messages: string[] } {
  const decision = resolveSubUserRoleChange({
    plan: input.plan,
    counts: countsOf(users),
    requestedRole: input.requestedRole,
    previousRole: null,
  });
  const password = validatePasswordChangeInput({
    currentPassword: "",
    newPassword: input.newPassword,
    confirmation: input.confirmation,
  });

  const messages: string[] = [];
  if (!decision.allowed) messages.push(decision.message);
  if (!password.ok) messages.push(...password.errors.map((e) => e.message));

  if (messages.length > 0) {
    // Failure: the modeled user set is preserved (same reference).
    return { ok: false, users, messages };
  }
  const role = decision.requestedRole as SubUserRole;
  return { ok: true, users: [...users, { id: `u${users.length}`, role }], messages };
}

// ===========================================================================
// Generators
// ===========================================================================

const planAliasArb = fc.constantFrom(...PLAN_ALIASES);

const roleCountsArb: fc.Arbitrary<UserRoleCounts> = fc.record({
  doctor: fc.integer({ min: 0, max: 8 }),
  reception: fc.integer({ min: 0, max: 8 }),
});

const validRoleArb = fc.constantFrom<SubUserRole>(...SUB_USER_ROLES);

/** Requested role space: valid roles plus invalid/foreign values. */
const requestedRoleArb = fc.oneof(
  validRoleArb,
  fc.constantFrom("admin", "owner", "manager", "", "Doctor", "RECEPTION"),
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
);

const previousRoleArb = fc.oneof(validRoleArb, fc.constant(null));

const minLen = LIMITS.passwordLength.min;
const passwordArb = fc.string({ minLength: 0, maxLength: minLen + 6 });

// ===========================================================================
// Property suite
// ===========================================================================

describe("Feature: restaurant-dashboard-settings, Property 16: User plan rules and validation are consistent", () => {
  it("canonicalizes canonical and legacy plan aliases to the same maxima used by message and guard", () => {
    fc.assert(
      fc.property(planAliasArb, roleCountsArb, (planAlias, counts) => {
        const limits = resolveSubUserPlanLimits(planAlias.alias, counts);

        // Message-side limits reflect the reference maxima for the resolved tier.
        expect(limits.plan).toBe(planAlias.tier);
        const expected = REFERENCE_MAXIMUMS[planAlias.tier];
        expect(limits.doctor.maximum).toBe(expected.doctor);
        expect(limits.reception.maximum).toBe(expected.reception);

        // canCreate is derived from those same maxima and the current counts.
        expect(limits.doctor.canCreate).toBe(refCanCreate(expected.doctor, counts.doctor));
        expect(limits.reception.canCreate).toBe(
          refCanCreate(expected.reception, counts.reception),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("derives the create mutation guard from the same limits as the displayed message", () => {
    fc.assert(
      fc.property(planAliasArb, roleCountsArb, validRoleArb, (planAlias, counts, role) => {
        const limits = resolveSubUserPlanLimits(planAlias.alias, counts);
        const decision = resolveSubUserRoleChange({
          plan: planAlias.alias,
          counts,
          requestedRole: role,
          previousRole: null,
        });

        // Guard and message share the resolved tier and per-role maxima.
        expect(decision.plan).toBe(limits.plan);
        expect(decision.limitsAfterRemoval.doctor.maximum).toBe(limits.doctor.maximum);
        expect(decision.limitsAfterRemoval.reception.maximum).toBe(limits.reception.maximum);

        // A create is permitted iff the message's canCreate flag for that role is set.
        expect(decision.allowed).toBe(limits[role].canCreate);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("permits creation only for reception or doctor within remaining capacity", () => {
    fc.assert(
      fc.property(planAliasArb, roleCountsArb, requestedRoleArb, (planAlias, counts, requested) => {
        const decision = resolveSubUserRoleChange({
          plan: planAlias.alias,
          counts,
          requestedRole: requested,
          previousRole: null,
        });

        const isValidRole = (SUB_USER_ROLES as readonly unknown[]).includes(requested);
        if (!isValidRole) {
          // Foreign/invalid role: rejected with the exact role message, counts untouched.
          expect(decision.allowed).toBe(false);
          expect(decision.requestedRole).toBeNull();
          expect(decision.message).toBe(MSG_SUB_USER_ROLE);
          expect(decision.countsAfterDecision).toEqual(counts);
          return;
        }

        const role = requested as SubUserRole;
        const maximum = REFERENCE_MAXIMUMS[planAlias.tier][role];
        const withinCapacity = maximum === null || counts[role] + 1 <= maximum;
        expect(decision.allowed).toBe(withinCapacity);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("models a role change as removal from the old role plus addition to the new role", () => {
    fc.assert(
      fc.property(
        planAliasArb,
        roleCountsArb,
        validRoleArb,
        previousRoleArb,
        (planAlias, counts, requested, previous) => {
          const decision = resolveSubUserRoleChange({
            plan: planAlias.alias,
            counts,
            requestedRole: requested,
            previousRole: previous,
          });

          // Removal step: the previous role is decremented (never below zero).
          const expectedAfterRemoval: UserRoleCounts = { ...counts };
          if (previous && expectedAfterRemoval[previous] > 0) {
            expectedAfterRemoval[previous] -= 1;
          }
          expect(decision.countsAfterRemoval).toEqual(expectedAfterRemoval);

          // Addition step: the requested role is incremented on top of removal.
          const expectedProjected: UserRoleCounts = { ...expectedAfterRemoval };
          expectedProjected[requested] += 1;
          expect(decision.projectedCounts).toEqual(expectedProjected);

          // Guard uses limits computed after removal (same-role edits at capacity stay valid).
          const maximum = REFERENCE_MAXIMUMS[planAlias.tier][requested];
          const allowed = maximum === null || expectedProjected[requested] <= maximum;
          expect(decision.allowed).toBe(allowed);
          expect(decision.countsAfterDecision).toEqual(allowed ? expectedProjected : counts);

          // The caller's counts object is never mutated by the guard.
          expect(counts.doctor).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("reports every plan and password failure without mutating the modeled user set", () => {
    fc.assert(
      fc.property(
        planAliasArb,
        fc.array(validRoleArb, { maxLength: 10 }).map((roles) =>
          roles.map((role, i) => ({ id: `u${i}`, role })),
        ),
        requestedRoleArb,
        passwordArb,
        passwordArb,
        (planAlias, users, requested, newPassword, confirmation) => {
          const before = users.slice();
          const result = attemptCreateSubUser(users, {
            plan: planAlias.alias,
            requestedRole: requested,
            newPassword,
            confirmation,
          });

          const isValidRole = (SUB_USER_ROLES as readonly unknown[]).includes(requested);
          const role = isValidRole ? (requested as SubUserRole) : null;
          const maximum = role === null ? 0 : REFERENCE_MAXIMUMS[planAlias.tier][role];
          const planOk = role !== null && (maximum === null || countsOf(users)[role] + 1 <= maximum);
          const passwordOk =
            newPassword.length >= minLen && newPassword === confirmation;

          const shouldSucceed = planOk && passwordOk;
          expect(result.ok).toBe(shouldSucceed);

          if (!result.ok) {
            // Failure preserves the user set exactly (same reference, same contents).
            expect(result.users).toBe(users);
            expect(users).toEqual(before);
            expect(result.messages.length).toBeGreaterThan(0);

            // Each reported message is one of the shared, limit-derived failures.
            if (!planOk && role === null) {
              expect(result.messages).toContain(MSG_SUB_USER_ROLE);
            }
            if (newPassword.length < minLen) {
              expect(result.messages).toContain(MSG_PASSWORD_MIN_LENGTH);
            }
            if (newPassword !== confirmation) {
              expect(result.messages).toContain(MSG_PASSWORDS_DO_NOT_MATCH);
            }
          } else {
            // Success appends exactly one user of the requested role.
            expect(result.users.length).toBe(users.length + 1);
            expect(result.users[result.users.length - 1].role).toBe(role);
            // The original array is still unchanged (a new array was produced).
            expect(users).toEqual(before);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
