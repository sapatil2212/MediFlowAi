import { describe, expect, it } from "vitest";
import { normalizeBreaks, overlapsBreak, type NormalizedBreak } from "./doctor-schedule-breaks";
import {
  DAY_END_MIN,
  SESSION_BANDS,
  bandRangeLabel,
  deriveSessionsFromRange,
  dropElapsedSlots,
  formatClock,
  formatClockLabel,
  formatSlotLabel,
  freeSlotLabels,
  generateLegacySlots,
  generateSessionSlots,
  groupSlotLabels,
  parseClock,
  parseSessionsColumn,
  parseSlotLabel,
  resolveDoctorDaySlots,
  resolveScheduleDaySlots,
  sessionOf,
  sessionWindows,
  sessionsEnvelope,
  validateDaySessions,
  type DaySessions,
} from "./day-sessions";

const LUNCH = normalizeBreaks([{ start: "13:00", end: "14:00", label: "Lunch" }]);

function sessions(
  m: [boolean, string, string],
  a: [boolean, string, string],
  e: [boolean, string, string],
): DaySessions {
  return {
    morning: { enabled: m[0], start: m[1], end: m[2] },
    afternoon: { enabled: a[0], start: a[1], end: a[2] },
    evening: { enabled: e[0], start: e[1], end: e[2] },
  };
}

const labels = (slots: { startMin: number }[]) => slots.map((s) => formatSlotLabel(s.startMin));

/** The slot loop both server generators ran before sessions existed. */
function oldGenerator(start: string, end: string, duration: number, breaks: NormalizedBreak[]) {
  const day = new Date(2026, 10, 9);
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startObj = new Date(day);
  startObj.setHours(sh, sm, 0, 0);
  const endObj = new Date(day);
  endObj.setHours(eh, em, 0, 0);
  const out: string[] = [];
  const temp = new Date(startObj);
  while (temp < endObj) {
    const label = temp.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    if (!overlapsBreak(temp.getHours() * 60 + temp.getMinutes(), duration, breaks)) out.push(label);
    temp.setMinutes(temp.getMinutes() + duration);
  }
  return out;
}

describe("session bands", () => {
  it("split the day at noon and 4 PM", () => {
    expect(SESSION_BANDS.morning).toMatchObject({ startMin: 0, endMin: 720 });
    expect(SESSION_BANDS.afternoon).toMatchObject({ startMin: 720, endMin: 960 });
    expect(SESSION_BANDS.evening).toMatchObject({ startMin: 960, endMin: DAY_END_MIN });
  });

  it("assign each minute to exactly one session", () => {
    expect(sessionOf(0)).toBe("morning");
    expect(sessionOf(719)).toBe("morning");
    expect(sessionOf(720)).toBe("afternoon");
    expect(sessionOf(959)).toBe("afternoon");
    expect(sessionOf(960)).toBe("evening");
    expect(sessionOf(1439)).toBe("evening");
  });

  it("label their ranges in 12-hour time", () => {
    expect(bandRangeLabel("morning")).toBe("12:00 AM – 12:00 PM");
    expect(bandRangeLabel("afternoon")).toBe("12:00 PM – 4:00 PM");
    expect(bandRangeLabel("evening")).toBe("4:00 PM – 12:00 AM");
  });
});

describe("clock helpers", () => {
  it("accept 24:00 only as an end-of-day value", () => {
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("24:00", true)).toBe(1440);
    expect(parseClock("24:01", true)).toBeNull();
    expect(parseClock("9:05")).toBe(545);
    expect(formatClock(1440)).toBe("24:00");
    expect(formatClock(545)).toBe("09:05");
    expect(formatClockLabel(0)).toBe("12:00 AM");
    expect(formatClockLabel(720)).toBe("12:00 PM");
    expect(formatClockLabel(1305)).toBe("9:45 PM");
  });

  it("format slot labels exactly like toLocaleTimeString (every minute of the day)", () => {
    for (let m = 0; m < DAY_END_MIN; m++) {
      const expected = new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(
        "en-US",
        { hour: "2-digit", minute: "2-digit", hour12: true },
      );
      expect(formatSlotLabel(m)).toBe(expected);
      expect(parseSlotLabel(expected)).toBe(m);
    }
  });

  it("parse loose slot labels and reject junk", () => {
    expect(parseSlotLabel("9:00 pm")).toBe(21 * 60);
    expect(parseSlotLabel("12:00\u202fAM")).toBe(0);
    expect(parseSlotLabel("13:00 PM")).toBeNull();
    expect(parseSlotLabel("")).toBeNull();
    expect(parseSlotLabel(null)).toBeNull();
  });
});

describe("parseSessionsColumn", () => {
  it("returns null for legacy / unusable values", () => {
    expect(parseSessionsColumn(null)).toBeNull();
    expect(parseSessionsColumn("")).toBeNull();
    expect(parseSessionsColumn("not json")).toBeNull();
    expect(parseSessionsColumn("[]")).toBeNull();
    expect(parseSessionsColumn({ foo: 1 })).toBeNull();
  });

  it("reads a JSON string or an already-parsed object", () => {
    const s = sessions(
      [true, "09:00", "12:00"],
      [false, "12:00", "16:00"],
      [true, "17:00", "21:00"],
    );
    expect(parseSessionsColumn(JSON.stringify(s))).toEqual(s);
    expect(parseSessionsColumn(s)).toEqual(s);
  });

  it("fills a missing session with its disabled default", () => {
    const parsed = parseSessionsColumn({
      evening: { enabled: true, start: "18:00", end: "21:00" },
    });
    expect(parsed?.morning).toEqual({ enabled: false, start: "09:00", end: "12:00" });
    expect(parsed?.evening).toEqual({ enabled: true, start: "18:00", end: "21:00" });
  });
});

describe("deriveSessionsFromRange (legacy rows)", () => {
  it("splits a long day across all three sessions", () => {
    expect(deriveSessionsFromRange("09:00", "22:00")).toEqual(
      sessions([true, "09:00", "12:00"], [true, "12:00", "16:00"], [true, "16:00", "22:00"]),
    );
  });

  it("keeps an evening-only clinic in the evening", () => {
    const s = deriveSessionsFromRange("18:00", "21:00");
    expect(s.morning.enabled).toBe(false);
    expect(s.afternoon.enabled).toBe(false);
    expect(s.evening).toEqual({ enabled: true, start: "18:00", end: "21:00" });
  });

  it("falls back to 09:00–18:00 for an unusable window", () => {
    expect(deriveSessionsFromRange("18:00", "09:00")).toEqual(
      deriveSessionsFromRange("09:00", "18:00"),
    );
    expect(deriveSessionsFromRange(undefined, "x")).toEqual(
      deriveSessionsFromRange("09:00", "18:00"),
    );
  });
});

describe("validateDaySessions", () => {
  it("normalizes valid input", () => {
    const r = validateDaySessions(
      sessions([true, "9:00", "12:00"], [false, "12:00", "16:00"], [true, "16:00", "24:00"]),
    );
    expect(r).toEqual({
      ok: true,
      sessions: sessions(
        [true, "09:00", "12:00"],
        [false, "12:00", "16:00"],
        [true, "16:00", "24:00"],
      ),
    });
  });

  it("rejects a session that leaves its band", () => {
    const morning = validateDaySessions(
      sessions([true, "09:00", "12:30"], [false, "12:00", "16:00"], [false, "16:00", "20:00"]),
    );
    expect(morning).toEqual({
      ok: false,
      error: "Morning session must stay between 12:00 AM – 12:00 PM",
    });
    const afternoon = validateDaySessions(
      sessions([false, "09:00", "12:00"], [true, "11:00", "16:00"], [false, "16:00", "20:00"]),
    );
    expect(afternoon.ok).toBe(false);
  });

  it("rejects inverted windows, 24:00 outside the evening, and no session at all", () => {
    expect(
      validateDaySessions(
        sessions([true, "11:00", "10:00"], [false, "12:00", "16:00"], [false, "16:00", "20:00"]),
      ),
    ).toEqual({ ok: false, error: "Morning: end time must be after start time" });
    expect(
      validateDaySessions(
        sessions([false, "09:00", "12:00"], [true, "12:00", "24:00"], [false, "16:00", "20:00"]),
      ).ok,
    ).toBe(false);
    expect(
      validateDaySessions(
        sessions([false, "09:00", "12:00"], [false, "12:00", "16:00"], [false, "16:00", "20:00"]),
      ),
    ).toEqual({ ok: false, error: "Turn on at least one session" });
    expect(validateDaySessions(null).ok).toBe(false);
    expect(validateDaySessions([]).ok).toBe(false);
  });

  it("resets a malformed disabled session instead of rejecting the day", () => {
    const r = validateDaySessions(
      sessions([false, "junk", "??"], [true, "12:00", "16:00"], [false, "16:00", "20:00"]),
    );
    expect(r.ok && r.sessions.morning).toEqual({ enabled: false, start: "09:00", end: "12:00" });
  });
});

describe("sessionWindows / sessionsEnvelope", () => {
  it("merges back-to-back sessions and keeps gaps", () => {
    expect(
      sessionWindows(
        sessions([true, "09:00", "12:00"], [true, "12:00", "14:00"], [true, "17:00", "21:00"]),
      ),
    ).toEqual([
      { startMin: 540, endMin: 840 },
      { startMin: 1020, endMin: 1260 },
    ]);
  });

  it("clamps stored windows to their band", () => {
    expect(
      sessionWindows(
        sessions([true, "09:00", "13:00"], [false, "12:00", "16:00"], [false, "16:00", "20:00"]),
      ),
    ).toEqual([{ startMin: 540, endMin: 720 }]);
  });

  it("summarizes to earliest start / latest end, storing midnight as 23:59", () => {
    expect(
      sessionsEnvelope(
        sessions([true, "10:00", "12:00"], [false, "12:00", "16:00"], [true, "18:00", "24:00"]),
      ),
    ).toEqual({ startTime: "10:00", endTime: "23:59" });
    expect(
      sessionsEnvelope(
        sessions([false, "10:00", "12:00"], [false, "12:00", "16:00"], [false, "18:00", "24:00"]),
      ),
    ).toBeNull();
  });
});

describe("generateSessionSlots", () => {
  it("reproduces Swapnil Patil's live schedule (09–22, 60 min, lunch 13–14) = 12 slots", () => {
    const s = deriveSessionsFromRange("09:00", "22:00");
    const slots = generateSessionSlots(s, 60, LUNCH);
    expect(labels(slots)).toEqual([
      "09:00 AM",
      "10:00 AM",
      "11:00 AM",
      "12:00 PM",
      "02:00 PM",
      "03:00 PM",
      "04:00 PM",
      "05:00 PM",
      "06:00 PM",
      "07:00 PM",
      "08:00 PM",
      "09:00 PM",
    ]);
    expect(slots.map((x) => x.session)).toEqual([
      "morning",
      "morning",
      "morning",
      "afternoon",
      "afternoon",
      "afternoon",
      "evening",
      "evening",
      "evening",
      "evening",
      "evening",
      "evening",
    ]);
    expect(labels(slots)).toEqual(oldGenerator("09:00", "22:00", 60, LUNCH));
  });

  it("never lets a slot run past its session's end", () => {
    const s = sessions(
      [true, "09:00", "12:00"],
      [false, "12:00", "16:00"],
      [true, "16:00", "17:00"],
    );
    expect(labels(generateSessionSlots(s, 45))).toEqual([
      "09:00 AM",
      "09:45 AM",
      "10:30 AM",
      "11:15 AM",
      "04:00 PM",
    ]);
  });

  it("lets a slot run across a back-to-back session boundary", () => {
    const s = sessions(
      [true, "11:00", "12:00"],
      [true, "12:00", "13:00"],
      [false, "16:00", "20:00"],
    );
    const slots = generateSessionSlots(s, 40);
    expect(labels(slots)).toEqual(["11:00 AM", "11:40 AM", "12:20 PM"]);
    expect(slots[1].session).toBe("morning");
  });

  it("restarts the grid at the start of a session after a gap", () => {
    const s = sessions(
      [true, "10:00", "11:00"],
      [false, "12:00", "16:00"],
      [true, "17:10", "18:00"],
    );
    expect(labels(generateSessionSlots(s, 25))).toEqual([
      "10:00 AM",
      "10:25 AM",
      "05:10 PM",
      "05:35 PM",
    ]);
  });

  it("fills the evening up to midnight without spilling into the next day", () => {
    const s = sessions(
      [false, "09:00", "12:00"],
      [false, "12:00", "16:00"],
      [true, "22:00", "24:00"],
    );
    expect(labels(generateSessionSlots(s, 30))).toEqual([
      "10:00 PM",
      "10:30 PM",
      "11:00 PM",
      "11:30 PM",
    ]);
  });

  it("covers a full 24-hour day", () => {
    const s = sessions(
      [true, "00:00", "12:00"],
      [true, "12:00", "16:00"],
      [true, "16:00", "24:00"],
    );
    const slots = generateSessionSlots(s, 60);
    expect(slots).toHaveLength(24);
    expect(formatSlotLabel(slots[0].startMin)).toBe("12:00 AM");
    expect(formatSlotLabel(slots[23].startMin)).toBe("11:00 PM");
  });

  it("returns nothing for a nonsense duration", () => {
    const s = deriveSessionsFromRange("09:00", "17:00");
    expect(generateSessionSlots(s, 0)).toEqual([]);
    expect(generateSessionSlots(s, Number.NaN)).toEqual([]);
  });
});

describe("legacy generation is unchanged", () => {
  // Every start/end/slot combination found in production DoctorSchedule rows.
  const LIVE = [
    ["09:00", "17:00", 30],
    ["09:00", "12:00", 30],
    ["09:00", "18:00", 30],
    ["09:00", "22:00", 60],
    ["18:00", "21:00", 8],
    ["18:00", "21:00", 10],
    ["09:00", "18:00", 15],
    ["18:00", "22:00", 15],
    ["10:00", "17:00", 8],
  ] as const;

  it.each(LIVE)("%s–%s / %i min matches the old Date loop", (start, end, d) => {
    const breakSets = [
      [],
      [{ start: "13:00", end: "14:00", label: "Lunch" }],
      [{ start: "19:00", end: "20:00", label: "Break" }],
    ];
    for (const raw of breakSets) {
      // The DB hands back the raw JSON string; both generators normalize it.
      const row = {
        startTime: start,
        endTime: end,
        slotDuration: d,
        breaks: JSON.stringify(raw),
        sessions: null,
      };
      expect(labels(resolveScheduleDaySlots(row))).toEqual(
        oldGenerator(start, end, d, normalizeBreaks(raw)),
      );
    }
  });

  it("keeps the final overrunning slot (18:00–21:00 in 8-minute slots)", () => {
    const slots = generateLegacySlots(1080, 1260, 8);
    expect(slots).toHaveLength(23);
    expect(formatSlotLabel(slots[slots.length - 1].startMin)).toBe("08:56 PM");
  });
});

describe("resolveScheduleDaySlots", () => {
  it("uses sessions when present and ignores the envelope", () => {
    const s = sessions(
      [true, "09:00", "10:00"],
      [false, "12:00", "16:00"],
      [true, "18:00", "19:00"],
    );
    const row = {
      startTime: "09:00",
      endTime: "19:00",
      slotDuration: 30,
      breaks: "[]",
      sessions: JSON.stringify(s),
    };
    expect(labels(resolveScheduleDaySlots(row))).toEqual([
      "09:00 AM",
      "09:30 AM",
      "06:00 PM",
      "06:30 PM",
    ]);
  });

  it("falls back to the legacy window for malformed sessions", () => {
    const row = { startTime: "09:00", endTime: "10:00", slotDuration: 30, sessions: "{bad" };
    expect(labels(resolveScheduleDaySlots(row))).toEqual(["09:00 AM", "09:30 AM"]);
  });

  it("returns nothing for an unusable legacy window", () => {
    expect(resolveScheduleDaySlots({ startTime: "x", endTime: "10:00" })).toEqual([]);
  });
});

describe("resolveDoctorDaySlots", () => {
  const clinicHours = { openTime: "10:00", closeTime: "11:00" };

  it("prefers the weekday's schedule row", () => {
    const daySchedule = { startTime: "09:00", endTime: "10:00", slotDuration: 30 };
    expect(
      labels(resolveDoctorDaySlots({ daySchedule, hasAnySchedule: true, clinicHours })),
    ).toEqual(["09:00 AM", "09:30 AM"]);
  });

  it("treats a weekday missing from an existing schedule as a day off", () => {
    expect(resolveDoctorDaySlots({ daySchedule: null, hasAnySchedule: true, clinicHours })).toEqual(
      [],
    );
  });

  it("borrows clinic hours, then 09:00–17:00, only for doctors with no schedule", () => {
    expect(
      labels(resolveDoctorDaySlots({ daySchedule: null, hasAnySchedule: false, clinicHours })),
    ).toEqual(["10:00 AM", "10:30 AM"]);
    expect(
      resolveDoctorDaySlots({ daySchedule: null, hasAnySchedule: false, clinicHours: null }),
    ).toHaveLength(16);
  });
});

describe("booking-page helpers", () => {
  it("freeSlotLabels drops booked slots", () => {
    const slots = generateLegacySlots(540, 660, 30);
    expect(freeSlotLabels(slots, ["09:30 AM", " 10:00 AM ", ""])).toEqual(["09:00 AM", "10:30 AM"]);
  });

  it("groups slots by session in day order and skips empty sessions", () => {
    expect(groupSlotLabels(["09:00 AM", "11:30 AM", "06:00 PM", "08:00 PM"])).toEqual([
      {
        key: "morning",
        label: "Morning",
        range: "12:00 AM – 12:00 PM",
        slots: ["09:00 AM", "11:30 AM"],
      },
      {
        key: "evening",
        label: "Evening",
        range: "4:00 PM – 12:00 AM",
        slots: ["06:00 PM", "08:00 PM"],
      },
    ]);
    expect(groupSlotLabels([])).toEqual([]);
  });

  it("hides slots that already started today, but not on other days", () => {
    const now = new Date(2026, 10, 6, 14, 0);
    const all = ["01:30 PM", "02:00 PM", "02:30 PM", "06:00 PM"];
    expect(dropElapsedSlots(all, "2026-11-06", now)).toEqual(["02:30 PM", "06:00 PM"]);
    expect(dropElapsedSlots(all, "2026-11-07", now)).toEqual(all);
  });
});
