import crypto from "node:crypto";
import type { PoolConnection } from "mariadb";

import { execute, query, queryOne, withTransaction } from "./db";
import {
  DEFAULT_DINING_AREA_NAME,
  EFFECTIVE_MAIN_AREA_ID,
  LIMITS,
  type AccountType,
  type ClosureDay,
  type ClosureScope,
  type DayHours,
  type DiningArea,
  type EmailVerification,
  type MenuCategory,
  type MenuCategoryDeletionPreview,
  type MenuItem,
  type MenuItemState,
  type NormalisedClosureDay,
  type NormalisedMenuCategory,
  type NormalisedMenuItem,
  type RestaurantProfile,
  type RestaurantResourceScope,
  type SubUser,
  type SubUserRole,
  type UserRoleCounts,
  SUB_USER_ROLES,
} from "./restaurant-settings-model";
import type { DiningTable, TableState } from "./restaurant-availability";
import {
  getWAStatusStrict,
  initializeWA,
  disconnectWA,
  enqueueWA,
  type WAStatus,
  type WASentLog,
} from "./whatsapp";

export interface StoredRestaurantProfile extends RestaurantProfile {
  id: string;
  tenantId: string;
}

export interface StoredRestaurantHours extends DayHours {
  id: string;
  tenantId: string;
}

export interface StoredEmailVerification extends EmailVerification {
  id: string;
  tenantId: string;
}

export interface WhatsAppAlertConfig {
  id: string;
  tenantId: string;
  phoneNumber: string;
  isEnabled: boolean;
}

export interface SaveEmailVerificationInput {
  id?: string;
  accountType: AccountType;
  accountId: string;
  targetEmail: string;
  codeHash: string;
  expiresAtMs: number;
  resendAvailableAtMs: number;
}

export interface SaveWhatsAppAlertConfigInput {
  phoneNumber: string;
  isEnabled: boolean;
}

export interface CreateClosureDayResult {
  status: "created" | "duplicate" | "table_not_found";
  id?: string;
}

export interface DeleteScopedRecordResult {
  status: "deleted" | "not_found";
}

export interface CreateDiningAreaInput {
  name: string;
  displayOrder?: number;
}

export interface CreateDiningAreaResult {
  status: "created" | "duplicate";
  area?: DiningArea;
}

export type DeleteDiningAreaResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "assigned_tables"; assignedTableCount: number };

export interface StoredRestaurantTable extends DiningTable {
  tenantId: string;
  locationId: string | null;
  areaId: string | null;
  closureCount: number;
}

export interface SaveScopedRestaurantTableInput {
  name: string;
  seatCapacity: number;
  areaId: string;
  displayOrder: number;
  state: TableState;
}

export type SaveScopedRestaurantTableResult =
  | { status: "saved"; table: StoredRestaurantTable }
  | { status: "not_found" | "area_not_found" | "duplicate" };

export type DeleteScopedRestaurantTableResult =
  | { status: "deleted"; deletedClosureCount: number }
  | { status: "not_found" };

export type SaveMenuCategoryResult =
  | { status: "saved"; category: MenuCategory }
  | { status: "not_found" | "duplicate" | "category_limit" };

export type SaveMenuItemResult =
  | { status: "saved"; item: MenuItem }
  | { status: "not_found" | "category_not_found" | "item_limit" };

export type DeleteMenuItemResult = { status: "deleted" | "not_found" };

export type PreviewMenuCategoryDeletionResult =
  | ({ status: "preview" } & MenuCategoryDeletionPreview)
  | { status: "not_found" };

export type DeleteMenuCategoryResult =
  | { status: "deleted"; deletedItemCount: number }
  | { status: "not_found" };

/** Self-service account security snapshot for one signed-in account. */
export interface AccountSecuritySnapshot {
  accountType: AccountType;
  accountId: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  profilePhoto: string | null;
}

export interface AccountEmailChangeInput {
  accountType: AccountType;
  accountId: string;
  verificationId: string;
  targetEmail: string;
  consumedAtMs: number;
}

export type AccountEmailChangeResult =
  | { status: "updated" }
  | { status: "not_found" | "email_taken" | "verification_invalid" };

export interface StoredSubUser extends SubUser {
  tenantId: string;
  profilePhoto: string | null;
}

export interface CreateSubUserInput {
  name: string;
  email: string;
  phone: string;
  role: SubUserRole;
  passwordHash: string;
  isActive: boolean;
}

export interface UpdateSubUserInput {
  name: string;
  email: string;
  phone: string;
  role: SubUserRole;
  /** Omit to retain the current stored password hash. */
  passwordHash?: string;
  isActive: boolean;
}

export type CreateSubUserResult = { status: "created"; id: string } | { status: "duplicate" };

export type UpdateSubUserResult = { status: "updated" } | { status: "not_found" | "duplicate" };

export type SubUserLifecycleResult = { status: "updated" | "not_found" };
export type DeleteSubUserResult = { status: "deleted" | "not_found" };

export interface StoredBranch {
  id: string;
  tenantId: string;
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

export interface CreateBranchInput {
  name: string;
  email: string;
  passwordHash: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  managerName: string;
}

export interface UpdateBranchInput {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  managerName: string;
  /** Omit to retain the current stored password hash. */
  passwordHash?: string;
  isActive: boolean;
}

export type CreateBranchResult = { status: "created"; id: string } | { status: "duplicate" };

export type UpdateBranchResult = { status: "updated" } | { status: "not_found" };

export type BranchLifecycleResult = { status: "updated" | "not_found" };
export type DeleteBranchResult = { status: "deleted" | "not_found" };

export interface SqlMutationResult {
  affectedRows: number;
  insertId?: unknown;
}

interface RepositoryRunner {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<SqlMutationResult>;
}

export interface RestaurantSettingsRepositoryDatabase extends RepositoryRunner {
  withTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T>;
}

type TransactionStarter = <T>(work: (connection: PoolConnection) => Promise<T>) => Promise<T>;

const defaultDatabase: RestaurantSettingsRepositoryDatabase = {
  query: (sql, params) => query(sql, params as any[] | undefined),
  queryOne: (sql, params) => queryOne(sql, params as any[] | undefined),
  execute: (sql, params) => execute(sql, params as any[] | undefined),
  withTransaction: (work) => withTransaction(work),
};

function transactionRunner(connection: PoolConnection): RepositoryRunner {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      return (await connection.query(sql, params as any[] | undefined)) as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const rows = (await connection.query(sql, params as any[] | undefined)) as T[];
      return rows.length > 0 ? rows[0] : null;
    },
    async execute(sql: string, params?: unknown[]): Promise<SqlMutationResult> {
      const result = (await connection.query(sql, params as any[] | undefined)) as any;
      return { affectedRows: Number(result?.affectedRows ?? 0), insertId: result?.insertId };
    },
  };
}

function sqlAlias(alias?: string): string {
  if (!alias) return "";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error("Invalid SQL alias");
  }
  return `${alias}.`;
}

/** Tenant-only predicate for records whose settings are global to a restaurant. */
export function tenantPredicate(
  tenantId: string,
  alias?: string,
): { sql: string; params: [string] } {
  const prefix = sqlAlias(alias);
  return { sql: `${prefix}tenantId = ?`, params: [tenantId] };
}

/** Tenant-constrained identifier predicate for global restaurant records. */
export function tenantIdentifierPredicate(
  tenantId: string,
  id: string,
  alias?: string,
): { sql: string; params: [string, string] } {
  const prefix = sqlAlias(alias);
  return {
    sql: `${prefix}tenantId = ? AND ${prefix}id = ?`,
    params: [tenantId, id],
  };
}

/** Shared MariaDB null-safe scope predicate for all scoped repositories. */
export function tenantLocationPredicate(
  scope: RestaurantResourceScope,
  alias?: string,
): { sql: string; params: [string, string | null] } {
  const prefix = sqlAlias(alias);
  return {
    sql: `${prefix}tenantId = ? AND ${prefix}locationId <=> ?`,
    params: [scope.tenantId, scope.locationId],
  };
}

/** Tenant/scope-constrained identifier predicate for later scoped repositories. */
export function tenantLocationIdentifierPredicate(
  scope: RestaurantResourceScope,
  id: string,
  alias?: string,
): { sql: string; params: [string, string | null, string] } {
  const prefix = sqlAlias(alias);
  return {
    sql: `${prefix}tenantId = ? AND ${prefix}locationId <=> ? AND ${prefix}id = ?`,
    params: [scope.tenantId, scope.locationId, id],
  };
}

type DatabaseRow = Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function milliseconds(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value as string | number).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapProfile(row: DatabaseRow): StoredRestaurantProfile {
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    restaurantName: text(row.clinicName),
    ownerOrManagerName: text(row.clinicianName),
    accountPhone: text(row.phone),
    teamSize: text(row.practiceSize),
    publicEmail: text(row.email),
    contactNumber: text(row.contactNo),
    whatsappNumber: text(row.whatsappNo),
    landline: text(row.landlineNo),
    address: text(row.address),
    cuisineOrServices: text(row.services),
    description: text(row.shortDescription),
  };
}

function mapHours(row: DatabaseRow): StoredRestaurantHours {
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    dayOfWeek: Number(row.dayOfWeek),
    openTime: text(row.openTime),
    closeTime: text(row.closeTime),
    isClosed: bool(row.isClosed),
  };
}

function mapVerification(row: DatabaseRow): StoredEmailVerification {
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    accountType: row.accountType as AccountType,
    accountId: text(row.accountId),
    targetEmail: text(row.targetEmail),
    codeHash: text(row.codeHash),
    issuedAtMs: milliseconds(row.createdAt),
    expiresAtMs: milliseconds(row.expiresAt),
    resendAvailableAtMs: milliseconds(row.resendAvailableAt),
    consumedAtMs: row.consumedAt == null ? null : milliseconds(row.consumedAt),
  };
}

function mapWhatsAppConfig(row: DatabaseRow): WhatsAppAlertConfig {
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    phoneNumber: text(row.phoneNumber),
    isEnabled: bool(row.isEnabled),
  };
}

function nullableText(value: unknown): string | null {
  return value == null ? null : String(value);
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapClosureDay(row: DatabaseRow): ClosureDay {
  const tableId = nullableText(row.tableId);
  return {
    id: text(row.id),
    date: text(row.closureDate),
    scope:
      row.scopeType === "table" && tableId ? { type: "table", tableId } : { type: "restaurant" },
    reason: text(row.reason),
    isHoliday: bool(row.isHoliday),
    affectedBookingCount: number(row.affectedBookingCount),
    locationId: nullableText(row.locationId),
  };
}

function mapDiningArea(row: DatabaseRow): DiningArea {
  return {
    id: text(row.id),
    name: text(row.name),
    displayOrder: number(row.displayOrder, 1),
    tableCount: number(row.tableCount),
    locationId: nullableText(row.locationId),
  };
}

function mapRestaurantTable(row: DatabaseRow): StoredRestaurantTable {
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    name: text(row.name),
    seatCapacity: number(row.seatCapacity),
    area: text(row.area),
    displayOrder: number(row.displayOrder, 1),
    state: row.state === "inactive" ? "inactive" : "active",
    locationId: nullableText(row.locationId),
    areaId: nullableText(row.areaId),
    closureCount: number(row.closureCount),
  };
}

function mapMenuItem(row: DatabaseRow): MenuItem {
  return {
    id: text(row.itemId ?? row.id),
    categoryId: text(row.itemCategoryId ?? row.categoryId),
    name: text(row.itemName ?? row.name),
    priceMinor: number(row.itemPriceMinor ?? row.priceMinor),
    description: text(row.itemDescription ?? row.description),
    displayOrder: number(row.itemDisplayOrder ?? row.displayOrder, 1),
    state: (row.itemState ?? row.state) === "unavailable" ? "unavailable" : "available",
    locationId: nullableText(row.itemLocationId ?? row.locationId),
  };
}

function mapMenuCategory(row: DatabaseRow, items: MenuItem[] = []): MenuCategory {
  return {
    id: text(row.categoryId ?? row.id),
    name: text(row.categoryName ?? row.name),
    displayOrder: number(row.categoryDisplayOrder ?? row.displayOrder, 1),
    items,
    locationId: nullableText(row.categoryLocationId ?? row.locationId),
  };
}

function isDuplicateKey(error: unknown): boolean {
  const value = error as { code?: unknown; errno?: unknown } | null;
  return value?.code === "ER_DUP_ENTRY" || value?.errno === 1062;
}

const PRIMARY_LOCATION_KEY = "__primary__";
const CLOSURE_COLUMNS = `
  closure.id, closure.locationId,
  DATE_FORMAT(closure.closureDate, '%Y-%m-%d') AS closureDate,
  closure.scopeType, closure.tableId, closure.reason, closure.isHoliday`;
const TABLE_COLUMNS = `
  restaurantTable.id, restaurantTable.tenantId, restaurantTable.locationId,
  restaurantTable.name, restaurantTable.seatCapacity, restaurantTable.area,
  restaurantTable.areaId, restaurantTable.displayOrder, restaurantTable.state`;

const ACCOUNT_TABLES: Readonly<Record<AccountType, "User" | "SubUser" | "Location">> = {
  user: "User",
  sub_user: "SubUser",
  location: "Location",
};

function accountTable(accountType: AccountType): "User" | "SubUser" | "Location" {
  const table = ACCOUNT_TABLES[accountType];
  if (!table) throw new Error("Unsupported account type");
  return table;
}

function subUserRole(value: unknown): SubUserRole {
  return (SUB_USER_ROLES as readonly string[]).includes(String(value))
    ? (value as SubUserRole)
    : "reception";
}

function mapSubUser(row: DatabaseRow): StoredSubUser {
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    name: text(row.name),
    email: text(row.email),
    phone: text(row.phone),
    role: subUserRole(row.role),
    isActive: bool(row.isActive),
    profilePhoto: nullableText(row.profilePhoto),
  };
}

function mapBranch(row: DatabaseRow): StoredBranch {
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    name: text(row.name),
    email: text(row.email),
    phone: text(row.phone),
    address: text(row.address),
    city: text(row.city),
    state: text(row.state),
    pincode: text(row.pincode),
    managerName: text(row.managerName),
    profilePhoto: nullableText(row.profilePhoto),
    isActive: bool(row.isActive),
  };
}

const PROFILE_COLUMNS = `
  id, tenantId, clinicName, clinicianName, phone, practiceSize, email,
  contactNo, whatsappNo, landlineNo, address, services, shortDescription`;

const HOURS_COLUMNS = "id, tenantId, dayOfWeek, openTime, closeTime, isClosed";

const VERIFICATION_COLUMNS = `
  verification.id, account.tenantId, verification.accountType,
  verification.accountId, verification.targetEmail, verification.codeHash,
  verification.createdAt, verification.expiresAt,
  verification.resendAvailableAt, verification.consumedAt`;
export class RestaurantSettingsRepository {
  constructor(
    private readonly runner: RepositoryRunner,
    private readonly startTransaction: TransactionStarter | null,
  ) {}

  /** Runs every callback statement on one MariaDB connection. */
  async transaction<T>(work: (repository: RestaurantSettingsRepository) => Promise<T>): Promise<T> {
    if (!this.startTransaction) return work(this);
    return this.startTransaction((connection) =>
      work(new RestaurantSettingsRepository(transactionRunner(connection), null)),
    );
  }

  async getTenantProfile(tenantId: string): Promise<StoredRestaurantProfile | null> {
    const row = await this.runner.queryOne<any>(
      `SELECT ${PROFILE_COLUMNS} FROM ClinicProfile WHERE tenantId = ? LIMIT 1`,
      [tenantId],
    );
    return row ? mapProfile(row) : null;
  }

  async saveTenantProfile(
    tenantId: string,
    profile: RestaurantProfile,
  ): Promise<StoredRestaurantProfile> {
    await this.runner.execute(
      `INSERT INTO ClinicProfile
        (id, tenantId, clinicName, clinicianName, phone, practiceSize, email,
         contactNo, whatsappNo, landlineNo, address, services, shortDescription)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         clinicName = VALUES(clinicName), clinicianName = VALUES(clinicianName),
         phone = VALUES(phone), practiceSize = VALUES(practiceSize),
         email = VALUES(email), contactNo = VALUES(contactNo),
         whatsappNo = VALUES(whatsappNo), landlineNo = VALUES(landlineNo),
         address = VALUES(address), services = VALUES(services),
         shortDescription = VALUES(shortDescription)`,
      [
        crypto.randomUUID(),
        tenantId,
        profile.restaurantName,
        profile.ownerOrManagerName,
        profile.accountPhone,
        profile.teamSize,
        profile.publicEmail,
        profile.contactNumber,
        profile.whatsappNumber,
        profile.landline,
        profile.address,
        profile.cuisineOrServices,
        profile.description,
      ],
    );

    const stored = await this.getTenantProfile(tenantId);
    if (!stored) throw new Error("Restaurant profile could not be read after save");
    return stored;
  }

  /**
   * Synchronizes the tenant owner's compatibility columns with the saved
   * restaurant profile. The tenant-global profile stored in `ClinicProfile`
   * remains the source of truth; this only keeps the owner `User` row's
   * session/legacy display columns (restaurant name, owner name, account phone,
   * and team size) in step. SubUser and Location rows are never rewritten by a
   * profile save, so only the owner's compatibility fields move.
   */
  async syncOwnerProfileCompatibility(tenantId: string, profile: RestaurantProfile): Promise<void> {
    await this.runner.execute(
      `UPDATE User
       SET clinicName = ?, name = ?, phone = ?, practiceSize = ?, updatedAt = NOW()
       WHERE tenantId = ?`,
      [
        profile.restaurantName,
        profile.ownerOrManagerName,
        profile.accountPhone,
        profile.teamSize,
        tenantId,
      ],
    );
  }

  /**
   * Atomically stores the trimmed tenant profile and synchronizes the owner's
   * compatibility fields in one transaction. Any failure leaves both the stored
   * profile and the owner row unchanged.
   */
  async saveRestaurantProfile(
    tenantId: string,
    profile: RestaurantProfile,
  ): Promise<StoredRestaurantProfile> {
    return this.transaction(async (repository) => {
      const stored = await repository.saveTenantProfile(tenantId, profile);
      await repository.syncOwnerProfileCompatibility(tenantId, profile);
      return stored;
    });
  }

  async getTenantHours(tenantId: string): Promise<StoredRestaurantHours[]> {
    const rows = await this.runner.query<any>(
      `SELECT ${HOURS_COLUMNS} FROM RestaurantHours
       WHERE tenantId = ? ORDER BY dayOfWeek ASC`,
      [tenantId],
    );
    return rows.map(mapHours);
  }

  async getTenantHoursForDay(
    tenantId: string,
    dayOfWeek: number,
  ): Promise<StoredRestaurantHours | null> {
    const row = await this.runner.queryOne<any>(
      `SELECT ${HOURS_COLUMNS} FROM RestaurantHours
       WHERE tenantId = ? AND dayOfWeek = ? LIMIT 1`,
      [tenantId, dayOfWeek],
    );
    return row ? mapHours(row) : null;
  }
  async replaceTenantHours(tenantId: string, days: readonly DayHours[]): Promise<void> {
    await this.transaction(async (repository) => {
      for (const day of days) {
        await repository.runner.execute(
          `INSERT INTO RestaurantHours
            (id, tenantId, dayOfWeek, openTime, closeTime, isClosed, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             openTime = VALUES(openTime), closeTime = VALUES(closeTime),
             isClosed = VALUES(isClosed)`,
          [
            crypto.randomUUID(),
            tenantId,
            day.dayOfWeek,
            day.openTime,
            day.closeTime,
            day.isClosed ? 1 : 0,
          ],
        );
      }
    });
  }

  async getEmailVerificationById(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
    verificationId: string,
  ): Promise<StoredEmailVerification | null> {
    const table = accountTable(accountType);
    const row = await this.runner.queryOne<any>(
      `SELECT ${VERIFICATION_COLUMNS}
       FROM AccountEmailVerification AS verification
       INNER JOIN ${table} AS account
         ON account.id = verification.accountId
        AND verification.accountType = ?
       WHERE account.tenantId = ? AND account.id = ?
         AND verification.id = ?
       LIMIT 1`,
      [accountType, tenantId, accountId, verificationId],
    );
    return row ? mapVerification(row) : null;
  }

  async getActiveEmailVerification(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
  ): Promise<StoredEmailVerification | null> {
    const table = accountTable(accountType);
    const row = await this.runner.queryOne<any>(
      `SELECT ${VERIFICATION_COLUMNS}
       FROM AccountEmailVerification AS verification
       INNER JOIN ${table} AS account
         ON account.id = verification.accountId
        AND verification.accountType = ?
       WHERE account.tenantId = ? AND account.id = ?
         AND verification.consumedAt IS NULL
       ORDER BY verification.createdAt DESC
       LIMIT 1`,
      [accountType, tenantId, accountId],
    );
    return row ? mapVerification(row) : null;
  }

  async saveEmailVerification(
    tenantId: string,
    input: SaveEmailVerificationInput,
  ): Promise<string> {
    const id = input.id ?? crypto.randomUUID();
    const table = accountTable(input.accountType);

    return this.transaction(async (repository) => {
      await repository.runner.execute(
        `DELETE verification FROM AccountEmailVerification AS verification
         INNER JOIN ${table} AS account ON account.id = verification.accountId
         WHERE account.tenantId = ? AND account.id = ?
           AND verification.accountType = ? AND verification.consumedAt IS NULL`,
        [tenantId, input.accountId, input.accountType],
      );

      const inserted = await repository.runner.execute(
        `INSERT INTO AccountEmailVerification
          (id, accountType, accountId, targetEmail, codeHash,
           expiresAt, resendAvailableAt, consumedAt, createdAt)
         SELECT ?, ?, account.id, ?, ?, ?, ?, NULL, NOW()
         FROM ${table} AS account
         WHERE account.tenantId = ? AND account.id = ?
         LIMIT 1`,
        [
          id,
          input.accountType,
          input.targetEmail,
          input.codeHash,
          new Date(input.expiresAtMs),
          new Date(input.resendAvailableAtMs),
          tenantId,
          input.accountId,
        ],
      );
      if (inserted.affectedRows !== 1) {
        throw new Error("Restaurant setting not found");
      }
      return id;
    });
  }
  async consumeEmailVerification(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
    verificationId: string,
    consumedAtMs: number,
  ): Promise<boolean> {
    const table = accountTable(accountType);
    const result = await this.runner.execute(
      `UPDATE AccountEmailVerification AS verification
       INNER JOIN ${table} AS account ON account.id = verification.accountId
       SET verification.consumedAt = ?
       WHERE account.tenantId = ? AND account.id = ?
         AND verification.accountType = ? AND verification.id = ?
         AND verification.consumedAt IS NULL`,
      [new Date(consumedAtMs), tenantId, accountId, accountType, verificationId],
    );
    return result.affectedRows === 1;
  }

  async listClosureDays(
    scope: RestaurantResourceScope,
    monthStart: string,
    nextMonthStart: string,
    closureScope?: ClosureScope,
  ): Promise<ClosureDay[]> {
    const scoped = tenantLocationPredicate(scope, "closure");
    const clauses = [scoped.sql, "closure.closureDate >= ?", "closure.closureDate < ?"];
    const params: unknown[] = [...scoped.params, monthStart, nextMonthStart];
    if (closureScope?.type === "restaurant") {
      clauses.push("closure.scopeType = 'restaurant'", "closure.tableId IS NULL");
    } else if (closureScope?.type === "table") {
      clauses.push("closure.scopeType = 'table'", "closure.tableId = ?");
      params.push(closureScope.tableId);
    }

    const rows = await this.runner.query<any>(
      `SELECT ${CLOSURE_COLUMNS},
         CASE WHEN closure.scopeType = 'table' THEN (
           SELECT COUNT(*) FROM Appointment AS booking
           WHERE booking.tenantId = closure.tenantId
             AND booking.locationId <=> closure.locationId
             AND DATE(booking.dateTime) = closure.closureDate
             AND booking.tableId = closure.tableId
         ) ELSE (
           SELECT COUNT(*) FROM Appointment AS booking
           WHERE booking.tenantId = closure.tenantId
             AND booking.locationId <=> closure.locationId
             AND DATE(booking.dateTime) = closure.closureDate
             AND (booking.tableId IS NOT NULL OR booking.partySize IS NOT NULL)
         ) END AS affectedBookingCount
       FROM RestaurantClosureDay AS closure
       WHERE ${clauses.join(" AND ")}
       ORDER BY closure.closureDate ASC, closure.scopeType ASC,
                COALESCE(closure.tableId, '') ASC, closure.id ASC`,
      params,
    );
    return rows.map(mapClosureDay);
  }

  async createClosureDay(
    scope: RestaurantResourceScope,
    input: NormalisedClosureDay,
  ): Promise<CreateClosureDayResult> {
    return this.transaction(async (repository) => {
      if (input.scope.type === "table") {
        const tableScope = tenantLocationIdentifierPredicate(
          scope,
          input.scope.tableId,
          "restaurantTable",
        );
        const table = await repository.runner.queryOne<{ id: string }>(
          `SELECT restaurantTable.id FROM RestaurantTable AS restaurantTable
           WHERE ${tableScope.sql} LIMIT 1 FOR UPDATE`,
          tableScope.params,
        );
        if (!table) return { status: "table_not_found" };
      }

      const id = crypto.randomUUID();
      const tableId = input.scope.type === "table" ? input.scope.tableId : null;
      const scopeKey = tableId ?? "restaurant";
      const result = await repository.runner.execute(
        `INSERT IGNORE INTO RestaurantClosureDay
          (id, tenantId, locationId, locationKey, closureDate, scopeType,
           tableId, scopeKey, reason, isHoliday, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          id,
          scope.tenantId,
          scope.locationId,
          scope.locationId ?? PRIMARY_LOCATION_KEY,
          input.date,
          input.scope.type,
          tableId,
          scopeKey,
          input.reason,
          input.isHoliday ? 1 : 0,
        ],
      );
      return result.affectedRows === 1 ? { status: "created", id } : { status: "duplicate" };
    });
  }

  async deleteClosureDay(
    scope: RestaurantResourceScope,
    closureId: string,
  ): Promise<DeleteScopedRecordResult> {
    const predicate = tenantLocationIdentifierPredicate(scope, closureId);
    const result = await this.runner.execute(
      `DELETE FROM RestaurantClosureDay WHERE ${predicate.sql}`,
      predicate.params,
    );
    return { status: result.affectedRows === 1 ? "deleted" : "not_found" };
  }

  async listDiningAreas(scope: RestaurantResourceScope): Promise<DiningArea[]> {
    const scoped = tenantLocationPredicate(scope, "area");
    const rows = await this.runner.query<any>(
      `SELECT area.id, area.locationId, area.name, area.displayOrder,
         (SELECT COUNT(*) FROM RestaurantTable AS restaurantTable
          WHERE restaurantTable.tenantId = area.tenantId
            AND restaurantTable.locationId <=> area.locationId
            AND (
              restaurantTable.areaId = area.id OR
              (restaurantTable.areaId IS NULL AND
               LOWER(TRIM(restaurantTable.area)) = LOWER(TRIM(area.name)))
            )) AS tableCount
       FROM RestaurantDiningArea AS area
       WHERE ${scoped.sql}
       ORDER BY area.displayOrder ASC, LOWER(area.name) ASC, area.id ASC`,
      scoped.params,
    );
    if (rows.length > 0) return rows.map(mapDiningArea);

    const tableScope = tenantLocationPredicate(scope);
    const mainCount = await this.runner.queryOne<{ tableCount: unknown }>(
      `SELECT COUNT(*) AS tableCount FROM RestaurantTable
       WHERE ${tableScope.sql} AND areaId IS NULL
         AND (NULLIF(TRIM(area), '') IS NULL OR LOWER(TRIM(area)) = LOWER(?))`,
      [...tableScope.params, DEFAULT_DINING_AREA_NAME],
    );
    return [
      {
        id: EFFECTIVE_MAIN_AREA_ID,
        name: DEFAULT_DINING_AREA_NAME,
        displayOrder: 1,
        tableCount: number(mainCount?.tableCount),
        locationId: scope.locationId,
      },
    ];
  }

  async getNextDiningAreaDisplayOrder(tenantId: string): Promise<number> {
    const row = await this.runner.queryOne<{ maxOrder: unknown }>(
      `SELECT COALESCE(MAX(displayOrder), 0) AS maxOrder
       FROM RestaurantDiningArea WHERE tenantId = ?`,
      [tenantId],
    );
    return number(row?.maxOrder) + 1;
  }

  async createDiningArea(
    scope: RestaurantResourceScope,
    input: CreateDiningAreaInput,
  ): Promise<CreateDiningAreaResult> {
    try {
      return await this.transaction(async (repository) => {
        const displayOrder =
          input.displayOrder ?? (await repository.getNextDiningAreaDisplayOrder(scope.tenantId));
        const id = crypto.randomUUID();
        await repository.runner.execute(
          `INSERT INTO RestaurantDiningArea
            (id, tenantId, locationId, name, displayOrder, createdAt)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [id, scope.tenantId, scope.locationId, input.name, displayOrder],
        );
        return {
          status: "created",
          area: {
            id,
            name: input.name,
            displayOrder,
            tableCount: 0,
            locationId: scope.locationId,
          },
        };
      });
    } catch (error) {
      if (isDuplicateKey(error)) return { status: "duplicate" };
      throw error;
    }
  }

  async deleteDiningArea(
    scope: RestaurantResourceScope,
    areaId: string,
  ): Promise<DeleteDiningAreaResult> {
    if (areaId === EFFECTIVE_MAIN_AREA_ID) return { status: "not_found" };
    return this.transaction(async (repository) => {
      const predicate = tenantLocationIdentifierPredicate(scope, areaId, "area");
      const area = await repository.runner.queryOne<{
        id: string;
        name: string;
        assignedTableCount: unknown;
      }>(
        `SELECT area.id, area.name,
           (SELECT COUNT(*) FROM RestaurantTable AS restaurantTable
            WHERE restaurantTable.tenantId = area.tenantId
              AND restaurantTable.locationId <=> area.locationId
              AND (
                restaurantTable.areaId = area.id OR
                (restaurantTable.areaId IS NULL AND
                 LOWER(TRIM(restaurantTable.area)) = LOWER(TRIM(area.name)))
              )) AS assignedTableCount
         FROM RestaurantDiningArea AS area
         WHERE ${predicate.sql} LIMIT 1 FOR UPDATE`,
        predicate.params,
      );
      if (!area) return { status: "not_found" };
      const assignedTableCount = number(area.assignedTableCount);
      if (assignedTableCount > 0) {
        return { status: "assigned_tables", assignedTableCount };
      }
      await repository.runner.execute(
        `DELETE FROM RestaurantDiningArea WHERE tenantId = ? AND locationId <=> ? AND id = ?`,
        [scope.tenantId, scope.locationId, areaId],
      );
      return { status: "deleted" };
    });
  }

  async listRestaurantTables(
    scope: RestaurantResourceScope,
    includeInactive = true,
  ): Promise<StoredRestaurantTable[]> {
    const scoped = tenantLocationPredicate(scope, "restaurantTable");
    const clauses = [scoped.sql];
    const params: unknown[] = [...scoped.params];
    if (!includeInactive) {
      clauses.push("restaurantTable.state = ?");
      params.push("active");
    }
    const rows = await this.runner.query<any>(
      `SELECT ${TABLE_COLUMNS},
         (SELECT COUNT(*) FROM RestaurantClosureDay AS closure
          WHERE closure.tenantId = restaurantTable.tenantId
            AND closure.locationId <=> restaurantTable.locationId
            AND closure.scopeType = 'table'
            AND closure.tableId = restaurantTable.id) AS closureCount
       FROM RestaurantTable AS restaurantTable
       WHERE ${clauses.join(" AND ")}
       ORDER BY LOWER(restaurantTable.area) ASC,
                restaurantTable.displayOrder ASC,
                LOWER(restaurantTable.name) ASC, restaurantTable.id ASC`,
      params,
    );
    return rows.map(mapRestaurantTable);
  }

  private async resolveCanonicalTableArea(
    scope: RestaurantResourceScope,
    areaId: string,
  ): Promise<{ areaId: string | null; name: string } | null> {
    if (areaId === EFFECTIVE_MAIN_AREA_ID) {
      const scoped = tenantLocationPredicate(scope);
      const row = await this.runner.queryOne<{ total: unknown }>(
        `SELECT COUNT(*) AS total FROM RestaurantDiningArea WHERE ${scoped.sql}`,
        scoped.params,
      );
      return number(row?.total) === 0 ? { areaId: null, name: DEFAULT_DINING_AREA_NAME } : null;
    }
    const predicate = tenantLocationIdentifierPredicate(scope, areaId);
    const row = await this.runner.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM RestaurantDiningArea WHERE ${predicate.sql} LIMIT 1`,
      predicate.params,
    );
    return row ? { areaId: row.id, name: row.name } : null;
  }

  async createRestaurantTable(
    scope: RestaurantResourceScope,
    input: SaveScopedRestaurantTableInput,
  ): Promise<SaveScopedRestaurantTableResult> {
    try {
      return await this.transaction(async (repository) => {
        const area = await repository.resolveCanonicalTableArea(scope, input.areaId);
        if (!area) return { status: "area_not_found" };
        const id = crypto.randomUUID();
        await repository.runner.execute(
          `INSERT INTO RestaurantTable
            (id, tenantId, locationId, name, seatCapacity, area, areaId,
             displayOrder, state, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            id,
            scope.tenantId,
            scope.locationId,
            input.name,
            input.seatCapacity,
            area.name,
            area.areaId,
            input.displayOrder,
            input.state === "inactive" ? "inactive" : "active",
          ],
        );
        return {
          status: "saved",
          table: {
            id,
            tenantId: scope.tenantId,
            locationId: scope.locationId,
            name: input.name,
            seatCapacity: input.seatCapacity,
            area: area.name,
            areaId: area.areaId,
            displayOrder: input.displayOrder,
            state: input.state === "inactive" ? "inactive" : "active",
            closureCount: 0,
          },
        };
      });
    } catch (error) {
      if (isDuplicateKey(error)) return { status: "duplicate" };
      throw error;
    }
  }

  async updateRestaurantTable(
    scope: RestaurantResourceScope,
    tableId: string,
    input: SaveScopedRestaurantTableInput,
  ): Promise<SaveScopedRestaurantTableResult> {
    try {
      return await this.transaction(async (repository) => {
        const tablePredicate = tenantLocationIdentifierPredicate(scope, tableId, "restaurantTable");
        const existing = await repository.runner.queryOne<{ id: string }>(
          `SELECT restaurantTable.id FROM RestaurantTable AS restaurantTable
           WHERE ${tablePredicate.sql} LIMIT 1 FOR UPDATE`,
          tablePredicate.params,
        );
        if (!existing) return { status: "not_found" };
        const area = await repository.resolveCanonicalTableArea(scope, input.areaId);
        if (!area) return { status: "area_not_found" };
        await repository.runner.execute(
          `UPDATE RestaurantTable
           SET name = ?, seatCapacity = ?, area = ?, areaId = ?,
               displayOrder = ?, state = ?
           WHERE tenantId = ? AND locationId <=> ? AND id = ?`,
          [
            input.name,
            input.seatCapacity,
            area.name,
            area.areaId,
            input.displayOrder,
            input.state === "inactive" ? "inactive" : "active",
            scope.tenantId,
            scope.locationId,
            tableId,
          ],
        );
        return {
          status: "saved",
          table: {
            id: tableId,
            tenantId: scope.tenantId,
            locationId: scope.locationId,
            name: input.name,
            seatCapacity: input.seatCapacity,
            area: area.name,
            areaId: area.areaId,
            displayOrder: input.displayOrder,
            state: input.state === "inactive" ? "inactive" : "active",
            closureCount: 0,
          },
        };
      });
    } catch (error) {
      if (isDuplicateKey(error)) return { status: "duplicate" };
      throw error;
    }
  }

  async deleteRestaurantTable(
    scope: RestaurantResourceScope,
    tableId: string,
  ): Promise<DeleteScopedRestaurantTableResult> {
    return this.transaction(async (repository) => {
      const predicate = tenantLocationIdentifierPredicate(scope, tableId, "restaurantTable");
      const table = await repository.runner.queryOne<{ id: string }>(
        `SELECT restaurantTable.id FROM RestaurantTable AS restaurantTable
         WHERE ${predicate.sql} LIMIT 1 FOR UPDATE`,
        predicate.params,
      );
      if (!table) return { status: "not_found" };
      const closures = await repository.runner.execute(
        `DELETE FROM RestaurantClosureDay
         WHERE tenantId = ? AND locationId <=> ?
           AND scopeType = 'table' AND tableId = ?`,
        [scope.tenantId, scope.locationId, tableId],
      );
      await repository.runner.execute(
        `DELETE FROM RestaurantTable
         WHERE tenantId = ? AND locationId <=> ? AND id = ?`,
        [scope.tenantId, scope.locationId, tableId],
      );
      return { status: "deleted", deletedClosureCount: closures.affectedRows };
    });
  }

  /**
   * Serializes every menu create for a tenant on its stable owner row. Both
   * category and item creates take this lock before counting, so concurrent
   * transactions cannot independently observe capacity and exceed a hard cap.
   */
  private async lockTenantMenuCreation(tenantId: string): Promise<void> {
    const owner = await this.runner.queryOne<{ id: string }>(
      `SELECT id FROM User
       WHERE tenantId = ? ORDER BY id ASC LIMIT 1 FOR UPDATE`,
      [tenantId],
    );
    if (!owner) throw new Error("Restaurant setting not found");
  }

  async listMenu(scope: RestaurantResourceScope, availableOnly = false): Promise<MenuCategory[]> {
    const scoped = tenantLocationPredicate(scope, "category");
    const stateJoin = availableOnly ? " AND item.state = 'available'" : "";
    const rows = await this.runner.query<any>(
      `SELECT
         category.id AS categoryId,
         category.locationId AS categoryLocationId,
         category.name AS categoryName,
         category.displayOrder AS categoryDisplayOrder,
         item.id AS itemId,
         item.locationId AS itemLocationId,
         item.categoryId AS itemCategoryId,
         item.name AS itemName,
         item.priceMinor AS itemPriceMinor,
         item.description AS itemDescription,
         item.displayOrder AS itemDisplayOrder,
         item.state AS itemState
       FROM RestaurantMenuCategory AS category
       LEFT JOIN RestaurantMenuItem AS item
         ON item.tenantId = category.tenantId
        AND item.locationId <=> category.locationId
        AND item.categoryId = category.id${stateJoin}
       WHERE ${scoped.sql}
       ORDER BY category.displayOrder ASC, LOWER(category.name) ASC,
                category.id ASC, item.displayOrder ASC,
                LOWER(item.name) ASC, item.id ASC`,
      scoped.params,
    );

    const categories = new Map<string, MenuCategory>();
    for (const row of rows) {
      const categoryId = text(row.categoryId);
      let category = categories.get(categoryId);
      if (!category) {
        category = mapMenuCategory(row);
        categories.set(categoryId, category);
      }
      if (row.itemId != null) category.items.push(mapMenuItem(row));
    }
    const menu = [...categories.values()];
    return availableOnly ? menu.filter((category) => category.items.length > 0) : menu;
  }

  async listMenuTree(scope: RestaurantResourceScope): Promise<MenuCategory[]> {
    return this.listMenu(scope);
  }

  async createMenuCategory(
    scope: RestaurantResourceScope,
    input: NormalisedMenuCategory,
  ): Promise<SaveMenuCategoryResult> {
    try {
      return await this.transaction(async (repository) => {
        await repository.lockTenantMenuCreation(scope.tenantId);
        const count = await repository.runner.queryOne<{ total: unknown }>(
          `SELECT COUNT(*) AS total FROM RestaurantMenuCategory
           WHERE tenantId = ?`,
          [scope.tenantId],
        );
        if (number(count?.total) >= LIMITS.menuCategoriesPerTenant) {
          return { status: "category_limit" };
        }

        const id = crypto.randomUUID();
        await repository.runner.execute(
          `INSERT INTO RestaurantMenuCategory
            (id, tenantId, locationId, name, displayOrder, createdAt)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [id, scope.tenantId, scope.locationId, input.name, input.displayOrder],
        );
        return {
          status: "saved",
          category: {
            id,
            name: input.name,
            displayOrder: input.displayOrder,
            items: [],
            locationId: scope.locationId,
          },
        };
      });
    } catch (error) {
      if (isDuplicateKey(error)) return { status: "duplicate" };
      throw error;
    }
  }

  async updateMenuCategory(
    scope: RestaurantResourceScope,
    categoryId: string,
    input: NormalisedMenuCategory,
  ): Promise<SaveMenuCategoryResult> {
    try {
      return await this.transaction(async (repository) => {
        const predicate = tenantLocationIdentifierPredicate(scope, categoryId, "category");
        const existing = await repository.runner.queryOne<{ id: string }>(
          `SELECT category.id FROM RestaurantMenuCategory AS category
           WHERE ${predicate.sql} LIMIT 1 FOR UPDATE`,
          predicate.params,
        );
        if (!existing) return { status: "not_found" };
        await repository.runner.execute(
          `UPDATE RestaurantMenuCategory
           SET name = ?, displayOrder = ?
           WHERE tenantId = ? AND locationId <=> ? AND id = ?`,
          [input.name, input.displayOrder, scope.tenantId, scope.locationId, categoryId],
        );
        return {
          status: "saved",
          category: {
            id: categoryId,
            name: input.name,
            displayOrder: input.displayOrder,
            items: [],
            locationId: scope.locationId,
          },
        };
      });
    } catch (error) {
      if (isDuplicateKey(error)) return { status: "duplicate" };
      throw error;
    }
  }

  async saveMenuCategory(
    scope: RestaurantResourceScope,
    input: NormalisedMenuCategory,
    categoryId?: string,
  ): Promise<SaveMenuCategoryResult> {
    return categoryId
      ? this.updateMenuCategory(scope, categoryId, input)
      : this.createMenuCategory(scope, input);
  }

  async createMenuItem(
    scope: RestaurantResourceScope,
    input: NormalisedMenuItem,
  ): Promise<SaveMenuItemResult> {
    return this.transaction(async (repository) => {
      await repository.lockTenantMenuCreation(scope.tenantId);
      const categoryPredicate = tenantLocationIdentifierPredicate(
        scope,
        input.categoryId,
        "category",
      );
      const category = await repository.runner.queryOne<{ id: string }>(
        `SELECT category.id FROM RestaurantMenuCategory AS category
         WHERE ${categoryPredicate.sql} LIMIT 1 FOR UPDATE`,
        categoryPredicate.params,
      );
      if (!category) return { status: "category_not_found" };

      const count = await repository.runner.queryOne<{ total: unknown }>(
        `SELECT COUNT(*) AS total FROM RestaurantMenuItem WHERE tenantId = ?`,
        [scope.tenantId],
      );
      if (number(count?.total) >= LIMITS.menuItemsPerTenant) {
        return { status: "item_limit" };
      }

      const id = crypto.randomUUID();
      await repository.runner.execute(
        `INSERT INTO RestaurantMenuItem
          (id, tenantId, locationId, categoryId, name, priceMinor,
           description, displayOrder, state, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          id,
          scope.tenantId,
          scope.locationId,
          input.categoryId,
          input.name,
          input.priceMinor,
          input.description,
          input.displayOrder,
          input.state,
        ],
      );
      return {
        status: "saved",
        item: {
          id,
          categoryId: input.categoryId,
          name: input.name,
          priceMinor: input.priceMinor,
          description: input.description,
          displayOrder: input.displayOrder,
          state: input.state,
          locationId: scope.locationId,
        },
      };
    });
  }

  async updateMenuItem(
    scope: RestaurantResourceScope,
    itemId: string,
    input: NormalisedMenuItem,
  ): Promise<SaveMenuItemResult> {
    return this.transaction(async (repository) => {
      const categoryPredicate = tenantLocationIdentifierPredicate(
        scope,
        input.categoryId,
        "category",
      );
      const category = await repository.runner.queryOne<{ id: string }>(
        `SELECT category.id FROM RestaurantMenuCategory AS category
         WHERE ${categoryPredicate.sql} LIMIT 1 FOR UPDATE`,
        categoryPredicate.params,
      );
      if (!category) return { status: "category_not_found" };

      const itemPredicate = tenantLocationIdentifierPredicate(scope, itemId, "item");
      const existing = await repository.runner.queryOne<{ id: string }>(
        `SELECT item.id FROM RestaurantMenuItem AS item
         WHERE ${itemPredicate.sql} LIMIT 1 FOR UPDATE`,
        itemPredicate.params,
      );
      if (!existing) return { status: "not_found" };

      await repository.runner.execute(
        `UPDATE RestaurantMenuItem
         SET categoryId = ?, name = ?, priceMinor = ?, description = ?,
             displayOrder = ?, state = ?
         WHERE tenantId = ? AND locationId <=> ? AND id = ?`,
        [
          input.categoryId,
          input.name,
          input.priceMinor,
          input.description,
          input.displayOrder,
          input.state,
          scope.tenantId,
          scope.locationId,
          itemId,
        ],
      );
      return {
        status: "saved",
        item: {
          id: itemId,
          categoryId: input.categoryId,
          name: input.name,
          priceMinor: input.priceMinor,
          description: input.description,
          displayOrder: input.displayOrder,
          state: input.state,
          locationId: scope.locationId,
        },
      };
    });
  }

  async saveMenuItem(
    scope: RestaurantResourceScope,
    input: NormalisedMenuItem,
    itemId?: string,
  ): Promise<SaveMenuItemResult> {
    return itemId ? this.updateMenuItem(scope, itemId, input) : this.createMenuItem(scope, input);
  }

  async updateMenuItemState(
    scope: RestaurantResourceScope,
    itemId: string,
    state: MenuItemState,
  ): Promise<SaveMenuItemResult> {
    return this.transaction(async (repository) => {
      const predicate = tenantLocationIdentifierPredicate(scope, itemId, "item");
      const existing = await repository.runner.queryOne<any>(
        `SELECT item.id, item.locationId, item.categoryId, item.name,
                item.priceMinor, item.description, item.displayOrder, item.state
         FROM RestaurantMenuItem AS item
         WHERE ${predicate.sql} LIMIT 1 FOR UPDATE`,
        predicate.params,
      );
      if (!existing) return { status: "not_found" };
      await repository.runner.execute(
        `UPDATE RestaurantMenuItem SET state = ?
         WHERE tenantId = ? AND locationId <=> ? AND id = ?`,
        [state, scope.tenantId, scope.locationId, itemId],
      );
      return { status: "saved", item: { ...mapMenuItem(existing), state } };
    });
  }

  async deleteMenuItem(
    scope: RestaurantResourceScope,
    itemId: string,
  ): Promise<DeleteMenuItemResult> {
    const predicate = tenantLocationIdentifierPredicate(scope, itemId);
    const result = await this.runner.execute(
      `DELETE FROM RestaurantMenuItem WHERE ${predicate.sql}`,
      predicate.params,
    );
    return { status: result.affectedRows === 1 ? "deleted" : "not_found" };
  }

  async previewMenuCategoryDeletion(
    scope: RestaurantResourceScope,
    categoryId: string,
  ): Promise<PreviewMenuCategoryDeletionResult> {
    const predicate = tenantLocationIdentifierPredicate(scope, categoryId, "category");
    const row = await this.runner.queryOne<{ id: string; itemCount: unknown }>(
      `SELECT category.id, COUNT(item.id) AS itemCount
       FROM RestaurantMenuCategory AS category
       LEFT JOIN RestaurantMenuItem AS item
         ON item.tenantId = category.tenantId
        AND item.locationId <=> category.locationId
        AND item.categoryId = category.id
       WHERE ${predicate.sql}
       GROUP BY category.id`,
      predicate.params,
    );
    if (!row) return { status: "not_found" };
    const itemCount = number(row.itemCount);
    return {
      status: "preview",
      categoryId,
      itemCount,
      confirmationRequired: itemCount > 0,
    };
  }

  async deleteMenuCategory(
    scope: RestaurantResourceScope,
    categoryId: string,
  ): Promise<DeleteMenuCategoryResult> {
    return this.transaction(async (repository) => {
      const predicate = tenantLocationIdentifierPredicate(scope, categoryId, "category");
      const category = await repository.runner.queryOne<{ id: string }>(
        `SELECT category.id FROM RestaurantMenuCategory AS category
         WHERE ${predicate.sql} LIMIT 1 FOR UPDATE`,
        predicate.params,
      );
      if (!category) return { status: "not_found" };
      const items = await repository.runner.execute(
        `DELETE FROM RestaurantMenuItem
         WHERE tenantId = ? AND locationId <=> ? AND categoryId = ?`,
        [scope.tenantId, scope.locationId, categoryId],
      );
      await repository.runner.execute(
        `DELETE FROM RestaurantMenuCategory
         WHERE tenantId = ? AND locationId <=> ? AND id = ?`,
        [scope.tenantId, scope.locationId, categoryId],
      );
      return { status: "deleted", deletedItemCount: items.affectedRows };
    });
  }

  async confirmDeleteMenuCategory(
    scope: RestaurantResourceScope,
    categoryId: string,
  ): Promise<DeleteMenuCategoryResult> {
    return this.deleteMenuCategory(scope, categoryId);
  }

  async getPublicRestaurantMenu(tenantId: string): Promise<MenuCategory[]> {
    return this.listMenu({ tenantId, locationId: null }, true);
  }

  async getWhatsAppConfig(tenantId: string): Promise<WhatsAppAlertConfig | null> {
    const row = await this.runner.queryOne<any>(
      `SELECT id, tenantId, phoneNumber, isEnabled
       FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1`,
      [tenantId],
    );
    return row ? mapWhatsAppConfig(row) : null;
  }

  async saveWhatsAppConfig(
    tenantId: string,
    input: SaveWhatsAppAlertConfigInput,
  ): Promise<WhatsAppAlertConfig> {
    await this.runner.execute(
      `INSERT INTO WhatsAppConfig (id, tenantId, phoneNumber, isEnabled)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         phoneNumber = VALUES(phoneNumber), isEnabled = VALUES(isEnabled)`,
      [crypto.randomUUID(), tenantId, input.phoneNumber, input.isEnabled ? 1 : 0],
    );

    const stored = await this.getWhatsAppConfig(tenantId);
    if (!stored) throw new Error("WhatsApp configuration could not be read after save");
    return stored;
  }

  // -------------------------------------------------------------------------
  // Self-service account security (email / password / photo)
  // -------------------------------------------------------------------------

  /** Reads the signed-in account's own credential row, constrained by tenant. */
  async getAccountSecurity(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
  ): Promise<AccountSecuritySnapshot | null> {
    const table = accountTable(accountType);
    const row = await this.runner.queryOne<any>(
      `SELECT id, email, password, profilePhoto FROM ${table}
       WHERE id = ? AND tenantId = ? LIMIT 1`,
      [accountId, tenantId],
    );
    if (!row) return null;
    return {
      accountType,
      accountId: text(row.id),
      tenantId,
      email: text(row.email),
      passwordHash: text(row.password),
      profilePhoto: nullableText(row.profilePhoto),
    };
  }

  /**
   * Case-insensitive email availability across every account table, excluding
   * the caller's own account. Returns false when any other account already
   * holds the address.
   */
  async isAccountEmailAvailable(
    email: string,
    current: { accountType: AccountType; accountId: string },
  ): Promise<boolean> {
    const normalised = email.trim().toLowerCase();
    const row = await this.runner.queryOne<{ found: unknown }>(
      `SELECT 1 AS found FROM (
         SELECT id, 'user' AS accountType FROM User WHERE LOWER(email) = ?
         UNION ALL
         SELECT id, 'sub_user' AS accountType FROM SubUser WHERE LOWER(email) = ?
         UNION ALL
         SELECT id, 'location' AS accountType FROM Location WHERE LOWER(email) = ?
       ) AS accounts
       WHERE NOT (accounts.accountType = ? AND accounts.id = ?)
       LIMIT 1`,
      [normalised, normalised, normalised, current.accountType, current.accountId],
    );
    return row == null;
  }

  /**
   * Tenant-scoped, case-insensitive email uniqueness across every account table
   * (`User`, `SubUser`, `Location`) for the requesting tenant, optionally
   * excluding one account id (the row being edited). Returns true when no other
   * account within the tenant already holds the address. Mirrors the
   * cross-account availability adapter but constrains every union arm to the
   * tenant so branch/SubUser lifecycle checks never leak across tenants.
   */
  async checkTenantAccountEmailUnique(
    tenantId: string,
    email: string,
    excludeId?: string,
  ): Promise<boolean> {
    const normalised = email.trim().toLowerCase();
    const excluded = (excludeId ?? "").trim();
    const row = await this.runner.queryOne<{ found: unknown }>(
      `SELECT 1 AS found FROM (
         SELECT id FROM User WHERE tenantId = ? AND LOWER(email) = ?
         UNION ALL
         SELECT id FROM SubUser WHERE tenantId = ? AND LOWER(email) = ?
         UNION ALL
         SELECT id FROM Location WHERE tenantId = ? AND LOWER(email) = ?
       ) AS accounts
       WHERE accounts.id <> ?
       LIMIT 1`,
      [tenantId, normalised, tenantId, normalised, tenantId, normalised, excluded],
    );
    return row == null;
  }

  /** Replaces exactly one account's stored password hash. */
  async updateAccountPassword(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
    passwordHash: string,
  ): Promise<boolean> {
    const table = accountTable(accountType);
    const result = await this.runner.execute(
      `UPDATE ${table} SET password = ? WHERE id = ? AND tenantId = ?`,
      [passwordHash, accountId, tenantId],
    );
    return result.affectedRows === 1;
  }

  /** Persists a profile photo URL for exactly one account after upload success. */
  async updateAccountProfilePhoto(
    tenantId: string,
    accountType: AccountType,
    accountId: string,
    profilePhotoUrl: string,
  ): Promise<boolean> {
    const table = accountTable(accountType);
    const result = await this.runner.execute(
      `UPDATE ${table} SET profilePhoto = ? WHERE id = ? AND tenantId = ?`,
      [profilePhotoUrl, accountId, tenantId],
    );
    return result.affectedRows === 1;
  }

  /**
   * Transactionally confirms an email change: rechecks cross-account
   * uniqueness under lock, updates exactly one account row, and consumes every
   * outstanding verification for that account. Any failure leaves the stored
   * email unchanged.
   */
  async confirmAccountEmailChange(
    tenantId: string,
    input: AccountEmailChangeInput,
  ): Promise<AccountEmailChangeResult> {
    const table = accountTable(input.accountType);
    return this.transaction(async (repository) => {
      const account = await repository.runner.queryOne<{ id: string }>(
        `SELECT id FROM ${table} WHERE id = ? AND tenantId = ? LIMIT 1 FOR UPDATE`,
        [input.accountId, tenantId],
      );
      if (!account) return { status: "not_found" };

      const consumed = await repository.consumeEmailVerification(
        tenantId,
        input.accountType,
        input.accountId,
        input.verificationId,
        input.consumedAtMs,
      );
      if (!consumed) return { status: "verification_invalid" };

      const available = await repository.isAccountEmailAvailable(input.targetEmail, {
        accountType: input.accountType,
        accountId: input.accountId,
      });
      if (!available) return { status: "email_taken" };

      const updated = await repository.runner.execute(
        `UPDATE ${table} SET email = ? WHERE id = ? AND tenantId = ?`,
        [input.targetEmail, input.accountId, tenantId],
      );
      if (updated.affectedRows !== 1) return { status: "not_found" };

      // Consume any other outstanding verifications for this account.
      await repository.runner.execute(
        `UPDATE AccountEmailVerification AS verification
         INNER JOIN ${table} AS account ON account.id = verification.accountId
         SET verification.consumedAt = ?
         WHERE account.tenantId = ? AND account.id = ?
           AND verification.accountType = ? AND verification.consumedAt IS NULL`,
        [new Date(input.consumedAtMs), tenantId, input.accountId, input.accountType],
      );
      return { status: "updated" };
    });
  }

  // -------------------------------------------------------------------------
  // Tenant-scoped SubUser lifecycle
  // -------------------------------------------------------------------------

  async listSubUsers(tenantId: string): Promise<StoredSubUser[]> {
    const rows = await this.runner.query<any>(
      `SELECT id, tenantId, name, email, phone, role, isActive, profilePhoto
       FROM SubUser WHERE tenantId = ?
       ORDER BY role ASC, LOWER(name) ASC, id ASC`,
      [tenantId],
    );
    return rows.map(mapSubUser);
  }

  async getSubUserRoleCounts(tenantId: string): Promise<UserRoleCounts> {
    const rows = await this.runner.query<{ role: unknown; total: unknown }>(
      `SELECT role, COUNT(*) AS total FROM SubUser
       WHERE tenantId = ? GROUP BY role`,
      [tenantId],
    );
    const counts: UserRoleCounts = { doctor: 0, reception: 0 };
    for (const row of rows) {
      const role = subUserRole(row.role);
      counts[role] = number(row.total);
    }
    return counts;
  }

  async createSubUser(tenantId: string, input: CreateSubUserInput): Promise<CreateSubUserResult> {
    try {
      const id = crypto.randomUUID();
      await this.runner.execute(
        `INSERT INTO SubUser
          (id, tenantId, name, email, phone, role, password, isActive, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          id,
          tenantId,
          input.name,
          input.email,
          input.phone || null,
          input.role,
          input.passwordHash,
          input.isActive ? 1 : 0,
        ],
      );
      return { status: "created", id };
    } catch (error) {
      if (isDuplicateKey(error)) return { status: "duplicate" };
      throw error;
    }
  }

  async updateSubUser(
    tenantId: string,
    subUserId: string,
    input: UpdateSubUserInput,
  ): Promise<UpdateSubUserResult> {
    try {
      return await this.transaction(async (repository) => {
        const existing = await repository.runner.queryOne<{ id: string }>(
          `SELECT id FROM SubUser WHERE id = ? AND tenantId = ? LIMIT 1 FOR UPDATE`,
          [subUserId, tenantId],
        );
        if (!existing) return { status: "not_found" };

        const columns = ["name = ?", "email = ?", "phone = ?", "role = ?", "isActive = ?"];
        const params: unknown[] = [
          input.name,
          input.email,
          input.phone || null,
          input.role,
          input.isActive ? 1 : 0,
        ];
        if (input.passwordHash !== undefined) {
          columns.push("password = ?");
          params.push(input.passwordHash);
        }
        params.push(subUserId, tenantId);
        await repository.runner.execute(
          `UPDATE SubUser SET ${columns.join(", ")} WHERE id = ? AND tenantId = ?`,
          params,
        );
        return { status: "updated" };
      });
    } catch (error) {
      if (isDuplicateKey(error)) return { status: "duplicate" };
      throw error;
    }
  }

  /**
   * Deactivates a SubUser and removes its sessions in one transaction so
   * Feature Access denies subsequent requests immediately.
   */
  async setSubUserActive(
    tenantId: string,
    subUserId: string,
    isActive: boolean,
  ): Promise<SubUserLifecycleResult> {
    return this.transaction(async (repository) => {
      const existing = await repository.runner.queryOne<{ id: string }>(
        `SELECT id FROM SubUser WHERE id = ? AND tenantId = ? LIMIT 1 FOR UPDATE`,
        [subUserId, tenantId],
      );
      if (!existing) return { status: "not_found" };
      await repository.runner.execute(
        `UPDATE SubUser SET isActive = ? WHERE id = ? AND tenantId = ?`,
        [isActive ? 1 : 0, subUserId, tenantId],
      );
      if (!isActive) {
        await repository.runner.execute(
          `DELETE session FROM SubUserSession AS session
           INNER JOIN SubUser AS account ON account.id = session.subUserId
           WHERE account.tenantId = ? AND account.id = ?`,
          [tenantId, subUserId],
        );
      }
      return { status: "updated" };
    });
  }

  /** Removes sessions then the tenant-scoped SubUser row in one transaction. */
  async deleteSubUser(tenantId: string, subUserId: string): Promise<DeleteSubUserResult> {
    return this.transaction(async (repository) => {
      const existing = await repository.runner.queryOne<{ id: string }>(
        `SELECT id FROM SubUser WHERE id = ? AND tenantId = ? LIMIT 1 FOR UPDATE`,
        [subUserId, tenantId],
      );
      if (!existing) return { status: "not_found" };
      await repository.runner.execute(
        `DELETE session FROM SubUserSession AS session
         INNER JOIN SubUser AS account ON account.id = session.subUserId
         WHERE account.tenantId = ? AND account.id = ?`,
        [tenantId, subUserId],
      );
      await repository.runner.execute(`DELETE FROM SubUser WHERE id = ? AND tenantId = ?`, [
        subUserId,
        tenantId,
      ]);
      return { status: "deleted" };
    });
  }

  // -------------------------------------------------------------------------
  // Tenant-scoped Branch (Location) lifecycle
  // -------------------------------------------------------------------------

  async listBranches(tenantId: string): Promise<StoredBranch[]> {
    const rows = await this.runner.query<any>(
      `SELECT id, tenantId, name, email, phone, address, city, state, pincode,
              managerName, profilePhoto, isActive
       FROM Location WHERE tenantId = ?
       ORDER BY LOWER(name) ASC, id ASC`,
      [tenantId],
    );
    return rows.map(mapBranch);
  }

  async getBranchCount(tenantId: string): Promise<number> {
    const row = await this.runner.queryOne<{ total: unknown }>(
      `SELECT COUNT(*) AS total FROM Location WHERE tenantId = ?`,
      [tenantId],
    );
    return number(row?.total);
  }

  async createBranch(tenantId: string, input: CreateBranchInput): Promise<CreateBranchResult> {
    try {
      const id = crypto.randomUUID();
      await this.runner.execute(
        `INSERT INTO Location
          (id, tenantId, name, address, city, state, pincode, phone, email,
           password, managerName, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          id,
          tenantId,
          input.name,
          input.address || null,
          input.city || null,
          input.state || null,
          input.pincode || null,
          input.phone || null,
          input.email,
          input.passwordHash,
          input.managerName || null,
        ],
      );
      return { status: "created", id };
    } catch (error) {
      if (isDuplicateKey(error)) return { status: "duplicate" };
      throw error;
    }
  }

  async updateBranch(
    tenantId: string,
    branchId: string,
    input: UpdateBranchInput,
  ): Promise<UpdateBranchResult> {
    return this.transaction(async (repository) => {
      const existing = await repository.runner.queryOne<{ id: string }>(
        `SELECT id FROM Location WHERE id = ? AND tenantId = ? LIMIT 1 FOR UPDATE`,
        [branchId, tenantId],
      );
      if (!existing) return { status: "not_found" };

      const columns = [
        "name = ?",
        "phone = ?",
        "address = ?",
        "city = ?",
        "state = ?",
        "pincode = ?",
        "managerName = ?",
        "isActive = ?",
      ];
      const params: unknown[] = [
        input.name,
        input.phone || null,
        input.address || null,
        input.city || null,
        input.state || null,
        input.pincode || null,
        input.managerName || null,
        input.isActive ? 1 : 0,
      ];
      if (input.passwordHash !== undefined) {
        columns.push("password = ?");
        params.push(input.passwordHash);
      }
      params.push(branchId, tenantId);
      await repository.runner.execute(
        `UPDATE Location SET ${columns.join(", ")} WHERE id = ? AND tenantId = ?`,
        params,
      );

      if (!input.isActive) {
        await repository.runner.execute(
          `DELETE session FROM LocationSession AS session
           INNER JOIN Location AS account ON account.id = session.locationId
           WHERE account.tenantId = ? AND account.id = ?`,
          [tenantId, branchId],
        );
      }
      return { status: "updated" };
    });
  }

  /** Deactivates a branch and revokes its sessions in one transaction. */
  async setBranchActive(
    tenantId: string,
    branchId: string,
    isActive: boolean,
  ): Promise<BranchLifecycleResult> {
    return this.transaction(async (repository) => {
      const existing = await repository.runner.queryOne<{ id: string }>(
        `SELECT id FROM Location WHERE id = ? AND tenantId = ? LIMIT 1 FOR UPDATE`,
        [branchId, tenantId],
      );
      if (!existing) return { status: "not_found" };
      await repository.runner.execute(
        `UPDATE Location SET isActive = ? WHERE id = ? AND tenantId = ?`,
        [isActive ? 1 : 0, branchId, tenantId],
      );
      if (!isActive) {
        await repository.runner.execute(
          `DELETE session FROM LocationSession AS session
           INNER JOIN Location AS account ON account.id = session.locationId
           WHERE account.tenantId = ? AND account.id = ?`,
          [tenantId, branchId],
        );
      }
      return { status: "updated" };
    });
  }

  /** Removes sessions then the tenant-scoped branch row in one transaction. */
  async deleteBranch(tenantId: string, branchId: string): Promise<DeleteBranchResult> {
    return this.transaction(async (repository) => {
      const existing = await repository.runner.queryOne<{ id: string }>(
        `SELECT id FROM Location WHERE id = ? AND tenantId = ? LIMIT 1 FOR UPDATE`,
        [branchId, tenantId],
      );
      if (!existing) return { status: "not_found" };
      await repository.runner.execute(
        `DELETE session FROM LocationSession AS session
         INNER JOIN Location AS account ON account.id = session.locationId
         WHERE account.tenantId = ? AND account.id = ?`,
        [tenantId, branchId],
      );
      await repository.runner.execute(`DELETE FROM Location WHERE id = ? AND tenantId = ?`, [
        branchId,
        tenantId,
      ]);
      return { status: "deleted" };
    });
  }
}

export function createRestaurantSettingsRepository(
  database: RestaurantSettingsRepositoryDatabase = defaultDatabase,
): RestaurantSettingsRepository {
  return new RestaurantSettingsRepository(database, (work) => database.withTransaction(work));
}

/** Default production repository; tests can inject a fake with the factory. */
export const restaurantSettingsRepository = createRestaurantSettingsRepository();

export const getTenantProfile = (tenantId: string) =>
  restaurantSettingsRepository.getTenantProfile(tenantId);
export const saveTenantProfile = (tenantId: string, profile: RestaurantProfile) =>
  restaurantSettingsRepository.saveTenantProfile(tenantId, profile);
export const saveRestaurantProfile = (tenantId: string, profile: RestaurantProfile) =>
  restaurantSettingsRepository.saveRestaurantProfile(tenantId, profile);
export const getTenantHours = (tenantId: string) =>
  restaurantSettingsRepository.getTenantHours(tenantId);
export const replaceTenantHours = (tenantId: string, days: readonly DayHours[]) =>
  restaurantSettingsRepository.replaceTenantHours(tenantId, days);
export const getWhatsAppConfig = (tenantId: string) =>
  restaurantSettingsRepository.getWhatsAppConfig(tenantId);
export const saveWhatsAppConfig = (tenantId: string, input: SaveWhatsAppAlertConfigInput) =>
  restaurantSettingsRepository.saveWhatsAppConfig(tenantId, input);

// ---------------------------------------------------------------------------
// Strict WhatsApp settings adapter
//
// The Settings panel needs an explicit `ERROR` state, so this adapter reads
// status strictly (a transport failure becomes `ERROR` instead of being hidden
// as `DISCONNECTED`) and never reports a state-changing action as successful
// when the microservice fails or does not confirm success. Booking
// notifications keep using the tolerant client helpers directly.
// ---------------------------------------------------------------------------

export type WhatsAppSessionState = WAStatus["state"];

export interface WhatsAppSettingsStatus {
  state: WhatsAppSessionState;
  qrDataUrl: string;
  connectedNumber: string;
  queueCount: number;
  sentCount: number;
  sentLog: WASentLog[];
}

export type WhatsAppActionOutcome = { status: "ok" } | { status: "error" };

/** Injectable microservice surface; every method may reject on transport failure. */
export interface WhatsAppMicroserviceClient {
  getStatus(tenantId: string): Promise<WAStatus>;
  initialize(tenantId: string): Promise<{ success: boolean }>;
  disconnect(tenantId: string): Promise<{ success: boolean }>;
  enqueue(tenantId: string, phone: string, body: string): Promise<{ success: boolean }>;
}

const defaultWhatsAppClient: WhatsAppMicroserviceClient = {
  getStatus: (tenantId) => getWAStatusStrict(tenantId),
  initialize: (tenantId) => initializeWA(tenantId),
  disconnect: (tenantId) => disconnectWA(tenantId),
  enqueue: (tenantId, phone, body) => enqueueWA(tenantId, phone, body),
};

export class WhatsAppSettingsAdapter {
  constructor(private readonly client: WhatsAppMicroserviceClient) {}

  /** Reads session state strictly; any transport failure surfaces as `ERROR`. */
  async readStatus(tenantId: string): Promise<WhatsAppSettingsStatus> {
    try {
      return this.normalise(await this.client.getStatus(tenantId));
    } catch {
      return {
        state: "ERROR",
        qrDataUrl: "",
        connectedNumber: "",
        queueCount: 0,
        sentCount: 0,
        sentLog: [],
      };
    }
  }

  private normalise(status: WAStatus): WhatsAppSettingsStatus {
    const sentLog = Array.isArray(status?.sentLog) ? status.sentLog : [];
    return {
      state: status?.state ?? "ERROR",
      qrDataUrl: status?.qrDataUrl ?? "",
      connectedNumber: status?.connectedNumber ?? "",
      queueCount: Number.isFinite(status?.queueCount) ? Number(status.queueCount) : 0,
      sentCount: sentLog.filter((entry) => entry?.status === "sent").length,
      sentLog,
    };
  }

  /** (Re-)initializes pairing; reports `error` unless the service confirms success. */
  async initialize(tenantId: string): Promise<WhatsAppActionOutcome> {
    return this.action(() => this.client.initialize(tenantId));
  }

  /** Disconnects the paired device; reports `error` unless success is confirmed. */
  async disconnect(tenantId: string): Promise<WhatsAppActionOutcome> {
    return this.action(() => this.client.disconnect(tenantId));
  }

  /** Enqueues a test message; a failed enqueue never reports success. */
  async sendTestMessage(
    tenantId: string,
    phone: string,
    body: string,
  ): Promise<WhatsAppActionOutcome> {
    return this.action(() => this.client.enqueue(tenantId, phone, body));
  }

  private async action(run: () => Promise<{ success: boolean }>): Promise<WhatsAppActionOutcome> {
    try {
      const result = await run();
      return result?.success === true ? { status: "ok" } : { status: "error" };
    } catch {
      return { status: "error" };
    }
  }
}

export function createWhatsAppSettingsAdapter(
  client: WhatsAppMicroserviceClient = defaultWhatsAppClient,
): WhatsAppSettingsAdapter {
  return new WhatsAppSettingsAdapter(client);
}

/** Default production adapter; tests inject a fake microservice client. */
export const whatsAppSettingsAdapter = createWhatsAppSettingsAdapter();
