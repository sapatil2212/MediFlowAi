// ─────────────────────────────────────────────────────────────────────────────
// notify-admin.ts  (server-only)
//
// Super Admin services for WhatsApp notifications: overview/health, searchable
// notification logs with an event timeline, safe retry, automation settings,
// the (category × event) routing matrix, the template catalog (plan / submit /
// activate) and an explicit test send. Every entry point is reached only
// through adminOnly() in wa-template-api.ts (verifyAdminSession first).
//
// Privacy: recipient numbers are masked to their last 4 digits in every
// response; message bodies are never returned; secrets never leave the server.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne } from "./db";
import {
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_LABELS,
  CATEGORY_KINDS,
  catalogRouteFor,
  EVENT_TYPE_LABELS,
  isBusinessCategory,
  type BusinessCategory,
} from "./notify-catalog";
import {
  EVENT_STATUSES,
  getNotifyRepo,
  normalizePlatformSettings,
  type EventFilter,
  type NotificationEventRow,
  type PlatformSettings,
} from "./notify-repo";
import { NOTIFY_KIND_LABELS, isNotifyKind, normalizeStatus } from "./wa-template-model";
import type { AptNotifyKind } from "./appointment-notify";

const HOUR = 3_600_000;

/** "919876543210" → "•••••••3210". */
export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length <= 4) return "••••";
  return `${"•".repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`;
}

export interface PublicEvent {
  id: string;
  tenantId: string;
  businessCategory: string;
  eventType: string;
  eventLabel: string;
  notifyKind: string;
  kindLabel: string;
  appointmentId: string | null;
  recipient: string | null;
  source: string | null;
  status: string;
  statusReason: string | null;
  errorClass: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  scheduledFor: string;
  nextAttemptAt: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  providerMessageId: string | null;
  submittedAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  createdAt: string;
  retryable: boolean;
}

const iso = (ms: number | null | undefined): string | null =>
  ms == null || !Number.isFinite(ms) || ms <= 0 ? null : new Date(ms).toISOString();

export function toPublicEvent(e: NotificationEventRow): PublicEvent {
  return {
    id: e.id,
    tenantId: e.tenantId,
    businessCategory: e.businessCategory,
    eventType: e.eventType,
    eventLabel: EVENT_TYPE_LABELS[e.eventType] ?? e.eventType,
    notifyKind: e.notifyKind,
    kindLabel: (NOTIFY_KIND_LABELS as Record<string, string>)[e.notifyKind] ?? e.notifyKind,
    appointmentId: e.appointmentId,
    recipient: maskPhone(e.recipient),
    source: e.source,
    status: e.status,
    statusReason: e.statusReason,
    errorClass: e.errorClass,
    errorCode: e.errorCode,
    errorMessage: e.errorMessage,
    attempts: e.attempts,
    maxAttempts: e.maxAttempts,
    scheduledFor: iso(e.scheduledForMs) ?? new Date(0).toISOString(),
    nextAttemptAt: e.status === "pending" || e.status === "retry" ? iso(e.nextAttemptAtMs) : null,
    templateName: e.templateName,
    templateLanguage: e.templateLanguage,
    providerMessageId: e.providerMessageId,
    submittedAt: iso(e.submittedAtMs),
    deliveredAt: iso(e.deliveredAtMs),
    readAt: iso(e.readAtMs),
    failedAt: iso(e.failedAtMs),
    createdAt: iso(e.createdAtMs) ?? new Date(0).toISOString(),
    retryable:
      ["failed", "dead", "blocked", "ambiguous", "expired"].includes(e.status) &&
      !e.providerMessageId,
  };
}

// ── Overview ─────────────────────────────────────────────────────────────────
export async function notifyOverview() {
  const nowMs = Date.now();
  const repo = getNotifyRepo();
  const { resolveCloudConfig, API_VERSION_EXPIRY } = await import("./whatsapp-cloud");
  const cfg = await resolveCloudConfig();
  const { getTemplateRepo } = await import("./wa-template-repo");
  const tplRepo = getTemplateRepo();
  const [dashboard, syncRuns, metrics24, metrics1, alerts, platform] = await Promise.all([
    tplRepo.dashboard(),
    tplRepo.listSyncRuns(1),
    repo.metrics(nowMs - 24 * HOUR, nowMs),
    repo.metrics(nowMs - HOUR, nowMs),
    repo.listAlerts("open", 50),
    repo.getPlatformSettings(),
  ]);
  const failures = await repo.listEvents({
    statuses: ["failed", "dead", "ambiguous", "blocked"],
    fromMs: nowMs - 7 * 24 * HOUR,
    limit: 10,
  });

  let health: any = null;
  try {
    const { waAccountHealth } = await import("./wa-template-health");
    const h = await waAccountHealth();
    health = h.ok ? h.health : { error: h.error };
  } catch {
    health = null;
  }

  const webhook = await queryOne<any>(
    `SELECT COUNT(*) AS n, MAX(createdAt) AS lastAt,
            SUM(status = 'error') AS errors
       FROM WebhookEvent WHERE eventType = 'whatsapp' AND createdAt > NOW() - INTERVAL 24 HOUR`,
  ).catch(() => null);

  const apiVersion = cfg?.apiVersion ?? null;
  const phone = health?.phone ?? null;
  return {
    ok: true as const,
    provider: {
      configured: !!(cfg?.phoneNumberId && cfg?.accessToken),
      enabled: !!cfg?.isEnabled,
      wabaId: cfg?.wabaId ?? null, // non-secret identifier
      phoneNumberIdPresent: !!cfg?.phoneNumberId,
      idsDistinct: !!cfg?.wabaId && !!cfg?.phoneNumberId && cfg.wabaId !== cfg.phoneNumberId,
      apiVersion,
      apiVersionExpiresOn: apiVersion ? (API_VERSION_EXPIRY[apiVersion] ?? null) : null,
      senderNumber: phone?.display_phone_number ?? null,
      verifiedName: phone?.verified_name ?? null,
      qualityRating: phone?.quality_rating ?? null,
      phoneStatus: phone?.status ?? null,
      codeVerification: phone?.code_verification_status ?? null,
      canSendMessage:
        (health?.health as any)?.health_status?.can_send_message ??
        (phone as any)?.health_status?.can_send_message ??
        null,
      tokenValid: health?.token?.valid ?? null,
      tokenScopesOk: health?.token
        ? !!(health.token.hasManagement && health.token.hasMessaging)
        : null,
      healthFetchedAt: health?.fetchedAt ?? null,
      healthError: health?.error ?? null,
      lastApiOkAt: dashboard.lastApiOkAt ? dashboard.lastApiOkAt.toISOString() : null,
    },
    templates: {
      total: dashboard.total,
      byStatus: dashboard.byStatus,
      lastSyncOkAt: dashboard.lastSyncOkAt ? dashboard.lastSyncOkAt.toISOString() : null,
      lastSyncRun: syncRuns[0]
        ? {
            status: syncRuns[0].status,
            trigger: syncRuns[0].trigger,
            scanned: syncRuns[0].scanned,
            startedAt: syncRuns[0].startedAt?.toISOString?.() ?? null,
            error: syncRuns[0].errorMessage,
          }
        : null,
    },
    queue: {
      last24h: metrics24,
      lastHour: metrics1,
      engineEnabled: platform.engineEnabled,
    },
    webhook: {
      received24h: Number(webhook?.n ?? 0),
      errors24h: Number(webhook?.errors ?? 0),
      lastReceivedAt:
        webhook?.lastAt instanceof Date ? webhook.lastAt.toISOString() : (webhook?.lastAt ?? null),
    },
    byCategory: BUSINESS_CATEGORIES.map((c) => ({
      category: c,
      label: BUSINESS_CATEGORY_LABELS[c],
      enabled: platform.categoryEnabled[c],
      ...(metrics24.byCategory[c] ?? { total: 0, delivered: 0, failed: 0 }),
    })),
    recentFailures: failures.rows.map(toPublicEvent),
    alerts: alerts.map((a) => ({
      key: a.alertKey,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      tenantId: a.tenantId,
      firstSeen: iso(a.firstSeenMs),
      lastSeen: iso(a.lastSeenMs),
      occurrences: a.occurrences,
    })),
  };
}

// ── Logs + timeline ──────────────────────────────────────────────────────────
export interface LogsInput {
  tenantId?: string;
  businessCategory?: string;
  appointmentId?: string;
  eventType?: string;
  notifyKind?: string;
  templateName?: string;
  status?: string;
  errorClass?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

function toFilter(input: LogsInput): EventFilter {
  const parseDate = (s?: string) => {
    if (!s) return undefined;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : undefined;
  };
  const status =
    input.status && (EVENT_STATUSES as readonly string[]).includes(input.status)
      ? [input.status]
      : input.status === "problems"
        ? ["failed", "dead", "ambiguous", "blocked"]
        : undefined;
  return {
    tenantId: input.tenantId?.trim() || undefined,
    businessCategory:
      input.businessCategory && isBusinessCategory(input.businessCategory)
        ? input.businessCategory
        : undefined,
    appointmentId: input.appointmentId?.trim() || undefined,
    eventType: input.eventType || undefined,
    notifyKind: input.notifyKind && isNotifyKind(input.notifyKind) ? input.notifyKind : undefined,
    templateName: input.templateName?.trim() || undefined,
    statuses: status,
    errorClass: input.errorClass || undefined,
    fromMs: parseDate(input.from),
    toMs: parseDate(input.to),
    search: input.search?.trim().slice(0, 100) || undefined,
    limit: Math.min(Math.max(Number(input.limit) || 50, 1), 200),
    offset: Math.max(Number(input.offset) || 0, 0),
  };
}

export async function notifyLogs(input: LogsInput) {
  const res = await getNotifyRepo().listEvents(toFilter(input));
  return { ok: true as const, total: res.total, rows: res.rows.map(toPublicEvent) };
}

export async function notifyEventDetail(id: string) {
  const repo = getNotifyRepo();
  const ev = await repo.getEvent(id);
  if (!ev) return { ok: false as const, error: "Notification not found." };
  const audit = await repo.listAudit({ eventId: id, limit: 200 });
  const attempts = await query<any>(
    `SELECT id, status, officialStatus, metaMessageId, errorCode,
            LEFT(errorMessage, 300) AS errorMessage, sentAtMs, deliveredAtMs, readAtMs, failedAtMs,
            createdAt, updatedAt
       FROM WaMessageLog WHERE eventId = ? ORDER BY createdAt ASC`,
    [id],
  ).catch(() => []);
  return {
    ok: true as const,
    event: toPublicEvent(ev),
    timeline: audit.map((a) => ({
      at: iso(a.atMs),
      action: a.action,
      actor: a.actor,
      detail: a.detail,
    })),
    attempts: attempts.map((r: any) => ({
      logId: String(r.id),
      status: r.status,
      providerStatus: r.officialStatus,
      providerMessageId: r.metaMessageId,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      sentAt: iso(r.sentAtMs != null ? Number(r.sentAtMs) : null),
      deliveredAt: iso(r.deliveredAtMs != null ? Number(r.deliveredAtMs) : null),
      readAt: iso(r.readAtMs != null ? Number(r.readAtMs) : null),
      failedAt: iso(r.failedAtMs != null ? Number(r.failedAtMs) : null),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
  };
}

export async function notifyRetry(id: string, actorId: string | null) {
  const repo = getNotifyRepo();
  const ev = await repo.getEvent(id);
  if (!ev) return { ok: false as const, error: "Notification not found." };
  if (ev.providerMessageId) {
    return {
      ok: false as const,
      error: "Meta already accepted this message; retrying would send a duplicate.",
    };
  }
  const ok = await repo.requeue(id, Date.now());
  if (!ok) {
    return {
      ok: false as const,
      error: "Only failed, dead, blocked, ambiguous or expired notifications can be retried.",
    };
  }
  await repo.addAudit({
    tenantId: ev.tenantId,
    eventId: id,
    action: "manual_retry",
    actor: actorId,
    detail: { previousStatus: ev.status },
    atMs: Date.now(),
  });
  const { kickDispatcher } = await import("./notify-dispatcher");
  kickDispatcher();
  return { ok: true as const };
}

// ── Settings ─────────────────────────────────────────────────────────────────
export async function notifySettingsGet() {
  const settings = await getNotifyRepo().getPlatformSettings();
  const { isTestModeProcess } = await import("./notify-dispatcher");
  return { ok: true as const, settings, testModeProcess: isTestModeProcess() };
}

export async function notifySettingsSave(raw: unknown, actorId: string | null) {
  const repo = getNotifyRepo();
  const before = await repo.getPlatformSettings();
  const patch = normalizePlatformSettings({ ...before, ...(raw as object) });
  const saved = await repo.savePlatformSettings(patch as Partial<PlatformSettings>, actorId);
  const changed = Object.keys(saved).filter(
    (k) => JSON.stringify((saved as any)[k]) !== JSON.stringify((before as any)[k]),
  );
  await repo.addAudit({
    action: "platform_settings_updated",
    actor: actorId,
    detail: { changed },
    atMs: Date.now(),
  });
  const { invalidatePlatformSettingsCache } = await import("./notify-dispatcher");
  invalidatePlatformSettingsCache();
  return { ok: true as const, settings: saved };
}

// ── Routing matrix ───────────────────────────────────────────────────────────
export async function notifyRoutes() {
  const { getTemplateRepo } = await import("./wa-template-repo");
  const repo = getTemplateRepo();
  const mappings = await repo.listMappings();
  const templateCache = new Map<string, any>();
  const loadTemplate = async (id: string) => {
    if (!templateCache.has(id)) templateCache.set(id, await repo.getById(id));
    return templateCache.get(id);
  };
  const rows = [];
  for (const category of BUSINESS_CATEGORIES) {
    for (const kind of CATEGORY_KINDS[category]) {
      const specific = mappings.find(
        (m) => m.notifyKind === kind && m.businessCategory === category,
      );
      const generic = mappings.find((m) => m.notifyKind === kind && m.businessCategory === "*");
      const mapping = specific ?? generic ?? null;
      const tpl = mapping ? await loadTemplate(mapping.templateId) : null;
      const status = tpl ? normalizeStatus(tpl.metaStatus).normalized : null;
      const route = catalogRouteFor(category, kind as AptNotifyKind);
      rows.push({
        businessCategory: category,
        categoryLabel: BUSINESS_CATEGORY_LABELS[category],
        kind,
        kindLabel: (NOTIFY_KIND_LABELS as Record<string, string>)[kind] ?? kind,
        catalogTemplate: route ? { name: route.templateName, language: route.language } : null,
        mapping: mapping
          ? {
              scope: mapping.businessCategory,
              templateId: mapping.templateId,
              templateName: tpl?.name ?? null,
              language: tpl?.language ?? mapping.language,
              enabled: mapping.isEnabled,
              optInAck: !!mapping.optInAckAt,
              templateStatus: status,
              templateCategory: tpl?.metaCategory ?? null,
              sendable:
                mapping.isEnabled &&
                !!mapping.optInAckAt &&
                status === "APPROVED" &&
                String(tpl?.metaCategory || "").toUpperCase() === "UTILITY",
            }
          : null,
      });
    }
  }
  return { ok: true as const, rows };
}

export async function notifyRouteSet(
  input: {
    businessCategory: string;
    kind: string;
    templateId?: string | null;
    enabled?: boolean;
    optInAck?: boolean;
    remove?: boolean;
  },
  actorId: string | null,
) {
  if (!isBusinessCategory(input.businessCategory)) {
    return { ok: false as const, error: "Unknown business category." };
  }
  if (!isNotifyKind(input.kind))
    return { ok: false as const, error: "Unknown notification event." };
  const category = input.businessCategory as BusinessCategory;
  if (!CATEGORY_KINDS[category].includes(input.kind as AptNotifyKind)) {
    return { ok: false as const, error: "This event does not apply to this business category." };
  }
  const svc = await import("./wa-templates");
  if (input.remove) {
    const r = await svc.waRemoveMapping(
      { notifyKind: input.kind, businessCategory: category },
      actorId,
    );
    return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
  }
  if (input.templateId) {
    const r = await svc.waAssignMapping(
      { notifyKind: input.kind, templateId: input.templateId, businessCategory: category },
      actorId,
    );
    if (!r.ok) return { ok: false as const, error: [r.error, ...(r.fieldErrors ?? [])].join(" ") };
  }
  if (typeof input.enabled === "boolean") {
    const r = await svc.waSetMappingEnabled(
      {
        notifyKind: input.kind,
        enabled: input.enabled,
        optInAck: input.optInAck === true,
        businessCategory: category,
      },
      actorId,
    );
    if (!r.ok) return { ok: false as const, error: [r.error, ...(r.fieldErrors ?? [])].join(" ") };
  }
  return { ok: true as const };
}

// ── Catalog ──────────────────────────────────────────────────────────────────
export async function notifyCatalogPlan() {
  const { planCatalog } = await import("./notify-template-catalog");
  return { ok: true as const, ...(await planCatalog()) };
}

export async function notifyCatalogSubmit(
  input: { names?: string[] | null; confirm?: boolean },
  actorId: string | null,
) {
  if (input.confirm !== true) {
    return { ok: false as const, error: "Confirm the submission to Meta first." };
  }
  const { submitCatalogTemplates } = await import("./notify-template-catalog");
  const { results } = await submitCatalogTemplates({ names: input.names ?? null, actorId });
  return { ok: true as const, results };
}

export async function notifyCatalogActivate(actorId: string | null) {
  const { activateCatalogRoutes } = await import("./notify-template-catalog");
  const { changes } = await activateCatalogRoutes({ actorId: actorId ?? undefined });
  const { invalidateMappingCache } = await import("./wa-template-notify");
  invalidateMappingCache();
  return { ok: true as const, changes };
}

// ── Explicit test send ───────────────────────────────────────────────────────
/**
 * Sends one approved template with its fictional sample values to a number the
 * Super Admin typed in. Never used for customers; logged as kind 'adminTest'.
 */
export async function notifyTestSend(
  input: { templateId: string; phone: string },
  actorId: string | null,
) {
  const { getTemplateRepo } = await import("./wa-template-repo");
  const { collectPlaceholderKeys } = await import("./wa-template-model");
  const { rowToDraft } = await import("./wa-templates");
  const { normalizeWaPhone, sendTemplateMessage } = await import("./whatsapp-cloud");
  const row = await getTemplateRepo().getById(input.templateId);
  if (!row) return { ok: false as const, error: "Template not found." };
  if (normalizeStatus(row.metaStatus).normalized !== "APPROVED") {
    return { ok: false as const, error: "Only APPROVED templates can be test-sent." };
  }
  const to = normalizeWaPhone(input.phone);
  if (to.length < 10 || to.length > 15)
    return { ok: false as const, error: "Enter a valid WhatsApp number." };
  const draft = rowToDraft(row);
  const keys = collectPlaceholderKeys(draft);
  const bodyParams: Array<{ text: string; name?: string }> = [];
  const urlButtons: Array<{ index: number; suffix: string }> = [];
  for (const key of keys) {
    const sample = row.sampleValues?.[key];
    if (!sample) return { ok: false as const, error: `No sample value is stored for ${key}.` };
    if (key.startsWith("body.")) bodyParams.push({ text: sample });
    else if (key.startsWith("button.")) {
      const idx = Number(key.split(".")[1]);
      const suffix = /\/consult\/([A-Za-z0-9_-]+)/.exec(sample)?.[1] ?? sample;
      urlButtons.push({ index: idx, suffix });
    }
  }
  const res = await sendTemplateMessage({
    to,
    templateName: row.name,
    language: row.language,
    parameterFormat: row.parameterFormat,
    bodyParams,
    urlButtons,
  });
  const crypto = await import("crypto");
  const { execute } = await import("./db");
  await execute(
    `INSERT INTO WaMessageLog
       (id, tenantId, direction, recipient, kind, templateId, channel, status, officialAttempted,
        metaMessageId, officialStatus, errorCode, errorMessage, createdAt)
     VALUES (?, 'global', 'out', ?, 'adminTest', ?, 'official', ?, 1, ?, ?, ?, ?, NOW())`,
    [
      crypto.randomUUID(),
      to,
      row.id,
      res.ok ? "sent" : "failed",
      res.ok ? res.messageId : null,
      res.ok ? "sent" : "failed",
      res.ok ? null : res.kind === "meta_error" ? res.code : "transport",
      res.ok ? null : String(res.message).slice(0, 300),
    ],
  ).catch(() => {});
  await getNotifyRepo().addAudit({
    action: "template_test_send",
    actor: actorId,
    detail: { template: row.name, language: row.language, ok: res.ok, recipient: maskPhone(to) },
    atMs: Date.now(),
  });
  if (res.ok) return { ok: true as const, messageId: res.messageId };
  return {
    ok: false as const,
    error: res.kind === "meta_error" ? `Meta error ${res.code}: ${res.message}` : res.message,
  };
}

export async function notifyResolveAlert(key: string) {
  const ok = await getNotifyRepo().resolveAlert(key, Date.now());
  return ok ? { ok: true as const } : { ok: false as const, error: "Alert not open." };
}
