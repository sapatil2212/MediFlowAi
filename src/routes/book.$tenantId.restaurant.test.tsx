// @vitest-environment jsdom
/**
 * book.$tenantId.restaurant.test.tsx
 *
 * DOM-level suite for the public restaurant booking arm of
 * `src/routes/book.$tenantId.tsx` (spec `.kiro/specs/restaurant-table-booking`,
 * task 10.2, Properties 33 and 34).
 *
 * The environment is pinned per file by the docblock above, matching
 * `src/components/restaurant/TableLayoutView.test.tsx`, so the pure `.test.ts`
 * suites under `src/lib/` keep running in the node environment untouched.
 *
 * Conventions, matching the existing suites:
 *   - exactly one property per test, tagged with the design's verbatim text;
 *   - `fc.assert(..., { numRuns: 100 })` at minimum;
 *   - generators are built from the module's exported constants (`LIMITS`,
 *     `AVAILABILITY_DEBOUNCE_MS`), so widening a limit without updating the
 *     logic fails here;
 *   - every guest-facing string is asserted against the exported constant the
 *     product renders (`MSG_NO_TABLE_FREE`, `MSG_CAPACITY_EXCEEDED`,
 *     `MSG_CLOSED_ON_DATE`, `MSG_FIELD_*`), never a retyped literal, so a copy
 *     edit cannot silently pass.
 *
 * Both server functions are mocked at the module boundary. That is not just to
 * keep the DOM off the database: injecting them is what lets a test hold several
 * availability requests in flight and resolve them OUT OF ORDER, which is the
 * whole point of Property 33 (Req 6.4).
 *
 * Time is faked, so the Req 6.4 render budget is measured on a clock the test
 * controls rather than on wall time.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fc from "fast-check";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The route module imports both server-function modules at load time. Mocking
// them keeps `db` / `auth.server` out of the jsdom run and gives the tests full
// control over request/response timing.
vi.mock("../lib/restaurant", () => ({
  getRestaurantAvailabilityServerFn: vi.fn(async () => {
    throw new Error("getRestaurantAvailabilityServerFn must be injected in tests");
  }),
  createRestaurantBookingPublicServerFn: vi.fn(async () => {
    throw new Error("createRestaurantBookingPublicServerFn must be injected in tests");
  }),
}));

vi.mock("../lib/booking", () => ({
  getClinicInfoAndSlotsServerFn: vi.fn(async () => {
    throw new Error("the clinic path must never run on the restaurant arm");
  }),
  createAppointmentPublicServerFn: vi.fn(async () => {
    throw new Error("the clinic path must never run on the restaurant arm");
  }),
}));

// The route module also imports the public-menu server function at load time.
// Mocking it keeps the settings row-access layer (db / auth.server) out of the
// jsdom run; every test injects `fetchMenu` explicitly.
vi.mock("../lib/restaurant-settings", () => ({
  getPublicRestaurantMenuServerFn: vi.fn(async () => ({
    categories: [] as never[],
  })),
}));

import {
  AVAILABILITY_DEBOUNCE_MS,
  AVAILABILITY_RENDER_BUDGET_MS,
  INITIAL_RESTAURANT_FORM_STATE,
  MSG_FIELD_DATE_REQUIRED,
  MSG_FIELD_PARTY_SIZE_REQUIRED,
  MSG_FIELD_SLOT_REQUIRED,
  PublicRestaurantMenu,
  RestaurantBookingForm,
  formatMenuItemPrice,
  partySizeOptions,
  restaurantEmptyFieldErrors,
  type CreateRestaurantBooking,
  type FetchPublicRestaurantMenu,
  type FetchRestaurantAvailability,
  type RestaurantAvailabilityResponse,
  type RestaurantBookingResponse,
} from "./book.$tenantId";
import type { MenuCategory } from "../lib/restaurant-settings-model";
import {
  DEFAULT_SETTINGS,
  LIMITS,
  MSG_MULTIPLE_TABLES_NEEDED,
  MSG_CLOSED_ON_DATE,
  MSG_NO_TABLE_FREE,
  TABLE_SELECTION_ANY_LABEL,
  type AvailabilitySlot,
  type DiningTable,
} from "../lib/restaurant-availability";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = "resto-test";
const RESTAURANT_NAME = "The Test Kitchen";

/** Two active Dining_Tables in two Table_Areas. */
const TABLES: DiningTable[] = [
  {
    id: "t1",
    name: "Table 1",
    seatCapacity: 2,
    area: "Main",
    displayOrder: 1,
    state: "active",
    locationId: null,
  },
  {
    id: "t2",
    name: "Table 2",
    seatCapacity: 4,
    area: "Patio",
    displayOrder: 1,
    state: "active",
    locationId: null,
  },
];

/** Booking dates the generators pick from. */
const DATES = ["2026-03-02", "2026-03-03", "2026-03-04"] as const;

/**
 * Party_Sizes the generators pick from — every one is inside the DEFAULT
 * Max_Party_Size, so the option is on the control before any availability has
 * been applied.
 */
const PARTY_SIZES = [1, 2, 3, 4] as const;

/**
 * A fingerprint that is injective in (booking date, Party_Size), so the slot
 * start minutes a response carries identify the selection it answers. If the
 * form ever applies the wrong response, the rendered Booking_Slots give it away.
 */
function fingerprint(date: string, partySize: number): number {
  const dayIndex = DATES.indexOf(date as (typeof DATES)[number]);
  return (dayIndex < 0 ? 9 : dayIndex) * 10 + partySize;
}

/**
 * The Booking_Slot start minutes that belong to exactly one (selection, request)
 * pair. The `reqId` is folded in on purpose: two requests for the SAME booking
 * date and Party_Size still return distinguishable slots, so applying a
 * superseded response is visible even when its echoes happen to match the
 * current selection — which is what makes the "latest issued `reqId`" half of
 * Req 6.4 assertable and not just the echo half.
 */
function slotStartsFor(date: string, partySize: number, reqId: number): number[] {
  const fp = fingerprint(date, partySize);
  return [fp * 1000 + reqId * 10 + 1, fp * 1000 + reqId * 10 + 2];
}

/**
 * An availability payload whose echoes and whose content agree: the slots always
 * describe the (date, Party_Size) pair in the echo, never the pair that was
 * requested. A response with a mismatched echo therefore carries recognisably
 * foreign slots, so applying it cannot go unnoticed.
 */
function availabilityFor(
  reqId: number,
  requestedDate: string,
  requestedPartySize: number,
  overrides: Partial<RestaurantAvailabilityResponse> = {},
): RestaurantAvailabilityResponse {
  const [firstStart, secondStart] = slotStartsFor(requestedDate, requestedPartySize, reqId);
  const slots: AvailabilitySlot[] = [
    // One Booking_Slot with a single Available_Table...
    {
      startMinutes: firstStart,
      label: `slot-${firstStart}`,
      availableTableIds: ["t1"],
      availableCount: 1,
      occupiedCount: 1,
      availableCapacity: 2,
    },
    // ...and one with none, which must stay selectable (Req 6.10).
    {
      startMinutes: secondStart,
      label: `slot-${secondStart}`,
      availableTableIds: [],
      availableCount: 0,
      occupiedCount: 2,
      availableCapacity: 0,
    },
  ];
  return {
    reqId,
    requestedDate,
    requestedPartySize,
    restaurantName: RESTAURANT_NAME,
    maxPartySize: DEFAULT_SETTINGS.maxPartySize,
    closed: false,
    outOfWindow: false,
    requiresMultipleTables: false,
    activeTableCount: TABLES.length,
    largestCapacity: 4,
    slots,
    tables: TABLES,
    ...overrides,
  };
}

/** Builds slots from a list of Available_Table counts (0 = no table free). */
function slotsFromCounts(counts: readonly number[]): AvailabilitySlot[] {
  return counts.map((count, i) => {
    const available = TABLES.slice(0, count);
    return {
      startMinutes: 600 + i * 30,
      label: `slot-${600 + i * 30}`,
      availableTableIds: available.map((t) => t.id),
      availableCount: count,
      occupiedCount: TABLES.length - count,
      availableCapacity: available.reduce((sum, t) => sum + t.seatCapacity, 0),
    };
  });
}

const bookingResponseFor = (data: {
  date: string;
  slotLabel: string;
  slotStartMinutes: number;
  partySize: number;
}): RestaurantBookingResponse => ({
  success: true,
  bookingId: "bk-1",
  tokenNo: 7,
  tables: [{ id: "t1", name: TABLES[0].name }],
  tableName: TABLES[0].name,
  date: data.date,
  slotLabel: data.slotLabel,
  startMinutes: data.slotStartMinutes,
  partySize: data.partySize,
  status: "Pending",
});

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

interface PendingAvailabilityCall {
  data: { tenantId: string; date: string; partySize: number; reqId: number };
  resolve: (response: RestaurantAvailabilityResponse) => void;
  reject: (error: unknown) => void;
}

/** Availability requests are parked, so a test decides the resolution order. */
function manualAvailability() {
  const calls: PendingAvailabilityCall[] = [];
  const fetchAvailability: FetchRestaurantAvailability = ({ data }) =>
    new Promise<RestaurantAvailabilityResponse>((resolve, reject) => {
      calls.push({ data, resolve, reject });
    });
  return { calls, fetchAvailability };
}

/** Availability answers immediately, echoing exactly what was requested. */
function autoAvailability(overrides: Partial<RestaurantAvailabilityResponse> = {}) {
  const requests: PendingAvailabilityCall["data"][] = [];
  const fetchAvailability: FetchRestaurantAvailability = async ({ data }) => {
    requests.push(data);
    return availabilityFor(data.reqId, data.date, data.partySize, overrides);
  };
  return { requests, fetchAvailability };
}

function recordingCreateBooking() {
  const sent: Array<Parameters<CreateRestaurantBooking>[0]["data"]> = [];
  const createBooking: CreateRestaurantBooking = async ({ data }) => {
    sent.push(data);
    return bookingResponseFor(data);
  };
  return { sent, createBooking };
}

const forbiddenCreateBooking: CreateRestaurantBooking = async () => {
  throw new Error("no booking request may be sent in this test");
};

// ---------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------

/** The menu read defaults to an empty projection, so the menu section is absent. */
const emptyFetchMenu: FetchPublicRestaurantMenu = async () => ({ categories: [] });

const mountForm = (
  fetchAvailability: FetchRestaurantAvailability,
  createBooking: CreateRestaurantBooking = forbiddenCreateBooking,
  fetchMenu: FetchPublicRestaurantMenu = emptyFetchMenu,
) =>
  render(
    <RestaurantBookingForm
      tenantId={TENANT_ID}
      restaurantName={RESTAURANT_NAME}
      fetchAvailability={fetchAvailability}
      createBooking={createBooking}
      fetchMenu={fetchMenu}
    />,
  );

const partySizeControl = () => screen.getByLabelText("Party size") as HTMLSelectElement;
const dateControl = () => screen.getByLabelText("Booking date") as HTMLInputElement;

const choosePartySize = (value: number | "") =>
  fireEvent.change(partySizeControl(), { target: { value: String(value) } });

const chooseDate = (value: string) => fireEvent.change(dateControl(), { target: { value } });

/** Advances the faked clock and flushes the promise jobs it releases. */
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** Settles a parked availability response without moving the clock. */
const settle = async (call: PendingAvailabilityCall, response: RestaurantAvailabilityResponse) => {
  await act(async () => {
    call.resolve(response);
    await vi.advanceTimersByTimeAsync(0);
  });
};

/** The Booking_Slot start minutes currently rendered, in render order. */
const renderedSlotStarts = (): number[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-slot-available-count]")).map(
    (b) => Number((b.getAttribute("data-testid") ?? "").replace("slot-", "")),
  );

/** The Dining_Tables the Table_Layout_View currently renders as `Available`. */
const renderedAvailableTableIds = (): string[] =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[data-table-id][data-state="Available"]'),
  ).map((b) => b.getAttribute("data-table-id") as string);

const slotButton = (startMinutes: number) => screen.getByTestId(`slot-${startMinutes}`);

const tableSelectionValue = () =>
  (screen.getByTestId("table-selection-value").textContent ?? "").trim();

const submitForm = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Book Table/i }));
    await vi.advanceTimersByTimeAsync(0);
  });
};

const otherDate = (date: string): string => {
  const at = DATES.indexOf(date as (typeof DATES)[number]);
  return DATES[(at + 1) % DATES.length];
};

const otherPartySize = (partySize: number): number =>
  PARTY_SIZES[
    (PARTY_SIZES.indexOf(partySize as (typeof PARTY_SIZES)[number]) + 1) % PARTY_SIZES.length
  ];

beforeEach(() => {
  // `performance` and the animation-frame timers are deliberately left real, so
  // React's scheduler keeps its own notion of time.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Property 33
// ---------------------------------------------------------------------------

describe("Property 33: Only the response matching the current selection is applied", () => {
  // Feature: restaurant-table-booking, Property 33: For any interleaving of availability requests and out-of-order responses, the rendered Booking_Slots and Available_Table sets always correspond to the currently selected Party_Size and booking date, and no response whose requested Party_Size or requested booking date differs from the current selection is applied.
  it("renders only the Booking_Slots and Available_Tables of the current selection, discarding every superseded or mis-echoed response", async () => {
    const arbCase = fc
      .record({
        initialPartySize: fc.constantFrom(...PARTY_SIZES),
        initialDate: fc.constantFrom(...DATES),
        changes: fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant<"party">("party"),
              party: fc.constantFrom(...PARTY_SIZES),
            }),
            fc.record({ kind: fc.constant<"date">("date"), date: fc.constantFrom(...DATES) }),
          ),
          { minLength: 1, maxLength: 3 },
        ),
        // How each response echoes itself: faithfully, or with a superseded
        // booking date / Party_Size — the Req 6.4 discard cases.
        echoes: fc.array(
          fc.constantFrom<"faithful" | "wrongDate" | "wrongParty">(
            "faithful",
            "wrongDate",
            "wrongParty",
          ),
          {
            minLength: 6,
            maxLength: 6,
          },
        ),
      })
      .chain((c) => {
        const requestCount = c.changes.length + 1;
        const indices = Array.from({ length: requestCount }, (_, i) => i);
        return fc.record({
          ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, fc.constant(v)])),
          // An arbitrary arrival order for the parked responses.
          arrivalOrder: fc.shuffledSubarray(indices, {
            minLength: requestCount,
            maxLength: requestCount,
          }),
        }) as fc.Arbitrary<typeof c & { arrivalOrder: number[] }>;
      });

    await fc.assert(
      fc.asyncProperty(
        arbCase,
        async ({ initialPartySize, initialDate, changes, echoes, arrivalOrder }) => {
          const { calls, fetchAvailability } = manualAvailability();

          try {
            mountForm(fetchAvailability);

            let currentPartySize: number = initialPartySize;
            let currentDate: string = initialDate;

            choosePartySize(currentPartySize);
            chooseDate(currentDate);
            await advance(AVAILABILITY_DEBOUNCE_MS);
            expect(calls).toHaveLength(1);
            expect(renderedSlotStarts()).toEqual([]);

            // Issue one further request per effective change. A change to the value
            // already selected is not a change at all, so it issues nothing.
            let issued = 1;
            for (const change of changes) {
              if (change.kind === "party") {
                if (change.party === currentPartySize) continue;
                currentPartySize = change.party;
                choosePartySize(currentPartySize);
              } else {
                if (change.date === currentDate) continue;
                currentDate = change.date;
                chooseDate(currentDate);
              }
              issued += 1;
              await advance(AVAILABILITY_DEBOUNCE_MS);
              expect(calls).toHaveLength(issued);
              // Req 6.13 — the previously applied availability is dropped at once.
              expect(renderedSlotStarts()).toEqual([]);
            }

            // Every parked response now arrives, in the generated order.
            for (const index of arrivalOrder.filter((i) => i < issued)) {
              const call = calls[index];
              // The form issues one strictly increasing `reqId` per request.
              expect(call.data.reqId).toBe(index + 1);
              const echo = echoes[index] ?? "faithful";
              const echoedDate = echo === "wrongDate" ? otherDate(call.data.date) : call.data.date;
              const echoedPartySize =
                echo === "wrongParty" ? otherPartySize(call.data.partySize) : call.data.partySize;

              await settle(call, availabilityFor(call.data.reqId, echoedDate, echoedPartySize));

              // Whatever arrived, what is rendered belongs to the current selection
              // AND to the latest request issued for it — never to a superseded one.
              const rendered = renderedSlotStarts();
              if (rendered.length > 0) {
                expect(rendered).toEqual(slotStartsFor(currentDate, currentPartySize, issued));
              }
            }

            // One last change, answered faithfully: the matching response IS applied,
            // so the invariant above is not satisfied by rendering nothing at all.
            const finalPartySize = otherPartySize(currentPartySize);
            currentPartySize = finalPartySize;
            choosePartySize(currentPartySize);
            issued += 1;
            await advance(AVAILABILITY_DEBOUNCE_MS);
            expect(calls).toHaveLength(issued);

            const finalCall = calls[issued - 1];
            expect(finalCall.data.date).toBe(currentDate);
            expect(finalCall.data.partySize).toBe(currentPartySize);
            const finalResponse = availabilityFor(
              finalCall.data.reqId,
              currentDate,
              currentPartySize,
            );
            await settle(finalCall, finalResponse);

            expect(renderedSlotStarts()).toEqual(
              slotStartsFor(currentDate, currentPartySize, finalCall.data.reqId),
            );

            // ...and the Available_Table set of the chosen Booking_Slot is the one
            // that response carried.
            fireEvent.click(slotButton(finalResponse.slots[0].startMinutes));
            expect(renderedAvailableTableIds()).toEqual(finalResponse.slots[0].availableTableIds);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
    // 100 mount-and-interleave runs of a full form; generous headroom over the
    // project-wide 30 s ceiling so a loaded machine cannot flake this.
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Property 34
// ---------------------------------------------------------------------------

/** The three required public-form fields Req 6.11 reports a field-level message for. */
type RequiredField = "partySize" | "date" | "slot";

describe("Property 34: Public form validation matches the offered option space", () => {
  // Feature: restaurant-table-booking, Property 34: For any Max_Party_Size within its permitted range, the Party_Size control offers exactly the values 1 through Max_Party_Size; for any subset of Party_Size, booking date, and Booking_Slot left empty at submission, a field-level message is shown for exactly those fields and no booking request is sent; for any availability result, every Booking_Slot whose Available_Table count is 0 remains selectable and displays `No table free for this party size at this time`.
  it("offers exactly 1..Max_Party_Size, messages exactly the empty fields while sending nothing, and keeps a zero-availability slot selectable with its reason", async () => {
    const arbCase = fc.record({
      maxPartySize: fc.integer({ min: LIMITS.maxPartySize.min, max: LIMITS.maxPartySize.max }),
      availableCounts: fc.array(fc.integer({ min: 0, max: TABLES.length }), {
        minLength: 1,
        maxLength: 2,
      }),
      emptyFields: fc.subarray<RequiredField>(["partySize", "date", "slot"]),
    });

    const MESSAGES = {
      partySize: MSG_FIELD_PARTY_SIZE_REQUIRED,
      date: MSG_FIELD_DATE_REQUIRED,
      slot: MSG_FIELD_SLOT_REQUIRED,
    } satisfies Record<RequiredField, string>;

    // A typed key tuple: iterating it keeps `field` narrowed to the three
    // required-field names, where `Object.keys` would widen it to `string`.
    const MESSAGE_FIELDS: readonly RequiredField[] = ["partySize", "date", "slot"];

    await fc.assert(
      fc.asyncProperty(arbCase, async ({ maxPartySize, availableCounts, emptyFields }) => {
        // ── The option space, and the zero-availability Booking_Slots ─────────
        const slots = slotsFromCounts(availableCounts);
        const { fetchAvailability } = autoAvailability({ maxPartySize, slots });

        try {
          mountForm(fetchAvailability);

          choosePartySize(1);
          chooseDate(DATES[0]);
          await advance(AVAILABILITY_DEBOUNCE_MS);

          // Exactly the values 1 through Max_Party_Size, after the placeholder.
          const offered = Array.from(partySizeControl().options);
          const expectedValues = Array.from({ length: maxPartySize }, (_, i) => String(i + 1));
          expect(offered.map((o) => o.value)).toEqual(["", ...expectedValues]);
          expect(offered.slice(1).map((o) => (o.textContent ?? "").trim())).toEqual(expectedValues);
          expect(partySizeOptions(maxPartySize)).toEqual(
            Array.from({ length: maxPartySize }, (_, i) => i + 1),
          );

          for (const slot of slots) {
            const button = slotButton(slot.startMinutes);
            expect(button.hasAttribute("disabled")).toBe(false);
            expect((button as HTMLButtonElement).disabled).toBe(false);
            expect(button.getAttribute("data-slot-available-count")).toBe(
              String(slot.availableCount),
            );

            // Req 6.10 — the reason renders exactly on the empty Booking_Slots.
            expect((button.textContent ?? "").includes(MSG_NO_TABLE_FREE)).toBe(
              slot.availableCount === 0,
            );

            // Still selectable, empty or not.
            fireEvent.click(button);
            expect(slotButton(slot.startMinutes).getAttribute("aria-pressed")).toBe("true");

            if (slot.availableCount === 0) {
              expect(
                (screen.getByTestId("table-layout-live-region").textContent ?? "").trim(),
              ).toBe(MSG_NO_TABLE_FREE);
              expect(renderedAvailableTableIds()).toEqual([]);
            }
          }
        } finally {
          cleanup();
        }

        // ── The empty-field messages, over the whole subset space ────────────
        // The pure projection covers all eight subsets, including the two that no
        // interaction can reach (a Booking_Slot cannot be chosen with no Party_Size
        // or no booking date).
        const syntheticState = {
          ...INITIAL_RESTAURANT_FORM_STATE,
          partySize: emptyFields.includes("partySize") ? null : 2,
          date: emptyFields.includes("date") ? "" : DATES[0],
          selectedSlotStart: emptyFields.includes("slot") ? null : slots[0].startMinutes,
        };
        const projected = restaurantEmptyFieldErrors(syntheticState);
        expect(Object.keys(projected).sort()).toEqual([...emptyFields].sort());
        for (const field of emptyFields) expect(projected[field]).toBe(MESSAGES[field]);

        const reachable = emptyFields.includes("slot") || emptyFields.length === 0;
        if (!reachable) return;

        const auto = autoAvailability({ maxPartySize, slots });
        const { sent, createBooking } = recordingCreateBooking();

        try {
          mountForm(auto.fetchAvailability, createBooking);

          if (!emptyFields.includes("partySize")) choosePartySize(1);
          if (!emptyFields.includes("date")) chooseDate(DATES[0]);
          if (!emptyFields.includes("partySize") && !emptyFields.includes("date")) {
            await advance(AVAILABILITY_DEBOUNCE_MS);
          }
          if (!emptyFields.includes("slot")) fireEvent.click(slotButton(slots[0].startMinutes));

          await submitForm();

          for (const field of MESSAGE_FIELDS) {
            expect(screen.queryAllByText(MESSAGES[field]).length > 0).toBe(
              emptyFields.includes(field),
            );
          }

          // No booking request is sent while any required field is empty.
          expect(sent).toHaveLength(emptyFields.length === 0 ? 1 : 0);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Example tests
// ---------------------------------------------------------------------------

describe("The restaurant availability indicators (Req 6.12, 6.14)", () => {
  it("shows the multiple-tables guidance from its exported constant, and still offers tables", async () => {
    const { fetchAvailability } = autoAvailability({ requiresMultipleTables: true });
    mountForm(fetchAvailability);

    choosePartySize(4);
    chooseDate(DATES[0]);
    await advance(AVAILABILITY_DEBOUNCE_MS);

    expect(screen.getByTestId("multiple-tables-message").textContent?.trim()).toBe(
      MSG_MULTIPLE_TABLES_NEEDED,
    );
    // The indicator is guidance, not a dead end: the slot list is still offered.
    expect(screen.getByTestId("slot-list")).toBeTruthy();
  });

  it("shows the closed-date message with no Booking_Slot and no Table_Layout_View", async () => {
    const { fetchAvailability } = autoAvailability({ closed: true, slots: [] });
    mountForm(fetchAvailability);

    choosePartySize(2);
    chooseDate(DATES[1]);
    await advance(AVAILABILITY_DEBOUNCE_MS);

    expect(screen.getByTestId("closed-message").textContent?.trim()).toBe(MSG_CLOSED_ON_DATE);
    expect(screen.queryByTestId("slot-list")).toBeNull();
    expect(renderedSlotStarts()).toEqual([]);
    expect(screen.queryByTestId("table-layout-live-region")).toBeNull();
    expect(screen.queryByTestId("table-selection-value")).toBeNull();
  });
});

describe("The Table selection reset (Req 6.13)", () => {
  const selectTable = async (partySize: number, date: string) => {
    const { fetchAvailability } = autoAvailability();
    mountForm(fetchAvailability);

    choosePartySize(partySize);
    chooseDate(date);
    await advance(AVAILABILITY_DEBOUNCE_MS);

    // The first request of a fresh mount carries reqId 1.
    fireEvent.click(slotButton(slotStartsFor(date, partySize, 1)[0]));
    fireEvent.click(document.querySelector('button[data-table-id="t1"]') as HTMLButtonElement);
    expect(tableSelectionValue()).toBe(TABLES[0].name);
  };

  it("returns the Table selection to `Any available table` on a Party_Size change", async () => {
    await selectTable(2, DATES[0]);

    choosePartySize(3);
    // The reset happens before the fresh availability lands.
    expect(screen.queryByTestId("table-selection-value")).toBeNull();

    await advance(AVAILABILITY_DEBOUNCE_MS);
    fireEvent.click(slotButton(slotStartsFor(DATES[0], 3, 2)[0]));
    expect(tableSelectionValue()).toBe(TABLE_SELECTION_ANY_LABEL);
  });

  it("returns the Table selection to `Any available table` on a booking date change", async () => {
    await selectTable(2, DATES[0]);

    chooseDate(DATES[2]);
    expect(screen.queryByTestId("table-selection-value")).toBeNull();

    await advance(AVAILABILITY_DEBOUNCE_MS);
    fireEvent.click(slotButton(slotStartsFor(DATES[2], 2, 2)[0]));
    expect(tableSelectionValue()).toBe(TABLE_SELECTION_ANY_LABEL);
  });
});

describe("The success view (Req 7.10)", () => {
  it("reports the assigned Dining_Table, booking date, Booking_Slot, Party_Size and Booking_Token", async () => {
    const { fetchAvailability } = autoAvailability();
    const { sent, createBooking } = recordingCreateBooking();
    mountForm(fetchAvailability, createBooking);

    const partySize = 2;
    const date = DATES[0];
    const [firstSlotStart] = slotStartsFor(date, partySize, 1);

    fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "9876543210" } });
    choosePartySize(partySize);
    chooseDate(date);
    await advance(AVAILABILITY_DEBOUNCE_MS);
    fireEvent.click(slotButton(firstSlotStart));

    await submitForm();

    expect(sent).toHaveLength(1);
    expect(screen.getByTestId("booking-table").textContent?.trim()).toBe(TABLES[0].name);
    expect(screen.getByTestId("booking-date").textContent?.trim()).toBe(date);
    expect(screen.getByTestId("booking-slot").textContent?.trim()).toBe(`slot-${firstSlotStart}`);
    expect(screen.getByTestId("booking-party-size").textContent?.trim()).toBe(String(partySize));
    expect(screen.getByTestId("booking-token").textContent?.trim()).toBe("#7");
  });
});

describe("The Req 6.4 render budget", () => {
  it("renders the returned Booking_Slots within the 2000 ms budget", async () => {
    const { calls, fetchAvailability } = manualAvailability();
    mountForm(fetchAvailability);

    const partySize = 3;
    const date = DATES[1];

    const startedAt = Date.now();
    choosePartySize(partySize);
    chooseDate(date);
    await advance(AVAILABILITY_DEBOUNCE_MS);

    expect(calls).toHaveLength(1);
    expect(screen.getByTestId("availability-loading")).toBeTruthy();

    await settle(calls[0], availabilityFor(calls[0].data.reqId, date, partySize));

    expect(renderedSlotStarts()).toEqual(slotStartsFor(date, partySize, 1));
    expect(Date.now() - startedAt).toBeLessThanOrEqual(AVAILABILITY_RENDER_BUDGET_MS);
    expect(AVAILABILITY_DEBOUNCE_MS).toBeLessThan(AVAILABILITY_RENDER_BUDGET_MS);

    // Nothing further is scheduled: the slots are still there for the rest of the
    // budget, and no second request was issued.
    await advance(AVAILABILITY_RENDER_BUDGET_MS - AVAILABILITY_DEBOUNCE_MS);
    expect(renderedSlotStarts()).toEqual(slotStartsFor(date, partySize, 1));
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Public menu (Req 6.9-6.11)
// ---------------------------------------------------------------------------

/** A projected Menu_Item — the projection already guarantees `available`. */
function menuItem(
  overrides: Partial<MenuCategory["items"][number]> = {},
): MenuCategory["items"][number] {
  return {
    id: "item-1",
    categoryId: "category-1",
    name: "Soup",
    priceMinor: 1000,
    description: "",
    displayOrder: 1,
    state: "available",
    locationId: null,
    ...overrides,
  };
}

/** A projected Menu_Category carrying its already-ordered available items. */
function menuCategory(overrides: Partial<MenuCategory> = {}): MenuCategory {
  return {
    id: "category-1",
    name: "Starters",
    displayOrder: 1,
    items: [],
    locationId: null,
    ...overrides,
  };
}

/** A menu read that answers immediately with the given projection. */
const menuReturning =
  (categories: MenuCategory[]): FetchPublicRestaurantMenu =>
  async () => ({ categories });

/** Settles the on-mount menu read without moving the availability clock. */
const flushMenu = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

describe("The public menu section (Req 6.9-6.11)", () => {
  it("renders every projected category name with each item's name, price, and description", async () => {
    const { fetchAvailability } = autoAvailability();
    const categories = [
      menuCategory({
        id: "starters",
        name: "Starters",
        items: [
          menuItem({
            id: "soup",
            categoryId: "starters",
            name: "Tomato Soup",
            priceMinor: 45000,
            description: "Roasted tomato and basil",
          }),
        ],
      }),
      menuCategory({
        id: "mains",
        name: "Mains",
        displayOrder: 2,
        items: [
          menuItem({
            id: "steak",
            categoryId: "mains",
            name: "Ribeye Steak",
            priceMinor: 189900,
            description: "300g grass-fed",
          }),
          menuItem({
            id: "pasta",
            categoryId: "mains",
            name: "Penne Arrabiata",
            priceMinor: 72500,
            description: "",
          }),
        ],
      }),
    ];

    mountForm(fetchAvailability, forbiddenCreateBooking, menuReturning(categories));
    await flushMenu();

    // The section is present and shows both category names.
    expect(screen.getByTestId("public-restaurant-menu")).toBeTruthy();
    expect(screen.getByTestId("menu-category-name-starters").textContent?.trim()).toBe("Starters");
    expect(screen.getByTestId("menu-category-name-mains").textContent?.trim()).toBe("Mains");

    // Each available item shows its name and price.
    expect(screen.getByTestId("menu-item-name-soup").textContent?.trim()).toBe("Tomato Soup");
    expect(screen.getByTestId("menu-item-price-soup").textContent?.trim()).toBe(
      formatMenuItemPrice(45000),
    );
    expect(screen.getByTestId("menu-item-description-soup").textContent?.trim()).toBe(
      "Roasted tomato and basil",
    );

    expect(screen.getByTestId("menu-item-name-steak").textContent?.trim()).toBe("Ribeye Steak");
    expect(screen.getByTestId("menu-item-price-steak").textContent?.trim()).toBe(
      formatMenuItemPrice(189900),
    );

    // An empty Item_Description renders no description node for that item.
    expect(screen.getByTestId("menu-item-name-pasta")).toBeTruthy();
    expect(screen.queryByTestId("menu-item-description-pasta")).toBeNull();
  });

  it("omits the whole menu section when the projection is empty, leaving the booking controls unchanged", async () => {
    const { fetchAvailability } = autoAvailability();
    mountForm(fetchAvailability, forbiddenCreateBooking, menuReturning([]));
    await flushMenu();

    // Req 6.11 — no menu section at all...
    expect(screen.queryByTestId("public-restaurant-menu")).toBeNull();

    // ...and every existing booking control still renders unchanged.
    expect(partySizeControl()).toBeTruthy();
    expect(dateControl()).toBeTruthy();
    expect(screen.getByRole("button", { name: /Book Table/i })).toBeTruthy();
  });

  it("keeps the menu section absent when the menu read fails, without blocking booking", async () => {
    const { fetchAvailability } = autoAvailability();
    const failingMenu: FetchPublicRestaurantMenu = async () => {
      throw new Error("menu outage");
    };

    mountForm(fetchAvailability, forbiddenCreateBooking, failingMenu);
    await flushMenu();

    expect(screen.queryByTestId("public-restaurant-menu")).toBeNull();
    // A menu outage never touches the booking controls.
    expect(partySizeControl()).toBeTruthy();
    expect(screen.getByRole("button", { name: /Book Table/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Closure-aware availability in the booking branch (Req 3.9, 4.7, 4.8, 11.5)
//
// Task 11.4 regression. The pure closure algebra (whole-restaurant closure,
// exact table exclusion, unaffected tables) is proved in
// `restaurant-availability.test.ts` (task 4.1/4.4); this block only pins the
// DOM-level consequence in the public restaurant arm — the booking form applies
// a closure-shaped availability response without altering any other control.
// ---------------------------------------------------------------------------

describe("The closure-aware booking branch (Req 3.9, 4.7, 4.8, 11.5)", () => {
  it("renders a whole-restaurant closure as the closed state with no Booking_Slots or Table_Layout_View", async () => {
    // A restaurant-scoped Closure_Day surfaces as `closed` with no slots.
    const { fetchAvailability } = autoAvailability({ closed: true, slots: [] });
    mountForm(fetchAvailability);

    choosePartySize(3);
    chooseDate(DATES[2]);
    await advance(AVAILABILITY_DEBOUNCE_MS);

    expect(screen.getByTestId("closed-message").textContent?.trim()).toBe(MSG_CLOSED_ON_DATE);
    expect(renderedSlotStarts()).toEqual([]);
    expect(screen.queryByTestId("table-layout-live-region")).toBeNull();
  });

  it("offers only the Dining_Tables a table-scoped closure leaves open, keeping every unaffected table available", async () => {
    // `t1` is closed for this date; `t2` is unaffected. A table-scoped closure
    // removes exactly the closed id from the Available_Table set while the rest
    // stay selectable — the DOM echo of Req 4.8.
    const slots: AvailabilitySlot[] = [
      {
        startMinutes: 600,
        label: "slot-600",
        availableTableIds: ["t2"],
        availableCount: 1,
        occupiedCount: 1,
        availableCapacity: 4,
      },
    ];
    const { fetchAvailability } = autoAvailability({ slots });
    mountForm(fetchAvailability);

    choosePartySize(2);
    chooseDate(DATES[0]);
    await advance(AVAILABILITY_DEBOUNCE_MS);

    // The Booking_Slot is offered and selectable...
    fireEvent.click(slotButton(600));

    // ...and only the table the closure left open renders as `Available`.
    expect(renderedAvailableTableIds()).toEqual(["t2"]);

    // The booking controls are untouched by the closure.
    expect(partySizeControl()).toBeTruthy();
    expect(dateControl()).toBeTruthy();
    expect(screen.getByRole("button", { name: /Book Table/i })).toBeTruthy();
  });
});

describe("PublicRestaurantMenu and formatMenuItemPrice", () => {
  it("renders nothing for an empty projection", () => {
    const { container } = render(<PublicRestaurantMenu categories={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("formats whole minor units as rupees with two fraction digits", () => {
    expect(formatMenuItemPrice(0)).toBe("₹0.00");
    expect(formatMenuItemPrice(1000)).toBe("₹10.00");
    expect(formatMenuItemPrice(189900)).toBe("₹1,899.00");
    // Defensive: a non-finite or negative value never renders a broken price.
    expect(formatMenuItemPrice(Number.NaN)).toBe("₹0.00");
    expect(formatMenuItemPrice(-5)).toBe("₹0.00");
  });
});
