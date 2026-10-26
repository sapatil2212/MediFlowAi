// ─────────────────────────────────────────────────────────────────────────────
// wa-template-repo.memory.ts  (TEST HELPER — imported only by tests)
//
// An in-memory TemplateRepo with identical claim/lease semantics to the SQL
// repo, so the service (FEAT-002) and flow (FEAT-004) tests run with no
// database. The atomic submission claim wins exactly once; a claim older than
// 120s is treated as uncertain (stale) and reclaimable; the sync lease is an
// overlap lock (only one holder until the 10-minute lease expires).
//
// This file must never be imported by production code.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { attentionBucket } from "./wa-template-model";
import type {
  ActivityRow,
  ClaimKind,
  DashboardSummary,
  DraftInput,
  ListQuery,
  ListResult,
  NotifyMappingRow,
  RevisionRow,
  SyncRunRow,
  TemplateRepo,
  TemplateRow,
} from "./wa-template-repo";

const CLAIM_STALE_MS = 120_000;
const LEASE_MS = 10 * 60_000;

function newId(): string {
  return crypto.randomUUID();
}

function mirrorStatus(row: TemplateRow): string {
  return (row.metaStatus ?? row.localState ?? "DRAFT").slice(0, 16);
}

export class InMemoryTemplateRepo implements TemplateRepo {
  private templates = new Map<string, TemplateRow>();
  private revisions: RevisionRow[] = [];
  private activity: ActivityRow[] = [];
  private syncRuns: SyncRunRow[] = [];
  private mappings = new Map<string, NotifyMappingRow>();
  private runtime: {
    syncLeaseHolder: string | null;
    syncLeaseUntil: number | null;
    lastSyncOkAt: Date | null;
    lastApiOkAt: Date | null;
  } = { syncLeaseHolder: null, syncLeaseUntil: null, lastSyncOkAt: null, lastApiOkAt: null };

  /** Test convenience: current clock, overridable for deterministic staleness tests. */
  now: () => number = () => Date.now();

  private blankRow(id: string, input: DraftInput): TemplateRow {
    const t = new Date(this.now());
    const row: TemplateRow = {
      id,
      name: input.name,
      language: input.language,
      category: input.category,
      bodyText: input.bodyText,
      components: null,
      displayTitle: input.displayTitle ?? null,
      description: input.description ?? null,
      purpose: input.purpose ?? null,
      parameterFormat: input.parameterFormat,
      footerText: input.footerText ?? null,
      headerType: input.headerType,
      headerText: input.headerText ?? null,
      headerImageUrl: null,
      buttons: input.buttons ?? [],
      variableMappings: input.variableMappings ?? {},
      sampleValues: input.sampleValues ?? {},
      source: input.source ?? "LOCAL",
      localState: "DRAFT",
      opState: null,
      opKind: null,
      opClaimedAt: null,
      status: "DRAFT",
      metaStatus: null,
      metaCategory: null,
      metaTemplateId: null,
      notifyKind: input.notifyKind ?? null,
      qualityScore: null,
      rejectionDetail: null,
      rejectionReason: null,
      messagingAccountId: null,
      lastSubmittedAt: null,
      lastSyncedAt: null,
      metaUpdatedAt: null,
      archivedAt: null,
      createdBy: input.actorId ?? null,
      updatedBy: input.actorId ?? null,
      createdAt: t,
      updatedAt: t,
    };
    row.status = mirrorStatus(row);
    return row;
  }

  async createDraft(input: DraftInput): Promise<TemplateRow> {
    const id = input.id || newId();
    const row = this.blankRow(id, input);
    this.templates.set(id, row);
    return { ...row };
  }

  async updateDraft(id: string, input: DraftInput): Promise<TemplateRow | null> {
    const row = this.templates.get(id);
    if (!row) return null;
    Object.assign(row, {
      name: input.name,
      language: input.language,
      category: input.category,
      bodyText: input.bodyText,
      headerType: input.headerType,
      headerText: input.headerText ?? null,
      footerText: input.footerText ?? null,
      parameterFormat: input.parameterFormat,
      buttons: input.buttons ?? [],
      variableMappings: input.variableMappings ?? {},
      sampleValues: input.sampleValues ?? {},
      displayTitle: input.displayTitle ?? null,
      description: input.description ?? null,
      purpose: input.purpose ?? null,
      notifyKind: input.notifyKind ?? null,
      updatedBy: input.actorId ?? null,
      updatedAt: new Date(this.now()),
    });
    row.status = mirrorStatus(row);
    return { ...row };
  }

  async getById(id: string): Promise<TemplateRow | null> {
    const r = this.templates.get(id);
    return r ? { ...r } : null;
  }

  async getByNameLanguage(name: string, language: string): Promise<TemplateRow | null> {
    for (const r of this.templates.values()) {
      if (r.name === name && r.language === language) return { ...r };
    }
    return null;
  }

  async getByMetaTemplateId(metaTemplateId: string): Promise<TemplateRow | null> {
    for (const r of this.templates.values()) {
      if (r.metaTemplateId === metaTemplateId) return { ...r };
    }
    return null;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const r = this.templates.get(id);
    if (!r || r.metaTemplateId || r.localState === "SUBMITTED") return false;
    return this.templates.delete(id);
  }

  async archiveDraft(id: string, actorId: string | null): Promise<boolean> {
    const r = this.templates.get(id);
    if (!r || r.metaTemplateId) return false;
    r.archivedAt = new Date(this.now());
    r.updatedBy = actorId;
    return true;
  }

  async unarchiveDraft(id: string, actorId: string | null): Promise<boolean> {
    const r = this.templates.get(id);
    if (!r) return false;
    r.archivedAt = null;
    r.updatedBy = actorId;
    return true;
  }

  async list(q: ListQuery): Promise<ListResult> {
    let rows = [...this.templates.values()];
    if (!q.includeArchived) rows = rows.filter((r) => r.archivedAt == null);
    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(s) || (r.displayTitle ?? "").toLowerCase().includes(s),
      );
    }
    if (q.source) rows = rows.filter((r) => r.source === q.source);
    if (q.metaStatus) rows = rows.filter((r) => r.metaStatus === q.metaStatus);
    if (q.category) rows = rows.filter((r) => r.category === q.category);
    if (q.notifyKind) rows = rows.filter((r) => r.notifyKind === q.notifyKind);

    const sortKey = q.sort ?? "updatedAt";
    const dir = q.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      const an = av instanceof Date ? av.getTime() : String(av ?? "");
      const bn = bv instanceof Date ? bv.getTime() : String(bv ?? "");
      if (an < bn) return -1 * dir;
      if (an > bn) return 1 * dir;
      return 0;
    });

    const total = rows.length;
    const limit = Math.max(1, Math.min(q.limit ?? 50, 100));
    const offset = Math.max(0, q.offset ?? 0);
    return { rows: rows.slice(offset, offset + limit).map((r) => ({ ...r })), total };
  }

  async dashboard(): Promise<DashboardSummary> {
    const byStatus: Record<string, number> = {};
    const byBucket: Record<string, number> = {};
    let total = 0;
    for (const r of this.templates.values()) {
      if (r.archivedAt) continue;
      const status = r.metaStatus || "DRAFT";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      const bucket = status === "DRAFT" ? "pending" : attentionBucket(status);
      byBucket[bucket] = (byBucket[bucket] ?? 0) + 1;
      total++;
    }
    return {
      total,
      byBucket,
      byStatus,
      lastSyncOkAt: this.runtime.lastSyncOkAt,
      lastApiOkAt: this.runtime.lastApiOkAt,
    };
  }

  async applyMetaState(
    id: string,
    patch: Parameters<TemplateRepo["applyMetaState"]>[1],
  ): Promise<void> {
    const r = this.templates.get(id);
    if (!r) return;
    Object.assign(r, patch);
    r.status = mirrorStatus(r);
    r.updatedAt = new Date(this.now());
  }

  async claimOp(id: string, kind: ClaimKind, actorId: string | null): Promise<boolean> {
    const r = this.templates.get(id);
    if (!r) return false;
    const now = this.now();
    const live =
      r.opState === "IN_FLIGHT" &&
      r.opClaimedAt != null &&
      now - r.opClaimedAt.getTime() < CLAIM_STALE_MS;
    if (r.opState != null && r.opState !== "IN_FLIGHT") {
      // UNCERTAIN blocks a re-claim until explicitly reconciled.
      return false;
    }
    if (live) return false;
    r.opState = "IN_FLIGHT";
    r.opKind = kind;
    r.opClaimedAt = new Date(now);
    r.updatedBy = actorId;
    return true;
  }

  async setOpState(id: string, opState: "UNCERTAIN" | null): Promise<void> {
    const r = this.templates.get(id);
    if (!r) return;
    if (opState === null) {
      r.opState = null;
      r.opKind = null;
      r.opClaimedAt = null;
    } else {
      r.opState = opState;
    }
  }

  async acquireSyncLease(holder: string): Promise<boolean> {
    const now = this.now();
    const held = this.runtime.syncLeaseUntil != null && this.runtime.syncLeaseUntil > now;
    if (held) return false;
    this.runtime.syncLeaseHolder = holder;
    this.runtime.syncLeaseUntil = now + LEASE_MS;
    return true;
  }

  async releaseSyncLease(holder: string): Promise<void> {
    if (this.runtime.syncLeaseHolder === holder) {
      this.runtime.syncLeaseHolder = null;
      this.runtime.syncLeaseUntil = null;
    }
  }

  async markSyncOk(): Promise<void> {
    this.runtime.lastSyncOkAt = new Date(this.now());
  }

  async markApiOk(): Promise<void> {
    this.runtime.lastApiOkAt = new Date(this.now());
  }

  async addRevision(
    templateId: string,
    snapshot: unknown,
    submittedPayload: unknown | null,
    metaStatusAtSnapshot: string | null,
    createdBy: string | null,
  ): Promise<RevisionRow> {
    const revisionNo =
      this.revisions
        .filter((r) => r.templateId === templateId)
        .reduce((max, r) => Math.max(max, r.revisionNo), 0) + 1;
    const row: RevisionRow = {
      id: newId(),
      templateId,
      revisionNo,
      snapshot,
      submittedPayload,
      metaStatusAtSnapshot,
      createdBy,
      createdAt: new Date(this.now()),
    };
    this.revisions.push(row);
    return { ...row };
  }

  async listRevisions(templateId: string): Promise<RevisionRow[]> {
    return this.revisions
      .filter((r) => r.templateId === templateId)
      .sort((a, b) => b.revisionNo - a.revisionNo)
      .map((r) => ({ ...r }));
  }

  async addActivity(
    templateId: string | null,
    action: string,
    detail: unknown | null,
    actorId: string | null,
  ): Promise<ActivityRow> {
    const row: ActivityRow = {
      id: newId(),
      templateId,
      action,
      detail,
      actorId,
      createdAt: new Date(this.now()),
    };
    this.activity.push(row);
    return { ...row };
  }

  async listActivity(templateId: string | null, limit = 50): Promise<ActivityRow[]> {
    const lim = Math.max(1, Math.min(limit, 200));
    return this.activity
      .filter((r) => (templateId ? r.templateId === templateId : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, lim)
      .map((r) => ({ ...r }));
  }

  async startSyncRun(trigger: SyncRunRow["trigger"]): Promise<SyncRunRow> {
    const row: SyncRunRow = {
      id: newId(),
      trigger,
      status: "running",
      scanned: 0,
      updated: 0,
      created: 0,
      skipped: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(this.now()),
      finishedAt: null,
    };
    this.syncRuns.push(row);
    return { ...row };
  }

  async finishSyncRun(id: string, patch: Partial<SyncRunRow>): Promise<void> {
    const row = this.syncRuns.find((r) => r.id === id);
    if (!row) return;
    Object.assign(row, patch);
    row.finishedAt = new Date(this.now());
  }

  async listSyncRuns(limit = 20): Promise<SyncRunRow[]> {
    const lim = Math.max(1, Math.min(limit, 100));
    return this.syncRuns
      .slice()
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, lim)
      .map((r) => ({ ...r }));
  }

  async upsertMapping(input: {
    notifyKind: string;
    templateId: string;
    language: string;
    actorId: string | null;
  }): Promise<NotifyMappingRow> {
    const existing = this.mappings.get(input.notifyKind);
    const t = new Date(this.now());
    if (existing) {
      existing.templateId = input.templateId;
      existing.language = input.language;
      existing.isEnabled = false;
      existing.optInAckAt = null;
      existing.optInAckBy = null;
      existing.optInAckVersion = null;
      existing.updatedBy = input.actorId;
      existing.updatedAt = t;
      return { ...existing };
    }
    const row: NotifyMappingRow = {
      id: newId(),
      notifyKind: input.notifyKind,
      templateId: input.templateId,
      language: input.language,
      isEnabled: false,
      optInAckAt: null,
      optInAckBy: null,
      optInAckVersion: null,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: t,
      updatedAt: t,
    };
    this.mappings.set(input.notifyKind, row);
    return { ...row };
  }

  async setMappingEnabled(
    notifyKind: string,
    enabled: boolean,
    optIn: { version: string; actorId: string | null } | null,
  ): Promise<NotifyMappingRow | null> {
    const row = this.mappings.get(notifyKind);
    if (!row) return null;
    if (enabled) {
      if (!optIn) return null;
      row.isEnabled = true;
      row.optInAckAt = new Date(this.now());
      row.optInAckBy = optIn.actorId;
      row.optInAckVersion = optIn.version;
      row.updatedBy = optIn.actorId;
    } else {
      row.isEnabled = false;
    }
    row.updatedAt = new Date(this.now());
    return { ...row };
  }

  async removeMapping(notifyKind: string): Promise<boolean> {
    return this.mappings.delete(notifyKind);
  }

  async getMapping(notifyKind: string): Promise<NotifyMappingRow | null> {
    const r = this.mappings.get(notifyKind);
    return r ? { ...r } : null;
  }

  async listMappings(): Promise<NotifyMappingRow[]> {
    return [...this.mappings.values()]
      .sort((a, b) => a.notifyKind.localeCompare(b.notifyKind))
      .map((r) => ({ ...r }));
  }
}

/** Factory used by tests. */
export function createInMemoryTemplateRepo(): InMemoryTemplateRepo {
  return new InMemoryTemplateRepo();
}
