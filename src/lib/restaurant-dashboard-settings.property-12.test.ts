/**
 * restaurant-dashboard-settings.property-12.test.ts
 *
 * Property-based suite for menu validation, defaults, and limits (spec task 8.5).
 *
 * Generators build menu category and item submissions covering all boundary
 * conditions: trimmed names, display orders, prices, descriptions, states,
 * tenant-wide category uniqueness, and the hard tenant caps of 40 categories
 * and 500 items. Each submission is applied to an in-memory repository model
 * with a known starting state.
 *
 * The property asserts, against independent reference implementations:
 *   - Valid fields are trimmed and preserved exactly.
 *   - An omitted item state becomes `available`.
 *   - Invalid fields are all reported without mutation.
 *   - Case/whitespace variants of an existing category name are rejected.
 *   - No accepted operation can increase tenant totals above the hard caps.
 *
 * This module is pure: no I/O, clock, or network dependencies.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateMenuCategory,
  validateMenuItem,
  LIMITS,
  DEFAULT_MENU_ITEM_STATE,
  DEFAULT_MENU_ITEM_DESCRIPTION,
  MENU_ITEM_STATES,
  type MenuContext,
  type MenuItemState,
  type NormalisedMenuCategory,
  type NormalisedMenuItem,
} from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 12: Menu validation, defaults, and limits
// **Validates: Requirements 6.3, 6.4, 6.5, 6.12, 6.13, 11.1**

// ===========================================================================
// Constants and bounds
// ===========================================================================

const TENANT_ID = "tenant-menu-validation";
const LOCATION_ID = null; // Primary scope

// ===========================================================================
// Independent reference helpers
// ===========================================================================

/** Trim and normalize whitespace variants for case-insensitive comparison. */
function normalizeNameKey(name: string): string {
  return String(name).trim().toLowerCase();
}

/** Check if category name is a duplicate (case-insensitive, after trim). */
function isDuplicateCategoryName(
  name: unknown,
  existing: Array<{ id: string; name: string }>,
  editingId: string | null,
): boolean {
  if (typeof name !== "string") return false;
  const key = normalizeNameKey(name);
  return existing.some((cat) => cat.id !== editingId && normalizeNameKey(cat.name) === key);
}

/** Check if category name is valid (length and type). */
function isCategoryNameValid(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  return (
    trimmed.length >= LIMITS.menuCategoryName.min && trimmed.length <= LIMITS.menuCategoryName.max
  );
}

/** Check if item name is valid. */
function isItemNameValid(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  return trimmed.length >= LIMITS.menuItemName.min && trimmed.length <= LIMITS.menuItemName.max;
}

/** Check if item price is valid. */
function isItemPriceValid(price: unknown): boolean {
  return (
    typeof price === "number" &&
    Number.isInteger(price) &&
    price >= LIMITS.menuItemPriceMinor.min &&
    price <= LIMITS.menuItemPriceMinor.max
  );
}

/** Check if item description is valid. */
function isItemDescriptionValid(description: unknown): boolean {
  if (description === undefined) return true;
  if (typeof description !== "string") return false;
  return description.trim().length <= LIMITS.menuItemDescription.max;
}

/** Check if display order is valid. */
function isDisplayOrderValid(order: unknown): boolean {
  return (
    typeof order === "number" &&
    Number.isInteger(order) &&
    order >= LIMITS.displayOrder.min &&
    order <= LIMITS.displayOrder.max
  );
}

/** Check if item state is valid. */
function isItemStateValid(state: unknown): boolean {
  return (MENU_ITEM_STATES as readonly unknown[]).includes(state);
}

// ===========================================================================
// In-memory repository model
// ===========================================================================

interface CategoryRecord {
  id: string;
  tenantId: string;
  locationId: string | null;
  name: string;
  displayOrder: number;
}

interface ItemRecord {
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

class MenuRepository {
  private categories: CategoryRecord[] = [];
  private items: ItemRecord[] = [];
  private nextCategoryId = 1;
  private nextItemId = 1;

  getCategoryCount(): number {
    return this.categories.length;
  }

  getItemCount(): number {
    return this.items.length;
  }

  getCategories(): CategoryRecord[] {
    return structuredClone(this.categories);
  }

  getItems(): ItemRecord[] {
    return structuredClone(this.items);
  }

  saveCategory(
    input: unknown,
    editingId: string | null = null,
  ): ReturnType<typeof validateMenuCategory> {
    const existingNames = this.categories.map((c) => ({ id: c.id, name: c.name }));
    const highestOrder = Math.max(0, ...this.categories.map((c) => c.displayOrder));

    const context: MenuContext = {
      existingCategoryNames: existingNames,
      highestCategoryDisplayOrder: highestOrder,
      categoryCount: this.categories.length,
      editingCategoryId: editingId,
      validCategoryIds: this.categories.map((c) => c.id),
      highestItemDisplayOrder: 0,
      itemCount: this.items.length,
      editingItemId: null,
    };

    const result = validateMenuCategory(input, context);
    if (result.ok) {
      if (editingId) {
        const index = this.categories.findIndex((c) => c.id === editingId);
        if (index !== -1) {
          this.categories[index] = {
            ...this.categories[index],
            name: result.value.name,
            displayOrder: result.value.displayOrder,
          };
        }
      } else {
        this.categories.push({
          id: `cat-${this.nextCategoryId++}`,
          tenantId: TENANT_ID,
          locationId: LOCATION_ID,
          name: result.value.name,
          displayOrder: result.value.displayOrder,
        });
      }
    }
    return result;
  }

  saveItem(input: unknown, editingId: string | null = null): ReturnType<typeof validateMenuItem> {
    const existingNames = this.categories.map((c) => ({ id: c.id, name: c.name }));
    const highestCategoryOrder = Math.max(0, ...this.categories.map((c) => c.displayOrder));
    const highestItemOrder = Math.max(0, ...this.items.map((i) => i.displayOrder));

    const context: MenuContext = {
      existingCategoryNames: existingNames,
      highestCategoryDisplayOrder: highestCategoryOrder,
      categoryCount: this.categories.length,
      editingCategoryId: null,
      validCategoryIds: this.categories.map((c) => c.id),
      highestItemDisplayOrder: highestItemOrder,
      itemCount: this.items.length,
      editingItemId: editingId,
    };

    const result = validateMenuItem(input, context);
    if (result.ok) {
      if (editingId) {
        const index = this.items.findIndex((i) => i.id === editingId);
        if (index !== -1) {
          this.items[index] = {
            ...this.items[index],
            categoryId: result.value.categoryId,
            name: result.value.name,
            priceMinor: result.value.priceMinor,
            description: result.value.description,
            displayOrder: result.value.displayOrder,
            state: result.value.state,
          };
        }
      } else {
        this.items.push({
          id: `item-${this.nextItemId++}`,
          tenantId: TENANT_ID,
          locationId: LOCATION_ID,
          categoryId: result.value.categoryId,
          name: result.value.name,
          priceMinor: result.value.priceMinor,
          description: result.value.description,
          displayOrder: result.value.displayOrder,
          state: result.value.state,
        });
      }
    }
    return result;
  }
}

// ===========================================================================
// Generators
// ===========================================================================

/** Whitespace that might surround a field. */
const whitespace = fc.string({
  unit: fc.constantFrom(" ", "\t", "\n", "\r"),
  maxLength: 4,
});

/** A string with surrounding whitespace. */
const fieldWithWhitespace = (maxLength: number) =>
  fc
    .tuple(whitespace, fc.string({ maxLength }), whitespace)
    .map(([lead, body, trail]) => `${lead}${body}${trail}`);

/** Category name arbitrary - concentrated around boundaries. */
const arbCategoryName = fc.oneof(
  // Valid names
  fc.string({ minLength: 1, maxLength: 40 }).map((s) => s || "A"),
  fieldWithWhitespace(40),
  // Boundary cases
  fc.constant("A"), // Min length
  fc.constant("A".repeat(40)), // Max length
  // Invalid cases
  fc.constant(""), // Too short
  fc.constant(" "), // Only whitespace
  fc.constant("A".repeat(41)), // Too long
  fc.constant("A".repeat(100)), // Way too long
  // Case variants
  fc.constantFrom("Appetizers", "APPETIZERS", "appetizers", "  Appetizers  "),
);

/** Item name arbitrary - concentrated around boundaries. */
const arbItemName = fc.oneof(
  // Valid names
  fc.string({ minLength: 1, maxLength: 80 }).map((s) => s || "A"),
  fieldWithWhitespace(80),
  // Boundary cases
  fc.constant("A"), // Min length
  fc.constant("A".repeat(80)), // Max length
  // Invalid cases
  fc.constant(""), // Too short
  fc.constant(" "), // Only whitespace
  fc.constant("A".repeat(81)), // Too long
  fc.constant("A".repeat(200)), // Way too long
);

/** Item price arbitrary - concentrated around boundaries. */
const arbItemPrice: fc.Arbitrary<unknown> = fc.oneof(
  // Valid prices
  fc.integer({ min: 0, max: 10_000_000 }),
  // Boundary cases
  fc.constantFrom(0, 1, 10_000_000),
  // Invalid cases
  fc.constantFrom(-1, -100, 10_000_001, 10_000_000 + 1000),
  fc.double({ min: 0, max: 100 }), // Non-integers
  fc.constantFrom(NaN, Infinity, -Infinity),
  fc.constantFrom(null, undefined, "100", {}, [100]), // Non-numbers
);

/** Item description arbitrary - concentrated around boundaries. */
const arbItemDescription = fc.oneof(
  // Valid descriptions
  fc.constant(undefined), // Should use default
  fc.string({ maxLength: 300 }),
  fieldWithWhitespace(300),
  // Boundary cases
  fc.constant(""),
  fc.constant("A".repeat(300)), // Max length
  // Invalid cases
  fc.constant("A".repeat(301)), // Too long
  fc.constant("A".repeat(1000)), // Way too long
  fc.constantFrom(null, 123, {}, []) as fc.Arbitrary<unknown>, // Non-strings
);

/** Display order arbitrary - concentrated around boundaries. */
const arbDisplayOrder = fc.oneof(
  // Valid orders
  fc.integer({ min: 1, max: 999 }),
  fc.constant(undefined), // Should use default
  // Boundary cases
  fc.constantFrom(1, 999),
  // Invalid cases
  fc.constantFrom(0, -1, 1000, 10000),
  fc.double({ min: 1, max: 999 }), // Non-integers
  fc.constantFrom(null, "1", {}, []) as fc.Arbitrary<unknown>, // Non-numbers
);

/** Item state arbitrary. */
const arbItemState = fc.oneof(
  // Valid states
  fc.constantFrom("available", "unavailable"),
  fc.constant(undefined), // Should use default
  // Invalid states
  fc.constantFrom("hidden", "sold_out", "", "AVAILABLE", null, 123, {}) as fc.Arbitrary<unknown>,
);

/** Category input arbitrary. */
const arbCategoryInput = fc.record({
  name: arbCategoryName as fc.Arbitrary<unknown>,
  displayOrder: arbDisplayOrder,
});

/** Item input arbitrary. */
const arbItemInput = (validCategoryIds: string[]) =>
  fc.record({
    categoryId: fc.oneof(
      fc.constantFrom(...(validCategoryIds.length > 0 ? validCategoryIds : ["cat-1"])),
      fc.constantFrom("", "foreign-cat", "  ", null, undefined, 123) as fc.Arbitrary<unknown>,
    ),
    name: arbItemName as fc.Arbitrary<unknown>,
    priceMinor: arbItemPrice,
    description: arbItemDescription,
    displayOrder: arbDisplayOrder,
    state: arbItemState,
  });

// ===========================================================================
// Property tests
// ===========================================================================

describe("Property 12: Menu validation, defaults, and limits", () => {
  it("category validation: trims and preserves valid fields, reports all invalid fields, rejects duplicates", () => {
    fc.assert(
      fc.property(arbCategoryInput, fc.boolean(), (input, isEdit) => {
        const repo = new MenuRepository();
        const beforeCategories = repo.getCategories();
        const beforeCount = repo.getCategoryCount();

        // Seed with one existing category for duplicate testing
        repo.saveCategory({ name: "Appetizers", displayOrder: 1 });
        const seededCategories = repo.getCategories();
        const seededCount = repo.getCategoryCount();

        const editingId = isEdit && seededCategories.length > 0 ? seededCategories[0].id : null;

        const result = repo.saveCategory(input, editingId);

        const nameValid = isCategoryNameValid(input.name);
        const nameDuplicate = isDuplicateCategoryName(input.name, seededCategories, editingId);
        const orderValid =
          input.displayOrder === undefined || isDisplayOrderValid(input.displayOrder);
        const atCapacity = !isEdit && seededCount >= LIMITS.menuCategoriesPerTenant;

        const shouldSucceed = nameValid && !nameDuplicate && orderValid && !atCapacity;

        expect(result.ok).toBe(shouldSucceed);

        if (result.ok) {
          // Valid fields are trimmed and preserved
          expect(result.value.name).toBe(String(input.name).trim());
          expect(result.value.name.length).toBeGreaterThanOrEqual(LIMITS.menuCategoryName.min);
          expect(result.value.name.length).toBeLessThanOrEqual(LIMITS.menuCategoryName.max);

          if (input.displayOrder === undefined) {
            // Default display order
            expect(result.value.displayOrder).toBeGreaterThanOrEqual(1);
          } else {
            expect(result.value.displayOrder).toBe(input.displayOrder);
          }

          // Category was saved
          const afterCategories = repo.getCategories();
          if (isEdit) {
            expect(afterCategories.length).toBe(seededCount);
          } else {
            expect(afterCategories.length).toBe(seededCount + 1);
          }
        } else {
          // All invalid fields are reported
          expect(result.errors.length).toBeGreaterThan(0);

          if (!nameValid) {
            expect(result.errors.some((e) => e.field === "name")).toBe(true);
          }
          if (nameDuplicate) {
            expect(result.errors.some((e) => e.field === "name")).toBe(true);
          }
          if (!orderValid) {
            expect(result.errors.some((e) => e.field === "displayOrder")).toBe(true);
          }
          if (atCapacity) {
            expect(result.errors.some((e) => e.field === "categoryCount")).toBe(true);
          }

          // Repository unchanged on error
          expect(repo.getCategories()).toEqual(seededCategories);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("item validation: trims fields, defaults state to available and description to empty, reports all invalid fields", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.record({
          categoryId: fc.constantFrom(
            "cat-1",
            "",
            "foreign-cat",
            "  ",
            null,
            undefined,
            123,
          ) as fc.Arbitrary<unknown>,
          name: arbItemName as fc.Arbitrary<unknown>,
          priceMinor: arbItemPrice,
          description: arbItemDescription,
          displayOrder: arbDisplayOrder,
          state: arbItemState,
        }),
        (isEdit, input) => {
          const repo = new MenuRepository();

          // Create a category first
          repo.saveCategory({ name: "Main Dishes", displayOrder: 1 });
          const categories = repo.getCategories();
          const categoryId = categories[0].id;

          // Replace the generated categoryId with a valid one for some cases
          if (typeof input.categoryId === "string" && input.categoryId === "cat-1") {
            input = { ...input, categoryId };
          }

          const seededItems = repo.getItems();
          const seededCount = repo.getItemCount();

          const editingId = isEdit && seededItems.length > 0 ? seededItems[0].id : null;

          const result = repo.saveItem(input, editingId);

          const categoryValid =
            typeof input.categoryId === "string" &&
            input.categoryId.trim().length > 0 &&
            categories.some((c) => c.id === input.categoryId);
          const nameValid = isItemNameValid(input.name);
          const priceValid = isItemPriceValid(input.priceMinor);
          const descriptionValid = isItemDescriptionValid(input.description);
          const orderValid =
            input.displayOrder === undefined || isDisplayOrderValid(input.displayOrder);
          const stateValid = input.state === undefined || isItemStateValid(input.state);
          const atCapacity = !isEdit && seededCount >= LIMITS.menuItemsPerTenant;

          const shouldSucceed =
            categoryValid &&
            nameValid &&
            priceValid &&
            descriptionValid &&
            orderValid &&
            stateValid &&
            !atCapacity;

          expect(result.ok).toBe(shouldSucceed);

          if (result.ok) {
            // Valid fields are trimmed and preserved
            expect(result.value.categoryId).toBe(String(input.categoryId).trim());
            expect(result.value.name).toBe(String(input.name).trim());
            expect(result.value.priceMinor).toBe(input.priceMinor);

            // Description defaults to empty string
            if (input.description === undefined) {
              expect(result.value.description).toBe(DEFAULT_MENU_ITEM_DESCRIPTION);
            } else {
              expect(result.value.description).toBe(String(input.description).trim());
            }

            // State defaults to available
            if (input.state === undefined) {
              expect(result.value.state).toBe(DEFAULT_MENU_ITEM_STATE);
            } else {
              expect(result.value.state).toBe(input.state);
            }

            // Display order has a default
            if (input.displayOrder === undefined) {
              expect(result.value.displayOrder).toBeGreaterThanOrEqual(1);
            } else {
              expect(result.value.displayOrder).toBe(input.displayOrder);
            }

            // Item was saved. Editing only occurs when a stored item exists to
            // target (editingId); otherwise the save creates a new row even when
            // the caller requested an edit.
            const afterItems = repo.getItems();
            if (editingId) {
              expect(afterItems.length).toBe(seededCount);
            } else {
              expect(afterItems.length).toBe(seededCount + 1);
            }
          } else {
            // All invalid fields are reported
            expect(result.errors.length).toBeGreaterThan(0);

            if (!categoryValid) {
              expect(result.errors.some((e) => e.field === "categoryId")).toBe(true);
            }
            if (!nameValid) {
              expect(result.errors.some((e) => e.field === "name")).toBe(true);
            }
            if (!priceValid) {
              expect(result.errors.some((e) => e.field === "priceMinor")).toBe(true);
            }
            if (!descriptionValid) {
              expect(result.errors.some((e) => e.field === "description")).toBe(true);
            }
            if (!orderValid) {
              expect(result.errors.some((e) => e.field === "displayOrder")).toBe(true);
            }
            if (!stateValid) {
              expect(result.errors.some((e) => e.field === "state")).toBe(true);
            }
            if (atCapacity) {
              expect(result.errors.some((e) => e.field === "itemCount")).toBe(true);
            }

            // Repository unchanged on error
            expect(repo.getItems()).toEqual(seededItems);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("enforces hard tenant caps: no operation can exceed 40 categories or 500 items", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 600 }),
        (categoryAttempts, itemAttempts) => {
          const repo = new MenuRepository();

          // Try to create categories up to the limit
          let categoriesCreated = 0;
          for (let i = 0; i < categoryAttempts; i++) {
            const result = repo.saveCategory({
              name: `Category ${i}`,
              displayOrder: i + 1,
            });
            if (result.ok) {
              categoriesCreated++;
            }
          }

          // Categories should never exceed the limit
          expect(categoriesCreated).toBeLessThanOrEqual(LIMITS.menuCategoriesPerTenant);
          expect(repo.getCategoryCount()).toBeLessThanOrEqual(LIMITS.menuCategoriesPerTenant);

          // Try to create items up to the limit (if we have at least one category)
          if (categoriesCreated > 0) {
            const categories = repo.getCategories();
            const categoryId = categories[0].id;

            let itemsCreated = 0;
            for (let i = 0; i < itemAttempts; i++) {
              const result = repo.saveItem({
                categoryId,
                name: `Item ${i}`,
                priceMinor: 1000 + i,
                displayOrder: i + 1,
              });
              if (result.ok) {
                itemsCreated++;
              }
            }

            // Items should never exceed the limit
            expect(itemsCreated).toBeLessThanOrEqual(LIMITS.menuItemsPerTenant);
            expect(repo.getItemCount()).toBeLessThanOrEqual(LIMITS.menuItemsPerTenant);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
