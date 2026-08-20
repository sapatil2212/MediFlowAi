// @vitest-environment jsdom
/**
 * MenuSettings.test.tsx
 *
 * Focused DOM suite for the `Menu` Settings sub-tab
 * (spec `.kiro/specs/restaurant-dashboard-settings`, task 8.2,
 * Req 6.1-6.8, 6.12-6.14, 9.3-9.7).
 *
 * Every server interaction is an injected callback, exactly like
 * `DiningAreasSettings.test.tsx`, so the tests never touch the database, auth,
 * or SQL. The production server-function module is mocked at the boundary so
 * importing the component does not pull `db`/`auth.server` into jsdom.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/restaurant-settings", () => ({
  getRestaurantMenuServerFn: vi.fn(),
  saveRestaurantMenuCategoryServerFn: vi.fn(),
  saveRestaurantMenuItemServerFn: vi.fn(),
  setRestaurantMenuItemStateServerFn: vi.fn(),
  deleteRestaurantMenuItemServerFn: vi.fn(),
  previewRestaurantMenuCategoryDeletionServerFn: vi.fn(),
  confirmDeleteRestaurantMenuCategoryServerFn: vi.fn(),
}));

import {
  MenuSettings,
  type FetchRestaurantMenu,
  type SaveRestaurantMenuCategory,
  type SaveRestaurantMenuItem,
  type SetRestaurantMenuItemState,
  type DeleteRestaurantMenuItem,
  type PreviewRestaurantMenuCategoryDeletion,
  type ConfirmDeleteRestaurantMenuCategory,
} from "./MenuSettings";
import type { MenuCategory, MenuItem } from "../../lib/restaurant-settings-model";
import type { RestaurantMenuView } from "../../lib/restaurant-settings";

type Permission = "operate" | "view_only" | "none";

function item(overrides: Partial<MenuItem> & { id: string; categoryId: string; name: string }): MenuItem {
  return {
    priceMinor: 1000,
    description: "",
    displayOrder: 1,
    state: "available",
    locationId: null,
    ...overrides,
  };
}

function category(
  overrides: Partial<MenuCategory> & { id: string; name: string },
): MenuCategory {
  return {
    displayOrder: 1,
    items: [],
    locationId: null,
    ...overrides,
  };
}

function viewOf(categories: MenuCategory[], permission: Permission): RestaurantMenuView {
  const canManage = permission === "operate";
  return { categories, canManage, readOnly: !canManage };
}

const fetchOf = (view: RestaurantMenuView): FetchRestaurantMenu => vi.fn(async () => view);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Menu listing and limits (Req 6.1, 6.12)", () => {
  it("renders each category with its ordered items and the per-tenant limits", async () => {
    const fetchMenu = fetchOf(
      viewOf(
        [
          category({
            id: "c1",
            name: "Starters",
            displayOrder: 1,
            items: [
              item({ id: "i1", categoryId: "c1", name: "Bruschetta", priceMinor: 650 }),
              item({ id: "i2", categoryId: "c1", name: "Soup", priceMinor: 500 }),
            ],
          }),
          category({ id: "c2", name: "Mains", displayOrder: 2, items: [] }),
        ],
        "operate",
      ),
    );
    render(<MenuSettings permission="operate" fetchMenu={fetchMenu} />);

    await screen.findByTestId("menu-list");
    expect(screen.getByTestId("menu-category-c1")).toBeTruthy();
    expect(screen.getByTestId("menu-item-i1").textContent).toContain("Bruschetta");
    expect(screen.getByTestId("menu-item-i1").textContent).toContain("6.50");
    // Req 6.12 — limits with current counts (2 categories, 2 items).
    expect(screen.getByTestId("menu-limits").textContent).toContain("2 of 40 categories");
    expect(screen.getByTestId("menu-limits").textContent).toContain("2 of 500 items");
  });
});

describe("Menu item creation and validation (Req 6.3, 6.4)", () => {
  it("creates an item and forwards the branch scope verbatim (Req 9.3-9.7)", async () => {
    const fetchMenu = fetchOf(viewOf([category({ id: "c1", name: "Mains" })], "operate"));
    const saveItem: SaveRestaurantMenuItem = vi.fn(async () => ({
      status: "saved" as const,
      item: item({ id: "i9", categoryId: "c1", name: "Steak" }),
    }));

    render(
      <MenuSettings
        permission="operate"
        requestedLocationId="branch-7"
        fetchMenu={fetchMenu}
        saveItem={saveItem}
      />,
    );
    await screen.findByTestId("menu-list");

    fireEvent.click(screen.getByRole("button", { name: /add item to mains/i }));
    fireEvent.change(screen.getByLabelText("Menu item name"), { target: { value: "Steak" } });
    fireEvent.change(screen.getByLabelText("Menu item price"), { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("button", { name: /^add item$/i }));

    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    expect(saveItem).toHaveBeenCalledWith({
      data: {
        itemId: null,
        categoryId: "c1",
        name: "Steak",
        priceMinor: 2500,
        description: "",
        displayOrder: null,
        requestedLocationId: "branch-7",
      },
    });
  });

  it("shows a validation summary naming each offending field", async () => {
    const fetchMenu = fetchOf(viewOf([category({ id: "c1", name: "Mains" })], "operate"));
    const saveItem: SaveRestaurantMenuItem = vi.fn(async () => ({
      status: "invalid" as const,
      errors: [
        { field: "name", message: "Menu item name must be between 1 and 80 characters" },
        { field: "priceMinor", message: "Menu item price must be a whole number between 0 and 10000000 minor units" },
      ],
    }));

    render(<MenuSettings permission="operate" fetchMenu={fetchMenu} saveItem={saveItem} />);
    await screen.findByTestId("menu-list");

    fireEvent.click(screen.getByRole("button", { name: /add item to mains/i }));
    fireEvent.click(screen.getByRole("button", { name: /^add item$/i }));

    expect(
      await screen.findByText("Menu item name must be between 1 and 80 characters"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Menu item price must be a whole number between 0 and 10000000 minor units",
      ),
    ).toBeTruthy();
  });
});

describe("Menu category duplicate handling (Req 6.5)", () => {
  it("shows the already-exists message on a duplicate category", async () => {
    const fetchMenu = fetchOf(viewOf([category({ id: "c1", name: "Mains" })], "operate"));
    const saveCategory: SaveRestaurantMenuCategory = vi.fn(async () => ({
      status: "duplicate" as const,
      message: "This menu category already exists",
    }));

    render(
      <MenuSettings permission="operate" fetchMenu={fetchMenu} saveCategory={saveCategory} />,
    );
    await screen.findByTestId("menu-list");

    fireEvent.click(screen.getByRole("button", { name: /add a menu category/i }));
    fireEvent.change(screen.getByLabelText("Menu category name"), { target: { value: "Mains" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));

    expect(await screen.findByText("This menu category already exists")).toBeTruthy();
  });
});

describe("Two-step category cascade deletion (Req 6.6, 6.7)", () => {
  it("previews the item count, then confirms the cascade delete", async () => {
    const fetchMenu = fetchOf(
      viewOf(
        [
          category({
            id: "c1",
            name: "Mains",
            items: [item({ id: "i1", categoryId: "c1", name: "Steak" })],
          }),
        ],
        "operate",
      ),
    );
    const previewCategoryDeletion: PreviewRestaurantMenuCategoryDeletion = vi.fn(async () => ({
      status: "preview" as const,
      categoryId: "c1",
      itemCount: 3,
      confirmationRequired: true,
    }));
    const confirmCategoryDeletion: ConfirmDeleteRestaurantMenuCategory = vi.fn(async () => ({
      status: "deleted" as const,
      deletedItemCount: 3,
    }));

    render(
      <MenuSettings
        permission="operate"
        fetchMenu={fetchMenu}
        previewCategoryDeletion={previewCategoryDeletion}
        confirmCategoryDeletion={confirmCategoryDeletion}
      />,
    );
    await screen.findByTestId("menu-list");

    // First click: preview only — nothing deleted yet (Req 6.6).
    fireEvent.click(screen.getByRole("button", { name: /delete mains/i }));
    await waitFor(() => expect(previewCategoryDeletion).toHaveBeenCalledTimes(1));
    expect(confirmCategoryDeletion).not.toHaveBeenCalled();

    // The returned cascade count is shown on the confirm control.
    const confirmBtn = await screen.findByTestId("menu-category-confirm-delete-c1");
    expect(confirmBtn.textContent).toContain("3 items");

    // Second click: confirmed cascade delete (Req 6.7).
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(confirmCategoryDeletion).toHaveBeenCalledTimes(1));
    expect(confirmCategoryDeletion).toHaveBeenCalledWith({
      data: { categoryId: "c1", requestedLocationId: null },
    });
  });
});

describe("Item availability toggle (Req 6.8)", () => {
  it("sets an available item to unavailable and keeps it in the tree", async () => {
    const available = item({ id: "i1", categoryId: "c1", name: "Steak", state: "available" });
    const fetchMenu: FetchRestaurantMenu = vi
      .fn()
      .mockResolvedValueOnce(viewOf([category({ id: "c1", name: "Mains", items: [available] })], "operate"))
      .mockResolvedValueOnce(
        viewOf(
          [category({ id: "c1", name: "Mains", items: [{ ...available, state: "unavailable" }] })],
          "operate",
        ),
      );
    const setItemState: SetRestaurantMenuItemState = vi.fn(async () => ({
      status: "saved" as const,
      item: { ...available, state: "unavailable" as const },
    }));

    render(<MenuSettings permission="operate" fetchMenu={fetchMenu} setItemState={setItemState} />);
    await screen.findByTestId("menu-list");

    fireEvent.click(screen.getByRole("button", { name: /mark steak unavailable/i }));

    await waitFor(() => expect(setItemState).toHaveBeenCalledTimes(1));
    expect(setItemState).toHaveBeenCalledWith({
      data: { itemId: "i1", state: "unavailable", requestedLocationId: null },
    });
    // Req 6.8 — the item stays listed, now marked unavailable.
    await waitFor(() =>
      expect(screen.getByTestId("menu-item-state-i1").textContent).toContain("Unavailable"),
    );
  });
});

describe("Read-only mode (Req 6.14)", () => {
  it("renders the menu read-only with no create, edit, delete, or state controls", async () => {
    const fetchMenu = fetchOf(
      viewOf(
        [
          category({
            id: "c1",
            name: "Mains",
            items: [item({ id: "i1", categoryId: "c1", name: "Steak" })],
          }),
        ],
        "view_only",
      ),
    );
    render(<MenuSettings permission="view_only" fetchMenu={fetchMenu} />);
    await screen.findByTestId("menu-list");

    expect(screen.getByTestId("menu-view-only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add a menu category/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete mains/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete steak/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark steak unavailable/i })).toBeNull();
    // The item itself is still shown.
    expect(screen.getByTestId("menu-item-i1")).toBeTruthy();
  });
});
