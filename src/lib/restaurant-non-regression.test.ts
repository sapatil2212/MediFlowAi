/**
 * restaurant-non-regression.test.ts
 *
 * The guard on Requirement 12 (spec task 11.3): adding the Restaurant & Dining
 * category changes nothing for the five existing categories.
 *
 * Everything that talks to MariaDB sits behind a connection guard, so `npm test`
 * stays runnable on a machine with no database configured. The one test that
 * needs no database — re-running the two pre-existing pure suites — always runs.
 *
 * Fixtures are namespaced (`clinic-nr-` for the non-restaurant tenant,
 * `resto-nr-` for the restaurant tenant used by the isolation test) and every row
 * is removed in `afterAll`, so repeated runs are deterministic and no other
 * spec's data is touched.
 */

import crypto from "crypto";
import path from "path";
import { spawnSync } from "child_process";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * A server function is normally reached over the wire, and its return value is
 * assembled by the client transport. Outside a running server there is no
 * transport, so `createServerFn` is replaced by a double that reproduces exactly
 * what the server side does — run the `.validator`, then run the handler with the
 * narrowed payload — and hands the handler's own return value back. The handlers
 * under test (`getClinicInfoAndSlotsServerFn`, `createAppointmentPublicServerFn`)
 * are the real, unmodified ones.
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

import { execute, query, queryOne } from "./db";
import { createAppointmentPublicServerFn, getClinicInfoAndSlotsServerFn } from "./booking";
import {
  DEFAULT_SETTINGS,
  MSG_TABLE_NOT_FOUND,
  formatSlotLabel,
  tenantNow,
  type DayHours,
  type ServiceSettings,
} from "./restaurant-availability";
import {
  createBookingAtomic,
  deleteTable,
  getBookingById,
  getTableById,
  insertTable,
  listTables,
  replaceHours,
  setTableState,
  updateTable,
  upsertSettings,
  type CreateBookingSuccess,
} from "./restaurant.server";

// ─────────────────────────────────────────────────────────────────────────────
// Connection guard
// ─────────────────────────────────────────────────────────────────────────────

const DB_CONFIGURED = Boolean(
  process.env.DATABASE_URL || process.env.DB_HOST || process.env.DB_NAME || process.env.DB_USER,
);

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
    console.warn(
      `[restaurant-non-regression] skipping DB tests — no usable database (${err?.message})`,
    );
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const DB_AVAILABLE = await probeDatabase();
const describeDb = describe.skipIf(!DB_AVAILABLE);

// ─────────────────────────────────────────────────────────────────────────────
// Namespaced fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CLINIC_NAMESPACE = "clinic-nr-";
const RESTAURANT_NAMESPACE = "resto-nr-";
const EMAIL_NAMESPACE = "restaurant-nonreg-";

const createdDoctorIds: string[] = [];

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function futureDate(days = 3): string {
  return addDays(tenantNow(DEFAULT_SETTINGS.timezone, new Date()).dateStr, days);
}

interface ClinicFixture {
  tenantId: string;
  userId: string;
  doctorId: string;
  date: string;
}

/**
 * A plain, non-restaurant tenant: `Healthcare and medical` owner account, one
 * department, one doctor, Operating hours for all seven weekdays and a doctor
 * schedule for all seven weekdays, so the slot computation has something to
 * return whichever weekday the chosen date falls on.
 */
async function createClinicFixture(): Promise<ClinicFixture> {
  const id = shortId();
  const tenantId = `${CLINIC_NAMESPACE}${id}`;
  const userId = crypto.randomUUID();

  await execute(
    `INSERT INTO User (id, tenantId, name, email, phone, clinicName, practiceSize, password,
                       subscriptionStatus, subscriptionPlan, subscriptionExpiresAt, createdAt, updatedAt, profession)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', 'Basic', DATE_ADD(NOW(), INTERVAL 30 DAY), NOW(), NOW(), ?)`,
    [
      userId,
      tenantId,
      "Non Regression Owner",
      `${EMAIL_NAMESPACE}${id}@example.invalid`,
      `44${Date.now()}${id.slice(0, 3)}`,
      "Non Regression Clinic",
      "1-5",
      "not-a-real-hash",
      "Healthcare and medical",
    ],
  );

  const departmentId = crypto.randomUUID();
  await execute("INSERT INTO Department (id, tenantId, name, createdAt) VALUES (?, ?, ?, NOW())", [
    departmentId,
    tenantId,
    "General",
  ]);

  const doctorId = crypto.randomUUID();
  createdDoctorIds.push(doctorId);
  await execute(
    `INSERT INTO Doctor (id, tenantId, name, email, phone, qualifications, departmentId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      doctorId,
      tenantId,
      "Dr Non Regression",
      "doc@example.invalid",
      "1234567890",
      "MBBS",
      departmentId,
    ],
  );

  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    await execute(
      `INSERT INTO ClinicHours (id, tenantId, dayOfWeek, openTime, closeTime, isClosed, createdAt)
       VALUES (?, ?, ?, '09:00', '17:00', 0, NOW())`,
      [crypto.randomUUID(), tenantId, dayOfWeek],
    );
    await execute(
      `INSERT INTO DoctorSchedule (id, doctorId, dayOfWeek, startTime, endTime, slotDuration, createdAt)
       VALUES (?, ?, ?, '09:00', '12:00', 30, NOW())`,
      [crypto.randomUUID(), doctorId, dayOfWeek],
    );
  }

  return { tenantId, userId, doctorId, date: futureDate() };
}

/** All seven weekdays open 10:00 → 23:00. */
function allDaysOpen(): DayHours[] {
  return Array.from({ length: 7 }, (_v, dayOfWeek) => ({
    dayOfWeek,
    openTime: "10:00",
    closeTime: "23:00",
    isClosed: false,
  }));
}

/** Deliberately arbitrary Operating_Hours: odd times, two closed weekdays. */
function arbitraryHours(): DayHours[] {
  return Array.from({ length: 7 }, (_v, dayOfWeek) => ({
    dayOfWeek,
    openTime: dayOfWeek % 2 === 0 ? "11:15" : "18:45",
    closeTime: dayOfWeek % 2 === 0 ? "22:30" : "23:59",
    isClosed: dayOfWeek === 2 || dayOfWeek === 5,
  }));
}

/** Deliberately arbitrary Service_Settings, none of them the defaults. */
function arbitrarySettings(): ServiceSettings {
  return {
    slotInterval: 15,
    turnTime: 120,
    maxPartySize: 20,
    advanceBookingWindow: 200,
    minLeadTime: 0,
    timezone: "America/New_York",
  };
}

async function addRestaurantRowsFor(tenantId: string, hours: DayHours[]): Promise<void> {
  await upsertSettings(tenantId, arbitrarySettings());
  await replaceHours(tenantId, hours);
  for (let i = 0; i < 3; i += 1) {
    const result = await insertTable(tenantId, {
      name: `NR Table ${i + 1}`,
      seatCapacity: 2 + i,
      area: i === 2 ? "Patio" : "Main",
      displayOrder: i + 1,
      state: "active",
      locationId: null,
    });
    expect(result.ok).toBe(true);
  }
}

afterAll(async () => {
  if (!DB_AVAILABLE) return;

  for (const like of [`${CLINIC_NAMESPACE}%`, `${RESTAURANT_NAMESPACE}%`]) {
    await execute("DELETE FROM Appointment WHERE tenantId LIKE ?", [like]);
    await execute("DELETE FROM Patient WHERE tenantId LIKE ?", [like]);
    await execute("DELETE FROM RestaurantTable WHERE tenantId LIKE ?", [like]);
    await execute("DELETE FROM RestaurantHours WHERE tenantId LIKE ?", [like]);
    await execute("DELETE FROM RestaurantSettings WHERE tenantId LIKE ?", [like]);
    await execute("DELETE FROM RestaurantTokenCounter WHERE tenantId LIKE ?", [like]);
    await execute("DELETE FROM ClinicHours WHERE tenantId LIKE ?", [like]);
    await execute("DELETE FROM Doctor WHERE tenantId LIKE ?", [like]);
    await execute("DELETE FROM Department WHERE tenantId LIKE ?", [like]);
  }

  for (const doctorId of createdDoctorIds) {
    await execute("DELETE FROM DoctorSchedule WHERE doctorId = ?", [doctorId]);
    await execute("DELETE FROM DoctorLeave WHERE doctorId = ?", [doctorId]);
  }

  const owners = await query<any>("SELECT id FROM User WHERE email LIKE ?", [
    `${EMAIL_NAMESPACE}%`,
  ]);
  for (const owner of owners) {
    await execute("DELETE FROM SubscriptionHistory WHERE userId = ?", [owner.id]);
    await execute("DELETE FROM Session WHERE userId = ?", [owner.id]);
    await execute("DELETE FROM User WHERE id = ?", [owner.id]);
  }
}, 120_000);

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 12.1 / 12.2 — the existing categories are untouched
// ─────────────────────────────────────────────────────────────────────────────

describeDb(
  "Task 11.3: restaurant rows change nothing for a non-restaurant tenant (Req 12.1)",
  () => {
    // Feature: restaurant-table-booking, Property 30: For any Tenant whose Business_Profession is not `Restaurant and dining`, the Booking_Slots computed for a given date and staff member are deeply equal whether or not arbitrary Operating_Hours, Service_Settings, and Dining_Table rows exist for that Tenant, and every booking created for that Tenant stores an empty Dining_Table reference, Party_Size, Turn_Time snapshot, and Table_Name snapshot; for any account context, the resolved feature availability and permission of every feature carrying no profession restriction are unchanged when only the Business_Profession varies.
    it("returns deeply equal slots with and without RestaurantHours, RestaurantSettings and RestaurantTable rows", async () => {
      const clinic = await createClinicFixture();

      const before: any = await getClinicInfoAndSlotsServerFn({
        data: { tenantId: clinic.tenantId, date: clinic.date, doctorId: clinic.doctorId },
      } as any);

      // The legacy slot computation must have something to say, otherwise the
      // comparison would be trivially satisfied by two empty lists.
      expect(before.slots.length).toBeGreaterThan(0);

      // Arbitrary restaurant configuration for the SAME tenant: odd operating
      // hours, two closed weekdays, non-default service settings, three tables.
      await addRestaurantRowsFor(clinic.tenantId, arbitraryHours());

      const after: any = await getClinicInfoAndSlotsServerFn({
        data: { tenantId: clinic.tenantId, date: clinic.date, doctorId: clinic.doctorId },
      } as any);

      expect(after.slots).toEqual(before.slots);
      expect(after.profession).toBe(before.profession);
      expect(after.clinicName).toBe(before.clinicName);
      expect(after.doctors.length).toBe(before.doctors.length);
      expect(after.departments.length).toBe(before.departments.length);

      // Even a set of hours that closes every weekday leaves the legacy slots alone.
      await replaceHours(
        clinic.tenantId,
        allDaysOpen().map((d) => ({ ...d, isClosed: true })),
      );
      const afterClosed: any = await getClinicInfoAndSlotsServerFn({
        data: { tenantId: clinic.tenantId, date: clinic.date, doctorId: clinic.doctorId },
      } as any);
      expect(afterClosed.slots).toEqual(before.slots);
    }, 120_000);

    // Feature: restaurant-table-booking, Property 30: For any Tenant whose Business_Profession is not `Restaurant and dining`, the Booking_Slots computed for a given date and staff member are deeply equal whether or not arbitrary Operating_Hours, Service_Settings, and Dining_Table rows exist for that Tenant, and every booking created for that Tenant stores an empty Dining_Table reference, Party_Size, Turn_Time snapshot, and Table_Name snapshot; for any account context, the resolved feature availability and permission of every feature carrying no profession restriction are unchanged when only the Business_Profession varies.
    it("leaves tableId, partySize, turnTimeMinutes and tableNameAtBooking NULL for a non-restaurant booking (Req 12.2)", async () => {
      const clinic = await createClinicFixture();

      // Restaurant rows exist for this tenant too — they must not leak into the row
      // the legacy public booking path writes.
      await addRestaurantRowsFor(clinic.tenantId, allDaysOpen());

      const created: any = await createAppointmentPublicServerFn({
        data: {
          tenantId: clinic.tenantId,
          name: "Legacy Patient",
          email: "patient@example.invalid",
          phone: "9876543210",
          dateTime: `${clinic.date}T09:30:00`,
          reason: "Checkup",
          doctorId: clinic.doctorId,
          timeSlot: "09:30 AM",
        },
      } as any);

      expect(created.success).toBe(true);

      const row = await queryOne<any>(
        `SELECT tableId, partySize, turnTimeMinutes, tableNameAtBooking, tokenNo
       FROM Appointment WHERE tenantId = ? AND id = ? LIMIT 1`,
        [clinic.tenantId, created.appointmentId],
      );

      expect(row).not.toBeNull();
      expect(row.tableId).toBeNull();
      expect(row.partySize).toBeNull();
      expect(row.turnTimeMinutes).toBeNull();
      expect(row.tableNameAtBooking).toBeNull();
      // The pre-existing behaviour still holds: the row got its sequential token.
      expect(Number(row.tokenNo)).toBeGreaterThan(0);
    }, 120_000);
  },
);

describeDb("Task 11.3: tenant isolation across the category boundary (Req 11.1-11.3)", () => {
  // Feature: restaurant-table-booking, Property 25: For any store holding Dining_Tables and Table_Bookings for several Tenants, every read performed for one Tenant returns only rows carrying that Tenant's `tenantId` and is unchanged by adding, altering, or removing rows belonging to any other Tenant; every operation naming a Dining_Table or Table_Booking of another Tenant is rejected as not found and mutates no row of either Tenant.
  it("reads only its own rows and reports another tenant's table as not found", async () => {
    const clinic = await createClinicFixture();
    const restaurantTenant = `${RESTAURANT_NAMESPACE}${shortId()}`;
    await addRestaurantRowsFor(restaurantTenant, allDaysOpen());

    const restaurantTables = await listTables(restaurantTenant);
    expect(restaurantTables.length).toBe(3);

    // The non-restaurant tenant sees none of them …
    expect(await listTables(clinic.tenantId)).toEqual([]);

    // … and its slot computation is unchanged by their existence.
    const slots: any = await getClinicInfoAndSlotsServerFn({
      data: { tenantId: clinic.tenantId, date: clinic.date, doctorId: clinic.doctorId },
    } as any);
    await addRestaurantRowsFor(clinic.tenantId, arbitraryHours());
    const slotsAgain: any = await getClinicInfoAndSlotsServerFn({
      data: { tenantId: clinic.tenantId, date: clinic.date, doctorId: clinic.doctorId },
    } as any);
    expect(slotsAgain.slots).toEqual(slots.slots);

    // A foreign id is NOT FOUND, never forbidden, and mutates nothing.
    const foreign = restaurantTables[0];
    expect(await getTableById(clinic.tenantId, foreign.id)).toBeNull();

    const stateChange = await setTableState(clinic.tenantId, foreign.id, "inactive");
    expect(stateChange).toEqual({ ok: false, message: MSG_TABLE_NOT_FOUND });

    const deletion = await deleteTable(clinic.tenantId, foreign.id);
    expect(deletion).toEqual({ ok: false, message: MSG_TABLE_NOT_FOUND });

    // Neither tenant's rows moved.
    const unchanged = await getTableById(restaurantTenant, foreign.id);
    expect(unchanged).toEqual(foreign);
    expect(await listTables(restaurantTenant)).toEqual(restaurantTables);

    // The clinic tenant's own read returns only its own three tables — none of
    // the other tenant's rows appear in it.
    const clinicTables = await listTables(clinic.tenantId);
    expect(clinicTables).toHaveLength(3);
    const foreignIds = new Set(restaurantTables.map((t) => t.id));
    expect(clinicTables.filter((t) => foreignIds.has(t.id))).toEqual([]);
  }, 120_000);
});

describeDb(
  "Task 11.3: configuration changes never mutate existing bookings (Req 3.12, 4.12)",
  () => {
    // Feature: restaurant-table-booking, Property 16: For any set of existing Table_Bookings and any valid change to Operating_Hours, to Service_Settings, to a Dining_Table's fields, or to a Dining_Table's Table_State, the stored Table_Bookings are unchanged afterwards — identifiers, assigned Dining_Table, Booking_Status, and Turn_Time snapshot included — including Table_Bookings whose Booking_Slot now falls outside the saved Operating_Hours; and for any Table_Booking, the Table_Name it displays equals the Table_Name recorded at booking time whether or not that Dining_Table still exists.
    it("keeps every stored booking byte-identical and keeps displaying the booking-time table name", async () => {
      const tenantId = `${RESTAURANT_NAMESPACE}${shortId()}`;
      const date = futureDate();
      await upsertSettings(tenantId, DEFAULT_SETTINGS);
      await replaceHours(tenantId, allDaysOpen());

      const inserted = await insertTable(tenantId, {
        name: "Window 1",
        seatCapacity: 4,
        area: "Main",
        displayOrder: 1,
        state: "active",
        locationId: null,
      });
      expect(inserted.ok).toBe(true);
      const table = (inserted as { ok: true; table: any }).table;

      const created = await createBookingAtomic(tenantId, {
        guestName: "Config Guest",
        phone: "9998887766",
        email: "",
        partySize: 2,
        date,
        slotStartMinutes: 18 * 60,
        tableIds: [table.id],
        specialRequests: "",
        locationId: null,
      });
      expect(created.ok).toBe(true);
      const booking = created as CreateBookingSuccess;
      expect(booking.slotLabel).toBe(formatSlotLabel(18 * 60));

      const BOOKING_COLUMNS = `id, tenantId, name, phone, DATE_FORMAT(dateTime, '%Y-%m-%d %H:%i:%s') AS dt,
       timeSlot, status, tokenNo, tableId, partySize, turnTimeMinutes, tableNameAtBooking, patientId`;
      const readRow = () =>
        queryOne<any>(
          `SELECT ${BOOKING_COLUMNS} FROM Appointment WHERE tenantId = ? AND id = ? LIMIT 1`,
          [tenantId, booking.bookingId],
        );

      const beforeRow = await readRow();
      expect(beforeRow.turnTimeMinutes).toBe(DEFAULT_SETTINGS.turnTime);

      // Every configuration surface changes underneath the booking: the weekday it
      // sits on becomes closed, the service settings change, the table is renamed,
      // moved to another area, deactivated — and finally deleted outright.
      await replaceHours(
        tenantId,
        allDaysOpen().map((d) => ({ ...d, isClosed: true, openTime: "12:00", closeTime: "14:00" })),
      );
      await upsertSettings(tenantId, arbitrarySettings());
      const renamed = await updateTable(tenantId, table.id, {
        name: "Window 1 Renamed",
        seatCapacity: 8,
        area: "Patio",
        displayOrder: 9,
        state: "active",
        locationId: null,
      });
      expect(renamed.ok).toBe(true);
      expect(await setTableState(tenantId, table.id, "inactive")).toEqual({ ok: true });

      const afterConfig = await readRow();
      expect(afterConfig).toEqual(beforeRow);

      // The booking still displays the Table_Name it was booked against, even once
      // the Dining_Table is gone.
      expect(await deleteTable(tenantId, table.id)).toEqual({ ok: true });
      expect(await getTableById(tenantId, table.id)).toBeNull();

      const afterDelete = await readRow();
      expect(afterDelete).toEqual(beforeRow);

      const projected = await getBookingById(tenantId, booking.bookingId);
      expect(projected).not.toBeNull();
      expect(projected!.tableName).toBe(table.name);
      expect(projected!.status).toBe("Pending");
      expect(projected!.turnTimeMinutes).toBe(DEFAULT_SETTINGS.turnTime);
    }, 120_000);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// The two pre-existing suites must still pass, unchanged. No database needed, so
// this runs whether or not one is configured.
// ─────────────────────────────────────────────────────────────────────────────

describe("Task 11.3: the pre-existing suites pass unchanged (Req 12.4)", () => {
  // Feature: restaurant-table-booking, Property 30: For any Tenant whose Business_Profession is not `Restaurant and dining`, the Booking_Slots computed for a given date and staff member are deeply equal whether or not arbitrary Operating_Hours, Service_Settings, and Dining_Table rows exist for that Tenant, and every booking created for that Tenant stores an empty Dining_Table reference, Party_Size, Turn_Time snapshot, and Table_Name snapshot; for any account context, the resolved feature availability and permission of every feature carrying no profession restriction are unchanged when only the Business_Profession varies.
  it("runs feature-access.test.ts and video-consultation.test.ts to completion with no failure", () => {
    const root = process.cwd();
    // A nested runner must not inherit this run's own runner state.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !key.startsWith("VITEST")) env[key] = value;
    }

    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "src/lib/feature-access.test.ts",
        "src/lib/video-consultation.test.ts",
      ],
      { cwd: root, encoding: "utf8", env, timeout: 240_000 },
    );

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(result.error).toBeUndefined();
    expect(output).toContain("Test Files  2 passed");
    expect(output).not.toContain("failed");
    expect(result.status).toBe(0);
  }, 300_000);
});
