// ─────────────────────────────────────────────────────────────────────────────
// reminder-scheduler.ts  (server-only)
//
// The 5-minute background cycle. WhatsApp reminders and queue-number updates
// are no longer sent from here directly: they are durable NotificationEvent
// jobs (notify-engine.ts) dispatched by notify-dispatcher.ts, which claims each
// job atomically, re-checks the booking, and records Meta's result. This cycle
// runs the engine's maintenance pass (token-correction events, reminder
// backfill after restarts, template sync, catalog activation, alerts,
// retention) plus the platform's other sweeps.
//
// Never throws out of the cycle — a failure in one step does not affect the
// others.
// ─────────────────────────────────────────────────────────────────────────────

const globalForScheduler = globalThis as unknown as {
  reminderSchedulerStarted?: boolean;
  reminderSchedulerRunning?: boolean;
};

const CYCLE_MS = 5 * 60 * 1000; // every 5 minutes
const FIRST_RUN_DELAY_MS = 30 * 1000; // 30s after boot

export function startReminderScheduler() {
  if (typeof window !== "undefined") return;
  if (globalForScheduler.reminderSchedulerStarted) return;
  globalForScheduler.reminderSchedulerStarted = true;

  console.log("[Reminder Scheduler] Started — notification maintenance and sweeps every 5 min.");
  setTimeout(() => {
    void runReminderCycle();
  }, FIRST_RUN_DELAY_MS);
  setInterval(() => {
    void runReminderCycle();
  }, CYCLE_MS);
}

async function runReminderCycle(): Promise<void> {
  // Prevent overlapping runs (a slow cycle shouldn't stack).
  if (globalForScheduler.reminderSchedulerRunning) return;
  globalForScheduler.reminderSchedulerRunning = true;

  try {
    // Notification engine upkeep: queue-number corrections, reminder jobs for
    // upcoming bookings, template sync + catalog activation, alerts, retention.
    try {
      const { runNotificationMaintenance } = await import("./notify-maintenance");
      await runNotificationMaintenance();
    } catch (notifyErr: any) {
      console.error("[Reminder Scheduler] notification maintenance error:", notifyErr?.message);
    }

    // Expire video rooms whose join window has closed, and prune stale signal
    // rows. Runs once per cycle on the existing timer — no new infrastructure.
    try {
      const { sweepExpiredVideoRooms } = await import("./video.server");
      await sweepExpiredVideoRooms();
    } catch (sweepErr: any) {
      console.error("[Reminder Scheduler] video sweep error:", sweepErr?.message);
    }

    // Permanently delete accounts whose deletion grace window has elapsed.
    // Piggy-backs on this cycle — no separate timer.
    try {
      const { sweepPendingAccountDeletions } = await import("./account-lifecycle");
      await sweepPendingAccountDeletions();
    } catch (delErr: any) {
      console.error("[Reminder Scheduler] account deletion sweep error:", delErr?.message);
    }

    // Re-lock custom-plan workspaces whose fixed term lapsed without AutoPay,
    // and email them a fresh payment link.
    try {
      const { sweepExpiredCustomPlans } = await import("./custom-plan-payment");
      await sweepExpiredCustomPlans();
    } catch (cpErr: any) {
      console.error("[Reminder Scheduler] custom plan expiry sweep error:", cpErr?.message);
    }
  } catch (err: any) {
    console.error("[Reminder Scheduler] cycle error:", err?.message);
  } finally {
    globalForScheduler.reminderSchedulerRunning = false;
  }
}
