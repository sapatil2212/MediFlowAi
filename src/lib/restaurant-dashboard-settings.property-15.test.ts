import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  filterRestaurantResourcesToScope,
  isRestaurantResourceInScope,
  resolveRestaurantResourceScope,
  MSG_BRANCH_SCOPE_OVERRIDE,
  MSG_BRANCH_SCOPE_REQUIRED,
  MSG_BRANCH_SELECTION_NOT_ALLOWED,
  MSG_BRANCH_NOT_FOUND,
  MSG_SETTINGS_RESOURCE_NOT_FOUND,
  type LocationScope,
  type RestaurantResourceScope,
  type RestaurantScopeBranch,
  type RestaurantSettingsAccountRole,
  type TenantLocationRow,
} from "./restaurant-settings-model";

// A resource row modelling any scoped area/table/menu/closure record. It carries
// both a tenant owner and a nullable branch scope exactly like the persisted rows.
interface ResourceRow extends TenantLocationRow {
  id: string;
  kind: "area" | "table" | "menuCategory" | "menuItem" | "closure";
}

const TENANTS = ["tenant-a", "tenant-b", "tenant-c"] as const;
const BRANCHES = ["branch-1", "branch-2", "branch-3", "branch-4"] as const;
const RESOURCE_KINDS = ["area", "table", "menuCategory", "menuItem", "closure"] as const;
const STAFF_ROLES: readonly RestaurantSettingsAccountRole[] = ["reception", "doctor"];

const tenantIdArb = fc.constantFrom(...TENANTS);
const locationScopeArb: fc.Arbitrary<LocationScope> = fc.oneof(
  fc.constant<LocationScope>(null),
  fc.constantFrom(...BRANCHES),
);

const resourceRowArb: fc.Arbitrary<ResourceRow> = fc.record({
  id: fc.uuid(),
  tenantId: tenantIdArb,
  locationId: locationScopeArb,
  kind: fc.constantFrom(...RESOURCE_KINDS),
});

// A mixed-tenant, mixed-location collection covering every resource kind.
const resourceCollectionArb = fc.array(resourceRowArb, { minLength: 0, maxLength: 40 });

// A tenant-validated branch list an owner may legitimately select from.
function branchesForTenant(tenantId: string, ids: readonly string[]): RestaurantScopeBranch[] {
  return ids.map((id, index) => ({ id, tenantId, isActive: index % 2 === 0 }));
}

function assertScopeIsolation(
  scope: RestaurantResourceScope,
  callerTenant: string,
  effectiveLocation: LocationScope,
  rows: readonly ResourceRow[],
): void {
  // The server-derived scope is always the caller tenant plus the effective location.
  expect(scope.tenantId).toBe(callerTenant);
  expect(scope.locationId).toBe(effectiveLocation);

  const visible = filterRestaurantResourcesToScope(scope, rows);

  for (const row of visible) {
    // Every readable/writable row is the caller tenant and effective location only.
    expect(row.tenantId).toBe(callerTenant);
    expect(row.locationId).toBe(effectiveLocation);
    expect(isRestaurantResourceInScope(scope, row)).toBe(true);
  }

  // No foreign-tenant row survives: foreign ids resolve as not found.
  expect(visible.some((row) => row.tenantId !== callerTenant)).toBe(false);
  // No other-location row survives, including primary vs branch mismatches.
  expect(visible.some((row) => row.locationId !== effectiveLocation)).toBe(false);

  // The filter is exactly the null-safe predicate; nothing in scope is dropped.
  const expected = rows.filter(
    (row) => row.tenantId === callerTenant && row.locationId === effectiveLocation,
  );
  expect(visible).toEqual(expected);
  expect(visible).toHaveLength(expected.length);
}

// Feature: restaurant-dashboard-settings, Property 15: Tenant and location isolation
// **Validates: Requirements 9.3, 9.4, 9.5, 9.7, 10.11, 10.12**
describe("Property 15: Tenant and location isolation", () => {
  it("confines owner primary scope (no branch selection) to the caller tenant and null location", () => {
    fc.assert(
      fc.property(tenantIdArb, resourceCollectionArb, (tenantId, rows) => {
        const result = resolveRestaurantResourceScope({
          tenantId,
          role: "admin",
          requestedLocationId: null,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Owner with no selection sees only primary (null) scope.
        assertScopeIsolation(result.value, tenantId, null, rows);
      }),
      { numRuns: 300 },
    );
  });

  it("confines a validated owner branch selection to exactly that branch", () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.constantFrom(...BRANCHES),
        fc.subarray([...BRANCHES], { minLength: 1 }),
        resourceCollectionArb,
        (tenantId, requested, availableBranchIds, rows) => {
          const branchIds = Array.from(new Set([requested, ...availableBranchIds]));
          const branches = branchesForTenant(tenantId, branchIds);
          const result = resolveRestaurantResourceScope({
            tenantId,
            role: "admin",
            requestedLocationId: requested,
            branches,
          });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          // Owner branch selection sees only that validated branch.
          assertScopeIsolation(result.value, tenantId, requested, rows);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("rejects an owner branch selection that is unknown or belongs to another tenant", () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.constantFrom(...BRANCHES),
        fc.subarray([...TENANTS]),
        (tenantId, requested, otherTenants) => {
          // Branches exist only for a different tenant, so the id never validates.
          const foreignTenants = otherTenants.filter((candidate) => candidate !== tenantId);
          const branches = foreignTenants.flatMap((foreign) =>
            branchesForTenant(foreign, [requested]),
          );
          const result = resolveRestaurantResourceScope({
            tenantId,
            role: "admin",
            requestedLocationId: requested,
            branches,
          });
          // A foreign/unknown branch id resolves as not found.
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.errors[0]?.message).toBe(MSG_BRANCH_NOT_FOUND);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("forces a branch account to its session location and blocks spoofed override ids", () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.constantFrom(...BRANCHES),
        locationScopeArb,
        resourceCollectionArb,
        (tenantId, sessionLocationId, spoofedClientBranchId, rows) => {
          const result = resolveRestaurantResourceScope({
            tenantId,
            role: "location",
            sessionLocationId,
            requestedLocationId: spoofedClientBranchId,
          });

          if (spoofedClientBranchId === null || spoofedClientBranchId === sessionLocationId) {
            // A matching or absent client scope resolves to the server session branch.
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            assertScopeIsolation(result.value, tenantId, sessionLocationId, rows);
          } else {
            // A branch account can never override its session location.
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.errors[0]?.message).toBe(MSG_BRANCH_SCOPE_OVERRIDE);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("rejects a branch account with no server-issued location", () => {
    fc.assert(
      fc.property(tenantIdArb, locationScopeArb, (tenantId, requestedLocationId) => {
        const result = resolveRestaurantResourceScope({
          tenantId,
          role: "location",
          sessionLocationId: null,
          requestedLocationId,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors[0]?.message).toBe(MSG_BRANCH_SCOPE_REQUIRED);
      }),
      { numRuns: 100 },
    );
  });

  it("confines reception/doctor to primary scope and forbids branch selection", () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.constantFrom(...STAFF_ROLES),
        locationScopeArb,
        resourceCollectionArb,
        (tenantId, role, requestedLocationId, rows) => {
          const result = resolveRestaurantResourceScope({
            tenantId,
            role,
            requestedLocationId,
          });

          if (requestedLocationId === null) {
            // Staff resolve to primary (null) scope.
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            assertScopeIsolation(result.value, tenantId, null, rows);
          } else {
            // Staff cannot select a branch.
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.errors[0]?.message).toBe(MSG_BRANCH_SELECTION_NOT_ALLOWED);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never reads or writes across tenants for any resolvable role and scope", () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.constantFrom<RestaurantSettingsAccountRole>("admin", "reception", "doctor", "location"),
        locationScopeArb,
        locationScopeArb,
        resourceCollectionArb,
        (tenantId, role, sessionLocationId, requestedLocationId, rows) => {
          // Owners can select a branch only if it validates against the tenant list.
          const branches =
            role === "admin" && requestedLocationId !== null
              ? branchesForTenant(tenantId, [requestedLocationId])
              : undefined;
          const result = resolveRestaurantResourceScope({
            tenantId,
            role,
            sessionLocationId: role === "location" ? sessionLocationId : undefined,
            requestedLocationId,
            branches,
          });

          if (!result.ok) {
            expect(result.errors[0]?.message).toBeTypeOf("string");
            return;
          }

          const scope = result.value;
          // Whatever scope resolves, it is always the caller tenant.
          expect(scope.tenantId).toBe(tenantId);
          const visible = filterRestaurantResourcesToScope(scope, rows);
          for (const row of visible) {
            expect(row.tenantId).toBe(tenantId);
            expect(row.locationId).toBe(scope.locationId);
          }
          // A row from any other tenant is always excluded.
          const foreignRows = rows.filter((row) => row.tenantId !== tenantId);
          for (const foreign of foreignRows) {
            expect(isRestaurantResourceInScope(scope, foreign)).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("treats an empty caller tenant as not found before any row access", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RestaurantSettingsAccountRole>("admin", "reception", "doctor", "location"),
        (role) => {
          const result = resolveRestaurantResourceScope({ tenantId: "   ", role });
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.errors[0]?.message).toBe(MSG_SETTINGS_RESOURCE_NOT_FOUND);
        },
      ),
      { numRuns: 100 },
    );
  });
});
