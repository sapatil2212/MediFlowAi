import { describe, expect, it, vi } from "vitest";

import { createPublicRestaurantMenuReader } from "./restaurant-settings";
import type { MenuCategory, MenuItem } from "./restaurant-settings-model";

function item(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: "item-1",
    categoryId: "category-1",
    name: "Item",
    priceMinor: 1000,
    description: "",
    displayOrder: 1,
    state: "available",
    locationId: null,
    ...overrides,
  };
}

function category(overrides: Partial<MenuCategory> = {}): MenuCategory {
  return {
    id: "category-1",
    name: "Category",
    displayOrder: 1,
    items: [],
    locationId: null,
    ...overrides,
  };
}

describe("public restaurant menu reader", () => {
  it("returns the canonically ordered available-only projection", async () => {
    const getPublicRestaurantMenu = vi.fn(async () => [
      category({
        id: "mains",
        name: "Mains",
        displayOrder: 2,
        items: [
          item({ id: "steak", categoryId: "mains", name: "Steak", displayOrder: 2 }),
          item({ id: "pasta", categoryId: "mains", name: "Pasta", displayOrder: 1 }),
        ],
      }),
      category({
        id: "starters",
        name: "Starters",
        displayOrder: 1,
        items: [item({ id: "soup", categoryId: "starters", name: "Soup", displayOrder: 1 })],
      }),
    ]);
    const reader = createPublicRestaurantMenuReader({ getPublicRestaurantMenu });

    const result = await reader.read("tenant-a");

    // Categories ordered by displayOrder, items ordered within each category.
    expect(result.map((entry) => entry.id)).toEqual(["starters", "mains"]);
    expect(result[1].items.map((entry) => entry.id)).toEqual(["pasta", "steak"]);
    expect(getPublicRestaurantMenu).toHaveBeenCalledWith("tenant-a");
  });

  it("drops unavailable items and empty categories via the pure projection", async () => {
    const getPublicRestaurantMenu = vi.fn(async () => [
      category({
        id: "drinks",
        items: [
          item({ id: "cola", categoryId: "drinks", state: "available" }),
          item({ id: "wine", categoryId: "drinks", state: "unavailable" }),
        ],
      }),
      category({
        id: "specials",
        displayOrder: 2,
        items: [item({ id: "gone", categoryId: "specials", state: "unavailable" })],
      }),
    ]);
    const reader = createPublicRestaurantMenuReader({ getPublicRestaurantMenu });

    const result = await reader.read("tenant-a");

    expect(result.map((entry) => entry.id)).toEqual(["drinks"]);
    expect(result[0].items.map((entry) => entry.id)).toEqual(["cola"]);
  });

  it("returns an empty projection for a blank tenant id without reading rows", async () => {
    const getPublicRestaurantMenu = vi.fn(async () => [category()]);
    const reader = createPublicRestaurantMenuReader({ getPublicRestaurantMenu });

    await expect(reader.read("   ")).resolves.toEqual([]);
    expect(getPublicRestaurantMenu).not.toHaveBeenCalled();
  });

  it("logs a read failure with a correlation id and returns an empty projection", async () => {
    const failure = new Error("database unavailable");
    const getPublicRestaurantMenu = vi.fn(async () => {
      throw failure;
    });
    const logReadFailure = vi.fn();
    const reader = createPublicRestaurantMenuReader({
      getPublicRestaurantMenu,
      logReadFailure,
      newCorrelationId: () => "corr-123",
    });

    const result = await reader.read("tenant-a");

    expect(result).toEqual([]);
    expect(logReadFailure).toHaveBeenCalledWith("corr-123", "tenant-a", failure);
  });
});
