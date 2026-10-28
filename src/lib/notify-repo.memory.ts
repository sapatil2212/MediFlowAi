// ─────────────────────────────────────────────────────────────────────────────
// notify-repo.memory.ts  (TEST-ONLY)
//
// In-memory NotifyRepo with the same semantics as the SQL implementation:
// unique event keys, atomic claim with a lease + claim token, stale-lease
// recovery (requeue vs ambiguous), monotonic delivery updates and tenant-scoped
// requeue. Used by the dispatcher/engine/webhook test suites.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import {
  defaultTenantSettings,
  normalizePlatformSettings,
  shouldApplyDelivery,
  type AlertInput,
  type AlertRow,
  type AuditInput,
  type AuditRow,
  type ConsentRow,
  type EventFilter,
  type EventPatch,
  type NewEventInput,
  type NotificationEventRow,
  type NotifyMetrics,
  type NotifyRepo,
  type PlatformSettings,
  type TenantNotificationSettings,
  type TenantSettingsPatch,
} from "./notify-repo";
import type { AptNotifyKind } from "./appointment-notify";
import type { ErrorClass } from "./wa-error-classify";

export class InMemoryNotifyRepo implements NotifyRepo {
  events = new Map<string, NotificationEventRow>();
  private byKey = new Map<string, string>();
  tenantSettings = new Map<string, TenantNotificationSettings>();
  platform: PlatformSettings = normalizePlatformSettings({});
  consents = new Map<string, ConsentRow>();
  audit: AuditRow[] = [];
  alerts = new Map<string, AlertRow>();

  async insertEvent(input: NewEventInput) {
    const existing = this.byKey.get(input.eventKey);
    if (existing) return { inserted: false, id: existing };
    const id = crypto.randomUUID();
    const row: NotificationEventRow = {
      id,
      eventKey: input.eventKey,
      tenantId: input.tenantId,
      businessCategory: input.businessCategory,
      eventType: input.eventType,
      notifyKind: input.notifyKind,
      appointmentId: input.appointmentId ?? null,
      channel: "whatsapp",
      recipient: input.recipient ?? null,
      source: input.source ?? null,
      status: input.status ?? "pending",
      statusReason: input.statusReason ?? null,
      errorClass: null,
      errorCode: null,
      errorMessage: null,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      scheduledForMs: input.scheduledForMs,
      nextAttemptAtMs: input.scheduledForMs,
      expiresAtMs: input.expiresAtMs ?? null,
      lockedBy: null,
      claimToken: null,
      lockedUntilMs: null,
      sendStartedAtMs: null,
      appointmentAtLocal: input.appointmentAtLocal ?? null,
      templateId: null,
      templateName: null,
      templateLanguage: null,
      waMessageLogId: null,
      providerMessageId: null,
      submittedAtMs: null,
      deliveredAtMs: null,
      readAtMs: null,
      failedAtMs: null,
      payload: input.payload ?? null,
      createdAtMs: input.createdAtMs,
    };
    this.events.set(id, row);
    this.byKey.set(input.eventKey, id);
    return { inserted: true, id };
  }

  async getEvent(id: string) {
    const r = this.events.get(id);
    return r ? { ...r } : null;
  }

  async getEventByKey(eventKey: string) {
    const id = this.byKey.get(eventKey);
    return id ? this.getEvent(id) : null;
  }

  async claimDue(opts: {
    workerId: string;
    nowMs: number;
    limit: number;
    leaseMs: number;
    recipientAllowList?: string[] | null;
  }) {
    if (opts.recipientAllowList && opts.recipientAllowList.length === 0) return [];
    const token = crypto.randomUUID();
    const due = [...this.events.values()]
      .filter(
        (e) =>
          (e.status === "pending" || e.status === "retry") &&
          e.nextAttemptAtMs <= opts.nowMs &&
          (!opts.recipientAllowList || opts.recipientAllowList.includes(e.recipient ?? "")),
      )
      .sort((a, b) => a.nextAttemptAtMs - b.nextAttemptAtMs)
      .slice(0, Math.max(1, Math.min(opts.limit, 50)));
    for (const e of due) {
      e.status = "processing";
      e.lockedBy = opts.workerId;
      e.claimToken = token;
      e.lockedUntilMs = opts.nowMs + opts.leaseMs;
      e.sendStartedAtMs = null;
      e.attempts += 1;
    }
    return due.map((e) => ({ ...e }));
  }

  async claimById(opts: {
    id: string;
    workerId: string;
    nowMs: number;
    leaseMs: number;
    recipientAllowList?: string[] | null;
  }) {
    const e = this.events.get(opts.id);
    if (!e) return null;
    if (!(e.status === "pending" || e.status === "retry") || e.nextAttemptAtMs > opts.nowMs)
      return null;
    if (opts.recipientAllowList && !opts.recipientAllowList.includes(e.recipient ?? ""))
      return null;
    e.status = "processing";
    e.lockedBy = opts.workerId;
    e.claimToken = crypto.randomUUID();
    e.lockedUntilMs = opts.nowMs + opts.leaseMs;
    e.sendStartedAtMs = null;
    e.attempts += 1;
    return { ...e };
  }

  async recoverStale(nowMs: number) {
    let requeued = 0;
    let ambiguous = 0;
    for (const e of this.events.values()) {
      if (e.status !== "processing" || e.lockedUntilMs == null || e.lockedUntilMs >= nowMs)
        continue;
      if (e.sendStartedAtMs == null) {
        e.status = "retry";
        e.statusReason = "lease_expired_requeued";
        e.nextAttemptAtMs = nowMs;
        requeued++;
      } else {
        e.status = "ambiguous";
        e.statusReason = "worker_stopped_mid_send";
        e.errorClass = "unknown";
        ambiguous++;
      }
      e.lockedBy = null;
      e.claimToken = null;
      e.lockedUntilMs = null;
    }
    return { requeued, ambiguous };
  }

  async markSendStarted(id: string, claimToken: string, nowMs: number) {
    const e = this.events.get(id);
    if (!e || e.claimToken !== claimToken) return false;
    e.sendStartedAtMs = nowMs;
    return true;
  }

  async finishClaimed(id: string, claimToken: string, patch: EventPatch) {
    const e = this.events.get(id);
    if (!e || e.claimToken !== claimToken) return false;
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (e as any)[k] = v;
    }
    e.lockedBy = null;
    e.claimToken = null;
    e.lockedUntilMs = null;
    return true;
  }

  async cancelPending(input: {
    tenantId: string;
    appointmentId: string;
    kinds: readonly AptNotifyKind[];
    status: "cancelled" | "superseded";
    reason: string;
    exceptEventKey?: string | null;
  }) {
    let n = 0;
    for (const e of this.events.values()) {
      if (
        e.tenantId === input.tenantId &&
        e.appointmentId === input.appointmentId &&
        (e.status === "pending" || e.status === "retry") &&
        input.kinds.includes(e.notifyKind) &&
        e.eventKey !== input.exceptEventKey
      ) {
        e.status = input.status;
        e.statusReason = input.reason;
        n++;
      }
    }
    return n;
  }

  async listEventsForAppointment(tenantId: string, appointmentId: string) {
    return [...this.events.values()]
      .filter((e) => e.tenantId === tenantId && e.appointmentId === appointmentId)
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .map((e) => ({ ...e }));
  }

  async findByProviderMessageId(providerMessageId: string) {
    const e = [...this.events.values()].find((x) => x.providerMessageId === providerMessageId);
    return e ? { ...e } : null;
  }

  async applyDeliveryStatus(input: {
    id: string;
    status: "sent" | "delivered" | "read" | "failed";
    atMs: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    errorClass?: ErrorClass | null;
  }) {
    const e = this.events.get(input.id);
    if (!e || !shouldApplyDelivery(e.status, input.status)) return false;
    e.status = input.status;
    if (input.status === "delivered") e.deliveredAtMs = e.deliveredAtMs ?? input.atMs;
    if (input.status === "read") {
      e.readAtMs = e.readAtMs ?? input.atMs;
      e.deliveredAtMs = e.deliveredAtMs ?? input.atMs;
    }
    if (input.status === "failed") {
      e.failedAtMs = e.failedAtMs ?? input.atMs;
      e.errorCode = input.errorCode ?? null;
      e.errorMessage = input.errorMessage ?? null;
      e.errorClass = input.errorClass ?? "unknown";
      e.statusReason = "provider_failed";
    }
    return true;
  }

  async requeue(id: string, nowMs: number, tenantId?: string | null) {
    const e = this.events.get(id);
    if (!e) return false;
    if (tenantId && e.tenantId !== tenantId) return false;
    if (!["failed", "dead", "blocked", "ambiguous", "expired"].includes(e.status)) return false;
    if (e.providerMessageId) return false;
    Object.assign(e, {
      status: "retry",
      statusReason: "manual_retry",
      nextAttemptAtMs: nowMs,
      errorClass: null,
      errorCode: null,
      errorMessage: null,
      attempts: 0,
      lockedBy: null,
      claimToken: null,
      lockedUntilMs: null,
      sendStartedAtMs: null,
    });
    return true;
  }

  async releaseHold(id: string, nowMs: number) {
    const e = this.events.get(id);
    if (!e || e.status !== "pending" || e.nextAttemptAtMs <= nowMs) return false;
    e.nextAttemptAtMs = nowMs;
    e.scheduledForMs = Math.min(e.scheduledForMs, nowMs);
    return true;
  }

  async reviveEvent(id: string, nextAttemptAtMs: number, reason: string) {
    const e = this.events.get(id);
    if (!e || !["cancelled", "superseded"].includes(e.status) || e.providerMessageId) return false;
    Object.assign(e, {
      status: "pending",
      statusReason: reason,
      nextAttemptAtMs,
      scheduledForMs: nextAttemptAtMs,
      attempts: 0,
      errorClass: null,
      errorCode: null,
      errorMessage: null,
    });
    return true;
  }

  async listEvents(filter: EventFilter) {
    let rows = [...this.events.values()];
    const eq = <K extends keyof NotificationEventRow>(k: K, v: unknown) => {
      if (v == null || v === "") return;
      rows = rows.filter((r) => r[k] === v);
    };
    eq("tenantId", filter.tenantId);
    eq("businessCategory", filter.businessCategory);
    eq("appointmentId", filter.appointmentId);
    eq("eventType", filter.eventType);
    eq("notifyKind", filter.notifyKind);
    eq("templateName", filter.templateName);
    eq("errorClass", filter.errorClass);
    if (filter.statuses?.length) rows = rows.filter((r) => filter.statuses!.includes(r.status));
    if (filter.fromMs != null) rows = rows.filter((r) => r.createdAtMs >= filter.fromMs!);
    if (filter.toMs != null) rows = rows.filter((r) => r.createdAtMs < filter.toMs!);
    if (filter.search?.trim()) {
      const s = filter.search.trim();
      rows = rows.filter((r) => r.id === s || r.appointmentId === s || r.eventKey.startsWith(s));
    }
    rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
    const limit = Math.max(1, Math.min(Number(filter.limit) || 50, 200));
    const offset = Math.max(0, Number(filter.offset) || 0);
    return { rows: rows.slice(offset, offset + limit).map((r) => ({ ...r })), total: rows.length };
  }

  async statusCounts(tenantId: string, sinceMs: number) {
    const out: Record<string, number> = {};
    for (const e of this.events.values()) {
      if (e.tenantId !== tenantId || e.createdAtMs < sinceMs) continue;
      out[e.status] = (out[e.status] ?? 0) + 1;
    }
    return out;
  }

  async metrics(sinceMs: number, nowMs: number): Promise<NotifyMetrics> {
    const rows = [...this.events.values()].filter((e) => e.createdAtMs >= sinceMs);
    const byStatus: Record<string, number> = {};
    const byCategory: NotifyMetrics["byCategory"] = {};
    let dispatchSum = 0;
    let dispatchN = 0;
    let deliverySum = 0;
    let deliveryN = 0;
    let retries = 0;
    for (const e of rows) {
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
      const c = (byCategory[e.businessCategory] ??= { total: 0, delivered: 0, failed: 0 });
      c.total++;
      if (e.status === "delivered" || e.status === "read") c.delivered++;
      if (e.status === "failed" || e.status === "dead" || e.status === "ambiguous") c.failed++;
      if (e.submittedAtMs != null && e.submittedAtMs >= e.scheduledForMs) {
        dispatchSum += e.submittedAtMs - e.scheduledForMs;
        dispatchN++;
      }
      if (
        e.deliveredAtMs != null &&
        e.submittedAtMs != null &&
        e.deliveredAtMs >= e.submittedAtMs
      ) {
        deliverySum += e.deliveredAtMs - e.submittedAtMs;
        deliveryN++;
      }
      retries += Math.max(0, e.attempts - 1);
    }
    const due = [...this.events.values()].filter(
      (e) => (e.status === "pending" || e.status === "retry") && e.nextAttemptAtMs <= nowMs,
    );
    return {
      sinceMs,
      byStatus,
      byCategory,
      dueBacklog: due.length,
      oldestDueMs: due.length ? Math.min(...due.map((e) => e.nextAttemptAtMs)) : null,
      retries,
      avgDispatchLatencyMs: dispatchN ? Math.round(dispatchSum / dispatchN) : null,
      avgDeliveryLatencyMs: deliveryN ? Math.round(deliverySum / deliveryN) : null,
    };
  }

  async purgeOlderThan(cutoffMs: number) {
    let events = 0;
    for (const [id, e] of this.events) {
      if (e.createdAtMs < cutoffMs && !["pending", "retry", "processing"].includes(e.status)) {
        this.events.delete(id);
        this.byKey.delete(e.eventKey);
        events++;
      }
    }
    const before = this.audit.length;
    this.audit = this.audit.filter((a) => a.atMs >= cutoffMs);
    return { events, audit: before - this.audit.length };
  }

  async getTenantSettings(tenantId: string) {
    return { ...(this.tenantSettings.get(tenantId) ?? defaultTenantSettings(tenantId)) };
  }

  async saveTenantSettings(tenantId: string, patch: TenantSettingsPatch, actor: string | null) {
    const next = {
      ...(await this.getTenantSettings(tenantId)),
      ...patch,
      tenantId,
      updatedBy: actor,
      persisted: true,
    };
    this.tenantSettings.set(tenantId, next);
    return { ...next };
  }

  async getPlatformSettings() {
    return normalizePlatformSettings(this.platform);
  }

  async savePlatformSettings(patch: Partial<PlatformSettings>) {
    this.platform = normalizePlatformSettings({
      ...this.platform,
      ...patch,
      categoryEnabled: { ...this.platform.categoryEnabled, ...(patch.categoryEnabled ?? {}) },
    });
    return this.getPlatformSettings();
  }

  private consentKey(tenantId: string, phone: string) {
    return `${tenantId}|${phone}`;
  }

  async getConsent(tenantId: string, phone: string) {
    const r = this.consents.get(this.consentKey(tenantId, phone));
    return r ? { ...r } : null;
  }

  async upsertConsent(input: Omit<ConsentRow, "id" | "channel">) {
    const key = this.consentKey(input.tenantId, input.phone);
    const prior = this.consents.get(key);
    this.consents.set(key, {
      id: prior?.id ?? crypto.randomUUID(),
      channel: "whatsapp",
      ...input,
    });
  }

  async listConsents(tenantId: string, limit: number) {
    return [...this.consents.values()]
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => b.capturedAtMs - a.capturedAtMs)
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }

  async addAudit(input: AuditInput) {
    this.audit.push({
      id: crypto.randomUUID(),
      tenantId: input.tenantId ?? (null as any),
      eventId: input.eventId ?? (null as any),
      action: input.action,
      actor: input.actor ?? (null as any),
      detail: input.detail ?? null,
      atMs: input.atMs,
    });
  }

  async listAudit(filter: { eventId?: string; tenantId?: string; limit?: number }) {
    return this.audit
      .filter(
        (a) =>
          (!filter.eventId || a.eventId === filter.eventId) &&
          (!filter.tenantId || a.tenantId === filter.tenantId),
      )
      .slice(0, filter.limit ?? 100)
      .map((a) => ({ ...a }));
  }

  async upsertAlert(input: AlertInput) {
    const prior = this.alerts.get(input.alertKey);
    const isNew = !prior || prior.status === "resolved";
    const row: AlertRow = {
      alertKey: input.alertKey,
      severity: input.severity,
      status: "open",
      title: input.title,
      detail: input.detail ?? null,
      tenantId: input.tenantId ?? null,
      firstSeenMs: isNew ? input.nowMs : prior!.firstSeenMs,
      lastSeenMs: input.nowMs,
      occurrences: isNew ? 1 : prior!.occurrences + 1,
      resolvedAtMs: null,
      notifiedAtMs: isNew ? null : prior!.notifiedAtMs,
    };
    this.alerts.set(input.alertKey, row);
    return { isNew, row: { ...row } };
  }

  async resolveAlert(alertKey: string, nowMs: number) {
    const a = this.alerts.get(alertKey);
    if (!a || a.status !== "open") return false;
    a.status = "resolved";
    a.resolvedAtMs = nowMs;
    return true;
  }

  async markAlertNotified(alertKey: string, nowMs: number) {
    const a = this.alerts.get(alertKey);
    if (a) a.notifiedAtMs = nowMs;
  }

  async listAlerts(status?: "open" | "resolved" | null) {
    return [...this.alerts.values()]
      .filter((a) => !status || a.status === status)
      .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
      .map((a) => ({ ...a }));
  }
}

export function createInMemoryNotifyRepo(): InMemoryNotifyRepo {
  return new InMemoryNotifyRepo();
}
