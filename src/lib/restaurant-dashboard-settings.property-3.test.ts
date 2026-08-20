import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ResolvedAccess } from "./feature-access";
import {
  createRestaurantProfileService,
  type AuthenticatedRestaurantSettingsContext,
} from "./restaurant-settings";
import type {
  AccountType,
  Permission,
  RestaurantProfile,
  RestaurantProfileInput,
} from "./restaurant-settings-model";
import type {
  AccountSecuritySnapshot,
  StoredRestaurantProfile,
} from "./restaurant-settings.server";

/**
 * The eleven trimmed tenant-profile fields (design: Pure settings model,
 * RestaurantProfile). Save normalizes each field with `trimmedString`, so the
 * round-trip invariant is that every stored/returned field equals its
 * submitted value after trimming (Req 2.7, 11.1) and that persisting the same
 * submission again leaves the stored state byte-identical (Req 11.2).
 */
const PROFILE_FIELDS = [
  "restaurantName",
  "ownerOrManagerName",
  "accountPhone",
  "teamSize",
  "publicEmail",
  "contactNumber",
  "whatsappNumber",
  "landline",
  "address",
  "cuisineOrServices",
  "description",
] as const satisfies readonly (keyof RestaurantProfile)[];

const TENANT_ID = "tenant-round-trip";
const ACCOUNT_ID = "account-owner";

/** Whitespace an operator might type around a field before submitting. */
const whitespace = fc.string({
  unit: fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"),
  maxLength: 4,
});

/** A submitted field string that may carry arbitrary surrounding whitespace. */
const fieldValue = fc
  .tuple(whitespace, fc.string({ maxLength: 40 }), whitespace)
  .map(([lead, body, trail]) => `${lead}${body}${trail}`);

/** A full submission for all eleven profile fields. */
const profileInputArbitrary: fc.Arbitrary<RestaurantProfileInput> = fc.record(
  Object.fromEntries(PROFILE_FIELDS.map((field) => [field, fieldValue])) as Record<
    keyof RestaurantProfile,
    fc.Arbitrary<string>
  >,
) as fc.Arbitrary<RestaurantProfileInput>;

/** Access map that resolves `restaurant_config: operate` so save is authorised. */
function operateAccess(): ResolvedAccess {
  const operate = { available: true, permission: "operate" as Permission, visible: true };
  return {
    restaurant_config: operate,
    users: operate,
    locations: operate,
    whatsapp: operate,
  } as unknown as ResolvedAccess;
}

/**
 * A minimal in-memory profile repository model behind the injectable profile
 * service. It stores exactly the (already-trimmed) profile the service hands
 * it, keyed by tenant, using one stable synthetic id.
 */
function createInMemoryProfileModel() {
  const rows = new Map<string, StoredRestaurantProfile>();
  const security: AccountSecuritySnapshot = {
    accountType: "user" as AccountType,
    accountId: ACCOUNT_ID,
    tenantId: TENANT_ID,
    email: "owner@example.com",
    passwordHash: "hash",
    profilePhoto: null,
  };

  const context: AuthenticatedRestaurantSettingsContext = {
    session: { id: ACCOUNT_ID, tenantId: TENANT_ID, role: "admin", isActive: true },
    accountId: ACCOUNT_ID,
    tenantId: TENANT_ID,
    role: "admin",
    featureContext: {
      role: "admin",
      isActive: true,
      now: new Date(0),
    } as AuthenticatedRestaurantSettingsContext["featureContext"],
    access: operateAccess(),
    scope: { tenantId: TENANT_ID, locationId: null },
  };

  const service = createRestaurantProfileService({
    resolveContext: async () => context,
    getTenantProfile: async (tenantId) => rows.get(tenantId) ?? null,
    getAccountSecurity: async () => security,
    saveProfile: async (tenantId, profile) => {
      const stored: StoredRestaurantProfile = {
        id: `${tenantId}-profile`,
        tenantId,
        ...profile,
      };
      rows.set(tenantId, stored);
      return stored;
    },
  });

  return { rows, service };
}

// Feature: restaurant-dashboard-settings, Property 3: Profile normalization round trip
// **Validates: Requirements 2.7, 11.1, 11.2**
describe("Property 3: Profile normalization round trip", () => {
  it("save-then-read returns every field trimmed and repeated saves are idempotent", async () => {
    await fc.assert(
      fc.asyncProperty(profileInputArbitrary, async (input) => {
        const { rows, service } = createInMemoryProfileModel();

        const expected: RestaurantProfile = Object.fromEntries(
          PROFILE_FIELDS.map((field) => [field, String(input[field]).trim()]),
        ) as unknown as RestaurantProfile;

        // Save trims and persists; the returned view exposes trimmed fields.
        const savedView = await service.save({ profile: input });
        for (const field of PROFILE_FIELDS) {
          expect(savedView.profile[field]).toBe(expected[field]);
        }

        // A subsequent read observes the identical trimmed state.
        const readView = await service.read({});
        for (const field of PROFILE_FIELDS) {
          expect(readView.profile[field]).toBe(expected[field]);
        }

        // Snapshot the stored state after the first save.
        const afterFirstSave = structuredClone(rows.get(TENANT_ID));

        // Persisting the same submission again must not change stored state.
        const resavedView = await service.save({ profile: input });
        for (const field of PROFILE_FIELDS) {
          expect(resavedView.profile[field]).toBe(expected[field]);
        }
        expect(rows.get(TENANT_ID)).toEqual(afterFirstSave);
      }),
      { numRuns: 400 },
    );
  });
});
