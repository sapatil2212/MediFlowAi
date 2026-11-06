/**
 * day-sessions.ts
 *
 * Pure, isomorphic model for splitting one calendar day (24 h) into three
 * fixed booking sessions:
 *
 *   Morning    12:00 AM (midnight) → 12:00 PM (noon)   [0,    720)
 *   Afternoon  12:00 PM (noon)     →  4:00 PM          [720,  960)
 *   Evening     4:00 PM            → 12:00 AM (midnight) [960, 1440]
 *
 * A practitioner's weekday holds one window per session (on/off + start/end,
 * always inside that session's band). The windows are stored in the nullable
 * `DoctorSchedule.sessions` JSON column. Rows written before sessions existed
 * have `sessions = NULL` and keep the exact legacy slot generation (one
 * `startTime → endTime` window), so nothing changes for them until someone
 * edits and saves that schedule.
 *
 * No I/O and no db/auth imports: the dashboard editor, the public booking
 * page and both server slot generators all share this file.
 */
import {
  overlapsBreak,
  parseTimeToMinutes,
  resolveBreaks,
  type NormalizedBreak,
} from "./doctor-schedule-breaks";

export type SessionKey = "morning" | "afternoon" | "evening";

export const SESSION_KEYS: readonly SessionKey[] = ["morning", "afternoon", "evening"];

export interface SessionBand {
  key: SessionKey;
  label: string;
  /** Inclusive band start, minutes from midnight. */
  startMin: number;
  /** Exclusive band end, minutes from midnight (1440 = end of day). */
  endMin: number;
}

/** Minutes in a day; also the end of the Evening band ("24:00"). */
export const DAY_END_MIN = 1440;

export const SESSION_BANDS: Readonly<Record<SessionKey, SessionBand>> = {
  morning: { key: "morning", label: "Morning", startMin: 0, endMin: 720 },
  afternoon: { key: "afternoon", label: "Afternoon", startMin: 720, endMin: 960 },
  evening: { key: "evening", label: "Evening", startMin: 960, endMin: DAY_END_MIN },
};

/** One session of one weekday. Times are "HH:MM"; only Evening may end at "24:00". */
export interface SessionWindow {
  enabled: boolean;
  start: string;
  end: string;
}

export type DaySessions = Record<SessionKey, SessionWindow>;

/** The window a session switches on with when it has no usable one yet. */
export const DEFAULT_SESSION_WINDOWS: Readonly<Record<SessionKey, { start: string; end: string }>> =
  {
    morning: { start: "09:00", end: "12:00" },
    afternoon: { start: "12:00", end: "16:00" },
    evening: { start: "16:00", end: "20:00" },
  };

/** Smallest / largest slot length the save endpoint accepts. */
export const MIN_SLOT_MINUTES = 5;
export const MAX_SLOT_MINUTES = 240;

// ─── clock helpers ──────────────────────────────────────────────────────────

/**
 * Parse "HH:MM" to minutes. "24:00" is accepted only when `allowDayEnd` is
 * set, because it is meaningful solely as the end of the Evening session.
 */
export function parseClock(value: unknown, allowDayEnd = false): number | null {
  if (allowDayEnd && typeof value === "string" && /^24:00$/.test(value.trim())) {
    return DAY_END_MIN;
  }
  return parseTimeToMinutes(value);
}

/** Minutes → "HH:MM" (1440 → "24:00"). */
export function formatClock(minutes: number): string {
  const m = Math.max(0, Math.min(DAY_END_MIN, Math.round(minutes)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Minutes → "9:00 AM" for editor labels. 720 is noon, 0 and 1440 are midnight. */
export function formatClockLabel(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_END_MIN) + DAY_END_MIN) % DAY_END_MIN;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * Minutes → the booking slot label, e.g. "09:00 AM".
 *
 * Must equal `Date#toLocaleTimeString("en-US", { hour: "2-digit", minute:
 * "2-digit", hour12: true })`, which is what every stored `Appointment.timeSlot`
 * was written with: "already booked" is decided by comparing these strings.
 * Formatting by hand keeps it independent of the server's ICU data and time zone.
 */
export function formatSlotLabel(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_END_MIN) + DAY_END_MIN) % DAY_END_MIN;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "09:00 AM" / "9:00 pm" (any whitespace) → minutes from midnight, or null. */
export function parseSlotLabel(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?$/.exec(label.replace(/\s+/g, " ").trim());
  if (!match) return null;
  const h = Number(match[1]);
  const mm = Number(match[2]);
  if (h < 1 || h > 12 || mm > 59) return null;
  const pm = match[3].toLowerCase() === "p";
  return ((h % 12) + (pm ? 12 : 0)) * 60 + mm;
}

/** Which session a start time (minutes from midnight) belongs to. */
export function sessionOf(minutes: number): SessionKey {
  if (minutes < SESSION_BANDS.morning.endMin) return "morning";
  if (minutes < SESSION_BANDS.afternoon.endMin) return "afternoon";
  return "evening";
}

/** "12:00 AM – 12:00 PM" style range for a session band. */
export function bandRangeLabel(key: SessionKey): string {
  const band = SESSION_BANDS[key];
  return `${formatClockLabel(band.startMin)} – ${formatClockLabel(band.endMin)}`;
}

// ─── reading / deriving ─────────────────────────────────────────────────────

function defaultWindow(key: SessionKey, enabled = false): SessionWindow {
  return { enabled, ...DEFAULT_SESSION_WINDOWS[key] };
}

/**
 * Coerce the raw `sessions` column into DaySessions, or null when the row has
 * none (legacy) or it is unusable. The driver may hand back a JSON string or
 * an already-parsed object. Lenient by design: times are kept as written and
 * clamped to their band at generation time, so a slightly off value can never
 * take the booking page down.
 */
export function parseSessionsColumn(raw: unknown): DaySessions | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (!SESSION_KEYS.some((k) => obj[k] != null && typeof obj[k] === "object")) return null;

  const out = {} as DaySessions;
  for (const key of SESSION_KEYS) {
    const entry = obj[key];
    if (entry == null || typeof entry !== "object") {
      out[key] = defaultWindow(key);
      continue;
    }
    const e = entry as Record<string, unknown>;
    out[key] = {
      enabled: e.enabled === true || e.enabled === 1 || e.enabled === "1",
      start: typeof e.start === "string" ? e.start : DEFAULT_SESSION_WINDOWS[key].start,
      end: typeof e.end === "string" ? e.end : DEFAULT_SESSION_WINDOWS[key].end,
    };
  }
  return out;
}

/**
 * Split a legacy single window ("09:00" → "22:00") into the three sessions:
 * each session gets the part of the window that falls inside its band.
 * An unusable window yields the 09:00–18:00 default.
 */
export function deriveSessionsFromRange(startTime: unknown, endTime: unknown): DaySessions {
  const start = parseClock(startTime);
  const end = parseClock(endTime, true);
  if (start === null || end === null || end <= start) {
    return deriveSessionsFromRange("09:00", "18:00");
  }
  const out = {} as DaySessions;
  for (const key of SESSION_KEYS) {
    const band = SESSION_BANDS[key];
    const lo = Math.max(start, band.startMin);
    const hi = Math.min(end, band.endMin);
    out[key] =
      lo < hi
        ? { enabled: true, start: formatClock(lo), end: formatClock(hi) }
        : defaultWindow(key);
  }
  return out;
}

/** The editor's starting point for a newly switched-on weekday (09:00–18:00). */
export function defaultDaySessions(): DaySessions {
  return deriveSessionsFromRange("09:00", "18:00");
}

// ─── validation (save path) ─────────────────────────────────────────────────

export type SessionsValidation = { ok: true; sessions: DaySessions } | { ok: false; error: string };

/**
 * Strict check used before saving. Every enabled session needs a valid
 * start < end inside its own band; at least one session must be on. Disabled
 * sessions are kept when well-formed (so switching one back on restores it)
 * and reset to their default window otherwise. Times come back normalized.
 */
export function validateDaySessions(input: unknown): SessionsValidation {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Sessions are missing" };
  }
  const obj = input as Record<string, unknown>;
  const out = {} as DaySessions;
  let anyEnabled = false;

  for (const key of SESSION_KEYS) {
    const band = SESSION_BANDS[key];
    const entry = (obj[key] ?? {}) as Record<string, unknown>;
    const enabled = entry.enabled === true;
    const start = parseClock(entry.start);
    const end = parseClock(entry.end, key === "evening");
    const inBand =
      start !== null && end !== null && start >= band.startMin && end <= band.endMin && end > start;

    if (!enabled) {
      out[key] = inBand
        ? { enabled: false, start: formatClock(start), end: formatClock(end) }
        : defaultWindow(key);
      continue;
    }

    if (start === null || end === null) {
      return { ok: false, error: `${band.label}: enter a valid start and end time` };
    }
    if (start < band.startMin || end > band.endMin) {
      return {
        ok: false,
        error: `${band.label} session must stay between ${bandRangeLabel(key)}`,
      };
    }
    if (end <= start) {
      return { ok: false, error: `${band.label}: end time must be after start time` };
    }
    anyEnabled = true;
    out[key] = { enabled: true, start: formatClock(start), end: formatClock(end) };
  }

  if (!anyEnabled) return { ok: false, error: "Turn on at least one session" };
  return { ok: true, sessions: out };
}

/**
 * Earliest start / latest end across the enabled sessions, written to the
 * legacy `startTime` / `endTime` columns so anything still reading them sees a
 * sensible summary. "24:00" is stored as "23:59": those columns have always
 * held a 00:00–23:59 clock value.
 */
export function sessionsEnvelope(
  sessions: DaySessions,
): { startTime: string; endTime: string } | null {
  const windows = sessionWindows(sessions);
  if (windows.length === 0) return null;
  const startMin = windows[0].startMin;
  const endMin = Math.min(windows[windows.length - 1].endMin, DAY_END_MIN - 1);
  return { startTime: formatClock(startMin), endTime: formatClock(endMin) };
}

// ─── slot generation ────────────────────────────────────────────────────────

export interface TimeWindow {
  startMin: number;
  endMin: number;
}

/**
 * Enabled sessions as minute windows, clamped to their bands, ordered, with
 * back-to-back sessions merged (Morning ending at noon + Afternoon starting at
 * noon is one continuous stretch, so a slot may run across the boundary
 * instead of leaving a gap or double-booking the hand-over).
 */
export function sessionWindows(sessions: DaySessions): TimeWindow[] {
  const windows: TimeWindow[] = [];
  for (const key of SESSION_KEYS) {
    const win = sessions[key];
    if (!win?.enabled) continue;
    const band = SESSION_BANDS[key];
    const start = parseClock(win.start);
    const end = parseClock(win.end, key === "evening");
    if (start === null || end === null) continue;
    const lo = Math.max(start, band.startMin);
    const hi = Math.min(end, band.endMin);
    if (hi <= lo) continue;
    const last = windows[windows.length - 1];
    if (last && lo <= last.endMin) {
      last.endMin = Math.max(last.endMin, hi);
    } else {
      windows.push({ startMin: lo, endMin: hi });
    }
  }
  return windows;
}

export interface DaySlot {
  /** Slot start, minutes from midnight. */
  startMin: number;
  /** Session the slot starts in. */
  session: SessionKey;
}

/**
 * Bookable slots for a day configured with sessions: step through each
 * window from its start; a slot must finish inside the window (no slot runs
 * past the session's end or past midnight) and must not touch a break.
 */
export function generateSessionSlots(
  sessions: DaySessions,
  durationMin: number,
  breaks: readonly NormalizedBreak[] = [],
): DaySlot[] {
  const d = Math.round(Number(durationMin));
  if (!Number.isFinite(d) || d < 1) return [];
  const slots: DaySlot[] = [];
  for (const w of sessionWindows(sessions)) {
    for (let t = w.startMin; t + d <= w.endMin; t += d) {
      if (!overlapsBreak(t, d, breaks)) slots.push({ startMin: t, session: sessionOf(t) });
    }
  }
  return slots;
}

/**
 * The pre-sessions generator, kept bit-for-bit for rows without `sessions`:
 * one window, stepping while the slot START is before the end (so the final
 * slot may overrun closing time — existing schedules rely on it).
 */
export function generateLegacySlots(
  startMin: number,
  endMin: number,
  durationMin: number,
  breaks: readonly NormalizedBreak[] = [],
): DaySlot[] {
  const d = Number(durationMin);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || !Number.isFinite(d) || d <= 0) {
    return [];
  }
  const slots: DaySlot[] = [];
  for (let t = startMin; t < endMin; t += d) {
    if (!overlapsBreak(t, d, breaks)) slots.push({ startMin: t, session: sessionOf(t) });
  }
  return slots;
}

/** A `DoctorSchedule` row (or a ClinicHours-shaped stand-in) as read from the DB. */
export interface ScheduleRowLike {
  startTime?: unknown;
  endTime?: unknown;
  slotDuration?: unknown;
  breaks?: unknown;
  sessions?: unknown;
}

/**
 * The single entry point for both server slot generators: sessions when the
 * row has them, otherwise the legacy single window. Break-aware either way.
 */
export function resolveScheduleDaySlots(row: ScheduleRowLike): DaySlot[] {
  const duration = Number(row.slotDuration) || 30;
  const breaks = resolveBreaks(row.breaks);
  const sessions = parseSessionsColumn(row.sessions);
  if (sessions) return generateSessionSlots(sessions, duration, breaks);
  const start = parseClock(row.startTime);
  const end = parseClock(row.endTime, true);
  if (start === null || end === null) return [];
  return generateLegacySlots(start, end, duration, breaks);
}

/**
 * Candidate slots for one doctor on one weekday, before removing booked ones.
 *
 * - The weekday's DoctorSchedule row wins (sessions or legacy window).
 * - A doctor who HAS a weekly schedule but no row for this weekday is off that
 *   day. Previously such a day fell through to the clinic's opening hours, so
 *   a doctor who works Mon–Sat was still bookable on an open Sunday.
 * - Only a doctor with no schedule at all borrows the ClinicHours window, and
 *   failing that 09:00–17:00 in 30-minute slots (legacy behaviour).
 */
export function resolveDoctorDaySlots(input: {
  daySchedule: ScheduleRowLike | null;
  hasAnySchedule: boolean;
  clinicHours: { openTime?: unknown; closeTime?: unknown; slotDuration?: unknown } | null;
}): DaySlot[] {
  if (input.daySchedule) return resolveScheduleDaySlots(input.daySchedule);
  if (input.hasAnySchedule) return [];
  const ch = input.clinicHours;
  if (ch && ch.openTime && ch.closeTime) {
    return resolveScheduleDaySlots({
      startTime: ch.openTime,
      endTime: ch.closeTime,
      slotDuration: ch.slotDuration,
    });
  }
  return resolveScheduleDaySlots({ startTime: "09:00", endTime: "17:00", slotDuration: 30 });
}

/** Slot labels in day order, minus those already taken (compared as "09:00 AM" strings). */
export function freeSlotLabels(
  slots: readonly DaySlot[],
  bookedTimeSlots: readonly string[],
): string[] {
  const booked = new Set(bookedTimeSlots.map((s) => String(s ?? "").trim()));
  const out: string[] = [];
  for (const s of slots) {
    const label = formatSlotLabel(s.startMin);
    if (!booked.has(label)) out.push(label);
  }
  return out;
}

/** Slot counts for the editor preview, per session and in total. */
export function countSessionSlots(
  sessions: DaySessions,
  durationMin: number,
  breaks: readonly NormalizedBreak[] = [],
): { total: number; bySession: Record<SessionKey, number> } {
  const bySession: Record<SessionKey, number> = { morning: 0, afternoon: 0, evening: 0 };
  const slots = generateSessionSlots(sessions, durationMin, breaks);
  for (const s of slots) bySession[s.session] += 1;
  return { total: slots.length, bySession };
}

// ─── booking-page helpers ───────────────────────────────────────────────────

export interface SlotGroup {
  key: SessionKey;
  label: string;
  range: string;
  slots: string[];
}

/**
 * Group flat slot labels ("09:00 AM") under Morning / Afternoon / Evening in
 * day order, dropping empty sessions. Labels that cannot be parsed are kept
 * (appended to the Evening group) rather than silently hidden.
 */
export function groupSlotLabels(labels: readonly string[]): SlotGroup[] {
  const buckets: Record<SessionKey, string[]> = { morning: [], afternoon: [], evening: [] };
  for (const label of labels) {
    const min = parseSlotLabel(label);
    buckets[min === null ? "evening" : sessionOf(min)].push(label);
  }
  return SESSION_KEYS.filter((k) => buckets[k].length > 0).map((key) => ({
    key,
    label: SESSION_BANDS[key].label,
    range: bandRangeLabel(key),
    slots: buckets[key],
  }));
}

/** Local "YYYY-MM-DD" for a Date. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Remove slots that have already started when `dateKey` ("YYYY-MM-DD") is
 * today in the viewer's local time. Other dates pass through unchanged.
 */
export function dropElapsedSlots(labels: readonly string[], dateKey: string, now: Date): string[] {
  if (dateKey !== localDateKey(now)) return [...labels];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return labels.filter((label) => {
    const min = parseSlotLabel(label);
    return min === null || min > nowMin;
  });
}
