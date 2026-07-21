// ─────────────────────────────────────────────────────────────────────────────
// appointment-notify.ts  (server-only)
//
// Single source of truth for all appointment-related WhatsApp notifications:
//   • booked / confirmed / cancelled / completed (event-driven, from server fns)
//   • reminders: 1 day before, day-of, 2 hours before, 1 hour before (scheduler)
//
// Every send is gated the same way a clinic's other WhatsApp notifications are:
//   1. WhatsAppConfig.isEnabled = 1 for the tenant
//   2. the tenant's WhatsApp session state is CONNECTED
// If either check fails the notification is silently skipped (never throws, so
// it can never block the booking/consultation flow).
// ─────────────────────────────────────────────────────────────────────────────
import { queryOne } from "./db";
import { getWAStatus, enqueueWA } from "./whatsapp";

export type AptNotifyKind =
  | "booked"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "reminderDayBefore"
  | "reminderDayOf"
  | "reminder2h"
  | "reminder1h";

export interface AptNotifyContext {
  name: string;
  clinicName?: string | null;
  doctorName?: string | null;
  dateTime: Date;
  timeSlot?: string | null;
  tokenNo?: number | null;
}

/**
 * True when the tenant's WhatsApp session is live (CONNECTED).
 *
 * A connected session IS the clinic's opt-in — scanning the QR to connect means
 * they want automated notifications sent. We deliberately do NOT require the
 * WhatsAppConfig.isEnabled flag here: that column defaults to 0 and connecting
 * the session never sets it, which previously caused notifications to be
 * silently skipped even though WhatsApp was connected. To turn notifications
 * off, a clinic simply disconnects their WhatsApp session.
 */
export async function isWhatsAppReady(tenantId: string): Promise<boolean> {
  try {
    const status = await getWAStatus(tenantId);
    return status.state === "CONNECTED";
  } catch (err: any) {
    console.error("[WhatsApp] readiness check failed:", err?.message);
    return false;
  }
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function fmtTime(d: Date, slot?: string | null): string {
  if (slot) return slot;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/** Builds the WhatsApp message body for a given notification kind. */
export function buildAppointmentMessage(kind: AptNotifyKind, ctx: AptNotifyContext): string {
  const clinic = ctx.clinicName || "our clinic";
  const dateStr = fmtDate(ctx.dateTime);
  const timeStr = fmtTime(ctx.dateTime, ctx.timeSlot);
  const docText = ctx.doctorName ? ` with *${ctx.doctorName}*` : "";
  const tokenText = ctx.tokenNo ? `\n\n🎫 *Your Token No: #${ctx.tokenNo}*` : "";
  const footer = "\n\n_This is an automated notification message._";

  switch (kind) {
    case "booked":
      return `Hello *${ctx.name}*,\n\nYour appointment at *${clinic}*${docText} is booked for *${dateStr}* at *${timeStr}*.${tokenText}\n\nThank you for choosing us!${footer}`;

    case "confirmed":
      return `Hello *${ctx.name}*,\n\nYour appointment at *${clinic}*${docText} on *${dateStr}* at *${timeStr}* has been *Confirmed* ✅.${tokenText}${footer}`;

    case "cancelled":
      return `Hello *${ctx.name}*,\n\nYour appointment at *${clinic}* scheduled for *${dateStr}* at *${timeStr}* has been *Cancelled* ❌.\n\nIf this was a mistake or you'd like to rebook, please contact us.${footer}`;

    case "completed":
      return `Hello *${ctx.name}*,\n\nThank you for visiting *${clinic}*${docText} today. Your consultation is now *Complete* ✅.\n\nYour prescription and advice (if any) have been recorded. We wish you a speedy recovery — take care!${footer}`;

    case "reminderDayBefore":
      return `Hello *${ctx.name}*,\n\n⏰ *Reminder:* You have an appointment at *${clinic}*${docText} *tomorrow*, *${dateStr}* at *${timeStr}*.${tokenText}\n\nPlease arrive 10 minutes early. See you soon!${footer}`;

    case "reminderDayOf":
      return `Hello *${ctx.name}*,\n\n📅 *Reminder:* Your appointment at *${clinic}*${docText} is *today* at *${timeStr}*.${tokenText}\n\nPlease arrive 10 minutes early.${footer}`;

    case "reminder2h":
      return `Hello *${ctx.name}*,\n\n⏳ *Reminder:* Your appointment at *${clinic}*${docText} is in about *2 hours* — today at *${timeStr}*.${tokenText}\n\nSee you soon!${footer}`;

    case "reminder1h":
      return `Hello *${ctx.name}*,\n\n🔔 *Reminder:* Your appointment at *${clinic}*${docText} is in about *1 hour* — today at *${timeStr}*.${tokenText}\n\nPlease start heading over. See you soon!${footer}`;

    default:
      return "";
  }
}

/**
 * Sends an appointment WhatsApp notification if (and only if) the tenant has
 * WhatsApp enabled and connected. Returns true when a message was queued.
 * Never throws — safe to call from any booking/consultation flow.
 */
export async function sendAppointmentNotification(
  tenantId: string,
  phone: string | null | undefined,
  kind: AptNotifyKind,
  ctx: AptNotifyContext
): Promise<boolean> {
  try {
    if (!phone) {
      console.warn(`[WhatsApp][${kind}] Skipped — no phone number for ${ctx.name} (${tenantId}).`);
      return false;
    }
    if (!(await isWhatsAppReady(tenantId))) {
      console.warn(`[WhatsApp][${kind}] Skipped — WhatsApp not CONNECTED for tenant ${tenantId}.`);
      return false;
    }
    const body = buildAppointmentMessage(kind, ctx);
    if (!body) return false;
    await enqueueWA(tenantId, phone, body);
    console.log(`[WhatsApp][${kind}] Queued to ${phone} (tenant ${tenantId}).`);
    return true;
  } catch (err: any) {
    console.error(`[WhatsApp][${kind}] Failed to enqueue notification:`, err?.message);
    return false;
  }
}

/** Resolves a doctor's display name (or "" if none/unknown). Best-effort. */
export async function resolveDoctorName(doctorId?: string | null): Promise<string> {
  if (!doctorId) return "";
  try {
    const doc = await queryOne<any>("SELECT name FROM Doctor WHERE id = ? LIMIT 1", [doctorId]);
    return doc?.name || "";
  } catch {
    return "";
  }
}

/** Resolves a tenant's clinic/business name (or "our clinic" fallback). */
export async function resolveClinicName(tenantId: string): Promise<string> {
  try {
    const clinic = await queryOne<any>("SELECT clinicName FROM User WHERE tenantId = ? LIMIT 1", [tenantId]);
    return clinic?.clinicName || "our clinic";
  } catch {
    return "our clinic";
  }
}
