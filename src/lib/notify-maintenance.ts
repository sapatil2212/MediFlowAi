// ─────────────────────────────────────────────────────────────────────────────
// notify-maintenance.ts  (server-only)
//
// Periodic upkeep for the notification engine, run from the existing 5-minute
// scheduler cycle (reminder-scheduler.ts). Every step is isolated and never
// throws out of the cycle:
//
//   1. queue-number corrections  tokenNotifyPending rows → one queue.updated
//                                event per (booking, token) — a burst of
//                                renumbers collapses into one message.
//   2. reminder backfill         upcoming bookings without reminder jobs (e.g.
//                                created before this engine, or after a tenant
//                                enabled a reminder) get them; restart-safe.
//   3. template sync             full Meta sync every templateSyncMinutes, or
//                                every pendingTemplateSyncMinutes while catalog
//                                templates await review.
//   4. catalog activation        approved catalog templates → routes.
//   5. alerts                    failure rate, backlog, worker, webhook silence,
//                                missing/rejected templates, tenant failures.
//   6. retention                 daily purge of old terminal events/audit/logs.
// ─────────────────────────────────────────────────────────────────────────────
import { execute, query, queryOne } from "./db";
import { getNotifyRepo, type AlertInput, type PlatformSettings } from "./notify-repo";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const state = globalThis as unknown as {
  __notifyMaint?: {
    running: boolean;
    lastSyncAt: number;
    lastActivationAt: number;
    lastPurgeAt: number;
    lastCredentialCheckAt: number;
  };
};

function maintState() {
  return (state.__notifyMaint ??= {
    running: false,
    lastSyncAt: 0,
    lastActivationAt: 0,
    lastPurgeAt: 0,
    lastCredentialCheckAt: 0,
  });
}

async function step(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e: any) {
    console.error(`[NotifyMaintenance] ${label} failed: ${e?.message ?? "error"}`);
  }
}

/** tokenNotifyPending → queue.updated events (debounced by the 5-minute cycle). */
export async function convertTokenCorrections(): Promise<number> {
  const rows = await query<any>(
    `SELECT a.id, a.tenantId, a.tokenNo FROM Appointment a
      WHERE a.tokenNotifyPending = 1 AND a.dateTime >= NOW()
        AND a.status NOT IN ('Cancelled', 'Completed', 'No Show')
      LIMIT 200`,
  );
  await execute(
    `UPDATE Appointment SET tokenNotifyPending = 0
      WHERE tokenNotifyPending = 1 AND (dateTime < NOW() OR status IN ('Cancelled', 'Completed', 'No Show'))`,
  );
  if (rows.length === 0) return 0;
  const { emitBookingEvent } = await import("./notify-engine");
  let n = 0;
  for (const r of rows) {
    const res = await emitBookingEvent({
      tenantId: String(r.tenantId),
      appointmentId: String(r.id),
      type: "queue.updated",
      source: "token_renumber",
      payload: { tokenNo: r.tokenNo != null ? Number(r.tokenNo) : null },
      skipReminders: true,
    });
    if (res.ok) {
      // Clear only if the token did not move again meanwhile (else next cycle).
      await execute(
        "UPDATE Appointment SET tokenNotifyPending = 0 WHERE id = ? AND tenantId = ? AND tokenNo <=> ?",
        [r.id, r.tenantId, r.tokenNo],
      );
      if (res.inserted) n++;
    }
  }
  return n;
}

/** Ensures reminder jobs exist for upcoming bookings (restart / late-enable safe). */
export async function backfillReminders(): Promise<number> {
  const rows = await query<any>(
    `SELECT a.id, a.tenantId, DATE_FORMAT(a.dateTime, '%Y-%m-%d %H:%i:%s') AS wallClock
       FROM Appointment a
      WHERE a.dateTime BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 HOUR)
        AND a.status IN ('Pending', 'Confirmed')
      ORDER BY a.dateTime ASC
      LIMIT 500`,
  );
  if (rows.length === 0) return 0;
  const ids = rows.map((r: any) => String(r.id));
  // Cancelled/superseded jobs do not count: a reinstated booking needs them back.
  const existing = await query<any>(
    `SELECT appointmentId, notifyKind, appointmentAtLocal FROM NotificationEvent
      WHERE eventType = 'booking.reminder_due' AND appointmentId IN (?)
        AND status NOT IN ('cancelled', 'superseded')`,
    [ids],
  );
  const have = new Set(
    existing.map((e: any) => `${e.appointmentId}|${e.notifyKind}|${e.appointmentAtLocal}`),
  );
  const { scheduleReminders } = await import("./notify-engine");
  let created = 0;
  for (const r of rows) {
    const key = (kind: string) => `${r.id}|${kind}|${r.wallClock}`;
    if (have.has(key("reminderDayBefore")) && have.has(key("reminder2h"))) continue;
    created += await scheduleReminders({
      tenantId: String(r.tenantId),
      appointmentId: String(r.id),
      mode: "backfill",
    });
  }
  return created;
}

/** Full Meta template sync on the configured cadence. Returns true when it ran. */
export async function maybeSyncTemplates(
  platform: PlatformSettings,
  nowMs: number,
): Promise<boolean> {
  const s = maintState();
  let intervalMs = platform.templateSyncMinutes * MINUTE;
  try {
    const { planCatalog } = await import("./notify-template-catalog");
    const plan = await planCatalog();
    if (plan.summary.pending > 0 || plan.summary.uncertain > 0) {
      intervalMs = Math.min(intervalMs, platform.pendingTemplateSyncMinutes * MINUTE);
    }
  } catch {
    /* fall back to the regular cadence */
  }
  if (s.lastSyncAt === 0) {
    // First cycle after boot: respect a recent sync by another process.
    try {
      const { getTemplateRepo } = await import("./wa-template-repo");
      const summary = await getTemplateRepo().dashboard();
      s.lastSyncAt = summary.lastSyncOkAt ? summary.lastSyncOkAt.getTime() : 0;
    } catch {
      s.lastSyncAt = 0;
    }
  }
  if (nowMs - s.lastSyncAt < intervalMs) return false;
  s.lastSyncAt = nowMs;
  const { runFullSync } = await import("./wa-template-sync");
  const res = await runFullSync("scheduled");
  if (!res.ok) {
    await raise({
      alertKey: "templates:sync_failed",
      severity: "warning",
      title: "Scheduled WhatsApp template sync failed",
      detail: res.error ?? "unknown error",
      nowMs,
    });
  } else {
    await getNotifyRepo().resolveAlert("templates:sync_failed", nowMs);
    const { invalidateMappingCache } = await import("./wa-template-notify");
    invalidateMappingCache();
  }
  return res.ok;
}

async function raise(input: AlertInput): Promise<void> {
  const repo = getNotifyRepo();
  const { isNew, row } = await repo.upsertAlert(input);
  if (row.severity !== "critical") return;
  // Email the Super Admin for new critical alerts, at most every 6 hours.
  const due = isNew || !row.notifiedAtMs || input.nowMs - row.notifiedAtMs > 6 * HOUR;
  const to = process.env.SUPER_ADMIN_EMAIL;
  if (!due || !to || !process.env.EMAIL_USERNAME) return;
  try {
    const { transporter } = await import("./email");
    await transporter.sendMail({
      from: `"BookMyTime Alerts" <${process.env.EMAIL_USERNAME}>`,
      to,
      subject: `[BookMyTime] WhatsApp alert: ${row.title}`,
      text: `${row.title}\n\n${row.detail ?? ""}\n\nOpen Super Admin → WhatsApp → Overview for details.\n(Alert key: ${row.alertKey}; occurrences: ${row.occurrences})`,
    });
    await repo.markAlertNotified(row.alertKey, input.nowMs);
  } catch (e: any) {
    console.error(`[NotifyMaintenance] alert email failed: ${e?.message ?? "error"}`);
  }
}

/** Evaluates operational alert conditions and opens/resolves alerts. */
export async function evaluateAlerts(platform: PlatformSettings, nowMs: number): Promise<void> {
  const repo = getNotifyRepo();
  const m = await repo.metrics(nowMs - HOUR, nowMs);
  const attempted =
    (m.byStatus.submitted ?? 0) +
    (m.byStatus.sent ?? 0) +
    (m.byStatus.delivered ?? 0) +
    (m.byStatus.read ?? 0) +
    (m.byStatus.failed ?? 0) +
    (m.byStatus.dead ?? 0) +
    (m.byStatus.ambiguous ?? 0);
  const failures = (m.byStatus.failed ?? 0) + (m.byStatus.dead ?? 0) + (m.byStatus.ambiguous ?? 0);
  const rate = attempted > 0 ? (failures / attempted) * 100 : 0;
  if (attempted >= platform.alertMinSample && rate >= platform.alertFailureRatePct) {
    await raise({
      alertKey: "delivery:failure_rate",
      severity: "critical",
      title: "Sustained WhatsApp send failures",
      detail: `${failures} of ${attempted} notifications failed in the last hour (${rate.toFixed(0)}%).`,
      nowMs,
    });
  } else {
    await repo.resolveAlert("delivery:failure_rate", nowMs);
  }

  const backlogAgeMs = m.oldestDueMs != null ? nowMs - m.oldestDueMs : 0;
  if (m.dueBacklog >= platform.alertBacklogThreshold || backlogAgeMs > 15 * MINUTE) {
    await raise({
      alertKey: "queue:backlog",
      severity: backlogAgeMs > 15 * MINUTE ? "critical" : "warning",
      title: "Notification queue backlog",
      detail: `${m.dueBacklog} notifications are due; the oldest has waited ${Math.round(backlogAgeMs / MINUTE)} min. Check that the notification worker is running.`,
      nowMs,
    });
  } else {
    await repo.resolveAlert("queue:backlog", nowMs);
  }

  // Webhook silence: accepted sends older than 30 min that never progressed
  // while no WhatsApp webhook has been received for 3 hours.
  const stuck = await queryOne<any>(
    `SELECT COUNT(*) AS n FROM NotificationEvent
      WHERE status = 'submitted' AND submittedAtMs BETWEEN ? AND ?`,
    [nowMs - 3 * HOUR, nowMs - 30 * MINUTE],
  );
  const lastHook = await queryOne<any>(
    `SELECT COUNT(*) AS n FROM WebhookEvent
      WHERE eventType = 'whatsapp' AND createdAt > NOW() - INTERVAL 3 HOUR`,
  );
  if (Number(stuck?.n ?? 0) >= 3 && Number(lastHook?.n ?? 0) === 0) {
    await raise({
      alertKey: "webhook:silent",
      severity: "critical",
      title: "No WhatsApp delivery webhooks received",
      detail: `${stuck?.n} accepted messages have no delivery status after 30+ minutes and no webhook arrived in 3 hours. Check the Meta app webhook subscription (messages field) and the callback URL.`,
      nowMs,
    });
  } else {
    await repo.resolveAlert("webhook:silent", nowMs);
  }

  // Tenants with repeated failures in the last 24 hours.
  const tenantRows = await query<any>(
    `SELECT tenantId, COUNT(*) AS total,
            SUM(status IN ('failed', 'dead', 'ambiguous')) AS failed
       FROM NotificationEvent
      WHERE createdAtMs >= ? AND status NOT IN ('pending', 'retry', 'processing', 'skipped', 'cancelled', 'superseded', 'expired')
      GROUP BY tenantId HAVING failed >= 5`,
    [nowMs - 24 * HOUR],
  );
  for (const t of tenantRows) {
    const total = Number(t.total) || 0;
    const failed = Number(t.failed) || 0;
    if (total > 0 && failed / total >= 0.5) {
      await raise({
        alertKey: `tenant:failures:${t.tenantId}`,
        severity: "warning",
        title: `Repeated notification failures for tenant ${t.tenantId}`,
        detail: `${failed} of ${total} notifications failed in the last 24 hours.`,
        tenantId: String(t.tenantId),
        nowMs,
      });
    }
  }

  // Rejected / paused / disabled catalog templates need attention.
  try {
    const { planCatalog } = await import("./notify-template-catalog");
    const plan = await planCatalog();
    for (const row of plan.rows) {
      const key = `template:${row.name}:${row.language}`;
      if (
        ["rejected", "paused", "disabled", "reclassified", "content_mismatch"].includes(row.state)
      ) {
        await raise({
          alertKey: key,
          severity: "warning",
          title: `Template ${row.name} (${row.language}) is ${row.state.replace("_", " ")}`,
          detail: row.rejectionDetail
            ? `Meta detail: ${row.rejectionDetail}`
            : "Review it in Super Admin → WhatsApp → Templates.",
          nowMs,
        });
      } else {
        await repo.resolveAlert(key, nowMs);
      }
    }
  } catch {
    /* catalog plan is best-effort */
  }
}

/** Daily credential/account probe (one Graph call). */
async function maybeCheckCredentials(nowMs: number): Promise<void> {
  const s = maintState();
  if (nowMs - s.lastCredentialCheckAt < 6 * HOUR) return;
  s.lastCredentialCheckAt = nowMs;
  const { getPhoneNode, isCloudAvailable } = await import("./whatsapp-cloud");
  if (!(await isCloudAvailable())) {
    await raise({
      alertKey: "provider:cloud_unavailable",
      severity: "critical",
      title: "WhatsApp Cloud API is not configured or disabled",
      detail: "Business notifications cannot be sent. Check Super Admin → WhatsApp → Credentials.",
      nowMs,
    });
    return;
  }
  const repo = getNotifyRepo();
  await repo.resolveAlert("provider:cloud_unavailable", nowMs);
  const res = await getPhoneNode();
  if (!res.ok) {
    const auth = ["0", "10", "190", "200"].includes(String(res.code));
    await raise({
      alertKey: "provider:credentials",
      severity: "critical",
      title: auth
        ? "WhatsApp access token is invalid or lacks permission"
        : "WhatsApp account check failed",
      detail: `Meta error ${res.code}: ${res.message}`.slice(0, 900),
      nowMs,
    });
  } else {
    await repo.resolveAlert("provider:credentials", nowMs);
  }
}

/** Daily retention purge. */
async function maybePurge(platform: PlatformSettings, nowMs: number): Promise<void> {
  const s = maintState();
  if (nowMs - s.lastPurgeAt < 24 * HOUR) return;
  s.lastPurgeAt = nowMs;
  const cutoff = nowMs - platform.retentionDays * 24 * HOUR;
  const res = await getNotifyRepo().purgeOlderThan(cutoff);
  const logs = await execute(
    "DELETE FROM WaMessageLog WHERE createdAt < NOW() - INTERVAL ? DAY LIMIT 5000",
    [platform.retentionDays],
  );
  if (res.events + res.audit + logs.affectedRows > 0) {
    console.log(
      `[NotifyMaintenance] retention: removed ${res.events} events, ${res.audit} audit rows, ${logs.affectedRows} message logs older than ${platform.retentionDays} days.`,
    );
  }
}

let testModeNoticeShown = false;

/**
 * A process running with WA_CLOUD_TEST_RECIPIENTS is a developer/test server.
 * It must not backfill reminders, convert token corrections, sync/activate
 * templates or purge data in a database it may share with production — those
 * writes would create or consume real customers' notifications. Override with
 * NOTIFY_MAINTENANCE_IN_TEST_MODE=1 on an isolated test database.
 */
export function maintenanceAllowedInThisProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  const testMode = !!(env.WA_CLOUD_TEST_RECIPIENTS && env.WA_CLOUD_TEST_RECIPIENTS.trim());
  return !testMode || env.NOTIFY_MAINTENANCE_IN_TEST_MODE === "1";
}

/** One maintenance pass. Safe to call every scheduler cycle. Never throws. */
export async function runNotificationMaintenance(nowMs: number = Date.now()): Promise<void> {
  if (!maintenanceAllowedInThisProcess()) {
    if (!testModeNoticeShown) {
      testModeNoticeShown = true;
      console.log(
        "[NotifyMaintenance] Test mode (WA_CLOUD_TEST_RECIPIENTS set): maintenance writes are disabled in this process.",
      );
    }
    return;
  }
  const s = maintState();
  if (s.running) return;
  s.running = true;
  try {
    const { ensureNotifySchema } = await import("./notify-ddl");
    if (!(await ensureNotifySchema())) return;
    const platform = await getNotifyRepo().getPlatformSettings();
    await step("token corrections", convertTokenCorrections);
    await step("reminder backfill", backfillReminders);
    let synced = false;
    await step("template sync", async () => {
      synced = await maybeSyncTemplates(platform, nowMs);
    });
    if (platform.autoActivateCatalog && (synced || nowMs - s.lastActivationAt > HOUR)) {
      await step("catalog activation", async () => {
        s.lastActivationAt = nowMs;
        const { activateCatalogRoutes } = await import("./notify-template-catalog");
        const { changes } = await activateCatalogRoutes({});
        const applied = changes.filter((c) => c.action !== "skipped");
        if (applied.length > 0) {
          console.log(`[NotifyMaintenance] catalog activation: ${applied.length} route change(s).`);
          await getNotifyRepo().addAudit({
            action: "catalog_routes_activated",
            actor: "system:catalog-auto-activation",
            detail: { changes: applied.slice(0, 50) },
            atMs: nowMs,
          });
        }
      });
    }
    await step("credential check", () => maybeCheckCredentials(nowMs));
    await step("alerts", () => evaluateAlerts(platform, nowMs));
    await step("retention", () => maybePurge(platform, nowMs));
  } finally {
    s.running = false;
  }
}
