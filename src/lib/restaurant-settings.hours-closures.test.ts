import { describe, expect, it, vi } from "vitest";

import { resolveFeatureAccess, type AccountContext, type ResolvedAccess } from "./feature-access";
import {
  MSG_CLOSURE_ALREADY_EXISTS,
  MSG_NOT_AUTHORISED_CONFIG,
  MSG_SETTINGS_RESOURCE_NOT_FOUND,
  type ClosureDay,
  type DayHours,
} from "./restaurant-settings-model";
import {
  MSG_CLOSURE_MONTH_INVALID,
  MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
  closureMonthRange,
  createRestaurantClosureService,
  createRestaurantOperatingHoursService,
  type AuthenticatedRestaurantSettingsContext,
} from "./restaurant-settings";
import type {
  CreateClosureDayResult,
  DeleteScopedRecordResult,
  StoredRestaurantHours,
} from "./restaurant-settings.server";

const NOW = new Date("2026-04-01T00:00:00.000Z");
const TENANT = "tenant-a";

type ConfigPermission = "operate" | "view_only" | "none";

function contextFor(
  configPermission: ConfigPermission = "operate",
  scopeLocationId: string | null = null,
): AuthenticatedRestaurantSettingsContext {
  const role = configPermission === "operate" ? "admin" : "reception";
  const accountContext: AccountContext = {
    role,
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    isActive: true,
    now: NOW,
  };
  const base = resolveFeatureAccess(accountContext);
  const access: ResolvedAccess = {
    ...base,
    restaurant_config:
      configPermission === "none"
        ? { available: false, permission: "none", visible: false }
        : {
            available: true,
            permission: configPermission,
            visible: true,
          },
  };
  return {
    session: {
      id: "owner-a",
      tenantId: TENANT,
      role,
      subscriptionPlan: "Premium",
    },
    accountId: "owner-a",
    tenantId: TENANT,
    role,
    featureContext: accountContext,
    access,
    scope: { tenantId: TENANT, locationId: scopeLocationId },
  };
}

function storedHours(
  dayOfWeek: number,
  overrides: Partial<StoredRestaurantHours> = {},
): StoredRestaurantHours {
  return {
    id: `hours-${dayOfWeek}`,
    tenantId: TENANT,
    dayOfWeek,
    openTime: "09:00",
    closeTime: "17:00",
    isClosed: false,
    ...overrides,
  };
}

function sevenValidDays(): DayHours[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    openTime: "09:00",
    closeTime: "22:00",
    isClosed: false,
  }));
}

// ---------------------------------------------------------------------------
// Operating hours
// ---------------------------------------------------------------------------

describe("restaurant operating-hours service", () => {
  it("requires restaurant_config visibility to read", async () => {
    const getTenantHours = vi.fn(async () => [] as StoredRestaurantHours[]);
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor("none"),
      getTenantHours,
    });

    await expect(service.read({})).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
    expect(getTenantHours).not.toHaveBeenCalled();
  });

  it("returns exactly seven weekdays, filling missing days as closed", async () => {
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor("operate"),
      getTenantHours: async () => [
        storedHours(1, { openTime: "08:30", closeTime: "18:45", isClosed: false }),
        storedHours(5, { isClosed: true }),
      ],
    });

    const view = await service.read({});

    expect(view.days).toHaveLength(7);
    expect(view.days.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(view.days[1]).toEqual({
      dayOfWeek: 1,
      openTime: "08:30",
      closeTime: "18:45",
      isClosed: false,
    });
    // A weekday with no stored row is reported closed.
    expect(view.days[0]).toEqual({
      dayOfWeek: 0,
      openTime: "00:00",
      closeTime: "00:00",
      isClosed: true,
    });
    expect(view.canSave).toBe(true);
    expect(view.readOnly).toBe(false);
  });

  it("reports read-only for a view_only account", async () => {
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor("view_only"),
      getTenantHours: async () => [],
    });

    const view = await service.read({});
    expect(view.canSave).toBe(false);
    expect(view.readOnly).toBe(true);
  });

  it("atomically saves a fully valid seven-day submission for an operate account", async () => {
    const replaceTenantHours = vi.fn(async () => {});
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor("operate"),
      getTenantHours: async () => [],
      replaceTenantHours,
    });

    const result = await service.save({ days: sevenValidDays() });

    expect(result.status).toBe("saved");
    expect(replaceTenantHours).toHaveBeenCalledOnce();
    expect(replaceTenantHours).toHaveBeenCalledWith(TENANT, sevenValidDays());
  });

  it("rejects an invalid submission naming each bad weekday and writes nothing", async () => {
    const replaceTenantHours = vi.fn(async () => {});
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor("operate"),
      getTenantHours: async () => [],
      replaceTenantHours,
    });

    // Monday (1) open with close <= open, Wednesday (3) missing entirely.
    const days = sevenValidDays().filter((d) => d.dayOfWeek !== 3);
    days[1] = { dayOfWeek: 1, openTime: "20:00", closeTime: "09:00", isClosed: false };

    const result = await service.save({ days });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      const fields = result.errors.map((e) => e.field);
      // Both the bad open day and the missing day are reported.
      expect(fields).toContain("hours.1");
      expect(fields).toContain("hours.3");
    }
    expect(replaceTenantHours).not.toHaveBeenCalled();
  });

  it("refuses a save from a view_only account before any write", async () => {
    const replaceTenantHours = vi.fn(async () => {});
    const service = createRestaurantOperatingHoursService({
      resolveContext: async () => contextFor("view_only"),
      getTenantHours: async () => [],
      replaceTenantHours,
    });

    await expect(service.save({ days: sevenValidDays() })).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    expect(replaceTenantHours).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// closureMonthRange
// ---------------------------------------------------------------------------

describe("closureMonthRange", () => {
  it("derives an inclusive month start and exclusive next-month start", () => {
    expect(closureMonthRange(2026, 4)).toEqual({
      monthStart: "2026-04-01",
      nextMonthStart: "2026-05-01",
    });
  });

  it("wraps December to the next January", () => {
    expect(closureMonthRange(2026, 12)).toEqual({
      monthStart: "2026-12-01",
      nextMonthStart: "2027-01-01",
    });
  });

  it("returns null for out-of-range or non-integer inputs", () => {
    expect(closureMonthRange(2026, 0)).toBeNull();
    expect(closureMonthRange(2026, 13)).toBeNull();
    expect(closureMonthRange(0, 5)).toBeNull();
    expect(closureMonthRange(2026.5, 5)).toBeNull();
    expect(closureMonthRange(2026, "4" as unknown)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Closure days
// ---------------------------------------------------------------------------

function closureRow(overrides: Partial<ClosureDay> = {}): ClosureDay {
  return {
    id: "closure-1",
    date: "2026-04-15",
    scope: { type: "restaurant" },
    reason: "Public holiday",
    isHoliday: true,
    affectedBookingCount: 3,
    locationId: null,
    ...overrides,
  };
}

describe("restaurant closure service", () => {
  it("requires config visibility and passes the derived month range and scope to the read", async () => {
    const listClosureDays = vi.fn(async () => [closureRow()]);
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("view_only"),
      listClosureDays,
    });

    const view = await service.list({
      year: 2026,
      month: 4,
      scope: { type: "table", tableId: "table-9" },
    });

    expect(view.closures).toHaveLength(1);
    expect(view.monthStart).toBe("2026-04-01");
    expect(view.nextMonthStart).toBe("2026-05-01");
    expect(view.canManage).toBe(false);
    expect(listClosureDays).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: null },
      "2026-04-01",
      "2026-05-01",
      { type: "table", tableId: "table-9" },
    );
  });

  it("rejects a read when config is not visible", async () => {
    const listClosureDays = vi.fn(async () => []);
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("none"),
      listClosureDays,
    });

    await expect(service.list({ year: 2026, month: 4 })).rejects.toThrow(
      MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
    );
    expect(listClosureDays).not.toHaveBeenCalled();
  });

  it("rejects an invalid month before any read", async () => {
    const listClosureDays = vi.fn(async () => []);
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("operate"),
      listClosureDays,
    });

    await expect(service.list({ year: 2026, month: 13 })).rejects.toThrow(
      MSG_CLOSURE_MONTH_INVALID,
    );
    expect(listClosureDays).not.toHaveBeenCalled();
  });

  it("creates a closure and returns it with its affected-booking count", async () => {
    const created = closureRow({ id: "new-1", affectedBookingCount: 5 });
    const createClosureDay = vi.fn(
      async (): Promise<CreateClosureDayResult> => ({ status: "created", id: "new-1" }),
    );
    const listClosureDays = vi.fn(async () => [created]);
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("operate"),
      createClosureDay,
      listClosureDays,
    });

    const result = await service.create({
      date: "2026-04-15",
      scope: { type: "restaurant" },
      reason: "Public holiday",
      isHoliday: true,
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.closure.id).toBe("new-1");
      expect(result.closure.affectedBookingCount).toBe(5);
    }
    expect(createClosureDay).toHaveBeenCalledOnce();
  });

  it("maps a duplicate to the already-blocked message and writes nothing more", async () => {
    const createClosureDay = vi.fn(
      async (): Promise<CreateClosureDayResult> => ({ status: "duplicate" }),
    );
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("operate"),
      createClosureDay,
    });

    const result = await service.create({
      date: "2026-04-15",
      scope: { type: "restaurant" },
      isHoliday: false,
    });

    expect(result).toEqual({ status: "duplicate", message: MSG_CLOSURE_ALREADY_EXISTS });
  });

  it("maps an absent table scope to the not-found message", async () => {
    const createClosureDay = vi.fn(
      async (): Promise<CreateClosureDayResult> => ({ status: "table_not_found" }),
    );
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("operate"),
      createClosureDay,
    });

    const result = await service.create({
      date: "2026-04-15",
      scope: { type: "table", tableId: "ghost" },
      isHoliday: false,
    });

    expect(result).toEqual({ status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND });
  });

  it("rejects a malformed submission with field errors and never reaches the store", async () => {
    const createClosureDay = vi.fn(
      async (): Promise<CreateClosureDayResult> => ({ status: "created", id: "x" }),
    );
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("operate"),
      createClosureDay,
    });

    const result = await service.create({
      date: "2026-02-30", // not an existing calendar date
      scope: { type: "restaurant" },
      isHoliday: false,
    });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.some((e) => e.field === "date")).toBe(true);
    }
    expect(createClosureDay).not.toHaveBeenCalled();
  });

  it("refuses a create from a view_only account before any write", async () => {
    const createClosureDay = vi.fn(
      async (): Promise<CreateClosureDayResult> => ({ status: "created", id: "x" }),
    );
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("view_only"),
      createClosureDay,
    });

    await expect(
      service.create({ date: "2026-04-15", scope: { type: "restaurant" }, isHoliday: false }),
    ).rejects.toThrow(MSG_NOT_AUTHORISED_CONFIG);
    expect(createClosureDay).not.toHaveBeenCalled();
  });

  it("deletes exactly the addressed closure under the resolved scope", async () => {
    const deleteClosureDay = vi.fn(
      async (): Promise<DeleteScopedRecordResult> => ({ status: "deleted" }),
    );
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("operate", "branch-1"),
      deleteClosureDay,
    });

    const result = await service.remove({ closureId: "closure-1" });

    expect(result).toEqual({ status: "deleted" });
    expect(deleteClosureDay).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: "branch-1" },
      "closure-1",
    );
  });

  it("maps a delete miss to the not-found message", async () => {
    const deleteClosureDay = vi.fn(
      async (): Promise<DeleteScopedRecordResult> => ({ status: "not_found" }),
    );
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("operate"),
      deleteClosureDay,
    });

    const result = await service.remove({ closureId: "ghost" });
    expect(result).toEqual({ status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND });
  });

  it("refuses a delete from a view_only account before any write", async () => {
    const deleteClosureDay = vi.fn(
      async (): Promise<DeleteScopedRecordResult> => ({ status: "deleted" }),
    );
    const service = createRestaurantClosureService({
      resolveContext: async () => contextFor("view_only"),
      deleteClosureDay,
    });

    await expect(service.remove({ closureId: "closure-1" })).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    expect(deleteClosureDay).not.toHaveBeenCalled();
  });
});
