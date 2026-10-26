// ─────────────────────────────────────────────────────────────────────────────
// whatsapp-router.ts  (server-only)
//
// Central channel router for all patient WhatsApp messaging. Decides, per send,
// whether a message goes through the official Meta Cloud API (primary) or the
// WhatsApp Web fallback, logs the attempt in WaMessageLog, and NEVER throws.
//
// SEND MODE (text by default, template when mapped):
//   The official channel sends the same plain text as WhatsApp Web
//   (params.buildMessage()) via sendTextMessage UNLESS the Super Admin has
//   mapped the notify kind to an APPROVED UTILITY template and enabled it. In
//   that case resolveTemplatePlan() returns a plan and the official attempt
//   uses sendTemplateMessage, recording WaMessageLog.templateId while storing
//   the SAME AES-encrypted plain-text body (so the async Web fallback is
//   unchanged). With no enabled mapping the gate returns null and this path is
//   byte-identical to the text-only behaviour (templateId stays NULL).
//
// META 24-HOUR RULE:
//   Free-form text is only allowed within 24h of the recipient's last message
//   to the business number. Outside that window Meta USUALLY ACCEPTS the send
//   (returns a wamid) and reports error 131047 LATER, in a 'failed' status
//   webhook; the async Web fallback below then re-sends via WhatsApp Web if the
//   tenant's Web session is CONNECTED at that moment. A synchronous 131047 is
//   handled by the sync fallback. Expected, not a bug. Because delivery to
//   out-of-window patients depends on the status webhook, the webhook
//   handshake and the app secret must be verified BEFORE the Cloud config is
//   enabled (isEnabled), otherwise those notifications are silently dropped.
//
// EXACTLY ONE CHANNEL DELIVERS:
//   • Sync fallback (here): Web is tried only when the official send returned
//     no wamid (Meta error / transport error) or official was not attempted.
//   • A 2xx from Meta means "accepted", not "delivered". If Meta later reports
//     'failed' via the status webhook, runAsyncWebFallback (below, driven by
//     whatsapp-webhook.ts) sends the stored body via Web ONCE, guarded by an
//     atomic webFallbackAttempted claim and never after delivered/read.
//   • An accepted send returns delivered:true, so callers (e.g. reminder
//     dedupe flags) treat it as sent. If the later async fallback finds the Web
//     session down, that message is not retried. Known and accepted.
//
// STORED BODY (WaMessageLog.body):
//   Bodies can carry bearer credentials (video join links, /consult/<token>),
//   which video.server.ts deliberately stores only as hashes. So the body is
//   persisted ONLY for official rows that Meta accepted (the only rows that can
//   reach the async fallback), ONLY AES-256-GCM encrypted (wa-crypto,
//   WA_CLOUD_ENC_KEY; nothing is stored without a key), and it is NULLed once
//   the row can no longer fall back (fallback claim taken here; delivered/read
//   in the status webhook). Web and failed-official rows never store a body.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { execute } from "./db";
import {
  isCloudAvailable,
  normalizeWaPhone,
  sendTemplateMessage,
  sendTextMessage,
} from "./whatsapp-cloud";
import { isWhatsAppReady, type AptNotifyKind, type AptNotifyContext } from "./appointment-notify";
import { enqueueWA } from "./whatsapp";
import { decryptSecret, encryptSecret, isEncKeyConfigured } from "./wa-crypto";

/** WaMessageLog.body is capped at Meta's text limit. */
const MAX_LOGGED_BODY = 4096;

/**
 * Encrypts an accepted official body for the async Web fallback. Returns null
 * (store nothing) when no encryption key is configured or encryption fails, so
 * a plaintext body is never persisted.
 */
function sealBody(body: string): string | null {
  if (typeof body !== "string" || body === "" || !isEncKeyConfigured()) return null;
  try {
    return encryptSecret(body.slice(0, MAX_LOGGED_BODY));
  } catch {
    return null;
  }
}

/** Decrypts a body sealed by {@link sealBody}; null when unreadable. */
function openBody(sealed: string): string | null {
  try {
    const body = decryptSecret(sealed);
    return body !== "" ? body : null;
  } catch {
    return null;
  }
}

/**
 * Pure routing decision: 'official' when the Cloud API is available, else
 * 'web'. Applies to every notify kind.
 */
export function decideRoute(
  _notifyKind: AptNotifyKind,
  config: { available: boolean },
): "official" | "web" {
  return config.available ? "official" : "web";
}

export interface SendPatientMessageParams {
  tenantId: string;
  appointmentId?: string;
  notifyKind: AptNotifyKind;
  recipientPhone: string | null | undefined;
  ctx: AptNotifyContext;
  buildMessage: () => string;
  /** Force the Web channel (explicit caller override). */
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

    const recipient = normalizeWaPhone(params.recipientPhone);
    const body = params.buildMessage();
    const available = params.cloudAvailable ?? (await isCloudAvailable());

    const route = params.channel === "web" ? "web" : decideRoute(params.notifyKind, { available });

    // Resolve a template plan only on the official route. The gate returns null
    // unless every gate passes (Cloud enabled, enabled+opt-in mapping, APPROVED
    // UTILITY template, all variables resolvable); null ⇒ the byte-identical
    // text path (templateId stays NULL — the original-incident invariant).
    let plan: Awaited<ReturnType<typeof import("./wa-template-notify").resolveTemplatePlan>> = null;
    if (route === "official") {
      try {
        const { resolveTemplatePlan } = await import("./wa-template-notify");
        plan = await resolveTemplatePlan(params.notifyKind, {
          ...params.ctx,
          recipientPhone: params.recipientPhone,
        });
      } catch {
        plan = null; // any gate error → text path
      }
    }

    // Insert the provisional log row. templateId is NULL unless a plan resolved;
    // no body here — it is stored, encrypted, only once Meta accepts the send.
    logId = crypto.randomUUID();
    if (plan) {
      await execute(
        `INSERT INTO WaMessageLog
           (id, tenantId, direction, recipient, kind, templateId, channel, status, officialAttempted, createdAt)
         VALUES (?, ?, 'out', ?, ?, ?, ?, 'queued', 0, NOW())`,
        [logId, params.tenantId, recipient, params.notifyKind, plan.templateId, route],
      );
    } else {
      await execute(
        `INSERT INTO WaMessageLog
           (id, tenantId, direction, recipient, kind, templateId, channel, status, officialAttempted, createdAt)
         VALUES (?, ?, 'out', ?, ?, NULL, ?, 'queued', 0, NOW())`,
        [logId, params.tenantId, recipient, params.notifyKind, route],
      );
    }

    // ── Official attempt ──
    if (route === "official") {
      await execute("UPDATE WaMessageLog SET officialAttempted = 1 WHERE id = ?", [logId]);
      // When a plan resolved, send the approved template; otherwise send the
      // same plain text as before. Either way the SAME plain-text body is
      // sealed for the async Web fallback (DP-05).
      const result = plan
        ? await sendTemplateMessage({
            to: recipient,
            templateName: plan.templateName,
            language: plan.language,
            parameterFormat: plan.parameterFormat,
            bodyParams: plan.bodyParams,
            headerParams: plan.headerParams,
            urlButtons: plan.urlButtons,
          })
        : await sendTextMessage({ to: recipient, body });
      if (result.ok) {
        // The wamid and the sealed body land in one UPDATE, so a 'failed'
        // status that finds the wamid also finds the body.
        await execute(
          `UPDATE WaMessageLog
              SET channel = 'official', status = 'sent', officialStatus = 'sent',
                  metaMessageId = ?, body = ?, updatedAt = NOW()
            WHERE id = ?`,
          [result.messageId, sealBody(body), logId],
        );
        return { delivered: true, channel: "official", logId };
      }
      // Record the official failure (a synchronous 131047 outside the 24h
      // window, another Meta error, or transport), then fall through to web.
      const errCode = result.kind === "meta_error" ? result.code : "transport";
      console.warn(
        `[WaRouter] Official Cloud API send failed for ${params.notifyKind} (tenant: ${params.tenantId}): ` +
          `${result.kind === "meta_error" ? `Meta error ${result.code}` : "transport error"} — ${result.message}`,
      );
      await execute(
        `UPDATE WaMessageLog
            SET officialStatus = 'failed', officialErrorCode = ?, officialErrorMessage = ?,
                errorCode = ?, errorMessage = ?, updatedAt = NOW()
          WHERE id = ?`,
        [errCode, result.message, errCode, result.message, logId],
      );
    }

    // ── Web attempt (route 'web', or official failed) ──
    // Web gets the ORIGINAL phone so its behavior is unchanged.
    if (await isWhatsAppReady(params.tenantId)) {
      await enqueueWA(params.tenantId, params.recipientPhone, body);
      await execute(
        "UPDATE WaMessageLog SET channel = 'web', status = 'sent', updatedAt = NOW() WHERE id = ?",
        [logId],
      );
      return { delivered: true, channel: "web", logId };
    }

    await execute("UPDATE WaMessageLog SET status = 'failed', updatedAt = NOW() WHERE id = ?", [
      logId,
    ]);
    console.error(
      `[WaRouter] Both channels failed for ${params.notifyKind} (tenant: ${params.tenantId}): ` +
        `Cloud unavailable or failed, WhatsApp Web not connected. Log ID: ${logId}`,
    );
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

// ── Async Web fallback (Meta 'failed' status webhook) ────────────────────────

/** Statuses after which the patient already has the message: never re-send. */
const RECEIVED_STATUSES = ["delivered", "read"];

/**
 * Pure eligibility check for the async Web fallback. `row` is the WaMessageLog
 * row read BEFORE the 'failed' status is applied. True only for an outbound
 * official tenant send (not an auto-reply) that has a stored (encrypted) body,
 * has not been claimed yet, and was never reported delivered/read.
 */
export function isAsyncFallbackEligible(row: any): boolean {
  if (!row) return false;
  if (row.direction !== "out") return false;
  if (row.channel !== "official") return false;
  if (row.kind === "autoReply") return false;
  const tenantId = row.tenantId != null ? String(row.tenantId) : "";
  if (tenantId === "" || tenantId === "global") return false;
  if (typeof row.body !== "string" || row.body === "") return false;
  if (Number(row.webFallbackAttempted) !== 0) return false;
  if (RECEIVED_STATUSES.includes(String(row.officialStatus ?? ""))) return false;
  return true;
}

export type AsyncWebFallbackOutcome = "fell_back" | "skipped" | "web_unavailable" | "error";

/**
 * Sends a previously official-accepted message via WhatsApp Web after Meta
 * reported it 'failed'. Runs at most once per row: the atomic
 * webFallbackAttempted claim (affectedRows === 1) wins exactly once even if the
 * webhook is re-delivered or processed concurrently. The claim also NULLs the
 * stored body (it is never needed again); `row.body` is the encrypted value
 * read before the claim and is decrypted only here. Never throws.
 */
export async function runAsyncWebFallback(row: {
  id: string;
  tenantId: string;
  recipient: string;
  body: string;
}): Promise<AsyncWebFallbackOutcome> {
  try {
    const claim = await execute(
      `UPDATE WaMessageLog
          SET webFallbackAttempted = 1, body = NULL, updatedAt = NOW()
        WHERE id = ? AND webFallbackAttempted = 0 AND channel = 'official'
          AND direction = 'out' AND kind <> 'autoReply'`,
      [row.id],
    );
    if (!claim || claim.affectedRows !== 1) return "skipped";

    const body = openBody(row.body);
    if (!body) {
      console.error("[WaRouter] async web fallback: stored body unreadable");
      return "error";
    }

    // Status stays 'failed' (already written by the status UPDATE).
    if (!(await isWhatsAppReady(row.tenantId))) return "web_unavailable";

    await enqueueWA(row.tenantId, row.recipient, body);
    // officialStatus / officialError* stay untouched so monitoring still shows
    // the official failure.
    await execute(
      "UPDATE WaMessageLog SET channel = 'web', status = 'sent', updatedAt = NOW() WHERE id = ?",
      [row.id],
    );
    return "fell_back";
  } catch (err: any) {
    console.error("[WaRouter] async web fallback failed:", err?.message);
    return "error";
  }
}
