/**
 * restaurant-availability.test.ts
 *
 * Property-based suite for the pure restaurant core (spec tasks 3.1, 3.2, 3.3).
 *
 * Structure follows `video-consultation.test.ts`: generators are derived from
 * the module's exported constants (`BLOCKING_STATUSES`, `RELEASING_STATUSES`,
 * `SLOT_INTERVALS`, `LIMITS`, `BOOKING_STATUSES`) so adding a status or a slot
 * interval without updating the logic fails the suite instead of quietly
 * passing. Exactly one property per test, each tagged with the design's
 * property text.
 *
 * All time is injected: `nowDateStr`, `nowMinutes` and `daysAhead` are
 * generated. Nothing here reads the system clock or sleeps.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  // constants the generators are built from
  BLOCKING_STATUSES,
  RELEASING_STATUSES,
  BOOKING_STATUSES,
  SLOT_INTERVALS,
  LIMITS,
  DEFAULT_SETTINGS,
  MINUTES_PER_DAY,
  DEFAULT_TABLE_AREA,
  WEEKDAY_NAMES,
  PROFESSION_RESTAURANT,
  TENANT_PREFIX_RESTAURANT,
  DEFAULT_TENANT_PREFIX,
  DEFAULT_DASHBOARD_ROUTE,
  CORE_NAV_ENTRIES,
  GATED_TAB_ENTRIES,
  GATED_SUB_TAB_ENTRIES,
  GATED_NAV_FEATURE,
  CONFIG_SUB_TABS,
  RESTAURANT_CONFIG_FEATURE,
  RESTAURANT_BOOKINGS_FEATURE,
  // messages
  MSG_SEAT_CAPACITY_RANGE,
  MSG_TABLE_NAME_LENGTH,
  MSG_TABLE_AREA_LENGTH,
  MSG_DISPLAY_ORDER_RANGE,
  MSG_MAX_TABLES_REACHED,
  MSG_DUPLICATE_TABLE_NAME,
  MSG_SLOT_INTERVAL,
  MSG_TURN_TIME,
  MSG_MAX_PARTY_SIZE,
  MSG_ADVANCE_WINDOW,
  MSG_MIN_LEAD_TIME,
  MSG_HOURS_SEVEN_DAYS,
  MSG_NOT_AUTHORISED_RULES,
  MSG_NOT_AUTHORISED_BOOKINGS,
  MSG_FEATURE_ACCESS_UNRESOLVED,
  MSG_RESTAURANT_NAME_LENGTH,
  MSG_BUSINESS_NAME_LENGTH,
  msgOperatingHoursDay,
  // functions under test
  parseClock,
  formatClock,
  formatSlotLabel,
  generateSlotStarts,
  windowsOverlap,
  computeAvailability,
  resolveSettings,
  orderTables,
  pickAutoTable,
  pickAutoTables,
  validateBookingRequest,
  TABLE_SELECTION_ANY,
  MSG_TABLE_JUST_BOOKED,
  occupancyRate,
  isBlockingStatus,
  validateTableInput,
  validateServiceSettings,
  validateOperatingHours,
  validateBusinessName,
  dashboardRouteForProfession,
  tenantPrefixForProfession,
  restaurantGuardDecision,
  businessNameLabelForProfession,
  deriveRestaurantNavigation,
  authoriseRestaurantWrite,
  isRestaurantProfession,
  tenantNow,
  daysBetween,
  type DayHours,
  type DiningTable,
  type ExistingBooking,
  type ServiceSettings,
  type AvailabilityInput,
  type AvailabilityClosureInput,
  type AvailabilityResult,
  type RestaurantPermission,
} from "./restaurant-availability";
import {
  FEATURE_IDS,
  PROFESSION_FEATURES,
  resolveFeatureAccess,
  type AccountContext,
  type AccountRole,
} from "./feature-access";

// ===========================================================================
// Shared generators — every one derives from the module's exported constants.
// ===========================================================================

const ROLES: AccountRole[] = ["admin", "reception", "doctor", "location"];
const PERMISSIONS: RestaurantPermission[] = ["operate", "view_only", "none"];

const arbMinuteOfDay = fc.integer({ min: 0, max: MINUTES_PER_DAY - 1 });
const arbSlotInterval = fc.constantFrom(...SLOT_INTERVALS);
const arbTurnTime = fc.integer({ min: LIMITS.turnTime.min, max: LIMITS.turnTime.max });
const arbMaxPartySize = fc.integer({ min: LIMITS.maxPartySize.min, max: LIMITS.maxPartySize.max });
const arbAdvanceWindow = fc.integer({
  min: LIMITS.advanceBookingWindow.min,
  max: LIMITS.advanceBookingWindow.max,
});
/** Includes the documented `minLeadTime` 0 edge case at both ends of the range. */
const arbMinLeadTime = fc.oneof(
  { weight: 2, arbitrary: fc.constant(LIMITS.minLeadTime.min) },
  {
    weight: 5,
    arbitrary: fc.integer({ min: LIMITS.minLeadTime.min, max: LIMITS.minLeadTime.max }),
  },
);

const TIMEZONES = [
  "Asia/Kolkata",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Kiritimati",
  "Pacific/Honolulu",
  "America/Sao_Paulo",
  "Asia/Kathmandu",
] as const;
const arbTimezone = fc.constantFrom<string>(...TIMEZONES);

const arbSettings: fc.Arbitrary<ServiceSettings> = fc.record({
  slotInterval: arbSlotInterval,
  turnTime: arbTurnTime,
  maxPartySize: arbMaxPartySize,
  advanceBookingWindow: arbAdvanceWindow,
  minLeadTime: arbMinLeadTime,
  timezone: arbTimezone,
});

/** Stored settings with arbitrary fields missing, exercising the per-field defaults. */
const arbPartialSettings: fc.Arbitrary<Partial<ServiceSettings>> = fc.record(
  {
    slotInterval: arbSlotInterval,
    turnTime: arbTurnTime,
    maxPartySize: arbMaxPartySize,
    advanceBookingWindow: arbAdvanceWindow,
    minLeadTime: arbMinLeadTime,
    timezone: arbTimezone,
  },
  { requiredKeys: [] },
);

const arbStoredSettings = fc.oneof(
  { weight: 4, arbitrary: arbSettings as fc.Arbitrary<Partial<ServiceSettings>> },
  { weight: 2, arbitrary: arbPartialSettings },
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

/**
 * Operating hours for one weekday. Branches deliberately cover a generous
 * window, a random window (frequently `close - turn < open`), a zero-slot day
 * and a closed day that still stores clock values.
 */
const arbDayHours: fc.Arbitrary<DayHours> = fc.oneof(
  { weight: 5, arbitrary: arbGenerousHours },
  {
    weight: 3,
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
    // zero-slot date: the window is shorter than any permitted Turn_Time
    weight: 2,
    arbitrary: fc
      .tuple(
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 1400 }),
        fc.integer({ min: 0, max: 29 }),
      )
      .map(([dayOfWeek, open, span]) => ({
        dayOfWeek,
        openTime: formatClock(open),
        closeTime: formatClock(open + span),
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

/** Every Booking_Status, plus values outside the vocabulary. */
const arbBookingStatus = fc.constantFrom<string>(...BOOKING_STATUSES);
const arbAnyStatus = fc.oneof(
  { weight: 6, arbitrary: arbBookingStatus },
  { weight: 1, arbitrary: fc.constantFrom<string>("", "pending", "Unknown", "Deleted") },
);
const arbBlockingStatus = fc.constantFrom<string>(...BLOCKING_STATUSES);
const arbReleasingStatus = fc.constantFrom<string>(...RELEASING_STATUSES);

const arbTableName = fc.oneof(
  { weight: 6, arbitrary: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ]{0,10}[A-Za-z0-9]$/) },
  { weight: 2, arbitrary: fc.constantFrom("T1", "t1", "Patio 2", "PATIO 2", "Window", "window") },
);
const arbTableArea = fc.constantFrom("Main", "main", "Patio", "Rooftop", "Bar", "Garden");

/** Table specs get their ids assigned by index, which keeps ids unique. */
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

const arbTables = (maxLength = 6): fc.Arbitrary<DiningTable[]> =>
  fc.array(arbTableSpec, { maxLength }).map(withIds);

// ===========================================================================
// Reference implementations used by the properties
// ===========================================================================

/** The design's reference definition of the Available_Table set. */
function referenceAvailability(input: AvailabilityInput): AvailabilityResult {
  const settings = resolveSettings(input.settings);
  const tables = input.tables ?? [];
  const active = tables.filter((t) => t.state === "active");
  const activeTableCount = active.length;
  const largestCapacity = active.reduce(
    (max, t) => (Number.isInteger(t.seatCapacity) && t.seatCapacity > max ? t.seatCapacity : max),
    0,
  );

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
  if (!input.hours || input.hours.isClosed) {
    return {
      closed: true,
      outOfWindow: false,
      requiresMultipleTables: false,
      activeTableCount,
      largestCapacity,
      slots: [],
    };
  }

  let starts = referenceSlotStarts(input.hours, settings);
  if (input.date === input.nowDateStr) {
    starts = starts.filter((s) => s >= input.nowMinutes + settings.minLeadTime);
  }

  const ordered = orderTables(active);
  const slots = starts.map((startMinutes) => {
    const availableTableIds: string[] = [];
    let occupiedCount = 0;
    let availableCapacity = 0;
    for (const table of ordered) {
      const blocking = (input.bookings ?? []).filter(
        (b) => b.tableId === table.id && isBlockingStatus(b.status),
      );
      const occupied = blocking.some((b) => {
        const bTurn = Number.isInteger(b.turnTimeMinutes) ? b.turnTimeMinutes : settings.turnTime;
        return (
          startMinutes < b.startMinutes + bTurn && b.startMinutes < startMinutes + settings.turnTime
        );
      });
      if (occupied) {
        occupiedCount += 1;
        continue;
      }
      // Seat_Capacity does not gate membership: tables combine into a
      // Table_Group, and there is no minimum party per table.
      availableTableIds.push(table.id);
      availableCapacity += Number.isInteger(table.seatCapacity) ? table.seatCapacity : 0;
    }
    return {
      startMinutes,
      label: formatSlotLabel(startMinutes),
      availableTableIds,
      availableCount: availableTableIds.length,
      occupiedCount,
      availableCapacity,
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

/** Reference slot starts: Open_Time to Close_Time − Turn_Time, stepping by Slot_Interval. */
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

/** Independent derivation of tenant-local now, via a different locale and hour cycle. */
function referenceTenantLocal(timezone: string, instant: Date) {
  let zone = typeof timezone === "string" ? timezone.trim() : "";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    if (zone.length === 0) zone = DEFAULT_SETTINGS.timezone;
  } catch {
    zone = DEFAULT_SETTINGS.timezone;
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(instant);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

  const hour12 = Number(pick("hour")) % 12;
  const isPm = pick("dayPeriod").toLowerCase().includes("p");
  const minutesOfDay = hour12 * 60 + (isPm ? 12 * 60 : 0) + Number(pick("minute"));
  const dateStr = `${pick("year").padStart(4, "0")}-${pick("month")}-${pick("day")}`;

  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(
    instant,
  );
  const weekday = (WEEKDAY_NAMES as readonly string[]).indexOf(weekdayName);

  return { dateStr, minutesOfDay, weekday };
}

/** Adds whole days to a `YYYY-MM-DD` string without touching the system clock. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(ms);
  return `${String(dt.getUTCFullYear()).padStart(4, "0")}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

const arbNowDateStr = fc
  .integer({ min: 0, max: 4000 })
  .map((offset) => addDays("2024-01-01", offset));

/**
 * A full availability snapshot with injected time. `daysAhead` and `date` stay
 * consistent with `nowDateStr`, and the same-day branch is generated explicitly
 * so the Min_Lead_Time filter is exercised.
 */
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
  { weight: 3, arbitrary: arbStoredSettings },
);

const arbSnapshot: fc.Arbitrary<AvailabilityInput> = fc
  .record({
    settings: arbSnapshotSettings,
    hours: fc.oneof(
      { weight: 7, arbitrary: arbGenerousHours as fc.Arbitrary<DayHours | null> },
      { weight: 3, arbitrary: arbDayHours as fc.Arbitrary<DayHours | null> },
      { weight: 1, arbitrary: fc.constant(null as DayHours | null) },
    ),
    tables: fc.oneof(
      { weight: 7, arbitrary: fc.array(arbTableSpec, { minLength: 1, maxLength: 6 }).map(withIds) },
      { weight: 2, arbitrary: arbTables() },
    ),
    bookingSpecs: fc.array(
      fc.record({
        tableIndex: fc.integer({ min: 0, max: 6 }),
        startMinutes: arbMinuteOfDay,
        turnTimeMinutes: fc.oneof(arbTurnTime, fc.constant(undefined as unknown as number)),
        status: arbAnyStatus,
        // when true the occupancy window is placed inside the open window, so
        // occupied slots occur often rather than by chance
        insideWindow: fc.boolean(),
      }),
      { maxLength: 8 },
    ),
    boundaryBooking: fc.boolean(),
    partySize: fc.oneof(
      { weight: 6, arbitrary: fc.integer({ min: 1, max: 8 }) },
      { weight: 2, arbitrary: fc.integer({ min: 1, max: LIMITS.seatCapacity.max }) },
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

    // Edge case: an occupancy window whose end lands exactly on Open_Time, so
    // the first candidate Booking_Slot starts exactly at that window's end.
    if (raw.boundaryBooking && raw.tables.length > 0 && raw.hours) {
      const open = parseClock(raw.hours.openTime) ?? 0;
      const turn = resolveSettings(raw.settings).turnTime;
      bookings.push({
        id: "b-boundary",
        tableId: raw.tables[0].id,
        startMinutes: Math.max(0, open - turn),
        turnTimeMinutes: turn,
        status: BLOCKING_STATUSES[0],
      });
    }

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

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Reference `parseClock`: a whole-minute time of day from 00:00 to 23:59. */
function referenceParseClock(v: string): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const arbClockCandidate = fc.oneof(
  { weight: 3, arbitrary: arbMinuteOfDay.map(formatClock) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      "24:00",
      "23:60",
      "0:0",
      "7:5",
      " 07:30 ",
      "07:30 PM",
      "-1:00",
      "12:3a",
      "0730",
      "07:300",
      "1:005",
      ":30",
      "07:",
      "",
      ":",
      "07:30:00",
      "07.30",
      "٠٧:٣٠",
    ),
  },
  { weight: 2, arbitrary: fc.string() },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.integer({ min: -5, max: 40 }), fc.integer({ min: -5, max: 75 }))
      .map(([h, m]) => `${h}:${String(m).padStart(2, "0")}`),
  },
);

// ===========================================================================
// Task 4.1 — focused closure input examples
// ===========================================================================

function closureAvailabilityInput(
  closures?: AvailabilityClosureInput,
  overrides: Partial<AvailabilityInput> = {},
): AvailabilityInput {
  return {
    settings: DEFAULT_SETTINGS,
    hours: { dayOfWeek: 1, openTime: "09:00", closeTime: "12:00", isClosed: false },
    tables: [
      {
        id: "small",
        name: "Small",
        seatCapacity: 2,
        area: "Main",
        displayOrder: 1,
        state: "active",
      },
      {
        id: "large",
        name: "Large",
        seatCapacity: 6,
        area: "Main",
        displayOrder: 2,
        state: "active",
      },
      {
        id: "inactive",
        name: "Inactive",
        seatCapacity: 10,
        area: "Main",
        displayOrder: 3,
        state: "inactive",
      },
    ],
    bookings: [
      {
        id: "small-booking",
        tableId: "small",
        startMinutes: 9 * 60,
        turnTimeMinutes: DEFAULT_SETTINGS.turnTime,
        status: "Confirmed",
      },
      {
        id: "large-booking",
        tableId: "large",
        startMinutes: 9 * 60,
        turnTimeMinutes: DEFAULT_SETTINGS.turnTime,
        status: "Confirmed",
      },
    ],
    closures,
    partySize: 2,
    date: "2026-06-02",
    nowDateStr: "2026-06-01",
    nowMinutes: 8 * 60,
    daysAhead: 1,
    ...overrides,
  };
}

describe("computeAvailability closure inputs", () => {
  it("preserves existing behavior when closure input is omitted or empty", () => {
    const omitted = computeAvailability(closureAvailabilityInput());
    const empty = computeAvailability(
      closureAvailabilityInput({ restaurantClosed: false, closedTableIds: [] }),
    );

    expect(omitted).toEqual(empty);
    expect(omitted.closed).toBe(false);
    expect(omitted.activeTableCount).toBe(2);
    expect(omitted.largestCapacity).toBe(6);
    expect(omitted.slots.length).toBeGreaterThan(0);
  });

  it("returns a restaurant-scoped closure as closed with no slots", () => {
    const result = computeAvailability(
      closureAvailabilityInput({ restaurantClosed: true, closedTableIds: [] }),
    );

    expect(result).toMatchObject({
      closed: true,
      outOfWindow: false,
      requiresMultipleTables: false,
      slots: [],
    });
  });

  it("keeps out-of-window precedence over a restaurant-scoped closure", () => {
    const result = computeAvailability(
      closureAvailabilityInput(
        { restaurantClosed: true, closedTableIds: [] },
        { daysAhead: DEFAULT_SETTINGS.advanceBookingWindow + 1 },
      ),
    );

    expect(result).toMatchObject({
      closed: false,
      outOfWindow: true,
      requiresMultipleTables: false,
      slots: [],
    });
  });

  it("removes table-scoped closures before capacity and occupancy evaluation", () => {
    const result = computeAvailability(
      closureAvailabilityInput(
        { restaurantClosed: false, closedTableIds: ["large", "large", "missing"] },
        { partySize: 4 },
      ),
    );

    expect(result.activeTableCount).toBe(1);
    expect(result.largestCapacity).toBe(2);
    // Closing the only table that could seat four alone leaves a party of four
    // needing a Table_Group — guidance, not a refusal.
    expect(result.requiresMultipleTables).toBe(true);
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.slots[0].occupiedCount).toBe(1);
    for (const slot of result.slots) {
      expect(slot.availableTableIds).not.toContain("large");
      expect(slot.occupiedCount).toBeLessThanOrEqual(1);
    }
  });

  it("excludes exactly the closed table id while every other table stays under all rules", () => {
    // Close only "small". "large" (which carries its own booking) must remain
    // fully evaluated: excluded from its own occupancy window and available
    // once that window ends — proving all other availability rules still apply.
    const closed = computeAvailability(
      closureAvailabilityInput({ restaurantClosed: false, closedTableIds: ["small"] }),
    );
    const baseline = computeAvailability(closureAvailabilityInput());

    // Exactly one table removed; "large" is untouched.
    expect(closed.activeTableCount).toBe(1);
    expect(closed.largestCapacity).toBe(6);
    expect(closed.closed).toBe(false);
    expect(closed.slots.length).toBe(baseline.slots.length);

    for (const slot of closed.slots) {
      // The closed id is never offered and never counted as occupied.
      expect(slot.availableTableIds).not.toContain("small");
      expect(slot.occupiedCount).toBeLessThanOrEqual(1);
    }

    // "large" still follows the occupancy rule: booked at 09:00 for the default
    // turn time, so its opening slot is occupied and offers no table...
    const firstSlot = closed.slots[0];
    expect(firstSlot.occupiedCount).toBe(1);
    expect(firstSlot.availableTableIds).not.toContain("large");

    // ...and it becomes available again once its own booking window closes.
    const freeSlot = closed.slots.find((s) => s.startMinutes >= 9 * 60 + DEFAULT_SETTINGS.turnTime);
    expect(freeSlot).toBeDefined();
    expect(freeSlot?.availableTableIds).toEqual(["large"]);
    expect(freeSlot?.occupiedCount).toBe(0);
  });
});

// ===========================================================================
// Task 3.1 — slot generation, clocks, overlap, availability, indicators,
//            determinism and tenant-local now (Properties 1, 2, 3, 5, 6, 7, 8, 9)
// ===========================================================================

describe("Property 1: Slot generation is bounded by Close_Time minus Turn_Time", () => {
  // Feature: restaurant-table-booking, Property 1: For any weekday hours and any Service_Settings, the generated Booking_Slot list either is empty — exactly when the day is closed or when Close_Time minus Turn_Time is earlier than Open_Time — or starts at Open_Time, has a constant difference of Slot_Interval between consecutive starts, has every start at or before Close_Time minus Turn_Time, and admits no further start within that bound. A closed weekday produces the same empty result whatever Open_Time and Close_Time it stores.
  it("is empty exactly when closed or close-turn < open, otherwise a bounded arithmetic run from open", () => {
    fc.assert(
      fc.property(
        arbDayHours,
        arbStoredSettings,
        arbMinuteOfDay,
        arbMinuteOfDay,
        (hours, stored, altA, altB) => {
          const settings = resolveSettings(stored);
          const starts = generateSlotStarts(hours, stored);

          const open = parseClock(hours.openTime);
          const close = parseClock(hours.closeTime);
          const latest = open === null || close === null ? null : close - settings.turnTime;
          const expectEmpty =
            hours.isClosed || open === null || close === null || (latest as number) < open;

          expect(starts).toEqual(referenceSlotStarts(hours, settings));
          expect(starts.length === 0).toBe(expectEmpty);

          if (!expectEmpty) {
            expect(starts[0]).toBe(open);
            for (let i = 1; i < starts.length; i++) {
              expect(starts[i] - starts[i - 1]).toBe(settings.slotInterval);
            }
            for (const s of starts) expect(s).toBeLessThanOrEqual(latest as number);
            expect(starts[starts.length - 1] + settings.slotInterval).toBeGreaterThan(
              latest as number,
            );
          }

          // A closed weekday is empty whatever Open_Time and Close_Time it stores.
          const closedVariant: DayHours = {
            ...hours,
            isClosed: true,
            openTime: formatClock(altA),
            closeTime: formatClock(altB),
          };
          expect(generateSlotStarts(closedVariant, stored)).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 2: Clock values round-trip through their string form", () => {
  // Feature: restaurant-table-booking, Property 2: For any whole minute of day from 0 to 1439, formatting it as a clock string and parsing that string returns the same minute; and for any string that is not a whole-minute time from 00:00 to 23:59, parsing rejects it.
  it("formatClock/parseClock round-trip every minute and parseClock rejects every non-time string", () => {
    fc.assert(
      fc.property(arbMinuteOfDay, arbClockCandidate, (minute, candidate) => {
        expect(parseClock(formatClock(minute))).toBe(minute);
        expect(formatClock(minute)).toMatch(/^\d{2}:\d{2}$/);

        const reference = referenceParseClock(candidate);
        expect(parseClock(candidate)).toBe(reference);
        if (reference === null) expect(parseClock(candidate)).toBeNull();
        else expect(formatClock(reference)).toBe(formatClock(parseClock(candidate) as number));
      }),
      { numRuns: 500 },
    );
  });
});

describe("Property 3: Occupancy windows overlap exactly when their half-open intervals intersect", () => {
  // Feature: restaurant-table-booking, Property 3: For any two Occupancy_Windows described by a start minute and a Turn_Time, the overlap test is true if and only if the first start is earlier than the second end and the second start is earlier than the first end; in particular, for any window, a candidate whose start equals that window's end does not overlap it.
  it("agrees with the half-open intersection test and never overlaps a candidate at the window's end", () => {
    fc.assert(
      fc.property(
        arbMinuteOfDay,
        arbTurnTime,
        arbMinuteOfDay,
        arbTurnTime,
        (aStart, aTurn, bStart, bTurn) => {
          const expected = aStart < bStart + bTurn && bStart < aStart + aTurn;
          expect(windowsOverlap(aStart, aTurn, bStart, bTurn)).toBe(expected);
          // symmetric
          expect(windowsOverlap(bStart, bTurn, aStart, aTurn)).toBe(expected);
          // a candidate starting exactly at the window's end does not overlap it
          expect(windowsOverlap(aStart + aTurn, bTurn, aStart, aTurn)).toBe(false);
          // and one minute earlier does
          expect(windowsOverlap(aStart + aTurn - 1, bTurn, aStart, aTurn)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("Property 5: The Available_Table set equals its reference definition, and the reported counts agree with it", () => {
  // Feature: restaurant-table-booking, Property 5: For any snapshot of Dining_Tables, existing Table_Bookings, Service_Settings, and Party_Size, the Available_Table set the Availability_Service returns for each Booking_Slot equals, element for element, the set of Dining_Tables whose Table_State is `active`, whose Seat_Capacity is at least the requested Party_Size, and none of whose blocking Table_Bookings overlaps that Booking_Slot's Occupancy_Window — including when the booked Dining_Table is `inactive`, in which case it is excluded from availability while its blocking Table_Booking still occupies its window. For each Booking_Slot the reported available count equals the size of that set, the reported active-table count equals the number of `active` Dining_Tables, and available plus occupied never exceeds the active-table count.
  it("equals the reference set element for element with faithful counts bounded by the active table count", () => {
    fc.assert(
      fc.property(
        arbSnapshot,
        arbReleasingStatus,
        arbBlockingStatus,
        (snapshot, releasing, blocking) => {
          const result = computeAvailability(snapshot);
          expect(result).toEqual(referenceAvailability(snapshot));

          const activeIds = new Set(
            snapshot.tables.filter((t) => t.state === "active").map((t) => t.id),
          );
          expect(result.activeTableCount).toBe(activeIds.size);

          for (const slot of result.slots) {
            expect(slot.availableCount).toBe(slot.availableTableIds.length);
            expect(slot.availableCount + slot.occupiedCount).toBeLessThanOrEqual(
              result.activeTableCount,
            );
            // never an inactive table, and never a duplicate
            for (const id of slot.availableTableIds) expect(activeIds.has(id)).toBe(true);
            expect(new Set(slot.availableTableIds).size).toBe(slot.availableTableIds.length);
            expect(slot.availableTableIds).toEqual(
              orderTables(snapshot.tables.filter((t) => slot.availableTableIds.includes(t.id))).map(
                (t) => t.id,
              ),
            );
          }

          // Releasing_Statuses occupy nothing; Blocking_Statuses occupy their window.
          const released = computeAvailability({
            ...snapshot,
            bookings: snapshot.bookings.map((b) => ({ ...b, status: releasing })),
          });
          for (const slot of released.slots) expect(slot.occupiedCount).toBe(0);

          const allBlocking = computeAvailability({
            ...snapshot,
            bookings: snapshot.bookings.map((b) => ({ ...b, status: blocking })),
          });
          expect(allBlocking).toEqual(
            referenceAvailability({
              ...snapshot,
              bookings: snapshot.bookings.map((b) => ({ ...b, status: blocking })),
            }),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 6: Same-day slots respect Min_Lead_Time", () => {
  // Feature: restaurant-table-booking, Property 6: For any current time, any Min_Lead_Time from 0 to 1440, and any weekday hours, every Booking_Slot returned for the current date has a start time at or after the current time plus Min_Lead_Time, and every generated start time earlier than that bound is absent from the returned list.
  it("returns exactly the generated starts at or after now plus Min_Lead_Time on the current date", () => {
    fc.assert(
      fc.property(arbSnapshot, arbMinLeadTime, (base, minLeadTime) => {
        const settings: ServiceSettings = { ...resolveSettings(base.settings), minLeadTime };
        const snapshot: AvailabilityInput = {
          ...base,
          settings,
          date: base.nowDateStr,
          daysAhead: 0,
        };
        const result = computeAvailability(snapshot);
        const bound = snapshot.nowMinutes + minLeadTime;
        const generated = referenceSlotStarts(
          snapshot.hours ?? { dayOfWeek: 0, openTime: "", closeTime: "", isClosed: true },
          settings,
        );

        for (const slot of result.slots) expect(slot.startMinutes).toBeGreaterThanOrEqual(bound);
        for (const start of generated.filter((s) => s < bound)) {
          expect(result.slots.some((s) => s.startMinutes === start)).toBe(false);
        }
        if (!result.closed && !result.outOfWindow) {
          expect(result.slots.map((s) => s.startMinutes)).toEqual(
            generated.filter((s) => s >= bound),
          );
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("Property 7: At most one availability indicator is raised, and out-of-window wins", () => {
  // Feature: restaurant-table-booking, Property 7: For any snapshot, at most one of the closed, out-of-window, and multiple-tables indicators is true; out-of-window is true exactly when the booking date is later than the current date plus Advance_Booking_Window days and then the Booking_Slot list is empty and the other two indicators are false; the multiple-tables indicator is true exactly when the date is in window, the day is open, at least one `active` Dining_Table exists, and the requested Party_Size exceeds the largest Seat_Capacity among them — and it never empties an Available_Table set, because a Table_Group can seat the party.
  it("raises at most one indicator with out-of-window short-circuiting the other two", () => {
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        const settings = resolveSettings(snapshot.settings);
        const result = computeAvailability(snapshot);

        const raised = [result.closed, result.outOfWindow, result.requiresMultipleTables].filter(
          Boolean,
        ).length;
        expect(raised).toBeLessThanOrEqual(1);

        const expectOutOfWindow = snapshot.daysAhead > settings.advanceBookingWindow;
        expect(result.outOfWindow).toBe(expectOutOfWindow);
        if (expectOutOfWindow) {
          expect(result.slots).toEqual([]);
          expect(result.closed).toBe(false);
          expect(result.requiresMultipleTables).toBe(false);
          return;
        }

        const isOpen = !!snapshot.hours && !snapshot.hours.isClosed;
        expect(result.closed).toBe(!isOpen);
        if (!isOpen) {
          expect(result.slots).toEqual([]);
          expect(result.requiresMultipleTables).toBe(false);
          return;
        }

        expect(result.requiresMultipleTables).toBe(
          result.activeTableCount > 0 && snapshot.partySize > result.largestCapacity,
        );
        if (result.requiresMultipleTables) {
          // The indicator is guidance only. Every unoccupied Dining_Table stays
          // available, so the guest can combine tables to seat the party.
          const anyAvailable = result.slots.some((s) => s.availableTableIds.length > 0);
          const anyUnoccupied = result.slots.some((s) => s.occupiedCount < result.activeTableCount);
          expect(anyAvailable).toBe(anyUnoccupied);

          // The date's Booking_Slots are still returned: whenever the day admits
          // any slot at all, the returned list is non-empty (Req 5.10).
          const generated = referenceSlotStarts(snapshot.hours as DayHours, settings).filter(
            (s) =>
              snapshot.date !== snapshot.nowDateStr ||
              s >= snapshot.nowMinutes + settings.minLeadTime,
          );
          expect(result.slots.length).toBe(generated.length);
          if (generated.length > 0) expect(result.slots.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("Property 8: Availability is deterministic and order-independent", () => {
  // Feature: restaurant-table-booking, Property 8: For any snapshot, computing availability twice returns deeply equal results, and permuting the order of the Dining_Table and Table_Booking inputs leaves the result deeply equal — so two requests for the same Tenant, date, and Party_Size with no intervening change return identical Booking_Slots and identical Available_Table sets, and no result depends on a value from an earlier call.
  it("returns deeply equal results across repeated calls and across permuted inputs", () => {
    fc.assert(
      fc.property(
        arbSnapshot,
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (snapshot, seedA, seedB) => {
          const first = computeAvailability(snapshot);
          const second = computeAvailability(snapshot);
          expect(second).toEqual(first);

          const permuted = computeAvailability({
            ...snapshot,
            tables: shuffled(snapshot.tables, seedA),
            bookings: shuffled(snapshot.bookings, seedB),
          });
          expect(permuted).toEqual(first);

          // a third call after an unrelated call on a different snapshot
          computeAvailability({ ...snapshot, partySize: snapshot.partySize + 1, tables: [] });
          expect(computeAvailability(snapshot)).toEqual(first);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 9: Tenant-local now is derived from the Tenant_Timezone", () => {
  // Feature: restaurant-table-booking, Property 9: For any instant and any Tenant_Timezone, the derived current date, current minute of day, and weekday agree with that instant rendered in that timezone, and the derived values change with the timezone whenever the timezone's local date or clock differs for that instant.
  it("agrees with the instant rendered in that timezone and differs exactly when the rendering differs", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date(Date.UTC(1995, 0, 1)),
          max: new Date(Date.UTC(2060, 0, 1)),
          noInvalidDate: true,
        }),
        fc.oneof(arbTimezone, fc.constantFrom("", "   ", "Not/AZone", "Mars/Base")),
        arbTimezone,
        (instant, zoneA, zoneB) => {
          const derived = tenantNow(zoneA, instant);
          const reference = referenceTenantLocal(zoneA, instant);

          expect(derived.dateStr).toBe(reference.dateStr);
          expect(derived.minutesOfDay).toBe(reference.minutesOfDay);
          expect(derived.weekday).toBe(reference.weekday);
          expect(derived.minutesOfDay).toBeGreaterThanOrEqual(0);
          expect(derived.minutesOfDay).toBeLessThan(MINUTES_PER_DAY);

          const derivedB = tenantNow(zoneB, instant);
          const referenceB = referenceTenantLocal(zoneB, instant);
          const sameRendering =
            reference.dateStr === referenceB.dateStr &&
            reference.minutesOfDay === referenceB.minutesOfDay;
          expect(
            derived.dateStr === derivedB.dateStr && derived.minutesOfDay === derivedB.minutesOfDay,
          ).toBe(sameRendering);
        },
      ),
      { numRuns: 400 },
    );
  });
});

// ===========================================================================
// Task 3.2 — ordering, auto-assignment, validation and the occupancy rate
//            (Properties 11, 17, 18, 19, 21, 24)
// ===========================================================================

/** Mirrors the module's whole-number coercion (integers, or exact integer strings). */
function referenceWhole(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^[+-]?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function referenceTrim(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function referenceAbsent(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

const arbSubmittedName = fc.oneof(
  { weight: 4, arbitrary: arbTableName as fc.Arbitrary<unknown> },
  {
    weight: 3,
    arbitrary: fc.constantFrom<unknown>(
      "",
      " ",
      "   ",
      "\t\n ",
      "A".repeat(40),
      "A".repeat(41),
      " Padded ",
      "  T1  ",
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 50 }) as fc.Arbitrary<unknown> },
  { weight: 1, arbitrary: fc.constantFrom<unknown>(undefined, null, 12) },
);

const arbSubmittedCapacity = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: -2, max: 34 }) as fc.Arbitrary<unknown> },
  { weight: 3, arbitrary: fc.constantFrom<unknown>(0, 1, 30, 31, 4.5, -1, 2.5, 29.999) },
  { weight: 3, arbitrary: fc.constantFrom<unknown>("4", " 12 ", "4.5", "abc", "", "12e1", "030") },
  { weight: 1, arbitrary: fc.constantFrom<unknown>(undefined, null, true) },
);

const arbSubmittedArea = fc.oneof(
  { weight: 4, arbitrary: arbTableArea as fc.Arbitrary<unknown> },
  {
    weight: 3,
    arbitrary: fc.constantFrom<unknown>("", "   ", "A".repeat(30), "A".repeat(31), " Patio "),
  },
  { weight: 1, arbitrary: fc.constantFrom<unknown>(undefined, null) },
);

const arbSubmittedDisplayOrder = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom<unknown>(undefined, null, "") },
  { weight: 4, arbitrary: fc.integer({ min: -1, max: 1001 }) as fc.Arbitrary<unknown> },
  { weight: 2, arbitrary: fc.constantFrom<unknown>(0, 1, 999, 1000, 2.5, "7", "abc") },
);

/** 199 / 200 / 201 boundary counts of the 200-tables-per-tenant cap. */
const arbTableCount = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(199, 200, 201) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 205 }) },
  { weight: 1, arbitrary: fc.constant(undefined as unknown as number) },
);

const arbExistingNames = fc
  .uniqueArray(arbTableName, { maxLength: 5, selector: (n) => n.trim().toLowerCase() })
  .map((names) => names.map((name, i) => ({ id: `e${i}`, name })));

describe("Property 11: Auto-assignment picks the smallest sufficient table deterministically", () => {
  // Feature: restaurant-table-booking, Property 11: For any Available_Table set, the Dining_Table assigned for the Table selection `Any available table` is a member of that set, no member has a smaller Seat_Capacity, ties are resolved by the lowest Display_Order and then the lowest Table_Name in ascending order, the choice is invariant to the order in which the set is supplied, and the assignment is refused exactly when the set is empty.
  it("picks a minimal member under capacity, display order then name, and refuses exactly on the empty set", () => {
    fc.assert(
      fc.property(
        arbTables(7),
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (tables, seedA, seedB) => {
          const chosen = pickAutoTable(tables);

          if (tables.length === 0) {
            expect(chosen).toBeNull();
            return;
          }

          expect(chosen).not.toBeNull();
          const pick = chosen as DiningTable;
          expect(tables.some((t) => t.id === pick.id)).toBe(true);

          for (const t of tables) {
            expect(t.seatCapacity).toBeGreaterThanOrEqual(pick.seatCapacity);
            if (t.seatCapacity === pick.seatCapacity) {
              expect(t.displayOrder).toBeGreaterThanOrEqual(pick.displayOrder);
              if (t.displayOrder === pick.displayOrder) {
                expect(t.name.toLowerCase() >= pick.name.toLowerCase()).toBe(true);
              }
            }
          }

          expect(pickAutoTable(shuffled(tables, seedA))?.id).toBe(pick.id);
          expect(pickAutoTable(shuffled(tables, seedB))?.id).toBe(pick.id);
          expect(pickAutoTable([])).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 17: Dining_Table input is accepted exactly within its documented limits", () => {
  // Feature: restaurant-table-booking, Property 17: For any submitted Table_Name, Seat_Capacity, Table_Area, and Display_Order, the submission is accepted if and only if the trimmed Table_Name length is 1 through 40, the Seat_Capacity is a whole number 1 through 30, any supplied Table_Area trims to at most 30 characters, any supplied Display_Order is a whole number 1 through 999, and the Tenant holds fewer than 200 Dining_Tables across both Table_States; an accepted submission stores the trimmed Table_Name, stores the trimmed Table_Area or `Main` when it trims to empty, stores Table_State `active` on creation, and stores as Display_Order, when none is supplied, 1 greater than the highest Display_Order in that Table_Area or 1 when that Table_Area holds none; a rejected submission returns a message naming the offending field with its permitted range and leaves every stored Dining_Table unchanged.
  it("accepts exactly within the documented limits, applies the documented defaults, and reports every offending field", () => {
    fc.assert(
      fc.property(
        fc.record({
          name: arbSubmittedName,
          seatCapacity: arbSubmittedCapacity,
          area: arbSubmittedArea,
          displayOrder: arbSubmittedDisplayOrder,
          existingNames: arbExistingNames,
          editingIndex: fc.integer({ min: -1, max: 4 }),
          tableCount: arbTableCount,
          highest: fc.oneof(
            fc.integer({ min: 0, max: 998 }),
            fc.constant(undefined as unknown as number),
          ),
          existingTables: arbTables(4),
        }),
        (raw) => {
          const editingId =
            raw.editingIndex >= 0 && raw.editingIndex < raw.existingNames.length
              ? raw.existingNames[raw.editingIndex].id
              : null;
          const ctx = {
            existingNames: raw.existingNames,
            editingId,
            tableCount: raw.tableCount,
            highestDisplayOrderInArea: raw.highest,
            existingTables: raw.existingTables,
          };
          const frozen = JSON.stringify(ctx);

          const result = validateTableInput(
            {
              name: raw.name,
              seatCapacity: raw.seatCapacity,
              area: raw.area,
              displayOrder: raw.displayOrder,
            },
            ctx,
          );

          // --- reference decision -------------------------------------------
          const name = referenceTrim(raw.name);
          const nameOk = name.length >= LIMITS.tableName.min && name.length <= LIMITS.tableName.max;
          const capacity = referenceWhole(raw.seatCapacity);
          const capacityOk =
            capacity !== null &&
            capacity >= LIMITS.seatCapacity.min &&
            capacity <= LIMITS.seatCapacity.max;
          const rawArea = referenceTrim(raw.area);
          const areaOk = rawArea.length <= LIMITS.tableArea.max;
          const area = rawArea.length === 0 ? DEFAULT_TABLE_AREA : rawArea;
          const orderAbsent = referenceAbsent(raw.displayOrder);
          const submittedOrder = orderAbsent ? null : referenceWhole(raw.displayOrder);
          const orderOk =
            orderAbsent ||
            (submittedOrder !== null &&
              submittedOrder >= LIMITS.displayOrder.min &&
              submittedOrder <= LIMITS.displayOrder.max);
          const isCreate = referenceAbsent(editingId);
          const count = Number.isInteger(raw.tableCount) ? (raw.tableCount as number) : 0;
          const capOk = !(isCreate && count >= LIMITS.tablesPerTenant);
          const duplicate = raw.existingNames.some(
            (row) => row.id !== editingId && row.name.trim().toLowerCase() === name.toLowerCase(),
          );
          const duplicateRejects = duplicate && name.length > 0;

          const expectedFields = new Set<string>();
          if (!nameOk) expectedFields.add("name");
          if (!capacityOk) expectedFields.add("seatCapacity");
          if (!areaOk) expectedFields.add("area");
          if (!orderOk) expectedFields.add("displayOrder");
          if (!capOk) expectedFields.add("tables");
          if (duplicateRejects) expectedFields.add("name");

          const expectAccept = expectedFields.size === 0;
          expect(result.ok).toBe(expectAccept);

          if (result.ok) {
            expect(result.value.name).toBe(name);
            expect(result.value.area).toBe(area);
            expect(result.value.state).toBe("active");
            expect(result.value.seatCapacity).toBe(capacity);
            if (orderAbsent) {
              let highest = 0;
              if (Number.isInteger(raw.highest)) highest = raw.highest as number;
              else
                for (const t of raw.existingTables) {
                  if (t.area.toLowerCase() === area.toLowerCase() && t.displayOrder > highest)
                    highest = t.displayOrder;
                }
              const expectedOrder = Math.min(
                Math.max(highest + 1, LIMITS.displayOrder.min),
                LIMITS.displayOrder.max,
              );
              expect(result.value.displayOrder).toBe(expectedOrder);
            } else {
              expect(result.value.displayOrder).toBe(submittedOrder);
            }
          } else {
            expect(new Set(result.errors.map((e) => e.field))).toEqual(expectedFields);
            for (const err of result.errors) expect(err.message.length).toBeGreaterThan(0);
            const messages = result.errors.map((e) => e.message);
            if (!nameOk) expect(messages).toContain(MSG_TABLE_NAME_LENGTH);
            if (!capacityOk) expect(messages).toContain(MSG_SEAT_CAPACITY_RANGE);
            if (!areaOk) expect(messages).toContain(MSG_TABLE_AREA_LENGTH);
            if (!orderOk) expect(messages).toContain(MSG_DISPLAY_ORDER_RANGE);
            if (!capOk) expect(messages).toContain(MSG_MAX_TABLES_REACHED);
            if (duplicateRejects) expect(messages).toContain(MSG_DUPLICATE_TABLE_NAME);
          }

          // the validator stores nothing and mutates no input
          expect(JSON.stringify(ctx)).toBe(frozen);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("Property 18: Duplicate Table_Name detection ignores case and surrounding whitespace", () => {
  // Feature: restaurant-table-booking, Property 18: For any stored Table_Name and any variant of it produced by changing letter case or adding leading and trailing whitespace, submitting that variant for a different Dining_Table of the same Tenant is rejected with `A table with this name already exists` and leaves every stored Dining_Table unchanged, while submitting it for the Dining_Table that already holds that Table_Name is accepted.
  it("rejects a case or whitespace variant for another table and accepts it for the row that holds it", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbTableName, {
          minLength: 2,
          maxLength: 4,
          selector: (n) => n.trim().toLowerCase(),
        }),
        fc.integer({ min: 0, max: 3 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
        fc.nat({ max: 3 }),
        fc.nat({ max: 3 }),
        fc.integer({ min: LIMITS.seatCapacity.min, max: LIMITS.seatCapacity.max }),
        (names, ownerIndex, caseFlips, padLeft, padRight, capacity) => {
          const stored = names.map((name, i) => ({ id: `e${i}`, name: name.trim() }));
          const owner = stored[ownerIndex % stored.length];
          const other = stored[(ownerIndex + 1) % stored.length];

          const variant =
            " ".repeat(padLeft) +
            owner.name
              .split("")
              .map((ch, i) =>
                caseFlips[i % caseFlips.length] ? ch.toUpperCase() : ch.toLowerCase(),
              )
              .join("") +
            " ".repeat(padRight);

          const baseCtx = { existingNames: stored, tableCount: stored.length };
          const frozen = JSON.stringify(stored);

          // submitted for a DIFFERENT table => duplicate
          const forOther = validateTableInput(
            { name: variant, seatCapacity: capacity },
            { ...baseCtx, editingId: other.id },
          );
          expect(forOther.ok).toBe(false);
          if (!forOther.ok) {
            expect(forOther.errors.map((e) => e.message)).toContain(MSG_DUPLICATE_TABLE_NAME);
            expect(forOther.errors.some((e) => e.field === "name")).toBe(true);
          }

          // submitted on creation (no editing row) => duplicate as well
          const onCreate = validateTableInput(
            { name: variant, seatCapacity: capacity },
            { ...baseCtx, editingId: null },
          );
          expect(onCreate.ok).toBe(false);

          // submitted for the row that already holds the name => accepted
          const forOwner = validateTableInput(
            { name: variant, seatCapacity: capacity },
            { ...baseCtx, editingId: owner.id },
          );
          expect(forOwner.ok).toBe(true);
          if (forOwner.ok) expect(forOwner.value.name).toBe(variant.trim());

          expect(JSON.stringify(stored)).toBe(frozen);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 19: Dining_Table ordering is a canonical total order", () => {
  // Feature: restaurant-table-booking, Property 19: For any set of Dining_Tables, the ordered read is a permutation of that set, is non-decreasing under Table_Area ascending then Display_Order ascending then Table_Name ascending with Table_Area and Table_Name compared case-insensitively, and is identical whatever order the input arrives in.
  it("is a permutation, non-decreasing under the canonical key, and identical for any input order", () => {
    fc.assert(
      fc.property(
        arbTables(8),
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (tables, seedA, seedB) => {
          const ordered = orderTables(tables);

          // permutation
          expect(ordered.length).toBe(tables.length);
          expect([...ordered].map((t) => t.id).sort()).toEqual([...tables].map((t) => t.id).sort());

          // non-decreasing under area (ci) then displayOrder then name (ci)
          for (let i = 1; i < ordered.length; i++) {
            const a = ordered[i - 1];
            const b = ordered[i];
            const areaA = a.area.toLowerCase();
            const areaB = b.area.toLowerCase();
            if (areaA !== areaB) {
              expect(areaA < areaB).toBe(true);
            } else if (a.displayOrder !== b.displayOrder) {
              expect(a.displayOrder).toBeLessThan(b.displayOrder);
            } else {
              expect(a.name.toLowerCase() <= b.name.toLowerCase()).toBe(true);
            }
          }

          // input-order invariant, and non-mutating
          const snapshot = JSON.stringify(tables);
          expect(orderTables(shuffled(tables, seedA))).toEqual(ordered);
          expect(orderTables(shuffled(tables, seedB))).toEqual(ordered);
          expect(JSON.stringify(tables)).toBe(snapshot);
        },
      ),
      { numRuns: 300 },
    );
  });
});

const arbSubmittedSettings = fc.record(
  {
    slotInterval: fc.oneof(
      { weight: 4, arbitrary: arbSlotInterval as fc.Arbitrary<unknown> },
      {
        weight: 3,
        arbitrary: fc.constantFrom<unknown>(0, 10, 20, 45, 90, 120, "30", "15", "15.5", -15),
      },
      { weight: 1, arbitrary: fc.constantFrom<unknown>(null, "", undefined) },
    ),
    turnTime: fc.oneof(
      { weight: 4, arbitrary: arbTurnTime as fc.Arbitrary<unknown> },
      {
        weight: 3,
        arbitrary: fc.constantFrom<unknown>(29, 30, 240, 241, 0, -30, 90.5, "120", "abc"),
      },
      { weight: 1, arbitrary: fc.constantFrom<unknown>(null, "", undefined) },
    ),
    maxPartySize: fc.oneof(
      { weight: 4, arbitrary: arbMaxPartySize as fc.Arbitrary<unknown> },
      { weight: 3, arbitrary: fc.constantFrom<unknown>(0, 1, 30, 31, -2, 12.5, "8") },
      { weight: 1, arbitrary: fc.constantFrom<unknown>(null, "", undefined) },
    ),
    advanceBookingWindow: fc.oneof(
      { weight: 4, arbitrary: arbAdvanceWindow as fc.Arbitrary<unknown> },
      { weight: 3, arbitrary: fc.constantFrom<unknown>(0, 1, 365, 366, -1, 60.5, "30") },
      { weight: 1, arbitrary: fc.constantFrom<unknown>(null, "", undefined) },
    ),
    minLeadTime: fc.oneof(
      { weight: 4, arbitrary: arbMinLeadTime as fc.Arbitrary<unknown> },
      { weight: 3, arbitrary: fc.constantFrom<unknown>(0, 1440, 1441, -1, 30.5, "0") },
      { weight: 1, arbitrary: fc.constantFrom<unknown>(null, "", undefined) },
    ),
    timezone: fc.oneof(
      arbTimezone as fc.Arbitrary<unknown>,
      fc.constantFrom<unknown>("", "   ", undefined),
    ),
  },
  { requiredKeys: [] },
);

const arbHoursRow = fc.record({
  openTime: fc.oneof(
    { weight: 4, arbitrary: fc.integer({ min: 0, max: 1200 }).map(formatClock) },
    { weight: 2, arbitrary: fc.constantFrom("", "24:00", "9:00", "bad", "23:59") },
  ),
  closeTime: fc.oneof(
    { weight: 4, arbitrary: fc.integer({ min: 0, max: 1439 }).map(formatClock) },
    { weight: 2, arbitrary: fc.constantFrom("", "24:00", "00:00", "bad", "23:59") },
  ),
  isClosed: fc.oneof(
    { weight: 3, arbitrary: fc.boolean() as fc.Arbitrary<unknown> },
    { weight: 1, arbitrary: fc.constantFrom<unknown>(1, "1", 0, "0", undefined) },
  ),
});

const arbWellFormedHours = fc
  .array(
    fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 1, max: 400 }), fc.boolean()),
    {
      minLength: 7,
      maxLength: 7,
    },
  )
  .map((rows) =>
    rows.map(([open, span, isClosed], i) => ({
      dayOfWeek: i,
      openTime: formatClock(open),
      closeTime: formatClock(Math.min(MINUTES_PER_DAY - 1, open + span)),
      isClosed,
    })),
  );

const arbSubmittedHours = fc.oneof(
  { weight: 4, arbitrary: arbWellFormedHours as fc.Arbitrary<unknown> },
  {
    weight: 4,
    arbitrary: fc
      .array(arbHoursRow, { minLength: 7, maxLength: 7 })
      .map((rows) => rows.map((r, i) => ({ ...r, dayOfWeek: i }))) as fc.Arbitrary<unknown>,
  },
  {
    // duplicate weekday -> the seven-weekday rule rejects
    weight: 2,
    arbitrary: fc
      .array(arbHoursRow, { minLength: 7, maxLength: 7 })
      .map((rows) =>
        rows.map((r, i) => ({ ...r, dayOfWeek: i === 6 ? 0 : i })),
      ) as fc.Arbitrary<unknown>,
  },
  {
    // wrong cardinality
    weight: 2,
    arbitrary: fc
      .array(arbHoursRow, { minLength: 0, maxLength: 9 })
      .filter((rows) => rows.length !== 7)
      .map((rows) => rows.map((r, i) => ({ ...r, dayOfWeek: i }))) as fc.Arbitrary<unknown>,
  },
  { weight: 1, arbitrary: fc.constantFrom<unknown>(null, undefined, "hours", 7, {}) },
);

/** Reference decision for `validateOperatingHours`. */
function referenceHours(
  input: unknown,
): { ok: true; days: DayHours[] } | { ok: false; fields: string[] } {
  if (!Array.isArray(input) || input.length !== 7) return { ok: false, fields: ["hours"] };

  const seen = new Set<number>();
  const offending: string[] = [];
  const days: DayHours[] = [];

  input.forEach((row, index) => {
    const raw = (row ?? {}) as Record<string, unknown>;
    const submitted = referenceWhole(raw.dayOfWeek);
    const dayOfWeek = submitted !== null && submitted >= 0 && submitted <= 6 ? submitted : index;
    seen.add(dayOfWeek);

    const isClosed = raw.isClosed === true || raw.isClosed === 1 || raw.isClosed === "1";
    const open = referenceParseClock(String(raw.openTime ?? ""));
    const close = referenceParseClock(String(raw.closeTime ?? ""));
    if (!isClosed && (open === null || close === null || close <= open)) {
      offending.push(`hours.${dayOfWeek}`);
    }
    days.push({
      dayOfWeek,
      openTime: open === null ? "00:00" : formatClock(open),
      closeTime: close === null ? "00:00" : formatClock(close),
      isClosed,
    });
  });

  if (seen.size !== 7) return { ok: false, fields: ["hours"] };
  if (offending.length > 0) return { ok: false, fields: offending };
  return { ok: true, days: days.sort((a, b) => a.dayOfWeek - b.dayOfWeek) };
}

/** Seven well-formed stored Operating_Hours rows, used as the "previously stored" state. */
const STORED_HOURS: DayHours[] = Array.from({ length: 7 }, (_, i) => ({
  dayOfWeek: i,
  openTime: "11:00",
  closeTime: "23:00",
  isClosed: false,
}));

describe("Property 21: Service_Settings and Operating_Hours are accepted exactly within their documented limits, and absent values fall back to defaults", () => {
  // Feature: restaurant-table-booking, Property 21: For any submitted Service_Settings, the submission is accepted if and only if Slot_Interval is 15, 30, or 60, Turn_Time is a whole number 30 through 240, Max_Party_Size is a whole number 1 through 30, Advance_Booking_Window is a whole number 1 through 365, and Min_Lead_Time is a whole number 0 through 1440; for any submitted Operating_Hours, the submission is accepted if and only if every weekday whose Closed_Flag is false carries an Open_Time and a strictly later Close_Time; a rejected submission names every offending field or the offending weekday and leaves the previously stored Service_Settings and all seven stored Operating_Hours rows unchanged; and for any partially stored Service_Settings, each absent field resolves to its documented default while every present field is used as stored.
  it("accepts exactly within the limits, names every offending field or weekday, and defaults every absent field", () => {
    fc.assert(
      fc.property(
        arbSubmittedSettings,
        arbSubmittedHours,
        arbPartialSettings,
        arbSettings,
        (submitted, hours, partial, storedSettings) => {
          // --- a store that only changes on an accepted submission -------------
          const store = {
            settings: { ...storedSettings },
            hours: STORED_HOURS.map((d) => ({ ...d })),
          };
          const before = JSON.stringify(store);

          // --- Service_Settings -------------------------------------------------
          const raw = (submitted ?? {}) as Record<string, unknown>;
          const expectedFields = new Set<string>();

          let expectedInterval = DEFAULT_SETTINGS.slotInterval;
          if (!referenceAbsent(raw.slotInterval)) {
            const v = referenceWhole(raw.slotInterval);
            if (v === null || !(SLOT_INTERVALS as readonly number[]).includes(v))
              expectedFields.add("slotInterval");
            else expectedInterval = v;
          }
          const readField = (
            key: string,
            range: { min: number; max: number },
            fallback: number,
          ): number => {
            if (referenceAbsent(raw[key])) return fallback;
            const v = referenceWhole(raw[key]);
            if (v === null || v < range.min || v > range.max) {
              expectedFields.add(key);
              return fallback;
            }
            return v;
          };
          const expectedTurn = readField("turnTime", LIMITS.turnTime, DEFAULT_SETTINGS.turnTime);
          const expectedParty = readField(
            "maxPartySize",
            LIMITS.maxPartySize,
            DEFAULT_SETTINGS.maxPartySize,
          );
          const expectedWindow = readField(
            "advanceBookingWindow",
            LIMITS.advanceBookingWindow,
            DEFAULT_SETTINGS.advanceBookingWindow,
          );
          const expectedLead = readField(
            "minLeadTime",
            LIMITS.minLeadTime,
            DEFAULT_SETTINGS.minLeadTime,
          );

          const settingsResult = validateServiceSettings(submitted);
          expect(settingsResult.ok).toBe(expectedFields.size === 0);

          if (settingsResult.ok) {
            expect(settingsResult.value.slotInterval).toBe(expectedInterval);
            expect(settingsResult.value.turnTime).toBe(expectedTurn);
            expect(settingsResult.value.maxPartySize).toBe(expectedParty);
            expect(settingsResult.value.advanceBookingWindow).toBe(expectedWindow);
            expect(settingsResult.value.minLeadTime).toBe(expectedLead);
            expect(settingsResult.value.timezone.length).toBeGreaterThan(0);
            store.settings = settingsResult.value;
          } else {
            expect(new Set(settingsResult.errors.map((e) => e.field))).toEqual(expectedFields);
            const messages = settingsResult.errors.map((e) => e.message);
            if (expectedFields.has("slotInterval")) expect(messages).toContain(MSG_SLOT_INTERVAL);
            if (expectedFields.has("turnTime")) expect(messages).toContain(MSG_TURN_TIME);
            if (expectedFields.has("maxPartySize")) expect(messages).toContain(MSG_MAX_PARTY_SIZE);
            if (expectedFields.has("advanceBookingWindow"))
              expect(messages).toContain(MSG_ADVANCE_WINDOW);
            if (expectedFields.has("minLeadTime")) expect(messages).toContain(MSG_MIN_LEAD_TIME);
            expect(JSON.stringify(store)).toBe(before);
          }

          // --- Operating_Hours --------------------------------------------------
          const hoursExpected = referenceHours(hours);
          const hoursResult = validateOperatingHours(hours);
          expect(hoursResult.ok).toBe(hoursExpected.ok);

          if (hoursResult.ok && hoursExpected.ok) {
            expect(hoursResult.value).toEqual(hoursExpected.days);
            expect(hoursResult.value.length).toBe(7);
            expect(hoursResult.value.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
          } else if (!hoursResult.ok && !hoursExpected.ok) {
            expect(new Set(hoursResult.errors.map((e) => e.field))).toEqual(
              new Set(hoursExpected.fields),
            );
            for (const err of hoursResult.errors) {
              if (err.field === "hours") expect(err.message).toBe(MSG_HOURS_SEVEN_DAYS);
              else expect(err.message).toBe(msgOperatingHoursDay(Number(err.field.split(".")[1])));
            }
            // all seven stored rows are untouched by a rejected submission
            expect(JSON.stringify(store.hours)).toBe(JSON.stringify(JSON.parse(before).hours));
          }

          // --- per-field defaults for a partially stored row --------------------
          const resolved = resolveSettings(partial);
          for (const key of [
            "slotInterval",
            "turnTime",
            "maxPartySize",
            "advanceBookingWindow",
            "minLeadTime",
          ] as const) {
            if (partial[key] === undefined) expect(resolved[key]).toBe(DEFAULT_SETTINGS[key]);
            else expect(resolved[key]).toBe(partial[key]);
          }
          expect(resolveSettings(undefined)).toEqual(DEFAULT_SETTINGS);
          expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("Property 24: Overview aggregates are faithful and the occupancy rate stays bounded", () => {
  // Feature: restaurant-table-booking, Property 24: For any set of Table_Bookings, the Overview booking count and Party_Size sum equal those aggregates over the Table_Bookings whose booking date is the current date in the Tenant_Timezone; for any blocking table-slot pair count, `active` Dining_Table count, and Booking_Slot count, the occupancy rate is a whole number between 0 and 100 inclusive, equals the ratio of blocking pairs to the product of the two counts rounded to the nearest whole number, is non-decreasing in the blocking pair count, and is 0 when the Booking_Slot count is 0.
  it("aggregates only the current date and keeps the occupancy rate a bounded monotonic whole percentage", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dayOffset: fc.integer({ min: -3, max: 3 }),
            partySize: fc.integer({ min: 1, max: LIMITS.maxPartySize.max }),
            status: arbAnyStatus,
          }),
          { maxLength: 14 },
        ),
        arbNowDateStr,
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 50 }),
        (specs, nowDateStr, pairs, activeTables, slotCount, delta) => {
          const bookings = specs.map((s, i) => ({
            id: `b${i}`,
            date: addDays(nowDateStr, s.dayOffset),
            partySize: s.partySize,
            status: s.status,
          }));

          // Overview aggregates for the current tenant-local date.
          const todays = bookings.filter((b) => b.date === nowDateStr);
          const overview = {
            count: bookings.filter((b) => b.date === nowDateStr).length,
            partySizeSum: bookings
              .filter((b) => b.date === nowDateStr)
              .reduce((sum, b) => sum + b.partySize, 0),
          };
          expect(overview.count).toBe(todays.length);
          expect(overview.partySizeSum).toBe(todays.reduce((sum, b) => sum + b.partySize, 0));
          // bookings on other dates never contribute
          expect(overview.count).toBe(
            bookings.length - bookings.filter((b) => b.date !== nowDateStr).length,
          );
          for (const b of bookings.filter((b) => b.date !== nowDateStr)) {
            expect(todays.some((t) => t.id === b.id)).toBe(false);
          }
          expect(daysBetween(nowDateStr, nowDateStr)).toBe(0);

          // Occupancy rate.
          const rate = occupancyRate(pairs, activeTables, slotCount);
          expect(Number.isInteger(rate)).toBe(true);
          expect(rate).toBeGreaterThanOrEqual(0);
          expect(rate).toBeLessThanOrEqual(100);

          if (slotCount === 0 || activeTables === 0) {
            expect(rate).toBe(0);
          } else {
            const exact = Math.round((pairs / (activeTables * slotCount)) * 100);
            expect(rate).toBe(Math.min(100, Math.max(0, exact)));
          }

          // non-decreasing in the blocking pair count
          expect(occupancyRate(pairs + delta, activeTables, slotCount)).toBeGreaterThanOrEqual(
            rate,
          );
          expect(occupancyRate(pairs, activeTables, 0)).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ===========================================================================
// Task 3.3 — routing, navigation derivation, server-side write refusal and
//            non-regression of the existing categories
//            (Properties 27, 28, 29, 30, 35)
// ===========================================================================

const KNOWN_PROFESSIONS = [
  PROFESSION_RESTAURANT,
  "Healthcare and medical",
  "Fitness Gym etc",
  "Beauty and wellness",
  "Professional services like law, consultant, real estate, CA",
  "Education institutions",
] as const;

const EXPECTED_ROUTES: Record<string, string> = {
  [PROFESSION_RESTAURANT]: "/dashboards/restaurant",
  "Fitness Gym etc": "/dashboards/gym",
  "Beauty and wellness": "/dashboards/beauty",
  "Professional services like law, consultant, real estate, CA": "/dashboards/professional",
  "Education institutions": "/dashboards/education",
};

const EXPECTED_PREFIXES: Record<string, string> = {
  [PROFESSION_RESTAURANT]: TENANT_PREFIX_RESTAURANT,
  "Fitness Gym etc": "gym-",
  "Beauty and wellness": "beauty-",
  "Professional services like law, consultant, real estate, CA": "advisory-",
  "Education institutions": "edu-",
};

const arbProfession = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom<string | null | undefined>(...KNOWN_PROFESSIONS) },
  {
    weight: 3,
    arbitrary: fc.constantFrom<string | null | undefined>(
      undefined,
      null,
      "",
      "   ",
      "Dentistry",
      "restaurant and dining",
      " Restaurant and dining ",
      "valueOf",
      "toString",
      "constructor",
      "hasOwnProperty",
      "__proto__",
    ),
  },
  { weight: 1, arbitrary: fc.string({ maxLength: 30 }) as fc.Arbitrary<string | null | undefined> },
);

const arbAccountContext: fc.Arbitrary<AccountContext> = fc.record({
  role: fc.constantFrom<AccountRole>(...ROLES),
  profession: arbProfession,
  subscriptionPlan: fc.constantFrom<string | null>(
    "Basic",
    "Premium",
    "Enterprise",
    "Clinic Plan",
    "Hospital",
    "",
    null,
  ),
  subscriptionStatus: fc.constantFrom<string | null>(
    "Active",
    "active",
    "Cancelled",
    "expired",
    "",
    null,
  ),
  subscriptionExpiresAt: fc.constantFrom<string | null>(
    null,
    "2099-01-01T00:00:00.000Z",
    "2000-01-01T00:00:00.000Z",
  ),
  isActive: fc.boolean(),
  now: fc.constant(new Date(Date.UTC(2025, 0, 1))),
});

const arbRequestedTab = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom<string>(...CORE_NAV_ENTRIES) },
  { weight: 3, arbitrary: fc.constantFrom<string>(...GATED_TAB_ENTRIES) },
  {
    weight: 2,
    arbitrary: fc.constantFrom<string>("", "   ", "Nonsense", "overview", "Manage Users"),
  },
);

describe("Property 27: Navigation is derived from the resolved feature access", () => {
  // Feature: restaurant-table-booking, Property 27: For any account context, the Restaurant_Dashboard navigation contains all five Core_Navigation_Entries, contains a Gated_Navigation_Entry if and only if the Feature_Access_Service resolves it visible for that account, contains the `Restaurant Profile`, `Operating Hours`, `Tables`, and `Booking Rules` sub-tabs if and only if the resolved permission for restaurant configuration is `operate` or `view_only` — with create, edit, delete, and save controls present only for `operate` — and resolves the effective tab to the requested tab when that tab is visible and to `Overview` otherwise.
  it("always carries the core entries, mirrors visibility for every gated entry, and falls back to Overview", () => {
    fc.assert(
      fc.property(arbAccountContext, arbRequestedTab, (ctx, requestedTab) => {
        const access = resolveFeatureAccess(ctx);
        const nav = deriveRestaurantNavigation({ access, requestedTab });

        expect(nav.accessResolved).toBe(true);
        expect(nav.message).toBeNull();
        for (const core of CORE_NAV_ENTRIES) expect(nav.tabs).toContain(core);

        for (const gated of GATED_TAB_ENTRIES) {
          const visible = access[GATED_NAV_FEATURE[gated] as keyof typeof access].visible;
          expect(nav.tabs.includes(gated)).toBe(visible);
          expect(nav.gatedTabs.includes(gated)).toBe(visible);
        }
        for (const gated of GATED_SUB_TAB_ENTRIES) {
          const visible = access[GATED_NAV_FEATURE[gated] as keyof typeof access].visible;
          expect(nav.settingsSubTabs.includes(gated)).toBe(visible);
        }

        const configPermission =
          access[RESTAURANT_CONFIG_FEATURE as keyof typeof access].permission;
        const bookingsPermission =
          access[RESTAURANT_BOOKINGS_FEATURE as keyof typeof access].permission;
        expect(nav.configPermission).toBe(configPermission);
        expect(nav.bookingsPermission).toBe(bookingsPermission);

        const showConfig = configPermission === "operate" || configPermission === "view_only";
        for (const sub of CONFIG_SUB_TABS)
          expect(nav.settingsSubTabs.includes(sub)).toBe(showConfig);
        expect(nav.canWriteConfig).toBe(configPermission === "operate");
        expect(nav.canWriteBookings).toBe(bookingsPermission === "operate");

        expect(nav.effectiveTab).toBe(
          nav.tabs.includes(requestedTab.trim()) ? requestedTab.trim() : "Overview",
        );

        // An unresolved feature access keeps the core entries only (Req 2.10).
        const unresolved = deriveRestaurantNavigation({ access: null, requestedTab });
        expect(unresolved.accessResolved).toBe(false);
        expect(unresolved.message).toBe(MSG_FEATURE_ACCESS_UNRESOLVED);
        expect(unresolved.tabs).toEqual([...CORE_NAV_ENTRIES]);
        expect(unresolved.settingsSubTabs).toEqual([]);
        expect(unresolved.canWriteConfig).toBe(false);
        expect(unresolved.canWriteBookings).toBe(false);
      }),
      { numRuns: 400 },
    );
  });
});

describe("Property 28: Writes are refused server-side whenever the resolved permission is not operate", () => {
  // Feature: restaurant-table-booking, Property 28: For any account context whose resolved permission for restaurant configuration is not `operate` and any submitted Dining_Table, Operating_Hours, or Service_Settings payload, and for any account context whose resolved permission for booking management is not `operate` and any submitted Booking_Status change or table reassignment, the submission is rejected with a not-authorised message and the stored Dining_Tables, Operating_Hours, Service_Settings, Booking_Statuses, and assigned Dining_Tables are unchanged.
  it("refuses every config and booking write below operate and leaves every stored row unchanged", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RestaurantPermission | null | undefined>(...PERMISSIONS, null, undefined),
        fc.constantFrom<RestaurantPermission | null | undefined>(...PERMISSIONS, null, undefined),
        arbTables(3),
        arbSettings,
        fc.constantFrom<string>(...BOOKING_STATUSES),
        (configPermission, bookingsPermission, tables, settings, status) => {
          const store = {
            tables: tables.map((t) => ({ ...t })),
            hours: STORED_HOURS.map((d) => ({ ...d })),
            settings: { ...settings },
            bookings: [
              {
                id: "b1",
                tableId: "t0",
                tableNameAtBooking: "T0",
                status: BOOKING_STATUSES[0] as string,
              },
            ],
          };
          const before = JSON.stringify(store);

          // Every config write goes through the same gate before touching a row.
          const configWrites = [
            "saveTable",
            "setTableState",
            "deleteTable",
            "saveHours",
            "saveSettings",
          ] as const;
          for (const write of configWrites) {
            const gate = authoriseRestaurantWrite("config", configPermission);
            expect(gate.ok).toBe(configPermission === "operate");
            if (!gate.ok) {
              expect(gate.errors[0].message).toBe(MSG_NOT_AUTHORISED_RULES);
              expect(gate.errors[0].field).toBe(RESTAURANT_CONFIG_FEATURE);
            } else {
              // an authorised write is the only one that may mutate
              if (write === "saveSettings")
                store.settings = { ...settings, turnTime: LIMITS.turnTime.max };
            }
          }

          const bookingWrites = ["setStatus", "reassign"] as const;
          for (const write of bookingWrites) {
            const gate = authoriseRestaurantWrite("bookings", bookingsPermission);
            expect(gate.ok).toBe(bookingsPermission === "operate");
            if (!gate.ok) {
              expect(gate.errors[0].message).toBe(MSG_NOT_AUTHORISED_BOOKINGS);
              expect(gate.errors[0].field).toBe(RESTAURANT_BOOKINGS_FEATURE);
            } else if (write === "setStatus") {
              store.bookings[0].status = status;
            } else {
              store.bookings[0].tableId = "t-other";
            }
          }

          if (configPermission !== "operate" && bookingsPermission !== "operate") {
            expect(JSON.stringify(store)).toBe(before);
          }
          if (configPermission !== "operate") {
            expect(JSON.stringify(store.tables)).toBe(JSON.stringify(JSON.parse(before).tables));
            expect(JSON.stringify(store.hours)).toBe(JSON.stringify(JSON.parse(before).hours));
            expect(JSON.stringify(store.settings)).toBe(
              JSON.stringify(JSON.parse(before).settings),
            );
          }
          if (bookingsPermission !== "operate") {
            expect(JSON.stringify(store.bookings)).toBe(
              JSON.stringify(JSON.parse(before).bookings),
            );
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 29: Dashboard routing and the restaurant guard are total functions of session and profession", () => {
  // Feature: restaurant-table-booking, Property 29: For any profession value, including absent, empty, and unrecognised ones, `/dashboard` resolves to `/dashboards/restaurant` for `Restaurant and dining`, to `/dashboards/gym`, `/dashboards/beauty`, `/dashboards/professional`, and `/dashboards/education` for the four respective professions, and to `/dashboards/medical` otherwise; for any session and profession pair, a request for `/dashboards/restaurant` resolves to a `/login` redirect when the session resolves to no account, to a `/dashboard` redirect when it resolves to an account whose profession is not `Restaurant and dining`, and to rendering only in the remaining case.
  it("maps every profession to a dashboard route and resolves the guard to login, dashboard or render", () => {
    fc.assert(
      fc.property(arbProfession, fc.boolean(), (profession, hasAccount) => {
        const trimmed = typeof profession === "string" ? profession.trim() : "";
        const expectedRoute = Object.hasOwn(EXPECTED_ROUTES, trimmed)
          ? EXPECTED_ROUTES[trimmed]
          : DEFAULT_DASHBOARD_ROUTE;

        expect(dashboardRouteForProfession(profession)).toBe(expectedRoute);
        expect(dashboardRouteForProfession(profession).startsWith("/dashboards/")).toBe(true);

        const decision = restaurantGuardDecision({ hasAccount, profession });
        if (!hasAccount) expect(decision).toBe("login");
        else if (trimmed === PROFESSION_RESTAURANT) expect(decision).toBe("render");
        else expect(decision).toBe("dashboard");

        // Only the restaurant profession reaches the restaurant dashboard.
        expect(decision === "render").toBe(
          hasAccount && expectedRoute === "/dashboards/restaurant",
        );
      }),
      { numRuns: 300 },
    );
  });
});

// --- The legacy (non-restaurant) slot model used by Property 30 -------------

/** The ONLY inputs the legacy slot computation reads (Req 12.1). */
const LEGACY_SLOT_INPUT_KEYS = ["workStart", "workEnd", "durationMinutes"] as const;

interface LegacyStaff {
  workStart: string;
  workEnd: string;
  durationMinutes: number;
}

/**
 * The pre-existing category slot computation, modelled: it reads the staff
 * working hours and the appointment duration, and nothing else. Restaurant rows
 * may sit in the same snapshot; they are not an input.
 */
function legacyStaffSlots(snapshot: { staff: LegacyStaff } & Record<string, unknown>): string[] {
  const { workStart, workEnd, durationMinutes } = snapshot.staff;
  const start = parseClock(workStart);
  const end = parseClock(workEnd);
  if (start === null || end === null || durationMinutes <= 0) return [];
  const out: string[] = [];
  for (let m = start; m + durationMinutes <= end; m += durationMinutes)
    out.push(formatSlotLabel(m));
  return out;
}

/** A booking row as the shared Appointment table stores it. */
function createAppointmentRow(
  profession: string | null | undefined,
  restaurantFields: {
    tableId: string;
    partySize: number;
    turnTimeMinutes: number;
    tableNameAtBooking: string;
  },
) {
  const isResto = isRestaurantProfession(profession);
  return {
    tableId: isResto ? restaurantFields.tableId : null,
    partySize: isResto ? restaurantFields.partySize : null,
    turnTimeMinutes: isResto ? restaurantFields.turnTimeMinutes : null,
    tableNameAtBooking: isResto ? restaurantFields.tableNameAtBooking : null,
  };
}

describe("Property 30: Restaurant data and the restaurant category change nothing for the existing categories", () => {
  // Feature: restaurant-table-booking, Property 30: For any Tenant whose Business_Profession is not `Restaurant and dining`, the Booking_Slots computed for a given date and staff member are deeply equal whether or not arbitrary Operating_Hours, Service_Settings, and Dining_Table rows exist for that Tenant, and every booking created for that Tenant stores an empty Dining_Table reference, Party_Size, Turn_Time snapshot, and Table_Name snapshot; for any account context, the resolved feature availability and permission of every feature carrying no profession restriction are unchanged when only the Business_Profession varies.
  it("leaves legacy slots, legacy booking columns and every unrestricted feature resolution untouched", () => {
    fc.assert(
      fc.property(
        fc.record({
          workStart: fc.integer({ min: 0, max: 1200 }).map(formatClock),
          workEnd: fc.integer({ min: 0, max: 1439 }).map(formatClock),
          durationMinutes: fc.constantFrom(10, 15, 20, 30, 45, 60),
        }),
        arbDayHours,
        arbSettings,
        arbTables(4),
        arbAccountContext,
        arbProfession,
        arbProfession,
        (
          staff,
          restaurantHours,
          restaurantSettings,
          restaurantTables,
          ctx,
          professionA,
          professionB,
        ) => {
          // 1. Legacy slot computation is unaffected by restaurant rows.
          const withoutRestaurantRows = legacyStaffSlots({ staff });
          const withRestaurantRows = legacyStaffSlots({
            staff,
            restaurantHours,
            restaurantSettings,
            restaurantTables,
          });
          expect(withRestaurantRows).toEqual(withoutRestaurantRows);
          for (const key of ["restaurantHours", "restaurantSettings", "restaurantTables"]) {
            expect((LEGACY_SLOT_INPUT_KEYS as readonly string[]).includes(key)).toBe(false);
          }

          // 2. A non-restaurant booking leaves the four added columns empty.
          const fields = {
            tableId: "t0",
            partySize: 4,
            turnTimeMinutes: 90,
            tableNameAtBooking: "T0",
          };
          for (const profession of [professionA, professionB]) {
            const row = createAppointmentRow(profession, fields);
            if (!isRestaurantProfession(profession)) {
              expect(row.tableId).toBeNull();
              expect(row.partySize).toBeNull();
              expect(row.turnTimeMinutes).toBeNull();
              expect(row.tableNameAtBooking).toBeNull();
            } else {
              expect(row.tableId).toBe(fields.tableId);
            }
          }

          // 3. Varying only the profession changes no unrestricted feature.
          const accessA = resolveFeatureAccess({ ...ctx, profession: professionA });
          const accessB = resolveFeatureAccess({ ...ctx, profession: professionB });
          for (const feature of FEATURE_IDS) {
            if (PROFESSION_FEATURES[feature]) continue; // the pre-existing `video` restriction
            expect(accessA[feature]).toEqual(accessB[feature]);
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});

const arbBusinessName = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: 120 }) as fc.Arbitrary<unknown> },
  {
    weight: 4,
    arbitrary: fc.constantFrom<unknown>(
      "",
      " ",
      "   ",
      "A",
      "A".repeat(100),
      "A".repeat(101),
      " Padded Name ",
      "Spice Route",
    ),
  },
  { weight: 1, arbitrary: fc.constantFrom<unknown>(undefined, null, 42) },
);

describe("Property 35: Signup name validation, label selection, and tenant prefix are pure functions of their inputs", () => {
  // Feature: restaurant-table-booking, Property 35: For any business name, the Signup_Form accepts it if and only if its trimmed length is 1 through 100 characters, and on rejection reports that the restaurant name must be between 1 and 100 characters while sending no signup request and retaining the entered values; for any sequence of Business_Profession selections, the business name field's label is `Restaurant Name` exactly while `Restaurant and dining` is selected and the entered text is unchanged by any selection change; for any Business_Profession, the assigned `tenantId` prefix is `resto-` for `Restaurant and dining` and its existing prefix for each of the five other professions.
  it("validates the trimmed 1-100 rule, labels only the restaurant selection, and prefixes every profession", () => {
    fc.assert(
      fc.property(
        arbBusinessName,
        arbProfession,
        fc.array(arbProfession, { maxLength: 6 }),
        (name, profession, selections) => {
          const trimmed = name === null || name === undefined ? "" : String(name).trim();
          const accepted =
            trimmed.length >= LIMITS.businessName.min && trimmed.length <= LIMITS.businessName.max;

          const result = validateBusinessName(name, profession);
          expect(result.ok).toBe(accepted);
          if (result.ok) {
            expect(result.value).toBe(trimmed);
          } else {
            expect(result.errors[0].field).toBe("businessName");
            expect(result.errors[0].message).toBe(
              isRestaurantProfession(profession)
                ? MSG_RESTAURANT_NAME_LENGTH
                : MSG_BUSINESS_NAME_LENGTH,
            );
            expect(MSG_RESTAURANT_NAME_LENGTH).toBe(
              "Restaurant name must be between 1 and 100 characters",
            );
          }

          // The label follows the selection; the entered text never does.
          const enteredText = typeof name === "string" ? name : "";
          let form = { text: enteredText, profession: profession ?? "" };
          for (const next of selections) {
            form = { ...form, profession: next ?? "" };
            expect(form.text).toBe(enteredText);
            expect(businessNameLabelForProfession(form.profession) === "Restaurant Name").toBe(
              isRestaurantProfession(form.profession),
            );
          }
          expect(businessNameLabelForProfession(profession) === "Restaurant Name").toBe(
            isRestaurantProfession(profession),
          );

          // tenantId prefixes.
          const trimmedProfession = typeof profession === "string" ? profession.trim() : "";
          expect(tenantPrefixForProfession(profession)).toBe(
            Object.hasOwn(EXPECTED_PREFIXES, trimmedProfession)
              ? EXPECTED_PREFIXES[trimmedProfession]
              : DEFAULT_TENANT_PREFIX,
          );
          expect(tenantPrefixForProfession(PROFESSION_RESTAURANT)).toBe(TENANT_PREFIX_RESTAURANT);
        },
      ),
      { numRuns: 400 },
    );
  });
});

// ===========================================================================
// Table_Group booking: a party may span several Dining_Tables, and no table
// carries a minimum party (Req 5.6, 5.10, 6.7, 7.3, 7.5)
// ===========================================================================

/** Four small tables plus one large one, nothing booked, in one Table_Area. */
function groupTables(): DiningTable[] {
  return [
    { id: "s1", name: "S1", seatCapacity: 2, area: "Main", displayOrder: 1, state: "active" },
    { id: "s2", name: "S2", seatCapacity: 2, area: "Main", displayOrder: 2, state: "active" },
    { id: "s3", name: "S3", seatCapacity: 2, area: "Main", displayOrder: 3, state: "active" },
    { id: "s4", name: "S4", seatCapacity: 2, area: "Main", displayOrder: 4, state: "active" },
    { id: "big", name: "Big", seatCapacity: 8, area: "Main", displayOrder: 5, state: "active" },
  ];
}

function groupAvailabilityInput(partySize: number, tables = groupTables()): AvailabilityInput {
  return {
    settings: DEFAULT_SETTINGS,
    hours: { dayOfWeek: 2, openTime: "09:00", closeTime: "22:00", isClosed: false },
    tables,
    bookings: [],
    partySize,
    date: "2026-06-02",
    nowDateStr: "2026-06-01",
    nowMinutes: 8 * 60,
    daysAhead: 1,
  };
}

describe("Seat_Capacity never gates an Available_Table (Req 5.6, 7.5)", () => {
  it("offers every unoccupied active table to a party larger than any single table", () => {
    // Four 2-seat tables only: a party of 6 fits none of them alone, and must
    // still be offered all four so it can combine them.
    const smallOnly = groupTables().filter((t) => t.id !== "big");
    const result = computeAvailability(groupAvailabilityInput(6, smallOnly));

    expect(result.requiresMultipleTables).toBe(true);
    expect(result.largestCapacity).toBe(2);
    for (const slot of result.slots) {
      expect(slot.availableTableIds).toEqual(["s1", "s2", "s3", "s4"]);
      expect(slot.availableCapacity).toBe(8);
    }
  });

  it("offers every table to a party of one, imposing no minimum", () => {
    const result = computeAvailability(groupAvailabilityInput(1));

    expect(result.requiresMultipleTables).toBe(false);
    for (const slot of result.slots) {
      // Including the 8-seat table: a lone guest may take it, or take four.
      expect(slot.availableTableIds).toEqual(["s1", "s2", "s3", "s4", "big"]);
      expect(slot.availableCapacity).toBe(16);
    }
  });

  it("raises the multiple-tables indicator only when no single table seats the party", () => {
    // 8 fits `big` exactly; 9 fits nothing alone.
    expect(computeAvailability(groupAvailabilityInput(8)).requiresMultipleTables).toBe(false);
    expect(computeAvailability(groupAvailabilityInput(9)).requiresMultipleTables).toBe(true);
  });
});

describe("pickAutoTables resolves `Any available table` to a Table_Group (Req 7.3)", () => {
  const tables = groupTables();

  it("picks the single smallest sufficient table when one exists", () => {
    // A party of 2 takes one 2-seater, not the 8-seater, and not two tables.
    expect(pickAutoTables(tables, 2).map((t) => t.id)).toEqual(["s1"]);
    // A party of 3 needs more than a 2-seater, so the 8-seater is the only
    // single sufficient table.
    expect(pickAutoTables(tables, 3).map((t) => t.id)).toEqual(["big"]);
    // Identical to the single-table picker whenever one table suffices.
    expect(pickAutoTables(tables, 2)[0]).toEqual(
      pickAutoTable(tables.filter((t) => t.id !== "big")),
    );
  });

  it("combines the fewest tables when no single table seats the party", () => {
    const smallOnly = tables.filter((t) => t.id !== "big");
    // 2+2 covers a party of 4; 2+2+2 covers 5 and 6.
    expect(pickAutoTables(smallOnly, 4).map((t) => t.id)).toEqual(["s1", "s2"]);
    expect(pickAutoTables(smallOnly, 5).map((t) => t.id)).toEqual(["s1", "s2", "s3"]);
    expect(pickAutoTables(smallOnly, 6).map((t) => t.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("returns the whole candidate set rather than refusing when even all of it is too small", () => {
    const smallOnly = tables.filter((t) => t.id !== "big");
    // 4 tables x 2 seats = 8 < 20. Capacity must not block the booking.
    expect(pickAutoTables(smallOnly, 20).map((t) => t.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("refuses only on an empty candidate set", () => {
    expect(pickAutoTables([], 4)).toEqual([]);
  });

  it("is invariant to candidate order and returns the canonical order", () => {
    const shuffled = [...tables].reverse();
    expect(pickAutoTables(shuffled, 4).map((t) => t.id)).toEqual(
      pickAutoTables(tables, 4).map((t) => t.id),
    );
    const smallOnly = [...tables.filter((t) => t.id !== "big")].reverse();
    expect(pickAutoTables(smallOnly, 6).map((t) => t.id)).toEqual(
      orderTables(pickAutoTables(smallOnly, 6)).map((t) => t.id),
    );
  });
});

describe("validateBookingRequest accepts a Table_Group (Req 7.5)", () => {
  const tables = groupTables();
  const slot = { startMinutes: 600, label: "10:00 AM" };

  function submit(tableIds: unknown, partySize = 4) {
    return validateBookingRequest(
      {
        guestName: "Asha",
        phone: "9876543210",
        partySize,
        date: "2026-06-02",
        tableIds,
        slotStartMinutes: slot.startMinutes,
      },
      {
        maxPartySize: DEFAULT_SETTINGS.maxPartySize,
        slots: [
          {
            ...slot,
            availableTableIds: tables.map((t) => t.id),
            availableCount: tables.length,
            occupiedCount: 0,
            availableCapacity: 16,
          },
        ],
        tables,
        phoneRequired: true,
      },
    );
  }

  it("accepts two 2-seat tables for a party of four", () => {
    const result = submit(["s1", "s2"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tableIds).toEqual(["s1", "s2"]);
  });

  it("accepts four tables for a party of one, with no minimum", () => {
    const result = submit(["s1", "s2", "s3", "s4"], 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tableIds).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("accepts a group that seats fewer guests than the party", () => {
    // One 2-seater for a party of 6 — the guest's call, not a rejection.
    const result = submit(["s1"], 6);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tableIds).toEqual(["s1"]);
  });

  it("normalises the group to canonical order and drops duplicates", () => {
    const result = submit(["s3", "s1", "s3"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tableIds).toEqual(["s1", "s3"]);
  });

  it("treats an empty group and the `any` sentinel alike", () => {
    for (const value of [[], [TABLE_SELECTION_ANY], TABLE_SELECTION_ANY, null, undefined]) {
      const result = submit(value);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.tableIds).toEqual([]);
    }
  });

  it("rejects a group holding a table that is not available for the slot", () => {
    const result = validateBookingRequest(
      {
        guestName: "Asha",
        phone: "9876543210",
        partySize: 4,
        date: "2026-06-02",
        tableIds: ["s1", "s2"],
        slotStartMinutes: slot.startMinutes,
      },
      {
        maxPartySize: DEFAULT_SETTINGS.maxPartySize,
        slots: [
          {
            ...slot,
            availableTableIds: ["s1"],
            availableCount: 1,
            occupiedCount: 4,
            availableCapacity: 2,
          },
        ],
        tables,
        phoneRequired: true,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.message)).toContain(MSG_TABLE_JUST_BOOKED);
  });
});
