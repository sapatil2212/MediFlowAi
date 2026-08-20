// @vitest-environment jsdom
/**
 * restaurant.settings-shell.test.tsx
 *
 * Focused DOM suite for the Restaurant_Dashboard Settings navigation shell
 * (`SettingsPanel` in `src/routes/dashboards/restaurant.tsx`), spec
 * `.kiro/specs/restaurant-dashboard-settings`, task 6.3 (Req 1.1-1.9, 2.1,
 * 10.1, 10.2).
 *
 * Conventions, matching `RestaurantProfilePanel.test.tsx` and
 * `DiningAreasSettings.test.tsx`:
 *   - Every server interaction crosses an injected callback: the shell reads its
 *     guarded bootstrap through the `fetchBootstrap` prop, which each test
 *     supplies, so the suite never touches the database, auth, or SQL.
 *   - The production server-function modules the route imports at load time
 *     (`../../lib/auth`, `../../lib/restaurant`, `../../lib/restaurant-settings`)
 *     are mocked at the module boundary so importing the route does not pull
 *     `db`/`auth.server` into jsdom.
 *   - The extracted sub-tab panels are mocked with tiny stubs so the tests stay
 *     focused on shell navigation rather than panel internals.
 *   - Canonical order, labels, and messages are asserted against the pure
 *     model's exported constants (`RESTAURANT_SETTINGS_TAB_ORDER`,
 *     `MSG_FEATURE_ACCESS_UNRESOLVED`, `MSG_NO_RESTAURANT_SETTINGS`), never
 *     retyped literals, so a copy edit cannot silently pass.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module-boundary mocks — keep server-only code out of jsdom.
// ---------------------------------------------------------------------------

vi.mock("../../lib/auth", () => ({
  getCurrentUserServerFn: vi.fn(async () => null),
  getClinicProfileServerFn: vi.fn(async () => ({})),
  getSubUsersServerFn: vi.fn(async () => []),
  createSubUserServerFn: vi.fn(async () => ({})),
  deleteSubUserServerFn: vi.fn(async () => ({})),
  disconnectWhatsAppServerFn: vi.fn(async () => ({})),
  getWhatsAppConfigServerFn: vi.fn(async () => ({})),
  getWhatsAppStatusServerFn: vi.fn(async () => ({
    state: "DISCONNECTED",
    qrDataUrl: "",
    connectedNumber: "",
    queueCount: 0,
    sentLog: [],
  })),
  logoutServerFn: vi.fn(async () => ({})),
  saveWhatsAppConfigServerFn: vi.fn(async () => ({})),
  sendEmailChangeOtpServerFn: vi.fn(async () => ({})),
  sendTestWaServerFn: vi.fn(async () => ({})),
  updateEmailServerFn: vi.fn(async () => ({})),
  updatePasswordServerFn: vi.fn(async () => ({})),
  updateProfileServerFn: vi.fn(async () => ({})),
  uploadProfilePhotoServerFn: vi.fn(async () => ({})),
}));

vi.mock("../../lib/restaurant", () => ({
  getRestaurantBookingsServerFn: vi.fn(async () => ({ rows: [], total: 0 })),
  getRestaurantGuestsServerFn: vi.fn(async () => ({ rows: [], total: 0 })),
  getRestaurantOverviewServerFn: vi.fn(async () => ({})),
  getRestaurantTablesServerFn: vi.fn(async () => ({ tables: [] })),
  reassignRestaurantBookingServerFn: vi.fn(async () => ({})),
  setRestaurantBookingStatusServerFn: vi.fn(async () => ({})),
}));

vi.mock("../../lib/restaurant-settings", () => ({
  getRestaurantSettingsBootstrapServerFn: vi.fn(async () => {
    throw new Error("fetchBootstrap must be injected in tests");
  }),
}));

// The extracted sub-tab panels — each mocked to a stub that announces which body
// mounted, so "exactly one active body" is directly observable.
vi.mock("../../components/restaurant/RestaurantProfilePanel", () => ({
  RestaurantProfilePanel: (props: { requestedLocationId?: string | null }) => (
    <div
      data-testid="mock-body-Restaurant Profile"
      data-location={String(props.requestedLocationId)}
    />
  ),
}));
vi.mock("../../components/restaurant/OperatingHours", () => ({
  OperatingHours: (props: { requestedLocationId?: string | null }) => (
    <div
      data-testid="mock-body-Operating Hours"
      data-location={String(props.requestedLocationId)}
    />
  ),
}));
vi.mock("../../components/restaurant/DiningAreasSettings", () => ({
  DiningAreasSettings: (props: { requestedLocationId?: string | null }) => (
    <div data-testid="mock-body-Dining Areas" data-location={String(props.requestedLocationId)} />
  ),
}));
vi.mock("../../components/restaurant/TableManager", () => ({
  TableManager: (props: { locationId?: string | null }) => (
    <div data-testid="mock-body-Tables" data-location={String(props.locationId)} />
  ),
}));
vi.mock("../../components/restaurant/MenuSettings", () => ({
  MenuSettings: (props: { requestedLocationId?: string | null }) => (
    <div data-testid="mock-body-Menu" data-location={String(props.requestedLocationId)} />
  ),
}));
vi.mock("../../components/restaurant/BookingRules", () => ({
  BookingRules: () => <div data-testid="mock-body-Booking Rules" />,
  default: () => <div data-testid="mock-body-Booking Rules" />,
}));
vi.mock("../../components/restaurant/WalkInDrawer", () => ({
  WalkInDrawer: () => null,
  default: () => null,
}));
vi.mock("../../components/settings/MultiLocationSettings", () => ({
  default: () => <div data-testid="mock-body-Multi Location" />,
}));
// The restaurant "Multi Location" tab body is `RestaurantBranchSettings`, not the
// generic MultiLocationSettings panel — stub it so switching to that tab mounts a
// deterministic body instead of pulling the real server-function imports.
vi.mock("../../components/restaurant/RestaurantBranchSettings", () => ({
  RestaurantBranchSettings: (props: { requestedLocationId?: string | null }) => (
    <div data-testid="mock-body-Multi Location" data-location={String(props.requestedLocationId)} />
  ),
}));
vi.mock("../../components/settings/ManagePlansPanel", () => ({
  default: () => <div data-testid="mock-manage-plans" />,
}));
vi.mock("../../components/WhatsAppHub", () => ({
  default: () => <div data-testid="mock-whatsapp-hub" />,
}));

import { SettingsPanel, type FetchRestaurantSettingsBootstrap } from "./restaurant";
import {
  RESTAURANT_SETTINGS_TAB_ORDER,
  MSG_FEATURE_ACCESS_UNRESOLVED,
  MSG_NO_RESTAURANT_SETTINGS,
  deriveRestaurantSettingsNavigation,
  deriveProfileCapabilityViewModel,
  deriveFeatureCapabilityViewModel,
  type FeaturePermission,
  type RestaurantSettingsPermissions,
  type RestaurantSettingsNavigation,
  type RestaurantSettingsTab,
  type Permission,
  type SettingsFeature,
} from "../../lib/restaurant-settings-model";
import type { RestaurantSettingsBootstrap } from "../../lib/restaurant-settings";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALL_TABS = RESTAURANT_SETTINGS_TAB_ORDER as readonly RestaurantSettingsTab[];

/** Every tab whose body is a mocked stub we can assert against precisely. */
const STUBBED_BODY_TABS: RestaurantSettingsTab[] = [
  "Restaurant Profile",
  "Operating Hours",
  "Dining Areas",
  "Tables",
  "Menu",
  "Booking Rules",
  "Multi Location",
];

function perm(permission: Permission, visible = permission !== "none"): FeaturePermission {
  return { available: visible, permission, visible };
}

/** Fully entitled: every feature visible and operable → all nine tabs. */
function fullyEntitledAccess(): RestaurantSettingsPermissions {
  return {
    restaurant_config: perm("operate"),
    users: perm("operate"),
    locations: perm("operate"),
    whatsapp: perm("operate"),
  };
}

const FEATURES: SettingsFeature[] = ["restaurant_config", "users", "locations", "whatsapp"];

/**
 * Builds a bootstrap the shell can consume. `access` is the resolved permissions
 * record (or `null` for the unresolved-access state); navigation is derived by
 * the same pure helper the server uses. `navigationOverride` supports the
 * defensive empty-set state the pure helper never produces on its own.
 */
function buildBootstrap(opts: {
  access: RestaurantSettingsPermissions | null;
  requestedTab?: string | null;
  branchChoices?: RestaurantSettingsBootstrap["branchChoices"];
  navigationOverride?: RestaurantSettingsNavigation;
}): RestaurantSettingsBootstrap {
  const { access, requestedTab = null, branchChoices = [], navigationOverride } = opts;
  const navigation =
    navigationOverride ?? deriveRestaurantSettingsNavigation({ access, requestedTab });
  const configPermission = access?.restaurant_config.permission ?? "none";

  const featureCapabilities = Object.fromEntries(
    FEATURES.map((feature) => [
      feature,
      deriveFeatureCapabilityViewModel(feature, access?.[feature]),
    ]),
  ) as RestaurantSettingsBootstrap["featureCapabilities"];

  return {
    accessResolved: navigation.accessResolved,
    message: navigation.message,
    navigation,
    permissions: access,
    identity: {
      accountId: "acc-1",
      tenantId: "tenant-1",
      role: "admin",
      accountType: "user",
      email: "owner@example.com",
      locationId: null,
    },
    profileCapability: deriveProfileCapabilityViewModel(configPermission),
    featureCapabilities,
    profileSummary: null,
    profilePhoto: null,
    branchChoices,
    userPlanLimits: null,
    locationPlan: null,
  };
}

const bootstrapOf = (bootstrap: RestaurantSettingsBootstrap): FetchRestaurantSettingsBootstrap =>
  vi.fn(async () => bootstrap);

/** Mounts the shell and waits for the injected bootstrap read to settle. */
async function mountShell(fetchBootstrap: FetchRestaurantSettingsBootstrap) {
  const utils = render(
    <SettingsPanel
      user={{ id: "acc-1", name: "Owner", email: "owner@example.com", tenantId: "tenant-1" }}
      setUser={vi.fn()}
      showToast={vi.fn()}
      onGoToPlans={vi.fn()}
      fetchBootstrap={fetchBootstrap}
    />,
  );
  // The heading is always present; wait for the loading spinner to be replaced.
  await waitFor(() => expect(fetchBootstrap).toHaveBeenCalled());
  return utils;
}

/** All rendered horizontal tab buttons, in DOM order. */
function tabButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Canonical nine-tab inventory (Req 1.1, 1.2, 1.3)
// ---------------------------------------------------------------------------

describe("Entitled nine-tab inventory (Req 1.1-1.3)", () => {
  it("renders a heading, a description, and all nine tabs once in canonical order", async () => {
    await mountShell(bootstrapOf(buildBootstrap({ access: fullyEntitledAccess() })));
    await screen.findByTestId("settings-active-panel");

    // Req 1.1 — heading and description.
    expect(
      screen.getByRole("heading", { name: /Workspace & Restaurant Management/i }),
    ).toBeTruthy();
    expect(screen.getByText(/Configure your restaurant profile, operating hours/i)).toBeTruthy();

    // Req 1.2 — the selector lists each visible sub-tab exactly once, in the
    // canonical order, and matches the model's canonical constant verbatim.
    const labels = tabButtons().map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual([...ALL_TABS]);
    expect(labels).toHaveLength(9);
  });

  it("has no duplicate tab labels in the horizontal selector or the dropdown", async () => {
    await mountShell(bootstrapOf(buildBootstrap({ access: fullyEntitledAccess() })));
    await screen.findByTestId("settings-active-panel");

    const barLabels = tabButtons().map((b) => (b.textContent ?? "").trim());
    expect(new Set(barLabels).size).toBe(barLabels.length);

    const optionLabels = Array.from(
      (screen.getByTestId("settings-subtab-select") as HTMLSelectElement).options,
    ).map((o) => o.textContent?.trim() ?? "");
    expect(new Set(optionLabels).size).toBe(optionLabels.length);
    expect(optionLabels).toEqual([...ALL_TABS]);
  });
});

// ---------------------------------------------------------------------------
// Unresolved access & defensive empty states (Req 1.8, 1.9, 2.1)
// ---------------------------------------------------------------------------

describe("Unresolved-access Profile-only state (Req 1.9, 2.1)", () => {
  it("renders only Restaurant Profile with the unresolved-access message", async () => {
    await mountShell(bootstrapOf(buildBootstrap({ access: null })));
    await screen.findByTestId("settings-active-panel");

    // Req 1.9 — the documented message is surfaced verbatim.
    expect(screen.getByTestId("settings-access-message").textContent).toContain(
      MSG_FEATURE_ACCESS_UNRESOLVED,
    );

    // Req 2.1 — Restaurant Profile is the only tab and it is the active body.
    const labels = tabButtons().map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual(["Restaurant Profile"]);
    expect(screen.getByTestId("settings-active-panel").getAttribute("data-active-tab")).toBe(
      "Restaurant Profile",
    );
    expect(screen.getByTestId("mock-body-Restaurant Profile")).toBeTruthy();
    // No owner branch selector when access (and therefore locations) is unresolved.
    expect(screen.queryByTestId("settings-branch-select")).toBeNull();
  });
});

describe("Defensive empty state (Req 1.8)", () => {
  it("renders the no-settings message and neither a selector nor a body", async () => {
    const navigationOverride: RestaurantSettingsNavigation = {
      accessResolved: true,
      message: null,
      visibleTabs: [],
      selectedTab: "Restaurant Profile",
      activePanel: "Restaurant Profile",
      hasVisibleSettings: false,
    };
    await mountShell(
      bootstrapOf(
        buildBootstrap({
          access: {
            restaurant_config: perm("none"),
            users: perm("none"),
            locations: perm("none"),
            whatsapp: perm("none"),
          },
          navigationOverride,
        }),
      ),
    );

    await screen.findByTestId("settings-empty-state");
    expect(screen.getByTestId("settings-empty-state").textContent).toContain(
      MSG_NO_RESTAURANT_SETTINGS,
    );
    // Req 1.8 — no selector (dropdown or bar) and no sub-tab body.
    expect(screen.queryByTestId("settings-subtab-select")).toBeNull();
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.queryByTestId("settings-active-panel")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invalid / unknown requested tab fallback (Req 1.7)
// ---------------------------------------------------------------------------

describe("Invalid requested-tab fallback (Req 1.7)", () => {
  it("falls back to the first visible tab (Restaurant Profile) for an unknown request", async () => {
    // The bootstrap is derived with a requested tab outside the visible set.
    await mountShell(
      bootstrapOf(
        buildBootstrap({ access: fullyEntitledAccess(), requestedTab: "Nonexistent Tab" }),
      ),
    );
    const panel = await screen.findByTestId("settings-active-panel");

    expect(panel.getAttribute("data-active-tab")).toBe("Restaurant Profile");
    const selected = tabButtons().filter((b) => b.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect((selected[0].textContent ?? "").trim()).toBe("Restaurant Profile");
  });

  it("falls back to the first visible tab when config is hidden but other features are visible", async () => {
    // Config `none` hides the five config tabs; the first visible tab is still
    // Restaurant Profile, and WhatsApp/Users/Multi Location remain visible.
    const access: RestaurantSettingsPermissions = {
      restaurant_config: perm("none"),
      users: perm("operate"),
      locations: perm("operate"),
      whatsapp: perm("operate"),
    };
    await mountShell(bootstrapOf(buildBootstrap({ access, requestedTab: "Menu" })));
    const panel = await screen.findByTestId("settings-active-panel");

    expect(panel.getAttribute("data-active-tab")).toBe("Restaurant Profile");
    const labels = tabButtons().map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual([
      "Restaurant Profile",
      "WhatsApp Alerts",
      "Multi Location",
      "Manage Users",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Exactly one active body, and selected semantics (Req 1.6, 1.2, 10.2)
// ---------------------------------------------------------------------------

describe("Exactly one active body per selected tab (Req 1.6, 10.2)", () => {
  it("mounts exactly the body of the selected tab and no other", async () => {
    await mountShell(bootstrapOf(buildBootstrap({ access: fullyEntitledAccess() })));
    await screen.findByTestId("settings-active-panel");

    for (const tab of STUBBED_BODY_TABS) {
      fireEvent.click(screen.getByTestId(`settings-subtab-${tab}`));

      // The active-panel container is keyed on the active tab, so it remounts on
      // each switch — re-query it rather than holding a stale reference.
      const panel = screen.getByTestId("settings-active-panel");
      // The active panel reports the selected tab and mounts exactly its body.
      expect(panel.getAttribute("data-active-tab")).toBe(tab);
      const bodies = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid^="mock-body-"]'),
      );
      expect(bodies).toHaveLength(1);
      expect(bodies[0].getAttribute("data-testid")).toBe(`mock-body-${tab}`);
      // The body lives inside the single active-panel container.
      expect(within(panel).getByTestId(`mock-body-${tab}`)).toBeTruthy();
    }
  });
});

describe("Selected / aria-selected semantics (Req 1.2, 1.4, 1.5)", () => {
  it("marks exactly one tab selected and keeps the dropdown value in sync", async () => {
    await mountShell(bootstrapOf(buildBootstrap({ access: fullyEntitledAccess() })));
    await screen.findByTestId("settings-active-panel");

    // Default selection is the first visible tab.
    const initiallySelected = tabButtons().filter(
      (b) => b.getAttribute("aria-selected") === "true",
    );
    expect(initiallySelected).toHaveLength(1);
    expect((initiallySelected[0].textContent ?? "").trim()).toBe("Restaurant Profile");
    expect((screen.getByTestId("settings-subtab-select") as HTMLSelectElement).value).toBe(
      "Restaurant Profile",
    );

    // Selecting Menu moves the sole selection and current marker, and mirrors in
    // the compact dropdown value (Req 1.4, 1.5).
    fireEvent.click(screen.getByTestId("settings-subtab-Menu"));

    const selectedAfter = tabButtons().filter((b) => b.getAttribute("aria-selected") === "true");
    expect(selectedAfter).toHaveLength(1);
    expect((selectedAfter[0].textContent ?? "").trim()).toBe("Menu");
    expect(selectedAfter[0].getAttribute("aria-current")).toBe("page");
    // The rest are explicitly not selected and carry no current marker.
    for (const button of tabButtons()) {
      const isMenu = (button.textContent ?? "").trim() === "Menu";
      expect(button.getAttribute("aria-selected")).toBe(isMenu ? "true" : "false");
      expect(button.getAttribute("aria-current")).toBe(isMenu ? "page" : null);
    }
    expect((screen.getByTestId("settings-subtab-select") as HTMLSelectElement).value).toBe("Menu");
  });

  it("selects the tab chosen through the compact dropdown", async () => {
    await mountShell(bootstrapOf(buildBootstrap({ access: fullyEntitledAccess() })));
    await screen.findByTestId("settings-active-panel");

    fireEvent.change(screen.getByTestId("settings-subtab-select"), {
      target: { value: "Dining Areas" },
    });

    // The keyed active-panel container remounts on switch; re-query it.
    expect(screen.getByTestId("settings-active-panel").getAttribute("data-active-tab")).toBe(
      "Dining Areas",
    );
    const selected = tabButtons().filter((b) => b.getAttribute("aria-selected") === "true");
    expect((selected[0].textContent ?? "").trim()).toBe("Dining Areas");
  });
});

// ---------------------------------------------------------------------------
// Responsive modes at 767 vs 768 CSS pixels (Req 1.4, 1.5)
// ---------------------------------------------------------------------------

describe("Responsive selector modes (Req 1.4, 1.5)", () => {
  /**
   * The shell drives the two selector presentations with Tailwind's `md`
   * breakpoint (768 px): a `md:hidden` dropdown wrapper (shown below 768 px) and
   * a `hidden md:flex` horizontal bar (shown at 768 px and above). jsdom never
   * evaluates media queries, so the responsive contract is asserted through the
   * exact breakpoint classes that govern each control's visibility, together
   * with a matchMedia probe pinned to the boundary widths.
   */
  function setViewportWidth(width: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    window.matchMedia = vi.fn((query: string) => {
      const match = /min-width:\s*(\d+)px/.exec(query);
      const threshold = match ? Number(match[1]) : 0;
      return {
        matches: width >= threshold,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
    }) as unknown as typeof window.matchMedia;
  }

  it("at 767 px the dropdown is the active control and the tab bar is breakpoint-hidden", async () => {
    setViewportWidth(767);
    await mountShell(bootstrapOf(buildBootstrap({ access: fullyEntitledAccess() })));
    await screen.findByTestId("settings-active-panel");

    // Below 768 px the compact dropdown wrapper is shown (`md:hidden`)...
    const dropdown = screen.getByTestId("settings-subtab-select");
    const dropdownWrapper = dropdown.closest("div.md\\:hidden");
    expect(dropdownWrapper).not.toBeNull();

    // ...and the horizontal bar is hidden at the base width (`hidden md:flex`).
    const tablist = document.querySelector('[role="tablist"]') as HTMLElement;
    expect(tablist.classList.contains("hidden")).toBe(true);
    expect(tablist.classList.contains("md:flex")).toBe(true);

    // The breakpoint query the mode hinges on evaluates false at 767 px.
    expect(window.matchMedia("(min-width: 768px)").matches).toBe(false);
  });

  it("at 768 px the horizontal tab bar is the active control and the dropdown is breakpoint-hidden", async () => {
    setViewportWidth(768);
    await mountShell(bootstrapOf(buildBootstrap({ access: fullyEntitledAccess() })));
    await screen.findByTestId("settings-active-panel");

    // At 768 px the horizontal bar is shown (`md:flex`)...
    const tablist = document.querySelector('[role="tablist"]') as HTMLElement;
    expect(tablist.classList.contains("md:flex")).toBe(true);
    expect(tabButtons().length).toBe(9);

    // ...and the compact dropdown wrapper is hidden from that breakpoint up.
    const dropdown = screen.getByTestId("settings-subtab-select");
    const dropdownWrapper = dropdown.closest("div.md\\:hidden") as HTMLElement;
    expect(dropdownWrapper).not.toBeNull();
    expect(dropdownWrapper.classList.contains("md:hidden")).toBe(true);

    // The breakpoint query the mode hinges on evaluates true at 768 px.
    expect(window.matchMedia("(min-width: 768px)").matches).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Keyboard & focus behavior (Req 1.4, 1.5)
// ---------------------------------------------------------------------------

describe("Keyboard and focus behavior (Req 1.4, 1.5)", () => {
  it("exposes native, focusable tab buttons and activates the focused tab", async () => {
    await mountShell(bootstrapOf(buildBootstrap({ access: fullyEntitledAccess() })));
    await screen.findByTestId("settings-active-panel");

    const menuTab = screen.getByTestId("settings-subtab-Menu") as HTMLButtonElement;
    // Real <button role="tab"> elements are keyboard-focusable and Enter/Space
    // activatable natively; none are disabled.
    expect(menuTab.tagName).toBe("BUTTON");
    expect(menuTab.disabled).toBe(false);

    menuTab.focus();
    expect(document.activeElement).toBe(menuTab);

    // Activating the focused control selects it (Enter/Space on a button maps to
    // a click, which fireEvent.click represents).
    fireEvent.click(menuTab);
    expect(screen.getByTestId("settings-active-panel").getAttribute("data-active-tab")).toBe(
      "Menu",
    );
    // The tab bar itself is not keyed, so its buttons persist across the switch.
    expect(screen.getByTestId("settings-subtab-Menu").getAttribute("aria-selected")).toBe("true");
  });

  it("gives the compact dropdown an accessible name and keyboard focus", async () => {
    await mountShell(bootstrapOf(buildBootstrap({ access: fullyEntitledAccess() })));
    await screen.findByTestId("settings-active-panel");

    // The sr-only <label htmlFor> names the select for assistive tech.
    const namedSelect = screen.getByLabelText("Settings section") as HTMLSelectElement;
    expect(namedSelect.getAttribute("data-testid")).toBe("settings-subtab-select");

    namedSelect.focus();
    expect(document.activeElement).toBe(namedSelect);
  });
});

// ---------------------------------------------------------------------------
// Branch scope reset on selection change (Req 10.2)
// ---------------------------------------------------------------------------

describe("Branch scope propagation and remount (Req 10.2)", () => {
  beforeEach(() => {
    // A stable matchMedia so any incidental probe does not throw in jsdom.
    window.matchMedia = vi.fn(
      (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    ) as unknown as typeof window.matchMedia;
  });

  it("re-reads the bootstrap for the chosen branch and passes the scope to the active body", async () => {
    const fetchBootstrap = bootstrapOf(
      buildBootstrap({
        access: fullyEntitledAccess(),
        branchChoices: [{ id: "loc-9", name: "Riverside", isActive: true }],
      }),
    );
    await mountShell(fetchBootstrap);
    await screen.findByTestId("settings-active-panel");

    // Initial scope is the primary (unscoped) location.
    expect(screen.getByTestId("mock-body-Restaurant Profile").getAttribute("data-location")).toBe(
      "null",
    );
    expect(fetchBootstrap).toHaveBeenCalledWith({ data: { requestedLocationId: null } });

    await act(async () => {
      fireEvent.change(screen.getByTestId("settings-branch-select"), {
        target: { value: "loc-9" },
      });
      await Promise.resolve();
    });

    // The scope change re-reads the guarded bootstrap and flows into the body.
    await waitFor(() =>
      expect(fetchBootstrap).toHaveBeenCalledWith({ data: { requestedLocationId: "loc-9" } }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("mock-body-Restaurant Profile").getAttribute("data-location")).toBe(
        "loc-9",
      ),
    );
  });
});
