import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

function tableDdl(table: string): string {
  const match = source.match(
    new RegExp(
      `CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\s*\\) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ),
  );
  expect(match, `${table} DDL`).not.toBeNull();
  return match![1].replace(/\s+/g, " ").trim();
}

function expectFragments(value: string, fragments: string[]): void {
  for (const fragment of fragments) expect(value).toContain(fragment);
}

describe("restaurant settings runtime schema", () => {
  it("declares scoped dining-area and closure records with duplicate-safe keys", () => {
    expectFragments(tableDdl("RestaurantDiningArea"), [
      "tenantId VARCHAR(255) NOT NULL",
      "locationId VARCHAR(255) NULL",
      "name VARCHAR(30) NOT NULL",
      "displayOrder INT NOT NULL DEFAULT 1",
      "UNIQUE KEY uq_area_tenant_name (tenantId, name)",
      "KEY idx_area_scope_order (tenantId, locationId, displayOrder, name)",
    ]);

    expectFragments(tableDdl("RestaurantClosureDay"), [
      "locationKey VARCHAR(255) NOT NULL",
      "closureDate DATE NOT NULL",
      "scopeType VARCHAR(16) NOT NULL",
      "tableId VARCHAR(255) NULL",
      "scopeKey VARCHAR(255) NOT NULL",
      "reason VARCHAR(100) NOT NULL DEFAULT ''",
      "isHoliday TINYINT(1) NOT NULL DEFAULT 0",
      "UNIQUE KEY uq_closure (tenantId, locationKey, closureDate, scopeKey)",
      "KEY idx_closure_month (tenantId, locationId, closureDate)",
      "KEY idx_closure_table (tenantId, locationId, tableId, closureDate)",
    ]);
  });

  it("declares menu records with the designed limits, defaults, and read indexes", () => {
    expectFragments(tableDdl("RestaurantMenuCategory"), [
      "name VARCHAR(40) NOT NULL",
      "UNIQUE KEY uq_menu_category_name (tenantId, name)",
      "KEY idx_menu_category_scope (tenantId, locationId, displayOrder, name)",
    ]);

    expectFragments(tableDdl("RestaurantMenuItem"), [
      "categoryId VARCHAR(255) NOT NULL",
      "name VARCHAR(80) NOT NULL",
      "priceMinor INT NOT NULL",
      "description VARCHAR(300) NOT NULL DEFAULT ''",
      "state VARCHAR(16) NOT NULL DEFAULT 'available'",
      "KEY idx_menu_item_category (tenantId, locationId, categoryId)",
      "KEY idx_menu_item_public (tenantId, locationId, state)",
    ]);
  });

  it("keeps account email verification account-bound and expiry-indexed", () => {
    expectFragments(tableDdl("AccountEmailVerification"), [
      "accountType VARCHAR(16) NOT NULL",
      "accountId VARCHAR(255) NOT NULL",
      "targetEmail VARCHAR(255) NOT NULL",
      "codeHash VARCHAR(255) NOT NULL",
      "expiresAt TIMESTAMP NOT NULL",
      "resendAvailableAt TIMESTAMP NOT NULL",
      "consumedAt TIMESTAMP NULL",
      "KEY idx_email_verify_account (accountType, accountId, consumedAt, expiresAt)",
      "KEY idx_email_verify_target (targetEmail)",
    ]);
  });

  it("guards nullable compatibility columns and the scoped area index", () => {
    expect(source).toContain('if (!tableColNames.includes("areaId"))');
    expect(source).toContain("ALTER TABLE RestaurantTable ADD COLUMN areaId VARCHAR(255) NULL");
    expect(source).toContain(
      "ALTER TABLE RestaurantTable ADD INDEX idx_resto_table_area (tenantId, locationId, areaId)",
    );
    expect(source).toContain('if (!subUserColNames.includes("profilePhoto"))');
    expect(source).toContain("ALTER TABLE SubUser ADD COLUMN profilePhoto VARCHAR(500) NULL");
    expect(source).toContain('if (!locationColNames.includes("profilePhoto"))');
    expect(source).toContain("ALTER TABLE Location ADD COLUMN profilePhoto VARCHAR(500) NULL");
  });

  it("backfills canonical scoped areas with deterministic retry-safe SQL", () => {
    const start = source.indexOf("// Backfill one canonical registry row");
    const end = source.indexOf("// Restaurant booking columns on Appointment", start);
    const migration = source.slice(start, end).replace(/\s+/g, " ");

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expectFragments(migration, [
      "INSERT IGNORE INTO RestaurantDiningArea",
      "SHA2(",
      "COALESCE(ranked.locationId, '__primary__')",
      "ROW_NUMBER() OVER ( PARTITION BY canonical.tenantId, canonical.locationId ORDER BY LOWER(canonical.name), BINARY canonical.name ) AS displayOrder",
      "CAST(MIN(BINARY TRIM(area)) AS CHAR CHARACTER SET utf8mb4) AS name",
      "WHERE NULLIF(TRIM(area), '') IS NOT NULL",
      "GROUP BY tenantId, locationId, LOWER(TRIM(area))",
      "ranked.locationId IS NOT NULL",
    ]);
    expect(migration).not.toMatch(/\bUUID\s*\(|\bRAND\s*\(/i);
  });

  it("resolves only null matching area ids without rewriting compatibility data", () => {
    const start = source.indexOf("// Resolve only previously-unresolved tables");
    const end = source.indexOf("// Restaurant booking columns on Appointment", start);
    const resolution = source.slice(start, end).replace(/\s+/g, " ");

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expectFragments(resolution, [
      "UPDATE RestaurantTable AS restaurantTable",
      "diningArea.tenantId = restaurantTable.tenantId",
      "diningArea.locationId <=> restaurantTable.locationId",
      "diningArea.name = TRIM(restaurantTable.area)",
      "SET restaurantTable.areaId = diningArea.id",
      "WHERE restaurantTable.areaId IS NULL",
      "NULLIF(TRIM(restaurantTable.area), '') IS NOT NULL",
      "effective Main area",
    ]);
    expect(resolution).not.toContain("SET restaurantTable.area =");
    expect(resolution).not.toContain("UPDATE Appointment");
  });

  it("logs every required startup step independently", () => {
    for (const table of [
      "RestaurantDiningArea",
      "RestaurantClosureDay",
      "RestaurantMenuCategory",
      "RestaurantMenuItem",
      "AccountEmailVerification",
    ]) {
      expect(source).toContain(`[DB] ❌ Failed to create ${table} table:`);
    }

    expect(source).toContain("[DB] ❌ Could not verify/add RestaurantTable.areaId:");
    expect(source).toContain("[DB] ❌ Could not verify/add RestaurantTable area index:");
    expect(source).toContain("[DB] ❌ Failed to backfill RestaurantDiningArea rows:");
    expect(source).toContain("[DB] ❌ Failed to resolve RestaurantTable.areaId:");
    expect(source).toContain("[DB] ❌ Could not verify/add SubUser.profilePhoto:");
    expect(source).toContain("[DB] ❌ Could not verify/add Location.profilePhoto:");
  });
});
