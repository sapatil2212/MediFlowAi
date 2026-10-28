// Timezone-correct scheduling: wall-clock ↔ UTC conversion (incl. DST gaps and
// overlaps), day-before reminder windows, "tomorrow" checks at midnight edges,
// and template date/time formatting.
import { describe, expect, it } from "vitest";
import {
  computeDayBeforeDueMs,
  computeHoursBeforeDueMs,
  formatTemplateDate,
  formatTemplateTime,
  hasTimeOfDay,
  isTomorrowLocal,
  normalizeSlotLabel,
  parseWallClock,
  resolveTimeZone,
  wallClockToUtcMs,
  zonedParts,
} from "./notify-time";

const IST = "Asia/Kolkata";
const NY = "America/New_York";
const w = (s: string) => parseWallClock(s)!;
const iso = (ms: number) => new Date(ms).toISOString();

describe("wall clock ↔ UTC", () => {
  it("converts IST wall-clock time to the right instant", () => {
    expect(iso(wallClockToUtcMs(w("2026-10-28 10:30:00"), IST))).toBe("2026-10-28T05:00:00.000Z");
    expect(iso(wallClockToUtcMs(w("2026-10-28 00:15:00"), IST))).toBe("2026-10-27T18:45:00.000Z");
  });

  it("handles a daylight-saving spring-forward gap", () => {
    // 02:30 does not exist on 8 Mar 2026 in New York; it resolves after the gap.
    const ms = wallClockToUtcMs(w("2026-03-08 02:30:00"), NY);
    const p = zonedParts(ms, NY);
    expect(p.hour === 3 || p.hour === 1).toBe(true);
  });

  it("picks the earlier instant for an ambiguous fall-back time", () => {
    // 01:30 occurs twice on 1 Nov 2026 in New York (EDT then EST).
    expect(iso(wallClockToUtcMs(w("2026-11-01 01:30:00"), NY))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("round-trips ordinary times in a DST zone", () => {
    const ms = wallClockToUtcMs(w("2026-07-04 18:45:00"), NY);
    expect(zonedParts(ms, NY)).toMatchObject({
      year: 2026,
      month: 7,
      day: 4,
      hour: 18,
      minute: 45,
    });
  });

  it("falls back to Asia/Kolkata for an unknown zone", () => {
    expect(resolveTimeZone("Not/AZone")).toBe(IST);
    expect(resolveTimeZone(null)).toBe(IST);
  });
});

describe("reminder due times", () => {
  it("sends the day-before reminder 24h earlier on the previous local day", () => {
    const due = computeDayBeforeDueMs(w("2026-10-28 10:30:00"), IST);
    expect(zonedParts(due, IST)).toMatchObject({ day: 27, hour: 10, minute: 30 });
  });

  it("clamps early and late appointments into the 08:00–21:00 window of the previous day", () => {
    expect(zonedParts(computeDayBeforeDueMs(w("2026-10-28 06:00:00"), IST), IST)).toMatchObject({
      day: 27,
      hour: 8,
      minute: 0,
    });
    expect(zonedParts(computeDayBeforeDueMs(w("2026-10-28 23:30:00"), IST), IST)).toMatchObject({
      day: 27,
      hour: 21,
      minute: 0,
    });
    // Date-only bookings (midnight) remind at 08:00 the day before.
    expect(zonedParts(computeDayBeforeDueMs(w("2026-10-28 00:00:00"), IST), IST)).toMatchObject({
      day: 27,
      hour: 8,
    });
  });

  it("keeps the day-before reminder on the previous local day across a DST change", () => {
    const due = computeDayBeforeDueMs(w("2026-03-09 10:00:00"), NY);
    expect(zonedParts(due, NY)).toMatchObject({ day: 8, hour: 10 });
  });

  it("computes the same-day reminder lead time", () => {
    const due = computeHoursBeforeDueMs(w("2026-10-28 10:30:00"), IST, 2);
    expect(zonedParts(due, IST)).toMatchObject({ day: 28, hour: 8, minute: 30 });
  });

  it("judges 'tomorrow' in the tenant timezone, not UTC", () => {
    // 2026-10-27 23:00 IST is still the 27th locally (17:30Z).
    const lateEvening = Date.parse("2026-10-27T17:30:00Z");
    expect(isTomorrowLocal(w("2026-10-28 10:30:00"), lateEvening, IST)).toBe(true);
    // 00:30 IST on the 28th: the appointment is today, no longer tomorrow.
    const afterMidnight = Date.parse("2026-10-27T19:00:00Z");
    expect(isTomorrowLocal(w("2026-10-28 10:30:00"), afterMidnight, IST)).toBe(false);
  });
});

describe("template formatting", () => {
  it("formats dates like the approved samples", () => {
    expect(formatTemplateDate({ year: 2026, month: 10, day: 28 })).toBe("28 October 2026");
  });

  it.each([
    ["10:30 AM", "10:30 AM"],
    ["09:30 AM", "9:30 AM"],
    ["12:15 pm", "12:15 PM"],
    ["12:05 AM", "12:05 AM"],
    ["14:30", "2:30 PM"],
    ["00:30", "12:30 AM"],
    ["25:00", null],
    ["soon", null],
  ])("normalizes slot %s → %s", (input, out) => {
    expect(normalizeSlotLabel(input)).toBe(out);
  });

  it("formats wall-clock times", () => {
    expect(formatTemplateTime({ hour: 0, minute: 5 })).toBe("12:05 AM");
    expect(formatTemplateTime({ hour: 18, minute: 30 })).toBe("6:30 PM");
  });

  it("recognises date-only bookings", () => {
    expect(hasTimeOfDay(w("2026-10-28 00:00:00"), null)).toBe(false);
    expect(hasTimeOfDay(w("2026-10-28 00:00:00"), "12:00 AM")).toBe(true);
    expect(hasTimeOfDay(w("2026-10-28 09:00:00"), null)).toBe(true);
  });
});
