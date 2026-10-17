// ─────────────────────────────────────────────────────────────────────────────
// whatsapp-router.ts  (server-only)
//
// Central channel router for all patient WhatsApp messaging. Decides, per send,
// whether a message goes through the official Meta Cloud API (primary) or the
// WhatsApp Web fallback, logs the attempt in WaMessageLog, and NEVER throws.
//
// HIGH-1 — VIDEO-LINK EXCLUSION:
//   videoLinkIssued and videoLinkReissued are FORCED to WhatsApp Web, always,
//   regardless of config. A video join link is a fresh per-send URL that cannot
//   be expressed as a Meta template body variable, so these kinds never route
//   official and can never be mapped to an approved template. decideRoute
//   returns 'web' for them unconditionally.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { execute, queryOne } from "./db";
import { isCloudAvailable, sendTemplateMessage } from "./whatsapp-cloud";
import {
  buildTemplateVars,
  isWhatsAppReady,
  type AptNotifyKind,
  type AptNotifyContext,
} from "./appointment-notify";
import { enqueueWA } from "./whatsapp";

export const VIDEO_LINK_KINDS = ["videoLinkIssued", "videoLinkReissued"] as const;

function isVideoKind(kind: AptNotifyKind): boolean {
  return (VIDEO_LINK_KINDS as readonly string[]).includes(kind);
}

/**
 * Pure routing decision. Returns 'web' UNCONDITIONALLY for the video kinds
 * (HIGH-1). Otherwise returns 'official' only when the Cloud API is available
 * AND an approved template exists for the kind; else 'web'.
 */
export function decideRoute(
  notifyKind: AptNotifyKind,
  config: { available: boolean; approvedTemplate: boolean },
): "official" | "web" {
  if (isVideoKind(notifyKind)) return "web";
  return config.available && config.approvedTemplate ? "official" : "web";
}

interface ApprovedTemplate {
  id: string;
  name: string;
  language: string;
  headerType: string | null;
  headerImageUrl: string | null;
}

/** Resolves the most-recent APPROVED template mapped to a notify kind, or null. */
async function resolveApprovedTemplate(
  notifyKind: AptNotifyKind,
): Promise<ApprovedTemplate | null> {
  try {
    const row = await queryOne<any>(
      `SELECT id, name, language, headerType, headerImageUrl
         FROM WaCloudTemplate
        WHERE notifyKind = ? AND status = 'APPROVED'
        ORDER BY updatedAt DESC
        LIMIT 1`,
      [notifyKind],
    );
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      language: String(row.language),
      headerType: row.headerType ?? null,
      headerImageUrl: row.headerImageUrl ?? null,
    };
  } catch {
    return null;
  }
}

/** Trims whitespace and a leading '+' for the recipient column. */
function normalizeRecipient(phone: string): string {
  return phone.trim().replace(/^\+/, "");
}

export interface SendPatientMessageParams {
  tenantId: string;
  appointmentId?: string;
  notifyKind: AptNotifyKind;
  recipientPhone: string | null | undefined;
  ctx: AptNotifyContext;
  buildMessage: () => string;
  /** Force the Web channel (e.g. reminders carrying a fresh video join link). */
  channel?: "web";
  /** Pre-computed cloud availability (cached once per scheduler cycle). */
  cloudAvailable?: boolean;
}

export interface SendPatientMessageResult {
  delivered: boolean;
  channel: "official" | "web" | null;
  logId: string;
  error?: string;
}

/**
 * Sends a patient message through the official Cloud API when possible, falling
 * back to WhatsApp Web. Logs exactly one WaMessageLog row per call and never
 * throws. At most ONE channel delivers per call.
 */
export async function sendPatientMessage(
  params: SendPatientMessageParams,
): Promise<SendPatientMessageResult> {
  let logId = "";
  try {
    if (!params.recipientPhone) {
      return { delivered: false, channel: null, logId: "" };
    }

    const recipient = normalizeRecipient(params.recipientPhone);
    const tpl = await resolveApprovedTemplate(params.notifyKind);
    const available = params.cloudAvailable ?? (await isCloudAvailable());

    const route =
      params.channel === "web"
        ? "web"
        : decideRoute(params.notifyKind, { available, approvedTemplate: !!tpl });

    // Insert the provisional log row.
    logId = crypto.randomUUID();
    await execute(
      `INSERT INTO WaMessageLog
         (id, tenantId, direction, recipient, kind, templateId, channel, status, officialAttempted, createdAt)
       VALUES (?, ?, 'out', ?, ?, ?, ?, 'queued', 0, NOW())`,
      [logId, params.tenantId, recipient, params.notifyKind, tpl?.id ?? null, route],
    );

    // ── Official attempt ──
    if (route === "official" && tpl) {
      await execute("UPDATE WaMessageLog SET officialAttempted = 1 WHERE id = ?", [logId]);
      const result = await sendTemplateMessage({
        to: recipient,
        templateName: tpl.name,
        language: tpl.language,
        bodyParams: buildTemplateVars(params.notifyKind, params.ctx),
        headerImageUrl: tpl.headerImageUrl,
      });
      if (result.ok) {
        await execute(
          `UPDATE WaMessageLog
              SET channel = 'official', status = 'sent', officialStatus = 'sent',
                  metaMessageId = ?, updatedAt = NOW()
            WHERE id = ?`,
          [result.messageId, logId],
        );
        return { delivered: true, channel: "official", logId };
      }
      // Record the official failure, then fall through to web.
      const errCode = result.kind === "meta_error" ? result.code : "transport";
      await execute(
        `UPDATE WaMessageLog
            SET officialStatus = 'failed', officialErrorCode = ?, officialErrorMessage = ?,
                errorCode = ?, errorMessage = ?, updatedAt = NOW()
          WHERE id = ?`,
        [errCode, result.message, errCode, result.message, logId],
      );
    }

    // ── Web attempt (route 'web', or official failed) ──
    if (await isWhatsAppReady(params.tenantId)) {
      await enqueueWA(params.tenantId, params.recipientPhone, params.buildMessage());
      await execute(
        "UPDATE WaMessageLog SET channel = 'web', status = 'sent', updatedAt = NOW() WHERE id = ?",
        [logId],
      );
      return { delivered: true, channel: "web", logId };
    }

    await execute("UPDATE WaMessageLog SET status = 'failed', updatedAt = NOW() WHERE id = ?", [
      logId,
    ]);
    return {
      delivered: false,
      channel: null,
      logId,
      error: "WhatsApp Web not connected and official channel unavailable",
    };
  } catch (err: any) {
    if (logId) {
      await execute("UPDATE WaMessageLog SET status = 'failed', updatedAt = NOW() WHERE id = ?", [
        logId,
      ]).catch(() => {});
    }
    return { delivered: false, channel: null, logId: logId || "", error: err?.message };
  }
}
