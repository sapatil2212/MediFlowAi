/**
 * restaurant-booking-model.test.ts
 *
 * Property-based suite for the booking transaction, modelled in memory
 * (spec task 3.4).
 *
 * The store below models the rows `restaurant.server.ts` owns — tables,
 * bookings (`Appointment`), guests (`Patient`), the per-tenant-per-date token
 * counter, settings and operating hours — and `serialiseConcurrentPair` models
 * the `SELECT ... FOR UPDATE` lock plus the availability re-check under that
 * lock. Every decision is delegated to the pure module, so these properties
 * exercise the real logic and only the row plumbing is simulated.
 *
 * All time is injected: `nowDateStr` and `nowMinutes` are generated. Nothing
 * here reads the system clock or sleeps.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  BLOCKING_STATUSES,
  RELEASING_STATUSES,
  BOOKING_STATUSES,
  SLOT_INTERVALS,
  LIMITS,
  DEFAULT_SETTINGS,
  BOOKINGS_PAGE_SIZE,
  TABLE_SELECTION_ANY,
  MSG_TABLE_JUST_BOOKED,
  MSG_SLOT_NOT_AVAILABLE,
  MSG_GUEST_NAME_LENGTH,
  MSG_PHONE_DIGITS,
  MSG_TABLE_NOT_FOUND,
  MSG_TABLE_HAS_UPCOMING_BOOKINGS,
  msgPartySizeRange,
  computeAvailability,
  validateBookingRequest,
  pickAutoTable,
  pickAutoTables,
  orderTables,
  windowsOverlap,
  isBlockingStatus,
  isBookingStatus,
  normalisePhone,
  phoneDigitCount,
  formatSlotLabel,
  formatClock,
  dayOfWeekForDate,
  daysBetween,
  type AvailabilitySlot,
  type DayHours,
  type DiningTable,
  type FieldError,
  type ServiceSettings,
} from "./restaurant-availability";

// ===========================================================================
// The in-memory store
// ===========================================================================

interface TableRow extends DiningTable {
  tenantId: string;
}

interface BookingRow {
  id: string;
  tenantId: string;
  tableId: string;
  /** The Table_Name snapshot taken at booking time (Req 3.12). */
  tableNameAtBooking: string;
  date: string;
  startMinutes: number;
  slotLabel: string;
  /** The Turn_Time snapshot taken at creation (Req 7.1). */
  turnTimeMinutes: number;
  status: string;
  partySize: number;
  guestName: string;
  phone: string;
  email: string;
  specialRequests: string;
  tokenNo: number;
  guestId: string;
  locationId: string | null;
  /** The Booking_Group this row belongs to; equals `id` for a single table. */
  bookingGroupId: string;
}

interface GuestRow {
  id: string;
  tenantId: string;
  guestNo: number;
  name: string;
  phone: string;
}

interface NotificationRow {
  tenantId: string;
  bookingId: string;
  to: string;
  text: string;
}

interface Store {
  tables: TableRow[];
  bookings: BookingRow[];
  guests: GuestRow[];
  /** `${tenantId}|${date}` -> lastToken, modelling RestaurantTokenCounter. */
  tokenCounters: Map<string, number>;
  settings: Map<string, ServiceSettings>;
  hours: Map<string, DayHours[]>;
  notifications: NotificationRow[];
  log: string[];
  seq: number;
}

interface TenantSpec {
  tenantId: string;
  settings: ServiceSettings;
  hours: DayHours[];
  tables: Omit<TableRow, "tenantId">[];
}

function createStore(tenants: TenantSpec[]): Store {
  const store: Store = {
    tables: [],
    bookings: [],
    guests: [],
    tokenCounters: new Map(),
    settings: new Map(),
    hours: new Map(),
    notifications: [],
    log: [],
    seq: 0,
  };
  for (const tenant of tenants) {
    store.settings.set(tenant.tenantId, { ...tenant.settings });
    store.hours.set(
      tenant.tenantId,
      tenant.hours.map((h) => ({ ...h })),
    );
    for (const t of tenant.tables) store.tables.push({ ...t, tenantId: tenant.tenantId });
  }
  return store;
}

function cloneStore(store: Store): Store {
  return {
    tables: store.tables.map((t) => ({ ...t })),
    bookings: store.bookings.map((b) => ({ ...b })),
    guests: store.guests.map((g) => ({ ...g })),
    tokenCounters: new Map(store.tokenCounters),
    settings: new Map([...store.settings].map(([k, v]) => [k, { ...v }])),
    hours: new Map([...store.hours].map(([k, v]) => [k, v.map((h) => ({ ...h }))])),
    notifications: store.notifications.map((n) => ({ ...n })),
    log: [...store.log],
    seq: store.seq,
  };
}

/** A stable, comparable image of everything a write could touch. */
function storeImage(store: Store): string {
  return JSON.stringify({
    tables: [...store.tables].sort((a, b) => a.id.localeCompare(b.id)),
    bookings: [...store.bookings].sort((a, b) => a.id.localeCompare(b.id)),
    guests: [...store.guests].sort((a, b) => a.id.localeCompare(b.id)),
    tokenCounters: [...store.tokenCounters].sort(),
    settings: [...store.settings].sort(),
    hours: [...store.hours].sort(),
    notifications: store.notifications,
  });
}

interface NowRef {
  nowDateStr: string;
  nowMinutes: number;
}

// ---------------------------------------------------------------------------
// Tenant-scoped reads (every one filters on tenantId — Req 11.1, 11.2)
// ---------------------------------------------------------------------------

function settingsOf(store: Store, tenantId: string): ServiceSettings {
  return store.settings.get(tenantId) ?? { ...DEFAULT_SETTINGS };
}

function listTables(
  store: Store,
  tenantId: string,
  opts: { locationId?: string | null; includeInactive?: boolean } = {},
): TableRow[] {
  const locationId = opts.locationId ?? null;
  const rows = store.tables.filter(
    (t) =>
      t.tenantId === tenantId &&
      (t.locationId ?? null) === locationId &&
      (opts.includeInactive === false ? t.state === "active" : true),
  );
  return orderTables(rows);
}

function findTable(store: Store, tenantId: string, tableId: string): TableRow | null {
  return store.tables.find((t) => t.tenantId === tenantId && t.id === tableId) ?? null;
}

function findBooking(store: Store, tenantId: string, bookingId: string): BookingRow | null {
  return store.bookings.find((b) => b.tenantId === tenantId && b.id === bookingId) ?? null;
}

function hoursFor(store: Store, tenantId: string, date: string): DayHours | null {
  const weekday = dayOfWeekForDate(date);
  return (store.hours.get(tenantId) ?? []).find((h) => h.dayOfWeek === weekday) ?? null;
}

/** The Availability_Service, wired to the store snapshot. */
function availabilityFor(
  store: Store,
  tenantId: string,
  args: { date: string; partySize: number; locationId?: string | null; now: NowRef },
) {
  const tables = listTables(store, tenantId, { locationId: args.locationId });
  const tableIds = new Set(tables.map((t) => t.id));
  return computeAvailability({
    settings: settingsOf(store, tenantId),
    hours: hoursFor(store, tenantId, args.date),
    tables,
    bookings: store.bookings
      .filter((b) => b.tenantId === tenantId && b.date === args.date && tableIds.has(b.tableId))
      .map((b) => ({
        id: b.id,
        tableId: b.tableId,
        startMinutes: b.startMinutes,
        turnTimeMinutes: b.turnTimeMinutes,
        status: b.status,
      })),
    partySize: args.partySize,
    date: args.date,
    nowDateStr: args.now.nowDateStr,
    nowMinutes: args.now.nowMinutes,
    daysAhead: daysBetween(args.now.nowDateStr, args.date),
  });
}

// ---------------------------------------------------------------------------
// The booking transaction
// ---------------------------------------------------------------------------

interface BookingSubmission {
  guestName: unknown;
  phone?: unknown;
  /** The requested Table_Group. */
  tableIds?: unknown;
  email?: unknown;
  partySize: unknown;
  date: unknown;
  slotStartMinutes?: unknown;
  specialRequests?: unknown;
}

interface CreateResponse {
  bookingId: string;
  tokenNo: number;
  tableName: string;
  slotLabel: string;
  partySize: number;
}

type CreateResult =
  | { ok: true; booking: BookingRow; bookings: BookingRow[]; response: CreateResponse }
  | { ok: false; errors: FieldError[]; message: string };

function reject(errors: FieldError[]): CreateResult {
  return { ok: false, errors, message: errors[0]?.message ?? "" };
}

/**
 * Models `createBookingAtomic`: pure validation against the availability the
 * caller saw, then the `FOR UPDATE` lock — availability is recomputed from the
 * locked rows and the request is refused when the table is no longer free —
 * then the atomic token increment, the guest link and the insert.
 *
 * `preLockSlots` models availability as the caller saw it BEFORE the lock, which
 * is what makes a genuinely concurrent pair reachable.
 */
function createBooking(
  store: Store,
  tenantId: string,
  input: BookingSubmission,
  opts: {
    now: NowRef;
    locationId?: string | null;
    status?: string;
    phoneRequired?: boolean;
    preLockSlots?: AvailabilitySlot[];
  },
): CreateResult {
  const settings = settingsOf(store, tenantId);
  const tables = listTables(store, tenantId, { locationId: opts.locationId });
  const partySize = typeof input.partySize === "number" ? input.partySize : Number(input.partySize);

  const preLock =
    opts.preLockSlots ??
    availabilityFor(store, tenantId, {
      date: String(input.date),
      partySize: Number.isFinite(partySize) ? partySize : 0,
      locationId: opts.locationId,
      now: opts.now,
    }).slots;

  const validated = validateBookingRequest(input, {
    maxPartySize: settings.maxPartySize,
    slots: preLock,
    tables,
    phoneRequired: opts.phoneRequired,
  });
  if (!validated.ok) return reject(validated.errors);
  const value = validated.value;

  // --- the serialisation point: recompute availability under the lock -------
  const locked = availabilityFor(store, tenantId, {
    date: value.date,
    partySize: value.partySize,
    locationId: opts.locationId,
    now: opts.now,
  });
  const slot = locked.slots.find((s) => s.startMinutes === value.slotStartMinutes);
  if (!slot) return reject([{ field: "slot", message: MSG_SLOT_NOT_AVAILABLE }]);

  // The Table_Group. Seat_Capacity never rejects: a group may seat more or
  // fewer guests than the party.
  let group: TableRow[] = [];
  if (value.tableIds.length === 0) {
    group = pickAutoTables(
      tables.filter((t) => slot.availableTableIds.includes(t.id)),
      value.partySize,
    );
  } else {
    for (const id of value.tableIds) {
      const named = tables.find((t) => t.id === id) ?? null;
      if (!named) return reject([{ field: "tableIds", message: MSG_TABLE_NOT_FOUND }]);
      if (!slot.availableTableIds.includes(named.id)) {
        return reject([{ field: "tableIds", message: MSG_TABLE_JUST_BOOKED }]);
      }
      group.push(named);
    }
  }
  if (group.length === 0) return reject([{ field: "tableIds", message: MSG_TABLE_JUST_BOOKED }]);
  const table = group[0] as TableRow;

  // --- token: one atomic increment per tenant per date ---------------------
  const tokenKey = `${tenantId}|${value.date}`;
  const highestStored = store.bookings
    .filter((b) => b.tenantId === tenantId && b.date === value.date)
    .reduce((max, b) => (b.tokenNo > max ? b.tokenNo : max), 0);
  const seed = Math.max(highestStored, store.tokenCounters.get(tokenKey) ?? 0);
  const tokenNo = seed + 1;
  store.tokenCounters.set(tokenKey, tokenNo);

  // --- guest link ----------------------------------------------------------
  const guest = linkOrCreateGuest(store, tenantId, value.guestName, value.phone);

  // One row per Dining_Table of the Table_Group, sharing one Booking_Token and
  // one Booking_Group id — the id of the first row.
  const rows: BookingRow[] = group.map((member) => ({
    id: `bk${++store.seq}`,
    tenantId,
    tableId: member.id,
    tableNameAtBooking: member.name,
    date: value.date,
    startMinutes: value.slotStartMinutes,
    slotLabel: value.slotLabel,
    turnTimeMinutes: settings.turnTime,
    status: opts.status ?? BLOCKING_STATUSES[0],
    partySize: value.partySize,
    guestName: value.guestName,
    phone: value.phone,
    email: value.email,
    specialRequests: value.specialRequests,
    tokenNo,
    guestId: guest.id,
    locationId: opts.locationId ?? null,
    bookingGroupId: "",
  }));
  const groupId = (rows[0] as BookingRow).id;
  for (const row of rows) {
    row.bookingGroupId = groupId;
    store.bookings.push(row);
  }

  const booking = rows[0] as BookingRow;
  return {
    ok: true,
    booking,
    bookings: rows,
    response: {
      bookingId: groupId,
      tokenNo,
      tableName: group.map((t) => t.name).join(" + "),
      slotLabel: booking.slotLabel,
      partySize: booking.partySize,
    },
  };
}

/** Req 10.1, 10.2, 10.4, 10.6 — link by Normalised_Phone, or by name when phone-less. */
function linkOrCreateGuest(store: Store, tenantId: string, name: string, phone: string): GuestRow {
  const normalised = normalisePhone(phone);
  const existing =
    normalised.length > 0
      ? store.guests.find((g) => g.tenantId === tenantId && normalisePhone(g.phone) === normalised)
      : store.guests.find(
          (g) => g.tenantId === tenantId && normalisePhone(g.phone).length === 0 && g.name === name,
        );
  if (existing) return existing; // the stored Guest name is left untouched (Req 10.6)

  const guest: GuestRow = {
    id: `g${++store.seq}`,
    tenantId,
    guestNo: store.guests.filter((g) => g.tenantId === tenantId).length + 1,
    name,
    phone: normalised,
  };
  store.guests.push(guest);
  return guest;
}

/** The walk-in path: identical validation, Booking_Status `Seated` (Req 9.7). */
function createWalkIn(
  store: Store,
  tenantId: string,
  input: BookingSubmission,
  opts: { now: NowRef; locationId?: string | null; preLockSlots?: AvailabilitySlot[] },
): CreateResult {
  return createBooking(store, tenantId, input, { ...opts, status: "Seated" });
}

/**
 * Models two concurrent transactions on one row lock: both callers computed
 * availability from the same pre-lock snapshot, then the lock serialises them,
 * so the second one re-checks against what the first committed.
 */
function serialiseConcurrentPair(
  store: Store,
  requests: [
    { tenantId: string; input: BookingSubmission; locationId?: string | null },
    { tenantId: string; input: BookingSubmission; locationId?: string | null },
  ],
  now: NowRef,
): [CreateResult, CreateResult] {
  const preLock = requests.map((r) => {
    const partySize = Number(r.input.partySize);
    return availabilityFor(store, r.tenantId, {
      date: String(r.input.date),
      partySize: Number.isFinite(partySize) ? partySize : 0,
      locationId: r.locationId,
      now,
    }).slots;
  });

  const first = createBooking(store, requests[0].tenantId, requests[0].input, {
    now,
    locationId: requests[0].locationId,
    preLockSlots: preLock[0],
  });
  const second = createBooking(store, requests[1].tenantId, requests[1].input, {
    now,
    locationId: requests[1].locationId,
    preLockSlots: preLock[1],
  });
  return [first, second];
}

// ---------------------------------------------------------------------------
// Writes: status, reassignment, table registry, configuration
// ---------------------------------------------------------------------------

const BOOKING_NOT_FOUND = "Booking not found";
const NO_SHOW_STATUS = (RELEASING_STATUSES as readonly string[]).find(
  (s) => s === "No Show",
) as string;

type WriteResult = { ok: true } | { ok: false; message: string };

/** True when giving `booking` a Blocking_Status would collide on its Dining_Table. */
function conflictsUnderLock(store: Store, booking: BookingRow, tableId: string): boolean {
  return store.bookings.some(
    (other) =>
      other.id !== booking.id &&
      other.tenantId === booking.tenantId &&
      other.tableId === tableId &&
      other.date === booking.date &&
      isBlockingStatus(other.status) &&
      windowsOverlap(
        booking.startMinutes,
        booking.turnTimeMinutes,
        other.startMinutes,
        other.turnTimeMinutes,
      ),
  );
}

/** Req 9.4, 9.5 — restricted to the six statuses, tenant-scoped, re-checked under the lock. */
function setBookingStatus(
  store: Store,
  tenantId: string,
  bookingId: string,
  status: string,
): WriteResult {
  const booking = findBooking(store, tenantId, bookingId);
  if (!booking) return { ok: false, message: BOOKING_NOT_FOUND };
  if (!isBookingStatus(status)) return { ok: false, message: "Unknown booking status" };
  if (isBlockingStatus(status) && conflictsUnderLock(store, booking, booking.tableId)) {
    return { ok: false, message: MSG_TABLE_JUST_BOOKED };
  }
  booking.status = status;
  return { ok: true };
}

/** Req 9.6 — the same lock order, the same availability and capacity checks. */
function reassignBooking(
  store: Store,
  tenantId: string,
  bookingId: string,
  targetTableId: string,
): WriteResult {
  const booking = findBooking(store, tenantId, bookingId);
  if (!booking) return { ok: false, message: BOOKING_NOT_FOUND };
  const target = findTable(store, tenantId, targetTableId);
  if (!target) return { ok: false, message: MSG_TABLE_NOT_FOUND };
  // Seat_Capacity does not block a reassignment: staff may move a party onto a
  // smaller table, exactly as a guest may book one.
  if (target.state !== "active") return { ok: false, message: MSG_TABLE_JUST_BOOKED };
  if (isBlockingStatus(booking.status) && conflictsUnderLock(store, booking, target.id)) {
    return { ok: false, message: MSG_TABLE_JUST_BOOKED };
  }
  booking.tableId = target.id;
  booking.tableNameAtBooking = target.name;
  return { ok: true };
}

/** True when a Blocking_Status booking of that table starts later than now. */
function hasUpcomingBlockingBookings(
  store: Store,
  tenantId: string,
  tableId: string,
  now: NowRef,
): boolean {
  return store.bookings.some((b) => {
    if (b.tenantId !== tenantId || b.tableId !== tableId || !isBlockingStatus(b.status))
      return false;
    const days = daysBetween(now.nowDateStr, b.date);
    return days > 0 || (days === 0 && b.startMinutes > now.nowMinutes);
  });
}

/** Req 3.11, 3.12 — refused while an upcoming blocking booking references it. */
function deleteTable(store: Store, tenantId: string, tableId: string, now: NowRef): WriteResult {
  const table = findTable(store, tenantId, tableId);
  if (!table) return { ok: false, message: MSG_TABLE_NOT_FOUND };
  if (hasUpcomingBlockingBookings(store, tenantId, tableId, now)) {
    return { ok: false, message: MSG_TABLE_HAS_UPCOMING_BOOKINGS };
  }
  store.tables = store.tables.filter((t) => !(t.tenantId === tenantId && t.id === tableId));
  return { ok: true }; // every referencing booking is retained (Req 3.12)
}

function setTableState(
  store: Store,
  tenantId: string,
  tableId: string,
  state: "active" | "inactive",
): WriteResult {
  const table = findTable(store, tenantId, tableId);
  if (!table) return { ok: false, message: MSG_TABLE_NOT_FOUND };
  table.state = state;
  return { ok: true };
}

function updateTable(
  store: Store,
  tenantId: string,
  tableId: string,
  fields: { name?: string; seatCapacity?: number; area?: string; displayOrder?: number },
): WriteResult {
  const table = findTable(store, tenantId, tableId);
  if (!table) return { ok: false, message: MSG_TABLE_NOT_FOUND };
  Object.assign(table, fields);
  return { ok: true };
}

function saveSettings(store: Store, tenantId: string, settings: ServiceSettings): void {
  store.settings.set(tenantId, { ...settings });
}

function saveHours(store: Store, tenantId: string, hours: DayHours[]): void {
  store.hours.set(
    tenantId,
    hours.map((h) => ({ ...h })),
  );
}

// ---------------------------------------------------------------------------
// Reads: the Bookings List projection and the Guests projection
// ---------------------------------------------------------------------------

interface BookingFilters {
  dateFrom?: string | null;
  dateTo?: string | null;
  status?: string | null;
  area?: string | null;
  tableId?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
}

interface BookingProjection {
  id: string;
  guestName: string;
  phone: string;
  partySize: number;
  date: string;
  slotLabel: string;
  tableName: string;
  status: string;
  tokenNo: number;
}

function projectBooking(b: BookingRow): BookingProjection {
  return {
    id: b.id,
    guestName: b.guestName,
    phone: b.phone,
    partySize: b.partySize,
    date: b.date,
    slotLabel: b.slotLabel,
    tableName: b.tableNameAtBooking, // Req 3.12 — the booking-time snapshot
    status: b.status,
    tokenNo: b.tokenNo,
  };
}

/** Req 9.12 — date descending, then slot start ascending, then token ascending. */
function compareBookings(a: BookingRow, b: BookingRow): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
  return a.tokenNo - b.tokenNo;
}

function matchesFilters(store: Store, tenantId: string, b: BookingRow, f: BookingFilters): boolean {
  if (f.dateFrom && b.date < f.dateFrom) return false;
  if (f.dateTo && b.date > f.dateTo) return false;
  if (f.status && b.status !== f.status) return false;
  if (f.tableId && b.tableId !== f.tableId) return false;
  if (f.area) {
    const area = findTable(store, tenantId, b.tableId)?.area ?? "";
    if (area.toLowerCase() !== f.area.toLowerCase()) return false;
  }
  if (f.guestName && !b.guestName.toLowerCase().includes(f.guestName.toLowerCase())) return false;
  if (f.guestPhone && !normalisePhone(b.phone).includes(normalisePhone(f.guestPhone))) return false;
  return true;
}

function listBookings(store: Store, tenantId: string, filters: BookingFilters = {}, page = 1) {
  const matched = store.bookings
    .filter((b) => b.tenantId === tenantId)
    .filter((b) => matchesFilters(store, tenantId, b, filters))
    .sort(compareBookings);
  const start = (page - 1) * BOOKINGS_PAGE_SIZE;
  return {
    rows: matched.slice(start, start + BOOKINGS_PAGE_SIZE).map(projectBooking),
    total: matched.length,
    pageCount: Math.max(1, Math.ceil(matched.length / BOOKINGS_PAGE_SIZE)),
  };
}

interface GuestProjection {
  guestNo: number;
  name: string;
  phone: string;
  bookingCount: number;
  mostRecentDate: string | null;
  noShowCount: number;
}

function listGuests(store: Store, tenantId: string): GuestProjection[] {
  return store.guests
    .filter((g) => g.tenantId === tenantId)
    .sort((a, b) => a.guestNo - b.guestNo)
    .map((g) => {
      const linked = store.bookings.filter((b) => b.tenantId === tenantId && b.guestId === g.id);
      return {
        guestNo: g.guestNo,
        name: g.name,
        phone: g.phone,
        bookingCount: linked.length,
        mostRecentDate: linked.reduce<string | null>(
          (max, b) => (max === null || b.date > max ? b.date : max),
          null,
        ),
        noShowCount: linked.filter((b) => b.status === NO_SHOW_STATUS).length,
      };
    });
}

// ---------------------------------------------------------------------------
// The notification queue (Req 8.1, 8.3, 8.6)
// ---------------------------------------------------------------------------

function queueBookingNotification(
  store: Store,
  booking: BookingRow,
  ctx: { restaurantName: string; featureAvailable: boolean; connected: boolean },
): boolean {
  if (normalisePhone(booking.phone).length === 0) {
    store.log.push(`notification omitted, no guest phone: ${booking.id}`);
    return false;
  }
  if (!ctx.featureAvailable || !ctx.connected) {
    store.log.push(`notification skipped, feature unavailable or disconnected: ${booking.id}`);
    return false;
  }
  store.notifications.push({
    tenantId: booking.tenantId,
    bookingId: booking.id,
    to: booking.phone,
    text: [
      ctx.restaurantName,
      booking.date,
      booking.slotLabel,
      `Party of ${booking.partySize}`,
      booking.tableNameAtBooking,
      `Token ${booking.tokenNo}`,
    ].join(" | "),
  });
  return true;
}

// ===========================================================================
// Generators
// ===========================================================================

const TENANT_A = "resto-alpha";
const TENANT_B = "resto-beta";
const arbLocationId = fc.constantFrom<string | null>(null, "loc-1", "loc-2");

/** Settings that always admit Booking_Slots inside the generated Operating_Hours. */
const arbWorkableSettings: fc.Arbitrary<ServiceSettings> = fc.record({
  slotInterval: fc.constantFrom(...SLOT_INTERVALS),
  turnTime: fc.constantFrom(LIMITS.turnTime.min, 60, 90),
  maxPartySize: fc.integer({ min: 8, max: LIMITS.maxPartySize.max }),
  advanceBookingWindow: fc.integer({ min: 30, max: LIMITS.advanceBookingWindow.max }),
  minLeadTime: fc.constantFrom(LIMITS.minLeadTime.min, 15, 30),
  timezone: fc.constant(DEFAULT_SETTINGS.timezone),
});

/** Seven open weekdays, so a generated date always resolves to an open day. */
const OPEN_HOURS: DayHours[] = Array.from({ length: 7 }, (_, i) => ({
  dayOfWeek: i,
  openTime: "11:00",
  closeTime: "23:00",
  isClosed: false,
}));

const arbTableSpecs = fc
  .array(
    fc.record({
      seatCapacity: fc.integer({ min: 2, max: 12 }),
      area: fc.constantFrom("Main", "Patio", "Rooftop"),
      displayOrder: fc.integer({ min: LIMITS.displayOrder.min, max: 5 }),
      state: fc.oneof(
        { weight: 5, arbitrary: fc.constant<"active" | "inactive">("active") },
        { weight: 1, arbitrary: fc.constant<"active" | "inactive">("inactive") },
      ),
      locationId: arbLocationId,
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((rows) =>
    rows.map((r, i) => ({
      ...r,
      id: `tb${i}`,
      name: `T${i}`,
    })),
  );

/** All-active tables on the Primary_Location, used where availability must exist. */
const arbPrimaryTableSpecs = fc
  .array(
    fc.record({
      seatCapacity: fc.integer({ min: 2, max: 12 }),
      area: fc.constantFrom("Main", "Patio"),
      displayOrder: fc.integer({ min: LIMITS.displayOrder.min, max: 5 }),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((rows) =>
    rows.map((r, i) => ({
      ...r,
      id: `tb${i}`,
      name: `T${i}`,
      state: "active" as const,
      locationId: null,
    })),
  );

const arbNow: fc.Arbitrary<NowRef> = fc.record({
  nowDateStr: fc.integer({ min: 0, max: 2000 }).map((offset) => {
    const ms = Date.UTC(2024, 0, 1) + offset * 86_400_000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }),
  nowMinutes: fc.integer({ min: 0, max: 700 }),
});

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

const GUEST_NAMES = [
  "Asha",
  "Ravi Kumar",
  "Meera Nair",
  "  Padded Name  ",
  "Zoë",
  "A".repeat(100),
] as const;
/** Every value here normalises to 7-15 digits, so validation accepts it. */
const PHONES = [
  "9876543210",
  "98765 43210",
  "(079) 123-4567",
  "+91-98765-43210",
  "080-2222-3333",
  "12345678",
] as const;
const arbGuestName = fc.constantFrom(...GUEST_NAMES);
const arbPhone = fc.constantFrom(...PHONES);

/** A fixture: a store with two tenants, injected now, and a booking date. */
interface Fixture {
  store: Store;
  now: NowRef;
  date: string;
}

function buildFixture(
  settings: ServiceSettings,
  tables: DiningTable[],
  now: NowRef,
  dayOffset: number,
): Fixture {
  return {
    store: createStore([
      { tenantId: TENANT_A, settings, hours: OPEN_HOURS, tables: tables.map((t) => ({ ...t })) },
      {
        tenantId: TENANT_B,
        settings,
        hours: OPEN_HOURS,
        tables: tables.map((t) => ({ ...t, id: `beta-${t.id}`, name: `B-${t.name}` })),
      },
    ]),
    now,
    date: shiftDate(now.nowDateStr, dayOffset),
  };
}

const arbFixture: fc.Arbitrary<Fixture> = fc
  .record({
    settings: arbWorkableSettings,
    tables: arbPrimaryTableSpecs,
    now: arbNow,
    dayOffset: fc.integer({ min: 0, max: 3 }),
  })
  .map(({ settings, tables, now, dayOffset }) => buildFixture(settings, tables, now, dayOffset));

/** Max_Party_Size pinned to its ceiling, so a too-small-table case is unambiguous. */
const arbWideFixture: fc.Arbitrary<Fixture> = fc
  .record({
    settings: arbWorkableSettings,
    tables: arbPrimaryTableSpecs,
    now: arbNow,
    dayOffset: fc.integer({ min: 0, max: 3 }),
  })
  .map(({ settings, tables, now, dayOffset }) =>
    buildFixture({ ...settings, maxPartySize: LIMITS.maxPartySize.max }, tables, now, dayOffset),
  );

function pickSlot(slots: AvailabilitySlot[], index: number): AvailabilitySlot | null {
  return slots.length === 0 ? null : slots[index % slots.length];
}

/** Asserts the no-double-booking invariant over the whole store. */
function expectNoDoubleBooking(store: Store): void {
  const blocking = store.bookings.filter((b) => isBlockingStatus(b.status));
  for (let i = 0; i < blocking.length; i++) {
    for (let j = i + 1; j < blocking.length; j++) {
      const a = blocking[i];
      const b = blocking[j];
      if (a.tenantId !== b.tenantId || a.tableId !== b.tableId || a.date !== b.date) continue;
      expect(
        windowsOverlap(a.startMinutes, a.turnTimeMinutes, b.startMinutes, b.turnTimeMinutes),
      ).toBe(false);
    }
  }
}

/** A booking row seeded directly, modelling rows that already exist. */
function seedBooking(
  store: Store,
  tenantId: string,
  fields: {
    tableId: string;
    date: string;
    startMinutes: number;
    turnTimeMinutes?: number;
    status?: string;
    partySize?: number;
    guestName?: string;
    phone?: string;
    tokenNo?: number;
  },
): BookingRow {
  const table = findTable(store, tenantId, fields.tableId);
  const guest = linkOrCreateGuest(
    store,
    tenantId,
    fields.guestName ?? "Asha",
    fields.phone ?? "9876543210",
  );
  const key = `${tenantId}|${fields.date}`;
  const tokenNo = fields.tokenNo ?? (store.tokenCounters.get(key) ?? 0) + 1;
  store.tokenCounters.set(key, Math.max(tokenNo, store.tokenCounters.get(key) ?? 0));
  const booking: BookingRow = {
    id: `bk${++store.seq}`,
    tenantId,
    tableId: fields.tableId,
    tableNameAtBooking: table?.name ?? fields.tableId,
    date: fields.date,
    startMinutes: fields.startMinutes,
    slotLabel: formatSlotLabel(fields.startMinutes),
    turnTimeMinutes: fields.turnTimeMinutes ?? settingsOf(store, tenantId).turnTime,
    status: fields.status ?? BLOCKING_STATUSES[0],
    partySize: fields.partySize ?? 2,
    guestName: fields.guestName ?? "Asha",
    phone: normalisePhone(fields.phone ?? "9876543210"),
    email: "",
    specialRequests: "",
    tokenNo,
    guestId: guest.id,
    locationId: table?.locationId ?? null,
    bookingGroupId: "",
  };
  // A seeded row is its own Booking_Group — a single-table booking.
  booking.bookingGroupId = booking.id;
  store.bookings.push(booking);
  return booking;
}

// ===========================================================================
// Task 3.4 — Properties 4, 10, 12, 13, 14, 15, 16, 20, 22, 23, 25, 26, 36
// ===========================================================================

const arbOp = fc.record({
  kind: fc.constantFrom("create", "walkIn", "reassign", "status"),
  dayOffset: fc.integer({ min: 0, max: 2 }),
  slotIdx: fc.nat({ max: 24 }),
  tableIdx: fc.integer({ min: -1, max: 3 }),
  partySize: fc.integer({ min: 1, max: 8 }),
  nameIdx: fc.nat({ max: GUEST_NAMES.length - 1 }),
  phoneIdx: fc.nat({ max: PHONES.length - 1 }),
  bookingIdx: fc.nat({ max: 12 }),
  statusIdx: fc.nat({ max: BOOKING_STATUSES.length - 1 }),
});

type Op = ReturnType<typeof arbOp extends fc.Arbitrary<infer T> ? () => T : never>;

function applyOp(store: Store, tenantId: string, op: Op, now: NowRef): void {
  const date = shiftDate(now.nowDateStr, op.dayOffset);

  if (op.kind === "create" || op.kind === "walkIn") {
    const tables = listTables(store, tenantId, { locationId: null });
    const availability = availabilityFor(store, tenantId, {
      date,
      partySize: op.partySize,
      locationId: null,
      now,
    });
    const slot = pickSlot(availability.slots, op.slotIdx);
    if (!slot) return;
    const tableId =
      op.tableIdx < 0 || tables.length === 0
        ? TABLE_SELECTION_ANY
        : tables[op.tableIdx % tables.length].id;
    const input: BookingSubmission = {
      guestName: GUEST_NAMES[op.nameIdx],
      phone: PHONES[op.phoneIdx],
      partySize: op.partySize,
      date,
      slotStartMinutes: slot.startMinutes,
      tableIds: [tableId],
    };
    if (op.kind === "create") createBooking(store, tenantId, input, { now });
    else createWalkIn(store, tenantId, input, { now });
    return;
  }

  const own = store.bookings.filter((b) => b.tenantId === tenantId);
  if (own.length === 0) return;
  const booking = own[op.bookingIdx % own.length];

  if (op.kind === "reassign") {
    const tables = listTables(store, tenantId, {});
    if (tables.length === 0) return;
    const target = tables[Math.max(0, op.tableIdx) % tables.length];
    reassignBooking(store, tenantId, booking.id, target.id);
  } else {
    setBookingStatus(store, tenantId, booking.id, BOOKING_STATUSES[op.statusIdx]);
  }
}

describe("Property 4: No two blocking bookings share a table and an overlapping window", () => {
  // Feature: restaurant-table-booking, Property 4: For any sequence of booking creations, table reassignments, and Booking_Status changes applied to a Restaurant_Tenant, after every step no two Table_Bookings in a Blocking_Status reference the same Dining_Table with overlapping Occupancy_Windows; and for any pair of requests naming the same Dining_Table with overlapping Occupancy_Windows submitted concurrently, exactly one is accepted and the other is rejected with `That table was just booked. Please pick another table or time`.
  it("holds the invariant after every step and accepts exactly one of a concurrent pair on one table", () => {
    fc.assert(
      fc.property(
        arbFixture,
        fc.array(arbOp, { maxLength: 12 }),
        fc.nat({ max: 24 }),
        (fx, ops, slotIdx) => {
          const { store, now, date } = fx;

          for (const op of ops) {
            applyOp(store, TENANT_A, op, now);
            expectNoDoubleBooking(store);
          }

          // Two requests naming the same Dining_Table for the same Booking_Slot,
          // submitted concurrently: their Occupancy_Windows are identical, so they
          // overlap, and the row lock must let exactly one through.
          const availability = availabilityFor(store, TENANT_A, {
            date,
            partySize: 1,
            locationId: null,
            now,
          });
          const slot = pickSlot(availability.slots, slotIdx);
          if (slot && slot.availableTableIds.length > 0) {
            const tableId = slot.availableTableIds[0];
            const base: BookingSubmission = {
              guestName: "Asha",
              phone: PHONES[0],
              partySize: 1,
              date,
              slotStartMinutes: slot.startMinutes,
              tableIds: [tableId],
            };
            const [first, second] = serialiseConcurrentPair(
              store,
              [
                { tenantId: TENANT_A, input: { ...base } },
                { tenantId: TENANT_A, input: { ...base, guestName: "Ravi Kumar" } },
              ],
              now,
            );
            expect([first.ok, second.ok].filter(Boolean).length).toBe(1);
            const rejected = first.ok ? second : first;
            expect(rejected.ok).toBe(false);
            if (!rejected.ok) expect(rejected.message).toBe(MSG_TABLE_JUST_BOOKED);
          }

          expectNoDoubleBooking(store);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("Property 10: Booking_Tokens are unique and sequential per Tenant per date", () => {
  // Feature: restaurant-table-booking, Property 10: For any sequence of accepted Table_Bookings across arbitrary Tenants and dates, including concurrently submitted ones, the Booking_Tokens within a single Tenant and calendar date are pairwise distinct, the first is 1 greater than the largest Booking_Token already assigned for that Tenant and date, and each subsequent one is exactly 1 greater than its predecessor; a rejected request leaves the sequence for that Tenant and date unchanged.
  it("continues the per-tenant-per-date sequence, stays distinct, and is untouched by a rejection", () => {
    fc.assert(
      fc.property(
        arbFixture,
        fc.nat({ max: 4 }),
        fc.array(
          fc.record({
            tenantB: fc.boolean(),
            dayOffset: fc.integer({ min: 0, max: 2 }),
            slotIdx: fc.nat({ max: 24 }),
          }),
          {
            minLength: 1,
            maxLength: 8,
          },
        ),
        (fx, seededCount, requests) => {
          const { store, now } = fx;

          // Bookings that already hold tokens for that tenant and date. Their
          // windows sit before Open_Time, so they never block a generated slot.
          const seedDate = shiftDate(now.nowDateStr, 0);
          const firstTable = listTables(store, TENANT_A, { locationId: null })[0];
          for (let i = 0; i < seededCount; i++) {
            seedBooking(store, TENANT_A, {
              tableId: firstTable.id,
              date: seedDate,
              startMinutes: 0,
              turnTimeMinutes: LIMITS.turnTime.min,
              tokenNo: i + 1,
            });
          }
          const largestSeeded = (tenantId: string, date: string) =>
            store.bookings
              .filter((b) => b.tenantId === tenantId && b.date === date)
              .reduce((max, b) => (b.tokenNo > max ? b.tokenNo : max), 0);

          const expectedNext = new Map<string, number>();
          for (const b of store.bookings) {
            const key = `${b.tenantId}|${b.date}`;
            expectedNext.set(key, Math.max(expectedNext.get(key) ?? 0, b.tokenNo));
          }
          expect(largestSeeded(TENANT_A, seedDate)).toBe(seededCount);

          for (const req of requests) {
            const tenantId = req.tenantB ? TENANT_B : TENANT_A;
            const date = shiftDate(now.nowDateStr, req.dayOffset);
            const key = `${tenantId}|${date}`;
            const before = expectedNext.get(key) ?? 0;

            const availability = availabilityFor(store, tenantId, {
              date,
              partySize: 1,
              locationId: null,
              now,
            });
            const slot = pickSlot(availability.slots, req.slotIdx);
            const input: BookingSubmission = {
              guestName: "Asha",
              phone: PHONES[0],
              partySize: 1,
              date,
              slotStartMinutes: slot ? slot.startMinutes : 3, // 3 is never a slot start
              tableIds: [TABLE_SELECTION_ANY],
            };
            const result = createBooking(store, tenantId, input, { now });

            if (result.ok) {
              expect(result.booking.tokenNo).toBe(before + 1);
              expectedNext.set(key, before + 1);
            } else {
              // a rejection leaves the sequence for that tenant and date alone
              expect(
                store.bookings
                  .filter((b) => b.tenantId === tenantId && b.date === date)
                  .reduce((max, b) => (b.tokenNo > max ? b.tokenNo : max), 0),
              ).toBe(before);
            }
          }

          // tokens are pairwise distinct and contiguous per tenant per date
          const groups = new Map<string, number[]>();
          for (const b of store.bookings) {
            const key = `${b.tenantId}|${b.date}`;
            groups.set(key, [...(groups.get(key) ?? []), b.tokenNo]);
          }
          for (const [, tokens] of groups) {
            const sorted = [...tokens].sort((a, b) => a - b);
            expect(new Set(sorted).size).toBe(sorted.length);
            for (let i = 0; i < sorted.length; i++) expect(sorted[i]).toBe(i + 1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("Property 12: An accepted booking round-trips into its record and its response", () => {
  // Feature: restaurant-table-booking, Property 12: For any valid restaurant booking request, the created Table_Booking holds the submitted `tenantId`, Guest name, Guest phone, Guest email, Party_Size, booking date-time, Booking_Slot, and assigned Dining_Table, holds the Turn_Time in force at creation, holds Booking_Status `Pending`, holds a Booking_Token, and the returned response reports the booking identifier, the Booking_Token, the assigned Table_Name, the Booking_Slot, and the Party_Size matching that record.
  it("stores every submitted value with the Turn_Time snapshot, status Pending and a token echoed by the response", () => {
    fc.assert(
      fc.property(
        arbFixture,
        arbGuestName,
        arbPhone,
        fc.constantFrom("", "guest@example.com"),
        fc.integer({ min: 1, max: 2 }),
        fc.nat({ max: 24 }),
        fc.boolean(),
        fc.constantFrom("", "  Window seat please  "),
        (fx, guestName, phone, email, partySize, slotIdx, explicitTable, requests) => {
          const { store, now, date } = fx;
          const availability = availabilityFor(store, TENANT_A, {
            date,
            partySize,
            locationId: null,
            now,
          });
          const slot = pickSlot(availability.slots, slotIdx);
          if (!slot || slot.availableTableIds.length === 0) return;

          const turnTimeAtCreation = settingsOf(store, TENANT_A).turnTime;
          const input: BookingSubmission = {
            guestName,
            phone,
            email,
            partySize,
            date,
            slotStartMinutes: slot.startMinutes,
            tableIds: [explicitTable ? slot.availableTableIds[0] : TABLE_SELECTION_ANY],
            specialRequests: requests,
          };

          const result = createBooking(store, TENANT_A, input, { now });
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const { booking, response } = result;
          expect(booking.tenantId).toBe(TENANT_A);
          expect(booking.guestName).toBe(guestName.trim());
          expect(booking.phone).toBe(normalisePhone(phone));
          expect(booking.email).toBe(email.trim());
          expect(booking.partySize).toBe(partySize);
          expect(booking.date).toBe(date);
          expect(booking.startMinutes).toBe(slot.startMinutes);
          expect(booking.slotLabel).toBe(formatSlotLabel(slot.startMinutes));
          expect(slot.availableTableIds).toContain(booking.tableId);
          expect(booking.turnTimeMinutes).toBe(turnTimeAtCreation);
          expect(booking.status).toBe("Pending");
          expect(BLOCKING_STATUSES).toContain(booking.status);
          expect(booking.tokenNo).toBeGreaterThan(0);
          expect(booking.specialRequests).toBe(requests.trim());
          if (explicitTable) expect(booking.tableId).toBe(slot.availableTableIds[0]);

          expect(response.bookingId).toBe(booking.id);
          expect(response.tokenNo).toBe(booking.tokenNo);
          expect(response.tableName).toBe(booking.tableNameAtBooking);
          expect(response.tableName).toBe(findTable(store, TENANT_A, booking.tableId)?.name);
          expect(response.slotLabel).toBe(booking.slotLabel);
          expect(response.partySize).toBe(booking.partySize);

          // A later Turn_Time change never moves this snapshot (Req 4.12).
          saveSettings(store, TENANT_A, {
            ...settingsOf(store, TENANT_A),
            turnTime: LIMITS.turnTime.max,
          });
          expect(findBooking(store, TENANT_A, booking.id)?.turnTimeMinutes).toBe(
            turnTimeAtCreation,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

// `tableTooSmall` is deliberately absent: Seat_Capacity no longer rejects a
// booking. A party may take a table smaller than itself, or combine several.
const REJECTIONS = [
  "none",
  "unavailableTable",
  "partyBelowRange",
  "partyAboveRange",
  "slotAbsent",
  "nameEmpty",
  "nameTooLong",
  "phoneTooShort",
  "phoneTooLong",
  "phoneMissing",
] as const;

describe("Property 13: Every rejected booking leaves the stored bookings unchanged", () => {
  // Feature: restaurant-table-booking, Property 13: For any booking request that names a Dining_Table that is not available, whose Party_Size exceeds the Seat_Capacity of the named Dining_Table, whose Party_Size falls outside 1 through Max_Party_Size, whose Booking_Slot is absent from the Booking_Slots computed for the date, whose Guest name has a trimmed length of 0 or greater than 100 characters, or whose Normalised_Phone holds fewer than 7 or more than 15 digits, the request is rejected with the message stated for that condition and the set of stored Table_Bookings is unchanged; and for any accepted request, none of those conditions holds.
  it("rejects each documented condition with its own message and mutates nothing, and accepts only clean requests", () => {
    fc.assert(
      fc.property(
        arbWideFixture,
        fc.constantFrom(...REJECTIONS),
        fc.nat({ max: 24 }),
        (fx, mutation, slotIdx) => {
          const { store, now, date } = fx;
          const settings = settingsOf(store, TENANT_A);

          const availability = availabilityFor(store, TENANT_A, {
            date,
            partySize: 1,
            locationId: null,
            now,
          });
          const slot = pickSlot(availability.slots, slotIdx);
          if (!slot || slot.availableTableIds.length === 0) return;
          const table = findTable(store, TENANT_A, slot.availableTableIds[0]) as TableRow;

          const base: BookingSubmission = {
            guestName: "Asha",
            phone: PHONES[0],
            partySize: 1,
            date,
            slotStartMinutes: slot.startMinutes,
            tableIds: [table.id],
          };
          let input: BookingSubmission = { ...base };
          let expected: string | null = null;

          switch (mutation) {
            case "none":
              break;
            case "unavailableTable":
              // occupy the named table for exactly that Occupancy_Window first
              seedBooking(store, TENANT_A, {
                tableId: table.id,
                date,
                startMinutes: slot.startMinutes,
                turnTimeMinutes: settings.turnTime,
                status: BLOCKING_STATUSES[1],
              });
              expected = MSG_TABLE_JUST_BOOKED;
              break;
            case "partyBelowRange":
              input = { ...base, partySize: 0 };
              expected = msgPartySizeRange(settings.maxPartySize);
              break;
            case "partyAboveRange":
              input = { ...base, partySize: settings.maxPartySize + 1 };
              expected = msgPartySizeRange(settings.maxPartySize);
              break;
            case "slotAbsent":
              input = { ...base, slotStartMinutes: 3 }; // never a generated start
              expected = MSG_SLOT_NOT_AVAILABLE;
              break;
            case "nameEmpty":
              input = { ...base, guestName: "   " };
              expected = MSG_GUEST_NAME_LENGTH;
              break;
            case "nameTooLong":
              input = { ...base, guestName: "A".repeat(LIMITS.guestName.max + 1) };
              expected = MSG_GUEST_NAME_LENGTH;
              break;
            case "phoneTooShort":
              input = { ...base, phone: "12 34-56" };
              expected = MSG_PHONE_DIGITS;
              break;
            case "phoneTooLong":
              input = { ...base, phone: "1".repeat(LIMITS.phoneDigits.max + 1) };
              expected = MSG_PHONE_DIGITS;
              break;
            case "phoneMissing":
              input = { ...base, phone: "" };
              expected = MSG_PHONE_DIGITS;
              break;
          }

          const before = storeImage(store);
          const result = createBooking(store, TENANT_A, input, { now });

          if (expected === null) {
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            // none of the documented conditions holds for an accepted request
            const value = result.booking;
            expect(value.guestName.trim().length).toBeGreaterThanOrEqual(LIMITS.guestName.min);
            expect(value.guestName.length).toBeLessThanOrEqual(LIMITS.guestName.max);
            expect(phoneDigitCount(value.phone)).toBeGreaterThanOrEqual(LIMITS.phoneDigits.min);
            expect(phoneDigitCount(value.phone)).toBeLessThanOrEqual(LIMITS.phoneDigits.max);
            expect(value.partySize).toBeGreaterThanOrEqual(1);
            expect(value.partySize).toBeLessThanOrEqual(settings.maxPartySize);
            expect(availability.slots.some((s) => s.startMinutes === value.startMinutes)).toBe(
              true,
            );
            // Seat_Capacity is no longer a precondition, so the accepted request
            // is only required to name a stored Dining_Table.
            expect(findTable(store, TENANT_A, value.tableId)).not.toBeNull();
          } else {
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.errors.map((e) => e.message)).toContain(expected);
            expect(storeImage(store)).toBe(before);
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("Property 14: Releasing a booking restores the availability that preceded it", () => {
  // Feature: restaurant-table-booking, Property 14: For any snapshot and any accepted Table_Booking, computing availability after that Table_Booking's Booking_Status is set to a Releasing_Status returns a result deeply equal to the availability computed before that Table_Booking existed.
  it("returns availability deeply equal to the pre-booking result once the status releases the table", () => {
    fc.assert(
      fc.property(
        arbFixture,
        fc.nat({ max: 24 }),
        fc.integer({ min: 1, max: 2 }),
        fc.constantFrom(...RELEASING_STATUSES),
        (fx, slotIdx, partySize, releasing) => {
          const { store, now, date } = fx;
          const before = availabilityFor(store, TENANT_A, {
            date,
            partySize,
            locationId: null,
            now,
          });
          const slot = pickSlot(before.slots, slotIdx);
          if (!slot || slot.availableTableIds.length === 0) return;

          const created = createBooking(
            store,
            TENANT_A,
            {
              guestName: "Asha",
              phone: PHONES[0],
              partySize,
              date,
              slotStartMinutes: slot.startMinutes,
              tableIds: [TABLE_SELECTION_ANY],
            },
            { now },
          );
          expect(created.ok).toBe(true);
          if (!created.ok) return;

          const during = availabilityFor(store, TENANT_A, {
            date,
            partySize,
            locationId: null,
            now,
          });
          expect(during).not.toEqual(before); // the booking does occupy its window

          const changed = setBookingStatus(store, TENANT_A, created.booking.id, releasing);
          expect(changed.ok).toBe(true);

          const after = availabilityFor(store, TENANT_A, {
            date,
            partySize,
            locationId: null,
            now,
          });
          expect(after).toEqual(before);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 15: Walk-in creation is equivalent to public creation, plus the Seated status", () => {
  // Feature: restaurant-table-booking, Property 15: For any booking input, the walk-in path accepts it if and only if the Public_Booking_Form path accepts it and rejects it with the same message otherwise; every Table_Booking the walk-in path creates carries Booking_Status `Seated`.
  it("accepts and rejects exactly as the public path does, and stores Seated when it accepts", () => {
    fc.assert(
      fc.property(
        arbWideFixture,
        fc.constantFrom(...REJECTIONS),
        fc.nat({ max: 24 }),
        arbGuestName,
        arbPhone,
        fc.integer({ min: 1, max: 3 }),
        (fx, mutation, slotIdx, guestName, phone, partySize) => {
          const { store, now, date } = fx;
          const settings = settingsOf(store, TENANT_A);
          const availability = availabilityFor(store, TENANT_A, {
            date,
            partySize,
            locationId: null,
            now,
          });
          const slot = pickSlot(availability.slots, slotIdx);
          if (!slot) return;

          let input: BookingSubmission = {
            guestName,
            phone,
            partySize,
            date,
            slotStartMinutes: slot.startMinutes,
            tableIds: [slot.availableTableIds[0] ?? TABLE_SELECTION_ANY],
          };
          if (mutation === "nameEmpty") input = { ...input, guestName: "   " };
          if (mutation === "phoneMissing") input = { ...input, phone: "" };
          if (mutation === "phoneTooShort") input = { ...input, phone: "12-34" };
          if (mutation === "partyAboveRange")
            input = { ...input, partySize: settings.maxPartySize + 1 };
          if (mutation === "slotAbsent") input = { ...input, slotStartMinutes: 3 };

          const publicStore = cloneStore(store);
          const walkInStore = cloneStore(store);

          const asPublic = createBooking(publicStore, TENANT_A, input, { now });
          const asWalkIn = createWalkIn(walkInStore, TENANT_A, input, { now });

          expect(asWalkIn.ok).toBe(asPublic.ok);
          if (!asPublic.ok && !asWalkIn.ok) {
            expect(asWalkIn.errors.map((e) => e.message)).toEqual(
              asPublic.errors.map((e) => e.message),
            );
            expect(asWalkIn.message).toBe(asPublic.message);
            expect(storeImage(walkInStore)).toBe(storeImage(store));
          }
          if (asPublic.ok && asWalkIn.ok) {
            expect(asPublic.booking.status).toBe("Pending");
            expect(asWalkIn.booking.status).toBe("Seated");
            expect(BLOCKING_STATUSES).toContain(asWalkIn.booking.status);
            // identical in every other respect
            expect({ ...asWalkIn.booking, status: null }).toEqual({
              ...asPublic.booking,
              status: null,
            });
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("Property 16: Configuration changes never mutate existing bookings", () => {
  // Feature: restaurant-table-booking, Property 16: For any set of existing Table_Bookings and any valid change to Operating_Hours, to Service_Settings, to a Dining_Table's fields, or to a Dining_Table's Table_State, the stored Table_Bookings are unchanged afterwards — identifiers, assigned Dining_Table, Booking_Status, and Turn_Time snapshot included — including Table_Bookings whose Booking_Slot now falls outside the saved Operating_Hours; and for any Table_Booking, the Table_Name it displays equals the Table_Name recorded at booking time whether or not that Dining_Table still exists.
  it("leaves every stored booking untouched and keeps displaying the booking-time table name", () => {
    fc.assert(
      fc.property(
        arbFixture,
        fc.array(arbOp, { minLength: 1, maxLength: 6 }),
        arbWorkableSettings,
        fc.integer({ min: 1, max: 3 }),
        (fx, ops, newSettings, dayShift) => {
          const { store, now } = fx;

          // A booking on a past date, so the table may later be deleted.
          const pastDate = shiftDate(now.nowDateStr, -dayShift);
          const availability = availabilityFor(store, TENANT_A, {
            date: pastDate,
            partySize: 1,
            locationId: null,
            now,
          });
          if (
            availability.slots.length === 0 ||
            availability.slots[0].availableTableIds.length === 0
          )
            return;
          const created = createBooking(
            store,
            TENANT_A,
            {
              guestName: "Asha",
              phone: PHONES[0],
              partySize: 1,
              date: pastDate,
              slotStartMinutes: availability.slots[0].startMinutes,
              tableIds: [availability.slots[0].availableTableIds[0]],
            },
            { now },
          );
          expect(created.ok).toBe(true);
          if (!created.ok) return;

          for (const op of ops) applyOp(store, TENANT_A, op, now);

          const bookingsBefore = JSON.stringify(
            [...store.bookings].sort((a, b) => a.id.localeCompare(b.id)),
          );
          const bookedTableName = created.booking.tableNameAtBooking;
          const bookedTableId = created.booking.tableId;

          // Operating_Hours closed on every weekday, so every stored Booking_Slot
          // now falls outside the saved hours.
          saveHours(
            store,
            TENANT_A,
            OPEN_HOURS.map((h) => ({ ...h, isClosed: true })),
          );
          saveSettings(store, TENANT_A, newSettings);
          updateTable(store, TENANT_A, bookedTableId, {
            name: `${bookedTableName}-renamed`,
            seatCapacity: LIMITS.seatCapacity.max,
            area: "Renamed Area",
            displayOrder: LIMITS.displayOrder.max,
          });
          setTableState(store, TENANT_A, bookedTableId, "inactive");

          expect(JSON.stringify([...store.bookings].sort((a, b) => a.id.localeCompare(b.id)))).toBe(
            bookingsBefore,
          );
          expect(findBooking(store, TENANT_A, created.booking.id)?.turnTimeMinutes).toBe(
            created.booking.turnTimeMinutes,
          );

          // The displayed Table_Name is the booking-time snapshot, before and
          // after the Dining_Table stops existing.
          const rowBefore = listBookings(store, TENANT_A).rows.find(
            (r) => r.id === created.booking.id,
          );
          expect(rowBefore?.tableName).toBe(bookedTableName);

          const refusalExpected = hasUpcomingBlockingBookings(store, TENANT_A, bookedTableId, now);
          const deleted = deleteTable(store, TENANT_A, bookedTableId, now);
          expect(deleted.ok).toBe(!refusalExpected);
          if (deleted.ok) {
            expect(findTable(store, TENANT_A, bookedTableId)).toBeNull();
          }
          expect(store.bookings.some((b) => b.id === created.booking.id)).toBe(true);
          const rowAfter = listBookings(store, TENANT_A).rows.find(
            (r) => r.id === created.booking.id,
          );
          expect(rowAfter?.tableName).toBe(bookedTableName);
          expect(JSON.stringify([...store.bookings].sort((a, b) => a.id.localeCompare(b.id)))).toBe(
            bookingsBefore,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 20: Deletion is refused exactly when an upcoming blocking booking references the table", () => {
  // Feature: restaurant-table-booking, Property 20: For any Dining_Table and any set of Table_Bookings referencing it, deletion is refused with `This table has upcoming bookings. Set the table to inactive instead` if and only if some referencing Table_Booking has a Booking_Slot start time later than the current time and a Blocking_Status; a refusal leaves that Dining_Table and every referencing Table_Booking unchanged, and an accepted deletion retains every referencing Table_Booking.
  it("refuses exactly on an upcoming blocking booking and retains every referencing booking either way", () => {
    fc.assert(
      fc.property(
        arbFixture,
        fc.array(
          fc.record({
            tableIdx: fc.nat({ max: 3 }),
            dayOffset: fc.integer({ min: -2, max: 2 }),
            minuteDelta: fc.integer({ min: -120, max: 120 }),
            status: fc.constantFrom(...BOOKING_STATUSES),
          }),
          { maxLength: 6 },
        ),
        fc.nat({ max: 3 }),
        (fx, seeds, targetIdx) => {
          const { store, now } = fx;
          const tables = listTables(store, TENANT_A, {});

          for (const s of seeds) {
            const table = tables[s.tableIdx % tables.length];
            seedBooking(store, TENANT_A, {
              tableId: table.id,
              date: shiftDate(now.nowDateStr, s.dayOffset),
              startMinutes: Math.min(1439, Math.max(0, now.nowMinutes + s.minuteDelta)),
              status: s.status,
            });
          }

          const target = tables[targetIdx % tables.length];
          const referencing = store.bookings.filter(
            (b) => b.tenantId === TENANT_A && b.tableId === target.id,
          );
          const upcoming = referencing.some((b) => {
            if (!isBlockingStatus(b.status)) return false;
            const days = daysBetween(now.nowDateStr, b.date);
            return days > 0 || (days === 0 && b.startMinutes > now.nowMinutes);
          });

          const before = storeImage(store);
          const result = deleteTable(store, TENANT_A, target.id, now);

          expect(result.ok).toBe(!upcoming);
          if (!result.ok) {
            expect(result.message).toBe(MSG_TABLE_HAS_UPCOMING_BOOKINGS);
            expect(storeImage(store)).toBe(before);
            expect(findTable(store, TENANT_A, target.id)).not.toBeNull();
          } else {
            expect(findTable(store, TENANT_A, target.id)).toBeNull();
            for (const b of referencing) {
              const retained = store.bookings.find((x) => x.id === b.id);
              expect(retained).toBeDefined();
              expect(retained?.tableNameAtBooking).toBe(b.tableNameAtBooking);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 22: Guest linking is invariant to phone formatting", () => {
  // Feature: restaurant-table-booking, Property 22: For any phone value, its Normalised_Phone contains no space, hyphen, opening bracket, or closing bracket, normalising it twice equals normalising it once, and inserting any number of those four characters anywhere in the value leaves its Normalised_Phone unchanged; for any sequence of Table_Bookings within one Tenant, two bookings link to the same Guest record if and only if their Normalised_Phone values are equal, a booking carrying no Guest phone links to a Guest record identified by its Guest name, Guest numbers within a Tenant are distinct and sequential, and a booking whose Guest name differs from the matched Guest record stores its own Guest name while leaving that Guest record's name unchanged.
  it("normalises formatting away and links guests by Normalised_Phone, or by name when phone-less", () => {
    fc.assert(
      fc.property(
        arbFixture,
        fc.string({ maxLength: 25 }),
        fc.array(fc.tuple(fc.constantFrom(" ", "-", "(", ")"), fc.nat({ max: 40 })), {
          maxLength: 8,
        }),
        fc.array(
          fc.record({
            phoneIdx: fc.nat({ max: PHONES.length - 1 }),
            nameIdx: fc.nat({ max: 2 }),
            padding: fc.array(fc.tuple(fc.constantFrom(" ", "-", "(", ")"), fc.nat({ max: 40 })), {
              maxLength: 4,
            }),
            phoneLess: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (fx, rawPhone, inserts, bookingSpecs) => {
          // --- Normalised_Phone ------------------------------------------------
          const normalised = normalisePhone(rawPhone);
          for (const ch of [" ", "-", "(", ")"]) expect(normalised.includes(ch)).toBe(false);
          expect(normalisePhone(normalised)).toBe(normalised);

          let decorated = rawPhone;
          for (const [ch, pos] of inserts) {
            const at = pos % (decorated.length + 1);
            decorated = decorated.slice(0, at) + ch + decorated.slice(at);
          }
          expect(normalisePhone(decorated)).toBe(normalised);

          // --- Guest linking ---------------------------------------------------
          const { store, now, date } = fx;
          const created: { booking: BookingRow; submittedName: string; submittedPhone: string }[] =
            [];

          bookingSpecs.forEach((spec, i) => {
            const availability = availabilityFor(store, TENANT_A, {
              date,
              partySize: 1,
              locationId: null,
              now,
            });
            const slot = pickSlot(availability.slots, i * 3);
            if (!slot || slot.availableTableIds.length === 0) return;

            let phone = spec.phoneLess ? "" : PHONES[spec.phoneIdx];
            if (!spec.phoneLess) {
              for (const [ch, pos] of spec.padding) {
                const at = pos % (phone.length + 1);
                phone = phone.slice(0, at) + ch + phone.slice(at);
              }
            }
            const guestName = GUEST_NAMES[spec.nameIdx];
            const result = createBooking(
              store,
              TENANT_A,
              {
                guestName,
                phone,
                partySize: 1,
                date,
                slotStartMinutes: slot.startMinutes,
                tableIds: [slot.availableTableIds[0]],
              },
              { now, phoneRequired: !spec.phoneLess },
            );
            if (result.ok)
              created.push({
                booking: result.booking,
                submittedName: guestName.trim(),
                submittedPhone: phone,
              });
          });

          // two bookings that carry a phone share a Guest record exactly when
          // their Normalised_Phone values are equal
          const withPhone = created.filter((c) => normalisePhone(c.submittedPhone).length > 0);
          for (let i = 0; i < withPhone.length; i++) {
            for (let j = i + 1; j < withPhone.length; j++) {
              const same =
                normalisePhone(withPhone[i].submittedPhone) ===
                normalisePhone(withPhone[j].submittedPhone);
              expect(withPhone[i].booking.guestId === withPhone[j].booking.guestId).toBe(same);
            }
          }

          // a phone-less booking links by Guest name
          const withoutPhone = created.filter((c) => normalisePhone(c.submittedPhone).length === 0);
          for (let i = 0; i < withoutPhone.length; i++) {
            for (let j = i + 1; j < withoutPhone.length; j++) {
              const same = withoutPhone[i].submittedName === withoutPhone[j].submittedName;
              expect(withoutPhone[i].booking.guestId === withoutPhone[j].booking.guestId).toBe(
                same,
              );
            }
          }

          // guest numbers are distinct and sequential within the tenant
          const guests = store.guests.filter((g) => g.tenantId === TENANT_A);
          const numbers = guests.map((g) => g.guestNo).sort((a, b) => a - b);
          expect(new Set(numbers).size).toBe(numbers.length);
          numbers.forEach((n, i) => expect(n).toBe(i + 1));

          // the booking keeps its own Guest name; the Guest record keeps the
          // name it was created with
          for (const c of created) {
            expect(c.booking.guestName).toBe(c.submittedName);
            const guest = store.guests.find((g) => g.id === c.booking.guestId) as GuestRow;
            expect(guest).toBeDefined();
            expect(normalisePhone(guest.phone)).toBe(normalisePhone(c.submittedPhone));
            const firstForGuest = created.find(
              (x) => x.booking.guestId === guest.id,
            ) as (typeof created)[number];
            expect(guest.name).toBe(firstForGuest.submittedName);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 23: Booking and Guest projections, filters, ordering, and pagination are faithful", () => {
  // Feature: restaurant-table-booking, Property 23: For any set of Table_Bookings and any combination of date-range, Booking_Status, Table_Area, Dining_Table, Guest-name, and Guest-phone criteria, the Bookings List contains exactly the Table_Bookings satisfying every supplied criterion, exposes for each one the Guest name, Guest phone, Party_Size, booking date, Booking_Slot, Table_Name, Booking_Status, and Booking_Token, is ordered by booking date descending then Booking_Slot start ascending then Booking_Token ascending, and splits into pages of 25 whose concatenation reproduces that order with no Table_Booking missing or repeated; and for any Guest record, the displayed booking count, most recent booking date, and `No Show` count equal those aggregates over the Table_Bookings linked to it.
  it("filters, projects, orders and paginates exactly, and reports faithful guest aggregates", () => {
    fc.assert(
      fc.property(
        arbFixture,
        fc.array(
          fc.record({
            tenantB: fc.boolean(),
            tableIdx: fc.nat({ max: 3 }),
            dayOffset: fc.integer({ min: -3, max: 3 }),
            startMinutes: fc.integer({ min: 660, max: 1320 }),
            status: fc.constantFrom(...BOOKING_STATUSES),
            nameIdx: fc.nat({ max: GUEST_NAMES.length - 1 }),
            phoneIdx: fc.nat({ max: PHONES.length - 1 }),
            partySize: fc.integer({ min: 1, max: 8 }),
          }),
          { maxLength: 60 },
        ),
        fc.record(
          {
            dateFrom: fc.integer({ min: -3, max: 3 }),
            dateTo: fc.integer({ min: -3, max: 3 }),
            status: fc.constantFrom(...BOOKING_STATUSES),
            area: fc.constantFrom("Main", "Patio", "Rooftop"),
            tableIdx: fc.nat({ max: 3 }),
            guestName: fc.constantFrom("as", "Ravi", "ZO"),
            guestPhone: fc.constantFrom("98765", "079", "12345678"),
          },
          { requiredKeys: [] },
        ),
        fc.integer({ min: 1, max: 4 }),
        (fx, seeds, rawFilters, page) => {
          const { store, now } = fx;
          const tablesA = listTables(store, TENANT_A, {});
          const tablesB = listTables(store, TENANT_B, {});

          for (const s of seeds) {
            const tenantId = s.tenantB ? TENANT_B : TENANT_A;
            const tables = s.tenantB ? tablesB : tablesA;
            seedBooking(store, tenantId, {
              tableId: tables[s.tableIdx % tables.length].id,
              date: shiftDate(now.nowDateStr, s.dayOffset),
              startMinutes: s.startMinutes,
              status: s.status,
              partySize: s.partySize,
              guestName: GUEST_NAMES[s.nameIdx],
              phone: PHONES[s.phoneIdx],
            });
          }

          const filters: BookingFilters = {
            dateFrom:
              rawFilters.dateFrom === undefined
                ? null
                : shiftDate(now.nowDateStr, rawFilters.dateFrom),
            dateTo:
              rawFilters.dateTo === undefined ? null : shiftDate(now.nowDateStr, rawFilters.dateTo),
            status: rawFilters.status ?? null,
            area: rawFilters.area ?? null,
            tableId:
              rawFilters.tableIdx === undefined
                ? null
                : tablesA[rawFilters.tableIdx % tablesA.length].id,
            guestName: rawFilters.guestName ?? null,
            guestPhone: rawFilters.guestPhone ?? null,
          };

          // reference: filter, then order
          const reference = store.bookings
            .filter((b) => b.tenantId === TENANT_A)
            .filter((b) => matchesFilters(store, TENANT_A, b, filters))
            .sort(compareBookings);

          const result = listBookings(store, TENANT_A, filters, page);
          expect(result.total).toBe(reference.length);

          // exactly the satisfying bookings, and never another tenant's
          const allPages: BookingProjection[] = [];
          for (let p = 1; p <= result.pageCount; p++) {
            const pageRows = listBookings(store, TENANT_A, filters, p).rows;
            expect(pageRows.length).toBeLessThanOrEqual(BOOKINGS_PAGE_SIZE);
            allPages.push(...pageRows);
          }
          expect(allPages.map((r) => r.id)).toEqual(reference.map((b) => b.id));
          expect(new Set(allPages.map((r) => r.id)).size).toBe(allPages.length);
          expect(result.rows).toEqual(
            reference
              .slice((page - 1) * BOOKINGS_PAGE_SIZE, page * BOOKINGS_PAGE_SIZE)
              .map(projectBooking),
          );

          // ordering: date descending, then slot start ascending, then token ascending
          for (let i = 1; i < reference.length; i++) {
            const a = reference[i - 1];
            const b = reference[i];
            if (a.date !== b.date) expect(a.date > b.date).toBe(true);
            else if (a.startMinutes !== b.startMinutes)
              expect(a.startMinutes).toBeLessThan(b.startMinutes);
            else expect(a.tokenNo).toBeLessThanOrEqual(b.tokenNo);
          }

          // the projection exposes every displayed field
          for (const row of allPages) {
            const source = store.bookings.find((b) => b.id === row.id) as BookingRow;
            expect(row).toEqual({
              id: source.id,
              guestName: source.guestName,
              phone: source.phone,
              partySize: source.partySize,
              date: source.date,
              slotLabel: source.slotLabel,
              tableName: source.tableNameAtBooking,
              status: source.status,
              tokenNo: source.tokenNo,
            });
            expect(source.tenantId).toBe(TENANT_A);
          }

          // guest aggregates
          for (const guest of listGuests(store, TENANT_A)) {
            const row = store.guests.find(
              (g) => g.tenantId === TENANT_A && g.guestNo === guest.guestNo,
            ) as GuestRow;
            const linked = store.bookings.filter(
              (b) => b.tenantId === TENANT_A && b.guestId === row.id,
            );
            expect(guest.bookingCount).toBe(linked.length);
            expect(guest.noShowCount).toBe(linked.filter((b) => b.status === "No Show").length);
            expect(guest.mostRecentDate).toBe(
              linked.length === 0 ? null : linked.map((b) => b.date).sort()[linked.length - 1],
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("Property 25: Tenant isolation holds for every read and every write", () => {
  // Feature: restaurant-table-booking, Property 25: For any store holding Dining_Tables and Table_Bookings for several Tenants, every read performed for one Tenant returns only rows carrying that Tenant's `tenantId` and is unchanged by adding, altering, or removing rows belonging to any other Tenant; every operation naming a Dining_Table or Table_Booking of another Tenant is rejected as not found and mutates no row of either Tenant.
  it("returns only own rows, is unaffected by another tenant's rows, and reports foreign ids as not found", () => {
    fc.assert(
      fc.property(
        arbFixture,
        fc.array(
          fc.record({
            tenantB: fc.boolean(),
            tableIdx: fc.nat({ max: 3 }),
            dayOffset: fc.integer({ min: -1, max: 2 }),
            startMinutes: fc.integer({ min: 660, max: 1300 }),
            status: fc.constantFrom(...BOOKING_STATUSES),
          }),
          { maxLength: 8 },
        ),
        fc.constantFrom<"active" | "inactive">("active", "inactive"),
        (fx, seeds, state) => {
          const { store, now } = fx;
          const tablesA = listTables(store, TENANT_A, {});
          const tablesB = listTables(store, TENANT_B, {});

          for (const s of seeds) {
            const tenantId = s.tenantB ? TENANT_B : TENANT_A;
            const tables = s.tenantB ? tablesB : tablesA;
            seedBooking(store, tenantId, {
              tableId: tables[s.tableIdx % tables.length].id,
              date: shiftDate(now.nowDateStr, s.dayOffset),
              startMinutes: s.startMinutes,
              status: s.status,
            });
          }

          // every read for A carries only A's tenantId
          expect(listTables(store, TENANT_A, {}).every((t) => t.tenantId === TENANT_A)).toBe(true);
          for (const row of listBookings(store, TENANT_A).rows) {
            expect((store.bookings.find((b) => b.id === row.id) as BookingRow).tenantId).toBe(
              TENANT_A,
            );
          }
          const readsBefore = JSON.stringify({
            tables: listTables(store, TENANT_A, {}),
            bookings: listBookings(store, TENANT_A),
            guests: listGuests(store, TENANT_A),
            availability: availabilityFor(store, TENANT_A, {
              date: shiftDate(now.nowDateStr, 1),
              partySize: 2,
              locationId: null,
              now,
            }),
          });

          // add, alter and remove rows of the OTHER tenant
          seedBooking(store, TENANT_B, {
            tableId: tablesB[0].id,
            date: shiftDate(now.nowDateStr, 1),
            startMinutes: 720,
            status: BLOCKING_STATUSES[0],
          });
          setTableState(store, TENANT_B, tablesB[0].id, state);
          if (tablesB.length > 1) {
            const removedId = tablesB[tablesB.length - 1].id;
            store.tables = store.tables.filter(
              (t) => !(t.tenantId === TENANT_B && t.id === removedId),
            );
          }
          saveSettings(store, TENANT_B, {
            ...settingsOf(store, TENANT_B),
            turnTime: LIMITS.turnTime.max,
          });

          expect(
            JSON.stringify({
              tables: listTables(store, TENANT_A, {}),
              bookings: listBookings(store, TENANT_A),
              guests: listGuests(store, TENANT_A),
              availability: availabilityFor(store, TENANT_A, {
                date: shiftDate(now.nowDateStr, 1),
                partySize: 2,
                locationId: null,
                now,
              }),
            }),
          ).toBe(readsBefore);

          // every operation naming a foreign row is not found and mutates nothing
          const foreignTable = listTables(store, TENANT_B, {})[0];
          const foreignBooking = store.bookings.find((b) => b.tenantId === TENANT_B) ?? null;
          const ownBooking = store.bookings.find((b) => b.tenantId === TENANT_A) ?? null;
          const image = storeImage(store);

          expect(setTableState(store, TENANT_A, foreignTable.id, "inactive")).toEqual({
            ok: false,
            message: MSG_TABLE_NOT_FOUND,
          });
          expect(updateTable(store, TENANT_A, foreignTable.id, { name: "Hijacked" })).toEqual({
            ok: false,
            message: MSG_TABLE_NOT_FOUND,
          });
          expect(deleteTable(store, TENANT_A, foreignTable.id, now)).toEqual({
            ok: false,
            message: MSG_TABLE_NOT_FOUND,
          });
          expect(findTable(store, TENANT_A, foreignTable.id)).toBeNull();

          if (foreignBooking) {
            expect(
              setBookingStatus(store, TENANT_A, foreignBooking.id, BOOKING_STATUSES[0]),
            ).toEqual({
              ok: false,
              message: BOOKING_NOT_FOUND,
            });
            expect(reassignBooking(store, TENANT_A, foreignBooking.id, tablesA[0].id)).toEqual({
              ok: false,
              message: BOOKING_NOT_FOUND,
            });
            expect(findBooking(store, TENANT_A, foreignBooking.id)).toBeNull();
          }
          if (ownBooking) {
            expect(reassignBooking(store, TENANT_A, ownBooking.id, foreignTable.id)).toEqual({
              ok: false,
              message: MSG_TABLE_NOT_FOUND,
            });
          }

          expect(storeImage(store)).toBe(image);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("Property 26: Dining_Tables are scoped to exactly one Location and availability respects that scope", () => {
  // Feature: restaurant-table-booking, Property 26: For any Dining_Table, it is associated with exactly one Location of its own Tenant, which is the Primary_Location whenever the multi-location feature is unavailable or no Location is supplied; for any multi-location Tenant and any selected Location, the Available_Table sets contain only Dining_Tables associated with that Location — the Primary_Location when none is selected — and are unchanged by adding Dining_Tables to any other Location.
  it("keeps every table in exactly one location and computes availability from that location alone", () => {
    fc.assert(
      fc.property(
        fc.record({
          settings: arbWorkableSettings,
          tables: arbTableSpecs,
          extra: arbTableSpecs,
          now: arbNow,
          dayOffset: fc.integer({ min: 0, max: 3 }),
          selected: arbLocationId,
          partySize: fc.integer({ min: 1, max: 4 }),
          multiLocation: fc.boolean(),
        }),
        (raw) => {
          const tables = raw.multiLocation
            ? raw.tables
            : raw.tables.map((t) => ({ ...t, locationId: null })); // Req 11.5
          const store = createStore([
            { tenantId: TENANT_A, settings: raw.settings, hours: OPEN_HOURS, tables },
          ]);
          const now = raw.now;
          const date = shiftDate(now.nowDateStr, raw.dayOffset);
          const selected = raw.multiLocation ? raw.selected : null;

          // exactly one Location per Dining_Table
          const buckets = [null, "loc-1", "loc-2"];
          for (const table of store.tables) {
            const hits = buckets.filter((b) => (table.locationId ?? null) === b);
            expect(hits.length).toBe(1);
            expect(
              listTables(store, TENANT_A, { locationId: hits[0] }).some((t) => t.id === table.id),
            ).toBe(true);
          }

          const scopedIds = new Set(
            store.tables.filter((t) => (t.locationId ?? null) === selected).map((t) => t.id),
          );
          const availability = availabilityFor(store, TENANT_A, {
            date,
            partySize: raw.partySize,
            locationId: selected,
            now,
          });
          expect(availability.activeTableCount).toBe(
            store.tables.filter((t) => (t.locationId ?? null) === selected && t.state === "active")
              .length,
          );
          for (const slot of availability.slots) {
            for (const id of slot.availableTableIds) expect(scopedIds.has(id)).toBe(true);
          }

          // no selected Location means the Primary_Location
          expect(availabilityFor(store, TENANT_A, { date, partySize: raw.partySize, now })).toEqual(
            availabilityFor(store, TENANT_A, {
              date,
              partySize: raw.partySize,
              locationId: null,
              now,
            }),
          );

          // adding Dining_Tables to another Location changes nothing
          const otherLocation = selected === "loc-9" ? "loc-8" : "loc-9";
          for (const t of raw.extra) {
            store.tables.push({
              ...t,
              id: `extra-${t.id}`,
              name: `X-${t.name}`,
              locationId: otherLocation,
              tenantId: TENANT_A,
            });
          }
          expect(
            availabilityFor(store, TENANT_A, {
              date,
              partySize: raw.partySize,
              locationId: selected,
              now,
            }),
          ).toEqual(availability);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 36: A queued booking notification carries the booking's facts, and only when the feature permits", () => {
  // Feature: restaurant-table-booking, Property 36: For any created Table_Booking carrying a Guest phone, the message the Notification_Service queues contains the restaurant name, the booking date, the Booking_Slot, the Party_Size, the assigned Table_Name, and the Booking_Token; for any combination of WhatsApp feature availability and connection state, a message is queued if and only if the feature is available for the Tenant and the connection state is connected, and the Table_Booking is created either way.
  it("queues a fact-carrying message exactly when the feature is available and connected, and books either way", () => {
    fc.assert(
      fc.property(
        arbFixture,
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        arbPhone,
        fc.nat({ max: 24 }),
        fc.constantFrom("Spice Route", "Café Noir", "The Green Fork"),
        (fx, featureAvailable, connected, phoneLess, phone, slotIdx, restaurantName) => {
          const { store, now, date } = fx;
          const availability = availabilityFor(store, TENANT_A, {
            date,
            partySize: 2,
            locationId: null,
            now,
          });
          const slot = pickSlot(availability.slots, slotIdx);
          if (!slot || slot.availableTableIds.length === 0) return;

          const result = createBooking(
            store,
            TENANT_A,
            {
              guestName: "Asha",
              phone: phoneLess ? "" : phone,
              partySize: 2,
              date,
              slotStartMinutes: slot.startMinutes,
              tableIds: [slot.availableTableIds[0]],
            },
            { now, phoneRequired: !phoneLess },
          );
          // the Table_Booking is created either way
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const booking = result.booking;
          expect(store.bookings.some((b) => b.id === booking.id)).toBe(true);

          const queued = queueBookingNotification(store, booking, {
            restaurantName,
            featureAvailable,
            connected,
          });
          const hasPhone = normalisePhone(phoneLess ? "" : phone).length > 0;
          expect(queued).toBe(featureAvailable && connected && hasPhone);

          if (queued) {
            expect(store.notifications.length).toBe(1);
            const message = store.notifications[0];
            expect(message.tenantId).toBe(TENANT_A);
            expect(message.bookingId).toBe(booking.id);
            expect(message.to).toBe(booking.phone);
            expect(message.text).toContain(restaurantName);
            expect(message.text).toContain(booking.date);
            expect(message.text).toContain(booking.slotLabel);
            expect(message.text).toContain(String(booking.partySize));
            expect(message.text).toContain(booking.tableNameAtBooking);
            expect(message.text).toContain(String(booking.tokenNo));
          } else {
            expect(store.notifications.length).toBe(0);
            expect(store.log.length).toBeGreaterThan(0);
          }
          // the booking survives regardless of the notification outcome
          expect(findBooking(store, TENANT_A, booking.id)).not.toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });
});
