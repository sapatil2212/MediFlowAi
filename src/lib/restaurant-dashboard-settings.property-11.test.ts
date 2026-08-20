/**
 * restaurant-dashboard-settings.property-11.test.ts
 *
 * Property-based suite for dining-area registry invariants (spec task 7.9).
 *
 * Generators build scoped dining-area collections, scoped table collections,
 * and arbitrary insertion permutations. The suite exercises the pure registry
 * helpers exported from `restaurant-settings-model`:
 *   - `orderDiningAreas`             canonical ordering + defensive copy
 *   - `withAssignedDiningTableCounts` scoped assigned-count derivation
 *   - `effectiveDiningAreas`         synthetic/effective `Main` fallback
 *   - `validateDiningArea`           bounds, uniqueness, display-order defaults
 *
 * Against independent reference implementations the property asserts:
 *   - Canonical order (display order, then case-insensitive name, then id) is
 *     deterministic and independent of the input insertion permutation.
 *   - Assigned counts equal the number of matching scoped tables.
 *   - A missing display order defaults to one greater than the tenant maximum
 *     (or one when the tenant holds no other area).
 *   - Case/whitespace variants of an existing tenant name are rejected.
 *   - The effective registry of an empty scope contains exactly synthetic `Main`.
 *   - Ordering round-trips (idempotent) and never mutates its inputs.
 *
 * This module is pure: no I/O, clock, or network dependencies.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  orderDiningAreas,
  withAssignedDiningTableCounts,
  effectiveDiningAreas,
  validateDiningArea,
  EFFECTIVE_MAIN_AREA_ID,
  DEFAULT_DINING_AREA_NAME,
  DEFAULT_DISPLAY_ORDER,
  LIMITS,
  type DiningArea,
  type DiningTableAreaAssignment,
  type AreaContext,
  type LocationScope,
} from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 11: Dining-area registry invariants
// **Validates: Requirements 5.1–5.3, 5.5, 5.6, 5.8, 5.9, 11.1, 11.4**

const NUM_RUNS = 400;

// ===========================================================================
// Independent reference implementations
// ===========================================================================

/** Canonical comparator: display order asc, case-insensitive name asc, id asc. */
function refCompare(
  a: Pick<DiningArea, "id" | "name" | "displayOrder">,
  b: Pick<DiningArea, "id" | "name" | "displayOrder">,
): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function refOrder(rows: readonly DiningArea[]): DiningArea[] {
  return rows.map((row) => ({ ...row })).sort(refCompare);
}

function refNameKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Mirror of `tableMatchesArea` from the production model. */
function refTableMatches(table: DiningTableAreaAssignment, area: DiningArea): boolean {
  if (table.locationId !== area.locationId) return false;
  const areaId = typeof table.areaId === "string" ? table.areaId.trim() : "";
  if (areaId.length > 0) return areaId === area.id;
  const tableAreaKey = refNameKey(table.area);
  if (tableAreaKey === refNameKey(area.name)) return true;
  return area.id === EFFECTIVE_MAIN_AREA_ID && tableAreaKey.length === 0;
}

function refCount(area: DiningArea, tables: readonly DiningTableAreaAssignment[]): number {
  return tables.reduce((n, t) => n + (refTableMatches(t, area) ? 1 : 0), 0);
}

function isValidDisplayOrder(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= LIMITS.displayOrder.min &&
    value <= LIMITS.displayOrder.max
  );
}

// ===========================================================================
// Generators
// ===========================================================================

const LOCATIONS: readonly LocationScope[] = [null, "loc-a", "loc-b"];

const arbLocation: fc.Arbitrary<LocationScope> = fc.constantFrom(...LOCATIONS);

/** Names that collide case-insensitively / with surrounding whitespace. */
const arbAreaName = fc.oneof(
  fc.constantFrom(
    "Main",
    "main",
    "MAIN",
    "  Main  ",
    "Patio",
    "patio",
    "Rooftop",
    "Bar",
    "Terrace",
    "Garden",
    "VIP Lounge",
    "vip lounge",
  ),
  fc.string({ minLength: 1, maxLength: 30 }).map((s) => (s.trim().length > 0 ? s : "Area")),
);

/** A collection of dining areas with unique ids for a single location scope. */
const arbAreas: fc.Arbitrary<DiningArea[]> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 0, maxLength: 8 })
  .chain((ids) =>
    fc.tuple(
      arbLocation,
      fc.tuple(
        ...ids.map((id) =>
          fc.record({
            id: fc.constant(`area-${id}`),
            name: arbAreaName,
            displayOrder: fc.integer({ min: LIMITS.displayOrder.min, max: LIMITS.displayOrder.max }),
          }),
        ),
      ),
    ),
  )
  .map(([locationId, rows]) => {
    // A valid tenant+location registry holds case-insensitively unique names
    // (enforced by `validateDiningArea`). Constrain the generator to that valid
    // input space: keep the first row per normalised name key so a blank-areaId,
    // name-matched table can never be assigned to two distinct stored areas.
    const seen = new Set<string>();
    const unique: { id: string; name: string; displayOrder: number }[] = [];
    for (const row of rows as { id: string; name: string; displayOrder: number }[]) {
      const key = row.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }
    return unique.map((row) => ({
      ...row,
      tableCount: 0,
      locationId,
    }));
  });

/** A table assignment that may reference an area by id, by name, or be blank. */
const arbTable = (areas: readonly DiningArea[], index: number): fc.Arbitrary<DiningTableAreaAssignment> =>
  fc.record({
    id: fc.constant(`table-${index}`),
    locationId: arbLocation,
    areaId: fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(""),
      fc.constant("  "),
      areas.length > 0 ? fc.constantFrom(...areas.map((a) => a.id)) : fc.constant("area-none"),
      fc.constant("area-ghost"),
    ),
    area: fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(""),
      fc.constant("  "),
      areas.length > 0 ? fc.constantFrom(...areas.map((a) => a.name)) : fc.constant("Main"),
      fc.constantFrom("Main", "PATIO", "  rooftop  "),
    ),
  });

const arbTables = (areas: readonly DiningArea[]): fc.Arbitrary<DiningTableAreaAssignment[]> =>
  fc.nat({ max: 12 }).chain((count) =>
    count === 0
      ? fc.constant([])
      : fc.tuple(...Array.from({ length: count }, (_, i) => arbTable(areas, i))),
  );

/** A permutation of an array's indices. */
function permutations<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

// ===========================================================================
// Property tests
// ===========================================================================

describe("Feature: restaurant-dashboard-settings, Property 11: Dining-area registry invariants", () => {
  it("orders areas by display order, then case-insensitive name, then id, independent of insertion permutation", () => {
    fc.assert(
      fc.property(
        arbAreas.chain((areas) => fc.tuple(fc.constant(areas), permutations(areas))),
        ([areas, shuffled]) => {
          const expected = refOrder(areas);
          const ordered = orderDiningAreas(areas);
          const orderedFromShuffled = orderDiningAreas(shuffled);

          // Matches the independent canonical order.
          expect(ordered.map((a) => a.id)).toEqual(expected.map((a) => a.id));

          // Order is independent of the insertion permutation.
          expect(orderedFromShuffled.map((a) => a.id)).toEqual(ordered.map((a) => a.id));

          // Adjacent pairs respect the ordering contract.
          for (let i = 1; i < ordered.length; i += 1) {
            const prev = ordered[i - 1];
            const cur = ordered[i];
            expect(prev.displayOrder).toBeLessThanOrEqual(cur.displayOrder);
            if (prev.displayOrder === cur.displayOrder) {
              const byName = prev.name.localeCompare(cur.name, undefined, { sensitivity: "base" });
              expect(byName).toBeLessThanOrEqual(0);
              if (byName === 0) {
                expect(prev.id < cur.id).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("ordering is idempotent and never mutates its input rows", () => {
    fc.assert(
      fc.property(arbAreas, (areas) => {
        const snapshot = structuredClone(areas);
        const once = orderDiningAreas(areas);
        const twice = orderDiningAreas(once);

        // Input untouched (no mutation, no reordering in place).
        expect(areas).toEqual(snapshot);

        // Round-trip stability: re-ordering an ordered list is a no-op.
        expect(twice).toEqual(once);

        // Returns fresh row objects, not the same references.
        once.forEach((row) => {
          expect(areas).not.toContain(row);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("recomputes assigned counts equal to the matching scoped tables and returns ordered fresh rows", () => {
    fc.assert(
      fc.property(
        arbAreas.chain((areas) => fc.tuple(fc.constant(areas), arbTables(areas))),
        ([areas, tables]) => {
          const areasSnapshot = structuredClone(areas);
          const tablesSnapshot = structuredClone(tables);

          const result = withAssignedDiningTableCounts(areas, tables);

          // Inputs are never mutated.
          expect(areas).toEqual(areasSnapshot);
          expect(tables).toEqual(tablesSnapshot);

          // Same set of areas, in canonical order.
          const expectedOrder = refOrder(areas).map((a) => a.id);
          expect(result.map((a) => a.id)).toEqual(expectedOrder);

          // Each count equals the independent reference count.
          for (const area of result) {
            const source = areas.find((a) => a.id === area.id)!;
            expect(area.tableCount).toBe(refCount(source, tables));
            expect(area.name).toBe(source.name);
            expect(area.displayOrder).toBe(source.displayOrder);
            expect(area.locationId).toBe(source.locationId);
          }

          // Total assigned across areas never exceeds the table count.
          const totalAssigned = result.reduce((n, a) => n + a.tableCount, 0);
          expect(totalAssigned).toBeLessThanOrEqual(tables.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("falls back to exactly one synthetic effective `Main` when the scope has no stored areas", () => {
    fc.assert(
      fc.property(arbLocation, arbTables([]), (locationId, tables) => {
        const effective = effectiveDiningAreas([], tables, locationId);

        // Exactly one synthetic Main area.
        expect(effective).toHaveLength(1);
        const main = effective[0];
        expect(main.id).toBe(EFFECTIVE_MAIN_AREA_ID);
        expect(main.name).toBe(DEFAULT_DINING_AREA_NAME);
        expect(main.displayOrder).toBe(DEFAULT_DISPLAY_ORDER);
        expect(main.locationId).toBe(locationId);

        // Its assigned count matches the reference for the synthetic Main.
        const syntheticMain: DiningArea = {
          id: EFFECTIVE_MAIN_AREA_ID,
          name: DEFAULT_DINING_AREA_NAME,
          displayOrder: DEFAULT_DISPLAY_ORDER,
          tableCount: 0,
          locationId,
        };
        expect(main.tableCount).toBe(refCount(syntheticMain, tables));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns stored areas (never synthetic Main) with derived counts when the scope has areas", () => {
    fc.assert(
      fc.property(
        arbAreas
          .filter((areas) => areas.length > 0)
          .chain((areas) => fc.tuple(fc.constant(areas), arbTables(areas))),
        ([areas, tables]) => {
          const effective = effectiveDiningAreas(areas, tables, areas[0].locationId);
          const derived = withAssignedDiningTableCounts(areas, tables);

          // Stored scope short-circuits the synthetic fallback entirely.
          expect(effective).toEqual(derived);
          expect(effective.some((a) => a.id === EFFECTIVE_MAIN_AREA_ID)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("defaults a missing display order to one greater than the tenant maximum, or one when empty", () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: LIMITS.displayOrder.max }), { nil: null }),
        fc.string({ minLength: 1, maxLength: 30 }).map((s) => (s.trim().length > 0 ? s : "Area")),
        (highest, rawName) => {
          const context: AreaContext = { existingNames: [], highestDisplayOrder: highest };
          const result = validateDiningArea({ name: rawName }, context);

          const expectedDefault = highest == null ? DEFAULT_DISPLAY_ORDER : highest + 1;

          if (isValidDisplayOrder(expectedDefault)) {
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.value.displayOrder).toBe(expectedDefault);
              expect(result.value.name).toBe(rawName.trim());
            }
          } else {
            // highest === 999 pushes the default out of range and is rejected.
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.errors.some((e) => e.field === "displayOrder")).toBe(true);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects case/whitespace variants of an existing tenant name and accepts genuinely new names", () => {
    fc.assert(
      fc.property(
        fc.record({
          existingName: fc.constantFrom("Main", "Patio", "Rooftop", "VIP Lounge"),
          submitted: arbAreaName,
          editSelf: fc.boolean(),
        }),
        ({ existingName, submitted, editSelf }) => {
          const existingId = "area-existing";
          const context: AreaContext = {
            existingNames: [{ id: existingId, name: existingName }],
            editingId: editSelf ? existingId : null,
            highestDisplayOrder: 3,
          };

          const result = validateDiningArea({ name: submitted, displayOrder: 5 }, context);

          const trimmed = submitted.trim();
          const nameValid =
            trimmed.length >= LIMITS.areaName.min && trimmed.length <= LIMITS.areaName.max;
          const key = trimmed.toLowerCase();
          const collidesWithExisting =
            key.length > 0 && key === existingName.trim().toLowerCase() && !editSelf;

          const shouldSucceed = nameValid && !collidesWithExisting;
          expect(result.ok).toBe(shouldSucceed);

          if (result.ok) {
            expect(result.value.name).toBe(trimmed);
            expect(result.value.displayOrder).toBe(5);
          } else {
            expect(result.errors.some((e) => e.field === "name")).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("uniqueness comparison is case-insensitive and trim-insensitive across the whole tenant", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("Main", "Patio", "Rooftop", "Terrace"),
        fc.constantFrom(
          (n: string) => n.toUpperCase(),
          (n: string) => n.toLowerCase(),
          (n: string) => `  ${n}  `,
          (n: string) => `\t${n}\n`,
        ),
        (baseName, transform) => {
          const context: AreaContext = {
            existingNames: [{ id: "area-1", name: baseName }],
            editingId: null,
            highestDisplayOrder: 1,
          };
          const variant = transform(baseName);
          const result = validateDiningArea({ name: variant }, context);

          // Every case/whitespace variant collides with the stored tenant name.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.errors.some((e) => e.field === "name")).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
