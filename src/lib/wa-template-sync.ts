// ─────────────────────────────────────────────────────────────────────────────
// wa-template-sync.ts  (server)
//
// Full and single sync of Meta template state onto local rows, guarded by the
// WaCloudRuntime lease lock (DP-12). Also the scheduled-sync hook
// (maybeRunScheduledTemplateSync, off by default), the webhook change applier
// (applyWebhookChange, §14), and the background single refresh used by the
// webhook on REINSTATED/UNARCHIVED.
//
// Never throws to the caller; returns {ok:false} safely. Uses getTemplateRepo()
// and the typed Graph ops in whatsapp-cloud.ts — no direct SQL, no raw fetch.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { getMessageTemplate, listMessageTemplates, resolveCloudConfig } from "./whatsapp-cloud";
import { getTemplateRepo } from "./wa-template-repo";
import { normalizeStatus } from "./wa-template-model";
import type { SyncRunRow } from "./wa-template-repo";

/** Local name cap (MV-03 / §5 item 5): Meta allows 512, we cap at 128. */
const NAME_MAX = 128;

export interface SyncResult {
  ok: boolean;
  runId?: string;
  scanned?: number;
  updated?: number;
  created?: number;
  skipped?: number;
  error?: string;
  code?: string;
}

function normLang(code: string | null | undefined): string {
  return String(code ?? "").replace(/-/g, "_");
}

/** Maps a Meta list node's quality score object/string to a stored value. */
function qualityOf(node: any): string | undefined {
  const q = node?.quality_score;
  if (!q) return undefined;
  if (typeof q === "string") return q.toUpperCase();
  if (q.score) return String(q.score).toUpperCase();
  return undefined;
}

function rejectionOf(node: any): string | undefined {
  if (node?.rejected_reason && node.rejected_reason !== "NONE") return String(node.rejected_reason);
  return undefined;
}

/**
 * Reconciles one Meta node onto a local row (match by metaTemplateId, then
 * name+language). Returns 'updated' | 'created' | 'skipped'.
 */
async function applyNode(
  node: any,
  messagingAccountId: string | null,
): Promise<"updated" | "created" | "skipped"> {
  const repo = getTemplateRepo();
  const name = String(node?.name ?? "");
  const language = normLang(node?.language);
  if (!name) return "skipped";
  if (name.length > NAME_MAX) return "skipped"; // §5 item 5

  const patch = {
    metaTemplateId: node?.id != null ? String(node.id) : undefined,
    metaStatus: normalizeStatus(node?.status).normalized || undefined,
    metaCategory: node?.category ? String(node.category).toUpperCase() : undefined,
    qualityScore: qualityOf(node),
    rejectionDetail: rejectionOf(node),
    messagingAccountId: messagingAccountId || undefined,
    lastSyncedAt: new Date(),
    metaUpdatedAt: new Date(),
  };

  let row =
    (node?.id != null ? await repo.getByMetaTemplateId(String(node.id)) : null) ||
    (await repo.getByNameLanguage(name, language));

  if (row) {
    // Rows bound to another Messaging account are read-only and skipped (DP-15).
    if (
      row.messagingAccountId &&
      messagingAccountId &&
      row.messagingAccountId !== messagingAccountId
    ) {
      return "skipped";
    }
    await repo.applyMetaState(row.id, { ...patch, localState: "SUBMITTED" });
    return "updated";
  }

  // Import as a META-source row.
  row = await repo.createDraft({
    name,
    language,
    category: node?.category ? String(node.category).toUpperCase() : "UTILITY",
    parameterFormat: node?.parameter_format === "named" ? "NAMED" : "POSITIONAL",
    headerType: "NONE",
    bodyText: extractBody(node),
    buttons: [],
    variableMappings: {},
    sampleValues: {},
    source: "META",
    actorId: "sync",
  });
  await repo.applyMetaState(row.id, { ...patch, localState: "SUBMITTED", source: "META" });
  return "created";
}

function extractBody(node: any): string {
  for (const c of node?.components ?? []) {
    if (String(c?.type).toUpperCase() === "BODY") return String(c?.text ?? "");
  }
  return "";
}

/**
 * Full sync: pages the unfiltered Meta list under the lease lock, reconciling
 * each node. Records a WaTemplateSyncRun. Trigger is 'manual' or 'scheduled'.
 */
export async function runFullSync(trigger: "manual" | "scheduled"): Promise<SyncResult> {
  const repo = getTemplateRepo();
  const holder = crypto.randomUUID();
  const gotLease = await repo.acquireSyncLease(holder);
  if (!gotLease) return { ok: false, error: "A sync is already running." };

  let run: SyncRunRow | null = null;
  try {
    run = await repo.startSyncRun(trigger);
    const cfg = await resolveCloudConfig();
    const messagingAccountId = cfg?.wabaId ?? null;
    let scanned = 0;
    let updated = 0;
    let created = 0;
    let skipped = 0;
    let after: string | undefined;

    for (let page = 0; page < 200; page++) {
      const res = await listMessageTemplates({ after });
      if (!res.ok) {
        await repo.finishSyncRun(run.id, {
          status: "error",
          scanned,
          updated,
          created,
          skipped,
          errorCode: res.code,
          errorMessage: res.message,
        });
        return { ok: false, runId: run.id, error: res.message, code: res.code };
      }
      for (const node of res.data.data) {
        scanned++;
        const outcome = await applyNode(node, messagingAccountId);
        if (outcome === "updated") updated++;
        else if (outcome === "created") created++;
        else skipped++;
      }
      after = res.data.paging?.cursors?.after;
      if (!after || !res.data.paging?.next) break;
    }

    await repo.finishSyncRun(run.id, { status: "ok", scanned, updated, created, skipped });
    await repo.markSyncOk();
    return { ok: true, runId: run.id, scanned, updated, created, skipped };
  } catch (e: any) {
    if (run) {
      await repo
        .finishSyncRun(run.id, { status: "error", errorMessage: e?.message || "sync error" })
        .catch(() => {});
    }
    return { ok: false, error: e?.message || "Could not run the sync." };
  } finally {
    await repo.releaseSyncLease(holder).catch(() => {});
  }
}

export async function waSyncAll(): Promise<SyncResult> {
  return runFullSync("manual");
}

/** Single-template sync: refreshes one row from its Meta node. */
export async function waSyncOne(id: string): Promise<SyncResult> {
  const repo = getTemplateRepo();
  try {
    const row = await repo.getById(id);
    if (!row) return { ok: false, error: "Template not found." };
    if (!row.metaTemplateId) return { ok: false, error: "This template has not been submitted." };
    const cfg = await resolveCloudConfig();
    const run = await repo.startSyncRun("single");
    const res = await getMessageTemplate(row.metaTemplateId);
    if (!res.ok) {
      await repo.finishSyncRun(run.id, {
        status: "error",
        errorCode: res.code,
        errorMessage: res.message,
      });
      return { ok: false, runId: run.id, error: res.message, code: res.code };
    }
    const outcome = await applyNode(res.data, cfg?.wabaId ?? null);
    await repo.finishSyncRun(run.id, {
      status: "ok",
      scanned: 1,
      updated: outcome === "updated" ? 1 : 0,
      created: outcome === "created" ? 1 : 0,
      skipped: outcome === "skipped" ? 1 : 0,
    });
    await repo.markSyncOk();
    return { ok: true, runId: run.id, scanned: 1 };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not sync the template." };
  }
}

/** Fire-and-forget background single refresh (webhook REINSTATED/UNARCHIVED). */
export function backgroundSyncOne(id: string): void {
  void Promise.resolve()
    .then(() => waSyncOne(id))
    .catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled sync hook (DP-12). Off by default; WA_CLOUD_TEMPLATE_SYNC_MINUTES
// unset/0 = off, valid 30–1440 (invalid → off + one warning). Kicked
// fire-and-forget from the reminder cycle; shares the lease lock.
// ─────────────────────────────────────────────────────────────────────────────
let scheduledSyncWarned = false;
let lastScheduledKickAt = 0;

/** Parses the configured interval; null when off/invalid. */
export function scheduledSyncMinutes(): number | null {
  const raw = process.env.WA_CLOUD_TEMPLATE_SYNC_MINUTES;
  if (!raw || raw.trim() === "" || raw.trim() === "0") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 30 || n > 1440) {
    if (!scheduledSyncWarned) {
      console.warn(
        `[WaTemplateSync] WA_CLOUD_TEMPLATE_SYNC_MINUTES='${raw}' is invalid (expected 30–1440); scheduled sync is off.`,
      );
      scheduledSyncWarned = true;
    }
    return null;
  }
  return n;
}

/**
 * Called fire-and-forget from the reminder cycle. Runs a full sync only when
 * the configured interval has elapsed since the last kick. Never throws.
 */
export async function maybeRunScheduledTemplateSync(): Promise<void> {
  try {
    const minutes = scheduledSyncMinutes();
    if (minutes == null) return;
    const now = Date.now();
    if (lastScheduledKickAt > 0 && now - lastScheduledKickAt < minutes * 60_000) return;
    lastScheduledKickAt = now;
    await runFullSync("scheduled");
  } catch (e: any) {
    console.error("[WaTemplateSync] scheduled sync error:", e?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook change application (§14, MV-13). Applies one template-field change to
// the matching row (by metaTemplateId, then name+language). Returns whether a
// mapped template became ineligible so the webhook can invalidate the cache.
// ─────────────────────────────────────────────────────────────────────────────
export interface WebhookChange {
  field:
    | "message_template_status_update"
    | "message_template_quality_update"
    | "template_category_update"
    | "message_template_components_update";
  metaTemplateId: string | null;
  name: string | null;
  language: string | null;
  entryTime: number;
  value: any;
}

export interface ApplyWebhookResult {
  applied: boolean;
  reason?: string;
  /** True when the row became non-APPROVED or non-UTILITY while mapped. */
  mappingInvalidated?: boolean;
  /** True when a background single refresh should run (REINSTATED/UNARCHIVED). */
  needsRefresh?: boolean;
  templateId?: string;
}

export async function applyWebhookChange(change: WebhookChange): Promise<ApplyWebhookResult> {
  const repo = getTemplateRepo();
  const row =
    (change.metaTemplateId ? await repo.getByMetaTemplateId(change.metaTemplateId) : null) ||
    (change.name && change.language
      ? await repo.getByNameLanguage(change.name, normLang(change.language))
      : null);
  if (!row) return { applied: false, reason: "no matching template" };

  // Monotonic guard: only apply entry.time >= metaUpdatedAt.
  if (row.metaUpdatedAt && change.entryTime * 1000 < row.metaUpdatedAt.getTime()) {
    return { applied: false, reason: "out of order" };
  }

  const v = change.value || {};
  const patch: Parameters<ReturnType<typeof getTemplateRepo>["applyMetaState"]>[1] = {
    metaUpdatedAt: new Date(change.entryTime * 1000),
  };
  let needsRefresh = false;

  if (change.field === "message_template_status_update") {
    const event = String(v.event ?? "").toUpperCase();
    if (event === "REINSTATED" || event === "UNARCHIVED") {
      // No resulting status in the payload (§5 item 8) → refresh instead.
      needsRefresh = true;
    } else if (event) {
      patch.metaStatus = event;
    }
    if (v.message_template_category)
      patch.metaCategory = String(v.message_template_category).toUpperCase();
    if (v.rejection_info) {
      patch.rejectionDetail = JSON.stringify(v.rejection_info);
    }
  } else if (change.field === "message_template_quality_update") {
    const score = v.new_quality_score;
    if (score)
      patch.qualityScore = (typeof score === "string" ? score : score.score || "").toUpperCase();
  } else if (change.field === "template_category_update") {
    // Completed recategorization sets new_category; impending keeps current.
    if (v.previous_category && v.new_category) {
      patch.metaCategory = String(v.new_category).toUpperCase();
    }
  } else if (change.field === "message_template_components_update") {
    // Components changed on Meta's side → refresh to pull the new shape.
    needsRefresh = true;
  }

  await repo.applyMetaState(row.id, patch);

  // Determine whether a mapped template became ineligible.
  let mappingInvalidated = false;
  const mappings = await repo.listMappings();
  const mapped = mappings.find((m) => m.templateId === row.id && m.isEnabled);
  if (mapped) {
    const updated = await repo.getById(row.id);
    const status = normalizeStatus(updated?.metaStatus).normalized;
    const category = (updated?.metaCategory || "").toUpperCase();
    if (status !== "APPROVED" || category !== "UTILITY") mappingInvalidated = true;
  }

  if (needsRefresh) backgroundSyncOne(row.id);

  return { applied: true, mappingInvalidated, needsRefresh, templateId: row.id };
}
