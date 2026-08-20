/**
 * restaurant-settings.persistence.integration.test.ts
 *
 * End-to-end persistence-consistency integration suite (spec
 * `.kiro/specs/restaurant-dashboard-settings`, task 11.2, Req 2.7, 3.6, 3.7,
 * 4.3-4.6, 5.1-5.9, 6.1-6.13, 8.4-8.14, 11.1-11.6).
 *
 * Where the per-service unit tests exercise each branch with per-scenario mocks,
 * this suite wires the REAL settings services (`restaurant-settings.ts`) to
 * faithful, stateful in-memory stores that mirror the scoped MariaDB repository
 * (`restaurant-settings.server.ts`): tenant-first null-safe scoping, atomic
 * seven-day hour replacement, duplicate-safe (`INSERT IGNORE`) closure creation,
 * assigned-table delete guards, tenant-wide menu caps with transactional
 * cascade deletion, and a complete SubUser lifecycle. Each store commits state
 * all-or-nothing exactly like the real transaction boundary, so the suite can
 * prove:
 *   - trimmed/normalized save -> read round trips (profile + hours),
 *   - repeated identical saves cause no drift (idempotence),
 *   - concurrent duplicate closure creation yields exactly one stored row,
 *   - a mid-save failure rolls back the whole seven-day hour write,
 *   - dining-area deletion reports the exact assigned-table count and is guarded,
 *   - menu caps and cascade deletes are all-or-nothing, and
 *   - every profile/user lifecycle failure leaves stored state byte-unchanged.
 *
 * No database, cookie, or network is touched. Authorization runs through real
 * `resolveFeatureAccess` results so `operate` / `view_only` / `none` behave
 * exactly as production.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFeatureAccess, type AccountContext, type ResolvedAccess } from "./feature-access";
import {
  EFFECTIVE_MAIN_AREA_ID,
  LIMITS,
  MSG_SETTINGS_RESOURCE_NOT_FOUND,
  MSG_SUB_USER_EMAIL_IN_USE,
  normaliseRestaurantProfile,
  type AccountType,
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
  type RestaurantSettingsAccountRole,
  type SubUser,
  type SubUserRole,
  type UserRoleCounts,
} from "./restaurant-settings-model";
import {
  createRestaurantClosureService,
  createRestaurantDiningAreaService,
  createRestaurantMenuService,
  createRestaurantOperatingHoursService,
  createRestaurantProfileService,
  createRestaurantUserService,
  type AuthenticatedRestaurantSettingsContext,
} from "./restaurant-settings";
import type {
  AccountSecuritySnapshot,
  CreateClosureDayResult,
  CreateDiningAreaInput,
  CreateDiningAreaResult,
  CreateSubUserInput,
  CreateSubUserResult,
  DeleteDiningAreaResult,
  DeleteMenuCategoryResult,
  DeleteMenuItemResult,
  DeleteScopedRecordResult,
  DeleteSubUserResult,
  PreviewMenuCategoryDeletionResult,
  SaveMenuCategoryResult,
  SaveMenuItemResult,
  StoredRestaurantHours,
  StoredRestaurantProfile,
  StoredSubUser,
  SubUserLifecycleResult,
  UpdateSubUserInput,
  UpdateSubUserResult,
} from "./restaurant-settings.server";

const TENANT_A = "tenant-a";
const BASE_NOW = Date.UTC(2026, 3, 1, 0, 0, 0);

// The guarded SubUser lifecycle resolves its context through the shared module
// boundary (`verifySession`), not the per-service injected `resolveContext`, so
// we drive that boundary with one controllable fake session. Every other service
// in this suite resolves context via injection and never touches this mock.
const mockAuth = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("./auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth.server")>();
  return { ...actual, verifySession: async () => mockAuth.session };
});

/** A signed-in owner session the shared boundary can resolve to `users: operate`. */
function ownerSession(subscriptionPlan = "Premium") {
  return {
    id: "owner-a",
    tenantId: TENANT_A,
    role: "admin" as const,
    profession: "Restaurant and dining",
    subscriptionPlan,
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2099-01-01T00:00:00.000Z",
    isActive: true,
  };
}

// ---------------------------------------------------------------------------
// Context builder (real feature-access resolution)
// ---------------------------------------------------------------------------

type ConfigPermission = "operate" | "view_only" | "none";

interface ContextOptions {
  role?: RestaurantSettingsAccountRole;
  tenantId?: string;
  accountId?: string;
  locationId?: string | null;
  subscriptionPlan?: string;
  /** Optional override of the single feature permission used by a service. */
  override?: { feature: keyof ResolvedAccess; permission: ConfigPermission };
}

function contextFor(opts: ContextOptions = {}): AuthenticatedRestaurantSettingsContext {
  const role = opts.role ?? "admin";
  const tenantId = opts.tenantId ?? TENANT_A;
  const accountId = opts.accountId ?? `owner-${tenantId}`;
  const subscriptionPlan = opts.subscriptionPlan ?? "Premium";
  const accountContext: AccountContext = {
    role,
    profession: "Restaurant and dining",
    subscriptionPlan,
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    isActive: true,
    now: new Date(BASE_NOW),
  };
  let access = resolveFeatureAccess(accountContext);
  if (opts.override) {
    const { feature, permission } = opts.override;
    access = {
      ...access,
      [feature]:
        permission === "none"
          ? { available: false, permission: "none", visible: false }
          : { available: true, permission, visible: true },
    } as ResolvedAccess;
  }
  return {
    session: { id: accountId, tenantId, role, subscriptionPlan },
    accountId,
    tenantId,
    role,
    featureContext: accountContext,
    access,
    scope: { tenantId, locationId: opts.locationId ?? null },
  };
}

function accountSecurity(context: AuthenticatedRestaurantSettingsContext): AccountSecuritySnapshot {
  const accountType: AccountType =
    context.role === "location" ? "location" : context.role === "admin" ? "user" : "sub_user";
  return {
    accountType,
    accountId: context.accountId,
    tenantId: context.tenantId,
    email: "owner@example.com",
    passwordHash: "h",
    profilePhoto: null,
  };
}

/** A profile submission with untrimmed values in every field. */
function paddedProfileInput(): RestaurantProfile {
  return {
    restaurantName: "  The Copper Spoon  ",
    ownerOrManagerName: "  Dana Reyes ",
    accountPhone: "  555-0100 ",
    teamSize: "  12 ",
    publicEmail: "  hello@copper.example  ",
    contactNumber: "  555-0101 ",
    whatsappNumber: "  555-0102 ",
    landline: "  555-0103 ",
    address: "  1 Market St  ",
    cuisineOrServices: "  Modern European  ",
    description: "  Seasonal tasting menus.  ",
  };
}

// ===========================================================================
// Profile: trimmed round trip + idempotent repeated saves + lifecycle rollback
// (Req 2.7, 11.1, 11.2)
// ===========================================================================

function createProfileStore(seed: StoredRestaurantProfile | null = null) {
  let row: StoredRestaurantProfile | null = seed ? { ...seed } : null;
  let failNextSave = false;
  const security = accountSecurity(contextFor());

  return {
    row(): StoredRestaurantProfile | null {
      return row ? { ...row } : null;
    },
    failNext() {
      failNextSave = true;
    },
    deps: {
      getTenantProfile: async (): Promise<StoredRestaurantProfile | null> => (row ? { ...row } : null),
      getAccountSecurity: async (): Promise<AccountSecuritySnapshot> => ({ ...security }),
      saveProfile: async (tenantId: string, profile: RestaurantProfile): Promise<StoredRestaurantProfile> => {
        if (failNextSave) {
          // A storage failure aborts before any row is written (Req 11.2 rollback).
          throw new Error("profile storage failure");
        }
        // Atomic replace of the single tenant profile row.
        row = { id: row?.id ?? "profile-1", tenantId, ...profile };
        return { ...row };
      },
    },
  };
}

describe("profile persistence (Req 2.7, 11.1, 11.2)", () => {
  it("trims every field on save and reads back the identical normalized row", async () => {
    const store = createProfileStore();
    const service = createRestaurantProfileService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    const saved = await service.save({ profile: paddedProfileInput() });
    const expected = normaliseRestaurantProfile(paddedProfileInput());
    expect(saved.profile).toEqual(expected);

    // A fresh read returns exactly the trimmed stored values (round trip).
    const read = await service.read();
    expect(read.profile).toEqual(expected);
    expect(store.row()).toMatchObject(expected);
  });

  it("is idempotent: saving identical input twice causes no drift", async () => {
    const store = createProfileStore();
    const service = createRestaurantProfileService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    await service.save({ profile: paddedProfileInput() });
    const afterFirst = store.row();
    await service.save({ profile: paddedProfileInput() });
    const afterSecond = store.row();

    // Byte-identical stored row after the repeated identical save.
    expect(afterSecond).toEqual(afterFirst);
  });

  it("leaves the stored profile unchanged when the atomic write fails", async () => {
    const seed: StoredRestaurantProfile = {
      id: "profile-1",
      tenantId: TENANT_A,
      ...normaliseRestaurantProfile({ restaurantName: "Original" }),
    };
    const store = createProfileStore(seed);
    const service = createRestaurantProfileService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    store.failNext();
    await expect(service.save({ profile: paddedProfileInput() })).rejects.toThrow(
      /profile storage failure/,
    );
    // The failed write rolled back: the seeded row is untouched.
    expect(store.row()).toEqual(seed);
  });

  it("refuses a save from a view_only account before any write", async () => {
    const store = createProfileStore();
    const service = createRestaurantProfileService({
      resolveContext: async () =>
        contextFor({ override: { feature: "restaurant_config", permission: "view_only" } }),
      ...store.deps,
    });

    await expect(service.save({ profile: paddedProfileInput() })).rejects.toThrow();
    expect(store.row()).toBeNull();
  });
});

// ===========================================================================
// Operating hours: normalized round trip, idempotence, and ATOMIC rollback
// (Req 3.6, 3.7, 11.1)
// ===========================================================================

function createHoursStore(seed: DayHours[] = []) {
  let rows: StoredRestaurantHours[] = seed.map((d) => ({ id: `hours-${d.dayOfWeek}`, tenantId: TENANT_A, ...d }));
  let failAtDay: number | null = null;

  return {
    /** Force the transaction to throw when it reaches this weekday (mid-save). */
    failAtDay(dayOfWeek: number) {
      failAtDay = dayOfWeek;
    },
    snapshot(): StoredRestaurantHours[] {
      return rows.map((r) => ({ ...r })).sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    },
    deps: {
      getTenantHours: async (): Promise<StoredRestaurantHours[]> => rows.map((r) => ({ ...r })),
      replaceTenantHours: async (tenantId: string, days: readonly DayHours[]): Promise<void> => {
        // Mirror the repository's single transaction: apply every upsert to a
        // working copy and COMMIT only if all seven succeed. A mid-loop failure
        // discards the working copy, leaving stored hours byte-unchanged.
        const working = new Map<number, StoredRestaurantHours>(rows.map((r) => [r.dayOfWeek, { ...r }]));
        for (const day of days) {
          if (failAtDay !== null && day.dayOfWeek === failAtDay) {
            throw new Error(`hours storage failure at day ${day.dayOfWeek}`);
          }
          const existing = working.get(day.dayOfWeek);
          if (existing) {
            existing.openTime = day.openTime;
            existing.closeTime = day.closeTime;
            existing.isClosed = day.isClosed;
          } else {
            working.set(day.dayOfWeek, { id: `hours-${day.dayOfWeek}`, tenantId, ...day });
          }
        }
        // COMMIT
        rows = [...working.values()];
      },
    },
  };
}

/** Seven valid weekdays, given here in a deliberately shuffled input order. */
function shuffledSevenDays(): DayHours[] {
  const canonical: DayHours[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    openTime: "09:00",
    closeTime: "22:00",
    isClosed: dayOfWeek === 0,
  }));
  return [canonical[4], canonical[1], canonical[6], canonical[0], canonical[3], canonical[2], canonical[5]];
}

describe("operating-hours persistence (Req 3.6, 3.7, 11.1)", () => {
  it("normalizes a shuffled seven-day submission and reads back canonical order", async () => {
    const store = createHoursStore();
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    const result = await service.save({ days: shuffledSevenDays() });
    expect(result.status).toBe("saved");

    const view = await service.read();
    // Exactly seven canonical (Sunday-first) rows regardless of input order.
    expect(view.days.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(view.days[0].isClosed).toBe(true);
    expect(view.days[1]).toEqual({ dayOfWeek: 1, openTime: "09:00", closeTime: "22:00", isClosed: false });
  });

  it("is idempotent: saving the same seven days twice yields no drift", async () => {
    const store = createHoursStore();
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    await service.save({ days: shuffledSevenDays() });
    const afterFirst = store.snapshot();
    await service.save({ days: shuffledSevenDays() });
    const afterSecond = store.snapshot();

    expect(afterSecond).toEqual(afterFirst);
  });

  it("rolls back the ENTIRE seven-day write when one row fails mid-save (no partial write)", async () => {
    // Seed a full, distinct baseline so a partial write would be observable.
    const baseline: DayHours[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      openTime: "08:00",
      closeTime: "12:00",
      isClosed: false,
    }));
    const store = createHoursStore(baseline);
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    const before = store.snapshot();
    // Wednesday (day 3) fails while days 0-2 have already been staged.
    store.failAtDay(3);

    await expect(service.save({ days: shuffledSevenDays() })).rejects.toThrow(/hours storage failure/);

    // Not one weekday changed — the transaction rolled back wholesale.
    expect(store.snapshot()).toEqual(before);
  });

  it("writes nothing when the submission is invalid (atomic validation)", async () => {
    const store = createHoursStore();
    const replaceSpy = vi.spyOn(store.deps, "replaceTenantHours");
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    // Monday open with close <= open, and Wednesday omitted entirely.
    const days = shuffledSevenDays().filter((d) => d.dayOfWeek !== 3);
    const monday = days.find((d) => d.dayOfWeek === 1)!;
    monday.openTime = "20:00";
    monday.closeTime = "09:00";

    const result = await service.save({ days });
    expect(result.status).toBe("invalid");
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual([]);
  });
});

// ===========================================================================
// Closures: duplicate-safe create under concurrency yields exactly one row
// (Req 4.3, 4.4, 4.5, 4.6, 11.6)
// ===========================================================================

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

function createClosureStore(opts: { tableIds?: string[] } = {}) {
  const rows: ClosureRow[] = [];
  const tableIds = new Set(opts.tableIds ?? []);
  let idCounter = 0;

  const inScope = (row: ClosureRow, scope: RestaurantResourceScope) =>
    row.tenantId === scope.tenantId && row.locationId === scope.locationId;

  return {
    rowCount(): number {
      return rows.length;
    },
    deps: {
      listClosureDays: async (
        scope: RestaurantResourceScope,
        monthStart: string,
        nextMonthStart: string,
        closureScope?: ClosureScope,
      ): Promise<ClosureDay[]> => {
        return rows
          .filter(
            (r) =>
              inScope(r, scope) &&
              r.date >= monthStart &&
              r.date < nextMonthStart &&
              (!closureScope ||
                (closureScope.type === "restaurant" && r.scopeType === "restaurant") ||
                (closureScope.type === "table" &&
                  r.scopeType === "table" &&
                  r.tableId === closureScope.tableId)),
          )
          .map<ClosureDay>((r) => ({
            id: r.id,
            date: r.date,
            scope: r.scopeType === "table" ? { type: "table", tableId: r.tableId! } : { type: "restaurant" },
            reason: r.reason,
            isHoliday: r.isHoliday,
            // Closure reads NEVER touch bookings, so the count is derived and 0 here.
            affectedBookingCount: 0,
            locationId: r.locationId,
          }));
      },
      createClosureDay: async (
        scope: RestaurantResourceScope,
        input: { date: string; scope: ClosureScope; reason: string; isHoliday: boolean },
      ): Promise<CreateClosureDayResult> => {
        // A table scope must resolve within the same tenant/location.
        if (input.scope.type === "table" && !tableIds.has(input.scope.tableId)) {
          return { status: "table_not_found" };
        }
        const scopeKey = input.scope.type === "table" ? input.scope.tableId : "restaurant";
        // Atomic INSERT IGNORE on the (tenant, location, scopeKey, date) unique key:
        // the check and the insert share one synchronous critical section, exactly
        // like the DB constraint, so concurrent duplicates collapse to one row.
        const duplicate = rows.find(
          (r) => inScope(r, scope) && r.scopeKey === scopeKey && r.date === input.date,
        );
        if (duplicate) return { status: "duplicate" };
        const id = `closure-${idCounter++}`;
        rows.push({
          id,
          tenantId: scope.tenantId,
          locationId: scope.locationId,
          date: input.date,
          scopeType: input.scope.type,
          tableId: input.scope.type === "table" ? input.scope.tableId : null,
          scopeKey,
          reason: input.reason,
          isHoliday: input.isHoliday,
        });
        return { status: "created", id };
      },
      deleteClosureDay: async (
        scope: RestaurantResourceScope,
        closureId: string,
      ): Promise<DeleteScopedRecordResult> => {
        const idx = rows.findIndex((r) => inScope(r, scope) && r.id === closureId);
        if (idx === -1) return { status: "not_found" };
        rows.splice(idx, 1);
        return { status: "deleted" };
      },
    },
  };
}

describe("closure persistence and concurrency (Req 4.3-4.6, 11.6)", () => {
  it("collapses two concurrent identical closure creations to exactly one stored row", async () => {
    const store = createClosureStore();
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    const payload = {
      date: "2026-04-15",
      scope: { type: "restaurant" as const },
      reason: "Holiday",
      isHoliday: true,
    };
    const [a, b] = await Promise.all([service.create(payload), service.create(payload)]);

    const statuses = [a.status, b.status].sort();
    // One wins with `created`, the other is rejected as a duplicate.
    expect(statuses).toEqual(["created", "duplicate"]);
    expect(store.rowCount()).toBe(1);
  });

  it("a repeated sequential creation of the same date is idempotent (one row)", async () => {
    const store = createClosureStore();
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    const payload = {
      date: "2026-04-20",
      scope: { type: "restaurant" as const },
      reason: "Maintenance",
      isHoliday: false,
    };
    const first = await service.create(payload);
    const second = await service.create(payload);

    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate");
    expect(store.rowCount()).toBe(1);
  });

  it("maps a table closure outside the resolved scope to not found and stores nothing", async () => {
    const store = createClosureStore({ tableIds: ["table-1"] });
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    const result = await service.create({
      date: "2026-04-21",
      scope: { type: "table", tableId: "ghost-table" },
      reason: "",
      isHoliday: false,
    });
    expect(result.status).toBe("not_found");
    expect(result.status === "not_found" && result.message).toBe(MSG_SETTINGS_RESOURCE_NOT_FOUND);
    expect(store.rowCount()).toBe(0);
  });

  it("names every malformed field and writes nothing (Req 4.6)", async () => {
    const store = createClosureStore();
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    const result = await service.create({
      date: "2026-02-30", // nonexistent calendar date
      scope: { type: "restaurant" },
      reason: "x".repeat(500), // overlong reason
      isHoliday: false,
    });
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.errors.map((e) => e.field).sort()).toEqual([
      "date",
      "reason",
    ]);
    expect(store.rowCount()).toBe(0);
  });

  it("deletes exactly the addressed closure and reports a miss as not found", async () => {
    const store = createClosureStore();
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });
    const created = await service.create({
      date: "2026-04-22",
      scope: { type: "restaurant" },
      reason: "One-off",
      isHoliday: false,
    });
    const closureId = created.status === "created" ? created.closure.id : "";

    expect((await service.remove({ closureId: "ghost" })).status).toBe("not_found");
    expect(store.rowCount()).toBe(1);

    expect((await service.remove({ closureId })).status).toBe("deleted");
    expect(store.rowCount()).toBe(0);
  });
});

// ===========================================================================
// Dining areas: delete reports the exact assigned-table count and is guarded
// (Req 5.6, 5.7, 5.8)
// ===========================================================================

interface AreaRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  name: string;
  displayOrder: number;
}
interface AreaTableRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  areaId: string | null;
  area: string;
}

function createAreaStore(seed: { areas?: AreaRow[]; tables?: AreaTableRow[] } = {}) {
  const areas: AreaRow[] = (seed.areas ?? []).map((a) => ({ ...a }));
  const tables: AreaTableRow[] = (seed.tables ?? []).map((t) => ({ ...t }));
  let idCounter = 0;

  const inScope = (row: { tenantId: string; locationId: string | null }, scope: RestaurantResourceScope) =>
    row.tenantId === scope.tenantId && row.locationId === scope.locationId;

  const assignedCount = (area: AreaRow): number =>
    tables.filter(
      (t) =>
        t.tenantId === area.tenantId &&
        t.locationId === area.locationId &&
        (t.areaId === area.id ||
          (t.areaId === null && t.area.trim().toLowerCase() === area.name.trim().toLowerCase())),
    ).length;

  return {
    areaCount(): number {
      return areas.length;
    },
    detachTablesFrom(areaId: string) {
      for (const t of tables) {
        if (t.areaId === areaId) t.areaId = null;
        t.area = "";
      }
    },
    deps: {
      listDiningAreas: async (scope: RestaurantResourceScope): Promise<DiningArea[]> => {
        const scoped = areas
          .filter((a) => inScope(a, scope))
          .map<DiningArea>((a) => ({
            id: a.id,
            name: a.name,
            displayOrder: a.displayOrder,
            tableCount: assignedCount(a),
            locationId: a.locationId,
          }));
        if (scoped.length > 0) return scoped;
        // Synthetic Main when no stored area exists.
        return [
          { id: EFFECTIVE_MAIN_AREA_ID, name: "Main", displayOrder: 1, tableCount: 0, locationId: scope.locationId },
        ];
      },
      createDiningArea: async (
        scope: RestaurantResourceScope,
        input: CreateDiningAreaInput,
      ): Promise<CreateDiningAreaResult> => {
        const duplicate = areas.some(
          (a) => inScope(a, scope) && a.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
        );
        if (duplicate) return { status: "duplicate" };
        const id = `area-${idCounter++}`;
        const displayOrder =
          input.displayOrder ?? areas.filter((a) => a.tenantId === scope.tenantId).length + 1;
        areas.push({ id, tenantId: scope.tenantId, locationId: scope.locationId, name: input.name, displayOrder });
        return {
          status: "created",
          area: { id, name: input.name, displayOrder, tableCount: 0, locationId: scope.locationId },
        };
      },
      deleteDiningArea: async (
        scope: RestaurantResourceScope,
        areaId: string,
      ): Promise<DeleteDiningAreaResult> => {
        if (areaId === EFFECTIVE_MAIN_AREA_ID) return { status: "not_found" };
        const area = areas.find((a) => inScope(a, scope) && a.id === areaId);
        if (!area) return { status: "not_found" };
        const assigned = assignedCount(area);
        if (assigned > 0) return { status: "assigned_tables", assignedTableCount: assigned };
        areas.splice(areas.indexOf(area), 1);
        return { status: "deleted" };
      },
    },
  };
}

describe("dining-area delete counts and guards (Req 5.6-5.8)", () => {
  function seededArea() {
    return createAreaStore({
      areas: [{ id: "area-patio", tenantId: TENANT_A, locationId: null, name: "Patio", displayOrder: 1 }],
      tables: [
        { id: "t-1", tenantId: TENANT_A, locationId: null, areaId: "area-patio", area: "Patio" },
        { id: "t-2", tenantId: TENANT_A, locationId: null, areaId: "area-patio", area: "Patio" },
      ],
    });
  }

  it("refuses deletion of an area with assigned tables and names the exact count", async () => {
    const store = seededArea();
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    const result = await service.remove({ areaId: "area-patio" });
    expect(result.status).toBe("assigned_tables");
    expect(result.status === "assigned_tables" && result.assignedTableCount).toBe(2);
    expect(result.status === "assigned_tables" && result.message).toContain("2 assigned tables");
    // Guard preserved the area.
    expect(store.areaCount()).toBe(1);
  });

  it("permits deletion once no tables remain assigned", async () => {
    const store = seededArea();
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    store.detachTablesFrom("area-patio");
    const result = await service.remove({ areaId: "area-patio" });
    expect(result.status).toBe("deleted");
    expect(store.areaCount()).toBe(0);
  });

  it("maps the synthetic Main and any foreign id to not found without mutation", async () => {
    const store = seededArea();
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor(),
      ...store.deps,
    });

    expect((await service.remove({ areaId: EFFECTIVE_MAIN_AREA_ID })).status).toBe("not_found");
    expect((await service.remove({ areaId: "no-such-area" })).status).toBe("not_found");
    expect(store.areaCount()).toBe(1);
  });
});

// ===========================================================================
// Menu: tenant caps and cascade deletions are transactional (all-or-nothing)
// (Req 6.1-6.13, 11.1, 11.4)
// ===========================================================================

interface MenuCategoryRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  name: string;
  displayOrder: number;
}
interface MenuItemRow {
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

function createMenuStore(seed: { categories?: MenuCategoryRow[]; items?: MenuItemRow[] } = {}) {
  const categories: MenuCategoryRow[] = (seed.categories ?? []).map((c) => ({ ...c }));
  const items: MenuItemRow[] = (seed.items ?? []).map((i) => ({ ...i }));
  let idCounter = 0;

  // Unrelated booking state no menu method may read/write; a byte-equal snapshot
  // before/after a cascade proves non-interference.
  const bookings = [{ id: "bk-1", tableId: "t-1", status: "confirmed" }];

  const inScope = (row: { tenantId: string; locationId: string | null }, scope: RestaurantResourceScope) =>
    row.tenantId === scope.tenantId && row.locationId === scope.locationId;

  return {
    snapshotUnrelated(): string {
      return JSON.stringify(bookings);
    },
    tenantItemCount(): number {
      return items.length;
    },
    tenantCategoryCount(): number {
      return categories.length;
    },
    deps: {
      listMenu: async (scope: RestaurantResourceScope): Promise<MenuCategory[]> =>
        categories
          .filter((c) => inScope(c, scope))
          .map<MenuCategory>((c) => ({
            id: c.id,
            name: c.name,
            displayOrder: c.displayOrder,
            locationId: c.locationId,
            items: items
              .filter((i) => inScope(i, scope) && i.categoryId === c.id)
              .map<MenuItem>((i) => ({ ...i })),
          })),
      saveMenuCategory: async (
        scope: RestaurantResourceScope,
        input: NormalisedMenuCategory,
        categoryId?: string,
      ): Promise<SaveMenuCategoryResult> => {
        if (categoryId) {
          const existing = categories.find((c) => inScope(c, scope) && c.id === categoryId);
          if (!existing) return { status: "not_found" };
          existing.name = input.name;
          existing.displayOrder = input.displayOrder;
          return {
            status: "saved",
            category: { id: existing.id, name: existing.name, displayOrder: existing.displayOrder, items: [], locationId: existing.locationId },
          };
        }
        if (categories.filter((c) => c.tenantId === scope.tenantId).length >= LIMITS.menuCategoriesPerTenant) {
          return { status: "category_limit" };
        }
        const id = `category-${idCounter++}`;
        categories.push({ id, tenantId: scope.tenantId, locationId: scope.locationId, name: input.name, displayOrder: input.displayOrder });
        return { status: "saved", category: { id, name: input.name, displayOrder: input.displayOrder, items: [], locationId: scope.locationId } };
      },
      saveMenuItem: async (
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
        if (items.filter((i) => i.tenantId === scope.tenantId).length >= LIMITS.menuItemsPerTenant) {
          return { status: "item_limit" };
        }
        const id = `item-${idCounter++}`;
        const row: MenuItemRow = {
          id,
          tenantId: scope.tenantId,
          locationId: scope.locationId,
          categoryId: input.categoryId,
          name: input.name,
          priceMinor: input.priceMinor,
          description: input.description,
          displayOrder: input.displayOrder,
          state: input.state,
        };
        items.push(row);
        return { status: "saved", item: { ...row } };
      },
      updateMenuItemState: async (
        scope: RestaurantResourceScope,
        itemId: string,
        state: MenuItemState,
      ): Promise<SaveMenuItemResult> => {
        const existing = items.find((i) => inScope(i, scope) && i.id === itemId);
        if (!existing) return { status: "not_found" };
        existing.state = state;
        return { status: "saved", item: { ...existing } };
      },
      deleteMenuItem: async (scope: RestaurantResourceScope, itemId: string): Promise<DeleteMenuItemResult> => {
        const idx = items.findIndex((i) => inScope(i, scope) && i.id === itemId);
        if (idx === -1) return { status: "not_found" };
        items.splice(idx, 1);
        return { status: "deleted" };
      },
      previewMenuCategoryDeletion: async (
        scope: RestaurantResourceScope,
        categoryId: string,
      ): Promise<PreviewMenuCategoryDeletionResult> => {
        const category = categories.find((c) => inScope(c, scope) && c.id === categoryId);
        if (!category) return { status: "not_found" };
        const itemCount = items.filter((i) => inScope(i, scope) && i.categoryId === categoryId).length;
        return { status: "preview", categoryId, itemCount, confirmationRequired: itemCount > 0 };
      },
      confirmDeleteMenuCategory: async (
        scope: RestaurantResourceScope,
        categoryId: string,
      ): Promise<DeleteMenuCategoryResult> => {
        const cIdx = categories.findIndex((c) => inScope(c, scope) && c.id === categoryId);
        if (cIdx === -1) return { status: "not_found" };
        // Transactional cascade: category + all its items removed together.
        const kept = items.filter((i) => !(inScope(i, scope) && i.categoryId === categoryId));
        const deletedItemCount = items.length - kept.length;
        items.length = 0;
        items.push(...kept);
        categories.splice(cIdx, 1);
        return { status: "deleted", deletedItemCount };
      },
    },
  };
}

function menuItemInput(categoryId: string, name: string) {
  return { categoryId, name, priceMinor: 1200, description: "", displayOrder: undefined, state: undefined as MenuItemState | undefined };
}

describe("menu cap and cascade transactions (Req 6.1-6.13, 11.1, 11.4)", () => {
  it("refuses a category beyond the tenant cap without mutating any row (all-or-nothing)", async () => {
    const seeded: MenuCategoryRow[] = Array.from({ length: LIMITS.menuCategoriesPerTenant }, (_, i) => ({
      id: `c-${i}`,
      tenantId: TENANT_A,
      locationId: null,
      name: `Category ${i}`,
      displayOrder: i + 1,
    }));
    const store = createMenuStore({ categories: seeded });
    const service = createRestaurantMenuService({ resolveContext: async () => contextFor(), ...store.deps });

    const before = store.tenantCategoryCount();
    const result = await service.saveCategory({ name: "One Too Many" });
    expect(result.status === "invalid" || result.status === "limit").toBe(true);
    expect(store.tenantCategoryCount()).toBe(before);
  });

  it("refuses an item beyond the tenant cap without mutating any row", async () => {
    const category: MenuCategoryRow = { id: "c-0", tenantId: TENANT_A, locationId: null, name: "Everything", displayOrder: 1 };
    const seededItems: MenuItemRow[] = Array.from({ length: LIMITS.menuItemsPerTenant }, (_, i) => ({
      id: `i-${i}`,
      tenantId: TENANT_A,
      locationId: null,
      categoryId: "c-0",
      name: `Item ${i}`,
      priceMinor: 100,
      description: "",
      displayOrder: i + 1,
      state: "available",
    }));
    const store = createMenuStore({ categories: [category], items: seededItems });
    const service = createRestaurantMenuService({ resolveContext: async () => contextFor(), ...store.deps });

    const before = store.tenantItemCount();
    const result = await service.saveItem(menuItemInput("c-0", "Overflow"));
    expect(result.status === "invalid" || result.status === "limit").toBe(true);
    expect(store.tenantItemCount()).toBe(before);
  });

  it("cascade-deletes a category and all its items together, leaving unrelated state intact", async () => {
    const store = createMenuStore();
    const service = createRestaurantMenuService({ resolveContext: async () => contextFor(), ...store.deps });

    const category = await service.saveCategory({ name: "Sides" });
    const categoryId = category.status === "saved" ? category.category.id : "";
    await service.saveItem(menuItemInput(categoryId, "Fries"));
    await service.saveItem(menuItemInput(categoryId, "Salad"));

    const before = store.snapshotUnrelated();

    // Preview mutates nothing.
    const preview = await service.previewCategoryDeletion({ categoryId });
    expect(preview.status === "preview" && preview.itemCount).toBe(2);
    expect(store.tenantItemCount()).toBe(2);
    expect(store.tenantCategoryCount()).toBe(1);

    const confirmed = await service.confirmCategoryDeletion({ categoryId });
    expect(confirmed.status).toBe("deleted");
    expect(confirmed.status === "deleted" && confirmed.deletedItemCount).toBe(2);
    // Category and every item gone atomically; booking state untouched.
    expect(store.tenantItemCount()).toBe(0);
    expect(store.tenantCategoryCount()).toBe(0);
    expect(store.snapshotUnrelated()).toBe(before);
  });

  it("leaves all rows intact when a cascade targets a foreign category id", async () => {
    const store = createMenuStore();
    const service = createRestaurantMenuService({ resolveContext: async () => contextFor(), ...store.deps });
    const category = await service.saveCategory({ name: "Mains" });
    const categoryId = category.status === "saved" ? category.category.id : "";
    await service.saveItem(menuItemInput(categoryId, "Steak"));

    const confirmed = await service.confirmCategoryDeletion({ categoryId: "ghost" });
    expect(confirmed.status).toBe("not_found");
    expect(store.tenantCategoryCount()).toBe(1);
    expect(store.tenantItemCount()).toBe(1);
  });
});

// ===========================================================================
// SubUser lifecycle: failures leave stored users byte-unchanged
// (Req 8.4-8.14, 11.1, 11.2)
// ===========================================================================

function createUserStore(seed: StoredSubUser[] = []) {
  const users: StoredSubUser[] = seed.map((u) => ({ ...u }));
  let idCounter = 0;

  const roleCounts = (): UserRoleCounts => ({
    doctor: users.filter((u) => u.role === "doctor").length,
    reception: users.filter((u) => u.role === "reception").length,
  });

  return {
    snapshot(): StoredSubUser[] {
      return users.map((u) => ({ ...u })).sort((a, b) => a.id.localeCompare(b.id));
    },
    hashOf(id: string): string | null {
      const u = users.find((x) => x.id === id) as (StoredSubUser & { passwordHash?: string }) | undefined;
      return u?.passwordHash ?? null;
    },
    deps: {
      listSubUsers: async (): Promise<StoredSubUser[]> => users.map((u) => ({ ...u })),
      getSubUserRoleCounts: async (): Promise<UserRoleCounts> => roleCounts(),
      checkEmailUnique: async (_tenantId: string, email: string, excludeId?: string): Promise<boolean> =>
        !users.some((u) => u.email.toLowerCase() === email.toLowerCase() && u.id !== excludeId),
      getSubUserById: async (_tenantId: string, id: string): Promise<StoredSubUser | null> =>
        users.find((u) => u.id === id) ?? null,
      createSubUser: async (_tenantId: string, input: CreateSubUserInput): Promise<CreateSubUserResult> => {
        if (users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
          return { status: "duplicate" };
        }
        const id = `sub-${idCounter++}`;
        users.push({
          id,
          tenantId: TENANT_A,
          name: input.name,
          email: input.email,
          phone: input.phone,
          role: input.role,
          isActive: input.isActive,
          profilePhoto: null,
          // Retain the hash so omission-preservation can be asserted.
          ...( { passwordHash: input.passwordHash } as object ),
        } as StoredSubUser);
        return { status: "created", id };
      },
      updateSubUser: async (
        _tenantId: string,
        id: string,
        input: UpdateSubUserInput,
      ): Promise<UpdateSubUserResult> => {
        const existing = users.find((u) => u.id === id) as (StoredSubUser & { passwordHash?: string }) | undefined;
        if (!existing) return { status: "not_found" };
        if (users.some((u) => u.id !== id && u.email.toLowerCase() === input.email.toLowerCase())) {
          return { status: "duplicate" };
        }
        existing.name = input.name;
        existing.email = input.email;
        existing.phone = input.phone;
        existing.role = input.role;
        existing.isActive = input.isActive;
        // Omitted password hash retains the stored value.
        if (input.passwordHash !== undefined) existing.passwordHash = input.passwordHash;
        return { status: "updated" };
      },
      setSubUserActive: async (
        _tenantId: string,
        id: string,
        isActive: boolean,
      ): Promise<SubUserLifecycleResult> => {
        const existing = users.find((u) => u.id === id);
        if (!existing) return { status: "not_found" };
        existing.isActive = isActive;
        return { status: "updated" };
      },
      deleteSubUser: async (_tenantId: string, id: string): Promise<DeleteSubUserResult> => {
        const idx = users.findIndex((u) => u.id === id);
        if (idx === -1) return { status: "not_found" };
        users.splice(idx, 1);
        return { status: "deleted" };
      },
      hashPassword: async (password: string): Promise<string> => `pwd:${password}`,
    },
  };
}

function seededSubUser(overrides: Partial<StoredSubUser> = {}): StoredSubUser {
  return {
    id: "sub-existing",
    tenantId: TENANT_A,
    name: "Sam Vale",
    email: "sam@example.com",
    phone: "555-0200",
    role: "doctor",
    isActive: true,
    profilePhoto: null,
    ...( { passwordHash: "pwd:original" } as object ),
    ...overrides,
  } as StoredSubUser;
}

describe("SubUser lifecycle persistence (Req 8.4-8.14, 11.1, 11.2)", () => {
  beforeEach(() => {
    // Default: an active owner on the Premium plan (users: operate).
    mockAuth.session = ownerSession();
  });

  it("persists a valid create and reads it back, then deletes exactly that row", async () => {
    const store = createUserStore();
    const service = createRestaurantUserService({ ...store.deps });

    const created = await service.create({
      name: "Ada Lin",
      email: "ada@example.com",
      phone: "555-0300",
      role: "doctor",
      password: "supersecret",
      confirmation: "supersecret",
    });
    expect(created.status).toBe("created");
    const id = created.status === "created" ? created.id : "";
    expect(store.snapshot()).toHaveLength(1);
    expect(store.hashOf(id)).toBe("pwd:supersecret");

    const deleted = await service.delete({ id });
    expect(deleted.status).toBe("deleted");
    expect(store.snapshot()).toHaveLength(0);
  });

  it("rolls back on a duplicate email, leaving users byte-unchanged", async () => {
    const store = createUserStore([seededSubUser()]);
    const before = store.snapshot();
    const service = createRestaurantUserService({ ...store.deps });

    const result = await service.create({
      name: "Clone",
      email: "SAM@example.com", // case-insensitive collision
      phone: "",
      role: "doctor",
      password: "supersecret",
      confirmation: "supersecret",
    });
    expect(result.status).toBe("email_taken");
    expect(result.status === "email_taken" && result.message).toBe(MSG_SUB_USER_EMAIL_IN_USE);
    expect(store.snapshot()).toEqual(before);
  });

  it("rolls back on a validation failure, leaving users byte-unchanged", async () => {
    const store = createUserStore([seededSubUser()]);
    const before = store.snapshot();
    const service = createRestaurantUserService({ ...store.deps });

    const result = await service.create({
      name: "",
      email: "not-an-email",
      phone: "",
      role: "doctor",
      password: "short",
      confirmation: "mismatch",
    });
    expect(result.status).toBe("validation_failed");
    expect(store.snapshot()).toEqual(before);
  });

  it("rolls back on a plan role-limit refusal, leaving users byte-unchanged", async () => {
    // Basic plan permits zero reception accounts.
    mockAuth.session = ownerSession("Basic");
    const store = createUserStore();
    const service = createRestaurantUserService({ ...store.deps });

    const result = await service.create({
      name: "Front Desk",
      email: "desk@example.com",
      phone: "",
      role: "reception",
      password: "supersecret",
      confirmation: "supersecret",
    });
    expect(result.status).toBe("role_limit_exceeded");
    expect(store.snapshot()).toHaveLength(0);
  });

  it("preserves the stored password hash when an edit omits the password", async () => {
    const store = createUserStore([seededSubUser()]);
    const service = createRestaurantUserService({ ...store.deps });

    const result = await service.update({
      id: "sub-existing",
      name: "Sam Vale II",
      email: "sam@example.com",
      phone: "555-0201",
      role: "doctor",
    });
    expect(result.status).toBe("updated");
    // Non-submitted password is not overwritten.
    expect(store.hashOf("sub-existing")).toBe("pwd:original");
    expect(store.snapshot()[0].name).toBe("Sam Vale II");
  });

  it("replaces the stored hash only when a valid new password is submitted", async () => {
    const store = createUserStore([seededSubUser()]);
    const service = createRestaurantUserService({ ...store.deps });

    const result = await service.update({
      id: "sub-existing",
      name: "Sam Vale",
      email: "sam@example.com",
      phone: "555-0200",
      role: "doctor",
      password: "brand-new-pass",
      confirmation: "brand-new-pass",
    });
    expect(result.status).toBe("updated");
    expect(store.hashOf("sub-existing")).toBe("pwd:brand-new-pass");
  });

  it("maps update/delete of a missing user to not found without mutation", async () => {
    const store = createUserStore([seededSubUser()]);
    const before = store.snapshot();
    const service = createRestaurantUserService({ ...store.deps });

    expect(
      (
        await service.update({
          id: "ghost",
          name: "Ghost",
          email: "ghost@example.com",
          phone: "",
          role: "doctor",
        })
      ).status,
    ).toBe("not_found");
    expect((await service.delete({ id: "ghost" })).status).toBe("not_found");
    expect(store.snapshot()).toEqual(before);
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
