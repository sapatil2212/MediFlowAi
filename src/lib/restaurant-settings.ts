import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import bcrypt from "bcryptjs";

import { queryOne } from "./db";
import { sendOtpEmail } from "./email";
import {
  normalizePlan,
  resolveFeatureAccess,
  type AccountContext,
  type AccountRole,
  type ResolvedAccess,
} from "./feature-access";
import {
  authoriseSettingsFeatureWrite,
  canResendEmailVerification,
  createVerificationTiming,
  deriveFeatureCapabilityViewModel,
  deriveProfileCapabilityViewModel,
  deriveRestaurantSettingsNavigation,
  EFFECTIVE_MAIN_AREA_ID,
  LIMITS,
  MENU_ITEM_STATES,
  MSG_AREA_ALREADY_EXISTS,
  MSG_CLOSURE_ALREADY_EXISTS,
  MSG_CURRENT_PASSWORD_INCORRECT,
  MSG_EMAIL_ALREADY_CURRENT,
  MSG_EMAIL_ALREADY_IN_USE,
  MSG_FEATURE_ACCESS_UNRESOLVED,
  MSG_MAX_MENU_CATEGORIES,
  MSG_MAX_MENU_ITEMS,
  MSG_MENU_CATEGORY_ALREADY_EXISTS,
  MSG_MENU_CATEGORY_REFERENCE,
  MSG_MENU_ITEM_STATE,
  MSG_PASSWORD_MIN_LENGTH,
  MSG_PASSWORDS_DO_NOT_MATCH,
  MSG_PROFILE_PHOTO,
  MSG_SETTINGS_RESOURCE_NOT_FOUND,
  MSG_SUB_USER_CREATE_FAILED,
  MSG_SUB_USER_EMAIL_IN_USE,
  MSG_SUB_USER_ROLE,
  MSG_VERIFICATION_INVALID_OR_EXPIRED,
  normaliseEmail,
  orderDiningAreas,
  orderMenu,
  validateClosureDay,
  validateDiningArea,
  validateEmailVerificationAttempt,
  validateMenuCategory,
  validateMenuItem,
  validatePasswordChangeInput,
  validateRestaurantOperatingHours,
  normaliseLocationScope,
  normaliseRestaurantProfile,
  parseImageDataUrl,
  validateProfilePhoto,
  resolveRestaurantResourceScope,
  resolveSubUserPlanLimits,
  resolveSubUserRoleChange,
  SUB_USER_ROLES,
  trimmedString,
  type AccountType,
  type AreaContext,
  type ClosureDay,
  type ClosureScope,
  type DayHours,
  type DiningArea,
  type DiningTableAreaAssignment,
  type ExistingAreaName,
  type FeatureCapabilityViewModel,
  type FeaturePermission,
  type FieldError,
  type LocationScope,
  type ExistingMenuCategoryName,
  type MenuCategory,
  type MenuCategoryDeletionPreview,
  type MenuContext,
  type MenuItem,
  type MenuItemState,
  type NormalisedMenuCategory,
  type NormalisedMenuItem,
  type ProfileCapabilityViewModel,
  type RestaurantProfile,
  type RestaurantProfileInput,
  type RestaurantResourceScope,
  type RestaurantSettingsAccountRole,
  type RestaurantSettingsNavigation,
  type RestaurantSettingsPermissions,
  type RestaurantScopeBranch,
  type SettingsFeature,
  type SubUser,
  type SubUserInput,
  type SubUserPlanLimits,
  type SubUserRole,
  type SubUserRoleChangeDecision,
  type UserRoleCounts,
} from "./restaurant-settings-model";
import {
  restaurantSettingsRepository,
  whatsAppSettingsAdapter,
  type AccountEmailChangeResult,
  type AccountSecuritySnapshot,
  type BranchLifecycleResult,
  type CreateBranchInput,
  type CreateBranchResult,
  type CreateClosureDayResult,
  type CreateDiningAreaInput,
  type CreateDiningAreaResult,
  type CreateSubUserInput,
  type CreateSubUserResult,
  type DeleteBranchResult,
  type DeleteDiningAreaResult,
  type DeleteMenuCategoryResult,
  type DeleteMenuItemResult,
  type DeleteScopedRecordResult,
  type DeleteScopedRestaurantTableResult,
  type DeleteSubUserResult,
  type PreviewMenuCategoryDeletionResult,
  type SaveMenuCategoryResult,
  type SaveMenuItemResult,
  type SaveEmailVerificationInput,
  type SaveScopedRestaurantTableInput,
  type SaveScopedRestaurantTableResult,
  type StoredBranch,
  type StoredEmailVerification,
  type StoredRestaurantHours,
  type StoredRestaurantProfile,
  type StoredRestaurantTable,
  type StoredSubUser,
  type SaveWhatsAppAlertConfigInput,
  type SubUserLifecycleResult,
  type UpdateBranchInput,
  type UpdateBranchResult,
  type UpdateSubUserInput,
  type UpdateSubUserResult,
  type WhatsAppActionOutcome,
  type WhatsAppAlertConfig,
  type WhatsAppSettingsStatus,
} from "./restaurant-settings.server";
import {
  validateTableInput,
  MSG_DUPLICATE_TABLE_NAME,
  type TableState,
} from "./restaurant-availability";

export const MSG_RESTAURANT_SETTINGS_UNAUTHORIZED = "Unauthorized";

export interface RestaurantSettingsSession {
  id?: string | null;
  tenantId?: string | null;
  role?: RestaurantSettingsAccountRole | string | null;
  locationId?: string | null;
  profession?: string | null;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface RestaurantSettingsScopeBranch extends RestaurantScopeBranch {
  isActive: boolean;
}

export interface RestaurantSettingsBoundaryDependencies {
  verifySession(): Promise<RestaurantSettingsSession | null>;
  resolveFeatureAccess(context: AccountContext): ResolvedAccess;
  findBranchById(tenantId: string, branchId: string): Promise<RestaurantSettingsScopeBranch | null>;
  now(): Date;
}

export interface AuthenticatedRestaurantSettingsContext {
  session: RestaurantSettingsSession;
  accountId: string;
  tenantId: string;
  role: RestaurantSettingsAccountRole;
  featureContext: AccountContext;
  access: ResolvedAccess;
  scope: RestaurantResourceScope;
}

export interface ResolveRestaurantSettingsContextInput {
  requestedLocationId?: string | null;
}

function databaseBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

// Server-only so the `./db` import (which pulls `dotenv` and `mariadb`) is
// stripped from the client bundle: on the client the plugin replaces the body
// with a throwing stub, leaving `queryOne` unreferenced and eliminated.
const findBranchById = createServerOnlyFn(
  async (tenantId: string, branchId: string): Promise<RestaurantSettingsScopeBranch | null> => {
    const row = await queryOne<{ id: unknown; tenantId: unknown; isActive: unknown }>(
      `SELECT id, tenantId, isActive
     FROM Location
     WHERE tenantId = ? AND id = ?
     LIMIT 1`,
      [tenantId, branchId],
    );
    if (!row) return null;
    return {
      id: String(row.id),
      tenantId: String(row.tenantId),
      isActive: databaseBoolean(row.isActive),
    };
  },
);

// Marked server-only so the `auth.server` import (which pulls
// `@tanstack/react-start/server`) is stripped from the client bundle. On the
// client the plugin replaces the body with a throwing stub, dropping the
// dynamic import entirely; it only ever executes server-side inside a handler.
const resolveDefaultSession = createServerOnlyFn(async () => {
  const { verifySession } = await import("./auth.server");
  return verifySession();
});

const defaultDependencies = createServerOnlyFn(
  (): RestaurantSettingsBoundaryDependencies => ({
    verifySession: () => resolveDefaultSession(),
    resolveFeatureAccess,
    findBranchById,
    now: () => new Date(),
  }),
);

function isSettingsRole(value: unknown): value is RestaurantSettingsAccountRole {
  return value === "admin" || value === "reception" || value === "doctor" || value === "location";
}

function throwUnauthorized(): never {
  throw new Error(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
}

function unwrapScope(
  result: ReturnType<typeof resolveRestaurantResourceScope>,
): RestaurantResourceScope {
  if (result.ok) return result.value;
  throw new Error(result.errors[0]?.message ?? MSG_SETTINGS_RESOURCE_NOT_FOUND);
}

/**
 * Creates the shared authenticated boundary used by restaurant Settings server functions.
 * All I/O is injectable so authorization and scope behavior can be tested without cookies or SQL.
 */
export function createRestaurantSettingsBoundary(
  overrides: Partial<RestaurantSettingsBoundaryDependencies> = {},
) {
  const dependencies: RestaurantSettingsBoundaryDependencies = {
    ...defaultDependencies(),
    ...overrides,
  };

  return {
    async resolve(
      input: ResolveRestaurantSettingsContextInput = {},
    ): Promise<AuthenticatedRestaurantSettingsContext> {
      const session = await dependencies.verifySession();
      if (!session || session.isActive === false) throwUnauthorized();

      const accountId = trimmedString(session.id);
      const tenantId = trimmedString(session.tenantId);
      const role = session.role;
      if (!accountId || !tenantId || !isSettingsRole(role)) throwUnauthorized();

      const featureContext: AccountContext = {
        role: role as AccountRole,
        profession: session.profession,
        subscriptionPlan: session.subscriptionPlan,
        subscriptionStatus: session.subscriptionStatus,
        subscriptionExpiresAt: session.subscriptionExpiresAt,
        isActive: true,
        now: dependencies.now(),
      };
      // Resolve inherited parent-plan access before any settings or branch row read.
      const access = dependencies.resolveFeatureAccess(featureContext);
      const requestedLocationId = normaliseLocationScope(input.requestedLocationId);

      let branches: readonly RestaurantScopeBranch[] | undefined;
      if (role === "location") {
        const sessionLocationId = normaliseLocationScope(session.locationId);
        // A branch session is valid only when both server-issued identity fields agree.
        if (!sessionLocationId || sessionLocationId !== accountId) throwUnauthorized();
        if (requestedLocationId !== null && requestedLocationId !== sessionLocationId) {
          unwrapScope(
            resolveRestaurantResourceScope({
              tenantId,
              role,
              sessionLocationId,
              requestedLocationId,
            }),
          );
          throwUnauthorized();
        }

        const branch = await dependencies.findBranchById(tenantId, sessionLocationId);
        if (
          !branch ||
          branch.id !== sessionLocationId ||
          branch.tenantId !== tenantId ||
          !branch.isActive
        ) {
          throwUnauthorized();
        }
      } else if (role === "admin" && requestedLocationId !== null) {
        const branch = await dependencies.findBranchById(tenantId, requestedLocationId);
        branches = branch ? [branch] : [];
      }

      const scope = unwrapScope(
        resolveRestaurantResourceScope({
          tenantId,
          role,
          sessionLocationId: session.locationId,
          requestedLocationId,
          branches,
        }),
      );

      return { session, accountId, tenantId, role, featureContext, access, scope };
    },
  };
}

let restaurantSettingsBoundaryInstance:
  | ReturnType<typeof createRestaurantSettingsBoundary>
  | undefined;
const restaurantSettingsBoundary = createServerOnlyFn(
  () => (restaurantSettingsBoundaryInstance ??= createRestaurantSettingsBoundary()),
);

/** Default production entry point; server functions should call this before row access. */
export async function resolveAuthenticatedRestaurantSettingsContext(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<AuthenticatedRestaurantSettingsContext> {
  return restaurantSettingsBoundary().resolve(input);
}

/**
 * Maps a tenant/scope-constrained identifier miss to the single public not-found error.
 * Callers must perform identifier lookups with the resolved scope before using this helper.
 */
export function requireRestaurantSettingsRecord<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error(MSG_SETTINGS_RESOURCE_NOT_FOUND);
  }
  return value;
}

/** Maps repository identifier-miss statuses without revealing a foreign tenant or branch. */
export function requireRestaurantSettingsResult<T extends { status: string }>(result: T): T {
  if (result.status === "not_found" || result.status.endsWith("_not_found")) {
    throw new Error(MSG_SETTINGS_RESOURCE_NOT_FOUND);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reusable feature-gated read/write wrappers
//
// Every authenticated Settings server function resolves the shared boundary
// (session -> inherited Feature Access -> server-derived scope) and then
// enforces the relevant plan-gated feature before touching any repository or
// external adapter. Reads require the feature to be visible (permission is not
// `none`); writes require `operate`. A sub-`operate` write is rejected with the
// feature-specific authorization message before `work` runs, so no
// state-changing repository or microservice call is ever reached.
// ---------------------------------------------------------------------------

/** The four plan-gated features that guard restaurant Settings surfaces. */
export const RESTAURANT_SETTINGS_FEATURES = [
  "restaurant_config",
  "users",
  "locations",
  "whatsapp",
] as const satisfies readonly SettingsFeature[];

function featureAccess(
  context: AuthenticatedRestaurantSettingsContext,
  feature: SettingsFeature,
): FeaturePermission {
  const access = (context.access as ResolvedAccess | null)?.[feature];
  return {
    available: access?.available === true,
    permission: access?.permission ?? "none",
    visible: access?.visible === true,
  };
}

/**
 * Throws the stable unauthorized error unless the resolved feature is visible
 * to the caller (available AND permission is not `none`). Read-shaped server
 * functions call this before any scoped row read.
 */
export function assertRestaurantSettingsFeatureVisible(
  context: AuthenticatedRestaurantSettingsContext,
  feature: SettingsFeature,
): void {
  const access = featureAccess(context, feature);
  if (!access.available || !access.visible || access.permission === "none") {
    throwUnauthorized();
  }
}

/**
 * Throws the feature-specific authorization message unless the caller resolves
 * `operate` for the feature. This runs before any repository or external call,
 * so a `view_only`/`none` account never reaches a state-changing adapter.
 */
export function assertRestaurantSettingsFeatureOperate(
  context: AuthenticatedRestaurantSettingsContext,
  feature: SettingsFeature,
): void {
  const decision = authoriseSettingsFeatureWrite(
    feature,
    featureAccess(context, feature).permission,
  );
  if (!decision.ok) {
    throw new Error(decision.errors[0]?.message ?? MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
  }
}

export interface GuardedRestaurantSettingsDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
}

const defaultGuardedDependencies = createServerOnlyFn(
  (): GuardedRestaurantSettingsDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
  }),
);

/**
 * Builds the reusable read/write wrappers around one context resolver. The
 * resolver is injectable so authorization can be exercised with fakes and
 * without cookies or SQL.
 */
export function createRestaurantSettingsFeatureGuards(
  overrides: Partial<GuardedRestaurantSettingsDependencies> = {},
) {
  const dependencies: GuardedRestaurantSettingsDependencies = {
    ...defaultGuardedDependencies(),
    ...overrides,
  };

  return {
    /** Resolves the guarded context, requires feature visibility, then reads. */
    async read<T>(
      feature: SettingsFeature,
      input: ResolveRestaurantSettingsContextInput,
      work: (context: AuthenticatedRestaurantSettingsContext) => T | Promise<T>,
    ): Promise<T> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureVisible(context, feature);
      return work(context);
    },
    /** Resolves the guarded context, requires `operate`, then mutates. */
    async write<T>(
      feature: SettingsFeature,
      input: ResolveRestaurantSettingsContextInput,
      work: (context: AuthenticatedRestaurantSettingsContext) => T | Promise<T>,
    ): Promise<T> {
      const context = await dependencies.resolveContext(input);
      // Reject before any repository/external call so no write adapter is reached.
      assertRestaurantSettingsFeatureOperate(context, feature);
      return work(context);
    },
  };
}

let restaurantSettingsFeatureGuardsInstance:
  | ReturnType<typeof createRestaurantSettingsFeatureGuards>
  | undefined;
const restaurantSettingsFeatureGuards = createServerOnlyFn(
  () => (restaurantSettingsFeatureGuardsInstance ??= createRestaurantSettingsFeatureGuards()),
);

/** Requires feature visibility, then runs a scoped read against the resolved context. */
export function withRestaurantSettingsFeatureRead<T>(
  feature: SettingsFeature,
  input: ResolveRestaurantSettingsContextInput,
  work: (context: AuthenticatedRestaurantSettingsContext) => T | Promise<T>,
): Promise<T> {
  return restaurantSettingsFeatureGuards().read(feature, input, work);
}

/** Requires `operate`, then runs a scoped mutation against the resolved context. */
export function withRestaurantSettingsFeatureWrite<T>(
  feature: SettingsFeature,
  input: ResolveRestaurantSettingsContextInput,
  work: (context: AuthenticatedRestaurantSettingsContext) => T | Promise<T>,
): Promise<T> {
  return restaurantSettingsFeatureGuards().write(feature, input, work);
}

// ---------------------------------------------------------------------------
// Guarded Settings bootstrap
//
// One authenticated read that returns everything the Settings shell needs to
// render before any panel loads: derived navigation, per-feature permissions,
// the signed-in account's identity, the profile summary, the owner's validated
// branch choices, and the user/location plan-limit messages. Unresolved feature
// access fails closed to a Profile-only state carrying MSG_FEATURE_ACCESS_
// UNRESOLVED and exposes no mutation capability.
// ---------------------------------------------------------------------------

export interface RestaurantSettingsBootstrapInput extends ResolveRestaurantSettingsContextInput {
  requestedTab?: string | null;
}

export interface RestaurantSettingsIdentity {
  accountId: string;
  tenantId: string;
  role: RestaurantSettingsAccountRole;
  accountType: AccountType;
  email: string;
  locationId: LocationScope;
}

export interface RestaurantSettingsBranchChoice {
  id: string;
  name: string;
  isActive: boolean;
}

export interface RestaurantLocationPlanLimit {
  maximum: number | null;
  current: number;
  remaining: number | null;
  canCreate: boolean;
  message: string;
}

export interface RestaurantSettingsBootstrap {
  accessResolved: boolean;
  message: string | null;
  navigation: RestaurantSettingsNavigation;
  permissions: RestaurantSettingsPermissions | null;
  identity: RestaurantSettingsIdentity;
  profileCapability: ProfileCapabilityViewModel;
  featureCapabilities: Record<SettingsFeature, FeatureCapabilityViewModel>;
  profileSummary: RestaurantProfile | null;
  profilePhoto: string | null;
  branchChoices: RestaurantSettingsBranchChoice[];
  userPlanLimits: SubUserPlanLimits | null;
  locationPlan: RestaurantLocationPlanLimit | null;
}

export interface RestaurantSettingsBootstrapDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  getTenantProfile(tenantId: string): Promise<StoredRestaurantProfile | null>;
  getAccountSecurity(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
  ): Promise<AccountSecuritySnapshot | null>;
  listBranches(tenantId: string): Promise<StoredBranch[]>;
  getSubUserRoleCounts(tenantId: string): Promise<UserRoleCounts>;
}

const defaultBootstrapDependencies = createServerOnlyFn(
  (): RestaurantSettingsBootstrapDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    getTenantProfile: (tenantId) => restaurantSettingsRepository.getTenantProfile(tenantId),
    getAccountSecurity: (tenantId, accountType, accountId) =>
      restaurantSettingsRepository.getAccountSecurity(tenantId, accountType, accountId),
    listBranches: (tenantId) => restaurantSettingsRepository.listBranches(tenantId),
    getSubUserRoleCounts: (tenantId) => restaurantSettingsRepository.getSubUserRoleCounts(tenantId),
  }),
);

function accountTypeForRole(role: RestaurantSettingsAccountRole): AccountType {
  if (role === "admin") return "user";
  if (role === "location") return "location";
  return "sub_user";
}

function toSettingsPermissions(access: ResolvedAccess): RestaurantSettingsPermissions {
  const pick = (feature: SettingsFeature): FeaturePermission => {
    const entry = access[feature];
    return {
      available: entry.available,
      permission: entry.permission,
      visible: entry.visible,
    };
  };
  return {
    restaurant_config: pick("restaurant_config"),
    users: pick("users"),
    locations: pick("locations"),
    whatsapp: pick("whatsapp"),
  };
}

function deriveFeatureCapabilities(
  permissions: RestaurantSettingsPermissions | null,
): Record<SettingsFeature, FeatureCapabilityViewModel> {
  const capability = (feature: SettingsFeature) =>
    deriveFeatureCapabilityViewModel(feature, permissions?.[feature] ?? null);
  return {
    restaurant_config: capability("restaurant_config"),
    users: capability("users"),
    locations: capability("locations"),
    whatsapp: capability("whatsapp"),
  };
}

function profileSummaryOf(row: StoredRestaurantProfile | null): RestaurantProfile | null {
  if (!row) return null;
  return {
    restaurantName: row.restaurantName,
    ownerOrManagerName: row.ownerOrManagerName,
    accountPhone: row.accountPhone,
    teamSize: row.teamSize,
    publicEmail: row.publicEmail,
    contactNumber: row.contactNumber,
    whatsappNumber: row.whatsappNumber,
    landline: row.landline,
    address: row.address,
    cuisineOrServices: row.cuisineOrServices,
    description: row.description,
  };
}

function resolveLocationPlanLimit(
  plan: string | null | undefined,
  current: number,
): RestaurantLocationPlanLimit {
  const tier = normalizePlan(plan);
  const maximum = tier === "Enterprise" ? null : tier === "Premium" ? 1 : 0;
  const remaining = maximum === null ? null : Math.max(0, maximum - current);
  const canCreate = maximum === null || remaining! > 0;
  const label = maximum === null ? "unlimited" : String(maximum);
  const message = `${tier} plan permits ${label} branch${maximum === 1 ? "" : "es"}.`;
  return { maximum, current, remaining, canCreate, message };
}

/**
 * Creates the guarded Settings bootstrap around injectable I/O so navigation,
 * capability, and plan assembly can be tested with fakes.
 */
export function createRestaurantSettingsBootstrap(
  overrides: Partial<RestaurantSettingsBootstrapDependencies> = {},
) {
  const dependencies: RestaurantSettingsBootstrapDependencies = {
    ...defaultBootstrapDependencies(),
    ...overrides,
  };

  return {
    async bootstrap(
      input: RestaurantSettingsBootstrapInput = {},
    ): Promise<RestaurantSettingsBootstrap> {
      const context = await dependencies.resolveContext(input);
      const accountType = accountTypeForRole(context.role);

      // Profile is always reachable, so its summary and the account identity are
      // loaded regardless of whether feature access resolves.
      const [profileRow, security] = await Promise.all([
        dependencies.getTenantProfile(context.tenantId),
        dependencies.getAccountSecurity(context.tenantId, accountType, context.accountId),
      ]);

      const identity: RestaurantSettingsIdentity = {
        accountId: context.accountId,
        tenantId: context.tenantId,
        role: context.role,
        accountType,
        email: security?.email ?? "",
        locationId: context.scope.locationId,
      };
      const profileSummary = profileSummaryOf(profileRow);
      const profilePhoto = security?.profilePhoto ?? null;

      const access = context.access as ResolvedAccess | null;
      if (!access) {
        // Unresolved feature access: Profile only, no mutation capability.
        return {
          accessResolved: false,
          message: MSG_FEATURE_ACCESS_UNRESOLVED,
          navigation: deriveRestaurantSettingsNavigation({
            access: null,
            requestedTab: input.requestedTab,
          }),
          permissions: null,
          identity,
          profileCapability: deriveProfileCapabilityViewModel(null),
          featureCapabilities: deriveFeatureCapabilities(null),
          profileSummary,
          profilePhoto,
          branchChoices: [],
          userPlanLimits: null,
          locationPlan: null,
        };
      }

      const permissions = toSettingsPermissions(access);
      const navigation = deriveRestaurantSettingsNavigation({
        access: permissions,
        requestedTab: input.requestedTab,
      });

      let userPlanLimits: SubUserPlanLimits | null = null;
      if (permissions.users.visible) {
        const counts = await dependencies.getSubUserRoleCounts(context.tenantId);
        userPlanLimits = resolveSubUserPlanLimits(context.session.subscriptionPlan, counts);
      }

      let branchChoices: RestaurantSettingsBranchChoice[] = [];
      let locationPlan: RestaurantLocationPlanLimit | null = null;
      // Location visibility already requires the owner role, so only the owner
      // receives validated (tenant-scoped) branch choices to select.
      if (permissions.locations.visible) {
        const branches = await dependencies.listBranches(context.tenantId);
        branchChoices = branches.map((branch) => ({
          id: branch.id,
          name: branch.name,
          isActive: branch.isActive,
        }));
        locationPlan = resolveLocationPlanLimit(context.session.subscriptionPlan, branches.length);
      }

      return {
        accessResolved: true,
        message: null,
        navigation,
        permissions,
        identity,
        profileCapability: deriveProfileCapabilityViewModel(
          permissions.restaurant_config.permission,
        ),
        featureCapabilities: deriveFeatureCapabilities(permissions),
        profileSummary,
        profilePhoto,
        branchChoices,
        userPlanLimits,
        locationPlan,
      };
    },
  };
}

let restaurantSettingsBootstrapInstance:
  | ReturnType<typeof createRestaurantSettingsBootstrap>
  | undefined;
const restaurantSettingsBootstrap = createServerOnlyFn(
  () => (restaurantSettingsBootstrapInstance ??= createRestaurantSettingsBootstrap()),
);

/** Default production entry point for the guarded Settings bootstrap read. */
export function getRestaurantSettingsBootstrap(
  input: RestaurantSettingsBootstrapInput = {},
): Promise<RestaurantSettingsBootstrap> {
  return restaurantSettingsBootstrap().bootstrap(input);
}

/**
 * Authenticated `createServerFn` boundary consumed by the Settings shell. The
 * owner may request a validated branch scope, and the caller may pass the
 * requested sub-tab so the pure navigation helper can pre-select it (falling
 * back to the first visible tab). Session, feature access, and scope are all
 * resolved server-side (Req 1.7-1.9, 2.1, 7.1, 8.1, 9.1, 10.1, 10.2).
 */
export const getRestaurantSettingsBootstrapServerFn = createServerFn({ method: "GET" })
  .validator((data?: { requestedTab?: string | null; requestedLocationId?: string | null }) => ({
    requestedTab: data?.requestedTab ?? null,
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => getRestaurantSettingsBootstrap(data));

// ---------------------------------------------------------------------------
// Public restaurant menu projection
//
// The guest-facing public menu read (`/book/{tenantId}`, Req 6.9-6.11, 9.5,
// 11.4) lives in `./restaurant-public` so the booking route's client bundle
// never pulls in this module's server-only `auth.server` import graph. It is
// re-exported here so existing importers and tests keep the same entry points.
// ---------------------------------------------------------------------------

export {
  createPublicRestaurantMenuReader,
  getPublicRestaurantMenu,
  getPublicRestaurantMenuServerFn,
  type PublicRestaurantMenuDependencies,
} from "./restaurant-public";

// ---------------------------------------------------------------------------
// Restaurant profile read/save
//
// The `Restaurant Profile` sub-tab is always reachable, so the read here is
// never gated on a plan feature: any authenticated Settings account may read
// its tenant profile plus its own account identity (Req 2.1, 2.5). The view
// carries the canonical `/book/{tenantId}` booking path and the tenant id only
// — never a caller-provided URL — so the browser builds the absolute portal
// link from its own origin (design: Profile and account security).
//
// Profile mutation stays permission-gated: a save is exposed and accepted only
// when `restaurant_config` resolves `operate` (Req 2.6, 2.7). `view_only` and
// `none` receive the profile read-only with `canSave: false` and no save path
// (Req 2.8, 2.9, 10.3, 10.4). A save trims every submitted field with the pure
// `normaliseRestaurantProfile` (Req 2.7, 11.1) and persists it atomically while
// synchronizing the owner's compatibility fields (Req 11.2).
// ---------------------------------------------------------------------------

export interface RestaurantProfileView {
  /** Canonical booking path; the browser prefixes its own origin. Never a caller URL. */
  bookingPath: string;
  tenantId: string;
  /** Merged tenant profile fields (empty strings when no profile row exists yet). */
  profile: RestaurantProfile;
  /** The signed-in account's own login email, used by the account-security section. */
  accountEmail: string;
  /** The signed-in account's stored profile photo URL, if any. */
  profilePhoto: string | null;
  /** Presentation model; security is always shown, editing follows config permission. */
  capability: ProfileCapabilityViewModel;
  /** True exactly when `restaurant_config` resolves `operate`. */
  canSave: boolean;
}

export interface RestaurantProfileSaveInput extends ResolveRestaurantSettingsContextInput {
  profile: RestaurantProfileInput;
}

export interface RestaurantProfileServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  getTenantProfile(tenantId: string): Promise<StoredRestaurantProfile | null>;
  getAccountSecurity(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
  ): Promise<AccountSecuritySnapshot | null>;
  /** Atomically stores the trimmed profile and syncs the owner compatibility fields. */
  saveProfile(tenantId: string, profile: RestaurantProfile): Promise<StoredRestaurantProfile>;
}

const defaultProfileDependencies = createServerOnlyFn(
  (): RestaurantProfileServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    getTenantProfile: (tenantId) => restaurantSettingsRepository.getTenantProfile(tenantId),
    getAccountSecurity: (tenantId, accountType, accountId) =>
      restaurantSettingsRepository.getAccountSecurity(tenantId, accountType, accountId),
    saveProfile: (tenantId, profile) =>
      restaurantSettingsRepository.saveRestaurantProfile(tenantId, profile),
  }),
);

/** The canonical booking portal path of a tenant. Never derived from caller input. */
export function canonicalBookingPath(tenantId: string): string {
  return `/book/${tenantId}`;
}

function buildRestaurantProfileView(
  context: AuthenticatedRestaurantSettingsContext,
  profileRow: StoredRestaurantProfile | null,
  security: AccountSecuritySnapshot | null,
): RestaurantProfileView {
  const access = context.access as ResolvedAccess | null;
  const configPermission = access?.restaurant_config?.permission ?? null;
  return {
    bookingPath: canonicalBookingPath(context.tenantId),
    tenantId: context.tenantId,
    // The tenant profile provides every restaurant field; an absent row yields
    // fully-trimmed empty defaults from the same pure normalizer used on save.
    profile: profileSummaryOf(profileRow) ?? normaliseRestaurantProfile({}),
    accountEmail: security?.email ?? "",
    profilePhoto: security?.profilePhoto ?? null,
    capability: deriveProfileCapabilityViewModel(configPermission),
    canSave: configPermission === "operate",
  };
}

/**
 * Builds the profile read/save service around injectable I/O so authorization,
 * merging, and atomic-save behavior can be exercised with fakes and without
 * cookies or SQL.
 */
export function createRestaurantProfileService(
  overrides: Partial<RestaurantProfileServiceDependencies> = {},
) {
  const dependencies: RestaurantProfileServiceDependencies = {
    ...defaultProfileDependencies(),
    ...overrides,
  };

  return {
    /** Any authenticated Settings account may read; editing follows config permission. */
    async read(input: ResolveRestaurantSettingsContextInput = {}): Promise<RestaurantProfileView> {
      const context = await dependencies.resolveContext(input);
      const accountType = accountTypeForRole(context.role);
      const [profileRow, security] = await Promise.all([
        dependencies.getTenantProfile(context.tenantId),
        dependencies.getAccountSecurity(context.tenantId, accountType, context.accountId),
      ]);
      return buildRestaurantProfileView(context, profileRow, security);
    },
    /** Requires `restaurant_config: operate`, then trims and atomically persists. */
    async save(input: RestaurantProfileSaveInput): Promise<RestaurantProfileView> {
      const context = await dependencies.resolveContext(input);
      // Reject before any repository write so view_only/none never persist.
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");
      const profile = normaliseRestaurantProfile(input.profile);
      const stored = await dependencies.saveProfile(context.tenantId, profile);
      const security = await dependencies.getAccountSecurity(
        context.tenantId,
        accountTypeForRole(context.role),
        context.accountId,
      );
      return buildRestaurantProfileView(context, stored, security);
    },
  };
}

let restaurantProfileServiceInstance: ReturnType<typeof createRestaurantProfileService> | undefined;
const restaurantProfileService = createServerOnlyFn(
  () => (restaurantProfileServiceInstance ??= createRestaurantProfileService()),
);

/** Default production entry point: reads the tenant profile and account identity. */
export function getRestaurantProfile(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<RestaurantProfileView> {
  return restaurantProfileService().read(input);
}

/** Default production entry point: trims and atomically saves the tenant profile. */
export function saveRestaurantProfile(
  input: RestaurantProfileSaveInput,
): Promise<RestaurantProfileView> {
  return restaurantProfileService().save(input);
}

/**
 * Authenticated read consumed by the `Restaurant Profile` sub-tab. Returns the
 * canonical booking path, tenant id, merged profile fields, account identity,
 * and the permission-derived capability view model.
 */
export const getRestaurantProfileServerFn = createServerFn({ method: "GET" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => getRestaurantProfile(data));

/**
 * Guarded profile write consumed by the `Restaurant Profile` sub-tab. Only an
 * account resolving `restaurant_config: operate` reaches the atomic store; every
 * submitted field is trimmed server-side before persistence.
 */
export const saveRestaurantProfileServerFn = createServerFn({ method: "POST" })
  .validator((data: { profile: RestaurantProfileInput; requestedLocationId?: string | null }) => {
    if (!data || typeof data !== "object" || data.profile == null) {
      throw new Error("Profile fields are required");
    }
    return {
      profile: data.profile,
      requestedLocationId: data.requestedLocationId ?? null,
    };
  })
  .handler(({ data }) => saveRestaurantProfile(data));

// ---------------------------------------------------------------------------
// Role-aware profile photo upload
//
// A profile photo change is exposed and accepted only when `restaurant_config`
// resolves `operate` (Req 2.10). The guard rejects a sub-`operate` account
// before any decode, upload, or row write runs, so `view_only`/`none` never
// reach the uploader (Req 10.3, 10.4). For an `operate` account the submitted
// data URL is decoded to its detected MIME and exact byte length and checked by
// the pure `validateProfilePhoto` (JPEG/PNG/WEBP, <= 5 MiB) BEFORE any upload;
// an invalid photo is rejected with the size/format message and the previously
// stored URL is retained unchanged (Req 2.12). Only after a successful upload is
// the correct account row (User/SubUser/Location per role) updated, so a
// validation or upload failure never overwrites the stored photo (Req 2.11).
// ---------------------------------------------------------------------------

/** Injected uploader input; production sends the raw data URL to Cloudinary. */
export interface ProfilePhotoUploadRequest {
  dataUrl: string;
  tenantId: string;
  accountType: AccountType;
  accountId: string;
}

export interface UploadRestaurantProfilePhotoInput extends ResolveRestaurantSettingsContextInput {
  /** A `data:<mime>;base64,<payload>` image URL. */
  dataUrl: string;
}

export interface RestaurantProfilePhotoResult {
  /** `uploaded` on success; `invalid`/`upload_failed` preserve the stored photo. */
  status: "uploaded" | "invalid" | "upload_failed";
  /** New URL on success; the previously stored URL (or null) on any failure. */
  profilePhoto: string | null;
  /** The size/format message on failure; `null` on success. */
  message: string | null;
}

export interface RestaurantProfilePhotoServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  getAccountSecurity(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
  ): Promise<AccountSecuritySnapshot | null>;
  /** Uploads the decoded image and resolves the stored secure URL. */
  uploadProfilePhoto(request: ProfilePhotoUploadRequest): Promise<string>;
  /** Persists the uploaded URL against exactly one account row. */
  updateAccountProfilePhoto(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
    profilePhotoUrl: string,
  ): Promise<boolean>;
}

/** Default production uploader: reuses the existing Cloudinary integration. */
async function uploadProfilePhotoToCloudinary(request: ProfilePhotoUploadRequest): Promise<string> {
  const cloudinary = await import("cloudinary");
  const cloud = cloudinary.v2;
  cloud.config({
    cloud_name: process.env["CLOUDINARY_CLOUD_NAME"],
    api_key: process.env["CLOUDINARY_API_KEY"],
    api_secret: process.env["CLOUDINARY_API_SECRET"],
  });
  const result = await cloud.uploader.upload(request.dataUrl, {
    folder: "bookmytime/profiles",
    public_id: `profile_${request.accountType}_${request.accountId}`,
    overwrite: true,
    transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
  });
  const url = result?.secure_url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("Cloudinary upload returned no secure URL");
  }
  return url;
}

const defaultProfilePhotoDependencies = createServerOnlyFn(
  (): RestaurantProfilePhotoServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    getAccountSecurity: (tenantId, accountType, accountId) =>
      restaurantSettingsRepository.getAccountSecurity(tenantId, accountType, accountId),
    uploadProfilePhoto: (request) => uploadProfilePhotoToCloudinary(request),
    updateAccountProfilePhoto: (tenantId, accountType, accountId, url) =>
      restaurantSettingsRepository.updateAccountProfilePhoto(tenantId, accountType, accountId, url),
  }),
);

/**
 * Builds the role-aware photo upload service around injectable I/O so
 * authorization, pre-upload validation, and the upload-then-persist ordering
 * can be exercised with fake uploaders and without cookies, SQL, or Cloudinary.
 */
export function createRestaurantProfilePhotoService(
  overrides: Partial<RestaurantProfilePhotoServiceDependencies> = {},
) {
  const dependencies: RestaurantProfilePhotoServiceDependencies = {
    ...defaultProfilePhotoDependencies(),
    ...overrides,
  };

  return {
    async upload(input: UploadRestaurantProfilePhotoInput): Promise<RestaurantProfilePhotoResult> {
      const context = await dependencies.resolveContext(input);
      // Reject a sub-`operate` account before any decode, upload, or row write.
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");

      const accountType = accountTypeForRole(context.role);
      const security = await dependencies.getAccountSecurity(
        context.tenantId,
        accountType,
        context.accountId,
      );
      const previousPhoto = security?.profilePhoto ?? null;

      // Validate detected MIME and decoded byte length BEFORE any upload; an
      // unparseable data URL yields the same size/format rejection.
      const decoded = parseImageDataUrl(input.dataUrl);
      const validation = validateProfilePhoto({
        mimeType: decoded?.mimeType,
        byteLength: decoded?.byteLength,
      });
      if (!validation.ok || !decoded) {
        return { status: "invalid", profilePhoto: previousPhoto, message: MSG_PROFILE_PHOTO };
      }

      let uploadedUrl: string;
      try {
        uploadedUrl = await dependencies.uploadProfilePhoto({
          dataUrl: input.dataUrl,
          tenantId: context.tenantId,
          accountType,
          accountId: context.accountId,
        });
      } catch {
        // Upload failed: never touch the stored row, retain the previous photo.
        return { status: "upload_failed", profilePhoto: previousPhoto, message: MSG_PROFILE_PHOTO };
      }

      // Persist only after upload success, against the role-specific account row.
      const updated = await dependencies.updateAccountProfilePhoto(
        context.tenantId,
        accountType,
        context.accountId,
        uploadedUrl,
      );
      if (!updated) {
        return { status: "upload_failed", profilePhoto: previousPhoto, message: MSG_PROFILE_PHOTO };
      }

      return { status: "uploaded", profilePhoto: uploadedUrl, message: null };
    },
  };
}

let restaurantProfilePhotoServiceInstance:
  | ReturnType<typeof createRestaurantProfilePhotoService>
  | undefined;
const restaurantProfilePhotoService = createServerOnlyFn(
  () => (restaurantProfilePhotoServiceInstance ??= createRestaurantProfilePhotoService()),
);

/** Default production entry point: validates, uploads, then persists the photo. */
export function uploadRestaurantProfilePhoto(
  input: UploadRestaurantProfilePhotoInput,
): Promise<RestaurantProfilePhotoResult> {
  return restaurantProfilePhotoService().upload(input);
}

/**
 * Guarded profile photo upload consumed by the `Restaurant Profile` sub-tab.
 * Only an account resolving `restaurant_config: operate` reaches decode, upload,
 * and persistence; validation or upload failure retains the stored photo and
 * returns the size/format message.
 */
export const uploadRestaurantProfilePhotoServerFn = createServerFn({ method: "POST" })
  .validator((data: { dataUrl: string; requestedLocationId?: string | null }) => {
    if (!data || typeof data.dataUrl !== "string" || data.dataUrl.length === 0) {
      throw new Error("Profile photo data is required");
    }
    return {
      dataUrl: data.dataUrl,
      requestedLocationId: data.requestedLocationId ?? null,
    };
  })
  .handler(({ data }) => uploadRestaurantProfilePhoto(data));

// ---------------------------------------------------------------------------
// Self-service account email-change lifecycle
//
// Changing the signed-in account's login email is available to EVERY
// authenticated Settings account, independent of `restaurant_config`
// permission (Req 2.13): the operations below never call a feature guard, only
// the shared authenticated boundary that resolves the account identity.
//
// request (Req 2.15, 2.17, 2.18): a submitted address equal to the account's
// current email is rejected as already-registered-to-account and a submitted
// address held by any other account is rejected as registered-to-another; in
// both cases NO code is generated or sent. Otherwise a cryptographically secure
// exactly-4-digit code is generated, stored hashed (never in plain text) with
// an account/email binding, an exact 5-minute validity, and an exact 60-second
// resend boundary, then emailed to the target address.
//
// resend (Req 2.16): re-issues a fresh code for the same bound target under the
// same 60-second rule; a resend before the stored boundary is refused and no
// new code is issued or sent.
//
// confirm (Req 2.19, 2.20): accepts only a code that matches the stored hash in
// constant time for the same account and normalized target email while
// unexpired, then transactionally rechecks cross-account uniqueness, updates
// exactly the signed-in account's row (User/SubUser/Location), and consumes all
// outstanding codes. Any invalid, expired, mismatched, raced, or already-used
// code leaves the stored email unchanged.
// ---------------------------------------------------------------------------

/** Refused when a resend is attempted before the stored 60-second boundary. */
export const MSG_EMAIL_VERIFICATION_RESEND_TOO_SOON =
  "Please wait before requesting another verification code";
/** Returned when a resend is attempted with no outstanding verification. */
export const MSG_EMAIL_VERIFICATION_NONE_PENDING = "Request a verification code before resending";

export interface AccountEmailChangeRequestInput extends ResolveRestaurantSettingsContextInput {
  email: string;
}

export interface AccountEmailChangeConfirmInput extends ResolveRestaurantSettingsContextInput {
  email: string;
  code: string;
}

export interface AccountEmailChangeRequestResult {
  /** `code_sent` on issue; every other status sends no code. */
  status: "code_sent" | "email_current" | "email_in_use" | "resend_too_soon" | "no_pending";
  message: string | null;
  /** The normalized target address a code was issued for; `null` on rejection. */
  targetEmail: string | null;
  /** Exact epoch-ms instant the resend control becomes usable; `null` on rejection. */
  resendAvailableAtMs: number | null;
  /** Exact epoch-ms code expiry; `null` on rejection. */
  expiresAtMs: number | null;
}

export interface AccountEmailChangeConfirmResult {
  /** `updated` on success; every other status leaves the stored email unchanged. */
  status: "updated" | "invalid_code" | "email_in_use" | "not_found";
  message: string | null;
  /** The new email on success; the unchanged current email on failure. */
  email: string;
}

export interface AccountEmailChangeVerificationBinding {
  accountType: AccountType;
  accountId: string;
}

export interface RestaurantAccountEmailServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  getAccountSecurity(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
  ): Promise<AccountSecuritySnapshot | null>;
  isAccountEmailAvailable(
    email: string,
    current: AccountEmailChangeVerificationBinding,
  ): Promise<boolean>;
  getActiveEmailVerification(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
  ): Promise<StoredEmailVerification | null>;
  saveEmailVerification(tenantId: string, input: SaveEmailVerificationInput): Promise<string>;
  confirmAccountEmailChange(
    tenantId: string,
    input: {
      accountType: AccountType;
      accountId: string;
      verificationId: string;
      targetEmail: string;
      consumedAtMs: number;
    },
  ): Promise<AccountEmailChangeResult>;
  /** Hashes a code bound to the account so a stored hash never reveals the code. */
  hashVerificationCode(binding: AccountEmailChangeVerificationBinding, code: string): string;
  /** Generates a cryptographically secure, exactly-4-digit code (leading zeros kept). */
  generateVerificationCode(): string;
  /** Delivers the plaintext code to the target address. */
  sendVerificationCode(email: string, code: string): Promise<void>;
  now(): number;
}

// The three helpers below are the only consumers of `node:crypto`. They are
// marked server-only so the import is stripped from the client bundle rather
// than evaluating Vite's browser-external stub during hydration.

/** Cryptographically secure exactly-4-digit code; leading zeros are preserved. */
const generateSecureVerificationCode = createServerOnlyFn((): string => {
  const ceiling = 10 ** LIMITS.verificationCodeDigits;
  return String(randomInt(0, ceiling)).padStart(LIMITS.verificationCodeDigits, "0");
});

/** Account-bound SHA-256 code hash so a leaked row never discloses the code. */
const hashAccountVerificationCode = createServerOnlyFn(
  (binding: AccountEmailChangeVerificationBinding, code: string): string =>
    createHash("sha256")
      .update(`${binding.accountType}:${binding.accountId}:${code}`, "utf8")
      .digest("hex"),
);

/** Length-guarded constant-time hash comparison. */
const constantTimeHashEqual = createServerOnlyFn((a: string, b: string): boolean => {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
});

const defaultAccountEmailDependencies = createServerOnlyFn(
  (): RestaurantAccountEmailServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    getAccountSecurity: (tenantId, accountType, accountId) =>
      restaurantSettingsRepository.getAccountSecurity(tenantId, accountType, accountId),
    isAccountEmailAvailable: (email, current) =>
      restaurantSettingsRepository.isAccountEmailAvailable(email, current),
    getActiveEmailVerification: (tenantId, accountType, accountId) =>
      restaurantSettingsRepository.getActiveEmailVerification(tenantId, accountType, accountId),
    saveEmailVerification: (tenantId, input) =>
      restaurantSettingsRepository.saveEmailVerification(tenantId, input),
    confirmAccountEmailChange: (tenantId, input) =>
      restaurantSettingsRepository.confirmAccountEmailChange(tenantId, input),
    hashVerificationCode: hashAccountVerificationCode,
    generateVerificationCode: generateSecureVerificationCode,
    sendVerificationCode: async (email, code) => {
      await sendOtpEmail(email, code);
    },
    now: () => Date.now(),
  }),
);

/**
 * Builds the self-service email-change service around injectable I/O so
 * uniqueness, timing, hashing, and transactional confirmation can be exercised
 * with fakes and without cookies, SQL, crypto, or an email transport.
 */
export function createRestaurantAccountEmailService(
  overrides: Partial<RestaurantAccountEmailServiceDependencies> = {},
) {
  const dependencies: RestaurantAccountEmailServiceDependencies = {
    ...defaultAccountEmailDependencies(),
    ...overrides,
  };

  /** Generates, hashes, stores, and sends a fresh code for one bound target. */
  async function issueCode(
    context: AuthenticatedRestaurantSettingsContext,
    binding: AccountEmailChangeVerificationBinding,
    targetEmail: string,
  ): Promise<{ resendAvailableAtMs: number; expiresAtMs: number }> {
    const code = dependencies.generateVerificationCode();
    const timing = createVerificationTiming(dependencies.now());
    await dependencies.saveEmailVerification(context.tenantId, {
      accountType: binding.accountType,
      accountId: binding.accountId,
      targetEmail,
      codeHash: dependencies.hashVerificationCode(binding, code),
      expiresAtMs: timing.expiresAtMs,
      resendAvailableAtMs: timing.resendAvailableAtMs,
    });
    // The code is stored only as a hash; deliver the plaintext out-of-band. A
    // delivery failure never rolls back the stored code — the account can
    // resend once the 60-second boundary passes.
    try {
      await dependencies.sendVerificationCode(targetEmail, code);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[Restaurant] Email-change code delivery failed for account ${binding.accountId}: ${detail}`,
      );
    }
    return { resendAvailableAtMs: timing.resendAvailableAtMs, expiresAtMs: timing.expiresAtMs };
  }

  return {
    /** Rejects current/in-use addresses without sending; otherwise issues a code. */
    async request(input: AccountEmailChangeRequestInput): Promise<AccountEmailChangeRequestResult> {
      const context = await dependencies.resolveContext(input);
      const binding: AccountEmailChangeVerificationBinding = {
        accountType: accountTypeForRole(context.role),
        accountId: context.accountId,
      };
      const targetEmail = normaliseEmail(input.email);
      const security = await dependencies.getAccountSecurity(
        context.tenantId,
        binding.accountType,
        binding.accountId,
      );

      // Same-as-current: reject and send nothing (Req 2.17).
      if (targetEmail.length === 0 || targetEmail === normaliseEmail(security?.email)) {
        return {
          status: "email_current",
          message: MSG_EMAIL_ALREADY_CURRENT,
          targetEmail: null,
          resendAvailableAtMs: null,
          expiresAtMs: null,
        };
      }

      // Registered to another account: reject and send nothing (Req 2.18).
      const available = await dependencies.isAccountEmailAvailable(targetEmail, binding);
      if (!available) {
        return {
          status: "email_in_use",
          message: MSG_EMAIL_ALREADY_IN_USE,
          targetEmail: null,
          resendAvailableAtMs: null,
          expiresAtMs: null,
        };
      }

      const timing = await issueCode(context, binding, targetEmail);
      return {
        status: "code_sent",
        message: null,
        targetEmail,
        resendAvailableAtMs: timing.resendAvailableAtMs,
        expiresAtMs: timing.expiresAtMs,
      };
    },

    /** Re-issues a code for the outstanding target under the 60-second rule. */
    async resend(
      input: ResolveRestaurantSettingsContextInput = {},
    ): Promise<AccountEmailChangeRequestResult> {
      const context = await dependencies.resolveContext(input);
      const binding: AccountEmailChangeVerificationBinding = {
        accountType: accountTypeForRole(context.role),
        accountId: context.accountId,
      };
      const active = await dependencies.getActiveEmailVerification(
        context.tenantId,
        binding.accountType,
        binding.accountId,
      );

      // Nothing outstanding to resend: request a code first.
      if (!active) {
        return {
          status: "no_pending",
          message: MSG_EMAIL_VERIFICATION_NONE_PENDING,
          targetEmail: null,
          resendAvailableAtMs: null,
          expiresAtMs: null,
        };
      }

      // Enforce the exact 60-second resend boundary server-side (Req 2.16).
      if (!canResendEmailVerification(active, dependencies.now())) {
        return {
          status: "resend_too_soon",
          message: MSG_EMAIL_VERIFICATION_RESEND_TOO_SOON,
          targetEmail: active.targetEmail,
          resendAvailableAtMs: active.resendAvailableAtMs,
          expiresAtMs: active.expiresAtMs,
        };
      }

      const timing = await issueCode(context, binding, normaliseEmail(active.targetEmail));
      return {
        status: "code_sent",
        message: null,
        targetEmail: normaliseEmail(active.targetEmail),
        resendAvailableAtMs: timing.resendAvailableAtMs,
        expiresAtMs: timing.expiresAtMs,
      };
    },

    /** Confirms a matching unexpired code and transactionally updates the row. */
    async confirm(input: AccountEmailChangeConfirmInput): Promise<AccountEmailChangeConfirmResult> {
      const context = await dependencies.resolveContext(input);
      const binding: AccountEmailChangeVerificationBinding = {
        accountType: accountTypeForRole(context.role),
        accountId: context.accountId,
      };
      const [security, active] = await Promise.all([
        dependencies.getAccountSecurity(context.tenantId, binding.accountType, binding.accountId),
        dependencies.getActiveEmailVerification(
          context.tenantId,
          binding.accountType,
          binding.accountId,
        ),
      ]);
      const currentEmail = security?.email ?? "";

      // No outstanding code can ever match an incoming submission.
      if (!active) {
        return {
          status: "invalid_code",
          message: MSG_VERIFICATION_INVALID_OR_EXPIRED,
          email: currentEmail,
        };
      }

      // Constant-time hash comparison bound to this account; the pure attempt
      // validator then enforces shape, binding, and 5-minute validity.
      const codeMatches =
        typeof input.code === "string" &&
        constantTimeHashEqual(
          dependencies.hashVerificationCode(binding, input.code),
          active.codeHash,
        );
      const attempt = validateEmailVerificationAttempt(
        active,
        {
          accountType: binding.accountType,
          accountId: binding.accountId,
          targetEmail: input.email,
          code: input.code,
        },
        dependencies.now(),
        codeMatches,
      );
      if (!attempt.ok) {
        return {
          status: "invalid_code",
          message: MSG_VERIFICATION_INVALID_OR_EXPIRED,
          email: currentEmail,
        };
      }

      // Transactionally recheck uniqueness, update exactly this row, and consume
      // every outstanding code. Any failure leaves the stored email unchanged.
      const result = await dependencies.confirmAccountEmailChange(context.tenantId, {
        accountType: binding.accountType,
        accountId: binding.accountId,
        verificationId: active.id,
        targetEmail: attempt.value.targetEmail,
        consumedAtMs: dependencies.now(),
      });
      if (result.status === "updated") {
        return { status: "updated", message: null, email: attempt.value.targetEmail };
      }
      if (result.status === "email_taken") {
        return {
          status: "email_in_use",
          message: MSG_EMAIL_ALREADY_IN_USE,
          email: currentEmail,
        };
      }
      if (result.status === "verification_invalid") {
        return {
          status: "invalid_code",
          message: MSG_VERIFICATION_INVALID_OR_EXPIRED,
          email: currentEmail,
        };
      }
      return {
        status: "not_found",
        message: MSG_SETTINGS_RESOURCE_NOT_FOUND,
        email: currentEmail,
      };
    },
  };
}

let restaurantAccountEmailServiceInstance:
  | ReturnType<typeof createRestaurantAccountEmailService>
  | undefined;
const restaurantAccountEmailService = createServerOnlyFn(
  () => (restaurantAccountEmailServiceInstance ??= createRestaurantAccountEmailService()),
);

/** Default production entry point: requests an account email-change code. */
export function requestAccountEmailChange(
  input: AccountEmailChangeRequestInput,
): Promise<AccountEmailChangeRequestResult> {
  return restaurantAccountEmailService().request(input);
}

/** Default production entry point: resends the outstanding email-change code. */
export function resendAccountEmailChange(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<AccountEmailChangeRequestResult> {
  return restaurantAccountEmailService().resend(input);
}

/** Default production entry point: confirms an account email-change code. */
export function confirmAccountEmailChange(
  input: AccountEmailChangeConfirmInput,
): Promise<AccountEmailChangeConfirmResult> {
  return restaurantAccountEmailService().confirm(input);
}

function requireEmailArgument(value: unknown): string {
  if (typeof value !== "string" || !value.includes("@")) {
    throw new Error("A valid email address is required");
  }
  return value;
}

/**
 * Self-service request consumed by the Account Security section. Available to
 * every authenticated Settings account; sends a code only for an address that
 * is neither the account's current email nor held by another account.
 */
export const requestAccountEmailChangeServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; requestedLocationId?: string | null }) => ({
    email: requireEmailArgument(data?.email),
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => requestAccountEmailChange(data));

/**
 * Self-service resend consumed by the Account Security section. Re-issues a
 * fresh code for the outstanding target under the exact 60-second rule.
 */
export const resendAccountEmailChangeServerFn = createServerFn({ method: "POST" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => resendAccountEmailChange(data));

/**
 * Self-service confirmation consumed by the Account Security section. Only a
 * matching, unexpired, account/email-bound code updates the signed-in account's
 * row; every other outcome leaves the stored email unchanged.
 */
export const confirmAccountEmailChangeServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; code: string; requestedLocationId?: string | null }) => {
    if (typeof data?.code !== "string" || data.code.length === 0) {
      throw new Error("A verification code is required");
    }
    return {
      email: requireEmailArgument(data?.email),
      code: data.code,
      requestedLocationId: data?.requestedLocationId ?? null,
    };
  })
  .handler(({ data }) => confirmAccountEmailChange(data));

// ---------------------------------------------------------------------------
// Self-service own-password change
//
// The Account Security section is available to every authenticated Settings
// account independent of Config_Permission (Req 2.13), so a password change is
// never gated on a plan feature: it always targets the signed-in account's own
// stored credential row (User / SubUser / Location, per role).
//
// The change succeeds only when the submitted current password matches the
// stored hash (Req 2.21) and the new password is at least 8 characters (Req
// 2.23) with a matching confirmation (Req 2.22). The pure
// `validatePasswordChangeInput` reports the length and confirmation failures
// together, and the current-password check is a constant-time hash comparison
// reusing the same bcrypt convention as `auth.ts`. On any failure — mismatched
// confirmation, too-short new password, or incorrect current password — the
// stored hash is left unchanged and the requirement-specific message is
// returned (Req 2.22-2.24).
// ---------------------------------------------------------------------------

export interface AccountPasswordChangeInput extends ResolveRestaurantSettingsContextInput {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}

export type AccountPasswordChangeField = "currentPassword" | "newPassword" | "confirmation";

export interface AccountPasswordChangeResult {
  /** `updated` on success; every other status leaves the stored hash unchanged. */
  status: "updated" | "invalid_input" | "current_incorrect" | "not_found";
  message: string | null;
  /** Every applicable field-level failure; empty on success. */
  fieldErrors: FieldError<AccountPasswordChangeField>[];
}

export interface RestaurantAccountPasswordServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  getAccountSecurity(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
  ): Promise<AccountSecuritySnapshot | null>;
  updateAccountPassword(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
    passwordHash: string,
  ): Promise<boolean>;
  /** Constant-time verification of a plaintext password against a stored hash. */
  verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean>;
  /** Hashes a new plaintext password with the shared bcrypt cost convention. */
  hashPassword(plainPassword: string): Promise<string>;
}

/** Matches the bcrypt cost factor used by `auth.ts` for every credential write. */
const PASSWORD_HASH_COST = 10;

const defaultAccountPasswordDependencies = createServerOnlyFn(
  (): RestaurantAccountPasswordServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    getAccountSecurity: (tenantId, accountType, accountId) =>
      restaurantSettingsRepository.getAccountSecurity(tenantId, accountType, accountId),
    updateAccountPassword: (tenantId, accountType, accountId, passwordHash) =>
      restaurantSettingsRepository.updateAccountPassword(
        tenantId,
        accountType,
        accountId,
        passwordHash,
      ),
    verifyPassword: (plainPassword, passwordHash) => bcrypt.compare(plainPassword, passwordHash),
    hashPassword: (plainPassword) => bcrypt.hash(plainPassword, PASSWORD_HASH_COST),
  }),
);

/**
 * Builds the self-service password-change service around injectable I/O so the
 * validation order, current-password verification, and single-account update
 * can be exercised with fakes and without cookies, SQL, or bcrypt.
 */
export function createRestaurantAccountPasswordService(
  overrides: Partial<RestaurantAccountPasswordServiceDependencies> = {},
) {
  const dependencies: RestaurantAccountPasswordServiceDependencies = {
    ...defaultAccountPasswordDependencies(),
    ...overrides,
  };

  return {
    async change(input: AccountPasswordChangeInput): Promise<AccountPasswordChangeResult> {
      const context = await dependencies.resolveContext(input);
      const accountType = accountTypeForRole(context.role);

      // Validate the new password and confirmation first; the pure validator
      // reports the 8-character minimum and the mismatch together (Req 2.22, 2.23).
      const validated = validatePasswordChangeInput({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        confirmation: input.confirmation,
      });
      if (!validated.ok) {
        return {
          status: "invalid_input",
          message: validated.errors[0]?.message ?? null,
          fieldErrors: validated.errors,
        };
      }

      // The account row is required to verify the current password. A missing
      // row can never authenticate, so no hash is ever written.
      const security = await dependencies.getAccountSecurity(
        context.tenantId,
        accountType,
        context.accountId,
      );
      if (!security) {
        return {
          status: "not_found",
          message: MSG_SETTINGS_RESOURCE_NOT_FOUND,
          fieldErrors: [],
        };
      }

      // Verify the submitted current password against the stored hash (Req 2.21,
      // 2.24). A mismatch leaves the stored hash unchanged.
      const currentMatches = await dependencies.verifyPassword(
        validated.value.currentPassword,
        security.passwordHash,
      );
      if (!currentMatches) {
        return {
          status: "current_incorrect",
          message: MSG_CURRENT_PASSWORD_INCORRECT,
          fieldErrors: [{ field: "currentPassword", message: MSG_CURRENT_PASSWORD_INCORRECT }],
        };
      }

      // Update exactly the signed-in account's stored hash (Req 2.21).
      const passwordHash = await dependencies.hashPassword(validated.value.newPassword);
      const updated = await dependencies.updateAccountPassword(
        context.tenantId,
        accountType,
        context.accountId,
        passwordHash,
      );
      if (!updated) {
        return {
          status: "not_found",
          message: MSG_SETTINGS_RESOURCE_NOT_FOUND,
          fieldErrors: [],
        };
      }
      return { status: "updated", message: null, fieldErrors: [] };
    },
  };
}

let restaurantAccountPasswordServiceInstance:
  | ReturnType<typeof createRestaurantAccountPasswordService>
  | undefined;
const restaurantAccountPasswordService = createServerOnlyFn(
  () => (restaurantAccountPasswordServiceInstance ??= createRestaurantAccountPasswordService()),
);

/** Default production entry point: changes the signed-in account's own password. */
export function changeOwnPassword(
  input: AccountPasswordChangeInput,
): Promise<AccountPasswordChangeResult> {
  return restaurantAccountPasswordService().change(input);
}

function requirePasswordArgument(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`A ${label} is required`);
  }
  return value;
}

/**
 * Self-service password change consumed by the Account Security section.
 * Available to every authenticated Settings account independent of
 * Config_Permission; updates only the signed-in account's stored hash and only
 * when the current password is correct and the new password is valid.
 */
export const changeOwnPasswordServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      currentPassword: string;
      newPassword: string;
      confirmation: string;
      requestedLocationId?: string | null;
    }) => ({
      currentPassword: requirePasswordArgument(data?.currentPassword, "current password"),
      newPassword: requirePasswordArgument(data?.newPassword, "new password"),
      confirmation: requirePasswordArgument(data?.confirmation, "confirmation"),
      requestedLocationId: data?.requestedLocationId ?? null,
    }),
  )
  .handler(({ data }) => changeOwnPassword(data));

// ---------------------------------------------------------------------------
// Operating hours read/save
//
// Weekly Operating_Hours are tenant-global (design decision 1): every branch of
// a Restaurant_Tenant shares the same seven-weekday schedule, so these reads and
// writes are keyed by tenant id only even though the shared boundary still
// resolves and validates the caller's scope. Access is gated on the
// `restaurant_config` feature: any account for whom the feature is visible may
// read the stored hours (Req 3.1, 3.2, 3.8), and only an account resolving
// `operate` may save (Req 3.6, 10.3, 10.4).
//
// A save is all-or-nothing (Req 3.6, 3.7, 11.1): the pure
// `validateRestaurantOperatingHours` requires exactly one row per weekday and,
// for every open weekday, an open time and a strictly later close time. When it
// refuses, EVERY offending weekday is named in the returned field errors and
// NOTHING is written, so the seven stored weekdays remain unchanged. Only a
// fully valid submission reaches `replaceTenantHours`, which upserts all seven
// rows in one transaction. The subsequent availability read observes the new
// stored hours (Req 3.9) because both paths read the same `RestaurantHours`
// rows.
// ---------------------------------------------------------------------------

/** A weekday with no stored row is reported as closed (matches booking reads). */
const CLOSED_DAY_DEFAULTS = { openTime: "00:00", closeTime: "00:00", isClosed: true } as const;

/** Merges stored weekday rows into exactly seven canonical-ordered entries. */
function toSevenWeekdays(stored: readonly StoredRestaurantHours[]): DayHours[] {
  return Array.from({ length: LIMITS.operatingHoursDays }, (_, dayOfWeek) => {
    const row = stored.find((day) => day.dayOfWeek === dayOfWeek);
    return row
      ? {
          dayOfWeek,
          openTime: row.openTime,
          closeTime: row.closeTime,
          isClosed: row.isClosed,
        }
      : { dayOfWeek, ...CLOSED_DAY_DEFAULTS };
  });
}

export interface RestaurantOperatingHoursView {
  /** Exactly seven weekday rows in canonical (Sunday-first) order. */
  days: DayHours[];
  /** True exactly when `restaurant_config` resolves `operate` (Req 3.3, 3.8). */
  canSave: boolean;
  /** True when the caller may view but not change hours (Req 3.8). */
  readOnly: boolean;
}

export type SaveRestaurantOperatingHoursResult =
  | { status: "saved"; days: DayHours[] }
  | { status: "invalid"; errors: FieldError[] };

export interface SaveRestaurantOperatingHoursInput extends ResolveRestaurantSettingsContextInput {
  /** Untrusted weekday submission; validated all-or-nothing before any write. */
  days: unknown;
}

export interface RestaurantOperatingHoursServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  getTenantHours(tenantId: string): Promise<StoredRestaurantHours[]>;
  replaceTenantHours(tenantId: string, days: readonly DayHours[]): Promise<void>;
}

const defaultOperatingHoursDependencies = createServerOnlyFn(
  (): RestaurantOperatingHoursServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    getTenantHours: (tenantId) => restaurantSettingsRepository.getTenantHours(tenantId),
    replaceTenantHours: (tenantId, days) =>
      restaurantSettingsRepository.replaceTenantHours(tenantId, days),
  }),
);

function operatingHoursCanSave(context: AuthenticatedRestaurantSettingsContext): boolean {
  return (context.access as ResolvedAccess | null)?.restaurant_config?.permission === "operate";
}

/**
 * Builds the tenant-global operating-hours read/save service around injectable
 * I/O so authorization, seven-day normalization, and atomic validation can be
 * exercised with fakes and without cookies or SQL.
 */
export function createRestaurantOperatingHoursService(
  overrides: Partial<RestaurantOperatingHoursServiceDependencies> = {},
) {
  const dependencies: RestaurantOperatingHoursServiceDependencies = {
    ...defaultOperatingHoursDependencies(),
    ...overrides,
  };

  return {
    /** Requires `restaurant_config` visibility, then returns the seven stored weekdays. */
    async read(
      input: ResolveRestaurantSettingsContextInput = {},
    ): Promise<RestaurantOperatingHoursView> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureVisible(context, "restaurant_config");
      const stored = await dependencies.getTenantHours(context.tenantId);
      const canSave = operatingHoursCanSave(context);
      return { days: toSevenWeekdays(stored), canSave, readOnly: !canSave };
    },
    /**
     * Requires `restaurant_config: operate`, validates the whole submission, and
     * only then atomically replaces all seven weekday rows. An invalid
     * submission returns every offending weekday error and writes nothing.
     */
    async save(
      input: SaveRestaurantOperatingHoursInput,
    ): Promise<SaveRestaurantOperatingHoursResult> {
      const context = await dependencies.resolveContext(input);
      // Reject before any repository write so view_only/none never persist hours.
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");
      const validated = validateRestaurantOperatingHours(input.days);
      if (!validated.ok) {
        // Req 3.7: name each invalid weekday and leave stored hours unchanged.
        return { status: "invalid", errors: validated.errors };
      }
      await dependencies.replaceTenantHours(context.tenantId, validated.value);
      return { status: "saved", days: validated.value };
    },
  };
}

let restaurantOperatingHoursServiceInstance:
  | ReturnType<typeof createRestaurantOperatingHoursService>
  | undefined;
const restaurantOperatingHoursService = createServerOnlyFn(
  () => (restaurantOperatingHoursServiceInstance ??= createRestaurantOperatingHoursService()),
);

/** Default production entry point: reads the seven tenant-global weekday rows. */
export function getRestaurantOperatingHours(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<RestaurantOperatingHoursView> {
  return restaurantOperatingHoursService().read(input);
}

/** Default production entry point: validates and atomically saves the weekly hours. */
export function saveRestaurantOperatingHours(
  input: SaveRestaurantOperatingHoursInput,
): Promise<SaveRestaurantOperatingHoursResult> {
  return restaurantOperatingHoursService().save(input);
}

/**
 * Guarded read consumed by the `Operating Hours` sub-tab. Returns the seven
 * stored weekday rows plus whether the caller may save.
 */
export const getRestaurantOperatingHoursServerFn = createServerFn({ method: "GET" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => getRestaurantOperatingHours(data));

/**
 * Guarded atomic write consumed by the `Operating Hours` sub-tab. Only an
 * account resolving `restaurant_config: operate` reaches the store; an invalid
 * submission returns every offending weekday error and changes no stored hours.
 */
export const saveRestaurantOperatingHoursServerFn = createServerFn({ method: "POST" })
  .validator((data: { days: unknown; requestedLocationId?: string | null }) => ({
    days: data?.days,
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => saveRestaurantOperatingHours(data));

// ---------------------------------------------------------------------------
// Closure days read/create/delete
//
// Closure_Days are location-scoped (Req 9.3-9.7): each read and write runs
// against the server-derived `{tenantId, locationId}` scope, never a
// caller-chosen tenant or branch. Reads require the `restaurant_config` feature
// to be visible (Req 4.1, 4.13); create and delete require `operate` (Req 4.3,
// 4.4, 10.3, 10.4).
//
// A month read returns exactly the closures whose date falls in the requested
// calendar month, optionally narrowed to a single Closure_Scope, and carries the
// affected Table_Booking count per closure (Req 4.9, 4.10) without ever touching
// bookings. Create is duplicate-safe (Req 4.3, 4.5): the pure `validateClosureDay`
// rejects a malformed date/reason/scope with every offending field named
// (Req 4.6), a stored duplicate for the same scope maps to the stable
// already-blocked message, and a table scope whose table is absent from the
// resolved scope maps to the stable not-found message. Delete removes exactly
// the addressed closure under the resolved scope and reports a miss as not
// found (Req 4.4). No closure write ever rewrites an appointment (Req 11.6).
// ---------------------------------------------------------------------------

/** Pads a positive integer to two digits for `YYYY-MM-01` month boundaries. */
function padMonth(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Derives the inclusive month-start and exclusive next-month-start boundaries
 * used by month-navigation closure reads. Returns `null` for a year or month
 * outside the supported calendar range so the caller can reject the request.
 */
export function closureMonthRange(
  year: unknown,
  month: unknown,
): { monthStart: string; nextMonthStart: string } | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    (year as number) < 1 ||
    (year as number) > 9999 ||
    (month as number) < 1 ||
    (month as number) > 12
  ) {
    return null;
  }
  const y = year as number;
  const m = month as number;
  const monthStart = `${String(y).padStart(4, "0")}-${padMonth(m)}-01`;
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextMonthStart = `${String(nextYear).padStart(4, "0")}-${padMonth(nextMonth)}-01`;
  return { monthStart, nextMonthStart };
}

export const MSG_CLOSURE_MONTH_INVALID =
  "Month navigation requires a whole calendar year and a month from 1 through 12";

/** Normalizes an optional caller closure-scope filter into the pure contract. */
function normaliseClosureScopeFilter(value: unknown): ClosureScope | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.type === "restaurant") return { type: "restaurant" };
  if (raw.type === "table") {
    const tableId = trimmedString(raw.tableId);
    if (tableId.length > 0) return { type: "table", tableId };
  }
  return undefined;
}

export interface ListRestaurantClosuresInput extends ResolveRestaurantSettingsContextInput {
  year: number;
  month: number;
  /** Optional narrowing to whole-restaurant or a single table's closures. */
  scope?: ClosureScope | { type?: string; tableId?: unknown } | null;
}

export interface RestaurantClosuresView {
  closures: ClosureDay[];
  monthStart: string;
  nextMonthStart: string;
  canManage: boolean;
}

export interface CreateRestaurantClosureInput extends ResolveRestaurantSettingsContextInput {
  date: unknown;
  scope: unknown;
  reason?: unknown;
  isHoliday?: unknown;
}

export type CreateRestaurantClosureResult =
  | { status: "created"; closure: ClosureDay }
  | { status: "invalid"; errors: FieldError[] }
  | { status: "duplicate"; message: string }
  | { status: "not_found"; message: string };

export interface DeleteRestaurantClosureInput extends ResolveRestaurantSettingsContextInput {
  closureId: string;
}

export type DeleteRestaurantClosureResult =
  | { status: "deleted" }
  | { status: "not_found"; message: string };

export interface RestaurantClosureServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  listClosureDays(
    scope: RestaurantResourceScope,
    monthStart: string,
    nextMonthStart: string,
    closureScope?: ClosureScope,
  ): Promise<ClosureDay[]>;
  createClosureDay(
    scope: RestaurantResourceScope,
    input: { date: string; scope: ClosureScope; reason: string; isHoliday: boolean },
  ): Promise<CreateClosureDayResult>;
  deleteClosureDay(
    scope: RestaurantResourceScope,
    closureId: string,
  ): Promise<DeleteScopedRecordResult>;
}

const defaultClosureDependencies = createServerOnlyFn(
  (): RestaurantClosureServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    listClosureDays: (scope, monthStart, nextMonthStart, closureScope) =>
      restaurantSettingsRepository.listClosureDays(scope, monthStart, nextMonthStart, closureScope),
    createClosureDay: (scope, input) => restaurantSettingsRepository.createClosureDay(scope, input),
    deleteClosureDay: (scope, closureId) =>
      restaurantSettingsRepository.deleteClosureDay(scope, closureId),
  }),
);

/**
 * Builds the scoped closure read/create/delete service around injectable I/O so
 * authorization, month-range derivation, duplicate/not-found mapping, and
 * affected-booking counts can be exercised with fakes and without SQL.
 */
export function createRestaurantClosureService(
  overrides: Partial<RestaurantClosureServiceDependencies> = {},
) {
  const dependencies: RestaurantClosureServiceDependencies = {
    ...defaultClosureDependencies(),
    ...overrides,
  };

  return {
    /** Requires config visibility, then returns the requested month's scoped closures. */
    async list(input: ListRestaurantClosuresInput): Promise<RestaurantClosuresView> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureVisible(context, "restaurant_config");
      const range = closureMonthRange(input.year, input.month);
      if (!range) throw new Error(MSG_CLOSURE_MONTH_INVALID);
      const closureScope = normaliseClosureScopeFilter(input.scope);
      const closures = await dependencies.listClosureDays(
        context.scope,
        range.monthStart,
        range.nextMonthStart,
        closureScope,
      );
      return {
        closures,
        monthStart: range.monthStart,
        nextMonthStart: range.nextMonthStart,
        canManage: operatingHoursCanSave(context),
      };
    },

    /**
     * Requires `restaurant_config: operate`, validates the submission, and
     * creates exactly one Closure_Day. Duplicates and absent table scopes map to
     * their stable messages; the created closure is returned with its affected
     * Table_Booking count.
     */
    async create(input: CreateRestaurantClosureInput): Promise<CreateRestaurantClosureResult> {
      const context = await dependencies.resolveContext(input);
      // Reject before any repository write so view_only/none never persist.
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");
      const validated = validateClosureDay({
        date: input.date,
        scope: input.scope,
        reason: input.reason,
        isHoliday: input.isHoliday,
      });
      if (!validated.ok) {
        // Req 4.6: name every offending field and store nothing.
        return { status: "invalid", errors: validated.errors };
      }

      const result = await dependencies.createClosureDay(context.scope, validated.value);
      if (result.status === "table_not_found") {
        // A table scope outside the resolved tenant/location never reveals a
        // foreign row; it maps to the single public not-found message (Req 9.7).
        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      }
      if (result.status === "duplicate") {
        // Req 4.5: an already-blocked date for this scope is rejected verbatim.
        return { status: "duplicate", message: MSG_CLOSURE_ALREADY_EXISTS };
      }

      // Re-read the created row within its own month so the affected-booking
      // count (Req 4.9, 4.10) is derived from the same scoped query.
      const range = closureMonthRange(
        Number(validated.value.date.slice(0, 4)),
        Number(validated.value.date.slice(5, 7)),
      );
      const created =
        range &&
        (
          await dependencies.listClosureDays(
            context.scope,
            range.monthStart,
            range.nextMonthStart,
            validated.value.scope,
          )
        ).find((closure) => closure.id === result.id);

      return {
        status: "created",
        closure: created ?? {
          id: result.id ?? "",
          date: validated.value.date,
          scope: validated.value.scope,
          reason: validated.value.reason,
          isHoliday: validated.value.isHoliday,
          affectedBookingCount: 0,
          locationId: context.scope.locationId,
        },
      };
    },

    /**
     * Requires `restaurant_config: operate`, then deletes exactly the addressed
     * Closure_Day under the resolved scope. A miss maps to the not-found message.
     */
    async remove(input: DeleteRestaurantClosureInput): Promise<DeleteRestaurantClosureResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");
      const closureId = trimmedString(input.closureId);
      const result = await dependencies.deleteClosureDay(context.scope, closureId);
      if (result.status === "not_found") {
        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      }
      return { status: "deleted" };
    },
  };
}

let restaurantClosureServiceInstance: ReturnType<typeof createRestaurantClosureService> | undefined;
const restaurantClosureService = createServerOnlyFn(
  () => (restaurantClosureServiceInstance ??= createRestaurantClosureService()),
);

/** Default production entry point: reads one month of scoped closures. */
export function listRestaurantClosures(
  input: ListRestaurantClosuresInput,
): Promise<RestaurantClosuresView> {
  return restaurantClosureService().list(input);
}

/** Default production entry point: duplicate-safe scoped closure create. */
export function createRestaurantClosure(
  input: CreateRestaurantClosureInput,
): Promise<CreateRestaurantClosureResult> {
  return restaurantClosureService().create(input);
}

/** Default production entry point: exact scoped closure delete. */
export function deleteRestaurantClosure(
  input: DeleteRestaurantClosureInput,
): Promise<DeleteRestaurantClosureResult> {
  return restaurantClosureService().remove(input);
}

/**
 * Guarded month-navigation read consumed by the `Operating Hours` calendar and
 * the `Tables` closure badges. Returns the requested month's scoped closures
 * with per-closure affected-booking counts.
 */
export const listRestaurantClosuresServerFn = createServerFn({ method: "GET" })
  .validator(
    (data: {
      year: number;
      month: number;
      scope?: ClosureScope | { type?: string; tableId?: unknown } | null;
      requestedLocationId?: string | null;
    }) => {
      if (!Number.isInteger(data?.year) || !Number.isInteger(data?.month)) {
        throw new Error(MSG_CLOSURE_MONTH_INVALID);
      }
      return {
        year: data.year,
        month: data.month,
        scope: data.scope ?? null,
        requestedLocationId: data.requestedLocationId ?? null,
      };
    },
  )
  .handler(({ data }) => listRestaurantClosures(data));

/**
 * Guarded closure create consumed by the `Operating Hours` calendar. Only an
 * account resolving `restaurant_config: operate` reaches the store; duplicates
 * and absent table scopes return their stable messages and change nothing.
 */
export const createRestaurantClosureServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      date: unknown;
      scope: unknown;
      reason?: unknown;
      isHoliday?: unknown;
      requestedLocationId?: string | null;
    }) => ({
      date: data?.date,
      scope: data?.scope,
      reason: data?.reason,
      isHoliday: data?.isHoliday,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => createRestaurantClosure(data));

/**
 * Guarded closure delete consumed by the `Operating Hours` calendar. Removes
 * exactly the addressed closure under the resolved scope.
 */
export const deleteRestaurantClosureServerFn = createServerFn({ method: "POST" })
  .validator((data: { closureId: string; requestedLocationId?: string | null }) => {
    const closureId = trimmedString(data?.closureId);
    if (!closureId) throw new Error("A closure id is required");
    return { closureId, requestedLocationId: data?.requestedLocationId ?? null };
  })
  .handler(({ data }) => deleteRestaurantClosure(data));

// ---------------------------------------------------------------------------
// Dining areas registry and registry-backed tables
//
// Dining areas and tables are location-scoped (Req 9.3-9.7): every read and
// write runs against the server-derived `{tenantId, locationId}` scope, never a
// caller-chosen tenant or branch. Reads require the `restaurant_config` feature
// to be visible; every Change_Operation requires `restaurant_config: operate`
// and is refused before any repository write (Req 10.3, 10.4).
//
// Area reads return the scope's stored registry ordered by display order then
// case-insensitive name (Req 5.1). When the scope holds no stored area, the
// repository returns exactly one synthetic effective `Main` area (Req 5.9); that
// synthetic row is never a stored duplicate, so an owner may still create a real
// `Main`. Create validates bounds and tenant-wide case-insensitive uniqueness
// with the pure `validateDiningArea`, defaults display order to one past the
// highest stored order (Req 5.2, 5.3), and maps a stored duplicate to the stable
// already-exists message (Req 5.6). Delete refuses an area that still owns
// tables with a message stating the assigned count (Req 5.7) and reports a miss
// as not found (Req 5.4).
//
// Table writes select a Table_Area only from the scope's stored areas (Req 5.8);
// the repository resolves the chosen area id to its canonical name and keeps
// `RestaurantTable.area`/`areaId` synchronized. The synthetic `Main` id resolves
// to `area = 'Main', areaId = NULL` and creates no stored area. Field bounds,
// duplicate names, and the tenant table cap reuse the existing pure
// `validateTableInput` (Req 11.1). Table deletion removes the table's own
// closure rows in the same transaction and never rewrites an existing
// Table_Booking (Req 11.6), and each table read carries its stored table-scoped
// closure count (Req 4.12).
// ---------------------------------------------------------------------------

/** True exactly when the resolved `restaurant_config` permission is `operate`. */
function restaurantConfigCanOperate(context: AuthenticatedRestaurantSettingsContext): boolean {
  return (context.access as ResolvedAccess | null)?.restaurant_config?.permission === "operate";
}

/** Stable refusal naming the assigned-table count that blocks a delete (Req 5.7). */
export function diningAreaAssignedTablesMessage(assignedTableCount: number): string {
  const noun = assignedTableCount === 1 ? "table" : "tables";
  return `This dining area has ${assignedTableCount} assigned ${noun} and cannot be deleted`;
}

/** Only a stored Dining_Area is a selectable Table_Area (Req 5.8). */
export const MSG_TABLE_AREA_NOT_IN_REGISTRY =
  "Select a dining area from the restaurant's dining areas";

export interface RestaurantDiningAreasView {
  /** Canonically ordered stored areas, or one synthetic `Main` when none exist. */
  areas: DiningArea[];
  /** True exactly when `restaurant_config` resolves `operate` (Req 5.10). */
  canManage: boolean;
  /** True when the caller may view but not change areas (Req 5.10). */
  readOnly: boolean;
}

export interface CreateRestaurantDiningAreaInput extends ResolveRestaurantSettingsContextInput {
  name: unknown;
  displayOrder?: unknown;
}

export type CreateRestaurantDiningAreaResult =
  | { status: "created"; area: DiningArea }
  | { status: "invalid"; errors: FieldError[] }
  | { status: "duplicate"; message: string };

export interface DeleteRestaurantDiningAreaInput extends ResolveRestaurantSettingsContextInput {
  areaId: string;
}

export type DeleteRestaurantDiningAreaResult =
  | { status: "deleted" }
  | { status: "assigned_tables"; message: string; assignedTableCount: number }
  | { status: "not_found"; message: string };

export interface RestaurantDiningAreaServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  listDiningAreas(scope: RestaurantResourceScope): Promise<DiningArea[]>;
  createDiningArea(
    scope: RestaurantResourceScope,
    input: CreateDiningAreaInput,
  ): Promise<CreateDiningAreaResult>;
  deleteDiningArea(scope: RestaurantResourceScope, areaId: string): Promise<DeleteDiningAreaResult>;
}

const defaultDiningAreaDependencies = createServerOnlyFn(
  (): RestaurantDiningAreaServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    listDiningAreas: (scope) => restaurantSettingsRepository.listDiningAreas(scope),
    createDiningArea: (scope, input) => restaurantSettingsRepository.createDiningArea(scope, input),
    deleteDiningArea: (scope, areaId) =>
      restaurantSettingsRepository.deleteDiningArea(scope, areaId),
  }),
);

/**
 * Builds the scoped dining-area registry read/create/delete service around
 * injectable I/O so authorization, ordering, synthetic `Main`, uniqueness,
 * default order, and assigned-count refusal can be exercised with fakes and
 * without SQL.
 */
export function createRestaurantDiningAreaService(
  overrides: Partial<RestaurantDiningAreaServiceDependencies> = {},
) {
  const dependencies: RestaurantDiningAreaServiceDependencies = {
    ...defaultDiningAreaDependencies(),
    ...overrides,
  };

  /** Stored registry rows only (drops the synthetic `Main` from uniqueness/order). */
  const storedAreasOnly = (areas: readonly DiningArea[]): DiningArea[] =>
    areas.filter((area) => area.id !== EFFECTIVE_MAIN_AREA_ID);

  return {
    /** Requires config visibility, then returns ordered effective areas. */
    async list(
      input: ResolveRestaurantSettingsContextInput = {},
    ): Promise<RestaurantDiningAreasView> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureVisible(context, "restaurant_config");
      const areas = orderDiningAreas(await dependencies.listDiningAreas(context.scope));
      const canManage = restaurantConfigCanOperate(context);
      return { areas, canManage, readOnly: !canManage };
    },

    /**
     * Requires `restaurant_config: operate`, validates the submission, and
     * creates exactly one area. A stored duplicate maps to the stable
     * already-exists message; the synthetic `Main` is never counted as a
     * duplicate.
     */
    async create(
      input: CreateRestaurantDiningAreaInput,
    ): Promise<CreateRestaurantDiningAreaResult> {
      const context = await dependencies.resolveContext(input);
      // Reject before any repository write so view_only/none never persist.
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");

      const stored = storedAreasOnly(await dependencies.listDiningAreas(context.scope));
      const areaContext: AreaContext = {
        existingNames: stored.map<ExistingAreaName>((area) => ({
          id: area.id,
          name: area.name,
        })),
        highestDisplayOrder:
          stored.length === 0
            ? null
            : stored.reduce((max, area) => Math.max(max, area.displayOrder), 0),
      };
      const validated = validateDiningArea(
        { name: input.name, displayOrder: input.displayOrder },
        areaContext,
      );
      if (!validated.ok) return { status: "invalid", errors: validated.errors };

      const result = await dependencies.createDiningArea(context.scope, {
        name: validated.value.name,
        displayOrder: validated.value.displayOrder,
      });
      if (result.status === "duplicate") {
        // Req 5.6: a case-insensitive stored duplicate is rejected verbatim.
        return { status: "duplicate", message: MSG_AREA_ALREADY_EXISTS };
      }
      return {
        status: "created",
        area: result.area ?? {
          id: "",
          name: validated.value.name,
          displayOrder: validated.value.displayOrder,
          tableCount: 0,
          locationId: context.scope.locationId,
        },
      };
    },

    /**
     * Requires `restaurant_config: operate`, then deletes exactly the addressed
     * area under the resolved scope. An area that still owns tables is refused
     * with a message stating the assigned count; a miss maps to not found.
     */
    async remove(
      input: DeleteRestaurantDiningAreaInput,
    ): Promise<DeleteRestaurantDiningAreaResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");
      const areaId = trimmedString(input.areaId);
      const result = await dependencies.deleteDiningArea(context.scope, areaId);
      if (result.status === "assigned_tables") {
        // Req 5.7: refuse and name the count of assigned tables.
        return {
          status: "assigned_tables",
          message: diningAreaAssignedTablesMessage(result.assignedTableCount),
          assignedTableCount: result.assignedTableCount,
        };
      }
      if (result.status === "not_found") {
        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      }
      return { status: "deleted" };
    },
  };
}

let restaurantDiningAreaServiceInstance:
  | ReturnType<typeof createRestaurantDiningAreaService>
  | undefined;
const restaurantDiningAreaService = createServerOnlyFn(
  () => (restaurantDiningAreaServiceInstance ??= createRestaurantDiningAreaService()),
);

/** Default production entry point: reads the scope's ordered effective areas. */
export function listRestaurantDiningAreas(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<RestaurantDiningAreasView> {
  return restaurantDiningAreaService().list(input);
}

/** Default production entry point: validates and creates one scoped area. */
export function createRestaurantDiningArea(
  input: CreateRestaurantDiningAreaInput,
): Promise<CreateRestaurantDiningAreaResult> {
  return restaurantDiningAreaService().create(input);
}

/** Default production entry point: guarded scoped area delete. */
export function deleteRestaurantDiningArea(
  input: DeleteRestaurantDiningAreaInput,
): Promise<DeleteRestaurantDiningAreaResult> {
  return restaurantDiningAreaService().remove(input);
}

// ---------------------------------------------------------------------------
// Registry-backed tables
// ---------------------------------------------------------------------------

export interface RestaurantTablesView {
  /** Scoped tables, each carrying its stored table-scoped closure count (Req 4.12). */
  tables: StoredRestaurantTable[];
  /** The only selectable Table_Area values: the scope's stored areas (Req 5.8). */
  selectableAreas: DiningArea[];
  /** True exactly when `restaurant_config` resolves `operate`. */
  canManage: boolean;
  readOnly: boolean;
}

export interface SaveRestaurantTableInput extends ResolveRestaurantSettingsContextInput {
  /** Absent/blank creates a table; a stored id edits it. */
  tableId?: string | null;
  name: unknown;
  seatCapacity: unknown;
  /** A stored Dining_Area id, or the synthetic `Main` id when none are stored. */
  areaId: unknown;
  displayOrder?: unknown;
  state?: unknown;
}

export type SaveRestaurantTableResult =
  | { status: "saved"; table: StoredRestaurantTable }
  | { status: "invalid"; errors: FieldError[] }
  | { status: "duplicate"; message: string }
  | { status: "not_found"; message: string };

export interface DeleteRestaurantTableInput extends ResolveRestaurantSettingsContextInput {
  tableId: string;
}

export type DeleteRestaurantTableResult =
  | { status: "deleted"; deletedClosureCount: number }
  | { status: "not_found"; message: string };

export interface RestaurantTableServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  listDiningAreas(scope: RestaurantResourceScope): Promise<DiningArea[]>;
  listRestaurantTables(
    scope: RestaurantResourceScope,
    includeInactive?: boolean,
  ): Promise<StoredRestaurantTable[]>;
  createRestaurantTable(
    scope: RestaurantResourceScope,
    input: SaveScopedRestaurantTableInput,
  ): Promise<SaveScopedRestaurantTableResult>;
  updateRestaurantTable(
    scope: RestaurantResourceScope,
    tableId: string,
    input: SaveScopedRestaurantTableInput,
  ): Promise<SaveScopedRestaurantTableResult>;
  deleteRestaurantTable(
    scope: RestaurantResourceScope,
    tableId: string,
  ): Promise<DeleteScopedRestaurantTableResult>;
}

const defaultRestaurantTableDependencies = createServerOnlyFn(
  (): RestaurantTableServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    listDiningAreas: (scope) => restaurantSettingsRepository.listDiningAreas(scope),
    listRestaurantTables: (scope, includeInactive) =>
      restaurantSettingsRepository.listRestaurantTables(scope, includeInactive),
    createRestaurantTable: (scope, input) =>
      restaurantSettingsRepository.createRestaurantTable(scope, input),
    updateRestaurantTable: (scope, tableId, input) =>
      restaurantSettingsRepository.updateRestaurantTable(scope, tableId, input),
    deleteRestaurantTable: (scope, tableId) =>
      restaurantSettingsRepository.deleteRestaurantTable(scope, tableId),
  }),
);

/**
 * Builds the scoped registry-backed table read/create/update/delete service
 * around injectable I/O so authorization, registry-only area selection,
 * canonical `area`/`areaId` synchronization, per-table closure counts, and
 * booking-safe deletion can be exercised with fakes and without SQL.
 */
export function createRestaurantTableService(
  overrides: Partial<RestaurantTableServiceDependencies> = {},
) {
  const dependencies: RestaurantTableServiceDependencies = {
    ...defaultRestaurantTableDependencies(),
    ...overrides,
  };

  async function save(input: SaveRestaurantTableInput): Promise<SaveRestaurantTableResult> {
    const context = await dependencies.resolveContext(input);
    // Reject before any repository write so view_only/none never persist.
    assertRestaurantSettingsFeatureOperate(context, "restaurant_config");

    const editingId = trimmedString(input.tableId) || null;
    const [areas, tables] = await Promise.all([
      dependencies.listDiningAreas(context.scope),
      dependencies.listRestaurantTables(context.scope),
    ]);

    const areaId = trimmedString(input.areaId);
    // Only a stored (or synthetic Main) area is selectable (Req 5.8).
    const selectedArea = areas.find((area) => area.id === areaId);

    // Validate field bounds, duplicate name, and tenant cap with the shared
    // pure validator. The selected area's canonical name feeds the in-area
    // display-order default; the repository remains the source of truth.
    const validated = validateTableInput(
      {
        name: input.name,
        seatCapacity: input.seatCapacity,
        area: selectedArea?.name,
        displayOrder: input.displayOrder,
        state: input.state,
      },
      {
        existingNames: tables.map((table) => ({ id: table.id, name: table.name })),
        editingId,
        tableCount: tables.length,
        existingTables: tables,
      },
    );

    const errors: FieldError[] = validated.ok ? [] : [...validated.errors];
    if (!selectedArea) {
      errors.push({ field: "areaId", message: MSG_TABLE_AREA_NOT_IN_REGISTRY });
    }
    if (!validated.ok || errors.length > 0) return { status: "invalid", errors };

    const saveInput: SaveScopedRestaurantTableInput = {
      name: validated.value.name,
      seatCapacity: validated.value.seatCapacity,
      areaId,
      displayOrder: validated.value.displayOrder,
      state: validated.value.state as TableState,
    };

    const result = editingId
      ? await dependencies.updateRestaurantTable(context.scope, editingId, saveInput)
      : await dependencies.createRestaurantTable(context.scope, saveInput);

    switch (result.status) {
      case "saved":
        return { status: "saved", table: result.table };
      case "duplicate":
        return { status: "duplicate", message: MSG_DUPLICATE_TABLE_NAME };
      case "area_not_found":
        // The chosen area vanished between read and write; surface it as a
        // registry-selection error rather than leaking scope details.
        return {
          status: "invalid",
          errors: [{ field: "areaId", message: MSG_TABLE_AREA_NOT_IN_REGISTRY }],
        };
      case "not_found":
        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
    }
  }

  return {
    /** Requires config visibility; returns scoped tables and selectable areas. */
    async list(input: ResolveRestaurantSettingsContextInput = {}): Promise<RestaurantTablesView> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureVisible(context, "restaurant_config");
      const [areas, tables] = await Promise.all([
        dependencies.listDiningAreas(context.scope),
        dependencies.listRestaurantTables(context.scope),
      ]);
      const canManage = restaurantConfigCanOperate(context);
      return {
        tables,
        selectableAreas: orderDiningAreas(areas),
        canManage,
        readOnly: !canManage,
      };
    },

    /** Requires `operate`; creates a table when no id is supplied, else edits it. */
    save,

    /**
     * Requires `operate`, then deletes exactly the addressed table under the
     * resolved scope. The repository removes the table's own closure rows in the
     * same transaction and never rewrites an existing Table_Booking (Req 11.6).
     */
    async remove(input: DeleteRestaurantTableInput): Promise<DeleteRestaurantTableResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");
      const tableId = trimmedString(input.tableId);
      const result = await dependencies.deleteRestaurantTable(context.scope, tableId);
      if (result.status === "not_found") {
        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      }
      return { status: "deleted", deletedClosureCount: result.deletedClosureCount };
    },
  };
}

let restaurantTableServiceInstance: ReturnType<typeof createRestaurantTableService> | undefined;
const restaurantTableService = createServerOnlyFn(
  () => (restaurantTableServiceInstance ??= createRestaurantTableService()),
);

/** Default production entry point: reads scoped tables and selectable areas. */
export function listRestaurantTables(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<RestaurantTablesView> {
  return restaurantTableService().list(input);
}

/** Default production entry point: registry-backed table create/update. */
export function saveRestaurantTable(
  input: SaveRestaurantTableInput,
): Promise<SaveRestaurantTableResult> {
  return restaurantTableService().save(input);
}

/** Default production entry point: guarded scoped table delete. */
export function deleteRestaurantTable(
  input: DeleteRestaurantTableInput,
): Promise<DeleteRestaurantTableResult> {
  return restaurantTableService().remove(input);
}

// ---------------------------------------------------------------------------
// Guarded dining-area and table server functions
// ---------------------------------------------------------------------------

/** Guarded read consumed by the `Dining Areas` sub-tab. */
export const listRestaurantDiningAreasServerFn = createServerFn({ method: "GET" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => listRestaurantDiningAreas(data));

/**
 * Guarded area create consumed by the `Dining Areas` sub-tab. Only an account
 * resolving `restaurant_config: operate` reaches the store; a stored duplicate
 * returns the stable already-exists message and changes nothing.
 */
export const createRestaurantDiningAreaServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: { name: unknown; displayOrder?: unknown; requestedLocationId?: string | null }) => ({
      name: data?.name,
      displayOrder: data?.displayOrder,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => createRestaurantDiningArea(data));

/**
 * Guarded area delete consumed by the `Dining Areas` sub-tab. An area with
 * assigned tables is refused with the assigned-count message.
 */
export const deleteRestaurantDiningAreaServerFn = createServerFn({ method: "POST" })
  .validator((data: { areaId: string; requestedLocationId?: string | null }) => {
    const areaId = trimmedString(data?.areaId);
    if (!areaId) throw new Error("A dining area id is required");
    return { areaId, requestedLocationId: data?.requestedLocationId ?? null };
  })
  .handler(({ data }) => deleteRestaurantDiningArea(data));

/**
 * Guarded read consumed by the `Tables` sub-tab. Returns scoped tables with
 * per-table closure counts plus the stored areas selectable as a Table_Area.
 */
export const listRestaurantTablesServerFn = createServerFn({ method: "GET" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => listRestaurantTables(data));

/**
 * Guarded registry-backed table create/update consumed by the `Tables` sub-tab.
 * The Table_Area must be one of the scope's stored areas; the store keeps the
 * canonical `area`/`areaId` synchronized.
 */
export const saveRestaurantTableServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      tableId?: string | null;
      name: unknown;
      seatCapacity: unknown;
      areaId: unknown;
      displayOrder?: unknown;
      state?: unknown;
      requestedLocationId?: string | null;
    }) => ({
      tableId: data?.tableId ?? null,
      name: data?.name,
      seatCapacity: data?.seatCapacity,
      areaId: data?.areaId,
      displayOrder: data?.displayOrder,
      state: data?.state,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => saveRestaurantTable(data));

/**
 * Guarded table delete consumed by the `Tables` sub-tab. Removes exactly the
 * addressed table and its own closure rows under the resolved scope while
 * leaving every existing Table_Booking unchanged.
 */
export const deleteRestaurantTableServerFn = createServerFn({ method: "POST" })
  .validator((data: { tableId: string; requestedLocationId?: string | null }) => {
    const tableId = trimmedString(data?.tableId);
    if (!tableId) throw new Error("A table id is required");
    return { tableId, requestedLocationId: data?.requestedLocationId ?? null };
  })
  .handler(({ data }) => deleteRestaurantTable(data));

// ---------------------------------------------------------------------------
// Guarded menu management
//
// The `Menu` sub-tab reads the scope's ordered category/item tree and, for an
// account resolving `restaurant_config: operate`, creates, edits, deletes, and
// toggles the state of categories and items. Reads require `restaurant_config`
// to be visible (Req 10.3); every Change_Operation requires `operate` and is
// refused before any repository write (Req 10.3, 10.4), so a `view_only`/`none`
// account never mutates a row.
//
// The tree read applies the pure `orderMenu` projection so categories sort by
// display order then case-insensitive name, and each category's items sort the
// same way (Req 6.1). Category and item writes validate bounds, defaults, and
// tenant-wide case-insensitive category-name uniqueness with the pure
// `validateMenuCategory`/`validateMenuItem` before the store is reached, so an
// invalid or cap-exceeding submission changes nothing and returns the stable
// field errors (Req 6.3, 6.4, 6.5, 6.12, 6.13, 11.1). A stored duplicate racing
// the write maps to the stable already-exists message, and a repository cap hit
// maps to the corresponding max message; both preserve every stored row
// (Req 6.5, 6.13, 11.1). Item writes only accept a category of the same
// tenant/location scope (Req 6.3, 9.3-9.7, 10.11, 10.12): the pure validator
// rejects a foreign/absent category id and the repository re-resolves the
// category under the resolved scope with a row lock.
//
// Category deletion is the approved two-step cascade (Req 6.6, 6.7): the caller
// first previews the cascade (the count of items the deletion would remove) and
// only a second confirmed request performs the transactional delete of the
// category and its items. The preview never changes state.
// ---------------------------------------------------------------------------

export interface RestaurantMenuView {
  /** Canonically ordered categories, each with canonically ordered items (Req 6.1). */
  categories: MenuCategory[];
  /** True exactly when `restaurant_config` resolves `operate` (Req 6.14). */
  canManage: boolean;
  /** True when the caller may view but not change the menu (Req 6.14). */
  readOnly: boolean;
}

export interface SaveRestaurantMenuCategoryInput extends ResolveRestaurantSettingsContextInput {
  /** Absent/blank creates a category; a stored id edits it. */
  categoryId?: string | null;
  name: unknown;
  displayOrder?: unknown;
}

export type SaveRestaurantMenuCategoryResult =
  | { status: "saved"; category: MenuCategory }
  | { status: "invalid"; errors: FieldError[] }
  | { status: "duplicate"; message: string }
  | { status: "limit"; message: string }
  | { status: "not_found"; message: string };

export interface SaveRestaurantMenuItemInput extends ResolveRestaurantSettingsContextInput {
  /** Absent/blank creates an item; a stored id edits it. */
  itemId?: string | null;
  categoryId: unknown;
  name: unknown;
  priceMinor: unknown;
  description?: unknown;
  displayOrder?: unknown;
  state?: unknown;
}

export type SaveRestaurantMenuItemResult =
  | { status: "saved"; item: MenuItem }
  | { status: "invalid"; errors: FieldError[] }
  | { status: "limit"; message: string }
  | { status: "not_found"; message: string };

export interface SetRestaurantMenuItemStateInput extends ResolveRestaurantSettingsContextInput {
  itemId: string;
  state: unknown;
}

export type SetRestaurantMenuItemStateResult =
  | { status: "saved"; item: MenuItem }
  | { status: "invalid"; errors: FieldError[] }
  | { status: "not_found"; message: string };

export interface DeleteRestaurantMenuItemInput extends ResolveRestaurantSettingsContextInput {
  itemId: string;
}

export type DeleteRestaurantMenuItemResult =
  | { status: "deleted" }
  | { status: "not_found"; message: string };

export interface RestaurantMenuCategoryIdInput extends ResolveRestaurantSettingsContextInput {
  categoryId: string;
}

export type PreviewRestaurantMenuCategoryDeletionResult =
  | ({ status: "preview" } & MenuCategoryDeletionPreview)
  | { status: "not_found"; message: string };

export type ConfirmDeleteRestaurantMenuCategoryResult =
  | { status: "deleted"; deletedItemCount: number }
  | { status: "not_found"; message: string };

export interface RestaurantMenuServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  listMenu(scope: RestaurantResourceScope): Promise<MenuCategory[]>;
  saveMenuCategory(
    scope: RestaurantResourceScope,
    input: NormalisedMenuCategory,
    categoryId?: string,
  ): Promise<SaveMenuCategoryResult>;
  saveMenuItem(
    scope: RestaurantResourceScope,
    input: NormalisedMenuItem,
    itemId?: string,
  ): Promise<SaveMenuItemResult>;
  updateMenuItemState(
    scope: RestaurantResourceScope,
    itemId: string,
    state: MenuItemState,
  ): Promise<SaveMenuItemResult>;
  deleteMenuItem(scope: RestaurantResourceScope, itemId: string): Promise<DeleteMenuItemResult>;
  previewMenuCategoryDeletion(
    scope: RestaurantResourceScope,
    categoryId: string,
  ): Promise<PreviewMenuCategoryDeletionResult>;
  confirmDeleteMenuCategory(
    scope: RestaurantResourceScope,
    categoryId: string,
  ): Promise<DeleteMenuCategoryResult>;
}

const defaultMenuDependencies = createServerOnlyFn(
  (): RestaurantMenuServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    listMenu: (scope) => restaurantSettingsRepository.listMenu(scope),
    saveMenuCategory: (scope, input, categoryId) =>
      restaurantSettingsRepository.saveMenuCategory(scope, input, categoryId),
    saveMenuItem: (scope, input, itemId) =>
      restaurantSettingsRepository.saveMenuItem(scope, input, itemId),
    updateMenuItemState: (scope, itemId, state) =>
      restaurantSettingsRepository.updateMenuItemState(scope, itemId, state),
    deleteMenuItem: (scope, itemId) => restaurantSettingsRepository.deleteMenuItem(scope, itemId),
    previewMenuCategoryDeletion: (scope, categoryId) =>
      restaurantSettingsRepository.previewMenuCategoryDeletion(scope, categoryId),
    confirmDeleteMenuCategory: (scope, categoryId) =>
      restaurantSettingsRepository.confirmDeleteMenuCategory(scope, categoryId),
  }),
);

/** Total item count across every category in a scoped menu tree. */
function countMenuItems(menu: readonly MenuCategory[]): number {
  return menu.reduce((total, category) => total + category.items.length, 0);
}

/** Highest stored display order in a list, or `null` when the list is empty. */
function highestDisplayOrder(values: readonly { displayOrder: number }[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((max, value) => Math.max(max, value.displayOrder), 0);
}

/**
 * Builds the scoped menu read/create/edit/delete/state service around injectable
 * I/O so authorization, ordering, uniqueness, caps, same-scope category
 * resolution, and the two-step cascade can be exercised with fakes and without
 * SQL.
 */
export function createRestaurantMenuService(
  overrides: Partial<RestaurantMenuServiceDependencies> = {},
) {
  const dependencies: RestaurantMenuServiceDependencies = {
    ...defaultMenuDependencies(),
    ...overrides,
  };

  return {
    /** Requires config visibility, then returns the ordered category/item tree. */
    async list(input: ResolveRestaurantSettingsContextInput = {}): Promise<RestaurantMenuView> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureVisible(context, "restaurant_config");
      const categories = orderMenu(await dependencies.listMenu(context.scope));
      const canManage = restaurantConfigCanOperate(context);
      return { categories, canManage, readOnly: !canManage };
    },

    /**
     * Requires `restaurant_config: operate`, validates the submission with the
     * pure category validator, then creates or edits one category. A stored
     * duplicate maps to the already-exists message and a cap hit to the max
     * message; both preserve every stored row.
     */
    async saveCategory(
      input: SaveRestaurantMenuCategoryInput,
    ): Promise<SaveRestaurantMenuCategoryResult> {
      const context = await dependencies.resolveContext(input);
      // Reject before any repository write so view_only/none never persist.
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");

      const editingCategoryId = trimmedString(input.categoryId) || null;
      const menu = await dependencies.listMenu(context.scope);
      const menuContext: MenuContext = {
        existingCategoryNames: menu.map<ExistingMenuCategoryName>((category) => ({
          id: category.id,
          name: category.name,
        })),
        editingCategoryId,
        categoryCount: menu.length,
        itemCount: countMenuItems(menu),
        highestCategoryDisplayOrder: highestDisplayOrder(menu),
      };

      const validated = validateMenuCategory(
        { name: input.name, displayOrder: input.displayOrder },
        menuContext,
      );
      if (!validated.ok) return { status: "invalid", errors: validated.errors };

      const result = await dependencies.saveMenuCategory(
        context.scope,
        validated.value,
        editingCategoryId ?? undefined,
      );
      switch (result.status) {
        case "saved":
          return { status: "saved", category: result.category };
        case "duplicate":
          // Req 6.5: a case-insensitive stored duplicate is rejected verbatim.
          return { status: "duplicate", message: MSG_MENU_CATEGORY_ALREADY_EXISTS };
        case "category_limit":
          // Req 6.13: a raced cap hit preserves every row and names the max.
          return { status: "limit", message: MSG_MAX_MENU_CATEGORIES };
        case "not_found":
          return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      }
    },

    /**
     * Requires `restaurant_config: operate`, validates every item field
     * together (including same-scope category membership and the tenant cap),
     * then creates or edits one item. A cap hit maps to the max message and a
     * category that vanished maps to the stable category-reference error; both
     * preserve every stored row.
     */
    async saveItem(input: SaveRestaurantMenuItemInput): Promise<SaveRestaurantMenuItemResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");

      const editingItemId = trimmedString(input.itemId) || null;
      const categoryId = trimmedString(input.categoryId);
      const menu = await dependencies.listMenu(context.scope);
      const targetCategory = menu.find((category) => category.id === categoryId);
      const menuContext: MenuContext = {
        existingCategoryNames: menu.map<ExistingMenuCategoryName>((category) => ({
          id: category.id,
          name: category.name,
        })),
        editingItemId,
        categoryCount: menu.length,
        itemCount: countMenuItems(menu),
        // Item display order defaults within its own category.
        highestItemDisplayOrder: highestDisplayOrder(targetCategory?.items ?? []),
        // Only a same-scope category id is a valid reference (Req 6.3, 10.11).
        validCategoryIds: menu.map((category) => category.id),
      };

      const validated = validateMenuItem(
        {
          categoryId: input.categoryId,
          name: input.name,
          priceMinor: input.priceMinor,
          description: input.description,
          displayOrder: input.displayOrder,
          state: input.state,
        },
        menuContext,
      );
      if (!validated.ok) return { status: "invalid", errors: validated.errors };

      const result = await dependencies.saveMenuItem(
        context.scope,
        validated.value,
        editingItemId ?? undefined,
      );
      switch (result.status) {
        case "saved":
          return { status: "saved", item: result.item };
        case "category_not_found":
          // The chosen category vanished between read and write; surface it as a
          // same-scope reference error rather than leaking scope details.
          return {
            status: "invalid",
            errors: [{ field: "categoryId", message: MSG_MENU_CATEGORY_REFERENCE }],
          };
        case "item_limit":
          // Req 6.13: a raced cap hit preserves every row and names the max.
          return { status: "limit", message: MSG_MAX_MENU_ITEMS };
        case "not_found":
          return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      }
    },

    /**
     * Requires `restaurant_config: operate`, then sets an item's publication
     * state. An `unavailable` item is retained in the dashboard tree (Req 6.8);
     * only the public projection drops it. A miss maps to not found.
     */
    async setItemState(
      input: SetRestaurantMenuItemStateInput,
    ): Promise<SetRestaurantMenuItemStateResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");

      if (!(MENU_ITEM_STATES as readonly unknown[]).includes(input.state)) {
        return { status: "invalid", errors: [{ field: "state", message: MSG_MENU_ITEM_STATE }] };
      }
      const result = await dependencies.updateMenuItemState(
        context.scope,
        trimmedString(input.itemId),
        input.state as MenuItemState,
      );
      return result.status === "saved"
        ? { status: "saved", item: result.item }
        : { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
    },

    /**
     * Requires `restaurant_config: operate`, then deletes exactly the addressed
     * item under the resolved scope. A miss maps to not found.
     */
    async removeItem(
      input: DeleteRestaurantMenuItemInput,
    ): Promise<DeleteRestaurantMenuItemResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");
      const result = await dependencies.deleteMenuItem(context.scope, trimmedString(input.itemId));
      return result.status === "deleted"
        ? { status: "deleted" }
        : { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
    },

    /**
     * First cascade step (Req 6.6): requires `operate` and returns the count of
     * items the deletion would remove without changing any stored row. A miss
     * maps to not found.
     */
    async previewCategoryDeletion(
      input: RestaurantMenuCategoryIdInput,
    ): Promise<PreviewRestaurantMenuCategoryDeletionResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");
      const result = await dependencies.previewMenuCategoryDeletion(
        context.scope,
        trimmedString(input.categoryId),
      );
      if (result.status === "not_found") {
        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      }
      return result;
    },

    /**
     * Second cascade step (Req 6.7): requires `operate` and transactionally
     * deletes the category and every item it holds under the resolved scope. A
     * miss maps to not found.
     */
    async confirmCategoryDeletion(
      input: RestaurantMenuCategoryIdInput,
    ): Promise<ConfirmDeleteRestaurantMenuCategoryResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "restaurant_config");
      const result = await dependencies.confirmDeleteMenuCategory(
        context.scope,
        trimmedString(input.categoryId),
      );
      return result.status === "deleted"
        ? { status: "deleted", deletedItemCount: result.deletedItemCount }
        : { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
    },
  };
}

let restaurantMenuServiceInstance: ReturnType<typeof createRestaurantMenuService> | undefined;
const restaurantMenuService = createServerOnlyFn(
  () => (restaurantMenuServiceInstance ??= createRestaurantMenuService()),
);

/** Default production entry point: reads the scope's ordered menu tree. */
export function listRestaurantMenu(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<RestaurantMenuView> {
  return restaurantMenuService().list(input);
}

/** Default production entry point: validates and creates/edits one category. */
export function saveRestaurantMenuCategory(
  input: SaveRestaurantMenuCategoryInput,
): Promise<SaveRestaurantMenuCategoryResult> {
  return restaurantMenuService().saveCategory(input);
}

/** Default production entry point: validates and creates/edits one item. */
export function saveRestaurantMenuItem(
  input: SaveRestaurantMenuItemInput,
): Promise<SaveRestaurantMenuItemResult> {
  return restaurantMenuService().saveItem(input);
}

/** Default production entry point: guarded item state change. */
export function setRestaurantMenuItemState(
  input: SetRestaurantMenuItemStateInput,
): Promise<SetRestaurantMenuItemStateResult> {
  return restaurantMenuService().setItemState(input);
}

/** Default production entry point: guarded scoped item delete. */
export function deleteRestaurantMenuItem(
  input: DeleteRestaurantMenuItemInput,
): Promise<DeleteRestaurantMenuItemResult> {
  return restaurantMenuService().removeItem(input);
}

/** Default production entry point: cascade preview (first delete step). */
export function previewRestaurantMenuCategoryDeletion(
  input: RestaurantMenuCategoryIdInput,
): Promise<PreviewRestaurantMenuCategoryDeletionResult> {
  return restaurantMenuService().previewCategoryDeletion(input);
}

/** Default production entry point: confirmed cascade delete (second step). */
export function confirmDeleteRestaurantMenuCategory(
  input: RestaurantMenuCategoryIdInput,
): Promise<ConfirmDeleteRestaurantMenuCategoryResult> {
  return restaurantMenuService().confirmCategoryDeletion(input);
}

// ---------------------------------------------------------------------------
// Guarded menu server functions
// ---------------------------------------------------------------------------

/** Guarded read consumed by the `Menu` sub-tab; returns the ordered tree. */
export const getRestaurantMenuServerFn = createServerFn({ method: "GET" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => listRestaurantMenu(data));

/**
 * Guarded category create/edit consumed by the `Menu` sub-tab. Only an account
 * resolving `restaurant_config: operate` reaches the store; a stored duplicate
 * or cap hit returns its stable message and changes nothing.
 */
export const saveRestaurantMenuCategoryServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      categoryId?: string | null;
      name: unknown;
      displayOrder?: unknown;
      requestedLocationId?: string | null;
    }) => ({
      categoryId: data?.categoryId ?? null,
      name: data?.name,
      displayOrder: data?.displayOrder,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => saveRestaurantMenuCategory(data));

/**
 * Guarded item create/edit consumed by the `Menu` sub-tab. The category must
 * belong to the resolved tenant/location scope; a cap hit returns the max
 * message and changes nothing.
 */
export const saveRestaurantMenuItemServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      itemId?: string | null;
      categoryId: unknown;
      name: unknown;
      priceMinor: unknown;
      description?: unknown;
      displayOrder?: unknown;
      state?: unknown;
      requestedLocationId?: string | null;
    }) => ({
      itemId: data?.itemId ?? null,
      categoryId: data?.categoryId,
      name: data?.name,
      priceMinor: data?.priceMinor,
      description: data?.description,
      displayOrder: data?.displayOrder,
      state: data?.state,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => saveRestaurantMenuItem(data));

/**
 * Guarded item state change consumed by the `Menu` sub-tab. An `unavailable`
 * item stays in the dashboard tree; only the public projection drops it.
 */
export const setRestaurantMenuItemStateServerFn = createServerFn({ method: "POST" })
  .validator((data: { itemId: string; state: unknown; requestedLocationId?: string | null }) => {
    const itemId = trimmedString(data?.itemId);
    if (!itemId) throw new Error("A menu item id is required");
    return { itemId, state: data?.state, requestedLocationId: data?.requestedLocationId ?? null };
  })
  .handler(({ data }) => setRestaurantMenuItemState(data));

/** Guarded item delete consumed by the `Menu` sub-tab. */
export const deleteRestaurantMenuItemServerFn = createServerFn({ method: "POST" })
  .validator((data: { itemId: string; requestedLocationId?: string | null }) => {
    const itemId = trimmedString(data?.itemId);
    if (!itemId) throw new Error("A menu item id is required");
    return { itemId, requestedLocationId: data?.requestedLocationId ?? null };
  })
  .handler(({ data }) => deleteRestaurantMenuItem(data));

/**
 * Guarded first cascade step consumed by the `Menu` sub-tab. Returns the count
 * of items a category deletion would remove without changing any stored row.
 */
export const previewRestaurantMenuCategoryDeletionServerFn = createServerFn({ method: "POST" })
  .validator((data: { categoryId: string; requestedLocationId?: string | null }) => {
    const categoryId = trimmedString(data?.categoryId);
    if (!categoryId) throw new Error("A menu category id is required");
    return { categoryId, requestedLocationId: data?.requestedLocationId ?? null };
  })
  .handler(({ data }) => previewRestaurantMenuCategoryDeletion(data));

/**
 * Guarded second cascade step consumed by the `Menu` sub-tab. Transactionally
 * deletes the confirmed category and every item it holds under the scope.
 */
export const confirmDeleteRestaurantMenuCategoryServerFn = createServerFn({ method: "POST" })
  .validator((data: { categoryId: string; requestedLocationId?: string | null }) => {
    const categoryId = trimmedString(data?.categoryId);
    if (!categoryId) throw new Error("A menu category id is required");
    return { categoryId, requestedLocationId: data?.requestedLocationId ?? null };
  })
  .handler(({ data }) => confirmDeleteRestaurantMenuCategory(data));

// ---------------------------------------------------------------------------
// WhatsApp alert configuration and device pairing
//
// The WhatsApp Settings surface is guarded by the plan-gated `whatsapp` feature
// (Req 7.1, 10.9, 10.10): the status read requires the feature to be visible,
// and every state-changing action (config save, initialize/pairing, disconnect,
// test-message queue) requires `whatsapp: operate` and is refused before any
// repository or microservice call so a `view_only`/`none` account never reaches
// a state-changing adapter (Req 10.10).
//
// Session state is read through the strict `whatsAppSettingsAdapter`, which
// surfaces a transport failure as an explicit `ERROR` state instead of the
// tolerant `DISCONNECTED` used by booking notifications (Req 7.4, 7.13). The
// stored WhatsApp_Alert_Config is loaded separately from the status read, so a
// status transport failure still returns the stored config unchanged (Req 7.13).
//
// A failed config save (Req 7.11) or a failed test-message queue (Req 7.12)
// returns an error, never reports success, and leaves the prior stored
// WhatsApp_Alert_Config unchanged. The adapter never conflates a transport
// failure with success, so an unconfirmed action always maps to an error result.
// ---------------------------------------------------------------------------

/** Stable messages for the WhatsApp Settings surface (shared with the UI). */
export const MSG_WHATSAPP_CONFIG_SAVE_FAILED = "The WhatsApp alert settings could not be saved";
export const MSG_WHATSAPP_TEST_MESSAGE_FAILED = "The test message could not be queued";
export const MSG_WHATSAPP_INITIALIZE_FAILED = "WhatsApp pairing could not be started";
export const MSG_WHATSAPP_DISCONNECT_FAILED = "The WhatsApp session could not be disconnected";
/** Req 7.13: shown alongside the `ERROR` state when the status read fails. */
export const MSG_WHATSAPP_STATUS_READ_FAILED = "The WhatsApp session state could not be read";

/** Default body used for a test message when the caller supplies none. */
const WHATSAPP_TEST_MESSAGE_BODY = "This is a test message from your restaurant dashboard.";

/** True exactly when the resolved `whatsapp` permission is `operate`. */
function whatsAppCanOperate(context: AuthenticatedRestaurantSettingsContext): boolean {
  return (context.access as ResolvedAccess | null)?.whatsapp?.permission === "operate";
}

/** Coerces a submitted enabled flag to a strict boolean. */
function toWhatsAppEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export interface WhatsAppSettingsStatusView {
  /** The stored WhatsApp_Alert_Config, loaded separately from the status read. */
  config: WhatsAppAlertConfig | null;
  /** Strict session state; a transport failure is surfaced as `ERROR`. */
  status: WhatsAppSettingsStatus;
  /** True when the caller resolves `whatsapp: operate` (controls are hidden otherwise). */
  canOperate: boolean;
  /** Req 7.13: message to display when the status read failed to `ERROR`. */
  statusMessage: string | null;
}

export interface WhatsAppSettingsStatusInput extends ResolveRestaurantSettingsContextInput {}

export interface SaveWhatsAppSettingsConfigInput extends ResolveRestaurantSettingsContextInput {
  phoneNumber: unknown;
  isEnabled: unknown;
}

export type SaveWhatsAppSettingsConfigResult =
  | { status: "saved"; config: WhatsAppAlertConfig }
  | { status: "error"; message: string; config: WhatsAppAlertConfig | null };

export type WhatsAppSettingsActionResult = { status: "ok" } | { status: "error"; message: string };

export interface WhatsAppSettingsTestMessageInput extends ResolveRestaurantSettingsContextInput {
  phone: unknown;
  body?: unknown;
}

export type WhatsAppSettingsTestMessageResult =
  | { status: "queued" }
  | { status: "error"; message: string };

export interface WhatsAppSettingsServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  getWhatsAppConfig(tenantId: string): Promise<WhatsAppAlertConfig | null>;
  saveWhatsAppConfig(
    tenantId: string,
    input: SaveWhatsAppAlertConfigInput,
  ): Promise<WhatsAppAlertConfig>;
  readStatus(tenantId: string): Promise<WhatsAppSettingsStatus>;
  initialize(tenantId: string): Promise<WhatsAppActionOutcome>;
  disconnect(tenantId: string): Promise<WhatsAppActionOutcome>;
  sendTestMessage(tenantId: string, phone: string, body: string): Promise<WhatsAppActionOutcome>;
}

const defaultWhatsAppSettingsDependencies = createServerOnlyFn(
  (): WhatsAppSettingsServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    getWhatsAppConfig: (tenantId) => restaurantSettingsRepository.getWhatsAppConfig(tenantId),
    saveWhatsAppConfig: (tenantId, input) =>
      restaurantSettingsRepository.saveWhatsAppConfig(tenantId, input),
    readStatus: (tenantId) => whatsAppSettingsAdapter.readStatus(tenantId),
    initialize: (tenantId) => whatsAppSettingsAdapter.initialize(tenantId),
    disconnect: (tenantId) => whatsAppSettingsAdapter.disconnect(tenantId),
    sendTestMessage: (tenantId, phone, body) =>
      whatsAppSettingsAdapter.sendTestMessage(tenantId, phone, body),
  }),
);

/**
 * Builds the guarded WhatsApp Settings service around injectable I/O so
 * authorization, strict status mapping, and no-false-success behavior can be
 * exercised with fakes and without cookies, SQL, or the microservice.
 */
export function createWhatsAppSettingsService(
  overrides: Partial<WhatsAppSettingsServiceDependencies> = {},
) {
  const dependencies: WhatsAppSettingsServiceDependencies = {
    ...defaultWhatsAppSettingsDependencies(),
    ...overrides,
  };

  /** Reads the stored config without letting a read failure throw. */
  async function safeReadConfig(tenantId: string): Promise<WhatsAppAlertConfig | null> {
    try {
      return await dependencies.getWhatsAppConfig(tenantId);
    } catch {
      return null;
    }
  }

  return {
    /**
     * Requires the `whatsapp` feature to be visible, then returns the stored
     * config plus the strict session state. The config is loaded separately from
     * the status read so a status transport failure (mapped to `ERROR`) still
     * returns the stored config unchanged (Req 7.2, 7.4, 7.13).
     */
    async status(input: WhatsAppSettingsStatusInput = {}): Promise<WhatsAppSettingsStatusView> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureVisible(context, "whatsapp");
      const [config, status] = await Promise.all([
        safeReadConfig(context.tenantId),
        dependencies.readStatus(context.tenantId),
      ]);
      return {
        config,
        status,
        canOperate: whatsAppCanOperate(context),
        statusMessage: status.state === "ERROR" ? MSG_WHATSAPP_STATUS_READ_FAILED : null,
      };
    },

    /**
     * Requires `whatsapp: operate`, then stores the trimmed alert phone number
     * and enabled flag (Req 7.3). A storage failure returns an error, reports no
     * success, and leaves the prior stored config unchanged (Req 7.11, 11.2).
     */
    async saveConfig(
      input: SaveWhatsAppSettingsConfigInput,
    ): Promise<SaveWhatsAppSettingsConfigResult> {
      const context = await dependencies.resolveContext(input);
      // Reject before any repository write so view_only/none never persist.
      assertRestaurantSettingsFeatureOperate(context, "whatsapp");
      const payload: SaveWhatsAppAlertConfigInput = {
        phoneNumber: trimmedString(input.phoneNumber),
        isEnabled: toWhatsAppEnabled(input.isEnabled),
      };
      try {
        const config = await dependencies.saveWhatsAppConfig(context.tenantId, payload);
        return { status: "saved", config };
      } catch {
        // Preserve the prior stored config and never report success (Req 7.11).
        const config = await safeReadConfig(context.tenantId);
        return { status: "error", message: MSG_WHATSAPP_CONFIG_SAVE_FAILED, config };
      }
    },

    /**
     * Requires `whatsapp: operate`, then (re-)initializes device pairing. The
     * adapter reports `error` unless the microservice confirms success, so an
     * unconfirmed or failed call never reports success (Req 7.6, 10.10).
     */
    async initialize(
      input: ResolveRestaurantSettingsContextInput = {},
    ): Promise<WhatsAppSettingsActionResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "whatsapp");
      const outcome = await dependencies.initialize(context.tenantId);
      return outcome.status === "ok"
        ? { status: "ok" }
        : { status: "error", message: MSG_WHATSAPP_INITIALIZE_FAILED };
    },

    /**
     * Requires `whatsapp: operate`, then disconnects the paired device. Reports
     * `error` unless the microservice confirms success (Req 7.8, 10.10).
     */
    async disconnect(
      input: ResolveRestaurantSettingsContextInput = {},
    ): Promise<WhatsAppSettingsActionResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "whatsapp");
      const outcome = await dependencies.disconnect(context.tenantId);
      return outcome.status === "ok"
        ? { status: "ok" }
        : { status: "error", message: MSG_WHATSAPP_DISCONNECT_FAILED };
    },

    /**
     * Requires `whatsapp: operate`, then queues a test message. A failed queue
     * returns an error and reports no successful queue outcome (Req 7.9, 7.12).
     * Queueing never touches the stored config, so the prior config is retained.
     */
    async sendTestMessage(
      input: WhatsAppSettingsTestMessageInput,
    ): Promise<WhatsAppSettingsTestMessageResult> {
      const context = await dependencies.resolveContext(input);
      assertRestaurantSettingsFeatureOperate(context, "whatsapp");
      const phone = trimmedString(input.phone);
      const body = trimmedString(input.body) || WHATSAPP_TEST_MESSAGE_BODY;
      const outcome = await dependencies.sendTestMessage(context.tenantId, phone, body);
      return outcome.status === "ok"
        ? { status: "queued" }
        : { status: "error", message: MSG_WHATSAPP_TEST_MESSAGE_FAILED };
    },
  };
}

let whatsAppSettingsServiceInstance: ReturnType<typeof createWhatsAppSettingsService> | undefined;
const whatsAppSettingsService = createServerOnlyFn(
  () => (whatsAppSettingsServiceInstance ??= createWhatsAppSettingsService()),
);

/** Default production entry point: stored config plus strict session state. */
export function getWhatsAppSettingsStatus(
  input: WhatsAppSettingsStatusInput = {},
): Promise<WhatsAppSettingsStatusView> {
  return whatsAppSettingsService().status(input);
}

/** Default production entry point: guarded WhatsApp_Alert_Config save. */
export function saveWhatsAppSettingsConfig(
  input: SaveWhatsAppSettingsConfigInput,
): Promise<SaveWhatsAppSettingsConfigResult> {
  return whatsAppSettingsService().saveConfig(input);
}

/** Default production entry point: guarded pairing (re-)initialization. */
export function initializeWhatsAppSettings(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<WhatsAppSettingsActionResult> {
  return whatsAppSettingsService().initialize(input);
}

/** Default production entry point: guarded session disconnect. */
export function disconnectWhatsAppSettings(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<WhatsAppSettingsActionResult> {
  return whatsAppSettingsService().disconnect(input);
}

/** Default production entry point: guarded test-message queue. */
export function sendWhatsAppSettingsTestMessage(
  input: WhatsAppSettingsTestMessageInput,
): Promise<WhatsAppSettingsTestMessageResult> {
  return whatsAppSettingsService().sendTestMessage(input);
}

/**
 * Guarded status read consumed by the `WhatsApp Alerts` sub-tab. Requires the
 * `whatsapp` feature to be visible and returns the stored WhatsApp_Alert_Config
 * plus the strict session state; a status transport failure surfaces as `ERROR`
 * while the stored config is still returned (Req 7.2, 7.4, 7.13).
 */
export const getWhatsAppSettingsStatusServerFn = createServerFn({ method: "GET" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => getWhatsAppSettingsStatus(data));

/**
 * Guarded config save consumed by the `WhatsApp Alerts` sub-tab. Only an account
 * resolving `whatsapp: operate` reaches the store; a storage failure returns an
 * error, reports no success, and preserves the prior config (Req 7.3, 7.11, 11.2).
 */
export const saveWhatsAppSettingsConfigServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      phoneNumber?: unknown;
      isEnabled?: unknown;
      requestedLocationId?: string | null;
    }) => ({
      phoneNumber: data?.phoneNumber,
      isEnabled: data?.isEnabled,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => saveWhatsAppSettingsConfig(data));

/**
 * Guarded pairing (re-)initialization consumed by the `WhatsApp Alerts` sub-tab.
 * Requires `whatsapp: operate`; an unconfirmed or failed call reports an error
 * and never reports success (Req 7.6, 10.10).
 */
export const initializeWhatsAppSettingsServerFn = createServerFn({ method: "POST" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => initializeWhatsAppSettings(data));

/**
 * Guarded session disconnect consumed by the `WhatsApp Alerts` sub-tab. Requires
 * `whatsapp: operate`; an unconfirmed or failed call reports an error (Req 7.8).
 */
export const disconnectWhatsAppSettingsServerFn = createServerFn({ method: "POST" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => disconnectWhatsAppSettings(data));

/**
 * Guarded test-message queue consumed by the `WhatsApp Alerts` sub-tab. Requires
 * `whatsapp: operate`; a failed queue reports an error and no successful queue
 * outcome, leaving the stored config unchanged (Req 7.9, 7.12).
 */
export const sendWhatsAppSettingsTestMessageServerFn = createServerFn({ method: "POST" })
  .validator((data: { phone?: unknown; body?: unknown; requestedLocationId?: string | null }) => ({
    phone: data?.phone,
    body: data?.body,
    requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
  }))
  .handler(({ data }) => sendWhatsAppSettingsTestMessage(data));

// ---------------------------------------------------------------------------
// Guarded SubUser lifecycle
//
// Complete tenant-scoped user management: list, create, edit, password update,
// deactivate, and delete with tenant email uniqueness, shared role limits,
// session revocation, optional-password updates, confirmations, and plan-upgrade
// outcomes. All writes require `users: operate` and preserve all users unchanged
// on validation, plan, authorization, or storage failure (Req 8.1-8.15, 10.5, 10.6).
// ---------------------------------------------------------------------------

export interface RestaurantUsersListView {
  users: SubUser[];
  planLimits: SubUserPlanLimits;
}

export interface CreateRestaurantUserInput extends ResolveRestaurantSettingsContextInput {
  name: unknown;
  email: unknown;
  phone?: unknown;
  role: unknown;
  password: unknown;
  confirmation: unknown;
}

export interface UpdateRestaurantUserInput extends ResolveRestaurantSettingsContextInput {
  id: string;
  name: unknown;
  email: unknown;
  phone?: unknown;
  role: unknown;
  password?: unknown;
  confirmation?: unknown;
  isActive?: unknown;
}

export interface DeactivateRestaurantUserInput extends ResolveRestaurantSettingsContextInput {
  id: string;
  isActive: boolean;
}

export interface DeleteRestaurantUserInput extends ResolveRestaurantSettingsContextInput {
  id: string;
}

export type CreateRestaurantUserResult =
  | { status: "created"; id: string }
  | { status: "validation_failed"; errors: FieldError[] }
  | { status: "email_taken"; message: string }
  | { status: "role_limit_exceeded"; message: string; decision: SubUserRoleChangeDecision }
  | { status: "storage_failed"; message: string };

export type UpdateRestaurantUserResult =
  | { status: "updated" }
  | { status: "validation_failed"; errors: FieldError[] }
  | { status: "email_taken"; message: string }
  | { status: "role_limit_exceeded"; message: string; decision: SubUserRoleChangeDecision }
  | { status: "not_found"; message: string }
  | { status: "storage_failed"; message: string };

export type DeactivateRestaurantUserResult =
  | { status: "updated" }
  | { status: "not_found"; message: string };

export type DeleteRestaurantUserResult =
  | { status: "deleted" }
  | { status: "not_found"; message: string };

export interface RestaurantUserServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  listSubUsers(tenantId: string): Promise<StoredSubUser[]>;
  getSubUserRoleCounts(tenantId: string): Promise<UserRoleCounts>;
  checkEmailUnique(tenantId: string, email: string, excludeId?: string): Promise<boolean>;
  getSubUserById(tenantId: string, id: string): Promise<StoredSubUser | null>;
  createSubUser(tenantId: string, input: CreateSubUserInput): Promise<CreateSubUserResult>;
  updateSubUser(
    tenantId: string,
    id: string,
    input: UpdateSubUserInput,
  ): Promise<UpdateSubUserResult>;
  setSubUserActive(
    tenantId: string,
    id: string,
    isActive: boolean,
  ): Promise<SubUserLifecycleResult>;
  deleteSubUser(tenantId: string, id: string): Promise<DeleteSubUserResult>;
  hashPassword(password: string): Promise<string>;
}

const defaultRestaurantUserServiceDependencies = createServerOnlyFn(
  (): RestaurantUserServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    listSubUsers: (tenantId) => restaurantSettingsRepository.listSubUsers(tenantId),
    getSubUserRoleCounts: (tenantId) => restaurantSettingsRepository.getSubUserRoleCounts(tenantId),
    checkEmailUnique: (tenantId, email, excludeId) =>
      restaurantSettingsRepository.checkTenantAccountEmailUnique(tenantId, email, excludeId),
    getSubUserById: (tenantId, id) => {
      return restaurantSettingsRepository
        .listSubUsers(tenantId)
        .then((users) => users.find((u) => u.id === id) ?? null);
    },
    createSubUser: (tenantId, input) => restaurantSettingsRepository.createSubUser(tenantId, input),
    updateSubUser: (tenantId, id, input) =>
      restaurantSettingsRepository.updateSubUser(tenantId, id, input),
    setSubUserActive: (tenantId, id, isActive) =>
      restaurantSettingsRepository.setSubUserActive(tenantId, id, isActive),
    deleteSubUser: (tenantId, id) => restaurantSettingsRepository.deleteSubUser(tenantId, id),
    hashPassword: (password) => bcrypt.hash(password, 10),
  }),
);

function isSubUserRole(value: unknown): value is SubUserRole {
  return typeof value === "string" && (SUB_USER_ROLES as readonly string[]).includes(value);
}

function validateSubUserInput(
  input: SubUserInput,
  requirePassword: boolean,
):
  | {
      ok: true;
      value: {
        name: string;
        email: string;
        phone: string;
        role: SubUserRole;
        password?: string;
        isActive: boolean;
      };
    }
  | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];

  const name = trimmedString(input.name);
  if (!name || name.length < 1 || name.length > 100) {
    errors.push({ field: "name", message: "Name must be between 1 and 100 characters" });
  }

  const email = normaliseEmail(input.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: "email", message: "Valid email address is required" });
  }

  const phone = trimmedString(input.phone);

  const role = isSubUserRole(input.role) ? input.role : null;
  if (!role) {
    errors.push({ field: "role", message: MSG_SUB_USER_ROLE });
  }

  let password: string | undefined;
  if (requirePassword) {
    const pwd = trimmedString(input.password);
    const conf = trimmedString(input.confirmation);

    if (!pwd || pwd.length < 8) {
      errors.push({ field: "password", message: MSG_PASSWORD_MIN_LENGTH });
    } else if (pwd !== conf) {
      errors.push({ field: "confirmation", message: MSG_PASSWORDS_DO_NOT_MATCH });
    } else {
      password = pwd;
    }
  } else if (input.password) {
    // Optional password for edit
    const pwd = trimmedString(input.password);
    const conf = trimmedString(input.confirmation);

    if (pwd.length > 0) {
      if (pwd.length < 8) {
        errors.push({ field: "password", message: MSG_PASSWORD_MIN_LENGTH });
      } else if (pwd !== conf) {
        errors.push({ field: "confirmation", message: MSG_PASSWORDS_DO_NOT_MATCH });
      } else {
        password = pwd;
      }
    }
  }

  const isActive = input.isActive === false ? false : true;

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { name, email, phone, role: role!, password, isActive },
  };
}

/**
 * Creates the SubUser lifecycle service around injectable I/O so user
 * management, plan limits, and authorization can be tested with fakes.
 */
export function createRestaurantUserService(
  overrides: Partial<RestaurantUserServiceDependencies> = {},
) {
  const dependencies: RestaurantUserServiceDependencies = {
    ...defaultRestaurantUserServiceDependencies(),
    ...overrides,
  };

  return {
    async list(
      input: ResolveRestaurantSettingsContextInput = {},
    ): Promise<RestaurantUsersListView> {
      return withRestaurantSettingsFeatureRead("users", input, async (context) => {
        const [users, counts] = await Promise.all([
          dependencies.listSubUsers(context.tenantId),
          dependencies.getSubUserRoleCounts(context.tenantId),
        ]);

        const planLimits = resolveSubUserPlanLimits(context.session.subscriptionPlan, counts);

        return {
          users: users.map(
            (u): SubUser => ({
              id: u.id,
              name: u.name,
              email: u.email,
              phone: u.phone,
              role: u.role,
              isActive: u.isActive,
            }),
          ),
          planLimits,
        };
      });
    },

    async create(input: CreateRestaurantUserInput): Promise<CreateRestaurantUserResult> {
      return withRestaurantSettingsFeatureWrite("users", input, async (context) => {
        // Validate input first
        const validation = validateSubUserInput(input, true);
        if (!validation.ok) {
          return { status: "validation_failed", errors: validation.errors };
        }

        const { name, email, phone, role, password } = validation.value;

        // Check email uniqueness
        const isUnique = await dependencies.checkEmailUnique(context.tenantId, email);
        if (!isUnique) {
          return { status: "email_taken", message: MSG_SUB_USER_EMAIL_IN_USE };
        }

        // Check plan limits for the requested role
        const counts = await dependencies.getSubUserRoleCounts(context.tenantId);
        const roleDecision = resolveSubUserRoleChange({
          plan: context.session.subscriptionPlan,
          counts,
          requestedRole: role,
          previousRole: null,
        });

        if (!roleDecision.allowed) {
          return {
            status: "role_limit_exceeded",
            message: roleDecision.message,
            decision: roleDecision,
          };
        }

        // Hash password and create user
        const passwordHash = await dependencies.hashPassword(password!);
        const createInput: CreateSubUserInput = {
          name,
          email,
          phone,
          role,
          passwordHash,
          isActive: true,
        };

        const result = await dependencies.createSubUser(context.tenantId, createInput);

        if (result.status === "created") {
          return { status: "created", id: result.id };
        } else if (result.status === "duplicate") {
          return { status: "email_taken", message: MSG_SUB_USER_EMAIL_IN_USE };
        }

        return { status: "storage_failed", message: MSG_SUB_USER_CREATE_FAILED };
      });
    },

    async update(input: UpdateRestaurantUserInput): Promise<UpdateRestaurantUserResult> {
      return withRestaurantSettingsFeatureWrite("users", input, async (context) => {
        // Check if user exists
        const existing = await dependencies.getSubUserById(context.tenantId, input.id);
        if (!existing) {
          return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
        }

        // Validate input (password is optional for edit)
        const validation = validateSubUserInput(input, false);
        if (!validation.ok) {
          return { status: "validation_failed", errors: validation.errors };
        }

        const { name, email, phone, role, password, isActive } = validation.value;

        // Check email uniqueness (excluding current user)
        const isUnique = await dependencies.checkEmailUnique(context.tenantId, email, input.id);
        if (!isUnique) {
          return { status: "email_taken", message: MSG_SUB_USER_EMAIL_IN_USE };
        }

        // Check plan limits if role is changing
        if (role !== existing.role) {
          const counts = await dependencies.getSubUserRoleCounts(context.tenantId);
          const roleDecision = resolveSubUserRoleChange({
            plan: context.session.subscriptionPlan,
            counts,
            requestedRole: role,
            previousRole: existing.role,
          });

          if (!roleDecision.allowed) {
            return {
              status: "role_limit_exceeded",
              message: roleDecision.message,
              decision: roleDecision,
            };
          }
        }

        // Hash password if provided
        const passwordHash = password ? await dependencies.hashPassword(password) : undefined;

        const updateInput: UpdateSubUserInput = {
          name,
          email,
          phone,
          role,
          passwordHash,
          isActive,
        };

        const result = await dependencies.updateSubUser(context.tenantId, input.id, updateInput);

        if (result.status === "updated") {
          return { status: "updated" };
        } else if (result.status === "not_found") {
          return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
        } else if (result.status === "duplicate") {
          return { status: "email_taken", message: MSG_SUB_USER_EMAIL_IN_USE };
        }

        return { status: "storage_failed", message: "User could not be updated" };
      });
    },

    async setActive(input: DeactivateRestaurantUserInput): Promise<DeactivateRestaurantUserResult> {
      return withRestaurantSettingsFeatureWrite("users", input, async (context) => {
        const result = await dependencies.setSubUserActive(
          context.tenantId,
          input.id,
          input.isActive,
        );

        if (result.status === "updated") {
          return { status: "updated" };
        }

        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      });
    },

    async delete(input: DeleteRestaurantUserInput): Promise<DeleteRestaurantUserResult> {
      return withRestaurantSettingsFeatureWrite("users", input, async (context) => {
        const result = await dependencies.deleteSubUser(context.tenantId, input.id);

        if (result.status === "deleted") {
          return { status: "deleted" };
        }

        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      });
    },
  };
}

let restaurantUserServiceInstance: ReturnType<typeof createRestaurantUserService> | undefined;
const restaurantUserService = createServerOnlyFn(
  () => (restaurantUserServiceInstance ??= createRestaurantUserService()),
);

/** Default production entry point: list SubUsers with plan limits. */
export function getRestaurantUsers(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<RestaurantUsersListView> {
  return restaurantUserService().list(input);
}

/** Default production entry point: create a SubUser with validation and limits. */
export function createRestaurantUser(
  input: CreateRestaurantUserInput,
): Promise<CreateRestaurantUserResult> {
  return restaurantUserService().create(input);
}

/** Default production entry point: update a SubUser with optional password. */
export function updateRestaurantUser(
  input: UpdateRestaurantUserInput,
): Promise<UpdateRestaurantUserResult> {
  return restaurantUserService().update(input);
}

/** Default production entry point: deactivate/activate a SubUser with session revocation. */
export function setRestaurantUserActive(
  input: DeactivateRestaurantUserInput,
): Promise<DeactivateRestaurantUserResult> {
  return restaurantUserService().setActive(input);
}

/** Default production entry point: delete a SubUser with session cleanup. */
export function deleteRestaurantUser(
  input: DeleteRestaurantUserInput,
): Promise<DeleteRestaurantUserResult> {
  return restaurantUserService().delete(input);
}

/**
 * Guarded list read consumed by the `Manage Users` sub-tab. Requires the
 * `users` feature to be visible and returns SubUsers with plan limits
 * (Req 8.1-8.3).
 */
export const getRestaurantUsersServerFn = createServerFn({ method: "GET" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => getRestaurantUsers(data));

/**
 * Guarded SubUser creation consumed by the `Manage Users` sub-tab. Requires
 * `users: operate` and validates tenant email uniqueness, role limits, and
 * password rules. Storage failure preserves all users unchanged (Req 8.4, 8.10-8.14).
 */
export const createRestaurantUserServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name?: unknown;
      email?: unknown;
      phone?: unknown;
      role?: unknown;
      password?: unknown;
      confirmation?: unknown;
      requestedLocationId?: string | null;
    }) => ({
      name: data?.name,
      email: data?.email,
      phone: data?.phone,
      role: data?.role,
      password: data?.password,
      confirmation: data?.confirmation,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => createRestaurantUser(data));

/**
 * Guarded SubUser update consumed by the `Manage Users` sub-tab. Requires
 * `users: operate`. Password is optional; omission retains the current hash.
 * Validates email uniqueness, role limits, and password rules (Req 8.5-8.7, 8.10-8.12).
 */
export const updateRestaurantUserServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id?: unknown;
      name?: unknown;
      email?: unknown;
      phone?: unknown;
      role?: unknown;
      password?: unknown;
      confirmation?: unknown;
      isActive?: unknown;
      requestedLocationId?: string | null;
    }) => ({
      id: String(data?.id ?? ""),
      name: data?.name,
      email: data?.email,
      phone: data?.phone,
      role: data?.role,
      password: data?.password,
      confirmation: data?.confirmation,
      isActive: data?.isActive,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => updateRestaurantUser(data));

/**
 * Guarded SubUser deactivation/activation consumed by the `Manage Users` sub-tab.
 * Requires `users: operate`. Deactivation removes sessions transactionally so
 * Feature Access denies subsequent requests immediately (Req 8.8).
 */
export const setRestaurantUserActiveServerFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown; isActive?: unknown; requestedLocationId?: string | null }) => ({
    id: String(data?.id ?? ""),
    isActive: data?.isActive === true,
    requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
  }))
  .handler(({ data }) => setRestaurantUserActive(data));

/**
 * Guarded SubUser deletion consumed by the `Manage Users` sub-tab. Requires
 * `users: operate` and confirmation. Removes sessions then the user row in one
 * transaction, leaving other users unchanged (Req 8.9).
 */
export const deleteRestaurantUserServerFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown; requestedLocationId?: string | null }) => ({
    id: String(data?.id ?? ""),
    requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
  }))
  .handler(({ data }) => deleteRestaurantUser(data));

// ---------------------------------------------------------------------------
// Guarded Branch (Location) lifecycle
//
// Shared Location operations refactored behind Feature Access: reads require the
// `locations` feature to be visible, and every write requires `locations:
// operate`. Branch rows are tenant-constrained, plan limits are centralized
// (the same helper feeds both the displayed limit and the create-time guard),
// and create/update/delete run transactionally in the repository. A refused or
// failed operation leaves every stored Branch_Account unchanged
// (Req 9.1, 9.2, 9.8, 10.7, 10.8).
// ---------------------------------------------------------------------------

const MSG_BRANCH_NAME_LENGTH = "Branch name must be between 1 and 100 characters";
const MSG_BRANCH_EMAIL = "Valid email address is required";
const MSG_BRANCH_EMAIL_IN_USE = "This email is already in use by another account";
const MSG_BRANCH_CREATE_FAILED = "Branch could not be created";
const MSG_BRANCH_UPDATE_FAILED = "Branch could not be updated";

/** Client-safe Branch_Account projection (excludes the stored password hash). */
export interface RestaurantBranch {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  managerName: string;
  profilePhoto: string | null;
  isActive: boolean;
}

export interface RestaurantBranchesListView {
  branches: RestaurantBranch[];
  planLimit: RestaurantLocationPlanLimit;
}

export interface CreateRestaurantBranchInput extends ResolveRestaurantSettingsContextInput {
  name: unknown;
  email: unknown;
  phone?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  pincode?: unknown;
  managerName?: unknown;
  password: unknown;
  confirmation: unknown;
}

export interface UpdateRestaurantBranchInput extends ResolveRestaurantSettingsContextInput {
  id: string;
  name: unknown;
  phone?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  pincode?: unknown;
  managerName?: unknown;
  password?: unknown;
  confirmation?: unknown;
  isActive?: unknown;
}

export interface DeactivateRestaurantBranchInput extends ResolveRestaurantSettingsContextInput {
  id: string;
  isActive: boolean;
}

export interface DeleteRestaurantBranchInput extends ResolveRestaurantSettingsContextInput {
  id: string;
}

export type CreateRestaurantBranchResult =
  | { status: "created"; id: string }
  | { status: "validation_failed"; errors: FieldError[] }
  | { status: "email_taken"; message: string }
  | { status: "plan_limit_exceeded"; message: string; planLimit: RestaurantLocationPlanLimit }
  | { status: "storage_failed"; message: string };

export type UpdateRestaurantBranchResult =
  | { status: "updated" }
  | { status: "validation_failed"; errors: FieldError[] }
  | { status: "not_found"; message: string }
  | { status: "storage_failed"; message: string };

export type DeactivateRestaurantBranchResult =
  | { status: "updated" }
  | { status: "not_found"; message: string };

export type DeleteRestaurantBranchResult =
  | { status: "deleted" }
  | { status: "not_found"; message: string };

interface BranchFieldInput {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  pincode?: unknown;
  managerName?: unknown;
  password?: unknown;
  confirmation?: unknown;
  isActive?: unknown;
}

interface ValidatedBranchFields {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  managerName: string;
  password?: string;
  isActive: boolean;
}

/**
 * Validates and trims Branch_Account fields. Email is validated only when it is
 * part of the operation (creation); a branch login email is not editable, so an
 * update never revalidates or rewrites it. Password is mandatory on creation and
 * optional on update, where an omitted password retains the stored hash.
 */
function validateBranchInput(
  input: BranchFieldInput,
  { requireEmail, requirePassword }: { requireEmail: boolean; requirePassword: boolean },
): { ok: true; value: ValidatedBranchFields } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];

  const name = trimmedString(input.name);
  if (!name || name.length < 1 || name.length > 100) {
    errors.push({ field: "name", message: MSG_BRANCH_NAME_LENGTH });
  }

  const email = normaliseEmail(input.email);
  if (requireEmail && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    errors.push({ field: "email", message: MSG_BRANCH_EMAIL });
  }

  const phone = trimmedString(input.phone);
  const address = trimmedString(input.address);
  const city = trimmedString(input.city);
  const state = trimmedString(input.state);
  const pincode = trimmedString(input.pincode);
  const managerName = trimmedString(input.managerName);

  let password: string | undefined;
  if (requirePassword) {
    const pwd = trimmedString(input.password);
    const conf = trimmedString(input.confirmation);
    if (!pwd || pwd.length < 8) {
      errors.push({ field: "password", message: MSG_PASSWORD_MIN_LENGTH });
    } else if (pwd !== conf) {
      errors.push({ field: "confirmation", message: MSG_PASSWORDS_DO_NOT_MATCH });
    } else {
      password = pwd;
    }
  } else if (input.password !== undefined && trimmedString(input.password).length > 0) {
    // Optional password on edit: validate only when a replacement is supplied.
    const pwd = trimmedString(input.password);
    const conf = trimmedString(input.confirmation);
    if (pwd.length < 8) {
      errors.push({ field: "password", message: MSG_PASSWORD_MIN_LENGTH });
    } else if (pwd !== conf) {
      errors.push({ field: "confirmation", message: MSG_PASSWORDS_DO_NOT_MATCH });
    } else {
      password = pwd;
    }
  }

  const isActive = input.isActive === false ? false : true;

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { name, email, phone, address, city, state, pincode, managerName, password, isActive },
  };
}

function branchListView(branch: StoredBranch): RestaurantBranch {
  return {
    id: branch.id,
    name: branch.name,
    email: branch.email,
    phone: branch.phone,
    address: branch.address,
    city: branch.city,
    state: branch.state,
    pincode: branch.pincode,
    managerName: branch.managerName,
    profilePhoto: branch.profilePhoto,
    isActive: branch.isActive,
  };
}

export interface RestaurantBranchServiceDependencies {
  resolveContext(
    input: ResolveRestaurantSettingsContextInput,
  ): Promise<AuthenticatedRestaurantSettingsContext>;
  listBranches(tenantId: string): Promise<StoredBranch[]>;
  getBranchCount(tenantId: string): Promise<number>;
  checkEmailUnique(tenantId: string, email: string, excludeId?: string): Promise<boolean>;
  createBranch(tenantId: string, input: CreateBranchInput): Promise<CreateBranchResult>;
  updateBranch(tenantId: string, id: string, input: UpdateBranchInput): Promise<UpdateBranchResult>;
  setBranchActive(tenantId: string, id: string, isActive: boolean): Promise<BranchLifecycleResult>;
  deleteBranch(tenantId: string, id: string): Promise<DeleteBranchResult>;
  hashPassword(password: string): Promise<string>;
}

const defaultRestaurantBranchServiceDependencies = createServerOnlyFn(
  (): RestaurantBranchServiceDependencies => ({
    resolveContext: (input) => resolveAuthenticatedRestaurantSettingsContext(input),
    listBranches: (tenantId) => restaurantSettingsRepository.listBranches(tenantId),
    getBranchCount: (tenantId) => restaurantSettingsRepository.getBranchCount(tenantId),
    checkEmailUnique: (tenantId, email, excludeId) =>
      restaurantSettingsRepository.checkTenantAccountEmailUnique(tenantId, email, excludeId),
    createBranch: (tenantId, input) => restaurantSettingsRepository.createBranch(tenantId, input),
    updateBranch: (tenantId, id, input) =>
      restaurantSettingsRepository.updateBranch(tenantId, id, input),
    setBranchActive: (tenantId, id, isActive) =>
      restaurantSettingsRepository.setBranchActive(tenantId, id, isActive),
    deleteBranch: (tenantId, id) => restaurantSettingsRepository.deleteBranch(tenantId, id),
    hashPassword: (password) => bcrypt.hash(password, 10),
  }),
);

/**
 * Creates the guarded Branch (Location) lifecycle service around injectable I/O
 * so authorization, tenant scoping, centralized plan limits, and transactional
 * create/update/delete can be tested with fakes and without cookies or SQL.
 */
export function createRestaurantBranchService(
  overrides: Partial<RestaurantBranchServiceDependencies> = {},
) {
  const dependencies: RestaurantBranchServiceDependencies = {
    ...defaultRestaurantBranchServiceDependencies(),
    ...overrides,
  };

  return {
    /** Requires `locations` visibility; returns Branch rows plus the plan limit. */
    async list(
      input: ResolveRestaurantSettingsContextInput = {},
    ): Promise<RestaurantBranchesListView> {
      return withRestaurantSettingsFeatureRead("locations", input, async (context) => {
        const branches = await dependencies.listBranches(context.tenantId);
        const planLimit = resolveLocationPlanLimit(
          context.session.subscriptionPlan,
          branches.length,
        );
        return { branches: branches.map(branchListView), planLimit };
      });
    },

    /**
     * Requires `locations: operate`; validates fields, tenant email uniqueness,
     * and the centralized plan limit before the transactional insert. Any
     * refusal or failure leaves every stored Branch_Account unchanged.
     */
    async create(input: CreateRestaurantBranchInput): Promise<CreateRestaurantBranchResult> {
      return withRestaurantSettingsFeatureWrite("locations", input, async (context) => {
        const validation = validateBranchInput(input, {
          requireEmail: true,
          requirePassword: true,
        });
        if (!validation.ok) {
          return { status: "validation_failed", errors: validation.errors };
        }

        const { name, email, phone, address, city, state, pincode, managerName, password } =
          validation.value;

        const isUnique = await dependencies.checkEmailUnique(context.tenantId, email);
        if (!isUnique) {
          return { status: "email_taken", message: MSG_BRANCH_EMAIL_IN_USE };
        }

        // Centralized plan limit: the same helper backs the displayed limit.
        const count = await dependencies.getBranchCount(context.tenantId);
        const planLimit = resolveLocationPlanLimit(context.session.subscriptionPlan, count);
        if (!planLimit.canCreate) {
          return { status: "plan_limit_exceeded", message: planLimit.message, planLimit };
        }

        const passwordHash = await dependencies.hashPassword(password!);
        try {
          const result = await dependencies.createBranch(context.tenantId, {
            name,
            email,
            passwordHash,
            phone,
            address,
            city,
            state,
            pincode,
            managerName,
          });
          if (result.status === "created") {
            return { status: "created", id: result.id };
          }
          return { status: "email_taken", message: MSG_BRANCH_EMAIL_IN_USE };
        } catch {
          return { status: "storage_failed", message: MSG_BRANCH_CREATE_FAILED };
        }
      });
    },

    /**
     * Requires `locations: operate`; validates fields (password optional) and
     * updates the tenant-scoped Branch_Account transactionally. Deactivation
     * revokes the branch's sessions in the same transaction. A missing branch or
     * a failure leaves stored branches unchanged.
     */
    async update(input: UpdateRestaurantBranchInput): Promise<UpdateRestaurantBranchResult> {
      return withRestaurantSettingsFeatureWrite("locations", input, async (context) => {
        const validation = validateBranchInput(input, {
          requireEmail: false,
          requirePassword: false,
        });
        if (!validation.ok) {
          return { status: "validation_failed", errors: validation.errors };
        }

        const { name, phone, address, city, state, pincode, managerName, password, isActive } =
          validation.value;

        const passwordHash = password ? await dependencies.hashPassword(password) : undefined;

        try {
          const result = await dependencies.updateBranch(context.tenantId, input.id, {
            name,
            phone,
            address,
            city,
            state,
            pincode,
            managerName,
            passwordHash,
            isActive,
          });
          if (result.status === "updated") {
            return { status: "updated" };
          }
          return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
        } catch {
          return { status: "storage_failed", message: MSG_BRANCH_UPDATE_FAILED };
        }
      });
    },

    /**
     * Requires `locations: operate`; activates or deactivates a tenant-scoped
     * Branch_Account, revoking its sessions on deactivation.
     */
    async setActive(
      input: DeactivateRestaurantBranchInput,
    ): Promise<DeactivateRestaurantBranchResult> {
      return withRestaurantSettingsFeatureWrite("locations", input, async (context) => {
        const result = await dependencies.setBranchActive(
          context.tenantId,
          input.id,
          input.isActive,
        );
        if (result.status === "updated") {
          return { status: "updated" };
        }
        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      });
    },

    /**
     * Requires `locations: operate`; removes the branch's sessions and then the
     * tenant-scoped Branch_Account row in one transaction. A miss leaves stored
     * branches unchanged.
     */
    async delete(input: DeleteRestaurantBranchInput): Promise<DeleteRestaurantBranchResult> {
      return withRestaurantSettingsFeatureWrite("locations", input, async (context) => {
        const result = await dependencies.deleteBranch(context.tenantId, input.id);
        if (result.status === "deleted") {
          return { status: "deleted" };
        }
        return { status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND };
      });
    },
  };
}

let restaurantBranchServiceInstance: ReturnType<typeof createRestaurantBranchService> | undefined;
const restaurantBranchService = createServerOnlyFn(
  () => (restaurantBranchServiceInstance ??= createRestaurantBranchService()),
);

/** Default production entry point: list Branch_Accounts with the plan limit. */
export function getRestaurantBranches(
  input: ResolveRestaurantSettingsContextInput = {},
): Promise<RestaurantBranchesListView> {
  return restaurantBranchService().list(input);
}

/** Default production entry point: create a Branch_Account with plan/uniqueness guards. */
export function createRestaurantBranch(
  input: CreateRestaurantBranchInput,
): Promise<CreateRestaurantBranchResult> {
  return restaurantBranchService().create(input);
}

/** Default production entry point: update a Branch_Account with optional password. */
export function updateRestaurantBranch(
  input: UpdateRestaurantBranchInput,
): Promise<UpdateRestaurantBranchResult> {
  return restaurantBranchService().update(input);
}

/** Default production entry point: activate/deactivate a Branch_Account with session revocation. */
export function setRestaurantBranchActive(
  input: DeactivateRestaurantBranchInput,
): Promise<DeactivateRestaurantBranchResult> {
  return restaurantBranchService().setActive(input);
}

/** Default production entry point: delete a Branch_Account with session cleanup. */
export function deleteRestaurantBranch(
  input: DeleteRestaurantBranchInput,
): Promise<DeleteRestaurantBranchResult> {
  return restaurantBranchService().delete(input);
}

/**
 * Guarded list read consumed by the `Multi Location` sub-tab. Requires the
 * `locations` feature to be visible and returns Branch_Accounts plus the
 * centralized location plan limit metadata (Req 9.1, 9.2).
 */
export const getRestaurantBranchesServerFn = createServerFn({ method: "GET" })
  .validator((data?: { requestedLocationId?: string | null }) => ({
    requestedLocationId: data?.requestedLocationId ?? null,
  }))
  .handler(({ data }) => getRestaurantBranches(data));

/**
 * Guarded Branch_Account creation consumed by the `Multi Location` sub-tab.
 * Requires `locations: operate` and validates tenant email uniqueness, the
 * centralized plan limit, and password rules. Any refusal or storage failure
 * leaves every stored branch unchanged (Req 9.2, 9.8, 10.7, 10.8).
 */
export const createRestaurantBranchServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name?: unknown;
      email?: unknown;
      phone?: unknown;
      address?: unknown;
      city?: unknown;
      state?: unknown;
      pincode?: unknown;
      managerName?: unknown;
      password?: unknown;
      confirmation?: unknown;
      requestedLocationId?: string | null;
    }) => ({
      name: data?.name,
      email: data?.email,
      phone: data?.phone,
      address: data?.address,
      city: data?.city,
      state: data?.state,
      pincode: data?.pincode,
      managerName: data?.managerName,
      password: data?.password,
      confirmation: data?.confirmation,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => createRestaurantBranch(data));

/**
 * Guarded Branch_Account update consumed by the `Multi Location` sub-tab.
 * Requires `locations: operate`. The login email is not editable; password is
 * optional and omission retains the stored hash. Deactivation revokes the
 * branch's sessions (Req 9.2, 9.8, 10.7, 10.8).
 */
export const updateRestaurantBranchServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id?: unknown;
      name?: unknown;
      phone?: unknown;
      address?: unknown;
      city?: unknown;
      state?: unknown;
      pincode?: unknown;
      managerName?: unknown;
      password?: unknown;
      confirmation?: unknown;
      isActive?: unknown;
      requestedLocationId?: string | null;
    }) => ({
      id: String(data?.id ?? ""),
      name: data?.name,
      phone: data?.phone,
      address: data?.address,
      city: data?.city,
      state: data?.state,
      pincode: data?.pincode,
      managerName: data?.managerName,
      password: data?.password,
      confirmation: data?.confirmation,
      isActive: data?.isActive,
      requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
    }),
  )
  .handler(({ data }) => updateRestaurantBranch(data));

/**
 * Guarded Branch_Account activation/deactivation consumed by the `Multi
 * Location` sub-tab. Requires `locations: operate`; deactivation removes the
 * branch's sessions transactionally (Req 9.2, 9.8, 10.7, 10.8).
 */
export const setRestaurantBranchActiveServerFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown; isActive?: unknown; requestedLocationId?: string | null }) => ({
    id: String(data?.id ?? ""),
    isActive: data?.isActive === true,
    requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
  }))
  .handler(({ data }) => setRestaurantBranchActive(data));

/**
 * Guarded Branch_Account deletion consumed by the `Multi Location` sub-tab.
 * Requires `locations: operate` and confirmation. Removes sessions then the
 * tenant-scoped branch row in one transaction, leaving other branches unchanged
 * (Req 9.2, 9.8, 10.7, 10.8).
 */
export const deleteRestaurantBranchServerFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown; requestedLocationId?: string | null }) => ({
    id: String(data?.id ?? ""),
    requestedLocationId: (data?.requestedLocationId as string | null | undefined) ?? null,
  }))
  .handler(({ data }) => deleteRestaurantBranch(data));
