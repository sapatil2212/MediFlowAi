// ─────────────────────────────────────────────────────────────────────────────
// wa-auto-reply.ts  (server-only)
//
// Inbound auto-reply for the shared BookMyTime WhatsApp Cloud number. Every
// tenant sends through the same official number, so when a patient/customer
// replies we look up which business's message they are answering (the quoted
// wamid when present, else the latest message that went out from the shared
// number) and answer once with that business's name and contact.
//
// Imported ONLY by whatsapp-webhook.ts. Never wrapped in createServerFn and
// never reachable from a client-callable endpoint (getBusinessContact reads
// tenant contact data). Never logs secrets or message bodies.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { execute, queryOne } from "./db";
import {
  isCloudAvailable,
  isOfficialRecipientAllowed,
  normalizeWaPhone,
  sendTextMessage,
} from "./whatsapp-cloud";

/** Inbound message types that get an auto-reply. Everything else is skipped. */
export const AUTO_REPLY_TYPES = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
  "button",
  "interactive",
] as const;

/** At most one auto-reply per sender phone within this window. */
export const AUTO_REPLY_COOLDOWN_HOURS = 6;

const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 32;

/** Senders with an auto-reply currently being dispatched (single process). */
const inFlight = new Set<string>();

/**
 * Pure eligibility check. True only for an allowlisted user message type from
 * a sender that isn't our own business number.
 */
export function shouldAutoReply(e: {
  msgType: string;
  from: string;
  displayPhone: string | null;
}): boolean {
  if (!(AUTO_REPLY_TYPES as readonly string[]).includes(String(e.msgType || ""))) return false;
  const from = normalizeWaPhone(e.from);
  if (!from) return false;
  if (e.displayPhone && from === normalizeWaPhone(e.displayPhone)) return false;
  return true;
}

/**
 * Candidate recipient values for a sender. Rows logged before text mode stored
 * the phone with only a leading '+' stripped, so a "91" + 10-digit number also
 * matches its bare 10-digit national form.
 */
function recipientCandidates(from: string): string[] {
  const phone = normalizeWaPhone(from);
  if (!phone) return [];
  if (phone.length === 12 && phone.startsWith("91")) return [phone, phone.slice(2)];
  return [phone];
}

function tenantOf(row: any): string | null {
  const tenantId = row?.tenantId != null ? String(row.tenantId) : "";
  return tenantId !== "" ? tenantId : null;
}

/**
 * Resolves the tenant whose message this sender is answering, in order:
 *   1. `contextId` (messages[].context.id on a swipe-reply): the outbound row
 *      with that exact wamid, sent to this sender.
 *   2. The newest outbound row that actually left the shared number: channel
 *      'official' with a wamid and not reported failed. Rows delivered from a
 *      tenant's own Web number, or never delivered, are skipped, so a later
 *      Web message from another business can't take over the attribution.
 *   3. Only when neither exists: the newest real-tenant outbound row of any
 *      channel (the sender never got a message from the shared number).
 * Returns null when nothing matches or on any DB error.
 */
export async function resolveInboundTenant(
  from: string,
  contextId?: string | null,
): Promise<string | null> {
  const candidates = recipientCandidates(from);
  if (candidates.length === 0) return null;
  try {
    const placeholders = candidates.map(() => "?").join(", ");

    if (contextId) {
      const quoted = await queryOne<any>(
        `SELECT tenantId FROM WaMessageLog
          WHERE direction = 'out' AND metaMessageId = ? AND recipient IN (${placeholders})
            AND tenantId <> 'global' AND tenantId <> ''
          LIMIT 1`,
        [contextId, ...candidates],
      );
      const quotedTenant = tenantOf(quoted);
      if (quotedTenant) return quotedTenant;
    }

    const official = await queryOne<any>(
      `SELECT tenantId FROM WaMessageLog
        WHERE direction = 'out' AND recipient IN (${placeholders})
          AND channel = 'official' AND metaMessageId IS NOT NULL
          AND (officialStatus IS NULL OR officialStatus <> 'failed')
          AND tenantId <> 'global' AND tenantId <> ''
        ORDER BY createdAt DESC
        LIMIT 1`,
      candidates,
    );
    const officialTenant = tenantOf(official);
    if (officialTenant) return officialTenant;

    const any = await queryOne<any>(
      `SELECT tenantId FROM WaMessageLog
        WHERE direction = 'out' AND recipient IN (${placeholders})
          AND tenantId <> 'global' AND tenantId <> ''
        ORDER BY createdAt DESC
        LIMIT 1`,
      candidates,
    );
    return tenantOf(any);
  } catch (err: any) {
    console.error("[WaAutoReply] tenant resolution failed:", err?.message);
    return null;
  }
}

function clean(value: unknown, max: number): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s.slice(0, max);
}

function firstNonBlank(values: unknown[], max: number): string | null {
  for (const v of values) {
    const s = clean(v, max);
    if (s) return s;
  }
  return null;
}

/**
 * Business display name + contact number for any vertical. ClinicProfile is
 * the shared business profile for every vertical (restaurants map
 * restaurantName ↔ clinicName); the User registration row is the fallback when
 * no profile exists yet. Phone priority: WhatsApp no., contact no., profile
 * phone, registration phone. Server-only; nulls on missing data or DB errors.
 */
export async function getBusinessContact(
  tenantId: string,
): Promise<{ name: string | null; phone: string | null }> {
  if (!tenantId) return { name: null, phone: null };

  let profile: any = null;
  try {
    profile = await queryOne<any>(
      "SELECT clinicName, whatsappNo, contactNo, phone FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [tenantId],
    );
  } catch (err: any) {
    console.error("[WaAutoReply] business profile lookup failed:", err?.message);
    profile = null;
  }

  let name = clean(profile?.clinicName, MAX_NAME_LENGTH);
  let phone = firstNonBlank(
    [profile?.whatsappNo, profile?.contactNo, profile?.phone],
    MAX_PHONE_LENGTH,
  );

  if (!name || !phone) {
    try {
      const user = await queryOne<any>(
        "SELECT clinicName, phone FROM User WHERE tenantId = ? LIMIT 1",
        [tenantId],
      );
      name = name || clean(user?.clinicName, MAX_NAME_LENGTH);
      phone = phone || clean(user?.phone, MAX_PHONE_LENGTH);
    } catch (err: any) {
      console.error("[WaAutoReply] registration lookup failed:", err?.message);
    }
  }

  return { name, phone };
}

const GENERIC_REPLY =
  "This is an automated BookMyTime notification number and cannot receive replies. Please contact the business you booked with directly.";

/**
 * Builds the auto-reply text. Every inbound message gets the same generic
 * notification-only reply — we intentionally do NOT disclose the business name
 * or contact number on the shared number. The `contact` argument is kept for
 * call-site compatibility but is not used.
 */
export function buildAutoReplyText(
  _contact?: { name: string | null; phone: string | null } | null,
): string {
  return GENERIC_REPLY;
}

export type AutoReplyOutcome = "sent" | "skipped" | "failed";

/**
 * Sends ONE auto-reply to an inbound sender, at most once per sender per
 * AUTO_REPLY_COOLDOWN_HOURS. The log row is inserted as 'queued' BEFORE the
 * Graph call so concurrent checks see it. Never throws.
 */
export async function dispatchAutoReply(args: {
  from: string;
  tenantId: string | null;
}): Promise<AutoReplyOutcome> {
  let phone = "";
  let claimed = false;
  try {
    if (!(await isCloudAvailable())) return "skipped";
    phone = normalizeWaPhone(args.from);
    if (!phone) return "skipped";
    // Local test mode: only auto-reply to allowlisted numbers (see whatsapp-cloud.ts).
    if (!isOfficialRecipientAllowed(phone)) return "skipped";

    if (inFlight.has(phone)) return "skipped";
    inFlight.add(phone);
    claimed = true;

    const recent = await queryOne<any>(
      `SELECT id FROM WaMessageLog
        WHERE direction = 'out' AND kind = 'autoReply' AND recipient = ?
          AND status <> 'failed'
          AND createdAt > DATE_SUB(NOW(), INTERVAL ${AUTO_REPLY_COOLDOWN_HOURS} HOUR)
        LIMIT 1`,
      [phone],
    );
    if (recent) return "skipped";

    // Every inbound message gets the same generic notification-only reply;
    // the business name/contact are intentionally not disclosed here.
    const text = buildAutoReplyText();

    const logId = crypto.randomUUID();
    await execute(
      `INSERT INTO WaMessageLog
         (id, tenantId, direction, recipient, kind, channel, status, officialAttempted, body, createdAt)
       VALUES (?, ?, 'out', ?, 'autoReply', 'official', 'queued', 1, ?, NOW())`,
      [logId, args.tenantId || "global", phone, text],
    );

    const result = await sendTextMessage({ to: phone, body: text });
    if (result.ok) {
      await execute(
        `UPDATE WaMessageLog
            SET status = 'sent', officialStatus = 'sent', metaMessageId = ?, updatedAt = NOW()
          WHERE id = ?`,
        [result.messageId, logId],
      );
      return "sent";
    }

    const errCode = result.kind === "meta_error" ? result.code : "transport";
    await execute(
      `UPDATE WaMessageLog
          SET status = 'failed', officialStatus = 'failed',
              officialErrorCode = ?, officialErrorMessage = ?,
              errorCode = ?, errorMessage = ?, updatedAt = NOW()
        WHERE id = ?`,
      [errCode, result.message, errCode, result.message, logId],
    );
    return "failed";
  } catch (err: any) {
    console.error("[WaAutoReply] dispatch failed:", err?.message);
    return "failed";
  } finally {
    if (claimed) inFlight.delete(phone);
  }
}
