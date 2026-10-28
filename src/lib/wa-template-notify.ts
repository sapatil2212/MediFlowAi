// ─────────────────────────────────────────────────────────────────────────────
// wa-template-notify.ts  (server)
//
// The runtime notification gate wired into whatsapp-router.ts. It returns a
// structured expected-readiness result for every outbound notification kind;
// unexpected repository/runtime errors propagate so the router can record a
// separate sanitized internal failure. The gates are:
//   1. Cloud enabled (isCloudAvailable) AND ctx.recipientPhone present.
//   2. An enabled WaNotifyMapping for the kind with a current opt-in ack.
//   3. The mapped template is owned by the configured Messaging account,
//      metaStatus === 'APPROVED' and metaCategory === 'UTILITY'.
//   4. Every placeholder's mapped field resolves for this appointment/tenant;
//      any unresolved field → null (never send a blank param).
//
// The mapping set is cached (fast path, no DB hit per send) and invalidated by
// the webhook and the admin mapping writes. Video join-link kinds use a URL
// button whose static prefix is the join origin + /consult/ and whose single
// variable is the base64url token, so no plaintext token is stored (DP-05).
//
// CRITICAL (the original incident): no notification may become free-form Cloud
// text or a whatsapp-web.js fallback when a template gate fails. The router
// records template_not_ready and leaves the underlying business write intact.
// ─────────────────────────────────────────────────────────────────────────────
import { isCloudAvailable, resolveCloudConfig } from "./whatsapp-cloud";
import { getTemplateRepo } from "./wa-template-repo";
import type { NotifyMappingRow, TemplateRow } from "./wa-template-repo";
import {
  collectPlaceholderKeys,
  normalizeStatus,
  type CatalogueField,
  type ParameterFormat,
} from "./wa-template-model";
import type { AptNotifyContext, AptNotifyKind } from "./appointment-notify";
import { findCatalogTemplate, type BusinessCategory } from "./notify-catalog";

export interface TemplatePlan {
  templateId: string;
  templateName: string;
  language: string;
  parameterFormat: ParameterFormat;
  bodyParams: Array<{ text: string; name?: string }>;
  headerParams: Array<{ text: string; name?: string }>;
  urlButtons: Array<{ index: number; suffix: string }>;
}

export type TemplateNotReadyReason =
  | "recipient_missing"
  | "cloud_unavailable"
  | "mapping_missing"
  | "mapping_disabled"
  | "opt_in_missing"
  | "template_missing"
  | "template_not_approved"
  | "template_not_utility"
  | "account_mismatch"
  | "language_mismatch"
  | "category_mismatch"
  | "variables_unresolved";

export type TemplatePlanResolution =
  | { status: "ready"; plan: TemplatePlan }
  | { status: "not_ready"; reason: TemplateNotReadyReason };

// ── Mapping cache ────────────────────────────────────────────────────────────
interface CacheEntry {
  mappings: NotifyMappingRow[];
  at: number;
}
const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

/** Invalidates the cached mapping set (webhook + admin writes call this). */
export function invalidateMappingCache(): void {
  cache = null;
}

async function loadMappings(): Promise<NotifyMappingRow[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.mappings;
  const mappings = await getTemplateRepo().listMappings();
  cache = { mappings, at: Date.now() };
  return mappings;
}

/**
 * Resolves a catalogue field for this appointment/tenant. Returns null when the
 * field cannot be resolved (the whole template plan fails closed). Reuses the
 * date/time formatting of appointment-notify via resolveTemplateField there.
 */
async function resolveField(field: CatalogueField, ctx: AptNotifyContext): Promise<string | null> {
  const { resolveTemplateField } = await import("./appointment-notify");
  return resolveTemplateField(field, ctx);
}

/**
 * Resolves the runtime gate with an explicit reason for expected readiness
 * failures. Unexpected repository/runtime errors propagate to the router.
 */
/**
 * Picks the mapping for (kind, category). A category-specific row — enabled
 * or not — always wins over the '*' row, so disabling one category's mapping
 * never silently falls back to a generic template.
 */
export function selectMapping(
  mappings: readonly NotifyMappingRow[],
  kind: AptNotifyKind,
  businessCategory?: string | null,
): NotifyMappingRow | null {
  if (businessCategory) {
    const specific = mappings.find(
      (m) => m.notifyKind === kind && m.businessCategory === businessCategory,
    );
    if (specific) return specific;
  }
  return mappings.find((m) => m.notifyKind === kind && m.businessCategory === "*") ?? null;
}

export async function resolveTemplatePlanResult(
  kind: AptNotifyKind,
  ctx: AptNotifyContext & { recipientPhone?: string | null },
  options: { cloudAvailable?: boolean; businessCategory?: BusinessCategory | null } = {},
): Promise<TemplatePlanResolution> {
  if (!ctx.recipientPhone) return { status: "not_ready", reason: "recipient_missing" };
  const cloudAvailable = options.cloudAvailable ?? (await isCloudAvailable());
  if (!cloudAvailable) return { status: "not_ready", reason: "cloud_unavailable" };

  const mappings = await loadMappings();
  const mapping = selectMapping(mappings, kind, options.businessCategory);
  if (!mapping) return { status: "not_ready", reason: "mapping_missing" };
  if (!mapping.isEnabled) return { status: "not_ready", reason: "mapping_disabled" };
  if (!mapping.optInAckAt) return { status: "not_ready", reason: "opt_in_missing" };

  const repo = getTemplateRepo();
  const row = await repo.getById(mapping.templateId);
  if (!row) return { status: "not_ready", reason: "template_missing" };
  if (normalizeStatus(row.metaStatus).normalized !== "APPROVED") {
    return { status: "not_ready", reason: "template_not_approved" };
  }
  if ((row.metaCategory || "").toUpperCase() !== "UTILITY") {
    return { status: "not_ready", reason: "template_not_utility" };
  }
  const cfg = await resolveCloudConfig();
  if (!row.messagingAccountId || !cfg?.wabaId || row.messagingAccountId !== cfg.wabaId) {
    return { status: "not_ready", reason: "account_mismatch" };
  }
  // Meta resolves a template by exact name + language: never send under a
  // language other than the approved one (no en <-> en_US normalization).
  if (mapping.language && mapping.language !== row.language) {
    return { status: "not_ready", reason: "language_mismatch" };
  }
  // A catalog template worded for one industry (e.g. "at the clinic") must
  // not reach another category through a generic '*' mapping.
  if (options.businessCategory) {
    const catalogEntry = findCatalogTemplate(row.name, row.language);
    if (catalogEntry && !catalogEntry.appliesTo.includes(options.businessCategory)) {
      return { status: "not_ready", reason: "category_mismatch" };
    }
  }

  const plan = await buildPlan(row, mapping, ctx);
  return plan ? { status: "ready", plan } : { status: "not_ready", reason: "variables_unresolved" };
}

/** Compatibility helper for callers that only need plan-or-null semantics. */
export async function resolveTemplatePlan(
  kind: AptNotifyKind,
  ctx: AptNotifyContext & { recipientPhone?: string | null },
): Promise<TemplatePlan | null> {
  const result = await resolveTemplatePlanResult(kind, ctx);
  return result.status === "ready" ? result.plan : null;
}

/** Builds the send plan from a row's placeholder keys + variable mappings. */
async function buildPlan(
  row: TemplateRow,
  mapping: NotifyMappingRow,
  ctx: AptNotifyContext & { recipientPhone?: string | null },
): Promise<TemplatePlan | null> {
  const draft = {
    name: row.name,
    language: row.language,
    category: "UTILITY" as const,
    parameterFormat: row.parameterFormat,
    headerType: (row.headerType as any) ?? "NONE",
    headerText: row.headerText,
    bodyText: row.bodyText,
    footerText: row.footerText,
    buttons: row.buttons ?? [],
    sampleValues: row.sampleValues ?? {},
    variableMappings: row.variableMappings ?? {},
  };
  const keys = collectPlaceholderKeys(draft);
  const mappings = row.variableMappings ?? {};

  const bodyParams: Array<{ text: string; name?: string }> = [];
  const headerParams: Array<{ text: string; name?: string }> = [];
  const named = row.parameterFormat === "NAMED";

  for (const key of keys) {
    // URL-button placeholders are handled separately (join-link suffix below).
    if (key.startsWith("button.")) continue;
    const field = mappings[key];
    if (!field) return null; // unmapped placeholder → fail closed
    const value = await resolveField(field, ctx);
    if (value == null || value === "") return null; // unresolved → fail closed
    const token = key.split(".").slice(1).join(".");
    const param = named ? { text: value, name: token } : { text: value };
    if (key.startsWith("header.")) headerParams.push(param);
    else bodyParams.push(param);
  }

  // URL-button suffix (video join-link kinds). The static prefix is the join
  // origin + /consult/; the suffix var is the base64url token from ctx.joinLink.
  const urlButtons: Array<{ index: number; suffix: string }> = [];
  (draft.buttons as any[]).forEach((b, idx) => {
    if (b?.type === "URL" && typeof b.url === "string" && /\{\{\s*[a-z0-9_]+\s*\}\}/i.test(b.url)) {
      const suffix = extractJoinToken(ctx.joinLink);
      if (suffix) urlButtons.push({ index: idx, suffix });
    }
  });
  // A URL button that needs a suffix but has no token fails closed.
  const dynamicUrlButtons = (draft.buttons as any[]).filter(
    (b) =>
      b?.type === "URL" && typeof b.url === "string" && /\{\{\s*[a-z0-9_]+\s*\}\}/i.test(b.url),
  ).length;
  if (dynamicUrlButtons > 0 && urlButtons.length !== dynamicUrlButtons) return null;

  return {
    templateId: row.id,
    templateName: row.name,
    // The template's own approved language code, verbatim.
    language: row.language,
    parameterFormat: row.parameterFormat,
    bodyParams,
    headerParams,
    urlButtons,
  };
}

/** Extracts the base64url token from a /consult/<token> join link. */
function extractJoinToken(joinLink: string | null | undefined): string | null {
  if (!joinLink) return null;
  const m = /\/consult\/([A-Za-z0-9_-]+)/.exec(joinLink);
  return m ? m[1] : null;
}
