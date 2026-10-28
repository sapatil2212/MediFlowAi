// ─────────────────────────────────────────────────────────────────────────────
// notify-engine.ts  (server-only)
//
// Event-driven notification engine — the single entry point business flows use
// after a booking write has been persisted.
//
//   emitBookingEvent()  records one durable NotificationEvent per real business
//                       event (unique eventKey → duplicate requests are no-ops),
//                       keeps reminder jobs in step with the booking (schedule,
//                       supersede on reschedule, cancel on cancel/complete),
//                       records the customer's consent choice and wakes the
//                       dispatcher. It never throws: a notification problem can
//                       never fail or roll back the booking that triggered it.
//
//   scheduleReminders() computes day-before / same-day reminder due instants in
//                       the tenant timezone and inserts one job per (kind,
//                       booking, wall-clock time).
//
// Delivery is done by notify-dispatcher.ts. Events are created even when the
// matching template is not yet approved, so the dashboard shows exactly what
// would have been sent and why it was blocked.
// ─────────────────────────────────────────────────────────────────────────────
import type { PoolConnection } from "mariadb";
import type { AptNotifyKind } from "./appointment-notify";
import {
  isKindApplicable,
  type BusinessCategory,
  type NotificationEventType,
} from "./notify-catalog";
import {
  bookingRecipient,
  bookingWallClock,
  CLOSED_STATUSES,
  loadBookingSnapshot,
  loadTenantSnapshot,
  REMINDABLE_STATUSES,
  type BookingSnapshot,
  type TenantSnapshot,
} from "./notify-context";
import { getNotifyRepo, type NotifyRepo } from "./notify-repo";
import {
  computeDayBeforeDueMs,
  computeHoursBeforeDueMs,
  hasTimeOfDay,
  isTomorrowLocal,
  wallClockToUtcMs,
} from "./notify-time";
import { consentPhone, recordConsent, type ConsentSource } from "./notify-consent";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const REMINDER_KINDS: readonly AptNotifyKind[] = ["reminderDayBefore", "reminder2h"];

/** Kinds whose pending jobs become stale when the booking time changes. */
const TIME_BOUND_KINDS: readonly AptNotifyKind[] = [
  "reminderDayBefore",
  "reminder2h",
  "rescheduled",
  "tokenUpdated",
];

export interface EngineDeps {
  repo: NotifyRepo;
  now: () => number;
  loadTenant: (tenantId: string) => Promise<TenantSnapshot | null>;
  loadBooking: (
    tenantId: string,
    appointmentId: string,
    conn?: PoolConnection | null,
  ) => Promise<BookingSnapshot | null>;
  kick: () => void;
  ensureSchema: () => Promise<boolean>;
}

let depsOverride: Partial<EngineDeps> | null = null;

/** Test seam. */
export function __setEngineDepsForTests(deps: Partial<EngineDeps> | null): void {
  depsOverride = deps;
}

async function deps(): Promise<EngineDeps> {
  const base: EngineDeps = {
    repo: getNotifyRepo(),
    now: () => Date.now(),
    loadTenant: loadTenantSnapshot,
    loadBooking: loadBookingSnapshot,
    kick: () => {
      void import("./notify-dispatcher").then((m) => m.kickDispatcher()).catch(() => {});
    },
    ensureSchema: async () => {
      const { ensureNotifySchema } = await import("./notify-ddl");
      return ensureNotifySchema();
    },
  };
  return { ...base, ...(depsOverride ?? {}) } as EngineDeps;
}

/** Maps a domain event to the notify kind used for template routing. */
export function kindForEvent(
  type: NotificationEventType,
  category: BusinessCategory,
  payload?: Record<string, unknown> | null,
): AptNotifyKind | null {
  switch (type) {
    case "booking.created":
      return category === "restaurant" ? "restaurantBooked" : "booked";
    case "booking.confirmed":
      return "confirmed";
    case "booking.rescheduled":
      return "rescheduled";
    case "booking.cancelled":
      return "cancelled";
    case "booking.completed":
      return "completed";
    case "booking.reschedule_needed":
      return "rescheduleNeeded";
    case "booking.reinstated":
      return "reinstated";
    case "booking.table_changed":
      return "restaurantTableChanged";
    case "queue.updated":
      return "tokenUpdated";
    case "video.link_issued":
      return payload?.reissued === true ? "videoLinkReissued" : "videoLinkIssued";
    case "booking.reminder_due":
      return payload?.reminder === "reminder2h" ? "reminder2h" : "reminderDayBefore";
    default:
      return null;
  }
}

export interface EmitInput {
  tenantId: string;
  appointmentId: string;
  type: Exclude<NotificationEventType, "booking.reminder_due">;
  /** Where the event came from (public_booking, dashboard, scheduler, ...). */
  source: string;
  /** Customer's consent choice captured with this action, if any. */
  consent?: { optedIn: boolean; source: ConsentSource } | null;
  /** Extra non-sensitive payload (secrets must be pre-encrypted). */
  payload?: Record<string, unknown> | null;
  /** Discriminator for events that may legitimately repeat (e.g. token value). */
  dedupeKey?: string | null;
  /** Skip reminder maintenance (callers that manage reminders themselves). */
  skipReminders?: boolean;
  /**
   * Transactional outbox: the booking's open transaction. The event row is
   * written on this connection so it commits (or rolls back) atomically with
   * the booking. The caller must call kickNotifications() after COMMIT.
   */
  conn?: PoolConnection | null;
  /**
   * Hold the event this long before it becomes due — lets post-commit work
   * (daily queue renumbering) settle so the message carries the final value.
   */
  delayMs?: number;
}

export type EmitResult =
  | {
      ok: true;
      eventId: string | null;
      inserted: boolean;
      kind: AptNotifyKind | null;
      note?: string;
    }
  | { ok: false; error: string };

/** Event key: the unique business identity of one notification. */
async function eventKeyFor(
  d: EngineDeps,
  input: EmitInput,
  booking: BookingSnapshot,
): Promise<string> {
  const base = `${input.type}:${input.appointmentId}`;
  switch (input.type) {
    case "booking.created":
    case "booking.confirmed":
    case "booking.completed":
      return base;
    case "booking.rescheduled":
    case "booking.reschedule_needed":
      return `${base}:${booking.wallClock}`;
    case "booking.table_changed":
      return `${base}:${booking.tableName ?? "?"}`;
    case "queue.updated":
      return `${base}:${booking.wallClock.slice(0, 10)}:${booking.tokenNo ?? "?"}`;
    case "video.link_issued":
      return `${base}:${input.dedupeKey ?? d.now()}`;
    case "booking.cancelled":
    case "booking.reinstated": {
      // A booking may be cancelled, reinstated and cancelled again: each real
      // transition is its own event, while duplicate requests collide.
      const prior = (
        await d.repo.listEventsForAppointment(input.tenantId, input.appointmentId)
      ).filter((e) => e.eventType === input.type && e.status !== "superseded").length;
      return `${base}:${input.dedupeKey ?? prior}`;
    }
    default:
      return `${base}:${input.dedupeKey ?? d.now()}`;
  }
}

/**
 * Records a business event for notification. Call AFTER the booking write is
 * committed. Never throws.
 */
export async function emitBookingEvent(input: EmitInput): Promise<EmitResult> {
  try {
    const d = await deps();
    if (!(await d.ensureSchema())) return { ok: false, error: "notification schema unavailable" };
    const nowMs = d.now();
    const [tenant, booking] = await Promise.all([
      d.loadTenant(input.tenantId),
      d.loadBooking(input.tenantId, input.appointmentId, input.conn ?? null),
    ]);
    if (!tenant) return { ok: false, error: "tenant not found" };
    if (!booking) return { ok: false, error: "booking not found" };

    const recipientRaw = bookingRecipient(booking);
    if (input.consent && recipientRaw) {
      await recordConsent({
        tenantId: input.tenantId,
        phone: recipientRaw,
        optedIn: input.consent.optedIn,
        source: input.consent.source,
        appointmentId: input.appointmentId,
        nowMs,
      }).catch(() => false);
    }

    // Reminder maintenance runs regardless of whether this event itself is
    // notifiable for the category.
    if (!input.skipReminders) {
      if (input.type === "booking.cancelled" || input.type === "booking.completed") {
        await cancelReminders(
          d,
          input.tenantId,
          input.appointmentId,
          `booking_${input.type.split(".")[1]}`,
        );
      } else if (input.type === "booking.reschedule_needed") {
        await cancelReminders(d, input.tenantId, input.appointmentId, "provider_unavailable");
      } else if (
        input.type === "booking.created" ||
        input.type === "booking.confirmed" ||
        input.type === "booking.rescheduled" ||
        input.type === "booking.reinstated"
      ) {
        await scheduleRemindersWith(d, { tenant, booking, mode: "event", nowMs });
      }
    }
    if (input.type === "booking.rescheduled") {
      // Older reschedule notices for a previous time are no longer true.
      await d.repo.cancelPending({
        tenantId: input.tenantId,
        appointmentId: input.appointmentId,
        kinds: ["rescheduled", "tokenUpdated"],
        status: "superseded",
        reason: "superseded_by_reschedule",
        exceptEventKey: `booking.rescheduled:${input.appointmentId}:${booking.wallClock}`,
      });
    }

    const kind = kindForEvent(input.type, tenant.category, input.payload);
    if (!kind || !isKindApplicable(tenant.category, kind)) {
      return { ok: true, eventId: null, inserted: false, kind, note: "not_applicable" };
    }

    const eventKey = await eventKeyFor(d, input, booking);
    const platform = await d.repo.getPlatformSettings();
    // The values that make these events "still true" at dispatch come from the
    // same snapshot the dispatcher re-reads, never from caller formatting.
    let basePayload = input.payload ?? null;
    if (input.type === "booking.table_changed") {
      basePayload = { ...(basePayload ?? {}), tableName: booking.tableName };
    } else if (input.type === "queue.updated") {
      basePayload = { ...(basePayload ?? {}), tokenNo: booking.tokenNo };
    }
    const payload = withTestMarker(basePayload);
    const res = await d.repo.insertEvent(
      {
        eventKey,
        tenantId: input.tenantId,
        businessCategory: tenant.category,
        eventType: input.type,
        notifyKind: kind,
        appointmentId: input.appointmentId,
        recipient: consentPhone(recipientRaw),
        source: input.source,
        scheduledForMs: nowMs + Math.max(0, Math.min(input.delayMs ?? 0, 120_000)),
        expiresAtMs: expiryFor(kind, booking, tenant),
        appointmentAtLocal: booking.wallClock,
        payload,
        maxAttempts: platform.maxAttempts,
        createdAtMs: nowMs,
      },
      input.conn ?? undefined,
    );
    if (res.inserted) {
      await d.repo
        .addAudit({
          tenantId: input.tenantId,
          eventId: res.id,
          action: "event_created",
          actor: input.source,
          detail: { eventType: input.type, notifyKind: kind },
          atMs: nowMs,
        })
        .catch(() => {});
      if (!input.conn) d.kick();
    }
    return { ok: true, eventId: res.id || null, inserted: res.inserted, kind };
  } catch (e: any) {
    console.error(`[NotifyEngine] emit ${input.type} failed: ${e?.message ?? "error"}`);
    return { ok: false, error: e?.message || "emit failed" };
  }
}

/**
 * Events created by a test-mode process (WA_CLOUD_TEST_RECIPIENTS set) are
 * marked so a production worker sharing the database never delivers them; only
 * a test worker (which also filters by its allow-list) will.
 */
function withTestMarker(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const raw = process.env.WA_CLOUD_TEST_RECIPIENTS;
  if (!raw || !raw.trim()) return payload;
  return { ...(payload ?? {}), testMode: true };
}

/** Latest useful send instant for an immediate event (null = no expiry). */
function expiryFor(
  kind: AptNotifyKind,
  booking: BookingSnapshot,
  tenant: TenantSnapshot,
): number | null {
  if (kind === "cancelled" || kind === "completed") return null;
  const w = bookingWallClock(booking);
  if (!w) return null;
  // Do not announce changes to a booking whose start time has passed.
  return wallClockToUtcMs(w, tenant.timezone) + 30 * MINUTE;
}

export function reminderEventKey(
  kind: AptNotifyKind,
  appointmentId: string,
  wallClock: string,
): string {
  return `booking.reminder_due:${kind}:${appointmentId}:${wallClock}`;
}

async function cancelReminders(
  d: EngineDeps,
  tenantId: string,
  appointmentId: string,
  reason: string,
): Promise<number> {
  return d.repo.cancelPending({
    tenantId,
    appointmentId,
    kinds: [...REMINDER_KINDS, "rescheduled", "tokenUpdated", "confirmed", "booked"],
    status: "cancelled",
    reason,
  });
}

export interface ScheduleInput {
  tenant: TenantSnapshot;
  booking: BookingSnapshot;
  /** "event": a live booking change. "backfill": maintenance/recovery pass. */
  mode: "event" | "backfill";
  nowMs: number;
}

/**
 * Ensures reminder jobs exist for the booking's CURRENT wall-clock time and
 * supersedes jobs computed for an older time. Returns the number created.
 */
async function scheduleRemindersWith(d: EngineDeps, input: ScheduleInput): Promise<number> {
  const { tenant, booking, nowMs } = input;
  const w = bookingWallClock(booking);
  // Supersede reminders computed for any other time of this booking.
  for (const kind of REMINDER_KINDS) {
    await d.repo.cancelPending({
      tenantId: tenant.tenantId,
      appointmentId: booking.appointmentId,
      kinds: [kind],
      status: "superseded",
      reason: "booking_time_changed",
      exceptEventKey: reminderEventKey(kind, booking.appointmentId, booking.wallClock),
    });
  }
  if (!w || !REMINDABLE_STATUSES.has(booking.status) || CLOSED_STATUSES.has(booking.status)) {
    return 0;
  }
  const settings = await d.repo.getTenantSettings(tenant.tenantId);
  if (!settings.whatsappEnabled) return 0;
  const platform = await d.repo.getPlatformSettings();
  const apptMs = wallClockToUtcMs(w, tenant.timezone);
  const recipient = consentPhone(bookingRecipient(booking));
  let created = 0;

  const plans: Array<{ kind: AptNotifyKind; dueMs: number; expiresMs: number; enabled: boolean }> =
    [];
  if (isKindApplicable(tenant.category, "reminderDayBefore")) {
    let due = computeDayBeforeDueMs(w, tenant.timezone, {
      quietEndHour: platform.reminderEarliestHour,
      quietStartHour: platform.reminderLatestHour,
    });
    if (due <= nowMs && input.mode === "backfill" && isTomorrowLocal(w, nowMs, tenant.timezone)) {
      due = nowMs; // recovery after downtime; dispatch re-checks every condition
    }
    plans.push({
      kind: "reminderDayBefore",
      dueMs: due,
      expiresMs: apptMs - 3 * HOUR,
      enabled: settings.reminderDayBefore && !booking.remDayBefore,
    });
  }
  if (isKindApplicable(tenant.category, "reminder2h") && hasTimeOfDay(w, booking.timeSlot)) {
    const due = computeHoursBeforeDueMs(w, tenant.timezone, platform.sameDayReminderHours);
    plans.push({
      kind: "reminder2h",
      dueMs: due,
      expiresMs: apptMs - 15 * MINUTE,
      enabled: settings.reminder2h && !booking.rem2h,
    });
  }

  for (const p of plans) {
    if (!p.enabled) continue;
    // A booking made inside a reminder's window already got its confirmation.
    if (p.dueMs <= nowMs - MINUTE || p.dueMs >= p.expiresMs) continue;
    const key = reminderEventKey(p.kind, booking.appointmentId, booking.wallClock);
    const existing = await d.repo.getEventByKey(key);
    if (existing) {
      // A booking moved back to this time, or reinstated after a cancellation:
      // revive its never-sent reminder instead of creating a duplicate.
      if (existing.status === "superseded" || existing.status === "cancelled") {
        if (await d.repo.reviveEvent(existing.id, Math.max(p.dueMs, nowMs), "reminder_revived")) {
          created++;
        }
      }
      continue;
    }
    const res = await d.repo.insertEvent({
      eventKey: key,
      tenantId: tenant.tenantId,
      businessCategory: tenant.category,
      eventType: "booking.reminder_due",
      notifyKind: p.kind,
      appointmentId: booking.appointmentId,
      recipient,
      source: input.mode === "backfill" ? "reminder_backfill" : "reminder_schedule",
      scheduledForMs: Math.max(p.dueMs, nowMs),
      expiresAtMs: p.expiresMs,
      appointmentAtLocal: booking.wallClock,
      payload: withTestMarker({ reminder: p.kind }),
      maxAttempts: platform.maxAttempts,
      createdAtMs: nowMs,
    });
    if (res.inserted) created++;
  }
  return created;
}

/** Wakes the dispatcher (call after committing a transactional emit). */
export function kickNotifications(): void {
  void deps()
    .then((d) => d.kick())
    .catch(() => {});
}

/**
 * Dispatches a freshly committed event immediately in the background (the
 * worker's poll remains the durable fallback). Never throws, never blocks.
 */
export function dispatchSoon(eventId: string | null | undefined): void {
  if (!eventId) return;
  void (async () => {
    const d = await deps();
    await d.repo.releaseHold(eventId, d.now());
    if (depsOverride?.kick) {
      depsOverride.kick();
      return;
    }
    const { dispatchEventNow } = await import("./notify-dispatcher");
    await dispatchEventNow(eventId);
  })().catch(() => {});
}

/** Hold applied to confirmations whose final values are set after commit. */
export const POST_COMMIT_HOLD_MS = 30_000;

/** Dispatches an event now and waits for its outcome (staff-initiated notices). */
export async function dispatchAndWait(
  eventId: string | null | undefined,
): Promise<"sent" | "failed" | "skipped" | "queued"> {
  if (!eventId) return "skipped";
  try {
    const { dispatchEventNow } = await import("./notify-dispatcher");
    const outcome = await dispatchEventNow(eventId);
    if (!outcome) return "queued";
    if (outcome.status === "submitted") return "sent";
    if (outcome.status === "retry" || outcome.status === "pending") return "queued";
    if (["failed", "dead", "blocked", "ambiguous"].includes(outcome.status)) return "failed";
    return "skipped";
  } catch {
    return "queued";
  }
}

/** Public wrapper used by maintenance (backfill). Never throws. */
export async function scheduleReminders(input: {
  tenantId: string;
  appointmentId: string;
  mode: "event" | "backfill";
}): Promise<number> {
  try {
    const d = await deps();
    if (!(await d.ensureSchema())) return 0;
    const [tenant, booking] = await Promise.all([
      d.loadTenant(input.tenantId),
      d.loadBooking(input.tenantId, input.appointmentId),
    ]);
    if (!tenant || !booking) return 0;
    return await scheduleRemindersWith(d, { tenant, booking, mode: input.mode, nowMs: d.now() });
  } catch (e: any) {
    console.error(`[NotifyEngine] schedule reminders failed: ${e?.message ?? "error"}`);
    return 0;
  }
}
