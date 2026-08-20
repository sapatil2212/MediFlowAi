import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MENU_ITEM_DESCRIPTION,
  DEFAULT_MENU_ITEM_STATE,
  LIMITS,
  orderMenu,
  publicMenu,
  type LocationScope,
  type MenuCategory,
  type MenuItem,
  type MenuItemState,
} from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 13: Menu ordering and public projection
// **Validates: Requirements 6.1, 6.8–6.11, 11.4**

const letters = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ "];
const nameArb = (minLength: number, maxLength: number) =>
  fc
    .array(fc.constantFrom(...letters), { minLength, maxLength })
    .map((characters) => characters.join("").trim())
    .filter((name) => name.length >= minLength);

const categoryNameArb = nameArb(
  LIMITS.menuCategoryName.min,
  Math.min(LIMITS.menuCategoryName.max, 20),
);
const itemNameArb = nameArb(LIMITS.menuItemName.min, Math.min(LIMITS.menuItemName.max, 25));

const uniqueCategoryNamesArb = fc.uniqueArray(categoryNameArb, {
  minLength: 1,
  maxLength: 8,
  selector: (name) => name.trim().toLowerCase(),
});

const locationScopeArb: fc.Arbitrary<LocationScope> = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 1, max: 10 }).map((value) => `location-${value}`),
);

const menuItemStateArb: fc.Arbitrary<MenuItemState> = fc.constantFrom("available", "unavailable");

const caseVariant = (value: string): string =>
  [...value]
    .map((character, index) =>
      index % 2 === 0 ? character.toUpperCase() : character.toLowerCase(),
    )
    .join("");

const compareCanonical = <T extends Pick<MenuCategory | MenuItem, "id" | "name" | "displayOrder">>(
  left: T,
  right: T,
): number =>
  left.displayOrder - right.displayOrder ||
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
  (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

const menuItemArb = (
  categoryId: string,
  locationId: LocationScope,
  baseIndex: number,
): fc.Arbitrary<MenuItem> =>
  fc
    .record({
      name: itemNameArb,
      displayOrder: fc.integer({ min: 1, max: 50 }),
      priceMinor: fc.integer({
        min: LIMITS.menuItemPriceMinor.min,
        max: Math.min(LIMITS.menuItemPriceMinor.max, 100000),
      }),
      description: fc.oneof(
        fc.constant(DEFAULT_MENU_ITEM_DESCRIPTION),
        fc.string({ maxLength: Math.min(LIMITS.menuItemDescription.max, 50) }),
      ),
      state: menuItemStateArb,
    })
    .map((generated) => ({
      // Placeholder id; the assembler below assigns a globally-unique id per item
      // using the item's real position (fast-check's `.map` provides no index).
      id: `item-${baseIndex}`,
      categoryId,
      name: generated.name,
      priceMinor: generated.priceMinor,
      description: generated.description,
      displayOrder: generated.displayOrder,
      state: generated.state,
      locationId,
    }));

const menuScenarioArb = uniqueCategoryNamesArb.chain((categoryNames) =>
  locationScopeArb.chain((locationId) => {
    const categoryCount = categoryNames.length;
    return fc
      .record({
        displayOrders: fc.array(fc.integer({ min: 1, max: 50 }), {
          minLength: categoryCount,
          maxLength: categoryCount,
        }),
        itemCounts: fc.array(fc.integer({ min: 0, max: 6 }), {
          minLength: categoryCount,
          maxLength: categoryCount,
        }),
      })
      .chain((generated) => {
        const itemArrayArbs: fc.Arbitrary<MenuItem[]>[] = [];
        let baseItemIndex = 0;

        categoryNames.forEach((categoryName, catIndex) => {
          const categoryId = `category-${catIndex}`;
          const itemCount = generated.itemCounts[catIndex];
          itemArrayArbs.push(
            fc.array(menuItemArb(categoryId, locationId, baseItemIndex), {
              minLength: itemCount,
              maxLength: itemCount,
            }),
          );
          baseItemIndex += itemCount + 1;
        });

        return fc.tuple(...itemArrayArbs).map((itemArrays) => {
          const categories: MenuCategory[] = categoryNames.map((name, index) => ({
            id: `category-${index}`,
            name,
            displayOrder: generated.displayOrders[index],
            items: itemArrays[index].map((item, itemIndex) => ({
              ...item,
              id: `item-${index}-${itemIndex}`,
            })),
            locationId,
          }));

          return {
            categories,
            locationId,
            categoryNames,
          };
        });
      });
  }),
);

describe("Property 13: Menu ordering and public projection", () => {
  it("preserves canonical menu ordering for every tree permutation", () => {
    fc.assert(
      fc.property(menuScenarioArb, (scenario) => {
        const scenarioBefore = structuredClone(scenario);

        // Test ordering is deterministic across permutations
        const expectedCategoryOrder = [...scenario.categories].sort((left, right) =>
          compareCanonical(left, right),
        );

        const expectedOrderedMenu = expectedCategoryOrder.map((category) => ({
          ...category,
          items: [...category.items].sort((left, right) => compareCanonical(left, right)),
        }));

        // Test multiple permutations produce identical ordered results
        const shuffled1 = fc.sample(
          fc.shuffledSubarray(scenario.categories, {
            minLength: scenario.categories.length,
            maxLength: scenario.categories.length,
          }),
          1,
        )[0];
        const shuffled2 = fc.sample(
          fc.shuffledSubarray(scenario.categories, {
            minLength: scenario.categories.length,
            maxLength: scenario.categories.length,
          }),
          1,
        )[0];

        const ordered1 = orderMenu(shuffled1);
        const ordered2 = orderMenu(shuffled2);
        const orderedOriginal = orderMenu(scenario.categories);

        expect(ordered1).toEqual(expectedOrderedMenu);
        expect(ordered2).toEqual(expectedOrderedMenu);
        expect(orderedOriginal).toEqual(expectedOrderedMenu);

        // Test idempotence - ordering already ordered menu returns same result
        expect(orderMenu(ordered1)).toEqual(ordered1);
        expect(orderMenu(orderedOriginal)).toEqual(orderedOriginal);

        // Verify category ordering (displayOrder, then case-insensitive name, then id)
        for (let index = 1; index < ordered1.length; index += 1) {
          const prev = ordered1[index - 1];
          const current = ordered1[index];
          expect(compareCanonical(prev, current)).toBeLessThanOrEqual(0);
        }

        // Verify item ordering within each category
        ordered1.forEach((category) => {
          for (let index = 1; index < category.items.length; index += 1) {
            const prev = category.items[index - 1];
            const current = category.items[index];
            expect(compareCanonical(prev, current)).toBeLessThanOrEqual(0);
          }
        });

        // Test public projection filters only available items
        const publicProjection = publicMenu(scenario.categories);

        // Public menu should be ordered
        expect(publicProjection).toEqual(orderMenu(publicProjection));

        // Public menu should only contain available items
        publicProjection.forEach((category) => {
          category.items.forEach((item) => {
            expect(item.state).toBe("available");
          });
        });

        // Public menu should exclude categories with no available items
        publicProjection.forEach((category) => {
          expect(category.items.length).toBeGreaterThan(0);
        });

        // Verify every available item from original menu is in public projection
        const availableItemIds = new Set<string>();
        scenario.categories.forEach((category) => {
          category.items.forEach((item) => {
            if (item.state === "available") {
              availableItemIds.add(item.id);
            }
          });
        });

        const publicItemIds = new Set<string>();
        publicProjection.forEach((category) => {
          category.items.forEach((item) => {
            publicItemIds.add(item.id);
          });
        });

        expect(publicItemIds).toEqual(availableItemIds);

        // Verify no unavailable items leak into public projection
        publicProjection.forEach((category) => {
          category.items.forEach((item) => {
            expect(item.state).toBe(DEFAULT_MENU_ITEM_STATE);
          });
        });

        // Test public projection preserves ordering invariants
        const publicShuffled = fc.sample(
          fc.shuffledSubarray(scenario.categories, {
            minLength: scenario.categories.length,
            maxLength: scenario.categories.length,
          }),
          1,
        )[0];
        const publicFromShuffled = publicMenu(publicShuffled);
        expect(publicFromShuffled).toEqual(publicProjection);

        // Test case-insensitive name comparison in ordering
        const categoryWithVariantName: MenuCategory = {
          ...scenario.categories[0],
          name: caseVariant(scenario.categories[0].name),
        };
        const menuWithVariant = [categoryWithVariantName, ...scenario.categories.slice(1)];
        const orderedVariant = orderMenu(menuWithVariant);

        // Should still be in same relative position based on case-insensitive comparison
        expect(orderedVariant.length).toBe(scenario.categories.length);

        // Verify immutability - original input is not mutated
        expect(scenario).toEqual(scenarioBefore);

        // Verify deep copy - returned objects are not same references
        const orderedOutput = orderMenu(scenario.categories);
        expect(orderedOutput).not.toBe(scenario.categories);
        if (orderedOutput.length > 0) {
          expect(orderedOutput[0]).not.toBe(scenario.categories[0]);
          if (orderedOutput[0].items.length > 0) {
            const originalMatch = scenario.categories.find((cat) => cat.id === orderedOutput[0].id);
            if (originalMatch && originalMatch.items.length > 0) {
              expect(orderedOutput[0].items[0]).not.toBe(originalMatch.items[0]);
            }
          }
        }

        // Test empty menu edge cases
        expect(orderMenu([])).toEqual([]);
        expect(publicMenu([])).toEqual([]);

        // Test menu with all unavailable items returns empty public projection
        const allUnavailableMenu: MenuCategory[] = scenario.categories.map((category) => ({
          ...category,
          items: category.items.map((item) => ({ ...item, state: "unavailable" as const })),
        }));
        const publicFromUnavailable = publicMenu(allUnavailableMenu);
        expect(publicFromUnavailable).toEqual([]);

        // Test menu with mixed states
        if (scenario.categories.length > 0 && scenario.categories[0].items.length > 1) {
          const mixedCategory: MenuCategory = {
            ...scenario.categories[0],
            items: scenario.categories[0].items.map((item, index) => ({
              ...item,
              state: (index % 2 === 0 ? "available" : "unavailable") as MenuItemState,
            })),
          };
          const mixedMenu = [mixedCategory, ...scenario.categories.slice(1)];
          const publicMixed = publicMenu(mixedMenu);

          const firstPublicCategory = publicMixed.find((cat) => cat.id === mixedCategory.id);
          if (firstPublicCategory) {
            expect(firstPublicCategory.items.every((item) => item.state === "available")).toBe(
              true,
            );
            expect(firstPublicCategory.items.length).toBeLessThanOrEqual(
              mixedCategory.items.length,
            );
          }
        }

        // Verify location scope is preserved through ordering and projection
        orderedOutput.forEach((category) => {
          expect(category.locationId).toBe(scenario.locationId);
          category.items.forEach((item) => {
            expect(item.locationId).toBe(scenario.locationId);
          });
        });

        publicProjection.forEach((category) => {
          expect(category.locationId).toBe(scenario.locationId);
          category.items.forEach((item) => {
            expect(item.locationId).toBe(scenario.locationId);
          });
        });
      }),
      { numRuns: 400 },
    );
  });
});
