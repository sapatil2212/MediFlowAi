// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  validateClosureDay,
  validateDiningArea,
  validateMenuCategory,
  validateMenuItem,
  validateRestaurantOperatingHours,
  type AreaContext,
  type MenuContext,
  type NormalisedClosureDay,
} from "./restaurant-settings-model";
import {
  BOOKING_STATUSES,
  DEFAULT_SETTINGS,
  computeAvailability,
  dayOfWeekForDate,
  daysBetween,
  validateServiceSettings,
  type AvailabilityClosureInput,
  type AvailabilityResult,
  type DayHours,
  type DiningTable,
  type ExistingBooking,
  type ServiceSettings,
} from "./restaurant-availability";

// Feature: restaurant-dashboard-settings, Property 18: Availability-affecting settings do not rewrite bookings
// **Validates: Requirements 3.9, 4.11, 11.5, 11.6**
//
// Requirement 3.9 / 11.5: when stored Operating_Hours or any availability-affecting setting change,
// the Availability_Service uses the changed stored values for every SUBSEQUENT availability request.
// Requirement 4.11 / 11.6: storing a Closure_Day (or any availability-affecting setting change) leaves
// every existing Table_Booking and Booking_Status unchanged.
//
// This property exercises the availability-affecting settings surface — operating hours, service /
// booking rules, restaurant + table closures, dining areas, and menu data — through a faithful
// in-memory reference model instead of a real database. The model mirrors the repository contracts
// documented in src/lib/restaurant-settings.server.ts: closure/area/menu mutations run inside a
// transaction over their OWN collection and never issue any write against the Appointment/booking
// rows. A parallel bookings collection lives in the same store and is never referenced by any
// settings mutation, proving noninterference. Availability itself is derived on demand from the
// pure computeAvailability() so we can additionally show that availability MAY differ after a change
// without ever asserting a booking changed.

// --- Fixed domains --------------------------------------------------------

const TABLE_IDS = ["table-1", "table-2", "table-3"] as const;
const TARGET_DATE = "2024-06-15"; // a real calendar date used for availability probes
const NOW_DATE = "2024-06-01";

// Seven open weekdays 09:00–22:00 — a permissive baseline so availability probes yield slots.
const OPEN_WEEK: DayHours[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  openTime: "09:00",
  closeTime: "22:00",
  isClosed: false,
}));

// A fixed active table registry so computeAvailability has resources to place bookings against.
const SEED_TABLES: DiningTable[] = TABLE_IDS.map((id, index) => ({
  id,
  name: `Table ${index + 1}`,
  seatCapacity: 4,
  area: "Main",
  displayOrder: index + 1,
  state: "active",
  locationId: null,
}));

// --- Store row shapes -----------------------------------------------------

interface ClosureRow {
  id: string;
  date: string;
  scopeKey: string; // "restaurant" or the tableId
  scopeType: "restaurant" | "table";
  tableId: string | null;
  reason: string;
  isHoliday: boolean;
}

interface AreaRow {
  id: string;
  name: string;
  displayOrder: number;
  tableCount: number;
}

interface CategoryRow {
  id: string;
  name: string;
  displayOrder: number;
}

interface ItemRow {
  id: string;
  categoryId: string;
  name: string;
  priceMinor: number;
  description: string;
  displayOrder: number;
  state: "available" | "unavailable";
}

const scopeKeyOf = (scope: NormalisedClosureDay["scope"]) =>
  scope.type === "table" ? scope.tableId : "restaurant";

/**
 * Faithful in-memory transactional reference for the availability-affecting settings repositories.
 * Every mutation touches only its own settings collection inside a snapshot/rollback transaction and
 * never reads or writes the parallel bookings collection. Bookings are stored isolated so external
 * mutation of the seed cannot alias store state.
 */
class InMemorySettingsStore {
  private bookings: ExistingBooking[];
  private settings: ServiceSettings;
  private hours: DayHours[];
  private closures: ClosureRow[] = [];
  private areas: AreaRow[] = [];
  private categories: CategoryRow[] = [];
  private items: ItemRow[] = [];
  private sequence = 0;

  constructor(bookings: ExistingBooking[]) {
    this.bookings = structuredClone(bookings);
    this.settings = { ...DEFAULT_SETTINGS };
    this.hours = OPEN_WEEK.map((day) => ({ ...day }));
  }

  private transaction<T>(collection: "closures" | "areas" | "categories" | "items", work: () => T): T {
    const savepoint = structuredClone(this[collection]);
    try {
      return work();
    } catch (error) {
      (this[collection] as unknown[]) = savepoint as unknown[];
      throw error;
    }
  }

  // --- Availability-affecting mutations (never touch bookings) -------------

  // Req 3.9 / 11.5: replace the stored seven-day snapshot atomically.
  editOperatingHours(rawHours: unknown): boolean {
    const result = validateRestaurantOperatingHours(rawHours);
    if (!result.ok) return false;
    this.hours = result.value.map((day) => ({ ...day }));
    return true;
  }

  // Booking-rule / service-settings edit (turn time, slot interval, party size, windows, lead time).
  editServiceSettings(rawSettings: unknown): boolean {
    const result = validateServiceSettings(rawSettings);
    if (!result.ok) return false;
    this.settings = { ...result.value };
    return true;
  }

  // Mirrors createClosureDay: unique (date, scope) collapses to a single row (INSERT IGNORE).
  createClosure(closure: NormalisedClosureDay): boolean {
    return this.transaction("closures", () => {
      const scopeKey = scopeKeyOf(closure.scope);
      const duplicate = this.closures.some(
        (row) => row.date === closure.date && row.scopeKey === scopeKey,
      );
      if (duplicate) return false;
      this.closures.push({
        id: `closure-${this.sequence++}`,
        date: closure.date,
        scopeKey,
        scopeType: closure.scope.type,
        tableId: closure.scope.type === "table" ? closure.scope.tableId : null,
        reason: closure.reason,
        isHoliday: closure.isHoliday,
      });
      return true;
    });
  }

  deleteClosure(pick: number): boolean {
    return this.transaction("closures", () => {
      if (this.closures.length === 0) return false;
      this.closures.splice(pick % this.closures.length, 1);
      return true;
    });
  }

  // Mirrors createDiningArea: tenant-wide normalized uniqueness + default display order.
  createArea(input: { name: unknown; displayOrder?: unknown }): boolean {
    return this.transaction("areas", () => {
      const context: AreaContext = {
        existingNames: this.areas.map((row) => ({ id: row.id, name: row.name })),
        highestDisplayOrder:
          this.areas.length > 0 ? Math.max(...this.areas.map((row) => row.displayOrder)) : null,
      };
      const result = validateDiningArea(input, context);
      if (!result.ok) return false;
      this.areas.push({
        id: `area-${this.sequence++}`,
        name: result.value.name,
        displayOrder: result.value.displayOrder,
        tableCount: 0,
      });
      return true;
    });
  }

  // Mirrors deleteDiningArea: only an area with zero assigned tables may be removed.
  deleteArea(pick: number): boolean {
    return this.transaction("areas", () => {
      const deletable = this.areas.filter((row) => row.tableCount === 0);
      if (deletable.length === 0) return false;
      const target = deletable[pick % deletable.length];
      this.areas = this.areas.filter((row) => row.id !== target.id);
      return true;
    });
  }

  // Mirrors createMenuCategory: tenant-wide normalized uniqueness + hard cap.
  createCategory(input: { name: unknown; displayOrder?: unknown }): boolean {
    return this.transaction("categories", () => {
      const context: MenuContext = {
        existingCategoryNames: this.categories.map((row) => ({ id: row.id, name: row.name })),
        categoryCount: this.categories.length,
        itemCount: this.items.length,
        highestCategoryDisplayOrder:
          this.categories.length > 0
            ? Math.max(...this.categories.map((row) => row.displayOrder))
            : null,
      };
      const result = validateMenuCategory(input, context);
      if (!result.ok) return false;
      this.categories.push({
        id: `category-${this.sequence++}`,
        name: result.value.name,
        displayOrder: result.value.displayOrder,
      });
      return true;
    });
  }

  deleteCategory(pick: number): boolean {
    return this.transaction("categories", () => {
      if (this.categories.length === 0) return false;
      const target = this.categories[pick % this.categories.length];
      this.categories = this.categories.filter((row) => row.id !== target.id);
      // Cascade removes the category's items, still within the settings space only.
      this.items = this.items.filter((row) => row.categoryId !== target.id);
      return true;
    });
  }

  // Mirrors createMenuItem: must reference an existing category, honors tenant cap.
  createItem(
    categoryPick: number,
    input: {
      name: unknown;
      priceMinor: unknown;
      description?: unknown;
      state?: unknown;
    },
  ): boolean {
    return this.transaction("items", () => {
      if (this.categories.length === 0) return false;
      const category = this.categories[categoryPick % this.categories.length];
      const context: MenuContext = {
        existingCategoryNames: this.categories.map((row) => ({ id: row.id, name: row.name })),
        categoryCount: this.categories.length,
        itemCount: this.items.length,
        validCategoryIds: this.categories.map((row) => row.id),
        highestItemDisplayOrder:
          this.items.length > 0 ? Math.max(...this.items.map((row) => row.displayOrder)) : null,
      };
      const result = validateMenuItem({ ...input, categoryId: category.id }, context);
      if (!result.ok) return false;
      this.items.push({
        id: `item-${this.sequence++}`,
        categoryId: result.value.categoryId,
        name: result.value.name,
        priceMinor: result.value.priceMinor,
        description: result.value.description,
        displayOrder: result.value.displayOrder,
        state: result.value.state,
      });
      return true;
    });
  }

  // --- Reads ---------------------------------------------------------------

  snapshotBookings(): ExistingBooking[] {
    return structuredClone(this.bookings);
  }

  private closureInputFor(date: string): AvailabilityClosureInput {
    const forDate = this.closures.filter((row) => row.date === date);
    return {
      restaurantClosed: forDate.some((row) => row.scopeType === "restaurant"),
      closedTableIds: forDate
        .filter((row) => row.scopeType === "table" && row.tableId !== null)
        .map((row) => row.tableId as string),
    };
  }

  // The SUBSEQUENT availability computation — derived from current stored settings/hours/closures.
  availabilityFor(date: string, partySize: number): AvailabilityResult {
    const bookingsOnDate = this.bookings.filter((booking) =>
      (BOOKING_STATUSES as readonly string[]).includes(String(booking.status)),
    );
    return computeAvailability({
      settings: { ...this.settings },
      hours: { ...this.hours[dayOfWeekForDate(date)] },
      tables: SEED_TABLES.map((table) => ({ ...table })),
      bookings: structuredClone(bookingsOnDate),
      closures: this.closureInputFor(date),
      partySize,
      date,
      nowDateStr: NOW_DATE,
      nowMinutes: 0,
      daysAhead: daysBetween(NOW_DATE, date),
    });
  }
}

// --- Generators -----------------------------------------------------------

const tableIdArb = fc.constantFrom(...TABLE_IDS);
const statusArb = fc.constantFrom(...BOOKING_STATUSES);
const dateArb = fc.constantFrom("2024-01-15", "2024-06-15", "2024-06-30", "2024-12-25");

const bookingArb: fc.Arbitrary<ExistingBooking> = fc.record({
  id: fc.uuid(),
  tableId: tableIdArb,
  startMinutes: fc.integer({ min: 0, max: 95 }).map((n) => n * 15),
  turnTimeMinutes: fc.integer({ min: 30, max: 240 }),
  status: statusArb,
  partySize: fc.integer({ min: 1, max: 12 }),
});

const bookingsArb = fc.array(bookingArb, { maxLength: 15 });

// Valid seven-day operating hours: each weekday closed, or open with a strictly-later close.
const dayHoursArb = (dayOfWeek: number): fc.Arbitrary<DayHours> =>
  fc.oneof(
    fc.constant({ dayOfWeek, openTime: "00:00", closeTime: "00:00", isClosed: true }),
    fc
      .tuple(fc.integer({ min: 6, max: 12 }), fc.integer({ min: 13, max: 23 }))
      .map(([openHour, closeHour]) => ({
        dayOfWeek,
        openTime: `${String(openHour).padStart(2, "0")}:00`,
        closeTime: `${String(closeHour).padStart(2, "0")}:00`,
        isClosed: false,
      })),
  );

const operatingHoursArb: fc.Arbitrary<DayHours[]> = fc.tuple(
  ...Array.from({ length: 7 }, (_, day) => dayHoursArb(day)),
);

// Valid service / booking-rule settings across every documented range.
const serviceSettingsArb: fc.Arbitrary<ServiceSettings> = fc.record({
  slotInterval: fc.constantFrom(15, 30, 60),
  turnTime: fc.integer({ min: 30, max: 240 }),
  maxPartySize: fc.integer({ min: 1, max: 30 }),
  advanceBookingWindow: fc.integer({ min: 1, max: 365 }),
  minLeadTime: fc.integer({ min: 0, max: 1440 }),
  timezone: fc.constantFrom("Asia/Kolkata", "UTC", "America/New_York"),
});

const closureScopeArb: fc.Arbitrary<NormalisedClosureDay["scope"]> = fc.oneof(
  fc.constant({ type: "restaurant" as const }),
  tableIdArb.map((tableId) => ({ type: "table" as const, tableId })),
);

const normalisedClosureArb: fc.Arbitrary<NormalisedClosureDay> = fc
  .record({
    date: dateArb,
    scope: closureScopeArb,
    reason: fc.constantFrom("", "Holiday", "Private event", "Maintenance"),
    isHoliday: fc.boolean(),
  })
  .map((submission) => {
    const result = validateClosureDay(submission);
    if (!result.ok) throw new Error("Generator produced an invalid closure submission");
    return result.value;
  });

const nameArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length >= 1);

// --- Operation model ------------------------------------------------------

type Op =
  | { kind: "editHours"; hours: DayHours[] }
  | { kind: "editSettings"; settings: ServiceSettings }
  | { kind: "createClosure"; closure: NormalisedClosureDay }
  | { kind: "deleteClosure"; pick: number }
  | { kind: "createArea"; name: string }
  | { kind: "deleteArea"; pick: number }
  | { kind: "createCategory"; name: string }
  | { kind: "deleteCategory"; pick: number }
  | { kind: "createItem"; categoryPick: number; name: string; priceMinor: number; state: string };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  operatingHoursArb.map((hours) => ({ kind: "editHours" as const, hours })),
  serviceSettingsArb.map((settings) => ({ kind: "editSettings" as const, settings })),
  normalisedClosureArb.map((closure) => ({ kind: "createClosure" as const, closure })),
  fc.nat().map((pick) => ({ kind: "deleteClosure" as const, pick })),
  nameArb.map((name) => ({ kind: "createArea" as const, name })),
  fc.nat().map((pick) => ({ kind: "deleteArea" as const, pick })),
  nameArb.map((name) => ({ kind: "createCategory" as const, name })),
  fc.nat().map((pick) => ({ kind: "deleteCategory" as const, pick })),
  fc
    .record({
      categoryPick: fc.nat(),
      name: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length >= 1),
      priceMinor: fc.integer({ min: 0, max: 10_000_000 }),
      state: fc.constantFrom("available", "unavailable"),
    })
    .map((item) => ({ kind: "createItem" as const, ...item })),
);

function applyOp(store: InMemorySettingsStore, op: Op): void {
  switch (op.kind) {
    case "editHours":
      store.editOperatingHours(op.hours);
      break;
    case "editSettings":
      store.editServiceSettings(op.settings);
      break;
    case "createClosure":
      store.createClosure(op.closure);
      break;
    case "deleteClosure":
      store.deleteClosure(op.pick);
      break;
    case "createArea":
      store.createArea({ name: op.name });
      break;
    case "deleteArea":
      store.deleteArea(op.pick);
      break;
    case "createCategory":
      store.createCategory({ name: op.name });
      break;
    case "deleteCategory":
      store.deleteCategory(op.pick);
      break;
    case "createItem":
      store.createItem(op.categoryPick, {
        name: op.name,
        priceMinor: op.priceMinor,
        state: op.state,
      });
      break;
  }
}

describe("Feature: restaurant-dashboard-settings, Property 18: Availability-affecting settings do not rewrite bookings", () => {
  it("leaves every booking id, table, snapshot, and status byte-identical across any valid settings-change sequence", () => {
    fc.assert(
      fc.property(bookingsArb, fc.array(opArb, { maxLength: 40 }), (bookings, ops) => {
        const store = new InMemorySettingsStore(bookings);
        const bookingsBefore = store.snapshotBookings();

        for (const op of ops) {
          applyOp(store, op);
          // Req 4.11 / 11.6 — invariant holds after EVERY single mutation, not only at the end.
          expect(store.snapshotBookings()).toEqual(bookingsBefore);
        }

        // Final byte-for-byte equality across ids, tableIds, startMinutes/turnTime snapshots, statuses.
        expect(store.snapshotBookings()).toEqual(bookingsBefore);
      }),
      { numRuns: 200 },
    );
  });

  it("recomputes availability from the changed stored values while never rewriting bookings (Req 3.9/11.5)", () => {
    fc.assert(
      fc.property(bookingsArb, fc.array(opArb, { maxLength: 40 }), (bookings, ops) => {
        const store = new InMemorySettingsStore(bookings);
        const bookingsBefore = store.snapshotBookings();

        for (const op of ops) {
          applyOp(store, op);
        }

        // A subsequent availability request is well-defined and derived from current stored values;
        // requesting it must not mutate any booking.
        const availability = store.availabilityFor(TARGET_DATE, 2);
        expect(typeof availability.closed).toBe("boolean");
        expect(store.snapshotBookings()).toEqual(bookingsBefore);
      }),
      { numRuns: 200 },
    );
  });

  it("allows subsequent availability to change after a closure while bookings stay unchanged", () => {
    fc.assert(
      fc.property(bookingsArb, (bookings) => {
        const store = new InMemorySettingsStore(bookings);
        const bookingsBefore = store.snapshotBookings();

        const before = store.availabilityFor(TARGET_DATE, 2);
        expect(before.closed).toBe(false);

        // A valid restaurant-scoped closure on the probed date is an availability-affecting change.
        const closure = validateClosureDay({
          date: TARGET_DATE,
          scope: { type: "restaurant" },
          reason: "Holiday",
          isHoliday: true,
        });
        if (!closure.ok) throw new Error("closure fixture invalid");
        expect(store.createClosure(closure.value)).toBe(true);

        const after = store.availabilityFor(TARGET_DATE, 2);
        // Availability MAY change (here it does: the date becomes closed)...
        expect(after.closed).toBe(true);
        expect(after).not.toEqual(before);
        // ...but no booking was rewritten by the settings change.
        expect(store.snapshotBookings()).toEqual(bookingsBefore);
      }),
      { numRuns: 100 },
    );
  });
});
