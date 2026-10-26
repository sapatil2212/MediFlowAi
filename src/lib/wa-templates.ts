// ─────────────────────────────────────────────────────────────────────────────
// wa-templates.ts  (server)
//
// The template service: draft CRUD, dry-run validation, submission (atomic
// claim + UNCERTAIN handling + reconcile-by-name), edit-submit, clone,
// archive/unarchive/delete-draft, delete-Meta-template, presets install,
// revisions/activity/sync-run reads, dashboard summary, list/details, and the
// notification mapping admin (opt-in-ack gated). Every function is typed, never
// throws to the handler (returns {ok:false,...} safely), and uses
// getTemplateRepo() — NEVER SQL directly (§9.1, §12, DP-01/04/11/12/13/17).
//
// No live Meta call is made except through whatsapp-cloud.ts (which the tests
// stub). This module itself does no fetch.
// ─────────────────────────────────────────────────────────────────────────────
import {
  createMessageTemplate,
  deleteMessageTemplate,
  editMessageTemplate,
  listMessageTemplates,
  resolveCloudConfig,
} from "./whatsapp-cloud";
import { getTemplateRepo } from "./wa-template-repo";
import type { DraftInput, NotifyMappingRow, TemplateRow } from "./wa-template-repo";
import { TEMPLATE_PRESETS } from "./wa-template-presets";
import {
  allowedActions,
  buildCreatePayload,
  describeMetaError,
  evaluateMappingEligibility,
  isCatalogueField,
  isNotifyKind,
  normalizeStatus,
  validateDraft,
  type CatalogueField,
  type ParameterFormat,
  type TemplateButton,
  type TemplateDraft,
} from "./wa-template-model";
import type { AptNotifyKind } from "./appointment-notify";

/** The current opt-in acknowledgement text version (DP-01). */
export const OPT_IN_ACK_VERSION = "v1";

// ─────────────────────────────────────────────────────────────────────────────
// Shared result unions. Services never throw to the handler.
// ─────────────────────────────────────────────────────────────────────────────
export type ServiceOk<T> = { ok: true } & T;
/** An ok-only result with no extra payload. */
export type EmptyOk = Record<never, never>;
export interface ServiceErr {
  ok: false;
  error: string;
  /** Field-level validation errors, when applicable. */
  fieldErrors?: string[];
  /** A Meta error code when the failure came from Meta. */
  code?: string;
  /** The describeMetaError category for UI surfacing. */
  category?: string;
  nextAction?: string;
  link?: string;
}
export type ServiceResult<T> = ServiceOk<T> | ServiceErr;

function err(error: string, extra?: Partial<ServiceErr>): ServiceErr {
  return { ok: false, error, ...extra };
}

function metaErr(
  code: string | number | null | undefined,
  subcode?: string,
  message?: string,
): ServiceErr {
  const d = describeMetaError(
    code != null ? Number(code) : null,
    subcode != null ? Number(subcode) : null,
  );
  return {
    ok: false,
    error: message || d.explanation,
    code: code != null ? String(code) : undefined,
    category: d.category,
    nextAction: d.nextAction,
    link: d.link,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft shape accepted from the client (validated server-side, R-SEC-01).
// ─────────────────────────────────────────────────────────────────────────────
export interface DraftPayload {
  id?: string;
  name: string;
  language: string;
  parameterFormat: ParameterFormat;
  headerType: string;
  headerText?: string | null;
  bodyText: string;
  footerText?: string | null;
  buttons?: TemplateButton[];
  sampleValues?: Record<string, string>;
  variableMappings?: Record<string, string>;
  displayTitle?: string | null;
  description?: string | null;
  purpose?: string | null;
  notifyKind?: string | null;
}

/** Coerces the client mapping (string → CatalogueField), dropping unknown fields. */
function coerceMappings(input?: Record<string, string>): Record<string, CatalogueField> {
  const out: Record<string, CatalogueField> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (isCatalogueField(v)) out[k] = v;
  }
  return out;
}

/** Builds the pure TemplateDraft used by the model from a payload. */
export function payloadToDraft(p: DraftPayload): TemplateDraft {
  return {
    name: p.name,
    language: p.language,
    category: "UTILITY",
    parameterFormat: p.parameterFormat,
    headerType: (p.headerType as TemplateDraft["headerType"]) ?? "NONE",
    headerText: p.headerText ?? null,
    bodyText: p.bodyText,
    footerText: p.footerText ?? null,
    buttons: p.buttons ?? [],
    sampleValues: p.sampleValues ?? {},
    variableMappings: coerceMappings(p.variableMappings),
  };
}

function toDraftInput(p: DraftPayload, actorId: string | null): DraftInput {
  return {
    id: p.id,
    name: p.name,
    language: p.language,
    category: "UTILITY",
    parameterFormat: p.parameterFormat,
    headerType: (p.headerType as string) || "NONE",
    headerText: p.headerText ?? null,
    bodyText: p.bodyText,
    footerText: p.footerText ?? null,
    buttons: p.buttons ?? [],
    variableMappings: coerceMappings(p.variableMappings),
    sampleValues: p.sampleValues ?? {},
    displayTitle: p.displayTitle ?? null,
    description: p.description ?? null,
    purpose: p.purpose ?? null,
    notifyKind: p.notifyKind ?? null,
    actorId,
  };
}

/** Reconstructs a TemplateDraft from a stored row (for validation/eligibility). */
export function rowToDraft(row: TemplateRow): TemplateDraft {
  return {
    name: row.name,
    language: row.language,
    category: "UTILITY",
    parameterFormat: row.parameterFormat,
    headerType: (row.headerType as TemplateDraft["headerType"]) ?? "NONE",
    headerText: row.headerText,
    bodyText: row.bodyText,
    footerText: row.footerText,
    buttons: row.buttons ?? [],
    sampleValues: row.sampleValues ?? {},
    variableMappings: row.variableMappings ?? {},
  };
}

function validateKind(kind?: string | null): AptNotifyKind | null {
  if (!kind) return null;
  return isNotifyKind(kind) ? (kind as AptNotifyKind) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft CRUD.
// ─────────────────────────────────────────────────────────────────────────────
export async function waCreateDraft(
  p: DraftPayload,
  actorId: string | null,
): Promise<ServiceResult<{ id: string }>> {
  try {
    const draft = payloadToDraft(p);
    const kind = validateKind(p.notifyKind);
    const check = validateDraft(draft, kind);
    if (!check.ok) return err("Validation failed", { fieldErrors: check.errors });
    const repo = getTemplateRepo();
    const existing = await repo.getByNameLanguage(p.name, p.language);
    if (existing) return err("A template with this name and language already exists.");
    const row = await repo.createDraft(toDraftInput(p, actorId));
    await repo.addRevision(row.id, draft, null, null, actorId);
    await repo.addActivity(row.id, "DRAFT_CREATED", { name: p.name }, actorId);
    return { ok: true, id: row.id };
  } catch (e: any) {
    return err(e?.message || "Could not create the draft.");
  }
}

export async function waUpdateDraft(
  p: DraftPayload & { id: string },
  actorId: string | null,
): Promise<ServiceResult<{ id: string }>> {
  try {
    const repo = getTemplateRepo();
    const row = await repo.getById(p.id);
    if (!row) return err("Template not found.");
    if (row.source === "META") return err("Imported templates are read-only.");
    const draft = payloadToDraft(p);
    const kind = validateKind(p.notifyKind);
    const check = validateDraft(draft, kind);
    if (!check.ok) return err("Validation failed", { fieldErrors: check.errors });
    const updated = await repo.updateDraft(p.id, toDraftInput(p, actorId));
    if (!updated) return err("Template not found.");
    await repo.addRevision(p.id, draft, null, updated.metaStatus, actorId);
    await repo.addActivity(p.id, "DRAFT_UPDATED", { name: p.name }, actorId);
    return { ok: true, id: p.id };
  } catch (e: any) {
    return err(e?.message || "Could not update the draft.");
  }
}

/** Dry-run: returns the exact Meta create payload (never calls Meta). */
export async function waValidateDraft(
  p: DraftPayload,
): Promise<ServiceResult<{ payload: unknown; warnings: string[] }>> {
  try {
    const draft = payloadToDraft(p);
    const kind = validateKind(p.notifyKind);
    const check = validateDraft(draft, kind);
    if (!check.ok) return err("Validation failed", { fieldErrors: check.errors });
    const payload = buildCreatePayload(draft);
    return { ok: true, payload, warnings: check.warnings };
  } catch (e: any) {
    return err(e?.message || "Could not build the payload.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Submission (atomic claim + UNCERTAIN handling, DP-17).
// ─────────────────────────────────────────────────────────────────────────────
export async function waSubmitTemplate(
  id: string,
  actorId: string | null,
): Promise<ServiceResult<{ metaStatus: string; metaTemplateId: string }>> {
  const repo = getTemplateRepo();
  let claimed = false;
  try {
    const row = await repo.getById(id);
    if (!row) return err("Template not found.");
    if (row.source === "META") return err("Imported templates cannot be submitted.");
    if (row.localState === "SUBMITTED" || row.metaTemplateId) {
      return err("This template has already been submitted.");
    }
    const draft = rowToDraft(row);
    const check = validateDraft(draft, validateKind(row.notifyKind));
    if (!check.ok) return err("Validation failed", { fieldErrors: check.errors });

    claimed = await repo.claimOp(id, "CREATE", actorId);
    if (!claimed) return err("A submission is already in progress for this template.");

    const payload = buildCreatePayload(draft);
    const cfg = await resolveCloudConfig();
    const res = await createMessageTemplate(payload as any);

    if (res.ok) {
      const metaTemplateId = String(res.data.id);
      await repo.applyMetaState(id, {
        metaTemplateId,
        metaStatus: res.data.status || "PENDING",
        metaCategory: res.data.category || "UTILITY",
        messagingAccountId: cfg?.wabaId || undefined,
        localState: "SUBMITTED",
        lastSubmittedAt: new Date(),
        metaUpdatedAt: new Date(),
      });
      await repo.setOpState(id, null);
      await repo.addRevision(id, draft, payload, res.data.status || "PENDING", actorId);
      await repo.addActivity(id, "SUBMITTED", { metaTemplateId }, actorId);
      return { ok: true, metaStatus: res.data.status || "PENDING", metaTemplateId };
    }

    // transport/timeout/5xx → uncertain (never auto-retried, DP-17).
    if (res.kind === "transport") {
      await repo.setOpState(id, "UNCERTAIN");
      await repo.addActivity(id, "SUBMIT_FAILED", { reason: "uncertain", code: res.code }, actorId);
      return err('The submission result is uncertain. Use "Check with Meta" before resubmitting.', {
        code: res.code,
        category: "transient",
      });
    }
    // meta_error → clear the claim, keep the draft.
    await repo.setOpState(id, null);
    await repo.addActivity(id, "SUBMIT_FAILED", { code: res.code, subcode: res.subcode }, actorId);
    return metaErr(res.code, res.subcode, res.userMsg || res.message);
  } catch (e: any) {
    if (claimed) {
      // An unexpected throw after the claim leaves the op uncertain.
      await repo.setOpState(id, "UNCERTAIN").catch(() => {});
    }
    return err(e?.message || "Could not submit the template.");
  }
}

/**
 * Reconcile ("Check with Meta", DP-17): list Meta templates and adopt a
 * name+language match for an UNCERTAIN op, or return the draft to editable.
 */
export async function waReconcileTemplate(
  id: string,
  actorId: string | null,
): Promise<ServiceResult<{ matched: boolean; metaStatus?: string }>> {
  const repo = getTemplateRepo();
  try {
    const row = await repo.getById(id);
    if (!row) return err("Template not found.");
    if (row.opState !== "UNCERTAIN") return err("This template is not awaiting reconciliation.");
    // A reconcile is allowed ≥30s after the attempt.
    if (row.opClaimedAt && Date.now() - row.opClaimedAt.getTime() < 30_000) {
      return err("Please wait a few seconds before checking with Meta.");
    }

    const cfg = await resolveCloudConfig();
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await listMessageTemplates({ after });
      if (!res.ok) return metaErr(res.code, undefined, res.message);
      const match = res.data.data.find(
        (t: any) => t.name === row.name && String(t.language) === row.language,
      );
      if (match) {
        await repo.applyMetaState(id, {
          metaTemplateId: String(match.id),
          metaStatus: normalizeStatus(match.status).normalized || "PENDING",
          metaCategory: (match.category || "UTILITY").toUpperCase(),
          messagingAccountId: cfg?.wabaId || undefined,
          localState: "SUBMITTED",
          lastSyncedAt: new Date(),
          metaUpdatedAt: new Date(),
        });
        await repo.setOpState(id, null);
        await repo.addActivity(
          id,
          "RECONCILED",
          { matched: true, metaTemplateId: match.id },
          actorId,
        );
        return { ok: true, matched: true, metaStatus: normalizeStatus(match.status).normalized };
      }
      after = res.data.paging?.cursors?.after;
      if (!after || !res.data.paging?.next) break;
    }
    // No match: the create did not take — return to editable.
    await repo.setOpState(id, null);
    await repo.addActivity(id, "RECONCILED", { matched: false }, actorId);
    return { ok: true, matched: false };
  } catch (e: any) {
    return err(e?.message || "Could not reconcile with Meta.");
  }
}

/** Edit-submit (components only) for an APPROVED/REJECTED/PAUSED LOCAL row (DP-11). */
export async function waEditTemplate(
  id: string,
  p: DraftPayload,
  actorId: string | null,
): Promise<ServiceResult<{ metaStatus: string }>> {
  const repo = getTemplateRepo();
  let claimed = false;
  try {
    const row = await repo.getById(id);
    if (!row) return err("Template not found.");
    const actions = allowedActions({
      source: row.source,
      metaStatus: row.metaStatus,
      localState: row.localState,
      opState: row.opState,
    });
    if (!actions.allowed.edit || !row.metaTemplateId) {
      return err(actions.reasons.edit || "This template cannot be edited.");
    }
    const draft = payloadToDraft({ ...p, name: row.name, language: row.language });
    const check = validateDraft(draft, validateKind(row.notifyKind));
    if (!check.ok) return err("Validation failed", { fieldErrors: check.errors });

    claimed = await repo.claimOp(id, "EDIT", actorId);
    if (!claimed) return err("An edit is already in progress for this template.");

    const payload = buildCreatePayload(draft);
    const res = await editMessageTemplate(row.metaTemplateId, { components: payload.components });
    if (res.ok) {
      await repo.updateDraft(
        id,
        toDraftInput({ ...p, id, name: row.name, language: row.language }, actorId),
      );
      await repo.applyMetaState(id, { metaStatus: "PENDING", metaUpdatedAt: new Date() });
      await repo.setOpState(id, null);
      await repo.addRevision(id, draft, payload, "PENDING", actorId);
      await repo.addActivity(id, "EDITED", { metaTemplateId: row.metaTemplateId }, actorId);
      return { ok: true, metaStatus: "PENDING" };
    }
    if (res.kind === "transport") {
      await repo.setOpState(id, "UNCERTAIN");
      return err("The edit result is uncertain; check with Meta before retrying.", {
        code: res.code,
        category: "transient",
      });
    }
    await repo.setOpState(id, null);
    return metaErr(res.code, res.subcode, res.userMsg || res.message);
  } catch (e: any) {
    if (claimed) await repo.setOpState(id, "UNCERTAIN").catch(() => {});
    return err(e?.message || "Could not edit the template.");
  }
}

/** Clone a readable template into a new editable local draft. */
export async function waCloneTemplate(
  id: string,
  actorId: string | null,
): Promise<ServiceResult<{ id: string }>> {
  try {
    const repo = getTemplateRepo();
    const row = await repo.getById(id);
    if (!row) return err("Template not found.");
    const actions = allowedActions({
      source: row.source,
      metaStatus: row.metaStatus,
      localState: row.localState,
      opState: row.opState,
      hasMediaHeader: row.headerType != null && !["NONE", "TEXT"].includes(row.headerType),
    });
    if (!actions.allowed.clone)
      return err(actions.reasons.clone || "This template cannot be cloned.");
    let name = `${row.name}_copy`;
    if (name.length > 128) name = name.slice(0, 128);
    const draft = rowToDraft(row);
    const created = await repo.createDraft({
      name,
      language: row.language,
      category: "UTILITY",
      parameterFormat: row.parameterFormat,
      headerType: draft.headerType,
      headerText: draft.headerText,
      bodyText: draft.bodyText,
      footerText: draft.footerText,
      buttons: draft.buttons,
      variableMappings: draft.variableMappings,
      sampleValues: draft.sampleValues,
      displayTitle: row.displayTitle,
      description: row.description,
      purpose: row.purpose,
      notifyKind: row.notifyKind,
      actorId,
    });
    await repo.addActivity(created.id, "DRAFT_CREATED", { clonedFrom: id }, actorId);
    return { ok: true, id: created.id };
  } catch (e: any) {
    return err(e?.message || "Could not clone the template.");
  }
}

export async function waArchiveDraft(
  id: string,
  actorId: string | null,
): Promise<ServiceResult<EmptyOk>> {
  try {
    const repo = getTemplateRepo();
    const ok = await repo.archiveDraft(id, actorId);
    if (!ok) return err("Only a never-submitted draft can be archived.");
    await repo.addActivity(id, "ARCHIVED", null, actorId);
    return { ok: true };
  } catch (e: any) {
    return err(e?.message || "Could not archive the draft.");
  }
}

export async function waUnarchiveDraft(
  id: string,
  actorId: string | null,
): Promise<ServiceResult<EmptyOk>> {
  try {
    const repo = getTemplateRepo();
    const ok = await repo.unarchiveDraft(id, actorId);
    if (!ok) return err("Template not found.");
    await repo.addActivity(id, "UNARCHIVED", null, actorId);
    return { ok: true };
  } catch (e: any) {
    return err(e?.message || "Could not unarchive the draft.");
  }
}

export async function waDeleteDraft(
  id: string,
  actorId: string | null,
): Promise<ServiceResult<EmptyOk>> {
  try {
    const repo = getTemplateRepo();
    const ok = await repo.deleteDraft(id);
    if (!ok) return err("Only a never-submitted draft can be deleted.");
    await repo.addActivity(id, "DELETED", { scope: "draft" }, actorId);
    return { ok: true };
  } catch (e: any) {
    return err(e?.message || "Could not delete the draft.");
  }
}

/** Delete the Meta template (hsm_id + name, MV-11). DISABLED is blocked. */
export async function waDeleteMetaTemplate(
  id: string,
  actorId: string | null,
): Promise<ServiceResult<EmptyOk>> {
  const repo = getTemplateRepo();
  let claimed = false;
  try {
    const row = await repo.getById(id);
    if (!row) return err("Template not found.");
    if (!row.metaTemplateId) return err("This template has no Meta template to delete.");
    if (normalizeStatus(row.metaStatus).normalized === "DISABLED") {
      return err("Disabled templates cannot be deleted.");
    }
    claimed = await repo.claimOp(id, "DELETE", actorId);
    if (!claimed) return err("An operation is already in progress for this template.");

    const res = await deleteMessageTemplate({ name: row.name, hsmId: row.metaTemplateId });
    if (res.ok) {
      await repo.applyMetaState(id, {
        metaStatus: "DELETED",
        localState: "META_DELETED",
        metaUpdatedAt: new Date(),
      });
      await repo.setOpState(id, null);
      await repo.addActivity(
        id,
        "DELETED",
        { scope: "meta", metaTemplateId: row.metaTemplateId },
        actorId,
      );
      return { ok: true };
    }
    if (res.kind === "transport") {
      await repo.setOpState(id, "UNCERTAIN");
      return err("The delete result is uncertain; check with Meta before retrying.", {
        code: res.code,
        category: "transient",
      });
    }
    await repo.setOpState(id, null);
    return metaErr(res.code, res.subcode, res.userMsg || res.message);
  } catch (e: any) {
    if (claimed) await repo.setOpState(id, "UNCERTAIN").catch(() => {});
    return err(e?.message || "Could not delete the Meta template.");
  }
}

/** Installs any preset drafts whose names do not already exist. */
export async function waInstallPresets(
  actorId: string | null,
): Promise<ServiceResult<{ installed: string[]; skipped: string[] }>> {
  try {
    const repo = getTemplateRepo();
    const installed: string[] = [];
    const skipped: string[] = [];
    for (const preset of TEMPLATE_PRESETS) {
      const d = preset.draft;
      const existing = await repo.getByNameLanguage(d.name, d.language);
      if (existing) {
        skipped.push(d.name);
        continue;
      }
      const created = await repo.createDraft({
        name: d.name,
        language: d.language,
        category: "UTILITY",
        parameterFormat: d.parameterFormat,
        headerType: d.headerType,
        headerText: d.headerText ?? null,
        bodyText: d.bodyText,
        footerText: d.footerText ?? null,
        buttons: d.buttons,
        variableMappings: d.variableMappings,
        sampleValues: d.sampleValues,
        purpose: preset.purpose,
        notifyKind: preset.suggestedKind,
        actorId,
      });
      await repo.addRevision(created.id, d, null, null, actorId);
      await repo.addActivity(created.id, "DRAFT_CREATED", { preset: d.name }, actorId);
      installed.push(d.name);
    }
    return { ok: true, installed, skipped };
  } catch (e: any) {
    return err(e?.message || "Could not install the presets.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads.
// ─────────────────────────────────────────────────────────────────────────────
export async function waTemplateDashboard(): Promise<ServiceResult<{ summary: unknown }>> {
  try {
    const summary = await getTemplateRepo().dashboard();
    return { ok: true, summary };
  } catch (e: any) {
    return err(e?.message || "Could not load the dashboard.");
  }
}

export interface ListInput {
  search?: string;
  source?: "LOCAL" | "META";
  metaStatus?: string;
  category?: string;
  notifyKind?: string;
  includeArchived?: boolean;
  sort?: "name" | "updatedAt" | "createdAt" | "metaStatus";
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export async function waTemplateList(
  q: ListInput,
): Promise<ServiceResult<{ rows: TemplateRow[]; total: number }>> {
  try {
    const res = await getTemplateRepo().list(q);
    return { ok: true, rows: res.rows, total: res.total };
  } catch (e: any) {
    return err(e?.message || "Could not list templates.");
  }
}

export async function waTemplateDetails(
  id: string,
): Promise<ServiceResult<{ row: TemplateRow; actions: unknown }>> {
  try {
    const row = await getTemplateRepo().getById(id);
    if (!row) return err("Template not found.");
    const actions = allowedActions({
      source: row.source,
      metaStatus: row.metaStatus,
      localState: row.localState,
      opState: row.opState,
      hasMediaHeader: row.headerType != null && !["NONE", "TEXT"].includes(row.headerType),
    });
    return { ok: true, row, actions };
  } catch (e: any) {
    return err(e?.message || "Could not load the template.");
  }
}

export async function waTemplateRevisions(id: string): Promise<ServiceResult<{ rows: unknown[] }>> {
  try {
    return { ok: true, rows: await getTemplateRepo().listRevisions(id) };
  } catch (e: any) {
    return err(e?.message || "Could not load revisions.");
  }
}

export async function waTemplateActivity(
  id: string | null,
  limit?: number,
): Promise<ServiceResult<{ rows: unknown[] }>> {
  try {
    return { ok: true, rows: await getTemplateRepo().listActivity(id, limit) };
  } catch (e: any) {
    return err(e?.message || "Could not load activity.");
  }
}

export async function waTemplateSyncRuns(
  limit?: number,
): Promise<ServiceResult<{ rows: unknown[] }>> {
  try {
    return { ok: true, rows: await getTemplateRepo().listSyncRuns(limit) };
  } catch (e: any) {
    return err(e?.message || "Could not load sync runs.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification mapping admin (opt-in-ack gated, DP-01).
// ─────────────────────────────────────────────────────────────────────────────
export async function waNotifyMappings(): Promise<ServiceResult<{ rows: NotifyMappingRow[] }>> {
  try {
    return { ok: true, rows: await getTemplateRepo().listMappings() };
  } catch (e: any) {
    return err(e?.message || "Could not load mappings.");
  }
}

export async function waAssignMapping(
  input: { notifyKind: string; templateId: string },
  actorId: string | null,
): Promise<ServiceResult<{ mapping: NotifyMappingRow }>> {
  try {
    const kind = validateKind(input.notifyKind);
    if (!kind) return err("Unknown notification kind.");
    const repo = getTemplateRepo();
    const tpl = await repo.getById(input.templateId);
    if (!tpl) return err("Template not found.");
    const eligibility = evaluateMappingEligibility({
      metaStatus: tpl.metaStatus,
      metaCategory: tpl.metaCategory,
      draft: rowToDraft(tpl),
      kind,
    });
    if (!eligibility.eligible) {
      return err("This template is not eligible for mapping.", {
        fieldErrors: eligibility.reasons,
      });
    }
    const mapping = await repo.upsertMapping({
      notifyKind: kind,
      templateId: input.templateId,
      language: tpl.language,
      actorId,
    });
    await repo.addActivity(input.templateId, "MAPPING_ASSIGNED", { notifyKind: kind }, actorId);
    await invalidateNotifyCache();
    return { ok: true, mapping };
  } catch (e: any) {
    return err(e?.message || "Could not assign the mapping.");
  }
}

export async function waSetMappingEnabled(
  input: { notifyKind: string; enabled: boolean; optInAck?: boolean },
  actorId: string | null,
): Promise<ServiceResult<{ mapping: NotifyMappingRow }>> {
  try {
    const kind = validateKind(input.notifyKind);
    if (!kind) return err("Unknown notification kind.");
    const repo = getTemplateRepo();
    if (input.enabled) {
      if (input.optInAck !== true) {
        return err("Enabling a template send requires the opt-in acknowledgement.");
      }
      // Re-check eligibility at enable time (Meta state can change via webhook).
      const mapping = await repo.getMapping(kind);
      if (!mapping) return err("No mapping exists for this kind.");
      const tpl = await repo.getById(mapping.templateId);
      if (!tpl) return err("Mapped template not found.");
      const eligibility = evaluateMappingEligibility({
        metaStatus: tpl.metaStatus,
        metaCategory: tpl.metaCategory,
        draft: rowToDraft(tpl),
        kind,
      });
      if (!eligibility.eligible) {
        return err("This template is no longer eligible.", { fieldErrors: eligibility.reasons });
      }
    }
    const updated = await repo.setMappingEnabled(
      kind,
      input.enabled,
      input.enabled ? { version: OPT_IN_ACK_VERSION, actorId } : null,
    );
    if (!updated) return err("Could not update the mapping (opt-in acknowledgement required).");
    const mappingRow = await repo.getMapping(kind);
    await repo.addActivity(
      mappingRow?.templateId ?? null,
      input.enabled ? "MAPPING_ENABLED" : "MAPPING_DISABLED",
      { notifyKind: kind },
      actorId,
    );
    if (input.enabled) {
      await repo.addActivity(
        mappingRow?.templateId ?? null,
        "OPTIN_ACK",
        { version: OPT_IN_ACK_VERSION },
        actorId,
      );
    }
    await invalidateNotifyCache();
    return { ok: true, mapping: updated };
  } catch (e: any) {
    return err(e?.message || "Could not update the mapping.");
  }
}

export async function waRemoveMapping(
  input: { notifyKind: string },
  actorId: string | null,
): Promise<ServiceResult<EmptyOk>> {
  try {
    const kind = validateKind(input.notifyKind);
    if (!kind) return err("Unknown notification kind.");
    const repo = getTemplateRepo();
    const ok = await repo.removeMapping(kind);
    if (!ok) return err("No mapping exists for this kind.");
    await repo.addActivity(null, "MAPPING_REMOVED", { notifyKind: kind }, actorId);
    await invalidateNotifyCache();
    return { ok: true };
  } catch (e: any) {
    return err(e?.message || "Could not remove the mapping.");
  }
}

/** Invalidates the runtime mapping cache (best-effort). */
async function invalidateNotifyCache(): Promise<void> {
  try {
    const { invalidateMappingCache } = await import("./wa-template-notify");
    invalidateMappingCache();
  } catch {
    /* the gate module may not be loaded yet — safe to ignore */
  }
}
