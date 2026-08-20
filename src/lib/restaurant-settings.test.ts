import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";

import { resolveFeatureAccess, type AccountContext, type ResolvedAccess } from "./feature-access";
import {
  MSG_BRANCH_NOT_FOUND,
  MSG_BRANCH_SCOPE_OVERRIDE,
  MSG_BRANCH_SELECTION_NOT_ALLOWED,
  MSG_CURRENT_PASSWORD_INCORRECT,
  MSG_EMAIL_ALREADY_CURRENT,
  MSG_EMAIL_ALREADY_IN_USE,
  MSG_FEATURE_ACCESS_UNRESOLVED,
  MSG_NOT_AUTHORISED_CONFIG,
  MSG_NOT_AUTHORISED_LOCATIONS,
  MSG_NOT_AUTHORISED_USERS,
  MSG_NOT_AUTHORISED_WHATSAPP,
  MSG_PASSWORD_MIN_LENGTH,
  MSG_PASSWORDS_DO_NOT_MATCH,
  MSG_PROFILE_PHOTO,
  MSG_SETTINGS_RESOURCE_NOT_FOUND,
  MSG_VERIFICATION_INVALID_OR_EXPIRED,
  type RestaurantProfile,
} from "./restaurant-settings-model";
import {
  MSG_EMAIL_VERIFICATION_NONE_PENDING,
  MSG_EMAIL_VERIFICATION_RESEND_TOO_SOON,
  MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
  assertRestaurantSettingsFeatureOperate,
  assertRestaurantSettingsFeatureVisible,
  canonicalBookingPath,
  createRestaurantAccountEmailService,
  createRestaurantAccountPasswordService,
  createRestaurantProfilePhotoService,
  createRestaurantProfileService,
  createRestaurantSettingsBootstrap,
  createRestaurantSettingsBoundary,
  createRestaurantSettingsFeatureGuards,
  requireRestaurantSettingsRecord,
  requireRestaurantSettingsResult,
  type AuthenticatedRestaurantSettingsContext,
  type RestaurantAccountEmailServiceDependencies,
  type RestaurantAccountPasswordServiceDependencies,
  type RestaurantSettingsBoundaryDependencies,
  type RestaurantSettingsScopeBranch,
  type RestaurantSettingsSession,
} from "./restaurant-settings";
import type {
  AccountEmailChangeResult,
  AccountSecuritySnapshot,
  StoredBranch,
  StoredEmailVerification,
  StoredRestaurantProfile,
} from "./restaurant-settings.server";

const NOW = new Date("2026-04-01T00:00:00.000Z");

function session(overrides: Partial<RestaurantSettingsSession> = {}): RestaurantSettingsSession {
  return {
    id: "owner-a",
    tenantId: "tenant-a",
    role: "admin",
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function branch(
  overrides: Partial<RestaurantSettingsScopeBranch> = {},
): RestaurantSettingsScopeBranch {
  return { id: "branch-a", tenantId: "tenant-a", isActive: true, ...overrides };
}

function boundaryFor(
  currentSession: RestaurantSettingsSession | null,
  foundBranch: RestaurantSettingsScopeBranch | null = null,
) {
  const calls: string[] = [];
  const verify = vi.fn(async () => {
    calls.push("session");
    return currentSession;
  });
  const resolveAccess = vi.fn((context: AccountContext) => {
    calls.push("access");
    return resolveFeatureAccess(context);
  });
  const findBranch = vi.fn(async (_tenantId: string, _branchId: string) => {
    calls.push("branch");
    return foundBranch;
  });
  const dependencies: RestaurantSettingsBoundaryDependencies = {
    verifySession: verify,
    resolveFeatureAccess: resolveAccess,
    findBranchById: findBranch,
    now: () => NOW,
  };
  return {
    boundary: createRestaurantSettingsBoundary(dependencies),
    verify,
    resolveAccess,
    findBranch,
    calls,
  };
}

describe("authenticated restaurant settings boundary", () => {
  it("rejects missing and explicitly inactive sessions before access or row resolution", async () => {
    for (const currentSession of [null, session({ isActive: false })]) {
      const test = boundaryFor(currentSession);
      await expect(test.boundary.resolve()).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
      expect(test.verify).toHaveBeenCalledOnce();
      expect(test.resolveAccess).not.toHaveBeenCalled();
      expect(test.findBranch).not.toHaveBeenCalled();
    }
  });

  it("resolves inherited parent-plan access before returning owner primary scope", async () => {
    const test = boundaryFor(session({ subscriptionPlan: "Basic" }));
    const result = await test.boundary.resolve();

    expect(result.scope).toEqual({ tenantId: "tenant-a", locationId: null });
    expect(result.access.restaurant_config.permission).toBe("operate");
    expect(result.access.whatsapp).toMatchObject({ available: false, permission: "none" });
    expect(result.featureContext).toMatchObject({
      role: "admin",
      profession: "Restaurant and dining",
      subscriptionPlan: "Basic",
      now: NOW,
    });
    expect(test.calls).toEqual(["session", "access"]);
  });

  it("accepts an owner-selected active or inactive branch only after tenant validation", async () => {
    for (const isActive of [true, false]) {
      const test = boundaryFor(session(), branch({ isActive }));
      const result = await test.boundary.resolve({ requestedLocationId: " branch-a " });

      expect(result.scope).toEqual({ tenantId: "tenant-a", locationId: "branch-a" });
      expect(test.findBranch).toHaveBeenCalledWith("tenant-a", "branch-a");
      expect(test.calls).toEqual(["session", "access", "branch"]);
    }
  });

  it("maps a missing or foreign owner-selected branch to not found", async () => {
    for (const found of [null, branch({ tenantId: "tenant-b" })]) {
      const test = boundaryFor(session(), found);
      await expect(test.boundary.resolve({ requestedLocationId: "branch-a" })).rejects.toThrow(
        MSG_BRANCH_NOT_FOUND,
      );
      expect(test.findBranch).toHaveBeenCalledWith("tenant-a", "branch-a");
    }
  });

  it("forces a verified active branch account to its server-issued branch scope", async () => {
    const test = boundaryFor(
      session({ id: "branch-a", role: "location", locationId: "branch-a" }),
      branch(),
    );
    const result = await test.boundary.resolve({ requestedLocationId: "branch-a" });

    expect(result.scope).toEqual({ tenantId: "tenant-a", locationId: "branch-a" });
    expect(result.access.restaurant_config.permission).toBe("operate");
    expect(test.findBranch).toHaveBeenCalledWith("tenant-a", "branch-a");
    expect(test.calls).toEqual(["session", "access", "branch"]);
  });

  it("rejects branch scope overrides before branch or settings row access", async () => {
    const test = boundaryFor(
      session({ id: "branch-a", role: "location", locationId: "branch-a" }),
      branch(),
    );
    await expect(test.boundary.resolve({ requestedLocationId: "branch-b" })).rejects.toThrow(
      MSG_BRANCH_SCOPE_OVERRIDE,
    );
    expect(test.findBranch).not.toHaveBeenCalled();
    expect(test.calls).toEqual(["session", "access"]);
  });

  it("rejects spoofed and inactive branch identities before scoped row access", async () => {
    const spoofed = boundaryFor(
      session({ id: "branch-b", role: "location", locationId: "branch-a" }),
      branch(),
    );
    await expect(spoofed.boundary.resolve()).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
    expect(spoofed.findBranch).not.toHaveBeenCalled();

    const inactive = boundaryFor(
      session({ id: "branch-a", role: "location", locationId: "branch-a" }),
      branch({ isActive: false }),
    );
    await expect(inactive.boundary.resolve()).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
    expect(inactive.findBranch).toHaveBeenCalledOnce();
  });

  it("keeps staff at primary scope and refuses owner-only branch selection without a lookup", async () => {
    const reception = boundaryFor(session({ id: "staff-a", role: "reception" }));
    await expect(reception.boundary.resolve()).resolves.toMatchObject({
      scope: { tenantId: "tenant-a", locationId: null },
    });

    await expect(reception.boundary.resolve({ requestedLocationId: "branch-a" })).rejects.toThrow(
      MSG_BRANCH_SELECTION_NOT_ALLOWED,
    );
    expect(reception.findBranch).not.toHaveBeenCalled();
  });
});

describe("scoped settings identifier mapping", () => {
  it("returns constrained records and successful repository results unchanged", () => {
    const record = { id: "area-a" };
    const result = { status: "deleted", id: "area-a" };
    expect(requireRestaurantSettingsRecord(record)).toBe(record);
    expect(requireRestaurantSettingsResult(result)).toBe(result);
  });

  it("maps every constrained identifier miss to the stable not-found message", () => {
    expect(() => requireRestaurantSettingsRecord(null)).toThrow(MSG_SETTINGS_RESOURCE_NOT_FOUND);
    expect(() => requireRestaurantSettingsRecord(undefined)).toThrow(
      MSG_SETTINGS_RESOURCE_NOT_FOUND,
    );
    for (const status of ["not_found", "area_not_found", "table_not_found"]) {
      expect(() => requireRestaurantSettingsResult({ status })).toThrow(
        MSG_SETTINGS_RESOURCE_NOT_FOUND,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Guarded feature wrappers and Settings bootstrap
// ---------------------------------------------------------------------------

function accessFor(overrides: Partial<AccountContext> = {}): ResolvedAccess {
  return resolveFeatureAccess({
    role: "admin",
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    isActive: true,
    now: NOW,
    ...overrides,
  });
}

function contextFor(
  overrides: Omit<Partial<AuthenticatedRestaurantSettingsContext>, "access"> & {
    accountContext?: Partial<AccountContext>;
    access?: ResolvedAccess | null;
  } = {},
): AuthenticatedRestaurantSettingsContext {
  const role = overrides.role ?? "admin";
  const accountContext: AccountContext = {
    role,
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    isActive: true,
    now: NOW,
    ...overrides.accountContext,
  };
  const access =
    overrides.access === null ? null : (overrides.access ?? resolveFeatureAccess(accountContext));
  return {
    session: session({
      id: overrides.accountId ?? "owner-a",
      role,
      subscriptionPlan: accountContext.subscriptionPlan,
    }),
    accountId: overrides.accountId ?? "owner-a",
    tenantId: overrides.tenantId ?? "tenant-a",
    role,
    featureContext: accountContext,
    // Cast to keep the unresolved-access defensive path testable.
    access: access as ResolvedAccess,
    scope: overrides.scope ?? { tenantId: overrides.tenantId ?? "tenant-a", locationId: null },
  };
}

describe("guarded feature read/write wrappers", () => {
  it("permits reads only when the feature is visible", () => {
    const owner = contextFor();
    expect(() => assertRestaurantSettingsFeatureVisible(owner, "users")).not.toThrow();

    const reception = contextFor({ role: "reception" });
    // reception has view_only restaurant_config (visible) but no users access.
    expect(() =>
      assertRestaurantSettingsFeatureVisible(reception, "restaurant_config"),
    ).not.toThrow();
    expect(() => assertRestaurantSettingsFeatureVisible(reception, "users")).toThrow(
      MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
    );
  });

  it("permits writes only for operate and rejects sub-operate with the feature message", () => {
    const owner = contextFor();
    expect(() => assertRestaurantSettingsFeatureOperate(owner, "restaurant_config")).not.toThrow();

    const reception = contextFor({ role: "reception" });
    const cases: [Parameters<typeof assertRestaurantSettingsFeatureOperate>[1], string][] = [
      ["restaurant_config", MSG_NOT_AUTHORISED_CONFIG],
      ["users", MSG_NOT_AUTHORISED_USERS],
      ["locations", MSG_NOT_AUTHORISED_LOCATIONS],
      ["whatsapp", MSG_NOT_AUTHORISED_WHATSAPP],
    ];
    for (const [feature, message] of cases) {
      expect(() => assertRestaurantSettingsFeatureOperate(reception, feature)).toThrow(message);
    }
  });

  it("runs read work with the resolved context after the visibility check passes", async () => {
    const context = contextFor();
    const resolveContext = vi.fn(async () => context);
    const work = vi.fn(async (ctx: AuthenticatedRestaurantSettingsContext) => ctx.tenantId);
    const guards = createRestaurantSettingsFeatureGuards({ resolveContext });

    await expect(guards.read("restaurant_config", {}, work)).resolves.toBe("tenant-a");
    expect(work).toHaveBeenCalledWith(context);
  });

  it("rejects a sub-operate write before any repository/external work runs", async () => {
    const context = contextFor({ role: "reception" });
    const resolveContext = vi.fn(async () => context);
    const work = vi.fn(async () => "should-not-run");
    const guards = createRestaurantSettingsFeatureGuards({ resolveContext });

    await expect(guards.write("restaurant_config", {}, work)).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    expect(work).not.toHaveBeenCalled();
  });

  it("runs write work with the resolved context when the caller resolves operate", async () => {
    const context = contextFor();
    const resolveContext = vi.fn(async () => context);
    const work = vi.fn(async (ctx: AuthenticatedRestaurantSettingsContext) => ctx.accountId);
    const guards = createRestaurantSettingsFeatureGuards({ resolveContext });

    await expect(guards.write("users", {}, work)).resolves.toBe("owner-a");
    expect(work).toHaveBeenCalledWith(context);
  });
});

function profileRow(): StoredRestaurantProfile {
  return {
    id: "profile-a",
    tenantId: "tenant-a",
    restaurantName: "Testaurant",
    ownerOrManagerName: "Owner",
    accountPhone: "111",
    teamSize: "5",
    publicEmail: "public@example.com",
    contactNumber: "222",
    whatsappNumber: "333",
    landline: "444",
    address: "1 Street",
    cuisineOrServices: "Italian",
    description: "Cozy",
  };
}

function security(overrides: Partial<AccountSecuritySnapshot> = {}): AccountSecuritySnapshot {
  return {
    accountType: "user",
    accountId: "owner-a",
    tenantId: "tenant-a",
    email: "owner@example.com",
    passwordHash: "hash",
    profilePhoto: "https://cdn/photo.png",
    ...overrides,
  };
}

function storedBranch(overrides: Partial<StoredBranch> = {}): StoredBranch {
  return {
    id: "branch-a",
    tenantId: "tenant-a",
    name: "Downtown",
    email: "branch@example.com",
    phone: "555",
    address: "2 Street",
    city: "City",
    state: "State",
    pincode: "00000",
    managerName: "Manager",
    profilePhoto: null,
    isActive: true,
    ...overrides,
  };
}

function bootstrapDepsFor(
  context: AuthenticatedRestaurantSettingsContext,
  overrides: {
    branches?: StoredBranch[];
    counts?: { doctor: number; reception: number };
    profile?: StoredRestaurantProfile | null;
    accountSecurity?: AccountSecuritySnapshot | null;
  } = {},
) {
  const listBranches = vi.fn(async () => overrides.branches ?? [storedBranch()]);
  const getSubUserRoleCounts = vi.fn(async () => overrides.counts ?? { doctor: 1, reception: 0 });
  return {
    deps: {
      resolveContext: vi.fn(async () => context),
      getTenantProfile: vi.fn(async () =>
        overrides.profile === undefined ? profileRow() : overrides.profile,
      ),
      getAccountSecurity: vi.fn(async () =>
        overrides.accountSecurity === undefined ? security() : overrides.accountSecurity,
      ),
      listBranches,
      getSubUserRoleCounts,
    },
    listBranches,
    getSubUserRoleCounts,
  };
}

describe("guarded restaurant settings bootstrap", () => {
  it("returns navigation, identity, profile summary, branch choices, and plan messages for the owner", async () => {
    const context = contextFor();
    const { deps, listBranches, getSubUserRoleCounts } = bootstrapDepsFor(context, {
      branches: [storedBranch(), storedBranch({ id: "branch-b", isActive: false })],
      counts: { doctor: 2, reception: 1 },
    });
    const result = await createRestaurantSettingsBootstrap(deps).bootstrap({});

    expect(result.accessResolved).toBe(true);
    expect(result.message).toBeNull();
    expect(result.navigation.visibleTabs).toEqual([
      "Restaurant Profile",
      "Operating Hours",
      "Dining Areas",
      "Tables",
      "Menu",
      "Booking Rules",
      "WhatsApp Alerts",
      "Multi Location",
      "Manage Users",
    ]);
    expect(result.identity).toMatchObject({
      accountId: "owner-a",
      tenantId: "tenant-a",
      role: "admin",
      accountType: "user",
      email: "owner@example.com",
      locationId: null,
    });
    expect(result.permissions?.restaurant_config.permission).toBe("operate");
    expect(result.profileCapability.canEditProfile).toBe(true);
    expect(result.profileSummary?.restaurantName).toBe("Testaurant");
    expect(result.profilePhoto).toBe("https://cdn/photo.png");
    expect(result.branchChoices).toEqual([
      { id: "branch-a", name: "Downtown", isActive: true },
      { id: "branch-b", name: "Downtown", isActive: false },
    ]);
    expect(result.userPlanLimits?.plan).toBe("Premium");
    expect(result.userPlanLimits?.doctor.current).toBe(2);
    expect(result.locationPlan?.maximum).toBe(1);
    expect(result.locationPlan?.current).toBe(2);
    expect(result.locationPlan?.canCreate).toBe(false);
    expect(listBranches).toHaveBeenCalledWith("tenant-a");
    expect(getSubUserRoleCounts).toHaveBeenCalledWith("tenant-a");
  });

  it("omits branch and user plan data when those features are not visible", async () => {
    const context = contextFor({ role: "reception" });
    const { deps, listBranches, getSubUserRoleCounts } = bootstrapDepsFor(context);
    const result = await createRestaurantSettingsBootstrap(deps).bootstrap({});

    expect(result.accessResolved).toBe(true);
    // reception sees config sub-tabs (view_only) and WhatsApp (view_only), but
    // never the owner-only users/locations tabs.
    expect(result.navigation.visibleTabs).toEqual([
      "Restaurant Profile",
      "Operating Hours",
      "Dining Areas",
      "Tables",
      "Menu",
      "Booking Rules",
      "WhatsApp Alerts",
    ]);
    expect(result.navigation.visibleTabs).not.toContain("Manage Users");
    expect(result.navigation.visibleTabs).not.toContain("Multi Location");
    expect(result.profileCapability.canEditProfile).toBe(false);
    expect(result.profileCapability.viewOnlyMessage).not.toBeNull();
    expect(result.userPlanLimits).toBeNull();
    expect(result.locationPlan).toBeNull();
    expect(result.branchChoices).toEqual([]);
    expect(listBranches).not.toHaveBeenCalled();
    expect(getSubUserRoleCounts).not.toHaveBeenCalled();
  });

  it("falls closed to a Profile-only state with no mutation capability when access is unresolved", async () => {
    const context = contextFor({ access: null });
    const { deps, listBranches, getSubUserRoleCounts } = bootstrapDepsFor(context);
    const result = await createRestaurantSettingsBootstrap(deps).bootstrap({
      requestedTab: "Manage Users",
    });

    expect(result.accessResolved).toBe(false);
    expect(result.message).toBe(MSG_FEATURE_ACCESS_UNRESOLVED);
    expect(result.navigation.visibleTabs).toEqual(["Restaurant Profile"]);
    expect(result.navigation.selectedTab).toBe("Restaurant Profile");
    expect(result.permissions).toBeNull();
    // No mutation capability is exposed.
    expect(result.profileCapability.canEditProfile).toBe(false);
    expect(result.profileCapability.canUploadProfilePhoto).toBe(false);
    for (const feature of ["restaurant_config", "users", "locations", "whatsapp"] as const) {
      expect(result.featureCapabilities[feature].canWrite).toBe(false);
      expect(result.featureCapabilities[feature].showMutationControls).toBe(false);
    }
    // Profile summary/identity still resolve for the authenticated account.
    expect(result.identity.email).toBe("owner@example.com");
    expect(result.profileSummary?.restaurantName).toBe("Testaurant");
    expect(result.userPlanLimits).toBeNull();
    expect(result.locationPlan).toBeNull();
    expect(listBranches).not.toHaveBeenCalled();
    expect(getSubUserRoleCounts).not.toHaveBeenCalled();
  });

  it("resolves a missing profile row to a null summary", async () => {
    const context = contextFor();
    const { deps } = bootstrapDepsFor(context, { profile: null, accountSecurity: null });
    const result = await createRestaurantSettingsBootstrap(deps).bootstrap({});

    expect(result.profileSummary).toBeNull();
    expect(result.profilePhoto).toBeNull();
    expect(result.identity.email).toBe("");
  });
});

function profileServiceFor(
  context: AuthenticatedRestaurantSettingsContext,
  overrides: {
    profile?: StoredRestaurantProfile | null;
    accountSecurity?: AccountSecuritySnapshot | null;
  } = {},
) {
  const saveProfile = vi.fn(
    async (tenantId: string, profile: RestaurantProfile): Promise<StoredRestaurantProfile> => ({
      id: "profile-a",
      tenantId,
      ...profile,
    }),
  );
  const getTenantProfile = vi.fn(async () =>
    overrides.profile === undefined ? profileRow() : overrides.profile,
  );
  const getAccountSecurity = vi.fn(async () =>
    overrides.accountSecurity === undefined ? security() : overrides.accountSecurity,
  );
  const service = createRestaurantProfileService({
    resolveContext: vi.fn(async () => context),
    getTenantProfile,
    getAccountSecurity,
    saveProfile,
  });
  return { service, saveProfile, getTenantProfile, getAccountSecurity };
}

describe("restaurant profile read/save service", () => {
  it("returns the canonical booking path, merged fields, and operate capability for the owner", async () => {
    const context = contextFor();
    const { service, saveProfile } = profileServiceFor(context);

    const view = await service.read({ requestedLocationId: "https://evil.example/attacker" });

    // The path is derived only from the tenant id, never from caller input.
    expect(view.bookingPath).toBe("/book/tenant-a");
    expect(view.bookingPath).toBe(canonicalBookingPath("tenant-a"));
    expect(view.tenantId).toBe("tenant-a");
    expect(view.profile.restaurantName).toBe("Testaurant");
    expect(view.accountEmail).toBe("owner@example.com");
    expect(view.profilePhoto).toBe("https://cdn/photo.png");
    expect(view.canSave).toBe(true);
    expect(view.capability.canEditProfile).toBe(true);
    expect(view.capability.showAccountSecurity).toBe(true);
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("exposes the profile read-only with no save path for a view_only account", async () => {
    const context = contextFor({ role: "reception" });
    const { service } = profileServiceFor(context, {
      accountSecurity: security({
        accountType: "sub_user",
        accountId: "staff-a",
        email: "staff@example.com",
      }),
    });

    const view = await service.read({});

    expect(view.canSave).toBe(false);
    expect(view.capability.canEditProfile).toBe(false);
    expect(view.capability.profileReadOnly).toBe(true);
    // Account security remains available regardless of configuration permission.
    expect(view.capability.showAccountSecurity).toBe(true);
    expect(view.capability.viewOnlyMessage).not.toBeNull();
    expect(view.accountEmail).toBe("staff@example.com");
  });

  it("returns fully-trimmed empty profile fields when no profile row exists", async () => {
    const context = contextFor();
    const { service } = profileServiceFor(context, { profile: null, accountSecurity: null });

    const view = await service.read({});

    expect(view.profile.restaurantName).toBe("");
    expect(view.profile.description).toBe("");
    expect(view.accountEmail).toBe("");
    expect(view.profilePhoto).toBeNull();
    expect(view.canSave).toBe(true);
  });

  it("trims every submitted field and atomically saves for an operate account", async () => {
    const context = contextFor();
    const { service, saveProfile } = profileServiceFor(context);

    const view = await service.save({
      profile: {
        restaurantName: "  Trimmed Name  ",
        ownerOrManagerName: " Owner ",
        accountPhone: " 100 ",
        teamSize: " 5 ",
        publicEmail: " public@example.com ",
        contactNumber: " 200 ",
        whatsappNumber: " 300 ",
        landline: " 400 ",
        address: " 1 Street ",
        cuisineOrServices: " Thai ",
        description: " Cozy spot ",
      },
    });

    expect(saveProfile).toHaveBeenCalledOnce();
    const savedProfile = saveProfile.mock.calls[0][1];
    expect(savedProfile.restaurantName).toBe("Trimmed Name");
    expect(savedProfile.publicEmail).toBe("public@example.com");
    expect(savedProfile.description).toBe("Cozy spot");
    expect(view.profile.restaurantName).toBe("Trimmed Name");
    expect(view.canSave).toBe(true);
  });

  it("rejects a view_only save before any repository write", async () => {
    const context = contextFor({ role: "reception" });
    const { service, saveProfile } = profileServiceFor(context);

    await expect(service.save({ profile: { restaurantName: "Blocked" } as never })).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    expect(saveProfile).not.toHaveBeenCalled();
  });
});

// A tiny valid PNG data URL: "hello" (5 bytes) is well under the 5 MiB limit.
const VALID_PHOTO_DATA_URL = "data:image/png;base64,aGVsbG8=";

function photoServiceFor(
  context: AuthenticatedRestaurantSettingsContext,
  overrides: {
    accountSecurity?: AccountSecuritySnapshot | null;
    uploadProfilePhoto?: (request: {
      dataUrl: string;
      tenantId: string;
      accountType: string;
      accountId: string;
    }) => Promise<string>;
    updateResult?: boolean;
  } = {},
) {
  const uploadProfilePhoto = vi.fn(
    overrides.uploadProfilePhoto ?? (async () => "https://cdn/new-photo.png"),
  );
  const updateAccountProfilePhoto = vi.fn(async () => overrides.updateResult ?? true);
  const getAccountSecurity = vi.fn(async () =>
    overrides.accountSecurity === undefined ? security() : overrides.accountSecurity,
  );
  const service = createRestaurantProfilePhotoService({
    resolveContext: vi.fn(async () => context),
    getAccountSecurity,
    uploadProfilePhoto,
    updateAccountProfilePhoto,
  });
  return { service, uploadProfilePhoto, updateAccountProfilePhoto, getAccountSecurity };
}

describe("role-aware profile photo upload service", () => {
  it("validates, uploads, then persists the new URL for an operate owner", async () => {
    const context = contextFor();
    const { service, uploadProfilePhoto, updateAccountProfilePhoto } = photoServiceFor(context);

    const result = await service.upload({ dataUrl: VALID_PHOTO_DATA_URL });

    expect(result).toEqual({
      status: "uploaded",
      profilePhoto: "https://cdn/new-photo.png",
      message: null,
    });
    // Upload runs before the row write, targeting the owner's User row.
    expect(uploadProfilePhoto).toHaveBeenCalledOnce();
    expect(updateAccountProfilePhoto).toHaveBeenCalledWith(
      "tenant-a",
      "user",
      "owner-a",
      "https://cdn/new-photo.png",
    );
    const uploadOrder = uploadProfilePhoto.mock.invocationCallOrder[0];
    const updateOrder = updateAccountProfilePhoto.mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(updateOrder);
  });

  it("updates the SubUser row for a reception operate account with config operate", async () => {
    // Grant restaurant_config: operate explicitly so a sub_user can upload.
    const context = contextFor({
      role: "reception",
      accountId: "staff-a",
      access: {
        restaurant_config: { available: true, permission: "operate", visible: true },
        users: { available: false, permission: "none", visible: false },
        locations: { available: false, permission: "none", visible: false },
        whatsapp: { available: false, permission: "none", visible: false },
      } as unknown as ResolvedAccess,
    });
    const { service, updateAccountProfilePhoto } = photoServiceFor(context, {
      accountSecurity: security({
        accountType: "sub_user",
        accountId: "staff-a",
        profilePhoto: null,
      }),
    });

    const result = await service.upload({ dataUrl: VALID_PHOTO_DATA_URL });

    expect(result.status).toBe("uploaded");
    expect(updateAccountProfilePhoto).toHaveBeenCalledWith(
      "tenant-a",
      "sub_user",
      "staff-a",
      "https://cdn/new-photo.png",
    );
  });

  it("rejects a sub-operate account before any decode, upload, or write", async () => {
    const context = contextFor({ role: "reception" });
    const { service, uploadProfilePhoto, updateAccountProfilePhoto } = photoServiceFor(context, {
      accountSecurity: security({ accountType: "sub_user", accountId: "staff-a" }),
    });

    await expect(service.upload({ dataUrl: VALID_PHOTO_DATA_URL })).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    expect(uploadProfilePhoto).not.toHaveBeenCalled();
    expect(updateAccountProfilePhoto).not.toHaveBeenCalled();
  });

  it("rejects an oversized or wrong-format photo before upload and retains the stored URL", async () => {
    const context = contextFor();
    const { service, uploadProfilePhoto, updateAccountProfilePhoto } = photoServiceFor(context, {
      accountSecurity: security({ profilePhoto: "https://cdn/old.png" }),
    });

    // A non-image/unsupported MIME never reaches the uploader.
    const result = await service.upload({ dataUrl: "data:application/pdf;base64,QUJDRA==" });

    expect(result).toEqual({
      status: "invalid",
      profilePhoto: "https://cdn/old.png",
      message: MSG_PROFILE_PHOTO,
    });
    expect(uploadProfilePhoto).not.toHaveBeenCalled();
    expect(updateAccountProfilePhoto).not.toHaveBeenCalled();
  });

  it("treats an unparseable data URL as a size/format rejection", async () => {
    const context = contextFor();
    const { service, uploadProfilePhoto } = photoServiceFor(context, {
      accountSecurity: security({ profilePhoto: "https://cdn/old.png" }),
    });

    const result = await service.upload({ dataUrl: "not-a-data-url" });

    expect(result.status).toBe("invalid");
    expect(result.profilePhoto).toBe("https://cdn/old.png");
    expect(result.message).toBe(MSG_PROFILE_PHOTO);
    expect(uploadProfilePhoto).not.toHaveBeenCalled();
  });

  it("preserves the stored URL and never persists when the upload fails", async () => {
    const context = contextFor();
    const { service, updateAccountProfilePhoto } = photoServiceFor(context, {
      accountSecurity: security({ profilePhoto: "https://cdn/old.png" }),
      uploadProfilePhoto: async () => {
        throw new Error("network down");
      },
    });

    const result = await service.upload({ dataUrl: VALID_PHOTO_DATA_URL });

    expect(result).toEqual({
      status: "upload_failed",
      profilePhoto: "https://cdn/old.png",
      message: MSG_PROFILE_PHOTO,
    });
    expect(updateAccountProfilePhoto).not.toHaveBeenCalled();
  });

  it("reports upload_failed and preserves the URL when the row update misses", async () => {
    const context = contextFor();
    const { service } = photoServiceFor(context, {
      accountSecurity: security({ profilePhoto: "https://cdn/old.png" }),
      updateResult: false,
    });

    const result = await service.upload({ dataUrl: VALID_PHOTO_DATA_URL });

    expect(result.status).toBe("upload_failed");
    expect(result.profilePhoto).toBe("https://cdn/old.png");
  });
});

// Fixed clock: request timing derives from this instant, confirm runs 30s later.
const EMAIL_NOW_MS = Date.UTC(2026, 3, 1, 0, 0, 0);
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const SIXTY_SECONDS_MS = 60 * 1000;

// Deterministic, account-bound fake hash so tests never touch node:crypto.
function fakeHash(binding: { accountType: string; accountId: string }, code: string): string {
  return `hash:${binding.accountType}:${binding.accountId}:${code}`;
}

function activeVerification(
  overrides: Partial<StoredEmailVerification> = {},
): StoredEmailVerification {
  return {
    id: "verification-1",
    tenantId: "tenant-a",
    accountType: "user",
    accountId: "owner-a",
    targetEmail: "new@example.com",
    codeHash: fakeHash({ accountType: "user", accountId: "owner-a" }, "1234"),
    issuedAtMs: EMAIL_NOW_MS,
    expiresAtMs: EMAIL_NOW_MS + FIVE_MINUTES_MS,
    resendAvailableAtMs: EMAIL_NOW_MS + SIXTY_SECONDS_MS,
    consumedAtMs: null,
    ...overrides,
  };
}

function emailServiceFor(
  context: AuthenticatedRestaurantSettingsContext,
  overrides: {
    accountSecurity?: AccountSecuritySnapshot | null;
    emailAvailable?: boolean;
    active?: StoredEmailVerification | null;
    confirmResult?: AccountEmailChangeResult;
    generatedCode?: string;
    nowMs?: number;
    sendRejects?: boolean;
  } = {},
) {
  const isAccountEmailAvailable = vi.fn(async () => overrides.emailAvailable ?? true);
  const getActiveEmailVerification = vi.fn(async () => overrides.active ?? null);
  const saveEmailVerification = vi.fn<
    RestaurantAccountEmailServiceDependencies["saveEmailVerification"]
  >(async () => "verification-1");
  const confirmAccountEmailChange = vi.fn<
    RestaurantAccountEmailServiceDependencies["confirmAccountEmailChange"]
  >(async () => overrides.confirmResult ?? ({ status: "updated" } as AccountEmailChangeResult));
  const getAccountSecurity = vi.fn(async () =>
    overrides.accountSecurity === undefined ? security() : overrides.accountSecurity,
  );
  const sendVerificationCode = vi.fn(async () => {
    if (overrides.sendRejects) throw new Error("smtp down");
  });
  const dependencies: Partial<RestaurantAccountEmailServiceDependencies> = {
    resolveContext: vi.fn(async () => context),
    getAccountSecurity,
    isAccountEmailAvailable,
    getActiveEmailVerification,
    saveEmailVerification,
    confirmAccountEmailChange,
    hashVerificationCode: (binding, code) => fakeHash(binding, code),
    generateVerificationCode: () => overrides.generatedCode ?? "0042",
    sendVerificationCode,
    now: () => overrides.nowMs ?? EMAIL_NOW_MS,
  };
  return {
    service: createRestaurantAccountEmailService(dependencies),
    isAccountEmailAvailable,
    getActiveEmailVerification,
    saveEmailVerification,
    confirmAccountEmailChange,
    getAccountSecurity,
    sendVerificationCode,
  };
}

describe("self-service account email-change request", () => {
  it("rejects a submission equal to the current email and sends no code (Req 2.17)", async () => {
    const context = contextFor();
    const { service, saveEmailVerification, sendVerificationCode, isAccountEmailAvailable } =
      emailServiceFor(context, {
        accountSecurity: security({ email: "Owner@Example.com" }),
      });

    // Case- and space-insensitive equality to the stored address is rejected.
    const result = await service.request({ email: "  owner@example.com " });

    expect(result.status).toBe("email_current");
    expect(result.message).toBe(MSG_EMAIL_ALREADY_CURRENT);
    expect(result.targetEmail).toBeNull();
    expect(isAccountEmailAvailable).not.toHaveBeenCalled();
    expect(saveEmailVerification).not.toHaveBeenCalled();
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("rejects an address registered to another account and sends no code (Req 2.18)", async () => {
    const context = contextFor();
    const { service, saveEmailVerification, sendVerificationCode } = emailServiceFor(context, {
      emailAvailable: false,
    });

    const result = await service.request({ email: "taken@example.com" });

    expect(result.status).toBe("email_in_use");
    expect(result.message).toBe(MSG_EMAIL_ALREADY_IN_USE);
    expect(saveEmailVerification).not.toHaveBeenCalled();
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("stores a hashed 4-digit code with exact 5-minute validity and 60-second resend, then sends it (Req 2.14-2.16)", async () => {
    const context = contextFor();
    const { service, saveEmailVerification, sendVerificationCode } = emailServiceFor(context, {
      generatedCode: "0042",
    });

    const result = await service.request({ email: " New@Example.com " });

    expect(result.status).toBe("code_sent");
    expect(result.targetEmail).toBe("new@example.com");
    expect(result.expiresAtMs).toBe(EMAIL_NOW_MS + FIVE_MINUTES_MS);
    expect(result.resendAvailableAtMs).toBe(EMAIL_NOW_MS + SIXTY_SECONDS_MS);

    expect(saveEmailVerification).toHaveBeenCalledOnce();
    const [tenantId, saved] = saveEmailVerification.mock.calls[0];
    expect(tenantId).toBe("tenant-a");
    expect(saved.accountType).toBe("user");
    expect(saved.accountId).toBe("owner-a");
    expect(saved.targetEmail).toBe("new@example.com");
    // The stored value is the hash output, never the raw code itself.
    expect(saved.codeHash).toBe(fakeHash({ accountType: "user", accountId: "owner-a" }, "0042"));
    expect(saved.expiresAtMs).toBe(EMAIL_NOW_MS + FIVE_MINUTES_MS);
    expect(saved.resendAvailableAtMs).toBe(EMAIL_NOW_MS + SIXTY_SECONDS_MS);

    // The plaintext code is delivered out-of-band to the target address.
    expect(sendVerificationCode).toHaveBeenCalledWith("new@example.com", "0042");
  });

  it("generates cryptographically secure exactly-4-digit codes via the default generator", async () => {
    // Exercise the real crypto generator (not the fake) across many draws.
    const captured: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const local = createRestaurantAccountEmailService({
        resolveContext: vi.fn(async () => contextFor()),
        getAccountSecurity: vi.fn(async () => security()),
        isAccountEmailAvailable: vi.fn(async () => true),
        saveEmailVerification: vi.fn(async () => "verification-1"),
        sendVerificationCode: vi.fn(async (_email: string, code: string) => {
          captured.push(code);
        }),
      });
      await local.request({ email: `new${i}@example.com` });
    }
    expect(captured).toHaveLength(50);
    for (const code of captured) {
      expect(code).toMatch(/^\d{4}$/);
    }
  });

  it("persists the real code only as an opaque hash, never in plain text", async () => {
    // No hashVerificationCode/generateVerificationCode override: exercise the
    // production SHA-256 hash and crypto generator together.
    let sentCode = "";
    let storedHash = "";
    const service = createRestaurantAccountEmailService({
      resolveContext: vi.fn(async () => contextFor()),
      getAccountSecurity: vi.fn(async () => security()),
      isAccountEmailAvailable: vi.fn(async () => true),
      saveEmailVerification: vi.fn(async (_tenantId: string, input) => {
        storedHash = input.codeHash;
        return "verification-1";
      }),
      sendVerificationCode: vi.fn(async (_email: string, code: string) => {
        sentCode = code;
      }),
    });

    await service.request({ email: "new@example.com" });

    expect(sentCode).toMatch(/^\d{4}$/);
    // SHA-256 hex digest is 64 chars and never contains the plaintext code.
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedHash).not.toContain(sentCode);
  });

  it("still reports the code as sent when email delivery fails (the row is retained for resend)", async () => {
    const context = contextFor();
    const { service, saveEmailVerification } = emailServiceFor(context, { sendRejects: true });

    const result = await service.request({ email: "new@example.com" });

    expect(result.status).toBe("code_sent");
    expect(saveEmailVerification).toHaveBeenCalledOnce();
  });
});

describe("self-service account email-change resend", () => {
  it("refuses a resend when nothing is outstanding", async () => {
    const context = contextFor();
    const { service, saveEmailVerification, sendVerificationCode } = emailServiceFor(context, {
      active: null,
    });

    const result = await service.resend({});

    expect(result.status).toBe("no_pending");
    expect(result.message).toBe(MSG_EMAIL_VERIFICATION_NONE_PENDING);
    expect(saveEmailVerification).not.toHaveBeenCalled();
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("refuses a resend before the exact 60-second boundary and issues no new code (Req 2.16)", async () => {
    const context = contextFor();
    const { service, saveEmailVerification, sendVerificationCode } = emailServiceFor(context, {
      active: activeVerification(),
      // One millisecond before the resend boundary.
      nowMs: EMAIL_NOW_MS + SIXTY_SECONDS_MS - 1,
    });

    const result = await service.resend({});

    expect(result.status).toBe("resend_too_soon");
    expect(result.message).toBe(MSG_EMAIL_VERIFICATION_RESEND_TOO_SOON);
    expect(saveEmailVerification).not.toHaveBeenCalled();
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("re-issues a fresh code for the outstanding target at the exact boundary (Req 2.16)", async () => {
    const context = contextFor();
    const { service, saveEmailVerification, sendVerificationCode } = emailServiceFor(context, {
      active: activeVerification({ targetEmail: "pending@example.com" }),
      generatedCode: "0042",
      // Exactly at the resend boundary; a new window opens from here.
      nowMs: EMAIL_NOW_MS + SIXTY_SECONDS_MS,
    });

    const result = await service.resend({});

    expect(result.status).toBe("code_sent");
    expect(result.targetEmail).toBe("pending@example.com");
    expect(result.resendAvailableAtMs).toBe(EMAIL_NOW_MS + SIXTY_SECONDS_MS + SIXTY_SECONDS_MS);
    expect(saveEmailVerification).toHaveBeenCalledOnce();
    expect(sendVerificationCode).toHaveBeenCalledWith("pending@example.com", "0042");
  });
});

describe("self-service account email-change confirm", () => {
  it("updates exactly the signed-in account row for a matching unexpired code (Req 2.19)", async () => {
    const context = contextFor();
    const { service, confirmAccountEmailChange } = emailServiceFor(context, {
      active: activeVerification(),
      confirmResult: { status: "updated" },
      nowMs: EMAIL_NOW_MS + 30_000,
    });

    const result = await service.confirm({ email: "new@example.com", code: "1234" });

    expect(result.status).toBe("updated");
    expect(result.email).toBe("new@example.com");
    expect(confirmAccountEmailChange).toHaveBeenCalledOnce();
    const [tenantId, confirmInput] = confirmAccountEmailChange.mock.calls[0];
    expect(tenantId).toBe("tenant-a");
    expect(confirmInput).toEqual({
      accountType: "user",
      accountId: "owner-a",
      verificationId: "verification-1",
      targetEmail: "new@example.com",
      consumedAtMs: EMAIL_NOW_MS + 30_000,
    });
  });

  it("rejects a mismatched code and leaves the stored email unchanged (Req 2.20)", async () => {
    const context = contextFor();
    const { service, confirmAccountEmailChange } = emailServiceFor(context, {
      active: activeVerification(),
      accountSecurity: security({ email: "owner@example.com" }),
      nowMs: EMAIL_NOW_MS + 30_000,
    });

    const result = await service.confirm({ email: "new@example.com", code: "9999" });

    expect(result.status).toBe("invalid_code");
    expect(result.message).toBe(MSG_VERIFICATION_INVALID_OR_EXPIRED);
    expect(result.email).toBe("owner@example.com");
    // No transactional update is ever attempted for a bad code.
    expect(confirmAccountEmailChange).not.toHaveBeenCalled();
  });

  it("rejects an expired code even when the hash matches (Req 2.20)", async () => {
    const context = contextFor();
    const { service, confirmAccountEmailChange } = emailServiceFor(context, {
      active: activeVerification(),
      // One millisecond past the exact 5-minute expiry.
      nowMs: EMAIL_NOW_MS + FIVE_MINUTES_MS,
    });

    const result = await service.confirm({ email: "new@example.com", code: "1234" });

    expect(result.status).toBe("invalid_code");
    expect(confirmAccountEmailChange).not.toHaveBeenCalled();
  });

  it("rejects a code whose target email does not match the stored binding (Req 2.20)", async () => {
    const context = contextFor();
    const { service, confirmAccountEmailChange } = emailServiceFor(context, {
      active: activeVerification({ targetEmail: "new@example.com" }),
      nowMs: EMAIL_NOW_MS + 30_000,
    });

    // Correct code, but for a different address than the one bound at request.
    const result = await service.confirm({ email: "other@example.com", code: "1234" });

    expect(result.status).toBe("invalid_code");
    expect(confirmAccountEmailChange).not.toHaveBeenCalled();
  });

  it("maps a transactional uniqueness loss to email-in-use and preserves the stored email", async () => {
    const context = contextFor();
    const { service } = emailServiceFor(context, {
      active: activeVerification(),
      accountSecurity: security({ email: "owner@example.com" }),
      confirmResult: { status: "email_taken" },
      nowMs: EMAIL_NOW_MS + 30_000,
    });

    const result = await service.confirm({ email: "new@example.com", code: "1234" });

    expect(result.status).toBe("email_in_use");
    expect(result.message).toBe(MSG_EMAIL_ALREADY_IN_USE);
    expect(result.email).toBe("owner@example.com");
  });

  it("treats a consumed/raced verification returned by the transaction as invalid", async () => {
    const context = contextFor();
    const { service } = emailServiceFor(context, {
      active: activeVerification(),
      confirmResult: { status: "verification_invalid" },
      nowMs: EMAIL_NOW_MS + 30_000,
    });

    const result = await service.confirm({ email: "new@example.com", code: "1234" });

    expect(result.status).toBe("invalid_code");
    expect(result.message).toBe(MSG_VERIFICATION_INVALID_OR_EXPIRED);
  });

  it("rejects confirmation when no verification is outstanding", async () => {
    const context = contextFor();
    const { service, confirmAccountEmailChange } = emailServiceFor(context, { active: null });

    const result = await service.confirm({ email: "new@example.com", code: "1234" });

    expect(result.status).toBe("invalid_code");
    expect(confirmAccountEmailChange).not.toHaveBeenCalled();
  });

  it("updates the correct row for a branch (location) account", async () => {
    const context = contextFor({
      role: "location",
      accountId: "branch-a",
      scope: { tenantId: "tenant-a", locationId: "branch-a" },
    });
    const { service, confirmAccountEmailChange } = emailServiceFor(context, {
      active: activeVerification({
        accountType: "location",
        accountId: "branch-a",
        codeHash: fakeHash({ accountType: "location", accountId: "branch-a" }, "1234"),
      }),
      accountSecurity: security({
        accountType: "location",
        accountId: "branch-a",
        email: "branch@example.com",
      }),
      confirmResult: { status: "updated" },
      nowMs: EMAIL_NOW_MS + 30_000,
    });

    const result = await service.confirm({ email: "new@example.com", code: "1234" });

    expect(result.status).toBe("updated");
    const [, confirmInput] = confirmAccountEmailChange.mock.calls[0];
    expect(confirmInput.accountType).toBe("location");
    expect(confirmInput.accountId).toBe("branch-a");
  });
});

function passwordServiceFor(
  context: AuthenticatedRestaurantSettingsContext,
  overrides: {
    accountSecurity?: AccountSecuritySnapshot | null;
    currentMatches?: boolean;
    updateResult?: boolean;
  } = {},
) {
  const getAccountSecurity = vi.fn(async () =>
    overrides.accountSecurity === undefined ? security() : overrides.accountSecurity,
  );
  const updateAccountPassword = vi.fn<
    RestaurantAccountPasswordServiceDependencies["updateAccountPassword"]
  >(async () => overrides.updateResult ?? true);
  const verifyPassword = vi.fn(async () => overrides.currentMatches ?? true);
  const hashPassword = vi.fn(async (plain: string) => `hashed:${plain}`);
  const dependencies: Partial<RestaurantAccountPasswordServiceDependencies> = {
    resolveContext: vi.fn(async () => context),
    getAccountSecurity,
    updateAccountPassword,
    verifyPassword,
    hashPassword,
  };
  return {
    service: createRestaurantAccountPasswordService(dependencies),
    getAccountSecurity,
    updateAccountPassword,
    verifyPassword,
    hashPassword,
  };
}

describe("self-service own-password change", () => {
  it("replaces exactly the signed-in account's hash for a correct current password and valid new password (Req 2.21)", async () => {
    const context = contextFor();
    const { service, updateAccountPassword, verifyPassword, hashPassword } = passwordServiceFor(
      context,
      { accountSecurity: security({ passwordHash: "stored-hash" }) },
    );

    const result = await service.change({
      currentPassword: "current-secret",
      newPassword: "brand-new-password",
      confirmation: "brand-new-password",
    });

    expect(result.status).toBe("updated");
    expect(result.message).toBeNull();
    expect(result.fieldErrors).toEqual([]);

    // The current password is checked against the stored hash before any write.
    expect(verifyPassword).toHaveBeenCalledWith("current-secret", "stored-hash");
    expect(hashPassword).toHaveBeenCalledWith("brand-new-password");
    expect(updateAccountPassword).toHaveBeenCalledOnce();
    const [tenantId, accountType, accountId, passwordHash] = updateAccountPassword.mock.calls[0];
    expect(tenantId).toBe("tenant-a");
    expect(accountType).toBe("user");
    expect(accountId).toBe("owner-a");
    expect(passwordHash).toBe("hashed:brand-new-password");
  });

  it("is available independent of config permission (view_only owner still changes password, Req 2.13)", async () => {
    // A resolved context whose restaurant_config is view_only must still be able
    // to change its own password: the service never consults feature access.
    const context = contextFor({ role: "reception" });
    const { service, updateAccountPassword } = passwordServiceFor(context, {
      accountSecurity: security({ accountType: "sub_user", accountId: "owner-a" }),
    });

    const result = await service.change({
      currentPassword: "current-secret",
      newPassword: "brand-new-password",
      confirmation: "brand-new-password",
    });

    expect(result.status).toBe("updated");
    expect(updateAccountPassword).toHaveBeenCalledOnce();
    expect(updateAccountPassword.mock.calls[0][1]).toBe("sub_user");
  });

  it("rejects a mismatched confirmation and never touches the stored hash (Req 2.22)", async () => {
    const context = contextFor();
    const { service, updateAccountPassword, verifyPassword } = passwordServiceFor(context);

    const result = await service.change({
      currentPassword: "current-secret",
      newPassword: "brand-new-password",
      confirmation: "different-password",
    });

    expect(result.status).toBe("invalid_input");
    expect(result.message).toBe(MSG_PASSWORDS_DO_NOT_MATCH);
    expect(result.fieldErrors).toContainEqual({
      field: "confirmation",
      message: MSG_PASSWORDS_DO_NOT_MATCH,
    });
    // Validation fails before the current password is ever verified or written.
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(updateAccountPassword).not.toHaveBeenCalled();
  });

  it("rejects a new password shorter than 8 characters and leaves the hash unchanged (Req 2.23)", async () => {
    const context = contextFor();
    const { service, updateAccountPassword } = passwordServiceFor(context);

    const result = await service.change({
      currentPassword: "current-secret",
      newPassword: "short",
      confirmation: "short",
    });

    expect(result.status).toBe("invalid_input");
    expect(result.message).toBe(MSG_PASSWORD_MIN_LENGTH);
    expect(result.fieldErrors).toContainEqual({
      field: "newPassword",
      message: MSG_PASSWORD_MIN_LENGTH,
    });
    expect(updateAccountPassword).not.toHaveBeenCalled();
  });

  it("rejects an incorrect current password and leaves the stored hash unchanged (Req 2.24)", async () => {
    const context = contextFor();
    const { service, updateAccountPassword, hashPassword } = passwordServiceFor(context, {
      currentMatches: false,
    });

    const result = await service.change({
      currentPassword: "wrong-current",
      newPassword: "brand-new-password",
      confirmation: "brand-new-password",
    });

    expect(result.status).toBe("current_incorrect");
    expect(result.message).toBe(MSG_CURRENT_PASSWORD_INCORRECT);
    expect(result.fieldErrors).toContainEqual({
      field: "currentPassword",
      message: MSG_CURRENT_PASSWORD_INCORRECT,
    });
    // No new hash is computed and no write is attempted on a bad current password.
    expect(hashPassword).not.toHaveBeenCalled();
    expect(updateAccountPassword).not.toHaveBeenCalled();
  });

  it("returns not-found without writing when the account row is missing", async () => {
    const context = contextFor();
    const { service, updateAccountPassword, verifyPassword } = passwordServiceFor(context, {
      accountSecurity: null,
    });

    const result = await service.change({
      currentPassword: "current-secret",
      newPassword: "brand-new-password",
      confirmation: "brand-new-password",
    });

    expect(result.status).toBe("not_found");
    expect(result.message).toBe(MSG_SETTINGS_RESOURCE_NOT_FOUND);
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(updateAccountPassword).not.toHaveBeenCalled();
  });

  it("verifies the current password with the real bcrypt convention end-to-end", async () => {
    // No verifyPassword/hashPassword overrides: exercise the production bcrypt
    // compare and hash so the stored hash is real and the round-trip verifies.
    const currentHash = await bcrypt.hash("current-secret", 10);
    let writtenHash = "";
    const service = createRestaurantAccountPasswordService({
      resolveContext: vi.fn(async () => contextFor()),
      getAccountSecurity: vi.fn(async () => security({ passwordHash: currentHash })),
      updateAccountPassword: vi.fn(async (_tenantId, _type, _id, hash: string) => {
        writtenHash = hash;
        return true;
      }),
    });

    const result = await service.change({
      currentPassword: "current-secret",
      newPassword: "brand-new-password",
      confirmation: "brand-new-password",
    });

    expect(result.status).toBe("updated");
    // The written value is a genuine bcrypt hash of the new password.
    expect(await bcrypt.compare("brand-new-password", writtenHash)).toBe(true);
    expect(writtenHash).not.toContain("brand-new-password");
  });
});
