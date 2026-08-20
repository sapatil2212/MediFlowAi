import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  HOURS_PRESETS,
  applyHoursPreset,
  applyHoursToOpenDays,
  type DayHours,
} from "./restaurant-settings-model";

const clock = (minute: number): string =>
  `${Math.floor(minute / 60)
    .toString()
    .padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;

const validTimePairArb = fc.integer({ min: 0, max: 1438 }).chain((openMinute) =>
  fc.integer({ min: openMinute + 1, max: 1439 }).map((closeMinute) => ({
    openTime: clock(openMinute),
    closeTime: clock(closeMinute),
  })),
);

const validSevenDayHoursArb: fc.Arbitrary<DayHours[]> = fc
  .array(fc.tuple(validTimePairArb, fc.boolean()), { minLength: 7, maxLength: 7 })
  .map((rows) => rows.map(([times, isClosed], dayOfWeek) => ({ dayOfWeek, ...times, isClosed })));

describe("restaurant dashboard settings hour shortcuts", () => {
  // Feature: restaurant-dashboard-settings, Property 6: Hour shortcuts change drafts only
  // **Validates: Requirements 3.3, 3.4, 3.5**
  it("applies presets and valid time pairs only to fresh draft values", () => {
    fc.assert(
      fc.property(
        validSevenDayHoursArb,
        validSevenDayHoursArb,
        fc.constantFrom(...HOURS_PRESETS),
        validTimePairArb,
        (draft, stored, preset, pair) => {
          const draftBefore = structuredClone(draft);
          const storedBefore = structuredClone(stored);
          const presetBefore = structuredClone(preset.days);

          const presetDraft = applyHoursPreset(draft, preset);
          expect(presetDraft).toEqual(preset.days);
          expect(presetDraft).not.toBe(draft);
          expect(presetDraft.every((row, index) => row !== preset.days[index])).toBe(true);

          const openDaysDraft = applyHoursToOpenDays(draft, pair.openTime, pair.closeTime);
          expect(openDaysDraft).toEqual(
            draftBefore.map((day) =>
              day.isClosed ? day : { ...day, openTime: pair.openTime, closeTime: pair.closeTime },
            ),
          );
          expect(openDaysDraft.map((day) => day.isClosed)).toEqual(
            draftBefore.map((day) => day.isClosed),
          );
          expect(openDaysDraft).not.toBe(draft);
          expect(openDaysDraft.every((row, index) => row !== draft[index])).toBe(true);

          presetDraft[0].openTime = "mutation-sentinel";
          openDaysDraft[0].closeTime = "mutation-sentinel";
          expect(draft).toEqual(draftBefore);
          expect(stored).toEqual(storedBefore);
          expect(preset.days).toEqual(presetBefore);
        },
      ),
      { numRuns: 400 },
    );
  });
});
