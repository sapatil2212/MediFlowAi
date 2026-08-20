import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOSURE_REASON,
  DEFAULT_DINING_AREA_NAME,
  DEFAULT_DISPLAY_ORDER,
  DEFAULT_MENU_ITEM_DESCRIPTION,
  DEFAULT_MENU_ITEM_STATE,
  LIMITS,
  MSG_AREA_NAME_LENGTH,
  MSG_MENU_ITEM_PRICE_RANGE,
  MSG_PROFILE_PHOTO,
  PROFILE_PHOTO_MIME_TYPES,
  SETTINGS_FIELD_ERRORS,
  fail,
  fieldError,
  normaliseEmail,
  normaliseLocationScope,
  normaliseNameKey,
  ok,
  trimmedString,
} from "./restaurant-settings-model";

describe("restaurant settings model constants", () => {
  it("exports the exact requirement bounds", () => {
    expect(LIMITS).toMatchObject({
      operatingHoursDays: 7,
      areaName: { min: 1, max: 30 },
      displayOrder: { min: 1, max: 999 },
      closureReason: { max: 100 },
      menuCategoryName: { min: 1, max: 40 },
      menuItemName: { min: 1, max: 80 },
      menuItemPriceMinor: { min: 0, max: 10_000_000 },
      menuItemDescription: { max: 300 },
      menuCategoriesPerTenant: 40,
      menuItemsPerTenant: 500,
      profilePhotoBytes: 5 * 1024 * 1024,
      verificationCodeDigits: 4,
      verificationCodeValidityMs: 300_000,
      verificationResendDelayMs: 60_000,
      passwordLength: { min: 8 },
    });
  });

  it("exports persistence defaults and permitted photo formats", () => {
    expect(DEFAULT_DINING_AREA_NAME).toBe("Main");
    expect(DEFAULT_DISPLAY_ORDER).toBe(1);
    expect(DEFAULT_CLOSURE_REASON).toBe("");
    expect(DEFAULT_MENU_ITEM_DESCRIPTION).toBe("");
    expect(DEFAULT_MENU_ITEM_STATE).toBe("available");
    expect(PROFILE_PHOTO_MIME_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("keeps stable field errors tied to their exported messages", () => {
    expect(SETTINGS_FIELD_ERRORS.areaName).toEqual({
      field: "name",
      message: MSG_AREA_NAME_LENGTH,
    });
    expect(SETTINGS_FIELD_ERRORS.menuItemPrice).toEqual({
      field: "priceMinor",
      message: MSG_MENU_ITEM_PRICE_RANGE,
    });
    expect(SETTINGS_FIELD_ERRORS.profilePhoto).toEqual({
      field: "photo",
      message: MSG_PROFILE_PHOTO,
    });
  });
});

describe("normalization helpers", () => {
  it("trims strings and maps non-strings to empty text", () => {
    expect(trimmedString("  Terrace  ")).toBe("Terrace");
    expect(trimmedString(null)).toBe("");
    expect(trimmedString(42)).toBe("");
  });

  it("normalizes email and name comparison keys without changing inner text", () => {
    expect(normaliseEmail("  Owner@Example.COM ")).toBe("owner@example.com");
    expect(normaliseNameKey("  Private Room ")).toBe("private room");
  });

  it("normalizes empty locations to primary scope and trims branch ids", () => {
    expect(normaliseLocationScope(undefined)).toBeNull();
    expect(normaliseLocationScope("   ")).toBeNull();
    expect(normaliseLocationScope(" branch-1 ")).toBe("branch-1");
  });
});

describe("typed result helpers", () => {
  it("creates successful results", () => {
    expect(ok({ id: "area-1" })).toEqual({ ok: true, value: { id: "area-1" } });
  });

  it("creates failed results with a defensive copy of every error", () => {
    const errors = [{ field: "name", message: "Required" }];
    const result = fail(errors);

    errors[0].message = "Changed";
    expect(result).toEqual({ ok: false, errors: [{ field: "name", message: "Required" }] });
  });

  it("creates field errors without sharing mutable state", () => {
    expect(fieldError("reason", "Too long")).toEqual({ field: "reason", message: "Too long" });
    expect(fieldError("reason", "Too long")).not.toBe(fieldError("reason", "Too long"));
  });
});

import * as settingsHelpers from "./restaurant-settings-model";

describe("strict closure and calendar helpers", () => {
  it("accepts only round-trippable YYYY-MM-DD calendar dates", () => {
    expect(settingsHelpers.isExistingCalendarDate("2024-02-29")).toBe(true);
    expect(settingsHelpers.isExistingCalendarDate("2023-02-29")).toBe(false);
    expect(settingsHelpers.isExistingCalendarDate("2024-04-31")).toBe(false);
    expect(settingsHelpers.isExistingCalendarDate("2024-2-09")).toBe(false);
    expect(settingsHelpers.isExistingCalendarDate("0000-01-01")).toBe(false);
  });

  it("reports every invalid closure field and leaves input unchanged", () => {
    const input = {
      date: "2023-02-29",
      scope: { type: "table", tableId: "   " },
      reason: `  ${"x".repeat(101)}  `,
      isHoliday: "yes",
    };
    const snapshot = structuredClone(input);
    const result = settingsHelpers.validateClosureDay(input);

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        { field: "date", message: settingsHelpers.MSG_CLOSURE_DATE },
        { field: "scope", message: settingsHelpers.MSG_CLOSURE_SCOPE },
        { field: "reason", message: settingsHelpers.MSG_CLOSURE_REASON_LENGTH },
        { field: "isHoliday", message: settingsHelpers.MSG_CLOSURE_HOLIDAY },
      ]),
    });
    expect(input).toEqual(snapshot);
  });

  it("normalizes a valid table closure into a fresh value", () => {
    const input = {
      date: "2024-12-25",
      scope: { type: "table", tableId: " table-1 " },
      reason: "  Public holiday  ",
      isHoliday: true,
    };
    expect(settingsHelpers.validateClosureDay(input)).toEqual({
      ok: true,
      value: {
        date: "2024-12-25",
        scope: { type: "table", tableId: "table-1" },
        reason: "Public holiday",
        isHoliday: true,
      },
    });
  });
});

describe("operating-hours helpers", () => {
  const sevenDays = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    openTime: "10:00",
    closeTime: "20:00",
    isClosed: dayOfWeek === 0,
  }));

  it("provides at least three complete named presets and applies them defensively", () => {
    expect(settingsHelpers.HOURS_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const preset of settingsHelpers.HOURS_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.days.map((day) => day.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }

    const storedSnapshot = structuredClone(sevenDays);
    const applied = settingsHelpers.applyHoursPreset(sevenDays, settingsHelpers.HOURS_PRESETS[0]);
    applied[0].openTime = "00:01";
    expect(sevenDays).toEqual(storedSnapshot);
    expect(settingsHelpers.HOURS_PRESETS[0].days[0].openTime).toBe("09:00");
  });

  it("applies valid times only to open days and preserves every closed flag", () => {
    const snapshot = structuredClone(sevenDays);
    const applied = settingsHelpers.applyHoursToOpenDays(sevenDays, "11:15", "23:45");

    expect(applied[0]).toEqual(sevenDays[0]);
    expect(
      applied.slice(1).every((day) => day.openTime === "11:15" && day.closeTime === "23:45"),
    ).toBe(true);
    expect(applied.map((day) => day.isClosed)).toEqual(sevenDays.map((day) => day.isClosed));
    expect(sevenDays).toEqual(snapshot);
  });

  it("returns all pair errors and makes an invalid apply a defensive no-op", () => {
    expect(settingsHelpers.validateHoursPair("9:00", "24:00")).toEqual({
      ok: false,
      errors: [
        { field: "openTime", message: settingsHelpers.MSG_OPERATING_HOURS_TIME },
        { field: "closeTime", message: settingsHelpers.MSG_OPERATING_HOURS_TIME },
      ],
    });
    const unchanged = settingsHelpers.applyHoursToOpenDays(sevenDays, "20:00", "10:00");
    expect(unchanged).toEqual(sevenDays);
    expect(unchanged).not.toBe(sevenDays);
    expect(unchanged[0]).not.toBe(sevenDays[0]);
  });

  it("accepts one valid row for every weekday and returns canonical order", () => {
    const shuffled = [
      sevenDays[4],
      sevenDays[1],
      sevenDays[6],
      sevenDays[0],
      sevenDays[3],
      sevenDays[2],
      sevenDays[5],
    ];
    const result = settingsHelpers.validateRestaurantOperatingHours(shuffled);
    expect(result).toEqual({ ok: true, value: sevenDays });
    expect(shuffled.map((day) => day.dayOfWeek)).toEqual([4, 1, 6, 0, 3, 2, 5]);
  });

  it("reports missing, duplicate, and every malformed open weekday together", () => {
    const invalid = [
      { ...sevenDays[0], dayOfWeek: 0 },
      { ...sevenDays[1], dayOfWeek: 1, openTime: "09:00", closeTime: "09:00" },
      { ...sevenDays[2], dayOfWeek: 1 },
      { ...sevenDays[3], dayOfWeek: 3, openTime: "xx", closeTime: "18:00" },
      sevenDays[4],
      sevenDays[5],
      sevenDays[6],
    ];
    const result = settingsHelpers.validateRestaurantOperatingHours(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.field)).toEqual(
        expect.arrayContaining(["hours.1", "hours.2", "hours.3"]),
      );
    }
  });
});

describe("profile and profile-photo helpers", () => {
  it("trims every profile field without changing the submission", () => {
    const input = Object.fromEntries(
      [
        "restaurantName",
        "ownerOrManagerName",
        "accountPhone",
        "teamSize",
        "publicEmail",
        "contactNumber",
        "whatsappNumber",
        "landline",
        "address",
        "cuisineOrServices",
        "description",
      ].map((field) => [field, `  ${field}  `]),
    );
    const snapshot = structuredClone(input);
    const profile = settingsHelpers.normaliseRestaurantProfile(input);

    expect(
      Object.values(profile).every((value) => !value.startsWith(" ") && !value.endsWith(" ")),
    ).toBe(true);
    expect(input).toEqual(snapshot);
  });

  it("accepts exact photo MIME types through exactly 5 MiB", () => {
    for (const mimeType of settingsHelpers.PROFILE_PHOTO_MIME_TYPES) {
      expect(
        settingsHelpers.validateProfilePhoto({
          mimeType,
          byteLength: settingsHelpers.LIMITS.profilePhotoBytes,
        }).ok,
      ).toBe(true);
    }
    expect(settingsHelpers.validateProfilePhoto({ mimeType: "image/jpg", byteLength: 1 }).ok).toBe(
      false,
    );
    expect(settingsHelpers.validateProfilePhoto({ mimeType: "IMAGE/PNG", byteLength: 1 }).ok).toBe(
      false,
    );
    expect(
      settingsHelpers.validateProfilePhoto({
        mimeType: "image/png",
        byteLength: settingsHelpers.LIMITS.profilePhotoBytes + 1,
      }).ok,
    ).toBe(false);
    expect(
      settingsHelpers.validateProfilePhoto({ mimeType: "image/png", byteLength: 1.5 }).ok,
    ).toBe(false);
  });

  it("parses a base64 image data URL into detected MIME and exact byte length", () => {
    // "hello" -> 5 bytes, base64 "aGVsbG8=" (8 chars, 1 pad).
    const decoded = settingsHelpers.parseImageDataUrl("data:image/png;base64,aGVsbG8=");
    expect(decoded).toEqual({ mimeType: "image/png", byteLength: 5, base64: "aGVsbG8=" });

    // MIME is lower-cased so it matches the permitted set.
    expect(settingsHelpers.parseImageDataUrl("data:IMAGE/JPEG;base64,QUJDRA==")?.mimeType).toBe(
      "image/jpeg",
    );

    // A four-byte payload has no padding.
    expect(settingsHelpers.parseImageDataUrl("data:image/webp;base64,QUJDRA==")?.byteLength).toBe(
      4,
    );
  });

  it("rejects values that are not a non-empty base64 image data URL", () => {
    expect(settingsHelpers.parseImageDataUrl(undefined)).toBeNull();
    expect(settingsHelpers.parseImageDataUrl(123)).toBeNull();
    expect(settingsHelpers.parseImageDataUrl("")).toBeNull();
    expect(settingsHelpers.parseImageDataUrl("https://cdn/photo.png")).toBeNull();
    expect(settingsHelpers.parseImageDataUrl("data:image/png;base64,")).toBeNull();
    // Non-multiple-of-four base64 length is malformed.
    expect(settingsHelpers.parseImageDataUrl("data:image/png;base64,aGVsbG")).toBeNull();
  });
});

describe("account verification and password helpers", () => {
  const issuedAtMs = 1_000_000;
  const timing = settingsHelpers.createVerificationTiming(issuedAtMs);
  const verification: settingsHelpers.EmailVerification = {
    accountType: "user",
    accountId: "account-1",
    targetEmail: "new@example.com",
    codeHash: "hash",
    ...timing,
    consumedAtMs: null,
  };

  it("enforces exact four-digit code shape and exact timing boundaries", () => {
    expect(settingsHelpers.validateVerificationCode("0007").ok).toBe(true);
    expect(settingsHelpers.validateVerificationCode("123").ok).toBe(false);
    expect(settingsHelpers.validateVerificationCode("12345").ok).toBe(false);
    expect(settingsHelpers.validateVerificationCode("12a4").ok).toBe(false);
    expect(timing.expiresAtMs - timing.issuedAtMs).toBe(300_000);
    expect(timing.resendAvailableAtMs - timing.issuedAtMs).toBe(60_000);
    expect(settingsHelpers.isEmailVerificationUnexpired(verification, timing.expiresAtMs - 1)).toBe(
      true,
    );
    expect(settingsHelpers.isEmailVerificationUnexpired(verification, timing.expiresAtMs)).toBe(
      false,
    );
    expect(
      settingsHelpers.canResendEmailVerification(verification, timing.resendAvailableAtMs - 1),
    ).toBe(false);
    expect(
      settingsHelpers.canResendEmailVerification(verification, timing.resendAvailableAtMs),
    ).toBe(true);
  });

  it("binds verification to exact account and normalized target email", () => {
    const validInput = {
      accountType: "user" as const,
      accountId: "account-1",
      targetEmail: " NEW@EXAMPLE.COM ",
      code: "0042",
    };
    expect(
      settingsHelpers.validateEmailVerificationAttempt(verification, validInput, issuedAtMs, true),
    ).toEqual({
      ok: true,
      value: { ...validInput, targetEmail: "new@example.com" },
    });
    expect(
      settingsHelpers.validateEmailVerificationAttempt(
        verification,
        { ...validInput, accountId: "account-2" },
        issuedAtMs,
        true,
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "code", message: settingsHelpers.MSG_VERIFICATION_INVALID_OR_EXPIRED }],
    });
    expect(
      settingsHelpers.validateEmailVerificationAttempt(verification, validInput, issuedAtMs, false)
        .ok,
    ).toBe(false);
  });

  it("reports password minimum and confirmation errors together without trimming secrets", () => {
    expect(
      settingsHelpers.validatePasswordChangeInput({
        currentPassword: " current ",
        newPassword: "short",
        confirmation: "different",
      }),
    ).toEqual({
      ok: false,
      errors: [
        { field: "newPassword", message: settingsHelpers.MSG_PASSWORD_MIN_LENGTH },
        { field: "confirmation", message: settingsHelpers.MSG_PASSWORDS_DO_NOT_MATCH },
      ],
    });
    expect(
      settingsHelpers.validatePasswordChangeInput({
        currentPassword: " current ",
        newPassword: " password ",
        confirmation: " password ",
      }),
    ).toEqual({
      ok: true,
      value: {
        currentPassword: " current ",
        newPassword: " password ",
        confirmation: " password ",
      },
    });
  });
});
describe("dining-area invariants", () => {
  it("normalizes valid areas, defaults order, and enforces tenant-wide uniqueness", () => {
    const context: settingsHelpers.AreaContext = {
      existingNames: [{ id: "area-1", name: "Terrace" }],
      highestDisplayOrder: 4,
    };
    const input = { name: "  Private Room  " };
    const snapshot = structuredClone(input);

    expect(settingsHelpers.validateDiningArea(input, context)).toEqual({
      ok: true,
      value: { name: "Private Room", displayOrder: 5 },
    });
    expect(settingsHelpers.validateDiningArea({ name: " terrace " }, context)).toEqual({
      ok: false,
      errors: [{ field: "name", message: settingsHelpers.MSG_AREA_ALREADY_EXISTS }],
    });
    expect(input).toEqual(snapshot);
  });

  it("orders deterministically, derives scoped counts, and returns synthetic Main", () => {
    const areas: settingsHelpers.DiningArea[] = [
      { id: "z", name: "terrace", displayOrder: 1, tableCount: 99, locationId: null },
      { id: "a", name: "Terrace", displayOrder: 1, tableCount: 99, locationId: null },
      { id: "b", name: "Patio", displayOrder: 1, tableCount: 99, locationId: null },
    ];
    const tables: settingsHelpers.DiningTableAreaAssignment[] = [
      { id: "t1", areaId: "a", area: "old", locationId: null },
      { id: "t2", areaId: null, area: " TERRACE ", locationId: null },
      { id: "t3", areaId: "a", area: "Terrace", locationId: "branch" },
    ];
    const snapshot = structuredClone({ areas, tables });

    expect(settingsHelpers.withAssignedDiningTableCounts(areas, tables)).toEqual([
      { ...areas[2], tableCount: 0 },
      { ...areas[1], tableCount: 2 },
      { ...areas[0], tableCount: 1 },
    ]);
    expect(
      settingsHelpers.effectiveDiningAreas(
        [],
        [
          { id: "m1", areaId: null, area: "Main", locationId: "branch" },
          { id: "m2", areaId: null, area: "", locationId: "branch" },
        ],
        "branch",
      ),
    ).toEqual([
      {
        id: settingsHelpers.EFFECTIVE_MAIN_AREA_ID,
        name: "Main",
        displayOrder: 1,
        tableCount: 2,
        locationId: "branch",
      },
    ]);
    expect({ areas, tables }).toEqual(snapshot);
  });
});

describe("menu invariants", () => {
  const context: settingsHelpers.MenuContext = {
    existingCategoryNames: [{ id: "cat-1", name: "Starters" }],
    categoryCount: 1,
    itemCount: 3,
    highestCategoryDisplayOrder: 3,
    highestItemDisplayOrder: 7,
    validCategoryIds: ["cat-1", "cat-2"],
  };

  it("validates category uniqueness/defaults and hard category caps", () => {
    expect(settingsHelpers.validateMenuCategory({ name: "  Desserts  " }, context)).toEqual({
      ok: true,
      value: { name: "Desserts", displayOrder: 4 },
    });
    expect(
      settingsHelpers.validateMenuCategory(
        { name: " starters " },
        { ...context, categoryCount: settingsHelpers.LIMITS.menuCategoriesPerTenant },
      ),
    ).toEqual({
      ok: false,
      errors: [
        { field: "name", message: settingsHelpers.MSG_MENU_CATEGORY_ALREADY_EXISTS },
        { field: "categoryCount", message: settingsHelpers.MSG_MAX_MENU_CATEGORIES },
      ],
    });
  });

  it("normalizes item defaults and reports every invalid field plus the tenant cap", () => {
    const valid = {
      categoryId: " cat-2 ",
      name: "  Soup  ",
      priceMinor: 1250,
      description: "  Seasonal  ",
    };
    const snapshot = structuredClone(valid);
    expect(settingsHelpers.validateMenuItem(valid, context)).toEqual({
      ok: true,
      value: {
        categoryId: "cat-2",
        name: "Soup",
        priceMinor: 1250,
        description: "Seasonal",
        displayOrder: 8,
        state: "available",
      },
    });
    expect(valid).toEqual(snapshot);

    const invalid = settingsHelpers.validateMenuItem(
      {
        categoryId: "foreign",
        name: " ",
        priceMinor: settingsHelpers.LIMITS.menuItemPriceMinor.max + 1,
        description: "x".repeat(settingsHelpers.LIMITS.menuItemDescription.max + 1),
        displayOrder: 0,
        state: "hidden",
      },
      { ...context, itemCount: settingsHelpers.LIMITS.menuItemsPerTenant },
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.map((error) => error.field)).toEqual([
        "categoryId",
        "name",
        "priceMinor",
        "description",
        "displayOrder",
        "state",
        "itemCount",
      ]);
    }
  });

  it("canonically orders without mutation and projects available items only", () => {
    const item = (
      id: string,
      categoryId: string,
      name: string,
      displayOrder: number,
      state: settingsHelpers.MenuItemState,
    ): settingsHelpers.MenuItem => ({
      id,
      categoryId,
      name,
      priceMinor: 100,
      description: `${name} description`,
      displayOrder,
      state,
      locationId: null,
    });
    const menu: settingsHelpers.MenuCategory[] = [
      {
        id: "z",
        name: "mains",
        displayOrder: 1,
        locationId: null,
        items: [item("z", "z", "Soup", 1, "unavailable"), item("a", "z", "soup", 1, "available")],
      },
      {
        id: "a",
        name: "Mains",
        displayOrder: 1,
        locationId: null,
        items: [item("b", "a", "Bread", 2, "available")],
      },
      {
        id: "empty",
        name: "Drinks",
        displayOrder: 2,
        locationId: null,
        items: [item("tea", "empty", "Tea", 1, "unavailable")],
      },
    ];
    const snapshot = structuredClone(menu);

    expect(settingsHelpers.orderMenu(menu).map((category) => category.id)).toEqual([
      "a",
      "z",
      "empty",
    ]);
    const projected = settingsHelpers.publicMenu(menu);
    expect(projected.map((category) => category.id)).toEqual(["a", "z"]);
    expect(projected.flatMap((category) => category.items).map((entry) => entry.id)).toEqual([
      "b",
      "a",
    ]);
    expect(
      projected.flatMap((category) => category.items).every((entry) => entry.state === "available"),
    ).toBe(true);
    expect(menu).toEqual(snapshot);
  });

  it("returns a non-destructive cascade preview with the exact item count", () => {
    const items = [
      { categoryId: "cat-1" },
      { categoryId: "cat-2" },
      { categoryId: "cat-1" },
    ] as settingsHelpers.MenuItem[];
    expect(settingsHelpers.previewMenuCategoryDeletion("cat-1", items)).toEqual({
      categoryId: "cat-1",
      itemCount: 2,
      confirmationRequired: true,
    });
    expect(settingsHelpers.previewMenuCategoryDeletion("missing", items)).toEqual({
      categoryId: "missing",
      itemCount: 0,
      confirmationRequired: false,
    });
  });
});

describe("restaurant settings navigation and capabilities", () => {
  const permission = (
    value: settingsHelpers.Permission,
    visible = value !== "none",
  ): settingsHelpers.FeaturePermission => ({
    available: visible,
    permission: value,
    visible,
  });

  it("derives the canonical nine-tab order and exact requested-panel mapping", () => {
    const access: settingsHelpers.RestaurantSettingsPermissions = {
      restaurant_config: permission("operate"),
      whatsapp: permission("view_only"),
      locations: permission("operate"),
      users: permission("view_only"),
    };
    const navigation = settingsHelpers.deriveRestaurantSettingsNavigation({
      access,
      requestedTab: "Menu",
    });

    expect(navigation.visibleTabs).toEqual(settingsHelpers.RESTAURANT_SETTINGS_TAB_ORDER);
    expect(new Set(navigation.visibleTabs).size).toBe(9);
    expect(navigation.visibleTabs[0]).toBe("Restaurant Profile");
    expect(navigation.selectedTab).toBe("Menu");
    expect(navigation.activePanel).toBe("Menu");
  });

  it("keeps Profile first, gates other tabs, and falls back to Profile", () => {
    const navigation = settingsHelpers.deriveRestaurantSettingsNavigation({
      access: {
        restaurant_config: permission("none", false),
        whatsapp: permission("none", false),
        locations: permission("view_only"),
        users: permission("none", false),
      },
      requestedTab: "Tables",
    });

    expect(navigation.visibleTabs).toEqual(["Restaurant Profile", "Multi Location"]);
    expect(navigation.selectedTab).toBe("Restaurant Profile");
    expect(navigation.activePanel).toBe("Restaurant Profile");
  });

  it("fails unresolved access closed to Profile with the stable message", () => {
    expect(
      settingsHelpers.deriveRestaurantSettingsNavigation({
        access: null,
        requestedTab: "Manage Users",
      }),
    ).toEqual({
      accessResolved: false,
      message: settingsHelpers.MSG_FEATURE_ACCESS_UNRESOLVED,
      visibleTabs: ["Restaurant Profile"],
      selectedTab: "Restaurant Profile",
      activePanel: "Restaurant Profile",
      hasVisibleSettings: true,
    });
  });

  it("keeps self-service security independent from profile mutation permission", () => {
    for (const permission of ["operate", "view_only", "none"] as const) {
      const model = settingsHelpers.deriveProfileCapabilityViewModel(permission);
      expect(model.showProfile).toBe(true);
      expect(model.showAccountSecurity).toBe(true);
      expect(model.canChangeOwnEmail).toBe(true);
      expect(model.canChangeOwnPassword).toBe(true);
      expect(model.canEditProfile).toBe(permission === "operate");
      expect(model.canUploadProfilePhoto).toBe(permission === "operate");
      expect(model.profileReadOnly).toBe(permission !== "operate");
    }
  });

  it("derives read-only and mutation controls from resolved feature access", () => {
    expect(
      settingsHelpers.deriveFeatureCapabilityViewModel("users", permission("view_only")),
    ).toMatchObject({
      visible: true,
      readOnly: true,
      canWrite: false,
      showMutationControls: false,
    });
    expect(
      settingsHelpers.deriveFeatureCapabilityViewModel("users", permission("operate")),
    ).toMatchObject({ visible: true, readOnly: false, canWrite: true, showMutationControls: true });
    expect(
      settingsHelpers.deriveFeatureCapabilityViewModel("users", permission("none", false)),
    ).toMatchObject({
      visible: false,
      readOnly: false,
      canWrite: false,
      showMutationControls: false,
    });
  });
});

describe("restaurant resource scope and feature-write decisions", () => {
  const branches: settingsHelpers.RestaurantScopeBranch[] = [
    { id: "branch-a", tenantId: "tenant-a", isActive: true },
    { id: "branch-inactive", tenantId: "tenant-a", isActive: false },
    { id: "branch-foreign", tenantId: "tenant-b", isActive: true },
  ];

  it("derives owner primary and tenant-validated active or inactive branch scopes", () => {
    expect(
      settingsHelpers.resolveRestaurantResourceScope({
        tenantId: "tenant-a",
        role: "admin",
        branches,
      }),
    ).toEqual({ ok: true, value: { tenantId: "tenant-a", locationId: null } });
    expect(
      settingsHelpers.resolveRestaurantResourceScope({
        tenantId: "tenant-a",
        role: "admin",
        requestedLocationId: " branch-inactive ",
        branches,
      }),
    ).toEqual({
      ok: true,
      value: { tenantId: "tenant-a", locationId: "branch-inactive" },
    });
    expect(
      settingsHelpers.resolveRestaurantResourceScope({
        tenantId: "tenant-a",
        role: "admin",
        requestedLocationId: "branch-foreign",
        branches,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "locationId", message: settingsHelpers.MSG_BRANCH_NOT_FOUND }],
    });
  });

  it("forces branch sessions to their server identity and rejects spoofed scope", () => {
    expect(
      settingsHelpers.resolveRestaurantResourceScope({
        tenantId: "tenant-a",
        role: "location",
        sessionLocationId: "branch-a",
      }),
    ).toEqual({ ok: true, value: { tenantId: "tenant-a", locationId: "branch-a" } });
    expect(
      settingsHelpers.resolveRestaurantResourceScope({
        tenantId: "tenant-a",
        role: "location",
        sessionLocationId: "branch-a",
        requestedLocationId: "branch-b",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "locationId", message: settingsHelpers.MSG_BRANCH_SCOPE_OVERRIDE }],
    });
  });

  it("uses primary scope for staff and prevents staff branch selection", () => {
    expect(
      settingsHelpers.resolveRestaurantResourceScope({ tenantId: "tenant-a", role: "reception" }),
    ).toEqual({ ok: true, value: { tenantId: "tenant-a", locationId: null } });
    expect(
      settingsHelpers.resolveRestaurantResourceScope({
        tenantId: "tenant-a",
        role: "doctor",
        requestedLocationId: "branch-a",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "locationId", message: settingsHelpers.MSG_BRANCH_SELECTION_NOT_ALLOWED }],
    });
  });

  it("allows feature writes only for operate and returns feature-specific refusals", () => {
    const features: settingsHelpers.SettingsFeature[] = [
      "restaurant_config",
      "users",
      "locations",
      "whatsapp",
    ];
    for (const feature of features) {
      expect(settingsHelpers.featureWriteGuardDecision(feature, "operate")).toEqual({
        feature,
        allowed: true,
        error: null,
      });
      expect(settingsHelpers.featureWriteGuardDecision(feature, "view_only").allowed).toBe(false);
      expect(settingsHelpers.authoriseSettingsFeatureWrite(feature, "none").ok).toBe(false);
    }
    expect(settingsHelpers.featureWriteGuardDecision("users", "none").error).toEqual({
      field: "users",
      message: settingsHelpers.MSG_NOT_AUTHORISED_USERS,
    });
  });
});

describe("shared SubUser plan limits", () => {
  it("normalizes canonical and legacy plan names to one limits table", () => {
    const aliases: Array<[string | null, settingsHelpers.UserPlanTier]> = [
      ["Basic", "Basic"],
      ["Trial", "Basic"],
      ["Solo Plan", "Basic"],
      [null, "Basic"],
      ["Premium", "Premium"],
      ["Clinic Plan", "Premium"],
      ["Pro", "Premium"],
      ["₹1,499/month", "Premium"],
      ["Enterprise", "Enterprise"],
      ["Hospital", "Enterprise"],
      ["Custom Business", "Enterprise"],
    ];

    for (const [raw, expected] of aliases) {
      expect(settingsHelpers.normaliseSubUserPlanTier(raw)).toBe(expected);
      expect(settingsHelpers.resolveSubUserPlanLimits(raw).plan).toBe(expected);
    }
  });

  it("derives messages and role capacities from the same exact maxima", () => {
    const basic = settingsHelpers.resolveSubUserPlanLimits("Solo", {
      doctor: 1,
      reception: 0,
    });
    expect(basic).toMatchObject({
      plan: "Basic",
      doctor: { maximum: 1, current: 1, remaining: 0, canCreate: false },
      reception: { maximum: 0, current: 0, remaining: 0, canCreate: false },
    });
    expect(basic.message).toContain("1 doctor account");
    expect(basic.message).toContain("0 reception accounts");

    const premium = settingsHelpers.resolveSubUserPlanLimits("Clinic", {
      doctor: 4,
      reception: 50,
    });
    expect(premium.doctor).toMatchObject({ maximum: 5, remaining: 1, canCreate: true });
    expect(premium.reception).toMatchObject({ maximum: null, remaining: null, canCreate: true });
    expect(premium.message).toContain("unlimited reception accounts");
  });

  it("accounts for same-role edits by removing the old role before adding it", () => {
    const decision = settingsHelpers.decideSubUserRoleChange({
      plan: "Basic",
      counts: { doctor: 1, reception: 0 },
      previousRole: "doctor",
      requestedRole: "doctor",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.countsAfterRemoval).toEqual({ doctor: 0, reception: 0 });
    expect(decision.projectedCounts).toEqual({ doctor: 1, reception: 0 });
    expect(decision.countsAfterDecision).toEqual(decision.countsBefore);
  });

  it("removes the old role before cross-role checks and preserves counts on refusal", () => {
    const allowed = settingsHelpers.decideSubUserRoleChange({
      plan: "Premium",
      counts: { doctor: 5, reception: 1 },
      previousRole: "reception",
      requestedRole: "doctor",
    });
    expect(allowed.allowed).toBe(false);
    expect(allowed.countsAfterRemoval).toEqual({ doctor: 5, reception: 0 });
    expect(allowed.projectedCounts).toEqual({ doctor: 6, reception: 0 });
    expect(allowed.countsAfterDecision).toEqual({ doctor: 5, reception: 1 });
    expect(allowed.message).toContain("at most 5 doctor accounts");

    const moved = settingsHelpers.decideSubUserRoleChange({
      plan: "Premium",
      counts: { doctor: 5, reception: 0 },
      previousRole: "doctor",
      requestedRole: "reception",
    });
    expect(moved.allowed).toBe(true);
    expect(moved.countsAfterDecision).toEqual({ doctor: 4, reception: 1 });
  });

  it("rejects invalid roles and Basic reception creates without changing counts", () => {
    const invalid = settingsHelpers.decideSubUserRoleChange({
      plan: "Enterprise",
      counts: { doctor: 2, reception: 3 },
      requestedRole: "manager",
    });
    expect(invalid.allowed).toBe(false);
    expect(invalid.message).toBe(settingsHelpers.MSG_SUB_USER_ROLE);
    expect(invalid.countsAfterDecision).toEqual({ doctor: 2, reception: 3 });

    const basicReception = settingsHelpers.decideSubUserRoleChange({
      plan: "Trial",
      counts: { doctor: 0, reception: 0 },
      requestedRole: "reception",
    });
    expect(basicReception.allowed).toBe(false);
    expect(basicReception.countsAfterDecision).toEqual({ doctor: 0, reception: 0 });
    expect(basicReception.message).toContain("permits no reception accounts");
  });
});
