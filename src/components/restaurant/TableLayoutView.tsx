// ─────────────────────────────────────────────────────────────────────────────
// TableLayoutView.tsx — the one visual table view, two consumers.
//
// The public booking form mounts it in `select` mode (interactive selection,
// Req 6.5-6.9) and the dashboard `Tables` sub-tab mounts it in `registry` mode
// (read-only registry, Req 3.15).
//
// The accessibility contract below is a set of assertions the component tests
// hold to (`TableLayoutView.test.tsx`, Properties 31 and 32), not a styling
// suggestion:
//
//   - each Table_Area is a <section role="group"> whose `aria-labelledby` points
//     at the VISIBLE area heading, and every Dining_Table is a
//     <button type="button"> child rendered in the order supplied — already
//     canonical, because callers pass `orderTables(...)`;
//   - the accessible name is composed text, `${name}, seats ${seatCapacity},
//     ${stateLabel}`, so the state reaches assistive technology through the name
//     and not only through a class;
//   - a VISIBLE text label for the state renders inside every card
//     (`Available` / `Booked` / `Selected` in select mode, `Active` / `Inactive`
//     in registry mode). Colour is an additional channel, never the only one;
//   - `Selected` sets aria-pressed="true", `Available` sets aria-pressed="false",
//     `Unavailable` sets aria-disabled="true" and keeps aria-pressed="false";
//   - an `Unavailable` table uses aria-disabled and NEVER the `disabled`
//     attribute, so it stays focusable and still fires `onActivate` — which is
//     what makes Req 6.8 (activate an unavailable table → keep the current
//     selection, show `This table is already booked for the selected time`)
//     reachable by keyboard;
//   - `message` renders into an aria-live="polite" region that also announces
//     selection changes, so a screen-reader user learns the outcome of an
//     activation;
//   - registry mode renders no activation affordance and no create / edit /
//     delete control — those live in `TableManager` and are gated on the
//     resolved `restaurant_config` permission (Req 2.8).
//
// The component holds no state and performs no I/O: the selection lives in the
// caller's reducer (`tableSelectionReducer` below) and the Availability_State of
// each table is supplied by `stateOf`.
//
// Presentation: each Dining_Table is drawn as a floor-plan piece — a table top
// (round for small covers, rounded-rectangular for larger ones) with ONE seat
// marker per seat, so a 2-seater and an 8-seater are told apart at a glance. The
// shapes, the colours and the hover / focus / pressed affordances are ADDITIONAL
// channels layered on top of the visible state text; none of them is ever the
// only carrier of the state, and every decorative part is `aria-hidden` so it
// cannot pollute the accessible name.
// ─────────────────────────────────────────────────────────────────────────────
import { useId } from "react";
import {
  DEFAULT_TABLE_AREA,
  LIMITS,
  MSG_TABLE_ALREADY_BOOKED,
  TABLE_SELECTION_ANY_LABEL,
  type AvailabilityState,
  type DiningTable,
} from "../../lib/restaurant-availability";
import { cn } from "../../lib/utils";

/** The Dining_Table facts the layout renders. */
export type LayoutTable = DiningTable;

export type TableLayoutMode = "select" | "registry";

export interface TableLayoutViewProps {
  /** Already ordered by `orderTables` — rendered in exactly this order. */
  tables: LayoutTable[];
  stateOf: (t: LayoutTable) => AvailabilityState;
  onActivate?: (t: LayoutTable) => void;
  mode: TableLayoutMode;
  /** Rendered into the aria-live region (Req 6.8, 6.10). */
  message?: string | null;
}

// ---------------------------------------------------------------------------
// The state vocabulary — one visible label per Availability_State, per mode
// ---------------------------------------------------------------------------

/**
 * The visible state label, which is also the third component of the accessible
 * name. Exactly one of these renders inside every card.
 */
export function stateLabelFor(state: AvailabilityState, mode: TableLayoutMode): string {
  if (mode === "registry") return state === "Unavailable" ? "Inactive" : "Active";
  return state === "Unavailable" ? "Booked" : state;
}

/** The composed accessible name (Req 6.9). */
export function accessibleNameFor(
  table: LayoutTable,
  state: AvailabilityState,
  mode: TableLayoutMode,
): string {
  return `${table.name}, seats ${table.seatCapacity}, ${stateLabelFor(state, mode)}`;
}

// ---------------------------------------------------------------------------
// The visual vocabulary — colour and shape, both ADDITIONAL channels
// ---------------------------------------------------------------------------

/** The card. Colour is an ADDITIONAL channel — the state label is the primary one. */
const CARD_CLASSES: Record<AvailabilityState, string> = {
  Available: "border-zinc-200 bg-white text-zinc-700 hover:border-brand/40",
  Selected: "border-brand bg-brand/5 text-brand ring-1 ring-brand/25",
  Unavailable: "border-zinc-100 bg-zinc-50 text-zinc-400",
};

/** The table top itself: lit and liftable, claimed in brand, or hatched out. */
const TABLE_TOP_CLASSES: Record<AvailabilityState, string> = {
  Available: "border-zinc-300 bg-gradient-to-b from-white to-zinc-100 shadow-sm",
  Selected: "border-brand bg-gradient-to-b from-brand-light to-brand shadow-sm",
  // Hatched, so `Booked` / `Inactive` also reads in greyscale — the visible
  // state text remains the primary channel either way.
  Unavailable:
    "border-zinc-200 bg-zinc-100 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,#d4d4d8_3px,#d4d4d8_4px)]",
};

/** The seat markers around the top — one per seat. */
const SEAT_CLASSES: Record<AvailabilityState, string> = {
  Available: "bg-zinc-300",
  Selected: "bg-brand/50",
  Unavailable: "bg-zinc-200",
};

const STATE_PILL_CLASSES: Record<AvailabilityState, string> = {
  Available: "bg-emerald-50 text-emerald-700",
  Selected: "bg-brand/10 text-brand",
  Unavailable: "bg-zinc-100 text-zinc-400",
};

const STATE_DOT_CLASSES: Record<AvailabilityState, string> = {
  Available: "bg-emerald-500",
  Selected: "bg-brand",
  Unavailable: "bg-zinc-300",
};

// ---------------------------------------------------------------------------
// Table geometry — shape and seat placement, derived from Seat_Capacity alone
// ---------------------------------------------------------------------------

export type TableShape = "round" | "rect";

/** Covers up to this many seats are drawn as a round top; above it, a long one. */
export const ROUND_TABLE_MAX_SEATS = 4;

/** Seat markers are one per seat, bounded by the Seat_Capacity limit. */
function seatMarkerCount(seatCapacity: number): number {
  const seats = Number(seatCapacity);
  if (!Number.isFinite(seats)) return 0;
  return Math.max(0, Math.min(LIMITS.seatCapacity.max, Math.trunc(seats)));
}

/** Round for a small cover, rounded-rectangular for a larger one (Req 6.5). */
export function tableShapeFor(seatCapacity: number): TableShape {
  return seatMarkerCount(seatCapacity) <= ROUND_TABLE_MAX_SEATS ? "round" : "rect";
}

/**
 * Where the seats sit around a round top, as utility classes rather than inline
 * styles — the layout is a fixed compass per cover, so nothing has to be
 * computed per render.
 */
const ROUND_SEAT_POSITIONS: readonly (readonly string[])[] = [
  [],
  ["left-1/2 -translate-x-1/2 top-0"],
  ["left-1/2 -translate-x-1/2 top-0", "left-1/2 -translate-x-1/2 bottom-0"],
  ["left-1/2 -translate-x-1/2 top-0", "bottom-1 left-1", "bottom-1 right-1"],
  [
    "left-1/2 -translate-x-1/2 top-0",
    "top-1/2 -translate-y-1/2 right-0",
    "left-1/2 -translate-x-1/2 bottom-0",
    "top-1/2 -translate-y-1/2 left-0",
  ],
];

/**
 * The drawn Dining_Table: a top plus one seat marker per seat. Entirely
 * decorative — `aria-hidden`, no text, so the accessible name stays exactly the
 * composed `${name}, seats ${seatCapacity}, ${stateLabel}`.
 */
function TableTopGraphic({
  seatCapacity,
  state,
}: {
  seatCapacity: number;
  state: AvailabilityState;
}) {
  const seats = seatMarkerCount(seatCapacity);
  const seatClass = cn("h-1.5 w-1.5 rounded-full", SEAT_CLASSES[state]);

  if (tableShapeFor(seats) === "round") {
    const positions = ROUND_SEAT_POSITIONS[seats] ?? [];
    return (
      <span aria-hidden="true" className="relative flex h-12 w-12 items-center justify-center">
        <span
          className={cn(
            "h-9 w-9 rounded-full border-2 transition-colors",
            TABLE_TOP_CLASSES[state],
          )}
        />
        {positions.map((position, i) => (
          <span key={i} aria-hidden="true" className={cn("absolute", seatClass, position)} />
        ))}
      </span>
    );
  }

  // A long top: half the seats along each side, the odd one at the head.
  const nearSide = Math.ceil(seats / 2);
  const farSide = seats - nearSide;
  return (
    <span aria-hidden="true" className="flex min-w-[4rem] flex-col gap-1">
      <span className="flex justify-around gap-1">
        {Array.from({ length: nearSide }, (_, i) => (
          <span key={i} aria-hidden="true" className={seatClass} />
        ))}
      </span>
      <span className={cn("h-7 rounded-lg border-2 transition-colors", TABLE_TOP_CLASSES[state])} />
      <span className="flex justify-around gap-1">
        {Array.from({ length: farSide }, (_, i) => (
          <span key={i} aria-hidden="true" className={seatClass} />
        ))}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Table selection — the reducer both consumers share (Req 6.7, 6.8, 6.13)
// ---------------------------------------------------------------------------

export interface TableSelectionState {
  /**
   * The selected Table_Group, in activation order. Empty = `Any available table`
   * (Req 6.3, 6.13). Several Dining_Tables may be combined to seat one party,
   * and there is no minimum: a party of one may take four tables (Req 6.7).
   */
  selectedTableIds: string[];
  /** The message the live region announces, or null. */
  message: string | null;
}

export const INITIAL_TABLE_SELECTION: TableSelectionState = {
  selectedTableIds: [],
  message: null,
};

export type TableSelectionAction =
  /** A guest activated a card — by pointer or by keyboard. */
  | { type: "activate"; table: LayoutTable; availableTableIds: readonly string[] }
  /** Party_Size or booking date changed — the selection resets (Req 6.13). */
  | { type: "reset" };

/**
 * Holds the selected Table_Group. Activating an Available_Table that is not yet
 * in the group adds it; activating a member removes it, so a card toggles
 * (Req 6.7). Activating an Unavailable_Table leaves the group untouched and
 * surfaces `MSG_TABLE_ALREADY_BOOKED` (Req 6.8). A reset returns the selection
 * to `Any available table` (Req 6.13).
 */
export function tableSelectionReducer(
  state: TableSelectionState,
  action: TableSelectionAction,
): TableSelectionState {
  switch (action.type) {
    case "activate": {
      const available = (action.availableTableIds ?? []).includes(action.table.id);
      if (!available) {
        // Req 6.8 — the selection is unchanged, and the reason is announced.
        return { selectedTableIds: [...state.selectedTableIds], message: MSG_TABLE_ALREADY_BOOKED };
      }
      const selected = state.selectedTableIds.includes(action.table.id);
      return {
        selectedTableIds: selected
          ? state.selectedTableIds.filter((id) => id !== action.table.id)
          : [...state.selectedTableIds, action.table.id],
        message: null,
      };
    }
    case "reset":
      return { ...INITIAL_TABLE_SELECTION, selectedTableIds: [] };
    default:
      return state;
  }
}

/**
 * The `stateOf` a select-mode consumer passes: a Dining_Table is `Selected` when
 * it is a member of the Table_Group, `Available` when it is an Available_Table of
 * the selected Booking_Slot that is not a member, and `Unavailable` otherwise
 * (Property 31).
 */
export function selectStateOf(
  availableTableIds: readonly string[],
  selectedTableIds: readonly string[],
): (t: LayoutTable) => AvailabilityState {
  const available = new Set(availableTableIds ?? []);
  const selected = new Set(selectedTableIds ?? []);
  return (t: LayoutTable) => {
    if (selected.has(t.id)) return "Selected";
    return available.has(t.id) ? "Available" : "Unavailable";
  };
}

/** The `stateOf` a registry-mode consumer passes: Table_State, nothing else. */
export function registryStateOf(t: LayoutTable): AvailabilityState {
  return t.state === "active" ? "Available" : "Unavailable";
}

// ---------------------------------------------------------------------------
// Grouping — every table appears exactly once, inside its own Table_Area group
// ---------------------------------------------------------------------------

interface AreaGroup {
  area: string;
  tables: LayoutTable[];
}

function groupByArea(tables: readonly LayoutTable[]): AreaGroup[] {
  const groups: AreaGroup[] = [];
  for (const t of tables ?? []) {
    const area = String(t.area ?? "").trim() || DEFAULT_TABLE_AREA;
    const group = groups.find((g) => g.area === area);
    if (group) group.tables.push(t);
    else groups.push({ area, tables: [t] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export function TableLayoutView({
  tables,
  stateOf,
  onActivate,
  mode,
  message,
}: TableLayoutViewProps) {
  const uid = useId();
  const list = Array.isArray(tables) ? tables : [];
  const groups = groupByArea(list);

  // Registry mode renders no activation affordance at all (Req 3.15).
  const activatable = mode === "select" && typeof onActivate === "function";

  const selected = list.find((t) => stateOf(t) === "Selected") ?? null;
  const trimmedMessage = String(message ?? "").trim();
  const announcement =
    trimmedMessage.length > 0
      ? trimmedMessage
      : mode === "select"
        ? selected
          ? `${selected.name} selected`
          : TABLE_SELECTION_ANY_LABEL
        : "";

  return (
    <div className="space-y-4">
      {groups.length === 0 && (
        <p className="text-[11px] font-bold text-zinc-400">No tables to show.</p>
      )}

      {groups.map((group, groupIndex) => {
        const headingId = `${uid}-area-${groupIndex}`;
        return (
          <section
            key={`${group.area}-${groupIndex}`}
            role="group"
            aria-labelledby={headingId}
            data-area={group.area}
            className="space-y-2"
          >
            {/* The VISIBLE area heading the group is named by. */}
            <h4
              id={headingId}
              className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1"
            >
              {group.area}
            </h4>

            {/* The floor the area's tables stand on. */}
            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-zinc-100 bg-zinc-50/60 p-2.5">
              {group.tables.map((t) => {
                const state = stateOf(t);
                const label = stateLabelFor(state, mode);
                const lift = activatable && state !== "Unavailable";
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-table-id={t.id}
                    data-state={state}
                    data-shape={tableShapeFor(t.seatCapacity)}
                    // Req 6.9 — the state travels in the accessible name.
                    aria-label={accessibleNameFor(t, state, mode)}
                    aria-pressed={state === "Selected"}
                    // Never the `disabled` attribute: the card stays focusable
                    // and still fires `onActivate` (Req 6.8).
                    aria-disabled={state === "Unavailable"}
                    onClick={activatable ? () => onActivate?.(t) : undefined}
                    className={cn(
                      "flex min-w-[7.5rem] flex-col items-center gap-1.5 rounded-2xl border px-2.5 py-3 text-center outline-none transition-all duration-150",
                      // A clear focus ring in every state — an Unavailable_Table
                      // stays keyboard reachable (Req 6.8).
                      "focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                      CARD_CLASSES[state],
                      activatable ? "cursor-pointer" : "cursor-default",
                      // A subtle hover lift and a pressed state that reads as the
                      // table being claimed. Dropped under reduced motion.
                      lift
                        ? "hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98]"
                        : "",
                      activatable && !lift ? "active:scale-[0.99]" : "",
                      "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                    )}
                  >
                    {/* Decorative only: the drawn top and one marker per seat. */}
                    <TableTopGraphic seatCapacity={t.seatCapacity} state={state} />

                    <span className="block max-w-[10rem] truncate text-xs font-bold leading-tight">
                      {t.name}
                    </span>
                    <span
                      className={cn(
                        "block text-[10px] font-semibold",
                        state === "Selected" ? "text-brand/70" : "text-zinc-500",
                      )}
                    >
                      Seats {t.seatCapacity}
                    </span>
                    {/* Req 6.9 — the state as VISIBLE TEXT, never colour alone. */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        STATE_PILL_CLASSES[state],
                      )}
                    >
                      <span
                        className={cn("h-1.5 w-1.5 rounded-full", STATE_DOT_CLASSES[state])}
                        aria-hidden="true"
                      />
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Req 6.8, 6.10 — the message AND the selection change are announced. */}
      <div
        role="status"
        aria-live="polite"
        data-testid="table-layout-live-region"
        className={cn(
          "text-[11px] font-bold",
          trimmedMessage.length > 0 ? "text-amber-600" : "text-zinc-400",
        )}
      >
        {announcement}
      </div>
    </div>
  );
}

export default TableLayoutView;
