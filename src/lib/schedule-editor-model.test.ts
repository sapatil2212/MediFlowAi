import { describe, expect, it } from "vitest";
import { deriveSessionsFromRange, type DaySessions } from "./day-sessions";
import {
  applyTemplateToActiveDays,
  copyBreakToDays,
  copyHoursToDays,
  editorDaysFromRows,
  isScheduleDirty,
  sessionTimeOptions,
  setEnabledDays,
  setSession,
  summarizeDay,
  templateFromDays,
  toSavePayload,
  updateSessionWindow,
  validateEditorDays,
  type EditorDay,
} from "./schedule-editor-model";

const LUNCH = { start: "13:00", end: "14:00", label: "Lunch" };

function swapnilRows() {
  return [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    startTime: "09:00",
    endTime: "22:00",
    slotDuration: 60,
    breaks: [LUNCH],
  }));
}

function eveningOnly(): DaySessions {
  return {
    morning: { enabled: false, start: "09:00", end: "12:00" },
    afternoon: { enabled: false, start: "12:00", end: "16:00" },
    evening: { enabled: true, start: "18:00", end: "21:00" },
  };
}

describe("editorDaysFromRows", () => {
  it("builds seven days and splits legacy rows into sessions", () => {
    const days = editorDaysFromRows(swapnilRows());
    expect(days).toHaveLength(7);
    expect(days[0].enabled).toBe(false);
    expect(days[1]).toEqual({
      dayOfWeek: 1,
      enabled: true,
      slotDuration: 60,
      sessions: deriveSessionsFromRange("09:00", "22:00"),
      breaks: [LUNCH],
    });
    // The editor shows the same 12 slots the dashboard showed before.
    expect(summarizeDay(days[1])).toEqual({
      total: 12,
      bySession: { morning: 3, afternoon: 3, evening: 6 },
    });
  });

  it("prefers saved sessions over the start/end envelope", () => {
    const days = editorDaysFromRows([
      {
        dayOfWeek: 3,
        startTime: "18:00",
        endTime: "21:00",
        slotDuration: 10,
        sessions: eveningOnly(),
      },
    ]);
    expect(days[3].sessions).toEqual(eveningOnly());
    expect(summarizeDay(days[3]).total).toBe(18);
  });

  it("tolerates a null response", () => {
    expect(editorDaysFromRows(null).every((d) => !d.enabled)).toBe(true);
  });
});

describe("editing", () => {
  it("presets switch exactly the chosen days on and keep their hours", () => {
    const days = setEnabledDays(editorDaysFromRows(swapnilRows()), [0, 6]);
    expect(days.filter((d) => d.enabled).map((d) => d.dayOfWeek)).toEqual([0, 6]);
    expect(days[6].slotDuration).toBe(60);
  });

  it("moving a start past the end pushes the end forward, capped at the band", () => {
    const w = { enabled: true, start: "09:00", end: "10:00" };
    expect(updateSessionWindow(w, "morning", { start: "10:30" }, 30)).toEqual({
      enabled: true,
      start: "10:30",
      end: "11:00",
    });
    expect(updateSessionWindow(w, "morning", { start: "11:45" }, 60)).toEqual({
      enabled: true,
      start: "11:45",
      end: "12:00",
    });
    expect(updateSessionWindow(w, "morning", { end: "08:00" }, 30)).toEqual({
      enabled: true,
      start: "07:30",
      end: "08:00",
    });
  });

  it("setSession only touches one session of one day", () => {
    const before = editorDaysFromRows(swapnilRows());
    const after = setSession(before, 2, "evening", { enabled: false });
    expect(after[2].sessions.evening.enabled).toBe(false);
    expect(after[3].sessions.evening.enabled).toBe(true);
    expect(before[2].sessions.evening.enabled).toBe(true);
  });

  it("applying a template changes active days only and never shares objects", () => {
    const days = applyTemplateToActiveDays(editorDaysFromRows(swapnilRows()), eveningOnly(), 15);
    expect(days[0].enabled).toBe(false);
    expect(days[0].sessions).toEqual(deriveSessionsFromRange("09:00", "18:00"));
    expect(days[1].sessions).toEqual(eveningOnly());
    expect(days[1].slotDuration).toBe(15);
    expect(days[1].sessions).not.toBe(days[2].sessions);
    expect(days[1].sessions.evening).not.toBe(days[2].sessions.evening);
  });

  it("copies one day's hours without touching the target's breaks", () => {
    let days = editorDaysFromRows(swapnilRows());
    days = setSession(days, 1, "morning", { enabled: false });
    days = copyHoursToDays(days, 1, [2, 1]);
    expect(days[2].sessions.morning.enabled).toBe(false);
    expect(days[2].breaks).toEqual([LUNCH]);
  });

  it("copying a break appends and stays idempotent", () => {
    let days = editorDaysFromRows(swapnilRows());
    days = copyBreakToDays(days, 1, 0, [2, 3]);
    expect(days[2].breaks).toEqual([LUNCH]);
    const tea = { start: "17:00", end: "17:15", label: "Tea" };
    days = days.map((d) => (d.dayOfWeek === 1 ? { ...d, breaks: [...d.breaks, tea] } : d));
    days = copyBreakToDays(days, 1, 1, [2]);
    days = copyBreakToDays(days, 1, 1, [2]);
    expect(days[2].breaks).toEqual([LUNCH, tea]);
  });

  it("detects unsaved changes", () => {
    const a = editorDaysFromRows(swapnilRows());
    expect(isScheduleDirty(a, editorDaysFromRows(swapnilRows()))).toBe(false);
    expect(isScheduleDirty(a, setEnabledDays(a, [1]))).toBe(true);
  });

  it("seeds the template from the first active day", () => {
    expect(templateFromDays(editorDaysFromRows(swapnilRows())).slotDuration).toBe(60);
    expect(templateFromDays(editorDaysFromRows([])).slotDuration).toBe(30);
  });
});

describe("validateEditorDays", () => {
  const base = (): EditorDay[] => editorDaysFromRows(swapnilRows());

  it("passes a valid week", () => {
    expect(validateEditorDays(base())).toEqual({});
  });

  it("flags a day where no slot fits", () => {
    let days = applyTemplateToActiveDays(base(), eveningOnly(), 240);
    days = setSession(days, 1, "evening", { start: "20:00", end: "21:00" });
    expect(validateEditorDays(days)[1]).toMatch(/No 240-minute slot fits on Monday/);
  });

  it("flags an incomplete or inverted break but ignores a blank one", () => {
    const days = base();
    days[1] = { ...days[1], breaks: [{ start: "15:00", end: "14:00", label: "" }] };
    days[2] = { ...days[2], breaks: [{ start: "15:00", end: "", label: "Tea" }] };
    days[3] = { ...days[3], breaks: [{ start: "", end: "", label: "" }] };
    const errors = validateEditorDays(days);
    expect(errors[1]).toBe('"Break": end time must be after start time');
    expect(errors[2]).toBe('Set both times for "Tea"');
    expect(errors[3]).toBeUndefined();
  });

  it("flags a day with every session off; ignores disabled days", () => {
    let days = base();
    for (const k of ["morning", "afternoon", "evening"] as const) {
      days = setSession(days, 4, k, { enabled: false });
      days = setSession(days, 0, k, { enabled: false });
    }
    const errors = validateEditorDays(days);
    expect(errors[4]).toBe("Turn on at least one session");
    expect(errors[0]).toBeUndefined();
  });
});

describe("toSavePayload", () => {
  it("sends enabled days with sessions, envelope times and non-blank breaks", () => {
    const days = base2();
    const payload = toSavePayload(days);
    expect(payload.map((p) => p.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(payload[0]).toEqual({
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "22:00",
      slotDuration: 60,
      sessions: deriveSessionsFromRange("09:00", "22:00"),
      breaks: [LUNCH],
    });
    expect(payload[1].endTime).toBe("23:59");
  });

  function base2(): EditorDay[] {
    let days = editorDaysFromRows(swapnilRows());
    days = setSession(days, 2, "evening", { end: "24:00" });
    days[1] = { ...days[1], breaks: [...days[1].breaks, { start: "", end: "", label: "" }] };
    return days;
  }
});

describe("sessionTimeOptions", () => {
  it("offers 15-minute steps inside the band", () => {
    const starts = sessionTimeOptions("morning", "start");
    expect(starts[0]).toBe("00:00");
    expect(starts[starts.length - 1]).toBe("11:45");
    const ends = sessionTimeOptions("afternoon", "end");
    expect(ends[0]).toBe("12:15");
    expect(ends[ends.length - 1]).toBe("16:00");
    expect(sessionTimeOptions("evening", "end").at(-1)).toBe("24:00");
  });

  it("keeps an off-grid saved value selectable", () => {
    expect(sessionTimeOptions("evening", "start", 15, "18:10")).toContain("18:10");
    expect(sessionTimeOptions("evening", "start", 15, "09:10")).not.toContain("09:10");
  });
});
