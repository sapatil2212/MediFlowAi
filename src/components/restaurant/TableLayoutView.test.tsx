// @vitest-environment jsdom
/**
 * TableLayoutView.test.tsx
 *
 * DOM-level property suite for the shared Table_Layout_View
 * (spec `.kiro/specs/restaurant-table-booking`, task 8.2, Properties 31 and 32).
 *
 * The environment is pinned per file by the docblock above, so the pure
 * `.test.ts` suites under `src/lib/` keep running in the default node
 * environment and nothing about the existing setup changes.
 *
 * Conventions, matching the pure suites:
 *   - exactly one property per test, tagged with the design's verbatim text;
 *   - `fc.assert(..., { numRuns: 100 })` at minimum;
 *   - generators are built from the module's exported constants (`LIMITS`,
 *     `TABLE_STATES`), so widening a limit without updating the logic fails here;
 *   - the expected state vocabulary is spelled out in this file rather than
 *     imported from the component, so a copy edit to a visible label cannot
 *     silently satisfy the assertion.
 */
import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  LIMITS,
  TABLE_STATES,
  MSG_TABLE_ALREADY_BOOKED,
  TABLE_SELECTION_ANY_LABEL,
  orderTables,
  type AvailabilityState,
  type DiningTable,
} from "../../lib/restaurant-availability";
import {
  INITIAL_TABLE_SELECTION,
  TableLayoutView,
  registryStateOf,
  selectStateOf,
  tableSelectionReducer,
  type TableLayoutMode,
  type TableSelectionState,
} from "./TableLayoutView";

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Distinct-cased Table_Areas, so an area group is unambiguous in the DOM. */
const AREAS = ["Bar", "Main", "Patio", "Rooftop"] as const;

const arbTableFields = fc.record({
  seatCapacity: fc.integer({ min: LIMITS.seatCapacity.min, max: LIMITS.seatCapacity.max }),
  area: fc.constantFrom(...AREAS),
  displayOrder: fc.integer({ min: LIMITS.displayOrder.min, max: 12 }),
  state: fc.constantFrom(...TABLE_STATES),
});

/** A set of Dining_Tables with distinct ids and distinct Table_Names. */
const arbTables = (maxCount: number) =>
  fc.array(arbTableFields, { minLength: 1, maxLength: maxCount }).map((rows): DiningTable[] =>
    rows.map((r, i) => ({
      id: `t${i + 1}`,
      name: `Table ${i + 1}`,
      seatCapacity: r.seatCapacity,
      area: r.area,
      displayOrder: r.displayOrder,
      state: r.state,
      locationId: null,
    })),
  );

// ---------------------------------------------------------------------------
// The expected state vocabulary — restated here on purpose
// ---------------------------------------------------------------------------

const SELECT_LABELS: Record<AvailabilityState, string> = {
  Available: "Available",
  Unavailable: "Booked",
  Selected: "Selected",
};

const REGISTRY_LABELS: Record<AvailabilityState, string> = {
  Available: "Active",
  Unavailable: "Inactive",
  Selected: "Active",
};

const MODE_LABELS: Record<TableLayoutMode, string[]> = {
  select: ["Available", "Booked", "Selected"],
  registry: ["Active", "Inactive"],
};

const labelFor = (state: AvailabilityState, mode: TableLayoutMode) =>
  mode === "select" ? SELECT_LABELS[state] : REGISTRY_LABELS[state];

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
}

const buttonFor = (id: string): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>(`button[data-table-id="${id}"]`);
  expect(el).not.toBeNull();
  return el as HTMLButtonElement;
};

const liveRegionText = () =>
  (screen.getByTestId("table-layout-live-region").textContent ?? "").trim();

// ---------------------------------------------------------------------------
// Property 31
// ---------------------------------------------------------------------------

describe("Property 31: The Table_Layout_View exposes exactly one state per table, in text and to assistive technology", () => {
  // Feature: restaurant-table-booking, Property 31: For any set of Dining_Tables and any Availability_State assignment, the Table_Layout_View renders each Dining_Table exactly once inside its Table_Area group in the canonical order, renders its Table_Name, its Seat_Capacity, and exactly one state as visible text alongside colour, gives it an accessible name containing the Table_Name, the Seat_Capacity, and that state, marks it pressed when and only when its state is `Selected`, and marks it disabled to assistive technology when and only when its state is `Unavailable` while keeping it focusable; a Dining_Table renders as `Available` if and only if it is an Available_Table of the selected Booking_Slot and is not the selected Dining_Table.
  it("renders every table once in its area group in canonical order, with one visible state, the composed accessible name, and pressed / aria-disabled exactly on Selected / Unavailable", () => {
    const arbCase = arbTables(6).chain((tables) =>
      fc.record({
        tables: fc.constant(tables),
        mode: fc.constantFrom<TableLayoutMode>("select", "registry"),
        availableTableIds: fc.subarray(tables.map((t) => t.id)),
        // -1 = `Any available table`, i.e. no selected Dining_Table.
        selectedIndex: fc.integer({ min: -1, max: tables.length - 1 }),
      }),
    );

    fc.assert(
      fc.property(arbCase, ({ tables, mode, availableTableIds, selectedIndex }) => {
        const selectedTableId = selectedIndex < 0 ? null : tables[selectedIndex].id;
        const ordered = orderTables(tables);
        const stateOf =
          mode === "select"
            ? selectStateOf(availableTableIds, selectedTableId === null ? [] : [selectedTableId])
            : registryStateOf;

        try {
          render(
            <TableLayoutView
              tables={ordered}
              stateOf={stateOf}
              onActivate={() => {}}
              mode={mode}
            />,
          );

          const buttons = screen.getAllByRole("button");

          // Rendered exactly once each, in the canonical order.
          expect(buttons).toHaveLength(tables.length);
          expect(buttons.map((b) => b.getAttribute("data-table-id"))).toEqual(
            ordered.map((t) => t.id),
          );

          // Every area group is a role="group" section named by its visible heading.
          const groups = screen.getAllByRole("group");
          for (const group of groups) {
            const labelledBy = group.getAttribute("aria-labelledby");
            expect(labelledBy).toBeTruthy();
            const heading = document.getElementById(labelledBy as string);
            expect(heading).not.toBeNull();
            expect((heading?.textContent ?? "").trim().length).toBeGreaterThan(0);
          }

          for (const table of tables) {
            // Reference definition of the rendered state.
            const expectedState: AvailabilityState =
              mode === "registry"
                ? table.state === "active"
                  ? "Available"
                  : "Unavailable"
                : selectedTableId === table.id
                  ? "Selected"
                  : availableTableIds.includes(table.id)
                    ? "Available"
                    : "Unavailable";
            const expectedLabel = labelFor(expectedState, mode);

            // Exactly one button for this table, and it sits inside the group of
            // its own Table_Area.
            expect(document.querySelectorAll(`button[data-table-id="${table.id}"]`)).toHaveLength(
              1,
            );
            const button = buttonFor(table.id);
            const section = button.closest("section");
            expect(section).not.toBeNull();
            expect(section?.getAttribute("role")).toBe("group");
            const heading = document.getElementById(section?.getAttribute("aria-labelledby") ?? "");
            expect((heading?.textContent ?? "").trim()).toBe(table.area);
            expect(
              within(section as HTMLElement).getByRole("button", {
                name: `${table.name}, seats ${table.seatCapacity}, ${expectedLabel}`,
              }),
            ).toBe(button);

            // Table_Name, Seat_Capacity and EXACTLY ONE state as visible text.
            const text = button.textContent ?? "";
            expect(text).toContain(table.name);
            expect(text).toContain(`Seats ${table.seatCapacity}`);
            expect(occurrences(text, expectedLabel)).toBe(1);
            expect(MODE_LABELS[mode].filter((l) => occurrences(text, l) > 0)).toEqual([
              expectedLabel,
            ]);

            // The accessible name carries all three facts.
            const accessibleName = button.getAttribute("aria-label") ?? "";
            expect(accessibleName).toBe(
              `${table.name}, seats ${table.seatCapacity}, ${expectedLabel}`,
            );
            expect(accessibleName).toContain(table.name);
            expect(accessibleName).toContain(String(table.seatCapacity));
            expect(accessibleName).toContain(expectedLabel);

            // Pressed exactly for `Selected`.
            expect(button.getAttribute("aria-pressed")).toBe(
              expectedState === "Selected" ? "true" : "false",
            );

            // Disabled to assistive technology exactly for `Unavailable`, and
            // still focusable — never the `disabled` attribute.
            expect(button.getAttribute("aria-disabled")).toBe(
              expectedState === "Unavailable" ? "true" : "false",
            );
            expect(button.hasAttribute("disabled")).toBe(false);
            expect(button.disabled).toBe(false);
            button.focus();
            expect(document.activeElement).toBe(button);

            // `Available` renders exactly for an Available_Table of the selected
            // Booking_Slot that is not the selected Dining_Table.
            if (mode === "select") {
              const isAvailableTable =
                availableTableIds.includes(table.id) && selectedTableId !== table.id;
              expect(occurrences(text, SELECT_LABELS.Available) === 1).toBe(isAvailableTable);
            }
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 32
// ---------------------------------------------------------------------------

describe("Property 32: Table selection holds at most one table and resets on every party-size or date change", () => {
  // Feature: restaurant-table-booking, Property 32: For any sequence of table activations, at most one Dining_Table is `Selected` after every step and it is the most recently activated Available_Table; activating a Dining_Table whose state is `Unavailable` leaves the selection unchanged and displays `This table is already booked for the selected time`; and for any change of Party_Size or booking date, the Table selection is `Any available table` once the fresh availability is rendered, retaining no previously selected Dining_Table.
  it("keeps at most one selection equal to the most recently activated available table, leaves it unchanged and announces the message on an unavailable activation, and resets to `Any available table`", () => {
    const arbCase = arbTables(5).chain((tables) =>
      fc.record({
        tables: fc.constant(tables),
        availableTableIds: fc.subarray(tables.map((t) => t.id)),
        actions: fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant<"activate">("activate"),
              index: fc.integer({ min: 0, max: tables.length - 1 }),
            }),
            fc.record({ kind: fc.constant<"reset">("reset"), index: fc.constant(0) }),
          ),
          { minLength: 1, maxLength: 5 },
        ),
      }),
    );

    fc.assert(
      fc.property(arbCase, ({ tables, availableTableIds, actions }) => {
        const ordered = orderTables(tables);

        let selection: TableSelectionState = { ...INITIAL_TABLE_SELECTION };
        // The expected Table_Group, in activation order — a card toggles.
        let expectedSelectedIds: string[] = [];
        let captured: TableSelectionState | null = null;

        // The handler always folds from the CURRENT selection, so one render per
        // step is enough — the DOM a step clicks on is the DOM that step's
        // predecessor asserted on.
        const currentRef = { current: selection };
        const ui = (state: TableSelectionState) => (
          <TableLayoutView
            tables={ordered}
            stateOf={selectStateOf(availableTableIds, state.selectedTableIds)}
            onActivate={(t) => {
              captured = tableSelectionReducer(currentRef.current, {
                type: "activate",
                table: t,
                availableTableIds,
              });
            }}
            mode="select"
            message={state.message}
          />
        );

        try {
          const view = render(ui(selection));

          for (const action of actions) {
            let activatedUnavailable = false;

            if (action.kind === "reset") {
              // Req 6.13 — a Party_Size or booking date change resets it.
              selection = tableSelectionReducer(selection, { type: "reset" });
              expectedSelectedIds = [];
            } else {
              const table = tables[action.index];
              activatedUnavailable = !availableTableIds.includes(table.id);

              captured = null;
              // An `Unavailable` card is aria-disabled, not disabled, so this
              // click reaches the handler — the Req 6.8 path.
              fireEvent.click(buttonFor(table.id));
              expect(captured).not.toBeNull();

              selection = captured as unknown as TableSelectionState;
              if (availableTableIds.includes(table.id)) {
                // Activating a member removes it; activating a non-member adds it.
                expectedSelectedIds = expectedSelectedIds.includes(table.id)
                  ? expectedSelectedIds.filter((id) => id !== table.id)
                  : [...expectedSelectedIds, table.id];
              }
            }

            currentRef.current = selection;
            view.rerender(ui(selection));

            // The Table_Group is exactly the set of Available_Tables activated an
            // odd number of times, in activation order.
            expect(selection.selectedTableIds).toEqual(expectedSelectedIds);
            const pressed = screen
              .getAllByRole("button")
              .filter((b) => b.getAttribute("aria-pressed") === "true");
            // Every member is pressed, and nothing else is.
            expect(pressed.map((b) => b.getAttribute("data-table-id")).sort()).toEqual(
              [...expectedSelectedIds].sort(),
            );

            if (activatedUnavailable) {
              // The selection is untouched and the reason is in the live region.
              expect(selection.message).toBe(MSG_TABLE_ALREADY_BOOKED);
              expect(liveRegionText()).toBe(MSG_TABLE_ALREADY_BOOKED);
            }

            if (action.kind === "reset") {
              // Nothing is retained, and the live region says so.
              expect(selection.selectedTableIds).toEqual([]);
              expect(selection.message).toBeNull();
              expect(liveRegionText()).toBe(TABLE_SELECTION_ANY_LABEL);
            }
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});
