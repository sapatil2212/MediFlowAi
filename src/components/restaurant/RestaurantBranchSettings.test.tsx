// @vitest-environment jsdom
/**
 * RestaurantBranchSettings.test.tsx
 *
 * Focused DOM suite for the `Multi Location` (Branches) Settings sub-tab
 * (spec `.kiro/specs/restaurant-dashboard-settings`, task 10.7, Req 9.1-9.8).
 *
 * Every server interaction is an injected callback, exactly like
 * `RestaurantProfilePanel.test.tsx`, so the tests never touch the database,
 * auth, or crypto. The production server-function module is mocked at the
 * module boundary only so importing the component does not pull `db`/
 * `auth.server` into jsdom.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Keep the real server-function module (and its db/auth imports) out of jsdom;
// the component only uses these as defaults, and every test injects its own.
vi.mock("../../lib/restaurant-settings", () => ({
  getRestaurantBranchesServerFn: vi.fn(),
  createRestaurantBranchServerFn: vi.fn(),
  updateRestaurantBranchServerFn: vi.fn(),
  setRestaurantBranchActiveServerFn: vi.fn(),
  deleteRestaurantBranchServerFn: vi.fn(),
}));

import {
  RestaurantBranchSettings,
  type FetchRestaurantBranches,
  type CreateRestaurantBranch,
  type DeleteRestaurantBranch,
  type SetRestaurantBranchActive,
  type RestaurantBranchSettingsProps,
} from "./RestaurantBranchSettings";
import type {
  RestaurantBranch,
  RestaurantBranchesListView,
  RestaurantLocationPlanLimit,
} from "../../lib/restaurant-settings";
import type { RestaurantPermission } from "../../lib/restaurant-availability";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAN_MESSAGE = "Your Premium plan allows 1 branch.";
const SCOPE = "loc-1";

function buildPlanLimit(overrides: Partial<RestaurantLocationPlanLimit> = {}): RestaurantLocationPlanLimit {
  return {
    maximum: 1,
    current: 1,
    remaining: 0,
    canCreate: true,
    message: PLAN_MESSAGE,
    ...overrides,
  };
}

const BRANCH_A: RestaurantBranch = {
  id: "b1",
  name: "Downtown branch",
  email: "downtown@example.com",
  phone: "555-1000",
  address: "123 Market Street",
  city: "Metropolis",
  state: "CA",
  pincode: "900001",
  managerName: "Alex Doe",
  profilePhoto: null,
  isActive: true,
};

const BRANCH_B: RestaurantBranch = {
  id: "b2",
  name: "Uptown branch",
  email: "uptown@example.com",
  phone: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  managerName: "",
  profilePhoto: null,
  isActive: false,
};

function buildView(branches: RestaurantBranch[]): RestaurantBranchesListView {
  return { branches, planLimit: buildPlanLimit() };
}

const fetchBranchesOf = (view: RestaurantBranchesListView): FetchRestaurantBranches =>
  vi.fn(async () => view);

async function mountBranches(
  props: Partial<RestaurantBranchSettingsProps> & { permission?: RestaurantPermission } = {},
) {
  const { permission = "operate", ...rest } = props;
  const fetchBranches = rest.fetchBranches ?? fetchBranchesOf(buildView([BRANCH_A, BRANCH_B]));
  const utils = render(
    <RestaurantBranchSettings permission={permission} {...rest} fetchBranches={fetchBranches} />,
  );
  await screen.findByTestId("branches-plan-message");
  return utils;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Branch terminology (Req 9.1) + directory (Req 9.2)
// ---------------------------------------------------------------------------

describe("Branch terminology and directory (Req 9.1, 9.2)", () => {
  it("uses Branch terminology throughout the panel", async () => {
    await mountBranches();
    // Heading and create control both use the Branch term.
    expect(screen.getByRole("heading", { name: "Branches" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a branch" })).toBeTruthy();

    // The create form title uses the Branch term.
    fireEvent.click(screen.getByRole("button", { name: "Add a branch" }));
    expect(screen.getByText("Add a branch", { selector: "h4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create branch" })).toBeTruthy();
  });

  it("lists each branch with its complete fields and active state", async () => {
    await mountBranches();

    const row = screen.getByTestId(`branch-row-${BRANCH_A.id}`);
    expect(row.textContent).toContain(BRANCH_A.name);
    expect(row.textContent).toContain(BRANCH_A.email);
    expect(row.textContent).toContain(BRANCH_A.phone);
    expect(row.textContent).toContain(BRANCH_A.managerName);
    // The address fragments are joined into one line.
    expect(row.textContent).toContain("123 Market Street, Metropolis, CA, 900001");

    expect(screen.getByTestId(`branch-state-${BRANCH_A.id}`).textContent).toContain("Active");
    expect(screen.getByTestId(`branch-state-${BRANCH_B.id}`).textContent).toContain("Inactive");
  });
});

// ---------------------------------------------------------------------------
// Plan-limit message
// ---------------------------------------------------------------------------

describe("Plan-limit message", () => {
  it("displays the centralized location plan-limit message", async () => {
    await mountBranches();
    expect(screen.getByTestId("branches-plan-message").textContent).toContain(PLAN_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// Create / edit validation (Req 9.2)
// ---------------------------------------------------------------------------

describe("Create validation", () => {
  it("surfaces every field error the server returns for a create", async () => {
    const createBranch = vi.fn(async () => ({
      status: "validation_failed" as const,
      errors: [
        { field: "name", message: "Branch name is required" },
        { field: "email", message: "Login email is invalid" },
        { field: "password", message: "Password is too short" },
        { field: "confirmation", message: "Passwords do not match" },
      ],
    }));
    await mountBranches({ createBranch });

    fireEvent.click(screen.getByRole("button", { name: "Add a branch" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
      await Promise.resolve();
    });

    expect(createBranch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Branch name is required")).toBeTruthy();
    expect(screen.getByText("Login email is invalid")).toBeTruthy();
    expect(screen.getByText("Password is too short")).toBeTruthy();
    expect(screen.getByText("Passwords do not match")).toBeTruthy();
  });

  it("shows the stable in-use email message and creates nothing", async () => {
    const createBranch = vi.fn(async () => ({
      status: "email_taken" as const,
      message: "This email address is already in use",
    }));
    const fetchBranches = fetchBranchesOf(buildView([BRANCH_A]));
    await mountBranches({ createBranch, fetchBranches });

    fireEvent.click(screen.getByRole("button", { name: "Add a branch" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("This email address is already in use")).toBeTruthy();
    expect(screen.queryByText("Branch added")).toBeNull();
    expect(fetchBranches).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Plan-limit refusal + upgrade navigation (Req 9.8, 10.7, 10.8)
// ---------------------------------------------------------------------------

describe("Plan-limit refusal", () => {
  it("shows the refusal message with an upgrade control that invokes onUpgrade", async () => {
    const REFUSAL = "Your plan does not allow another branch.";
    const createBranch = vi.fn(async () => ({
      status: "plan_limit_exceeded" as const,
      message: REFUSAL,
      planLimit: buildPlanLimit({ current: 1, remaining: 0, canCreate: false }),
    }));
    const onUpgrade = vi.fn();
    await mountBranches({ createBranch, onUpgrade });

    fireEvent.click(screen.getByRole("button", { name: "Add a branch" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
      await Promise.resolve();
    });

    const banner = await screen.findByTestId("branches-upgrade");
    expect(banner.textContent).toContain(REFUSAL);

    fireEvent.click(screen.getByTestId("branches-upgrade-button"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Branch added")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Delete (exact deletion)
// ---------------------------------------------------------------------------

describe("Delete", () => {
  it("deletes only the targeted branch and leaves the others unchanged", async () => {
    const deleteBranch = vi.fn<DeleteRestaurantBranch>(async () => ({ status: "deleted" as const }));
    let reloaded = false;
    const fetchBranches = vi.fn(async () => {
      const view = reloaded ? buildView([BRANCH_B]) : buildView([BRANCH_A, BRANCH_B]);
      reloaded = true;
      return view;
    }) as unknown as FetchRestaurantBranches;
    await mountBranches({ deleteBranch, fetchBranches });

    fireEvent.click(screen.getByRole("button", { name: "Delete Downtown branch" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
      await Promise.resolve();
    });

    expect(deleteBranch).toHaveBeenCalledTimes(1);
    expect(deleteBranch.mock.calls[0][0].data.id).toBe(BRANCH_A.id);

    expect(await screen.findByText("Branch deleted")).toBeTruthy();
    expect(screen.queryByTestId(`branch-row-${BRANCH_A.id}`)).toBeNull();
    expect(screen.getByTestId(`branch-row-${BRANCH_B.id}`)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Scope forwarding (requestedLocationId on every call)
// ---------------------------------------------------------------------------

describe("Scope forwarding", () => {
  it("forwards requestedLocationId on load, create, delete, and activation calls", async () => {
    const fetchBranches = fetchBranchesOf(buildView([BRANCH_B]));
    const createBranch = vi.fn<CreateRestaurantBranch>(async () => ({
      status: "created" as const,
      id: "new",
    }));
    const deleteBranch = vi.fn<DeleteRestaurantBranch>(async () => ({ status: "deleted" as const }));
    const setBranchActive = vi.fn<SetRestaurantBranchActive>(async () => ({
      status: "updated" as const,
    }));

    await mountBranches({
      requestedLocationId: SCOPE,
      fetchBranches,
      createBranch,
      deleteBranch,
      setBranchActive,
    });

    // Load forwards the scope.
    expect(vi.mocked(fetchBranches).mock.calls[0][0]?.data?.requestedLocationId).toBe(SCOPE);

    // Create forwards the scope.
    fireEvent.click(screen.getByRole("button", { name: "Add a branch" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
      await Promise.resolve();
    });
    expect(createBranch.mock.calls[0][0].data.requestedLocationId).toBe(SCOPE);

    // Reactivation forwards the scope (BRANCH_B is inactive).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reactivate Uptown branch" }));
      await Promise.resolve();
    });
    expect(setBranchActive.mock.calls[0][0].data.requestedLocationId).toBe(SCOPE);

    // Delete forwards the scope.
    fireEvent.click(screen.getByRole("button", { name: "Delete Uptown branch" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
      await Promise.resolve();
    });
    expect(deleteBranch.mock.calls[0][0].data.requestedLocationId).toBe(SCOPE);
  });
});

// ---------------------------------------------------------------------------
// view_only (Req 9.8)
// ---------------------------------------------------------------------------

describe("view_only (Req 9.8)", () => {
  it("renders the branches read-only with no mutation controls", async () => {
    await mountBranches({ permission: "view_only" });

    expect(screen.getByTestId("branches-view-only")).toBeTruthy();
    expect(screen.getByTestId(`branch-row-${BRANCH_A.id}`)).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Add a branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Downtown branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deactivate Downtown branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Downtown branch" })).toBeNull();
  });
});
