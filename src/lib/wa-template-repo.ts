// ─────────────────────────────────────────────────────────────────────────────
// wa-template-repo.ts  (server)
//
// All SQL for the template tables behind a single `TemplateRepo` interface. The
// real implementation uses the raw-SQL helpers (query / queryOne / execute /
// withTransaction) from db.ts. There are NO Graph calls here — this layer is
// pure persistence. The service modules (FEAT-002/003/004) depend only on the
// `TemplateRepo` interface, so tests can swap in the in-memory double
// (wa-template-repo.memory.ts) via __setTemplateRepoForTests().
//
// Locking (§8.3):
//   • Submission claim (DP-17): an atomic UPDATE that wins only when no live
//     claim exists (opState NULL) or the existing claim is stale (>120s). The
//     op proceeds only when affectedRows === 1.
//   • Sync lease (DP-12): an atomic UPDATE on WaCloudRuntime that takes a
//     10-minute lease only when none is held or the current one has expired.
//
// Every write mirrors the legacy `status VARCHAR(16)` column via LEFT(value,16)
// (DP-14) so a code rollback still reads sensible values. No UPDATE/DELETE is
// ever run against existing rows outside these documented writes (R-DB-01).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import type { PoolConnection } from "mariadb";
import { execute, query, queryOne, withTransaction } from "./db";
import type {
  CatalogueField,
  ParameterFormat,
  TemplateButton,
  TemplateSource,
} from "./wa-template-model";

// ─────────────────────────────────────────────────────────────────────────────
// Row-shaped records returned by the repo.
// ─────────────────────────────────────────────────────────────────────────────
export interface TemplateRow {
  id: string;
  name: string;
  language: string;
  category: string;
  bodyText: string;
  components: unknown | null;
  displayTitle: string | null;
  description: string | null;
  purpose: string | null;
  parameterFormat: ParameterFormat;
  footerText: string | null;
  headerType: string | null;
  headerText: string | null;
  headerImageUrl: string | null;
  buttons: TemplateButton[] | null;
  variableMappings: Record<string, CatalogueField> | null;
  sampleValues: Record<string, string> | null;
  source: TemplateSource;
  localState: string | null;
  opState: string | null;
  opKind: string | null;
  opClaimedAt: Date | null;
  status: string;
  metaStatus: string | null;
  metaCategory: string | null;
  metaTemplateId: string | null;
  notifyKind: string | null;
  qualityScore: string | null;
  rejectionDetail: string | null;
  rejectionReason: string | null;
  messagingAccountId: string | null;
  lastSubmittedAt: Date | null;
  lastSyncedAt: Date | null;
  metaUpdatedAt: Date | null;
  archivedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DraftInput {
  id?: string;
  name: string;
  language: string;
  category: string;
  parameterFormat: ParameterFormat;
  headerType: string;
  headerText?: string | null;
  bodyText: string;
  footerText?: string | null;
  buttons: TemplateButton[];
  variableMappings: Record<string, CatalogueField>;
  sampleValues: Record<string, string>;
  displayTitle?: string | null;
  description?: string | null;
  purpose?: string | null;
  notifyKind?: string | null;
  source?: TemplateSource;
  actorId?: string | null;
}

export interface ListQuery {
  search?: string;
  source?: TemplateSource;
  metaStatus?: string;
  category?: string;
  notifyKind?: string;
  includeArchived?: boolean;
  sort?: "name" | "updatedAt" | "createdAt" | "metaStatus";
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ListResult {
  rows: TemplateRow[];
  total: number;
}

export interface RevisionRow {
  id: string;
  templateId: string;
  revisionNo: number;
  snapshot: unknown;
  submittedPayload: unknown | null;
  metaStatusAtSnapshot: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface ActivityRow {
  id: string;
  templateId: string | null;
  action: string;
  detail: unknown | null;
  actorId: string | null;
  createdAt: Date;
}

export interface SyncRunRow {
  id: string;
  trigger: "manual" | "scheduled" | "single";
  status: "running" | "ok" | "error";
  scanned: number;
  updated: number;
  created: number;
  skipped: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface NotifyMappingRow {
  id: string;
  notifyKind: string;
  /** Business category the mapping applies to, or '*' for every category. */
  businessCategory: string;
  templateId: string;
  language: string;
  isEnabled: boolean;
  optInAckAt: Date | null;
  optInAckBy: string | null;
  optInAckVersion: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardSummary {
  total: number;
  byBucket: Record<string, number>;
  byStatus: Record<string, number>;
  lastSyncOkAt: Date | null;
  lastApiOkAt: Date | null;
}

export type ClaimKind = "CREATE" | "EDIT" | "DELETE";

// ─────────────────────────────────────────────────────────────────────────────
// The interface every service and test depends on.
// ─────────────────────────────────────────────────────────────────────────────
export interface TemplateRepo {
  // Draft CRUD
  createDraft(input: DraftInput): Promise<TemplateRow>;
  updateDraft(id: string, input: DraftInput): Promise<TemplateRow | null>;
  getById(id: string): Promise<TemplateRow | null>;
  getByNameLanguage(name: string, language: string): Promise<TemplateRow | null>;
  getByMetaTemplateId(metaTemplateId: string): Promise<TemplateRow | null>;
  deleteDraft(id: string): Promise<boolean>;
  archiveDraft(id: string, actorId: string | null): Promise<boolean>;
  unarchiveDraft(id: string, actorId: string | null): Promise<boolean>;

  // Listing + dashboard
  list(q: ListQuery): Promise<ListResult>;
  dashboard(): Promise<DashboardSummary>;

  // Meta state writes (used by sync + webhook in later FEATs)
  applyMetaState(
    id: string,
    patch: Partial<{
      metaStatus: string;
      metaCategory: string;
      qualityScore: string;
      rejectionDetail: string;
      metaTemplateId: string;
      messagingAccountId: string;
      metaUpdatedAt: Date;
      lastSyncedAt: Date;
      lastSubmittedAt: Date;
      localState: string;
      source: TemplateSource;
    }>,
  ): Promise<void>;

  // Atomic submission claim (DP-17)
  claimOp(id: string, kind: ClaimKind, actorId: string | null): Promise<boolean>;
  setOpState(id: string, opState: "UNCERTAIN" | null): Promise<void>;

  // Sync lease (DP-12)
  acquireSyncLease(holder: string): Promise<boolean>;
  releaseSyncLease(holder: string): Promise<void>;
  markSyncOk(): Promise<void>;
  markApiOk(): Promise<void>;

  // Revisions
  addRevision(
    templateId: string,
    snapshot: unknown,
    submittedPayload: unknown | null,
    metaStatusAtSnapshot: string | null,
    createdBy: string | null,
  ): Promise<RevisionRow>;
  listRevisions(templateId: string): Promise<RevisionRow[]>;

  // Activity
  addActivity(
    templateId: string | null,
    action: string,
    detail: unknown | null,
    actorId: string | null,
  ): Promise<ActivityRow>;
  listActivity(templateId: string | null, limit?: number): Promise<ActivityRow[]>;

  // Sync runs
  startSyncRun(trigger: SyncRunRow["trigger"]): Promise<SyncRunRow>;
  finishSyncRun(id: string, patch: Partial<SyncRunRow>): Promise<void>;
  listSyncRuns(limit?: number): Promise<SyncRunRow[]>;

  // Notify mappings — one per (notifyKind, businessCategory); '*' = all categories.
  upsertMapping(input: {
    notifyKind: string;
    businessCategory?: string;
    templateId: string;
    language: string;
    actorId: string | null;
  }): Promise<NotifyMappingRow>;
  setMappingEnabled(
    notifyKind: string,
    enabled: boolean,
    optIn: { version: string; actorId: string | null } | null,
    businessCategory?: string,
  ): Promise<NotifyMappingRow | null>;
  removeMapping(notifyKind: string, businessCategory?: string): Promise<boolean>;
  getMapping(notifyKind: string, businessCategory?: string): Promise<NotifyMappingRow | null>;
  listMappings(): Promise<NotifyMappingRow[]>;
}

/** Category key used for mappings that apply to every business category. */
export const ALL_CATEGORIES_KEY = "*";

// ─────────────────────────────────────────────────────────────────────────────
// Column / value helpers.
// ─────────────────────────────────────────────────────────────────────────────
function newId(): string {
  return crypto.randomUUID();
}

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function toRow(r: Record<string, unknown>): TemplateRow {
  return {
    id: String(r.id),
    name: String(r.name),
    language: String(r.language),
    category: String(r.category),
    bodyText: String(r.bodyText ?? ""),
    components: parseJson(r.components),
    displayTitle: (r.displayTitle as string) ?? null,
    description: (r.description as string) ?? null,
    purpose: (r.purpose as string) ?? null,
    parameterFormat: ((r.parameterFormat as string) || "POSITIONAL") as ParameterFormat,
    footerText: (r.footerText as string) ?? null,
    headerType: (r.headerType as string) ?? null,
    headerText: (r.headerText as string) ?? null,
    headerImageUrl: (r.headerImageUrl as string) ?? null,
    buttons: parseJson<TemplateButton[]>(r.buttons),
    variableMappings: parseJson<Record<string, CatalogueField>>(r.variableMappings),
    sampleValues: parseJson<Record<string, string>>(r.sampleValues),
    source: ((r.source as string) || "LOCAL") as TemplateSource,
    localState: (r.localState as string) ?? null,
    opState: (r.opState as string) ?? null,
    opKind: (r.opKind as string) ?? null,
    opClaimedAt: (r.opClaimedAt as Date) ?? null,
    status: String(r.status ?? ""),
    metaStatus: (r.metaStatus as string) ?? null,
    metaCategory: (r.metaCategory as string) ?? null,
    metaTemplateId: (r.metaTemplateId as string) ?? null,
    notifyKind: (r.notifyKind as string) ?? null,
    qualityScore: (r.qualityScore as string) ?? null,
    rejectionDetail: (r.rejectionDetail as string) ?? null,
    rejectionReason: (r.rejectionReason as string) ?? null,
    messagingAccountId: (r.messagingAccountId as string) ?? null,
    lastSubmittedAt: (r.lastSubmittedAt as Date) ?? null,
    lastSyncedAt: (r.lastSyncedAt as Date) ?? null,
    metaUpdatedAt: (r.metaUpdatedAt as Date) ?? null,
    archivedAt: (r.archivedAt as Date) ?? null,
    createdBy: (r.createdBy as string) ?? null,
    updatedBy: (r.updatedBy as string) ?? null,
    createdAt: (r.createdAt as Date) ?? new Date(),
    updatedAt: (r.updatedAt as Date) ?? new Date(),
  };
}

function toMappingRow(r: Record<string, unknown>): NotifyMappingRow {
  return {
    id: String(r.id),
    notifyKind: String(r.notifyKind),
    businessCategory:
      r.businessCategory != null && String(r.businessCategory) !== ""
        ? String(r.businessCategory)
        : "*",
    templateId: String(r.templateId),
    language: String(r.language),
    isEnabled: Number(r.isEnabled) === 1,
    optInAckAt: (r.optInAckAt as Date) ?? null,
    optInAckBy: (r.optInAckBy as string) ?? null,
    optInAckVersion: (r.optInAckVersion as string) ?? null,
    createdBy: (r.createdBy as string) ?? null,
    updatedBy: (r.updatedBy as string) ?? null,
    createdAt: (r.createdAt as Date) ?? new Date(),
    updatedAt: (r.updatedAt as Date) ?? new Date(),
  };
}

function toRevisionRow(r: Record<string, unknown>): RevisionRow {
  return {
    id: String(r.id),
    templateId: String(r.templateId),
    revisionNo: Number(r.revisionNo),
    snapshot: parseJson(r.snapshot),
    submittedPayload: parseJson(r.submittedPayload),
    metaStatusAtSnapshot: (r.metaStatusAtSnapshot as string) ?? null,
    createdBy: (r.createdBy as string) ?? null,
    createdAt: (r.createdAt as Date) ?? new Date(),
  };
}

function toActivityRow(r: Record<string, unknown>): ActivityRow {
  return {
    id: String(r.id),
    templateId: (r.templateId as string) ?? null,
    action: String(r.action),
    detail: parseJson(r.detail),
    actorId: (r.actorId as string) ?? null,
    createdAt: (r.createdAt as Date) ?? new Date(),
  };
}

function toSyncRunRow(r: Record<string, unknown>): SyncRunRow {
  return {
    id: String(r.id),
    trigger: String(r.trigger) as SyncRunRow["trigger"],
    status: String(r.status) as SyncRunRow["status"],
    scanned: Number(r.scanned ?? 0),
    updated: Number(r.updated ?? 0),
    created: Number(r.created ?? 0),
    skipped: Number(r.skipped ?? 0),
    errorCode: (r.errorCode as string) ?? null,
    errorMessage: (r.errorMessage as string) ?? null,
    startedAt: (r.startedAt as Date) ?? new Date(),
    finishedAt: (r.finishedAt as Date) ?? null,
  };
}

/** Mirrors the legacy status column (DP-14): LEFT(value,16). */
function legacyStatus(value: string | null | undefined): string {
  return (value ?? "DRAFT").slice(0, 16);
}

const SORT_COLUMNS: Record<NonNullable<ListQuery["sort"]>, string> = {
  name: "name",
  updatedAt: "updatedAt",
  createdAt: "createdAt",
  metaStatus: "metaStatus",
};

// ─────────────────────────────────────────────────────────────────────────────
// SQL implementation.
// ─────────────────────────────────────────────────────────────────────────────
class SqlTemplateRepo implements TemplateRepo {
  async createDraft(input: DraftInput): Promise<TemplateRow> {
    const id = input.id || newId();
    const metaStatus = null;
    const localState = "DRAFT";
    await execute(
      `INSERT INTO WaCloudTemplate
        (id, name, language, category, bodyText, components, variables, varCount,
         headerType, headerImageUrl, status, rejectionReason, metaTemplateId, notifyKind,
         displayTitle, description, purpose, parameterFormat, footerText, headerText,
         buttons, variableMappings, sampleValues, source, localState, createdBy, updatedBy)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.name,
        input.language,
        input.category,
        input.bodyText,
        null,
        null,
        0,
        input.headerType,
        null,
        legacyStatus(localState),
        null,
        null,
        input.notifyKind ?? null,
        input.displayTitle ?? null,
        input.description ?? null,
        input.purpose ?? null,
        input.parameterFormat,
        input.footerText ?? null,
        input.headerText ?? null,
        JSON.stringify(input.buttons ?? []),
        JSON.stringify(input.variableMappings ?? {}),
        JSON.stringify(input.sampleValues ?? {}),
        input.source ?? "LOCAL",
        localState,
        input.actorId ?? null,
        input.actorId ?? null,
      ],
    );
    void metaStatus;
    const row = await this.getById(id);
    if (!row) throw new Error("createDraft: row not found after insert");
    return row;
  }

  async updateDraft(id: string, input: DraftInput): Promise<TemplateRow | null> {
    const res = await execute(
      `UPDATE WaCloudTemplate SET
         name=?, language=?, category=?, bodyText=?, headerType=?, headerText=?,
         footerText=?, parameterFormat=?, buttons=?, variableMappings=?, sampleValues=?,
         displayTitle=?, description=?, purpose=?, notifyKind=?, updatedBy=?,
         status=LEFT(COALESCE(metaStatus, localState, status, 'DRAFT'),16)
       WHERE id=?`,
      [
        input.name,
        input.language,
        input.category,
        input.bodyText,
        input.headerType,
        input.headerText ?? null,
        input.footerText ?? null,
        input.parameterFormat,
        JSON.stringify(input.buttons ?? []),
        JSON.stringify(input.variableMappings ?? {}),
        JSON.stringify(input.sampleValues ?? {}),
        input.displayTitle ?? null,
        input.description ?? null,
        input.purpose ?? null,
        input.notifyKind ?? null,
        input.actorId ?? null,
        id,
      ],
    );
    if (res.affectedRows === 0) return null;
    return this.getById(id);
  }

  async getById(id: string): Promise<TemplateRow | null> {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM WaCloudTemplate WHERE id=? LIMIT 1",
      [id],
    );
    return r ? toRow(r) : null;
  }

  async getByNameLanguage(name: string, language: string): Promise<TemplateRow | null> {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM WaCloudTemplate WHERE name=? AND language=? LIMIT 1",
      [name, language],
    );
    return r ? toRow(r) : null;
  }

  async getByMetaTemplateId(metaTemplateId: string): Promise<TemplateRow | null> {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM WaCloudTemplate WHERE metaTemplateId=? LIMIT 1",
      [metaTemplateId],
    );
    return r ? toRow(r) : null;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const res = await execute(
      "DELETE FROM WaCloudTemplate WHERE id=? AND metaTemplateId IS NULL AND (localState IS NULL OR localState <> 'SUBMITTED')",
      [id],
    );
    return res.affectedRows > 0;
  }

  async archiveDraft(id: string, actorId: string | null): Promise<boolean> {
    const res = await execute(
      "UPDATE WaCloudTemplate SET archivedAt=NOW(), updatedBy=? WHERE id=? AND metaTemplateId IS NULL",
      [actorId, id],
    );
    return res.affectedRows > 0;
  }

  async unarchiveDraft(id: string, actorId: string | null): Promise<boolean> {
    const res = await execute(
      "UPDATE WaCloudTemplate SET archivedAt=NULL, updatedBy=? WHERE id=?",
      [actorId, id],
    );
    return res.affectedRows > 0;
  }

  async list(q: ListQuery): Promise<ListResult> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.search) {
      // Escape LIKE wildcards (R-LIST-03/05).
      const escaped = q.search.replace(/[\\%_]/g, (c) => `\\${c}`);
      where.push("(name LIKE ? ESCAPE '\\\\' OR displayTitle LIKE ? ESCAPE '\\\\')");
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (q.source) {
      where.push("source=?");
      params.push(q.source);
    }
    if (q.metaStatus) {
      where.push("metaStatus=?");
      params.push(q.metaStatus);
    }
    if (q.category) {
      where.push("category=?");
      params.push(q.category);
    }
    if (q.notifyKind) {
      where.push("notifyKind=?");
      params.push(q.notifyKind);
    }
    if (!q.includeArchived) {
      where.push("archivedAt IS NULL");
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sortCol = SORT_COLUMNS[q.sort ?? "updatedAt"] ?? "updatedAt";
    const dir = q.dir === "asc" ? "ASC" : "DESC";
    const limit = Math.max(1, Math.min(q.limit ?? 50, 100));
    const offset = Math.max(0, q.offset ?? 0);

    const totalRow = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM WaCloudTemplate ${whereSql}`,
      params,
    );
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM WaCloudTemplate ${whereSql} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { rows: rows.map(toRow), total: Number(totalRow?.c ?? 0) };
  }

  async dashboard(): Promise<DashboardSummary> {
    const rows = await query<{ metaStatus: string | null; c: number }>(
      "SELECT metaStatus, COUNT(*) AS c FROM WaCloudTemplate WHERE archivedAt IS NULL GROUP BY metaStatus",
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const key = r.metaStatus || "DRAFT";
      byStatus[key] = (byStatus[key] ?? 0) + Number(r.c);
      total += Number(r.c);
    }
    const { attentionBucket } = await import("./wa-template-model");
    const byBucket: Record<string, number> = {};
    for (const [status, count] of Object.entries(byStatus)) {
      const bucket = status === "DRAFT" ? "pending" : attentionBucket(status);
      byBucket[bucket] = (byBucket[bucket] ?? 0) + count;
    }
    const runtime = await queryOne<{ lastSyncOkAt: Date | null; lastApiOkAt: Date | null }>(
      "SELECT lastSyncOkAt, lastApiOkAt FROM WaCloudRuntime WHERE id='central' LIMIT 1",
    );
    return {
      total,
      byBucket,
      byStatus,
      lastSyncOkAt: runtime?.lastSyncOkAt ?? null,
      lastApiOkAt: runtime?.lastApiOkAt ?? null,
    };
  }

  async applyMetaState(
    id: string,
    patch: Parameters<TemplateRepo["applyMetaState"]>[1],
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => {
      sets.push(`${col}=?`);
      params.push(val);
    };
    if (patch.metaStatus !== undefined) add("metaStatus", patch.metaStatus);
    if (patch.metaCategory !== undefined) add("metaCategory", patch.metaCategory);
    if (patch.qualityScore !== undefined) add("qualityScore", patch.qualityScore);
    if (patch.rejectionDetail !== undefined) add("rejectionDetail", patch.rejectionDetail);
    if (patch.metaTemplateId !== undefined) add("metaTemplateId", patch.metaTemplateId);
    if (patch.messagingAccountId !== undefined) add("messagingAccountId", patch.messagingAccountId);
    if (patch.metaUpdatedAt !== undefined) add("metaUpdatedAt", patch.metaUpdatedAt);
    if (patch.lastSyncedAt !== undefined) add("lastSyncedAt", patch.lastSyncedAt);
    if (patch.lastSubmittedAt !== undefined) add("lastSubmittedAt", patch.lastSubmittedAt);
    if (patch.localState !== undefined) add("localState", patch.localState);
    if (patch.source !== undefined) add("source", patch.source);
    if (sets.length === 0) return;
    // Mirror the legacy status column (DP-14).
    sets.push("status=LEFT(COALESCE(metaStatus, localState, status, 'DRAFT'),16)");
    params.push(id);
    await execute(`UPDATE WaCloudTemplate SET ${sets.join(", ")} WHERE id=?`, params);
  }

  async claimOp(id: string, kind: ClaimKind, actorId: string | null): Promise<boolean> {
    const res = await execute(
      `UPDATE WaCloudTemplate
         SET opState='IN_FLIGHT', opKind=?, opClaimedAt=NOW(), updatedBy=?
       WHERE id=? AND (opState IS NULL OR (opState='IN_FLIGHT' AND opClaimedAt < NOW() - INTERVAL 120 SECOND))`,
      [kind, actorId, id],
    );
    return res.affectedRows === 1;
  }

  async setOpState(id: string, opState: "UNCERTAIN" | null): Promise<void> {
    if (opState === null) {
      await execute(
        "UPDATE WaCloudTemplate SET opState=NULL, opKind=NULL, opClaimedAt=NULL WHERE id=?",
        [id],
      );
    } else {
      await execute("UPDATE WaCloudTemplate SET opState=? WHERE id=?", [opState, id]);
    }
  }

  async acquireSyncLease(holder: string): Promise<boolean> {
    // Ensure the central runtime row exists.
    await execute("INSERT IGNORE INTO WaCloudRuntime (id) VALUES ('central')");
    const res = await execute(
      `UPDATE WaCloudRuntime
         SET syncLeaseHolder=?, syncLeaseUntil=NOW()+INTERVAL 10 MINUTE
       WHERE id='central' AND (syncLeaseUntil IS NULL OR syncLeaseUntil < NOW())`,
      [holder],
    );
    return res.affectedRows === 1;
  }

  async releaseSyncLease(holder: string): Promise<void> {
    await execute(
      "UPDATE WaCloudRuntime SET syncLeaseHolder=NULL, syncLeaseUntil=NULL WHERE id='central' AND syncLeaseHolder=?",
      [holder],
    );
  }

  async markSyncOk(): Promise<void> {
    await execute("INSERT IGNORE INTO WaCloudRuntime (id) VALUES ('central')");
    await execute("UPDATE WaCloudRuntime SET lastSyncOkAt=NOW() WHERE id='central'");
  }

  async markApiOk(): Promise<void> {
    await execute("INSERT IGNORE INTO WaCloudRuntime (id) VALUES ('central')");
    await execute("UPDATE WaCloudRuntime SET lastApiOkAt=NOW() WHERE id='central'");
  }

  async addRevision(
    templateId: string,
    snapshot: unknown,
    submittedPayload: unknown | null,
    metaStatusAtSnapshot: string | null,
    createdBy: string | null,
  ): Promise<RevisionRow> {
    return withTransaction(async (conn: PoolConnection) => {
      const next = await conn.query(
        "SELECT COALESCE(MAX(revisionNo),0)+1 AS n FROM WaTemplateRevision WHERE templateId=?",
        [templateId],
      );
      const revisionNo = Number(next[0]?.n ?? 1);
      const id = newId();
      await conn.query(
        `INSERT INTO WaTemplateRevision
          (id, templateId, revisionNo, snapshot, submittedPayload, metaStatusAtSnapshot, createdBy)
         VALUES (?,?,?,?,?,?,?)`,
        [
          id,
          templateId,
          revisionNo,
          JSON.stringify(snapshot),
          submittedPayload != null ? JSON.stringify(submittedPayload) : null,
          metaStatusAtSnapshot,
          createdBy,
        ],
      );
      const r = await conn.query("SELECT * FROM WaTemplateRevision WHERE id=? LIMIT 1", [id]);
      return toRevisionRow(r[0]);
    });
  }

  async listRevisions(templateId: string): Promise<RevisionRow[]> {
    const rows = await query<Record<string, unknown>>(
      "SELECT * FROM WaTemplateRevision WHERE templateId=? ORDER BY revisionNo DESC",
      [templateId],
    );
    return rows.map(toRevisionRow);
  }

  async addActivity(
    templateId: string | null,
    action: string,
    detail: unknown | null,
    actorId: string | null,
  ): Promise<ActivityRow> {
    const id = newId();
    await execute(
      "INSERT INTO WaTemplateActivity (id, templateId, action, detail, actorId) VALUES (?,?,?,?,?)",
      [id, templateId, action, detail != null ? JSON.stringify(detail) : null, actorId],
    );
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM WaTemplateActivity WHERE id=? LIMIT 1",
      [id],
    );
    return toActivityRow(r!);
  }

  async listActivity(templateId: string | null, limit = 50): Promise<ActivityRow[]> {
    const lim = Math.max(1, Math.min(limit, 200));
    const rows = templateId
      ? await query<Record<string, unknown>>(
          "SELECT * FROM WaTemplateActivity WHERE templateId=? ORDER BY createdAt DESC LIMIT ?",
          [templateId, lim],
        )
      : await query<Record<string, unknown>>(
          "SELECT * FROM WaTemplateActivity ORDER BY createdAt DESC LIMIT ?",
          [lim],
        );
    return rows.map(toActivityRow);
  }

  async startSyncRun(trigger: SyncRunRow["trigger"]): Promise<SyncRunRow> {
    const id = newId();
    await execute("INSERT INTO WaTemplateSyncRun (id, `trigger`, status) VALUES (?,?, 'running')", [
      id,
      trigger,
    ]);
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM WaTemplateSyncRun WHERE id=? LIMIT 1",
      [id],
    );
    return toSyncRunRow(r!);
  }

  async finishSyncRun(id: string, patch: Partial<SyncRunRow>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => {
      sets.push(`${col}=?`);
      params.push(val);
    };
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.scanned !== undefined) add("scanned", patch.scanned);
    if (patch.updated !== undefined) add("updated", patch.updated);
    if (patch.created !== undefined) add("created", patch.created);
    if (patch.skipped !== undefined) add("skipped", patch.skipped);
    if (patch.errorCode !== undefined) add("errorCode", patch.errorCode);
    if (patch.errorMessage !== undefined) add("errorMessage", patch.errorMessage);
    sets.push("finishedAt=NOW()");
    params.push(id);
    await execute(`UPDATE WaTemplateSyncRun SET ${sets.join(", ")} WHERE id=?`, params);
  }

  async listSyncRuns(limit = 20): Promise<SyncRunRow[]> {
    const lim = Math.max(1, Math.min(limit, 100));
    const rows = await query<Record<string, unknown>>(
      "SELECT * FROM WaTemplateSyncRun ORDER BY startedAt DESC LIMIT ?",
      [lim],
    );
    return rows.map(toSyncRunRow);
  }

  async upsertMapping(input: {
    notifyKind: string;
    businessCategory?: string;
    templateId: string;
    language: string;
    actorId: string | null;
  }): Promise<NotifyMappingRow> {
    const category = input.businessCategory || ALL_CATEGORIES_KEY;
    const existing = await this.getMapping(input.notifyKind, category);
    if (existing) {
      await execute(
        "UPDATE WaNotifyMapping SET templateId=?, language=?, isEnabled=0, optInAckAt=NULL, optInAckBy=NULL, optInAckVersion=NULL, updatedBy=? WHERE notifyKind=? AND businessCategory=?",
        [input.templateId, input.language, input.actorId, input.notifyKind, category],
      );
    } else {
      const id = newId();
      await execute(
        "INSERT INTO WaNotifyMapping (id, notifyKind, businessCategory, templateId, language, isEnabled, createdBy, updatedBy) VALUES (?,?,?,?,?,0,?,?)",
        [
          id,
          input.notifyKind,
          category,
          input.templateId,
          input.language,
          input.actorId,
          input.actorId,
        ],
      );
    }
    const row = await this.getMapping(input.notifyKind, category);
    if (!row) throw new Error("upsertMapping: mapping not found after write");
    return row;
  }

  async setMappingEnabled(
    notifyKind: string,
    enabled: boolean,
    optIn: { version: string; actorId: string | null } | null,
    businessCategory?: string,
  ): Promise<NotifyMappingRow | null> {
    const category = businessCategory || ALL_CATEGORIES_KEY;
    if (enabled) {
      if (!optIn) return null; // enabling requires an opt-in acknowledgement (DP-01)
      await execute(
        "UPDATE WaNotifyMapping SET isEnabled=1, optInAckAt=NOW(), optInAckBy=?, optInAckVersion=?, updatedBy=? WHERE notifyKind=? AND businessCategory=?",
        [optIn.actorId, optIn.version, optIn.actorId, notifyKind, category],
      );
    } else {
      await execute(
        "UPDATE WaNotifyMapping SET isEnabled=0 WHERE notifyKind=? AND businessCategory=?",
        [notifyKind, category],
      );
    }
    return this.getMapping(notifyKind, category);
  }

  async removeMapping(notifyKind: string, businessCategory?: string): Promise<boolean> {
    const res = await execute(
      "DELETE FROM WaNotifyMapping WHERE notifyKind=? AND businessCategory=?",
      [notifyKind, businessCategory || ALL_CATEGORIES_KEY],
    );
    return res.affectedRows > 0;
  }

  async getMapping(
    notifyKind: string,
    businessCategory?: string,
  ): Promise<NotifyMappingRow | null> {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM WaNotifyMapping WHERE notifyKind=? AND businessCategory=? LIMIT 1",
      [notifyKind, businessCategory || ALL_CATEGORIES_KEY],
    );
    return r ? toMappingRow(r) : null;
  }

  async listMappings(): Promise<NotifyMappingRow[]> {
    // SELECT * stays valid before the businessCategory column exists (rows then
    // read as '*'), so the runtime gate keeps working during a deploy.
    const rows = await query<Record<string, unknown>>(
      "SELECT * FROM WaNotifyMapping ORDER BY notifyKind ASC",
    );
    return rows.map(toMappingRow);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy legacy-row normalization (DP-14). Legacy rows have NULL localState and a
// legacy `status` value; this interprets them without any DML on existing rows.
// A legacy `variables` array ([{index, field}]) is read as positional body
// mappings. Used by the service layer when loading a row for editing.
// ─────────────────────────────────────────────────────────────────────────────
export function normalizeLegacyRow(row: TemplateRow): TemplateRow {
  const localState =
    row.localState ?? (row.metaTemplateId ? "SUBMITTED" : row.status === "DRAFT" ? "DRAFT" : null);
  const metaStatus = row.metaStatus ?? (row.status && row.status !== "DRAFT" ? row.status : null);
  // Legacy `variables` ([{index, field}]) are read as positional body mappings
  // by the service layer; nothing to rewrite on the row itself here (R-DB-01).
  return { ...row, localState, metaStatus };
}

// ─────────────────────────────────────────────────────────────────────────────
// Repo accessor + test override.
// ─────────────────────────────────────────────────────────────────────────────
let repoInstance: TemplateRepo | null = null;

export function getTemplateRepo(): TemplateRepo {
  if (!repoInstance) repoInstance = new SqlTemplateRepo();
  return repoInstance;
}

/** Test seam: swap in the in-memory repo (wa-template-repo.memory.ts). */
export function __setTemplateRepoForTests(repo: TemplateRepo | null): void {
  repoInstance = repo;
}
