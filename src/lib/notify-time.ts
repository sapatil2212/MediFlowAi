// ─────────────────────────────────────────────────────────────────────────────
// notify-time.ts  (PURE, isomorphic)
//
// Timezone-correct scheduling helpers for notifications.
//
// Appointment.dateTime holds the business's LOCAL wall-clock time (the booking
// UI generates slots in local time and the DB stores them verbatim). The
// notification engine therefore reads it as a "YYYY-MM-DD HH:MM:SS" string via
// DATE_FORMAT and converts it to a real instant using the tenant's IANA
// timezone. All scheduling instants are UTC epoch milliseconds, so behaviour
// does not depend on the Node process TZ or the database time_zone, and
// daylight-saving transitions are handled by Intl.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** True when `tz` is an IANA zone this runtime can format. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Returns a usable IANA zone, falling back to the platform default. */
export function resolveTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? String(tz) : DEFAULT_TIMEZONE;
}

/** Parses "YYYY-MM-DD[ T]HH:MM[:SS]" (or a bare date) into wall-clock parts. */
export function parseWallClock(value: string | null | undefined): WallClock | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(value));
  if (!m) return null;
  const w: WallClock = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
    second: m[6] ? Number(m[6]) : 0,
  };
  if (w.month < 1 || w.month > 12 || w.day < 1 || w.day > 31 || w.hour > 23 || w.minute > 59) {
    return null;
  }
  return w;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** Formats wall-clock parts as "YYYY-MM-DD HH:MM:SS". */
export function formatWallClock(w: WallClock): string {
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

/** "YYYY-MM-DD" date key of a wall clock. */
export function dateKey(w: Pick<WallClock, "year" | "month" | "day">): string {
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Wall-clock parts of a UTC instant in `tz`. */
export function zonedParts(utcMs: number, tz: string): WallClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(tz),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Offset of `tz` from UTC at the given instant, in ms (IST → +19 800 000). */
export function zoneOffsetMs(utcMs: number, tz: string): number {
  const w = zonedParts(utcMs, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Converts a local wall-clock time in `tz` to a UTC instant. DST-safe: the
 * offset is re-evaluated at the candidate instant. A non-existent local time
 * (spring-forward gap) resolves to the instant just after the gap; an
 * ambiguous one (fall-back) resolves to the earlier occurrence.
 */
export function wallClockToUtcMs(w: WallClock, tz: string): number {
  const zone = resolveTimeZone(tz);
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const first = naive - zoneOffsetMs(naive, zone);
  const second = naive - zoneOffsetMs(first, zone);
  if (first === second) return first;
  // Offsets differ around a transition: prefer the candidate that round-trips.
  const roundTrips = (t: number) => {
    const p = zonedParts(t, zone);
    return (
      p.year === w.year &&
      p.month === w.month &&
      p.day === w.day &&
      p.hour === w.hour &&
      p.minute === w.minute
    );
  };
  const candidates = [first, second].filter(roundTrips).sort((a, b) => a - b);
  return candidates.length > 0 ? candidates[0] : Math.max(first, second);
}

/** Adds whole calendar days to a date (no time component involved). */
export function addCalendarDays(
  d: Pick<WallClock, "year" | "month" | "day">,
  days: number,
): Pick<WallClock, "year" | "month" | "day"> {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + days * DAY_MS);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Template date text, e.g. "28 October 2026". */
export function formatTemplateDate(w: Pick<WallClock, "year" | "month" | "day">): string {
  return `${w.day} ${MONTHS[w.month - 1]} ${w.year}`;
}

/** Template time text from wall-clock parts, e.g. "10:30 AM". */
export function formatTemplateTime(w: Pick<WallClock, "hour" | "minute">): string {
  const suffix = w.hour >= 12 ? "PM" : "AM";
  const h12 = w.hour % 12 === 0 ? 12 : w.hour % 12;
  return `${h12}:${pad(w.minute)} ${suffix}`;
}

/**
 * Normalises a stored slot label ("09:30 AM", "9:30 am", "14:30") to the
 * template time format ("9:30 AM"). Returns null for unparseable input.
 */
export function normalizeSlotLabel(slot: string | null | undefined): string | null {
  if (!slot) return null;
  const s = String(slot).trim();
  const ampm = /^(\d{1,2}):(\d{2})\s*([AaPp])\.?\s*[Mm]\.?$/.exec(s);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    const pm = ampm[3].toLowerCase() === "p";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
    return formatTemplateTime({ hour, minute });
  }
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (h24) {
    const hour = Number(h24[1]);
    const minute = Number(h24[2]);
    if (hour > 23 || minute > 59) return null;
    return formatTemplateTime({ hour, minute });
  }
  return null;
}

/**
 * True when a booking carries a real time of day. Education bookings are
 * date-only and stored at local midnight with no slot label.
 */
export function hasTimeOfDay(w: WallClock, timeSlot: string | null | undefined): boolean {
  if (normalizeSlotLabel(timeSlot)) return true;
  return !(w.hour === 0 && w.minute === 0);
}

export interface ReminderPolicy {
  /** Earliest local hour a day-before reminder may be sent (inclusive). */
  quietEndHour?: number;
  /** Latest local hour a day-before reminder may be sent (exclusive). */
  quietStartHour?: number;
}

/**
 * Due instant of the day-before reminder: 24 hours before the appointment,
 * clamped into the [quietEndHour, quietStartHour) local window of the previous
 * calendar day, so the "tomorrow" wording is always true when it is sent.
 */
export function computeDayBeforeDueMs(
  appt: WallClock,
  tz: string,
  policy: ReminderPolicy = {},
): number {
  const earliest = policy.quietEndHour ?? 8;
  const latest = policy.quietStartHour ?? 21;
  const apptMs = wallClockToUtcMs(appt, tz);
  const prev = addCalendarDays(appt, -1);
  const windowStart = wallClockToUtcMs({ ...prev, hour: earliest, minute: 0, second: 0 }, tz);
  const windowEnd = wallClockToUtcMs({ ...prev, hour: latest, minute: 0, second: 0 }, tz);
  const target = apptMs - DAY_MS;
  return Math.min(Math.max(target, windowStart), windowEnd);
}

/** Due instant of the same-day reminder: `hoursBefore` before the appointment. */
export function computeHoursBeforeDueMs(appt: WallClock, tz: string, hoursBefore = 2): number {
  return wallClockToUtcMs(appt, tz) - hoursBefore * HOUR_MS;
}

/** True when the appointment's local date is the calendar day after `nowMs` in `tz`. */
export function isTomorrowLocal(appt: WallClock, nowMs: number, tz: string): boolean {
  const today = zonedParts(nowMs, tz);
  return dateKey(addCalendarDays(today, 1)) === dateKey(appt);
}

/** True when the appointment's local date is the same calendar day as `nowMs` in `tz`. */
export function isTodayLocal(appt: WallClock, nowMs: number, tz: string): boolean {
  return dateKey(zonedParts(nowMs, tz)) === dateKey(appt);
}
