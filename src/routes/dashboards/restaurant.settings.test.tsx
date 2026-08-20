// @vitest-environment jsdom
/**
 * restaurant.settings.test.tsx
 *
 * Focused DOM suite for the Restaurant Settings shell exported from
 * `src/routes/dashboards/restaurant.tsx` (spec
 * `.kiro/specs/restaurant-dashboard-settings`, task 6.1).
 *
 * These tests exercise only the shell contract — heading/description, the nine
 * canonical sub-tabs and their order, the responsive selectors, the
 * default/fallback selection, the unresolved-access Profile-only state, the
 * defensive empty state, the owner-only branch selector, and single-panel
 * mounting. The guarded bootstrap read is injected, and every heavy child
 * (panels, server modules) is mocked at the module boundary so the shell renders
 * without touching the database, auth, or the real editors.
 *
 * The canonical order and the unresolved/empty messages are asserted against the
 * exported constants the product uses, never retyped literals, so a copy or
 * order edit cannot silently pass.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module-boundary mocks. Importing the route module pulls in every settings
// panel and server module; stubbing them keeps db/auth/microservice code out of
// the jsdom run and lets each test assert exactly which panel is mounted.
// ---------------------------------------------------------------------------

vi.mock("../../lib/restaurant-settings", () => ({
  getRestaurantSettingsBootstrapServerFn: vi.fn(async () => {
    throw new Error("getRestaurantSettingsBootstrapServerFn must be injected in tests");
  }),
}));

vi.mock("../../lib/auth", () => ({
  createSubUserServerFn: vi.fn(async () => ({})),
  deleteSubUserServerFn: vi.fn(async () => ({})),
  getClinicProfileServerFn: vi.fn(async () => ({})),
  getCurrentUserServerFn: vi.fn(async () => null),
  getSubUsersServerFn: vi.fn(async () => []),
  getWhatsAppConfigServerFn: vi.fn(async () => ({ phoneNumber: "", isEnabled: false })),
  logoutServerFn: vi.fn(async () => ({})),
  saveWhatsAppConfigServerFn: vi.fn(async () => ({})),
  sendEmailChangeOtpServerFn: vi.fn(async () => ({})),
  updateEmailServerFn: vi.fn(async () => ({})),
  updatePasswordServerFn: vi.fn(async () => ({})),
  updateProfileServerFn: vi.fn(async () => ({})),
  uploadProfilePhotoServerFn: vi.fn(async () => ({})),
}));

vi.mock("../../lib/restaurant", () => ({
  getRestaurantBookingsServerFn: vi.fn(async () => ({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
    totalPages: 0,
  })),
  getRestaurantGuestsServerFn: vi.fn(async () => ({ rows: [] })),
  getRestaurantOverviewServerFn: vi.fn(async () => ({})),
  getRestaurantTablesServerFn: vi.fn(async () => ({ tables: [] })),
  reassignRestaurantBookingServerFn: vi.fn(async () => ({})),
  setRestaurantBookingStatusServerFn: vi.fn(async () => ({})),
}));

vi.mock("../../components/restaurant/RestaurantProfilePanel", () => ({
  RestaurantProfilePanel: (props: { requestedLocationId?: string | null }) => (
    <div data-testid="panel-profile" data-location={props.requestedLocationId ?? ""} />
  ),
}));
vi.mock("../../components/restaurant/OperatingHours", () => ({
  OperatingHours: () => <div data-testid="panel-hours" />,
}));
vi.mock("../../components/restaurant/TableManager", () => ({
  TableManager: (props: { locationId?: string | null }) => (
    <div data-testid="panel-tables" data-location={props.locationId ?? ""} />
  ),
}));
vi.mock("../../components/restaurant/BookingRules", () => ({
  BookingRules: () => <div data-testid="panel-booking-rules" />,
}));
vi.mock("../../components/restaurant/WalkInDrawer", () => ({
  WalkInDrawer: () => null,
}));
vi.mock("../../components/settings/ManagePlansPanel", () => ({
  default: () => <div data-testid="panel-plans" />,
}));
vi.mock("../../components/settings/MultiLocationSettings", () => ({
  default: () => <div data-testid="panel-multi-location" />,
}));
vi.mock("../../components/WhatsAppHub", () => ({
  default: () => <div data-testid="panel-whatsapp-hub" />,
}));

import { SettingsPanel, type FetchRestaurantSettingsBootstrap } from "./restaurant";
import type {
  RestaurantSettingsBootstrap,
  RestaurantSettingsBranchChoice,
} from "../../lib/restaurant-settings";
import {
  deriveRestaurantSettingsNavigation,
  MSG_FEATURE_ACCESS_UNRESOLVED,
  MSG_NO_RESTAURANT_SETTINGS,
  RESTAURANT_SETTINGS_TAB_ORDER,
  type Permission,
  type RestaurantSettingsNavigation,
  type RestaurantSettingsPermissions,
} from "../../lib/restaurant-settings-model";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CANONICAL_ORDER = [...RESTAURANT_SETTINGS_TAB_ORDER];

function featurePermission(permission: Permission) {
  return {
    available: permission !== "none",
    permission,
    visible: permission !== "none",
  };
}

function permissionsFor(
  overrides: Partial<Record<keyof RestaurantSettingsPermissions, Permission>> = {},
): RestaurantSettingsPermissions {
  return {
    restaurant_config: featurePermission(overrides.restaurant_config ?? "operate"),
    users: featurePermission(overrides.users ?? "operate"),
    locations: featurePermission(overrides.locations ?? "operate"),
    whatsapp: featurePermission(overrides.whatsapp ?? "operate"),
  };
}

function bootstrap(options: {
  permissions: RestaurantSettingsPermissions | null;
  navigation?: RestaurantSettingsNavigation;
  branchChoices?: RestaurantSettingsBranchChoice[];
}): RestaurantSettingsBootstrap {
  const navigation =
    options.navigation ?? deriveRestaurantSettingsNavigation({ access: options.permissions });
  return {
    accessResolved: navigation.accessResolved,
    message: navigation.message,
    navigation,
    permissions: options.permissions,
    identity: {
      accountId: "owner-1",
      tenantId: "tenant-1",
      role: "admin",
      accountType: "user",
      email: "owner@example.com",
      locationId: null,
    },
    profileSummary: null,
    profilePhoto: null,
    branchChoices: options.branchChoices ?? [],
    userPlanLimits: null,
    locationPlan: null,
  } as unknown as RestaurantSettingsBootstrap;
}

/** A resolved fetcher returning one bootstrap for every scope request. */
function fetcher(value: RestaurantSettingsBootstrap): FetchRestaurantSettingsBootstrap {
  return vi.fn(async () => value);
}

const noop = () => {};
const noopSetUser = () => {};
const noopToast = () => {};

function renderShell(fetchBootstrap: FetchRestaurantSettingsBootstrap) {
  return render(
    <SettingsPanel
      user={null}
      setUser={noopSetUser}
      showToast={noopToast}
      onGoToPlans={noop}
      fetchBootstrap={fetchBootstrap}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Shell structure
// ---------------------------------------------------------------------------

describe("Restaurant Settings shell", () => {
  it("renders a section heading and description (Req 1.1)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor() })));
    expect(await screen.findByRole("heading", { name: /Restaurant Management/i })).toBeTruthy();
    expect(screen.getByText(/Configure your restaurant profile/i)).toBeTruthy();
  });

  it("lists the nine canonical sub-tabs exactly once in canonical order (Req 1.2)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor() })));
    const tablist = await screen.findByRole("tablist");
    const labels = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim());
    expect(labels).toEqual(CANONICAL_ORDER);
  });

  it("defaults to the first visible sub-tab and marks it selected (Req 1.7)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor() })));
    const tablist = await screen.findByRole("tablist");
    const selected = within(tablist).getByRole("tab", { selected: true });
    expect(selected.textContent?.trim()).toBe("Restaurant Profile");
    expect(screen.getByTestId("panel-profile")).toBeTruthy();
  });

  it("mounts exactly one panel body and swaps it when a sub-tab is selected (Req 1.6, 10.2)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor() })));
    await screen.findByTestId("panel-profile");
    expect(screen.queryByTestId("panel-tables")).toBeNull();

    fireEvent.click(screen.getByTestId("settings-subtab-Tables"));

    await screen.findByTestId("panel-tables");
    expect(screen.queryByTestId("panel-profile")).toBeNull();
    const tablist = screen.getByRole("tablist");
    expect(within(tablist).getByRole("tab", { selected: true }).textContent?.trim()).toBe("Tables");
  });

  it("gives an entitled owner all nine canonical sub-tabs, each with its own control (Req 1.1, 1.2, 2.1, 10.1)", async () => {
    // Every gated feature resolves to `operate` — the full-entitlement owner.
    renderShell(
      fetcher(
        bootstrap({
          permissions: permissionsFor({
            restaurant_config: "operate",
            users: "operate",
            locations: "operate",
            whatsapp: "operate",
          }),
        }),
      ),
    );
    const tablist = await screen.findByRole("tablist");
    // Exactly one tab control per canonical entry, reachable by its own testid.
    expect(within(tablist).getAllByRole("tab")).toHaveLength(CANONICAL_ORDER.length);
    for (const id of CANONICAL_ORDER) {
      expect(screen.getByTestId(`settings-subtab-${id}`)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Responsive selectors
// ---------------------------------------------------------------------------

describe("Restaurant Settings responsive selectors", () => {
  it("renders a single-select dropdown listing every visible sub-tab (Req 1.4)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor() })));
    const select = (await screen.findByTestId("settings-subtab-select")) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.multiple).toBe(false);
    expect([...select.options].map((o) => o.value)).toEqual(CANONICAL_ORDER);
    // The dropdown marks the rendered sub-tab as selected (Req 1.4).
    expect(select.value).toBe("Restaurant Profile");
  });

  it("renders a horizontal bar marking the selected sub-tab (Req 1.5)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor() })));
    const tablist = await screen.findByRole("tablist");
    const selected = within(tablist).getByRole("tab", { selected: true });
    expect(selected.getAttribute("aria-current")).toBe("page");
  });

  it("keeps the dropdown and the bar in sync when a sub-tab is chosen (Req 1.4, 1.6)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor() })));
    const select = (await screen.findByTestId("settings-subtab-select")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Booking Rules" } });
    await screen.findByTestId("panel-booking-rules");
    expect((screen.getByTestId("settings-subtab-select") as HTMLSelectElement).value).toBe(
      "Booking Rules",
    );
  });
});

// ---------------------------------------------------------------------------
// Fallback, unresolved, and empty states
// ---------------------------------------------------------------------------

describe("Restaurant Settings visibility states", () => {
  it("renders the Profile-only unresolved state with the documented message (Req 1.9)", async () => {
    renderShell(fetcher(bootstrap({ permissions: null })));
    const message = await screen.findByTestId("settings-access-message");
    expect(message.textContent).toContain(MSG_FEATURE_ACCESS_UNRESOLVED);
    const tablist = screen.getByRole("tablist");
    const labels = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim());
    expect(labels).toEqual(["Restaurant Profile"]);
    expect(screen.getByTestId("panel-profile")).toBeTruthy();
  });

  it("renders the empty-state message with no selector or body when nothing is visible (Req 1.8)", async () => {
    const navigation: RestaurantSettingsNavigation = {
      accessResolved: true,
      message: null,
      visibleTabs: [],
      selectedTab: "Restaurant Profile",
      activePanel: "Restaurant Profile",
      hasVisibleSettings: false,
    };
    renderShell(fetcher(bootstrap({ permissions: permissionsFor(), navigation })));
    const empty = await screen.findByTestId("settings-empty-state");
    expect(empty.textContent).toContain(MSG_NO_RESTAURANT_SETTINGS);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("settings-subtab-select")).toBeNull();
    expect(screen.queryByTestId("settings-active-panel")).toBeNull();
  });

  it("hides config sub-tabs when restaurant_config is not visible but keeps Profile first (Req 1.2, 2.1)", async () => {
    renderShell(
      fetcher(
        bootstrap({
          permissions: permissionsFor({
            restaurant_config: "none",
            users: "none",
            locations: "none",
            whatsapp: "none",
          }),
        }),
      ),
    );
    const tablist = await screen.findByRole("tablist");
    const labels = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim());
    expect(labels).toEqual(["Restaurant Profile"]);
  });
});

// ---------------------------------------------------------------------------
// Owner-only branch selector
// ---------------------------------------------------------------------------

describe("Restaurant Settings branch selector", () => {
  it("shows the owner branch selector and re-reads the bootstrap on a branch change (Req 9.6, 9.7)", async () => {
    const branches: RestaurantSettingsBranchChoice[] = [
      { id: "branch-1", name: "Downtown", isActive: true },
      { id: "branch-2", name: "Airport", isActive: false },
    ];
    const fetchBootstrap = fetcher(
      bootstrap({ permissions: permissionsFor(), branchChoices: branches }),
    );
    renderShell(fetchBootstrap);

    const select = (await screen.findByTestId("settings-branch-select")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      "Primary location",
      "Downtown",
      "Airport (inactive)",
    ]);

    fireEvent.change(select, { target: { value: "branch-1" } });

    await waitFor(() => {
      expect(fetchBootstrap).toHaveBeenCalledWith({ data: { requestedLocationId: "branch-1" } });
    });
    // The active panel receives the selected branch scope.
    await waitFor(() => {
      expect(screen.getByTestId("panel-profile").getAttribute("data-location")).toBe("branch-1");
    });
  });

  it("hides the branch selector when the locations feature is not visible (Req 9.6)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor({ locations: "none" }) })));
    await screen.findByRole("tablist");
    expect(screen.queryByTestId("settings-branch-select")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Keyboard operation, focus retention, and label uniqueness
// ---------------------------------------------------------------------------

describe("Restaurant Settings selector keyboard and labels", () => {
  it("exposes each sub-tab as a focusable native button and keeps focus on it after activation (Req 1.6, 10.2)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor() })));
    const tablist = await screen.findByRole("tablist");
    // Every tab is a real <button> — focusable and keyboard-operable by default
    // (Enter/Space activate it), with none removed from the tab order.
    for (const tab of within(tablist).getAllByRole("tab")) {
      expect(tab.tagName).toBe("BUTTON");
      expect((tab as HTMLButtonElement).disabled).toBe(false);
      expect(tab.getAttribute("tabindex")).not.toBe("-1");
    }

    const tablesTab = screen.getByTestId("settings-subtab-Tables") as HTMLButtonElement;
    tablesTab.focus();
    expect(document.activeElement).toBe(tablesTab);

    // Activating the focused tab swaps the body and leaves focus on the selector.
    fireEvent.click(tablesTab);
    await screen.findByTestId("panel-tables");
    expect(within(tablist).getByRole("tab", { selected: true }).textContent?.trim()).toBe("Tables");
    expect(document.activeElement).toBe(tablesTab);
  });

  it("renders no duplicate sub-tab labels in the bar or the dropdown (Req 1.2)", async () => {
    renderShell(fetcher(bootstrap({ permissions: permissionsFor() })));
    const tablist = await screen.findByRole("tablist");
    const barLabels = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim());
    expect(new Set(barLabels).size).toBe(barLabels.length);
    expect(barLabels.length).toBe(CANONICAL_ORDER.length);

    const select = screen.getByTestId("settings-subtab-select") as HTMLSelectElement;
    const dropdownLabels = [...select.options].map((o) => o.textContent?.trim());
    expect(new Set(dropdownLabels).size).toBe(dropdownLabels.length);
    expect(dropdownLabels.length).toBe(CANONICAL_ORDER.length);
  });
});
