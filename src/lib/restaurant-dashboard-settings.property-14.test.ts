import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { AccountContext, FeatureAccess, FeatureId, ResolvedAccess } from "./feature-access";
import {
  authoriseSettingsFeatureWrite,
  MSG_NOT_AUTHORISED_CONFIG,
  MSG_NOT_AUTHORISED_LOCATIONS,
  MSG_NOT_AUTHORISED_USERS,
  MSG_NOT_AUTHORISED_WHATSAPP,
  type Permission,
  type SettingsFeature,
} from "./restaurant-settings-model";
import {
  createRestaurantSettingsFeatureGuards,
  RESTAURANT_SETTINGS_FEATURES,
  type AuthenticatedRestaurantSettingsContext,
} from "./restaurant-settings";

// ---------------------------------------------------------------------------
// Property 14 exercises the guarded settings write pipeline in isolation.
//
// Every governed feature write must reach its state-changing work closure
// (which stands in for a mutating repository or external microservice adapter)
// exactly when the resolved permission is `operate`. For `view_only` and `none`
// the wrapper must reject with the feature's authorization error BEFORE the
// mutating work runs, so no fake repository row and no fake adapter call is ever
// reached. The feature-access resolution and scope derivation are injected so
// the property depends on nothing but the resolved permission.
// ---------------------------------------------------------------------------

/** Every plan-gated feature id the resolver returns; each guard reads only its own. */
const ALL_FEATURE_IDS: readonly FeatureId[] = [
  "whatsapp",
  "analytics",
  "scribe",
  "users",
  "locations",
  "plans",
  "video",
  "restaurant_config",
  "restaurant_bookings",
];

/** The feature-specific authorization message a non-`operate` write must return. */
const EXPECTED_WRITE_ERROR: Record<SettingsFeature, string> = {
  restaurant_config: MSG_NOT_AUTHORISED_CONFIG,
  users: MSG_NOT_AUTHORISED_USERS,
  locations: MSG_NOT_AUTHORISED_LOCATIONS,
  whatsapp: MSG_NOT_AUTHORISED_WHATSAPP,
};

const PERMISSIONS: readonly Permission[] = ["operate", "view_only", "none"];

const featureArb = fc.constantFrom<SettingsFeature>(...RESTAURANT_SETTINGS_FEATURES);
const permissionArb = fc.constantFrom<Permission>(...PERMISSIONS);

/** Builds a full resolved-access record, then stamps the feature under test. */
function buildResolvedAccess(overrides: Partial<Record<FeatureId, FeatureAccess>>): ResolvedAccess {
  const access = {} as ResolvedAccess;
  for (const id of ALL_FEATURE_IDS) {
    access[id] = { available: true, permission: "none", visible: false };
  }
  for (const id of Object.keys(overrides) as FeatureId[]) {
    access[id] = { ...access[id], ...overrides[id]! };
  }
  return access;
}

/**
 * A fake authenticated context. Only the feature-under-test's resolved
 * permission (plus surrounding availability/visibility noise) varies; identity
 * and scope are fixed because the write guard depends on permission alone.
 */
function buildContext(
  feature: SettingsFeature,
  permission: Permission,
  available: boolean,
  visible: boolean,
): AuthenticatedRestaurantSettingsContext {
  const access = buildResolvedAccess({ [feature]: { available, permission, visible } });
  const featureContext: AccountContext = { role: "admin", isActive: true, now: new Date(0) };
  return {
    session: { id: "acct-1", tenantId: "tenant-1", role: "admin", isActive: true },
    accountId: "acct-1",
    tenantId: "tenant-1",
    role: "admin",
    featureContext,
    access,
    scope: { tenantId: "tenant-1", locationId: null },
  };
}

/** A mutating fake repository plus a state-changing external adapter spy. */
function makeFakeSideEffects() {
  const state = { rows: 0, adapterCalls: 0, lastPayload: null as string | null };
  return {
    state,
    // The work closure stands in for the guarded state-changing operation.
    work(context: AuthenticatedRestaurantSettingsContext, feature: SettingsFeature): string {
      // A real settings write would call the repository and/or microservice here.
      state.adapterCalls += 1;
      state.rows += 1;
      state.lastPayload = `${feature}:${context.tenantId}`;
      return state.lastPayload;
    },
  };
}

// Feature: restaurant-dashboard-settings, Property 14: Feature writes require operate permission
// **Validates: Requirements 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10**
describe("Property 14: Feature writes require operate permission", () => {
  it("reaches the state-changing work iff permission is operate, else returns the feature error", async () => {
    await fc.assert(
      fc.asyncProperty(
        featureArb,
        permissionArb,
        fc.boolean(),
        fc.boolean(),
        async (feature, permission, available, visible) => {
          const context = buildContext(feature, permission, available, visible);
          const guards = createRestaurantSettingsFeatureGuards({
            resolveContext: async () => context,
          });
          const effects = makeFakeSideEffects();

          if (permission === "operate") {
            // Operate: the mutating work closure/adapter is reached exactly once.
            const result = await guards.write(feature, {}, (ctx) => effects.work(ctx, feature));
            expect(result).toBe(`${feature}:tenant-1`);
            expect(effects.state.adapterCalls).toBe(1);
            expect(effects.state.rows).toBe(1);
            expect(effects.state.lastPayload).toBe(`${feature}:tenant-1`);
          } else {
            // Non-operate: rejected with the feature error before any mutation.
            await expect(
              guards.write(feature, {}, (ctx) => effects.work(ctx, feature)),
            ).rejects.toThrow(EXPECTED_WRITE_ERROR[feature]);
            // The state-changing work never ran: no fake row, no adapter call.
            expect(effects.state.adapterCalls).toBe(0);
            expect(effects.state.rows).toBe(0);
            expect(effects.state.lastPayload).toBeNull();
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("returns each governed feature's own distinct authorization error for non-operate writes", async () => {
    await fc.assert(
      fc.asyncProperty(
        featureArb,
        fc.constantFrom<Permission>("view_only", "none"),
        async (feature, permission) => {
          const context = buildContext(feature, permission, true, permission !== "none");
          const guards = createRestaurantSettingsFeatureGuards({
            resolveContext: async () => context,
          });
          const effects = makeFakeSideEffects();

          await expect(
            guards.write(feature, {}, (ctx) => effects.work(ctx, feature)),
          ).rejects.toThrow(EXPECTED_WRITE_ERROR[feature]);
          expect(effects.state.rows).toBe(0);
          expect(effects.state.adapterCalls).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("agrees with the pure write guard decision for every feature and permission", () => {
    fc.assert(
      fc.property(featureArb, permissionArb, (feature, permission) => {
        const decision = authoriseSettingsFeatureWrite(feature, permission);
        if (permission === "operate") {
          expect(decision.ok).toBe(true);
        } else {
          expect(decision.ok).toBe(false);
          if (decision.ok) return;
          expect(decision.errors[0]?.field).toBe(feature);
          expect(decision.errors[0]?.message).toBe(EXPECTED_WRITE_ERROR[feature]);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("treats a missing or malformed resolved permission as a refused write", async () => {
    await fc.assert(
      fc.asyncProperty(
        featureArb,
        fc.constantFrom<Permission | null | undefined>(null, undefined),
        async (feature, permission) => {
          const context = buildContext(feature, "none", false, false);
          // Force the feature entry to carry no usable permission at all.
          (context.access as ResolvedAccess)[feature] = {
            available: false,
            permission: permission as unknown as Permission,
            visible: false,
          };
          const guards = createRestaurantSettingsFeatureGuards({
            resolveContext: async () => context,
          });
          const effects = makeFakeSideEffects();

          await expect(
            guards.write(feature, {}, (ctx) => effects.work(ctx, feature)),
          ).rejects.toThrow(EXPECTED_WRITE_ERROR[feature]);
          expect(effects.state.rows).toBe(0);
          expect(effects.state.adapterCalls).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
