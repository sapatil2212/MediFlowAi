/**
 * restaurant-settings.permission-regression.integration.test.ts
 *
 * Assembled permission and location regression suite (spec
 * `.kiro/specs/restaurant-dashboard-settings`, task 11.3, Req 7.10, 8.15,
 * 9.3-9.8, 10.1-10.12).
 *
 * Where the per-feature integration suites prove one feature's behaviour, this
 * suite wires ALL the guarded Settings services (profile, operating hours,
 * closures, dining areas, menu, users, branches, WhatsApp) to faithful, stateful
 * in-memory stores + external adapter and drives them through the REAL
 * authorization/scope pipeline (`createRestaurantSettingsBoundary` ->
 * `resolveFeatureAccess` -> `resolveRestaurantResourceScope`). It then exercises
 * every plan-gated Settings mutation under the full context matrix:
 *
 *   - `operate`               -> the mutation is permitted;
 *   - `view_only` and `none`  -> the mutation is refused BEFORE any repository or
 *                                external adapter call (no state change, no side
 *                                effect, feature-specific message);
 *   - unresolved access       -> refused (Profile stays reachable);
 *   - inactive child account  -> refused at the boundary;
 *   - foreign-tenant id        -> maps to the single not-found message and never
 *                                mutates the foreign row;
 *   - owner primary vs owner-selected branch -> read/write ONLY the effective
 *                                server-derived scope;
 *   - branch (location) session -> forced to its own scope, cannot reach the
 *                                primary or another branch;
 *   - reception context        -> behaves per its resolved permissions
 *                                (config/whatsapp view-only, users/locations none).
 *
 * Every refused write is asserted twice over: the mutating dependency is a spy
 * that must NOT be called, and the persistent + external snapshot must be
 * byte-for-byte identical afterwards. Reads are asserted to contain only the
 * effective scope's rows.
 *
 * No database, cookie, or network is touched. Feature access runs through the
 * real `resolveFeatureAccess`, so `operate`/`view_only`/`none` behave exactly as
 * production. The restaurant_config/whatsapp services resolve context through an
 * injected boundary; the users/branches services resolve through the shared
 * module boundary, so a hoisted `vi.mock("./auth.server")` fake session and a
 * hoisted `vi.mock("./db")` fake `queryOne` (for branch-scope resolution) drive
 * them exactly as the persistence integration suite drives users.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFeatureAccess } from "./feature-access";
import {
  EFFECTIVE_MAIN_AREA_ID,
  MSG_NOT_AUTHORISED_CONFIG,
  MSG_NOT_AUTHORISED_LOCATIONS,
  MSG_NOT_AUTHORISED_USERS,
  MSG_NOT_AUTHORISED_WHATSAPP,
  MSG_SETTINGS_RESOURCE_NOT_FOUND,
  normaliseRestaurantProfile,
  type ClosureDay,
  type ClosureScope,
  type DayHours,
  type DiningArea,
  type MenuCategory,
  type MenuItem,
  type MenuItemState,
  type NormalisedMenuCategory,
  type NormalisedMenuItem,
  type RestaurantProfile,
  type RestaurantResourceScope,
  type UserRoleCounts,
} from "./restaurant-settings-model";
import {
  createRestaurantBranchService,
  createRestaurantClosureService,
  createRestaurantDiningAreaService,
  createRestaurantMenuService,
  createRestaurantOperatingHoursService,
  createRestaurantProfileService,
  createRestaurantSettingsBoundary,
  createRestaurantUserService,
  createWhatsAppSettingsService,
  MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
  type AuthenticatedRestaurantSettingsContext,
  type ResolveRestaurantSettingsContextInput,
} from "./restaurant-settings";
import type {
  AccountSecuritySnapshot,
  CreateBranchInput,
  CreateBranchResult,
  CreateClosureDayResult,
  CreateDiningAreaInput,
  CreateDiningAreaResult,
  CreateSubUserInput,
  CreateSubUserResult,
  DeleteBranchResult,
  DeleteDiningAreaResult,
  DeleteMenuCategoryResult,
  DeleteMenuItemResult,
  DeleteScopedRecordResult,
  DeleteSubUserResult,
  PreviewMenuCategoryDeletionResult,
  SaveMenuCategoryResult,
  SaveMenuItemResult,
  SaveWhatsAppAlertConfigInput,
  StoredBranch,
  StoredRestaurantHours,
  StoredRestaurantProfile,
  StoredSubUser,
  SubUserLifecycleResult,
  UpdateBranchInput,
  UpdateBranchResult,
  UpdateSubUserInput,
  UpdateSubUserResult,
  WhatsAppActionOutcome,
  WhatsAppAlertConfig,
  WhatsAppSettingsStatus,
} from "./restaurant-settings.server";

// ---------------------------------------------------------------------------
// Shared module-boundary fakes (users + branches resolve through this path)
// ---------------------------------------------------------------------------

/**
 * The users and branches services resolve their context through the shared
 * module boundary (`resolveAuthenticatedRestaurantSettingsContext`), not the
 * injected `resolveContext`. That boundary reads the session via
 * `verifySession` and validates a branch scope via `queryOne` against Location.
 * We drive both with hoisted fakes so those services run the REAL authorization
 * and scope logic without cookies or SQL.
 */
const mockAuth = vi.hoisted(() => ({ session: null as unknown }));
const mockDb = vi.hoisted(() => ({
  branches: [] as { id: string; tenantId: string; isActive: boolean }[],
}));

vi.mock("./auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth.server")>();
  return { ...actual, verifySession: async () => mockAuth.session };
});

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    // Only the boundary's `findBranchById` uses queryOne in this module graph;
    // every repository method is injected, so this fake is the sole DB surface.
    queryOne: async (sql: string, params: unknown[]) => {
      if (/FROM\s+Location/i.test(sql)) {
        const [tenantId, id] = params as string[];
        return (
          mockDb.branches.find((b) => b.tenantId === tenantId && b.id === id) ?? null
        );
      }
      return null;
    },
  };
});

// ---------------------------------------------------------------------------
// Constants + session builders
// ---------------------------------------------------------------------------

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const BRANCH_A1 = "branch-a-1";
const BRANCH_A2 = "branch-a-2";
const BASE_NOW = Date.UTC(2026, 3, 1, 0, 0, 0);

const PRIMARY_A: RestaurantResourceScope = { tenantId: TENANT_A, locationId: null };
const BRANCH_A1_SCOPE: RestaurantResourceScope = { tenantId: TENANT_A, locationId: BRANCH_A1 };
const PRIMARY_B: RestaurantResourceScope = { tenantId: TENANT_B, locationId: null };

interface FakeSession {
  id: string;
  tenantId: string;
  role: "admin" | "reception" | "doctor" | "location";
  profession: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  subscriptionExpiresAt: string;
  isActive: boolean;
  locationId: string | null;
  // Matches RestaurantSettingsSession's index signature so this fake is assignable
  // to the boundary's `verifySession` return type.
  [key: string]: unknown;
}

function session(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    id: "owner-a",
    tenantId: TENANT_A,
    role: "admin",
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2099-01-01T00:00:00.000Z",
    isActive: true,
    locationId: null,
    ...overrides,
  };
}

const ownerA = () => session();
const ownerB = () => session({ id: "owner-b", tenantId: TENANT_B });
const receptionA = (plan = "Premium") =>
  session({ id: "recep-a", role: "reception", subscriptionPlan: plan });
const doctorA = () => session({ id: "doc-a", role: "doctor" });
const branchSessionA1 = () =>
  session({ id: BRANCH_A1, role: "location", locationId: BRANCH_A1 });
const inactiveOwnerA = () => session({ isActive: false });

interface BoundaryOptions {
  /** Model "unresolved feature access" (Profile-only fallback state). */
  unresolved?: boolean;
  /** Tenant-validated branches available for an owner's branch selection. */
  branches?: { id: string; tenantId: string; isActive: boolean }[];
}

/**
 * Builds an injected boundary resolver around one session so the
 * restaurant_config/whatsapp services run the REAL session ->
 * feature-access -> scope pipeline without cookies or SQL.
 */
function resolveContextWith(
  sess: FakeSession,
  opts: BoundaryOptions = {},
): (input: ResolveRestaurantSettingsContextInput) => Promise<AuthenticatedRestaurantSettingsContext> {
  const boundary = createRestaurantSettingsBoundary({
    verifySession: async () => sess,
    resolveFeatureAccess: opts.unresolved
      ? () => null as never
      : resolveFeatureAccess,
    findBranchById: async (tenantId, id) =>
      (opts.branches ?? []).find((b) => b.tenantId === tenantId && b.id === id) ?? null,
    now: () => new Date(BASE_NOW),
  });
  return (input) => boundary.resolve(input);
}

// ---------------------------------------------------------------------------
// Faithful in-memory stores (tenant-first, null-safe location scoping)
// ---------------------------------------------------------------------------

/** Null-safe tenant+location match, mirroring `tenantId = ? AND locationId <=> ?`. */
function inScope(
  row: { tenantId: string; locationId: string | null },
  scope: RestaurantResourceScope,
): boolean {
  return row.tenantId === scope.tenantId && row.locationId === scope.locationId;
}

function accountSecurity(tenantId: string): AccountSecuritySnapshot {
  return {
    accountType: "user",
    accountId: `owner-${tenantId}`,
    tenantId,
    email: `owner@${tenantId}.example`,
    passwordHash: "h",
    profilePhoto: null,
  };
}

// ----- Profile (tenant-global) ---------------------------------------------

function createProfileStore() {
  const rows = new Map<string, StoredRestaurantProfile>();
  rows.set(TENANT_A, {
    id: "profile-a",
    tenantId: TENANT_A,
    ...normaliseRestaurantProfile({ restaurantName: "Tenant A Diner" }),
  });
  rows.set(TENANT_B, {
    id: "profile-b",
    tenantId: TENANT_B,
    ...normaliseRestaurantProfile({ restaurantName: "Tenant B Bistro" }),
  });

  const saveProfile = vi.fn(
    async (tenantId: string, profile: RestaurantProfile): Promise<StoredRestaurantProfile> => {
      const existing = rows.get(tenantId);
      const stored: StoredRestaurantProfile = {
        id: existing?.id ?? `profile-${tenantId}`,
        tenantId,
        ...profile,
      };
      rows.set(tenantId, stored);
      return { ...stored };
    },
  );

  return {
    saveProfile,
    snapshot: () => JSON.stringify([...rows.entries()]),
    deps: {
      getTenantProfile: async (tenantId: string) => {
        const row = rows.get(tenantId);
        return row ? { ...row } : null;
      },
      getAccountSecurity: async (tenantId: string) => accountSecurity(tenantId),
      saveProfile,
    },
  };
}

// ----- Operating hours (tenant-global) -------------------------------------

function sevenDays(open = "09:00", close = "22:00"): DayHours[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    openTime: open,
    closeTime: close,
    isClosed: false,
  }));
}

function createHoursStore() {
  let rows: StoredRestaurantHours[] = sevenDays("08:00", "20:00").map((d) => ({
    id: `hours-a-${d.dayOfWeek}`,
    tenantId: TENANT_A,
    ...d,
  }));

  const replaceTenantHours = vi.fn(
    async (tenantId: string, days: readonly DayHours[]): Promise<void> => {
      rows = days.map((d) => ({ id: `hours-${tenantId}-${d.dayOfWeek}`, tenantId, ...d }));
    },
  );

  return {
    replaceTenantHours,
    snapshot: () => JSON.stringify(rows),
    deps: {
      getTenantHours: async (tenantId: string) =>
        rows.filter((r) => r.tenantId === tenantId).map((r) => ({ ...r })),
      replaceTenantHours,
    },
  };
}

// ----- Closures (tenant + location scoped) ---------------------------------

interface ClosureRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  date: string;
  scopeType: "restaurant" | "table";
  tableId: string | null;
  scopeKey: string;
  reason: string;
  isHoliday: boolean;
}

function createClosureStore() {
  const rows: ClosureRow[] = [
    mkClosure("cl-a-primary", PRIMARY_A, "2026-04-10"),
    mkClosure("cl-a-branch", BRANCH_A1_SCOPE, "2026-04-11"),
    mkClosure("cl-b-primary", PRIMARY_B, "2026-04-12"),
  ];
  let idCounter = 0;

  function mkClosureFrom(scope: RestaurantResourceScope, date: string): ClosureRow {
    return mkClosure(`cl-new-${idCounter++}`, scope, date);
  }

  const createClosureDay = vi.fn(
    async (
      scope: RestaurantResourceScope,
      input: { date: string; scope: ClosureScope; reason: string; isHoliday: boolean },
    ): Promise<CreateClosureDayResult> => {
      const scopeKey = input.scope.type === "table" ? input.scope.tableId : "restaurant";
      if (rows.some((r) => inScope(r, scope) && r.scopeKey === scopeKey && r.date === input.date)) {
        return { status: "duplicate" };
      }
      const row = mkClosureFrom(scope, input.date);
      row.reason = input.reason;
      row.isHoliday = input.isHoliday;
      rows.push(row);
      return { status: "created", id: row.id };
    },
  );

  const deleteClosureDay = vi.fn(
    async (scope: RestaurantResourceScope, id: string): Promise<DeleteScopedRecordResult> => {
      const idx = rows.findIndex((r) => inScope(r, scope) && r.id === id);
      if (idx === -1) return { status: "not_found" };
      rows.splice(idx, 1);
      return { status: "deleted" };
    },
  );

  return {
    createClosureDay,
    deleteClosureDay,
    snapshot: () => JSON.stringify(rows),
    ids: () => rows.map((r) => r.id).sort(),
    deps: {
      listClosureDays: async (
        scope: RestaurantResourceScope,
        monthStart: string,
        nextMonthStart: string,
      ): Promise<ClosureDay[]> =>
        rows
          .filter((r) => inScope(r, scope) && r.date >= monthStart && r.date < nextMonthStart)
          .map<ClosureDay>((r) => ({
            id: r.id,
            date: r.date,
            scope:
              r.scopeType === "table" ? { type: "table", tableId: r.tableId! } : { type: "restaurant" },
            reason: r.reason,
            isHoliday: r.isHoliday,
            affectedBookingCount: 0,
            locationId: r.locationId,
          })),
      createClosureDay,
      deleteClosureDay,
    },
  };
}

function mkClosure(id: string, scope: RestaurantResourceScope, date: string): ClosureRow {
  return {
    id,
    tenantId: scope.tenantId,
    locationId: scope.locationId,
    date,
    scopeType: "restaurant",
    tableId: null,
    scopeKey: "restaurant",
    reason: "Seeded",
    isHoliday: false,
  };
}

// ----- Dining areas (tenant + location scoped) -----------------------------

interface AreaRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  name: string;
  displayOrder: number;
}

function createAreaStore() {
  const areas: AreaRow[] = [
    { id: "area-a-primary", tenantId: TENANT_A, locationId: null, name: "Patio", displayOrder: 1 },
    { id: "area-a-branch", tenantId: TENANT_A, locationId: BRANCH_A1, name: "Terrace", displayOrder: 1 },
    { id: "area-b-primary", tenantId: TENANT_B, locationId: null, name: "Garden", displayOrder: 1 },
  ];
  let idCounter = 0;

  const createDiningArea = vi.fn(
    async (
      scope: RestaurantResourceScope,
      input: CreateDiningAreaInput,
    ): Promise<CreateDiningAreaResult> => {
      if (
        areas.some(
          (a) => inScope(a, scope) && a.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
        )
      ) {
        return { status: "duplicate" };
      }
      const id = `area-new-${idCounter++}`;
      const displayOrder = input.displayOrder ?? areas.filter((a) => inScope(a, scope)).length + 1;
      areas.push({ id, tenantId: scope.tenantId, locationId: scope.locationId, name: input.name, displayOrder });
      return { status: "created", area: { id, name: input.name, displayOrder, tableCount: 0, locationId: scope.locationId } };
    },
  );

  const deleteDiningArea = vi.fn(
    async (scope: RestaurantResourceScope, areaId: string): Promise<DeleteDiningAreaResult> => {
      if (areaId === EFFECTIVE_MAIN_AREA_ID) return { status: "not_found" };
      const idx = areas.findIndex((a) => inScope(a, scope) && a.id === areaId);
      if (idx === -1) return { status: "not_found" };
      areas.splice(idx, 1);
      return { status: "deleted" };
    },
  );

  return {
    createDiningArea,
    deleteDiningArea,
    snapshot: () => JSON.stringify(areas),
    deps: {
      listDiningAreas: async (scope: RestaurantResourceScope): Promise<DiningArea[]> => {
        const scoped = areas
          .filter((a) => inScope(a, scope))
          .map<DiningArea>((a) => ({
            id: a.id,
            name: a.name,
            displayOrder: a.displayOrder,
            tableCount: 0,
            locationId: a.locationId,
          }));
        if (scoped.length > 0) return scoped;
        return [
          { id: EFFECTIVE_MAIN_AREA_ID, name: "Main", displayOrder: 1, tableCount: 0, locationId: scope.locationId },
        ];
      },
      createDiningArea,
      deleteDiningArea,
    },
  };
}

// ----- Menu (tenant + location scoped) -------------------------------------

interface CategoryRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  name: string;
  displayOrder: number;
}
interface ItemRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  categoryId: string;
  name: string;
  priceMinor: number;
  description: string;
  displayOrder: number;
  state: MenuItemState;
}

function createMenuStore() {
  const categories: CategoryRow[] = [
    { id: "cat-a-primary", tenantId: TENANT_A, locationId: null, name: "Starters", displayOrder: 1 },
    { id: "cat-a-branch", tenantId: TENANT_A, locationId: BRANCH_A1, name: "Branch Mains", displayOrder: 1 },
    { id: "cat-b-primary", tenantId: TENANT_B, locationId: null, name: "B Starters", displayOrder: 1 },
  ];
  const items: ItemRow[] = [
    mkItem("item-a-primary", PRIMARY_A, "cat-a-primary", "Soup"),
    mkItem("item-a-branch", BRANCH_A1_SCOPE, "cat-a-branch", "Branch Steak"),
    mkItem("item-b-primary", PRIMARY_B, "cat-b-primary", "B Soup"),
  ];
  let idCounter = 0;

  const saveMenuCategory = vi.fn(
    async (
      scope: RestaurantResourceScope,
      input: NormalisedMenuCategory,
      categoryId?: string,
    ): Promise<SaveMenuCategoryResult> => {
      if (categoryId) {
        const existing = categories.find((c) => inScope(c, scope) && c.id === categoryId);
        if (!existing) return { status: "not_found" };
        existing.name = input.name;
        existing.displayOrder = input.displayOrder;
        return { status: "saved", category: { id: existing.id, name: existing.name, displayOrder: existing.displayOrder, items: [], locationId: existing.locationId } };
      }
      const id = `cat-new-${idCounter++}`;
      categories.push({ id, tenantId: scope.tenantId, locationId: scope.locationId, name: input.name, displayOrder: input.displayOrder });
      return { status: "saved", category: { id, name: input.name, displayOrder: input.displayOrder, items: [], locationId: scope.locationId } };
    },
  );

  const saveMenuItem = vi.fn(
    async (
      scope: RestaurantResourceScope,
      input: NormalisedMenuItem,
      itemId?: string,
    ): Promise<SaveMenuItemResult> => {
      const category = categories.find((c) => inScope(c, scope) && c.id === input.categoryId);
      if (!category) return { status: "category_not_found" };
      if (itemId) {
        const existing = items.find((i) => inScope(i, scope) && i.id === itemId);
        if (!existing) return { status: "not_found" };
        Object.assign(existing, input);
        return { status: "saved", item: { ...existing } };
      }
      const row: ItemRow = { id: `item-new-${idCounter++}`, tenantId: scope.tenantId, locationId: scope.locationId, ...input };
      items.push(row);
      return { status: "saved", item: { ...row } };
    },
  );

  const updateMenuItemState = vi.fn(
    async (scope: RestaurantResourceScope, itemId: string, state: MenuItemState): Promise<SaveMenuItemResult> => {
      const existing = items.find((i) => inScope(i, scope) && i.id === itemId);
      if (!existing) return { status: "not_found" };
      existing.state = state;
      return { status: "saved", item: { ...existing } };
    },
  );

  const deleteMenuItem = vi.fn(
    async (scope: RestaurantResourceScope, itemId: string): Promise<DeleteMenuItemResult> => {
      const idx = items.findIndex((i) => inScope(i, scope) && i.id === itemId);
      if (idx === -1) return { status: "not_found" };
      items.splice(idx, 1);
      return { status: "deleted" };
    },
  );

  const confirmDeleteMenuCategory = vi.fn(
    async (scope: RestaurantResourceScope, categoryId: string): Promise<DeleteMenuCategoryResult> => {
      const cIdx = categories.findIndex((c) => inScope(c, scope) && c.id === categoryId);
      if (cIdx === -1) return { status: "not_found" };
      const kept = items.filter((i) => !(inScope(i, scope) && i.categoryId === categoryId));
      const deletedItemCount = items.length - kept.length;
      items.length = 0;
      items.push(...kept);
      categories.splice(cIdx, 1);
      return { status: "deleted", deletedItemCount };
    },
  );

  return {
    saveMenuCategory,
    saveMenuItem,
    updateMenuItemState,
    deleteMenuItem,
    confirmDeleteMenuCategory,
    snapshot: () => JSON.stringify({ categories, items }),
    deps: {
      listMenu: async (scope: RestaurantResourceScope): Promise<MenuCategory[]> =>
        categories
          .filter((c) => inScope(c, scope))
          .map<MenuCategory>((c) => ({
            id: c.id,
            name: c.name,
            displayOrder: c.displayOrder,
            locationId: c.locationId,
            items: items.filter((i) => inScope(i, scope) && i.categoryId === c.id).map<MenuItem>((i) => ({ ...i })),
          })),
      saveMenuCategory,
      saveMenuItem,
      updateMenuItemState,
      deleteMenuItem,
      previewMenuCategoryDeletion: async (
        scope: RestaurantResourceScope,
        categoryId: string,
      ): Promise<PreviewMenuCategoryDeletionResult> => {
        const category = categories.find((c) => inScope(c, scope) && c.id === categoryId);
        if (!category) return { status: "not_found" };
        const itemCount = items.filter((i) => inScope(i, scope) && i.categoryId === categoryId).length;
        return { status: "preview", categoryId, itemCount, confirmationRequired: itemCount > 0 };
      },
      confirmDeleteMenuCategory,
    },
  };
}

function mkItem(id: string, scope: RestaurantResourceScope, categoryId: string, name: string): ItemRow {
  return {
    id,
    tenantId: scope.tenantId,
    locationId: scope.locationId,
    categoryId,
    name,
    priceMinor: 1200,
    description: "",
    displayOrder: 1,
    state: "available",
  };
}

// ----- WhatsApp (tenant-global config + external adapter) ------------------

function whatsAppStatus(): WhatsAppSettingsStatus {
  return {
    state: "CONNECTED",
    qrDataUrl: "",
    connectedNumber: "+10000000000",
    queueCount: 0,
    sentCount: 0,
    sentLog: [],
  };
}

function createWhatsAppStore() {
  const configs = new Map<string, WhatsAppAlertConfig>();
  configs.set(TENANT_A, { id: "wa-a", tenantId: TENANT_A, phoneNumber: "+15550000001", isEnabled: true });
  configs.set(TENANT_B, { id: "wa-b", tenantId: TENANT_B, phoneNumber: "+15550000002", isEnabled: true });

  // External microservice/session state that must be byte-stable on refusal.
  const external = { initialized: false, disconnected: false, queued: [] as string[] };

  const saveWhatsAppConfig = vi.fn(
    async (tenantId: string, input: SaveWhatsAppAlertConfigInput): Promise<WhatsAppAlertConfig> => {
      const existing = configs.get(tenantId);
      const stored: WhatsAppAlertConfig = {
        id: existing?.id ?? `wa-${tenantId}`,
        tenantId,
        phoneNumber: input.phoneNumber,
        isEnabled: input.isEnabled,
      };
      configs.set(tenantId, stored);
      return { ...stored };
    },
  );
  const initialize = vi.fn(async (): Promise<WhatsAppActionOutcome> => {
    external.initialized = true;
    return { status: "ok" };
  });
  const disconnect = vi.fn(async (): Promise<WhatsAppActionOutcome> => {
    external.disconnected = true;
    return { status: "ok" };
  });
  const sendTestMessage = vi.fn(async (_t: string, phone: string): Promise<WhatsAppActionOutcome> => {
    external.queued.push(phone);
    return { status: "ok" };
  });

  return {
    saveWhatsAppConfig,
    initialize,
    disconnect,
    sendTestMessage,
    external,
    snapshot: () => JSON.stringify({ configs: [...configs.entries()], external }),
    deps: {
      getWhatsAppConfig: async (tenantId: string) => {
        const c = configs.get(tenantId);
        return c ? { ...c } : null;
      },
      saveWhatsAppConfig,
      readStatus: async () => whatsAppStatus(),
      initialize,
      disconnect,
      sendTestMessage,
    },
  };
}

// ----- Users (tenant-scoped, resolves through the module boundary) ---------

function createUserStore(seed: StoredSubUser[] = []) {
  const users: StoredSubUser[] = seed.map((u) => ({ ...u }));
  let idCounter = 0;
  const roleCounts = (): UserRoleCounts => ({
    doctor: users.filter((u) => u.role === "doctor").length,
    reception: users.filter((u) => u.role === "reception").length,
  });

  const createSubUser = vi.fn(async (tenantId: string, input: CreateSubUserInput): Promise<CreateSubUserResult> => {
    if (users.some((u) => u.tenantId === tenantId && u.email.toLowerCase() === input.email.toLowerCase())) {
      return { status: "duplicate" };
    }
    const id = `sub-${idCounter++}`;
    users.push({ id, tenantId, name: input.name, email: input.email, phone: input.phone, role: input.role, isActive: input.isActive, profilePhoto: null });
    return { status: "created", id };
  });
  const updateSubUser = vi.fn(async (tenantId: string, id: string, input: UpdateSubUserInput): Promise<UpdateSubUserResult> => {
    const existing = users.find((u) => u.tenantId === tenantId && u.id === id);
    if (!existing) return { status: "not_found" };
    Object.assign(existing, { name: input.name, email: input.email, phone: input.phone, role: input.role, isActive: input.isActive });
    return { status: "updated" };
  });
  const setSubUserActive = vi.fn(async (tenantId: string, id: string, isActive: boolean): Promise<SubUserLifecycleResult> => {
    const existing = users.find((u) => u.tenantId === tenantId && u.id === id);
    if (!existing) return { status: "not_found" };
    existing.isActive = isActive;
    return { status: "updated" };
  });
  const deleteSubUser = vi.fn(async (tenantId: string, id: string): Promise<DeleteSubUserResult> => {
    const idx = users.findIndex((u) => u.tenantId === tenantId && u.id === id);
    if (idx === -1) return { status: "not_found" };
    users.splice(idx, 1);
    return { status: "deleted" };
  });

  return {
    createSubUser,
    updateSubUser,
    setSubUserActive,
    deleteSubUser,
    snapshot: () => JSON.stringify(users.map((u) => ({ ...u })).sort((a, b) => a.id.localeCompare(b.id))),
    deps: {
      listSubUsers: async (tenantId: string) => users.filter((u) => u.tenantId === tenantId).map((u) => ({ ...u })),
      getSubUserRoleCounts: async () => roleCounts(),
      checkEmailUnique: async (tenantId: string, email: string, excludeId?: string) =>
        !users.some((u) => u.tenantId === tenantId && u.email.toLowerCase() === email.toLowerCase() && u.id !== excludeId),
      getSubUserById: async (tenantId: string, id: string) =>
        users.find((u) => u.tenantId === tenantId && u.id === id) ?? null,
      createSubUser,
      updateSubUser,
      setSubUserActive,
      deleteSubUser,
      hashPassword: async (password: string) => `pwd:${password}`,
    },
  };
}

function seededSubUser(overrides: Partial<StoredSubUser> = {}): StoredSubUser {
  return {
    id: "sub-a",
    tenantId: TENANT_A,
    name: "Sam Vale",
    email: "sam@example.com",
    phone: "555-0200",
    role: "doctor",
    isActive: true,
    profilePhoto: null,
    ...overrides,
  };
}

// ----- Branches (tenant-scoped, resolves through the module boundary) ------

function createBranchStore(seed: StoredBranch[] = []) {
  const branches: StoredBranch[] = seed.map((b) => ({ ...b }));
  let idCounter = 0;

  const createBranch = vi.fn(async (tenantId: string, input: CreateBranchInput): Promise<CreateBranchResult> => {
    if (branches.some((b) => b.tenantId === tenantId && b.email.toLowerCase() === input.email.toLowerCase())) {
      return { status: "duplicate" };
    }
    const id = `branch-new-${idCounter++}`;
    branches.push({ id, tenantId, name: input.name, email: input.email, phone: input.phone, address: input.address, city: input.city, state: input.state, pincode: input.pincode, managerName: input.managerName, profilePhoto: null, isActive: true });
    return { status: "created", id };
  });
  const updateBranch = vi.fn(async (tenantId: string, id: string, input: UpdateBranchInput): Promise<UpdateBranchResult> => {
    const existing = branches.find((b) => b.tenantId === tenantId && b.id === id);
    if (!existing) return { status: "not_found" };
    Object.assign(existing, { name: input.name, phone: input.phone, address: input.address, city: input.city, state: input.state, pincode: input.pincode, managerName: input.managerName, isActive: input.isActive });
    return { status: "updated" };
  });
  const setBranchActive = vi.fn(async (tenantId: string, id: string, isActive: boolean) => {
    const existing = branches.find((b) => b.tenantId === tenantId && b.id === id);
    if (!existing) return { status: "not_found" as const };
    existing.isActive = isActive;
    return { status: "updated" as const };
  });
  const deleteBranch = vi.fn(async (tenantId: string, id: string): Promise<DeleteBranchResult> => {
    const idx = branches.findIndex((b) => b.tenantId === tenantId && b.id === id);
    if (idx === -1) return { status: "not_found" };
    branches.splice(idx, 1);
    return { status: "deleted" };
  });

  return {
    createBranch,
    updateBranch,
    setBranchActive,
    deleteBranch,
    snapshot: () => JSON.stringify(branches.map((b) => ({ ...b })).sort((a, b) => a.id.localeCompare(b.id))),
    deps: {
      listBranches: async (tenantId: string) => branches.filter((b) => b.tenantId === tenantId).map((b) => ({ ...b })),
      getBranchCount: async (tenantId: string) => branches.filter((b) => b.tenantId === tenantId).length,
      checkEmailUnique: async (tenantId: string, email: string, excludeId?: string) =>
        !branches.some((b) => b.tenantId === tenantId && b.email.toLowerCase() === email.toLowerCase() && b.id !== excludeId),
      createBranch,
      updateBranch,
      setBranchActive,
      deleteBranch,
      hashPassword: async (password: string) => `pwd:${password}`,
    },
  };
}

function seededBranch(overrides: Partial<StoredBranch> = {}): StoredBranch {
  return {
    id: BRANCH_A1,
    tenantId: TENANT_A,
    name: "Downtown",
    email: "downtown@example.com",
    phone: "555-1000",
    address: "1 Main",
    city: "Metro",
    state: "ST",
    pincode: "00001",
    managerName: "Robin",
    profilePhoto: null,
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Service wiring helpers
// ---------------------------------------------------------------------------

interface ConfigStores {
  profile: ReturnType<typeof createProfileStore>;
  hours: ReturnType<typeof createHoursStore>;
  closure: ReturnType<typeof createClosureStore>;
  area: ReturnType<typeof createAreaStore>;
  menu: ReturnType<typeof createMenuStore>;
}

function freshConfigStores(): ConfigStores {
  return {
    profile: createProfileStore(),
    hours: createHoursStore(),
    closure: createClosureStore(),
    area: createAreaStore(),
    menu: createMenuStore(),
  };
}

function configServices(
  resolveContext: (input: ResolveRestaurantSettingsContextInput) => Promise<AuthenticatedRestaurantSettingsContext>,
  stores: ConfigStores,
) {
  return {
    profile: createRestaurantProfileService({ resolveContext, ...stores.profile.deps }),
    hours: createRestaurantOperatingHoursService({ resolveContext, ...stores.hours.deps }),
    closure: createRestaurantClosureService({ resolveContext, ...stores.closure.deps }),
    area: createRestaurantDiningAreaService({ resolveContext, ...stores.area.deps }),
    menu: createRestaurantMenuService({ resolveContext, ...stores.menu.deps }),
  };
}

/** A valid profile submission (distinct from the seed to detect any write). */
function profileInput(): RestaurantProfile {
  return {
    restaurantName: "Renamed",
    ownerOrManagerName: "Dana",
    accountPhone: "555-0100",
    teamSize: "10",
    publicEmail: "hi@example.com",
    contactNumber: "555-0101",
    whatsappNumber: "555-0102",
    landline: "555-0103",
    address: "1 St",
    cuisineOrServices: "Modern",
    description: "Tasting menus.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.session = null;
  mockDb.branches = [];
});

// ---------------------------------------------------------------------------
// restaurant_config mutations: full permission matrix (Req 10.1-10.4, 10.11)
// ---------------------------------------------------------------------------

interface ConfigMutation {
  name: string;
  run: (services: ReturnType<typeof configServices>) => Promise<unknown>;
  spy: (stores: ConfigStores) => ReturnType<typeof vi.fn>;
}

const configMutations: ConfigMutation[] = [
  {
    name: "profile save",
    run: (s) => s.profile.save({ profile: profileInput() }),
    spy: (st) => st.profile.saveProfile,
  },
  {
    name: "operating hours save",
    run: (s) => s.hours.save({ days: sevenDays() }),
    spy: (st) => st.hours.replaceTenantHours,
  },
  {
    name: "closure create",
    run: (s) =>
      s.closure.create({ date: "2026-05-01", scope: { type: "restaurant" }, reason: "Holiday", isHoliday: true }),
    spy: (st) => st.closure.createClosureDay,
  },
  {
    name: "dining area create",
    run: (s) => s.area.create({ name: "New Area" }),
    spy: (st) => st.area.createDiningArea,
  },
  {
    name: "menu category save",
    run: (s) => s.menu.saveCategory({ name: "New Category" }),
    spy: (st) => st.menu.saveMenuCategory,
  },
];

function snapshotConfig(stores: ConfigStores) {
  return {
    profile: stores.profile.snapshot(),
    hours: stores.hours.snapshot(),
    closure: stores.closure.snapshot(),
    area: stores.area.snapshot(),
    menu: stores.menu.snapshot(),
  };
}

describe("restaurant_config permission matrix (Req 10.1-10.4, 10.11)", () => {
  it("permits every restaurant_config mutation under operate (owner primary)", async () => {
    for (const mutation of configMutations) {
      const stores = freshConfigStores();
      const services = configServices(resolveContextWith(ownerA()), stores);
      await expect(mutation.run(services)).resolves.toBeDefined();
      expect(mutation.spy(stores)).toHaveBeenCalledTimes(1);
    }
  });

  it("permits every restaurant_config mutation under operate (branch/location session)", async () => {
    const branches = [{ id: BRANCH_A1, tenantId: TENANT_A, isActive: true }];
    for (const mutation of configMutations) {
      const stores = freshConfigStores();
      const services = configServices(resolveContextWith(branchSessionA1(), { branches }), stores);
      await expect(mutation.run(services)).resolves.toBeDefined();
      expect(mutation.spy(stores)).toHaveBeenCalledTimes(1);
    }
  });

  const configRefusals = [
    {
      label: "view_only (reception)",
      resolve: () => resolveContextWith(receptionA()),
      message: MSG_NOT_AUTHORISED_CONFIG,
    },
    {
      label: "none (doctor)",
      resolve: () => resolveContextWith(doctorA()),
      message: MSG_NOT_AUTHORISED_CONFIG,
    },
    {
      label: "unresolved access (owner)",
      resolve: () => resolveContextWith(ownerA(), { unresolved: true }),
      message: MSG_NOT_AUTHORISED_CONFIG,
    },
    {
      label: "inactive child account",
      resolve: () => resolveContextWith(inactiveOwnerA()),
      message: MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
    },
  ];

  for (const refusal of configRefusals) {
    it(`refuses every restaurant_config mutation under ${refusal.label} before any repository call`, async () => {
      for (const mutation of configMutations) {
        const stores = freshConfigStores();
        const before = snapshotConfig(stores);
        const services = configServices(refusal.resolve(), stores);

        await expect(mutation.run(services)).rejects.toThrow(refusal.message);
        // Refused before the repository: the mutating adapter was never reached.
        expect(mutation.spy(stores)).not.toHaveBeenCalled();
        // And persistent state is byte-for-byte identical.
        expect(snapshotConfig(stores)).toEqual(before);
      }
    });
  }

  it("keeps Profile readable (read-only) under unresolved access while save is refused", async () => {
    const stores = freshConfigStores();
    const services = configServices(resolveContextWith(ownerA(), { unresolved: true }), stores);

    const view = await services.profile.read();
    expect(view.canSave).toBe(false);
    expect(view.tenantId).toBe(TENANT_A);
    await expect(services.profile.save({ profile: profileInput() })).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    expect(stores.profile.saveProfile).not.toHaveBeenCalled();
  });

  it("lets a reception (view_only) account read config surfaces without any manage capability", async () => {
    const stores = freshConfigStores();
    const services = configServices(resolveContextWith(receptionA()), stores);

    const [profile, hours, menu, areas] = await Promise.all([
      services.profile.read(),
      services.hours.read(),
      services.menu.list(),
      services.area.list(),
    ]);
    expect(profile.canSave).toBe(false);
    expect(hours.readOnly).toBe(true);
    expect(menu.canManage).toBe(false);
    expect(menu.readOnly).toBe(true);
    expect(areas.canManage).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// restaurant_config: tenant + location isolation (Req 9.3-9.7, 10.11, 10.12)
// ---------------------------------------------------------------------------

describe("restaurant_config tenant and location isolation (Req 9.3-9.7, 10.11, 10.12)", () => {
  it("returns only the effective server-derived scope on reads for each caller", async () => {
    const stores = freshConfigStores();
    const branches = [{ id: BRANCH_A1, tenantId: TENANT_A, isActive: true }];

    const ownerPrimary = configServices(resolveContextWith(ownerA()), stores);
    const ownerBranch = configServices(resolveContextWith(ownerA(), { branches }), stores);
    const tenantBOwner = configServices(resolveContextWith(ownerB()), stores);

    expect((await ownerPrimary.menu.list()).categories.map((c) => c.id)).toEqual(["cat-a-primary"]);
    expect(
      (await ownerBranch.menu.list({ requestedLocationId: BRANCH_A1 })).categories.map((c) => c.id),
    ).toEqual(["cat-a-branch"]);
    expect((await tenantBOwner.menu.list()).categories.map((c) => c.id)).toEqual(["cat-b-primary"]);

    // Areas honour the same scope split.
    expect((await ownerPrimary.area.list()).areas.map((a) => a.id)).toEqual(["area-a-primary"]);
    expect(
      (await ownerBranch.area.list({ requestedLocationId: BRANCH_A1 })).areas.map((a) => a.id),
    ).toEqual(["area-a-branch"]);
  });

  it("maps a foreign-tenant id to not-found and never mutates the foreign row (owner primary)", async () => {
    const stores = freshConfigStores();
    const before = snapshotConfig(stores);
    const services = configServices(resolveContextWith(ownerA()), stores);

    expect((await services.closure.remove({ closureId: "cl-b-primary" })).status).toBe("not_found");
    expect((await services.area.remove({ areaId: "area-b-primary" })).status).toBe("not_found");
    expect((await services.menu.confirmCategoryDeletion({ categoryId: "cat-b-primary" })).status).toBe(
      "not_found",
    );
    const edit = await services.menu.saveCategory({ categoryId: "cat-b-primary", name: "Hijacked" });
    expect(edit.status).toBe("not_found");

    // Tenant B rows are byte-for-byte unchanged.
    expect(snapshotConfig(stores)).toEqual(before);
  });

  it("cannot reach another location within the same tenant (owner primary -> branch rows)", async () => {
    const stores = freshConfigStores();
    const before = snapshotConfig(stores);
    const services = configServices(resolveContextWith(ownerA()), stores);

    // The branch-scoped ids are invisible to the primary scope -> not found.
    expect((await services.closure.remove({ closureId: "cl-a-branch" })).status).toBe("not_found");
    expect((await services.area.remove({ areaId: "area-a-branch" })).status).toBe("not_found");
    expect((await services.menu.confirmCategoryDeletion({ categoryId: "cat-a-branch" })).status).toBe(
      "not_found",
    );
    expect(snapshotConfig(stores)).toEqual(before);
  });

  it("owner-selected branch writes only the selected branch scope", async () => {
    const stores = freshConfigStores();
    const branches = [{ id: BRANCH_A1, tenantId: TENANT_A, isActive: true }];
    const services = configServices(resolveContextWith(ownerA(), { branches }), stores);

    // A branch-scoped closure is reachable only under the selected branch scope.
    expect(
      (await services.closure.remove({ closureId: "cl-a-branch", requestedLocationId: BRANCH_A1 })).status,
    ).toBe("deleted");
    // The primary closure is NOT reachable while the branch is selected.
    expect(
      (await services.closure.remove({ closureId: "cl-a-primary", requestedLocationId: BRANCH_A1 })).status,
    ).toBe("not_found");
  });

  it("rejects an owner selecting a branch that is not in the validated tenant list", async () => {
    const stores = freshConfigStores();
    const services = configServices(resolveContextWith(ownerA(), { branches: [] }), stores);
    await expect(services.menu.list({ requestedLocationId: BRANCH_A1 })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// restaurant_config: branch session forcing + spoofing (Req 9.6, 10.11, 10.12)
// ---------------------------------------------------------------------------

describe("restaurant_config branch session scope forcing (Req 9.6, 10.11, 10.12)", () => {
  const activeBranch = [{ id: BRANCH_A1, tenantId: TENANT_A, isActive: true }];

  it("forces a branch session to its own scope on reads (never the primary)", async () => {
    const stores = freshConfigStores();
    const services = configServices(resolveContextWith(branchSessionA1(), { branches: activeBranch }), stores);

    const menu = await services.menu.list();
    expect(menu.categories.map((c) => c.id)).toEqual(["cat-a-branch"]);
  });

  it("prevents a branch session from reaching the primary or another branch", async () => {
    const stores = freshConfigStores();
    const services = configServices(resolveContextWith(branchSessionA1(), { branches: activeBranch }), stores);

    // A branch-scoped delete of the primary closure resolves to not-found.
    expect((await services.closure.remove({ closureId: "cl-a-primary" })).status).toBe("not_found");
    // Attempting to select ANOTHER branch is rejected at the boundary.
    await expect(services.menu.list({ requestedLocationId: BRANCH_A2 })).rejects.toThrow();
  });

  it("rejects a spoofing branch account whose session location != account id", async () => {
    const stores = freshConfigStores();
    const spoof = session({ id: BRANCH_A1, role: "location", locationId: BRANCH_A2 });
    const services = configServices(
      resolveContextWith(spoof, { branches: [{ id: BRANCH_A2, tenantId: TENANT_A, isActive: true }] }),
      stores,
    );
    await expect(services.menu.list()).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
  });

  it("rejects a branch session whose branch is inactive", async () => {
    const stores = freshConfigStores();
    const services = configServices(
      resolveContextWith(branchSessionA1(), { branches: [{ id: BRANCH_A1, tenantId: TENANT_A, isActive: false }] }),
      stores,
    );
    await expect(services.menu.list()).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
  });
});

// ---------------------------------------------------------------------------
// whatsapp mutations: full permission matrix + external side-effect safety
// (Req 7.10, 10.9, 10.10, 10.11)
// ---------------------------------------------------------------------------

type WhatsAppStore = ReturnType<typeof createWhatsAppStore>;

interface WhatsAppMutation {
  name: string;
  run: (service: ReturnType<typeof createWhatsAppSettingsService>) => Promise<unknown>;
  spy: (store: WhatsAppStore) => ReturnType<typeof vi.fn>;
}

const whatsAppMutations: WhatsAppMutation[] = [
  {
    name: "config save",
    run: (svc) => svc.saveConfig({ phoneNumber: "+15559999999", isEnabled: false }),
    spy: (st) => st.saveWhatsAppConfig,
  },
  { name: "pairing initialize", run: (svc) => svc.initialize({}), spy: (st) => st.initialize },
  { name: "session disconnect", run: (svc) => svc.disconnect({}), spy: (st) => st.disconnect },
  {
    name: "test message queue",
    run: (svc) => svc.sendTestMessage({ phone: "+15551112222" }),
    spy: (st) => st.sendTestMessage,
  },
];

function whatsAppService(store: WhatsAppStore, sess: FakeSession, opts: BoundaryOptions = {}) {
  return createWhatsAppSettingsService({ resolveContext: resolveContextWith(sess, opts), ...store.deps });
}

describe("whatsapp permission matrix (Req 7.10, 10.9, 10.10)", () => {
  it("permits every whatsapp action under operate (owner)", async () => {
    for (const mutation of whatsAppMutations) {
      const store = createWhatsAppStore();
      await expect(mutation.run(whatsAppService(store, ownerA()))).resolves.toBeDefined();
      expect(mutation.spy(store)).toHaveBeenCalledTimes(1);
    }
  });

  const whatsAppRefusals = [
    { label: "view_only (reception, Premium)", sess: () => receptionA(), opts: {}, message: MSG_NOT_AUTHORISED_WHATSAPP },
    { label: "none (owner, Basic plan)", sess: () => session({ subscriptionPlan: "Basic" }), opts: {}, message: MSG_NOT_AUTHORISED_WHATSAPP },
    { label: "unresolved access (owner)", sess: () => ownerA(), opts: { unresolved: true }, message: MSG_NOT_AUTHORISED_WHATSAPP },
    { label: "inactive child account", sess: () => inactiveOwnerA(), opts: {}, message: MSG_RESTAURANT_SETTINGS_UNAUTHORIZED },
  ];

  for (const refusal of whatsAppRefusals) {
    it(`refuses every whatsapp action under ${refusal.label} with no external side effect`, async () => {
      for (const mutation of whatsAppMutations) {
        const store = createWhatsAppStore();
        const before = store.snapshot();
        const service = whatsAppService(store, refusal.sess(), refusal.opts);

        await expect(mutation.run(service)).rejects.toThrow(refusal.message);
        expect(mutation.spy(store)).not.toHaveBeenCalled();
        // Neither the stored config nor the external session/queue changed.
        expect(store.snapshot()).toBe(before);
      }
    });
  }

  it("exposes a strict status read to a view_only reception without operate controls", async () => {
    const store = createWhatsAppStore();
    const view = await whatsAppService(store, receptionA()).status({});
    expect(view.status.state).toBe("CONNECTED");
    expect(view.canOperate).toBe(false);
    expect(view.config?.tenantId).toBe(TENANT_A);
  });

  it("refuses the whatsapp status read entirely when the feature is not visible (Basic plan)", async () => {
    const store = createWhatsAppStore();
    await expect(whatsAppService(store, session({ subscriptionPlan: "Basic" })).status({})).rejects.toThrow(
      MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
    );
  });
});

// ---------------------------------------------------------------------------
// users mutations: full permission matrix (resolves through module boundary)
// (Req 8.15, 10.5, 10.6)
// ---------------------------------------------------------------------------

type UserStore = ReturnType<typeof createUserStore>;

interface UserMutation {
  name: string;
  run: (service: ReturnType<typeof createRestaurantUserService>) => Promise<{ status: string }>;
  spy: (store: UserStore) => ReturnType<typeof vi.fn>;
}

const userMutations: UserMutation[] = [
  {
    name: "create",
    run: (svc) =>
      svc.create({ name: "Ada Lin", email: "ada@example.com", phone: "", role: "doctor", password: "supersecret", confirmation: "supersecret" }),
    spy: (st) => st.createSubUser,
  },
  {
    name: "update",
    run: (svc) => svc.update({ id: "sub-a", name: "Sam II", email: "sam@example.com", phone: "555-0201", role: "doctor" }),
    spy: (st) => st.updateSubUser,
  },
  {
    name: "deactivate",
    run: (svc) => svc.setActive({ id: "sub-a", isActive: false }),
    spy: (st) => st.setSubUserActive,
  },
  { name: "delete", run: (svc) => svc.delete({ id: "sub-a" }), spy: (st) => st.deleteSubUser },
];

describe("users permission matrix (Req 8.15, 10.5, 10.6)", () => {
  it("permits every user mutation under operate (owner)", async () => {
    mockAuth.session = ownerA();
    // create
    let store = createUserStore();
    let svc = createRestaurantUserService({ ...store.deps });
    expect((await svc.create({ name: "Ada", email: "ada@example.com", phone: "", role: "doctor", password: "supersecret", confirmation: "supersecret" })).status).toBe("created");
    expect(store.createSubUser).toHaveBeenCalledTimes(1);

    // update / deactivate / delete against a seeded row
    for (const mutation of userMutations.slice(1)) {
      store = createUserStore([seededSubUser()]);
      svc = createRestaurantUserService({ ...store.deps });
      const result = await mutation.run(svc);
      expect(["updated", "deleted"]).toContain(result.status);
      expect(mutation.spy(store)).toHaveBeenCalledTimes(1);
    }
  });

  const userRefusals = [
    { label: "none (reception)", session: () => receptionA(), branches: [] as typeof mockDb.branches, message: MSG_NOT_AUTHORISED_USERS },
    { label: "none (branch/location session)", session: () => branchSessionA1(), branches: [{ id: BRANCH_A1, tenantId: TENANT_A, isActive: true }], message: MSG_NOT_AUTHORISED_USERS },
    { label: "unentitled (inactive subscription owner)", session: () => session({ subscriptionStatus: "Cancelled" }), branches: [], message: MSG_NOT_AUTHORISED_USERS },
    { label: "inactive child account", session: () => inactiveOwnerA(), branches: [], message: MSG_RESTAURANT_SETTINGS_UNAUTHORIZED },
  ];

  for (const refusal of userRefusals) {
    it(`refuses every user mutation under ${refusal.label} before any repository call`, async () => {
      mockAuth.session = refusal.session();
      mockDb.branches = refusal.branches;
      for (const mutation of userMutations) {
        const store = createUserStore([seededSubUser()]);
        const before = store.snapshot();
        const svc = createRestaurantUserService({ ...store.deps });

        await expect(mutation.run(svc)).rejects.toThrow(refusal.message);
        expect(mutation.spy(store)).not.toHaveBeenCalled();
        expect(store.snapshot()).toBe(before);
      }
    });
  }

  it("maps a foreign-tenant user id to not-found and never mutates the foreign row", async () => {
    mockAuth.session = ownerA();
    const store = createUserStore([
      seededSubUser(),
      seededSubUser({ id: "sub-b", tenantId: TENANT_B, email: "b@example.com" }),
    ]);
    const before = store.snapshot();
    const svc = createRestaurantUserService({ ...store.deps });

    expect((await svc.update({ id: "sub-b", name: "X", email: "b@example.com", phone: "", role: "doctor" })).status).toBe("not_found");
    expect((await svc.setActive({ id: "sub-b", isActive: false })).status).toBe("not_found");
    expect((await svc.delete({ id: "sub-b" })).status).toBe("not_found");
    expect(store.snapshot()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// branches (locations) mutations: full permission matrix (module boundary)
// (Req 9.8, 10.7, 10.8)
// ---------------------------------------------------------------------------

type BranchStore = ReturnType<typeof createBranchStore>;

interface BranchMutation {
  name: string;
  run: (service: ReturnType<typeof createRestaurantBranchService>) => Promise<{ status: string }>;
  spy: (store: BranchStore) => ReturnType<typeof vi.fn>;
}

const branchMutations: BranchMutation[] = [
  {
    name: "create",
    run: (svc) =>
      svc.create({ name: "New Branch", email: "new@example.com", phone: "", address: "", city: "", state: "", pincode: "", managerName: "", password: "supersecret", confirmation: "supersecret" }),
    spy: (st) => st.createBranch,
  },
  {
    name: "update",
    run: (svc) => svc.update({ id: BRANCH_A1, name: "Renamed", phone: "", address: "", city: "", state: "", pincode: "", managerName: "" }),
    spy: (st) => st.updateBranch,
  },
  {
    name: "deactivate",
    run: (svc) => svc.setActive({ id: BRANCH_A1, isActive: false }),
    spy: (st) => st.setBranchActive,
  },
  { name: "delete", run: (svc) => svc.delete({ id: BRANCH_A1 }), spy: (st) => st.deleteBranch },
];

describe("branches permission matrix (Req 9.8, 10.7, 10.8)", () => {
  it("permits every branch mutation under operate (owner, within plan limit)", async () => {
    mockAuth.session = ownerA();
    // create against an empty tenant (Premium permits 1 branch)
    let store = createBranchStore();
    let svc = createRestaurantBranchService({ ...store.deps });
    expect((await svc.create({ name: "Downtown", email: "dt@example.com", phone: "", address: "", city: "", state: "", pincode: "", managerName: "", password: "supersecret", confirmation: "supersecret" })).status).toBe("created");
    expect(store.createBranch).toHaveBeenCalledTimes(1);

    for (const mutation of branchMutations.slice(1)) {
      store = createBranchStore([seededBranch()]);
      svc = createRestaurantBranchService({ ...store.deps });
      const result = await mutation.run(svc);
      expect(["updated", "deleted"]).toContain(result.status);
      expect(mutation.spy(store)).toHaveBeenCalledTimes(1);
    }
  });

  const branchRefusals = [
    { label: "none (reception)", session: () => receptionA(), message: MSG_NOT_AUTHORISED_LOCATIONS },
    { label: "unentitled (Basic plan owner)", session: () => session({ subscriptionPlan: "Basic" }), message: MSG_NOT_AUTHORISED_LOCATIONS },
    { label: "inactive child account", session: () => inactiveOwnerA(), message: MSG_RESTAURANT_SETTINGS_UNAUTHORIZED },
  ];

  for (const refusal of branchRefusals) {
    it(`refuses every branch mutation under ${refusal.label} before any repository call`, async () => {
      mockAuth.session = refusal.session();
      mockDb.branches = [];
      for (const mutation of branchMutations) {
        const store = createBranchStore([seededBranch()]);
        const before = store.snapshot();
        const svc = createRestaurantBranchService({ ...store.deps });

        await expect(mutation.run(svc)).rejects.toThrow(refusal.message);
        expect(mutation.spy(store)).not.toHaveBeenCalled();
        expect(store.snapshot()).toBe(before);
      }
    });
  }

  it("maps a foreign-tenant branch id to not-found and never mutates the foreign row", async () => {
    mockAuth.session = ownerA();
    const store = createBranchStore([
      seededBranch(),
      seededBranch({ id: "branch-b-1", tenantId: TENANT_B, email: "bbranch@example.com" }),
    ]);
    const before = store.snapshot();
    const svc = createRestaurantBranchService({ ...store.deps });

    expect((await svc.update({ id: "branch-b-1", name: "X", phone: "", address: "", city: "", state: "", pincode: "", managerName: "" })).status).toBe("not_found");
    expect((await svc.setActive({ id: "branch-b-1", isActive: false })).status).toBe("not_found");
    expect((await svc.delete({ id: "branch-b-1" })).status).toBe("not_found");
    expect(store.snapshot()).toBe(before);
  });
});
