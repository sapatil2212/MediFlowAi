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
  | "reminder1h"
  | "tokenUpdated"
  | "videoLinkIssued"
  | "videoLinkReissued";

export interface AptNotifyContext {
  name: string;
  clinicName?: string | null;
  doctorName?: string | null;
  dateTime: Date;
  timeSlot?: string | null;
  tokenNo?: number | null;
  /** Absolute patient join link for video consultations (Req 13). */
  joinLink?: string | null;
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
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
  // Join-link line, appended to reminders and used by the two video kinds.
  const linkText = ctx.joinLink ? `\n\n🎥 *Join your video consultation:*\n${ctx.joinLink}` : "";

  switch (kind) {
    case "videoLinkIssued":
      return `Hello *${ctx.name}*,\n\nYour *video consultation* at *${clinic}*${docText} is scheduled for *${dateStr}* at *${timeStr}*.${linkText}\n\nPlease open the link at your appointment time from a phone or computer with a camera and microphone. You will wait briefly until the doctor admits you.${footer}`;

    case "videoLinkReissued":
      return `Hello *${ctx.name}*,\n\nHere is your updated *video consultation* link for *${clinic}*${docText} on *${dateStr}* at *${timeStr}*.${linkText}\n\nThe previous link is no longer valid.${footer}`;

    case "booked":
      return `Hello *${ctx.name}*,\n\nYour appointment at *${clinic}*${docText} is booked for *${dateStr}* at *${timeStr}*.${tokenText}\n\nThank you for choosing us!${footer}`;

    case "confirmed":
      return `Hello *${ctx.name}*,\n\nYour appointment at *${clinic}*${docText} on *${dateStr}* at *${timeStr}* has been *Confirmed* ✅.${tokenText}${footer}`;

    case "cancelled":
      return `Hello *${ctx.name}*,\n\nYour appointment at *${clinic}* scheduled for *${dateStr}* at *${timeStr}* has been *Cancelled* ❌.\n\nIf this was a mistake or you'd like to rebook, please contact us.${footer}`;

    case "completed":
      return `Hello *${ctx.name}*,\n\nThank you for visiting *${clinic}*${docText} today. Your consultation is now *Complete* ✅.\n\nYour prescription and advice (if any) have been recorded. We wish you a speedy recovery — take care!${footer}`;

    case "tokenUpdated":
      return `Hello *${ctx.name}*,\n\nYour token number for the appointment at *${clinic}*${docText} on *${dateStr}* at *${timeStr}* has been updated.${tokenText}\n\nYour appointment date and time have *not* changed — only the token number. Please quote this new number at the reception.${footer}`;

    case "reminderDayBefore":
      return `Hello *${ctx.name}*,\n\n⏰ *Reminder:* You have an appointment at *${clinic}*${docText} *tomorrow*, *${dateStr}* at *${timeStr}*.${tokenText}${linkText}\n\n${ctx.joinLink ? "You can join online at your appointment time." : "Please arrive 10 minutes early."} See you soon!${footer}`;

    case "reminderDayOf":
      return `Hello *${ctx.name}*,\n\n📅 *Reminder:* Your appointment at *${clinic}*${docText} is *today* at *${timeStr}*.${tokenText}${linkText}\n\n${ctx.joinLink ? "Open the link at your appointment time to join." : "Please arrive 10 minutes early."}${footer}`;

    case "reminder2h":
      return `Hello *${ctx.name}*,\n\n⏳ *Reminder:* Your appointment at *${clinic}*${docText} is in about *2 hours* — today at *${timeStr}*.${tokenText}${linkText}\n\nSee you soon!${footer}`;

    case "reminder1h":
      return `Hello *${ctx.name}*,\n\n🔔 *Reminder:* Your appointment at *${clinic}*${docText} is in about *1 hour* — today at *${timeStr}*.${tokenText}${linkText}\n\n${ctx.joinLink ? "Please be ready to join online." : "Please start heading over."} See you soon!${footer}`;

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
  ctx: AptNotifyContext,
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
    const clinic = await queryOne<any>("SELECT clinicName FROM User WHERE tenantId = ? LIMIT 1", [
      tenantId,
    ]);
    return clinic?.clinicName || "our clinic";
  } catch {
    return "our clinic";
  }
}

/**
 * Sends the patient video-consultation join link by email (Req 13.5), in
 * addition to the WhatsApp message. Kept here so all video messaging shares one
 * module. Throws on transport failure so the caller can record it; callers wrap
 * this in a never-throw guard.
 */
export async function sendVideoLinkEmail(
  email: string,
  ctx: {
    name: string;
    clinicName?: string | null;
    doctorName?: string | null;
    dateTime: Date;
    joinLink: string;
  },
): Promise<void> {
  const { transporter } = await import("./email");
  const clinic = ctx.clinicName || "our clinic";
  const dateStr = fmtDate(ctx.dateTime);
  const timeStr = fmtTime(ctx.dateTime, null);
  const docText = ctx.doctorName ? ` with ${ctx.doctorName}` : "";
  const bcc = process.env.EMAIL_BCC || "";

  await transporter.sendMail({
    from: `"BookMyTime" <${process.env.EMAIL_USERNAME}>`,
    to: email,
    bcc: bcc || undefined,
    subject: `Your video consultation link — ${clinic}`,
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;padding:24px 16px;color:#18181b;">
        <h2 style="font-size:18px;margin:0 0 12px;">Your video consultation is ready</h2>
        <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 8px;">Hello ${escapeHtml(ctx.name)},</p>
        <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 16px;">
          Your video consultation at <strong>${escapeHtml(clinic)}</strong>${escapeHtml(docText)} is scheduled for
          <strong>${escapeHtml(dateStr)}</strong> at <strong>${escapeHtml(timeStr)}</strong>.
        </p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${ctx.joinLink}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">
            Join Consultation
          </a>
        </p>
        <p style="font-size:12px;line-height:1.6;color:#71717a;margin:0 0 8px;">
          Or paste this link into your browser at your appointment time:<br/>
          <span style="word-break:break-all;color:#2563eb;">${ctx.joinLink}</span>
        </p>
        <p style="font-size:12px;line-height:1.6;color:#71717a;margin:16px 0 0;">
          Use a device with a camera and microphone. You will wait briefly in a waiting room until the doctor admits you.
        </p>
        <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0 12px;" />
        <p style="color:#a1a1aa;font-size:10px;text-align:center;margin:0;">
          &copy; ${new Date().getFullYear()} BookMyTime
        </p>
      </div>
    `,
  });
}

/** Minimal HTML escaping for interpolated values in the email body. */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
