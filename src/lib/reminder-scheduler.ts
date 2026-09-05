// ─────────────────────────────────────────────────────────────────────────────
// reminder-scheduler.ts  (server-only)
//
// Background scheduler that sends WhatsApp appointment reminders at four points:
//   • ~1 day before   (remDayBefore)
//   • the day of       (remDayOf, after 8am, morning-of)
//   • ~2 hours before  (rem2h)
//   • ~1 hour before   (rem1h)
//
// Runs every 5 minutes. For each upcoming appointment it fires AT MOST ONE
// reminder per cycle (the most urgent applicable stage), deduped by per-row
// boolean columns so a customer never receives the same reminder twice.
//
// Gated per-tenant via appointment-notify.isWhatsAppReady (enabled + CONNECTED).
// Never throws out of the cycle — a failure for one appointment/tenant does not
// affect the others.
// ─────────────────────────────────────────────────────────────────────────────
import { query, execute } from "./db";
import { isWhatsAppReady, buildAppointmentMessage, type AptNotifyKind } from "./appointment-notify";
import { enqueueWA } from "./whatsapp";

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

  console.log("[Reminder Scheduler] Started — WhatsApp appointment reminders every 5 min.");
  setTimeout(() => {
    void runReminderCycle();
  }, FIRST_RUN_DELAY_MS);
  setInterval(() => {
    void runReminderCycle();
  }, CYCLE_MS);
}

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Sends corrected token numbers to patients whose token shifted after they were
 * already notified (see renumberDailyTokens). Running this on the scheduler's
 * cycle is what debounces a burst of bookings: however many times a patient's
 * token moved in the last few minutes, they receive ONE message carrying the
 * current value. The flag is cleared only after a successful enqueue so a
 * transient WhatsApp outage retries on the next cycle.
 */
async function runTokenCorrections(): Promise<void> {
  const rows = await query<any>(
    `SELECT a.id, a.tenantId, a.name, a.phone, a.whatsapp, a.dateTime, a.timeSlot, a.tokenNo,
            u.clinicName, d.name AS doctorName
       FROM Appointment a
       LEFT JOIN User u ON u.tenantId = a.tenantId
       LEFT JOIN Doctor d ON d.id = a.doctorId
      WHERE a.tokenNotifyPending = 1
        AND a.dateTime >= NOW()
        AND a.status NOT IN ('Cancelled', 'Completed')`,
  );

  if (!rows || rows.length === 0) {
    // Clear stale flags on rows we will never message (past or closed) so they
    // do not accumulate.
    await execute(
      `UPDATE Appointment SET tokenNotifyPending = 0
        WHERE tokenNotifyPending = 1
          AND (dateTime < NOW() OR status IN ('Cancelled', 'Completed'))`,
    );
    return;
  }

  const readiness = new Map<string, boolean>();
  const canSend = async (tenantId: string): Promise<boolean> => {
    if (readiness.has(tenantId)) return readiness.get(tenantId)!;
    const ok = await isWhatsAppReady(tenantId);
    readiness.set(tenantId, ok);
    return ok;
  };

  for (const apt of rows) {
    try {
      const phone = apt.whatsapp || apt.phone;
      if (!phone) {
        // Nothing we can do for this row — clear it so it stops being scanned.
        await execute("UPDATE Appointment SET tokenNotifyPending = 0 WHERE id = ?", [apt.id]);
        continue;
      }
      if (!(await canSend(apt.tenantId))) continue; // retry next cycle

      const body = buildAppointmentMessage("tokenUpdated", {
        name: apt.name,
        clinicName: apt.clinicName,
        doctorName: apt.doctorName,
        dateTime: new Date(apt.dateTime),
        timeSlot: apt.timeSlot,
        tokenNo: apt.tokenNo,
      });
      if (!body) continue;

      await enqueueWA(apt.tenantId, phone, body);
      await execute("UPDATE Appointment SET tokenNotifyPending = 0 WHERE id = ?", [apt.id]);
      console.log(
        `[Reminder Scheduler] Sent corrected token #${apt.tokenNo} for appointment ${apt.id} (${apt.tenantId})`,
      );
    } catch (rowErr: any) {
      console.error("[Reminder Scheduler] token correction error:", rowErr?.message);
    }
  }
}

async function runReminderCycle(): Promise<void> {
  // Prevent overlapping runs (a slow cycle shouldn't stack).
  if (globalForScheduler.reminderSchedulerRunning) return;
  globalForScheduler.reminderSchedulerRunning = true;

  try {
    // Correct any tokens that shifted since the patient was last told, before
    // the reminders below go out carrying token numbers.
    try {
      await runTokenCorrections();
    } catch (tokErr: any) {
      console.error("[Reminder Scheduler] token correction pass error:", tokErr?.message);
    }

    // Pull appointments in the next ~26h that are still upcoming.
    // Expire video rooms whose join window has closed, and prune stale signal
    // rows. Runs once per cycle on the existing timer — no new infrastructure.
    try {
      const { sweepExpiredVideoRooms } = await import("./video.server");
      await sweepExpiredVideoRooms();
    } catch (sweepErr: any) {
      console.error("[Reminder Scheduler] video sweep error:", sweepErr?.message);
    }

    const rows = await query<any>(
      `SELECT a.id, a.tenantId, a.name, a.phone, a.whatsapp, a.dateTime, a.timeSlot, a.tokenNo,
              a.doctorId, a.status, a.consultationMode,
              a.remDayBefore, a.remDayOf, a.rem2h, a.rem1h,
              u.clinicName, d.name AS doctorName
       FROM Appointment a
       LEFT JOIN User u ON u.tenantId = a.tenantId
       LEFT JOIN Doctor d ON d.id = a.doctorId
       WHERE a.dateTime BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 26 HOUR)
         AND a.status NOT IN ('Cancelled', 'Completed')`,
    );

    if (!rows || rows.length === 0) return;

    // Cache per-tenant readiness so we hit the WA service once per tenant per cycle.
    const readiness = new Map<string, boolean>();
    const canSend = async (tenantId: string): Promise<boolean> => {
      if (readiness.has(tenantId)) return readiness.get(tenantId)!;
      const ok = await isWhatsAppReady(tenantId);
      readiness.set(tenantId, ok);
      return ok;
    };

    const now = Date.now();

    for (const apt of rows) {
      try {
        const t = new Date(apt.dateTime).getTime();
        if (Number.isNaN(t)) continue;
        const mins = Math.round((t - now) / 60000);
        if (mins <= 0) continue; // already started

        const sameDay = isSameLocalDay(t, now);
        const hour = new Date(now).getHours();

        // Decide the single most-urgent unsent stage for this appointment.
        let kind: AptNotifyKind | null = null;
        let column: string | null = null;

        if (mins <= 75 && !Number(apt.rem1h)) {
          kind = "reminder1h";
          column = "rem1h";
        } else if (mins <= 135 && !Number(apt.rem2h)) {
          kind = "reminder2h";
          column = "rem2h";
        } else if (sameDay && hour >= 8 && mins > 150 && !Number(apt.remDayOf)) {
          kind = "reminderDayOf";
          column = "remDayOf";
        } else if (!sameDay && mins <= 1500 && !Number(apt.remDayBefore)) {
          kind = "reminderDayBefore";
          column = "remDayBefore";
        }

        if (!kind || !column) continue;

        const phone = apt.whatsapp || apt.phone;
        if (!phone) continue;

        if (!(await canSend(apt.tenantId))) continue;

        // For a video consultation, mint a fresh join link to carry in the
        // reminder. Tokens are stored only as hashes, so a reminder cannot
        // re-send a prior link; this issues an additional room-scoped token that
        // sits alongside any previously issued ones (Req 13.3).
        let joinLink: string | null = null;
        if (apt.consultationMode === "video") {
          try {
            const { loadRoomByAppointment, issueJoinToken, ensureVideoRoom } =
              await import("./video.server");
            let room = await loadRoomByAppointment(apt.id, apt.tenantId);
            if (!room) room = await ensureVideoRoom(apt.id, apt.tenantId);
            const issued = await issueJoinToken(room.id, apt.tenantId, "reminder");
            joinLink = issued.link;
          } catch (linkErr: any) {
            console.error("[Reminder Scheduler] join link mint failed:", linkErr?.message);
          }
        }

        const body = buildAppointmentMessage(kind, {
          name: apt.name,
          clinicName: apt.clinicName,
          doctorName: apt.doctorName,
          dateTime: new Date(apt.dateTime),
          timeSlot: apt.timeSlot,
          tokenNo: apt.tokenNo,
          joinLink,
        });
        if (!body) continue;

        await enqueueWA(apt.tenantId, phone, body);
        // Mark this reminder as sent so it never repeats.
        await execute(`UPDATE Appointment SET ${column} = 1 WHERE id = ?`, [apt.id]);
        console.log(
          `[Reminder Scheduler] Sent ${kind} for appointment ${apt.id} (${apt.tenantId})`,
        );
      } catch (rowErr: any) {
        console.error("[Reminder Scheduler] row error:", rowErr?.message);
      }
    }
  } catch (err: any) {
    console.error("[Reminder Scheduler] cycle error:", err?.message);
  } finally {
    globalForScheduler.reminderSchedulerRunning = false;
  }
}
