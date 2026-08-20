import { describe, expect, it, vi } from "vitest";

import { resolveFeatureAccess, type AccountContext, type ResolvedAccess } from "./feature-access";
import {
  EFFECTIVE_MAIN_AREA_ID,
  MSG_AREA_ALREADY_EXISTS,
  MSG_NOT_AUTHORISED_CONFIG,
  MSG_SETTINGS_RESOURCE_NOT_FOUND,
  type DiningArea,
} from "./restaurant-settings-model";
import { MSG_DUPLICATE_TABLE_NAME } from "./restaurant-availability";
import {
  MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
  MSG_TABLE_AREA_NOT_IN_REGISTRY,
  createRestaurantDiningAreaService,
  createRestaurantTableService,
  diningAreaAssignedTablesMessage,
  type AuthenticatedRestaurantSettingsContext,
} from "./restaurant-settings";
import type {
  CreateDiningAreaResult,
  DeleteDiningAreaResult,
  DeleteScopedRestaurantTableResult,
  SaveScopedRestaurantTableResult,
  StoredRestaurantTable,
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
        : { available: true, permission: configPermission, visible: true },
  };
  return {
    session: { id: "owner-a", tenantId: TENANT, role, subscriptionPlan: "Premium" },
    accountId: "owner-a",
    tenantId: TENANT,
    role,
    featureContext: accountContext,
    access,
    scope: { tenantId: TENANT, locationId: scopeLocationId },
  };
}

function area(overrides: Partial<DiningArea> = {}): DiningArea {
  return {
    id: "area-1",
    name: "Terrace",
    displayOrder: 2,
    tableCount: 0,
    locationId: null,
    ...overrides,
  };
}

function storedTable(overrides: Partial<StoredRestaurantTable> = {}): StoredRestaurantTable {
  return {
    id: "table-1",
    tenantId: TENANT,
    locationId: null,
    name: "T1",
    seatCapacity: 4,
    area: "Terrace",
    areaId: "area-1",
    displayOrder: 1,
    state: "active",
    closureCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Dining areas
// ---------------------------------------------------------------------------

describe("restaurant dining-area service", () => {
  it("requires config visibility to read", async () => {
    const listDiningAreas = vi.fn(async () => [] as DiningArea[]);
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("none"),
      listDiningAreas,
    });

    await expect(service.list({})).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
    expect(listDiningAreas).not.toHaveBeenCalled();
  });

  it("returns ordered effective areas with a read-only flag for view_only", async () => {
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("view_only"),
      listDiningAreas: async () => [
        area({ id: "b", name: "Bar", displayOrder: 2 }),
        area({ id: "a", name: "Atrium", displayOrder: 1 }),
      ],
    });

    const view = await service.list({});
    expect(view.areas.map((a) => a.id)).toEqual(["a", "b"]);
    expect(view.canManage).toBe(false);
    expect(view.readOnly).toBe(true);
  });

  it("passes through the synthetic Main fallback when no areas are stored", async () => {
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [
        area({ id: EFFECTIVE_MAIN_AREA_ID, name: "Main", displayOrder: 1, tableCount: 3 }),
      ],
    });

    const view = await service.list({});
    expect(view.areas).toHaveLength(1);
    expect(view.areas[0].id).toBe(EFFECTIVE_MAIN_AREA_ID);
    expect(view.areas[0].tableCount).toBe(3);
    expect(view.canManage).toBe(true);
  });

  it("creates an area with a defaulted display order past the highest stored", async () => {
    const createDiningArea = vi.fn(
      async (): Promise<CreateDiningAreaResult> => ({
        status: "created",
        area: area({ id: "new", name: "Patio", displayOrder: 3, tableCount: 0 }),
      }),
    );
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [area({ id: "a", name: "Atrium", displayOrder: 2 })],
      createDiningArea,
    });

    const result = await service.create({ name: "  Patio  " });

    expect(result.status).toBe("created");
    expect(createDiningArea).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: null },
      { name: "Patio", displayOrder: 3 },
    );
  });

  it("allows creating a real Main while only the synthetic Main exists", async () => {
    const createDiningArea = vi.fn(
      async (): Promise<CreateDiningAreaResult> => ({
        status: "created",
        area: area({ id: "new", name: "Main", displayOrder: 1 }),
      }),
    );
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [
        area({ id: EFFECTIVE_MAIN_AREA_ID, name: "Main", displayOrder: 1 }),
      ],
      createDiningArea,
    });

    const result = await service.create({ name: "Main" });
    expect(result.status).toBe("created");
    expect(createDiningArea).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: null },
      { name: "Main", displayOrder: 1 },
    );
  });

  it("rejects a blank name with field errors and never writes", async () => {
    const createDiningArea = vi.fn(
      async (): Promise<CreateDiningAreaResult> => ({ status: "created", area: area() }),
    );
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [],
      createDiningArea,
    });

    const result = await service.create({ name: "   " });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.some((e) => e.field === "name")).toBe(true);
    }
    expect(createDiningArea).not.toHaveBeenCalled();
  });

  it("maps a stored duplicate to the already-exists message", async () => {
    const createDiningArea = vi.fn(
      async (): Promise<CreateDiningAreaResult> => ({ status: "duplicate" }),
    );
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [area({ id: "a", name: "Terrace", displayOrder: 1 })],
      createDiningArea,
    });

    const result = await service.create({ name: "Balcony" });
    expect(result).toEqual({ status: "duplicate", message: MSG_AREA_ALREADY_EXISTS });
  });

  it("refuses a create from a view_only account before any write", async () => {
    const createDiningArea = vi.fn(
      async (): Promise<CreateDiningAreaResult> => ({ status: "created", area: area() }),
    );
    const listDiningAreas = vi.fn(async () => [] as DiningArea[]);
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("view_only"),
      listDiningAreas,
      createDiningArea,
    });

    await expect(service.create({ name: "Patio" })).rejects.toThrow(MSG_NOT_AUTHORISED_CONFIG);
    expect(createDiningArea).not.toHaveBeenCalled();
    expect(listDiningAreas).not.toHaveBeenCalled();
  });

  it("refuses deletion of an area with assigned tables and names the count", async () => {
    const deleteDiningArea = vi.fn(
      async (): Promise<DeleteDiningAreaResult> => ({
        status: "assigned_tables",
        assignedTableCount: 2,
      }),
    );
    const service = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("operate"),
      deleteDiningArea,
    });

    const result = await service.remove({ areaId: "area-1" });
    expect(result).toEqual({
      status: "assigned_tables",
      message: diningAreaAssignedTablesMessage(2),
      assignedTableCount: 2,
    });
  });

  it("deletes an empty area and maps a miss to not found", async () => {
    const deletedService = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("operate", "branch-1"),
      deleteDiningArea: async () => ({ status: "deleted" }),
    });
    await expect(deletedService.remove({ areaId: "area-1" })).resolves.toEqual({
      status: "deleted",
    });

    const missService = createRestaurantDiningAreaService({
      resolveContext: async () => contextFor("operate"),
      deleteDiningArea: async () => ({ status: "not_found" }),
    });
    await expect(missService.remove({ areaId: "ghost" })).resolves.toEqual({
      status: "not_found",
      message: MSG_SETTINGS_RESOURCE_NOT_FOUND,
    });
  });
});

// ---------------------------------------------------------------------------
// Registry-backed tables
// ---------------------------------------------------------------------------

describe("restaurant table service", () => {
  it("requires config visibility to read", async () => {
    const listRestaurantTables = vi.fn(async () => [] as StoredRestaurantTable[]);
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("none"),
      listDiningAreas: async () => [],
      listRestaurantTables,
    });

    await expect(service.list({})).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
    expect(listRestaurantTables).not.toHaveBeenCalled();
  });

  it("returns scoped tables with closure counts and ordered selectable areas", async () => {
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("view_only"),
      listDiningAreas: async () => [
        area({ id: "b", name: "Bar", displayOrder: 2 }),
        area({ id: "a", name: "Atrium", displayOrder: 1 }),
      ],
      listRestaurantTables: async () => [storedTable({ closureCount: 4 })],
    });

    const view = await service.list({});
    expect(view.tables[0].closureCount).toBe(4);
    expect(view.selectableAreas.map((a) => a.id)).toEqual(["a", "b"]);
    expect(view.canManage).toBe(false);
    expect(view.readOnly).toBe(true);
  });

  it("creates a table synchronizing the chosen registry area id", async () => {
    const createRestaurantTable = vi.fn(
      async (): Promise<SaveScopedRestaurantTableResult> => ({
        status: "saved",
        table: storedTable({ id: "new", name: "T9", areaId: "area-1", area: "Terrace" }),
      }),
    );
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [area({ id: "area-1", name: "Terrace", displayOrder: 1 })],
      listRestaurantTables: async () => [],
      createRestaurantTable,
    });

    const result = await service.save({
      name: "T9",
      seatCapacity: 4,
      areaId: "area-1",
      displayOrder: 5,
    });

    expect(result.status).toBe("saved");
    expect(createRestaurantTable).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: null },
      { name: "T9", seatCapacity: 4, areaId: "area-1", displayOrder: 5, state: "active" },
    );
  });

  it("rejects an area id that is not a stored dining area", async () => {
    const createRestaurantTable = vi.fn(
      async (): Promise<SaveScopedRestaurantTableResult> => ({
        status: "saved",
        table: storedTable(),
      }),
    );
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [area({ id: "area-1", name: "Terrace", displayOrder: 1 })],
      listRestaurantTables: async () => [],
      createRestaurantTable,
    });

    const result = await service.save({
      name: "T9",
      seatCapacity: 4,
      areaId: "does-not-exist",
    });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors).toContainEqual({
        field: "areaId",
        message: MSG_TABLE_AREA_NOT_IN_REGISTRY,
      });
    }
    expect(createRestaurantTable).not.toHaveBeenCalled();
  });

  it("collects field-bound errors and never reaches the store", async () => {
    const createRestaurantTable = vi.fn(
      async (): Promise<SaveScopedRestaurantTableResult> => ({
        status: "saved",
        table: storedTable(),
      }),
    );
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [area({ id: "area-1", name: "Terrace", displayOrder: 1 })],
      listRestaurantTables: async () => [],
      createRestaurantTable,
    });

    const result = await service.save({ name: "", seatCapacity: 0, areaId: "area-1" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("name");
      expect(fields).toContain("seatCapacity");
    }
    expect(createRestaurantTable).not.toHaveBeenCalled();
  });

  it("maps a duplicate table name to the stable message", async () => {
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [area({ id: "area-1", name: "Terrace", displayOrder: 1 })],
      listRestaurantTables: async () => [],
      createRestaurantTable: async () => ({ status: "duplicate" }),
    });

    const result = await service.save({ name: "T1", seatCapacity: 4, areaId: "area-1" });
    expect(result).toEqual({ status: "duplicate", message: MSG_DUPLICATE_TABLE_NAME });
  });

  it("edits an existing table through the update path", async () => {
    const updateRestaurantTable = vi.fn(
      async (): Promise<SaveScopedRestaurantTableResult> => ({
        status: "saved",
        table: storedTable({ id: "table-1", name: "Renamed" }),
      }),
    );
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [area({ id: "area-1", name: "Terrace", displayOrder: 1 })],
      listRestaurantTables: async () => [storedTable({ id: "table-1", name: "T1" })],
      updateRestaurantTable,
    });

    const result = await service.save({
      tableId: "table-1",
      name: "Renamed",
      seatCapacity: 6,
      areaId: "area-1",
      displayOrder: 1,
    });

    expect(result.status).toBe("saved");
    expect(updateRestaurantTable).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: null },
      "table-1",
      { name: "Renamed", seatCapacity: 6, areaId: "area-1", displayOrder: 1, state: "active" },
    );
  });

  it("maps an update miss to not found", async () => {
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("operate"),
      listDiningAreas: async () => [area({ id: "area-1", name: "Terrace", displayOrder: 1 })],
      listRestaurantTables: async () => [],
      updateRestaurantTable: async () => ({ status: "not_found" }),
    });

    const result = await service.save({
      tableId: "ghost",
      name: "T1",
      seatCapacity: 4,
      areaId: "area-1",
      displayOrder: 1,
    });
    expect(result).toEqual({ status: "not_found", message: MSG_SETTINGS_RESOURCE_NOT_FOUND });
  });

  it("refuses a save from a view_only account before any write", async () => {
    const createRestaurantTable = vi.fn(
      async (): Promise<SaveScopedRestaurantTableResult> => ({
        status: "saved",
        table: storedTable(),
      }),
    );
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("view_only"),
      listDiningAreas: async () => [],
      listRestaurantTables: async () => [],
      createRestaurantTable,
    });

    await expect(service.save({ name: "T9", seatCapacity: 4, areaId: "area-1" })).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    expect(createRestaurantTable).not.toHaveBeenCalled();
  });

  it("deletes a table and reports the removed closure count", async () => {
    const deleteRestaurantTable = vi.fn(
      async (): Promise<DeleteScopedRestaurantTableResult> => ({
        status: "deleted",
        deletedClosureCount: 3,
      }),
    );
    const service = createRestaurantTableService({
      resolveContext: async () => contextFor("operate", "branch-1"),
      deleteRestaurantTable,
    });

    const result = await service.remove({ tableId: "table-1" });
    expect(result).toEqual({ status: "deleted", deletedClosureCount: 3 });
    expect(deleteRestaurantTable).toHaveBeenCalledWith(
      { tenantId: TENANT, locationId: "branch-1" },
      "table-1",
    );
  });

  it("maps a delete miss to not found and refuses view_only deletes", async () => {
    const missService = createRestaurantTableService({
      resolveContext: async () => contextFor("operate"),
      deleteRestaurantTable: async () => ({ status: "not_found" }),
    });
    await expect(missService.remove({ tableId: "ghost" })).resolves.toEqual({
      status: "not_found",
      message: MSG_SETTINGS_RESOURCE_NOT_FOUND,
    });

    const deleteRestaurantTable = vi.fn(
      async (): Promise<DeleteScopedRestaurantTableResult> => ({
        status: "deleted",
        deletedClosureCount: 0,
      }),
    );
    const refusedService = createRestaurantTableService({
      resolveContext: async () => contextFor("view_only"),
      deleteRestaurantTable,
    });
    await expect(refusedService.remove({ tableId: "table-1" })).rejects.toThrow(
      MSG_NOT_AUTHORISED_CONFIG,
    );
    expect(deleteRestaurantTable).not.toHaveBeenCalled();
  });
});
