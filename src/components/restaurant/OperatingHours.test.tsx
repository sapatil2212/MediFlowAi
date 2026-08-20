// @vitest-environment jsdom
/**
 * OperatingHours.test.tsx
 *
 * Focused DOM suite for the `Operating Hours` Settings sub-tab
 * (spec `.kiro/specs/restaurant-dashboard-settings`, task 7.3,
 * Req 3.1-3.8, 4.1-4.11, 4.13).
 *
 * Every server interaction is an injected callback, exactly like
 * `DiningAreasSettings.test.tsx`, so the tests never touch the database, auth,
 * or SQL. The production server-function module is mocked at the boundary so
 * importing the component does not pull `db`/`auth.server` into jsdom.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/restaurant-settings", () => ({
  getRestaurantOperatingHoursServerFn: vi.fn(),
  saveRestaurantOperatingHoursServerFn: vi.fn(),
  listRestaurantClosuresServerFn: vi.fn(),
  createRestaurantClosureServerFn: vi.fn(),
  deleteRestaurantClosureServerFn: vi.fn(),
}));

import {
  OperatingHours,
  type FetchRestaurantOperatingHours,
  type SaveRestaurantOperatingHours,
  type FetchRestaurantClosures,
  type CreateRestaurantClosure,
  type DeleteRestaurantClosure,
} from "./OperatingHours";
import type { ClosureDay, DayHours } from "../../lib/restaurant-settings-model";
import type {
  RestaurantClosuresView,
  RestaurantOperatingHoursView,
} from "../../lib/restaurant-settings";

type Permission = "operate" | "view_only" | "none";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Seven canonical weekday rows; Sunday closed, the rest open 09:00-17:00. */
function storedDays(): DayHours[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    openTime: "09:00",
    closeTime: "17:00",
    isClosed: dayOfWeek === 0,
  }));
}

function hoursView(days: DayHours[], permission: Permission): RestaurantOperatingHoursView {
  const canSave = permission === "operate";
  return { days, canSave, readOnly: !canSave };
}

const fetchHoursOf = (view: RestaurantOperatingHoursView): FetchRestaurantOperatingHours =>
  vi.fn(async () => view);

// The closure calendar defaults to the current month; build a marked date in it.
const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1;
const pad2 = (n: number) => String(n).padStart(2, "0");
const IN_MONTH_DATE = `${YEAR}-${pad2(MONTH)}-15`;

function closuresView(closures: ClosureDay[], permission: Permission): RestaurantClosuresView {
  return {
    closures,
    monthStart: `${YEAR}-${pad2(MONTH)}-01`,
    nextMonthStart: `${YEAR}-${pad2(MONTH === 12 ? 1 : MONTH + 1)}-01`,
    canManage: permission === "operate",
  };
}

const emptyClosures = (permission: Permission): FetchRestaurantClosures =>
  vi.fn(async () => closuresView([], permission));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Weekly hours rendering (Req 3.1, 3.2) ─────────────────────────────────────

describe("Weekly hours rendering (Req 3.1, 3.2)", () => {
  it("renders exactly seven weekday rows with stored times and closed flags", async () => {
    render(
      <OperatingHours
        permission="operate"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "operate"))}
        fetchClosures={emptyClosures("operate")}
      />,
    );

    await screen.findByTestId("operating-hours-list");
    for (let day = 0; day < 7; day += 1) {
      expect(screen.getByTestId(`hours-row-${day}`)).toBeTruthy();
    }
    expect((screen.getByLabelText("Monday open time") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText("Monday close time") as HTMLInputElement).value).toBe("17:00");
    expect((screen.getByLabelText("Sunday closed") as HTMLInputElement).checked).toBe(true);
  });
});

// ── Presets change the draft only (Req 3.3, 3.4) ──────────────────────────────

describe("Hour presets (Req 3.3, 3.4)", () => {
  it("applies a named preset to all seven draft rows without saving", async () => {
    const saveHours: SaveRestaurantOperatingHours = vi.fn();
    render(
      <OperatingHours
        permission="operate"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "operate"))}
        saveHours={saveHours}
        fetchClosures={emptyClosures("operate")}
      />,
    );
    await screen.findByTestId("operating-hours-list");

    fireEvent.click(screen.getByRole("button", { name: /Dinner Service/i }));

    // Draft rows updated to the preset; stored data is untouched (no save call).
    expect((screen.getByLabelText("Monday open time") as HTMLInputElement).value).toBe("17:00");
    expect((screen.getByLabelText("Sunday open time") as HTMLInputElement).value).toBe("17:00");
    expect(saveHours).not.toHaveBeenCalled();
  });
});

// ── Apply-to-all changes open days only (Req 3.5) ─────────────────────────────

describe("Apply-to-all open days (Req 3.5)", () => {
  it("rewrites open weekdays' times and leaves closed flags unchanged", async () => {
    render(
      <OperatingHours
        permission="operate"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "operate"))}
        fetchClosures={emptyClosures("operate")}
      />,
    );
    await screen.findByTestId("operating-hours-list");

    fireEvent.change(screen.getByLabelText("Apply open time to all open days"), {
      target: { value: "10:00" },
    });
    fireEvent.change(screen.getByLabelText("Apply close time to all open days"), {
      target: { value: "20:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply to all open days/i }));

    // Open weekday updated.
    expect((screen.getByLabelText("Monday open time") as HTMLInputElement).value).toBe("10:00");
    expect((screen.getByLabelText("Monday close time") as HTMLInputElement).value).toBe("20:00");
    // Sunday stays closed and its time is not rewritten.
    expect((screen.getByLabelText("Sunday closed") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Sunday open time") as HTMLInputElement).value).toBe("09:00");
  });
});

// ── Atomic save (Req 3.6, 3.7) ────────────────────────────────────────────────

describe("Atomic operating-hours save (Req 3.6, 3.7)", () => {
  it("submits all seven weekdays and shows a confirmation on success", async () => {
    const saved = storedDays();
    const saveHours: SaveRestaurantOperatingHours = vi.fn(async () => ({
      status: "saved" as const,
      days: saved,
    }));
    render(
      <OperatingHours
        permission="operate"
        requestedLocationId="branch-1"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "operate"))}
        saveHours={saveHours}
        fetchClosures={emptyClosures("operate")}
      />,
    );
    await screen.findByTestId("operating-hours-list");

    fireEvent.click(screen.getByRole("button", { name: /save operating hours/i }));

    await waitFor(() => expect(saveHours).toHaveBeenCalledTimes(1));
    const call = (saveHours as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.days).toHaveLength(7);
    expect(call.data.requestedLocationId).toBe("branch-1");
    expect(await screen.findByText("Operating hours saved")).toBeTruthy();
  });

  it("names the invalid weekday and never sends a malformed submission", async () => {
    const saveHours: SaveRestaurantOperatingHours = vi.fn();
    render(
      <OperatingHours
        permission="operate"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "operate"))}
        saveHours={saveHours}
        fetchClosures={emptyClosures("operate")}
      />,
    );
    await screen.findByTestId("operating-hours-list");

    // Monday close before open — an invalid open weekday.
    fireEvent.change(screen.getByLabelText("Monday close time"), { target: { value: "08:00" } });
    fireEvent.click(screen.getByRole("button", { name: /save operating hours/i }));

    expect(await screen.findByText(/Monday:/i)).toBeTruthy();
    expect(saveHours).not.toHaveBeenCalled();
  });
});

// ── View-only hours (Req 3.8) ─────────────────────────────────────────────────

describe("View-only operating hours (Req 3.8)", () => {
  it("renders no preset, apply-to-all, or save controls", async () => {
    render(
      <OperatingHours
        permission="view_only"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "view_only"))}
        fetchClosures={emptyClosures("view_only")}
      />,
    );
    await screen.findByTestId("operating-hours-list");

    expect(screen.getByTestId("operating-hours-view-only")).toBeTruthy();
    expect(screen.queryByTestId("hours-shortcuts")).toBeNull();
    expect(screen.queryByRole("button", { name: /save operating hours/i })).toBeNull();
    expect((screen.getByLabelText("Monday open time") as HTMLInputElement).disabled).toBe(true);
  });
});

// ── Closure calendar (Req 4.1-4.9) ────────────────────────────────────────────

describe("Restaurant closure calendar (Req 4.1, 4.2, 4.9)", () => {
  it("marks a stored restaurant closure and warns about affected bookings", async () => {
    const closure: ClosureDay = {
      id: "c1",
      date: IN_MONTH_DATE,
      scope: { type: "restaurant" },
      reason: "Staff day",
      isHoliday: true,
      affectedBookingCount: 2,
      locationId: null,
    };
    render(
      <OperatingHours
        permission="operate"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "operate"))}
        fetchClosures={vi.fn(async () => closuresView([closure], "operate"))}
      />,
    );

    const cell = await screen.findByTestId(`closure-day-${IN_MONTH_DATE}`);
    expect(cell.getAttribute("data-closed")).toBe("true");

    fireEvent.click(cell);
    const warning = await screen.findByTestId("closure-affected-warning");
    expect(warning.textContent).toContain("2");
  });

  it("navigates to the next month", async () => {
    const fetchClosures = emptyClosures("operate");
    render(
      <OperatingHours
        permission="operate"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "operate"))}
        fetchClosures={fetchClosures}
      />,
    );
    await screen.findByTestId("restaurant-closure-calendar");
    const initialLabel = screen.getByTestId("closure-month-label").textContent;

    fireEvent.click(screen.getByRole("button", { name: /next month/i }));

    await waitFor(() =>
      expect(screen.getByTestId("closure-month-label").textContent).not.toBe(initialLabel),
    );
  });
});

describe("Closure create and delete (Req 4.3, 4.4)", () => {
  it("creates a restaurant closure with reason and holiday flag", async () => {
    const createClosure: CreateRestaurantClosure = vi.fn(async () => ({
      status: "created" as const,
      closure: {
        id: "c9",
        date: IN_MONTH_DATE,
        scope: { type: "restaurant" as const },
        reason: "Holiday",
        isHoliday: true,
        affectedBookingCount: 0,
        locationId: null,
      },
    }));
    render(
      <OperatingHours
        permission="operate"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "operate"))}
        fetchClosures={emptyClosures("operate")}
        createClosure={createClosure}
      />,
    );

    fireEvent.click(await screen.findByTestId(`closure-day-${IN_MONTH_DATE}`));
    fireEvent.change(screen.getByLabelText("Closure reason"), { target: { value: "Holiday" } });
    fireEvent.click(screen.getByLabelText("Mark as public holiday"));
    fireEvent.click(screen.getByRole("button", { name: /block this date/i }));

    await waitFor(() => expect(createClosure).toHaveBeenCalledTimes(1));
    expect(createClosure).toHaveBeenCalledWith({
      data: {
        date: IN_MONTH_DATE,
        scope: { type: "restaurant" },
        reason: "Holiday",
        isHoliday: true,
        requestedLocationId: null,
      },
    });
  });

  it("deletes exactly the addressed stored closure", async () => {
    const closure: ClosureDay = {
      id: "c1",
      date: IN_MONTH_DATE,
      scope: { type: "restaurant" },
      reason: "",
      isHoliday: false,
      affectedBookingCount: 0,
      locationId: null,
    };
    const deleteClosure: DeleteRestaurantClosure = vi.fn(async () => ({
      status: "deleted" as const,
    }));
    render(
      <OperatingHours
        permission="operate"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "operate"))}
        fetchClosures={vi.fn(async () => closuresView([closure], "operate"))}
        deleteClosure={deleteClosure}
      />,
    );

    fireEvent.click(await screen.findByTestId(`closure-day-${IN_MONTH_DATE}`));
    fireEvent.click(screen.getByRole("button", { name: /delete closure on/i }));

    await waitFor(() => expect(deleteClosure).toHaveBeenCalledTimes(1));
    expect(deleteClosure).toHaveBeenCalledWith({
      data: { closureId: "c1", requestedLocationId: null },
    });
  });
});

describe("View-only closures (Req 4.13)", () => {
  it("shows stored closures with no create or delete control", async () => {
    const closure: ClosureDay = {
      id: "c1",
      date: IN_MONTH_DATE,
      scope: { type: "restaurant" },
      reason: "Closed",
      isHoliday: false,
      affectedBookingCount: 0,
      locationId: null,
    };
    render(
      <OperatingHours
        permission="view_only"
        fetchHours={fetchHoursOf(hoursView(storedDays(), "view_only"))}
        fetchClosures={vi.fn(async () => closuresView([closure], "view_only"))}
      />,
    );

    fireEvent.click(await screen.findByTestId(`closure-day-${IN_MONTH_DATE}`));

    expect(screen.queryByRole("button", { name: /delete closure on/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /block this date/i })).toBeNull();
    expect(screen.queryByLabelText("Closure reason")).toBeNull();
  });
});
