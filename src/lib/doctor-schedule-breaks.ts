/**
 * doctor-schedule-breaks.ts
 *
 * Pure, isomorphic helpers for reasoning about a DoctorSchedule's break list.
 *
 * Context: `DoctorSchedule.breaks` is a JSON column written by the practitioner
 * dashboard ("Add Break" / "Copy to days"). Before this module the breaks were
 * persisted and echoed back to the dashboard, but every slot-generation path
 * (`booking.ts`, `auth.ts`) read only `slotDuration` and ignored `breaks`
 * entirely. The dashboard therefore subtracted break minutes from its slot
 * *preview* while the public booking portal still handed out appointments in
 * the middle of a doctor's lunch.
 *
 * This module is intentionally PURE: no I/O, no imports from db/auth, so it
 * runs identically on client and server and is trivially unit-testable.
 */

/** A single break window on one weekday. */
export interface BreakSlot {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  label: string;
}

/** A break reduced to minutes-from-midnight, guaranteed non-empty and ordered. */
export interface NormalizedBreak {
  startMin: number;
  endMin: number;
  label: string;
}

/**
 * Parse "HH:MM" into minutes from midnight, or null when unparseable.
 * Accepts "9:05" as well as "09:05"; rejects out-of-range and non-numeric.
 */
export function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Coerce the raw `breaks` column into a BreakSlot[].
 *
 * The column is JSON, but the MariaDB driver may hand back either a string or
 * an already-parsed value depending on the connection, and legacy rows may hold
 * NULL. Anything malformed degrades to an empty list rather than throwing —
 * a corrupt break list must never take down the booking portal.
 */
export function parseBreaksColumn(raw: unknown): BreakSlot[] {
  if (raw == null) return [];

  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): BreakSlot[] => {
    if (entry == null || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const start = typeof candidate.start === "string" ? candidate.start : "";
    const end = typeof candidate.end === "string" ? candidate.end : "";
    const label = typeof candidate.label === "string" ? candidate.label : "";
    return [{ start, end, label }];
  });
}

/**
 * Drop incomplete/zero-length/inverted breaks and convert the survivors to
 * minute offsets. A break with end <= start is discarded rather than silently
 * swallowing the rest of the day.
 */
export function normalizeBreaks(breaks: readonly BreakSlot[]): NormalizedBreak[] {
  return breaks.flatMap((br): NormalizedBreak[] => {
    const startMin = parseTimeToMinutes(br?.start);
    const endMin = parseTimeToMinutes(br?.end);
    if (startMin === null || endMin === null) return [];
    if (endMin <= startMin) return [];
    return [{ startMin, endMin, label: br.label ?? "" }];
  });
}

/**
 * True when an appointment occupying [slotStartMin, slotStartMin + durationMin)
 * overlaps any break. Half-open intervals on both sides, so a slot that ends
 * exactly when a break begins (or begins exactly when one ends) is allowed.
 */
export function overlapsBreak(
  slotStartMin: number,
  durationMin: number,
  breaks: readonly NormalizedBreak[],
): boolean {
  const slotEndMin = slotStartMin + Math.max(durationMin, 0);
  return breaks.some((br) => slotStartMin < br.endMin && slotEndMin > br.startMin);
}

/**
 * Total minutes covered by the breaks, counting overlapping windows once.
 * Used for "N min break" summaries and work-minute maths.
 */
export function totalBreakMinutes(breaks: readonly NormalizedBreak[]): number {
  const sorted = [...breaks].sort((a, b) => a.startMin - b.startMin);
  let total = 0;
  let cursor = -1;
  for (const br of sorted) {
    const start = Math.max(br.startMin, cursor);
    if (br.endMin > start) {
      total += br.endMin - start;
      cursor = br.endMin;
    }
  }
  return total;
}

/**
 * The single entry point slot generators should use: given the raw DB column,
 * return the normalized breaks to test each candidate slot against.
 */
export function resolveBreaks(raw: unknown): NormalizedBreak[] {
  return normalizeBreaks(parseBreaksColumn(raw));
}

/**
 * Count the bookable slots in a working window, skipping any slot that
 * overlaps a break — walking the day exactly the way the server-side slot
 * generators do.
 *
 * The dashboard previously previewed `floor((span - breakMinutes) / duration)`,
 * which disagrees with reality whenever a break is not slot-aligned: a 13:10–
 * 13:50 break inside 30-minute slots costs the 13:00 AND 13:30 slots (60
 * minutes of capacity), not the 40 minutes the subtraction assumed. It also
 * counted breaks lying entirely outside the working window. Sharing this
 * function keeps the preview honest.
 */
export function countAvailableSlots(
  startMin: number,
  endMin: number,
  durationMin: number,
  breaks: readonly NormalizedBreak[],
): number {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return 0;
  if (durationMin <= 0 || endMin <= startMin) return 0;

  // `t < endMin` (not `t + durationMin <= endMin`) mirrors the generators'
  // `while (temp < endObj)`, so the preview reports the slots a patient can
  // actually book — including a final slot that overruns closing time.
  let count = 0;
  for (let t = startMin; t < endMin; t += durationMin) {
    if (!overlapsBreak(t, durationMin, breaks)) count += 1;
  }
  return count;
}
