// ─────────────────────────────────────────────────────────────────────────────
// notify-dispatcher.ts  (server-only)
//
// Durable, at-least-once dispatch of NotificationEvent jobs with strong
// application-side de-duplication:
//
//   claim  → atomic UPDATE … LIMIT with a lease + claim token (safe across
//            processes and restarts; a crashed worker's lease expires and the
//            job is requeued — or marked ambiguous if the send had started).
//   verify → the booking is re-read; the job is skipped / superseded / expired
//            when it is no longer true (cancelled, rescheduled again, past…).
//   gate   → tenant switches, platform category switch, recipient validity and
//            consent; then the approved-template gate for (kind, category).
//   send   → one Cloud API template request (type "template"), never free-form
//            text, never gated on the 24-hour customer-service window.
//   record → Meta's wamid (accepted ≠ delivered; webhooks finish the story) or
//            a classified error: retryable → exponential backoff with jitter up
//            to maxAttempts, then dead; permanent/config/template → failed;
//            ambiguous (may have been sent) → never auto-retried.
//
// Rate limiting is a per-process token bucket on the shared sender number plus
// bounded concurrency. Test mode (WA_CLOUD_TEST_RECIPIENTS set) only claims jobs
// for allow-listed recipients, so a developer machine pointed at a shared
// database can never consume or skip real customers' notifications.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import type { AptNotifyKind } from "./appointment-notify";
import { KIND_SWITCH } from "./notify-catalog";
import {
  bookingRecipient,
  bookingWallClock,
  buildNotifyContext,
  CLOSED_STATUSES,
  loadBookingSnapshot,
  loadTenantSnapshot,
  REMINDABLE_STATUSES,
  type BookingSnapshot,
  type TenantSnapshot,
} from "./notify-context";
import { consentPhone, evaluateConsent, type ConsentDecision } from "./notify-consent";
import {
  getNotifyRepo,
  type EventPatch,
  type EventStatus,
  type NotificationEventRow,
  type NotifyRepo,
  type PlatformSettings,
} from "./notify-repo";
import { isTomorrowLocal, wallClockToUtcMs } from "./notify-time";
import {
  backoffDelayMs,
  classifyMetaError,
  classifyTransportError,
  type ClassifiedError,
} from "./wa-error-classify";
import type { TemplatePlanResolution } from "./wa-template-notify";
import type { SubmitTemplateResult } from "./whatsapp-router";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LEASE_MS = 2 * MINUTE;
const POLL_MS = 5_000;
const STALE_SWEEP_MS = 30_000;
const PLATFORM_CACHE_MS = 30_000;

export interface DispatcherDeps {
  repo: NotifyRepo;
  now: () => number;
  workerId: string;
  /** Normalized test recipients, or null in production (no restriction). */
  allowList: string[] | null;
  loadTenant: (tenantId: string) => Promise<TenantSnapshot | null>;
  loadBooking: (tenantId: string, appointmentId: string) => Promise<BookingSnapshot | null>;
  isCloudAvailable: () => Promise<boolean>;
  resolvePlan: (
    kind: AptNotifyKind,
    ctx: ReturnType<typeof buildNotifyContext> & { recipientPhone?: string | null },
    options: { cloudAvailable?: boolean; businessCategory?: TenantSnapshot["category"] | null },
  ) => Promise<TemplatePlanResolution>;
  submit: (input: {
    tenantId: string;
    notifyKind: AptNotifyKind;
    recipient: string;
    plan: Extract<TemplatePlanResolution, { status: "ready" }>["plan"];
    eventId?: string | null;
    sensitiveValues?: unknown[];
  }) => Promise<SubmitTemplateResult>;
  evaluateConsent: (input: {
    tenantId: string;
    phone: string;
    mode: PlatformSettings["consentMode"];
  }) => Promise<ConsentDecision>;
  decryptSecret: (blob: string) => Promise<string | null>;
  markLegacyReminder: (
    tenantId: string,
    appointmentId: string,
    kind: AptNotifyKind,
  ) => Promise<void>;
  onTemplateIssue: (templateId: string | null) => void;
  raiseAlert: (input: {
    alertKey: string;
    severity: "info" | "warning" | "critical";
    title: string;
    detail?: string | null;
    tenantId?: string | null;
  }) => Promise<void>;
  random: () => number;
  acquireSendSlot: () => Promise<void>;
}

/** Parses WA_CLOUD_TEST_RECIPIENTS the same way whatsapp-cloud.ts does. */
export function testRecipientAllowList(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = env.WA_CLOUD_TEST_RECIPIENTS;
  if (!raw || !raw.trim()) return null;
  return raw
    .split(",")
    .map((s) => {
      const digits = s.replace(/\D/g, "");
      return digits.length === 10 ? "91" + digits : digits;
    })
    .filter(Boolean);
}

// ── Token bucket (per process, shared sender) ────────────────────────────────
class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private ratePerSec: number) {
    this.tokens = ratePerSec;
  }
  setRate(rate: number) {
    this.ratePerSec = Math.max(1, rate);
  }
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(
        this.ratePerSec,
        this.tokens + ((now - this.last) / 1000) * this.ratePerSec,
      );
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, Math.ceil(1000 / this.ratePerSec)));
    }
  }
}

const bucket = new TokenBucket(20);
let platformCache: { at: number; value: PlatformSettings } | null = null;

async function platformSettings(repo: NotifyRepo, nowMs: number): Promise<PlatformSettings> {
  if (platformCache && nowMs - platformCache.at < PLATFORM_CACHE_MS) return platformCache.value;
  const value = await repo.getPlatformSettings();
  platformCache = { at: nowMs, value };
  bucket.setRate(value.sendRatePerSecond);
  return value;
}

/** Drops the cached platform settings (admin writes call this). */
export function invalidatePlatformSettingsCache(): void {
  platformCache = null;
}

function defaultDeps(): DispatcherDeps {
  return {
    repo: getNotifyRepo(),
    now: () => Date.now(),
    workerId: `${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
    allowList: testRecipientAllowList(),
    loadTenant: loadTenantSnapshot,
    loadBooking: loadBookingSnapshot,
    isCloudAvailable: async () => {
      const { isCloudAvailable } = await import("./whatsapp-cloud");
      return isCloudAvailable();
    },
    resolvePlan: async (kind, ctx, options) => {
      const { resolveTemplatePlanResult } = await import("./wa-template-notify");
      return resolveTemplatePlanResult(kind, ctx, options);
    },
    submit: async (input) => {
      const { submitTemplatePlan } = await import("./whatsapp-router");
      return submitTemplatePlan(input);
    },
    evaluateConsent,
    decryptSecret: async (blob) => {
      try {
        const { decryptSecret } = await import("./wa-crypto");
        return decryptSecret(blob);
      } catch {
        return null;
      }
    },
    markLegacyReminder: async (tenantId, appointmentId, kind) => {
      const column =
        kind === "reminderDayBefore" ? "remDayBefore" : kind === "reminder2h" ? "rem2h" : null;
      if (!column) return;
      const { execute } = await import("./db");
      await execute(`UPDATE Appointment SET ${column} = 1 WHERE id = ? AND tenantId = ?`, [
        appointmentId,
        tenantId,
      ]);
    },
    onTemplateIssue: (templateId) => {
      void import("./wa-template-notify").then((m) => m.invalidateMappingCache()).catch(() => {});
      if (templateId) {
        void import("./wa-template-sync")
          .then((m) => m.backgroundSyncOne(templateId))
          .catch(() => {});
      }
    },
    raiseAlert: async (input) => {
      await getNotifyRepo().upsertAlert({ ...input, nowMs: Date.now() });
    },
    random: Math.random,
    acquireSendSlot: () => bucket.acquire(),
  };
}

let depsOverride: Partial<DispatcherDeps> | null = null;

/** Test seam. */
export function __setDispatcherDepsForTests(deps: Partial<DispatcherDeps> | null): void {
  depsOverride = deps;
  platformCache = null;
}

let resolvedDeps: DispatcherDeps | null = null;
function getDeps(): DispatcherDeps {
  if (depsOverride)
    return { ...(resolvedDeps ??= defaultDeps()), ...depsOverride } as DispatcherDeps;
  return (resolvedDeps ??= defaultDeps());
}

// ── Eligibility (pure) ───────────────────────────────────────────────────────
export type Eligibility =
  | { ok: true }
  | {
      ok: false;
      status: Extract<EventStatus, "skipped" | "superseded" | "expired">;
      reason: string;
    };

/**
 * Decides whether an event is still true for the booking as it is NOW. This is
 * what prevents stale reminders after a cancel/complete/reschedule, and
 * cancellation messages for bookings that were not actually cancelled.
 */
export function evaluateEligibility(
  ev: Pick<NotificationEventRow, "notifyKind" | "appointmentAtLocal" | "payload" | "expiresAtMs">,
  booking: BookingSnapshot,
  tenant: Pick<TenantSnapshot, "timezone">,
  nowMs: number,
): Eligibility {
  const kind = ev.notifyKind;
  const status = booking.status;
  const closed = CLOSED_STATUSES.has(status);
  const timeUnchanged = !ev.appointmentAtLocal || ev.appointmentAtLocal === booking.wallClock;
  if (ev.expiresAtMs != null && nowMs > ev.expiresAtMs) {
    return { ok: false, status: "expired", reason: "expired_before_dispatch" };
  }
  switch (kind) {
    case "cancelled":
      return status === "Cancelled"
        ? { ok: true }
        : { ok: false, status: "skipped", reason: "booking_not_cancelled" };
    case "completed":
      return status === "Completed"
        ? { ok: true }
        : { ok: false, status: "skipped", reason: "booking_not_completed" };
    case "rescheduleNeeded":
      return status === "Reschedule Needed"
        ? { ok: true }
        : { ok: false, status: "skipped", reason: "no_longer_applicable" };
    case "reminderDayBefore":
    case "reminder2h":
    case "reminderDayOf":
    case "reminder1h": {
      if (!REMINDABLE_STATUSES.has(status)) {
        return {
          ok: false,
          status: "skipped",
          reason: `booking_${status.toLowerCase().replace(/\s+/g, "_")}`,
        };
      }
      if (!timeUnchanged)
        return { ok: false, status: "superseded", reason: "booking_time_changed" };
      if (kind === "reminderDayBefore" && booking.remDayBefore) {
        return { ok: false, status: "skipped", reason: "already_sent_legacy" };
      }
      if (kind === "reminder2h" && booking.rem2h) {
        return { ok: false, status: "skipped", reason: "already_sent_legacy" };
      }
      const w = bookingWallClock(booking);
      if (!w) return { ok: false, status: "skipped", reason: "invalid_booking_time" };
      const apptMs = wallClockToUtcMs(w, tenant.timezone);
      if (kind === "reminderDayBefore" && !isTomorrowLocal(w, nowMs, tenant.timezone)) {
        return { ok: false, status: "expired", reason: "not_tomorrow_anymore" };
      }
      if (kind === "reminder2h" && (apptMs - nowMs > 3 * HOUR || apptMs - nowMs < 15 * MINUTE)) {
        return { ok: false, status: "expired", reason: "outside_same_day_window" };
      }
      return { ok: true };
    }
    case "rescheduled":
      if (closed) return { ok: false, status: "skipped", reason: "booking_closed" };
      return timeUnchanged
        ? { ok: true }
        : { ok: false, status: "superseded", reason: "booking_time_changed" };
    case "tokenUpdated": {
      if (closed) return { ok: false, status: "skipped", reason: "booking_closed" };
      if (!timeUnchanged)
        return { ok: false, status: "superseded", reason: "booking_time_changed" };
      const emitted = ev.payload?.tokenNo;
      if (emitted != null && Number(emitted) !== Number(booking.tokenNo)) {
        return { ok: false, status: "superseded", reason: "token_changed_again" };
      }
      return { ok: true };
    }
    case "restaurantTableChanged": {
      if (closed) return { ok: false, status: "skipped", reason: "booking_closed" };
      const emitted = ev.payload?.tableName;
      if (emitted != null && String(emitted) !== String(booking.tableName ?? "")) {
        return { ok: false, status: "superseded", reason: "table_changed_again" };
      }
      return { ok: true };
    }
    default:
      // booked, confirmed, reinstated, restaurantBooked, video links
      if (closed) return { ok: false, status: "skipped", reason: "booking_closed" };
      if (kind === "reinstated" && status === "Reschedule Needed") {
        return { ok: false, status: "skipped", reason: "no_longer_applicable" };
      }
      return { ok: true };
  }
}

// ── Processing ───────────────────────────────────────────────────────────────
export interface ProcessOutcome {
  status: EventStatus;
  reason?: string | null;
}

async function finish(
  d: DispatcherDeps,
  ev: NotificationEventRow,
  patch: EventPatch & { status: EventStatus },
  audit?: Record<string, unknown>,
): Promise<ProcessOutcome> {
  const token = ev.claimToken ?? "";
  const ok = await d.repo.finishClaimed(ev.id, token, patch);
  if (ok) {
    await d.repo
      .addAudit({
        tenantId: ev.tenantId,
        eventId: ev.id,
        action: `status_${patch.status}`,
        actor: "dispatcher",
        detail: { reason: patch.statusReason ?? null, attempt: ev.attempts, ...(audit ?? {}) },
        atMs: d.now(),
      })
      .catch(() => {});
  }
  return { status: patch.status, reason: patch.statusReason ?? null };
}

const NOT_READY_RETRY = new Set(["cloud_unavailable"]);

/** Processes one claimed event to a new state. Never throws. */
export async function processEvent(
  ev: NotificationEventRow,
  deps?: DispatcherDeps,
): Promise<ProcessOutcome> {
  const d = deps ?? getDeps();
  try {
    const nowMs = d.now();
    const platform = await platformSettings(d.repo, nowMs);
    if (!platform.engineEnabled) {
      // Paused by the Super Admin: hand the job back untouched.
      return finish(d, ev, {
        status: "pending",
        statusReason: "engine_paused",
        nextAttemptAtMs: nowMs + MINUTE,
        attempts: Math.max(0, ev.attempts - 1),
      });
    }

    // Events created by a developer process in test mode are never delivered by
    // a production worker (the developer's allow-list is unknown here).
    if (ev.payload?.testMode === true && !d.allowList) {
      return finish(d, ev, { status: "skipped", statusReason: "created_by_test_mode_server" });
    }

    const tenant = await d.loadTenant(ev.tenantId);
    if (!tenant) return finish(d, ev, { status: "skipped", statusReason: "tenant_not_found" });
    if (!platform.categoryEnabled[tenant.category]) {
      return finish(d, ev, { status: "skipped", statusReason: "category_disabled" });
    }
    const settings = await d.repo.getTenantSettings(ev.tenantId);
    if (!settings.whatsappEnabled) {
      return finish(d, ev, { status: "skipped", statusReason: "tenant_whatsapp_disabled" });
    }
    const sw = KIND_SWITCH[ev.notifyKind];
    if (sw && settings[sw] === false) {
      return finish(d, ev, { status: "skipped", statusReason: `tenant_disabled:${sw}` });
    }

    if (!ev.appointmentId) return finish(d, ev, { status: "skipped", statusReason: "no_booking" });
    const booking = await d.loadBooking(ev.tenantId, ev.appointmentId);
    if (!booking) return finish(d, ev, { status: "skipped", statusReason: "booking_not_found" });

    const eligibility = evaluateEligibility(ev, booking, tenant, nowMs);
    if (!eligibility.ok) {
      return finish(d, ev, { status: eligibility.status, statusReason: eligibility.reason });
    }

    const recipient = consentPhone(bookingRecipient(booking));
    if (!recipient) {
      return finish(d, ev, {
        status: "failed",
        statusReason: "invalid_recipient",
        errorClass: "permanent",
        errorMessage: "The booking has no valid WhatsApp number.",
      });
    }
    if (d.allowList && !d.allowList.includes(recipient)) {
      // The booking's number changed to one this test-mode worker must not
      // send to: hand it back for a production worker.
      return finish(d, ev, {
        status: "pending",
        statusReason: "released_by_test_worker",
        recipient,
        nextAttemptAtMs: nowMs,
        attempts: Math.max(0, ev.attempts - 1),
      });
    }

    const consent = await d.evaluateConsent({
      tenantId: ev.tenantId,
      phone: recipient,
      mode: platform.consentMode,
    });
    if (!consent.allowed) {
      return finish(d, ev, {
        status: "skipped",
        statusReason:
          consent.reason === "consent_missing" ? "consent_missing" : "consent_withdrawn",
        errorClass: "consent",
        recipient,
      });
    }

    let joinLink: string | null = null;
    const enc = ev.payload?.joinLinkEnc;
    if (typeof enc === "string" && enc) joinLink = await d.decryptSecret(enc);

    const ctx = buildNotifyContext(booking, tenant, { joinLink });
    const cloudAvailable = await d.isCloudAvailable();
    const resolution = await d.resolvePlan(
      ev.notifyKind,
      { ...ctx, recipientPhone: recipient },
      { cloudAvailable, businessCategory: tenant.category },
    );
    if (resolution.status === "not_ready") {
      const reason = `template_not_ready:${resolution.reason}`;
      if (NOT_READY_RETRY.has(resolution.reason) && ev.attempts < ev.maxAttempts) {
        await d.raiseAlert({
          alertKey: "provider:cloud_unavailable",
          severity: "critical",
          title: "WhatsApp Cloud API is not configured or disabled",
          detail:
            "Notifications are being held and retried. Check Super Admin → WhatsApp → Credentials.",
        });
        return finish(d, ev, {
          status: "retry",
          statusReason: reason,
          errorClass: "configuration",
          nextAttemptAtMs:
            nowMs + Math.max(5 * MINUTE, backoffDelayMs(ev.attempts, { random: d.random })),
          recipient,
        });
      }
      if (resolution.reason !== "variables_unresolved") {
        await d.raiseAlert({
          alertKey: `template_missing:${tenant.category}:${ev.notifyKind}`,
          severity: "warning",
          title: `No sendable template for ${tenant.category} / ${ev.notifyKind}`,
          detail: `Notifications are blocked (${resolution.reason}). Sync templates or approve/map one in Super Admin → WhatsApp → Templates.`,
        });
      }
      return finish(d, ev, {
        status: NOT_READY_RETRY.has(resolution.reason) ? "dead" : "blocked",
        statusReason: reason,
        errorClass: resolution.reason === "variables_unresolved" ? "permanent" : "template",
        recipient,
      });
    }

    const plan = resolution.plan;
    await d.acquireSendSlot();
    const started = await d.repo.markSendStarted(ev.id, ev.claimToken ?? "", d.now());
    if (!started) return { status: "processing", reason: "lease_lost" };

    const result = await d.submit({
      tenantId: ev.tenantId,
      notifyKind: ev.notifyKind,
      recipient,
      plan,
      eventId: ev.id,
      sensitiveValues: [
        booking.name,
        booking.phone,
        booking.whatsapp,
        tenant.businessName,
        booking.doctorName,
        joinLink,
      ],
    });

    const templateFields = {
      templateId: plan.templateId,
      templateName: plan.templateName,
      templateLanguage: plan.language,
      recipient,
    };
    if (result.ok) {
      await d.markLegacyReminder(ev.tenantId, ev.appointmentId, ev.notifyKind).catch(() => {});
      return finish(
        d,
        ev,
        {
          status: "submitted",
          statusReason: "accepted_by_meta",
          providerMessageId: result.messageId,
          waMessageLogId: result.logId,
          submittedAtMs: d.now(),
          errorClass: null,
          errorCode: null,
          errorMessage: null,
          ...templateFields,
        },
        { template: plan.templateName, language: plan.language, consentBasis: consent.basis },
      );
    }

    const classified: ClassifiedError =
      result.kind === "meta_error"
        ? classifyMetaError({
            httpStatus: result.httpStatus,
            code: result.code,
            subcode: result.subcode,
            isTransient: result.isTransient,
          })
        : classifyTransportError({
            message: result.transportMessage,
            httpStatus: result.httpStatus,
          });

    if (classified.refreshTemplate) d.onTemplateIssue(plan.templateId);
    if (classified.systemic) {
      await d.raiseAlert({
        alertKey: `provider:${result.code}`,
        severity: classified.errorClass === "retryable" ? "warning" : "critical",
        title: `WhatsApp send error ${result.code} (${classified.errorClass})`,
        detail: classified.hint,
      });
    }
    const errorFields = {
      errorClass: classified.errorClass,
      errorCode: result.code,
      errorMessage: `${classified.hint} ${result.safeMessage}`.slice(0, 500),
      waMessageLogId: result.logId || null,
      ...templateFields,
    };
    if (classified.retry) {
      if (ev.attempts >= ev.maxAttempts) {
        return finish(d, ev, {
          status: "dead",
          statusReason: "retries_exhausted",
          failedAtMs: d.now(),
          ...errorFields,
        });
      }
      const delay = Math.max(
        classified.minRetryDelayMs ?? 0,
        backoffDelayMs(ev.attempts, { random: d.random }),
      );
      return finish(d, ev, {
        status: "retry",
        statusReason: "retry_scheduled",
        nextAttemptAtMs: d.now() + delay,
        ...errorFields,
      });
    }
    if (classified.ambiguous) {
      return finish(d, ev, {
        status: "ambiguous",
        statusReason: "send_outcome_unknown",
        ...errorFields,
      });
    }
    return finish(d, ev, {
      status: "failed",
      statusReason: "send_rejected",
      failedAtMs: d.now(),
      ...errorFields,
    });
  } catch (e: any) {
    console.error(`[NotifyDispatcher] event ${ev.id} processing error: ${e?.message ?? "error"}`);
    // Unknown internal error before any send started: retry with backoff.
    const nowMs = d.now();
    const exhausted = ev.attempts >= ev.maxAttempts;
    return finish(d, ev, {
      status: exhausted ? "dead" : "retry",
      statusReason: "internal_error",
      errorClass: "unknown",
      errorMessage: "Internal error while preparing the notification.",
      nextAttemptAtMs: nowMs + backoffDelayMs(ev.attempts, { random: d.random }),
    }).catch(() => ({ status: "retry" as EventStatus }));
  }
}

/**
 * Claims and processes one specific event right away (e.g. the confirmation of
 * a booking that was just committed, or a staff-initiated notice whose result
 * the UI shows). Returns null when the event is not claimable by this process
 * (already taken, not yet due, or outside the test allow-list). Never throws.
 */
export async function dispatchEventNow(
  eventId: string,
  deps?: DispatcherDeps,
): Promise<ProcessOutcome | null> {
  try {
    const d = deps ?? getDeps();
    const ev = await d.repo.claimById({
      id: eventId,
      workerId: d.workerId,
      nowMs: d.now(),
      leaseMs: LEASE_MS,
      recipientAllowList: d.allowList,
    });
    if (!ev) return null;
    return await processEvent(ev, d);
  } catch (e: any) {
    console.error(`[NotifyDispatcher] immediate dispatch failed: ${e?.message ?? "error"}`);
    return null;
  }
}

/** True when this process runs with WA_CLOUD_TEST_RECIPIENTS (developer machine). */
export function isTestModeProcess(): boolean {
  return testRecipientAllowList() !== null;
}

/** Claims and processes one batch. Returns how many events were processed. */
export async function dispatchDue(deps?: DispatcherDeps): Promise<number> {
  const d = deps ?? getDeps();
  const nowMs = d.now();
  const platform = await platformSettings(d.repo, nowMs);
  if (!platform.engineEnabled) return 0;
  const claimed = await d.repo.claimDue({
    workerId: d.workerId,
    nowMs,
    limit: Math.max(platform.concurrency * 4, 10),
    leaseMs: LEASE_MS,
    recipientAllowList: d.allowList,
  });
  if (claimed.length === 0) return 0;
  let index = 0;
  const workers = Array.from(
    { length: Math.min(platform.concurrency, claimed.length) },
    async () => {
      while (index < claimed.length) {
        const ev = claimed[index++];
        await processEvent(ev, d);
      }
    },
  );
  await Promise.all(workers);
  return claimed.length;
}

// ── Worker loop ──────────────────────────────────────────────────────────────
const g = globalThis as unknown as {
  __notifyWorker?: {
    timer: ReturnType<typeof setInterval> | null;
    running: boolean;
    again: boolean;
    lastSweep: number;
  };
};

async function runLoop(): Promise<void> {
  const state = g.__notifyWorker;
  if (!state || state.running) {
    if (state) state.again = true;
    return;
  }
  state.running = true;
  try {
    const { ensureNotifySchema } = await import("./notify-ddl");
    if (!(await ensureNotifySchema())) return;
    const d = getDeps();
    if (Date.now() - state.lastSweep > STALE_SWEEP_MS) {
      state.lastSweep = Date.now();
      const r = await d.repo.recoverStale(d.now());
      if (r.ambiguous > 0) {
        console.warn(
          `[NotifyDispatcher] ${r.ambiguous} job(s) were mid-send when a worker stopped; marked ambiguous.`,
        );
      }
    }
    // Drain: keep claiming while full batches come back.
    for (let i = 0; i < 20; i++) {
      const n = await dispatchDue(d);
      if (n === 0) break;
    }
  } catch (e: any) {
    console.error(`[NotifyDispatcher] loop error: ${e?.message ?? "error"}`);
  } finally {
    state.running = false;
    if (state.again) {
      state.again = false;
      setTimeout(() => void runLoop(), 50);
    }
  }
}

/** Starts the background worker once per process. */
export function startNotificationWorker(): void {
  if (typeof window !== "undefined") return;
  if (g.__notifyWorker) return;
  g.__notifyWorker = { timer: null, running: false, again: false, lastSweep: 0 };
  g.__notifyWorker.timer = setInterval(() => void runLoop(), POLL_MS);
  setTimeout(() => void runLoop(), 3_000);
  const mode = testRecipientAllowList() ? "test mode (allow-listed recipients only)" : "production";
  console.log(`[NotifyDispatcher] Started — durable WhatsApp notification worker, ${mode}.`);
}

/** Wakes the worker immediately (e.g. right after a booking). Non-blocking. */
export function kickDispatcher(): void {
  if (!g.__notifyWorker) return;
  setTimeout(() => void runLoop(), 0);
}

/** Test helper. */
export function __stopNotificationWorkerForTests(): void {
  if (g.__notifyWorker?.timer) clearInterval(g.__notifyWorker.timer);
  delete g.__notifyWorker;
}
