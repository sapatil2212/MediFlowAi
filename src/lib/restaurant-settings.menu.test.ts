import { describe, expect, it, vi } from "vitest";

import { resolveFeatureAccess, type AccountContext, type ResolvedAccess } from "./feature-access";
import {
  LIMITS,
  MSG_MAX_MENU_CATEGORIES,
  MSG_MAX_MENU_ITEMS,
  MSG_MENU_CATEGORY_ALREADY_EXISTS,
  MSG_MENU_CATEGORY_REFERENCE,
  MSG_MENU_ITEM_STATE,
  MSG_NOT_AUTHORISED_CONFIG,
  MSG_SETTINGS_RESOURCE_NOT_FOUND,
  type MenuCategory,
  type MenuItem,
} from "./restaurant-settings-model";
import {
  MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
  createRestaurantMenuService,
  type AuthenticatedRestaurantSettingsContext,
} from "./restaurant-settings";
import type {
  DeleteMenuCategoryResult,
  DeleteMenuItemResult,
  PreviewMenuCategoryDeletionResult,
  SaveMenuCategoryResult,
  SaveMenuItemResult,
} from "./restaurant-settings.server";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const TENANT = "tenant-a";

type ConfigPermission = "operate" | "view_only" | "none";

function contextFor(
  configPermission: ConfigPermission = "operate",
  scopeLocationId: string | null = null,
): AuthenticatedRestaurantSettingsContext {
  const role = configPermission === "operate" ? "admin" : "reception";
  const accountContext: AccountContext = {
    role,
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    isActive: true,
    now: NOW,
  };
  const base = resolveFeatureAccess(accountContext);
  const access: ResolvedAccess = {
    ...base,
    restaurant_config:
      configPermission === "none"
        ? { available: false, permission: "none", visible: false }
        : { available: true, permission: configPermission, visible: true },
  };
  return {
    session: { id: "owner-a", tenantId: TENANT, role, subscriptionPlan: "Premium" },
    accountId: "owner-a",
    tenantId: TENANT,
    role,
    featureContext: accountContext,
    access,
    scope: { tenantId: TENANT, locationId: scopeLocationId },
  };
}

function item(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: "item-1",
    categoryId: "cat-1",
    name: "Soup",
    priceMinor: 500,
    description: "",
    displayOrder: 1,
    state: "available",
    locationId: null,
    ...overrides,
  };
}

function category(overrides: Partial<MenuCategory> = {}): MenuCategory {
  return {
    id: "cat-1",
    name: "Starters",
    displayOrder: 1,
    items: [],
    locationId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe("restaurant menu service reads", () => {
  it("requires config visibility to read", async () => {
    const listMenu = vi.fn(async () => [] as MenuCategory[]);
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("none"),
      listMenu,
    });

    await expect(service.list({})).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
    expect(listMenu).not.toHaveBeenCalled();
  });

  it("returns a canonically ordered tree with a read-only flag for view_only", async () => {
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("view_only"),
      listMenu: async () => [
        category({
          id: "b",
          name: "Beverages",
          displayOrder: 2,
          items: [
            item({ id: "i2", categoryId: "b", name: "Water", displayOrder: 2 }),
            item({ id: "i1", categoryId: "b", name: "Ale", displayOrder: 1 }),
          ],
        }),
        category({ id: "a", name: "Appetisers", displayOrder: 1, items: [] }),
      ],
    });

    const view = await service.list({});
    expect(view.categories.map((c) => c.id)).toEqual(["a", "b"]);
    expect(view.categories[1].items.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(view.canManage).toBe(false);
    expect(view.readOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Category writes
// ---------------------------------------------------------------------------

describe("restaurant menu category writes", () => {
  it("refuses a create from a view_only account before any write", async () => {
    const saveMenuCategory = vi.fn(
      async (): Promise<SaveMenuCategoryResult> => ({ status: "saved", category: category() }),
    );
    const listMenu = vi.fn(async () => [] as MenuCategory[]);
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("view_only"),
      listMenu,
      saveMenuCategory,
    });

    await expect(service.saveCategory({ name: "New" })).rejects.toThrow(MSG_NOT_AUTHORISED_CONFIG);
    expect(saveMenuCategory).not.toHaveBeenCalled();
    expect(listMenu).not.toHaveBeenCalled();
  });

  it("creates a category defaulting the display order past the highest stored", async () => {
    const saveMenuCategory = vi.fn(
      async (): Promise<SaveMenuCategoryResult> => ({
        status: "saved",
        category: category({ id: "new", name: "Desserts", displayOrder: 3 }),
      }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [category({ id: "a", name: "Appetisers", displayOrder: 2 })],
      saveMenuCategory,
    });

    const result = await service.saveCategory({ name: "  Desserts  " });
    expect(result.status).toBe("saved");
    expect(saveMenuCategory).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: null },
      { name: "Desserts", displayOrder: 3 },
      undefined,
    );
  });

  it("rejects a blank category name with field errors and never writes", async () => {
    const saveMenuCategory = vi.fn(
      async (): Promise<SaveMenuCategoryResult> => ({ status: "saved", category: category() }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [],
      saveMenuCategory,
    });

    const result = await service.saveCategory({ name: "   " });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.some((e) => e.field === "name")).toBe(true);
    }
    expect(saveMenuCategory).not.toHaveBeenCalled();
  });

  it("rejects a case-insensitive duplicate name during validation", async () => {
    const saveMenuCategory = vi.fn(
      async (): Promise<SaveMenuCategoryResult> => ({ status: "saved", category: category() }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [category({ id: "a", name: "Starters", displayOrder: 1 })],
      saveMenuCategory,
    });

    const result = await service.saveCategory({ name: "  starters " });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors).toContainEqual({
        field: "name",
        message: MSG_MENU_CATEGORY_ALREADY_EXISTS,
      });
    }
    expect(saveMenuCategory).not.toHaveBeenCalled();
  });

  it("maps a raced stored duplicate to the already-exists message", async () => {
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [],
      saveMenuCategory: async () => ({ status: "duplicate" }),
    });

    const result = await service.saveCategory({ name: "Mains" });
    expect(result).toEqual({ status: "duplicate", message: MSG_MENU_CATEGORY_ALREADY_EXISTS });
  });

  it("rejects a create that would exceed the category cap during validation", async () => {
    const stored = Array.from({ length: LIMITS.menuCategoriesPerTenant }, (_, index) =>
      category({ id: `c${index}`, name: `Category ${index}`, displayOrder: index + 1 }),
    );
    const saveMenuCategory = vi.fn(
      async (): Promise<SaveMenuCategoryResult> => ({ status: "saved", category: category() }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => stored,
      saveMenuCategory,
    });

    const result = await service.saveCategory({ name: "One Too Many" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors).toContainEqual({
        field: "categoryCount",
        message: MSG_MAX_MENU_CATEGORIES,
      });
    }
    expect(saveMenuCategory).not.toHaveBeenCalled();
  });

  it("maps a raced category cap hit to the max message", async () => {
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [],
      saveMenuCategory: async () => ({ status: "category_limit" }),
    });

    const result = await service.saveCategory({ name: "Mains" });
    expect(result).toEqual({ status: "limit", message: MSG_MAX_MENU_CATEGORIES });
  });

  it("edits a category through the update path and maps a miss to not found", async () => {
    const saveMenuCategory = vi.fn(
      async (): Promise<SaveMenuCategoryResult> => ({ status: "not_found" }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate", "branch-1"),
      listMenu: async () => [category({ id: "cat-1", name: "Starters", displayOrder: 1 })],
      saveMenuCategory,
    });

    const result = await service.saveCategory({
      categoryId: "ghost",
      name: "Renamed",
      displayOrder: 1,
    });
    expect(result).toEqual({ status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND });
    expect(saveMenuCategory).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: "branch-1" },
      { name: "Renamed", displayOrder: 1 },
      "ghost",
    );
  });
});

// ---------------------------------------------------------------------------
// Item writes and state
// ---------------------------------------------------------------------------

describe("restaurant menu item writes", () => {
  it("creates an item resolving the category within the same scope", async () => {
    const saveMenuItem = vi.fn(
      async (): Promise<SaveMenuItemResult> => ({
        status: "saved",
        item: item({ id: "new", categoryId: "cat-1", name: "Fries", displayOrder: 2 }),
      }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [
        category({
          id: "cat-1",
          name: "Sides",
          displayOrder: 1,
          items: [item({ id: "i1", categoryId: "cat-1", displayOrder: 1 })],
        }),
      ],
      saveMenuItem,
    });

    const result = await service.saveItem({
      categoryId: "cat-1",
      name: "  Fries  ",
      priceMinor: 300,
    });

    expect(result.status).toBe("saved");
    expect(saveMenuItem).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: null },
      {
        categoryId: "cat-1",
        name: "Fries",
        priceMinor: 300,
        description: "",
        displayOrder: 2,
        state: "available",
      },
      undefined,
    );
  });

  it("rejects an item whose category is not in scope", async () => {
    const saveMenuItem = vi.fn(
      async (): Promise<SaveMenuItemResult> => ({ status: "saved", item: item() }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [category({ id: "cat-1", name: "Sides", displayOrder: 1 })],
      saveMenuItem,
    });

    const result = await service.saveItem({
      categoryId: "foreign",
      name: "Fries",
      priceMinor: 300,
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors).toContainEqual({
        field: "categoryId",
        message: MSG_MENU_CATEGORY_REFERENCE,
      });
    }
    expect(saveMenuItem).not.toHaveBeenCalled();
  });

  it("collects every offending item field and never reaches the store", async () => {
    const saveMenuItem = vi.fn(
      async (): Promise<SaveMenuItemResult> => ({ status: "saved", item: item() }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [category({ id: "cat-1", name: "Sides", displayOrder: 1 })],
      saveMenuItem,
    });

    const result = await service.saveItem({
      categoryId: "cat-1",
      name: "",
      priceMinor: -5,
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("name");
      expect(fields).toContain("priceMinor");
    }
    expect(saveMenuItem).not.toHaveBeenCalled();
  });

  it("maps a raced item cap hit to the max message", async () => {
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [category({ id: "cat-1", name: "Sides", displayOrder: 1 })],
      saveMenuItem: async () => ({ status: "item_limit" }),
    });

    const result = await service.saveItem({
      categoryId: "cat-1",
      name: "Fries",
      priceMinor: 300,
    });
    expect(result).toEqual({ status: "limit", message: MSG_MAX_MENU_ITEMS });
  });

  it("maps a raced category disappearance to the category-reference error", async () => {
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      listMenu: async () => [category({ id: "cat-1", name: "Sides", displayOrder: 1 })],
      saveMenuItem: async () => ({ status: "category_not_found" }),
    });

    const result = await service.saveItem({
      categoryId: "cat-1",
      name: "Fries",
      priceMinor: 300,
    });
    expect(result).toEqual({
      status: "invalid",
      errors: [{ field: "categoryId", message: MSG_MENU_CATEGORY_REFERENCE }],
    });
  });

  it("refuses an item save from a view_only account before any write", async () => {
    const saveMenuItem = vi.fn(
      async (): Promise<SaveMenuItemResult> => ({ status: "saved", item: item() }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("view_only"),
      listMenu: async () => [],
      saveMenuItem,
    });

    await expect(
      service.saveItem({ categoryId: "cat-1", name: "Fries", priceMinor: 300 }),
    ).rejects.toThrow(MSG_NOT_AUTHORISED_CONFIG);
    expect(saveMenuItem).not.toHaveBeenCalled();
  });

  it("sets an item state and retains it in the dashboard tree", async () => {
    const updateMenuItemState = vi.fn(
      async (): Promise<SaveMenuItemResult> => ({
        status: "saved",
        item: item({ id: "item-1", state: "unavailable" }),
      }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      updateMenuItemState,
    });

    const result = await service.setItemState({ itemId: "item-1", state: "unavailable" });
    expect(result.status).toBe("saved");
    if (result.status === "saved") expect(result.item.state).toBe("unavailable");
    expect(updateMenuItemState).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: null },
      "item-1",
      "unavailable",
    );
  });

  it("rejects an unknown item state without touching the store", async () => {
    const updateMenuItemState = vi.fn(
      async (): Promise<SaveMenuItemResult> => ({ status: "saved", item: item() }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      updateMenuItemState,
    });

    const result = await service.setItemState({ itemId: "item-1", state: "sold-out" });
    expect(result).toEqual({
      status: "invalid",
      errors: [{ field: "state", message: MSG_MENU_ITEM_STATE }],
    });
    expect(updateMenuItemState).not.toHaveBeenCalled();
  });

  it("deletes an item and maps a miss to not found", async () => {
    const deletedService = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      deleteMenuItem: async (): Promise<DeleteMenuItemResult> => ({ status: "deleted" }),
    });
    await expect(deletedService.removeItem({ itemId: "item-1" })).resolves.toEqual({
      status: "deleted",
    });

    const missService = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      deleteMenuItem: async (): Promise<DeleteMenuItemResult> => ({ status: "not_found" }),
    });
    await expect(missService.removeItem({ itemId: "ghost" })).resolves.toEqual({
      status: "not_found",
      message: MSG_SETTINGS_RESOURCE_NOT_FOUND,
    });
  });
});

// ---------------------------------------------------------------------------
// Two-step cascade deletion
// ---------------------------------------------------------------------------

describe("restaurant menu category cascade deletion", () => {
  it("previews the cascade without changing any row", async () => {
    const confirmDeleteMenuCategory = vi.fn(
      async (): Promise<DeleteMenuCategoryResult> => ({ status: "deleted", deletedItemCount: 0 }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      previewMenuCategoryDeletion: async (): Promise<PreviewMenuCategoryDeletionResult> => ({
        status: "preview",
        categoryId: "cat-1",
        itemCount: 3,
        confirmationRequired: true,
      }),
      confirmDeleteMenuCategory,
    });

    const preview = await service.previewCategoryDeletion({ categoryId: "cat-1" });
    expect(preview).toEqual({
      status: "preview",
      categoryId: "cat-1",
      itemCount: 3,
      confirmationRequired: true,
    });
    expect(confirmDeleteMenuCategory).not.toHaveBeenCalled();
  });

  it("maps a preview miss to not found", async () => {
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate"),
      previewMenuCategoryDeletion: async (): Promise<PreviewMenuCategoryDeletionResult> => ({
        status: "not_found",
      }),
    });

    await expect(service.previewCategoryDeletion({ categoryId: "ghost" })).resolves.toEqual({
      status: "not_found",
      message: MSG_SETTINGS_RESOURCE_NOT_FOUND,
    });
  });

  it("confirms the cascade and reports the deleted item count", async () => {
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate", "branch-1"),
      confirmDeleteMenuCategory: async (): Promise<DeleteMenuCategoryResult> => ({
        status: "deleted",
        deletedItemCount: 4,
      }),
    });

    await expect(service.confirmCategoryDeletion({ categoryId: "cat-1" })).resolves.toEqual({
      status: "deleted",
      deletedItemCount: 4,
    });
  });

  it("refuses preview and confirm from a view_only account before any read/write", async () => {
    const previewMenuCategoryDeletion = vi.fn(
      async (): Promise<PreviewMenuCategoryDeletionResult> => ({
        status: "preview",
        categoryId: "cat-1",
        itemCount: 0,
        confirmationRequired: false,
      }),
    );
    const confirmDeleteMenuCategory = vi.fn(
      async (): Promise<DeleteMenuCategoryResult> => ({ status: "deleted", deletedItemCount: 0 }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("view_only"),
      previewMenuCategoryDeletion,
      confirmDeleteMenuCategory,
    });

    await expect(service.previewCategoryDeletion({ categoryId: "cat-1" })).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    await expect(service.confirmCategoryDeletion({ categoryId: "cat-1" })).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    expect(previewMenuCategoryDeletion).not.toHaveBeenCalled();
    expect(confirmDeleteMenuCategory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tenant and location isolation (Req 9.3-9.7, 10.11, 10.12)
//
// The service never trusts a caller-supplied scope: every read and write runs
// against the server-derived `context.scope` exactly. These tests prove the
// resolved `{tenantId, locationId}` is the only scope forwarded to the
// repository for both the primary restaurant and an owner-selected branch.
// ---------------------------------------------------------------------------

describe("restaurant menu tenant and location isolation", () => {
  it("reads the menu against the server-derived branch scope only", async () => {
    const listMenu = vi.fn(async () => [] as MenuCategory[]);
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate", "branch-1"),
      listMenu,
    });

    await service.list({});

    expect(listMenu).toHaveBeenCalledTimes(1);
    expect(listMenu).toHaveBeenCalledWith({ tenantId: TENANT, locationId: "branch-1" });
  });

  it("reads the primary restaurant against the null-location scope", async () => {
    const listMenu = vi.fn(async () => [] as MenuCategory[]);
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate", null),
      listMenu,
    });

    await service.list({});

    expect(listMenu).toHaveBeenCalledWith({ tenantId: TENANT, locationId: null });
  });

  it("forwards the resolved branch scope verbatim to every menu mutation", async () => {
    const scope = { tenantId: TENANT, locationId: "branch-9" };
    const saveMenuCategory = vi.fn(
      async (): Promise<SaveMenuCategoryResult> => ({
        status: "saved",
        category: category({ id: "new", name: "Desserts", displayOrder: 2 }),
      }),
    );
    const saveMenuItem = vi.fn(
      async (): Promise<SaveMenuItemResult> => ({
        status: "saved",
        item: item({ id: "new", categoryId: "cat-1", name: "Fries", displayOrder: 2 }),
      }),
    );
    const updateMenuItemState = vi.fn(
      async (): Promise<SaveMenuItemResult> => ({
        status: "saved",
        item: item({ id: "item-1", state: "unavailable" }),
      }),
    );
    const deleteMenuItem = vi.fn(
      async (): Promise<DeleteMenuItemResult> => ({ status: "deleted" }),
    );
    const previewMenuCategoryDeletion = vi.fn(
      async (): Promise<PreviewMenuCategoryDeletionResult> => ({
        status: "preview",
        categoryId: "cat-1",
        itemCount: 1,
        confirmationRequired: true,
      }),
    );
    const confirmDeleteMenuCategory = vi.fn(
      async (): Promise<DeleteMenuCategoryResult> => ({ status: "deleted", deletedItemCount: 1 }),
    );
    const service = createRestaurantMenuService({
      resolveContext: async () => contextFor("operate", "branch-9"),
      listMenu: async () => [
        category({
          id: "cat-1",
          name: "Sides",
          displayOrder: 1,
          items: [item({ id: "item-1", categoryId: "cat-1", displayOrder: 1 })],
        }),
      ],
      saveMenuCategory,
      saveMenuItem,
      updateMenuItemState,
      deleteMenuItem,
      previewMenuCategoryDeletion,
      confirmDeleteMenuCategory,
    });

    await service.saveCategory({ name: "Desserts" });
    await service.saveItem({ categoryId: "cat-1", name: "Fries", priceMinor: 300 });
    await service.setItemState({ itemId: "item-1", state: "unavailable" });
    await service.removeItem({ itemId: "item-1" });
    await service.previewCategoryDeletion({ categoryId: "cat-1" });
    await service.confirmCategoryDeletion({ categoryId: "cat-1" });

    // Every mutation is keyed by the resolved scope's first argument.
    for (const spy of [
      saveMenuCategory,
      saveMenuItem,
      updateMenuItemState,
      deleteMenuItem,
      previewMenuCategoryDeletion,
      confirmDeleteMenuCategory,
    ]) {
      expect(spy).toHaveBeenCalledTimes(1);
      const firstArg = (spy.mock.calls[0] as unknown[])[0];
      expect(firstArg).toEqual(scope);
    }
  });
});
