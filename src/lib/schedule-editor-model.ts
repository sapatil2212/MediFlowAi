/**
 * schedule-editor-model.ts
 *
 * Pure state helpers behind the Weekly Availability Schedule editor (shared
 * by every dashboard). Each weekday holds three sessions, one slot length and
 * a break list. Kept free of React so the rules are unit-testable and the
 * editor component stays a thin view.
 */
import { normalizeBreaks, type BreakSlot } from "./doctor-schedule-breaks";
import {
  MAX_SLOT_MINUTES,
  MIN_SLOT_MINUTES,
  SESSION_BANDS,
  countSessionSlots,
  defaultDaySessions,
  deriveSessionsFromRange,
  formatClock,
  parseClock,
  parseSessionsColumn,
  sessionsEnvelope,
  validateDaySessions,
  type DaySessions,
  type SessionKey,
  type SessionWindow,
} from "./day-sessions";

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Slot lengths offered by the editor (minutes). */
export const SLOT_LENGTH_OPTIONS = [5, 8, 10, 15, 20, 30, 45, 60, 90, 120] as const;

export const DEFAULT_SLOT_MINUTES = 30;

export interface EditorDay {
  dayOfWeek: number;
  enabled: boolean;
  slotDuration: number;
  sessions: DaySessions;
  breaks: BreakSlot[];
}

/** Row shape returned by `getDoctorScheduleServerFn`. */
export interface ScheduleRowInput {
  dayOfWeek: number;
  startTime?: string | null;
  endTime?: string | null;
  slotDuration?: number | null;
  breaks?: BreakSlot[] | null;
  sessions?: unknown;
}

/** Payload row accepted by `saveDoctorScheduleServerFn`. */
export interface ScheduleSaveRow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDuration: number;
  sessions: DaySessions;
  breaks: BreakSlot[];
}

function cloneSessions(s: DaySessions): DaySessions {
  return {
    morning: { ...s.morning },
    afternoon: { ...s.afternoon },
    evening: { ...s.evening },
  };
}

function blankDay(dayOfWeek: number): EditorDay {
  return {
    dayOfWeek,
    enabled: false,
    slotDuration: DEFAULT_SLOT_MINUTES,
    sessions: defaultDaySessions(),
    breaks: [],
  };
}

/**
 * Seven editor days from the saved rows. A weekday with no row is off. Rows
 * saved before sessions existed get their single window split into sessions.
 */
export function editorDaysFromRows(
  rows: readonly ScheduleRowInput[] | null | undefined,
): EditorDay[] {
  return Array.from({ length: 7 }, (_, day) => {
    const row = (rows ?? []).find((r) => Number(r?.dayOfWeek) === day);
    if (!row) return blankDay(day);
    const slot = Math.round(Number(row.slotDuration) || DEFAULT_SLOT_MINUTES);
    return {
      dayOfWeek: day,
      enabled: true,
      slotDuration: slot,
      sessions:
        parseSessionsColumn(row.sessions) ?? deriveSessionsFromRange(row.startTime, row.endTime),
      breaks: Array.isArray(row.breaks)
        ? row.breaks.map((b) => ({
            start: String(b?.start ?? ""),
            end: String(b?.end ?? ""),
            label: String(b?.label ?? ""),
          }))
        : [],
    };
  });
}

function mapDay(days: EditorDay[], day: number, fn: (d: EditorDay) => EditorDay): EditorDay[] {
  return days.map((d) => (d.dayOfWeek === day ? fn(d) : d));
}

/** Quick presets: exactly these weekdays on, the rest off. Hours are kept. */
export function setEnabledDays(days: EditorDay[], enabledDays: readonly number[]): EditorDay[] {
  return days.map((d) => ({ ...d, enabled: enabledDays.includes(d.dayOfWeek) }));
}

export function toggleDay(days: EditorDay[], day: number): EditorDay[] {
  return mapDay(days, day, (d) => ({ ...d, enabled: !d.enabled }));
}

export function setSlotDuration(days: EditorDay[], day: number, minutes: number): EditorDay[] {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 1) return days;
  return mapDay(days, day, (d) => ({ ...d, slotDuration: m }));
}

/**
 * Change one session's window. Keeps the window valid while editing: moving
 * the start to or past the end pushes the end forward (by one slot, capped at
 * the band end), and moving the end to or before the start pulls the start
 * back the same way.
 */
export function updateSessionWindow(
  window: SessionWindow,
  key: SessionKey,
  patch: Partial<SessionWindow>,
  slotDuration: number,
): SessionWindow {
  const band = SESSION_BANDS[key];
  const next: SessionWindow = { ...window, ...patch };
  const step = Math.max(5, Math.min(Math.round(slotDuration) || DEFAULT_SLOT_MINUTES, 120));
  const start = parseClock(next.start);
  const end = parseClock(next.end, key === "evening");
  if (start === null || end === null || end > start) return next;
  if (patch.start !== undefined) {
    const pushed = Math.min(band.endMin, start + step);
    if (pushed > start) return { ...next, end: formatClock(pushed) };
  }
  if (patch.end !== undefined) {
    const pulled = Math.max(band.startMin, end - step);
    if (pulled < end) return { ...next, start: formatClock(pulled) };
  }
  return next;
}

export function setSession(
  days: EditorDay[],
  day: number,
  key: SessionKey,
  patch: Partial<SessionWindow>,
): EditorDay[] {
  return mapDay(days, day, (d) => ({
    ...d,
    sessions: {
      ...d.sessions,
      [key]: updateSessionWindow(d.sessions[key], key, patch, d.slotDuration),
    },
  }));
}

/** "Apply to all active days": same sessions and slot length on every enabled day. */
export function applyTemplateToActiveDays(
  days: EditorDay[],
  sessions: DaySessions,
  slotDuration: number,
): EditorDay[] {
  return days.map((d) =>
    d.enabled ? { ...d, sessions: cloneSessions(sessions), slotDuration } : d,
  );
}

/** Copy one day's sessions + slot length onto other days (their breaks stay). */
export function copyHoursToDays(
  days: EditorDay[],
  fromDay: number,
  toDays: readonly number[],
): EditorDay[] {
  const source = days.find((d) => d.dayOfWeek === fromDay);
  if (!source) return days;
  return days.map((d) =>
    toDays.includes(d.dayOfWeek) && d.dayOfWeek !== fromDay
      ? { ...d, sessions: cloneSessions(source.sessions), slotDuration: source.slotDuration }
      : d,
  );
}

export function addBreak(days: EditorDay[], day: number, br: BreakSlot): EditorDay[] {
  return mapDay(days, day, (d) => ({ ...d, breaks: [...d.breaks, { ...br }] }));
}

export function updateBreak(
  days: EditorDay[],
  day: number,
  index: number,
  patch: Partial<BreakSlot>,
): EditorDay[] {
  return mapDay(days, day, (d) => ({
    ...d,
    breaks: d.breaks.map((b, i) => (i === index ? { ...b, ...patch } : b)),
  }));
}

export function removeBreak(days: EditorDay[], day: number, index: number): EditorDay[] {
  return mapDay(days, day, (d) => ({ ...d, breaks: d.breaks.filter((_, i) => i !== index) }));
}

/**
 * Copy ONE break onto other days. Appends (never replaces the target day's
 * own breaks) and skips exact duplicates so repeated clicks are idempotent.
 */
export function copyBreakToDays(
  days: EditorDay[],
  fromDay: number,
  index: number,
  toDays: readonly number[],
): EditorDay[] {
  const br = days.find((d) => d.dayOfWeek === fromDay)?.breaks[index];
  if (!br) return days;
  return days.map((d) => {
    if (!toDays.includes(d.dayOfWeek) || d.dayOfWeek === fromDay) return d;
    const dup = d.breaks.some(
      (b) => b.start === br.start && b.end === br.end && b.label === br.label,
    );
    return dup ? d : { ...d, breaks: [...d.breaks, { ...br }] };
  });
}

/**
 * The window a new break starts with: Lunch 1–2 PM first, then a short
 * 4:00–4:30 PM break. Always a real window, because empty times are dropped
 * on save and a blank row would vanish without explanation.
 */
export function suggestBreak(existingCount: number): BreakSlot {
  if (existingCount === 0) return { start: "13:00", end: "14:00", label: "Lunch" };
  return { start: "16:00", end: "16:30", label: "Break" };
}

export interface DaySummary {
  total: number;
  bySession: Record<SessionKey, number>;
}

export function summarizeDay(day: EditorDay): DaySummary {
  return countSessionSlots(day.sessions, day.slotDuration, normalizeBreaks(day.breaks));
}

/**
 * Per-day problems that would block saving, keyed by weekday. Mirrors the
 * server's checks so the user sees them before pressing Save.
 */
export function validateEditorDays(days: readonly EditorDay[]): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const d of days) {
    if (!d.enabled) continue;
    const name = WEEKDAY_NAMES[d.dayOfWeek];
    const v = validateDaySessions(d.sessions);
    if (!v.ok) {
      errors[d.dayOfWeek] = v.error;
      continue;
    }
    if (d.slotDuration < MIN_SLOT_MINUTES || d.slotDuration > MAX_SLOT_MINUTES) {
      errors[d.dayOfWeek] = `Slot length must be ${MIN_SLOT_MINUTES}–${MAX_SLOT_MINUTES} minutes`;
      continue;
    }
    const badBreak = d.breaks.find((b) => !isBlankBreak(b) && normalizeBreaks([b]).length === 0);
    if (badBreak) {
      const name = badBreak.label.trim() || "Break";
      errors[d.dayOfWeek] =
        !badBreak.start || !badBreak.end
          ? `Set both times for "${name}"`
          : `"${name}": end time must be after start time`;
      continue;
    }
    if (summarizeDay(d).total === 0) {
      errors[d.dayOfWeek] =
        `No ${d.slotDuration}-minute slot fits on ${name}. Lengthen a session, shorten the slot or remove a break.`;
    }
  }
  return errors;
}

/** Enabled days in the shape `saveDoctorScheduleServerFn` expects. */
export function toSavePayload(days: readonly EditorDay[]): ScheduleSaveRow[] {
  return days
    .filter((d) => d.enabled)
    .map((d) => {
      const v = validateDaySessions(d.sessions);
      const sessions = v.ok ? v.sessions : d.sessions;
      const env = sessionsEnvelope(sessions) ?? { startTime: "09:00", endTime: "18:00" };
      return {
        dayOfWeek: d.dayOfWeek,
        startTime: env.startTime,
        endTime: env.endTime,
        slotDuration: d.slotDuration,
        sessions,
        breaks: d.breaks.filter((b) => !isBlankBreak(b)),
      };
    });
}

/** A break row with neither time set is ignored rather than reported. */
function isBlankBreak(b: BreakSlot): boolean {
  return !b.start && !b.end;
}

/** True when the editor state differs from what was loaded. */
export function isScheduleDirty(a: readonly EditorDay[], b: readonly EditorDay[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Time options for a session's start or end picker, in `step`-minute steps. */
export function sessionTimeOptions(
  key: SessionKey,
  which: "start" | "end",
  step = 15,
  keep?: string,
): string[] {
  const band = SESSION_BANDS[key];
  const from = which === "start" ? band.startMin : band.startMin + step;
  const to = which === "start" ? band.endMin - step : band.endMin;
  const values = new Set<number>();
  for (let m = from; m <= to; m += step) values.add(m);
  // An off-grid saved value (e.g. 18:10) must stay selectable, not silently change.
  const kept = parseClock(keep, which === "end" && key === "evening");
  if (kept !== null && kept >= band.startMin && kept <= band.endMin) values.add(kept);
  return [...values].sort((x, y) => x - y).map(formatClock);
}

/**
 * Starting values for the "apply to all active days" panel: the first enabled
 * day's sessions and slot length, or the 09:00–18:00 default.
 */
export function templateFromDays(days: readonly EditorDay[]): {
  sessions: DaySessions;
  slotDuration: number;
} {
  const first = days.find((d) => d.enabled);
  if (first) return { sessions: cloneSessions(first.sessions), slotDuration: first.slotDuration };
  return { sessions: defaultDaySessions(), slotDuration: DEFAULT_SLOT_MINUTES };
}
