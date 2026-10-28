// ─────────────────────────────────────────────────────────────────────────────
// notify-context.ts  (server-only)
//
// Loads the CURRENT booking + tenant facts at dispatch time and turns them into
// the template context. Values come from the database when the message is sent
// (not from a snapshot taken at booking time), so a token renumber, a reschedule
// or a cancellation that happened in between is always reflected — and the
// dispatcher can refuse to send an event that is no longer true.
//
// The appointment's wall-clock time is read as a string (DATE_FORMAT) so date
// and time text never depend on the Node process timezone.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne } from "./db";
import type { AptNotifyContext } from "./appointment-notify";
import { businessCategoryFromProfession, type BusinessCategory } from "./notify-catalog";
import {
  formatTemplateDate,
  formatTemplateTime,
  hasTimeOfDay,
  normalizeSlotLabel,
  parseWallClock,
  resolveTimeZone,
  type WallClock,
} from "./notify-time";

export interface TenantSnapshot {
  tenantId: string;
  businessName: string | null;
  /** Registered owner clinician (ClinicProfile.clinicianName), if any. */
  clinicianName?: string | null;
  profession: string | null;
  category: BusinessCategory;
  timezone: string;
}

export interface BookingSnapshot {
  appointmentId: string;
  tenantId: string;
  status: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  /** "YYYY-MM-DD HH:MM:SS" business-local wall clock. */
  wallClock: string;
  timeSlot: string | null;
  tokenNo: number | null;
  doctorName: string | null;
  appointmentType: string | null;
  consultationMode: string | null;
  partySize: number | null;
  tableName: string | null;
  remDayBefore: boolean;
  rem2h: boolean;
}

/** Statuses after which no further booking notification (other than its own) is valid. */
export const CLOSED_STATUSES = new Set(["Cancelled", "Completed", "No Show"]);

/** Statuses for which a reminder may still be sent. */
export const REMINDABLE_STATUSES = new Set(["Pending", "Confirmed"]);

export async function loadTenantSnapshot(tenantId: string): Promise<TenantSnapshot | null> {
  const owner = await queryOne<any>(
    "SELECT clinicName, profession FROM User WHERE tenantId = ? LIMIT 1",
    [tenantId],
  );
  let profileName: string | null = null;
  let clinicianName: string | null = null;
  try {
    const profile = await queryOne<any>(
      "SELECT clinicName, clinicianName FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [tenantId],
    );
    profileName = profile?.clinicName ? String(profile.clinicName) : null;
    clinicianName = profile?.clinicianName ? String(profile.clinicianName).trim() || null : null;
  } catch {
    profileName = null;
  }
  if (!owner && !profileName) return null;

  const category = businessCategoryFromProfession(owner?.profession);
  let timezone: string | null = null;
  try {
    const settings = await queryOne<any>(
      "SELECT timezone FROM TenantNotificationSettings WHERE tenantId = ? LIMIT 1",
      [tenantId],
    );
    timezone = settings?.timezone ? String(settings.timezone) : null;
  } catch {
    timezone = null;
  }
  if (!timezone && category === "restaurant") {
    try {
      const rs = await queryOne<any>(
        "SELECT timezone FROM RestaurantSettings WHERE tenantId = ? LIMIT 1",
        [tenantId],
      );
      timezone = rs?.timezone ? String(rs.timezone) : null;
    } catch {
      timezone = null;
    }
  }

  const businessName =
    (profileName && profileName.trim()) ||
    (owner?.clinicName ? String(owner.clinicName).trim() : "") ||
    null;
  return {
    tenantId,
    businessName,
    clinicianName,
    profession: owner?.profession ?? null,
    category,
    timezone: resolveTimeZone(timezone),
  };
}

/** Minimal query runner so snapshots can be read inside a booking transaction. */
export interface SqlRunner {
  query: (sql: string, params?: unknown[]) => Promise<any>;
}

export async function loadBookingSnapshot(
  tenantId: string,
  appointmentId: string,
  conn?: SqlRunner | null,
): Promise<BookingSnapshot | null> {
  const one = async (sql: string, params: unknown[]) => {
    if (!conn) return queryOne<any>(sql, params);
    const rows = await conn.query(sql, params);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  };
  const many = async (sql: string, params: unknown[]) =>
    conn ? ((await conn.query(sql, params)) as any[]) : query<any>(sql, params);
  const row = await one(
    `SELECT a.id, a.tenantId, a.status, a.name, a.phone, a.whatsapp, a.email,
            DATE_FORMAT(a.dateTime, '%Y-%m-%d %H:%i:%s') AS wallClock,
            a.timeSlot, a.tokenNo, a.appointmentType, a.consultationMode, a.partySize,
            a.tableNameAtBooking, a.bookingGroupId, a.remDayBefore, a.rem2h,
            d.name AS doctorName
       FROM Appointment a
       LEFT JOIN Doctor d ON d.id = a.doctorId
      WHERE a.tenantId = ? AND (a.id = ? OR a.bookingGroupId = ?)
      ORDER BY (a.id = ?) DESC
      LIMIT 1`,
    [tenantId, appointmentId, appointmentId, appointmentId],
  );
  if (!row) return null;

  // Restaurant Table_Groups: one reservation spread over several rows.
  let tableName: string | null = row.tableNameAtBooking ? String(row.tableNameAtBooking) : null;
  let partySize: number | null = row.partySize != null ? Number(row.partySize) : null;
  const groupId = row.bookingGroupId ? String(row.bookingGroupId) : null;
  if (groupId) {
    try {
      const members = await many(
        `SELECT COALESCE(t.name, a.tableNameAtBooking) AS tableName, a.partySize
           FROM Appointment a LEFT JOIN RestaurantTable t ON t.id = a.tableId
          WHERE a.tenantId = ? AND COALESCE(a.bookingGroupId, a.id) = ?
          ORDER BY t.name ASC`,
        [tenantId, groupId],
      );
      const names = members
        .map((m: any) => (m.tableName ? String(m.tableName) : ""))
        .filter(Boolean);
      if (names.length > 0) tableName = names.join(" + ");
      const sizes = members.map((m: any) => Number(m.partySize) || 0);
      if (sizes.length > 0) partySize = Math.max(...sizes) || partySize;
    } catch {
      /* keep the primary row's snapshot */
    }
  }

  return {
    // Events are keyed by the id the caller used (a Table_Group's booking id).
    appointmentId,
    tenantId: String(row.tenantId),
    status: String(row.status ?? "Pending"),
    name: String(row.name ?? ""),
    phone: row.phone ? String(row.phone) : null,
    whatsapp: row.whatsapp ? String(row.whatsapp) : null,
    email: row.email ? String(row.email) : null,
    wallClock: String(row.wallClock ?? ""),
    timeSlot: row.timeSlot ? String(row.timeSlot) : null,
    tokenNo: row.tokenNo != null ? Number(row.tokenNo) : null,
    doctorName: row.doctorName ? String(row.doctorName) : null,
    appointmentType: row.appointmentType ? String(row.appointmentType) : null,
    consultationMode: row.consultationMode ? String(row.consultationMode) : null,
    partySize,
    tableName,
    remDayBefore: Number(row.remDayBefore) === 1,
    rem2h: Number(row.rem2h) === 1,
  };
}

/** Neutral service wording when a booking has no appointment type. */
const DEFAULT_SERVICE: Record<BusinessCategory, string> = {
  clinic: "appointment",
  salon: "salon",
  gym: "training session",
  coaching: "session",
  restaurant: "reservation",
  professional: "consultation",
};

/** The recipient a booking's notifications go to (WhatsApp number first). */
export function bookingRecipient(b: Pick<BookingSnapshot, "whatsapp" | "phone">): string | null {
  const raw = (b.whatsapp && b.whatsapp.trim()) || (b.phone && b.phone.trim()) || "";
  return raw || null;
}

/** Parsed wall clock of a booking (null when the stored value is unusable). */
export function bookingWallClock(b: Pick<BookingSnapshot, "wallClock">): WallClock | null {
  return parseWallClock(b.wallClock);
}

/** Builds the template context from current booking + tenant facts. */
export function buildNotifyContext(
  booking: BookingSnapshot,
  tenant: TenantSnapshot,
  extra: { joinLink?: string | null } = {},
): AptNotifyContext {
  const w = parseWallClock(booking.wallClock);
  const dateTime = w
    ? new Date(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
    : new Date(NaN);
  const slot = normalizeSlotLabel(booking.timeSlot);
  const timeText = slot ?? (w && hasTimeOfDay(w, booking.timeSlot) ? formatTemplateTime(w) : null);
  return {
    name: booking.name,
    clinicName: tenant.businessName,
    // A booking without a doctor falls back to the clinic's registered
    // clinician; never to invented text.
    doctorName: booking.doctorName || tenant.clinicianName || null,
    dateTime,
    timeSlot: booking.timeSlot,
    tokenNo: booking.tokenNo,
    partySize: booking.partySize,
    tableName: booking.tableName,
    joinLink: extra.joinLink ?? null,
    appointmentId: booking.appointmentId,
    serviceName: booking.appointmentType || DEFAULT_SERVICE[tenant.category],
    dateText: w ? formatTemplateDate(w) : null,
    timeText,
  };
}
