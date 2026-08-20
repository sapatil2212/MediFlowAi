/**
 * restaurant-dashboard-settings.property-7.test.ts
 *
 * Property-based suite for atomic operating-hours validation (spec task 7.6).
 *
 * Generators build seven-day Operating_Hours submissions covering duplicate
 * weekdays, omitted weekdays, malformed or absent open/close times, open days
 * whose Close_Time is not strictly later than the Open_Time, and fully valid
 * permutations in arbitrary row order. Each submission is applied to an
 * in-memory repository model seeded with a known valid seven-day baseline.
 *
 * The single property asserts, against an independent reference derivation:
 *   - `validateRestaurantOperatingHours` succeeds iff every weekday 0-6 occurs
 *     exactly once and every open weekday carries a valid Open_Time/Close_Time
 *     pair with Close_Time strictly later than Open_Time.
 *   - On failure, every invalid weekday is named and the modelled seven-day
 *     repository state is left byte-for-byte unchanged (atomic rollback).
 *   - On success, a read returns the submitted, normalized seven rows in
 *     canonical weekday order (0 through 6).
 *
 * This module is pure: nothing here reads the system clock, sleeps, or performs
 * any I/O.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validateRestaurantOperatingHours, type DayHours } from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 7: Operating-hours validation is atomic
// **Validates: Requirements 3.1, 3.2, 3.6, 3.7, 11.1**

// ===========================================================================
// Independent reference helpers — mirror only the specification, not the code.
// ===========================================================================

/** Accepts exactly `HH:MM` with hours 0-23 and minutes 0-59; else `null`. */
function parseStrictClockRef(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** A time that parses is preserved; anything else normalizes to `"00:00"`. */
function normClockRef(value: unknown): string {
  return parseStrictClockRef(value) === null ? "00:00" : (value as string);
}

interface Evaluation {
  valid: boolean;
  reportedDays: Set<number>;
  lengthError: boolean;
  hasInvalidDayNumber: boolean;
}

/** Derives validity, invalid-weekday set, and length/day-number faults. */
function evaluate(input: unknown): Evaluation {
  if (!Array.isArray(input)) {
    return {
      valid: false,
      reportedDays: new Set<number>(),
      lengthError: true,
      hasInvalidDayNumber: false,
    };
  }

  const byDay = new Map<number, Record<string, unknown>[]>();
  let hasInvalidDayNumber = false;
  for (const row of input) {
    const raw = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const day = raw.dayOfWeek;
    if (!Number.isInteger(day) || (day as number) < 0 || (day as number) > 6) {
      hasInvalidDayNumber = true;
      continue;
    }
    const rows = byDay.get(day as number) ?? [];
    rows.push(raw);
    byDay.set(day as number, rows);
  }

  const reportedDays = new Set<number>();
  for (let day = 0; day < 7; day += 1) {
    const rows = byDay.get(day) ?? [];
    if (rows.length !== 1) {
      reportedDays.add(day);
      continue;
    }
    const raw = rows[0];
    if (typeof raw.isClosed !== "boolean") {
      reportedDays.add(day);
      continue;
    }
    if (!raw.isClosed) {
      const open = parseStrictClockRef(raw.openTime);
      const close = parseStrictClockRef(raw.closeTime);
      if (open === null || close === null || close <= open) reportedDays.add(day);
    }
  }

  const lengthError = input.length !== 7;
  const valid = !hasInvalidDayNumber && reportedDays.size === 0 && !lengthError;
  return { valid, reportedDays, lengthError, hasInvalidDayNumber };
}

/** Expected normalized seven rows, in canonical weekday order, for a valid input. */
function expectedNormalized(input: unknown[]): DayHours[] {
  const rows: DayHours[] = [];
  for (let day = 0; day < 7; day += 1) {
    const raw = input.find((r) => (r as Record<string, unknown>).dayOfWeek === day) as Record<
      string,
      unknown
    >;
    rows.push({
      dayOfWeek: day,
      openTime: normClockRef(raw.openTime),
      closeTime: normClockRef(raw.closeTime),
      isClosed: raw.isClosed as boolean,
    });
  }
  return rows;
}

// ===========================================================================
// In-memory repository model — atomic seven-day store.
// ===========================================================================

const BASELINE: DayHours[] = Array.from({ length: 7 }, (_, day) => ({
  dayOfWeek: day,
  openTime: "08:00",
  closeTime: "20:00",
  isClosed: false,
}));

class HoursRepository {
  private stored: DayHours[];

  constructor(seed: readonly DayHours[]) {
    this.stored = seed.map((row) => ({ ...row }));
  }

  save(input: unknown): ReturnType<typeof validateRestaurantOperatingHours> {
    const result = validateRestaurantOperatingHours(input);
    if (result.ok) this.stored = result.value.map((row) => ({ ...row }));
    return result;
  }

  read(): DayHours[] {
    return this.stored.map((row) => ({ ...row }));
  }
}

// ===========================================================================
// Generators — every failure mode plus fully valid permutations.
// ===========================================================================

const pad2 = (value: number): string => String(value).padStart(2, "0");

const arbValidClock: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${pad2(h)}:${pad2(m)}`);

const arbMalformedClock = fc.constantFrom(
  "24:00",
  "12:60",
  "9:00",
  "0900",
  "",
  "aa:bb",
  "23:5",
  "-1:00",
  "12:0",
  "99:99",
);

/** A time slot that may be a valid clock, a malformed string, or absent. */
const arbLooseClock = fc.oneof(
  { weight: 5, arbitrary: arbValidClock as fc.Arbitrary<unknown> },
  { weight: 2, arbitrary: arbMalformedClock as fc.Arbitrary<unknown> },
  { weight: 1, arbitrary: fc.constant(undefined) },
);

/** An open/close pair with close strictly later than open. */
const arbValidOpenPair: fc.Arbitrary<{ openTime: string; closeTime: string }> = fc
  .tuple(fc.integer({ min: 0, max: 23 * 60 + 58 }), fc.integer({ min: 1, max: 60 }))
  .map(([openMinutes, span]) => {
    const closeMinutes = Math.min(23 * 60 + 59, openMinutes + span);
    return {
      openTime: `${pad2(Math.floor(openMinutes / 60))}:${pad2(openMinutes % 60)}`,
      closeTime: `${pad2(Math.floor(closeMinutes / 60))}:${pad2(closeMinutes % 60)}`,
    };
  });

/** An open/close pair whose close is not strictly later than open. */
const arbNonLaterPair: fc.Arbitrary<{ openTime: string; closeTime: string }> = fc
  .tuple(fc.integer({ min: 0, max: 23 * 60 + 59 }), fc.integer({ min: 0, max: 300 }))
  .map(([openMinutes, back]) => {
    const closeMinutes = Math.max(0, openMinutes - back);
    return {
      openTime: `${pad2(Math.floor(openMinutes / 60))}:${pad2(openMinutes % 60)}`,
      closeTime: `${pad2(Math.floor(closeMinutes / 60))}:${pad2(closeMinutes % 60)}`,
    };
  });

/** Any single day's content, biased across all valid and invalid shapes. */
const arbDayContent = fc.oneof(
  // Valid: closed day — open/close may be valid, malformed, or absent.
  {
    weight: 4,
    arbitrary: fc.record({
      isClosed: fc.constant(true),
      openTime: arbLooseClock,
      closeTime: arbLooseClock,
    }),
  },
  // Valid: open day with a strictly-later close.
  {
    weight: 5,
    arbitrary: arbValidOpenPair.map((pair) => ({ isClosed: false, ...pair })),
  },
  // Invalid: open day, close not strictly later than open.
  {
    weight: 2,
    arbitrary: arbNonLaterPair.map((pair) => ({ isClosed: false, ...pair })),
  },
  // Invalid: open day with an absent open or close time.
  {
    weight: 2,
    arbitrary: fc.record({
      isClosed: fc.constant(false),
      openTime: fc.oneof(fc.constant(undefined), arbValidClock as fc.Arbitrary<unknown>),
      closeTime: fc.oneof(fc.constant(undefined), arbValidClock as fc.Arbitrary<unknown>),
    }),
  },
  // Invalid: open day with a malformed time.
  {
    weight: 2,
    arbitrary: fc.record({
      isClosed: fc.constant(false),
      openTime: arbMalformedClock as fc.Arbitrary<unknown>,
      closeTime: arbValidClock as fc.Arbitrary<unknown>,
    }),
  },
  // Invalid: non-boolean closed flag.
  {
    weight: 1,
    arbitrary: fc.record({
      isClosed: fc.oneof(fc.constant(undefined), fc.constant("false" as unknown), fc.integer()),
      openTime: arbLooseClock,
      closeTime: arbLooseClock,
    }),
  },
);

/** A guaranteed-valid submission: each weekday exactly once, all rows valid, shuffled. */
const arbValidContentForDay = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      isClosed: fc.constant(true),
      openTime: arbLooseClock,
      closeTime: arbLooseClock,
    }),
  },
  {
    weight: 5,
    arbitrary: arbValidOpenPair.map((pair) => ({ isClosed: false, ...pair })),
  },
);

const arbValidSubmission: fc.Arbitrary<Record<string, unknown>[]> = fc
  .array(arbValidContentForDay, { minLength: 7, maxLength: 7 })
  .chain((contents) => {
    const rows = contents.map((content, day) => ({ dayOfWeek: day, ...content }));
    return fc.shuffledSubarray(rows, { minLength: 7, maxLength: 7 });
  });

/** A structurally arbitrary submission: duplicates, omissions, and bad content. */
const arbBrokenSubmission: fc.Arbitrary<Record<string, unknown>[]> = fc.array(
  fc
    .tuple(fc.integer({ min: 0, max: 6 }), arbDayContent)
    .map(([dayOfWeek, content]) => ({ dayOfWeek, ...content })),
  { minLength: 0, maxLength: 10 },
);

const arbSubmission: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: arbValidSubmission as fc.Arbitrary<unknown> },
  { weight: 6, arbitrary: arbBrokenSubmission as fc.Arbitrary<unknown> },
  // A small share of non-array inputs exercises the shape guard.
  {
    weight: 1,
    arbitrary: fc.constantFrom(null, undefined, {}, "hours", 7) as fc.Arbitrary<unknown>,
  },
);

// ===========================================================================
// Property.
// ===========================================================================

// Feature: restaurant-dashboard-settings, Property 7: Operating-hours validation is atomic
// **Validates: Requirements 3.1, 3.2, 3.6, 3.7, 11.1**
describe("Feature: restaurant-dashboard-settings, Property 7: Operating-hours validation is atomic", () => {
  it("succeeds iff all seven weekdays are present and valid, otherwise names every invalid weekday and rolls back", () => {
    fc.assert(
      fc.property(arbSubmission, (submission) => {
        const repo = new HoursRepository(BASELINE);
        const before = repo.read();
        const evaluation = evaluate(submission);

        const result = repo.save(submission);

        // Validation succeeds exactly when the reference deems the input valid.
        expect(result.ok).toBe(evaluation.valid);

        if (result.ok) {
          // A read returns the submitted, normalized seven rows in canonical order.
          const read = repo.read();
          const expected = expectedNormalized(submission as unknown[]);
          expect(read).toEqual(expected);
          expect(result.value).toEqual(expected);
          expect(read.map((row) => row.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
          expect(read).toHaveLength(7);
        } else {
          // Atomic rollback: the modelled seven-day state is untouched.
          expect(repo.read()).toEqual(before);
          // Every invalid weekday is reported by field `hours.<day>`.
          for (const day of evaluation.reportedDays) {
            expect(result.errors.some((error) => error.field === `hours.${day}`)).toBe(true);
          }
          expect(result.errors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 400 },
    );
  });
});
