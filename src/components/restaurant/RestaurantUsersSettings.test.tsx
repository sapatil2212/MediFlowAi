// @vitest-environment jsdom
/**
 * RestaurantUsersSettings.test.tsx
 *
 * Focused DOM suite for the `Manage Users` Settings sub-tab
 * (spec `.kiro/specs/restaurant-dashboard-settings`, task 10.7, Req 8.1-8.15).
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
  getRestaurantUsersServerFn: vi.fn(),
  createRestaurantUserServerFn: vi.fn(),
  updateRestaurantUserServerFn: vi.fn(),
  setRestaurantUserActiveServerFn: vi.fn(),
  deleteRestaurantUserServerFn: vi.fn(),
}));

import {
  RestaurantUsersSettings,
  type FetchRestaurantUsers,
  type UpdateRestaurantUser,
  type SetRestaurantUserActive,
  type DeleteRestaurantUser,
  type RestaurantUsersSettingsProps,
} from "./RestaurantUsersSettings";
import {
  MSG_PASSWORD_MIN_LENGTH,
  MSG_PASSWORDS_DO_NOT_MATCH,
  MSG_SUB_USER_ROLE,
  MSG_SUB_USER_EMAIL_IN_USE,
  MSG_SUB_USER_CREATE_FAILED,
  type SubUser,
  type SubUserPlanLimits,
  type SubUserRoleChangeDecision,
} from "../../lib/restaurant-settings-model";
import type { RestaurantUsersListView } from "../../lib/restaurant-settings";
import type { RestaurantPermission } from "../../lib/restaurant-availability";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAN_MESSAGE = "Your Premium plan allows 2 doctors and 2 reception logins.";

function buildPlanLimits(overrides: Partial<SubUserPlanLimits> = {}): SubUserPlanLimits {
  return {
    plan: "Premium",
    doctor: { role: "doctor", maximum: 2, current: 1, remaining: 1, canCreate: true },
    reception: { role: "reception", maximum: 2, current: 1, remaining: 1, canCreate: true },
    message: PLAN_MESSAGE,
    ...overrides,
  };
}

/** A role-change decision object; the panel only reads its `message`. */
function buildRoleDecision(message: string): SubUserRoleChangeDecision {
  const counts = { doctor: 2, reception: 1 };
  return {
    allowed: false,
    plan: "Premium",
    requestedRole: "doctor",
    countsBefore: counts,
    countsAfterRemoval: counts,
    projectedCounts: { doctor: 3, reception: 1 },
    countsAfterDecision: counts,
    limitsAfterRemoval: buildPlanLimits(),
    message,
  };
}

const USER_A: SubUser = {
  id: "u1",
  name: "Alex Doe",
  email: "alex@example.com",
  phone: "555-0001",
  role: "reception",
  isActive: true,
};

const USER_B: SubUser = {
  id: "u2",
  name: "Bo Lee",
  email: "bo@example.com",
  phone: "",
  role: "doctor",
  isActive: true,
};

function buildView(users: SubUser[]): RestaurantUsersListView {
  return { users, planLimits: buildPlanLimits() };
}

/** A resolved-immediately users read. */
const fetchUsersOf = (view: RestaurantUsersListView): FetchRestaurantUsers =>
  vi.fn(async () => view);

/** Mounts the panel and waits for the initial read (plan message always shown). */
async function mountUsers(
  props: Partial<RestaurantUsersSettingsProps> & { permission?: RestaurantPermission } = {},
) {
  const { permission = "operate", ...rest } = props;
  const fetchUsers = rest.fetchUsers ?? fetchUsersOf(buildView([USER_A, USER_B]));
  const utils = render(
    <RestaurantUsersSettings permission={permission} {...rest} fetchUsers={fetchUsers} />,
  );
  await screen.findByTestId("users-plan-message");
  return utils;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Plan-limit message (Req 8.3)
// ---------------------------------------------------------------------------

describe("Plan-limit message (Req 8.3)", () => {
  it("displays the subscription plan-limit message", async () => {
    await mountUsers();
    expect(screen.getByTestId("users-plan-message").textContent).toContain(PLAN_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// Create validation (Req 8.4, 8.10, 8.11)
// ---------------------------------------------------------------------------

describe("Create validation (Req 8.4, 8.10, 8.11)", () => {
  it("surfaces every field error the server returns for a create", async () => {
    const createUser = vi.fn(async () => ({
      status: "validation_failed" as const,
      errors: [
        { field: "name", message: "Name is required" },
        { field: "email", message: "Email is invalid" },
        { field: "role", message: MSG_SUB_USER_ROLE },
        { field: "password", message: MSG_PASSWORD_MIN_LENGTH },
        { field: "confirmation", message: MSG_PASSWORDS_DO_NOT_MATCH },
      ],
    }));
    await mountUsers({ createUser });

    fireEvent.click(screen.getByRole("button", { name: "Add a team member" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add team member" }));
      await Promise.resolve();
    });

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Name is required")).toBeTruthy();
    expect(screen.getByText("Email is invalid")).toBeTruthy();
    expect(screen.getByText(MSG_SUB_USER_ROLE)).toBeTruthy();
    expect(screen.getByText(MSG_PASSWORD_MIN_LENGTH)).toBeTruthy();
    expect(screen.getByText(MSG_PASSWORDS_DO_NOT_MATCH)).toBeTruthy();
  });

  it("shows the stable in-use email message and creates nothing", async () => {
    const createUser = vi.fn(async () => ({
      status: "email_taken" as const,
      message: MSG_SUB_USER_EMAIL_IN_USE,
    }));
    const fetchUsers = fetchUsersOf(buildView([USER_A]));
    await mountUsers({ createUser, fetchUsers });

    fireEvent.click(screen.getByRole("button", { name: "Add a team member" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add team member" }));
      await Promise.resolve();
    });

    expect(await screen.findByText(MSG_SUB_USER_EMAIL_IN_USE)).toBeTruthy();
    // No reload happened, so the fetch ran only for the initial mount.
    expect(fetchUsers).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Team member added")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Optional password on edit (Req 8.5, 8.6, 8.7)
// ---------------------------------------------------------------------------

describe("Optional password on edit (Req 8.7)", () => {
  it("forwards an undefined password when the edit leaves the field blank", async () => {
    const updateUser = vi.fn<UpdateRestaurantUser>(async () => ({ status: "updated" as const }));
    await mountUsers({ updateUser });

    fireEvent.click(screen.getByRole("button", { name: "Edit Alex Doe" }));
    fireEvent.change(screen.getByLabelText("Team member name"), {
      target: { value: "Alex Renamed" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save team member" }));
      await Promise.resolve();
    });

    expect(updateUser).toHaveBeenCalledTimes(1);
    const payload = updateUser.mock.calls[0][0].data;
    expect(payload.id).toBe(USER_A.id);
    expect(payload.name).toBe("Alex Renamed");
    // A blank password retains the stored hash server-side (Req 8.7).
    expect(payload.password).toBeUndefined();
    expect(payload.confirmation).toBeUndefined();
  });

  it("forwards the new password when the edit sets one", async () => {
    const updateUser = vi.fn<UpdateRestaurantUser>(async () => ({ status: "updated" as const }));
    await mountUsers({ updateUser });

    fireEvent.click(screen.getByRole("button", { name: "Edit Alex Doe" }));
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "brand-new-secret" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "brand-new-secret" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save team member" }));
      await Promise.resolve();
    });

    const payload = updateUser.mock.calls[0][0].data;
    expect(payload.password).toBe("brand-new-secret");
    expect(payload.confirmation).toBe("brand-new-secret");
  });
});

// ---------------------------------------------------------------------------
// Deactivate confirmation + session denial (Req 8.8)
// ---------------------------------------------------------------------------

describe("Deactivate (Req 8.8)", () => {
  it("requires an explicit confirmation, then forwards the inactive state", async () => {
    const setUserActive = vi.fn<SetRestaurantUserActive>(async () => ({
      status: "updated" as const,
    }));
    let reloaded = false;
    const fetchUsers = vi.fn(async () => {
      const view = reloaded
        ? buildView([{ ...USER_A, isActive: false }, USER_B])
        : buildView([USER_A, USER_B]);
      reloaded = true;
      return view;
    }) as unknown as FetchRestaurantUsers;
    await mountUsers({ setUserActive, fetchUsers });

    // The inactive state is not forwarded until the confirmation is clicked.
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Alex Doe" }));
    expect(setUserActive).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
      await Promise.resolve();
    });

    expect(setUserActive).toHaveBeenCalledTimes(1);
    // The server stores the inactive state and revokes sessions so Feature
    // Access denies the account immediately (Req 8.8).
    expect(setUserActive.mock.calls[0][0].data).toMatchObject({
      id: USER_A.id,
      isActive: false,
    });
    expect(await screen.findByText("Team member deactivated")).toBeTruthy();
  });

  it("shows the stable message and no success when the server refuses", async () => {
    const setUserActive = vi.fn(async () => ({
      status: "not_found" as const,
      message: "Team member not found",
    }));
    await mountUsers({ setUserActive });

    fireEvent.click(screen.getByRole("button", { name: "Deactivate Alex Doe" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
      await Promise.resolve();
    });

    expect(await screen.findByText("Team member not found")).toBeTruthy();
    expect(screen.queryByText("Team member deactivated")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Delete (Req 8.9)
// ---------------------------------------------------------------------------

describe("Delete (Req 8.9)", () => {
  it("deletes only the targeted user and leaves the others unchanged", async () => {
    const deleteUser = vi.fn<DeleteRestaurantUser>(async () => ({ status: "deleted" as const }));
    let reloaded = false;
    const fetchUsers = vi.fn(async () => {
      const view = reloaded ? buildView([USER_B]) : buildView([USER_A, USER_B]);
      reloaded = true;
      return view;
    }) as unknown as FetchRestaurantUsers;
    await mountUsers({ deleteUser, fetchUsers });

    expect(screen.getByTestId(`user-row-${USER_A.id}`)).toBeTruthy();
    expect(screen.getByTestId(`user-row-${USER_B.id}`)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Alex Doe" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
      await Promise.resolve();
    });

    // Exactly the targeted user was passed to the delete call.
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser.mock.calls[0][0].data.id).toBe(USER_A.id);

    // After the reload only the other user remains.
    expect(await screen.findByText("Team member deleted")).toBeTruthy();
    expect(screen.queryByTestId(`user-row-${USER_A.id}`)).toBeNull();
    expect(screen.getByTestId(`user-row-${USER_B.id}`)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Storage failure (Req 8.14)
// ---------------------------------------------------------------------------

describe("Storage failure (Req 8.14)", () => {
  it("shows the stable failure message and no success when a create cannot be stored", async () => {
    const createUser = vi.fn(async () => ({
      status: "storage_failed" as const,
      message: MSG_SUB_USER_CREATE_FAILED,
    }));
    const fetchUsers = fetchUsersOf(buildView([USER_A]));
    await mountUsers({ createUser, fetchUsers });

    fireEvent.click(screen.getByRole("button", { name: "Add a team member" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add team member" }));
      await Promise.resolve();
    });

    expect(await screen.findByText(MSG_SUB_USER_CREATE_FAILED)).toBeTruthy();
    expect(screen.queryByText("Team member added")).toBeNull();
    // No reload — the stored list is untouched.
    expect(fetchUsers).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Role-limit refusal + upgrade navigation (Req 8.13)
// ---------------------------------------------------------------------------

describe("Role-limit refusal (Req 8.13)", () => {
  it("shows the refusal message with an upgrade control that invokes onUpgrade", async () => {
    const REFUSAL = "Your plan does not allow another doctor login.";
    const createUser = vi.fn(async () => ({
      status: "role_limit_exceeded" as const,
      message: REFUSAL,
      decision: buildRoleDecision(REFUSAL),
    }));
    const onUpgrade = vi.fn();
    await mountUsers({ createUser, onUpgrade });

    fireEvent.click(screen.getByRole("button", { name: "Add a team member" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add team member" }));
      await Promise.resolve();
    });

    const banner = await screen.findByTestId("users-upgrade");
    expect(banner.textContent).toContain(REFUSAL);

    fireEvent.click(screen.getByTestId("users-upgrade-button"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    // Nothing was created — no success message.
    expect(screen.queryByText("Team member added")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// view_only (Req 8.15)
// ---------------------------------------------------------------------------

describe("view_only (Req 8.15)", () => {
  it("renders the users read-only with no mutation controls", async () => {
    await mountUsers({ permission: "view_only" });

    // The directory and the view-only notice are shown.
    expect(screen.getByTestId("users-view-only")).toBeTruthy();
    expect(screen.getByTestId(`user-row-${USER_A.id}`)).toBeTruthy();

    // No create/edit/delete/activation controls at all.
    expect(screen.queryByRole("button", { name: "Add a team member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Alex Doe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deactivate Alex Doe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Alex Doe" })).toBeNull();
  });
});
