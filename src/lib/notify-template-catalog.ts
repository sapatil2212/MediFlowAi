// ─────────────────────────────────────────────────────────────────────────────
// notify-template-catalog.ts  (server-only)
//
// Reconciles the BookMyTime template catalog (notify-catalog.ts) with the
// templates that actually exist on the connected WABA, submits missing ones,
// and activates event routes for templates Meta has approved.
//
//   planCatalog()             catalog vs synced Meta state, per entry + route
//   submitCatalogTemplates()  creates a local draft from the catalog entry and
//                             submits it through waSubmitTemplate (atomic claim,
//                             UNCERTAIN on ambiguous transport errors — never a
//                             blind resubmit). Existing names are never
//                             recreated, overwritten or deleted.
//   activateCatalogRoutes()   maps every APPROVED + UTILITY catalog template
//                             whose approved wording still matches the catalog to
//                             its (category, event) route, and narrows legacy
//                             '*' mappings of industry-specific templates.
//
// Meta decides approval and category; nothing here fabricates a status.
// ─────────────────────────────────────────────────────────────────────────────
import {
  BUSINESS_CATEGORIES,
  buildTemplateCatalog,
  catalogEntryToDraft,
  EXCLUDED_CANDIDATES,
  type BusinessCategory,
  type CatalogTemplate,
} from "./notify-catalog";
import { normalizeStatus, validateDraft } from "./wa-template-model";
import { getTemplateRepo, type NotifyMappingRow, type TemplateRow } from "./wa-template-repo";
import type { AptNotifyKind } from "./appointment-notify";

export const AUTO_ACTIVATION_ACTOR = "system:catalog-auto-activation";

export type CatalogState =
  | "approved"
  | "pending"
  | "rejected"
  | "paused"
  | "disabled"
  | "reclassified"
  | "content_mismatch"
  | "draft"
  | "uncertain"
  | "missing"
  | "unknown";

export interface CatalogRouteState {
  businessCategory: BusinessCategory;
  kind: AptNotifyKind;
  /** The mapping currently routing this (category, kind), if any. */
  mappedTemplateName: string | null;
  mappedLanguage: string | null;
  mappingCategory: string | null;
  enabled: boolean;
  /** True when the route currently points at this catalog template. */
  usesCatalogTemplate: boolean;
}

export interface CatalogPlanRow {
  name: string;
  language: string;
  origin: CatalogTemplate["origin"];
  appliesTo: readonly BusinessCategory[];
  kinds: readonly AptNotifyKind[];
  purpose: string;
  bodyText: string;
  footerText: string | null;
  variables: Array<{ key: string; field: string; sample: string }>;
  state: CatalogState;
  sendable: boolean;
  metaTemplateId: string | null;
  metaStatus: string | null;
  metaCategory: string | null;
  rejectionDetail: string | null;
  lastSyncedAt: string | null;
  localTemplateId: string | null;
  validationErrors: string[];
  routes: CatalogRouteState[];
}

export interface CatalogPlan {
  rows: CatalogPlanRow[];
  excluded: ReadonlyArray<{ name: string; reason: string }>;
  summary: Record<CatalogState, number> & { total: number; submittable: number };
}

export function currentCatalog(): CatalogTemplate[] {
  return buildTemplateCatalog(process.env.APP_ORIGIN || undefined);
}

function normText(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** True when a synced row carries exactly the catalog wording. */
export function contentMatches(entry: CatalogTemplate, row: TemplateRow): boolean {
  return (
    normText(row.bodyText) === normText(entry.bodyText) &&
    normText(row.footerText) === normText(entry.footerText)
  );
}

export function catalogState(entry: CatalogTemplate, row: TemplateRow | null): CatalogState {
  if (!row) return "missing";
  if (!row.metaTemplateId) {
    if (row.opState === "UNCERTAIN") return "uncertain";
    return "draft";
  }
  const status = normalizeStatus(row.metaStatus).normalized;
  const category = String(row.metaCategory || "").toUpperCase();
  // Only an imported/synced row has Meta's real components to compare.
  if (row.bodyText && !contentMatches(entry, row)) return "content_mismatch";
  switch (status) {
    case "APPROVED":
      return category === "UTILITY" ? "approved" : "reclassified";
    case "PENDING":
    case "IN_APPEAL":
    case "PENDING_DELETION":
      return "pending";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
      return "disabled";
    default:
      return "unknown";
  }
}

function iso(d: Date | null | undefined): string | null {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/** Catalog vs Meta (as last synced) for every entry and route. */
export async function planCatalog(): Promise<CatalogPlan> {
  const repo = getTemplateRepo();
  const catalog = currentCatalog();
  const mappings = await repo.listMappings();
  const rowsById = new Map<string, TemplateRow>();
  const rows: CatalogPlanRow[] = [];

  for (const entry of catalog) {
    const row = await repo.getByNameLanguage(entry.name, entry.language);
    if (row) rowsById.set(row.id, row);
    const state = catalogState(entry, row);
    const validation = validateDraft(catalogEntryToDraft(entry), entry.kinds[0] ?? null);
    const routes: CatalogRouteState[] = [];
    for (const businessCategory of entry.appliesTo) {
      for (const kind of entry.kinds) {
        const mapping =
          mappings.find((m) => m.notifyKind === kind && m.businessCategory === businessCategory) ??
          mappings.find((m) => m.notifyKind === kind && m.businessCategory === "*") ??
          null;
        let mapped: TemplateRow | null = null;
        if (mapping) {
          mapped = rowsById.get(mapping.templateId) ?? (await repo.getById(mapping.templateId));
          if (mapped) rowsById.set(mapped.id, mapped);
        }
        routes.push({
          businessCategory,
          kind,
          mappedTemplateName: mapped?.name ?? null,
          mappedLanguage: mapped?.language ?? null,
          mappingCategory: mapping?.businessCategory ?? null,
          enabled: !!mapping?.isEnabled,
          usesCatalogTemplate: !!row && !!mapping && mapping.templateId === row.id,
        });
      }
    }
    rows.push({
      name: entry.name,
      language: entry.language,
      origin: entry.origin,
      appliesTo: entry.appliesTo,
      kinds: entry.kinds,
      purpose: entry.purpose,
      bodyText: entry.bodyText,
      footerText: entry.footerText,
      variables: Object.entries(entry.variableMappings).map(([key, field]) => ({
        key,
        field,
        sample: entry.sampleValues[key] ?? "",
      })),
      state,
      sendable: state === "approved",
      metaTemplateId: row?.metaTemplateId ?? null,
      metaStatus: row?.metaStatus ?? null,
      metaCategory: row?.metaCategory ?? null,
      rejectionDetail: row?.rejectionDetail ?? row?.rejectionReason ?? null,
      lastSyncedAt: iso(row?.lastSyncedAt),
      localTemplateId: row?.id ?? null,
      validationErrors: validation.errors,
      routes,
    });
  }

  const summary = {
    total: rows.length,
    submittable: rows.filter(
      (r) =>
        r.origin === "catalog_new" &&
        (r.state === "missing" || r.state === "draft") &&
        r.validationErrors.length === 0,
    ).length,
  } as CatalogPlan["summary"];
  for (const s of [
    "approved",
    "pending",
    "rejected",
    "paused",
    "disabled",
    "reclassified",
    "content_mismatch",
    "draft",
    "uncertain",
    "missing",
    "unknown",
  ] as CatalogState[]) {
    summary[s] = rows.filter((r) => r.state === s).length;
  }
  return { rows, excluded: EXCLUDED_CANDIDATES, summary };
}

export interface SubmitOutcome {
  name: string;
  language: string;
  outcome:
    | "submitted"
    | "already_exists"
    | "invalid"
    | "failed"
    | "uncertain"
    | "skipped_not_new"
    | "stopped";
  metaTemplateId?: string;
  metaStatus?: string;
  detail?: string;
  code?: string;
}

/** Meta error codes that make every further submission pointless right now. */
const STOP_CODES = new Set(["0", "3", "4", "10", "190", "200", "80007", "368", "131031"]);

/**
 * Submits missing catalog templates to Meta for review. Idempotent: a name
 * that already exists locally (synced from Meta or previously submitted) is
 * never re-created. Sequential, with a short pause between requests.
 */
export async function submitCatalogTemplates(input: {
  names?: string[] | null;
  actorId: string | null;
  pauseMs?: number;
}): Promise<{ results: SubmitOutcome[] }> {
  const { waCreateDraft, waSubmitTemplate, waUpdateDraft } = await import("./wa-templates");
  const repo = getTemplateRepo();
  const wanted = input.names && input.names.length > 0 ? new Set(input.names) : null;
  const results: SubmitOutcome[] = [];
  let stopped: string | null = null;

  for (const entry of currentCatalog()) {
    if (wanted && !wanted.has(entry.name)) continue;
    const base = { name: entry.name, language: entry.language };
    if (stopped) {
      results.push({ ...base, outcome: "stopped", detail: stopped });
      continue;
    }
    if (entry.origin !== "catalog_new") {
      results.push({
        ...base,
        outcome: "skipped_not_new",
        detail: "Already approved on the WABA; reused.",
      });
      continue;
    }
    const validation = validateDraft(catalogEntryToDraft(entry), entry.kinds[0] ?? null);
    if (!validation.ok) {
      results.push({ ...base, outcome: "invalid", detail: validation.errors.join(" ") });
      continue;
    }
    const draftPayload = {
      name: entry.name,
      language: entry.language,
      parameterFormat: "POSITIONAL" as const,
      headerType: "NONE",
      headerText: null,
      bodyText: entry.bodyText,
      footerText: entry.footerText,
      buttons: entry.buttons,
      sampleValues: entry.sampleValues,
      variableMappings: entry.variableMappings,
      displayTitle: entry.name.replace(/_/g, " "),
      description: entry.purpose,
      purpose: entry.appliesTo.join(","),
      notifyKind: entry.kinds[0] ?? null,
    };
    let row = await repo.getByNameLanguage(entry.name, entry.language);
    if (row?.metaTemplateId) {
      results.push({
        ...base,
        outcome: "already_exists",
        metaTemplateId: row.metaTemplateId,
        metaStatus: row.metaStatus ?? undefined,
      });
      continue;
    }
    if (row?.opState === "UNCERTAIN") {
      results.push({
        ...base,
        outcome: "uncertain",
        detail:
          'An earlier submission result is unknown. Use "Check with Meta" (or Sync) before retrying.',
      });
      continue;
    }
    if (row) {
      // A catalog submission that Meta rejected remains a LOCAL draft. Refresh
      // only drafts provably created by this catalog before retrying, so a
      // later compliant catalog correction is used without overwriting an
      // operator-authored row that happens to share the reserved name.
      const catalogManaged =
        row.source !== "META" &&
        row.description === entry.purpose &&
        row.purpose === entry.appliesTo.join(",");
      if (!catalogManaged) {
        results.push({
          ...base,
          outcome: "failed",
          detail:
            "An existing unsubmitted draft with this name is not catalog-managed. Review it manually before submission.",
        });
        continue;
      }
      const refreshed = await waUpdateDraft({ ...draftPayload, id: row.id }, input.actorId);
      if (!refreshed.ok) {
        results.push({
          ...base,
          outcome: "failed",
          detail: [refreshed.error, ...(refreshed.fieldErrors ?? [])].join(" "),
        });
        continue;
      }
      row = await repo.getById(row.id);
    } else {
      const created = await waCreateDraft(draftPayload, input.actorId);
      if (!created.ok) {
        results.push({
          ...base,
          outcome: "failed",
          detail: [created.error, ...(created.fieldErrors ?? [])].join(" "),
        });
        continue;
      }
      row = await repo.getById(created.id);
    }
    if (!row) {
      results.push({ ...base, outcome: "failed", detail: "Draft could not be reloaded." });
      continue;
    }
    const submitted = await waSubmitTemplate(row.id, input.actorId);
    if (submitted.ok) {
      results.push({
        ...base,
        outcome: "submitted",
        metaTemplateId: submitted.metaTemplateId,
        metaStatus: submitted.metaStatus,
      });
    } else {
      const uncertain = submitted.category === "transient";
      results.push({
        ...base,
        outcome: uncertain ? "uncertain" : "failed",
        detail: submitted.error,
        code: submitted.code,
      });
      if (submitted.code && STOP_CODES.has(submitted.code)) {
        stopped = `Stopped after Meta error ${submitted.code}: ${submitted.error}`;
      }
    }
    if (input.pauseMs !== 0) {
      await new Promise((r) => setTimeout(r, input.pauseMs ?? 400));
    }
  }

  try {
    const { getNotifyRepo } = await import("./notify-repo");
    await getNotifyRepo().addAudit({
      action: "catalog_submission",
      actor: input.actorId,
      detail: {
        submitted: results.filter((r) => r.outcome === "submitted").map((r) => r.name),
        failed: results
          .filter((r) => r.outcome === "failed" || r.outcome === "invalid")
          .map((r) => r.name),
      },
      atMs: Date.now(),
    });
  } catch {
    /* audit is best-effort */
  }
  return { results };
}

export interface ActivationChange {
  businessCategory: string;
  kind: string;
  templateName: string;
  action: "mapped" | "remapped" | "narrowed" | "skipped";
  detail?: string;
}

function sendable(row: TemplateRow | null | undefined): boolean {
  return (
    !!row &&
    normalizeStatus(row.metaStatus).normalized === "APPROVED" &&
    String(row.metaCategory || "").toUpperCase() === "UTILITY"
  );
}

/**
 * Activates catalog routes for approved templates and narrows '*' mappings of
 * industry-specific templates to the categories they are worded for. An
 * admin's explicit choice (a different sendable template, or a disabled
 * mapping) is never overridden.
 */
export async function activateCatalogRoutes(input: {
  actorId?: string | null;
}): Promise<{ changes: ActivationChange[] }> {
  const { waAssignMapping, waSetMappingEnabled, waRemoveMapping } = await import("./wa-templates");
  const actor = input.actorId ?? AUTO_ACTIVATION_ACTOR;
  const repo = getTemplateRepo();
  const changes: ActivationChange[] = [];
  const catalog = currentCatalog();

  // 1. Narrow legacy '*' mappings that point at an industry-specific catalog template.
  let mappings: NotifyMappingRow[] = await repo.listMappings();
  for (const m of mappings.filter((x) => x.businessCategory === "*")) {
    const row = await repo.getById(m.templateId);
    if (!row) continue;
    const entry = catalog.find((e) => e.name === row.name && e.language === row.language);
    if (!entry || entry.appliesTo.length === BUSINESS_CATEGORIES.length) continue;
    let ok = true;
    for (const category of entry.appliesTo) {
      const existing = mappings.find(
        (x) => x.notifyKind === m.notifyKind && x.businessCategory === category,
      );
      if (existing) continue;
      const assigned = await waAssignMapping(
        { notifyKind: m.notifyKind, templateId: m.templateId, businessCategory: category },
        actor,
      );
      if (!assigned.ok) {
        ok = false;
        changes.push({
          businessCategory: category,
          kind: m.notifyKind,
          templateName: row.name,
          action: "skipped",
          detail: assigned.error,
        });
        continue;
      }
      if (m.isEnabled && m.optInAckAt) {
        await waSetMappingEnabled(
          { notifyKind: m.notifyKind, enabled: true, optInAck: true, businessCategory: category },
          actor,
        );
      }
      changes.push({
        businessCategory: category,
        kind: m.notifyKind,
        templateName: row.name,
        action: "narrowed",
      });
    }
    if (ok) await waRemoveMapping({ notifyKind: m.notifyKind, businessCategory: "*" }, actor);
  }

  // 2. Map approved catalog templates to their routes.
  mappings = await repo.listMappings();
  for (const entry of catalog) {
    const row = await repo.getByNameLanguage(entry.name, entry.language);
    if (!row || !sendable(row) || !contentMatches(entry, row)) continue;
    for (const category of entry.appliesTo) {
      for (const kind of entry.kinds) {
        const existing = mappings.find(
          (x) => x.notifyKind === kind && x.businessCategory === category,
        );
        if (existing) {
          if (existing.templateId === row.id) continue;
          const current = await repo.getById(existing.templateId);
          if (sendable(current)) continue; // an admin chose another working template
          const reassigned = await waAssignMapping(
            { notifyKind: kind, templateId: row.id, businessCategory: category },
            actor,
          );
          if (reassigned.ok) {
            await waSetMappingEnabled(
              { notifyKind: kind, enabled: true, optInAck: true, businessCategory: category },
              actor,
            );
            changes.push({
              businessCategory: category,
              kind,
              templateName: row.name,
              action: "remapped",
              detail: `replaced ${current?.name ?? "missing template"}`,
            });
          }
          continue;
        }
        const assigned = await waAssignMapping(
          { notifyKind: kind, templateId: row.id, businessCategory: category },
          actor,
        );
        if (!assigned.ok) {
          changes.push({
            businessCategory: category,
            kind,
            templateName: row.name,
            action: "skipped",
            detail: assigned.error,
          });
          continue;
        }
        const enabled = await waSetMappingEnabled(
          { notifyKind: kind, enabled: true, optInAck: true, businessCategory: category },
          actor,
        );
        changes.push({
          businessCategory: category,
          kind,
          templateName: row.name,
          action: enabled.ok ? "mapped" : "skipped",
          detail: enabled.ok ? undefined : enabled.error,
        });
      }
    }
  }
  return { changes };
}
