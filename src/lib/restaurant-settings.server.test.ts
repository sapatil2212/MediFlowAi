import type { PoolConnection } from "mariadb";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  withTransaction: vi.fn(),
}));

import type { DayHours, RestaurantProfile } from "./restaurant-settings-model";
import {
  createRestaurantSettingsRepository,
  createWhatsAppSettingsAdapter,
  tenantLocationPredicate,
  type RestaurantSettingsRepositoryDatabase,
  type WhatsAppMicroserviceClient,
} from "./restaurant-settings.server";

function compact(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function fakeDatabase(
  options: {
    rows?: unknown[];
    row?: unknown | null;
    affectedRows?: number;
  } = {},
) {
  const query = vi.fn(async (_sql: string, _params: unknown[]) => options.rows ?? []);
  const queryOne = vi.fn(async (_sql: string, _params: unknown[]) => options.row ?? null);
  const execute = vi.fn(async (_sql: string, _params: unknown[]) => ({
    affectedRows: options.affectedRows ?? 1,
    insertId: undefined,
  }));
  const connectionQuery = vi.fn(
    async (_sql: string, _params: unknown[]): Promise<any> => ({
      affectedRows: options.affectedRows ?? 1,
    }),
  );
  const connection = { query: connectionQuery } as unknown as PoolConnection;
  const withTransaction = vi.fn(async (work: (value: PoolConnection) => Promise<unknown>) =>
    work(connection),
  );
  const database = {
    query,
    queryOne,
    execute,
    withTransaction,
  } as unknown as RestaurantSettingsRepositoryDatabase;
  return { database, query, queryOne, execute, withTransaction, connectionQuery };
}

beforeEach(() => {
  vi.clearAllMocks();
});
describe("restaurant settings repository scope shell", () => {
  it("builds a tenant-first MariaDB null-safe location predicate", () => {
    expect(tenantLocationPredicate({ tenantId: "tenant-a", locationId: null }, "resource")).toEqual(
      {
        sql: "resource.tenantId = ? AND resource.locationId <=> ?",
        params: ["tenant-a", null],
      },
    );

    expect(() =>
      tenantLocationPredicate(
        { tenantId: "tenant-a", locationId: "branch-a" },
        "resource; DROP TABLE User",
      ),
    ).toThrow("Invalid SQL alias");
  });

  it("maps a tenant profile without leaking nullable database values", async () => {
    const fake = fakeDatabase({
      row: {
        id: "profile-1",
        tenantId: "tenant-a",
        clinicName: "Restaurant A",
        clinicianName: "Owner A",
        phone: "100",
        practiceSize: "10",
        email: null,
        contactNo: "200",
        whatsappNo: "300",
        landlineNo: null,
        address: "Address",
        services: "Indian",
        shortDescription: "Description",
      },
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.getTenantProfile("tenant-a")).resolves.toMatchObject({
      id: "profile-1",
      tenantId: "tenant-a",
      restaurantName: "Restaurant A",
      ownerOrManagerName: "Owner A",
      publicEmail: "",
      landline: "",
      cuisineOrServices: "Indian",
    });
    expect(compact(fake.queryOne.mock.calls[0][0])).toContain(
      "FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
    );
    expect(fake.queryOne.mock.calls[0][1]).toEqual(["tenant-a"]);
  });

  it("uses tenant-first profile upsert parameters", async () => {
    const profile: RestaurantProfile = {
      restaurantName: "Restaurant A",
      ownerOrManagerName: "Owner A",
      accountPhone: "100",
      teamSize: "10",
      publicEmail: "public@example.test",
      contactNumber: "200",
      whatsappNumber: "300",
      landline: "400",
      address: "Address",
      cuisineOrServices: "Indian",
      description: "Description",
    };
    const fake = fakeDatabase({
      row: { id: "profile-1", tenantId: "tenant-a", clinicName: "Restaurant A" },
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await repository.saveTenantProfile("tenant-a", profile);

    const params = fake.execute.mock.calls[0][1];
    expect(params[1]).toBe("tenant-a");
    expect(params.slice(2)).toEqual(Object.values(profile));
  });

  it("atomically saves the profile and syncs owner compatibility fields in one transaction", async () => {
    const profile: RestaurantProfile = {
      restaurantName: "Restaurant A",
      ownerOrManagerName: "Owner A",
      accountPhone: "100",
      teamSize: "10",
      publicEmail: "public@example.test",
      contactNumber: "200",
      whatsappNumber: "300",
      landline: "400",
      address: "Address",
      cuisineOrServices: "Indian",
      description: "Description",
    };
    const storedRow = {
      id: "profile-1",
      tenantId: "tenant-a",
      clinicName: "Restaurant A",
      clinicianName: "Owner A",
      phone: "100",
      practiceSize: "10",
      email: "public@example.test",
      contactNo: "200",
      whatsappNo: "300",
      landlineNo: "400",
      address: "Address",
      services: "Indian",
      shortDescription: "Description",
    };
    // The profile SELECT after upsert returns rows; every other statement is a mutation.
    const connectionQuery = vi.fn(
      async (sql: string, _params?: unknown[]): Promise<any> =>
        /FROM ClinicProfile/.test(sql) ? [storedRow] : { affectedRows: 1 },
    );
    const connection = { query: connectionQuery } as unknown as PoolConnection;
    const withTransaction = vi.fn(async (work: (value: PoolConnection) => Promise<unknown>) =>
      work(connection),
    );
    const database = {
      query: vi.fn(),
      queryOne: vi.fn(),
      execute: vi.fn(),
      withTransaction,
    } as unknown as RestaurantSettingsRepositoryDatabase;
    const repository = createRestaurantSettingsRepository(database);

    const result = await repository.saveRestaurantProfile("tenant-a", profile);

    expect(result).toMatchObject({ restaurantName: "Restaurant A", ownerOrManagerName: "Owner A" });
    expect(withTransaction).toHaveBeenCalledOnce();

    const ownerCall = connectionQuery.mock.calls.find(([sql]) => /UPDATE User/.test(sql as string));
    expect(ownerCall).toBeDefined();
    expect(compact(ownerCall![0] as string)).toContain(
      "UPDATE User SET clinicName = ?, name = ?, phone = ?, practiceSize = ?",
    );
    expect(ownerCall![1]).toEqual(["Restaurant A", "Owner A", "100", "10", "tenant-a"]);
  });
});
describe("global operating-hours access", () => {
  it("maps ordered hour rows and coerces MariaDB flags", async () => {
    const fake = fakeDatabase({
      rows: [
        {
          id: "hours-0",
          tenantId: "tenant-a",
          dayOfWeek: "0",
          openTime: "09:00",
          closeTime: "22:00",
          isClosed: 0,
        },
        {
          id: "hours-1",
          tenantId: "tenant-a",
          dayOfWeek: 1,
          openTime: "00:00",
          closeTime: "00:00",
          isClosed: 1,
        },
      ],
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.getTenantHours("tenant-a")).resolves.toEqual([
      {
        id: "hours-0",
        tenantId: "tenant-a",
        dayOfWeek: 0,
        openTime: "09:00",
        closeTime: "22:00",
        isClosed: false,
      },
      {
        id: "hours-1",
        tenantId: "tenant-a",
        dayOfWeek: 1,
        openTime: "00:00",
        closeTime: "00:00",
        isClosed: true,
      },
    ]);
    expect(compact(fake.query.mock.calls[0][0])).toContain(
      "WHERE tenantId = ? ORDER BY dayOfWeek ASC",
    );
  });

  it("replaces all seven rows on the transaction connection", async () => {
    const days: DayHours[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      openTime: "09:00",
      closeTime: "22:00",
      isClosed: dayOfWeek === 0,
    }));
    const fake = fakeDatabase();
    const repository = createRestaurantSettingsRepository(fake.database);

    await repository.replaceTenantHours("tenant-a", days);

    expect(fake.withTransaction).toHaveBeenCalledOnce();
    expect(fake.connectionQuery).toHaveBeenCalledTimes(7);
    expect(fake.execute).not.toHaveBeenCalled();
    for (const call of fake.connectionQuery.mock.calls) {
      expect(compact(call[0])).toContain("INSERT INTO RestaurantHours");
      expect(call[1][1]).toBe("tenant-a");
    }
  });
});
describe("account-bound email verification access", () => {
  it("constrains verification identifiers by tenant, account type, and account id", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-01T00:05:00.000Z");
    const resendAt = new Date("2026-01-01T00:01:00.000Z");
    const fake = fakeDatabase({
      row: {
        id: "verification-1",
        tenantId: "tenant-a",
        accountType: "sub_user",
        accountId: "account-a",
        targetEmail: "next@example.test",
        codeHash: "hash",
        createdAt,
        expiresAt,
        resendAvailableAt: resendAt,
        consumedAt: null,
      },
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.getEmailVerificationById("tenant-a", "sub_user", "account-a", "verification-1"),
    ).resolves.toMatchObject({
      tenantId: "tenant-a",
      issuedAtMs: createdAt.getTime(),
      expiresAtMs: expiresAt.getTime(),
      resendAvailableAtMs: resendAt.getTime(),
      consumedAtMs: null,
    });

    const sql = compact(fake.queryOne.mock.calls[0][0]);
    expect(sql).toContain("INNER JOIN SubUser AS account");
    expect(sql).toContain("account.tenantId = ? AND account.id = ?");
    expect(sql).toContain("verification.id = ?");
    expect(fake.queryOne.mock.calls[0][1]).toEqual([
      "sub_user",
      "tenant-a",
      "account-a",
      "verification-1",
    ]);
  });

  it("atomically replaces an active row only for an account in the tenant", async () => {
    const fake = fakeDatabase();
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.saveEmailVerification("tenant-a", {
        id: "verification-1",
        accountType: "location",
        accountId: "branch-a",
        targetEmail: "next@example.test",
        codeHash: "hash",
        expiresAtMs: Date.UTC(2026, 0, 1, 0, 5),
        resendAvailableAtMs: Date.UTC(2026, 0, 1, 0, 1),
      }),
    ).resolves.toBe("verification-1");

    expect(fake.withTransaction).toHaveBeenCalledOnce();
    expect(fake.connectionQuery).toHaveBeenCalledTimes(2);
    const deleteSql = compact(fake.connectionQuery.mock.calls[0][0]);
    const insertSql = compact(fake.connectionQuery.mock.calls[1][0]);
    expect(deleteSql).toContain("INNER JOIN Location AS account");
    expect(deleteSql).toContain("account.tenantId = ? AND account.id = ?");
    expect(insertSql).toContain("FROM Location AS account");
    expect(insertSql).toContain("WHERE account.tenantId = ? AND account.id = ?");
    expect(fake.execute).not.toHaveBeenCalled();
  });

  it("rejects verification insertion when the account is outside the tenant", async () => {
    const fake = fakeDatabase({ affectedRows: 0 });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.saveEmailVerification("tenant-a", {
        id: "verification-1",
        accountType: "user",
        accountId: "foreign-owner",
        targetEmail: "next@example.test",
        codeHash: "hash",
        expiresAtMs: Date.UTC(2026, 0, 1, 0, 5),
        resendAvailableAtMs: Date.UTC(2026, 0, 1, 0, 1),
      }),
    ).rejects.toThrow("Restaurant setting not found");
    expect(fake.withTransaction).toHaveBeenCalledOnce();
    expect(fake.connectionQuery).toHaveBeenCalledTimes(2);
  });

  it("consumes exactly one tenant/account-constrained verification identifier", async () => {
    const fake = fakeDatabase();
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.consumeEmailVerification(
        "tenant-a",
        "user",
        "owner-a",
        "verification-a",
        Date.UTC(2026, 0, 1, 0, 2),
      ),
    ).resolves.toBe(true);

    const sql = compact(fake.execute.mock.calls[0][0]);
    expect(sql).toContain("INNER JOIN User AS account");
    expect(sql).toContain("account.tenantId = ? AND account.id = ?");
    expect(sql).toContain("verification.accountType = ? AND verification.id = ?");
    expect(fake.execute.mock.calls[0][1].slice(1)).toEqual([
      "tenant-a",
      "owner-a",
      "user",
      "verification-a",
    ]);
  });
});

describe("global WhatsApp alert configuration access", () => {
  it("maps nullable configuration values and constrains reads by tenant", async () => {
    const fake = fakeDatabase({
      row: {
        id: "wa-1",
        tenantId: "tenant-a",
        phoneNumber: null,
        isEnabled: "1",
      },
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.getWhatsAppConfig("tenant-a")).resolves.toEqual({
      id: "wa-1",
      tenantId: "tenant-a",
      phoneNumber: "",
      isEnabled: true,
    });
    expect(compact(fake.queryOne.mock.calls[0][0])).toContain(
      "FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1",
    );
    expect(fake.queryOne.mock.calls[0][1]).toEqual(["tenant-a"]);
  });

  it("upserts idempotent values tenant-first and returns the typed stored row", async () => {
    const fake = fakeDatabase({
      row: {
        id: "wa-1",
        tenantId: "tenant-a",
        phoneNumber: "+15550001",
        isEnabled: 0,
      },
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.saveWhatsAppConfig("tenant-a", {
        phoneNumber: "+15550001",
        isEnabled: false,
      }),
    ).resolves.toEqual({
      id: "wa-1",
      tenantId: "tenant-a",
      phoneNumber: "+15550001",
      isEnabled: false,
    });

    const params = fake.execute.mock.calls[0][1];
    expect(params[1]).toBe("tenant-a");
    expect(params.slice(2)).toEqual(["+15550001", 0]);
  });
});

describe("scoped closure repository operations", () => {
  const scope = { tenantId: "tenant-a", locationId: "branch-a" } as const;

  it("reads one scoped month and reports scope-specific booking counts", async () => {
    const fake = fakeDatabase({
      rows: [
        {
          id: "closure-1",
          locationId: "branch-a",
          closureDate: "2026-04-12",
          scopeType: "table",
          tableId: "table-a",
          reason: null,
          isHoliday: "1",
          affectedBookingCount: "3",
        },
      ],
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.listClosureDays(scope, "2026-04-01", "2026-05-01", {
        type: "table",
        tableId: "table-a",
      }),
    ).resolves.toEqual([
      {
        id: "closure-1",
        date: "2026-04-12",
        scope: { type: "table", tableId: "table-a" },
        reason: "",
        isHoliday: true,
        affectedBookingCount: 3,
        locationId: "branch-a",
      },
    ]);

    const sql = compact(fake.query.mock.calls[0][0]);
    expect(sql).toContain("closure.tenantId = ? AND closure.locationId <=> ?");
    expect(sql).toContain("closure.closureDate >= ? AND closure.closureDate < ?");
    expect(sql).toContain("closure.scopeType = 'table' AND closure.tableId = ?");
    expect(sql).toContain("booking.locationId <=> closure.locationId");
    expect(sql).toContain("booking.tableId = closure.tableId");
    expect(fake.query.mock.calls[0][1]).toEqual([
      "tenant-a",
      "branch-a",
      "2026-04-01",
      "2026-05-01",
      "table-a",
    ]);
  });

  it("validates a table in scope and makes duplicate closure creation harmless", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "table-a" }])
      .mockResolvedValueOnce({ affectedRows: 0 });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.createClosureDay(scope, {
        date: "2026-04-12",
        scope: { type: "table", tableId: "table-a" },
        reason: "Maintenance",
        isHoliday: false,
      }),
    ).resolves.toEqual({ status: "duplicate" });

    expect(fake.withTransaction).toHaveBeenCalledOnce();
    expect(compact(fake.connectionQuery.mock.calls[0][0])).toContain(
      "restaurantTable.tenantId = ? AND restaurantTable.locationId <=> ? AND restaurantTable.id = ?",
    );
    expect(compact(fake.connectionQuery.mock.calls[1][0])).toContain(
      "INSERT IGNORE INTO RestaurantClosureDay",
    );
    expect(fake.connectionQuery.mock.calls.flatMap((call) => call[0])).not.toContain(
      "UPDATE Appointment",
    );
  });

  it("deletes exactly one tenant/location-constrained closure identifier", async () => {
    const fake = fakeDatabase({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.deleteClosureDay(scope, "closure-a")).resolves.toEqual({
      status: "deleted",
    });
    expect(compact(fake.execute.mock.calls[0][0])).toBe(
      "DELETE FROM RestaurantClosureDay WHERE tenantId = ? AND locationId <=> ? AND id = ?",
    );
    expect(fake.execute.mock.calls[0][1]).toEqual(["tenant-a", "branch-a", "closure-a"]);
  });
});

describe("scoped dining-area repository operations", () => {
  const scope = { tenantId: "tenant-a", locationId: null } as const;

  it("returns the effective Main area with legacy assigned counts for an empty scope", async () => {
    const fake = fakeDatabase({ rows: [], row: { tableCount: "2" } });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.listDiningAreas(scope)).resolves.toEqual([
      {
        id: "__main__",
        name: "Main",
        displayOrder: 1,
        tableCount: 2,
        locationId: null,
      },
    ]);
    expect(compact(fake.query.mock.calls[0][0])).toContain(
      "ORDER BY area.displayOrder ASC, LOWER(area.name) ASC, area.id ASC",
    );
    expect(compact(fake.queryOne.mock.calls[0][0])).toContain(
      "tenantId = ? AND locationId <=> ? AND areaId IS NULL",
    );
  });

  it("defaults area display order from the tenant-wide maximum", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ maxOrder: "4" }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    const result = await repository.createDiningArea(scope, { name: "Terrace" });

    expect(result.status).toBe("created");
    expect(result.area).toMatchObject({ name: "Terrace", displayOrder: 5 });
    expect(compact(fake.connectionQuery.mock.calls[0][0])).toContain(
      "FROM RestaurantDiningArea WHERE tenantId = ?",
    );
    expect(fake.connectionQuery.mock.calls[1][1].slice(1)).toEqual([
      "tenant-a",
      null,
      "Terrace",
      5,
    ]);
  });

  it("refuses area deletion when scoped tables are assigned", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery.mockResolvedValueOnce([
      {
        id: "area-a",
        name: "Terrace",
        assignedTableCount: "2",
      },
    ]);
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.deleteDiningArea(scope, "area-a")).resolves.toEqual({
      status: "assigned_tables",
      assignedTableCount: 2,
    });
    expect(fake.connectionQuery).toHaveBeenCalledOnce();
    const sql = compact(fake.connectionQuery.mock.calls[0][0]);
    expect(sql).toContain("restaurantTable.locationId <=> area.locationId");
    expect(sql).toContain("restaurantTable.areaId = area.id");
    expect(sql).toContain("LOWER(TRIM(restaurantTable.area)) = LOWER(TRIM(area.name))");
  });
});

describe("registry-backed scoped table repository operations", () => {
  const scope = { tenantId: "tenant-a", locationId: "branch-a" } as const;
  const input = {
    name: "T1",
    seatCapacity: 4,
    areaId: "area-a",
    displayOrder: 2,
    state: "active" as const,
  };

  it("reads ordered tables with their table-closure counts", async () => {
    const fake = fakeDatabase({
      rows: [
        {
          id: "table-a",
          tenantId: "tenant-a",
          locationId: "branch-a",
          name: "T1",
          seatCapacity: "4",
          area: "Terrace",
          areaId: "area-a",
          displayOrder: "2",
          state: "active",
          closureCount: "6",
        },
      ],
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.listRestaurantTables(scope)).resolves.toEqual([
      {
        id: "table-a",
        tenantId: "tenant-a",
        locationId: "branch-a",
        name: "T1",
        seatCapacity: 4,
        area: "Terrace",
        areaId: "area-a",
        displayOrder: 2,
        state: "active",
        closureCount: 6,
      },
    ]);
    const sql = compact(fake.query.mock.calls[0][0]);
    expect(sql).toContain("restaurantTable.tenantId = ? AND restaurantTable.locationId <=> ?");
    expect(sql).toContain("closure.scopeType = 'table'");
    expect(sql).toContain("closure.tableId = restaurantTable.id");
  });

  it("synchronizes canonical area id and name when creating a table", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "area-a", name: "Terrace" }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    const result = await repository.createRestaurantTable(scope, input);

    expect(result.status).toBe("saved");
    if (result.status === "saved") {
      expect(result.table).toMatchObject({ areaId: "area-a", area: "Terrace" });
    }
    const insertSql = compact(fake.connectionQuery.mock.calls[1][0]);
    expect(insertSql).toContain("area, areaId, displayOrder");
    expect(fake.connectionQuery.mock.calls[1][1].slice(1)).toEqual([
      "tenant-a",
      "branch-a",
      "T1",
      4,
      "Terrace",
      "area-a",
      2,
      "active",
    ]);
  });

  it("deletes table closures and the table atomically without touching appointments", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "table-a" }])
      .mockResolvedValueOnce({ affectedRows: 3 })
      .mockResolvedValueOnce({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.deleteRestaurantTable(scope, "table-a")).resolves.toEqual({
      status: "deleted",
      deletedClosureCount: 3,
    });
    expect(fake.withTransaction).toHaveBeenCalledOnce();
    expect(fake.connectionQuery).toHaveBeenCalledTimes(3);
    expect(compact(fake.connectionQuery.mock.calls[1][0])).toContain(
      "DELETE FROM RestaurantClosureDay WHERE tenantId = ? AND locationId <=> ? AND scopeType = 'table' AND tableId = ?",
    );
    expect(compact(fake.connectionQuery.mock.calls[2][0])).toContain(
      "DELETE FROM RestaurantTable WHERE tenantId = ? AND locationId <=> ? AND id = ?",
    );
    const allSql = fake.connectionQuery.mock.calls.map((call) => compact(call[0])).join(" ");
    expect(allSql).not.toMatch(/(?:UPDATE|DELETE FROM) Appointment/);
  });
});

describe("scoped menu repository operations", () => {
  const scope = { tenantId: "tenant-a", locationId: "branch-a" } as const;

  it("reads a canonically ordered scoped category/item tree", async () => {
    const fake = fakeDatabase({
      rows: [
        {
          categoryId: "category-a",
          categoryLocationId: "branch-a",
          categoryName: "Drinks",
          categoryDisplayOrder: "1",
          itemId: "item-a",
          itemLocationId: "branch-a",
          itemCategoryId: "category-a",
          itemName: "Tea",
          itemPriceMinor: "250",
          itemDescription: null,
          itemDisplayOrder: "2",
          itemState: "unavailable",
        },
        {
          categoryId: "category-b",
          categoryLocationId: "branch-a",
          categoryName: "Mains",
          categoryDisplayOrder: "2",
          itemId: null,
        },
      ],
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.listMenu(scope)).resolves.toEqual([
      {
        id: "category-a",
        name: "Drinks",
        displayOrder: 1,
        locationId: "branch-a",
        items: [
          {
            id: "item-a",
            categoryId: "category-a",
            name: "Tea",
            priceMinor: 250,
            description: "",
            displayOrder: 2,
            state: "unavailable",
            locationId: "branch-a",
          },
        ],
      },
      {
        id: "category-b",
        name: "Mains",
        displayOrder: 2,
        locationId: "branch-a",
        items: [],
      },
    ]);

    const sql = compact(fake.query.mock.calls[0][0]);
    expect(sql).toContain("category.tenantId = ? AND category.locationId <=> ?");
    expect(sql).toContain("item.tenantId = category.tenantId");
    expect(sql).toContain("item.locationId <=> category.locationId");
    expect(sql).toContain(
      "ORDER BY category.displayOrder ASC, LOWER(category.name) ASC, category.id ASC, item.displayOrder ASC, LOWER(item.name) ASC, item.id ASC",
    );
    expect(fake.query.mock.calls[0][1]).toEqual(["tenant-a", "branch-a"]);
  });

  it("takes the shared tenant lock before rejecting a concurrent-safe category cap", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "owner-a" }])
      .mockResolvedValueOnce([{ total: "40" }]);
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.createMenuCategory(scope, {
        name: "Desserts",
        displayOrder: 3,
      }),
    ).resolves.toEqual({ status: "category_limit" });

    expect(fake.withTransaction).toHaveBeenCalledOnce();
    expect(fake.connectionQuery).toHaveBeenCalledTimes(2);
    expect(compact(fake.connectionQuery.mock.calls[0][0])).toBe(
      "SELECT id FROM User WHERE tenantId = ? ORDER BY id ASC LIMIT 1 FOR UPDATE",
    );
    expect(compact(fake.connectionQuery.mock.calls[1][0])).toBe(
      "SELECT COUNT(*) AS total FROM RestaurantMenuCategory WHERE tenantId = ?",
    );
  });

  it("enforces tenant-wide category uniqueness through the database key", async () => {
    const duplicate = Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "owner-a" }])
      .mockResolvedValueOnce([{ total: "2" }])
      .mockRejectedValueOnce(duplicate);
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.createMenuCategory(scope, {
        name: "drinks",
        displayOrder: 3,
      }),
    ).resolves.toEqual({ status: "duplicate" });
  });

  it("resolves an item category in the same scope before a tenant-wide cap check", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "owner-a" }])
      .mockResolvedValueOnce([{ id: "category-a" }])
      .mockResolvedValueOnce([{ total: "499" }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    const result = await repository.createMenuItem(scope, {
      categoryId: "category-a",
      name: "Tea",
      priceMinor: 250,
      description: "Hot tea",
      displayOrder: 1,
      state: "available",
    });

    expect(result).toMatchObject({
      status: "saved",
      item: { categoryId: "category-a", locationId: "branch-a", state: "available" },
    });
    expect(compact(fake.connectionQuery.mock.calls[1][0])).toContain(
      "category.tenantId = ? AND category.locationId <=> ? AND category.id = ?",
    );
    expect(fake.connectionQuery.mock.calls[1][1]).toEqual(["tenant-a", "branch-a", "category-a"]);
    expect(compact(fake.connectionQuery.mock.calls[2][0])).toBe(
      "SELECT COUNT(*) AS total FROM RestaurantMenuItem WHERE tenantId = ?",
    );
    expect(fake.connectionQuery.mock.calls[3][1].slice(1, 4)).toEqual([
      "tenant-a",
      "branch-a",
      "category-a",
    ]);
  });

  it("updates item state and deletes items only through scoped identifiers", async () => {
    const fake = fakeDatabase({ affectedRows: 1 });
    fake.connectionQuery
      .mockResolvedValueOnce([
        {
          id: "item-a",
          locationId: "branch-a",
          categoryId: "category-a",
          name: "Tea",
          priceMinor: 250,
          description: "Hot tea",
          displayOrder: 1,
          state: "available",
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.updateMenuItemState(scope, "item-a", "unavailable"),
    ).resolves.toMatchObject({
      status: "saved",
      item: { id: "item-a", state: "unavailable" },
    });
    expect(compact(fake.connectionQuery.mock.calls[0][0])).toContain(
      "item.tenantId = ? AND item.locationId <=> ? AND item.id = ?",
    );
    expect(compact(fake.connectionQuery.mock.calls[1][0])).toContain(
      "WHERE tenantId = ? AND locationId <=> ? AND id = ?",
    );

    await expect(repository.deleteMenuItem(scope, "item-a")).resolves.toEqual({
      status: "deleted",
    });
    expect(compact(fake.execute.mock.calls[0][0])).toBe(
      "DELETE FROM RestaurantMenuItem WHERE tenantId = ? AND locationId <=> ? AND id = ?",
    );
  });

  it("previews without mutation and performs confirmed cascade deletion transactionally", async () => {
    const previewFake = fakeDatabase({ row: { id: "category-a", itemCount: "3" } });
    const previewRepository = createRestaurantSettingsRepository(previewFake.database);
    await expect(
      previewRepository.previewMenuCategoryDeletion(scope, "category-a"),
    ).resolves.toEqual({
      status: "preview",
      categoryId: "category-a",
      itemCount: 3,
      confirmationRequired: true,
    });
    expect(previewFake.execute).not.toHaveBeenCalled();
    expect(previewFake.withTransaction).not.toHaveBeenCalled();

    const deleteFake = fakeDatabase();
    deleteFake.connectionQuery
      .mockResolvedValueOnce([{ id: "category-a" }])
      .mockResolvedValueOnce({ affectedRows: 3 })
      .mockResolvedValueOnce({ affectedRows: 1 });
    const deleteRepository = createRestaurantSettingsRepository(deleteFake.database);
    await expect(deleteRepository.confirmDeleteMenuCategory(scope, "category-a")).resolves.toEqual({
      status: "deleted",
      deletedItemCount: 3,
    });

    expect(deleteFake.withTransaction).toHaveBeenCalledOnce();
    expect(compact(deleteFake.connectionQuery.mock.calls[0][0])).toContain(
      "category.tenantId = ? AND category.locationId <=> ? AND category.id = ?",
    );
    expect(compact(deleteFake.connectionQuery.mock.calls[1][0])).toBe(
      "DELETE FROM RestaurantMenuItem WHERE tenantId = ? AND locationId <=> ? AND categoryId = ?",
    );
    expect(compact(deleteFake.connectionQuery.mock.calls[2][0])).toBe(
      "DELETE FROM RestaurantMenuCategory WHERE tenantId = ? AND locationId <=> ? AND id = ?",
    );
  });

  it("returns only available primary-scope menu items for public reads", async () => {
    const fake = fakeDatabase({
      rows: [
        {
          categoryId: "category-a",
          categoryLocationId: null,
          categoryName: "Drinks",
          categoryDisplayOrder: 1,
          itemId: "item-a",
          itemLocationId: null,
          itemCategoryId: "category-a",
          itemName: "Tea",
          itemPriceMinor: 250,
          itemDescription: "Hot tea",
          itemDisplayOrder: 1,
          itemState: "available",
        },
      ],
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.getPublicRestaurantMenu("tenant-a")).resolves.toMatchObject([
      { id: "category-a", items: [{ id: "item-a", state: "available" }] },
    ]);
    const sql = compact(fake.query.mock.calls[0][0]);
    expect(sql).toContain("AND item.state = 'available'");
    expect(fake.query.mock.calls[0][1]).toEqual(["tenant-a", null]);
  });
});

describe("self-service account security access", () => {
  it("reads a tenant-constrained account credential snapshot per role", async () => {
    const fake = fakeDatabase({
      row: {
        id: "sub-a",
        email: "old@example.test",
        password: "hash",
        profilePhoto: null,
      },
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.getAccountSecurity("tenant-a", "sub_user", "sub-a")).resolves.toEqual({
      accountType: "sub_user",
      accountId: "sub-a",
      tenantId: "tenant-a",
      email: "old@example.test",
      passwordHash: "hash",
      profilePhoto: null,
    });
    expect(compact(fake.queryOne.mock.calls[0][0])).toContain(
      "SELECT id, email, password, profilePhoto FROM SubUser WHERE id = ? AND tenantId = ?",
    );
    expect(fake.queryOne.mock.calls[0][1]).toEqual(["sub-a", "tenant-a"]);
  });

  it("treats an address as available only when no other account holds it", async () => {
    const takenFake = fakeDatabase({ row: { found: 1 } });
    const takenRepository = createRestaurantSettingsRepository(takenFake.database);
    await expect(
      takenRepository.isAccountEmailAvailable("Next@Example.test", {
        accountType: "user",
        accountId: "owner-a",
      }),
    ).resolves.toBe(false);

    const sql = compact(takenFake.queryOne.mock.calls[0][0]);
    expect(sql).toContain("FROM User WHERE LOWER(email) = ?");
    expect(sql).toContain("FROM SubUser WHERE LOWER(email) = ?");
    expect(sql).toContain("FROM Location WHERE LOWER(email) = ?");
    expect(sql).toContain("WHERE NOT (accounts.accountType = ? AND accounts.id = ?)");
    expect(takenFake.queryOne.mock.calls[0][1]).toEqual([
      "next@example.test",
      "next@example.test",
      "next@example.test",
      "user",
      "owner-a",
    ]);

    const freeFake = fakeDatabase({ row: null });
    const freeRepository = createRestaurantSettingsRepository(freeFake.database);
    await expect(
      freeRepository.isAccountEmailAvailable("free@example.test", {
        accountType: "user",
        accountId: "owner-a",
      }),
    ).resolves.toBe(true);
  });

  it("updates exactly one account password and photo by tenant and id", async () => {
    const fake = fakeDatabase({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.updateAccountPassword("tenant-a", "user", "owner-a", "new-hash"),
    ).resolves.toBe(true);
    expect(compact(fake.execute.mock.calls[0][0])).toBe(
      "UPDATE User SET password = ? WHERE id = ? AND tenantId = ?",
    );
    expect(fake.execute.mock.calls[0][1]).toEqual(["new-hash", "owner-a", "tenant-a"]);

    await expect(
      repository.updateAccountProfilePhoto("tenant-a", "location", "branch-a", "https://cdn/x.png"),
    ).resolves.toBe(true);
    expect(compact(fake.execute.mock.calls[1][0])).toBe(
      "UPDATE Location SET profilePhoto = ? WHERE id = ? AND tenantId = ?",
    );
  });

  it("confirms an email change transactionally: consume, recheck, update", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "owner-a" }]) // lock account
      .mockResolvedValueOnce({ affectedRows: 1 }) // consume target verification
      .mockResolvedValueOnce([]) // uniqueness recheck -> available
      .mockResolvedValueOnce({ affectedRows: 1 }) // update email
      .mockResolvedValueOnce({ affectedRows: 1 }); // consume remaining outstanding
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.confirmAccountEmailChange("tenant-a", {
        accountType: "user",
        accountId: "owner-a",
        verificationId: "verification-a",
        targetEmail: "next@example.test",
        consumedAtMs: Date.UTC(2026, 0, 1, 0, 2),
      }),
    ).resolves.toEqual({ status: "updated" });

    expect(fake.withTransaction).toHaveBeenCalledOnce();
    const updateSql = compact(fake.connectionQuery.mock.calls[3][0]);
    expect(updateSql).toBe("UPDATE User SET email = ? WHERE id = ? AND tenantId = ?");
    expect(fake.connectionQuery.mock.calls[3][1]).toEqual([
      "next@example.test",
      "owner-a",
      "tenant-a",
    ]);
  });

  it("rejects an email change and leaves the address unchanged when taken", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "owner-a" }]) // lock account
      .mockResolvedValueOnce({ affectedRows: 1 }) // consume target verification
      .mockResolvedValueOnce([{ found: 1 }]); // uniqueness recheck -> taken
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.confirmAccountEmailChange("tenant-a", {
        accountType: "user",
        accountId: "owner-a",
        verificationId: "verification-a",
        targetEmail: "taken@example.test",
        consumedAtMs: Date.UTC(2026, 0, 1, 0, 2),
      }),
    ).resolves.toEqual({ status: "email_taken" });

    const allSql = fake.connectionQuery.mock.calls.map((call) => compact(call[0])).join(" ");
    expect(allSql).not.toContain("SET email = ?");
  });
});

describe("tenant-scoped SubUser lifecycle", () => {
  it("creates a SubUser and maps a duplicate email key to a duplicate status", async () => {
    const fake = fakeDatabase({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    const created = await repository.createSubUser("tenant-a", {
      name: "Rey",
      email: "rey@example.test",
      phone: "100",
      role: "doctor",
      passwordHash: "hash",
      isActive: true,
    });
    expect(created.status).toBe("created");
    expect(compact(fake.execute.mock.calls[0][0])).toContain("INSERT INTO SubUser");
    expect(fake.execute.mock.calls[0][1].slice(1, 8)).toEqual([
      "tenant-a",
      "Rey",
      "rey@example.test",
      "100",
      "doctor",
      "hash",
      1,
    ]);

    const dupFake = fakeDatabase();
    dupFake.execute.mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }),
    );
    const dupRepository = createRestaurantSettingsRepository(dupFake.database);
    await expect(
      dupRepository.createSubUser("tenant-a", {
        name: "Rey",
        email: "rey@example.test",
        phone: "100",
        role: "doctor",
        passwordHash: "hash",
        isActive: true,
      }),
    ).resolves.toEqual({ status: "duplicate" });
  });

  it("omits the password column when no new hash is provided on update", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery.mockResolvedValueOnce([{ id: "sub-a" }]);
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(
      repository.updateSubUser("tenant-a", "sub-a", {
        name: "Rey",
        email: "rey@example.test",
        phone: "100",
        role: "reception",
        isActive: true,
      }),
    ).resolves.toEqual({ status: "updated" });

    const updateSql = compact(fake.connectionQuery.mock.calls[1][0]);
    expect(updateSql).not.toContain("password = ?");
    expect(updateSql).toContain("WHERE id = ? AND tenantId = ?");
  });

  it("includes the password column only when a hash is provided", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery.mockResolvedValueOnce([{ id: "sub-a" }]);
    const repository = createRestaurantSettingsRepository(fake.database);

    await repository.updateSubUser("tenant-a", "sub-a", {
      name: "Rey",
      email: "rey@example.test",
      phone: "100",
      role: "reception",
      passwordHash: "fresh-hash",
      isActive: true,
    });
    expect(compact(fake.connectionQuery.mock.calls[1][0])).toContain("password = ?");
  });

  it("revokes sessions transactionally when deactivating a SubUser", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "sub-a" }]) // lock
      .mockResolvedValueOnce({ affectedRows: 1 }) // update isActive
      .mockResolvedValueOnce({ affectedRows: 2 }); // delete sessions
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.setSubUserActive("tenant-a", "sub-a", false)).resolves.toEqual({
      status: "updated",
    });

    expect(fake.withTransaction).toHaveBeenCalledOnce();
    expect(compact(fake.connectionQuery.mock.calls[1][0])).toBe(
      "UPDATE SubUser SET isActive = ? WHERE id = ? AND tenantId = ?",
    );
    expect(compact(fake.connectionQuery.mock.calls[2][0])).toContain(
      "DELETE session FROM SubUserSession AS session",
    );
  });

  it("does not delete sessions when reactivating a SubUser", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "sub-a" }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    await repository.setSubUserActive("tenant-a", "sub-a", true);
    const allSql = fake.connectionQuery.mock.calls.map((call) => compact(call[0])).join(" ");
    expect(allSql).not.toContain("DELETE session FROM SubUserSession");
  });

  it("deletes sessions before the tenant-scoped SubUser row", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "sub-a" }]) // lock
      .mockResolvedValueOnce({ affectedRows: 1 }) // delete sessions
      .mockResolvedValueOnce({ affectedRows: 1 }); // delete row
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.deleteSubUser("tenant-a", "sub-a")).resolves.toEqual({
      status: "deleted",
    });
    expect(compact(fake.connectionQuery.mock.calls[1][0])).toContain(
      "DELETE session FROM SubUserSession AS session",
    );
    expect(compact(fake.connectionQuery.mock.calls[2][0])).toBe(
      "DELETE FROM SubUser WHERE id = ? AND tenantId = ?",
    );
  });

  it("returns not_found for a foreign SubUser id without mutating", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery.mockResolvedValueOnce([]);
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.deleteSubUser("tenant-a", "foreign")).resolves.toEqual({
      status: "not_found",
    });
    expect(fake.connectionQuery).toHaveBeenCalledOnce();
  });

  it("aggregates SubUser role counts for plan-limit callers", async () => {
    const fake = fakeDatabase({
      rows: [
        { role: "doctor", total: "3" },
        { role: "reception", total: 1 },
      ],
    });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.getSubUserRoleCounts("tenant-a")).resolves.toEqual({
      doctor: 3,
      reception: 1,
    });
  });
});

describe("tenant-scoped Branch lifecycle", () => {
  it("creates a branch and maps a duplicate email key to duplicate", async () => {
    const fake = fakeDatabase({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    const created = await repository.createBranch("tenant-a", {
      name: "Downtown",
      email: "downtown@example.test",
      passwordHash: "hash",
      phone: "100",
      address: "1 St",
      city: "Metropolis",
      state: "ST",
      pincode: "00001",
      managerName: "Manager",
    });
    expect(created.status).toBe("created");
    expect(compact(fake.execute.mock.calls[0][0])).toContain("INSERT INTO Location");

    const dupFake = fakeDatabase();
    dupFake.execute.mockRejectedValueOnce(Object.assign(new Error("dup"), { errno: 1062 }));
    const dupRepository = createRestaurantSettingsRepository(dupFake.database);
    await expect(
      dupRepository.createBranch("tenant-a", {
        name: "Downtown",
        email: "downtown@example.test",
        passwordHash: "hash",
        phone: "",
        address: "",
        city: "",
        state: "",
        pincode: "",
        managerName: "",
      }),
    ).resolves.toEqual({ status: "duplicate" });
  });

  it("revokes branch sessions when an update deactivates the branch", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "branch-a" }]) // lock
      .mockResolvedValueOnce({ affectedRows: 1 }) // update
      .mockResolvedValueOnce({ affectedRows: 1 }); // delete sessions
    const repository = createRestaurantSettingsRepository(fake.database);

    await repository.updateBranch("tenant-a", "branch-a", {
      name: "Downtown",
      phone: "100",
      address: "1 St",
      city: "Metropolis",
      state: "ST",
      pincode: "00001",
      managerName: "Manager",
      isActive: false,
    });
    const allSql = fake.connectionQuery.mock.calls.map((call) => compact(call[0])).join(" ");
    expect(allSql).toContain("DELETE session FROM LocationSession AS session");
    const updateSql = compact(fake.connectionQuery.mock.calls[1][0]);
    expect(updateSql).not.toContain("password = ?");
  });

  it("deletes branch sessions before the tenant-scoped branch row", async () => {
    const fake = fakeDatabase();
    fake.connectionQuery
      .mockResolvedValueOnce([{ id: "branch-a" }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });
    const repository = createRestaurantSettingsRepository(fake.database);

    await expect(repository.deleteBranch("tenant-a", "branch-a")).resolves.toEqual({
      status: "deleted",
    });
    expect(compact(fake.connectionQuery.mock.calls[1][0])).toContain(
      "DELETE session FROM LocationSession AS session",
    );
    expect(compact(fake.connectionQuery.mock.calls[2][0])).toBe(
      "DELETE FROM Location WHERE id = ? AND tenantId = ?",
    );
  });
});

describe("strict WhatsApp settings adapter", () => {
  function fakeClient(overrides: Partial<WhatsAppMicroserviceClient> = {}) {
    return {
      getStatus: vi.fn(async () => ({
        state: "CONNECTED" as const,
        qrDataUrl: "",
        connectedNumber: "+15550001",
        queueCount: 2,
        sentLog: [
          { timestamp: "t1", recipient: "a", message: "m", status: "sent" as const },
          { timestamp: "t2", recipient: "b", message: "m", status: "failed" as const },
          { timestamp: "t3", recipient: "c", message: "m", status: "sent" as const },
        ],
      })),
      initialize: vi.fn(async () => ({ success: true })),
      disconnect: vi.fn(async () => ({ success: true })),
      enqueue: vi.fn(async () => ({ success: true })),
      ...overrides,
    } as WhatsAppMicroserviceClient;
  }

  it("normalises a connected status and derives the sent count", async () => {
    const adapter = createWhatsAppSettingsAdapter(fakeClient());

    await expect(adapter.readStatus("tenant-a")).resolves.toEqual({
      state: "CONNECTED",
      qrDataUrl: "",
      connectedNumber: "+15550001",
      queueCount: 2,
      sentCount: 2,
      sentLog: expect.any(Array),
    });
  });

  it("surfaces a transport failure as ERROR instead of hiding it", async () => {
    const adapter = createWhatsAppSettingsAdapter(
      fakeClient({
        getStatus: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      }),
    );

    await expect(adapter.readStatus("tenant-a")).resolves.toEqual({
      state: "ERROR",
      qrDataUrl: "",
      connectedNumber: "",
      queueCount: 0,
      sentCount: 0,
      sentLog: [],
    });
  });

  it("reports ok only when the microservice confirms success", async () => {
    const adapter = createWhatsAppSettingsAdapter(fakeClient());
    await expect(adapter.initialize("tenant-a")).resolves.toEqual({ status: "ok" });
    await expect(adapter.disconnect("tenant-a")).resolves.toEqual({ status: "ok" });
    await expect(adapter.sendTestMessage("tenant-a", "+15550002", "hi")).resolves.toEqual({
      status: "ok",
    });
  });

  it("never reports success when an action throws or is unconfirmed", async () => {
    const throwing = createWhatsAppSettingsAdapter(
      fakeClient({
        initialize: vi.fn(async () => {
          throw new Error("down");
        }),
      }),
    );
    await expect(throwing.initialize("tenant-a")).resolves.toEqual({ status: "error" });

    const unconfirmed = createWhatsAppSettingsAdapter(
      fakeClient({ enqueue: vi.fn(async () => ({ success: false })) }),
    );
    await expect(unconfirmed.sendTestMessage("tenant-a", "+15550002", "hi")).resolves.toEqual({
      status: "error",
    });
  });
});
