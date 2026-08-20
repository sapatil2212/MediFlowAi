import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CONFIG_SETTINGS_TABS,
  MSG_FEATURE_ACCESS_UNRESOLVED,
  RESTAURANT_SETTINGS_TAB_ORDER,
  deriveRestaurantSettingsNavigation,
  type FeaturePermission,
  type Permission,
  type RestaurantSettingsPermissions,
  type RestaurantSettingsTab,
  type SettingsFeature,
} from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 1: Canonical settings navigation
// **Validates: Requirements 1.2, 1.6, 1.7, 1.9, 2.1, 7.1, 8.1, 9.1, 10.1, 10.2**

const SETTINGS_FEATURES: readonly SettingsFeature[] = [
  "restaurant_config",
  "users",
  "locations",
  "whatsapp",
];

const CONFIG_TAB_SET = new Set<RestaurantSettingsTab>(
  CONFIG_SETTINGS_TABS as readonly RestaurantSettingsTab[],
);

/** Maps a non-config, non-profile tab to the feature flag that governs it. */
const GOVERNING_FEATURE: Partial<Record<RestaurantSettingsTab, SettingsFeature>> = {
  "WhatsApp Alerts": "whatsapp",
  "Multi Location": "locations",
  "Manage Users": "users",
};

const permissionArb: fc.Arbitrary<Permission> = fc.constantFrom("operate", "view_only", "none");

/**
 * Generates a resolved feature permission with `permission` and `visible`
 * independently chosen so the property exercises every combination, including
 * inconsistent snapshots (e.g. visible without an operable permission).
 */
const featurePermissionArb: fc.Arbitrary<FeaturePermission> = fc.record({
  available: fc.boolean(),
  permission: permissionArb,
  visible: fc.boolean(),
});

const accessArb: fc.Arbitrary<RestaurantSettingsPermissions> = fc.record({
  restaurant_config: featurePermissionArb,
  users: featurePermissionArb,
  locations: featurePermissionArb,
  whatsapp: featurePermissionArb,
});

/** Any requested tab: canonical tabs, padded tabs, foreign strings, and absent values. */
const requestedTabArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.constantFrom(...RESTAURANT_SETTINGS_TAB_ORDER),
  fc.constantFrom(...RESTAURANT_SETTINGS_TAB_ORDER).map((tab) => `  ${tab}  `),
  fc.string(),
  fc.constant(""),
  fc.constant(null),
  fc.constant(undefined),
);

/** Reference visibility, expressed directly from the acceptance criteria. */
function expectedVisibleTabs(access: RestaurantSettingsPermissions): RestaurantSettingsTab[] {
  const configVisible =
    access.restaurant_config.permission === "operate" ||
    access.restaurant_config.permission === "view_only";
  return RESTAURANT_SETTINGS_TAB_ORDER.filter((tab) => {
    if (tab === "Restaurant Profile") return true;
    if (CONFIG_TAB_SET.has(tab)) return configVisible;
    const feature = GOVERNING_FEATURE[tab];
    return feature !== undefined && access[feature].visible === true;
  });
}

describe("Property 1: Canonical settings navigation", () => {
  it("derives Profile-first, permission-governed, canonically ordered navigation for resolved access", () => {
    fc.assert(
      fc.property(accessArb, requestedTabArb, (access, requestedTab) => {
        const nav = deriveRestaurantSettingsNavigation({ access, requestedTab });

        expect(nav.accessResolved).toBe(true);
        expect(nav.message).toBeNull();

        // Restaurant Profile is present exactly once and first.
        const profileOccurrences = nav.visibleTabs.filter((tab) => tab === "Restaurant Profile");
        expect(profileOccurrences).toHaveLength(1);
        expect(nav.visibleTabs[0]).toBe("Restaurant Profile");

        // Each tab appears exactly once iff its governing permission is visible.
        const expected = expectedVisibleTabs(access);
        expect(nav.visibleTabs).toEqual(expected);
        for (const tab of RESTAURANT_SETTINGS_TAB_ORDER) {
          const occurrences = nav.visibleTabs.filter((visible) => visible === tab);
          expect(occurrences.length).toBe(expected.includes(tab) ? 1 : 0);
        }

        // Canonical order is preserved (the visible set is a subsequence of the order).
        const canonicalIndexes = nav.visibleTabs.map((tab) =>
          RESTAURANT_SETTINGS_TAB_ORDER.indexOf(tab),
        );
        const sortedIndexes = [...canonicalIndexes].sort((a, b) => a - b);
        expect(canonicalIndexes).toEqual(sortedIndexes);

        // Selected tab is the requested visible tab, otherwise the first visible tab.
        const trimmedRequested = (requestedTab ?? "").trim() as RestaurantSettingsTab;
        const expectedSelected = expected.includes(trimmedRequested)
          ? trimmedRequested
          : expected[0];
        expect(nav.selectedTab).toBe(expectedSelected);

        // Selecting a visible tab maps to exactly one panel body.
        expect(nav.activePanel).toBe(nav.selectedTab);
        expect(nav.visibleTabs).toContain(nav.activePanel);
        expect(nav.visibleTabs.filter((tab) => tab === nav.activePanel)).toHaveLength(1);

        expect(nav.hasVisibleSettings).toBe(nav.visibleTabs.length > 0);
      }),
      { numRuns: 400 },
    );
  });

  it("fails closed to Profile with the unresolved message for unresolved access", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<null | undefined>(null, undefined),
        requestedTabArb,
        (access, requestedTab) => {
          const nav = deriveRestaurantSettingsNavigation({ access, requestedTab });

          expect(nav.accessResolved).toBe(false);
          expect(nav.message).toBe(MSG_FEATURE_ACCESS_UNRESOLVED);
          expect(nav.visibleTabs).toEqual(["Restaurant Profile"]);
          expect(nav.selectedTab).toBe("Restaurant Profile");
          expect(nav.activePanel).toBe("Restaurant Profile");
          expect(nav.hasVisibleSettings).toBe(true);
        },
      ),
      { numRuns: 400 },
    );
  });
});
