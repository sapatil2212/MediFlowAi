/**
 * restaurant-availability.ts
 *
 * Pure, isomorphic decision logic for the Restaurant & Dining category.
 *
 * This module performs NO I/O. It imports nothing from the database, auth,
 * `crypto`, or React, and runs identically on the client and the server. It is
 * the single source of truth for:
 *   - the restaurant constants, status sets, limits and guest-facing messages
 *   - clock <-> minutes conversion and slot-label formatting (Req 4.1)
 *   - Booking_Slot generation and the half-open overlap test (Req 5.2, 5.3, 5.5)
 *   - Available_Table computation and the availability indicators (Req 5.1-5.14)
 *   - table ordering, auto-assignment, occupancy rate, phone normalisation
 *   - validation of table input, Service_Settings, Operating_Hours and bookings
 *   - tenant-local "now" derivation, the single timezone-aware function (Req 5.14)
 *   - the pure routing / navigation / signup helpers the shells consume
 *
 * All time arithmetic is on integer minutes since midnight plus `YYYY-MM-DD`
 * date strings. No `Date` object enters any function except `tenantNow`.
 *
 * Because it is pure it is the primary target of the property-based test suite.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Table_State (Req 3, glossary). */
export type TableState = "active" | "inactive";

/** Booking_Status — derived from the status tuples below. */
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Availability_State rendered by the Table_Layout_View (Req 6.5, 6.6). */
export type AvailabilityState = "Available" | "Unavailable" | "Selected";

/** Permission level as resolved by the Feature_Access_Service. */
export type RestaurantPermission = "operate" | "view_only" | "none";

/** Service_Settings, per tenant (Req 4.3-4.7). */
export interface ServiceSettings {
  slotInterval: number;
  turnTime: number;
  maxPartySize: number;
  advanceBookingWindow: number;
  minLeadTime: number;
  timezone: string;
}

/** Operating_Hours for one weekday. `dayOfWeek` 0 = Sunday (matches ClinicHours). */
export interface DayHours {
  dayOfWeek: number;
  openTime: string; // "HH:MM"
  closeTime: string; // "HH:MM"
  isClosed: boolean;
}

/** A registered Dining_Table. */
export interface DiningTable {
  id: string;
  name: string;
  seatCapacity: number;
  area: string;
  displayOrder: number;
  state: TableState;
  /** NULL / undefined = Primary_Location (Req 11.4, 11.5). */
  locationId?: string | null;
}

/**
 * A stored Table_Booking as availability sees it. `turnTimeMinutes` is the
 * Turn_Time snapshot taken when the booking was created — availability always
 * compares a booking against its OWN snapshot, never the current setting, so
 * changing Turn_Time later cannot move an existing occupancy (Req 4.12, 7.1).
 */
export interface ExistingBooking {
  id: string;
  tableId: string;
  /** Booking_Slot start, minutes since midnight on the booking date. */
  startMinutes: number;
  turnTimeMinutes: number;
  status: BookingStatus | string;
  partySize?: number;
}

/** Closure_Day effects already resolved for the requested date and scope. */
export interface AvailabilityClosureInput {
  /** A restaurant-scoped closure suppresses every Booking_Slot for the date. */
  restaurantClosed: boolean;
  /** Dining_Table ids closed for the date. */
  closedTableIds: readonly string[];
}

/** The snapshot `computeAvailability` consumes. */
export interface AvailabilityInput {
  /** Stored values; per-field defaults may already be applied (Req 4.9). */
  settings: Partial<ServiceSettings> | null | undefined;
  /** The weekday row for `date`, or null / a default-closed row. */
  hours: DayHours | null | undefined;
  /** Active + inactive, already location-scoped (Req 11.6, 11.7). */
  tables: DiningTable[];
  /** Blocking-status bookings on `date` for those tables. */
  bookings: ExistingBooking[];
  /** Optional closure snapshot for `date`; absent preserves legacy behavior. */
  closures?: AvailabilityClosureInput | null;
  partySize: number;
  /** Requested booking date, `YYYY-MM-DD`. */
  date: string;
  /** Tenant-local today, `YYYY-MM-DD`. */
  nowDateStr: string;
  /** Tenant-local minute of day. */
  nowMinutes: number;
  /** Whole days from `nowDateStr` to `date` (see `daysBetween`). */
  daysAhead: number;
}

/** One returned Booking_Slot. */
export interface AvailabilitySlot {
  startMinutes: number;
  label: string;
  /** Available_Table ids, ordered by `orderTables` (Req 5.6, 3.14). */
  availableTableIds: string[];
  availableCount: number; // Req 5.12
  occupiedCount: number; // Req 9.8
  /** Summed Seat_Capacity of the Available_Tables — what a Table_Group can seat. */
  availableCapacity: number; // Req 5.12
}

export interface AvailabilityResult {
  closed: boolean; // Req 5.4
  outOfWindow: boolean; // Req 5.9 — suppresses every other indicator (Req 5.11)
  /**
   * Req 5.10 — the Party_Size exceeds the largest single Seat_Capacity, so the
   * booking needs a Table_Group of two or more Dining_Tables. This is guidance,
   * not a dead end: Seat_Capacity never blocks a booking (Req 5.6, 7.5).
   */
  requiresMultipleTables: boolean;
  activeTableCount: number; // Req 5.12
  largestCapacity: number;
  slots: AvailabilitySlot[];
}

/** A field-level validation failure. */
export interface FieldError {
  field: string;
  message: string;
}

/** Every validator returns this shape and never throws. */
export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

/** Raw Dining_Table submission. */
export interface TableInput {
  name: unknown;
  seatCapacity: unknown;
  area?: unknown;
  displayOrder?: unknown;
  state?: unknown;
  locationId?: string | null;
}

/** A stored (id, name) pair used for duplicate-name detection. */
export interface ExistingTableName {
  id: string;
  name: string;
}

export interface TableContext {
  /** Every stored table name of the tenant, with its id. */
  existingNames: ExistingTableName[];
  /** The id of the row being edited, excluded from duplicate detection. */
  editingId?: string | null;
  /** Table count for the tenant across BOTH Table_States (Req 3.18). */
  tableCount: number;
  /** Highest Display_Order already used in the resolved Table_Area (Req 3.17). */
  highestDisplayOrderInArea?: number | null;
  /** Optional fallback for deriving the above from a table list. */
  existingTables?: DiningTable[];
}

export interface NormalisedTable {
  name: string;
  seatCapacity: number;
  area: string;
  displayOrder: number;
  state: TableState;
  locationId: string | null;
}

/** Raw booking submission (public form or walk-in). */
export interface BookingInput {
  guestName: unknown;
  phone?: unknown;
  email?: unknown;
  partySize: unknown;
  date: unknown;
  /** Either the slot start in minutes or its label; one of the two is required. */
  slotStartMinutes?: unknown;
  slotLabel?: unknown;
  /**
   * The Table_Group: one or more table ids. An empty list, or the single value
   * `TABLE_SELECTION_ANY`, means `Any available table`. A bare string is
   * accepted as a one-table group.
   */
  tableIds?: unknown;
  specialRequests?: unknown;
}

export interface BookingContext {
  maxPartySize: number;
  /** The slots the Availability_Service computed for the requested date. */
  slots: AvailabilitySlot[];
  /** The location-scoped tables of the tenant. */
  tables: DiningTable[];
  /** Public form requires a phone; a guest record may exist without one. */
  phoneRequired?: boolean;
}

export interface NormalisedBooking {
  guestName: string;
  phone: string;
  email: string;
  partySize: number;
  date: string;
  slotStartMinutes: number;
  slotLabel: string;
  /**
   * The requested Table_Group in canonical order. An empty list means
   * `Any available table`, resolved under the transaction lock.
   */
  tableIds: string[];
  specialRequests: string;
}

// ---------------------------------------------------------------------------
// 2.1 Constants, status sets, limits and guest-facing messages
// ---------------------------------------------------------------------------

/** The Business_Profession value that identifies a Restaurant_Tenant (Req 1.1). */
export const PROFESSION_RESTAURANT = "Restaurant and dining";

/** The tenantId prefix assigned to a Restaurant_Tenant (Req 1.4). */
export const TENANT_PREFIX_RESTAURANT = "resto-";

/** Blocking_Statuses — these reserve a Dining_Table. */
export const BLOCKING_STATUSES = ["Pending", "Confirmed", "Seated", "Completed"] as const;

/** Releasing_Statuses — these free a Dining_Table (Req 9.5). */
export const RELEASING_STATUSES = ["Cancelled", "No Show"] as const;

/** The six permitted Booking_Status values (Req 9.4). */
export const BOOKING_STATUSES = [...BLOCKING_STATUSES, ...RELEASING_STATUSES] as const;

/** The two Table_States. */
export const TABLE_STATES = ["active", "inactive"] as const;

/** True when a Booking_Status reserves its Dining_Table. */
export function isBlockingStatus(s: unknown): boolean {
  return (BLOCKING_STATUSES as readonly string[]).includes(String(s));
}

/** True when a Booking_Status frees its Dining_Table. */
export function isReleasingStatus(s: unknown): boolean {
  return (RELEASING_STATUSES as readonly string[]).includes(String(s));
}

/** True when the value is one of the six permitted Booking_Status values. */
export function isBookingStatus(s: unknown): s is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(String(s));
}

/** Permitted Slot_Interval values in minutes (Req 4.3). */
export const SLOT_INTERVALS = [15, 30, 60] as const;

/** The documented per-field Service_Settings defaults (Req 1.5, 4.3-4.7). */
export const DEFAULT_SETTINGS: ServiceSettings = {
  slotInterval: 30,
  turnTime: 90,
  maxPartySize: 12,
  advanceBookingWindow: 60,
  minLeadTime: 30,
  timezone: "Asia/Kolkata",
};

/** Every inclusive limit the requirements state, in one place. */
export const LIMITS = {
  tableName: { min: 1, max: 40 },
  tableArea: { min: 1, max: 30 },
  seatCapacity: { min: 1, max: 30 },
  displayOrder: { min: 1, max: 999 },
  tablesPerTenant: 200,
  guestName: { min: 1, max: 100 },
  businessName: { min: 1, max: 100 },
  phoneDigits: { min: 7, max: 15 },
  turnTime: { min: 30, max: 240 },
  maxPartySize: { min: 1, max: 30 },
  advanceBookingWindow: { min: 1, max: 365 },
  minLeadTime: { min: 0, max: 1440 },
} as const;

/** Bookings List page size (Req 9.12). */
export const BOOKINGS_PAGE_SIZE = 25;

/** Minutes in a day — the exclusive upper bound of every clock value. */
export const MINUTES_PER_DAY = 1440;

/** The Table selection value standing for `Any available table` (Req 6.3, 7.3). */
export const TABLE_SELECTION_ANY = "any";

/** The label shown for that selection. */
export const TABLE_SELECTION_ANY_LABEL = "Any available table";

/** Default Table_Area when none is supplied (Req 3.7). */
export const DEFAULT_TABLE_AREA = "Main";

/** Weekday names, index 0 = Sunday, matching `DayHours.dayOfWeek`. */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// --- The exact guest-facing strings the requirements specify. ---------------
// Exported as named constants so a copy edit cannot silently break a criterion.

/** Req 3.3 */
export const MSG_DUPLICATE_TABLE_NAME = "A table with this name already exists";
/** Req 3.5 */
export const MSG_SEAT_CAPACITY_RANGE = "Seat capacity must be between 1 and 30";
/** Req 3.11 */
export const MSG_TABLE_HAS_UPCOMING_BOOKINGS =
  "This table has upcoming bookings. Set the table to inactive instead";
/** Req 6.8 */
export const MSG_TABLE_ALREADY_BOOKED = "This table is already booked for the selected time";
/** Req 6.10 */
export const MSG_NO_TABLE_FREE = "No table free at this time";
/**
 * Req 6.12 — guidance, replacing the former capacity-exceeded dead end. A large
 * party is bookable by combining Dining_Tables, so the form says how, rather
 * than turning the guest away.
 */
export const MSG_MULTIPLE_TABLES_NEEDED =
  "Your party needs more than one table. Select as many tables as you need";
/** Req 6.14 */
export const MSG_CLOSED_ON_DATE = "The restaurant is closed on this date. Please pick another date";
/** Req 7.4, 7.11 */
export const MSG_TABLE_JUST_BOOKED =
  "That table was just booked. Please pick another table or time";
/** Req 6.15 — a Table_Group must hold at least one Dining_Table. */
export const MSG_NO_TABLE_SELECTED = "Please select at least one table";
/** Req 7.7 */
export const MSG_SLOT_NOT_AVAILABLE = "That time is not available for booking";

/** The ten guest-facing strings above, addressable as a set. */
export const GUEST_MESSAGES = [
  MSG_DUPLICATE_TABLE_NAME,
  MSG_SEAT_CAPACITY_RANGE,
  MSG_TABLE_HAS_UPCOMING_BOOKINGS,
  MSG_TABLE_ALREADY_BOOKED,
  MSG_NO_TABLE_FREE,
  MSG_MULTIPLE_TABLES_NEEDED,
  MSG_CLOSED_ON_DATE,
  MSG_TABLE_JUST_BOOKED,
  MSG_NO_TABLE_SELECTED,
  MSG_SLOT_NOT_AVAILABLE,
] as const;

// --- Supporting messages the validators and shells need. -------------------

/** Req 3.16 */
export const MSG_TABLE_NAME_LENGTH = `Table name must be between ${LIMITS.tableName.min} and ${LIMITS.tableName.max} characters`;
/** Req 3.16 */
export const MSG_TABLE_AREA_LENGTH = `Table area must be at most ${LIMITS.tableArea.max} characters`;
/** Req 3.8 */
export const MSG_DISPLAY_ORDER_RANGE = `Display order must be a whole number between ${LIMITS.displayOrder.min} and ${LIMITS.displayOrder.max}`;
/** Req 3.18 */
export const MSG_MAX_TABLES_REACHED = `The maximum of ${LIMITS.tablesPerTenant} tables per restaurant is reached`;
/** Req 7.12 */
export const MSG_GUEST_NAME_LENGTH = `Guest name must be between ${LIMITS.guestName.min} and ${LIMITS.guestName.max} characters`;
/** Req 7.12 */
export const MSG_PHONE_DIGITS = `Phone number must contain between ${LIMITS.phoneDigits.min} and ${LIMITS.phoneDigits.max} digits`;
/** Req 1.6 */
export const MSG_RESTAURANT_NAME_LENGTH = `Restaurant name must be between ${LIMITS.businessName.min} and ${LIMITS.businessName.max} characters`;
/** Req 4.3 */
export const MSG_SLOT_INTERVAL = `Slot interval must be one of ${SLOT_INTERVALS.join(", ")} minutes`;
/** Req 4.4 */
export const MSG_TURN_TIME = `Turn time must be a whole number of minutes between ${LIMITS.turnTime.min} and ${LIMITS.turnTime.max}`;
/** Req 4.5 */
export const MSG_MAX_PARTY_SIZE = `Max party size must be a whole number between ${LIMITS.maxPartySize.min} and ${LIMITS.maxPartySize.max}`;
/** Req 4.6 */
export const MSG_ADVANCE_WINDOW = `Advance booking window must be a whole number of days between ${LIMITS.advanceBookingWindow.min} and ${LIMITS.advanceBookingWindow.max}`;
/** Req 4.7 */
export const MSG_MIN_LEAD_TIME = `Minimum lead time must be a whole number of minutes between ${LIMITS.minLeadTime.min} and ${LIMITS.minLeadTime.max}`;
/** Req 4.2 */
export const MSG_HOURS_SEVEN_DAYS = "Operating hours must cover all seven weekdays";
/** Req 4.11 */
export const MSG_NOT_AUTHORISED_RULES = "You are not authorised to change booking rules";
/** Req 9.13 */
export const MSG_NOT_AUTHORISED_BOOKINGS = "You are not authorised to change bookings";
/** Req 2.10 */
export const MSG_FEATURE_ACCESS_UNRESOLVED = "Feature access could not be resolved";
/** Req 11.3 */
export const MSG_TABLE_NOT_FOUND = "Table not found";

/** Req 4.2 — names the offending weekday. */
export function msgOperatingHoursDay(dayOfWeek: number): string {
  const name = WEEKDAY_NAMES[((dayOfWeek % 7) + 7) % 7] ?? "That day";
  return `${name} requires an open time and a later close time`;
}

/** Req 7.6 — names the permitted Party_Size range. */
export function msgPartySizeRange(maxPartySize: number): string {
  return `Party size must be between 1 and ${maxPartySize}`;
}

// ---------------------------------------------------------------------------
// 2.2 Clock helpers, slot generation, half-open overlap test
// ---------------------------------------------------------------------------

/** True for a finite whole number. */
function isWholeNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
}

/**
 * Coerces a submitted numeric value without ever accepting a non-whole one.
 * Strings are accepted only when they are an exact decimal integer, because the
 * HTML number input hands over strings.
 */
function toWholeNumber(v: unknown): number | null {
  if (isWholeNumber(v)) return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (/^[+-]?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Parses an `HH:MM` clock value into minutes since midnight.
 * Returns null for anything that is not a whole-minute time of day from
 * `00:00` to `23:59` (Req 4.1).
 */
export function parseClock(v: string): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Formats minutes since midnight as `HH:MM`. Inverse of `parseClock`. */
export function formatClock(minutes: number): string {
  const m = normaliseMinuteOfDay(minutes);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Formats minutes since midnight as the `06:30 PM` shape used by `timeSlot`. */
export function formatSlotLabel(minutes: number): string {
  const m = normaliseMinuteOfDay(minutes);
  const hour24 = Math.floor(m / 60);
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${pad2(hour12)}:${pad2(m % 60)} ${suffix}`;
}

/** Parses a `06:30 PM` label back into minutes since midnight. */
export function parseSlotLabel(label: string): number | null {
  if (typeof label !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(label.trim());
  if (!m) return null;
  const hour12 = Number(m[1]);
  const minutes = Number(m[2]);
  if (hour12 < 1 || hour12 > 12 || minutes > 59) return null;
  const isPm = m[3].toLowerCase() === "pm";
  const hour24 = (hour12 % 12) + (isPm ? 12 : 0);
  return hour24 * 60 + minutes;
}

/** Wraps any numeric input into `0..1439` so formatting stays total. */
function normaliseMinuteOfDay(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  const floored = Math.floor(minutes);
  return ((floored % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Generates the Booking_Slot start times of a date, in minutes since midnight
 * (Req 5.2, 5.3).
 *
 * Returns an empty list when the weekday is closed (Req 4.13), when either
 * clock value is unusable, or when `closeTime - turnTime` is earlier than
 * `openTime`. Otherwise it starts at `openTime` and steps by `slotInterval`
 * while the start is at or before `closeTime - turnTime`.
 */
export function generateSlotStarts(
  hours: DayHours | null | undefined,
  settings: Partial<ServiceSettings> | null | undefined,
): number[] {
  if (!hours || hours.isClosed) return [];

  const open = parseClock(hours.openTime);
  const close = parseClock(hours.closeTime);
  if (open === null || close === null) return [];

  const resolved = resolveSettings(settings);
  const latest = close - resolved.turnTime;
  if (latest < open) return [];

  const starts: number[] = [];
  for (let start = open; start <= latest; start += resolved.slotInterval) {
    starts.push(start);
  }
  return starts;
}

/**
 * True when two Occupancy_Windows intersect as half-open intervals
 * `[start, start + turn)` (Req 5.5). A candidate starting exactly at an
 * existing window's end therefore does NOT overlap it.
 */
export function windowsOverlap(
  aStart: number,
  aTurn: number,
  bStart: number,
  bTurn: number,
): boolean {
  return aStart < bStart + bTurn && bStart < aStart + aTurn;
}

// ---------------------------------------------------------------------------
// 2.3 computeAvailability
// ---------------------------------------------------------------------------

/**
 * Applies the documented default of every absent or unusable Service_Settings
 * field, leaving every present, in-range field exactly as stored (Req 4.9).
 */
export function resolveSettings(
  input: Partial<ServiceSettings> | null | undefined,
): ServiceSettings {
  const s = input ?? {};

  const slotInterval = (SLOT_INTERVALS as readonly number[]).includes(s.slotInterval as number)
    ? (s.slotInterval as number)
    : DEFAULT_SETTINGS.slotInterval;

  const timezone =
    typeof s.timezone === "string" && s.timezone.trim().length > 0
      ? s.timezone.trim()
      : DEFAULT_SETTINGS.timezone;

  return {
    slotInterval,
    turnTime: inRangeOrDefault(s.turnTime, LIMITS.turnTime, DEFAULT_SETTINGS.turnTime),
    maxPartySize: inRangeOrDefault(
      s.maxPartySize,
      LIMITS.maxPartySize,
      DEFAULT_SETTINGS.maxPartySize,
    ),
    advanceBookingWindow: inRangeOrDefault(
      s.advanceBookingWindow,
      LIMITS.advanceBookingWindow,
      DEFAULT_SETTINGS.advanceBookingWindow,
    ),
    minLeadTime: inRangeOrDefault(s.minLeadTime, LIMITS.minLeadTime, DEFAULT_SETTINGS.minLeadTime),
    timezone,
  };
}

function inRangeOrDefault(
  value: unknown,
  range: { readonly min: number; readonly max: number },
  fallback: number,
): number {
  return isWholeNumber(value) && value >= range.min && value <= range.max ? value : fallback;
}

/**
 * Computes the Booking_Slots of a date and, per Booking_Slot, the set of
 * Available_Tables (Req 5.1-5.14).
 *
 * Indicator precedence is explicit and total:
 *   1. `outOfWindow` short-circuits — empty slots, the other two false (Req 5.11).
 *   2. `closed` — empty slots (Req 5.4).
 *   3. slots, with `capacityExceeded` when the party exceeds every active table
 *      (Req 5.10), in which case every Available_Table set is empty.
 *
 * The function depends on no input array order and on no call history, so
 * repeated calls on an equal snapshot return deeply equal results (Req 5.13).
 */
export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const settings = resolveSettings(input.settings);
  const tables = Array.isArray(input.tables) ? input.tables : [];
  const bookings = Array.isArray(input.bookings) ? input.bookings : [];
  const partySize = isWholeNumber(input.partySize) ? input.partySize : 0;
  const closedTableIds = new Set(input.closures?.closedTableIds ?? []);

  // Table-scoped closures remove those tables before all existing active-table,
  // capacity, ordering and occupancy evaluation.
  const activeTables = tables.filter((t) => t.state === "active" && !closedTableIds.has(t.id));
  const activeTableCount = activeTables.length;
  const largestCapacity = activeTables.reduce(
    (max, t) => (isWholeNumber(t.seatCapacity) && t.seatCapacity > max ? t.seatCapacity : max),
    0,
  );

  // 1. Out of window wins over every other indicator (Req 5.9, 5.11).
  const daysAhead = Number.isFinite(input.daysAhead) ? input.daysAhead : 0;
  if (daysAhead > settings.advanceBookingWindow) {
    return {
      closed: false,
      outOfWindow: true,
      requiresMultipleTables: false,
      activeTableCount,
      largestCapacity,
      slots: [],
    };
  }

  // 2. Closed weekday, absent hours row, or restaurant-scoped closure.
  const hours = input.hours ?? null;
  if (!hours || hours.isClosed || input.closures?.restaurantClosed === true) {
    return {
      closed: true,
      outOfWindow: false,
      requiresMultipleTables: false,
      activeTableCount,
      largestCapacity,
      slots: [],
    };
  }

  // 3. Slots, filtered by Min_Lead_Time on the current date (Req 5.7, 5.8).
  let starts = generateSlotStarts(hours, settings);
  if (input.date === input.nowDateStr) {
    const nowMinutes = Number.isFinite(input.nowMinutes) ? input.nowMinutes : 0;
    const earliest = nowMinutes + settings.minLeadTime;
    starts = starts.filter((start) => start >= earliest);
  }

  // Blocking bookings grouped per table, each carrying its OWN Turn_Time
  // snapshot so a later settings change cannot move an existing occupancy.
  const blockingByTable = new Map<string, ExistingBooking[]>();
  for (const b of bookings) {
    if (!isBlockingStatus(b.status)) continue;
    const list = blockingByTable.get(b.tableId);
    if (list) list.push(b);
    else blockingByTable.set(b.tableId, [b]);
  }

  const orderedActive = orderTables(activeTables);

  const slots: AvailabilitySlot[] = starts.map((startMinutes) => {
    const availableTableIds: string[] = [];
    let occupiedCount = 0;
    let availableCapacity = 0;

    for (const table of orderedActive) {
      const occupied = (blockingByTable.get(table.id) ?? []).some((b) =>
        windowsOverlap(
          startMinutes,
          settings.turnTime,
          b.startMinutes,
          isWholeNumber(b.turnTimeMinutes) ? b.turnTimeMinutes : settings.turnTime,
        ),
      );

      if (occupied) {
        occupiedCount += 1;
        continue;
      }
      // Req 5.6 — Seat_Capacity does not gate membership. A guest may combine
      // Dining_Tables into a Table_Group to seat a larger party, and may equally
      // take a table larger than the party: there is no minimum (Req 7.5).
      availableTableIds.push(table.id);
      availableCapacity += isWholeNumber(table.seatCapacity) ? table.seatCapacity : 0;
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
    // Req 5.10 — guidance that one table cannot seat this party, so the guest
    // should combine several. It never empties an Available_Table set.
    requiresMultipleTables: activeTableCount > 0 && partySize > largestCapacity,
    activeTableCount,
    largestCapacity,
    slots,
  };
}

// ---------------------------------------------------------------------------
// 2.4 Ordering, auto-assignment, occupancy rate, phone normalisation
// ---------------------------------------------------------------------------

/** Case-insensitive, locale-independent string comparison. */
function compareCi(a: string, b: string): number {
  const x = String(a ?? "").toLowerCase();
  const y = String(b ?? "").toLowerCase();
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

function compareRaw(a: string, b: string): number {
  const x = String(a ?? "");
  const y = String(b ?? "");
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

function numericOr(value: unknown, fallback: number): number {
  return isWholeNumber(value) ? value : fallback;
}

/**
 * The canonical total order of Dining_Tables: Table_Area ascending, then
 * Display_Order ascending, then Table_Name ascending, comparing Table_Area and
 * Table_Name case-insensitively, with the id as the final tie-break so the
 * order is total (Req 3.14, 3.15).
 *
 * Returns a new array and never mutates its input.
 */
export function orderTables<T extends DiningTable>(tables: readonly T[]): T[] {
  return [...(tables ?? [])].sort(compareTables);
}

function compareTables(a: DiningTable, b: DiningTable): number {
  const byArea = compareCi(a.area, b.area);
  if (byArea !== 0) return byArea;

  const byOrder = numericOr(a.displayOrder, 0) - numericOr(b.displayOrder, 0);
  if (byOrder !== 0) return byOrder;

  const byName = compareCi(a.name, b.name);
  if (byName !== 0) return byName;

  return compareRaw(a.id, b.id);
}

/**
 * Picks the Dining_Table for the `Any available table` selection: the smallest
 * Seat_Capacity, ties resolved by the lowest Display_Order then the lowest
 * Table_Name ascending, with the id as the final tie-break (Req 7.3).
 *
 * Returns null for an empty candidate set, and is invariant to input order.
 */
export function pickAutoTable<T extends DiningTable>(candidates: readonly T[]): T | null {
  const list = candidates ?? [];
  let best: T | null = null;

  for (const candidate of list) {
    if (best === null || compareAutoAssign(candidate, best) < 0) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Picks the Table_Group for the `Any available table` selection (Req 7.3).
 *
 * Two regimes, so the common case is unchanged and the new case is minimal:
 *
 *   1. Some single candidate seats the party — return exactly that table, the
 *      one `pickAutoTable` would choose. Never waste a large table on a small
 *      party.
 *   2. No single candidate seats the party — take candidates largest-capacity
 *      first until the party is seated, which yields the fewest tables. Ties
 *      resolve by the lowest Display_Order, then Table_Name, then id.
 *
 * Returns the whole candidate set when even all of it cannot seat the party, so
 * Seat_Capacity never blocks a booking (Req 5.6, 7.5); returns an empty array
 * only for an empty candidate set. Invariant to input order, and the result is
 * returned in the canonical `orderTables` order.
 */
export function pickAutoTables<T extends DiningTable>(
  candidates: readonly T[],
  partySize: number,
): T[] {
  const list = [...(candidates ?? [])];
  if (list.length === 0) return [];

  const party = isWholeNumber(partySize) && partySize > 0 ? partySize : 1;

  const single = pickAutoTable(list.filter((t) => numericOr(t.seatCapacity, 0) >= party));
  if (single) return [single];

  // Largest first: the reverse of the single-table comparator, so the tie-break
  // chain (Display_Order, Table_Name, id) still reads ascending.
  const byLargest = [...list].sort((a, b) => {
    const byCapacity = numericOr(b.seatCapacity, 0) - numericOr(a.seatCapacity, 0);
    if (byCapacity !== 0) return byCapacity;
    return compareAutoAssign(a, b);
  });

  const chosen: T[] = [];
  let seated = 0;
  for (const table of byLargest) {
    if (seated >= party) break;
    chosen.push(table);
    seated += numericOr(table.seatCapacity, 0);
  }
  return orderTables(chosen);
}

function compareAutoAssign(a: DiningTable, b: DiningTable): number {
  const byCapacity = numericOr(a.seatCapacity, 0) - numericOr(b.seatCapacity, 0);
  if (byCapacity !== 0) return byCapacity;

  const byOrder = numericOr(a.displayOrder, 0) - numericOr(b.displayOrder, 0);
  if (byOrder !== 0) return byOrder;

  const byName = compareCi(a.name, b.name);
  if (byName !== 0) return byName;

  return compareRaw(a.id, b.id);
}

/**
 * The occupancy rate of a date as a whole percentage 0-100: blocking table-slot
 * pairs over the product of the `active` table count and the slot count,
 * rounded to the nearest whole number (Req 9.10). Zero when either factor is 0
 * (Req 9.11).
 */
export function occupancyRate(
  blockingPairs: number,
  activeTables: number,
  slotCount: number,
): number {
  const pairs = Number.isFinite(blockingPairs) ? Math.max(0, blockingPairs) : 0;
  const tables = Number.isFinite(activeTables) ? activeTables : 0;
  const slots = Number.isFinite(slotCount) ? slotCount : 0;

  if (tables <= 0 || slots <= 0) return 0;

  const rate = Math.round((pairs / (tables * slots)) * 100);
  return Math.min(100, Math.max(0, rate));
}

/**
 * Normalised_Phone: the value with every space, hyphen, opening bracket and
 * closing bracket removed (Req 10.5). Idempotent.
 */
export function normalisePhone(raw: string): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/[ ()-]/g, "");
}

/** The digit count of a Normalised_Phone, used by the 7-15 digit rule. */
export function phoneDigitCount(raw: string): number {
  return (normalisePhone(raw).match(/\d/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// 2.5 Validation — every validator returns a Result and never throws
// ---------------------------------------------------------------------------

/** Req 7.12 / 6.11 — an unusable booking date. */
export const MSG_INVALID_DATE = "Booking date must be a valid date";

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(errors: FieldError[]): Result<T> {
  return { ok: false, errors };
}

function trimmedString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** True when a submitted optional field carries no value at all. */
function isAbsent(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * Validates a Dining_Table submission (Req 3.1-3.7, 3.16-3.18).
 *
 * Accepted submissions carry the trimmed Table_Name, the trimmed Table_Area or
 * `Main`, a whole Seat_Capacity 1-30, and a Display_Order that defaults to one
 * greater than the highest already used in that Table_Area.
 */
export function validateTableInput(input: TableInput, ctx: TableContext): Result<NormalisedTable> {
  const errors: FieldError[] = [];

  const name = trimmedString(input?.name);
  if (name.length < LIMITS.tableName.min || name.length > LIMITS.tableName.max) {
    errors.push({ field: "name", message: MSG_TABLE_NAME_LENGTH });
  }

  const capacity = toWholeNumber(input?.seatCapacity);
  if (
    capacity === null ||
    capacity < LIMITS.seatCapacity.min ||
    capacity > LIMITS.seatCapacity.max
  ) {
    errors.push({ field: "seatCapacity", message: MSG_SEAT_CAPACITY_RANGE });
  }

  const rawArea = trimmedString(input?.area);
  if (rawArea.length > LIMITS.tableArea.max) {
    errors.push({ field: "area", message: MSG_TABLE_AREA_LENGTH });
  }
  const area = rawArea.length === 0 ? DEFAULT_TABLE_AREA : rawArea;

  let displayOrder: number | null = null;
  if (isAbsent(input?.displayOrder)) {
    displayOrder = nextDisplayOrder(area, ctx);
  } else {
    const submitted = toWholeNumber(input?.displayOrder);
    if (
      submitted === null ||
      submitted < LIMITS.displayOrder.min ||
      submitted > LIMITS.displayOrder.max
    ) {
      errors.push({ field: "displayOrder", message: MSG_DISPLAY_ORDER_RANGE });
    } else {
      displayOrder = submitted;
    }
  }

  const isCreate = isAbsent(ctx?.editingId);
  const tableCount = numericOr(ctx?.tableCount, 0);
  if (isCreate && tableCount >= LIMITS.tablesPerTenant) {
    errors.push({ field: "tables", message: MSG_MAX_TABLES_REACHED });
  }

  const editingId = isCreate ? null : String(ctx.editingId);
  const duplicate = (ctx?.existingNames ?? []).some(
    (row) => row.id !== editingId && compareCi(trimmedString(row.name), name) === 0,
  );
  if (duplicate && name.length > 0) {
    errors.push({ field: "name", message: MSG_DUPLICATE_TABLE_NAME });
  }

  if (errors.length > 0) return fail(errors);

  const state: TableState = input?.state === "inactive" ? "inactive" : "active";

  return ok({
    name,
    seatCapacity: capacity as number,
    area,
    displayOrder: displayOrder as number,
    state,
    locationId: input?.locationId ?? null,
  });
}

/**
 * Req 3.17 — one greater than the highest Display_Order in that Table_Area, or
 * 1 when the area holds no other Dining_Table.
 */
function nextDisplayOrder(area: string, ctx: TableContext): number {
  let highest = 0;

  if (isWholeNumber(ctx?.highestDisplayOrderInArea)) {
    highest = ctx.highestDisplayOrderInArea as number;
  } else if (Array.isArray(ctx?.existingTables)) {
    for (const t of ctx.existingTables) {
      if (compareCi(t.area, area) !== 0) continue;
      const order = numericOr(t.displayOrder, 0);
      if (order > highest) highest = order;
    }
  }

  return Math.min(Math.max(highest + 1, LIMITS.displayOrder.min), LIMITS.displayOrder.max);
}

/**
 * Validates a Service_Settings submission, all-or-nothing (Req 4.3-4.8).
 * Absent fields resolve to their documented default (Req 4.9); present fields
 * outside their permitted values collect one FieldError each.
 */
export function validateServiceSettings(input: unknown): Result<ServiceSettings> {
  const errors: FieldError[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;

  let slotInterval = DEFAULT_SETTINGS.slotInterval;
  if (!isAbsent(raw.slotInterval)) {
    const v = toWholeNumber(raw.slotInterval);
    if (v === null || !(SLOT_INTERVALS as readonly number[]).includes(v)) {
      errors.push({ field: "slotInterval", message: MSG_SLOT_INTERVAL });
    } else {
      slotInterval = v;
    }
  }

  const turnTime = readRange(
    raw.turnTime,
    LIMITS.turnTime,
    DEFAULT_SETTINGS.turnTime,
    "turnTime",
    MSG_TURN_TIME,
    errors,
  );
  const maxPartySize = readRange(
    raw.maxPartySize,
    LIMITS.maxPartySize,
    DEFAULT_SETTINGS.maxPartySize,
    "maxPartySize",
    MSG_MAX_PARTY_SIZE,
    errors,
  );
  const advanceBookingWindow = readRange(
    raw.advanceBookingWindow,
    LIMITS.advanceBookingWindow,
    DEFAULT_SETTINGS.advanceBookingWindow,
    "advanceBookingWindow",
    MSG_ADVANCE_WINDOW,
    errors,
  );
  const minLeadTime = readRange(
    raw.minLeadTime,
    LIMITS.minLeadTime,
    DEFAULT_SETTINGS.minLeadTime,
    "minLeadTime",
    MSG_MIN_LEAD_TIME,
    errors,
  );

  if (errors.length > 0) return fail(errors);

  const timezone = trimmedString(raw.timezone);

  return ok({
    slotInterval,
    turnTime,
    maxPartySize,
    advanceBookingWindow,
    minLeadTime,
    timezone: timezone.length > 0 ? timezone : DEFAULT_SETTINGS.timezone,
  });
}

function readRange(
  value: unknown,
  range: { readonly min: number; readonly max: number },
  fallback: number,
  field: string,
  message: string,
  errors: FieldError[],
): number {
  if (isAbsent(value)) return fallback;

  const v = toWholeNumber(value);
  if (v === null || v < range.min || v > range.max) {
    errors.push({ field, message });
    return fallback;
  }
  return v;
}

/**
 * Validates an Operating_Hours submission: exactly seven weekdays,
 * all-or-nothing, every open weekday carrying an Open_Time and a strictly later
 * Close_Time, naming the offending weekday (Req 4.1, 4.2).
 */
export function validateOperatingHours(input: unknown): Result<DayHours[]> {
  if (!Array.isArray(input) || input.length !== 7) {
    return fail([{ field: "hours", message: MSG_HOURS_SEVEN_DAYS }]);
  }

  const errors: FieldError[] = [];
  const days: DayHours[] = [];
  const seen = new Set<number>();

  input.forEach((row, index) => {
    const raw = (row ?? {}) as Record<string, unknown>;
    const submittedDay = toWholeNumber(raw.dayOfWeek);
    const dayOfWeek =
      submittedDay !== null && submittedDay >= 0 && submittedDay <= 6 ? submittedDay : index;
    seen.add(dayOfWeek);

    const isClosed = raw.isClosed === true || raw.isClosed === 1 || raw.isClosed === "1";
    const open = parseClock(String(raw.openTime ?? ""));
    const close = parseClock(String(raw.closeTime ?? ""));

    if (!isClosed && (open === null || close === null || close <= open)) {
      errors.push({ field: `hours.${dayOfWeek}`, message: msgOperatingHoursDay(dayOfWeek) });
    }

    days.push({
      dayOfWeek,
      openTime: open === null ? "00:00" : formatClock(open),
      closeTime: close === null ? "00:00" : formatClock(close),
      isClosed,
    });
  });

  if (seen.size !== 7) {
    return fail([{ field: "hours", message: MSG_HOURS_SEVEN_DAYS }]);
  }
  if (errors.length > 0) return fail(errors);

  return ok(days.sort((a, b) => a.dayOfWeek - b.dayOfWeek));
}

/**
 * Validates a booking submission against the computed slots of its date
 * (Req 7.5, 7.6, 7.7, 7.12). The availability conflict of Req 7.4 is re-checked
 * under the transaction lock; this validator rejects what is already knowable
 * from the snapshot.
 */
export function validateBookingRequest(
  input: BookingInput,
  ctx: BookingContext,
): Result<NormalisedBooking> {
  const errors: FieldError[] = [];

  const guestName = trimmedString(input?.guestName);
  if (guestName.length < LIMITS.guestName.min || guestName.length > LIMITS.guestName.max) {
    errors.push({ field: "guestName", message: MSG_GUEST_NAME_LENGTH });
  }

  const phone = normalisePhone(String(input?.phone ?? ""));
  const phoneRequired = ctx?.phoneRequired !== false;
  if (phoneRequired || phone.length > 0) {
    const digits = phoneDigitCount(phone);
    if (digits < LIMITS.phoneDigits.min || digits > LIMITS.phoneDigits.max) {
      errors.push({ field: "phone", message: MSG_PHONE_DIGITS });
    }
  }

  const maxPartySize = numericOr(ctx?.maxPartySize, DEFAULT_SETTINGS.maxPartySize);
  const partySize = toWholeNumber(input?.partySize);
  if (partySize === null || partySize < 1 || partySize > maxPartySize) {
    errors.push({ field: "partySize", message: msgPartySizeRange(maxPartySize) });
  }

  const date = trimmedString(input?.date);
  if (parseDateStr(date) === null) {
    errors.push({ field: "date", message: MSG_INVALID_DATE });
  }

  const startMinutes = resolveSlotStart(input);
  const slots = Array.isArray(ctx?.slots) ? ctx.slots : [];
  const slot =
    startMinutes === null ? undefined : slots.find((s) => s.startMinutes === startMinutes);
  if (!slot) {
    errors.push({ field: "slot", message: MSG_SLOT_NOT_AVAILABLE });
  }

  // The requested Table_Group. `Any available table` is the empty group, and is
  // resolved to concrete tables later, under the transaction's row lock.
  const requested = normaliseTableGroupInput(input?.tableIds);
  const auto =
    requested.length === 0 ||
    (requested.length === 1 &&
      (requested[0] === TABLE_SELECTION_ANY ||
        compareCi(requested[0] as string, TABLE_SELECTION_ANY_LABEL) === 0));

  const tableIds: string[] = [];
  if (!auto) {
    const resolved: DiningTable[] = [];
    for (const rawTable of requested) {
      const table = (ctx?.tables ?? []).find((t) => t.id === rawTable);
      if (!table) {
        errors.push({ field: "tableIds", message: MSG_TABLE_NOT_FOUND });
        continue;
      }
      // Req 7.4 — taken between the availability read and this submission.
      if (slot && !slot.availableTableIds.includes(table.id)) {
        errors.push({ field: "tableIds", message: MSG_TABLE_JUST_BOOKED });
        continue;
      }
      // Req 7.5 — Seat_Capacity is deliberately NOT checked. A Table_Group may
      // seat more or fewer guests than the party; the guest decides.
      if (!resolved.some((t) => t.id === table.id)) resolved.push(table);
    }
    // Canonical order, so the stored group reads the way the layout renders.
    for (const table of orderTables(resolved)) tableIds.push(table.id);
  }

  if (errors.length > 0) return fail(errors);

  return ok({
    guestName,
    phone,
    email: trimmedString(input?.email),
    partySize: partySize as number,
    date,
    slotStartMinutes: (slot as AvailabilitySlot).startMinutes,
    slotLabel: (slot as AvailabilitySlot).label,
    tableIds,
    specialRequests:
      input?.specialRequests === null || input?.specialRequests === undefined
        ? ""
        : String(input.specialRequests).trim(),
  });
}

/**
 * Normalises a Table_Group submission to a de-duplicated list of trimmed ids,
 * preserving submission order. A bare string is a one-table group, so a caller
 * holding a single id (walk-in, reassignment) needs no wrapper.
 */
export function normaliseTableGroupInput(value: unknown): string[] {
  const raw = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
  const ids: string[] = [];
  for (const entry of raw) {
    const id = trimmedString(entry);
    if (id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Accepts either an explicit start minute or a `06:30 PM` label. */
function resolveSlotStart(input: BookingInput): number | null {
  if (!isAbsent(input?.slotStartMinutes)) {
    const v = toWholeNumber(input?.slotStartMinutes);
    if (v !== null && v >= 0 && v < MINUTES_PER_DAY) return v;
    return null;
  }
  if (!isAbsent(input?.slotLabel)) {
    return parseSlotLabel(String(input?.slotLabel));
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2.6 Plain date arithmetic and the single timezone-aware function
// ---------------------------------------------------------------------------

interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** Parses a `YYYY-MM-DD` string. Returns null for anything else. */
function parseDateStr(v: string): CivilDate | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Days since 1970-01-01 for a civil date, by integer arithmetic only — no
 * `Date`, so no implicit timezone can enter.
 */
function daysFromCivil({ year, month, day }: CivilDate): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * Whole days from `fromDateStr` to `toDateStr`, both `YYYY-MM-DD`. Negative for
 * a past date, 0 when either string is not a valid date.
 */
export function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = parseDateStr(fromDateStr);
  const to = parseDateStr(toDateStr);
  if (from === null || to === null) return 0;
  return daysFromCivil(to) - daysFromCivil(from);
}

/** Weekday of a `YYYY-MM-DD` date, 0 = Sunday. Returns 0 for an invalid date. */
export function dayOfWeekForDate(dateStr: string): number {
  const civil = parseDateStr(dateStr);
  if (civil === null) return 0;
  // 1970-01-01 was a Thursday (index 4).
  return (((daysFromCivil(civil) + 4) % 7) + 7) % 7;
}

/** True when the string is a well-formed, real `YYYY-MM-DD` calendar date. */
export function isValidDateStr(dateStr: string): boolean {
  return parseDateStr(dateStr) !== null;
}

/** True when the IANA timezone is usable by the runtime. */
function isUsableTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The ONLY timezone-aware function in this module (Req 5.14).
 *
 * Renders `instant` in the given IANA zone via `Intl.DateTimeFormat` parts and
 * returns the tenant-local date string, minute of day and weekday. From here on
 * every other function works on those integers and date strings alone.
 *
 * An unusable zone falls back to `DEFAULT_SETTINGS.timezone`.
 */
export function tenantNow(
  timezone: string,
  instant: Date,
): { dateStr: string; minutesOfDay: number; weekday: number } {
  const requested = typeof timezone === "string" ? timezone.trim() : "";
  const zone =
    requested.length > 0 && isUsableTimeZone(requested) ? requested : DEFAULT_SETTINGS.timezone;

  const when = instant instanceof Date && !Number.isNaN(instant.getTime()) ? instant : new Date();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(when);

  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";

  const year = Number(pick("year"));
  const month = Number(pick("month"));
  const day = Number(pick("day"));
  // Some engines render midnight as hour 24 under hour12: false.
  const hour = Number(pick("hour")) % 24;
  const minute = Number(pick("minute"));

  const dateStr = `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;

  return {
    dateStr,
    minutesOfDay: hour * 60 + minute,
    weekday: dayOfWeekForDate(dateStr),
  };
}

// ---------------------------------------------------------------------------
// Pure shell helpers: routing, navigation derivation, signup rules
//
// The design's Testing Strategy assigns these to this module so task 3.3 can
// assert them as pure functions, without a DOM. They import nothing and read
// nothing but their arguments.
// ---------------------------------------------------------------------------

/** `/dashboard` destinations by Business_Profession (Req 2.1, 12.3, 12.5). */
export const PROFESSION_DASHBOARD_ROUTES: Record<string, string> = {
  [PROFESSION_RESTAURANT]: "/dashboards/restaurant",
  "Fitness Gym etc": "/dashboards/gym",
  "Beauty and wellness": "/dashboards/beauty",
  "Professional services like law, consultant, real estate, CA": "/dashboards/professional",
  "Education institutions": "/dashboards/education",
};

/** Absent, empty and unrecognised professions land on the medical dashboard. */
export const DEFAULT_DASHBOARD_ROUTE = "/dashboards/medical";

/** Total over every profession value, including absent and unrecognised ones. */
export function dashboardRouteForProfession(profession?: string | null): string {
  const key = trimmedString(profession);
  // Own-property guard: a profession that collides with an `Object.prototype`
  // member (`valueOf`, `toString`, `constructor`, `__proto__`, …) must still be
  // treated as unrecognised rather than resolving through the prototype chain.
  return Object.hasOwn(PROFESSION_DASHBOARD_ROUTES, key)
    ? PROFESSION_DASHBOARD_ROUTES[key]
    : DEFAULT_DASHBOARD_ROUTE;
}

/** tenantId prefixes by Business_Profession (Req 1.4). */
export const PROFESSION_TENANT_PREFIXES: Record<string, string> = {
  [PROFESSION_RESTAURANT]: TENANT_PREFIX_RESTAURANT,
  "Fitness Gym etc": "gym-",
  "Beauty and wellness": "beauty-",
  "Professional services like law, consultant, real estate, CA": "advisory-",
  "Education institutions": "edu-",
};

/** The pre-existing default prefix for healthcare and unrecognised values. */
export const DEFAULT_TENANT_PREFIX = "clinic-";

export function tenantPrefixForProfession(profession?: string | null): string {
  const key = trimmedString(profession);
  // Same own-property guard as dashboardRouteForProfession: prototype-named
  // professions resolve to the default prefix, never a prototype member.
  return Object.hasOwn(PROFESSION_TENANT_PREFIXES, key)
    ? PROFESSION_TENANT_PREFIXES[key]
    : DEFAULT_TENANT_PREFIX;
}

/** True when the profession identifies a Restaurant_Tenant. */
export function isRestaurantProfession(profession?: string | null): boolean {
  return trimmedString(profession) === PROFESSION_RESTAURANT;
}

/**
 * The public booking page's branch predicate: profession first, tenantId prefix
 * as the fallback when the profession is not loaded.
 */
export function isRestaurantTenant(tenantId?: string | null, profession?: string | null): boolean {
  if (isRestaurantProfession(profession)) return true;
  return trimmedString(tenantId).startsWith(TENANT_PREFIX_RESTAURANT);
}

export type RestaurantGuardDecision = "login" | "dashboard" | "render";

/**
 * The `/dashboards/restaurant` mount guard (Req 2.2, 2.3): no account resolves
 * to `/login`, a non-restaurant account resolves to `/dashboard`, and only a
 * restaurant account renders.
 */
export function restaurantGuardDecision(input: {
  hasAccount: boolean;
  profession?: string | null;
}): RestaurantGuardDecision {
  if (!input?.hasAccount) return "login";
  return isRestaurantProfession(input.profession) ? "render" : "dashboard";
}

/** The business name field label per profession (Req 1.2, 1.7). */
export function businessNameLabelForProfession(profession?: string | null): string {
  switch (trimmedString(profession)) {
    case PROFESSION_RESTAURANT:
      return "Restaurant Name";
    case "Beauty and wellness":
      return "Salon / Spa Name";
    case "Fitness Gym etc":
      return "Gym / Fitness Center Name";
    case "Professional services like law, consultant, real estate, CA":
      return "Firm / Office Name";
    case "Education institutions":
      return "Institution / Academy Name";
    default:
      return "Clinic / Hospital Name";
  }
}

/** Non-restaurant wording for the same 1-100 character rule. */
export const MSG_BUSINESS_NAME_LENGTH = `Business name must be between ${LIMITS.businessName.min} and ${LIMITS.businessName.max} characters`;

/**
 * Business name validation, accepted exactly when the trimmed length is 1-100
 * (Req 1.2, 1.6). A restaurant signup reports the restaurant-specific message.
 */
export function validateBusinessName(name: unknown, profession?: string | null): Result<string> {
  const trimmed = trimmedString(name);
  if (trimmed.length < LIMITS.businessName.min || trimmed.length > LIMITS.businessName.max) {
    return fail([
      {
        field: "businessName",
        message: isRestaurantProfession(profession)
          ? MSG_RESTAURANT_NAME_LENGTH
          : MSG_BUSINESS_NAME_LENGTH,
      },
    ]);
  }
  return ok(trimmed);
}

// --- Navigation derivation (Req 2.4-2.11) -----------------------------------

/** Core_Navigation_Entries — present for every account of a Restaurant_Tenant. */
export const CORE_NAV_ENTRIES = [
  "Overview",
  "Calendar",
  "Bookings List",
  "Guests",
  "Settings",
] as const;

/** Gated tabs of the dashboard shell. */
export const GATED_TAB_ENTRIES = ["WhatsApp", "Manage Plans"] as const;

/** Gated Settings sub-tabs. */
export const GATED_SUB_TAB_ENTRIES = ["WhatsApp Alerts", "Multi Location", "Manage Users"] as const;

/** Every Gated_Navigation_Entry. */
export const GATED_NAV_ENTRIES = [...GATED_TAB_ENTRIES, ...GATED_SUB_TAB_ENTRIES] as const;

/** The Settings sub-tabs gated on restaurant configuration (Req 2.5, 2.9). */
export const CONFIG_SUB_TABS = [
  "Restaurant Profile",
  "Operating Hours",
  "Tables",
  "Booking Rules",
] as const;

/** Tab render order of the Restaurant_Dashboard shell. */
export const DASHBOARD_TAB_ORDER = [
  "Overview",
  "Calendar",
  "Bookings List",
  "Guests",
  "WhatsApp",
  "Settings",
  "Manage Plans",
] as const;

export type CoreNavEntry = (typeof CORE_NAV_ENTRIES)[number];
export type GatedNavEntry = (typeof GATED_NAV_ENTRIES)[number];
export type ConfigSubTab = (typeof CONFIG_SUB_TABS)[number];

/** Gated entry to feature id mapping. */
export const GATED_NAV_FEATURE: Record<GatedNavEntry, string> = {
  WhatsApp: "whatsapp",
  "Manage Plans": "plans",
  "WhatsApp Alerts": "whatsapp",
  "Multi Location": "locations",
  "Manage Users": "users",
};

export const RESTAURANT_CONFIG_FEATURE = "restaurant_config";
export const RESTAURANT_BOOKINGS_FEATURE = "restaurant_bookings";

/** The shape `resolveFeatureAccess` returns, read structurally to stay pure. */
export interface FeatureGate {
  available?: boolean;
  permission: RestaurantPermission;
  visible: boolean;
}

export type ResolvedAccessLike = Record<string, FeatureGate>;

export interface RestaurantNavigation {
  /** False when the Feature_Access_Service returned no resolution (Req 2.10). */
  accessResolved: boolean;
  message: string | null;
  tabs: string[];
  gatedTabs: GatedNavEntry[];
  settingsSubTabs: string[];
  configPermission: RestaurantPermission;
  bookingsPermission: RestaurantPermission;
  canWriteConfig: boolean;
  canWriteBookings: boolean;
  effectiveTab: string;
}

/**
 * Derives the Restaurant_Dashboard navigation from a resolved feature access
 * (Req 2.4-2.11). The five core entries are always present; a gated entry
 * appears exactly when it resolves visible; the configuration sub-tabs appear
 * exactly for `operate` or `view_only`, with write controls only for `operate`;
 * a requested tab that is not visible falls back to `Overview`.
 */
export function deriveRestaurantNavigation(input: {
  access?: ResolvedAccessLike | null;
  requestedTab?: string | null;
}): RestaurantNavigation {
  const access = input?.access ?? null;
  const requestedTab = trimmedString(input?.requestedTab);

  if (!access) {
    return {
      accessResolved: false,
      message: MSG_FEATURE_ACCESS_UNRESOLVED,
      tabs: [...CORE_NAV_ENTRIES],
      gatedTabs: [],
      settingsSubTabs: [],
      configPermission: "none",
      bookingsPermission: "none",
      canWriteConfig: false,
      canWriteBookings: false,
      effectiveTab: CORE_NAV_ENTRIES.includes(requestedTab as CoreNavEntry)
        ? requestedTab
        : "Overview",
    };
  }

  const isVisible = (entry: GatedNavEntry): boolean =>
    access[GATED_NAV_FEATURE[entry]]?.visible === true;

  const gatedTabs = GATED_TAB_ENTRIES.filter(isVisible);
  const tabs: string[] = DASHBOARD_TAB_ORDER.filter(
    (tab) => CORE_NAV_ENTRIES.includes(tab as CoreNavEntry) || isVisible(tab as GatedNavEntry),
  );

  const configPermission = access[RESTAURANT_CONFIG_FEATURE]?.permission ?? "none";
  const bookingsPermission = access[RESTAURANT_BOOKINGS_FEATURE]?.permission ?? "none";

  const showConfigSubTabs = configPermission === "operate" || configPermission === "view_only";
  const settingsSubTabs: string[] = [
    ...(showConfigSubTabs ? CONFIG_SUB_TABS : []),
    ...GATED_SUB_TAB_ENTRIES.filter(isVisible),
  ];

  return {
    accessResolved: true,
    message: null,
    tabs,
    gatedTabs: [...gatedTabs],
    settingsSubTabs,
    configPermission,
    bookingsPermission,
    canWriteConfig: configPermission === "operate",
    canWriteBookings: bookingsPermission === "operate",
    effectiveTab: tabs.includes(requestedTab) ? requestedTab : "Overview",
  };
}

/**
 * The server-side write gate (Req 2.8, 4.11, 9.13): a resolved permission below
 * `operate` is refused with the documented message before any row is touched.
 */
export function authoriseRestaurantWrite(
  kind: "config" | "bookings",
  permission: RestaurantPermission | null | undefined,
): Result<true> {
  if (permission === "operate") return ok(true);
  return fail([
    {
      field: kind === "config" ? "restaurant_config" : "restaurant_bookings",
      message: kind === "config" ? MSG_NOT_AUTHORISED_RULES : MSG_NOT_AUTHORISED_BOOKINGS,
    },
  ]);
}
