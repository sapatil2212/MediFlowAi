// @vitest-environment jsdom
/**
 * DiningAreasSettings.test.tsx
 *
 * Focused DOM suite for the `Dining Areas` Settings sub-tab
 * (spec `.kiro/specs/restaurant-dashboard-settings`, task 7.4, Req 5.1-5.10).
 *
 * Every server interaction is an injected callback, exactly like
 * `RestaurantProfilePanel.test.tsx`, so the tests never touch the database,
 * auth, or SQL. The production server-function module is mocked at the boundary
 * so importing the component does not pull `db`/`auth.server` into jsdom.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/restaurant-settings", () => ({
  listRestaurantDiningAreasServerFn: vi.fn(),
  createRestaurantDiningAreaServerFn: vi.fn(),
  deleteRestaurantDiningAreaServerFn: vi.fn(),
}));

import {
  DiningAreasSettings,
  type ListRestaurantDiningAreas,
  type CreateRestaurantDiningArea,
  type DeleteRestaurantDiningArea,
} from "./DiningAreasSettings";
import { EFFECTIVE_MAIN_AREA_ID, type DiningArea } from "../../lib/restaurant-settings-model";
import type { RestaurantDiningAreasView } from "../../lib/restaurant-settings";

type Permission = "operate" | "view_only" | "none";

function area(overrides: Partial<DiningArea> & { id: string; name: string }): DiningArea {
  return {
    displayOrder: 1,
    tableCount: 0,
    locationId: null,
    ...overrides,
  };
}

function viewOf(areas: DiningArea[], permission: Permission): RestaurantDiningAreasView {
  const canManage = permission === "operate";
  return { areas, canManage, readOnly: !canManage };
}

const listOf = (view: RestaurantDiningAreasView): ListRestaurantDiningAreas =>
  vi.fn(async () => view);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Dining areas listing (Req 5.1)", () => {
  it("renders each stored area with its assigned-table count", async () => {
    const listAreas = listOf(
      viewOf(
        [
          area({ id: "a1", name: "Main", displayOrder: 1, tableCount: 3 }),
          area({ id: "a2", name: "Terrace", displayOrder: 2, tableCount: 1 }),
        ],
        "operate",
      ),
    );
    render(<DiningAreasSettings permission="operate" listAreas={listAreas} />);

    await screen.findByTestId("dining-areas-list");
    expect(screen.getByTestId("dining-area-count-a1").textContent).toContain("3 tables");
    expect(screen.getByTestId("dining-area-count-a2").textContent).toContain("1 table");
  });
});

describe("Dining area creation (Req 5.2)", () => {
  it("creates an area from the trimmed name and reloads", async () => {
    const listAreas = listOf(viewOf([area({ id: "a1", name: "Main", tableCount: 0 })], "operate"));
    const createArea: CreateRestaurantDiningArea = vi.fn(async () => ({
      status: "created" as const,
      area: area({ id: "a2", name: "Terrace" }),
    }));

    render(
      <DiningAreasSettings permission="operate" listAreas={listAreas} createArea={createArea} />,
    );
    await screen.findByTestId("dining-areas-list");

    fireEvent.change(screen.getByLabelText("Dining area name"), {
      target: { value: "  Terrace  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /add dining area/i }));

    await waitFor(() => expect(createArea).toHaveBeenCalledTimes(1));
    expect(createArea).toHaveBeenCalledWith({
      data: { name: "Terrace", requestedLocationId: null },
    });
  });

  it("shows the already-exists message on a duplicate without clearing input", async () => {
    const listAreas = listOf(viewOf([area({ id: "a1", name: "Main" })], "operate"));
    const createArea: CreateRestaurantDiningArea = vi.fn(async () => ({
      status: "duplicate" as const,
      message: "This dining area already exists",
    }));

    render(
      <DiningAreasSettings permission="operate" listAreas={listAreas} createArea={createArea} />,
    );
    await screen.findByTestId("dining-areas-list");

    fireEvent.change(screen.getByLabelText("Dining area name"), { target: { value: "Main" } });
    fireEvent.click(screen.getByRole("button", { name: /add dining area/i }));

    expect(await screen.findByText("This dining area already exists")).toBeTruthy();
  });
});

describe("Dining area deletion (Req 5.4, 5.7)", () => {
  it("refuses deletion of an area with assigned tables and shows the count message", async () => {
    const listAreas = listOf(
      viewOf([area({ id: "a2", name: "Terrace", tableCount: 2 })], "operate"),
    );
    const deleteArea: DeleteRestaurantDiningArea = vi.fn(async () => ({
      status: "assigned_tables" as const,
      assignedTableCount: 2,
      message: "This dining area has 2 assigned tables and cannot be deleted",
    }));

    render(
      <DiningAreasSettings permission="operate" listAreas={listAreas} deleteArea={deleteArea} />,
    );
    await screen.findByTestId("dining-areas-list");

    fireEvent.click(screen.getByRole("button", { name: /delete terrace/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(
      await screen.findByText("This dining area has 2 assigned tables and cannot be deleted"),
    ).toBeTruthy();
    expect(deleteArea).toHaveBeenCalledWith({ data: { areaId: "a2", requestedLocationId: null } });
  });
});

describe("Synthetic Main handling (Req 5.9)", () => {
  it("offers no delete control for the synthetic Main area", async () => {
    const listAreas = listOf(
      viewOf([area({ id: EFFECTIVE_MAIN_AREA_ID, name: "Main", tableCount: 0 })], "operate"),
    );
    render(<DiningAreasSettings permission="operate" listAreas={listAreas} />);
    await screen.findByTestId("dining-areas-list");

    expect(screen.queryByRole("button", { name: /delete main/i })).toBeNull();
  });
});

describe("Read-only mode (Req 5.10)", () => {
  it("renders areas read-only with no create or delete controls", async () => {
    const listAreas = listOf(
      viewOf([area({ id: "a2", name: "Terrace", tableCount: 0 })], "view_only"),
    );
    render(<DiningAreasSettings permission="view_only" listAreas={listAreas} />);
    await screen.findByTestId("dining-areas-list");

    expect(screen.getByTestId("dining-areas-view-only")).toBeTruthy();
    expect(screen.queryByLabelText("Dining area name")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete terrace/i })).toBeNull();
  });
});
