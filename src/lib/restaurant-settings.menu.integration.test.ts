/**
 * restaurant-settings.menu.integration.test.ts
 *
 * Menu dashboard + public projection integration suite (spec
 * `.kiro/specs/restaurant-dashboard-settings`, task 8.7, Req 6.1-6.14, 9.3-9.7,
 * 10.3, 10.4, 10.11, 10.12, 11.1, 11.4).
 *
 * This suite wires the REAL guarded menu service (`createRestaurantMenuService`,
 * task 8.1) and the REAL public menu reader (`createPublicRestaurantMenuReader`,
 * task 8.3) to ONE stateful, in-memory store that faithfully mirrors the scoped
 * MariaDB menu repository (`restaurant-settings.server.ts`): tenant-first,
 * null-safe location scoping (`locationId <=> ?`), tenant-wide case-insensitive
 * category-name uniqueness (`uq_menu_category_name (tenantId, name)`),
 * tenant-wide category/item caps, transactional cascade deletion, and an
 * available-only primary-scope public read.
 *
 * No database, cookie, or network is touched. Authorization is exercised through
 * real `resolveFeatureAccess` results so `operate` / `view_only` / `none` behave
 * exactly as production. The store also carries unrelated availability/booking
 * state that no menu repository method can reach, so the suite can prove menu
 * operations never rewrite booking controls (Req 11.4-adjacent, task 8.7).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFeatureAccess, type AccountContext } from "./feature-access";
import {
  createPublicRestaurantMenuReader,
} from "./restaurant-public";
import {
  createRestaurantMenuService,
  type AuthenticatedRestaurantSettingsContext,
} from "./restaurant-settings";
import {
  LIMITS,
  MSG_MAX_MENU_CATEGORIES,
  MSG_MAX_MENU_ITEMS,
  MSG_MENU_CATEGORY_ALREADY_EXISTS,
  MSG_MENU_CATEGORY_REFERENCE,
  MSG_SETTINGS_RESOURCE_NOT_FOUND,
  publicMenu,
  type MenuCategory,
  type MenuItem,
  type MenuItemState,
  type NormalisedMenuCategory,
  type NormalisedMenuItem,
  type RestaurantResourceScope,
  type RestaurantSettingsAccountRole,
} from "./restaurant-settings-model";
import type {
  DeleteMenuCategoryResult,
  DeleteMenuItemResult,
  PreviewMenuCategoryDeletionResult,
  SaveMenuCategoryResult,
  SaveMenuItemResult,
} from "./restaurant-settings.server";

const BASE_NOW = Date.UTC(2026, 3, 1, 0, 0, 0);

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const BRANCH_A = "branch-a-1";

// ---------------------------------------------------------------------------
// Faithful in-memory menu store
// ---------------------------------------------------------------------------

interface CategoryRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  name: string;
  displayOrder: number;
}

interface ItemRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  categoryId: string;
  name: string;
  priceMinor: number;
  description: string;
  displayOrder: number;
  state: MenuItemState;
}

interface StoreSeed {
  categories?: CategoryRow[];
  items?: ItemRow[];
}

/** Null-safe tenant+location scope match, mirroring `tenantId = ? AND locationId <=> ?`. */
function inScope(row: { tenantId: string; locationId: string | null }, scope: RestaurantResourceScope): boolean {
  return row.tenantId === scope.tenantId && row.locationId === scope.locationId;
}

/**
 * One stateful store standing in for every scoped menu repository method plus
 * the primary-scope public read. Caps and uniqueness are tenant-wide (across all
 * locations) exactly like the SQL COUNT/unique key; every mutation is scoped.
 */
function createMenuStore(seed: StoreSeed = {}) {
  const categories: CategoryRow[] = (seed.categories ?? []).map((c) => ({ ...c }));
  const items: ItemRow[] = (seed.items ?? []).map((i) => ({ ...i }));
  let idCounter = 0;
  const newId = (prefix: string) => `${prefix}-${idCounter++}`;

  // Unrelated availability/booking state. NO menu repository method may read or
  // write this, so a byte-equal snapshot before/after proves non-interference.
  const bookingControls = {
    slotInterval: 30,
    turnTime: 90,
    maxPartySize: 12,
    acceptOnlineBookings: true,
  };
  const bookings = [
    { id: "bk-1", tableId: "t-1", status: "confirmed", partySize: 4, date: "2026-04-10" },
    { id: "bk-2", tableId: "t-2", status: "seated", partySize: 2, date: "2026-04-10" },
  ];

  const nameKey = (name: string) => name.trim().toLowerCase();

  function duplicateTenantWide(tenantId: string, name: string, excludeId: string | null): boolean {
    const key = nameKey(name);
    return categories.some((c) => c.tenantId === tenantId && c.id !== excludeId && nameKey(c.name) === key);
  }

  return {
    // ---- inspection helpers -------------------------------------------------
    snapshotUnrelated() {
      return JSON.stringify({ bookingControls, bookings });
    },
    categoryRows(): CategoryRow[] {
      return categories.map((c) => ({ ...c }));
    },
    itemRows(): ItemRow[] {
      return items.map((i) => ({ ...i }));
    },
    tenantCategoryCount(tenantId: string): number {
      return categories.filter((c) => c.tenantId === tenantId).length;
    },
    tenantItemCount(tenantId: string): number {
      return items.filter((i) => i.tenantId === tenantId).length;
    },

    // ---- guarded menu service dependencies ---------------------------------
    menuDeps: {
      listMenu: async (scope: RestaurantResourceScope): Promise<MenuCategory[]> =>
        categories
          .filter((c) => inScope(c, scope))
          .map<MenuCategory>((c) => ({
            id: c.id,
            name: c.name,
            displayOrder: c.displayOrder,
            locationId: c.locationId,
            items: items
              .filter((i) => inScope(i, scope) && i.categoryId === c.id)
              .map<MenuItem>((i) => ({ ...i })),
          })),

      saveMenuCategory: async (
        scope: RestaurantResourceScope,
        input: NormalisedMenuCategory,
        categoryId?: string,
      ): Promise<SaveMenuCategoryResult> => {
        if (categoryId) {
          const existing = categories.find((c) => inScope(c, scope) && c.id === categoryId);
          if (!existing) return { status: "not_found" };
          if (duplicateTenantWide(scope.tenantId, input.name, categoryId)) {
            return { status: "duplicate" };
          }
          existing.name = input.name;
          existing.displayOrder = input.displayOrder;
          return {
            status: "saved",
            category: { id: existing.id, name: existing.name, displayOrder: existing.displayOrder, items: [], locationId: existing.locationId },
          };
        }
        // Create: tenant-wide cap is checked before insert (cap wins over dup).
        if (categories.filter((c) => c.tenantId === scope.tenantId).length >= LIMITS.menuCategoriesPerTenant) {
          return { status: "category_limit" };
        }
        if (duplicateTenantWide(scope.tenantId, input.name, null)) return { status: "duplicate" };
        const row: CategoryRow = {
          id: newId("category"),
          tenantId: scope.tenantId,
          locationId: scope.locationId,
          name: input.name,
          displayOrder: input.displayOrder,
        };
        categories.push(row);
        return {
          status: "saved",
          category: { id: row.id, name: row.name, displayOrder: row.displayOrder, items: [], locationId: row.locationId },
        };
      },

      saveMenuItem: async (
        scope: RestaurantResourceScope,
        input: NormalisedMenuItem,
        itemId?: string,
      ): Promise<SaveMenuItemResult> => {
        // The chosen category must resolve under the same scope (Req 6.3, 10.11).
        const category = categories.find((c) => inScope(c, scope) && c.id === input.categoryId);
        if (!category) return { status: "category_not_found" };
        if (itemId) {
          const existing = items.find((i) => inScope(i, scope) && i.id === itemId);
          if (!existing) return { status: "not_found" };
          existing.categoryId = input.categoryId;
          existing.name = input.name;
          existing.priceMinor = input.priceMinor;
          existing.description = input.description;
          existing.displayOrder = input.displayOrder;
          existing.state = input.state;
          return { status: "saved", item: { ...existing } };
        }
        if (items.filter((i) => i.tenantId === scope.tenantId).length >= LIMITS.menuItemsPerTenant) {
          return { status: "item_limit" };
        }
        const row: ItemRow = {
          id: newId("item"),
          tenantId: scope.tenantId,
          locationId: scope.locationId,
          categoryId: input.categoryId,
          name: input.name,
          priceMinor: input.priceMinor,
          description: input.description,
          displayOrder: input.displayOrder,
          state: input.state,
        };
        items.push(row);
        return { status: "saved", item: { ...row } };
      },

      updateMenuItemState: async (
        scope: RestaurantResourceScope,
        itemId: string,
        state: MenuItemState,
      ): Promise<SaveMenuItemResult> => {
        const existing = items.find((i) => inScope(i, scope) && i.id === itemId);
        if (!existing) return { status: "not_found" };
        existing.state = state;
        return { status: "saved", item: { ...existing } };
      },

      deleteMenuItem: async (scope: RestaurantResourceScope, itemId: string): Promise<DeleteMenuItemResult> => {
        const idx = items.findIndex((i) => inScope(i, scope) && i.id === itemId);
        if (idx === -1) return { status: "not_found" };
        items.splice(idx, 1);
        return { status: "deleted" };
      },

      previewMenuCategoryDeletion: async (
        scope: RestaurantResourceScope,
        categoryId: string,
      ): Promise<PreviewMenuCategoryDeletionResult> => {
        const category = categories.find((c) => inScope(c, scope) && c.id === categoryId);
        if (!category) return { status: "not_found" };
        const itemCount = items.filter((i) => inScope(i, scope) && i.categoryId === categoryId).length;
        return { status: "preview", categoryId, itemCount, confirmationRequired: itemCount > 0 };
      },

      confirmDeleteMenuCategory: async (
        scope: RestaurantResourceScope,
        categoryId: string,
      ): Promise<DeleteMenuCategoryResult> => {
        const cIdx = categories.findIndex((c) => inScope(c, scope) && c.id === categoryId);
        if (cIdx === -1) return { status: "not_found" };
        // Transactional cascade: remove the category and every item it holds.
        const kept = items.filter((i) => !(inScope(i, scope) && i.categoryId === categoryId));
        const deletedItemCount = items.length - kept.length;
        items.length = 0;
        items.push(...kept);
        categories.splice(cIdx, 1);
        return { status: "deleted", deletedItemCount };
      },
    },

    // ---- public reader dependency ------------------------------------------
    getPublicRestaurantMenu: async (tenantId: string): Promise<MenuCategory[]> => {
      const scope: RestaurantResourceScope = { tenantId, locationId: null };
      return categories
        .filter((c) => inScope(c, scope))
        .map<MenuCategory>((c) => ({
          id: c.id,
          name: c.name,
          displayOrder: c.displayOrder,
          locationId: c.locationId,
          items: items
            .filter((i) => inScope(i, scope) && i.categoryId === c.id && i.state === "available")
            .map<MenuItem>((i) => ({ ...i })),
        }))
        .filter((c) => c.items.length > 0);
    },
  };
}

type MenuStore = ReturnType<typeof createMenuStore>;

// ---------------------------------------------------------------------------
// Context + service wiring
// ---------------------------------------------------------------------------

function contextFor(opts: {
  role: RestaurantSettingsAccountRole;
  tenantId: string;
  accountId: string;
  locationId: string | null;
}): AuthenticatedRestaurantSettingsContext {
  const accountContext: AccountContext = {
    role: opts.role,
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    isActive: true,
    now: new Date(BASE_NOW),
  };
  return {
    session: { id: opts.accountId, tenantId: opts.tenantId, role: opts.role },
    accountId: opts.accountId,
    tenantId: opts.tenantId,
    role: opts.role,
    featureContext: accountContext,
    access: resolveFeatureAccess(accountContext),
    scope: { tenantId: opts.tenantId, locationId: opts.locationId },
  };
}

/** Owner (admin) operating the tenant's primary, unscoped restaurant. */
function ownerPrimary(tenantId = TENANT_A): AuthenticatedRestaurantSettingsContext {
  return contextFor({ role: "admin", tenantId, accountId: `owner-${tenantId}`, locationId: null });
}

/** Branch account (location role) forced to its own branch scope. */
function branchAccount(tenantId = TENANT_A, locationId = BRANCH_A): AuthenticatedRestaurantSettingsContext {
  return contextFor({ role: "location", tenantId, accountId: locationId, locationId });
}

function menuServiceFor(store: MenuStore, context: AuthenticatedRestaurantSettingsContext) {
  return createRestaurantMenuService({ resolveContext: async () => context, ...store.menuDeps });
}

// A menu item submission with every required field.
function itemInput(categoryId: string, overrides: Partial<{ name: string; priceMinor: number; description: string; displayOrder: number; state: MenuItemState }> = {}) {
  return {
    categoryId,
    name: overrides.name ?? "Dish",
    priceMinor: overrides.priceMinor ?? 1200,
    description: overrides.description,
    displayOrder: overrides.displayOrder,
    state: overrides.state,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Category & item CRUD (Req 6.1-6.4)
// ===========================================================================

describe("category and item CRUD (Req 6.1-6.4)", () => {
  it("creates, edits, and reads back a category with defaults applied", async () => {
    const store = createMenuStore();
    const service = menuServiceFor(store, ownerPrimary());

    const created = await service.saveCategory({ name: "  Starters  " });
    expect(created.status).toBe("saved");
    const categoryId = created.status === "saved" ? created.category.id : "";
    // Trimmed name and default display order 1.
    expect(created.status === "saved" && created.category.name).toBe("Starters");
    expect(created.status === "saved" && created.category.displayOrder).toBe(1);

    const edited = await service.saveCategory({ categoryId, name: "Appetizers", displayOrder: 3 });
    expect(edited.status).toBe("saved");

    const view = await service.list();
    expect(view.canManage).toBe(true);
    expect(view.readOnly).toBe(false);
    expect(view.categories).toHaveLength(1);
    expect(view.categories[0]).toMatchObject({ id: categoryId, name: "Appetizers", displayOrder: 3 });
  });

  it("creates, edits, toggles, and deletes an item under a category", async () => {
    const store = createMenuStore();
    const service = menuServiceFor(store, ownerPrimary());
    const category = await service.saveCategory({ name: "Mains" });
    const categoryId = category.status === "saved" ? category.category.id : "";

    const created = await service.saveItem(itemInput(categoryId, { name: "  Burger ", priceMinor: 1500, description: "  Beef  " }));
    expect(created.status).toBe("saved");
    const itemId = created.status === "saved" ? created.item.id : "";
    // Trimmed fields and default available state.
    expect(created.status === "saved" && created.item).toMatchObject({ name: "Burger", priceMinor: 1500, description: "Beef", state: "available" });

    const edited = await service.saveItem({ itemId, ...itemInput(categoryId, { name: "Cheeseburger", priceMinor: 1700 }) });
    expect(edited.status === "saved" && edited.item).toMatchObject({ name: "Cheeseburger", priceMinor: 1700 });

    const toggled = await service.setItemState({ itemId, state: "unavailable" });
    expect(toggled.status === "saved" && toggled.item.state).toBe("unavailable");

    const removed = await service.removeItem({ itemId });
    expect(removed.status).toBe("deleted");

    const view = await service.list();
    expect(view.categories[0].items).toHaveLength(0);
  });

  it("rejects an item pointing at a category outside the resolved scope (Req 6.3, 10.11)", async () => {
    const store = createMenuStore();
    const service = menuServiceFor(store, ownerPrimary());
    await service.saveCategory({ name: "Mains" });

    const result = await service.saveItem(itemInput("no-such-category", { name: "Ghost" }));
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.errors[0]).toMatchObject({ field: "categoryId", message: MSG_MENU_CATEGORY_REFERENCE });
    expect(store.tenantItemCount(TENANT_A)).toBe(0);
  });

  it("rejects a case-insensitive duplicate category name and preserves rows (Req 6.5, 11.1)", async () => {
    const store = createMenuStore();
    const service = menuServiceFor(store, ownerPrimary());
    await service.saveCategory({ name: "Desserts" });

    const dup = await service.saveCategory({ name: "  desserts " });
    // The pure validator catches the same-scope duplicate up front.
    expect(dup.status).toBe("invalid");
    expect(store.tenantCategoryCount(TENANT_A)).toBe(1);
  });

  it("maps a tenant-wide stored duplicate racing the write to the already-exists message", async () => {
    // A same-named category exists in a DIFFERENT location, so the primary-scope
    // validator cannot see it but the tenant-wide unique key rejects the insert.
    const store = createMenuStore({
      categories: [{ id: "c-branch", tenantId: TENANT_A, locationId: BRANCH_A, name: "Drinks", displayOrder: 1 }],
    });
    const service = menuServiceFor(store, ownerPrimary());

    const result = await service.saveCategory({ name: "drinks" });
    expect(result.status).toBe("duplicate");
    expect(result.status === "duplicate" && result.message).toBe(MSG_MENU_CATEGORY_ALREADY_EXISTS);
    // No new primary-scope row was created.
    expect(store.categoryRows().filter((c) => c.locationId === null)).toHaveLength(0);
  });
});

// ===========================================================================
// Hard tenant caps reject without mutation (Req 6.12, 6.13, 11.1)
// ===========================================================================

describe("hard tenant caps (Req 6.12, 6.13, 11.1)", () => {
  it("refuses a category beyond the tenant cap without mutating any row", async () => {
    const seeded: CategoryRow[] = Array.from({ length: LIMITS.menuCategoriesPerTenant }, (_, index) => ({
      id: `c-${index}`,
      tenantId: TENANT_A,
      locationId: null,
      name: `Category ${index}`,
      displayOrder: index + 1,
    }));
    const store = createMenuStore({ categories: seeded });
    const service = menuServiceFor(store, ownerPrimary());

    const result = await service.saveCategory({ name: "One Too Many" });
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.errors.some((e) => e.field === "categoryCount" && e.message === MSG_MAX_MENU_CATEGORIES)).toBe(true);
    expect(store.tenantCategoryCount(TENANT_A)).toBe(LIMITS.menuCategoriesPerTenant);
  });

  it("refuses an item beyond the tenant cap without mutating any row", async () => {
    const category: CategoryRow = { id: "c-0", tenantId: TENANT_A, locationId: null, name: "Everything", displayOrder: 1 };
    const seededItems: ItemRow[] = Array.from({ length: LIMITS.menuItemsPerTenant }, (_, index) => ({
      id: `i-${index}`,
      tenantId: TENANT_A,
      locationId: null,
      categoryId: "c-0",
      name: `Item ${index}`,
      priceMinor: 100,
      description: "",
      displayOrder: index + 1,
      state: "available",
    }));
    const store = createMenuStore({ categories: [category], items: seededItems });
    const service = menuServiceFor(store, ownerPrimary());

    const result = await service.saveItem(itemInput("c-0", { name: "Overflow" }));
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.errors.some((e) => e.field === "itemCount" && e.message === MSG_MAX_MENU_ITEMS)).toBe(true);
    expect(store.tenantItemCount(TENANT_A)).toBe(LIMITS.menuItemsPerTenant);
  });

  it("maps a raced repository category cap (cap reached in another location) to the max message", async () => {
    // 40 categories exist in a branch scope; the primary-scope validator sees 0,
    // but the tenant-wide repository cap still rejects with the max message.
    const seeded: CategoryRow[] = Array.from({ length: LIMITS.menuCategoriesPerTenant }, (_, index) => ({
      id: `c-${index}`,
      tenantId: TENANT_A,
      locationId: BRANCH_A,
      name: `Branch Category ${index}`,
      displayOrder: index + 1,
    }));
    const store = createMenuStore({ categories: seeded });
    const service = menuServiceFor(store, ownerPrimary());

    const result = await service.saveCategory({ name: "Primary Category" });
    expect(result.status).toBe("limit");
    expect(result.status === "limit" && result.message).toBe(MSG_MAX_MENU_CATEGORIES);
    expect(store.categoryRows().filter((c) => c.locationId === null)).toHaveLength(0);
  });
});

// ===========================================================================
// Two-step cascade preview then confirmed delete (Req 6.6, 6.7)
// ===========================================================================

describe("category cascade (Req 6.6, 6.7)", () => {
  it("previews the item count without mutation, then confirms a transactional delete", async () => {
    const store = createMenuStore();
    const service = menuServiceFor(store, ownerPrimary());
    const category = await service.saveCategory({ name: "Sides" });
    const categoryId = category.status === "saved" ? category.category.id : "";
    await service.saveItem(itemInput(categoryId, { name: "Fries" }));
    await service.saveItem(itemInput(categoryId, { name: "Salad" }));

    const before = store.snapshotUnrelated();

    const preview = await service.previewCategoryDeletion({ categoryId });
    expect(preview.status).toBe("preview");
    expect(preview.status === "preview" && preview.itemCount).toBe(2);
    expect(preview.status === "preview" && preview.confirmationRequired).toBe(true);
    // The preview changed nothing.
    expect(store.tenantItemCount(TENANT_A)).toBe(2);
    expect(store.tenantCategoryCount(TENANT_A)).toBe(1);

    const confirmed = await service.confirmCategoryDeletion({ categoryId });
    expect(confirmed.status).toBe("deleted");
    expect(confirmed.status === "deleted" && confirmed.deletedItemCount).toBe(2);
    // Both category and its items are gone.
    expect(store.tenantItemCount(TENANT_A)).toBe(0);
    expect(store.tenantCategoryCount(TENANT_A)).toBe(0);
    // Booking controls untouched by the cascade.
    expect(store.snapshotUnrelated()).toBe(before);
  });

  it("previews an empty category as not requiring confirmation", async () => {
    const store = createMenuStore();
    const service = menuServiceFor(store, ownerPrimary());
    const category = await service.saveCategory({ name: "Empty" });
    const categoryId = category.status === "saved" ? category.category.id : "";

    const preview = await service.previewCategoryDeletion({ categoryId });
    expect(preview.status === "preview" && preview.itemCount).toBe(0);
    expect(preview.status === "preview" && preview.confirmationRequired).toBe(false);

    const confirmed = await service.confirmCategoryDeletion({ categoryId });
    expect(confirmed.status === "deleted" && confirmed.deletedItemCount).toBe(0);
  });

  it("maps preview/confirm of a foreign category id to not found", async () => {
    const store = createMenuStore();
    const service = menuServiceFor(store, ownerPrimary());

    const preview = await service.previewCategoryDeletion({ categoryId: "ghost" });
    expect(preview.status).toBe("not_found");
    expect(preview.status === "not_found" && preview.message).toBe(MSG_SETTINGS_RESOURCE_NOT_FOUND);

    const confirmed = await service.confirmCategoryDeletion({ categoryId: "ghost" });
    expect(confirmed.status).toBe("not_found");
  });
});

// ===========================================================================
// Unavailable items retained in the dashboard tree (Req 6.8)
// ===========================================================================

describe("unavailable retention (Req 6.8)", () => {
  it("keeps an unavailable item in the dashboard read while the public projection drops it", async () => {
    const store = createMenuStore();
    const service = menuServiceFor(store, ownerPrimary());
    const category = await service.saveCategory({ name: "Specials" });
    const categoryId = category.status === "saved" ? category.category.id : "";
    const available = await service.saveItem(itemInput(categoryId, { name: "Soup" }));
    const hidden = await service.saveItem(itemInput(categoryId, { name: "Off Menu" }));
    const hiddenId = hidden.status === "saved" ? hidden.item.id : "";
    void available;

    await service.setItemState({ itemId: hiddenId, state: "unavailable" });

    const view = await service.list();
    // Dashboard retains BOTH items.
    expect(view.categories[0].items.map((i) => i.name).sort()).toEqual(["Off Menu", "Soup"]);
    expect(view.categories[0].items.find((i) => i.name === "Off Menu")?.state).toBe("unavailable");

    // Public projection exposes only the available item.
    const reader = createPublicRestaurantMenuReader({ getPublicRestaurantMenu: store.getPublicRestaurantMenu });
    const projected = await reader.read(TENANT_A);
    expect(projected).toHaveLength(1);
    expect(projected[0].items.map((i) => i.name)).toEqual(["Soup"]);
  });
});

// ===========================================================================
// Tenant AND location isolation (Req 9.3-9.7, 10.11, 10.12)
// ===========================================================================

describe("tenant and location isolation (Req 9.3-9.7, 10.11, 10.12)", () => {
  function seededTwoTenants() {
    return createMenuStore({
      categories: [
        { id: "a-primary", tenantId: TENANT_A, locationId: null, name: "A Primary", displayOrder: 1 },
        { id: "a-branch", tenantId: TENANT_A, locationId: BRANCH_A, name: "A Branch", displayOrder: 1 },
        { id: "b-primary", tenantId: TENANT_B, locationId: null, name: "B Primary", displayOrder: 1 },
      ],
      items: [
        { id: "ia-primary", tenantId: TENANT_A, locationId: null, categoryId: "a-primary", name: "A Primary Dish", priceMinor: 100, description: "", displayOrder: 1, state: "available" },
        { id: "ia-branch", tenantId: TENANT_A, locationId: BRANCH_A, categoryId: "a-branch", name: "A Branch Dish", priceMinor: 100, description: "", displayOrder: 1, state: "available" },
        { id: "ib-primary", tenantId: TENANT_B, locationId: null, categoryId: "b-primary", name: "B Primary Dish", priceMinor: 100, description: "", displayOrder: 1, state: "available" },
      ],
    });
  }

  it("returns only the effective server-derived scope for each caller", async () => {
    const store = seededTwoTenants();

    const primaryView = await menuServiceFor(store, ownerPrimary(TENANT_A)).list();
    expect(primaryView.categories.map((c) => c.id)).toEqual(["a-primary"]);

    const branchView = await menuServiceFor(store, branchAccount(TENANT_A, BRANCH_A)).list();
    expect(branchView.categories.map((c) => c.id)).toEqual(["a-branch"]);

    const tenantBView = await menuServiceFor(store, ownerPrimary(TENANT_B)).list();
    expect(tenantBView.categories.map((c) => c.id)).toEqual(["b-primary"]);
  });

  it("never mutates a foreign tenant's row through a spoofed id", async () => {
    const store = seededTwoTenants();
    const tenantBOwner = menuServiceFor(store, ownerPrimary(TENANT_B));
    const before = store.categoryRows();

    // Tenant B tries to edit / delete Tenant A's primary category and item.
    expect((await tenantBOwner.saveCategory({ categoryId: "a-primary", name: "Hijacked" })).status).toBe("not_found");
    // Tenant B's scope never lists Tenant A's category, so the foreign category
    // id fails same-scope validation before any repository write is reached.
    expect((await tenantBOwner.saveItem({ itemId: "ia-primary", ...itemInput("a-primary", { name: "Hijacked" }) })).status).toBe("invalid");
    expect((await tenantBOwner.setItemState({ itemId: "ia-primary", state: "unavailable" })).status).toBe("not_found");
    expect((await tenantBOwner.removeItem({ itemId: "ia-primary" })).status).toBe("not_found");
    expect((await tenantBOwner.confirmCategoryDeletion({ categoryId: "a-primary" })).status).toBe("not_found");

    // Tenant A's rows are byte-identical.
    expect(store.categoryRows()).toEqual(before);
    expect(store.itemRows().find((i) => i.id === "ia-primary")?.state).toBe("available");
  });

  it("never mutates another location's row within the same tenant", async () => {
    const store = seededTwoTenants();
    const branch = menuServiceFor(store, branchAccount(TENANT_A, BRANCH_A));

    // The branch account tries to reach the tenant's PRIMARY (locationId null) rows.
    expect((await branch.saveCategory({ categoryId: "a-primary", name: "Cross" })).status).toBe("not_found");
    expect((await branch.setItemState({ itemId: "ia-primary", state: "unavailable" })).status).toBe("not_found");
    expect((await branch.removeItem({ itemId: "ia-primary" })).status).toBe("not_found");

    expect(store.itemRows().find((i) => i.id === "ia-primary")?.state).toBe("available");
    expect(store.categoryRows().find((c) => c.id === "a-primary")?.name).toBe("A Primary");
  });
});

// ===========================================================================
// Permission gating: view_only / none refuse writes (Req 10.3, 10.4)
// ===========================================================================

describe("permission gating (Req 10.3, 10.4)", () => {
  it("lets a view_only account read but refuses every write without mutation", async () => {
    const store = createMenuStore({
      categories: [{ id: "c-0", tenantId: TENANT_A, locationId: null, name: "Read Me", displayOrder: 1 }],
      items: [{ id: "i-0", tenantId: TENANT_A, locationId: null, categoryId: "c-0", name: "Dish", priceMinor: 100, description: "", displayOrder: 1, state: "available" }],
    });
    const reception = contextFor({ role: "reception", tenantId: TENANT_A, accountId: "rec-a", locationId: null });
    const service = menuServiceFor(store, reception);
    const before = store.categoryRows();
    const beforeItems = store.itemRows();

    const view = await service.list();
    expect(view.canManage).toBe(false);
    expect(view.readOnly).toBe(true);
    expect(view.categories).toHaveLength(1);

    await expect(service.saveCategory({ name: "Nope" })).rejects.toThrow();
    await expect(service.saveItem(itemInput("c-0", { name: "Nope" }))).rejects.toThrow();
    await expect(service.setItemState({ itemId: "i-0", state: "unavailable" })).rejects.toThrow();
    await expect(service.removeItem({ itemId: "i-0" })).rejects.toThrow();
    await expect(service.previewCategoryDeletion({ categoryId: "c-0" })).rejects.toThrow();
    await expect(service.confirmCategoryDeletion({ categoryId: "c-0" })).rejects.toThrow();

    expect(store.categoryRows()).toEqual(before);
    expect(store.itemRows()).toEqual(beforeItems);
  });

  it("refuses both reads and writes for a none-permission account", async () => {
    const store = createMenuStore({
      categories: [{ id: "c-0", tenantId: TENANT_A, locationId: null, name: "Hidden", displayOrder: 1 }],
    });
    const doctor = contextFor({ role: "doctor", tenantId: TENANT_A, accountId: "doc-a", locationId: null });
    const service = menuServiceFor(store, doctor);
    const before = store.categoryRows();

    await expect(service.list()).rejects.toThrow();
    await expect(service.saveCategory({ name: "Nope" })).rejects.toThrow();

    expect(store.categoryRows()).toEqual(before);
  });
});

// ===========================================================================
// Public projection: ordered available-only content (Req 6.9, 6.10, 11.4)
// ===========================================================================

describe("public projection content and ordering (Req 6.9, 6.10, 11.4)", () => {
  it("returns only available items in canonical order and drops empty categories", async () => {
    const store = createMenuStore({
      categories: [
        { id: "c-drinks", tenantId: TENANT_A, locationId: null, name: "Drinks", displayOrder: 2 },
        { id: "c-mains", tenantId: TENANT_A, locationId: null, name: "Mains", displayOrder: 1 },
        { id: "c-empty", tenantId: TENANT_A, locationId: null, name: "Nothing Available", displayOrder: 3 },
      ],
      items: [
        // Mains (displayOrder 1) — deliberately inserted out of order.
        { id: "m2", tenantId: TENANT_A, locationId: null, categoryId: "c-mains", name: "Zucchini", priceMinor: 900, description: "", displayOrder: 2, state: "available" },
        { id: "m1", tenantId: TENANT_A, locationId: null, categoryId: "c-mains", name: "Alfredo", priceMinor: 1400, description: "Creamy", displayOrder: 1, state: "available" },
        { id: "m3", tenantId: TENANT_A, locationId: null, categoryId: "c-mains", name: "Hidden Main", priceMinor: 500, description: "", displayOrder: 3, state: "unavailable" },
        // Drinks (displayOrder 2)
        { id: "d1", tenantId: TENANT_A, locationId: null, categoryId: "c-drinks", name: "Cola", priceMinor: 300, description: "", displayOrder: 1, state: "available" },
        // Empty category has only an unavailable item.
        { id: "e1", tenantId: TENANT_A, locationId: null, categoryId: "c-empty", name: "Sold Out", priceMinor: 100, description: "", displayOrder: 1, state: "unavailable" },
      ],
    });

    const reader = createPublicRestaurantMenuReader({ getPublicRestaurantMenu: store.getPublicRestaurantMenu });
    const projected = await reader.read(TENANT_A);

    // Categories ordered by displayOrder; empty-after-filter category dropped.
    expect(projected.map((c) => c.name)).toEqual(["Mains", "Drinks"]);
    // Only available items, ordered by displayOrder then name.
    expect(projected[0].items.map((i) => i.name)).toEqual(["Alfredo", "Zucchini"]);
    expect(projected[1].items.map((i) => i.name)).toEqual(["Cola"]);
    // Names, prices, and descriptions are exposed for available items.
    expect(projected[0].items[0]).toMatchObject({ name: "Alfredo", priceMinor: 1400, description: "Creamy" });
    // The output equals the pure canonical projection of the same rows.
    expect(projected).toEqual(publicMenu(await store.getPublicRestaurantMenu(TENANT_A)));
  });

  it("reads only the primary (unscoped) restaurant, never a branch's menu", async () => {
    const store = createMenuStore({
      categories: [{ id: "c-branch", tenantId: TENANT_A, locationId: BRANCH_A, name: "Branch Only", displayOrder: 1 }],
      items: [{ id: "i-branch", tenantId: TENANT_A, locationId: BRANCH_A, categoryId: "c-branch", name: "Branch Dish", priceMinor: 100, description: "", displayOrder: 1, state: "available" }],
    });
    const reader = createPublicRestaurantMenuReader({ getPublicRestaurantMenu: store.getPublicRestaurantMenu });

    // No primary-scope rows exist, so the projection is empty.
    expect(await reader.read(TENANT_A)).toEqual([]);
  });
});

// ===========================================================================
// Public read: empty & error omission never throws or affects booking
// (Req 6.11, 9.5, 11.4)
// ===========================================================================

describe("public read empty / error omission (Req 6.11, 9.5, 11.4)", () => {
  it("returns an empty projection when no available item exists", async () => {
    const store = createMenuStore({
      categories: [{ id: "c-0", tenantId: TENANT_A, locationId: null, name: "All Sold Out", displayOrder: 1 }],
      items: [{ id: "i-0", tenantId: TENANT_A, locationId: null, categoryId: "c-0", name: "Gone", priceMinor: 100, description: "", displayOrder: 1, state: "unavailable" }],
    });
    const reader = createPublicRestaurantMenuReader({ getPublicRestaurantMenu: store.getPublicRestaurantMenu });

    expect(await reader.read(TENANT_A)).toEqual([]);
  });

  it("downgrades a read failure to an empty informational projection, logs it, and never throws", async () => {
    const store = createMenuStore();
    const before = store.snapshotUnrelated();
    const logReadFailure = vi.fn();
    const reader = createPublicRestaurantMenuReader({
      getPublicRestaurantMenu: async () => {
        throw new Error("menu store unavailable");
      },
      logReadFailure,
      newCorrelationId: () => "corr-123",
    });

    const result = await reader.read(TENANT_A);
    expect(result).toEqual([]);
    // The failure was logged with a correlation id, not surfaced to the caller.
    expect(logReadFailure).toHaveBeenCalledWith("corr-123", TENANT_A, expect.any(Error));
    // Booking/availability state is untouched by a menu outage.
    expect(store.snapshotUnrelated()).toBe(before);
  });

  it("treats a blank tenant id as an empty projection without a store call", async () => {
    const getPublicRestaurantMenu = vi.fn(async () => [] as MenuCategory[]);
    const reader = createPublicRestaurantMenuReader({ getPublicRestaurantMenu });

    expect(await reader.read("   ")).toEqual([]);
    expect(getPublicRestaurantMenu).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Menu operations never touch availability / booking controls (task 8.7)
// ===========================================================================

describe("menu operations leave booking controls unchanged (task 8.7)", () => {
  it("runs a full CRUD + cascade sequence without altering unrelated booking state", async () => {
    const store = createMenuStore();
    const service = menuServiceFor(store, ownerPrimary());
    const before = store.snapshotUnrelated();

    const category = await service.saveCategory({ name: "Menu" });
    const categoryId = category.status === "saved" ? category.category.id : "";
    const item = await service.saveItem(itemInput(categoryId, { name: "Thing" }));
    const itemId = item.status === "saved" ? item.item.id : "";
    await service.saveItem({ itemId, ...itemInput(categoryId, { name: "Thing 2" }) });
    await service.setItemState({ itemId, state: "unavailable" });
    await service.previewCategoryDeletion({ categoryId });
    await service.confirmCategoryDeletion({ categoryId });

    // Every booking control and booking row is byte-identical after menu churn.
    expect(store.snapshotUnrelated()).toBe(before);
  });
});
