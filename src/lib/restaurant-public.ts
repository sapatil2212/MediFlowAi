import { randomUUID } from "node:crypto";

import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";

import { restaurantSettingsRepository } from "./restaurant-settings.server";
import { publicMenu, trimmedString, type MenuCategory } from "./restaurant-settings-model";

// ---------------------------------------------------------------------------
// Public restaurant menu projection
//
// The public booking page (`/book/{tenantId}`) renders the restaurant menu with
// no session. Unlike every other Settings surface, this read requires no
// authentication and no feature gate: it is the guest-facing consumer described
// by Requirements 6.9-6.11.
//
// This module is intentionally client-import-safe: it must never reach
// `auth.server` or any other server-only-cookie code so the booking route's
// client bundle stays free of server-only imports. It depends only on the
// repository (`./restaurant-settings.server`), the pure model helpers
// (`./restaurant-settings-model`), `@tanstack/react-start`, and `node:crypto`.
//
// The projection is always primary-scope (`locationId IS NULL`, Req 9.5): the
// public page addresses the owner's unscoped restaurant, never a branch. Row
// access returns categories whose only items are `available`, and the pure
// `publicMenu` projection re-applies canonical ordering and drops every empty
// category (Req 6.10, 11.4). An `unavailable` item is therefore never exposed
// (Req 6.9), and a tenant with no `available` item yields an empty array so the
// caller can omit the menu section entirely (Req 6.11).
//
// This read must never disturb availability or booking. Any read failure is
// logged with a correlation id and downgraded to the same empty informational
// projection, so a menu outage can never block a guest from booking a table.
// ---------------------------------------------------------------------------

export interface PublicRestaurantMenuDependencies {
  /** Primary-scope, available-only menu row access. */
  getPublicRestaurantMenu(tenantId: string): Promise<MenuCategory[]>;
  /** Records a read failure with a correlation id for later diagnosis. */
  logReadFailure(correlationId: string, tenantId: string, error: unknown): void;
  /** Supplies a fresh correlation id per failed read. */
  newCorrelationId(): string;
}

function logPublicMenuReadFailure(correlationId: string, tenantId: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(
    `[Restaurant] Public menu read failed [${correlationId}] for tenant ${tenantId}: ${detail}`,
  );
}

// Marked server-only so the repository (`./restaurant-settings.server` → `./db`
// → `dotenv`/`mariadb`) and `node:crypto` imports are stripped from the client
// bundle. The booking route imports this module for its server function, and
// every route module is reachable from the generated route tree, so a single
// Node-only import here would break hydration on every page.
const defaultPublicMenuDependencies = createServerOnlyFn(
  (): PublicRestaurantMenuDependencies => ({
    getPublicRestaurantMenu: (tenantId) =>
      restaurantSettingsRepository.getPublicRestaurantMenu(tenantId),
    logReadFailure: logPublicMenuReadFailure,
    newCorrelationId: () => randomUUID(),
  }),
);

/**
 * Builds the public menu reader around injectable I/O so the projection,
 * failure logging, and empty-fallback behavior can be tested without SQL.
 */
export function createPublicRestaurantMenuReader(
  overrides: Partial<PublicRestaurantMenuDependencies> = {},
) {
  const dependencies: PublicRestaurantMenuDependencies = {
    ...defaultPublicMenuDependencies(),
    ...overrides,
  };

  return {
    async read(tenantId: string): Promise<MenuCategory[]> {
      const trimmedTenantId = trimmedString(tenantId);
      // A blank tenant id can never resolve a menu; treat it as an empty
      // informational projection rather than a hard error.
      if (!trimmedTenantId) return [];
      try {
        const categories = await dependencies.getPublicRestaurantMenu(trimmedTenantId);
        // Re-apply the pure projection so ordering and empty-category dropping
        // hold regardless of how the rows were assembled (Req 6.10, 11.4).
        return publicMenu(categories);
      } catch (error) {
        // Never let a menu outage affect availability or booking (Req 6.11):
        // log with a correlation id and return the empty projection.
        dependencies.logReadFailure(dependencies.newCorrelationId(), trimmedTenantId, error);
        return [];
      }
    },
  };
}

let publicRestaurantMenuReaderInstance:
  | ReturnType<typeof createPublicRestaurantMenuReader>
  | undefined;
const publicRestaurantMenuReader = createServerOnlyFn(
  () => (publicRestaurantMenuReaderInstance ??= createPublicRestaurantMenuReader()),
);

/**
 * Default production entry point: returns the primary-scope public menu of one
 * restaurant tenant, or an empty array on failure or when no available item
 * exists.
 */
export function getPublicRestaurantMenu(tenantId: string): Promise<MenuCategory[]> {
  return publicRestaurantMenuReader().read(tenantId);
}

/**
 * Public, unauthenticated server function consumed by the restaurant booking
 * page. Returns `{ categories }` where an empty array instructs the caller to
 * omit the menu section (Req 6.9-6.11, 9.5, 11.4).
 */
export const getPublicRestaurantMenuServerFn = createServerFn({ method: "GET" })
  .validator((data: { tenantId: string }) => {
    const tenantId = trimmedString(data?.tenantId);
    if (!tenantId) throw new Error("Tenant ID is required");
    return { tenantId };
  })
  .handler(async ({ data }) => ({
    categories: await getPublicRestaurantMenu(data.tenantId),
  }));
