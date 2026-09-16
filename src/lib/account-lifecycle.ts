/**
 * Self-service account lifecycle: deactivate plan, schedule permanent deletion,
 * cancel a scheduled deletion, and the background sweep that purges accounts
 * once their grace window elapses.
 *
 * Deletion is deliberately deferred: a request only stamps `deletionScheduledAt`
 * (now + GRACE) on the User row and leaves every access field untouched, so the
 * owner keeps FULL access during the grace window and can undo. The customer is
 * never told the exact day count — the UI only says "deletion is in progress".
 * A cron-less sweep piggy-backed on the reminder scheduler does the actual,
 * irreversible purge.
 */

import { createServerFn } from "@tanstack/react-start";
import { execute, query, queryOne } from "./db";
import { verifySession } from "./auth.server";
import { manageCashfreeSubscription } from "./cashfree";
import { sendBillingNotificationEmail } from "./email";

/** Days a delete request waits before the account is permanently purged. */
export const ACCOUNT_DELETION_GRACE_DAYS = 5;

/** Runs a DELETE and swallows failures (missing table/column must not abort a purge). */
async function safeExecute(sql: string, params: (string | number | null)[]): Promise<void> {
  try {
    await execute(sql, params);
  } catch (err) {
    console.warn("[AccountLifecycle] purge step failed:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Deactivate plan (stop recurring billing)
// ---------------------------------------------------------------------------

/**
 * Cancels any active/pending AutoPay mandate so the workspace stops auto-renewing.
 * Access is retained until the current period ends — this is the "cancel anytime"
 * action, not a shutdown. Owner-only.
 */
export const deactivatePlanServerFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  if (user.role && user.role !== "admin") {
    throw new Error("Only the workspace owner can change the plan.");
  }

  const sub = await queryOne<{ subscriptionRef: string; currentPeriodEnd: string | null }>(
    `SELECT subscriptionRef, currentPeriodEnd FROM Subscription
     WHERE userId = ? AND status IN ('ACTIVE','BANK_APPROVAL_PENDING','ON_HOLD')
     ORDER BY createdAt DESC LIMIT 1`,
    [user.id],
  );

  if (!sub) {
    return {
      success: true as const,
      hadSubscription: false,
      message:
        "No recurring AutoPay is active. Your plan will simply not renew after its current period.",
    };
  }

  try {
    await manageCashfreeSubscription(sub.subscriptionRef, "CANCEL");
  } catch (err) {
    // Non-fatal: still reflect the intent locally so the customer isn't stuck.
    console.warn(
      "[AccountLifecycle] Cashfree cancel failed:",
      err instanceof Error ? err.message : err,
    );
  }

  await execute(
    `UPDATE Subscription SET status = 'CANCELLED', cancelAtPeriodEnd = 1, updatedAt = NOW() WHERE subscriptionRef = ?`,
    [sub.subscriptionRef],
  );

  return {
    success: true as const,
    hadSubscription: true,
    message: "AutoPay cancelled. Your plan stays active until the current period ends, then stops.",
  };
});

// ---------------------------------------------------------------------------
// Account deletion — request / cancel / status
// ---------------------------------------------------------------------------

export const requestAccountDeletionServerFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role && user.role !== "admin") {
      throw new Error("Only the workspace owner can delete the account.");
    }

    await execute(
      `UPDATE User
         SET deletionRequestedAt = NOW(),
             deletionScheduledAt = DATE_ADD(NOW(), INTERVAL ? DAY),
             updatedAt = NOW()
       WHERE id = ?`,
      [ACCOUNT_DELETION_GRACE_DAYS, user.id],
    );

    // Best-effort acknowledgement. Deliberately omits any day count.
    if (user.email) {
      try {
        await sendBillingNotificationEmail({
          email: user.email,
          subject: "Your account deletion request has been received",
          title: "Account deletion in progress",
          message: `Hi ${user.name || "there"}, we've received your request to delete ${user.clinicName || "your workspace"}. Your account deletion is now in progress. If this was a mistake, you can cancel it anytime from your dashboard.`,
          tone: "warning",
          details: [{ label: "Workspace", value: user.clinicName || user.tenantId }],
        });
      } catch (err) {
        console.warn(
          "[AccountLifecycle] deletion email failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { success: true as const };
  },
);

export const cancelAccountDeletionServerFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role && user.role !== "admin") {
      throw new Error("Only the workspace owner can manage the account.");
    }

    await execute(
      `UPDATE User SET deletionRequestedAt = NULL, deletionScheduledAt = NULL, updatedAt = NOW() WHERE id = ?`,
      [user.id],
    );

    return { success: true as const };
  },
);

/**
 * Whether a deletion is pending for the caller's account. The scheduled date is
 * intentionally NOT returned — the UI must not surface the countdown.
 */
export const getAccountDeletionStatusServerFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) return { pending: false as const };

    const row = await queryOne<{ deletionRequestedAt: string | null }>(
      "SELECT deletionRequestedAt FROM User WHERE id = ? LIMIT 1",
      [user.id],
    );
    return { pending: Boolean(row?.deletionRequestedAt) };
  },
);

// ---------------------------------------------------------------------------
// Permanent purge + scheduled sweep
// ---------------------------------------------------------------------------

/**
 * Irreversibly removes a workspace and everything scoped to it. Ordered so child
 * rows go before their parents; every statement is individually fault-tolerant
 * so one missing table can't strand a half-deleted tenant.
 */
export async function purgeTenantCompletely(
  userId: string,
  tenantId: string | null,
): Promise<void> {
  if (tenantId) {
    // Child sessions first (keyed by their own parent ids, resolved via subquery).
    // Explicit COLLATE on the cross-column comparisons — id columns and their
    // foreign keys can carry mismatched collations in this database.
    await safeExecute(
      "DELETE FROM SubUserSession WHERE subUserId COLLATE utf8mb4_unicode_ci IN (SELECT id COLLATE utf8mb4_unicode_ci FROM SubUser WHERE tenantId = ?)",
      [tenantId],
    );
    await safeExecute(
      "DELETE FROM LocationSession WHERE locationId COLLATE utf8mb4_unicode_ci IN (SELECT id COLLATE utf8mb4_unicode_ci FROM Location WHERE tenantId = ?)",
      [tenantId],
    );
    await safeExecute(
      "DELETE FROM DoctorSchedule WHERE doctorId COLLATE utf8mb4_unicode_ci IN (SELECT id COLLATE utf8mb4_unicode_ci FROM Doctor WHERE tenantId = ?)",
      [tenantId],
    );
    await safeExecute(
      "DELETE FROM DoctorLeave WHERE doctorId COLLATE utf8mb4_unicode_ci IN (SELECT id COLLATE utf8mb4_unicode_ci FROM Doctor WHERE tenantId = ?)",
      [tenantId],
    );

    // Everything else scoped directly by tenantId.
    const tenantScoped = [
      "ClinicProfile",
      "ClinicHours",
      "Department",
      "Doctor",
      "SubUser",
      "Location",
      "Appointment",
      "Patient",
      "SoapNote",
      "Prescription",
      "WhatsAppConfig",
      "WATemplate",
      "WACampaign",
      "WACampaignRecipient",
      "WAAutoReply",
      "WAConversation",
      "VideoRoom",
      "VideoJoinToken",
      "VideoParticipant",
      "VideoSignal",
      "VideoConsent",
      "VideoAuditEvent",
      "RestaurantTable",
      "RestaurantSettings",
      "RestaurantHours",
      "RestaurantTokenCounter",
      "RestaurantDiningArea",
      "RestaurantClosureDay",
      "RestaurantMenuCategory",
      "RestaurantMenuItem",
      "Subscription",
      "SubscriptionPayment",
      "PaymentHistory",
      "CustomPlanRequest",
    ];
    for (const table of tenantScoped) {
      await safeExecute(`DELETE FROM \`${table}\` WHERE tenantId = ?`, [tenantId]);
    }
  }

  // User-scoped rows, then the owner record itself.
  await safeExecute("DELETE FROM Session WHERE userId = ?", [userId]);
  await safeExecute("DELETE FROM SubscriptionHistory WHERE userId = ?", [userId]);
  await safeExecute("DELETE FROM Subscription WHERE userId = ?", [userId]);
  await safeExecute("DELETE FROM PaymentHistory WHERE userId = ?", [userId]);
  await safeExecute("DELETE FROM CustomPlanRequest WHERE userId = ?", [userId]);
  await safeExecute("DELETE FROM User WHERE id = ?", [userId]);
}

/**
 * Permanently deletes accounts whose grace window has elapsed. Invoked from the
 * existing reminder cycle — no new timer. Returns the number purged.
 */
export async function sweepPendingAccountDeletions(): Promise<number> {
  const due = await query<{ id: string; tenantId: string | null }>(
    `SELECT id, tenantId FROM User
     WHERE deletionScheduledAt IS NOT NULL AND deletionScheduledAt <= NOW()`,
  );
  if (!due || due.length === 0) return 0;

  let purged = 0;
  for (const row of due) {
    try {
      await purgeTenantCompletely(row.id, row.tenantId);
      purged += 1;
      console.log(`[AccountLifecycle] Purged account ${row.id} (tenant ${row.tenantId || "—"})`);
    } catch (err) {
      console.error(
        `[AccountLifecycle] Failed to purge account ${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return purged;
}
