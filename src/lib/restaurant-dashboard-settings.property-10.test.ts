import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  LIMITS,
  isExistingCalendarDate,
  validateClosureDay,
  type ClosureDay,
} from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 10: Closure validation rejects every malformed field
// **Validates: Requirements 4.6**

const pad = (value: number, length = 2) => String(value).padStart(length, "0");
const daysInMonth = (year: number, month: number) =>
  [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
const formatDate = (year: number, month: number, day: number) =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

const calendarBaseArb = fc.tuple(
  fc.integer({ min: 1, max: 9999 }),
  fc.integer({ min: 1, max: 12 }),
);
const validDateArb = calendarBaseArb.chain(([year, month]) =>
  fc.integer({ min: 1, max: daysInMonth(year, month) }).map((day) => formatDate(year, month, day)),
);
const nonexistentDateArb = calendarBaseArb.map(([year, month]) =>
  formatDate(year, month, daysInMonth(year, month) + 1),
);
const malformedDateArb = fc.oneof(
  nonexistentDateArb,
  validDateArb.map((date) => date.replaceAll("-", "/")),
  validDateArb.map((date) => date.replaceAll("-", "")),
  fc.constantFrom("not-a-date", "2024-2-03", "2024-02-3", ""),
);

const reasonChars = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
const validReasonArb = fc
  .array(fc.constantFrom(...reasonChars), { maxLength: LIMITS.closureReason.max })
  .map((chars) => chars.join(""));
const overlongReasonArb = fc
  .array(fc.constantFrom(...reasonChars), {
    minLength: LIMITS.closureReason.max + 1,
    maxLength: LIMITS.closureReason.max + 80,
  })
  .map((chars) => `  ${chars.join("")}  `);
const malformedSubmissionArb = fc.oneof(
  fc.record({ date: malformedDateArb, reason: validReasonArb }),
  fc.record({ date: validDateArb, reason: overlongReasonArb }),
  fc.record({ date: malformedDateArb, reason: overlongReasonArb }),
);
const closureArb: fc.Arbitrary<ClosureDay> = fc.record({
  id: fc.uuid(),
  date: validDateArb,
  scope: fc.oneof(
    fc.constant({ type: "restaurant" as const }),
    fc.uuid().map((tableId) => ({ type: "table" as const, tableId })),
  ),
  reason: validReasonArb,
  isHoliday: fc.boolean(),
  affectedBookingCount: fc.nat(),
  locationId: fc.option(fc.uuid(), { nil: null }),
});

describe("Property 10: Closure validation rejects every malformed field", () => {
  it("reports all malformed fields without changing input or closure collections", () => {
    fc.assert(
      fc.property(
        malformedSubmissionArb,
        fc.boolean(),
        fc.array(closureArb, { maxLength: 20 }),
        ({ date, reason }, isHoliday, closures) => {
          const input = { date, scope: { type: "restaurant" }, reason, isHoliday };
          const inputBefore = structuredClone(input);
          const closuresBefore = structuredClone(closures);
          const result = validateClosureDay(input);
          const applied = result.ok ? [...closures, result.value] : closures;

          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("Malformed closure was accepted");
          const fields = result.errors.map(({ field }) => field);
          if (!isExistingCalendarDate(date)) expect(fields).toContain("date");
          if (reason.trim().length > LIMITS.closureReason.max) {
            expect(fields).toContain("reason");
          }
          expect(input).toEqual(inputBefore);
          expect(closures).toEqual(closuresBefore);
          expect(applied).toBe(closures);
          expect(applied).toEqual(closuresBefore);
        },
      ),
      { numRuns: 400 },
    );
  });
});
