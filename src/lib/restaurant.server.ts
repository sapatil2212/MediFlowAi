// ─────────────────────────────────────────────────────────────────────────────
// restaurant.server.ts — row access for the Restaurant & Dining category.
//
// Server-only (`.server.ts` house convention, cf. `auth.server.ts`,
// `video.server.ts`). Raw SQL through `query` / `queryOne` / `execute` /
// `withTransaction` from `./db`; no Prisma. `crypto.randomUUID()` for ids, as in
// `./booking.ts`.
//
// Two rules hold everywhere in this file and are what make Req 11.1-11.3
// structural rather than a matter of discipline:
//
//   1. Every exported function takes `tenantId` as its FIRST argument and every
//      statement it issues contains `tenantId = ?`. No function accepts a table
//      id or a booking id without also constraining `tenantId`.
//   2. A row that does not match the caller's `tenantId` is reported as NOT
//      FOUND, never as forbidden, so a foreign id discloses nothing.
//
// All decision logic lives in the pure, isomorphic `./restaurant-availability`
// module. This file does I/O and nothing else: it never re-derives a slot list,
// an overlap test, an auto-assignment, or a status set locally. Every
// blocking / releasing status predicate is GENERATED from the exported
// `BLOCKING_STATUSES` / `RELEASING_STATUSES` tuples, so the two sets cannot
// drift from the pure layer.
//
// Time is stored the way every existing category stores it: `Appointment
// .dateTime` holds wall time on the booking date. This module therefore binds
// date-times as `'YYYY-MM-DD HH:MM:SS'` strings rather than `Date` objects, so
// the driver's session timezone can never shift a stored slot.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import type { PoolConnection } from "mariadb";

import { execute, query, queryOne, withTransaction } from "./db";
import {
  BLOCKING_STATUSES,
  BOOKINGS_PAGE_SIZE,
  DEFAULT_SETTINGS,
  MSG_DUPLICATE_TABLE_NAME,
  MSG_SLOT_NOT_AVAILABLE,
  MSG_TABLE_JUST_BOOKED,
  MSG_TABLE_NOT_FOUND,
  RELEASING_STATUSES,
  computeAvailability,
  dayOfWeekForDate,
  daysBetween,
  formatClock,
  formatSlotLabel,
  isBlockingStatus,
  isBookingStatus,
  normalisePhone,
  normaliseTableGroupInput,
  orderTables,
  parseClock,
  parseSlotLabel,
  pickAutoTable,
  pickAutoTables,
  resolveSettings,
  tenantNow,
  windowsOverlap,
  type AvailabilityClosureInput,
  type BookingStatus,
  type DayHours,
  type DiningTable,
  type ExistingBooking,
  type ServiceSettings,
  type TableState,
} from "./restaurant-availability";

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

/** A stored `RestaurantSettings` row, mapped onto the pure shape. */
export interface StoredSettings extends ServiceSettings {
  id: string;
  tenantId: string;
}

/** A stored `RestaurantHours` row, mapped onto the pure shape. */
export interface StoredHours extends DayHours {
  id: string;
  tenantId: string;
}

/** Options for `listTables`. */
export interface ListTablesOptions {
  /**
   * `undefined` = every Location of the tenant. `null` = the Primary_Location
   * (`locationId IS NULL`), which is how Req 11.4 / 11.5 is represented.
   */
  locationId?: string | null;
  /** Default false — only `active` Dining_Tables are returned. */
  includeInactive?: boolean;
}

/** A stored (id, name) pair, the shape `validateTableInput` wants. */
export interface StoredTableName {
  id: string;
  name: string;
}

/** Fields a Dining_Table write persists. */
export interface TableWriteInput {
  name: string;
  seatCapacity: number;
  area: string;
  displayOrder: number;
  state?: TableState;
  locationId?: string | null;
}

/** Every Dining_Table write reports success or a message, never both. */
export type TableWriteResult = { ok: true; table: DiningTable } | { ok: false; message: string };

/** Deletes and state changes report only whether the row was matched. */
export type RowWriteResult = { ok: true } | { ok: false; message: string };

/** One Bookings List row (Req 9.1). */
export interface BookingRow {
  id: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  partySize: number | null;
  /** Booking date, `YYYY-MM-DD`. */
  date: string;
  /** Booking_Slot label as stored in `timeSlot`, e.g. `07:30 PM`. */
  slotLabel: string;
  /** Booking_Slot start, minutes since midnight. */
  startMinutes: number;
  /** The Turn_Time snapshot taken at creation (Req 7.1, 4.12). */
  turnTimeMinutes: number | null;
  tableId: string | null;
  /** The Table_Name recorded at booking time — survives deletion (Req 3.12). */
  tableName: string;
  /** The Table_Area of the referenced Dining_Table, null once it is deleted. */
  area: string | null;
  status: string;
  tokenNo: number | null;
  specialRequests: string;
  locationId: string | null;
  patientId: string | null;
  /**
   * The Booking_Group this row belongs to. Equal to `id` for a single-table
   * booking, so grouping logic needs no special case (Req 9.1).
   */
  bookingGroupId: string;
  /**
   * The other Dining_Tables of the same Booking_Group, in canonical order.
   * Populated only by the grouped Bookings List read; empty elsewhere.
   */
  groupTables: AssignedTable[];
}

/** Bookings List criteria (Req 9.2, 9.3). Absent fields do not filter. */
export interface BookingFilters {
  /** Inclusive lower bound of the booking date range, `YYYY-MM-DD`. */
  dateFrom?: string | null;
  /** Inclusive upper bound of the booking date range, `YYYY-MM-DD`. */
  dateTo?: string | null;
  /** Booking_Status values to include. */
  statuses?: readonly string[] | null;
  /** Table_Area of the referenced Dining_Table, compared case-insensitively. */
  area?: string | null;
  tableId?: string | null;
  /** Substring search on the Guest name. */
  guestName?: string | null;
  /** Substring search on the Normalised_Phone of the Guest phone. */
  guestPhone?: string | null;
  /** `undefined` = every Location. `null` = the Primary_Location. */
  locationId?: string | null;
}

/** One page of the Bookings List (Req 9.12). */
export interface BookingPage {
  rows: BookingRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** One Guests tab row (Req 10.3). */
export interface GuestRow {
  id: string;
  guestNo: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  address?: string | null;
  bookingCount: number;
  lastBookingDate: string | null;
  noShowCount: number;
}

/** A booking creation request, already validated by the pure layer. */
export interface CreateBookingRequest {
  guestName: string;
  phone: string;
  email?: string;
  partySize: number;
  /** Booking date, `YYYY-MM-DD`. */
  date: string;
  /** Booking_Slot start, minutes since midnight. */
  slotStartMinutes: number;
  /**
   * The requested Table_Group. An empty list is `Any available table`, resolved
   * under the transaction lock.
   */
  tableIds: string[];
  specialRequests?: string;
  /** Branch, or null for the Primary_Location. */
  locationId?: string | null;
  /** `Pending` for the public path, `Seated` for a walk-in (Req 9.7). */
  status?: BookingStatus;
  /** Injected instant; defaults to now. Kept injectable for tests. */
  now?: Date;
}

/** One Dining_Table of an assigned Table_Group. */
export interface AssignedTable {
  id: string;
  name: string;
}

/** What an accepted creation returns (Req 7.9). */
export interface CreateBookingSuccess {
  ok: true;
  /** The Booking_Group id — one value shared by every row of the reservation. */
  bookingId: string;
  tokenNo: number;
  /** The assigned Table_Group, in canonical order; never empty. */
  tables: AssignedTable[];
  /** The Table_Group rendered for display, e.g. `T1 + T2`. */
  tableName: string;
  slotLabel: string;
  startMinutes: number;
  date: string;
  partySize: number;
  status: BookingStatus;
  turnTimeMinutes: number;
  patientId: string;
}

export type CreateBookingResult = CreateBookingSuccess | { ok: false; message: string };

/** What an accepted reassignment returns (Req 9.6). */
export interface ReassignSuccess {
  ok: true;
  bookingId: string;
  tableId: string;
  tableName: string;
}

export type ReassignResult = ReassignSuccess | { ok: false; message: string };

/** Req 11.2 — a booking of another tenant is reported as not found. */
export const MSG_BOOKING_NOT_FOUND = "Booking not found";
/** The six permitted Booking_Status values are the only accepted input. */
export const MSG_INVALID_STATUS = "Unknown booking status";

// ─────────────────────────────────────────────────────────────────────────────
// Status predicates — generated from the pure tuples, never hand-written
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKING_STATUS_LIST: string[] = [...BLOCKING_STATUSES];
const RELEASING_STATUS_LIST: string[] = [...RELEASING_STATUSES];

/** `?, ?, ?` sized to a status list. */
function placeholders(count: number): string {
  return new Array(Math.max(0, count)).fill("?").join(", ");
}

/** `<alias>status IN (?, ?, ?, ?)` for the Blocking_Statuses. */
function blockingStatusSql(alias = ""): string {
  return `${alias}status IN (${placeholders(BLOCKING_STATUS_LIST.length)})`;
}

/** `<alias>status IN (?, ?)` for the Releasing_Statuses. */
function releasingStatusSql(alias = ""): string {
  return `${alias}status IN (${placeholders(RELEASING_STATUS_LIST.length)})`;
}

/** `No Show`, taken from the exported tuple so a rename cannot go unnoticed. */
const NO_SHOW_STATUS: BookingStatus = RELEASING_STATUSES.find((s) => s === "No Show") ?? "No Show";

/**
 * The `status IN (...)` fragment and its parameters for an arbitrary status
 * list, used by the Bookings List status filter.
 */
function statusFilter(statuses: readonly string[], alias = ""): { sql: string; params: string[] } {
  const known = statuses.filter((s) => isBookingStatus(s));
  return { sql: `${alias}status IN (${placeholders(known.length)})`, params: known };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small mapping helpers
// ─────────────────────────────────────────────────────────────────────────────

/** MariaDB returns `COUNT(*)` as a BigInt, so every numeric read goes through this. */
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ""): string {
  return v === null || v === undefined ? fallback : String(v);
}

function newId(): string {
  return crypto.randomUUID();
}

/** `YYYY-MM-DD HH:MM:SS` wall time, the form `Appointment.dateTime` stores. */
function sqlDateTime(dateStr: string, minutesOfDay: number): string {
  return `${dateStr} ${formatClock(minutesOfDay)}:00`;
}

/**
 * Normalises a tenant-local wall-time instant into the comparable
 * `YYYY-MM-DD HH:MM:SS` form. Accepts what callers already hold: a `Date`, a
 * SQL date-time string, or an ISO string.
 */
function toSqlDateTime(value: string | Date): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
      `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
    );
  }
  const raw = String(value).trim();
  const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/.exec(raw);
  if (iso) return `${iso[1]} ${iso[2]}:${iso[3] ?? "00"}`;
  return raw;
}

/** Maps a `RestaurantTable` row onto the pure `DiningTable` shape. */
function mapTable(row: any): DiningTable {
  return {
    id: str(row.id),
    name: str(row.name),
    seatCapacity: num(row.seatCapacity),
    area: str(row.area),
    displayOrder: num(row.displayOrder, 1),
    state: row.state === "inactive" ? "inactive" : "active",
    locationId:
      row.locationId === null || row.locationId === undefined ? null : String(row.locationId),
  };
}

/**
 * The Booking_Slot start of a stored booking. `timeSlot` holds the canonical
 * label; the `dateTime` clock is the fallback for a row written without one.
 */
function startMinutesOf(row: any): number {
  const fromLabel = parseSlotLabel(str(row.timeSlot));
  if (fromLabel !== null) return fromLabel;
  const fromClock = parseClock(str(row.startClock));
  return fromClock === null ? 0 : fromClock;
}

/** Maps an `Appointment` row onto the Bookings List shape. */
function mapBooking(row: any): BookingRow {
  const startMinutes = startMinutesOf(row);
  return {
    id: str(row.id),
    guestName: str(row.name),
    guestPhone: str(row.phone),
    guestEmail: str(row.email),
    partySize: row.partySize === null || row.partySize === undefined ? null : num(row.partySize),
    date: str(row.bookingDate),
    slotLabel: str(row.timeSlot) || formatSlotLabel(startMinutes),
    startMinutes,
    turnTimeMinutes:
      row.turnTimeMinutes === null || row.turnTimeMinutes === undefined
        ? null
        : num(row.turnTimeMinutes),
    tableId: row.tableId === null || row.tableId === undefined ? null : String(row.tableId),
    tableName: str(row.tableNameAtBooking) || str(row.currentTableName),
    area: row.area === null || row.area === undefined ? null : String(row.area),
    status: str(row.status),
    tokenNo: row.tokenNo === null || row.tokenNo === undefined ? null : num(row.tokenNo),
    specialRequests: str(row.reason),
    locationId:
      row.locationId === null || row.locationId === undefined ? null : String(row.locationId),
    patientId: row.patientId === null || row.patientId === undefined ? null : String(row.patientId),
    // A row written before the column existed groups as itself.
    bookingGroupId: str(row.bookingGroupId) || str(row.id),
    groupTables: [],
  };
}

/**
 * Collapses the rows of each Booking_Group into one Bookings List entry: the
 * reservation the guest made, not the per-table occupancy rows that implement
 * it. The surviving entry is the group's own row (`id === bookingGroupId`) when
 * present, else the first in read order, so the entry's id is stable across
 * reads. `tableName` becomes the rendered Table_Group and `groupTables` carries
 * every member for the reassignment control (Req 9.1).
 *
 * Input order is preserved, which is what keeps the list's sort intact.
 */
export function groupBookingRows(rows: readonly BookingRow[]): BookingRow[] {
  const byGroup = new Map<string, BookingRow[]>();
  const order: string[] = [];

  for (const row of rows ?? []) {
    const key = row.bookingGroupId || row.id;
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(row);
    else {
      byGroup.set(key, [row]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const bucket = byGroup.get(key) as BookingRow[];
    const primary = bucket.find((r) => r.id === key) ?? (bucket[0] as BookingRow);
    if (bucket.length === 1) return { ...primary, groupTables: tablesOf(bucket) };
    return {
      ...primary,
      tableName: bucket.map((r) => r.tableName).join(" + "),
      groupTables: tablesOf(bucket),
    };
  });
}

function tablesOf(rows: readonly BookingRow[]): AssignedTable[] {
  const tables: AssignedTable[] = [];
  for (const row of rows) {
    if (row.tableId === null) continue;
    if (tables.some((t) => t.id === row.tableId)) continue;
    tables.push({ id: row.tableId, name: row.tableName });
  }
  return tables;
}

/**
 * Restaurant bookings are `Appointment` rows carrying the restaurant columns.
 * The five existing categories leave all four NULL (Req 12.2), so this
 * predicate keeps their rows out of every restaurant read.
 */
function restaurantBookingSql(alias = ""): string {
  return `(${alias}tableId IS NOT NULL OR ${alias}partySize IS NOT NULL)`;
}

/** True for a MariaDB duplicate-key violation. */
function isDuplicateKey(err: any): boolean {
  return err?.code === "ER_DUP_ENTRY" || err?.errno === 1062;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant identity — what a PUBLIC handler needs before doing anything
// restaurant-shaped
// ─────────────────────────────────────────────────────────────────────────────

/** The Business_Profession, business name and plan facts of a tenant. */
export interface TenantProfile {
  tenantId: string;
  /** Business name — `ClinicProfile.clinicName` when set, else the owner's. */
  businessName: string;
  /** Business_Profession as stored on the owner `User` row. */
  profession: string;
  /** Plan facts, so a PUBLIC handler can resolve a tenant-level feature. */
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  subscriptionExpiresAt: string | null;
}

/**
 * The addressed tenant's identity, or null when no owner account exists.
 *
 * A public handler has no session, so this is the only thing standing between an
 * arbitrary `tenantId` in a URL and the restaurant surface: the caller checks
 * `isRestaurantProfession(profile.profession)` before touching a restaurant row.
 * The business name is also what the WhatsApp message needs (Req 8.1).
 */
export async function getTenantProfile(tenantId: string): Promise<TenantProfile | null> {
  const owner = await queryOne<any>(
    `SELECT clinicName, profession, subscriptionPlan, subscriptionStatus, subscriptionExpiresAt
     FROM User WHERE tenantId = ? LIMIT 1`,
    [tenantId],
  );
  if (!owner) return null;

  // `ClinicProfile.clinicName` is the editable display name where one exists,
  // exactly as `getClinicInfoAndSlotsServerFn` resolves it.
  const profile = await queryOne<any>(
    "SELECT clinicName FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
    [tenantId],
  );

  const expiresAt =
    owner.subscriptionExpiresAt instanceof Date
      ? owner.subscriptionExpiresAt.toISOString()
      : owner.subscriptionExpiresAt === null || owner.subscriptionExpiresAt === undefined
        ? null
        : String(owner.subscriptionExpiresAt);

  return {
    tenantId,
    businessName: str(profile?.clinicName) || str(owner.clinicName),
    profession: str(owner.profession),
    subscriptionPlan:
      owner.subscriptionPlan === null || owner.subscriptionPlan === undefined
        ? null
        : String(owner.subscriptionPlan),
    subscriptionStatus:
      owner.subscriptionStatus === null || owner.subscriptionStatus === undefined
        ? null
        : String(owner.subscriptionStatus),
    subscriptionExpiresAt: expiresAt,
  };
}

/** True when the tenant's WhatsApp integration is switched on (Req 8.3). */
export async function isWhatsAppEnabled(tenantId: string): Promise<boolean> {
  try {
    const row = await queryOne<any>(
      "SELECT isEnabled FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1",
      [tenantId],
    );
    return !!row?.isEnabled;
  } catch {
    // The table may not exist on an older deployment — treat as not enabled.
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.1 Service_Settings and Operating_Hours (Req 4.1, 4.2, 4.9, 4.10, 4.12, 11.1)
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_COLUMNS =
  "id, tenantId, slotInterval, turnTime, maxPartySize, advanceBookingWindow, minLeadTime, timezone";

function mapSettings(row: any): StoredSettings {
  // resolveSettings applies the documented default of every absent or unusable
  // field, so a partially written row still yields correct availability (Req 4.9).
  const resolved = resolveSettings({
    slotInterval: num(row.slotInterval, DEFAULT_SETTINGS.slotInterval),
    turnTime: num(row.turnTime, DEFAULT_SETTINGS.turnTime),
    maxPartySize: num(row.maxPartySize, DEFAULT_SETTINGS.maxPartySize),
    advanceBookingWindow: num(row.advanceBookingWindow, DEFAULT_SETTINGS.advanceBookingWindow),
    minLeadTime: num(row.minLeadTime, DEFAULT_SETTINGS.minLeadTime),
    timezone: str(row.timezone, DEFAULT_SETTINGS.timezone),
  });
  return { id: str(row.id), tenantId: str(row.tenantId), ...resolved };
}

/** The stored Service_Settings of a tenant, or null when no row exists. */
export async function getSettings(tenantId: string): Promise<StoredSettings | null> {
  const row = await queryOne<any>(
    `SELECT ${SETTINGS_COLUMNS} FROM RestaurantSettings WHERE tenantId = ? LIMIT 1`,
    [tenantId],
  );
  return row ? mapSettings(row) : null;
}

/**
 * The Service_Settings availability should use: the stored row with per-field
 * defaults applied, or the documented defaults outright when no row exists
 * (Req 4.9).
 */
export async function getResolvedSettings(tenantId: string): Promise<ServiceSettings> {
  const stored = await getSettings(tenantId);
  if (!stored) return { ...DEFAULT_SETTINGS };
  const { id: _id, tenantId: _tenantId, ...settings } = stored;
  return settings;
}

/** Inserts or updates the single Service_Settings row of a tenant (Req 4.10). */
export async function upsertSettings(tenantId: string, s: ServiceSettings): Promise<void> {
  await execute(
    `INSERT INTO RestaurantSettings
       (id, tenantId, slotInterval, turnTime, maxPartySize, advanceBookingWindow, minLeadTime, timezone, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       slotInterval = VALUES(slotInterval),
       turnTime = VALUES(turnTime),
       maxPartySize = VALUES(maxPartySize),
       advanceBookingWindow = VALUES(advanceBookingWindow),
       minLeadTime = VALUES(minLeadTime),
       timezone = VALUES(timezone)`,
    [
      newId(),
      tenantId,
      s.slotInterval,
      s.turnTime,
      s.maxPartySize,
      s.advanceBookingWindow,
      s.minLeadTime,
      s.timezone,
    ],
  );
}

function mapHours(row: any): StoredHours {
  return {
    id: str(row.id),
    tenantId: str(row.tenantId),
    dayOfWeek: num(row.dayOfWeek),
    openTime: str(row.openTime, "00:00"),
    closeTime: str(row.closeTime, "00:00"),
    isClosed: num(row.isClosed) === 1,
  };
}

/** The stored Operating_Hours rows of a tenant — 0 to 7 of them, day ascending. */
export async function getHours(tenantId: string): Promise<StoredHours[]> {
  const rows = await query<any>(
    `SELECT id, tenantId, dayOfWeek, openTime, closeTime, isClosed
     FROM RestaurantHours WHERE tenantId = ? ORDER BY dayOfWeek ASC`,
    [tenantId],
  );
  return rows.map(mapHours);
}

/**
 * The Operating_Hours row of one weekday, or null when the tenant stores none —
 * which the pure layer treats as closed (Req 4.13, 5.4).
 */
export async function getHoursForWeekday(
  tenantId: string,
  dayOfWeek: number,
): Promise<StoredHours | null> {
  const row = await queryOne<any>(
    `SELECT id, tenantId, dayOfWeek, openTime, closeTime, isClosed
     FROM RestaurantHours WHERE tenantId = ? AND dayOfWeek = ? LIMIT 1`,
    [tenantId, dayOfWeek],
  );
  return row ? mapHours(row) : null;
}

/**
 * Replaces all seven Operating_Hours rows of a tenant inside ONE transaction, so
 * a partial save is impossible (Req 4.2). Every statement runs on the
 * transaction's connection.
 */
export async function replaceHours(tenantId: string, days: DayHours[]): Promise<void> {
  await withTransaction(async (conn) => {
    for (const day of days) {
      await conn.query(
        `INSERT INTO RestaurantHours (id, tenantId, dayOfWeek, openTime, closeTime, isClosed, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           openTime = VALUES(openTime),
           closeTime = VALUES(closeTime),
           isClosed = VALUES(isClosed)`,
        [newId(), tenantId, day.dayOfWeek, day.openTime, day.closeTime, day.isClosed ? 1 : 0],
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.2 Table registry (Req 3.1-3.3, 3.8-3.12, 3.14, 3.17, 3.18, 11.1, 11.3-11.5)
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_COLUMNS = "id, tenantId, locationId, name, seatCapacity, area, displayOrder, state";

/**
 * The tenant's Dining_Tables, returned through the pure canonical order
 * (`orderTables`, Req 3.14) so the registry view and the layout agree.
 *
 * `opts.locationId === null` scopes to the Primary_Location (`locationId IS
 * NULL`); omitting it returns every Location of the tenant.
 */
export async function listTables(
  tenantId: string,
  opts: ListTablesOptions = {},
): Promise<DiningTable[]> {
  const clauses = ["tenantId = ?"];
  const params: any[] = [tenantId];

  if (opts.locationId !== undefined) {
    if (opts.locationId === null) clauses.push("locationId IS NULL");
    else {
      clauses.push("locationId = ?");
      params.push(opts.locationId);
    }
  }
  if (!opts.includeInactive) {
    clauses.push("state = ?");
    params.push("active");
  }

  const rows = await query<any>(
    `SELECT ${TABLE_COLUMNS} FROM RestaurantTable WHERE ${clauses.join(" AND ")}`,
    params,
  );
  return orderTables(rows.map(mapTable));
}

/** One Dining_Table of this tenant, or null — a foreign id is not found (Req 11.3). */
export async function getTableById(tenantId: string, tableId: string): Promise<DiningTable | null> {
  const row = await queryOne<any>(
    `SELECT ${TABLE_COLUMNS} FROM RestaurantTable WHERE tenantId = ? AND id = ? LIMIT 1`,
    [tenantId, tableId],
  );
  return row ? mapTable(row) : null;
}

/** The tenant's Dining_Table count across BOTH Table_States (Req 3.18). */
export async function countTables(tenantId: string): Promise<number> {
  const row = await queryOne<any>(
    "SELECT COUNT(*) AS total FROM RestaurantTable WHERE tenantId = ?",
    [tenantId],
  );
  return num(row?.total);
}

/** Every stored (id, Table_Name) pair, the context `validateTableInput` wants. */
export async function listTableNames(tenantId: string): Promise<StoredTableName[]> {
  const rows = await query<any>("SELECT id, name FROM RestaurantTable WHERE tenantId = ?", [
    tenantId,
  ]);
  return rows.map((r) => ({ id: str(r.id), name: str(r.name) }));
}

/**
 * The Dining_Table holding a Table_Name, compared case-insensitively and
 * ignoring surrounding whitespace (Req 3.3). `exceptId` excludes the row being
 * edited, so re-saving a table under its own name is not a duplicate.
 */
export async function findTableByName(
  tenantId: string,
  name: string,
  exceptId?: string | null,
): Promise<DiningTable | null> {
  const clauses = ["tenantId = ?", "LOWER(TRIM(name)) = LOWER(TRIM(?))"];
  const params: any[] = [tenantId, name];
  if (exceptId) {
    clauses.push("id <> ?");
    params.push(exceptId);
  }
  const row = await queryOne<any>(
    `SELECT ${TABLE_COLUMNS} FROM RestaurantTable WHERE ${clauses.join(" AND ")} LIMIT 1`,
    params,
  );
  return row ? mapTable(row) : null;
}

/**
 * The highest Display_Order already used in a Table_Area of this tenant, so the
 * pure validator can default to one greater (Req 3.17). Area comparison is
 * case-insensitive, matching `orderTables`.
 */
export async function highestDisplayOrderInArea(tenantId: string, area: string): Promise<number> {
  const row = await queryOne<any>(
    `SELECT COALESCE(MAX(displayOrder), 0) AS maxOrder
     FROM RestaurantTable WHERE tenantId = ? AND LOWER(TRIM(area)) = LOWER(TRIM(?))`,
    [tenantId, area],
  );
  return num(row?.maxOrder);
}

/** Registers a Dining_Table for this tenant (Req 3.1, 3.2, 3.6, 3.7). */
export async function insertTable(
  tenantId: string,
  input: TableWriteInput,
): Promise<TableWriteResult> {
  const id = newId();
  const state: TableState = input.state === "inactive" ? "inactive" : "active";
  const locationId = input.locationId ?? null;

  try {
    await execute(
      `INSERT INTO RestaurantTable
         (id, tenantId, locationId, name, seatCapacity, area, displayOrder, state, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        tenantId,
        locationId,
        input.name,
        input.seatCapacity,
        input.area,
        input.displayOrder,
        state,
      ],
    );
  } catch (err: any) {
    // uq_resto_table_name is the last line of defence behind the pure duplicate
    // check, and closes the create/create race.
    if (isDuplicateKey(err)) return { ok: false, message: MSG_DUPLICATE_TABLE_NAME };
    throw err;
  }

  return {
    ok: true,
    table: {
      id,
      name: input.name,
      seatCapacity: input.seatCapacity,
      area: input.area,
      displayOrder: input.displayOrder,
      state,
      locationId,
    },
  };
}

/**
 * Updates a Dining_Table of this tenant, retaining its identifier and every
 * referencing Table_Booking (Req 3.8). A foreign or unknown id is not found.
 */
export async function updateTable(
  tenantId: string,
  tableId: string,
  input: TableWriteInput,
): Promise<TableWriteResult> {
  const existing = await getTableById(tenantId, tableId);
  if (!existing) return { ok: false, message: MSG_TABLE_NOT_FOUND };

  const state: TableState = input.state ?? existing.state;
  const locationId =
    input.locationId === undefined ? (existing.locationId ?? null) : input.locationId;

  try {
    await execute(
      `UPDATE RestaurantTable
       SET name = ?, seatCapacity = ?, area = ?, displayOrder = ?, state = ?, locationId = ?
       WHERE tenantId = ? AND id = ?`,
      [
        input.name,
        input.seatCapacity,
        input.area,
        input.displayOrder,
        state,
        locationId,
        tenantId,
        tableId,
      ],
    );
  } catch (err: any) {
    if (isDuplicateKey(err)) return { ok: false, message: MSG_DUPLICATE_TABLE_NAME };
    throw err;
  }

  return {
    ok: true,
    table: {
      id: tableId,
      name: input.name,
      seatCapacity: input.seatCapacity,
      area: input.area,
      displayOrder: input.displayOrder,
      state,
      locationId,
    },
  };
}

/**
 * Sets the Table_State of a Dining_Table, retaining every existing
 * Table_Booking with its Booking_Status unchanged (Req 3.9, 3.13).
 */
export async function setTableState(
  tenantId: string,
  tableId: string,
  state: TableState,
): Promise<RowWriteResult> {
  const existing = await getTableById(tenantId, tableId);
  if (!existing) return { ok: false, message: MSG_TABLE_NOT_FOUND };

  await execute("UPDATE RestaurantTable SET state = ? WHERE tenantId = ? AND id = ?", [
    state === "inactive" ? "inactive" : "active",
    tenantId,
    tableId,
  ]);
  return { ok: true };
}

/**
 * Deletes a Dining_Table of this tenant.
 *
 * Every referencing `Appointment` row is left completely untouched — there is no
 * foreign key and no cascade, and nothing here rewrites `tableId`. Those
 * bookings keep displaying `tableNameAtBooking`, the Table_Name they were booked
 * against (Req 3.12).
 *
 * The upcoming-bookings refusal of Req 3.11 is the caller's check via
 * `hasUpcomingBlockingBookings`; this function performs the delete only.
 */
export async function deleteTable(tenantId: string, tableId: string): Promise<RowWriteResult> {
  const result = await execute("DELETE FROM RestaurantTable WHERE tenantId = ? AND id = ?", [
    tenantId,
    tableId,
  ]);
  if (num(result.affectedRows) === 0) return { ok: false, message: MSG_TABLE_NOT_FOUND };
  return { ok: true };
}

/**
 * True when some Table_Booking of this tenant references the Dining_Table with a
 * Booking_Slot start later than `nowIso` and a Blocking_Status (Req 3.11).
 *
 * `nowIso` is tenant-local wall time, because `Appointment.dateTime` stores wall
 * time on the booking date.
 */
export async function hasUpcomingBlockingBookings(
  tenantId: string,
  tableId: string,
  nowIso: string | Date,
): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT COUNT(*) AS total FROM Appointment
     WHERE tenantId = ? AND tableId = ? AND dateTime > ? AND ${blockingStatusSql()}`,
    [tenantId, tableId, toSqlDateTime(nowIso), ...BLOCKING_STATUS_LIST],
  );
  return num(row?.total) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection-agnostic statement runner
//
// The transactional flows below MUST issue every statement on the connection
// `withTransaction` hands them — a pool-level `query()` inside the callback runs
// OUTSIDE the transaction and silently defeats the `FOR UPDATE` lock. To make
// that impossible to get wrong by accident, every read that is needed both
// inside and outside a transaction is written once against this `SqlRunner`
// abstraction and then invoked with either the pool runner or the transaction's
// connection runner.
//
// A runner also carries whether its reads must be LOCKING reads. Taking the
// `FOR UPDATE` lock on the Dining_Table row is necessary but NOT sufficient: at
// the MariaDB default isolation level (REPEATABLE READ) a transaction answers
// PLAIN reads from the consistent snapshot it opened at its FIRST statement —
// which, for the transaction that had to WAIT for the row lock, predates the
// winner's COMMIT. So the loser would re-check availability against a snapshot in
// which the winner's Appointment row does not exist yet and would happily insert
// a second booking on the same Dining_Table. A locking read (`FOR UPDATE`) is
// exempt from that snapshot: it always sees the latest committed version. Hence
// every in-transaction read whose staleness could change a decision is issued
// through a runner marked `locking`, and the same statement stays a plain,
// non-locking read when it runs on the pool for a read-only caller.
// ─────────────────────────────────────────────────────────────────────────────

type SqlRunner = ((sql: string, params?: any[]) => Promise<any>) & {
  /**
   * True when this runner runs inside a transaction, so its reads must be
   * locking reads to escape the transaction's start-of-transaction snapshot.
   */
  locking?: boolean;
};

/** Runs on a fresh pooled connection — for reads outside any transaction. */
const poolRunner: SqlRunner = (sql, params) => query<any>(sql, params);
// Pool reads are read-only and must never take row locks: a shared reader would
// otherwise block writers for the life of the statement (Req 5.x reads).
poolRunner.locking = false;

/** Runs on the transaction's own connection — the only legal runner inside one. */
function connRunner(conn: PoolConnection): SqlRunner {
  const run: SqlRunner = (sql, params) => conn.query(sql, params);
  run.locking = true;
  return run;
}

/**
 * The `FOR UPDATE` suffix a runner requires — empty for a pool read.
 *
 * Why appending this cannot introduce a deadlock: the locks it takes are on
 * `Appointment` (the availability re-check and the Booking_Token seed) and on
 * `Patient` (the guest number), and they are taken at steps 2 and 4/5 of the
 * fixed lock order, i.e. strictly AFTER step 1 has already locked the
 * `RestaurantTable` row(s) with `ORDER BY id FOR UPDATE`. No new lock is taken
 * before or between the table locks, and the order of the later locks is
 * identical in all three write paths (`createBookingAtomic`,
 * `reassignBookingAtomic`, `setBookingStatus`), so two concurrent transactions
 * still queue on the same first lock — the table row — and the one that wins it
 * runs every subsequent lock unopposed.
 */
function lockingSuffix(run: SqlRunner): string {
  return run.locking ? " FOR UPDATE" : "";
}

/**
 * The transaction options the three write paths share.
 *
 * READ COMMITTED is here for the LOCK FOOTPRINT of the locking reads above, not
 * for what they can see: visibility is already guaranteed by `FOR UPDATE`, so the
 * correctness argument still rests on the Dining_Table lock plus the re-check
 * under it, never on snapshot semantics.
 *
 * Measured on the live server, per configuration, over a concurrent pair on ONE
 * table (A) and four concurrent bookings on four DISTINCT tables of one tenant (B):
 *
 *   plain reads  + REPEATABLE READ : A both accepted (the double booking)   B deadlocks intermittently
 *   locking reads + REPEATABLE READ: A exactly one accepted                 B deadlocks almost every run
 *   locking reads + READ COMMITTED : A exactly one accepted                 B all four accepted, no deadlock
 *
 * The reason is the lock footprint. `EXPLAIN` shows the availability re-check and
 * the token seed read resolve through `Appointment_tenantId_idx`, i.e. a range
 * over the WHOLE tenant. At REPEATABLE READ a locking read over that range takes
 * next-key (gap) locks covering the empty stretch where every concurrent booking
 * of that tenant must insert. Two bookings on DIFFERENT Dining_Tables share no
 * lock at step 1 (different `RestaurantTable` rows), so both reach step 2, both
 * take that same gap, and then each one's INSERT waits on the other's gap lock —
 * `ER_LOCK_DEADLOCK`. At READ COMMITTED InnoDB takes no gap locks for these
 * reads, so the re-check still sees the winner's committed row (that is the
 * `FOR UPDATE`), while a booking on another table is not blocked at all.
 *
 * The level is set for THIS transaction only (`SET TRANSACTION ISOLATION LEVEL
 * ...` with no scope keyword), so it reverts when the transaction ends and a
 * pooled connection cannot carry it to the next borrower.
 */
const BOOKING_TX_OPTIONS = { isolationLevel: "READ COMMITTED" } as const;

/** True for an InnoDB deadlock rollback (`ER_LOCK_DEADLOCK`). */
function isDeadlock(err: any): boolean {
  return err?.code === "ER_LOCK_DEADLOCK" || err?.errno === 1213;
}

/**
 * Runs one write path as a booking transaction: READ COMMITTED, and restarted
 * from the top if the engine picks it as a deadlock victim.
 *
 * The retry is not a substitute for the lock order — it is the remedy for the one
 * contention point the lock order cannot serialise. Every booking of a tenant and
 * date increments the SAME `RestaurantTokenCounter` row through `INSERT ... ON
 * DUPLICATE KEY UPDATE`, and when that row does not exist yet, three or more
 * concurrent inserts of the same key queue on a shared lock for the duplicate
 * check and then each need it exclusively — InnoDB resolves that by rolling one
 * of them back. It is measurable on this schema with four concurrent bookings on
 * four DIFFERENT Dining_Tables of one tenant, and it predates the locking reads
 * added above: the plain-read version deadlocks there too, just less often.
 *
 * A deadlock victim's transaction is rolled back whole, so nothing it wrote
 * survives — no Appointment row, no Booking_Token, no Guest record — and running
 * the callback again on a fresh transaction is therefore equivalent to having
 * arrived slightly later. That is exactly what MySQL's own advice ("try
 * restarting transaction") means, and it keeps a rejection message the caller can
 * act on out of a purely internal scheduling event. Attempts are bounded: after
 * the last one the error propagates rather than looping.
 */
async function withBookingTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const attempts = 4;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withTransaction(fn, BOOKING_TX_OPTIONS);
    } catch (err: any) {
      if (!isDeadlock(err) || attempt >= attempts) throw err;
      // Back off a little, and by a different amount per attempt, so two victims
      // do not retry in lockstep straight back into each other.
      await new Promise((resolve) =>
        setTimeout(resolve, 10 * attempt + Math.floor(Math.random() * 15)),
      );
    }
  }
}

/** A SELECT through a runner, normalised to a plain array. */
async function selectRows(run: SqlRunner, sql: string, params: any[] = []): Promise<any[]> {
  const result = await run(sql, params);
  return Array.isArray(result) ? result : [];
}

/** The first row of a SELECT through a runner, or null. */
async function selectOne(run: SqlRunner, sql: string, params: any[] = []): Promise<any | null> {
  const rows = await selectRows(run, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.3 Booking and guest reads (Req 9.1-9.3, 9.12, 10.3, 11.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The columns every restaurant booking read projects.
 *
 * `bookingDate` and `startClock` are derived in SQL rather than mapped from a
 * `Date`, so the driver's session timezone can never shift a stored slot:
 * `Appointment.dateTime` holds wall time on the booking date and is read back as
 * exactly that. `t.name` is the CURRENT Table_Name and is only a fallback —
 * `tableNameAtBooking` is what a booking displays, which is why a deleted
 * Dining_Table's bookings keep their name (Req 3.12).
 */
const BOOKING_COLUMNS = `
  a.id, a.name, a.phone, a.email, a.status, a.tokenNo, a.reason, a.timeSlot,
  a.tableId, a.partySize, a.turnTimeMinutes, a.tableNameAtBooking,
  a.locationId, a.patientId, a.bookingGroupId,
  DATE_FORMAT(a.dateTime, '%Y-%m-%d') AS bookingDate,
  DATE_FORMAT(a.dateTime, '%H:%i') AS startClock,
  t.name AS currentTableName,
  t.area AS area`;

/**
 * The join every restaurant booking read uses. The Dining_Table join carries
 * `tenantId` in its own ON clause as well, so a Table_Area filter can never
 * reach across tenants (Req 11.1, 11.2).
 */
const BOOKING_FROM = `
  FROM Appointment a
  LEFT JOIN RestaurantTable t ON t.id = a.tableId AND t.tenantId = a.tenantId`;

/**
 * Normalises a stored phone value the same way `normalisePhone` does, in SQL, so
 * a phone search matches regardless of the formatting it was typed with
 * (Req 10.5). Kept in one place so the two spellings cannot drift.
 */
function normalisedPhoneSql(column: string): string {
  return `REPLACE(REPLACE(REPLACE(REPLACE(${column}, ' ', ''), '-', ''), '(', ''), ')', '')`;
}

/**
 * A `%value%` substring pattern with the LIKE metacharacters escaped, so a
 * search term containing `%` or `_` matches those characters literally instead of
 * widening the result set.
 */
function likeContains(raw: string): string {
  const escaped = String(raw ?? "")
    .trim()
    .replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

/** Options for a blocking-bookings read. */
interface BlockingBookingOptions {
  /** Restrict to these Dining_Tables; omitted / empty = every table of the date. */
  tableIds?: readonly string[] | null;
  /**
   * The Turn_Time to attribute to a row that stores no snapshot. Availability
   * always prefers a booking's OWN snapshot (Req 4.12, 7.1); this only covers a
   * row written before the column existed.
   */
  fallbackTurnTime?: number;
  /** Exclude one booking — the row being reassigned must not block itself. */
  excludeBookingId?: string | null;
}

/**
 * The Blocking_Status bookings of a tenant on one date, in the pure
 * `ExistingBooking` shape.
 *
 * Written against a `SqlRunner` so `createBookingAtomic` can issue the very same
 * read on the transaction's connection, under the `FOR UPDATE` lock.
 */
async function selectBlockingBookings(
  run: SqlRunner,
  tenantId: string,
  date: string,
  opts: BlockingBookingOptions = {},
): Promise<ExistingBooking[]> {
  const ids = (opts.tableIds ?? []).filter((id) => typeof id === "string" && id.length > 0);

  const clauses = [
    "a.tenantId = ?",
    "DATE(a.dateTime) = ?",
    "a.tableId IS NOT NULL",
    blockingStatusSql("a."),
  ];
  const params: any[] = [tenantId, date, ...BLOCKING_STATUS_LIST];

  if (ids.length > 0) {
    clauses.push(`a.tableId IN (${placeholders(ids.length)})`);
    params.push(...ids);
  }
  if (opts.excludeBookingId) {
    clauses.push("a.id <> ?");
    params.push(opts.excludeBookingId);
  }

  // Inside a transaction this is the availability re-check that Req 7.8 rests on,
  // so it must be a LOCKING read: a plain read would answer from the snapshot the
  // transaction opened before it waited for the Dining_Table lock and would miss
  // the booking the winner just committed. Outside a transaction the very same
  // statement stays a plain read. The lock lands after step 1's `RestaurantTable`
  // lock in every path, so the fixed lock order is unchanged.
  const rows = await selectRows(
    run,
    `SELECT a.id, a.tableId, a.timeSlot, a.status, a.partySize, a.turnTimeMinutes,
            DATE_FORMAT(a.dateTime, '%H:%i') AS startClock
     FROM Appointment a
     WHERE ${clauses.join(" AND ")}${lockingSuffix(run)}`,
    params,
  );

  const fallbackTurnTime = num(opts.fallbackTurnTime, DEFAULT_SETTINGS.turnTime);
  return rows.map((row) => ({
    id: str(row.id),
    tableId: str(row.tableId),
    startMinutes: startMinutesOf(row),
    turnTimeMinutes: num(row.turnTimeMinutes, fallbackTurnTime),
    status: str(row.status),
    partySize:
      row.partySize === null || row.partySize === undefined ? undefined : num(row.partySize),
  }));
}

/**
 * The Blocking_Status bookings of a tenant on `date` for the given
 * Dining_Tables, in the pure `ExistingBooking` shape — the `bookings` half of
 * the `computeAvailability` snapshot.
 *
 * The Booking_Slot start comes from the canonical `timeSlot` label, falling back
 * to the `dateTime` clock for a row written without one. Each row carries its
 * OWN stored `turnTimeMinutes`, never the current setting, so changing Turn_Time
 * later cannot move an existing occupancy (Req 4.12, 7.1).
 *
 * An empty or omitted `tableIds` means every Dining_Table of that date.
 */
export async function listBlockingBookings(
  tenantId: string,
  date: string,
  tableIds?: readonly string[] | null,
  fallbackTurnTime?: number,
): Promise<ExistingBooking[]> {
  return selectBlockingBookings(poolRunner, tenantId, date, { tableIds, fallbackTurnTime });
}

/** Builds the shared WHERE fragment of the Bookings List (Req 9.2, 9.3). */
function bookingFilterSql(
  tenantId: string,
  filters: BookingFilters,
): { sql: string; params: any[] } {
  // Restaurant bookings are Appointment rows carrying the restaurant columns;
  // the five existing categories leave all four NULL (Req 12.2).
  const clauses = ["a.tenantId = ?", restaurantBookingSql("a.")];
  const params: any[] = [tenantId];

  if (filters.dateFrom) {
    clauses.push("DATE(a.dateTime) >= ?");
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    clauses.push("DATE(a.dateTime) <= ?");
    params.push(filters.dateTo);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    // Generated from the pure tuples — unknown values are dropped rather than
    // widening the result set.
    const { sql, params: statusParams } = statusFilter(filters.statuses, "a.");
    clauses.push(sql);
    params.push(...statusParams);
  }
  if (filters.area) {
    clauses.push("LOWER(TRIM(t.area)) = LOWER(TRIM(?))");
    params.push(filters.area);
  }
  if (filters.tableId) {
    clauses.push("a.tableId = ?");
    params.push(filters.tableId);
  }
  if (filters.guestName) {
    clauses.push("a.name LIKE ?");
    params.push(likeContains(filters.guestName));
  }
  if (filters.guestPhone) {
    // Both sides normalised, so `98765-43210` finds a stored `98765 43210`.
    clauses.push(`${normalisedPhoneSql("a.phone")} LIKE ?`);
    params.push(likeContains(normalisePhone(filters.guestPhone)));
  }
  if (filters.locationId !== undefined) {
    if (filters.locationId === null) clauses.push("a.locationId IS NULL");
    else {
      clauses.push("a.locationId = ?");
      params.push(filters.locationId);
    }
  }

  return { sql: clauses.join(" AND "), params };
}

/**
 * One page of the Bookings List.
 *
 * Default ordering is booking date DESCENDING, then Booking_Slot start
 * ASCENDING, then Booking_Token ascending (Req 9.12), with the id as a final
 * tie-break so the page boundaries of two identical requests agree. The slot
 * start is taken from `TIME(a.dateTime)` because that is where the slot start is
 * persisted — the `timeSlot` label sorts lexically and would put `10:00 AM`
 * after `07:30 PM`.
 *
 * `BOOKINGS_PAGE_SIZE` rows per page, plus the unpaginated total so the caller
 * can render the pager.
 */
export async function listBookings(
  tenantId: string,
  filters: BookingFilters = {},
  page = 1,
): Promise<BookingPage> {
  const { sql: where, params } = bookingFilterSql(tenantId, filters);
  // A reservation spanning a Table_Group is several rows; the list shows one
  // entry per reservation, so both the total and the page are counted over
  // Booking_Groups. Paging over rows could split a group across a boundary.
  const groupKey = "COALESCE(a.bookingGroupId, a.id)";

  const countRow = await queryOne<any>(
    `SELECT COUNT(DISTINCT ${groupKey}) AS total ${BOOKING_FROM} WHERE ${where}`,
    params,
  );
  const total = num(countRow?.total);

  const pageSize = BOOKINGS_PAGE_SIZE;
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const offset = (safePage - 1) * pageSize;

  // Every row of a Booking_Group shares its date, slot and token, so the
  // aggregates below order groups exactly as Req 9.12 orders rows.
  const groupRows = await query<any>(
    `SELECT ${groupKey} AS groupId ${BOOKING_FROM}
     WHERE ${where}
     GROUP BY groupId
     ORDER BY DATE(MIN(a.dateTime)) DESC, TIME(MIN(a.dateTime)) ASC,
              MIN(a.tokenNo) ASC, MIN(a.id) ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  const groupIds = groupRows.map((r: any) => str(r.groupId)).filter((id: string) => id.length > 0);
  if (groupIds.length === 0) return { rows: [], total, page: safePage, pageSize };

  // Read every member of the page's groups. A row is included because its group
  // matched the filter, so filtering by one table shows that table's whole
  // reservation rather than a partial one.
  // `tableNameAtBooking` precedes the id tie-break so the members of one
  // Booking_Group arrive in a stable, readable order — every row of a group
  // shares its date, slot and token, so this only orders WITHIN a group and
  // leaves the Req 9.12 ordering of the groups themselves untouched.
  const rows = await query<any>(
    `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}
     WHERE a.tenantId = ? AND ${restaurantBookingSql("a.")}
       AND ${groupKey} IN (${placeholders(groupIds.length)})
     ORDER BY DATE(a.dateTime) DESC, TIME(a.dateTime) ASC, a.tokenNo ASC,
              t.area ASC, t.displayOrder ASC, a.tableNameAtBooking ASC, a.id ASC`,
    [tenantId, ...groupIds],
  );

  return { rows: groupBookingRows(rows.map(mapBooking)), total, page: safePage, pageSize };
}

/** One booking of this tenant, or null — a foreign id is not found (Req 11.2). */
export async function getBookingById(
  tenantId: string,
  bookingId: string,
): Promise<BookingRow | null> {
  const row = await queryOne<any>(
    `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}
     WHERE a.tenantId = ? AND a.id = ? AND ${restaurantBookingSql("a.")}
     LIMIT 1`,
    [tenantId, bookingId],
  );
  return row ? mapBooking(row) : null;
}

/**
 * Every Table_Booking of a tenant on one date, Booking_Slot start ascending —
 * the read behind the Calendar view (Req 9.8).
 *
 * Every Booking_Status is returned, not just the Blocking_Statuses, because the
 * calendar shows cancelled and no-show bookings too; a caller that needs
 * occupancy filters on `isBlockingStatus`.
 */
export async function getBookingsForDate(
  tenantId: string,
  date: string,
  opts: { locationId?: string | null } = {},
): Promise<BookingRow[]> {
  const clauses = ["a.tenantId = ?", "DATE(a.dateTime) = ?", restaurantBookingSql("a.")];
  const params: any[] = [tenantId, date];

  if (opts.locationId !== undefined) {
    if (opts.locationId === null) clauses.push("a.locationId IS NULL");
    else {
      clauses.push("a.locationId = ?");
      params.push(opts.locationId);
    }
  }

  const rows = await query<any>(
    `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}
     WHERE ${clauses.join(" AND ")}
     ORDER BY TIME(a.dateTime) ASC, a.tokenNo ASC, a.id ASC`,
    params,
  );
  return rows.map(mapBooking);
}

/**
 * The Guests tab read (Req 10.3): every Guest record of the tenant with its
 * linked Table_Booking count, most recent booking date and `No Show` count.
 *
 * Guests reuse `Patient`, so the join is restricted to `Appointment` rows that
 * carry the restaurant columns — a clinic-era appointment of the same guest
 * never inflates a restaurant booking count (Req 12.2). The `No Show` predicate
 * is bound from the exported status tuple, not spelled out here.
 */
export async function listGuests(tenantId: string): Promise<GuestRow[]> {
  const rows = await query<any>(
    `SELECT p.id, p.patientNo, p.name, p.phone, p.email, p.notes, p.address,
            COUNT(a.id) AS bookingCount,
            MAX(DATE_FORMAT(a.dateTime, '%Y-%m-%d')) AS lastBookingDate,
            SUM(CASE WHEN a.status = ? THEN 1 ELSE 0 END) AS noShowCount
     FROM Patient p
     LEFT JOIN Appointment a
       ON a.patientId = p.id AND a.tenantId = p.tenantId AND ${restaurantBookingSql("a.")}
     WHERE p.tenantId = ?
     GROUP BY p.id, p.patientNo, p.name, p.phone, p.email, p.notes, p.address
     ORDER BY p.name ASC, p.id ASC`,
    [NO_SHOW_STATUS, tenantId],
  );

  return rows.map((row) => ({
    id: str(row.id),
    guestNo: str(row.patientNo),
    name: str(row.name),
    phone: str(row.phone),
    email: row.email ? str(row.email) : null,
    notes: row.notes ? str(row.notes) : null,
    address: row.address ? str(row.address) : null,
    bookingCount: num(row.bookingCount),
    lastBookingDate:
      row.lastBookingDate === null || row.lastBookingDate === undefined
        ? null
        : String(row.lastBookingDate),
    noShowCount: num(row.noShowCount),
  }));
}

/** Creates a new guest in the restaurant guest directory. */
export async function createRestaurantGuest(
  tenantId: string,
  input: {
    name: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    address?: string | null;
  },
): Promise<GuestRow> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Guest name is required");

  const [lastP] = await query<any>(
    "SELECT patientNo FROM Patient WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 1",
    [tenantId],
  );
  let nextNum = 1;
  if (lastP?.patientNo) {
    const m = String(lastP.patientNo).match(/[PG]-(\d+)/i) || String(lastP.patientNo).match(/(\d+)/);
    if (m) nextNum = parseInt(m[1]) + 1;
  }
  const guestNo = `G-${String(nextNum).padStart(3, "0")}`;
  const id = crypto.randomUUID();
  const phone = input.phone ? String(input.phone).trim() : null;
  const email = input.email ? String(input.email).trim() : null;
  const notes = input.notes ? String(input.notes).trim() : null;
  const address = input.address ? String(input.address).trim() : null;

  await execute(
    `INSERT INTO Patient (id, tenantId, patientNo, name, phone, email, notes, address, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [id, tenantId, guestNo, name, phone, email, notes, address],
  );

  return {
    id,
    guestNo,
    name,
    phone: phone ?? "",
    email,
    notes,
    address,
    bookingCount: 0,
    lastBookingDate: null,
    noShowCount: 0,
  };
}

/** Updates guest contact information, notes, or address. */
export async function updateRestaurantGuest(
  tenantId: string,
  input: {
    id: string;
    name?: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    address?: string | null;
  },
): Promise<void> {
  const guestId = String(input.id ?? "").trim();
  if (!guestId) throw new Error("Guest ID is required");

  const existing = await queryOne<any>(
    "SELECT id, name, phone, email, notes, address FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1",
    [guestId, tenantId],
  );
  if (!existing) throw new Error("Guest not found");

  const name = input.name !== undefined ? String(input.name).trim() : str(existing.name);
  if (!name) throw new Error("Guest name cannot be empty");

  const phone = input.phone !== undefined ? (input.phone ? String(input.phone).trim() : null) : existing.phone;
  const email = input.email !== undefined ? (input.email ? String(input.email).trim() : null) : existing.email;
  const notes = input.notes !== undefined ? (input.notes ? String(input.notes).trim() : null) : existing.notes;
  const address = input.address !== undefined ? (input.address ? String(input.address).trim() : null) : existing.address;

  await execute(
    `UPDATE Patient SET name = ?, phone = ?, email = ?, notes = ?, address = ? WHERE id = ? AND tenantId = ?`,
    [name, phone, email, notes, address, guestId, tenantId],
  );
}

/** Deletes a guest record for this tenant while safely decoupling past appointments. */
export async function deleteRestaurantGuest(tenantId: string, guestId: string): Promise<void> {
  const id = String(guestId ?? "").trim();
  if (!id) throw new Error("Guest ID is required");

  const existing = await queryOne<any>(
    "SELECT id FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1",
    [id, tenantId],
  );
  if (!existing) throw new Error("Guest not found");

  await execute("DELETE FROM SoapNote WHERE patientId = ?", [id]);
  await execute("UPDATE Appointment SET patientId = NULL WHERE patientId = ? AND tenantId = ?", [id, tenantId]);
  await execute("DELETE FROM Patient WHERE id = ? AND tenantId = ?", [id, tenantId]);
}

export interface RestaurantOverviewAnalytics {
  metrics: {
    totalBookings: number;
    todayBookings: number;
    upcomingBookings: number;
    completedBookings: number;
    cancelledBookings: number;
    totalGuests: number;
    todayGuests: number;
    upcomingGuests: number;
    activeTablesCount: number;
    totalTablesCount: number;
    totalCapacity: number;
    averagePartySize: number;
  };
  statusBreakdown: Array<{
    status: string;
    count: number;
    guestCount: number;
  }>;
  dailyTrends: Array<{
    date: string;
    label: string;
    bookings: number;
    guests: number;
  }>;
  hourlyRush: Array<{
    hour: string;
    hourNum: number;
    period: string;
    bookings: number;
    guests: number;
  }>;
  areaBreakdown: Array<{
    area: string;
    bookings: number;
    guests: number;
    tableCount: number;
  }>;
  recentBookings: BookingRow[];
}

/**
 * Rich analytics, metrics, trends, and recent bookings for the Restaurant Overview tab.
 */
export async function getRestaurantOverviewAnalytics(
  tenantId: string,
  todayDateStr: string,
  opts: { locationId?: string | null } = {},
): Promise<RestaurantOverviewAnalytics> {
  const clauses = ["a.tenantId = ?", restaurantBookingSql("a.")];
  const params: any[] = [tenantId];

  if (opts.locationId !== undefined) {
    if (opts.locationId === null) clauses.push("a.locationId IS NULL");
    else {
      clauses.push("a.locationId = ?");
      params.push(opts.locationId);
    }
  }

  const where = clauses.join(" AND ");

  // 1. Overall counts & metric stats
  let totalBookings = 0;
  let totalGuests = 0;
  let todayBookings = 0;
  let todayGuests = 0;
  let upcomingBookings = 0;
  let upcomingGuests = 0;
  let completedBookings = 0;
  let cancelledBookings = 0;

  try {
    const summaryRow = await queryOne<any>(
      `SELECT 
        COUNT(DISTINCT COALESCE(a.bookingGroupId, a.id)) AS totalBookings,
        COALESCE(SUM(a.partySize), 0) AS totalGuests,
        COUNT(DISTINCT CASE WHEN DATE(a.dateTime) = ? THEN COALESCE(a.bookingGroupId, a.id) END) AS todayBookings,
        COALESCE(SUM(CASE WHEN DATE(a.dateTime) = ? THEN a.partySize ELSE 0 END), 0) AS todayGuests,
        COUNT(DISTINCT CASE WHEN DATE(a.dateTime) >= ? AND a.status NOT IN ('Cancelled', 'No Show', 'Completed') THEN COALESCE(a.bookingGroupId, a.id) END) AS upcomingBookings,
        COALESCE(SUM(CASE WHEN DATE(a.dateTime) >= ? AND a.status NOT IN ('Cancelled', 'No Show', 'Completed') THEN a.partySize ELSE 0 END), 0) AS upcomingGuests,
        COUNT(DISTINCT CASE WHEN a.status = 'Completed' OR a.status = 'Seated' THEN COALESCE(a.bookingGroupId, a.id) END) AS completedBookings,
        COUNT(DISTINCT CASE WHEN a.status = 'Cancelled' OR a.status = 'No Show' THEN COALESCE(a.bookingGroupId, a.id) END) AS cancelledBookings
       FROM Appointment a
       WHERE ${where}`,
      [todayDateStr, todayDateStr, todayDateStr, todayDateStr, ...params],
    );

    if (summaryRow) {
      totalBookings = num(summaryRow.totalBookings);
      totalGuests = num(summaryRow.totalGuests);
      todayBookings = num(summaryRow.todayBookings);
      todayGuests = num(summaryRow.todayGuests);
      upcomingBookings = num(summaryRow.upcomingBookings);
      upcomingGuests = num(summaryRow.upcomingGuests);
      completedBookings = num(summaryRow.completedBookings);
      cancelledBookings = num(summaryRow.cancelledBookings);
    }
  } catch (err: any) {
    console.error("[Restaurant Overview] summary query failed:", err?.message);
  }

  // 2. Table capacity stats
  let totalTablesCount = 0;
  let activeTablesCount = 0;
  let totalCapacity = 0;

  try {
    const tableClauses = ["tenantId = ?"];
    const tableParams: any[] = [tenantId];
    if (opts.locationId !== undefined) {
      if (opts.locationId === null) tableClauses.push("locationId IS NULL");
      else {
        tableClauses.push("locationId = ?");
        tableParams.push(opts.locationId);
      }
    }
    const tableSummary = await queryOne<any>(
      `SELECT 
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END), 0) AS active,
        COALESCE(SUM(CASE WHEN state = 'active' THEN seatCapacity ELSE 0 END), 0) AS capacity
       FROM RestaurantTable
       WHERE ${tableClauses.join(" AND ")}`,
      tableParams,
    );
    if (tableSummary) {
      totalTablesCount = num(tableSummary.total);
      activeTablesCount = num(tableSummary.active);
      totalCapacity = num(tableSummary.capacity);
    }
  } catch (err: any) {
    console.error("[Restaurant Overview] table summary failed:", err?.message);
  }

  // 3. Status breakdown
  let statusBreakdown: Array<{ status: string; count: number; guestCount: number }> = [];
  try {
    const statusRows = await query<any>(
      `SELECT a.status,
              COUNT(DISTINCT COALESCE(a.bookingGroupId, a.id)) AS count,
              COALESCE(SUM(a.partySize), 0) AS guestCount
       FROM Appointment a
       WHERE ${where}
       GROUP BY a.status
       ORDER BY count DESC`,
      params,
    );
    statusBreakdown = statusRows.map((r: any) => ({
      status: str(r.status),
      count: num(r.count),
      guestCount: num(r.guestCount),
    }));
  } catch (err: any) {
    console.error("[Restaurant Overview] status breakdown failed:", err?.message);
  }

  // 4. Daily trends (past 30 days)
  let dailyTrends: Array<{ date: string; label: string; bookings: number; guests: number }> = [];
  try {
    const trendRows = await query<any>(
      `SELECT DATE_FORMAT(a.dateTime, '%Y-%m-%d') AS bDate,
              COUNT(DISTINCT COALESCE(a.bookingGroupId, a.id)) AS bookings,
              COALESCE(SUM(a.partySize), 0) AS guests
       FROM Appointment a
       WHERE ${where} AND a.dateTime >= DATE_SUB(?, INTERVAL 30 DAY)
       GROUP BY bDate
       ORDER BY bDate ASC`,
      [...params, todayDateStr],
    );
    dailyTrends = trendRows.map((r: any) => {
      const bDate = str(r.bDate);
      const d = new Date(bDate);
      const label = Number.isNaN(d.getTime())
        ? bDate
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return {
        date: bDate,
        label,
        bookings: num(r.bookings),
        guests: num(r.guests),
      };
    });
  } catch (err: any) {
    console.error("[Restaurant Overview] daily trends failed:", err?.message);
  }

  // 5. Hourly rush distribution
  let hourlyRush: Array<{ hour: string; hourNum: number; period: string; bookings: number; guests: number }> = [];
  try {
    const hourRows = await query<any>(
      `SELECT HOUR(a.dateTime) AS bHour,
              COUNT(DISTINCT COALESCE(a.bookingGroupId, a.id)) AS bookings,
              COALESCE(SUM(a.partySize), 0) AS guests
       FROM Appointment a
       WHERE ${where}
       GROUP BY bHour
       ORDER BY bHour ASC`,
      params,
    );
    hourlyRush = hourRows.map((r: any) => {
      const h = num(r.bHour);
      const period =
        h >= 11 && h <= 15
          ? "Lunch Rush"
          : h >= 18 && h <= 22
          ? "Dinner Rush"
          : h >= 7 && h <= 10
          ? "Breakfast / Brunch"
          : "Late Evening";
      const ampm = h >= 12 ? "PM" : "AM";
      const displayHour = h % 12 === 0 ? 12 : h % 12;
      const hourStr = `${displayHour}:00 ${ampm}`;
      return {
        hour: hourStr,
        hourNum: h,
        period,
        bookings: num(r.bookings),
        guests: num(r.guests),
      };
    });
  } catch (err: any) {
    console.error("[Restaurant Overview] hourly rush failed:", err?.message);
  }

  // 6. Area breakdown
  let areaBreakdown: Array<{ area: string; bookings: number; guests: number; tableCount: number }> = [];
  try {
    const areaRows = await query<any>(
      `SELECT 
        COALESCE(NULLIF(TRIM(t.area), ''), 'Main Dining') AS areaName,
        COUNT(DISTINCT COALESCE(a.bookingGroupId, a.id)) AS bookings,
        COALESCE(SUM(a.partySize), 0) AS guests,
        COUNT(DISTINCT t.id) AS tableCount
       FROM RestaurantTable t
       LEFT JOIN Appointment a ON a.tableId = t.id AND a.tenantId = t.tenantId
       WHERE t.tenantId = ?
       GROUP BY areaName
       ORDER BY bookings DESC, tableCount DESC`,
      [tenantId],
    );
    areaBreakdown = areaRows.map((r: any) => ({
      area: str(r.areaName),
      bookings: num(r.bookings),
      guests: num(r.guests),
      tableCount: num(r.tableCount),
    }));
  } catch (err: any) {
    console.error("[Restaurant Overview] area breakdown failed:", err?.message);
  }

  // 7. Recent / Upcoming bookings (up to 8)
  let recentBookings: BookingRow[] = [];
  try {
    const recentRows = await query<any>(
      `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}
       WHERE ${where}
       ORDER BY a.dateTime DESC, a.id DESC
       LIMIT 8`,
      params,
    );
    recentBookings = recentRows.map(mapBooking);
  } catch (err: any) {
    console.error("[Restaurant Overview] recent bookings failed:", err?.message);
  }

  const averagePartySize =
    totalBookings > 0 ? Math.round((totalGuests / totalBookings) * 10) / 10 : 0;

  return {
    metrics: {
      totalBookings,
      todayBookings,
      upcomingBookings,
      completedBookings,
      cancelledBookings,
      totalGuests,
      todayGuests,
      upcomingGuests,
      activeTablesCount,
      totalTablesCount,
      totalCapacity,
      averagePartySize,
    },
    statusBreakdown,
    dailyTrends,
    hourlyRush,
    areaBreakdown,
    recentBookings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot reads shared by the pool path and the transactional path
//
// `createBookingAtomic` must recompute availability from the SAME snapshot the
// public availability endpoint uses, but read on its own locked connection.
// These runner-based reads are how both paths stay literally the same query.
// ─────────────────────────────────────────────────────────────────────────────

/** The resolved Service_Settings of a tenant through an arbitrary runner. */
async function selectResolvedSettings(run: SqlRunner, tenantId: string): Promise<ServiceSettings> {
  const row = await selectOne(
    run,
    `SELECT ${SETTINGS_COLUMNS} FROM RestaurantSettings WHERE tenantId = ? LIMIT 1`,
    [tenantId],
  );
  if (!row) return { ...DEFAULT_SETTINGS };
  const { id: _id, tenantId: _tenantId, ...settings } = mapSettings(row);
  return settings;
}

/** The Operating_Hours row of one weekday through an arbitrary runner. */
async function selectHoursForWeekday(
  run: SqlRunner,
  tenantId: string,
  dayOfWeek: number,
): Promise<StoredHours | null> {
  const row = await selectOne(
    run,
    `SELECT id, tenantId, dayOfWeek, openTime, closeTime, isClosed
     FROM RestaurantHours WHERE tenantId = ? AND dayOfWeek = ? LIMIT 1`,
    [tenantId, dayOfWeek],
  );
  return row ? mapHours(row) : null;
}

/**
 * The Closure_Day snapshot for one tenant, date and Location, in the pure
 * `AvailabilityClosureInput` shape (Req 4.7, 4.8, 11.5, 11.6).
 *
 * A `scopeType = 'restaurant'` row for the date closes every Booking_Slot; each
 * `scopeType = 'table'` row names one Dining_Table removed from availability
 * before the capacity and occupancy rules run. Location is matched null-safely
 * so the Primary_Location (`locationId IS NULL`) and a branch resolve to their
 * own closure rows only (Req 11.6).
 *
 * Written against a `SqlRunner` so `createBookingAtomic` can issue the very same
 * read on the transaction's connection. Inside a transaction it is a LOCKING
 * read — the same reason `selectBlockingBookings` locks — so a closure another
 * transaction has already committed cannot be missed by the pre-wait snapshot,
 * and a newly closed date or table cannot slip past the recheck (Req 4.11). The
 * read lands after step 1's `RestaurantTable` lock in the booking path, so the
 * fixed lock order is unchanged.
 */
async function selectClosureSnapshot(
  run: SqlRunner,
  tenantId: string,
  date: string,
  locationId: string | null,
): Promise<AvailabilityClosureInput> {
  const rows = await selectRows(
    run,
    `SELECT scopeType, tableId FROM RestaurantClosureDay
     WHERE tenantId = ? AND locationId <=> ? AND closureDate = ?${lockingSuffix(run)}`,
    [tenantId, locationId, date],
  );

  let restaurantClosed = false;
  const closedTableIds: string[] = [];
  for (const row of rows) {
    if (str(row.scopeType) === "restaurant") {
      restaurantClosed = true;
    } else if (str(row.scopeType) === "table") {
      const tableId = str(row.tableId);
      if (tableId.length > 0) closedTableIds.push(tableId);
    }
  }
  return { restaurantClosed, closedTableIds };
}

/**
 * The Closure_Day snapshot of a tenant, date and Location read on a pooled
 * connection — the `closures` half of the `computeAvailability` snapshot the
 * public availability read, the public booking path and the walk-in path share.
 */
export async function getClosuresForDate(
  tenantId: string,
  date: string,
  locationId: string | null,
): Promise<AvailabilityClosureInput> {
  return selectClosureSnapshot(poolRunner, tenantId, date, locationId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.4 createBookingAtomic — the double-booking guard
//
// The serialisation point is a row lock on the RestaurantTable row(s), NOT on the
// conflicting bookings: a conflicting Appointment row may not exist yet when the
// check runs, so locking bookings cannot serialise two inserts, while locking the
// table being booked can, because both transactions must take the same lock.
//
// The lock order is FIXED and identical in every transactional flow of this
// module, which is what keeps deadlocks off the table:
//
//   1. SELECT ... FROM RestaurantTable WHERE tenantId = ? AND id IN (...)
//      ORDER BY id FOR UPDATE
//   2. read the date's Blocking_Status bookings on the SAME connection and
//      recompute the Available_Table set with the pure `computeAvailability`
//   3. resolve the Dining_Table (`pickAutoTable` when auto-assigning)
//   4. INSERT ... ON DUPLICATE KEY UPDATE on RestaurantTokenCounter, read back
//   5. link or create the Guest record
//   6. INSERT INTO Appointment
//   7. COMMIT
//
// Isolation level is left at the MariaDB default; the correctness argument rests
// on the explicit FOR UPDATE lock plus the re-check under it, not on snapshot
// semantics.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Step 1 of the lock order. `ORDER BY id` is the whole point: two concurrent
 * auto-assign transactions acquire the candidate locks in the same sequence.
 */
async function lockTables(
  conn: PoolConnection,
  tenantId: string,
  tableIds: readonly string[],
): Promise<DiningTable[]> {
  const ids = tableIds.filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return [];

  const rows = await selectRows(
    connRunner(conn),
    `SELECT ${TABLE_COLUMNS} FROM RestaurantTable
     WHERE tenantId = ? AND id IN (${placeholders(ids.length)})
     ORDER BY id
     FOR UPDATE`,
    [tenantId, ...ids],
  );
  return rows.map(mapTable);
}

/**
 * The ids `Any available table` may lock: every `active` Dining_Table of the
 * tenant in the requested Location, id ascending so the caller locks them in
 * that order.
 *
 * Seat_Capacity is deliberately not filtered here (Req 5.6, 7.3): a party too
 * large for any single table is seated by a Table_Group, so every active table
 * is a candidate and must be inside the lock before the group is chosen.
 *
 * A table registered after this read is not a candidate of this transaction, so
 * not locking it is correct rather than a gap.
 */
async function selectAutoCandidateIds(
  run: SqlRunner,
  tenantId: string,
  locationId: string | null,
): Promise<string[]> {
  const clauses = ["tenantId = ?", "state = ?"];
  const params: any[] = [tenantId, "active"];

  if (locationId === null) clauses.push("locationId IS NULL");
  else {
    clauses.push("locationId = ?");
    params.push(locationId);
  }

  const rows = await selectRows(
    run,
    `SELECT id FROM RestaurantTable WHERE ${clauses.join(" AND ")} ORDER BY id`,
    params,
  );
  return rows.map((r) => str(r.id)).filter((id) => id.length > 0);
}

/**
 * Step 4 — allocates the Booking_Token for a tenant and date (Req 7.2).
 *
 * The `(tenantId, bookingDate)` primary key makes `INSERT ... ON DUPLICATE KEY
 * UPDATE lastToken = lastToken + 1` a single atomic statement, so two concurrent
 * bookings on the same tenant and date cannot read the same value — no `MAX()`
 * race. The seed is `COALESCE(MAX(tokenNo), 0) + 1` over that tenant and date, so
 * a tenant that already holds bookings (including legacy clinic-era rows)
 * continues its sequence instead of restarting it.
 */
async function nextTokenNo(conn: PoolConnection, tenantId: string, date: string): Promise<number> {
  const run = connRunner(conn);

  // A LOCKING read for the same reason as the availability re-check: a plain
  // `MAX(tokenNo)` would come from the pre-wait snapshot and seed the counter from
  // a value another transaction has already used. Step 4 runs after step 1's
  // table lock, so the lock order still holds.
  const seedRow = await selectOne(
    run,
    `SELECT COALESCE(MAX(tokenNo), 0) + 1 AS seed
     FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = ?${lockingSuffix(run)}`,
    [tenantId, date],
  );
  const seed = Math.max(1, num(seedRow?.seed, 1));

  await conn.query(
    `INSERT INTO RestaurantTokenCounter (tenantId, bookingDate, lastToken)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE lastToken = lastToken + 1`,
    [tenantId, date, seed],
  );

  const row = await selectOne(
    run,
    "SELECT lastToken FROM RestaurantTokenCounter WHERE tenantId = ? AND bookingDate = ? LIMIT 1",
    [tenantId, date],
  );
  return Math.max(1, num(row?.lastToken, seed));
}

/**
 * The next `P-###` guest number of a tenant, read on the transaction's connection.
 *
 * Also a LOCKING read: with a stale snapshot two concurrent transactions both
 * compute `P-001`, and the loser burns all five retry attempts on the same number
 * before surfacing the raw `tenant_patno` duplicate-key error instead of the
 * documented rejection. Step 5 runs after step 1's table lock, so the lock order
 * still holds.
 */
async function nextGuestNo(conn: PoolConnection, tenantId: string): Promise<string> {
  const run = connRunner(conn);
  const row = await selectOne(
    run,
    `SELECT COALESCE(MAX(CAST(SUBSTRING(patientNo, 3) AS UNSIGNED)), 0) AS maxNo
     FROM Patient WHERE tenantId = ? AND patientNo REGEXP '^P-[0-9]+$'${lockingSuffix(run)}`,
    [tenantId],
  );
  return `P-${String(num(row?.maxNo) + 1).padStart(3, "0")}`;
}

/**
 * Links a Table_Booking to a Guest record, creating one when no match exists
 * (Req 10.1, 10.2, 10.4, 10.5, 10.6).
 *
 * Guests reuse `Patient`. Matching is by Normalised_Phone, computed by the pure
 * `normalisePhone` on the submitted value and by the same transformation in SQL
 * on the stored value, so formatting differences never split one guest into two.
 * A phone-less booking matches a phone-less Guest record of the same name
 * instead (Req 10.4).
 *
 * A matched Guest record's stored name is left UNTOUCHED even when the submitted
 * name differs — the submitted name lives on the booking (Req 10.6).
 *
 * A created record stores the Normalised_Phone, so every later match is an exact
 * comparison rather than a comparison of two formattings.
 *
 * Exceptionally for this module, `conn` comes first: this runs only inside the
 * booking transaction, and `tenantId` still constrains every statement.
 */
export async function linkOrCreateGuest(
  conn: PoolConnection,
  tenantId: string,
  name: string,
  phone: string,
): Promise<string> {
  const run = connRunner(conn);
  const guestName = str(name).trim();
  const normalised = normalisePhone(str(phone));

  const existing = normalised
    ? await selectOne(
        run,
        `SELECT id FROM Patient
         WHERE tenantId = ? AND ${normalisedPhoneSql("phone")} = ?
         ORDER BY createdAt ASC LIMIT 1`,
        [tenantId, normalised],
      )
    : await selectOne(
        run,
        `SELECT id FROM Patient
         WHERE tenantId = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))
           AND (phone IS NULL OR TRIM(phone) = '')
         ORDER BY createdAt ASC LIMIT 1`,
        [tenantId, guestName],
      );

  if (existing?.id) return str(existing.id);

  // `tenant_patno` is UNIQUE, so a concurrent creation loses the race on the
  // insert rather than on the read; take the next number and try again. A failed
  // statement does not abort the surrounding transaction in MariaDB.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = newId();
    const guestNo = await nextGuestNo(conn, tenantId);
    try {
      await conn.query(
        `INSERT INTO Patient (id, tenantId, patientNo, name, phone, createdAt)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [id, tenantId, guestNo, guestName, normalised || null],
      );
      return id;
    } catch (err: any) {
      if (!isDuplicateKey(err) || attempt === 4) throw err;
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new Error("Could not allocate a guest number");
}

/**
 * Creates a Table_Booking inside ONE transaction, or creates nothing.
 *
 * Every statement below runs on the connection `withTransaction` supplies. The
 * pool-level `query` / `execute` helpers are deliberately not used anywhere in
 * this callback: they would take a different connection and run outside the
 * transaction, leaving the `FOR UPDATE` lock guarding nothing.
 *
 * Rejections roll back by returning a result the caller reports — nothing is
 * inserted, and the Booking_Token counter is never touched on a rejected path
 * (Req 7.4, 7.11).
 */
export async function createBookingAtomic(
  tenantId: string,
  req: CreateBookingRequest,
): Promise<CreateBookingResult> {
  const status: BookingStatus = isBookingStatus(req.status) ? req.status : "Pending";
  const partySize = num(req.partySize);
  const date = str(req.date);
  const startMinutes = num(req.slotStartMinutes);
  const explicitTableIds = normaliseTableGroupInput(req.tableIds);
  const isAuto = explicitTableIds.length === 0;
  // Req 11.7 — no selected Location means the Primary_Location.
  const scopeLocationId = req.locationId === undefined ? null : req.locationId;

  return withBookingTransaction(async (conn) => {
    const run = connRunner(conn);

    // The snapshot inputs, all read on the transaction's connection.
    const settings = await selectResolvedSettings(run, tenantId);
    const now = tenantNow(settings.timezone, req.now ?? new Date());
    const hours = await selectHoursForWeekday(run, tenantId, dayOfWeekForDate(date));

    // ── Step 1: take the lock, in id order. ──────────────────────────────────
    // Every Dining_Table of the requested Table_Group is locked in one ordered
    // statement, so two concurrent group bookings can never deadlock by taking
    // the same two tables in opposite orders (Req 7.8, 7.11).
    const lockIds = isAuto
      ? await selectAutoCandidateIds(run, tenantId, scopeLocationId)
      : [...explicitTableIds].sort();

    if (lockIds.length === 0) {
      // No `active` Dining_Table at all — nothing can be assigned.
      return { ok: false as const, message: MSG_TABLE_JUST_BOOKED };
    }

    const lockedTables = await lockTables(conn, tenantId, lockIds);
    if (lockedTables.length === 0) {
      return {
        ok: false as const,
        message: isAuto ? MSG_TABLE_JUST_BOOKED : MSG_TABLE_NOT_FOUND,
      };
    }

    // ── Step 2: recompute availability under that lock. ──────────────────────
    const bookings = await selectBlockingBookings(run, tenantId, date, {
      tableIds: lockedTables.map((t) => t.id),
      fallbackTurnTime: settings.turnTime,
    });

    // The Closure_Day snapshot on the SAME connection, so a restaurant or table
    // closure committed while this transaction waited for the table lock closes
    // the date or removes the table here too — a stale availability response
    // cannot pass the recheck (Req 4.7, 4.8, 4.11, 11.5, 11.6).
    const closures = await selectClosureSnapshot(run, tenantId, date, scopeLocationId);

    const availability = computeAvailability({
      settings,
      hours,
      tables: lockedTables,
      bookings,
      closures,
      partySize,
      date,
      nowDateStr: now.dateStr,
      nowMinutes: now.minutesOfDay,
      daysAhead: daysBetween(now.dateStr, date),
    });

    const slot = availability.slots.find((s) => s.startMinutes === startMinutes);
    if (!slot) {
      // Closed, out of window, past the Min_Lead_Time, or simply not a slot of
      // this date — Req 7.7.
      return { ok: false as const, message: MSG_SLOT_NOT_AVAILABLE };
    }

    // ── Step 3: resolve the Table_Group. ─────────────────────────────────────
    let tables: DiningTable[];
    if (!isAuto) {
      const named: DiningTable[] = [];
      for (const id of explicitTableIds) {
        const table = lockedTables.find((t) => t.id === id) ?? null;
        if (!table) return { ok: false as const, message: MSG_TABLE_NOT_FOUND };
        // Req 7.4 — taken between the availability read and this lock. Note
        // Seat_Capacity is NOT checked: a Table_Group may seat more or fewer
        // guests than the party, which is the guest's call (Req 7.5).
        if (!slot.availableTableIds.includes(table.id)) {
          return { ok: false as const, message: MSG_TABLE_JUST_BOOKED };
        }
        named.push(table);
      }
      tables = orderTables(named);
    } else {
      // Req 7.3 — one sufficient table when one exists, else the fewest tables
      // that seat the party.
      const candidates = lockedTables.filter((t) => slot.availableTableIds.includes(t.id));
      tables = pickAutoTables(candidates, partySize);
      if (tables.length === 0) return { ok: false as const, message: MSG_TABLE_JUST_BOOKED };
    }

    // ── Step 4: allocate the Booking_Token. ──────────────────────────────────
    // One Booking_Token for the whole Table_Group: the guest made one booking.
    const tokenNo = await nextTokenNo(conn, tenantId, date);

    // ── Step 5: link or create the Guest record. ─────────────────────────────
    const patientId = await linkOrCreateGuest(conn, tenantId, req.guestName, str(req.phone));

    // ── Step 6: insert one row per Dining_Table of the Table_Group. ───────────
    // Occupancy is still one row per table, so the per-table lock, the
    // availability scan and `idx_apt_table_window` all keep working unchanged.
    // The rows share a `bookingGroupId` — the id of the first row — so the group
    // reads back, displays and changes status as a single reservation.
    const rowIds = tables.map(() => newId());
    const bookingId = rowIds[0] as string;
    const slotLabel = slot.label;
    // Req 7.1 — the Turn_Time in force at creation, snapshotted on the row so a
    // later settings change cannot move this occupancy (Req 4.12).
    const turnTimeMinutes = settings.turnTime;

    for (let index = 0; index < tables.length; index++) {
      const table = tables[index] as DiningTable;
      const locationId = req.locationId === undefined ? (table.locationId ?? null) : req.locationId;

      await conn.query(
        `INSERT INTO Appointment
           (id, tenantId, name, email, phone, dateTime, reason, status, timeSlot, tokenNo,
            patientId, locationId, doctorId, tableId, partySize, turnTimeMinutes,
            tableNameAtBooking, bookingGroupId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NOW())`,
        [
          rowIds[index],
          tenantId,
          str(req.guestName).trim(),
          str(req.email),
          str(req.phone),
          sqlDateTime(date, startMinutes),
          str(req.specialRequests), // `reason` is NOT NULL — blank becomes ''
          status,
          slotLabel,
          tokenNo,
          patientId,
          locationId,
          table.id,
          partySize,
          turnTimeMinutes,
          table.name, // Req 3.12 — survives deletion of the Dining_Table
          bookingId,
        ],
      );
    }

    // ── Step 7: commit happens when this callback resolves. ──────────────────
    return {
      ok: true as const,
      bookingId,
      tokenNo,
      tables: tables.map((t) => ({ id: t.id, name: t.name })),
      tableName: formatTableGroupName(tables),
      slotLabel,
      startMinutes,
      date,
      partySize,
      status,
      turnTimeMinutes,
      patientId,
    };
  });
}

/**
 * Renders a Table_Group for display: the Table_Names in canonical order joined
 * by ` + `, which is what a confirmation, a notification and the dashboard all
 * show for one reservation (Req 7.9, 7.10, 8.2).
 */
export function formatTableGroupName(tables: readonly { name: string }[]): string {
  return (tables ?? []).map((t) => str(t.name)).join(" + ");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.5 reassignBookingAtomic, setBookingStatus and the walk-in entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reassigns a Table_Booking to a different Dining_Table (Req 9.6), applying the
 * Req 7.4 and 7.5 checks to the target table under the SAME lock order
 * `createBookingAtomic` uses — a single `RestaurantTable` row selected `ORDER BY
 * id FOR UPDATE`, then the availability re-check on that same connection.
 *
 * A reassignment moves an EXISTING Occupancy_Window rather than opening a new
 * one, so it does not regenerate the date's Booking_Slots: re-running slot
 * generation would reject moving a booking that is about to start purely because
 * of the Min_Lead_Time. What is re-checked is exactly what Req 7.4 and 7.5 ask
 * for — the target's Seat_Capacity, and whether any Blocking_Status booking of
 * the target overlaps this booking's own window, tested with the pure
 * `windowsOverlap` and each row's own Turn_Time snapshot.
 */
export async function reassignBookingAtomic(
  tenantId: string,
  bookingId: string,
  targetTableId: string,
): Promise<ReassignResult> {
  return withBookingTransaction(async (conn) => {
    const run = connRunner(conn);

    const bookingRow = await selectOne(
      run,
      `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}
       WHERE a.tenantId = ? AND a.id = ? AND ${restaurantBookingSql("a.")}
       LIMIT 1`,
      [tenantId, bookingId],
    );
    if (!bookingRow) return { ok: false as const, message: MSG_BOOKING_NOT_FOUND };

    const booking = mapBooking(bookingRow);
    const settings = await selectResolvedSettings(run, tenantId);
    const partySize = booking.partySize ?? 0;
    const turnTime = booking.turnTimeMinutes ?? settings.turnTime;

    // ── Step 1: the same lock, in the same order. ────────────────────────────
    const [target] = await lockTables(conn, tenantId, [str(targetTableId)]);
    if (!target) return { ok: false as const, message: MSG_TABLE_NOT_FOUND };

    // Req 7.5 — Seat_Capacity does not block a reassignment. Staff may move a
    // party onto a smaller table, exactly as a guest may book one.
    // An `inactive` Dining_Table is not an Available_Table (Req 5.6).
    if (target.state !== "active") {
      return { ok: false as const, message: MSG_TABLE_JUST_BOOKED };
    }

    // ── Step 2: re-check availability under that lock. ───────────────────────
    // The booking being moved must not block itself.
    const others = await selectBlockingBookings(run, tenantId, booking.date, {
      tableIds: [target.id],
      fallbackTurnTime: settings.turnTime,
      excludeBookingId: booking.id,
    });

    const occupied = others.some((b) =>
      windowsOverlap(booking.startMinutes, turnTime, b.startMinutes, b.turnTimeMinutes),
    );
    if (occupied) return { ok: false as const, message: MSG_TABLE_JUST_BOOKED };

    // ── Step 3: persist the new Dining_Table and its Table_Name snapshot. ────
    await conn.query(
      "UPDATE Appointment SET tableId = ?, tableNameAtBooking = ? WHERE tenantId = ? AND id = ?",
      [target.id, target.name, tenantId, booking.id],
    );

    return { ok: true as const, bookingId: booking.id, tableId: target.id, tableName: target.name };
  });
}

/**
 * Sets the Booking_Status of a Table_Booking (Req 9.4).
 *
 * Accepts only the six permitted `BOOKING_STATUSES` values, and only for a row
 * of the requesting tenant — a booking of another tenant is reported as not
 * found (Req 11.2). Changing to a Releasing_Status frees the Dining_Table for
 * that Occupancy_Window automatically (Req 9.5), because every availability read
 * in this module filters on the generated Blocking_Status predicate.
 *
 * The reverse transition is the one that needs a guard. Req 7.8 holds at most
 * one Blocking_Status booking per Dining_Table per overlapping Occupancy_Window
 * at EVERY point in time, so moving a released booking (`Cancelled` / `No Show`)
 * back into a Blocking_Status can only be permitted when the window it would
 * reclaim is still free — another booking may have taken it in the meantime.
 * That re-check runs under the SAME `RestaurantTable` row lock and in the same
 * lock order `createBookingAtomic` and `reassignBookingAtomic` use, and refuses
 * with the same message, so the three write paths cannot disagree.
 *
 * Every other transition (Blocking → Blocking, anything → Releasing) cannot
 * introduce an overlap and is persisted without an availability read.
 *
 * The row is read before the write so an unknown id is distinguishable from a
 * no-op update, whose `affectedRows` is also 0.
 */
export async function setBookingStatus(
  tenantId: string,
  bookingId: string,
  status: string,
): Promise<RowWriteResult> {
  if (!isBookingStatus(status)) return { ok: false, message: MSG_INVALID_STATUS };

  return withBookingTransaction(async (conn) => {
    const run = connRunner(conn);

    const bookingRow = await selectOne(
      run,
      `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}
       WHERE a.tenantId = ? AND a.id = ? AND ${restaurantBookingSql("a.")}
       LIMIT 1`,
      [tenantId, bookingId],
    );
    if (!bookingRow) return { ok: false as const, message: MSG_BOOKING_NOT_FOUND };

    const booking = mapBooking(bookingRow);
    // A Booking_Group is one reservation, so the status moves as a unit: every
    // Dining_Table of the group is released or reinstated together.
    const groupId = booking.bookingGroupId;
    const groupRows = await selectRows(
      run,
      `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}
       WHERE a.tenantId = ? AND COALESCE(a.bookingGroupId, a.id) = ?
         AND ${restaurantBookingSql("a.")}`,
      [tenantId, groupId],
    );
    const groupBookings = groupRows.map(mapBooking);
    const members = groupBookings.length > 0 ? groupBookings : [booking];

    // Only a Releasing_Status → Blocking_Status transition can re-introduce an
    // overlap, and only for members that still reference a Dining_Table.
    if (isBlockingStatus(status) && !isBlockingStatus(booking.status)) {
      const reinstating = members.filter((m) => m.tableId !== null);
      if (reinstating.length > 0) {
        const settings = await selectResolvedSettings(run, tenantId);

        // ── Step 1: the same lock, in the same order. ────────────────────────
        const lockIds = [...new Set(reinstating.map((m) => m.tableId as string))].sort();
        const locked = await lockTables(conn, tenantId, lockIds);
        if (locked.length !== lockIds.length) {
          return { ok: false as const, message: MSG_TABLE_NOT_FOUND };
        }

        // ── Step 2: re-check every window under that lock. The group being
        // reinstated must not block itself. ─────────────────────────────────
        for (const member of reinstating) {
          const turnTime = member.turnTimeMinutes ?? settings.turnTime;
          const others = await selectBlockingBookings(run, tenantId, member.date, {
            tableIds: [member.tableId as string],
            fallbackTurnTime: settings.turnTime,
            excludeBookingId: member.id,
          });
          // No member of this group may block another: they are one reservation
          // at one slot, so their windows coincide by construction.
          const occupied = others.some(
            (b) =>
              !members.some((m) => m.id === b.id) &&
              windowsOverlap(member.startMinutes, turnTime, b.startMinutes, b.turnTimeMinutes),
          );
          if (occupied) return { ok: false as const, message: MSG_TABLE_JUST_BOOKED };
        }
      }
    }

    await conn.query(
      `UPDATE Appointment SET status = ?
       WHERE tenantId = ? AND COALESCE(bookingGroupId, id) = ?`,
      [status, tenantId, groupId],
    );
    return { ok: true as const };
  });
}

/**
 * Creates a walk-in Table_Booking (Req 9.7) — the same transaction, the same lock
 * order and the same validation as the public path, with Booking_Status `Seated`.
 *
 * A status supplied by the caller is ignored on purpose: a walk-in is `Seated` by
 * definition.
 */
export async function createWalkInBooking(
  tenantId: string,
  req: Omit<CreateBookingRequest, "status">,
): Promise<CreateBookingResult> {
  return createBookingAtomic(tenantId, { ...req, status: "Seated" });
}

/** Updates booking parameters such as guest details, party size, notes, status, or table assignment. */
export async function updateBookingAtomic(
  tenantId: string,
  input: {
    bookingId: string;
    guestName?: string;
    phone?: string;
    email?: string;
    partySize?: number;
    specialRequests?: string;
    status?: string;
    tableId?: string;
  },
): Promise<{ ok: boolean; message?: string }> {
  // If status is provided, update via setBookingStatus
  if (input.status) {
    const res = await setBookingStatus(tenantId, input.bookingId, input.status);
    if (!res.ok) return res;
  }
  // If tableId is provided and valid, update via reassignBookingAtomic
  if (input.tableId) {
    const res = await reassignBookingAtomic(tenantId, input.bookingId, input.tableId);
    if (!res.ok) return res;
  }

  // Update remaining guest/booking details on the Appointment rows of this group
  const bookingRow = await queryOne<any>(
    `SELECT a.id, a.bookingGroupId, a.patientId FROM Appointment a
     WHERE a.tenantId = ? AND a.id = ? AND ${restaurantBookingSql("a.")} LIMIT 1`,
    [tenantId, input.bookingId],
  );
  if (!bookingRow) return { ok: false, message: MSG_BOOKING_NOT_FOUND };

  const groupId = bookingRow.bookingGroupId || bookingRow.id;

  const updates: string[] = [];
  const params: any[] = [];

  if (input.guestName !== undefined) {
    updates.push("patientName = ?");
    params.push(input.guestName.trim());
  }
  if (input.phone !== undefined) {
    updates.push("patientPhone = ?");
    params.push(input.phone.trim() || null);
  }
  if (input.email !== undefined) {
    updates.push("patientEmail = ?");
    params.push(input.email.trim() || null);
  }
  if (input.partySize !== undefined) {
    updates.push("partySize = ?");
    params.push(Number(input.partySize));
  }
  if (input.specialRequests !== undefined) {
    updates.push("specialRequests = ?");
    params.push(input.specialRequests.trim() || null);
  }

  if (updates.length > 0) {
    params.push(tenantId, groupId);
    await execute(
      `UPDATE Appointment SET ${updates.join(", ")}
       WHERE tenantId = ? AND COALESCE(bookingGroupId, id) = ?`,
      params,
    );
  }

  // Also update the linked Patient profile if contact details were updated
  if (bookingRow.patientId && (input.guestName || input.phone || input.email !== undefined)) {
    const pUpdates: string[] = [];
    const pParams: any[] = [];
    if (input.guestName) {
      pUpdates.push("name = ?");
      pParams.push(input.guestName.trim());
    }
    if (input.phone) {
      pUpdates.push("phone = ?");
      pParams.push(input.phone.trim());
    }
    if (input.email !== undefined) {
      pUpdates.push("email = ?");
      pParams.push(input.email ? input.email.trim() : null);
    }
    if (pUpdates.length > 0) {
      pParams.push(bookingRow.patientId, tenantId);
      await execute(`UPDATE Patient SET ${pUpdates.join(", ")} WHERE id = ? AND tenantId = ?`, pParams);
    }
  }

  return { ok: true };
}

/** Deletes all Appointment records belonging to a reservation booking group. */
export async function deleteBookingAtomic(
  tenantId: string,
  bookingId: string,
): Promise<{ ok: boolean; message?: string }> {
  const bookingRow = await queryOne<any>(
    `SELECT a.id, a.bookingGroupId FROM Appointment a
     WHERE a.tenantId = ? AND a.id = ? AND ${restaurantBookingSql("a.")} LIMIT 1`,
    [tenantId, bookingId],
  );
  if (!bookingRow) return { ok: false, message: MSG_BOOKING_NOT_FOUND };

  const groupId = bookingRow.bookingGroupId || bookingRow.id;

  await execute(
    `DELETE FROM Appointment WHERE tenantId = ? AND COALESCE(bookingGroupId, id) = ?`,
    [tenantId, groupId],
  );

  return { ok: true };
}

