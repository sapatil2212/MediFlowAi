import { query, queryOne, execute } from "./db";
import { sendDoctorMonthlyReportEmail } from "./doctor-report.server";

const globalForMonthlyScheduler = globalThis as unknown as {
  monthlySchedulerStarted?: boolean;
};

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every 1 hour
const FIRST_CHECK_DELAY_MS = 45 * 1000; // 45s after boot
const STAGGER_DELAY_MS = 6000; // 6 seconds between each email to prevent SMTP / rate-limit blocks

/**
 * Initializes the Monthly Report Scheduler that automatically runs on the 1st of each month.
 */
export function startMonthlyReportScheduler() {
  if (typeof window !== "undefined") return;
  if (globalForMonthlyScheduler.monthlySchedulerStarted) return;
  globalForMonthlyScheduler.monthlySchedulerStarted = true;

  console.log("[Monthly Report Scheduler] 📅 Initialized — Auto-dispatches on the 1st of each month.");

  // Ensure tracking table exists
  void ensureLogTable();

  // Run initial check after boot delay
  setTimeout(() => {
    void runMonthlyReportCycle();
  }, FIRST_CHECK_DELAY_MS);

  // Set recurring hourly check
  setInterval(() => {
    void runMonthlyReportCycle();
  }, CHECK_INTERVAL_MS);
}

async function ensureLogTable() {
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS MonthlyReportLog (
        id VARCHAR(255) PRIMARY KEY,
        tenantId VARCHAR(255) NOT NULL,
        doctorId VARCHAR(255) NOT NULL,
        reportMonth VARCHAR(20) NOT NULL,
        sentAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        recipientEmail VARCHAR(255),
        status VARCHAR(50) DEFAULT 'SENT',
        UNIQUE KEY unique_monthly_doc_report (tenantId, doctorId, reportMonth)
      )
    `);
  } catch (err: any) {
    console.error("[Monthly Report Scheduler] Failed to ensure MonthlyReportLog table:", err?.message);
  }
}

/**
 * Main cycle that checks if today is the 1st of the month and dispatches reports.
 */
export async function runMonthlyReportCycle(forceRun = false): Promise<{ sent: number; skipped: number; errors: number }> {
  const now = new Date();
  const dayOfMonth = now.getDate();

  // Only run on the 1st of the month unless forced (e.g. manual trigger)
  if (!forceRun && dayOfMonth !== 1) {
    return { sent: 0, skipped: 0, errors: 0 };
  }

  // Target month is the one that just concluded (previous month)
  // e.g. on 1st Oct, target is September (month - 1)
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const targetYear = prevMonthDate.getFullYear();
  const targetMonth = String(prevMonthDate.getMonth() + 1).padStart(2, "0");
  const reportMonthStr = `${targetYear}-${targetMonth}`; // "2026-09"

  console.log(`[Monthly Report Scheduler] 🚀 Initiating report cycle for concluded month: ${reportMonthStr}...`);

  await ensureLogTable();

  // 1. Fetch all unique active tenants
  const tenants = await query<any>(
    `SELECT DISTINCT tenantId, clinicName, email
     FROM User
     WHERE tenantId IS NOT NULL AND tenantId != ''`,
  );

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const t of tenants) {
    const tenantId = t.tenantId;

    // 2. Fetch all doctors in this tenant
    const doctors = await query<any>(
      `SELECT id, name, email FROM Doctor WHERE tenantId = ?`,
      [tenantId],
    );

    for (const doc of doctors) {
      try {
        // Check if report was already sent this month
        const existing = await queryOne<any>(
          `SELECT id FROM MonthlyReportLog WHERE tenantId = ? AND doctorId = ? AND reportMonth = ? LIMIT 1`,
          [tenantId, doc.id, reportMonthStr],
        );

        if (existing) {
          skippedCount++;
          continue;
        }

        console.log(
          `[Monthly Report Scheduler] Generating & emailing report for Dr. ${doc.name} (${tenantId})...`,
        );

        // Send email with attached PDF
        const sendRes = await sendDoctorMonthlyReportEmail({
          tenantId,
          doctorId: doc.id,
          monthDateStr: `${reportMonthStr}-01`,
        });

        // Record successful dispatch
        const logId = crypto.randomUUID();
        await execute(
          `INSERT INTO MonthlyReportLog (id, tenantId, doctorId, reportMonth, recipientEmail, status)
           VALUES (?, ?, ?, ?, ?, 'SENT')
           ON DUPLICATE KEY UPDATE sentAt = CURRENT_TIMESTAMP`,
          [logId, tenantId, doc.id, reportMonthStr, sendRes.recipient],
        );

        sentCount++;
        console.log(
          `[Monthly Report Scheduler] ✅ Successfully sent to ${sendRes.recipient}. Staggering next email by ${STAGGER_DELAY_MS / 1000}s...`,
        );

        // Stagger next dispatch to prevent SMTP rate-limiting / blocking
        await new Promise((resolve) => setTimeout(resolve, STAGGER_DELAY_MS));
      } catch (docErr: any) {
        errorCount++;
        console.error(
          `[Monthly Report Scheduler] ❌ Failed to dispatch report for Dr. ${doc.name} (${doc.id}):`,
          docErr?.message,
        );
      }
    }
  }

  console.log(
    `[Monthly Report Scheduler] Cycle complete for ${reportMonthStr}. Sent: ${sentCount}, Skipped: ${skippedCount}, Errors: ${errorCount}.`,
  );

  return { sent: sentCount, skipped: skippedCount, errors: errorCount };
}
