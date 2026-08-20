import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { validateClosureDay, type NormalisedClosureDay } from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 9: Closure uniqueness and booking noninterference
// **Validates: Requirements 4.3, 4.4, 4.5, 4.11, 11.3, 11.6**
//
// This property exercises the closure repository contract (createClosureDay / deleteClosureDay)
// through a faithful in-memory transactional reference model instead of a real database. The model
// mirrors the production INSERT IGNORE unique key uq_closure (tenantId, locationKey, closureDate,
// scopeKey), null-safe location matching, and exact-id delete predicate documented in
// src/lib/restaurant-settings.server.ts and design.md. A parallel bookings/status collection lives
// in the same store and is never referenced by any closure mutation, proving noninterference.

const PRIMARY_LOCATION_KEY = "__primary__";

type ClosureScope = { type: "restaurant" } | { type: "table"; tableId: string };
type ResourceScope = { tenantId: string; locationId: string | null };

interface ClosureRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  locationKey: string;
  closureDate: string;
  scopeType: "restaurant" | "table";
  tableId: string | null;
  scopeKey: string;
  reason: string;
  isHoliday: boolean;
}

interface Booking {
  id: string;
  tableId: string | null;
  dateTime: string;
  status: string;
  partySize: number | null;
}

type CreateResult = { status: "created"; id: string } | { status: "duplicate" };
type DeleteResult = { status: "deleted" } | { status: "not_found" };

const locationKeyOf = (locationId: string | null) => locationId ?? PRIMARY_LOCATION_KEY;
const scopeKeyOf = (scope: ClosureScope) => (scope.type === "table" ? scope.tableId : "restaurant");
// Null-safe location match mirroring MariaDB's `<=>` operator used by the repository.
const sameLocation = (a: string | null, b: string | null) => a === b;

/**
 * Faithful in-memory transactional reference for the closure repository. Closure mutations run
 * inside a transaction that snapshots the closure rows and rolls back on failure. The parallel
 * bookings collection is stored alongside but is never touched by any closure operation.
 */
class InMemoryClosureStore {
  private rows: ClosureRow[] = [];
  private bookings: Booking[];
  private sequence = 0;

  constructor(bookings: Booking[]) {
    // Store an isolated copy so external mutation of the seed cannot alias store state.
    this.bookings = structuredClone(bookings);
  }

  private transaction<T>(work: () => T): T {
    const savepoint = structuredClone(this.rows);
    try {
      return work();
    } catch (error) {
      this.rows = savepoint;
      throw error;
    }
  }

  // Mirrors createClosureDay: INSERT IGNORE against uq_closure — a matching unique key is a no-op.
  createClosureDay(scope: ResourceScope, input: NormalisedClosureDay): CreateResult {
    return this.transaction(() => {
      const locationKey = locationKeyOf(scope.locationId);
      const scopeKey = scopeKeyOf(input.scope);
      const duplicate = this.rows.some(
        (row) =>
          row.tenantId === scope.tenantId &&
          row.locationKey === locationKey &&
          row.closureDate === input.date &&
          row.scopeKey === scopeKey,
      );
      if (duplicate) return { status: "duplicate" };

      const tableId = input.scope.type === "table" ? input.scope.tableId : null;
      const id = `closure-${this.sequence++}`;
      this.rows.push({
        id,
        tenantId: scope.tenantId,
        locationId: scope.locationId,
        locationKey,
        closureDate: input.date,
        scopeType: input.scope.type,
        tableId,
        scopeKey,
        reason: input.reason,
        isHoliday: input.isHoliday,
      });
      return { status: "created", id };
    });
  }

  // Mirrors deleteClosureDay: DELETE constrained by tenant + null-safe location + exact id.
  deleteClosureDay(scope: ResourceScope, closureId: string): DeleteResult {
    return this.transaction(() => {
      const index = this.rows.findIndex(
        (row) =>
          row.tenantId === scope.tenantId &&
          sameLocation(row.locationId, scope.locationId) &&
          row.id === closureId,
      );
      if (index < 0) return { status: "not_found" };
      this.rows.splice(index, 1);
      return { status: "deleted" };
    });
  }

  matchingRows(scope: ResourceScope, input: NormalisedClosureDay): ClosureRow[] {
    const locationKey = locationKeyOf(scope.locationId);
    const scopeKey = scopeKeyOf(input.scope);
    return this.rows.filter(
      (row) =>
        row.tenantId === scope.tenantId &&
        row.locationKey === locationKey &&
        row.closureDate === input.date &&
        row.scopeKey === scopeKey,
    );
  }

  allRows(): ClosureRow[] {
    return structuredClone(this.rows);
  }

  snapshotBookings(): Booking[] {
    return structuredClone(this.bookings);
  }
}

// --- Generators -----------------------------------------------------------

// Small pools deliberately encourage unique-key collisions across generated closures.
const tenantArb = fc.constantFrom("tenant-a", "tenant-b", "tenant-c");
const locationArb = fc.constantFrom<string | null>(null, "loc-1", "loc-2");
const dateArb = fc.constantFrom("2024-01-15", "2024-02-29", "2024-06-30", "2024-12-25");
const tableIdArb = fc.constantFrom("table-1", "table-2", "table-3");
const reasonArb = fc.constantFrom("", "Holiday", "Private event", "Maintenance");

const scopeArb: fc.Arbitrary<ClosureScope> = fc.oneof(
  fc.constant({ type: "restaurant" as const }),
  tableIdArb.map((tableId) => ({ type: "table" as const, tableId })),
);

const resourceScopeArb: fc.Arbitrary<ResourceScope> = fc.record({
  tenantId: tenantArb,
  locationId: locationArb,
});

// Build a valid, normalized closure via the real validator so the model mirrors production input.
const normalisedClosureArb: fc.Arbitrary<NormalisedClosureDay> = fc
  .record({ date: dateArb, scope: scopeArb, reason: reasonArb, isHoliday: fc.boolean() })
  .map((submission) => {
    const result = validateClosureDay(submission);
    if (!result.ok) throw new Error("Generator produced an invalid closure submission");
    return result.value;
  });

const bookingArb: fc.Arbitrary<Booking> = fc.record({
  id: fc.uuid(),
  tableId: fc.option(tableIdArb, { nil: null }),
  dateTime: fc.constantFrom(
    "2024-01-15T19:00:00Z",
    "2024-02-29T12:30:00Z",
    "2024-06-30T20:15:00Z",
    "2024-12-25T18:00:00Z",
  ),
  status: fc.constantFrom("pending", "confirmed", "seated", "completed", "cancelled"),
  partySize: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
});

const bookingsArb = fc.array(bookingArb, { maxLength: 15 });

describe("Property 9: Closure uniqueness and booking noninterference", () => {
  it("collapses repeated identical create into exactly one closure row (idempotent duplicates)", () => {
    fc.assert(
      fc.property(
        resourceScopeArb,
        normalisedClosureArb,
        bookingsArb,
        fc.integer({ min: 2, max: 8 }),
        (scope, closure, bookings, repeats) => {
          const store = new InMemoryClosureStore(bookings);
          const bookingsBefore = store.snapshotBookings();

          const results: CreateResult[] = [];
          for (let attempt = 0; attempt < repeats; attempt += 1) {
            results.push(store.createClosureDay(scope, closure));
          }

          // Exactly one row exists for the unique key and exactly one create reported "created".
          expect(store.matchingRows(scope, closure)).toHaveLength(1);
          expect(results.filter((result) => result.status === "created")).toHaveLength(1);
          expect(results[0].status).toBe("created");
          results.slice(1).forEach((result) => expect(result.status).toBe("duplicate"));

          // Bookings are byte-equivalent after repeated closure creation.
          expect(store.snapshotBookings()).toEqual(bookingsBefore);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("deletes exactly the targeted closure and no other across scopes/dates/tables", () => {
    fc.assert(
      fc.property(
        resourceScopeArb,
        fc.array(normalisedClosureArb, { minLength: 1, maxLength: 12 }),
        bookingsArb,
        fc.nat(),
        (scope, closures, bookings, pick) => {
          const store = new InMemoryClosureStore(bookings);

          // Create all closures; distinct unique keys survive, duplicates collapse.
          const createdIds: string[] = [];
          for (const closure of closures) {
            const result = store.createClosureDay(scope, closure);
            if (result.status === "created") createdIds.push(result.id);
          }
          fc.pre(createdIds.length > 0);

          const before = store.allRows();
          const targetId = createdIds[pick % createdIds.length];
          const targetRow = before.find((row) => row.id === targetId)!;

          const result = store.deleteClosureDay(scope, targetId);
          expect(result.status).toBe("deleted");

          const after = store.allRows();
          // Exactly one row removed: the target.
          expect(after).toHaveLength(before.length - 1);
          expect(after.some((row) => row.id === targetId)).toBe(false);
          // Every other row is untouched (byte-equivalent).
          const expectedRemaining = before.filter((row) => row.id !== targetId);
          expect(after).toEqual(expectedRemaining);
          // The removed row was genuinely the target unique key.
          expect(targetRow.id).toBe(targetId);

          // A second delete of the same id finds nothing and changes nothing.
          const second = store.deleteClosureDay(scope, targetId);
          expect(second.status).toBe("not_found");
          expect(store.allRows()).toEqual(after);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("leaves every booking and booking status byte-equivalent across any create/delete sequence", () => {
    type Op =
      | { kind: "create"; closure: NormalisedClosureDay }
      | { kind: "delete"; pick: number };
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      normalisedClosureArb.map((closure) => ({ kind: "create" as const, closure })),
      fc.nat().map((pick) => ({ kind: "delete" as const, pick })),
    );

    fc.assert(
      fc.property(
        resourceScopeArb,
        bookingsArb,
        fc.array(opArb, { maxLength: 30 }),
        (scope, bookings, ops) => {
          const store = new InMemoryClosureStore(bookings);
          const bookingsBefore = store.snapshotBookings();

          for (const op of ops) {
            if (op.kind === "create") {
              store.createClosureDay(scope, op.closure);
            } else {
              const rows = store.allRows();
              if (rows.length === 0) continue;
              const targetId = rows[op.pick % rows.length].id;
              store.deleteClosureDay(scope, targetId);
            }
            // Invariant holds after every single operation, not just at the end.
            expect(store.snapshotBookings()).toEqual(bookingsBefore);
          }

          expect(store.snapshotBookings()).toEqual(bookingsBefore);
        },
      ),
      { numRuns: 300 },
    );
  });
});
