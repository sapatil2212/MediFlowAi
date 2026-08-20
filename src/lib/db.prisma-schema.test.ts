import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `${name} Prisma mirror`).not.toBeNull();
  return match![1].replace(/\s+/g, " ").trim();
}

function expectModel(name: string, fragments: string[]): void {
  const source = model(name);
  for (const fragment of fragments) expect(source).toContain(fragment);
  expect(source).toContain(`@@map("${name}")`);
}

describe("restaurant settings Prisma schema mirror", () => {
  it("mirrors dining-area and closure SQL metadata", () => {
    expectModel("RestaurantDiningArea", [
      "id String @id @db.VarChar(255)",
      "locationId String? @db.VarChar(255)",
      "name String @db.VarChar(30)",
      "displayOrder Int @default(1)",
      '@@unique([tenantId, name], map: "uq_area_tenant_name")',
      '@@index([tenantId, locationId, displayOrder, name], map: "idx_area_scope_order")',
    ]);
    expectModel("RestaurantClosureDay", [
      "locationKey String @db.VarChar(255)",
      "closureDate DateTime @db.Date",
      "scopeType String @db.VarChar(16)",
      "tableId String? @db.VarChar(255)",
      "scopeKey String @db.VarChar(255)",
      'reason String @default("") @db.VarChar(100)',
      "isHoliday Boolean @default(false)",
      '@@unique([tenantId, locationKey, closureDate, scopeKey], map: "uq_closure")',
      '@@index([tenantId, locationId, closureDate], map: "idx_closure_month")',
      '@@index([tenantId, locationId, tableId, closureDate], map: "idx_closure_table")',
    ]);
  });

  it("mirrors menu SQL metadata", () => {
    expectModel("RestaurantMenuCategory", [
      "name String @db.VarChar(40)",
      "displayOrder Int @default(1)",
      '@@unique([tenantId, name], map: "uq_menu_category_name")',
      '@@index([tenantId, locationId, displayOrder, name], map: "idx_menu_category_scope")',
    ]);
    expectModel("RestaurantMenuItem", [
      "categoryId String @db.VarChar(255)",
      "name String @db.VarChar(80)",
      "priceMinor Int",
      'description String @default("") @db.VarChar(300)',
      "displayOrder Int @default(1)",
      'state String @default("available") @db.VarChar(16)',
      '@@index([tenantId, locationId, categoryId], map: "idx_menu_item_category")',
      '@@index([tenantId, locationId, state], map: "idx_menu_item_public")',
    ]);
  });

  it("mirrors account-bound email verification SQL metadata", () => {
    expectModel("AccountEmailVerification", [
      "accountType String @db.VarChar(16)",
      "accountId String @db.VarChar(255)",
      "targetEmail String @db.VarChar(255)",
      "codeHash String @db.VarChar(255)",
      "expiresAt DateTime @db.Timestamp(0)",
      "resendAvailableAt DateTime @db.Timestamp(0)",
      "consumedAt DateTime? @db.Timestamp(0)",
      '@@index([accountType, accountId, consumedAt, expiresAt], map: "idx_email_verify_account")',
      '@@index([targetEmail], map: "idx_email_verify_target")',
    ]);
  });

  it("requires compatibility scalars whenever legacy tables are mirrored", () => {
    for (const [name, scalar] of [
      ["RestaurantTable", "areaId String? @db.VarChar(255)"],
      ["SubUser", "profilePhoto String? @db.VarChar(500)"],
      ["Location", "profilePhoto String? @db.VarChar(500)"],
    ] as const) {
      if (schema.includes(`model ${name} {`)) expect(model(name)).toContain(scalar);
    }
  });
});
