/**
 * restaurant.integration.test.ts
 *
 * MariaDB integration suite for the Restaurant & Dining category
 * (spec tasks 11.1 and 11.2).
 *
 * These tests talk to a REAL database, so the whole suite sits behind a
 * connection guard: when no database is configured, or the configured one
 * cannot be reached, every `describe` below is skipped and `npm test` stays
 * runnable on a machine with no database at all.
 *
 * Everything the suite creates is namespaced — tenant ids start with
 * `resto-it-`, signup e-mail addresses with `restaurant-it-` — and every row is
 * removed in `afterAll`, so repeated runs are deterministic and no other spec's
 * data is touched. Real restaurant tenants are `resto-` plus six digits, so the
 * `resto-it-` namespace can never collide with one.
 *
 * Assertions compare against the exported message constants
 * (`MSG_TABLE_JUST_BOOKED`, `DEFAULT_SETTINGS`, `TENANT_PREFIX_RESTAURANT`, …),
 * never against retyped literals, so a copy edit cannot silently break a
 * criterion.
 */

import crypto from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * A server function is normally reached over the wire, and its return value is
 * assembled by the client transport. Outside a running server there is no
 * transport, so `createServerFn` is replaced by a double that reproduces exactly
 * what the server side does — run the `.validator`, then run the handler with the
 * narrowed payload — and hands the handler's own return value back. The handler
 * under test is the real one; only the transport is stubbed out.
 */
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const createServerFn = (_options?: unknown) => {
    let validator: any;
    const api: any = {
      validator: (v: any) => {
        validator = v;
        return api;
      },
      inputValidator: (v: any) => {
        validator = v;
        return api;
      },
      middleware: () => api,
      handler: (fn: any) => async (payload?: { data?: unknown }) => {
        const data = validator ? await validator(payload?.data) : payload?.data;
        return fn({ data, context: {} });
      },
    };
    return api;
  };
  return { ...actual, createServerFn };
});

/**
 * The induced-failure switch for the signup-atomicity tests (Req 1.8).
 *
 * `mode` is empty for every other test in this file, and the mock below then
 * delegates straight to the real `withTransaction`, so the concurrency tests run
 * against completely unmodified behaviour.
 *
 *   "ownerInsert"    — the FIRST statement of the transaction throws
 *   "settingsInsert" — the SECOND statement of the transaction throws
 *   "beforeCommit"   — both statements succeed, then the transaction throws
 */
const induced = vi.hoisted(() => ({
  mode: "" as "" | "ownerInsert" | "settingsInsert" | "beforeCommit",
  message: "induced signup failure",
}));

vi.mock("./db", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("./db");

  const withTransaction: typeof actual.withTransaction = async (fn) => {
    const mode = induced.mode;
    if (!mode) return actual.withTransaction(fn);

    return actual.withTransaction(async (conn) => {
      let statements = 0;
      const failAt = mode === "ownerInsert" ? 1 : mode === "settingsInsert" ? 2 : -1;

      // The callback only ever reaches for `conn.query`; everything else is
      // forwarded untouched so the real transaction semantics are preserved.
      const guarded = new Proxy(conn, {
        get(target: any, prop: string | symbol) {
          if (prop === "query") {
            return async (...args: any[]) => {
              statements += 1;
              if (statements === failAt) throw new Error(induced.message);
              return target.query(...args);
            };
          }
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      const result = await fn(guarded);
      if (mode === "beforeCommit") throw new Error(induced.message);
      return result;
    });
  };

  return { ...actual, withTransaction, default: { ...actual.default, withTransaction } };
});

import { execute, pool, query, queryOne } from "./db";
import { signupServerFn } from "./auth";
import {
  DEFAULT_SETTINGS,
  MSG_SLOT_NOT_AVAILABLE,
  MSG_TABLE_JUST_BOOKED,
  PROFESSION_RESTAURANT,
  TENANT_PREFIX_RESTAURANT,
  formatSlotLabel,
  tenantNow,
  tenantPrefixForProfession,
  type DayHours,
} from "./restaurant-availability";
import {
  createBookingAtomic,
  createWalkInBooking,
  getClosuresForDate,
  getSettings,
  insertTable,
  listBookings,
  replaceHours,
  setBookingStatus,
  upsertSettings,
  type CreateBookingRequest,
  type CreateBookingSuccess,
} from "./restaurant.server";
import { getRestaurantAvailabilityServerFn } from "./restaurant";

// ─────────────────────────────────────────────────────────────────────────────
// Connection guard — the whole point of `describe.skipIf`
// ─────────────────────────────────────────────────────────────────────────────

const DB_CONFIGURED = Boolean(
  process.env.DATABASE_URL || process.env.DB_HOST || process.env.DB_NAME || process.env.DB_USER,
);

/** One short-fused probe query. A machine with no database skips, never hangs. */
async function probeDatabase(): Promise<boolean> {
  if (!DB_CONFIGURED) return false;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      query("SELECT 1 AS ok"),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("database probe timed out")), 15000);
      }),
    ]);
    return true;
  } catch (err: any) {
    console.warn(`[restaurant.integration] skipping — no usable database (${err?.message})`);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const DB_AVAILABLE = await probeDatabase();
const describeDb = describe.skipIf(!DB_AVAILABLE);

// ─────────────────────────────────────────────────────────────────────────────
// Namespaced fixtures and cleanup bookkeeping
// ─────────────────────────────────────────────────────────────────────────────

const TENANT_NAMESPACE = `${TENANT_PREFIX_RESTAURANT}it-`;
const EMAIL_NAMESPACE = "restaurant-it-";

/** Tenant ids created by the booking tests, cleaned up in `afterAll`. */
const createdTenants: string[] = [];

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

function newTenantId(): string {
  const tenantId = `${TENANT_NAMESPACE}${shortId()}`;
  createdTenants.push(tenantId);
  return tenantId;
}

function newSignupIdentity(): { email: string; phone: string } {
  const id = shortId();
  return {
    email: `${EMAIL_NAMESPACE}${id}@example.invalid`,
    phone: `55${Date.now()}${id.slice(0, 3)}`,
  };
}

/** Tenant ids a signup attempt was steered onto, cleaned up in `afterAll`. */
const plannedTenantIds: string[] = [];

/** The tenant id `signupServerFn` derives from one `Math.random()` sample. */
function plannedTenantId(sample: number): string {
  return `${TENANT_PREFIX_RESTAURANT}${Math.floor(100000 + sample * 900000)}`;
}

/** A `Math.random()` sample whose tenant id no row currently uses. */
async function reserveTenantId(): Promise<{ sample: number; tenantId: string }> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const sample = Math.random();
    const tenantId = plannedTenantId(sample);
    const user = await queryOne<any>("SELECT id FROM User WHERE tenantId = ? LIMIT 1", [tenantId]);
    const settings = await queryOne<any>(
      "SELECT id FROM RestaurantSettings WHERE tenantId = ? LIMIT 1",
      [tenantId],
    );
    if (!user && !settings) {
      plannedTenantIds.push(tenantId);
      return { sample, tenantId };
    }
  }
  throw new Error("could not reserve an unused tenant id");
}

async function withConnection<T>(fn: (conn: any) => Promise<T>): Promise<T> {
  const conn = await (pool as any).getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Whole-day arithmetic on `YYYY-MM-DD` strings — no implicit timezones. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** All seven weekdays open 10:00 → 23:00, so any generated date has slots. */
function allDaysOpen(): DayHours[] {
  return Array.from({ length: 7 }, (_v, dayOfWeek) => ({
    dayOfWeek,
    openTime: "10:00",
    closeTime: "23:00",
    isClosed: false,
  }));
}

/** 18:00 — comfortably inside 10:00 + n·30 min and at or before 23:00 − 90 min. */
const SLOT_START_MINUTES = 18 * 60;

/** Three days out: inside the Advance_Booking_Window, past any Min_Lead_Time. */
function bookingDate(): string {
  return addDays(tenantNow(DEFAULT_SETTINGS.timezone, new Date()).dateStr, 3);
}

interface Fixture {
  tenantId: string;
  date: string;
  tables: Array<{ id: string; name: string; seatCapacity: number }>;
}

const GUEST_NAME = "Integration Guest";
const GUEST_PHONE = "9998887777";

/**
 * The Guest record every fixture booking links to.
 *
 * It is created up front on purpose: `Patient.tenant_patno` is UNIQUE, so a
 * concurrent pair that both reach the guest step would collide there and hide
 * whichever behaviour the test is actually about. With the Guest already stored,
 * both transactions simply link to it and the assertions speak only about the
 * property under test.
 */
async function seedGuest(tenantId: string): Promise<void> {
  await execute(
    "INSERT INTO Patient (id, tenantId, patientNo, name, phone, createdAt) VALUES (?, ?, 'P-001', ?, ?, NOW())",
    [crypto.randomUUID(), tenantId, GUEST_NAME, GUEST_PHONE],
  );
}

/** A restaurant tenant with default settings, open hours and `count` tables. */
async function createFixture(count: number, seatCapacity = 4): Promise<Fixture> {
  const tenantId = newTenantId();
  await upsertSettings(tenantId, DEFAULT_SETTINGS);
  await replaceHours(tenantId, allDaysOpen());
  await seedGuest(tenantId);

  const tables: Fixture["tables"] = [];
  for (let i = 0; i < count; i += 1) {
    const result = await insertTable(tenantId, {
      name: `IT Table ${i + 1}`,
      seatCapacity,
      area: "Main",
      displayOrder: i + 1,
      state: "active",
      locationId: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) tables.push(result.table);
  }

  return { tenantId, date: bookingDate(), tables };
}

function bookingRequest(
  fixture: Fixture,
  tableId: string | null,
  partySize = 2,
): CreateBookingRequest {
  return {
    guestName: GUEST_NAME,
    phone: GUEST_PHONE,
    email: "guest@example.invalid",
    partySize,
    date: fixture.date,
    slotStartMinutes: SLOT_START_MINUTES,
    tableIds: tableId === null ? [] : [tableId],
    specialRequests: "",
    locationId: null,
  };
}

async function countAppointments(
  tenantId: string,
  date: string,
  tableId?: string,
): Promise<number> {
  const row = await queryOne<any>(
    `SELECT COUNT(*) AS total FROM Appointment
     WHERE tenantId = ? AND DATE(dateTime) = ?${tableId ? " AND tableId = ?" : ""}`,
    tableId ? [tenantId, date, tableId] : [tenantId, date],
  );
  return Number(row?.total ?? 0);
}

async function lastToken(tenantId: string, date: string): Promise<number | null> {
  const row = await queryOne<any>(
    "SELECT lastToken FROM RestaurantTokenCounter WHERE tenantId = ? AND bookingDate = ? LIMIT 1",
    [tenantId, date],
  );
  return row ? Number(row.lastToken) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup — every namespaced row this file creates is removed, so a repeated run
// starts from the same state and no other spec's data is disturbed.
// ─────────────────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (!DB_AVAILABLE) return;
  induced.mode = "";

  const tenantLike = `${TENANT_NAMESPACE}%`;
  await execute("DELETE FROM Appointment WHERE tenantId LIKE ?", [tenantLike]);
  await execute("DELETE FROM Patient WHERE tenantId LIKE ?", [tenantLike]);
  await execute("DELETE FROM RestaurantTable WHERE tenantId LIKE ?", [tenantLike]);
  await execute("DELETE FROM RestaurantHours WHERE tenantId LIKE ?", [tenantLike]);
  await execute("DELETE FROM RestaurantSettings WHERE tenantId LIKE ?", [tenantLike]);
  await execute("DELETE FROM RestaurantTokenCounter WHERE tenantId LIKE ?", [tenantLike]);
  await execute("DELETE FROM RestaurantClosureDay WHERE tenantId LIKE ?", [tenantLike]);

  // Any tenant id a failed signup was steered onto: nothing should exist for it,
  // and if a rollback ever regresses, this keeps the leak from accumulating.
  for (const tenantId of plannedTenantIds) {
    await execute("DELETE FROM RestaurantSettings WHERE tenantId = ?", [tenantId]);
  }

  // Signup fixtures: the owner account plus everything keyed off it.
  const owners = await query<any>("SELECT id, tenantId FROM User WHERE email LIKE ?", [
    `${EMAIL_NAMESPACE}%`,
  ]);
  for (const owner of owners) {
    await execute("DELETE FROM SubscriptionHistory WHERE userId = ?", [owner.id]);
    await execute("DELETE FROM Session WHERE userId = ?", [owner.id]);
    if (owner.tenantId) {
      await execute("DELETE FROM RestaurantSettings WHERE tenantId = ?", [owner.tenantId]);
      await execute("DELETE FROM RestaurantHours WHERE tenantId = ?", [owner.tenantId]);
      await execute("DELETE FROM RestaurantTable WHERE tenantId = ?", [owner.tenantId]);
      await execute("DELETE FROM RestaurantTokenCounter WHERE tenantId = ?", [owner.tenantId]);
      await execute("DELETE FROM Appointment WHERE tenantId = ?", [owner.tenantId]);
      await execute("DELETE FROM Patient WHERE tenantId = ?", [owner.tenantId]);
    }
    await execute("DELETE FROM User WHERE id = ?", [owner.id]);
  }
}, 120_000);

// ─────────────────────────────────────────────────────────────────────────────
// 11.1 — signup atomicity and bootstrap idempotency
// ─────────────────────────────────────────────────────────────────────────────

describeDb("Task 11.1: restaurant signup is all-or-nothing (Req 1.4, 1.5, 1.8)", () => {
  // Feature: restaurant-table-booking, Property 35: For any business name, the Signup_Form accepts it if and only if its trimmed length is 1 through 100 characters, and on rejection reports that the restaurant name must be between 1 and 100 characters while sending no signup request and retaining the entered values; for any sequence of Business_Profession selections, the business name field's label is `Restaurant Name` exactly while `Restaurant and dining` is selected and the entered text is unchanged by any selection change; for any Business_Profession, the assigned `tenantId` prefix is `resto-` for `Restaurant and dining` and its existing prefix for each of the five other professions.
  it("creates the owner account, the resto- tenant id and the default RestaurantSettings row together", async () => {
    const { email, phone } = newSignupIdentity();

    const result: any = await signupServerFn({
      data: {
        name: "Integration Owner",
        phone,
        email,
        clinicName: "Integration Bistro",
        practiceSize: "1-5",
        password: "IntegrationPass123",
        plan: "Basic",
        profession: PROFESSION_RESTAURANT,
      },
    } as any);
    expect(result.success).toBe(true);
    expect(result.userId).toBeTruthy();

    // 1. The owner account exists and stores the profession as given.
    const owner = await queryOne<any>(
      "SELECT id, tenantId, profession, clinicName FROM User WHERE email = ? LIMIT 1",
      [email],
    );
    expect(owner).not.toBeNull();
    expect(owner.profession).toBe(PROFESSION_RESTAURANT);
    expect(owner.clinicName).toBe("Integration Bistro");

    // 2. The tenant id carries the `resto-` prefix the pure rule assigns.
    expect(tenantPrefixForProfession(PROFESSION_RESTAURANT)).toBe(TENANT_PREFIX_RESTAURANT);
    expect(String(owner.tenantId).startsWith(TENANT_PREFIX_RESTAURANT)).toBe(true);

    // 3. The default Service_Settings row was created in the same breath.
    const settings = await getSettings(String(owner.tenantId));
    expect(settings).not.toBeNull();
    expect({
      slotInterval: settings!.slotInterval,
      turnTime: settings!.turnTime,
      maxPartySize: settings!.maxPartySize,
      advanceBookingWindow: settings!.advanceBookingWindow,
      minLeadTime: settings!.minLeadTime,
      timezone: settings!.timezone,
    }).toEqual(DEFAULT_SETTINGS);
  }, 60_000);

  // Feature: restaurant-table-booking, Property 35: For any business name, the Signup_Form accepts it if and only if its trimmed length is 1 through 100 characters, and on rejection reports that the restaurant name must be between 1 and 100 characters while sending no signup request and retaining the entered values; for any sequence of Business_Profession selections, the business name field's label is `Restaurant Name` exactly while `Restaurant and dining` is selected and the entered text is unchanged by any selection change; for any Business_Profession, the assigned `tenantId` prefix is `resto-` for `Restaurant and dining` and its existing prefix for each of the five other professions.
  it("persists none of the three when any one of them fails (Req 1.8)", async () => {
    const modes: Array<typeof induced.mode> = ["ownerInsert", "settingsInsert", "beforeCommit"];

    for (const mode of modes) {
      const { email, phone } = newSignupIdentity();
      // The signup path derives the tenant id from `Math.random()`, so pinning
      // that makes the tenant id known up front — and the assertions can then
      // name the exact rows that must not exist, instead of counting totals that
      // anything else on the database could move.
      const { sample, tenantId } = await reserveTenantId();

      induced.mode = mode;
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(sample);
      let failure: any = null;
      try {
        await signupServerFn({
          data: {
            name: "Integration Owner",
            phone,
            email,
            clinicName: "Integration Bistro",
            practiceSize: "1-5",
            password: "IntegrationPass123",
            plan: "Basic",
            profession: PROFESSION_RESTAURANT,
          },
        } as any);
      } catch (err: any) {
        failure = err;
      } finally {
        randomSpy.mockRestore();
        induced.mode = "";
      }

      // The form is told the signup failed …
      expect(failure).not.toBeNull();
      expect(failure.message).toContain(induced.message);

      // … and none of the three was left behind: no owner account, no tenant
      // assignment, no Service_Settings row.
      expect(
        await queryOne<any>("SELECT id FROM User WHERE email = ? LIMIT 1", [email]),
      ).toBeNull();
      expect(
        await queryOne<any>("SELECT id FROM User WHERE tenantId = ? LIMIT 1", [tenantId]),
      ).toBeNull();
      expect(
        await queryOne<any>("SELECT id FROM RestaurantSettings WHERE tenantId = ? LIMIT 1", [
          tenantId,
        ]),
      ).toBeNull();
    }
  }, 120_000);
});

describeDb("Task 11.1: the task 1.1 bootstrap statements are idempotent", () => {
  /**
   * The statements from the restaurant block of the `src/lib/db.ts` pool
   * initialisation, verbatim: `CREATE TABLE IF NOT EXISTS` per table, the four
   * `Appointment` columns guarded by `SHOW COLUMNS`, and the index in its own
   * swallowed try/catch.
   */
  async function runBootstrap(conn: any): Promise<void> {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS RestaurantTable (
        id            VARCHAR(255) PRIMARY KEY,
        tenantId      VARCHAR(255) NOT NULL,
        locationId    VARCHAR(255) NULL,
        name          VARCHAR(40)  NOT NULL,
        seatCapacity  INT          NOT NULL,
        area          VARCHAR(30)  NOT NULL DEFAULT 'Main',
        displayOrder  INT          NOT NULL DEFAULT 1,
        state         VARCHAR(16)  NOT NULL DEFAULT 'active',
        createdAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_resto_table_name (tenantId, name),
        KEY idx_resto_table_tenant (tenantId, state),
        KEY idx_resto_table_loc (tenantId, locationId)
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS RestaurantSettings (
        id                   VARCHAR(255) PRIMARY KEY,
        tenantId             VARCHAR(255) NOT NULL UNIQUE,
        slotInterval         INT NOT NULL DEFAULT 30,
        turnTime             INT NOT NULL DEFAULT 90,
        maxPartySize         INT NOT NULL DEFAULT 12,
        advanceBookingWindow INT NOT NULL DEFAULT 60,
        minLeadTime          INT NOT NULL DEFAULT 30,
        timezone             VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
        createdAt            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS RestaurantHours (
        id        VARCHAR(255) PRIMARY KEY,
        tenantId  VARCHAR(255) NOT NULL,
        dayOfWeek INT NOT NULL,
        openTime  VARCHAR(5) NOT NULL,
        closeTime VARCHAR(5) NOT NULL,
        isClosed  TINYINT(1) NOT NULL DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_resto_hours (tenantId, dayOfWeek)
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS RestaurantTokenCounter (
        tenantId    VARCHAR(255) NOT NULL,
        bookingDate DATE NOT NULL,
        lastToken   INT NOT NULL DEFAULT 0,
        PRIMARY KEY (tenantId, bookingDate)
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const restoApptCols: any[] = await conn.query("SHOW COLUMNS FROM Appointment");
    const colNames = restoApptCols.map((c: any) => c.Field || c.field || c.ColumnName || "");
    if (!colNames.includes("tableId")) {
      await conn.query("ALTER TABLE Appointment ADD COLUMN tableId VARCHAR(255) NULL");
    }
    if (!colNames.includes("partySize")) {
      await conn.query("ALTER TABLE Appointment ADD COLUMN partySize INT NULL");
    }
    if (!colNames.includes("turnTimeMinutes")) {
      await conn.query("ALTER TABLE Appointment ADD COLUMN turnTimeMinutes INT NULL");
    }
    if (!colNames.includes("tableNameAtBooking")) {
      await conn.query("ALTER TABLE Appointment ADD COLUMN tableNameAtBooking VARCHAR(40) NULL");
    }

    try {
      await conn.query(
        "ALTER TABLE Appointment ADD INDEX idx_apt_table_window (tenantId, tableId, dateTime)",
      );
    } catch (_) {
      /* index already exists */
    }
  }

  const RESTAURANT_TABLES = [
    "RestaurantTable",
    "RestaurantSettings",
    "RestaurantHours",
    "RestaurantTokenCounter",
  ] as const;

  /** Every column and index of everything task 1.1 touches. */
  async function snapshotSchema(): Promise<Record<string, unknown>> {
    const snapshot: Record<string, unknown> = {};

    for (const table of [...RESTAURANT_TABLES, "Appointment"]) {
      const columns = await query<any>(`SHOW COLUMNS FROM ${table}`);
      snapshot[`${table}.columns`] = columns
        .map((c: any) => `${c.Field}:${c.Type}:${c.Null}:${c.Key}`)
        .sort();

      const indexes = await query<any>(`SHOW INDEX FROM ${table}`);
      snapshot[`${table}.indexes`] = indexes
        .map((i: any) => `${i.Key_name}#${i.Seq_in_index}:${i.Column_name}`)
        .sort();
    }

    return snapshot;
  }

  /** One row in each of the five affected tables, all owned by one tenant. */
  async function seedMarkerRows(marker: string): Promise<void> {
    await execute(
      `INSERT INTO RestaurantTable (id, tenantId, locationId, name, seatCapacity, area, displayOrder, state, createdAt)
       VALUES (?, ?, NULL, 'Marker', 4, 'Main', 1, 'active', NOW())`,
      [crypto.randomUUID(), marker],
    );
    await upsertSettings(marker, DEFAULT_SETTINGS);
    await execute(
      `INSERT INTO RestaurantHours (id, tenantId, dayOfWeek, openTime, closeTime, isClosed, createdAt)
       VALUES (?, ?, 1, '10:00', '23:00', 0, NOW())`,
      [crypto.randomUUID(), marker],
    );
    await execute(
      "INSERT INTO RestaurantTokenCounter (tenantId, bookingDate, lastToken) VALUES (?, ?, 1)",
      [marker, bookingDate()],
    );
    await execute(
      `INSERT INTO Appointment (id, tenantId, name, email, phone, dateTime, reason, status, timeSlot, tokenNo, createdAt)
       VALUES (?, ?, 'Marker Guest', '', '', ?, '', 'Pending', '06:00 PM', 1, NOW())`,
      [crypto.randomUUID(), marker, `${bookingDate()} 18:00:00`],
    );
  }

  async function markerRowCounts(marker: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of [...RESTAURANT_TABLES, "Appointment"]) {
      const row = await queryOne<any>(`SELECT COUNT(*) AS total FROM ${table} WHERE tenantId = ?`, [
        marker,
      ]);
      counts[table] = Number(row?.total ?? 0);
    }
    return counts;
  }

  it("runs twice with no error escaping and no duplicated column, index or row", async () => {
    // One marker row per table, so "no row is duplicated" is asserted on rows
    // this test owns rather than on totals another session could move.
    const marker = newTenantId();
    await seedMarkerRows(marker);

    const before = await snapshotSchema();

    await withConnection(runBootstrap);
    await withConnection(runBootstrap);

    const after = await snapshotSchema();
    expect(after).toEqual(before);

    // Every marker row survived exactly once, with its values intact.
    expect(await markerRowCounts(marker)).toEqual({
      RestaurantTable: 1,
      RestaurantSettings: 1,
      RestaurantHours: 1,
      RestaurantTokenCounter: 1,
      Appointment: 1,
    });

    // The four additive Appointment columns exist exactly once each.
    const apptColumns = await query<any>("SHOW COLUMNS FROM Appointment");
    for (const column of ["tableId", "partySize", "turnTimeMinutes", "tableNameAtBooking"]) {
      expect(apptColumns.filter((c: any) => c.Field === column)).toHaveLength(1);
    }

    // The window index exists exactly once, over exactly its three columns.
    const apptIndexes = await query<any>("SHOW INDEX FROM Appointment");
    const windowIndex = apptIndexes
      .filter((i: any) => i.Key_name === "idx_apt_table_window")
      .map((i: any) => `${i.Seq_in_index}:${i.Column_name}`)
      .sort();
    expect(windowIndex).toEqual(["1:tenantId", "2:tableId", "3:dateTime"]);

    // Every restaurant table's own keys are single, not doubled.
    for (const table of RESTAURANT_TABLES) {
      const indexes = await query<any>(`SHOW INDEX FROM ${table}`);
      const seen = indexes.map((i: any) => `${i.Key_name}#${i.Seq_in_index}`);
      expect(new Set(seen).size).toBe(seen.length);
    }
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 11.2 — genuinely concurrent booking transactions and the token counter
// ─────────────────────────────────────────────────────────────────────────────

describeDb("Task 11.2: concurrent createBookingAtomic on one table (Req 7.8, 7.11)", () => {
  // Feature: restaurant-table-booking, Property 4: For any sequence of booking creations, table reassignments, and Booking_Status changes applied to a Restaurant_Tenant, after every step no two Table_Bookings in a Blocking_Status reference the same Dining_Table with overlapping Occupancy_Windows; and for any pair of requests naming the same Dining_Table with overlapping Occupancy_Windows submitted concurrently, exactly one is accepted and the other is rejected with `That table was just booked. Please pick another table or time`.
  it("accepts exactly one of a concurrent pair and leaves exactly one Appointment row", async () => {
    // What this pins down: taking the `FOR UPDATE` lock is not on its own enough.
    // Under the MariaDB default isolation level the transaction that waited for
    // the lock still answers PLAIN reads from the snapshot it opened before the
    // wait, so the availability re-check has to be a read that sees the latest
    // committed rows for this pair to serialise.
    //
    // Three independent rounds, each on its own tenant and table, so the race is
    // exercised more than once without any round seeing another's rows.
    for (let round = 0; round < 3; round += 1) {
      const fixture = await createFixture(1);
      const table = fixture.tables[0];
      const request = bookingRequest(fixture, table.id);

      const [first, second] = await Promise.all([
        createBookingAtomic(fixture.tenantId, request),
        createBookingAtomic(fixture.tenantId, request),
      ]);

      const accepted = [first, second].filter((r) => r.ok) as CreateBookingSuccess[];
      const rejected = [first, second].filter((r) => !r.ok) as Array<{
        ok: false;
        message: string;
      }>;

      expect(accepted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].message).toBe(MSG_TABLE_JUST_BOOKED);

      expect(accepted[0].tables.map((t) => t.id)).toEqual([table.id]);
      expect(accepted[0].slotLabel).toBe(formatSlotLabel(SLOT_START_MINUTES));

      // The committed side is the only row that exists.
      expect(await countAppointments(fixture.tenantId, fixture.date, table.id)).toBe(1);
      expect(await countAppointments(fixture.tenantId, fixture.date)).toBe(1);
    }
  }, 180_000);
});

describeDb("Task 11.2: the RestaurantTokenCounter primary key (Req 7.2)", () => {
  // Feature: restaurant-table-booking, Property 10: For any sequence of accepted Table_Bookings across arbitrary Tenants and dates, including concurrently submitted ones, the Booking_Tokens within a single Tenant and calendar date are pairwise distinct, the first is 1 greater than the largest Booking_Token already assigned for that Tenant and date, and each subsequent one is exactly 1 greater than its predecessor; a rejected request leaves the sequence for that Tenant and date unchanged.
  it("hands out distinct, sequential Booking_Tokens per tenant per date under concurrency", async () => {
    // Four distinct tables, so the four transactions contend only on the counter
    // row — the token property is isolated from the availability race.
    const fixture = await createFixture(4);
    const requests = fixture.tables.map((t) => bookingRequest(fixture, t.id));

    const results = await Promise.all(
      requests.map((request) => createBookingAtomic(fixture.tenantId, request)),
    );

    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    const tokens = (results as CreateBookingSuccess[]).map((r) => r.tokenNo).sort((a, b) => a - b);

    // Pairwise distinct, starting at 1 and each exactly 1 greater than the last.
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens).toEqual([1, 2, 3, 4]);
    expect(await lastToken(fixture.tenantId, fixture.date)).toBe(4);

    // The stored rows carry the same tokens the responses reported.
    const stored = await query<any>(
      "SELECT tokenNo FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = ? ORDER BY tokenNo",
      [fixture.tenantId, fixture.date],
    );
    expect(stored.map((r: any) => Number(r.tokenNo))).toEqual([1, 2, 3, 4]);
  }, 120_000);

  // Feature: restaurant-table-booking, Property 10: For any sequence of accepted Table_Bookings across arbitrary Tenants and dates, including concurrently submitted ones, the Booking_Tokens within a single Tenant and calendar date are pairwise distinct, the first is 1 greater than the largest Booking_Token already assigned for that Tenant and date, and each subsequent one is exactly 1 greater than its predecessor; a rejected request leaves the sequence for that Tenant and date unchanged.
  it("seeds from the existing MAX(tokenNo) instead of restarting the sequence", async () => {
    const fixture = await createFixture(2);

    // A legacy, non-restaurant booking already holds token 7 on this date: all
    // four restaurant columns stay NULL, exactly as the other five categories
    // write their rows.
    await execute(
      `INSERT INTO Appointment (id, tenantId, name, email, phone, dateTime, reason, status, timeSlot, tokenNo, createdAt)
       VALUES (?, ?, ?, '', '', ?, '', 'Pending', '11:00 AM', 7, NOW())`,
      [crypto.randomUUID(), fixture.tenantId, "Legacy Guest", `${fixture.date} 11:00:00`],
    );

    const first = await createBookingAtomic(
      fixture.tenantId,
      bookingRequest(fixture, fixture.tables[0].id),
    );
    expect(first.ok).toBe(true);
    expect((first as CreateBookingSuccess).tokenNo).toBe(8);

    const second = await createBookingAtomic(
      fixture.tenantId,
      bookingRequest(fixture, fixture.tables[1].id),
    );
    expect(second.ok).toBe(true);
    expect((second as CreateBookingSuccess).tokenNo).toBe(9);

    expect(await lastToken(fixture.tenantId, fixture.date)).toBe(9);
  }, 120_000);

  // Feature: restaurant-table-booking, Property 10: For any sequence of accepted Table_Bookings across arbitrary Tenants and dates, including concurrently submitted ones, the Booking_Tokens within a single Tenant and calendar date are pairwise distinct, the first is 1 greater than the largest Booking_Token already assigned for that Tenant and date, and each subsequent one is exactly 1 greater than its predecessor; a rejected request leaves the sequence for that Tenant and date unchanged.
  it("burns no token when the booking is rejected", async () => {
    const fixture = await createFixture(1);
    const request = bookingRequest(fixture, fixture.tables[0].id);

    const accepted = await createBookingAtomic(fixture.tenantId, request);
    expect(accepted.ok).toBe(true);
    const tokenAfterAccept = await lastToken(fixture.tenantId, fixture.date);
    expect(tokenAfterAccept).toBe((accepted as CreateBookingSuccess).tokenNo);

    // The same table and slot again — the availability re-check under the lock
    // rejects it, and the counter must not move.
    const rejected = await createBookingAtomic(fixture.tenantId, request);
    expect(rejected.ok).toBe(false);
    expect((rejected as { ok: false; message: string }).message).toBe(MSG_TABLE_JUST_BOOKED);

    expect(await lastToken(fixture.tenantId, fixture.date)).toBe(tokenAfterAccept);
    expect(await countAppointments(fixture.tenantId, fixture.date)).toBe(1);
  }, 120_000);
});

describeDb("Task 11.2: walk-in and auto-assign share one lock order (Req 9.7)", () => {
  // Feature: restaurant-table-booking, Property 4: For any sequence of booking creations, table reassignments, and Booking_Status changes applied to a Restaurant_Tenant, after every step no two Table_Bookings in a Blocking_Status reference the same Dining_Table with overlapping Occupancy_Windows; and for any pair of requests naming the same Dining_Table with overlapping Occupancy_Windows submitted concurrently, exactly one is accepted and the other is rejected with `That table was just booked. Please pick another table or time`.
  it("raises no deadlock when a walk-in and an auto-assign booking run concurrently", async () => {
    for (let round = 0; round < 3; round += 1) {
      // Several candidate tables, so both transactions lock a multi-row set —
      // which is exactly where a differing lock order would deadlock.
      const fixture = await createFixture(4);
      const request = bookingRequest(fixture, null);

      // The two orders alternate, so neither wins by always starting first.
      const pair =
        round % 2 === 0
          ? [
              createWalkInBooking(fixture.tenantId, request),
              createBookingAtomic(fixture.tenantId, request),
            ]
          : [
              createBookingAtomic(fixture.tenantId, request),
              createWalkInBooking(fixture.tenantId, request),
            ];

      const settled = await Promise.allSettled(pair);

      for (const outcome of settled) {
        // No transaction was rolled back by the engine: a deadlock surfaces as a
        // thrown ER_LOCK_DEADLOCK, never as a returned rejection message.
        if (outcome.status === "rejected") {
          expect(String(outcome.reason?.message ?? outcome.reason)).not.toMatch(/deadlock/i);
        }
        expect(outcome.status).toBe("fulfilled");
      }

      const results = settled
        .filter((o): o is PromiseFulfilledResult<any> => o.status === "fulfilled")
        .map((o) => o.value);

      // Both transactions completed, and the walk-in is the `Seated` one while
      // the public booking is `Pending`. Which Dining_Table each one lands on is
      // the subject of the concurrency property above, not of this one.
      for (const result of results) {
        expect(result.ok).toBe(true);
      }
      const accepted = results as CreateBookingSuccess[];
      expect(accepted.map((r) => r.status).sort()).toEqual(["Pending", "Seated"]);

      const stored = await query<any>(
        "SELECT status FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = ?",
        [fixture.tenantId, fixture.date],
      );
      expect(stored.map((r: any) => String(r.status)).sort()).toEqual(["Pending", "Seated"]);
    }
  }, 180_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.3 — closure-aware availability wiring through the booking recheck
//
// Task 4.2/4.3 feed one Closure_Day snapshot into the SAME pure computation the
// public availability read and the locked booking transaction both use. These
// tests exercise the transactional recheck: a restaurant-scoped closure closes
// the date, a table-scoped closure removes exactly that Dining_Table, and the
// snapshot reader agrees with what the recheck sees. Closure writes never touch
// Appointment rows (Req 3.9, 4.7, 4.8, 11.5, 11.6).
// ─────────────────────────────────────────────────────────────────────────────

/** Inserts a Closure_Day row the way the settings repository does. */
async function insertClosure(
  tenantId: string,
  date: string,
  scope: { type: "restaurant" } | { type: "table"; tableId: string },
  locationId: string | null = null,
): Promise<void> {
  const tableId = scope.type === "table" ? scope.tableId : null;
  const scopeKey = tableId ?? "restaurant";
  await execute(
    `INSERT INTO RestaurantClosureDay
       (id, tenantId, locationId, locationKey, closureDate, scopeType, tableId, scopeKey,
        reason, isHoliday, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 0, NOW())`,
    [
      crypto.randomUUID(),
      tenantId,
      locationId,
      locationId ?? "__primary__",
      date,
      scope.type,
      tableId,
      scopeKey,
    ],
  );
}

describeDb("Task 4.3: closure-aware booking recheck (Req 3.9, 4.7, 4.8, 11.5, 11.6)", () => {
  // Feature: restaurant-dashboard-settings, Property 8: Closure-aware availability
  it("refuses every table on a restaurant-scoped closure and leaves bookings untouched", async () => {
    const fixture = await createFixture(2);
    await insertClosure(fixture.tenantId, fixture.date, { type: "restaurant" });

    // The snapshot reader reports the date closed for the Primary_Location …
    const snapshot = await getClosuresForDate(fixture.tenantId, fixture.date, null);
    expect(snapshot.restaurantClosed).toBe(true);
    expect(snapshot.closedTableIds).toEqual([]);

    // … and the locked recheck refuses the booking: a closed date generates no
    // Booking_Slots, so the requested slot is not available.
    const result = await createBookingAtomic(
      fixture.tenantId,
      bookingRequest(fixture, fixture.tables[0].id),
    );
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toBe(MSG_SLOT_NOT_AVAILABLE);

    // No Appointment row was written on that closed date.
    expect(await countAppointments(fixture.tenantId, fixture.date)).toBe(0);
  }, 60_000);

  // Feature: restaurant-dashboard-settings, Property 8: Closure-aware availability
  it("removes exactly the closed table while an unaffected table still books", async () => {
    const fixture = await createFixture(2);
    const [closedTable, openTable] = fixture.tables;
    await insertClosure(fixture.tenantId, fixture.date, { type: "table", tableId: closedTable.id });

    const snapshot = await getClosuresForDate(fixture.tenantId, fixture.date, null);
    expect(snapshot.restaurantClosed).toBe(false);
    expect(snapshot.closedTableIds).toEqual([closedTable.id]);

    // The closed table is refused under the lock — it is no longer an
    // Available_Table for the slot.
    const refused = await createBookingAtomic(
      fixture.tenantId,
      bookingRequest(fixture, closedTable.id),
    );
    expect(refused.ok).toBe(false);
    expect((refused as { ok: false; message: string }).message).toBe(MSG_TABLE_JUST_BOOKED);

    // The unaffected table is still bookable, proving every other rule survives.
    const accepted = await createBookingAtomic(
      fixture.tenantId,
      bookingRequest(fixture, openTable.id),
    );
    expect(accepted.ok).toBe(true);
    expect(await countAppointments(fixture.tenantId, fixture.date, openTable.id)).toBe(1);
    expect(await countAppointments(fixture.tenantId, fixture.date, closedTable.id)).toBe(0);
  }, 60_000);

  // Feature: restaurant-dashboard-settings, Property 8: Closure-aware availability
  it("scopes closures by effective Location so another scope is unaffected", async () => {
    const fixture = await createFixture(1);

    // A branch-scoped closure must not leak into the Primary_Location snapshot.
    await insertClosure(fixture.tenantId, fixture.date, { type: "restaurant" }, "branch-1");

    const primary = await getClosuresForDate(fixture.tenantId, fixture.date, null);
    expect(primary.restaurantClosed).toBe(false);

    const branch = await getClosuresForDate(fixture.tenantId, fixture.date, "branch-1");
    expect(branch.restaurantClosed).toBe(true);

    // The Primary_Location booking still succeeds despite the branch closure.
    const accepted = await createBookingAtomic(
      fixture.tenantId,
      bookingRequest(fixture, fixture.tables[0].id),
    );
    expect(accepted.ok).toBe(true);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.5 — closure concurrency and endpoint/transaction agreement
//
// Task 4.3 proved the locked recheck honours a closure that already exists. This
// suite goes further and pins the two claims that make closures safe end to end:
//
//   1. The PUBLIC availability endpoint (`getRestaurantAvailabilityServerFn`) and
//      the transactional `createBookingAtomic` recheck read the SAME closure
//      snapshot, so a guest never sees a slot the transaction would then refuse.
//   2. A closure committed WHILE a booking waits for the table lock is caught by
//      the recheck's locking read — a genuinely raced closure, not a pre-existing
//      one — for both a newly closed date and a newly closed table.
//
// And it re-asserts the non-interference guarantee at the row level: writing (and
// removing) closures never rewrites a single field or status of an existing
// Appointment (Req 3.9, 4.7, 4.8, 4.11, 11.5, 11.6).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The public availability endpoint verifies the tenant through its owner `User`
 * row, so a fixture read by the endpoint needs one. The email lands in the
 * `restaurant-it-` namespace, which the `afterAll` owner sweep already cleans up.
 */
async function seedOwner(tenantId: string): Promise<void> {
  const id = shortId();
  await execute(
    `INSERT INTO User (id, tenantId, name, email, phone, clinicName, practiceSize, password,
                       subscriptionStatus, subscriptionPlan, subscriptionExpiresAt, createdAt, updatedAt, profession)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', 'Basic', DATE_ADD(NOW(), INTERVAL 30 DAY), NOW(), NOW(), ?)`,
    [
      crypto.randomUUID(),
      tenantId,
      "IT Availability Owner",
      `${EMAIL_NAMESPACE}${id}@example.invalid`,
      `66${Date.now()}${id.slice(0, 3)}`,
      "Integration Bistro",
      "1-5",
      "not-a-real-hash",
      PROFESSION_RESTAURANT,
    ],
  );
}

/** A fixture whose tenant also owns a restaurant `User`, so the endpoint admits it. */
async function createOwnedFixture(count: number): Promise<Fixture> {
  const fixture = await createFixture(count);
  await seedOwner(fixture.tenantId);
  return fixture;
}

/** Calls the public availability endpoint exactly as the booking client would. */
async function fetchAvailability(
  fixture: Fixture,
  partySize = 2,
  locationId: string | null = null,
): Promise<any> {
  return getRestaurantAvailabilityServerFn({
    data: { tenantId: fixture.tenantId, date: fixture.date, partySize, locationId },
  } as any);
}

/** The endpoint's slot at `SLOT_START_MINUTES`, or null when the date has none. */
function slotAt(availability: any, startMinutes = SLOT_START_MINUTES): any {
  return (availability.slots ?? []).find((s: any) => s.startMinutes === startMinutes) ?? null;
}

/**
 * Every persisted field of one Appointment row, so "a closure rewrites nothing"
 * is asserted on the exact stored bytes rather than on a chosen column.
 */
async function appointmentSnapshot(tenantId: string, bookingId: string): Promise<any> {
  const row = await queryOne<any>(
    `SELECT id, tenantId, name, email, phone,
            DATE_FORMAT(dateTime, '%Y-%m-%d %H:%i:%s') AS dateTime,
            reason, status, timeSlot, tokenNo, patientId, locationId,
            tableId, partySize, turnTimeMinutes, tableNameAtBooking
     FROM Appointment WHERE tenantId = ? AND id = ? LIMIT 1`,
    [tenantId, bookingId],
  );
  // Normalise BigInt/number columns so the equality compares stable primitives.
  return {
    ...row,
    tokenNo: row?.tokenNo === null || row?.tokenNo === undefined ? null : Number(row.tokenNo),
    partySize:
      row?.partySize === null || row?.partySize === undefined ? null : Number(row.partySize),
    turnTimeMinutes:
      row?.turnTimeMinutes === null || row?.turnTimeMinutes === undefined
        ? null
        : Number(row.turnTimeMinutes),
  };
}

describeDb(
  "Task 4.5: endpoint and booking transaction agree on closures (Req 4.7, 4.8, 11.5)",
  () => {
    // Feature: restaurant-dashboard-settings, Property 8: Closure-aware availability
    it("whole-restaurant closure: the endpoint reports closed with no slots and the transaction refuses", async () => {
      const fixture = await createOwnedFixture(2);

      // Before the closure the endpoint offers the slot on every table.
      const before = await fetchAvailability(fixture);
      expect(before.closed).toBe(false);
      expect(slotAt(before)).not.toBeNull();

      await insertClosure(fixture.tenantId, fixture.date, { type: "restaurant" });

      // After it the endpoint reports the date closed and hands back no slots …
      const after = await fetchAvailability(fixture);
      expect(after.closed).toBe(true);
      expect(after.slots).toEqual([]);

      // … and the transactional recheck agrees: no table on that date books.
      const result = await createBookingAtomic(
        fixture.tenantId,
        bookingRequest(fixture, fixture.tables[0].id),
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; message: string }).message).toBe(MSG_SLOT_NOT_AVAILABLE);
      expect(await countAppointments(fixture.tenantId, fixture.date)).toBe(0);
    }, 60_000);

    // Feature: restaurant-dashboard-settings, Property 8: Closure-aware availability
    it("table-scoped closure: the endpoint drops exactly that table while the others stay bookable", async () => {
      const fixture = await createOwnedFixture(3);
      const [closedTable, openA, openB] = fixture.tables;

      const before = await fetchAvailability(fixture);
      const beforeSlot = slotAt(before);
      expect(beforeSlot.availableTableIds).toEqual(
        expect.arrayContaining([closedTable.id, openA.id, openB.id]),
      );

      await insertClosure(fixture.tenantId, fixture.date, {
        type: "table",
        tableId: closedTable.id,
      });

      // The endpoint removes precisely the closed table id and keeps the rest.
      const after = await fetchAvailability(fixture);
      expect(after.closed).toBe(false);
      const afterSlot = slotAt(after);
      expect(afterSlot.availableTableIds).not.toContain(closedTable.id);
      expect(afterSlot.availableTableIds).toEqual(expect.arrayContaining([openA.id, openB.id]));

      // The transaction refuses exactly that table …
      const refused = await createBookingAtomic(
        fixture.tenantId,
        bookingRequest(fixture, closedTable.id),
      );
      expect(refused.ok).toBe(false);
      expect((refused as { ok: false; message: string }).message).toBe(MSG_TABLE_JUST_BOOKED);

      // … and still accepts an unaffected one, so no other rule was disturbed.
      const accepted = await createBookingAtomic(
        fixture.tenantId,
        bookingRequest(fixture, openA.id),
      );
      expect(accepted.ok).toBe(true);
      expect(await countAppointments(fixture.tenantId, fixture.date, closedTable.id)).toBe(0);
      expect(await countAppointments(fixture.tenantId, fixture.date, openA.id)).toBe(1);
    }, 60_000);
  },
);

describeDb(
  "Task 4.5: a closure raced against the locked recheck (Req 4.7, 4.8, 4.11, 11.5)",
  () => {
    /**
     * Reproduces the race deterministically: a holder connection takes the very
     * `RestaurantTable` row lock the booking needs, the booking starts and blocks on
     * that lock, the closure is committed on a separate connection while the booking
     * waits, then the holder releases. The booking's closure read is a LOCKING read,
     * so it sees the just-committed closure and the recheck refuses — a stale
     * availability response cannot slip a newly closed date or table through.
     */
    async function bookWhileClosureCommits(
      fixture: Fixture,
      tableId: string,
      closureScope: { type: "restaurant" } | { type: "table"; tableId: string },
    ): Promise<Awaited<ReturnType<typeof createBookingAtomic>>> {
      const holder = await (pool as any).getConnection();
      let booking: Promise<Awaited<ReturnType<typeof createBookingAtomic>>>;
      try {
        await holder.beginTransaction();
        // Hold the exact row lock step 1 of the booking will queue on.
        await holder.query(
          "SELECT id FROM RestaurantTable WHERE tenantId = ? AND id = ? FOR UPDATE",
          [fixture.tenantId, tableId],
        );

        // The booking now blocks at its own `FOR UPDATE` on the same row.
        booking = createBookingAtomic(fixture.tenantId, bookingRequest(fixture, tableId));

        // Let it reach the lock wait, commit the closure on a pooled connection
        // (auto-commit), then release so the booking proceeds into its recheck.
        await new Promise((resolve) => setTimeout(resolve, 400));
        await insertClosure(fixture.tenantId, fixture.date, closureScope);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await holder.commit();
      } finally {
        holder.release();
      }
      return booking!;
    }

    // Feature: restaurant-dashboard-settings, Property 8: Closure-aware availability
    it("a restaurant closure committed during the lock wait makes the recheck refuse the date", async () => {
      const fixture = await createFixture(1);
      const table = fixture.tables[0];

      const result = await bookWhileClosureCommits(fixture, table.id, { type: "restaurant" });

      expect(result.ok).toBe(false);
      expect((result as { ok: false; message: string }).message).toBe(MSG_SLOT_NOT_AVAILABLE);
      expect(await countAppointments(fixture.tenantId, fixture.date)).toBe(0);
    }, 60_000);

    // Feature: restaurant-dashboard-settings, Property 8: Closure-aware availability
    it("a table closure committed during the lock wait makes the recheck refuse that table", async () => {
      const fixture = await createFixture(1);
      const table = fixture.tables[0];

      const result = await bookWhileClosureCommits(fixture, table.id, {
        type: "table",
        tableId: table.id,
      });

      expect(result.ok).toBe(false);
      expect((result as { ok: false; message: string }).message).toBe(MSG_TABLE_JUST_BOOKED);
      expect(await countAppointments(fixture.tenantId, fixture.date, table.id)).toBe(0);
    }, 60_000);
  },
);

describeDb("Task 4.5: closures never rewrite existing bookings (Req 3.9, 4.11, 11.6)", () => {
  // Feature: restaurant-dashboard-settings, Property 8: Closure-aware availability
  it("leaves every field and status of a prior booking byte-identical across closure create and delete", async () => {
    const fixture = await createFixture(2);
    const [bookedTable, otherTable] = fixture.tables;

    // A booking exists BEFORE any closure is written.
    const created = await createBookingAtomic(
      fixture.tenantId,
      bookingRequest(fixture, bookedTable.id),
    );
    expect(created.ok).toBe(true);
    const bookingId = (created as CreateBookingSuccess).bookingId;

    const before = await appointmentSnapshot(fixture.tenantId, bookingId);
    expect(before.status).toBe("Pending");

    // Close the whole restaurant, then the other table, then the booked table —
    // three closure writes touching the same date the booking sits on.
    await insertClosure(fixture.tenantId, fixture.date, { type: "restaurant" });
    await insertClosure(fixture.tenantId, fixture.date, { type: "table", tableId: otherTable.id });
    await insertClosure(fixture.tenantId, fixture.date, { type: "table", tableId: bookedTable.id });

    const afterCreate = await appointmentSnapshot(fixture.tenantId, bookingId);
    expect(afterCreate).toEqual(before);

    // Removing every closure again must equally leave the booking untouched.
    await execute("DELETE FROM RestaurantClosureDay WHERE tenantId = ? AND closureDate = ?", [
      fixture.tenantId,
      fixture.date,
    ]);

    const afterDelete = await appointmentSnapshot(fixture.tenantId, bookingId);
    expect(afterDelete).toEqual(before);

    // The row still exists exactly once — nothing cascaded from the closures.
    expect(await countAppointments(fixture.tenantId, fixture.date, bookedTable.id)).toBe(1);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Table_Group reservations: one entry per Booking_Group in the Bookings List,
// and a status change that moves the whole group (Req 7.1, 9.1, 9.4, 9.12)
// ─────────────────────────────────────────────────────────────────────────────

describeDb("Table_Group reservations read and change as one unit", () => {
  it("stores one row per table sharing a Booking_Group, token and slot", async () => {
    const fixture = await createFixture(2, 2); // two 2-seat tables
    const request = {
      ...bookingRequest(fixture, null, 4),
      tableIds: fixture.tables.map((t) => t.id),
    };

    const created = await createBookingAtomic(fixture.tenantId, request);
    expect(created.ok).toBe(true);
    const booking = created as CreateBookingSuccess;

    // A party of four seated by two 2-seat tables — the capacity that used to be
    // a dead end (Req 7.5).
    expect(booking.tables).toHaveLength(2);
    expect(booking.tableName).toBe(fixture.tables.map((t) => t.name).join(" + "));

    const rows = await query<any>(
      `SELECT id, bookingGroupId, tokenNo, partySize, timeSlot, status, tableId
       FROM Appointment WHERE tenantId = ? ORDER BY tableNameAtBooking`,
      [fixture.tenantId],
    );
    expect(rows).toHaveLength(2);
    // Every row shares the reservation's identity …
    expect(new Set(rows.map((r) => String(r.bookingGroupId))).size).toBe(1);
    expect(String(rows[0].bookingGroupId)).toBe(booking.bookingId);
    expect(new Set(rows.map((r) => Number(r.tokenNo))).size).toBe(1);
    expect(new Set(rows.map((r) => Number(r.partySize)))).toEqual(new Set([4]));
    expect(new Set(rows.map((r) => String(r.timeSlot))).size).toBe(1);
    // … and carries its own Dining_Table, which is what keeps per-table
    // occupancy and the double-booking guard working unchanged.
    expect(new Set(rows.map((r) => String(r.tableId))).size).toBe(2);
  }, 120_000);

  it("returns one Bookings List entry per Booking_Group, counted and paged over groups", async () => {
    const fixture = await createFixture(3, 4);
    const [a, b, c] = fixture.tables;

    // One two-table reservation …
    const group = await createBookingAtomic(fixture.tenantId, {
      ...bookingRequest(fixture, null, 6),
      tableIds: [a.id, b.id],
    });
    expect(group.ok).toBe(true);

    // … and one single-table reservation in a non-overlapping window.
    const single = await createBookingAtomic(fixture.tenantId, {
      ...bookingRequest(fixture, c.id, 2),
      slotStartMinutes: SLOT_START_MINUTES + DEFAULT_SETTINGS.turnTime,
    });
    expect(single.ok).toBe(true);

    const page = await listBookings(fixture.tenantId, {}, 1);

    // Three Appointment rows, but two reservations.
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(2);

    const grouped = page.rows.find((r) => r.bookingGroupId === (group as CreateBookingSuccess).bookingId);
    expect(grouped).toBeDefined();
    expect(grouped!.tableName).toBe(`${a.name} + ${b.name}`);
    expect(grouped!.groupTables.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());

    const alone = page.rows.find((r) => r.bookingGroupId === (single as CreateBookingSuccess).bookingId);
    expect(alone).toBeDefined();
    expect(alone!.tableName).toBe(c.name);
    expect(alone!.groupTables).toHaveLength(1);
  }, 120_000);

  it("applies a Booking_Status change to every table of the Booking_Group", async () => {
    const fixture = await createFixture(2, 2);
    const created = await createBookingAtomic(fixture.tenantId, {
      ...bookingRequest(fixture, null, 4),
      tableIds: fixture.tables.map((t) => t.id),
    });
    expect(created.ok).toBe(true);
    const bookingId = (created as CreateBookingSuccess).bookingId;

    // Addressing ONE row of the group cancels the whole reservation (Req 9.4).
    expect(await setBookingStatus(fixture.tenantId, bookingId, "Cancelled")).toEqual({ ok: true });

    const cancelled = await query<any>(
      "SELECT status FROM Appointment WHERE tenantId = ?",
      [fixture.tenantId],
    );
    expect(cancelled).toHaveLength(2);
    expect(new Set(cancelled.map((r) => String(r.status)))).toEqual(new Set(["Cancelled"]));

    // Both Dining_Tables are free again, so the group can be reinstated as a
    // whole without blocking itself (Req 9.5, 7.8).
    expect(await setBookingStatus(fixture.tenantId, bookingId, "Confirmed")).toEqual({ ok: true });
    const reinstated = await query<any>(
      "SELECT status FROM Appointment WHERE tenantId = ?",
      [fixture.tenantId],
    );
    expect(new Set(reinstated.map((r) => String(r.status)))).toEqual(new Set(["Confirmed"]));
  }, 120_000);
});
