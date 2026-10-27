// ─────────────────────────────────────────────────────────────────────────────
// whatsapp-router.ts  (server-only)
//
// Official Meta WhatsApp Cloud API router for outbound patient notifications.
// Every business-initiated notification is template-only: a mapped, enabled,
// approved UTILITY template is required, and neither free-form Cloud text nor
// whatsapp-web.js is used as a fallback. Meta acceptance is not delivery; final
// delivered/read/failed state is applied by the signed status webhook.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { execute } from "./db";
import { isCloudAvailable, normalizeWaPhone, sendTemplateMessage } from "./whatsapp-cloud";
import type { AptNotifyKind, AptNotifyContext } from "./appointment-notify";
import type {
  TemplateNotReadyReason,
  TemplatePlan,
  TemplatePlanResolution,
} from "./wa-template-notify";

const MAX_DIAGNOSTIC_TEXT = 300;
const TEMPLATE_NOT_READY_CODE = "template_not_ready";
const TEMPLATE_GATE_ERROR_CODE = "template_gate_error";
const TEMPLATE_GATE_ERROR_MESSAGE =
  "WhatsApp template readiness check failed because of an internal error; inspect server and database health, then retry.";
const NOTIFICATION_INTERNAL_ERROR_CODE = "notification_internal_error";
const NOTIFICATION_INTERNAL_ERROR_MESSAGE =
  "WhatsApp notification failed because of an internal error; inspect server and database health, then retry.";

function templateNotReadyMessage(kind: AptNotifyKind, reason: TemplateNotReadyReason): string {
  return `No approved WhatsApp utility template is ready for ${kind} (reason=${reason}); sync templates, verify account/status/category, assign the mapping, acknowledge opt-in, enable it, and ensure all required values resolve.`;
}

function redactDiagnosticText(text: string, sensitiveValues: unknown[]): string {
  let safe = String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bEAA[A-Za-z0-9_-]{12,}\b/g, "[redacted]");
  for (const value of sensitiveValues) {
    const raw = value == null ? "" : String(value).trim();
    if (raw.length === 0) continue;
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    safe = safe.replace(new RegExp(escaped, "gi"), "[redacted]");
  }
  return safe.slice(0, MAX_DIAGNOSTIC_TEXT);
}

export interface SendPatientMessageParams {
  tenantId: string;
  appointmentId?: string;
  notifyKind: AptNotifyKind;
  recipientPhone: string | null | undefined;
  ctx: AptNotifyContext;
  /** Pre-computed Cloud availability (cached once per scheduler cycle). */
  cloudAvailable?: boolean;
}

export interface SendPatientMessageResult {
  /** True only when Meta accepted the template request. */
  delivered: boolean;
  /** Acceptance is distinct from webhook-confirmed delivery. */
  deliveryStatus: "accepted" | "failed";
  channel: "official" | null;
  logId: string;
  error?: string;
}

async function insertLog(
  logId: string,
  params: SendPatientMessageParams,
  recipient: string,
  plan: TemplatePlan | null,
): Promise<void> {
  if (plan) {
    await execute(
      `INSERT INTO WaMessageLog
         (id, tenantId, direction, recipient, kind, templateId, channel, status, officialAttempted, createdAt)
       VALUES (?, ?, 'out', ?, ?, ?, 'official', 'queued', 0, NOW())`,
      [logId, params.tenantId, recipient, params.notifyKind, plan.templateId],
    );
    return;
  }
  await execute(
    `INSERT INTO WaMessageLog
       (id, tenantId, direction, recipient, kind, templateId, channel, status, officialAttempted, createdAt)
     VALUES (?, ?, 'out', ?, ?, NULL, 'official', 'queued', 0, NOW())`,
    [logId, params.tenantId, recipient, params.notifyKind],
  );
}

async function recordGateFailure(
  logId: string,
  errorCode: string,
  errorMessage: string,
): Promise<SendPatientMessageResult> {
  console.error(`[WaRouter] Notification template send blocked code=${errorCode}: ${errorMessage}`);
  await execute(
    `UPDATE WaMessageLog
        SET status = 'failed', errorCode = ?, errorMessage = ?, updatedAt = NOW()
      WHERE id = ?`,
    [errorCode, errorMessage, logId],
  );
  return {
    delivered: false,
    deliveryStatus: "failed",
    channel: null,
    logId,
    error: errorMessage,
  };
}

/**
 * Submits one approved template through Meta Cloud API. The promise always
 * settles and is safe to await after appointment persistence.
 */
export async function sendPatientMessage(
  params: SendPatientMessageParams,
): Promise<SendPatientMessageResult> {
  let logId = "";
  try {
    if (!params.recipientPhone) {
      return {
        delivered: false,
        deliveryStatus: "failed",
        channel: null,
        logId: "",
        error: "Recipient phone number is missing.",
      };
    }

    const recipient = normalizeWaPhone(params.recipientPhone);
    let resolution: TemplatePlanResolution;
    try {
      const available = params.cloudAvailable ?? (await isCloudAvailable());
      const { resolveTemplatePlanResult } = await import("./wa-template-notify");
      resolution = await resolveTemplatePlanResult(
        params.notifyKind,
        { ...params.ctx, recipientPhone: params.recipientPhone },
        { cloudAvailable: available },
      );
    } catch {
      logId = crypto.randomUUID();
      await insertLog(logId, params, recipient, null);
      return await recordGateFailure(logId, TEMPLATE_GATE_ERROR_CODE, TEMPLATE_GATE_ERROR_MESSAGE);
    }

    const plan = resolution.status === "ready" ? resolution.plan : null;
    logId = crypto.randomUUID();
    await insertLog(logId, params, recipient, plan);

    if (resolution.status === "not_ready") {
      return await recordGateFailure(
        logId,
        TEMPLATE_NOT_READY_CODE,
        templateNotReadyMessage(params.notifyKind, resolution.reason),
      );
    }

    await execute("UPDATE WaMessageLog SET officialAttempted = 1 WHERE id = ?", [logId]);
    const result = await sendTemplateMessage({
      to: recipient,
      templateName: plan.templateName,
      language: plan.language,
      parameterFormat: plan.parameterFormat,
      bodyParams: plan.bodyParams,
      headerParams: plan.headerParams,
      urlButtons: plan.urlButtons,
    });

    if (result.ok) {
      await execute(
        `UPDATE WaMessageLog
            SET channel = 'official', status = 'sent', officialStatus = 'sent',
                metaMessageId = ?, body = NULL, updatedAt = NOW()
          WHERE id = ?`,
        [result.messageId, logId],
      );
      return {
        delivered: true,
        deliveryStatus: "accepted",
        channel: "official",
        logId,
      };
    }

    const errCode = result.kind === "meta_error" ? result.code : "transport";
    const safeMessage = redactDiagnosticText(result.message, [
      params.recipientPhone,
      recipient,
      params.ctx.name,
      params.ctx.clinicName,
      params.ctx.doctorName,
      params.ctx.appointmentId,
      params.ctx.joinLink,
      params.ctx.tableName,
      ...(plan.bodyParams.map((parameter) => parameter.text) ?? []),
      ...(plan.headerParams.map((parameter) => parameter.text) ?? []),
      ...(plan.urlButtons.map((button) => button.suffix) ?? []),
    ]);
    const safeDiagnostic =
      result.kind === "meta_error"
        ? `http_status=${result.httpStatus} code=${result.code}` +
          (result.subcode ? ` subcode=${result.subcode}` : "") +
          ` message=${JSON.stringify(safeMessage)}` +
          (result.fbtraceId ? ` fbtrace_id=${result.fbtraceId}` : "")
        : `http_status=${result.httpStatus ?? "n/a"} kind=transport message=${JSON.stringify(safeMessage)}`;
    console.warn(
      `[WaRouter] Official Cloud API template send failed kind=${params.notifyKind} ${safeDiagnostic}`,
    );
    await execute(
      `UPDATE WaMessageLog
          SET channel = 'official', status = 'failed', officialStatus = 'failed',
              officialErrorCode = ?, officialErrorMessage = ?,
              errorCode = ?, errorMessage = ?, updatedAt = NOW()
        WHERE id = ?`,
      [errCode, safeMessage, errCode, safeMessage, logId],
    );
    return {
      delivered: false,
      deliveryStatus: "failed",
      channel: "official",
      logId,
      error: safeMessage,
    };
  } catch {
    if (logId) {
      await execute(
        `UPDATE WaMessageLog
            SET status = 'failed', errorCode = ?, errorMessage = ?, updatedAt = NOW()
          WHERE id = ?`,
        [NOTIFICATION_INTERNAL_ERROR_CODE, NOTIFICATION_INTERNAL_ERROR_MESSAGE, logId],
      ).catch(() => {});
    }
    console.error(
      `[WaRouter] Notification send failed code=${NOTIFICATION_INTERNAL_ERROR_CODE}: ${NOTIFICATION_INTERNAL_ERROR_MESSAGE}`,
    );
    return {
      delivered: false,
      deliveryStatus: "failed",
      channel: null,
      logId,
      error: NOTIFICATION_INTERNAL_ERROR_MESSAGE,
    };
  }
}
