// @vitest-environment jsdom
/**
 * TableManager.test.tsx
 *
 * Focused DOM suite for the registry-backed `Tables` Settings sub-tab
 * (spec `.kiro/specs/restaurant-dashboard-settings`, task 7.4, Req 4.8-4.13,
 * 5.8, 5.10, 9.3-9.7).
 *
 * Every server interaction is an injected callback, exactly like
 * `RestaurantProfilePanel.test.tsx`, so the tests never touch the database,
 * auth, or SQL. The production server-function module is mocked at the boundary
 * so importing the component does not pull `db`/`auth.server` into jsdom.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/restaurant-settings", () => ({
  listRestaurantTablesServerFn: vi.fn(),
  saveRestaurantTableServerFn: vi.fn(),
  deleteRestaurantTableServerFn: vi.fn(),
  listRestaurantClosuresServerFn: vi.fn(),
  createRestaurantClosureServerFn: vi.fn(),
  deleteRestaurantClosureServerFn: vi.fn(),
}));

import {
  TableManager,
  type FetchRestaurantTables,
  type SaveRestaurantTable,
  type FetchRestaurantClosures,
  type CreateRestaurantClosure,
  type DeleteRestaurantClosure,
} from "./TableManager";
import type { DiningArea, ClosureDay } from "../../lib/restaurant-settings-model";
import type { RestaurantTablesView, RestaurantClosuresView } from "../../lib/restaurant-settings";

type Permission = "operate" | "view_only" | "none";
type TableRow = RestaurantTablesView["tables"][number];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const AREAS: DiningArea[] = [
  { id: "a1", name: "Main", displayOrder: 1, tableCount: 1, locationId: null },
  { id: "a2", name: "Terrace", displayOrder: 2, tableCount: 0, locationId: null },
];

function tableRow(overrides: Partial<TableRow> & { id: string; name: string }): TableRow {
  return {
    seatCapacity: 4,
    area: "Main",
    areaId: "a1",
    displayOrder: 1,
    state: "active",
    tenantId: "t1",
    locationId: null,
    closureCount: 0,
    ...overrides,
  } as TableRow;
}

function tablesView(tables: TableRow[], permission: Permission): RestaurantTablesView {
  const canManage = permission === "operate";
  return { tables, selectableAreas: AREAS, canManage, readOnly: !canManage };
}

const fetchTablesOf = (view: RestaurantTablesView): FetchRestaurantTables =>
  vi.fn(async () => view);

const emptyClosures: RestaurantClosuresView = {
  closures: [],
  monthStart: "",
  nextMonthStart: "",
  canManage: true,
};

const fetchClosuresOf = (view: RestaurantClosuresView): FetchRestaurantClosures =>
  vi.fn(async () => view);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Registry-backed area selector (Req 5.8)", () => {
  it("offers only the stored dining areas as Table_Area options", async () => {
    const fetchTables = fetchTablesOf(
      tablesView([tableRow({ id: "tbl1", name: "Window 1" })], "operate"),
    );
    render(<TableManager permission="operate" fetchTables={fetchTables} />);
    await screen.findByTestId("tables-list");

    const select = screen.getByLabelText("Dining area") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    // The placeholder plus exactly the two stored areas — no free text.
    expect(optionValues).toEqual(["", "a1", "a2"]);
  });
});

describe("Table closure count (Req 4.12)", () => {
  it("shows each table's stored table-scoped closure count", async () => {
    const fetchTables = fetchTablesOf(
      tablesView([tableRow({ id: "tbl1", name: "Window 1", closureCount: 3 })], "operate"),
    );
    render(<TableManager permission="operate" fetchTables={fetchTables} />);
    await screen.findByTestId("tables-list");

    expect(screen.getByTestId("table-closure-count-tbl1").textContent).toContain("3 closures");
  });
});

describe("Per-table closure calendar (Req 4.2, 4.4, 4.8)", () => {
  it("loads the table's closures and creates one for a selected date", async () => {
    const fetchTables = fetchTablesOf(
      tablesView([tableRow({ id: "tbl1", name: "Window 1" })], "operate"),
    );
    const fetchClosures = fetchClosuresOf(emptyClosures);
    const createClosure: CreateRestaurantClosure = vi.fn(async () => ({
      status: "created" as const,
      closure: {
        id: "c1",
        date: "2024-06-15",
        scope: { type: "table", tableId: "tbl1" },
        reason: "Maintenance",
        isHoliday: false,
        affectedBookingCount: 0,
        locationId: null,
      } as ClosureDay,
    }));

    render(
      <TableManager
        permission="operate"
        fetchTables={fetchTables}
        fetchClosures={fetchClosures}
        createClosure={createClosure}
      />,
    );
    await screen.findByTestId("tables-list");

    fireEvent.click(screen.getByRole("button", { name: /closures/i }));
    await screen.findByTestId("table-closure-calendar-tbl1");
    await waitFor(() => expect(fetchClosures).toHaveBeenCalled());

    // A mid-month day always exists in the displayed month.
    const now = new Date();
    const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-15`;
    fireEvent.click(screen.getByTestId(`closure-day-${date}`));

    fireEvent.change(screen.getByLabelText("Closure reason"), { target: { value: "Maintenance" } });
    fireEvent.click(screen.getByRole("button", { name: /block this date/i }));

    await waitFor(() => expect(createClosure).toHaveBeenCalledTimes(1));
    const call = vi.mocked(createClosure).mock.calls[0][0];
    expect(call.data.date).toBe(date);
    expect(call.data.scope).toEqual({ type: "table", tableId: "tbl1" });
    expect(call.data.reason).toBe("Maintenance");
  });

  it("navigates to the next month and re-reads the closures", async () => {
    const fetchTables = fetchTablesOf(
      tablesView([tableRow({ id: "tbl1", name: "Window 1" })], "operate"),
    );
    const fetchClosures = fetchClosuresOf(emptyClosures);

    render(
      <TableManager permission="operate" fetchTables={fetchTables} fetchClosures={fetchClosures} />,
    );
    await screen.findByTestId("tables-list");

    fireEvent.click(screen.getByRole("button", { name: /closures/i }));
    await screen.findByTestId("table-closure-calendar-tbl1");
    await waitFor(() => expect(fetchClosures).toHaveBeenCalledTimes(1));

    const firstMonth = vi.mocked(fetchClosures).mock.calls[0][0].data.month;
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));

    await waitFor(() => expect(fetchClosures).toHaveBeenCalledTimes(2));
    const secondMonth = vi.mocked(fetchClosures).mock.calls[1][0].data.month;
    const expected = firstMonth === 12 ? 1 : firstMonth + 1;
    expect(secondMonth).toBe(expected);
  });

  it("deletes a stored table closure", async () => {
    const fetchTables = fetchTablesOf(
      tablesView([tableRow({ id: "tbl1", name: "Window 1", closureCount: 1 })], "operate"),
    );
    const now = new Date();
    const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-10`;
    const fetchClosures = fetchClosuresOf({
      ...emptyClosures,
      closures: [
        {
          id: "c9",
          date,
          scope: { type: "table", tableId: "tbl1" },
          reason: "Repair",
          isHoliday: false,
          affectedBookingCount: 0,
          locationId: null,
        } as ClosureDay,
      ],
    });
    const deleteClosure: DeleteRestaurantClosure = vi.fn(async () => ({
      status: "deleted" as const,
    }));

    render(
      <TableManager
        permission="operate"
        fetchTables={fetchTables}
        fetchClosures={fetchClosures}
        deleteClosure={deleteClosure}
      />,
    );
    await screen.findByTestId("tables-list");

    fireEvent.click(screen.getByRole("button", { name: /closures/i }));
    await screen.findByTestId("table-closure-calendar-tbl1");
    await waitFor(() => expect(fetchClosures).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId(`closure-day-${date}`));
    fireEvent.click(await screen.findByRole("button", { name: /remove closure/i }));

    await waitFor(() => expect(deleteClosure).toHaveBeenCalledTimes(1));
    expect(vi.mocked(deleteClosure).mock.calls[0][0].data.closureId).toBe("c9");
  });
});

describe("Read-only mode (Req 5.10, 4.13)", () => {
  it("hides table create/delete and closure create controls under view_only", async () => {
    const fetchTables = fetchTablesOf(
      tablesView([tableRow({ id: "tbl1", name: "Window 1", closureCount: 0 })], "view_only"),
    );
    const fetchClosures = fetchClosuresOf({ ...emptyClosures, canManage: false });

    render(
      <TableManager
        permission="view_only"
        fetchTables={fetchTables}
        fetchClosures={fetchClosures}
      />,
    );
    await screen.findByTestId("tables-list");

    // No table mutation controls.
    expect(screen.queryByLabelText("Dining area")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete window 1/i })).toBeNull();

    // The closure calendar is still viewable, but offers no create control.
    fireEvent.click(screen.getByRole("button", { name: /closures/i }));
    await screen.findByTestId("table-closure-calendar-tbl1");
    await waitFor(() => expect(fetchClosures).toHaveBeenCalled());

    const now = new Date();
    const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-15`;
    fireEvent.click(screen.getByTestId(`closure-day-${date}`));
    expect(screen.queryByRole("button", { name: /block this date/i })).toBeNull();
  });
});
