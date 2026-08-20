# Implementation Plan

## Overview

This plan builds the restaurant table-booking category end to end: the schema and transactional helper, the pure availability and validation core, the tenant-scoped row-access and server-function layers, the configuration and guest-facing UI, and finally the database integration and non-regression coverage. Work is ordered so that the schema and pure logic land first, then the row access and server functions that depend on them, then the UI that consumes those server functions, and last the integration and non-regression tests that exercise the assembled feature. The plan has 11 top-level tasks and 38 sub-tasks, 49 checkbox items in total.

## Task Dependency Graph

```json
{
  "tasks": {
    "1": { "dependsOn": [] },
    "1.1": { "dependsOn": [] },
    "1.2": { "dependsOn": ["1.1"] },
    "2": { "dependsOn": ["1.2"] },
    "2.1": { "dependsOn": ["1.2"] },
    "2.2": { "dependsOn": ["2.1"] },
    "2.3": { "dependsOn": ["2.2"] },
    "2.4": { "dependsOn": ["2.3"] },
    "2.5": { "dependsOn": ["2.4"] },
    "2.6": { "dependsOn": ["2.5"] },
    "3": { "dependsOn": ["2.6"] },
    "3.1": { "dependsOn": ["2.6"] },
    "3.2": { "dependsOn": ["3.1"] },
    "3.3": { "dependsOn": ["3.2"] },
    "3.4": { "dependsOn": ["2.6"] },
    "4": { "dependsOn": ["1.2", "2.6"] },
    "4.1": { "dependsOn": ["1.2", "2.6"] },
    "4.2": { "dependsOn": ["4.1"] },
    "4.3": { "dependsOn": ["4.2"] },
    "4.4": { "dependsOn": ["4.3"] },
    "4.5": { "dependsOn": ["4.4"] },
    "5": { "dependsOn": ["4.5"] },
    "5.1": { "dependsOn": ["4.5"] },
    "5.2": { "dependsOn": ["5.1"] },
    "5.3": { "dependsOn": ["5.2"] },
    "5.4": { "dependsOn": ["5.3"] },
    "6": { "dependsOn": [] },
    "6.1": { "dependsOn": [] },
    "6.2": { "dependsOn": ["6.1"] },
    "7": { "dependsOn": ["1.2", "2.6"] },
    "7.1": { "dependsOn": ["1.2", "2.6"] },
    "7.2": { "dependsOn": ["1.2", "2.6"] },
    "7.3": { "dependsOn": ["1.2", "2.6"] },
    "8": { "dependsOn": ["2.6", "5.4", "6.1"] },
    "8.1": { "dependsOn": ["2.6", "5.4", "6.1"] },
    "8.2": { "dependsOn": ["8.1"] },
    "8.3": { "dependsOn": ["8.1"] },
    "8.4": { "dependsOn": ["8.1"] },
    "9": { "dependsOn": ["6.1", "8.2", "8.3", "8.4"] },
    "9.1": { "dependsOn": ["6.1", "8.2", "8.3", "8.4"] },
    "9.2": { "dependsOn": ["9.1"] },
    "9.3": { "dependsOn": ["9.2"] },
    "10": { "dependsOn": ["5.4", "8.1"] },
    "10.1": { "dependsOn": ["5.4", "8.1"] },
    "10.2": { "dependsOn": ["10.1"] },
    "11": { "dependsOn": ["4.5", "5.4", "7.1", "7.2", "7.3", "10.2"] },
    "11.1": { "dependsOn": ["4.5", "5.4", "7.1", "7.2", "7.3", "10.2"] },
    "11.2": { "dependsOn": ["4.5", "5.4", "7.1", "7.2", "7.3", "10.2"] },
    "11.3": { "dependsOn": ["4.5", "5.4", "7.1", "7.2", "7.3", "10.2"] }
  },
  "waves": [
    ["1.1", "6.1"],
    ["1.2", "6.2"],
    ["2.1"],
    ["2.2"],
    ["2.3"],
    ["2.4"],
    ["2.5"],
    ["2.6"],
    ["3.1", "3.4", "4.1", "7.1", "7.2", "7.3"],
    ["3.2", "4.2"],
    ["3.3", "4.3"],
    ["4.4"],
    ["4.5"],
    ["5.1"],
    ["5.2"],
    ["5.3"],
    ["5.4"],
    ["8.1"],
    ["8.2", "8.3", "8.4", "10.1"],
    ["9.1", "10.2"],
    ["9.2", "11.1", "11.2", "11.3"],
    ["9.3"]
  ]
}
```

Work that can proceed in parallel:

- Wave 1 is two independent files: the first `db.ts` edit (1.1) and the feature-access registration (6.1), so task 6 can be picked up before the pure core exists and stays off the critical path.
- Wave 9 is the widest: once the pure core is complete (2.6), the two property suites (3.1, 3.4), the first row-access slice (4.1) and all three additive shared-file edits (7.1, 7.2, 7.3) touch disjoint files and can run together; 3.2 and 3.3 then continue alongside 4.2 and 4.3.
- Sub-tasks that write the same file are serialised: 1.1 → 1.2 on `db.ts`, 2.1 → 2.6 on `restaurant-availability.ts`, 3.1 → 3.3 on `restaurant-availability.test.ts`, 4.1 → 4.5 on `restaurant.server.ts`, 5.1 → 5.4 on `restaurant.ts`, 9.1 → 9.3 on `restaurant.tsx` and 10.1 → 10.2 on `book.$tenantId.tsx`.
- Once `TableLayoutView` (8.1) lands, its component tests (8.2), the config components (8.3), the walk-in drawer (8.4) and the public booking field set (10.1) proceed in parallel; the three task 11 suites also run together in the final waves alongside the dashboard tab bodies (9.2).

## Tasks

- [x] 1. Bootstrap the restaurant schema and add transactional support to `src/lib/db.ts`
  - All work stays inside the existing pool-initialisation IIFE in `src/lib/db.ts`, using the same `CREATE TABLE IF NOT EXISTS` inside its own `try/catch` and swallowed-catch `ALTER TABLE` style already used for `ClinicHours`, `VideoRoom` and the `Appointment` column migrations.
  - _Requirements: 1.5, 3.1, 4.1, 7.1, 7.2, 11.4, 12.2_

- [x] 1.1 Add the four restaurant tables and the four additive `Appointment` columns
  - In the self-heal block of `src/lib/db.ts`, after the video-consultation table block, add `CREATE TABLE IF NOT EXISTS RestaurantTable` with `id`, `tenantId`, nullable `locationId`, `name VARCHAR(40)`, `seatCapacity INT`, `area VARCHAR(30) DEFAULT 'Main'`, `displayOrder INT DEFAULT 1`, `state VARCHAR(16) DEFAULT 'active'`, timestamps, `UNIQUE KEY uq_resto_table_name (tenantId, name)`, `KEY idx_resto_table_tenant (tenantId, state)`, `KEY idx_resto_table_loc (tenantId, locationId)`, each in its own `try/catch` with the existing `console.error("[DB] ❌ ...")` shape.
  - Add `CREATE TABLE IF NOT EXISTS RestaurantSettings` with `tenantId` UNIQUE and column defaults `slotInterval 30`, `turnTime 90`, `maxPartySize 12`, `advanceBookingWindow 60`, `minLeadTime 30`, `timezone 'Asia/Kolkata'`.
  - Add `CREATE TABLE IF NOT EXISTS RestaurantHours` with `dayOfWeek INT` (0 = Sunday, matching `ClinicHours`), `openTime VARCHAR(5)`, `closeTime VARCHAR(5)`, `isClosed TINYINT(1) DEFAULT 0`, `UNIQUE KEY uq_resto_hours (tenantId, dayOfWeek)`; do not write into or read from `ClinicHours`.
  - Add `CREATE TABLE IF NOT EXISTS RestaurantTokenCounter` with `PRIMARY KEY (tenantId, bookingDate)` and `lastToken INT NOT NULL DEFAULT 0`.
  - Extend the existing `SHOW COLUMNS FROM Appointment` block with the four nullable columns `tableId VARCHAR(255)`, `partySize INT`, `turnTimeMinutes INT`, `tableNameAtBooking VARCHAR(40)`, each guarded by the same `colNames.includes(...)` check so no existing row or column is altered.
  - Add `ALTER TABLE Appointment ADD INDEX idx_apt_table_window (tenantId, tableId, dateTime)` in its own swallowed `try/catch`, mirroring the `idx_apt_tenant_mode` statement.
  - Confirm charset/collation match the surrounding tables (`utf8mb4_unicode_ci`) so table-name uniqueness is case-insensitive.
  - _Requirements: 1.5, 3.1, 3.6, 3.9, 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 7.1, 7.2, 11.4, 11.5, 12.2_

- [x] 1.2 Add and export the `withTransaction` helper
  - Add `export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T>` next to the existing `query` / `queryOne` / `execute` exports at the bottom of `src/lib/db.ts`.
  - Acquire one pooled connection, `beginTransaction()`, run the callback with that connection, `commit()`, `rollback()` and rethrow on any throw, and release the connection in `finally`, matching the `try/finally` release shape of `query` and `execute`.
  - Add `withTransaction` to the default export object so callers can import it the same way as the existing helpers.
  - _Requirements: 1.8, 7.2, 7.8, 7.11_

- [x] 2. Create the pure, I/O-free module `src/lib/restaurant-availability.ts`
  - New file importing nothing from `db`, `auth`, `crypto` or React, mirroring the isomorphic style of `src/lib/video-consultation.ts` and `src/lib/feature-access.ts`.
  - Export the types `ServiceSettings`, `DayHours`, `DiningTable`, `ExistingBooking`, `AvailabilityInput`, `AvailabilityResult`, `TableInput`, `Result<T>` and `FieldError` used by the server and UI layers.
  - _Requirements: 3.2, 3.14, 4.1, 4.9, 5.1, 5.14, 7.3, 10.5_

- [x] 2.1 Export the constants, status sets, limits and guest-facing message strings
  - Export `PROFESSION_RESTAURANT = "Restaurant and dining"` and `TENANT_PREFIX_RESTAURANT = "resto-"`.
  - Export `BLOCKING_STATUSES`, `RELEASING_STATUSES` and `BOOKING_STATUSES` as `as const` tuples plus the derived `BookingStatus` type, and a `isBlockingStatus(s)` predicate that every SQL predicate and UI filter derives from.
  - Export `SLOT_INTERVALS = [15, 30, 60] as const`, `DEFAULT_SETTINGS` (slot 30, turn 90, party 12, window 60, lead 30, timezone `Asia/Kolkata`) and `LIMITS` for table name, area, seat capacity, display order, tables per tenant (200), guest name, phone digits, turn time, max party size, advance window and min lead time.
  - Export the exact guest-facing strings as named constants: `A table with this name already exists`, `Seat capacity must be between 1 and 30`, `This table has upcoming bookings. Set the table to inactive instead`, `This table is already booked for the selected time`, `No table free at this time`, `Your party needs more than one table. Select as many tables as you need`, `The restaurant is closed on this date. Please pick another date`, `That table was just booked. Please pick another table or time`, `Please select at least one table`, `That time is not available for booking`.
  - _Requirements: 1.1, 3.3, 3.5, 3.11, 4.3, 4.4, 4.5, 4.6, 4.7, 6.8, 6.10, 6.12, 6.14, 7.4, 7.5, 7.7_

- [x] 2.2 Implement the clock helpers, slot generation and the half-open overlap test
  - Implement `parseClock(v: string): number | null` (rejects anything that is not a whole-minute `HH:MM` from `00:00` to `23:59`), `formatClock(minutes)`, `formatSlotLabel(minutes)` producing the `"06:30 PM"` shape used by `Appointment.timeSlot`, and `parseSlotLabel(label): number | null` as its inverse.
  - Implement `generateSlotStarts(hours, settings)`: empty array when the day is closed or when `closeTime - turnTime < openTime`; otherwise start at `openTime` and step by `slotInterval` while the start is at or before `closeTime - turnTime`.
  - Implement `windowsOverlap(aStart, aTurn, bStart, bTurn)` as `aStart < bEnd && bStart < aEnd` so a candidate starting exactly at an existing window's end does not overlap.
  - Keep every calculation on integer minutes since midnight; no `Date` object enters these functions.
  - _Requirements: 4.1, 4.13, 5.2, 5.3, 5.5_

- [x] 2.3 Implement `computeAvailability` with the total indicator precedence
  - Take the `AvailabilityInput` snapshot (settings with per-field defaults applied, the single weekday `DayHours` row, location-scoped tables including inactive ones, blocking bookings for the date, party size, `date`, `nowDateStr`, `nowMinutes`, `daysAhead`) and return the `AvailabilityResult` shape from the design.
  - Short-circuit `outOfWindow` when `daysAhead > advanceBookingWindow`, returning empty slots with `closed` and `capacityExceeded` false; then `closed` when the weekday `isClosed` or no hours row exists, returning empty slots; otherwise generate slots.
  - Filter same-day slots by `nowMinutes + minLeadTime`, treating `minLeadTime === 0` as "at or after now".
  - Per slot, build `availableTableIds` from `state === 'active'` tables whose `seatCapacity >= partySize` and none of whose blocking bookings overlaps the candidate window (comparing each booking's own `turnTimeMinutes` snapshot), ordered by `orderTables`, and report `availableCount`, `occupiedCount`, `activeTableCount` and `largestCapacity`.
  - Set `capacityExceeded` only when in window, open, and `partySize > largestCapacity`, in which case slots are returned with every `availableTableIds` empty.
  - Keep the function free of any dependence on input array order or on call history so repeated calls on an equal snapshot return deeply equal results.
  - _Requirements: 3.10, 3.13, 5.1, 5.4, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 9.8, 11.6, 11.7_

- [x] 2.4 Implement `orderTables`, `pickAutoTable`, `occupancyRate` and `normalisePhone`
  - `orderTables(tables)`: canonical total order by area ascending, then display order ascending, then name ascending, comparing area and name case-insensitively, returning a new array and never mutating the input.
  - `pickAutoTable(candidates)`: smallest seat capacity, ties by lowest display order then lowest name ascending, `null` for an empty set, invariant to input order.
  - `occupancyRate(blockingPairs, activeTables, slotCount)`: whole number 0–100, `blockingPairs / (activeTables * slotCount)` rounded to nearest, and `0` when `slotCount` or `activeTables` is 0.
  - `normalisePhone(raw)`: strip every space, hyphen, `(` and `)`; idempotent.
  - _Requirements: 3.14, 7.3, 9.10, 9.11, 10.5_

- [x] 2.5 Implement the four `validate*` functions
  - `validateTableInput(input, ctx)`: trim name and area, enforce name 1–40, area at most 30 (defaulting to `Main` when it trims empty), whole-number seat capacity 1–30, whole-number display order 1–999 (defaulting to highest in area + 1, or 1), the 200-tables-per-tenant cap counted across both states, and case-insensitive duplicate-name detection against `ctx.existingNames` excluding the edited row, returning the exact message constants from task 2.1.
  - `validateServiceSettings(input)`: all-or-nothing, slot interval in `SLOT_INTERVALS`, turn time 30–240, max party size 1–30, advance window 1–365, min lead time 0–1440, collecting one `FieldError` per offending field with its permitted values or inclusive range; absent fields resolve to `DEFAULT_SETTINGS` per field.
  - `validateOperatingHours(input)`: exactly seven days, all-or-nothing, each non-closed day requiring an open time and a strictly later close time, naming the offending weekday in the error.
  - `validateBookingRequest(input, ctx)`: trimmed guest name 1–100, `normalisePhone` digit count 7–15, party size within 1–`maxPartySize`, requested slot present in the computed slot list, and requested table capacity at least the party size, returning the corresponding message constants.
  - Return `{ ok: true, value }` / `{ ok: false, errors }` from every validator, never throwing.
  - _Requirements: 1.2, 1.6, 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.16, 3.17, 3.18, 4.2, 4.8, 4.9, 7.5, 7.6, 7.12_

- [x] 2.6 Implement `tenantNow` as the single timezone-aware function
  - `tenantNow(timezone, instant)` returns `{ dateStr, minutesOfDay, weekday }` derived from the instant rendered in the given IANA zone via `Intl.DateTimeFormat` parts, falling back to `DEFAULT_SETTINGS.timezone` for an unusable zone.
  - Add a `daysBetween(fromDateStr, toDateStr)` helper on plain `YYYY-MM-DD` strings so `daysAhead` never depends on `Date` arithmetic with implicit zones.
  - _Requirements: 5.14, 9.9_

- [x] 3. Write the property-based test suites for the pure core and the booking model
  - Two new files, `src/lib/restaurant-availability.test.ts` and `src/lib/restaurant-booking-model.test.ts`, following the structure of `src/lib/video-consultation.test.ts`: `describe` per property, generators built from the module's exported constants, `fc.assert(fc.property(...), { numRuns: 100 })` or higher.
  - Exactly one property per test, each tagged with a comment `// Feature: restaurant-table-booking, Property {number}: {property text}`.
  - Inject all time: generate `nowDateStr`, `nowMinutes` and `daysAhead`; no test reads the system clock. Generators cover the edge cases the design lists (whitespace-only names, non-integer capacities, `minLeadTime` 0, zero-slot dates, `close - turn < open`, empty available sets, phone-less guests, 199/200/201 table counts, a candidate slot starting exactly at an occupancy window's end).
  - Properties 31–34 are DOM-level and are implemented in tasks 8.2 and 10.2.
  - Run `npm test` and keep the whole suite green.
  - _Requirements: 3.10, 3.13, 4.10, 5.1, 5.13, 7.8, 9.8, 12.4_
  - _Properties: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 35, 36_

- [x] 3.1 Property tests for slot generation, overlap, availability, indicators, determinism and tenant-local now
  - In `src/lib/restaurant-availability.test.ts`, assert slot bounds and the closed-day equivalence, clock round-tripping and rejection, the half-open overlap equivalence, the reference definition of the available-table set with its counts, the min-lead-time bound for same-day slots, the mutually exclusive indicator precedence with out-of-window winning, deep equality across repeated and permuted inputs, and `tenantNow` agreeing with the instant rendered in the generated timezone.
  - _Requirements: 3.10, 3.13, 4.1, 4.10, 4.13, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 9.8_
  - _Properties: 1, 2, 3, 5, 6, 7, 8, 9_

- [x] 3.2 Property tests for ordering, auto-assignment, validation and the occupancy rate
  - Same file: assert `orderTables` is a canonical total order and a permutation invariant to input order, `pickAutoTable` picks the smallest sufficient table with the documented tie-breaks and refuses exactly on an empty set, `validateTableInput` accepts exactly within its documented limits with the documented defaults and rejection messages, duplicate-name detection ignores case and surrounding whitespace while accepting the row that already holds the name, `validateServiceSettings` / `validateOperatingHours` accept exactly within their limits with per-field defaults for absent values, and `occupancyRate` stays a bounded, monotonic whole number that is 0 for a zero slot count.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.14, 3.15, 3.16, 3.17, 3.18, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 7.3, 9.9, 9.10, 9.11_
  - _Properties: 11, 17, 18, 19, 21, 24_

- [x] 3.3 Property tests for routing, navigation derivation, server-side write refusal and non-regression of the existing categories
  - Extract the dashboard-router mapping, the restaurant-guard decision, the navigation/sub-tab derivation from a resolved feature access, and the signup label/name-validation/tenant-prefix rules as pure helpers in `src/lib/restaurant-availability.ts` (or a small sibling pure module) so they are testable without a DOM, then assert in the same test file: routing is total over profession values including absent, empty and unrecognised ones; the restaurant guard resolves to `/login`, `/dashboard` or render; navigation always contains the five core entries and a gated entry exactly when it resolves visible, with config sub-tabs exactly for `operate` or `view_only` and write controls only for `operate`, falling back to `Overview` for a non-visible requested tab; every write path refuses when the resolved permission is not `operate`; and varying profession alone changes no feature resolution other than the pre-existing `video` restriction.
  - _Requirements: 1.2, 1.4, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.11, 4.11, 9.13, 12.1, 12.2, 12.3, 12.4, 12.5_
  - _Properties: 27, 28, 29, 30, 35_

- [x] 3.4 Property tests for the in-memory booking transaction model
  - In `src/lib/restaurant-booking-model.test.ts`, build an in-memory store (tenants, tables, bookings, guests, token counters) plus a `serialiseConcurrentPair` helper that models the `FOR UPDATE` lock plus the re-check, then assert: no two blocking bookings ever share a table with overlapping windows and a concurrent pair yields exactly one acceptance with the documented rejection message; tokens are distinct and sequential per tenant per date and unchanged by a rejection; an accepted booking round-trips into its record and its response with status `Pending` and the turn-time snapshot; every documented rejection leaves the store unchanged; releasing a booking restores the prior availability; the walk-in path accepts exactly what the public path accepts and stores `Seated`; configuration and table-state changes never mutate existing bookings and the displayed table name comes from the booking-time snapshot; deletion is refused exactly when an upcoming blocking booking references the table; guest linking is invariant to phone formatting with sequential guest numbers and an untouched stored guest name; bookings-list and guests projections, filters, ordering and 25-per-page pagination are faithful; tenant isolation holds for every read and write with foreign ids reported as not found; tables are scoped to exactly one location and availability respects that scope; and a notification is queued with the booking's facts exactly when the WhatsApp feature is available and connected, with the booking created either way.
  - _Requirements: 3.8, 3.9, 3.11, 3.12, 4.12, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 8.1, 8.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.12, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_
  - _Properties: 4, 10, 12, 13, 14, 15, 16, 20, 22, 23, 25, 26, 36_

- [x] 4. Implement the row-access layer `src/lib/restaurant.server.ts`
  - New server-only module importing `query`, `queryOne`, `execute` and the new `withTransaction` from `./db`, `crypto` for ids as in `src/lib/booking.ts`, and the pure helpers and status sets from `./restaurant-availability`.
  - Every exported function takes `tenantId` first and every statement contains `tenantId = ?`; no function accepts a table or booking id without also constraining `tenantId`.
  - Generate every blocking/releasing status predicate from `BLOCKING_STATUSES` rather than hand-writing status lists per query.
  - _Requirements: 11.1, 11.2, 11.3_

- [x] 4.1 Settings and hours access
  - Implement `getSettings`, `upsertSettings`, `getHours` and `replaceHours` against `RestaurantSettings` and `RestaurantHours`, with `replaceHours` writing all seven weekday rows inside one `withTransaction` call so a partial save is impossible.
  - Map stored rows onto the pure `ServiceSettings` / `DayHours` shapes, applying `DEFAULT_SETTINGS` per absent field so a missing row still yields correct availability.
  - _Requirements: 4.1, 4.2, 4.9, 4.10, 4.12, 11.1_

- [x] 4.2 Table registry access
  - Implement `listTables` (with `locationId` and `includeInactive` options, returning rows through `orderTables`), `countTables`, `findTableByName` (case-insensitive, optional excluded id), `insertTable`, `updateTable`, `setTableState`, `deleteTable` and `hasUpcomingBlockingBookings(tenantId, tableId, nowIso)`.
  - Resolve the next display order for an area with a tenant-and-area scoped `MAX(displayOrder)` read, and report a row that does not match the session tenant as not found.
  - Leave every `Appointment` row referencing a deleted table untouched, relying on `tableNameAtBooking` for display.
  - _Requirements: 3.1, 3.3, 3.8, 3.9, 3.11, 3.12, 3.14, 3.17, 3.18, 11.1, 11.3, 11.4, 11.5_

- [x] 4.3 Booking and guest reads
  - Implement `listBlockingBookings(tenantId, date, tableIds)` returning the pure `ExistingBooking` shape (slot start minutes from `timeSlot`/`dateTime` plus the stored `turnTimeMinutes`), `listBookings(tenantId, filters, page)` with date-range, status, area, table, guest-name and guest-phone filters, the default ordering (date descending, slot start ascending, token ascending) and 25 rows per page with a total count, `getBookingsForDate` for the calendar view, and `listGuests(tenantId)` joining `Patient` to its linked `Appointment` rows for booking count, most recent booking date and `No Show` count.
  - _Requirements: 9.1, 9.2, 9.3, 9.12, 10.3, 11.2_

- [x] 4.4 `createBookingAtomic` with the fixed lock order
  - Implement `createBookingAtomic(tenantId, req)` inside a single `withTransaction`, running every statement on the passed connection: `SELECT ... FROM RestaurantTable WHERE tenantId = ? AND id IN (...) ORDER BY id FOR UPDATE` (one row for an explicit table, the candidate rows for `Any available table`), then read the date's blocking bookings under the lock and recompute the available set with `computeAvailability`, then resolve the table via `pickAutoTable` when auto-assigning.
  - On conflict, roll back and surface `That table was just booked. Please pick another table or time` without inserting anything.
  - Otherwise `INSERT INTO RestaurantTokenCounter (tenantId, bookingDate, lastToken) VALUES (?, ?, <seed>) ON DUPLICATE KEY UPDATE lastToken = lastToken + 1` where `<seed>` is `COALESCE(MAX(tokenNo), 0) + 1` over that tenant and date, read `lastToken` back, link or create the `Patient` guest row by `normalisePhone` (or by name when phone-less) with a sequential `patientNo`, and insert the `Appointment` row with `status 'Pending'`, `tableId`, `partySize`, `turnTimeMinutes`, `tableNameAtBooking`, `timeSlot`, `reason` defaulting to `''`, `tokenNo`, `locationId` and `doctorId NULL`, then commit.
  - Return the booking id, token, assigned table name, slot label and party size.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.8, 7.9, 7.11, 10.1, 10.2, 10.4, 10.6_

- [x] 4.5 `reassignBookingAtomic` and `setBookingStatus`
  - Implement `reassignBookingAtomic(tenantId, bookingId, targetTableId)` reusing the identical lock order, re-checking availability and target capacity under the lock before persisting the new `tableId` and `tableNameAtBooking`, and rolling back with the same conflict messages otherwise.
  - Implement `setBookingStatus(tenantId, bookingId, status)` restricted to the six `BOOKING_STATUSES` values and to rows of the requesting tenant, and reuse `createBookingAtomic` for walk-ins with `status 'Seated'`.
  - _Requirements: 9.4, 9.5, 9.6, 9.7, 11.2_

- [x] 5. Implement the server function boundary `src/lib/restaurant.ts`
  - New module of `createServerFn` handlers following the `src/lib/booking.ts` and `src/lib/auth.ts` conventions: a `.validator` that narrows the payload, then session verification, then the permission check via `canUseFeature` / `canOperateFeature`, then pure validation, then row access; failures are reported as `throw new Error(message)`.
  - Public handlers take `tenantId` from the validated payload and verify the addressed tenant's profession is `Restaurant and dining` before doing anything restaurant-shaped.
  - _Requirements: 2.8, 4.11, 9.13, 11.1, 11.2, 11.3_

- [x] 5.1 Public availability and booking creation, with fire-and-forget notification
  - Implement `getRestaurantAvailabilityServerFn` (GET): resolve settings, the weekday hours row, the location-scoped tables and the date's blocking bookings, derive tenant-local now with `tenantNow`, call `computeAvailability`, and echo `reqId`, `requestedDate` and `requestedPartySize` in the response.
  - Implement `createRestaurantBookingPublicServerFn` (POST): validate with `validateBookingRequest` against the computed slots, call `createBookingAtomic`, return the booking id, token, table name, slot and party size, and only then queue the WhatsApp message with `enqueueWA` after checking `getWAStatus` and the tenant's `whatsapp` feature availability — never awaited in the response path, wrapped so a failure is logged and the committed booking is still returned, and skipped with a logged omission when the guest has no phone.
  - _Requirements: 5.1, 5.14, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 7.12, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.1, 10.2, 10.4, 10.5, 10.6, 11.6, 11.7_

- [x] 5.2 Configuration server functions gated on `restaurant_config`
  - Implement `getRestaurantTablesServerFn`, `saveRestaurantTableServerFn`, `setRestaurantTableStateServerFn`, `deleteRestaurantTableServerFn`, `getRestaurantRulesServerFn`, `saveRestaurantHoursServerFn` and `saveRestaurantSettingsServerFn`.
  - Reads require `canUseFeature(ctx, "restaurant_config")`; every write requires `canOperateFeature(ctx, "restaurant_config")` and otherwise throws the not-authorised message without touching a row.
  - Refuse deletion with the upcoming-bookings message when `hasUpcomingBlockingBookings` is true, and surface validator `FieldError`s as thrown messages naming the offending field and its range.
  - _Requirements: 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 3.12, 3.16, 3.17, 3.18, 4.1, 4.2, 4.8, 4.10, 4.11, 11.1, 11.3_

- [x] 5.3 Booking management server functions gated on `restaurant_bookings`
  - Implement `getRestaurantBookingsServerFn` (filters, search, default ordering, 25 per page), `setRestaurantBookingStatusServerFn`, `reassignRestaurantBookingServerFn` and `createWalkInBookingServerFn`.
  - Writes require `canOperateFeature(ctx, "restaurant_bookings")` and otherwise throw the not-authorised-to-change-bookings message leaving status and table assignment untouched; the walk-in path reuses `validateBookingRequest` and creates with `Seated`.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.12, 9.13, 11.2_

- [x] 5.4 Overview and guests server functions
  - Implement `getRestaurantOverviewServerFn` returning today's booking count and party-size sum in the tenant timezone plus the occupancy rate from `occupancyRate`, and the per-slot occupied/available counts for the selected date.
  - Implement `getRestaurantGuestsServerFn` returning each guest's name, phone, linked booking count, most recent booking date and `No Show` count.
  - _Requirements: 9.8, 9.9, 9.10, 9.11, 10.3_

- [x] 6. Add the two restaurant features to `src/lib/feature-access.ts`
  - Purely additive edits to the existing maps, keeping the module I/O-free.
  - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 4.11, 9.13, 12.4_

- [x] 6.1 Register `restaurant_config` and `restaurant_bookings`
  - Extend the `FeatureId` union and the `FEATURE_IDS` array with `restaurant_config` and `restaurant_bookings`, and add `true` for both in all three `PLAN_FEATURES` tiers.
  - Add `ROLE_PERMISSIONS` rows: `restaurant_config` → admin `operate`, reception `view_only`, doctor `none`, location `operate`; `restaurant_bookings` → admin `operate`, reception `operate`, doctor `view_only`, location `operate`.
  - Add no `PROFESSION_FEATURES` entry for either id so profession stays an input to nothing but the pre-existing `video` restriction.
  - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 4.11, 9.13, 12.4_

- [x] 6.2 Add the feature-access baseline non-regression test
  - Add a test in `src/lib/feature-access.test.ts` (or a sibling `feature-access.baseline.test.ts`) that records `resolveFeatureAccess` output for every combination of plan, subscription status, role and legacy profession and fails on any drift for the seven pre-existing feature ids.
  - Assert the existing assertions in `src/lib/feature-access.test.ts` still pass unchanged, and that varying only `profession` leaves every unrestricted feature's `available`, `permission` and `visible` identical.
  - _Requirements: 12.4_
  - _Properties: 28, 30_

- [x] 7. Make the three additive shared-file edits
  - Each edit is an added arm or an added option; no existing branch, label, prefix or redirect is rewritten.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 2.1, 12.3, 12.5_

- [x] 7.1 Add the `Restaurant & Dining` option and Restaurant Name label rule in `src/routes/signup.tsx`
  - Add `<option value="Restaurant and dining">Restaurant &amp; Dining</option>` as a sixth option in the Business Profession / Industry `select`, leaving the five existing options' labels and values untouched.
  - Add a `case "Restaurant and dining": return "Restaurant Name";` arm to `getBusinessNameLabel`, so switching away restores the previous label while the entered `clinicName` text is retained.
  - Add the 1–100 trimmed-length check for the business name on submit for that profession, setting the existing `formError` state with the message that the restaurant name must be between 1 and 100 characters and returning before the signup request is sent, keeping the already entered values.
  - _Requirements: 1.1, 1.2, 1.6, 1.7_

- [x] 7.2 Add the `resto-` prefix and default settings insert in `src/lib/auth.ts`
  - Add one `else if (profession === "Restaurant and dining") { tenantPrefix = "resto-"; }` arm to the existing prefix chain in `signupServerFn`.
  - Move the owner-account insert, the tenant assignment and a new `RestaurantSettings` insert carrying the Req 1.5 defaults into a single `withTransaction` call for the restaurant path, so a failure in any step leaves no partially created tenant and returns an error to the form.
  - Store `Restaurant and dining` as the created account's profession exactly as the other professions are stored.
  - _Requirements: 1.3, 1.4, 1.5, 1.8_

- [x] 7.3 Add the `/dashboards/restaurant` redirect in `src/routes/dashboard.tsx`
  - Add one `else if (profession === "Restaurant and dining") { navigate({ to: "/dashboards/restaurant" }); }` arm to the existing chain in `DashboardRouterGateway`, leaving the four existing arms and the medical default untouched.
  - _Requirements: 2.1, 12.3, 12.5_

- [x] 8. Build `src/components/restaurant/TableLayoutView.tsx` and the dashboard sub-components
  - New `src/components/restaurant/` directory; components take data and callbacks as props and hold no server calls of their own beyond the `src/lib/restaurant.ts` server functions passed in.
  - _Requirements: 2.5, 2.8, 3.15, 6.5, 6.6, 6.7, 6.8, 6.9_

- [x] 8.1 Implement `TableLayoutView` against the accessibility contract
  - Props `{ tables, stateOf, onActivate?, mode, message? }`; render each area as a `<section role="group">` with `aria-labelledby` pointing at the visible area heading, and each table as a `<button type="button">` child, in the order supplied by `orderTables`.
  - Compose the accessible name as `` `${name}, seats ${seatCapacity}, ${stateLabel}` ``, render the state as visible text inside every card (`Available` / `Booked` / `Selected` in select mode, `Active` / `Inactive` in registry mode) with colour as an additional channel only.
  - Set `aria-pressed="true"` for `Selected`, `aria-pressed="false"` for `Available`, and `aria-disabled="true"` with `aria-pressed="false"` for `Unavailable` — never the `disabled` attribute — so an unavailable table stays focusable and still fires `onActivate`.
  - Render `message` into an `aria-live="polite"` region that also announces selection changes; registry mode renders no activation affordance and no create/edit/delete controls.
  - _Requirements: 3.15, 6.5, 6.6, 6.7, 6.8, 6.9_

- [x] 8.2 Component tests for `TableLayoutView`
  - Add `src/components/restaurant/TableLayoutView.test.tsx` with fast-check-driven table sets and state assignments, asserting each table renders exactly once inside its area group in canonical order with its name, seat capacity and exactly one visible state, the accessible name contains all three, `aria-pressed` is true exactly for `Selected`, `aria-disabled` is true exactly for `Unavailable` while the button stays focusable, and a table renders `Available` exactly when it is an available table of the selected slot and is not the selection.
  - Assert the selection reducer holds at most one selected table equal to the most recently activated available table, and that activating an unavailable table leaves the selection unchanged and surfaces `This table is already booked for the selected time` in the live region.
  - _Requirements: 3.15, 6.5, 6.6, 6.7, 6.8, 6.9, 6.13_
  - _Properties: 31, 32_

- [x] 8.3 Implement `TableManager`, `OperatingHours` and `BookingRules`
  - `TableManager.tsx`: registry list via `TableLayoutView` in `registry` mode grouped by area in canonical order showing name, seat capacity and state as text, plus create/edit/deactivate/delete forms wired to the task 5.2 server functions, surfacing field-level messages from the validators, and rendering no create/edit/delete/save control when the resolved `restaurant_config` permission is `view_only`.
  - `OperatingHours.tsx`: seven weekday rows with open time, close time and a closed flag, saved all-or-nothing and re-rendering the previously stored values on rejection with the weekday named.
  - `BookingRules.tsx`: slot interval, turn time, max party size, advance window and min lead time controls bounded by `LIMITS`, saved all-or-nothing with per-field messages and read-only under `view_only`.
  - _Requirements: 2.5, 2.8, 3.15, 3.16, 4.1, 4.2, 4.8, 4.11_

- [x] 8.4 Implement `WalkInDrawer`
  - Guest name, party size, date, slot and table selection reusing `TableLayoutView` in `select` mode, submitting to `createWalkInBookingServerFn`, showing the same validation messages as the public path and the resulting token and table on success.
  - Render nothing but a disabled state when the resolved `restaurant_bookings` permission is not `operate`.
  - _Requirements: 9.7, 9.13_

- [x] 9. Create the route `src/routes/dashboards/restaurant.tsx`
  - New file following the shell of `src/routes/dashboards/gym.tsx`: `createFileRoute`, the same `activeTab` state persisted to `localStorage` under `bmt_active_tab`, the same mobile bottom bar, `resolveFeatureAccess` memoised from the session — composing the task 8 components instead of inlining the tab bodies.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.10_

- [x] 9.1 Implement the shell and the guard order
  - On mount call `getCurrentUserServerFn`; redirect to `/login` and render no dashboard content when it resolves to no account, then redirect to `/dashboard` and render no dashboard content when `profession !== "Restaurant and dining"` including absent and empty values, and only then render.
  - Resolve feature access once from the session; when it cannot be resolved, render only the five core navigation entries, omit every gated entry and every Settings sub-tab, and show the message that feature access could not be resolved.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.10_

- [x] 9.2 Implement the navigation and the core tab bodies
  - Always render `Overview`, `Calendar`, `Bookings List`, `Guests` and `Settings`; render `WhatsApp` and `Manage Plans` only when the resolved access marks them visible, and fall back to rendering `Overview` when a non-visible gated tab is requested.
  - Wire `Overview` to `getRestaurantOverviewServerFn` (today's booking count, party-size sum, occupancy rate), `Calendar` to the per-slot occupied and available counts for a selected date, `Bookings List` to `getRestaurantBookingsServerFn` with the filters, search, default ordering, 25-per-page pagination and the status/reassign controls plus the `WalkInDrawer`, and `Guests` to `getRestaurantGuestsServerFn`.
  - _Requirements: 2.4, 2.6, 2.7, 2.11, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9, 9.11, 9.12, 10.3_

- [x] 9.3 Implement the Settings sub-tabs
  - Render `Restaurant Profile`, `Operating Hours`, `Tables` and `Booking Rules` when the resolved `restaurant_config` permission is `operate` or `view_only`, omit all four when it is `none`, and render the gated `WhatsApp Alerts`, `Multi Location` and `Manage Users` sub-tabs only when their features resolve visible.
  - Mount `TableManager`, `OperatingHours` and `BookingRules` with the resolved permission so `view_only` shows stored values with no create, edit, delete or save control.
  - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 3.15, 4.1, 4.11_

- [x] 10. Add the additive `isRestaurant` branch to `src/routes/book.$tenantId.tsx`
  - Add `const isRestaurant = profession === "Restaurant and dining" || (tenantId ? tenantId.startsWith("resto-") : false);` alongside the existing `isGym` / `isEducation` / `isBeauty` / `isProfessional` flags, and guard every existing slot-loading and validation effect so the non-restaurant paths run exactly as before.
  - _Requirements: 6.1, 6.2, 6.3, 6.11, 7.10_

- [x] 10.1 Render the restaurant field set and success view
  - When `isRestaurant`, render Guest name, Phone, Email, Party size (1 through `maxPartySize`), Booking date, Booking slot, Table selection defaulting to `Any available table`, and Special requests, calling `getRestaurantAvailabilityServerFn` and `createRestaurantBookingPublicServerFn` instead of the existing clinic server functions.
  - Render `TableLayoutView` in `select` mode for the chosen slot, keep a slot with zero available tables selectable while showing `No table free at this time`, show `Your party needs more than one table. Select as many tables as you need` on the multiple-tables indicator, and on the closed indicator show `The restaurant is closed on this date. Please pick another date` with no slots and no layout.
  - On success display the assigned table name, booking date, slot, party size and token.
  - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.10, 6.12, 6.14, 7.10_

- [x] 10.2 Implement and test the stale-response discipline and the selection reset
  - Carry an incrementing `reqId` on each availability request and apply a response only when its echoed `requestedDate` and `requestedPartySize` equal the current selection and its `reqId` is the latest issued; discard every other response.
  - Reset the table selection to `Any available table` on any party-size or date change before the fresh availability is applied, and block submission with field-level messages for empty party size, date or slot without sending a request.
  - Add `src/routes/book.$tenantId.restaurant.test.tsx` covering the interleaving of requests and out-of-order responses, the option space of the party-size control, the empty-field messages, and the zero-available-tables message, using fake timers to assert slots render within the 2000 ms budget.
  - _Requirements: 6.2, 6.4, 6.10, 6.11, 6.13_
  - _Properties: 33, 34_

- [x] 11. Add the MariaDB integration tests and the non-regression suite
  - New files under `src/lib/` following the existing test layout, skipped by a guard when no database connection is configured so `npm test` stays runnable locally.
  - _Requirements: 1.4, 1.5, 1.8, 7.2, 7.8, 7.11, 12.1, 12.2, 12.4_

- [x] 11.1 Integration tests for signup atomicity and bootstrap idempotency
  - In `src/lib/restaurant.integration.test.ts`, assert a restaurant signup creates the owner account, the `resto-` tenant id and the default `RestaurantSettings` row together, and that an induced failure in any of the three leaves none of them persisted.
  - Assert the task 1.1 bootstrap statements are idempotent by running them twice against the same database and checking no error escapes and no column, index or row is duplicated.
  - _Requirements: 1.4, 1.5, 1.8_
  - _Properties: 35_

- [x] 11.2 Integration tests for concurrent booking and the token counter
  - Fire two genuinely concurrent `createBookingAtomic` calls on the same tenant, date, slot and table and assert exactly one commits while the other rolls back with `That table was just booked. Please pick another table or time`, leaving one `Appointment` row.
  - Assert the `RestaurantTokenCounter` primary key makes tokens distinct and sequential per tenant per date under concurrency, that the seed continues an existing `MAX(tokenNo)` sequence, and that a rolled-back booking burns no token.
  - Assert a walk-in and an auto-assign booking take the same lock order so no deadlock is raised.
  - _Requirements: 7.2, 7.8, 7.11, 9.7_
  - _Properties: 4, 10_

- [x] 11.3 Non-regression suite for the five existing categories
  - In `src/lib/restaurant-non-regression.test.ts`, assert `getClinicInfoAndSlotsServerFn` returns deeply equal slots for a non-restaurant tenant with and without arbitrary `RestaurantHours`, `RestaurantSettings` and `RestaurantTable` rows present for that tenant.
  - Assert a booking created through `createAppointmentPublicServerFn` for a non-restaurant tenant leaves `tableId`, `partySize`, `turnTimeMinutes` and `tableNameAtBooking` `NULL`.
  - Assert the existing `src/lib/feature-access.test.ts` and `src/lib/video-consultation.test.ts` suites pass unchanged, and run `npm test` to confirm the whole suite is green.
  - _Requirements: 12.1, 12.2, 12.4_
  - _Properties: 16, 25, 30_
## Notes

- Only three shared files are edited, and every edit is additive: `src/routes/signup.tsx` (one added profession option, one added label arm, one added length check), `src/lib/auth.ts` (one added tenant-prefix arm plus the transactional default-settings insert) and `src/routes/dashboard.tsx` (one added redirect arm). The five existing category dashboard route files are not touched at all.
- `npm test` runs `vitest run`, and fast-check 4.8 is already a devDependency, so no tooling or dependency changes are needed for the property suites.
- The MariaDB integration tests in task 11 self-skip behind a connection guard, so `npm test` stays runnable on a machine with no database configured.
- Every guest-facing message string lives as an exported constant in `src/lib/restaurant-availability.ts` and is referenced by both the server functions and the UI, so a copy edit cannot silently break an acceptance criterion: the assertions compare against the same constant the product renders.
