// ─────────────────────────────────────────────────────────────────────────────
// wa-template-notify.ts  (server)
//
// The runtime notification gate wired into whatsapp-router.ts. resolveTemplatePlan
// returns null (→ unchanged plain-text + Web fallback path) UNLESS every gate
// passes (§15, DP-05, DP-08):
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
// CRITICAL (the original incident): with no enabled mapping this returns null
// and the router's text path stays byte-identical, WaMessageLog.templateId NULL.
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

export interface TemplatePlan {
  templateId: string;
  templateName: string;
  language: string;
  parameterFormat: ParameterFormat;
  bodyParams: Array<{ text: string; name?: string }>;
  headerParams: Array<{ text: string; name?: string }>;
  urlButtons: Array<{ index: number; suffix: string }>;
}

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
 * field cannot be resolved (→ the whole plan falls back to text). Reuses the
 * date/time formatting of appointment-notify via resolveTemplateField there.
 */
async function resolveField(field: CatalogueField, ctx: AptNotifyContext): Promise<string | null> {
  const { resolveTemplateField } = await import("./appointment-notify");
  return resolveTemplateField(field, ctx);
}

/**
 * The runtime gate. Returns a send plan when every gate passes, else null.
 * Never throws (any error → null → text path).
 */
export async function resolveTemplatePlan(
  kind: AptNotifyKind,
  ctx: AptNotifyContext & { recipientPhone?: string | null },
): Promise<TemplatePlan | null> {
  try {
    // Gate 1: Cloud enabled + a recipient phone.
    if (!ctx.recipientPhone) return null;
    if (!(await isCloudAvailable())) return null;

    // Gate 2: an enabled mapping with a current opt-in ack.
    const mappings = await loadMappings();
    const mapping = mappings.find((m) => m.notifyKind === kind);
    if (!mapping || !mapping.isEnabled || !mapping.optInAckAt) return null;

    // Gate 3: APPROVED + UTILITY + owned by the configured account.
    const repo = getTemplateRepo();
    const row = await repo.getById(mapping.templateId);
    if (!row) return null;
    if (normalizeStatus(row.metaStatus).normalized !== "APPROVED") return null;
    if ((row.metaCategory || "").toUpperCase() !== "UTILITY") return null;
    const cfg = await resolveCloudConfig();
    if (row.messagingAccountId && cfg?.wabaId && row.messagingAccountId !== cfg.wabaId) return null;

    // Gate 4: every placeholder resolves.
    return await buildPlan(row, mapping, ctx);
  } catch {
    return null;
  }
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
    if (!field) return null; // unmapped placeholder → fall back to text
    const value = await resolveField(field, ctx);
    if (value == null || value === "") return null; // unresolved → text path
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
  // A URL button that needs a suffix but has no token → fall back to text.
  const dynamicUrlButtons = (draft.buttons as any[]).filter(
    (b) =>
      b?.type === "URL" && typeof b.url === "string" && /\{\{\s*[a-z0-9_]+\s*\}\}/i.test(b.url),
  ).length;
  if (dynamicUrlButtons > 0 && urlButtons.length !== dynamicUrlButtons) return null;

  return {
    templateId: row.id,
    templateName: row.name,
    language: mapping.language || row.language,
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
