/**
 * restaurant-dashboard-settings.property-8.test.ts
 *
 * Property-based suite for the closure-aware availability core (spec task 4.4).
 *
 * Generators build valid availability snapshots — Service_Settings, one
 * weekday's Operating_Hours, a Dining_Table set, blocking/releasing
 * Table_Bookings and injected time — plus a Closure snapshot pairing a
 * restaurant-scoped flag with an arbitrary set of table-scoped closed ids
 * (including duplicates and ids that no table carries). The single property
 * compares `computeAvailability` against an independent reference filter and
 * cross-checks the table-scoped case against a computation whose closed tables
 * were physically removed, so every pre-existing state, capacity, occupancy,
 * lead-time and window rule must still hold for every non-closed table.
 *
 * All time is injected; nothing here reads the system clock or sleeps.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  BOOKING_STATUSES,
  SLOT_INTERVALS,
  LIMITS,
  MINUTES_PER_DAY,
  formatClock,
  formatSlotLabel,
  parseClock,
  resolveSettings,
  orderTables,
  isBlockingStatus,
  computeAvailability,
  type DayHours,
  type DiningTable,
  type ExistingBooking,
  type ServiceSettings,
  type AvailabilityInput,
  type AvailabilityResult,
  type AvailabilityClosureInput,
} from "./restaurant-availability";

// Feature: restaurant-dashboard-settings, Property 8: Closure-aware availability
// **Validates: Requirements 4.7, 4.8, 11.5**

// ===========================================================================
// Generators — snapshot pieces mirror the availability suite's shapes.
// ===========================================================================

const arbMinuteOfDay = fc.integer({ min: 0, max: MINUTES_PER_DAY - 1 });
const arbSlotInterval = fc.constantFrom(...SLOT_INTERVALS);
const arbTurnTime = fc.integer({ min: LIMITS.turnTime.min, max: LIMITS.turnTime.max });
const arbMaxPartySize = fc.integer({ min: LIMITS.maxPartySize.min, max: LIMITS.maxPartySize.max });
const arbMinLeadTime = fc.oneof(
  { weight: 2, arbitrary: fc.constant(LIMITS.minLeadTime.min) },
  {
    weight: 5,
    arbitrary: fc.integer({ min: LIMITS.minLeadTime.min, max: LIMITS.minLeadTime.max }),
  },
);
const arbTimezone = fc.constantFrom<string>(
  "Asia/Kolkata",
  "UTC",
  "America/New_York",
  "Europe/London",
);

/** Settings biased to admit several slots, plus occasional partial/null. */
const arbSnapshotSettings = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      slotInterval: arbSlotInterval,
      turnTime: fc.integer({ min: LIMITS.turnTime.min, max: 120 }),
      maxPartySize: arbMaxPartySize,
      advanceBookingWindow: fc.integer({ min: 60, max: LIMITS.advanceBookingWindow.max }),
      minLeadTime: arbMinLeadTime,
      timezone: arbTimezone,
    }) as fc.Arbitrary<Partial<ServiceSettings>>,
  },
  {
    weight: 2,
    arbitrary: fc.record(
      {
        slotInterval: arbSlotInterval,
        turnTime: arbTurnTime,
        maxPartySize: arbMaxPartySize,
        advanceBookingWindow: fc.integer({
          min: LIMITS.advanceBookingWindow.min,
          max: LIMITS.advanceBookingWindow.max,
        }),
        minLeadTime: arbMinLeadTime,
        timezone: arbTimezone,
      },
      { requiredKeys: [] },
    ),
  },
  { weight: 1, arbitrary: fc.constant(null as unknown as Partial<ServiceSettings>) },
);

/** A window wide enough to admit several Booking_Slots after Turn_Time. */
const arbGenerousHours: fc.Arbitrary<DayHours> = fc
  .tuple(
    fc.integer({ min: 0, max: 6 }),
    fc.integer({ min: 0, max: 700 }),
    fc.integer({ min: 300, max: 600 }),
  )
  .map(([dayOfWeek, open, span]) => ({
    dayOfWeek,
    openTime: formatClock(open),
    closeTime: formatClock(Math.min(MINUTES_PER_DAY - 1, open + span)),
    isClosed: false,
  }));

const arbDayHours: fc.Arbitrary<DayHours> = fc.oneof(
  { weight: 6, arbitrary: arbGenerousHours },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.integer({ min: 0, max: 6 }), arbMinuteOfDay, arbMinuteOfDay)
      .map(([dayOfWeek, a, b]) => ({
        dayOfWeek,
        openTime: formatClock(a),
        closeTime: formatClock(b),
        isClosed: false,
      })),
  },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.integer({ min: 0, max: 6 }), arbMinuteOfDay, arbMinuteOfDay)
      .map(([dayOfWeek, a, b]) => ({
        dayOfWeek,
        openTime: formatClock(a),
        closeTime: formatClock(b),
        isClosed: true,
      })),
  },
);

const arbBookingStatus = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom<string>(...BOOKING_STATUSES) },
  { weight: 1, arbitrary: fc.constantFrom<string>("", "pending", "Unknown", "Deleted") },
);

const arbTableName = fc.oneof(
  { weight: 6, arbitrary: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ]{0,10}[A-Za-z0-9]$/) },
  { weight: 2, arbitrary: fc.constantFrom("T1", "t1", "Patio 2", "Window", "window") },
);
const arbTableArea = fc.constantFrom("Main", "main", "Patio", "Rooftop", "Bar", "Garden");

const arbTableSpec = fc.record({
  name: arbTableName,
  seatCapacity: fc.integer({ min: LIMITS.seatCapacity.min, max: LIMITS.seatCapacity.max }),
  area: arbTableArea,
  displayOrder: fc.integer({ min: LIMITS.displayOrder.min, max: 12 }),
  state: fc.constantFrom<"active" | "inactive">("active", "inactive"),
});

function withIds(specs: Omit<DiningTable, "id">[]): DiningTable[] {
  return specs.map((s, i) => ({ ...s, id: `t${i}` }));
}

/** Adds whole days to a `YYYY-MM-DD` string without touching the system clock. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${String(dt.getUTCFullYear()).padStart(4, "0")}-${String(dt.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

const arbNowDateStr = fc
  .integer({ min: 0, max: 4000 })
  .map((offset) => addDays("2024-01-01", offset));

/** A full availability snapshot with injected time and consistent date/daysAhead. */
const arbSnapshotBase = fc
  .record({
    settings: arbSnapshotSettings,
    hours: fc.oneof(
      { weight: 7, arbitrary: arbGenerousHours as fc.Arbitrary<DayHours | null> },
      { weight: 3, arbitrary: arbDayHours as fc.Arbitrary<DayHours | null> },
      { weight: 1, arbitrary: fc.constant(null as DayHours | null) },
    ),
    tables: fc.array(arbTableSpec, { minLength: 1, maxLength: 6 }).map(withIds),
    bookingSpecs: fc.array(
      fc.record({
        tableIndex: fc.integer({ min: 0, max: 6 }),
        startMinutes: arbMinuteOfDay,
        turnTimeMinutes: fc.oneof(arbTurnTime, fc.constant(undefined as unknown as number)),
        status: arbBookingStatus,
        insideWindow: fc.boolean(),
      }),
      { maxLength: 8 },
    ),
    partySize: fc.oneof(
      { weight: 6, arbitrary: fc.integer({ min: 1, max: 8 }) },
      { weight: 2, arbitrary: fc.integer({ min: 0, max: LIMITS.seatCapacity.max + 4 }) },
    ),
    nowDateStr: arbNowDateStr,
    nowMinutes: arbMinuteOfDay,
    daysAhead: fc.oneof(
      { weight: 3, arbitrary: fc.constant(0) },
      { weight: 5, arbitrary: fc.integer({ min: 0, max: 60 }) },
      { weight: 2, arbitrary: fc.integer({ min: -3, max: 400 }) },
    ),
  })
  .map((raw) => {
    const openMinutes = raw.hours ? parseClock(raw.hours.openTime) : null;
    const closeMinutes = raw.hours ? parseClock(raw.hours.closeTime) : null;
    const span =
      openMinutes !== null && closeMinutes !== null && closeMinutes > openMinutes
        ? closeMinutes - openMinutes
        : null;

    const bookings: ExistingBooking[] = raw.bookingSpecs.map((b, i) => ({
      id: `b${i}`,
      tableId: `t${b.tableIndex}`,
      startMinutes:
        b.insideWindow && span !== null
          ? (openMinutes as number) + (b.startMinutes % span)
          : b.startMinutes,
      turnTimeMinutes: b.turnTimeMinutes as number,
      status: b.status,
    }));

    const date = raw.daysAhead === 0 ? raw.nowDateStr : addDays(raw.nowDateStr, raw.daysAhead);
    return {
      settings: raw.settings,
      hours: raw.hours,
      tables: raw.tables,
      bookings,
      partySize: raw.partySize,
      date,
      nowDateStr: raw.nowDateStr,
      nowMinutes: raw.nowMinutes,
      daysAhead: raw.daysAhead,
    } satisfies AvailabilityInput;
  });

/**
 * Pairs a snapshot with a closure set: a restaurant-scoped flag plus a subset
 * of the snapshot's table ids (with duplicates) mixed with ids no table
 * carries, exercising the "excludes exactly those ids" claim.
 */
const arbSnapshotWithClosures = arbSnapshotBase.chain((snapshot) => {
  const tableIds = snapshot.tables.map((t) => t.id);
  const closedIdArb = fc.oneof(
    fc.constantFrom(...tableIds),
    fc.constantFrom("missing-1", "missing-2", "t99"),
  );
  return fc
    .record({
      restaurantClosed: fc.boolean(),
      closedTableIds: fc.array(closedIdArb, { maxLength: tableIds.length + 3 }),
      omitClosures: fc.boolean(),
    })
    .map(({ restaurantClosed, closedTableIds, omitClosures }) => {
      const closures: AvailabilityClosureInput | null = omitClosures
        ? null
        : { restaurantClosed, closedTableIds };
      return { ...snapshot, closures } satisfies AvailabilityInput;
    });
});

// ===========================================================================
// Reference filter — independent derivation of the closure-aware result.
// ===========================================================================

function referenceSlotStarts(hours: DayHours, settings: ServiceSettings): number[] {
  if (hours.isClosed) return [];
  const open = parseClock(hours.openTime);
  const close = parseClock(hours.closeTime);
  if (open === null || close === null) return [];
  const latest = close - settings.turnTime;
  if (latest < open) return [];
  const out: number[] = [];
  for (let s = open; s <= latest; s += settings.slotInterval) out.push(s);
  return out;
}

function referenceClosureAvailability(input: AvailabilityInput): AvailabilityResult {
  const settings = resolveSettings(input.settings);
  const closedIds = new Set(input.closures?.closedTableIds ?? []);
  const tables = input.tables ?? [];

  // Table-scoped closures remove those ids before every other rule.
  const active = tables.filter((t) => t.state === "active" && !closedIds.has(t.id));
  const activeTableCount = active.length;
  const largestCapacity = active.reduce(
    (max, t) => (Number.isInteger(t.seatCapacity) && t.seatCapacity > max ? t.seatCapacity : max),
    0,
  );

  // 1. Out of window wins over every other indicator, closures included.
  if (input.daysAhead > settings.advanceBookingWindow) {
    return {
      closed: false,
      outOfWindow: true,
      requiresMultipleTables: false,
      activeTableCount,
      largestCapacity,
      slots: [],
    };
  }

  // 2. Closed weekday, absent hours, or a restaurant-scoped closure.
  if (!input.hours || input.hours.isClosed || input.closures?.restaurantClosed === true) {
    return {
      closed: true,
      outOfWindow: false,
      requiresMultipleTables: false,
      activeTableCount,
      largestCapacity,
      slots: [],
    };
  }

  // 3. Slots, filtered by Min_Lead_Time on the current date.
  let starts = referenceSlotStarts(input.hours, settings);
  if (input.date === input.nowDateStr) {
    starts = starts.filter((s) => s >= input.nowMinutes + settings.minLeadTime);
  }

  const ordered = orderTables(active);
  const slots = starts.map((startMinutes) => {
    const availableTableIds: string[] = [];
    let occupiedCount = 0;
    for (const table of ordered) {
      const occupied = (input.bookings ?? [])
        .filter((b) => b.tableId === table.id && isBlockingStatus(b.status))
        .some((b) => {
          const bTurn = Number.isInteger(b.turnTimeMinutes) ? b.turnTimeMinutes : settings.turnTime;
          return (
            startMinutes < b.startMinutes + bTurn &&
            b.startMinutes < startMinutes + settings.turnTime
          );
        });
      if (occupied) {
        occupiedCount += 1;
        continue;
      }
      // Seat_Capacity does not gate membership: tables combine into a
      // Table_Group, and there is no minimum party per table.
      availableTableIds.push(table.id);
    }
    return {
      startMinutes,
      label: formatSlotLabel(startMinutes),
      availableTableIds,
      availableCount: availableTableIds.length,
      occupiedCount,
      availableCapacity: availableTableIds.reduce((sum, id) => {
        const table = ordered.find((t) => t.id === id);
        return sum + (table && Number.isInteger(table.seatCapacity) ? table.seatCapacity : 0);
      }, 0),
    };
  });

  return {
    closed: false,
    outOfWindow: false,
    requiresMultipleTables: activeTableCount > 0 && input.partySize > largestCapacity,
    activeTableCount,
    largestCapacity,
    slots,
  };
}

describe("Property 8: Closure-aware availability", () => {
  it("equals the reference closure filter, closing on restaurant closures and excluding exactly the closed tables", () => {
    fc.assert(
      fc.property(arbSnapshotWithClosures, (input) => {
        const result = computeAvailability(input);

        // The whole result equals the independent reference filter.
        expect(result).toEqual(referenceClosureAvailability(input));

        const settings = resolveSettings(input.settings);
        const outOfWindow = input.daysAhead > settings.advanceBookingWindow;
        const closedIds = new Set(input.closures?.closedTableIds ?? []);

        // A restaurant-scoped closure yields closed with no slots — unless the
        // out-of-window indicator, which still wins, takes precedence first.
        if (input.closures?.restaurantClosed === true && !outOfWindow) {
          expect(result.closed).toBe(true);
          expect(result.outOfWindow).toBe(false);
          expect(result.slots).toEqual([]);
        }
        if (outOfWindow) {
          expect(result.outOfWindow).toBe(true);
          expect(result.closed).toBe(false);
          expect(result.slots).toEqual([]);
        }

        // No closed table id is ever offered or counted among active tables.
        for (const slot of result.slots) {
          for (const id of slot.availableTableIds) {
            expect(closedIds.has(id)).toBe(false);
          }
        }
        for (const table of input.tables) {
          if (closedIds.has(table.id)) {
            expect(result.slots.every((s) => !s.availableTableIds.includes(table.id))).toBe(true);
          }
        }

        // Cross-check: table-scoped closures behave exactly like physically
        // removing those tables (and their bookings never being evaluated),
        // proving non-closed tables stay under every existing rule.
        const survivingTables = input.tables.filter((t) => !closedIds.has(t.id));
        const removed = computeAvailability({
          ...input,
          tables: survivingTables,
          closures: input.closures?.restaurantClosed
            ? { restaurantClosed: true, closedTableIds: [] }
            : null,
        });
        expect(result).toEqual(removed);
      }),
      { numRuns: 300 },
    );
  });
});
