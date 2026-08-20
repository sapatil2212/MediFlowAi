import { readFileSync } from "node:fs";
import type { PoolConnection } from "mariadb";
import { describe, expect, it, vi } from "vitest";

// The settings repository module eagerly constructs a default repository that
// binds to `./db`. That module opens a real MariaDB pool on import, so — exactly
// like the existing repository unit suite — we replace it with inert fakes and
// inject purpose-built databases per test instead of standing up a server.
vi.mock("./db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  withTransaction: vi.fn(),
}));

import {
  createRestaurantSettingsRepository,
  type RestaurantSettingsRepositoryDatabase,
} from "./restaurant-settings.server";
import type { NormalisedClosureDay, NormalisedMenuCategory } from "./restaurant-settings-model";

const runtimeSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const prismaSchema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

/** The five schema objects this feature adds to the authoritative runtime DDL. */
const NEW_TABLES = [
  "RestaurantDiningArea",
  "RestaurantClosureDay",
  "RestaurantMenuCategory",
  "RestaurantMenuItem",
  "AccountEmailVerification",
] as const;

function runtimeTableDdl(table: string): string {
  const match = runtimeSource.match(
    new RegExp(
      `CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\s*\\) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ),
  );
  expect(match, `${table} runtime DDL`).not.toBeNull();
  return match![1].replace(/\s+/g, " ").trim();
}

function prismaModel(name: string): string {
  const match = prismaSchema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `${name} Prisma mirror`).not.toBeNull();
  return match![1].replace(/\s+/g, " ").trim();
}

/**
 * The additive migration region: everything from the legacy-area backfill up to
 * the pre-existing Appointment column block. Both the deterministic-backfill and
 * booking-noninterference claims are proved against this exact slice.
 */
function migrationRegion(): string {
  const start = runtimeSource.indexOf("// Backfill one canonical registry row");
  const end = runtimeSource.indexOf("// Restaurant booking columns on Appointment", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return runtimeSource.slice(start, end);
}

describe("runtime schema initializes from a pre-feature database and re-runs safely", () => {
  it("creates every new settings table only when absent", () => {
    for (const table of NEW_TABLES) {
      expect(
        runtimeSource,
        `${table} must be created with IF NOT EXISTS so a pre-feature database gains it and a re-run is a no-op`,
      ).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
  });

  it("adds compatibility columns and indexes conditionally so repeated startups do not fail", () => {
    // areaId is only added when SHOW COLUMNS proves it absent on the pre-feature table.
    expect(runtimeSource).toContain("SHOW COLUMNS FROM RestaurantTable");
    expect(runtimeSource).toContain('if (!tableColNames.includes("areaId"))');
    expect(runtimeSource).toContain(
      "ALTER TABLE RestaurantTable ADD COLUMN areaId VARCHAR(255) NULL",
    );
    // The scoped area index is guarded by a SHOW INDEX existence probe.
    expect(runtimeSource).toContain(
      "SHOW INDEX FROM RestaurantTable WHERE Key_name = 'idx_resto_table_area'",
    );
    expect(runtimeSource).toContain(
      "ALTER TABLE RestaurantTable ADD INDEX idx_resto_table_area (tenantId, locationId, areaId)",
    );
  });

  it("orders the migration additively: create tables, then backfill, then resolve", () => {
    const lastTableCreate = Math.max(
      ...NEW_TABLES.map((table) => runtimeSource.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)),
    );
    const areaIdColumn = runtimeSource.indexOf(
      "ALTER TABLE RestaurantTable ADD COLUMN areaId VARCHAR(255) NULL",
    );
    const backfill = runtimeSource.indexOf("INSERT IGNORE INTO RestaurantDiningArea");
    const resolve = runtimeSource.indexOf("// Resolve only previously-unresolved tables");

    expect(lastTableCreate).toBeLessThan(areaIdColumn);
    expect(areaIdColumn).toBeLessThan(backfill);
    expect(backfill).toBeLessThan(resolve);
  });

  it("uses retry-safe write forms for the data migration", () => {
    const region = migrationRegion();
    // INSERT IGNORE means a second startup that re-derives identical ids is a no-op.
    expect(region).toContain("INSERT IGNORE INTO RestaurantDiningArea");
    // Resolution only writes rows still missing an areaId, so it converges after the first run.
    expect(region.replace(/\s+/g, " ")).toContain("WHERE restaurantTable.areaId IS NULL");
    // Nothing in the migration drops or truncates a table.
    expect(region).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(region).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("fails each startup step closed and independently rather than aborting the batch", () => {
    for (const table of NEW_TABLES) {
      expect(runtimeSource).toContain(`[DB] ❌ Failed to create ${table} table:`);
    }
    expect(runtimeSource).toContain("[DB] ❌ Failed to backfill RestaurantDiningArea rows:");
    expect(runtimeSource).toContain("[DB] ❌ Failed to resolve RestaurantTable.areaId:");
  });
});

describe("runtime DDL and the Prisma mirror agree on critical metadata (drift)", () => {
  // Each fact is asserted in BOTH sources, so a change to either the runtime DDL
  // or the Prisma mirror that is not mirrored in the other fails this suite.
  const CRITICAL: Record<
    (typeof NEW_TABLES)[number],
    ReadonlyArray<{ runtime: string; prisma: string }>
  > = {
    RestaurantDiningArea: [
      { runtime: "tenantId VARCHAR(255) NOT NULL", prisma: "tenantId String @db.VarChar(255)" },
      { runtime: "locationId VARCHAR(255) NULL", prisma: "locationId String? @db.VarChar(255)" },
      { runtime: "name VARCHAR(30) NOT NULL", prisma: "name String @db.VarChar(30)" },
      { runtime: "displayOrder INT NOT NULL DEFAULT 1", prisma: "displayOrder Int @default(1)" },
      {
        runtime: "UNIQUE KEY uq_area_tenant_name (tenantId, name)",
        prisma: '@@unique([tenantId, name], map: "uq_area_tenant_name")',
      },
      {
        runtime: "KEY idx_area_scope_order (tenantId, locationId, displayOrder, name)",
        prisma: '@@index([tenantId, locationId, displayOrder, name], map: "idx_area_scope_order")',
      },
    ],
    RestaurantClosureDay: [
      { runtime: "locationId VARCHAR(255) NULL", prisma: "locationId String? @db.VarChar(255)" },
      {
        runtime: "locationKey VARCHAR(255) NOT NULL",
        prisma: "locationKey String @db.VarChar(255)",
      },
      { runtime: "closureDate DATE NOT NULL", prisma: "closureDate DateTime @db.Date" },
      { runtime: "scopeType VARCHAR(16) NOT NULL", prisma: "scopeType String @db.VarChar(16)" },
      { runtime: "tableId VARCHAR(255) NULL", prisma: "tableId String? @db.VarChar(255)" },
      { runtime: "scopeKey VARCHAR(255) NOT NULL", prisma: "scopeKey String @db.VarChar(255)" },
      {
        runtime: "reason VARCHAR(100) NOT NULL DEFAULT ''",
        prisma: 'reason String @default("") @db.VarChar(100)',
      },
      {
        runtime: "isHoliday TINYINT(1) NOT NULL DEFAULT 0",
        prisma: "isHoliday Boolean @default(false)",
      },
      {
        runtime: "UNIQUE KEY uq_closure (tenantId, locationKey, closureDate, scopeKey)",
        prisma: '@@unique([tenantId, locationKey, closureDate, scopeKey], map: "uq_closure")',
      },
      {
        runtime: "KEY idx_closure_month (tenantId, locationId, closureDate)",
        prisma: '@@index([tenantId, locationId, closureDate], map: "idx_closure_month")',
      },
      {
        runtime: "KEY idx_closure_table (tenantId, locationId, tableId, closureDate)",
        prisma: '@@index([tenantId, locationId, tableId, closureDate], map: "idx_closure_table")',
      },
    ],
    RestaurantMenuCategory: [
      { runtime: "name VARCHAR(40) NOT NULL", prisma: "name String @db.VarChar(40)" },
      { runtime: "displayOrder INT NOT NULL DEFAULT 1", prisma: "displayOrder Int @default(1)" },
      {
        runtime: "UNIQUE KEY uq_menu_category_name (tenantId, name)",
        prisma: '@@unique([tenantId, name], map: "uq_menu_category_name")',
      },
      {
        runtime: "KEY idx_menu_category_scope (tenantId, locationId, displayOrder, name)",
        prisma:
          '@@index([tenantId, locationId, displayOrder, name], map: "idx_menu_category_scope")',
      },
    ],
    RestaurantMenuItem: [
      { runtime: "categoryId VARCHAR(255) NOT NULL", prisma: "categoryId String @db.VarChar(255)" },
      { runtime: "name VARCHAR(80) NOT NULL", prisma: "name String @db.VarChar(80)" },
      { runtime: "priceMinor INT NOT NULL", prisma: "priceMinor Int" },
      {
        runtime: "description VARCHAR(300) NOT NULL DEFAULT ''",
        prisma: 'description String @default("") @db.VarChar(300)',
      },
      { runtime: "displayOrder INT NOT NULL DEFAULT 1", prisma: "displayOrder Int @default(1)" },
      {
        runtime: "state VARCHAR(16) NOT NULL DEFAULT 'available'",
        prisma: 'state String @default("available") @db.VarChar(16)',
      },
      {
        runtime: "KEY idx_menu_item_category (tenantId, locationId, categoryId)",
        prisma: '@@index([tenantId, locationId, categoryId], map: "idx_menu_item_category")',
      },
      {
        runtime: "KEY idx_menu_item_public (tenantId, locationId, state)",
        prisma: '@@index([tenantId, locationId, state], map: "idx_menu_item_public")',
      },
    ],
    AccountEmailVerification: [
      { runtime: "accountType VARCHAR(16) NOT NULL", prisma: "accountType String @db.VarChar(16)" },
      { runtime: "accountId VARCHAR(255) NOT NULL", prisma: "accountId String @db.VarChar(255)" },
      {
        runtime: "targetEmail VARCHAR(255) NOT NULL",
        prisma: "targetEmail String @db.VarChar(255)",
      },
      { runtime: "codeHash VARCHAR(255) NOT NULL", prisma: "codeHash String @db.VarChar(255)" },
      { runtime: "expiresAt TIMESTAMP NOT NULL", prisma: "expiresAt DateTime @db.Timestamp(0)" },
      {
        runtime: "resendAvailableAt TIMESTAMP NOT NULL",
        prisma: "resendAvailableAt DateTime @db.Timestamp(0)",
      },
      { runtime: "consumedAt TIMESTAMP NULL", prisma: "consumedAt DateTime? @db.Timestamp(0)" },
      {
        runtime: "KEY idx_email_verify_account (accountType, accountId, consumedAt, expiresAt)",
        prisma:
          '@@index([accountType, accountId, consumedAt, expiresAt], map: "idx_email_verify_account")',
      },
      {
        runtime: "KEY idx_email_verify_target (targetEmail)",
        prisma: '@@index([targetEmail], map: "idx_email_verify_target")',
      },
    ],
  };

  it.each(NEW_TABLES)("keeps runtime and Prisma metadata in lockstep for %s", (table) => {
    const runtime = runtimeTableDdl(table);
    const prisma = prismaModel(table);
    for (const fact of CRITICAL[table]) {
      expect(runtime, `${table} runtime is missing ${fact.runtime}`).toContain(fact.runtime);
      expect(prisma, `${table} Prisma is missing ${fact.prisma}`).toContain(fact.prisma);
    }
    // Both sources must still address the same physical table.
    expect(prisma).toContain(`@@map("${table}")`);
  });

  it("mirrors every new runtime table as a Prisma model", () => {
    for (const table of NEW_TABLES) {
      expect(prismaSchema, `${table} is missing from the Prisma mirror`).toContain(
        `model ${table} {`,
      );
    }
  });
});

describe("legacy dining-area backfill is deterministic and non-destructive", () => {
  const region = migrationRegion();
  const compact = region.replace(/\s+/g, " ");

  it("derives ids and order from canonical source values only", () => {
    // Deterministic id from a hash of tenant/location/name — never random.
    expect(compact).toContain("SHA2(");
    expect(compact).toContain("COALESCE(ranked.locationId, '__primary__')");
    expect(compact).toContain(
      "ROW_NUMBER() OVER ( PARTITION BY canonical.tenantId, canonical.locationId ORDER BY LOWER(canonical.name), BINARY canonical.name ) AS displayOrder",
    );
    // A non-deterministic generator would make repeated startups diverge.
    expect(region).not.toMatch(/\bUUID\s*\(/i);
    expect(region).not.toMatch(/\bRAND\s*\(/i);
  });

  it("groups by trimmed case-insensitive area within the original scope", () => {
    expect(compact).toContain("CAST(MIN(BINARY TRIM(area)) AS CHAR CHARACTER SET utf8mb4) AS name");
    expect(compact).toContain("WHERE NULLIF(TRIM(area), '') IS NOT NULL");
    expect(compact).toContain("GROUP BY tenantId, locationId, LOWER(TRIM(area))");
  });

  it("never rewrites the compatibility RestaurantTable.area string", () => {
    // areaId may be resolved, but the display/compatibility string is untouched.
    expect(compact).toContain("SET restaurantTable.areaId = diningArea.id");
    expect(region).not.toContain("SET restaurantTable.area =");
    expect(region).not.toMatch(/UPDATE\s+RestaurantTable[\s\S]*?SET[\s\S]*?\barea\b\s*=/i);
  });

  it("resolves only unresolved rows against a same-scope canonical area", () => {
    expect(compact).toContain("diningArea.tenantId = restaurantTable.tenantId");
    expect(compact).toContain("diningArea.locationId <=> restaurantTable.locationId");
    expect(compact).toContain("diningArea.name = TRIM(restaurantTable.area)");
    expect(compact).toContain("WHERE restaurantTable.areaId IS NULL");
    expect(compact).toContain("NULLIF(TRIM(restaurantTable.area), '') IS NOT NULL");
  });

  it("leaves appointments, booking statuses, settings, and hours untouched", () => {
    for (const table of [
      "Appointment",
      "RestaurantSettings",
      "RestaurantHours",
      "RestaurantTokenCounter",
    ]) {
      expect(region, `migration must not write ${table}`).not.toMatch(
        new RegExp(`(?:UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\s+${table}\\b`, "i"),
      );
    }
    expect(region).not.toMatch(/\bstatus\b\s*=/i);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed behavior: when a required new schema object is unavailable the
// affected repositories (which back the settings panels) must surface a storage
// error rather than silently returning success or empty data.
// ---------------------------------------------------------------------------

function schemaUnavailableError(object: string): Error {
  return Object.assign(new Error(`ER_NO_SUCH_TABLE: Table '${object}' doesn't exist`), {
    code: "ER_NO_SUCH_TABLE",
    errno: 1146,
  });
}

/** A database whose every access rejects, modeling an absent schema object. */
function unavailableDatabase(object: string): RestaurantSettingsRepositoryDatabase {
  const error = schemaUnavailableError(object);
  const reject = vi.fn(async () => {
    throw error;
  });
  const connection = {
    query: vi.fn(async () => {
      throw error;
    }),
  } as unknown as PoolConnection;
  const withTransaction = vi.fn(async (work: (connection: PoolConnection) => Promise<unknown>) =>
    work(connection),
  );
  return {
    query: reject,
    queryOne: reject,
    execute: reject,
    withTransaction,
  } as unknown as RestaurantSettingsRepositoryDatabase;
}

describe("settings repositories fail closed when a new schema object is unavailable", () => {
  const primaryScope = { tenantId: "tenant-a", locationId: null } as const;
  const branchScope = { tenantId: "tenant-a", locationId: "branch-a" } as const;

  it("propagates the storage error from scoped reads instead of returning empty data", async () => {
    const cases: ReadonlyArray<{
      object: string;
      run: (repository: ReturnType<typeof createRestaurantSettingsRepository>) => Promise<unknown>;
    }> = [
      { object: "RestaurantDiningArea", run: (r) => r.listDiningAreas(primaryScope) },
      {
        object: "RestaurantClosureDay",
        run: (r) => r.listClosureDays(branchScope, "2026-04-01", "2026-05-01"),
      },
      { object: "RestaurantMenuCategory", run: (r) => r.listMenu(branchScope) },
      { object: "RestaurantTable", run: (r) => r.listRestaurantTables(branchScope) },
    ];

    for (const { object, run } of cases) {
      const repository = createRestaurantSettingsRepository(unavailableDatabase(object));
      await expect(run(repository)).rejects.toThrow("ER_NO_SUCH_TABLE");
    }
  });

  it("fails the public menu projection closed rather than serving stale/empty content", async () => {
    const repository = createRestaurantSettingsRepository(
      unavailableDatabase("RestaurantMenuItem"),
    );
    await expect(repository.listMenu(primaryScope, true)).rejects.toThrow("ER_NO_SUCH_TABLE");
  });

  it("propagates the storage error from account email verification reads", async () => {
    const repository = createRestaurantSettingsRepository(
      unavailableDatabase("AccountEmailVerification"),
    );
    await expect(
      repository.getEmailVerificationById("tenant-a", "user", "owner-a", "verification-a"),
    ).rejects.toThrow("ER_NO_SUCH_TABLE");
  });

  it("propagates the storage error from scoped writes rather than reporting success", async () => {
    const closureInput: NormalisedClosureDay = {
      date: "2026-04-12",
      scope: { type: "restaurant" },
      reason: "Renovation",
      isHoliday: false,
    };
    const closureRepo = createRestaurantSettingsRepository(
      unavailableDatabase("RestaurantClosureDay"),
    );
    await expect(closureRepo.createClosureDay(branchScope, closureInput)).rejects.toThrow(
      "ER_NO_SUCH_TABLE",
    );

    const categoryInput: NormalisedMenuCategory = { name: "Desserts", displayOrder: 3 };
    const menuRepo = createRestaurantSettingsRepository(
      unavailableDatabase("RestaurantMenuCategory"),
    );
    await expect(menuRepo.createMenuCategory(branchScope, categoryInput)).rejects.toThrow(
      "ER_NO_SUCH_TABLE",
    );

    const verificationRepo = createRestaurantSettingsRepository(
      unavailableDatabase("AccountEmailVerification"),
    );
    await expect(
      verificationRepo.saveEmailVerification("tenant-a", {
        accountType: "user",
        accountId: "owner-a",
        targetEmail: "next@example.test",
        codeHash: "hash",
        expiresAtMs: Date.UTC(2026, 0, 1, 0, 5),
        resendAvailableAtMs: Date.UTC(2026, 0, 1, 0, 1),
      }),
    ).rejects.toThrow("ER_NO_SUCH_TABLE");
  });
});
