// ─────────────────────────────────────────────────────────────────────────────
// notify-repo.ts  (server-only)
//
// Persistence for the notification engine: the NotificationEvent outbox/job
// table, tenant + platform settings, recipient consent, the audit trail and
// operational alerts. All SQL lives here behind the NotifyRepo interface so the
// dispatcher and services are testable with the in-memory double
// (notify-repo.memory.ts), mirroring wa-template-repo.ts.
//
// Every tenant-facing read takes a tenantId and filters on it; callers bind the
// tenantId from the verified session, never from client input.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import type { PoolConnection } from "mariadb";
import { execute, query, queryOne } from "./db";
import {
  BUSINESS_CATEGORIES,
  isBusinessCategory,
  type BusinessCategory,
  type NotificationEventType,
} from "./notify-catalog";
import type { AptNotifyKind } from "./appointment-notify";
import type { ErrorClass } from "./wa-error-classify";

// ── Event model ──────────────────────────────────────────────────────────────
export type EventStatus =
  | "pending"
  | "processing"
  | "retry"
  | "submitted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "dead"
  | "ambiguous"
  | "cancelled"
  | "skipped"
  | "blocked"
  | "expired"
  | "superseded";

export const EVENT_STATUSES: readonly EventStatus[] = [
  "pending",
  "processing",
  "retry",
  "submitted",
  "sent",
  "delivered",
  "read",
  "failed",
  "dead",
  "ambiguous",
  "cancelled",
  "skipped",
  "blocked",
  "expired",
  "superseded",
];

/** Statuses the dispatcher may claim. */
export const DISPATCHABLE: readonly EventStatus[] = ["pending", "retry"];

/** Provider delivery progression (monotonic). */
export const DELIVERY_RANK: Partial<Record<EventStatus, number>> = {
  submitted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export interface NotificationEventRow {
  id: string;
  eventKey: string;
  tenantId: string;
  businessCategory: BusinessCategory;
  eventType: NotificationEventType;
  notifyKind: AptNotifyKind;
  appointmentId: string | null;
  channel: string;
  recipient: string | null;
  source: string | null;
  status: EventStatus;
  statusReason: string | null;
  errorClass: ErrorClass | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  scheduledForMs: number;
  nextAttemptAtMs: number;
  expiresAtMs: number | null;
  lockedBy: string | null;
  claimToken: string | null;
  lockedUntilMs: number | null;
  sendStartedAtMs: number | null;
  appointmentAtLocal: string | null;
  templateId: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  waMessageLogId: string | null;
  providerMessageId: string | null;
  submittedAtMs: number | null;
  deliveredAtMs: number | null;
  readAtMs: number | null;
  failedAtMs: number | null;
  payload: Record<string, unknown> | null;
  createdAtMs: number;
}

export interface NewEventInput {
  eventKey: string;
  tenantId: string;
  businessCategory: BusinessCategory;
  eventType: NotificationEventType;
  notifyKind: AptNotifyKind;
  appointmentId?: string | null;
  recipient?: string | null;
  source?: string | null;
  scheduledForMs: number;
  expiresAtMs?: number | null;
  appointmentAtLocal?: string | null;
  payload?: Record<string, unknown> | null;
  maxAttempts?: number;
  /** Events can be recorded already-terminal (e.g. skipped at creation). */
  status?: "pending" | "skipped" | "cancelled";
  statusReason?: string | null;
  createdAtMs: number;
}

export interface EventPatch {
  status?: EventStatus;
  statusReason?: string | null;
  errorClass?: ErrorClass | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  nextAttemptAtMs?: number;
  recipient?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  waMessageLogId?: string | null;
  providerMessageId?: string | null;
  submittedAtMs?: number | null;
  failedAtMs?: number | null;
  attempts?: number;
}

export interface EventFilter {
  tenantId?: string;
  businessCategory?: string;
  appointmentId?: string;
  eventType?: string;
  notifyKind?: string;
  templateName?: string;
  statuses?: string[];
  errorClass?: string;
  fromMs?: number;
  toMs?: number;
  /** Matches an event id, appointment id or event key prefix. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface EventListResult {
  rows: NotificationEventRow[];
  total: number;
}

export interface NotifyMetrics {
  sinceMs: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, { total: number; delivered: number; failed: number }>;
  dueBacklog: number;
  oldestDueMs: number | null;
  retries: number;
  avgDispatchLatencyMs: number | null;
  avgDeliveryLatencyMs: number | null;
}

// ── Settings / consent / audit / alerts ──────────────────────────────────────
export interface TenantNotificationSettings {
  tenantId: string;
  whatsappEnabled: boolean;
  confirmations: boolean;
  reschedules: boolean;
  cancellations: boolean;
  completions: boolean;
  reminderDayBefore: boolean;
  reminder2h: boolean;
  queueUpdates: boolean;
  timezone: string | null;
  updatedBy: string | null;
  persisted: boolean;
}

export type TenantSettingsPatch = Partial<
  Omit<TenantNotificationSettings, "tenantId" | "updatedBy" | "persisted">
>;

export function defaultTenantSettings(tenantId: string): TenantNotificationSettings {
  return {
    tenantId,
    whatsappEnabled: true,
    confirmations: true,
    reschedules: true,
    cancellations: true,
    completions: true,
    reminderDayBefore: true,
    reminder2h: false,
    queueUpdates: true,
    timezone: null,
    updatedBy: null,
    persisted: false,
  };
}

export type ConsentMode = "implied_by_booking" | "explicit_only";

export interface PlatformSettings {
  /** Master switch: when false the dispatcher leaves events pending. */
  engineEnabled: boolean;
  /**
   * implied_by_booking: a customer who gave their WhatsApp number for a booking
   * may receive that booking's transactional updates unless they opted out.
   * explicit_only: send only after a recorded opt-in.
   */
  consentMode: ConsentMode;
  /** Map newly APPROVED catalog templates to their events automatically. */
  autoActivateCatalog: boolean;
  categoryEnabled: Record<BusinessCategory, boolean>;
  maxAttempts: number;
  sendRatePerSecond: number;
  concurrency: number;
  reminderEarliestHour: number;
  reminderLatestHour: number;
  sameDayReminderHours: number;
  alertFailureRatePct: number;
  alertMinSample: number;
  alertBacklogThreshold: number;
  retentionDays: number;
  templateSyncMinutes: number;
  pendingTemplateSyncMinutes: number;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  engineEnabled: true,
  consentMode: "implied_by_booking",
  autoActivateCatalog: true,
  categoryEnabled: Object.fromEntries(BUSINESS_CATEGORIES.map((c) => [c, true])) as Record<
    BusinessCategory,
    boolean
  >,
  maxAttempts: 5,
  sendRatePerSecond: 20,
  concurrency: 4,
  reminderEarliestHour: 8,
  reminderLatestHour: 21,
  sameDayReminderHours: 2,
  alertFailureRatePct: 25,
  alertMinSample: 10,
  alertBacklogThreshold: 100,
  retentionDays: 180,
  templateSyncMinutes: 360,
  pendingTemplateSyncMinutes: 30,
};

const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** Validates and normalizes a (possibly partial / untrusted) settings object. */
export function normalizePlatformSettings(raw: unknown): PlatformSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PLATFORM_SETTINGS;
  const cats = (
    o.categoryEnabled && typeof o.categoryEnabled === "object" ? o.categoryEnabled : {}
  ) as Record<string, unknown>;
  const earliest = clampInt(o.reminderEarliestHour, 0, 23, d.reminderEarliestHour);
  const latest = clampInt(o.reminderLatestHour, 1, 24, d.reminderLatestHour);
  return {
    engineEnabled: typeof o.engineEnabled === "boolean" ? o.engineEnabled : d.engineEnabled,
    consentMode: o.consentMode === "explicit_only" ? "explicit_only" : "implied_by_booking",
    autoActivateCatalog:
      typeof o.autoActivateCatalog === "boolean" ? o.autoActivateCatalog : d.autoActivateCatalog,
    categoryEnabled: Object.fromEntries(
      BUSINESS_CATEGORIES.map((c) => [c, typeof cats[c] === "boolean" ? cats[c] : true]),
    ) as Record<BusinessCategory, boolean>,
    maxAttempts: clampInt(o.maxAttempts, 1, 10, d.maxAttempts),
    sendRatePerSecond: clampInt(o.sendRatePerSecond, 1, 80, d.sendRatePerSecond),
    concurrency: clampInt(o.concurrency, 1, 16, d.concurrency),
    reminderEarliestHour: earliest,
    reminderLatestHour: latest > earliest ? latest : Math.min(24, earliest + 1),
    sameDayReminderHours: clampInt(o.sameDayReminderHours, 1, 6, d.sameDayReminderHours),
    alertFailureRatePct: clampInt(o.alertFailureRatePct, 1, 100, d.alertFailureRatePct),
    alertMinSample: clampInt(o.alertMinSample, 1, 1000, d.alertMinSample),
    alertBacklogThreshold: clampInt(o.alertBacklogThreshold, 1, 100000, d.alertBacklogThreshold),
    retentionDays: clampInt(o.retentionDays, 30, 3650, d.retentionDays),
    templateSyncMinutes: clampInt(o.templateSyncMinutes, 30, 1440, d.templateSyncMinutes),
    pendingTemplateSyncMinutes: clampInt(
      o.pendingTemplateSyncMinutes,
      10,
      720,
      d.pendingTemplateSyncMinutes,
    ),
  };
}

export type ConsentStatus = "opted_in" | "opted_out";

export interface ConsentRow {
  id: string;
  tenantId: string;
  phone: string;
  channel: string;
  status: ConsentStatus;
  source: string;
  noticeVersion: string | null;
  appointmentId: string | null;
  capturedAtMs: number;
  withdrawnAtMs: number | null;
}

/** Platform-wide consent scope (e.g. STOP sent to the shared WhatsApp number). */
export const PLATFORM_CONSENT_SCOPE = "*";

export interface AuditInput {
  tenantId?: string | null;
  eventId?: string | null;
  action: string;
  actor?: string | null;
  detail?: Record<string, unknown> | null;
  atMs: number;
}

export interface AuditRow extends Required<Omit<AuditInput, "detail">> {
  id: string;
  detail: Record<string, unknown> | null;
}

export interface AlertRow {
  alertKey: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "resolved";
  title: string;
  detail: string | null;
  tenantId: string | null;
  firstSeenMs: number;
  lastSeenMs: number;
  occurrences: number;
  resolvedAtMs: number | null;
  notifiedAtMs: number | null;
}

export interface AlertInput {
  alertKey: string;
  severity: AlertRow["severity"];
  title: string;
  detail?: string | null;
  tenantId?: string | null;
  nowMs: number;
}

// ── Interface ────────────────────────────────────────────────────────────────
export interface NotifyRepo {
  insertEvent(
    input: NewEventInput,
    conn?: PoolConnection,
  ): Promise<{ inserted: boolean; id: string }>;
  getEvent(id: string): Promise<NotificationEventRow | null>;
  getEventByKey(eventKey: string): Promise<NotificationEventRow | null>;
  claimDue(opts: {
    workerId: string;
    nowMs: number;
    limit: number;
    leaseMs: number;
    recipientAllowList?: string[] | null;
  }): Promise<NotificationEventRow[]>;
  /** Claims one specific due event (immediate dispatch right after a booking). */
  claimById(opts: {
    id: string;
    workerId: string;
    nowMs: number;
    leaseMs: number;
    recipientAllowList?: string[] | null;
  }): Promise<NotificationEventRow | null>;
  recoverStale(nowMs: number): Promise<{ requeued: number; ambiguous: number }>;
  markSendStarted(id: string, claimToken: string, nowMs: number): Promise<boolean>;
  /** Finalizes a claimed event; only the holder of `claimToken` may do so. */
  finishClaimed(id: string, claimToken: string, patch: EventPatch): Promise<boolean>;
  /** Cancels dispatchable events of an appointment for the given kinds. */
  cancelPending(input: {
    tenantId: string;
    appointmentId: string;
    kinds: readonly AptNotifyKind[];
    status: "cancelled" | "superseded";
    reason: string;
    exceptEventKey?: string | null;
  }): Promise<number>;
  listEventsForAppointment(
    tenantId: string,
    appointmentId: string,
  ): Promise<NotificationEventRow[]>;
  findByProviderMessageId(providerMessageId: string): Promise<NotificationEventRow | null>;
  /** Monotonic delivery update (submitted < sent < delivered < read; failed ends it). */
  applyDeliveryStatus(input: {
    id: string;
    status: "sent" | "delivered" | "read" | "failed";
    atMs: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    errorClass?: ErrorClass | null;
  }): Promise<boolean>;
  /** Admin/tenant safe requeue; returns false when not requeueable. */
  requeue(id: string, nowMs: number, tenantId?: string | null): Promise<boolean>;
  /** Re-activates a cancelled/superseded, never-sent event (e.g. reinstated booking). */
  reviveEvent(id: string, nextAttemptAtMs: number, reason: string): Promise<boolean>;
  /** Makes a held pending event due now (post-commit release). */
  releaseHold(id: string, nowMs: number): Promise<boolean>;
  listEvents(filter: EventFilter): Promise<EventListResult>;
  /** Event counts by status for one tenant since a time (tenant dashboards). */
  statusCounts(tenantId: string, sinceMs: number): Promise<Record<string, number>>;
  metrics(sinceMs: number, nowMs: number): Promise<NotifyMetrics>;
  purgeOlderThan(cutoffMs: number): Promise<{ events: number; audit: number }>;

  getTenantSettings(tenantId: string): Promise<TenantNotificationSettings>;
  saveTenantSettings(
    tenantId: string,
    patch: TenantSettingsPatch,
    actor: string | null,
  ): Promise<TenantNotificationSettings>;
  getPlatformSettings(): Promise<PlatformSettings>;
  savePlatformSettings(
    patch: Partial<PlatformSettings>,
    actor: string | null,
  ): Promise<PlatformSettings>;

  getConsent(tenantId: string, phone: string): Promise<ConsentRow | null>;
  upsertConsent(input: Omit<ConsentRow, "id" | "channel">): Promise<void>;
  listConsents(tenantId: string, limit: number): Promise<ConsentRow[]>;

  addAudit(input: AuditInput): Promise<void>;
  listAudit(filter: { eventId?: string; tenantId?: string; limit?: number }): Promise<AuditRow[]>;

  upsertAlert(input: AlertInput): Promise<{ isNew: boolean; row: AlertRow }>;
  resolveAlert(alertKey: string, nowMs: number): Promise<boolean>;
  markAlertNotified(alertKey: string, nowMs: number): Promise<void>;
  listAlerts(status?: "open" | "resolved" | null, limit?: number): Promise<AlertRow[]>;
}

// ── Row helpers ──────────────────────────────────────────────────────────────
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
}

function toEventRow(r: Record<string, unknown>): NotificationEventRow {
  return {
    id: String(r.id),
    eventKey: String(r.eventKey),
    tenantId: String(r.tenantId),
    businessCategory: (isBusinessCategory(r.businessCategory)
      ? r.businessCategory
      : "clinic") as BusinessCategory,
    eventType: String(r.eventType) as NotificationEventType,
    notifyKind: String(r.notifyKind) as AptNotifyKind,
    appointmentId: strOrNull(r.appointmentId),
    channel: String(r.channel ?? "whatsapp"),
    recipient: strOrNull(r.recipient),
    source: strOrNull(r.source),
    status: String(r.status) as EventStatus,
    statusReason: strOrNull(r.statusReason),
    errorClass: strOrNull(r.errorClass) as ErrorClass | null,
    errorCode: strOrNull(r.errorCode),
    errorMessage: strOrNull(r.errorMessage),
    attempts: num(r.attempts),
    maxAttempts: num(r.maxAttempts) || 5,
    scheduledForMs: num(r.scheduledForMs),
    nextAttemptAtMs: num(r.nextAttemptAtMs),
    expiresAtMs: numOrNull(r.expiresAtMs),
    lockedBy: strOrNull(r.lockedBy),
    claimToken: strOrNull(r.claimToken),
    lockedUntilMs: numOrNull(r.lockedUntilMs),
    sendStartedAtMs: numOrNull(r.sendStartedAtMs),
    appointmentAtLocal: strOrNull(r.appointmentAtLocal),
    templateId: strOrNull(r.templateId),
    templateName: strOrNull(r.templateName),
    templateLanguage: strOrNull(r.templateLanguage),
    waMessageLogId: strOrNull(r.waMessageLogId),
    providerMessageId: strOrNull(r.providerMessageId),
    submittedAtMs: numOrNull(r.submittedAtMs),
    deliveredAtMs: numOrNull(r.deliveredAtMs),
    readAtMs: numOrNull(r.readAtMs),
    failedAtMs: numOrNull(r.failedAtMs),
    payload: parseJson<Record<string, unknown>>(r.payload),
    createdAtMs: num(r.createdAtMs),
  };
}

function toConsentRow(r: Record<string, unknown>): ConsentRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId),
    phone: String(r.phone),
    channel: String(r.channel ?? "whatsapp"),
    status: String(r.status) === "opted_out" ? "opted_out" : "opted_in",
    source: String(r.source),
    noticeVersion: strOrNull(r.noticeVersion),
    appointmentId: strOrNull(r.appointmentId),
    capturedAtMs: num(r.capturedAtMs),
    withdrawnAtMs: numOrNull(r.withdrawnAtMs),
  };
}

function toAlertRow(r: Record<string, unknown>): AlertRow {
  const sev = String(r.severity);
  return {
    alertKey: String(r.alertKey),
    severity: sev === "critical" || sev === "info" ? sev : "warning",
    status: String(r.status) === "resolved" ? "resolved" : "open",
    title: String(r.title),
    detail: strOrNull(r.detail),
    tenantId: strOrNull(r.tenantId),
    firstSeenMs: num(r.firstSeenMs),
    lastSeenMs: num(r.lastSeenMs),
    occurrences: num(r.occurrences),
    resolvedAtMs: numOrNull(r.resolvedAtMs),
    notifiedAtMs: numOrNull(r.notifiedAtMs),
  };
}

const bool = (v: unknown, dflt: boolean): boolean => (v == null ? dflt : Number(v) === 1);

function toTenantSettings(tenantId: string, r: Record<string, unknown> | null) {
  const d = defaultTenantSettings(tenantId);
  if (!r) return d;
  return {
    tenantId,
    whatsappEnabled: bool(r.whatsappEnabled, d.whatsappEnabled),
    confirmations: bool(r.confirmations, d.confirmations),
    reschedules: bool(r.reschedules, d.reschedules),
    cancellations: bool(r.cancellations, d.cancellations),
    completions: bool(r.completions, d.completions),
    reminderDayBefore: bool(r.reminderDayBefore, d.reminderDayBefore),
    reminder2h: bool(r.reminder2h, d.reminder2h),
    queueUpdates: bool(r.queueUpdates, d.queueUpdates),
    timezone: strOrNull(r.timezone),
    updatedBy: strOrNull(r.updatedBy),
    persisted: true,
  } satisfies TenantNotificationSettings;
}

function isDuplicateKey(err: any): boolean {
  return err?.errno === 1062 || err?.code === "ER_DUP_ENTRY";
}

const TERMINAL_FOR_PURGE = [
  "submitted",
  "sent",
  "delivered",
  "read",
  "failed",
  "dead",
  "cancelled",
  "skipped",
  "blocked",
  "expired",
  "superseded",
  "ambiguous",
];

const TENANT_SETTING_COLUMNS = [
  "whatsappEnabled",
  "confirmations",
  "reschedules",
  "cancellations",
  "completions",
  "reminderDayBefore",
  "reminder2h",
  "queueUpdates",
] as const;

// ── SQL implementation ───────────────────────────────────────────────────────
class SqlNotifyRepo implements NotifyRepo {
  async insertEvent(input: NewEventInput, conn?: PoolConnection) {
    const id = crypto.randomUUID();
    const sql = `INSERT INTO NotificationEvent
      (id, eventKey, tenantId, businessCategory, eventType, notifyKind, appointmentId, channel,
       recipient, source, status, statusReason, attempts, maxAttempts, scheduledForMs,
       nextAttemptAtMs, expiresAtMs, appointmentAtLocal, payload, createdAtMs)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'whatsapp', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      id,
      input.eventKey,
      input.tenantId,
      input.businessCategory,
      input.eventType,
      input.notifyKind,
      input.appointmentId ?? null,
      input.recipient ?? null,
      input.source ?? null,
      input.status ?? "pending",
      input.statusReason ?? null,
      input.maxAttempts ?? 5,
      input.scheduledForMs,
      input.scheduledForMs,
      input.expiresAtMs ?? null,
      input.appointmentAtLocal ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.createdAtMs,
    ];
    try {
      if (conn) await conn.query(sql, params);
      else await execute(sql, params);
      return { inserted: true, id };
    } catch (err: any) {
      if (isDuplicateKey(err)) {
        const existing = conn
          ? (
              (await conn.query("SELECT id FROM NotificationEvent WHERE eventKey = ? LIMIT 1", [
                input.eventKey,
              ])) as any[]
            )[0]
          : await queryOne<any>("SELECT id FROM NotificationEvent WHERE eventKey = ? LIMIT 1", [
              input.eventKey,
            ]);
        return { inserted: false, id: existing ? String(existing.id) : "" };
      }
      throw err;
    }
  }

  async getEvent(id: string) {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM NotificationEvent WHERE id = ? LIMIT 1",
      [id],
    );
    return r ? toEventRow(r) : null;
  }

  async getEventByKey(eventKey: string) {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM NotificationEvent WHERE eventKey = ? LIMIT 1",
      [eventKey],
    );
    return r ? toEventRow(r) : null;
  }

  async claimDue(opts: {
    workerId: string;
    nowMs: number;
    limit: number;
    leaseMs: number;
    recipientAllowList?: string[] | null;
  }) {
    const token = crypto.randomUUID();
    const params: unknown[] = [opts.workerId, token, opts.nowMs + opts.leaseMs, opts.nowMs];
    let allow = "";
    if (opts.recipientAllowList) {
      if (opts.recipientAllowList.length === 0) return [];
      allow = " AND recipient IN (?)";
      params.push(opts.recipientAllowList);
    }
    params.push(Math.max(1, Math.min(opts.limit, 50)));
    const res = await execute(
      `UPDATE NotificationEvent
          SET status = 'processing', lockedBy = ?, claimToken = ?, lockedUntilMs = ?,
              sendStartedAtMs = NULL, attempts = attempts + 1
        WHERE status IN ('pending', 'retry') AND nextAttemptAtMs <= ?${allow}
        ORDER BY nextAttemptAtMs ASC
        LIMIT ?`,
      params,
    );
    if (!res.affectedRows) return [];
    const rows = await query<Record<string, unknown>>(
      "SELECT * FROM NotificationEvent WHERE claimToken = ? ORDER BY nextAttemptAtMs ASC",
      [token],
    );
    return rows.map(toEventRow);
  }

  async claimById(opts: {
    id: string;
    workerId: string;
    nowMs: number;
    leaseMs: number;
    recipientAllowList?: string[] | null;
  }) {
    if (opts.recipientAllowList && opts.recipientAllowList.length === 0) return null;
    const token = crypto.randomUUID();
    const params: unknown[] = [
      opts.workerId,
      token,
      opts.nowMs + opts.leaseMs,
      opts.id,
      opts.nowMs,
    ];
    let allow = "";
    if (opts.recipientAllowList) {
      allow = " AND recipient IN (?)";
      params.push(opts.recipientAllowList);
    }
    const res = await execute(
      `UPDATE NotificationEvent
          SET status = 'processing', lockedBy = ?, claimToken = ?, lockedUntilMs = ?,
              sendStartedAtMs = NULL, attempts = attempts + 1
        WHERE id = ? AND status IN ('pending', 'retry') AND nextAttemptAtMs <= ?${allow}`,
      params,
    );
    if (!res.affectedRows) return null;
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM NotificationEvent WHERE claimToken = ? LIMIT 1",
      [token],
    );
    return r ? toEventRow(r) : null;
  }

  async recoverStale(nowMs: number) {
    const requeued = await execute(
      `UPDATE NotificationEvent
          SET status = 'retry', statusReason = 'lease_expired_requeued', nextAttemptAtMs = ?,
              lockedBy = NULL, claimToken = NULL, lockedUntilMs = NULL
        WHERE status = 'processing' AND lockedUntilMs IS NOT NULL AND lockedUntilMs < ?
          AND sendStartedAtMs IS NULL`,
      [nowMs, nowMs],
    );
    const ambiguous = await execute(
      `UPDATE NotificationEvent
          SET status = 'ambiguous', statusReason = 'worker_stopped_mid_send', errorClass = 'unknown',
              lockedBy = NULL, claimToken = NULL, lockedUntilMs = NULL
        WHERE status = 'processing' AND lockedUntilMs IS NOT NULL AND lockedUntilMs < ?
          AND sendStartedAtMs IS NOT NULL`,
      [nowMs],
    );
    return { requeued: requeued.affectedRows, ambiguous: ambiguous.affectedRows };
  }

  async markSendStarted(id: string, claimToken: string, nowMs: number) {
    const res = await execute(
      "UPDATE NotificationEvent SET sendStartedAtMs = ? WHERE id = ? AND claimToken = ?",
      [nowMs, id, claimToken],
    );
    return res.affectedRows > 0;
  }

  async finishClaimed(id: string, claimToken: string, patch: EventPatch) {
    const sets: string[] = ["lockedBy = NULL", "claimToken = NULL", "lockedUntilMs = NULL"];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(v);
    }
    params.push(id, claimToken);
    const res = await execute(
      `UPDATE NotificationEvent SET ${sets.join(", ")} WHERE id = ? AND claimToken = ?`,
      params,
    );
    return res.affectedRows > 0;
  }

  async cancelPending(input: {
    tenantId: string;
    appointmentId: string;
    kinds: readonly AptNotifyKind[];
    status: "cancelled" | "superseded";
    reason: string;
    exceptEventKey?: string | null;
  }) {
    if (input.kinds.length === 0) return 0;
    const params: unknown[] = [
      input.status,
      input.reason,
      input.tenantId,
      input.appointmentId,
      [...input.kinds],
    ];
    let except = "";
    if (input.exceptEventKey) {
      except = " AND eventKey <> ?";
      params.push(input.exceptEventKey);
    }
    const res = await execute(
      `UPDATE NotificationEvent SET status = ?, statusReason = ?
        WHERE tenantId = ? AND appointmentId = ? AND status IN ('pending', 'retry')
          AND notifyKind IN (?)${except}`,
      params,
    );
    return res.affectedRows;
  }

  async listEventsForAppointment(tenantId: string, appointmentId: string) {
    const rows = await query<Record<string, unknown>>(
      "SELECT * FROM NotificationEvent WHERE tenantId = ? AND appointmentId = ? ORDER BY createdAtMs ASC",
      [tenantId, appointmentId],
    );
    return rows.map(toEventRow);
  }

  async findByProviderMessageId(providerMessageId: string) {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM NotificationEvent WHERE providerMessageId = ? LIMIT 1",
      [providerMessageId],
    );
    return r ? toEventRow(r) : null;
  }

  async applyDeliveryStatus(input: {
    id: string;
    status: "sent" | "delivered" | "read" | "failed";
    atMs: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    errorClass?: ErrorClass | null;
  }) {
    const row = await this.getEvent(input.id);
    if (!row) return false;
    if (!shouldApplyDelivery(row.status, input.status)) return false;
    const sets = ["status = ?"];
    const params: unknown[] = [input.status];
    if (input.status === "delivered") sets.push("deliveredAtMs = COALESCE(deliveredAtMs, ?)");
    if (input.status === "read") {
      sets.push("readAtMs = COALESCE(readAtMs, ?)");
      params.push(input.atMs);
      sets.push("deliveredAtMs = COALESCE(deliveredAtMs, ?)");
    }
    if (input.status === "failed") {
      sets.push("failedAtMs = COALESCE(failedAtMs, ?)");
      sets.push("errorCode = ?", "errorMessage = ?", "errorClass = ?", "statusReason = ?");
    }
    if (input.status === "delivered" || input.status === "read" || input.status === "failed") {
      params.push(input.atMs);
    }
    if (input.status === "failed") {
      params.push(
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.errorClass ?? "unknown",
        "provider_failed",
      );
    }
    params.push(input.id, row.status);
    const res = await execute(
      `UPDATE NotificationEvent SET ${sets.join(", ")} WHERE id = ? AND status = ?`,
      params,
    );
    return res.affectedRows > 0;
  }

  async requeue(id: string, nowMs: number, tenantId?: string | null) {
    const params: unknown[] = [nowMs, id];
    let scope = "";
    if (tenantId) {
      scope = " AND tenantId = ?";
      params.push(tenantId);
    }
    const res = await execute(
      `UPDATE NotificationEvent
          SET status = 'retry', statusReason = 'manual_retry', nextAttemptAtMs = ?,
              errorClass = NULL, errorCode = NULL, errorMessage = NULL, attempts = 0,
              lockedBy = NULL, claimToken = NULL, lockedUntilMs = NULL, sendStartedAtMs = NULL
        WHERE id = ?${scope}
          AND status IN ('failed', 'dead', 'blocked', 'ambiguous', 'expired')
          AND providerMessageId IS NULL`,
      params,
    );
    return res.affectedRows > 0;
  }

  async releaseHold(id: string, nowMs: number) {
    const res = await execute(
      `UPDATE NotificationEvent SET nextAttemptAtMs = ?, scheduledForMs = LEAST(scheduledForMs, ?)
        WHERE id = ? AND status = 'pending' AND nextAttemptAtMs > ?`,
      [nowMs, nowMs, id, nowMs],
    );
    return res.affectedRows > 0;
  }

  async reviveEvent(id: string, nextAttemptAtMs: number, reason: string) {
    const res = await execute(
      `UPDATE NotificationEvent
          SET status = 'pending', statusReason = ?, nextAttemptAtMs = ?, scheduledForMs = ?,
              attempts = 0, errorClass = NULL, errorCode = NULL, errorMessage = NULL
        WHERE id = ? AND status IN ('cancelled', 'superseded') AND providerMessageId IS NULL`,
      [reason, nextAttemptAtMs, nextAttemptAtMs, id],
    );
    return res.affectedRows > 0;
  }

  async listEvents(filter: EventFilter) {
    const where: string[] = [];
    const params: unknown[] = [];
    const eq = (col: string, v: unknown) => {
      if (v == null || v === "") return;
      where.push(`${col} = ?`);
      params.push(v);
    };
    eq("tenantId", filter.tenantId);
    eq("businessCategory", filter.businessCategory);
    eq("appointmentId", filter.appointmentId);
    eq("eventType", filter.eventType);
    eq("notifyKind", filter.notifyKind);
    eq("templateName", filter.templateName);
    eq("errorClass", filter.errorClass);
    if (filter.statuses && filter.statuses.length > 0) {
      where.push("status IN (?)");
      params.push(filter.statuses);
    }
    if (filter.fromMs != null) {
      where.push("createdAtMs >= ?");
      params.push(filter.fromMs);
    }
    if (filter.toMs != null) {
      where.push("createdAtMs < ?");
      params.push(filter.toMs);
    }
    if (filter.search && filter.search.trim()) {
      const s = filter.search.trim();
      where.push("(id = ? OR appointmentId = ? OR eventKey LIKE ?)");
      params.push(s, s, `${s.replace(/[%_\\]/g, "\\$&")}%`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(Number(filter.limit) || 50, 200));
    const offset = Math.max(0, Number(filter.offset) || 0);
    const total = await queryOne<any>(
      `SELECT COUNT(*) AS n FROM NotificationEvent ${clause}`,
      params,
    );
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM NotificationEvent ${clause} ORDER BY createdAtMs DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { rows: rows.map(toEventRow), total: num(total?.n) };
  }

  async statusCounts(tenantId: string, sinceMs: number) {
    const rows = await query<any>(
      `SELECT status, COUNT(*) AS n FROM NotificationEvent
        WHERE tenantId = ? AND createdAtMs >= ? GROUP BY status`,
      [tenantId, sinceMs],
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.status)] = num(r.n);
    return out;
  }

  async metrics(sinceMs: number, nowMs: number): Promise<NotifyMetrics> {
    const byStatusRows = await query<any>(
      "SELECT status, COUNT(*) AS n FROM NotificationEvent WHERE createdAtMs >= ? GROUP BY status",
      [sinceMs],
    );
    const byCatRows = await query<any>(
      `SELECT businessCategory,
              COUNT(*) AS total,
              SUM(status IN ('delivered', 'read')) AS delivered,
              SUM(status IN ('failed', 'dead', 'ambiguous')) AS failed
         FROM NotificationEvent WHERE createdAtMs >= ? GROUP BY businessCategory`,
      [sinceMs],
    );
    const backlog = await queryOne<any>(
      `SELECT COUNT(*) AS n, MIN(nextAttemptAtMs) AS oldest FROM NotificationEvent
        WHERE status IN ('pending', 'retry') AND nextAttemptAtMs <= ?`,
      [nowMs],
    );
    const lat = await queryOne<any>(
      `SELECT AVG(CASE WHEN submittedAtMs >= scheduledForMs THEN submittedAtMs - scheduledForMs END) AS dispatch,
              AVG(CASE WHEN deliveredAtMs >= submittedAtMs THEN deliveredAtMs - submittedAtMs END) AS delivery,
              SUM(GREATEST(attempts - 1, 0)) AS retries
         FROM NotificationEvent WHERE createdAtMs >= ?`,
      [sinceMs],
    );
    const byStatus: Record<string, number> = {};
    for (const r of byStatusRows) byStatus[String(r.status)] = num(r.n);
    const byCategory: NotifyMetrics["byCategory"] = {};
    for (const r of byCatRows) {
      byCategory[String(r.businessCategory)] = {
        total: num(r.total),
        delivered: num(r.delivered),
        failed: num(r.failed),
      };
    }
    return {
      sinceMs,
      byStatus,
      byCategory,
      dueBacklog: num(backlog?.n),
      oldestDueMs: numOrNull(backlog?.oldest),
      retries: num(lat?.retries),
      avgDispatchLatencyMs: lat?.dispatch == null ? null : Math.round(Number(lat.dispatch)),
      avgDeliveryLatencyMs: lat?.delivery == null ? null : Math.round(Number(lat.delivery)),
    };
  }

  async purgeOlderThan(cutoffMs: number) {
    const events = await execute(
      `DELETE FROM NotificationEvent WHERE createdAtMs < ? AND status IN (?) LIMIT 2000`,
      [cutoffMs, TERMINAL_FOR_PURGE],
    );
    const audit = await execute("DELETE FROM NotificationAudit WHERE atMs < ? LIMIT 5000", [
      cutoffMs,
    ]);
    return { events: events.affectedRows, audit: audit.affectedRows };
  }

  async getTenantSettings(tenantId: string) {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM TenantNotificationSettings WHERE tenantId = ? LIMIT 1",
      [tenantId],
    );
    return toTenantSettings(tenantId, r);
  }

  async saveTenantSettings(tenantId: string, patch: TenantSettingsPatch, actor: string | null) {
    const current = await this.getTenantSettings(tenantId);
    const next = { ...current, ...patch };
    const values = TENANT_SETTING_COLUMNS.map((c) => (next[c] ? 1 : 0));
    await execute(
      `INSERT INTO TenantNotificationSettings
         (tenantId, ${TENANT_SETTING_COLUMNS.join(", ")}, timezone, updatedBy)
       VALUES (?, ${TENANT_SETTING_COLUMNS.map(() => "?").join(", ")}, ?, ?)
       ON DUPLICATE KEY UPDATE ${TENANT_SETTING_COLUMNS.map((c) => `${c} = VALUES(${c})`).join(", ")},
         timezone = VALUES(timezone), updatedBy = VALUES(updatedBy)`,
      [tenantId, ...values, next.timezone ?? null, actor],
    );
    return this.getTenantSettings(tenantId);
  }

  async getPlatformSettings() {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT settings FROM NotificationPlatformSettings WHERE id = 'platform' LIMIT 1",
    );
    return normalizePlatformSettings(parseJson(r?.settings ?? null));
  }

  async savePlatformSettings(patch: Partial<PlatformSettings>, actor: string | null) {
    const current = await this.getPlatformSettings();
    const next = normalizePlatformSettings({
      ...current,
      ...patch,
      categoryEnabled: { ...current.categoryEnabled, ...(patch.categoryEnabled ?? {}) },
    });
    await execute(
      `INSERT INTO NotificationPlatformSettings (id, settings, updatedBy) VALUES ('platform', ?, ?)
       ON DUPLICATE KEY UPDATE settings = VALUES(settings), updatedBy = VALUES(updatedBy)`,
      [JSON.stringify(next), actor],
    );
    return next;
  }

  async getConsent(tenantId: string, phone: string) {
    const r = await queryOne<Record<string, unknown>>(
      "SELECT * FROM NotificationConsent WHERE tenantId = ? AND phone = ? AND channel = 'whatsapp' LIMIT 1",
      [tenantId, phone],
    );
    return r ? toConsentRow(r) : null;
  }

  async upsertConsent(input: Omit<ConsentRow, "id" | "channel">) {
    await execute(
      `INSERT INTO NotificationConsent
         (id, tenantId, phone, channel, status, source, noticeVersion, appointmentId, capturedAtMs, withdrawnAtMs)
       VALUES (?, ?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), source = VALUES(source),
         noticeVersion = VALUES(noticeVersion), appointmentId = VALUES(appointmentId),
         capturedAtMs = VALUES(capturedAtMs), withdrawnAtMs = VALUES(withdrawnAtMs)`,
      [
        crypto.randomUUID(),
        input.tenantId,
        input.phone,
        input.status,
        input.source,
        input.noticeVersion,
        input.appointmentId,
        input.capturedAtMs,
        input.withdrawnAtMs,
      ],
    );
  }

  async listConsents(tenantId: string, limit: number) {
    const rows = await query<Record<string, unknown>>(
      "SELECT * FROM NotificationConsent WHERE tenantId = ? ORDER BY capturedAtMs DESC LIMIT ?",
      [tenantId, Math.max(1, Math.min(limit, 200))],
    );
    return rows.map(toConsentRow);
  }

  async addAudit(input: AuditInput) {
    await execute(
      `INSERT INTO NotificationAudit (id, tenantId, eventId, action, actor, detail, atMs)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        input.tenantId ?? null,
        input.eventId ?? null,
        input.action,
        input.actor ?? null,
        input.detail ? JSON.stringify(input.detail) : null,
        input.atMs,
      ],
    );
  }

  async listAudit(filter: { eventId?: string; tenantId?: string; limit?: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.eventId) {
      where.push("eventId = ?");
      params.push(filter.eventId);
    }
    if (filter.tenantId) {
      where.push("tenantId = ?");
      params.push(filter.tenantId);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM NotificationAudit ${clause} ORDER BY atMs ASC LIMIT ?`,
      [...params, Math.max(1, Math.min(filter.limit ?? 100, 500))],
    );
    return rows.map((r) => ({
      id: String(r.id),
      tenantId: strOrNull(r.tenantId) as string,
      eventId: strOrNull(r.eventId) as string,
      action: String(r.action),
      actor: strOrNull(r.actor) as string,
      detail: parseJson<Record<string, unknown>>(r.detail),
      atMs: num(r.atMs),
    }));
  }

  async upsertAlert(input: AlertInput) {
    const prior = await queryOne<Record<string, unknown>>(
      "SELECT * FROM NotificationAlert WHERE alertKey = ? LIMIT 1",
      [input.alertKey],
    );
    const isNew = !prior || String(prior.status) === "resolved";
    await execute(
      `INSERT INTO NotificationAlert
         (alertKey, severity, status, title, detail, tenantId, firstSeenMs, lastSeenMs, occurrences)
       VALUES (?, ?, 'open', ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
         detail = VALUES(detail), lastSeenMs = VALUES(lastSeenMs),
         firstSeenMs = IF(status = 'resolved', VALUES(firstSeenMs), firstSeenMs),
         occurrences = IF(status = 'resolved', 1, occurrences + 1),
         notifiedAtMs = IF(status = 'resolved', NULL, notifiedAtMs),
         resolvedAtMs = NULL, status = 'open'`,
      [
        input.alertKey,
        input.severity,
        input.title.slice(0, 255),
        input.detail ? input.detail.slice(0, 1000) : null,
        input.tenantId ?? null,
        input.nowMs,
        input.nowMs,
      ],
    );
    const row = await queryOne<Record<string, unknown>>(
      "SELECT * FROM NotificationAlert WHERE alertKey = ? LIMIT 1",
      [input.alertKey],
    );
    return { isNew, row: toAlertRow(row ?? {}) };
  }

  async resolveAlert(alertKey: string, nowMs: number) {
    const res = await execute(
      "UPDATE NotificationAlert SET status = 'resolved', resolvedAtMs = ? WHERE alertKey = ? AND status = 'open'",
      [nowMs, alertKey],
    );
    return res.affectedRows > 0;
  }

  async markAlertNotified(alertKey: string, nowMs: number) {
    await execute("UPDATE NotificationAlert SET notifiedAtMs = ? WHERE alertKey = ?", [
      nowMs,
      alertKey,
    ]);
  }

  async listAlerts(status?: "open" | "resolved" | null, limit = 100) {
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM NotificationAlert ${status ? "WHERE status = ?" : ""}
        ORDER BY lastSeenMs DESC LIMIT ?`,
      status ? [status, Math.min(limit, 500)] : [Math.min(limit, 500)],
    );
    return rows.map(toAlertRow);
  }
}

/** Shared monotonic rule for provider delivery statuses. */
export function shouldApplyDelivery(current: EventStatus, incoming: EventStatus): boolean {
  const cur = DELIVERY_RANK[current];
  if (cur == null) return false; // not yet accepted by Meta, or already terminal elsewhere
  if (incoming === "failed") return cur <= (DELIVERY_RANK.sent as number);
  const inc = DELIVERY_RANK[incoming];
  return inc != null && inc > cur;
}

// ── Accessor + test seam ─────────────────────────────────────────────────────
let repoInstance: NotifyRepo | null = null;

export function getNotifyRepo(): NotifyRepo {
  if (!repoInstance) repoInstance = new SqlNotifyRepo();
  return repoInstance;
}

export function __setNotifyRepoForTests(repo: NotifyRepo | null): void {
  repoInstance = repo;
}
