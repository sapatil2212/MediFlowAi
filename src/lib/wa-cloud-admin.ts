// ─────────────────────────────────────────────────────────────────────────────
// wa-cloud-admin.ts  (server-only)
//
// Handler logic for the Super-Admin WhatsApp Cloud API console. The
// createServerFn wrappers live in admin.ts (the client-imported surface) and
// gate every call on verifyAdminSession(). This module holds NO wrappers so it
// stays a plain server module.
//
// Secrets (accessToken, appSecret) are AES-256-GCM encrypted at rest and NEVER
// returned to the client — only masked `••••last4` indicators are surfaced.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { query, queryOne, execute } from "./db";
import { encryptSecret, isEncKeyConfigured, last4 } from "./wa-crypto";
import {
  resolveCloudConfig,
  sendTestTemplate,
  submitTemplate,
  syncTemplateStatus,
} from "./whatsapp-cloud";
import {
  countBodyPlaceholders,
  expectedVarCount,
  TEMPLATE_VAR_SPEC,
  type AptNotifyKind,
} from "./appointment-notify";

// HIGH-1: video kinds are forced to WhatsApp Web always and may never be mapped
// to an official template.
const VIDEO_KINDS = ["videoLinkIssued", "videoLinkReissued"];
const VALID_CATEGORIES = ["UTILITY", "MARKETING", "AUTHENTICATION"];

// ── Config ───────────────────────────────────────────────────────────────────

/** Returns the masked central config (never the ciphertext/plaintext). */
export async function getWaCloudConfig() {
  const row = await queryOne<any>("SELECT * FROM WaCloudConfig WHERE id = 'central' LIMIT 1");
  const resolved = await resolveCloudConfig();
  return {
    phoneNumberId: row?.phoneNumberId ?? resolved?.phoneNumberId ?? null,
    wabaId: row?.wabaId ?? resolved?.wabaId ?? null,
    apiVersion: row?.apiVersion ?? resolved?.apiVersion ?? "v20.0",
    isEnabled: row ? Number(row.isEnabled) === 1 : false,
    tokenConfigured: !!(row?.accessTokenEnc || process.env.WA_CLOUD_ACCESS_TOKEN),
    tokenLast4: row?.tokenLast4 ?? null,
    appSecretConfigured: !!(row?.appSecretEnc || process.env.WA_CLOUD_APP_SECRET),
    appSecretLast4: row?.appSecretLast4 ?? null,
    verifyTokenConfigured: !!(row?.verifyToken || process.env.WA_CLOUD_VERIFY_TOKEN),
    encKeyConfigured: isEncKeyConfigured(),
    source: resolved?.source ?? "none",
  };
}

export interface SaveWaCloudConfigInput {
  phoneNumberId?: string;
  wabaId?: string;
  apiVersion?: string;
  verifyToken?: string;
  accessToken?: string;
  appSecret?: string;
  isEnabled?: boolean;
}

/** Validates + upserts the single central config row. */
export function validateSaveWaCloudConfig(data: SaveWaCloudConfigInput): SaveWaCloudConfigInput {
  if (data.apiVersion != null && data.apiVersion !== "" && !/^v\d+\.\d+$/.test(data.apiVersion)) {
    throw new Error("Invalid apiVersion (expected like v20.0)");
  }
  if (data.phoneNumberId != null && data.phoneNumberId !== "") {
    if (!/^\d{1,64}$/.test(data.phoneNumberId)) throw new Error("Invalid phoneNumberId");
  }
  if (data.wabaId != null && data.wabaId !== "") {
    if (!/^\d{1,64}$/.test(data.wabaId)) throw new Error("Invalid wabaId");
  }
  if (data.verifyToken != null && data.verifyToken.length > 255) {
    throw new Error("verifyToken too long");
  }
  if (data.isEnabled != null && typeof data.isEnabled !== "boolean") {
    throw new Error("isEnabled must be a boolean");
  }
  return data;
}

export async function saveWaCloudConfig(data: SaveWaCloudConfigInput): Promise<{ ok: true }> {
  const row = await queryOne<any>("SELECT * FROM WaCloudConfig WHERE id = 'central' LIMIT 1");

  // Encrypt secrets only when provided; require the enc key first.
  let accessTokenEnc: string | null = row?.accessTokenEnc ?? null;
  let tokenLast4: string | null = row?.tokenLast4 ?? null;
  let appSecretEnc: string | null = row?.appSecretEnc ?? null;
  let appSecretLast4: string | null = row?.appSecretLast4 ?? null;

  const hasNewToken = !!data.accessToken && data.accessToken.trim() !== "";
  const hasNewSecret = !!data.appSecret && data.appSecret.trim() !== "";
  if (hasNewToken || hasNewSecret) {
    if (!isEncKeyConfigured()) {
      throw new Error("Encryption key not configured");
    }
    if (hasNewToken) {
      accessTokenEnc = encryptSecret(data.accessToken!.trim());
      tokenLast4 = last4(data.accessToken!.trim());
    }
    if (hasNewSecret) {
      appSecretEnc = encryptSecret(data.appSecret!.trim());
      appSecretLast4 = last4(data.appSecret!.trim());
    }
  }

  const phoneNumberId = data.phoneNumberId ?? row?.phoneNumberId ?? null;
  const wabaId = data.wabaId ?? row?.wabaId ?? null;
  const apiVersion = data.apiVersion || row?.apiVersion || "v20.0";
  const verifyToken =
    data.verifyToken != null && data.verifyToken !== ""
      ? data.verifyToken
      : (row?.verifyToken ?? null);
  const isEnabled = data.isEnabled != null ? (data.isEnabled ? 1 : 0) : (row?.isEnabled ?? 0);

  if (row) {
    await execute(
      `UPDATE WaCloudConfig
          SET phoneNumberId = ?, wabaId = ?, apiVersion = ?, verifyToken = ?,
              accessTokenEnc = ?, appSecretEnc = ?, tokenLast4 = ?, appSecretLast4 = ?,
              isEnabled = ?, updatedAt = NOW()
        WHERE id = 'central'`,
      [
        phoneNumberId,
        wabaId,
        apiVersion,
        verifyToken,
        accessTokenEnc,
        appSecretEnc,
        tokenLast4,
        appSecretLast4,
        isEnabled,
      ],
    );
  } else {
    await execute(
      `INSERT INTO WaCloudConfig
         (id, phoneNumberId, wabaId, apiVersion, verifyToken, accessTokenEnc, appSecretEnc,
          tokenLast4, appSecretLast4, isEnabled, createdAt)
       VALUES ('central', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        phoneNumberId,
        wabaId,
        apiVersion,
        verifyToken,
        accessTokenEnc,
        appSecretEnc,
        tokenLast4,
        appSecretLast4,
        isEnabled,
      ],
    );
  }
  return { ok: true };
}

export async function testWaCloudConfig(data: {
  toPhone: string;
  templateName: string;
  language: string;
}): Promise<{ ok: boolean; code?: string; message?: string }> {
  const result = await sendTestTemplate(data.toPhone, data.templateName, data.language || "en_US");
  if (result.ok) return { ok: true };
  if (result.kind === "meta_error")
    return { ok: false, code: result.code, message: result.message };
  return { ok: false, message: result.message };
}

// ── Templates ─────────────────────────────────────────────────────────────────

export async function listWaCloudTemplates() {
  const rows = await query<any>(
    `SELECT id, name, language, category, bodyText, headerType, headerImageUrl,
            status, notifyKind, varCount, metaTemplateId, rejectionReason, updatedAt
       FROM WaCloudTemplate
      ORDER BY updatedAt DESC`,
  );
  return rows || [];
}

export interface SaveWaCloudTemplateInput {
  id?: string;
  name: string;
  language?: string;
  category?: string;
  bodyText: string;
  headerType?: string | null;
  headerImageUrl?: string | null;
  notifyKind?: string | null;
}

/** Validates a template save/submit payload. Throws on bad input (400-style). */
function validateTemplatePayload(data: SaveWaCloudTemplateInput): {
  notifyKind: AptNotifyKind | null;
  authoredCount: number;
} {
  if (!/^[a-z0-9_]{1,128}$/.test(data.name || "")) {
    throw new Error("Invalid template name (use a-z, 0-9, _ only; max 128)");
  }
  if (data.language != null && data.language.length > 16) {
    throw new Error("language too long");
  }
  const category = data.category || "UTILITY";
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error("Invalid category");
  }
  if (!data.bodyText || data.bodyText.length > 1024) {
    throw new Error("bodyText is required and must be <= 1024 chars");
  }

  const notifyKind = data.notifyKind ? (data.notifyKind as AptNotifyKind) : null;
  if (notifyKind) {
    // HIGH-1: video kinds may never be mapped to an official template.
    if (VIDEO_KINDS.includes(notifyKind)) {
      throw new Error(
        "Video-link notifications are always sent via WhatsApp Web and cannot use an official template",
      );
    }
    if (!(notifyKind in TEMPLATE_VAR_SPEC)) {
      throw new Error("Unknown notifyKind");
    }
    const authoredCount = countBodyPlaceholders(data.bodyText);
    const expected = expectedVarCount(notifyKind);
    if (authoredCount !== expected) {
      throw new Error(
        `Variable count mismatch: template body has ${authoredCount} placeholders but ${notifyKind} requires ${expected}`,
      );
    }
    return { notifyKind, authoredCount };
  }
  return { notifyKind: null, authoredCount: countBodyPlaceholders(data.bodyText) };
}

export async function saveWaCloudTemplate(
  data: SaveWaCloudTemplateInput,
): Promise<{ ok: true; id: string }> {
  const { notifyKind, authoredCount } = validateTemplatePayload(data);
  const language = data.language || "en_US";
  const category = data.category || "UTILITY";
  const id = data.id || crypto.randomUUID();
  const variables = notifyKind
    ? TEMPLATE_VAR_SPEC[notifyKind].map((f, i) => ({ index: i + 1, field: String(f) }))
    : [];

  const existing = data.id
    ? await queryOne<any>("SELECT id FROM WaCloudTemplate WHERE id = ? LIMIT 1", [data.id])
    : null;

  if (existing) {
    await execute(
      `UPDATE WaCloudTemplate
          SET name = ?, language = ?, category = ?, bodyText = ?, headerType = ?,
              headerImageUrl = ?, notifyKind = ?, varCount = ?, variables = ?, updatedAt = NOW()
        WHERE id = ?`,
      [
        data.name,
        language,
        category,
        data.bodyText,
        data.headerType ?? null,
        data.headerImageUrl ?? null,
        notifyKind,
        authoredCount,
        JSON.stringify(variables),
        id,
      ],
    );
  } else {
    await execute(
      `INSERT INTO WaCloudTemplate
         (id, name, language, category, bodyText, headerType, headerImageUrl, notifyKind,
          varCount, variables, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', NOW())`,
      [
        id,
        data.name,
        language,
        category,
        data.bodyText,
        data.headerType ?? null,
        data.headerImageUrl ?? null,
        notifyKind,
        authoredCount,
        JSON.stringify(variables),
      ],
    );
  }
  return { ok: true, id };
}

/** Builds the Meta components payload for a template definition. */
function buildTemplateComponents(data: SaveWaCloudTemplateInput): any[] {
  const components: any[] = [];
  if (data.headerType === "IMAGE" && data.headerImageUrl) {
    components.push({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: [data.headerImageUrl] },
    });
  } else if (data.headerType === "TEXT") {
    // Header text, when used, is carried in bodyText authoring; skip for now.
  }
  components.push({ type: "BODY", text: data.bodyText });
  return components;
}

export async function submitWaCloudTemplate(data: SaveWaCloudTemplateInput): Promise<{
  ok: boolean;
  code?: string;
  message?: string;
  metaTemplateId?: string;
}> {
  // Re-run the same video-kind + varCount guard before submitting to Meta.
  validateTemplatePayload(data);
  const language = data.language || "en_US";
  const category = data.category || "UTILITY";

  const result = await submitTemplate({
    name: data.name,
    language,
    category,
    components: buildTemplateComponents(data),
  });

  if (result.ok) {
    const metaTemplateId = result.metaTemplateId || result.messageId;
    if (data.id) {
      await execute(
        "UPDATE WaCloudTemplate SET status = 'PENDING', metaTemplateId = ?, updatedAt = NOW() WHERE id = ?",
        [metaTemplateId, data.id],
      );
    }
    return { ok: true, metaTemplateId };
  }
  if (result.kind === "meta_error")
    return { ok: false, code: result.code, message: result.message };
  return { ok: false, message: result.message };
}

export async function syncWaCloudTemplateStatus(data: {
  id: string;
}): Promise<{ ok: boolean; status?: string; message?: string }> {
  const row = await queryOne<any>(
    "SELECT id, name, language, metaTemplateId FROM WaCloudTemplate WHERE id = ? LIMIT 1",
    [data.id],
  );
  if (!row) throw new Error("Template not found");

  const result = await syncTemplateStatus({
    name: row.name,
    language: row.language,
    metaTemplateId: row.metaTemplateId || undefined,
  });

  if (result.ok) {
    await execute(
      `UPDATE WaCloudTemplate
          SET status = ?, rejectionReason = ?, metaTemplateId = COALESCE(?, metaTemplateId),
              updatedAt = NOW()
        WHERE id = ?`,
      [result.status, result.reason ?? null, result.metaTemplateId ?? null, data.id],
    );
    return { ok: true, status: result.status };
  }
  return { ok: false, message: result.message };
}

// ── Monitoring (cross-tenant) ───────────────────────────────────────────────

export async function getWaCloudLogs(data?: { limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(Number(data?.limit) || 50, 1), 200);
  const offset = Math.max(Number(data?.offset) || 0, 0);

  const recent = await query<any>(
    `SELECT id, tenantId, recipient, kind, channel, status, metaMessageId,
            officialAttempted, officialStatus,
            COALESCE(officialErrorCode, errorCode) AS errorCode,
            COALESCE(officialErrorMessage, errorMessage) AS errorMessage,
            createdAt
       FROM WaMessageLog
      WHERE direction = 'out'
      ORDER BY createdAt DESC
      LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  const breakdown = await queryOne<any>(
    `SELECT
       SUM(CASE WHEN officialAttempted = 1 AND officialStatus IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS officialOk,
       SUM(CASE WHEN officialStatus = 'failed' THEN 1 ELSE 0 END) AS officialFailed,
       SUM(CASE WHEN channel = 'web' AND status = 'sent' THEN 1 ELSE 0 END) AS webOk,
       SUM(CASE WHEN channel = 'web' AND status = 'failed' THEN 1 ELSE 0 END) AS webFailed,
       COUNT(*) AS total
     FROM WaMessageLog
     WHERE direction = 'out'`,
  );

  const statusTotals = await query<any>(
    `SELECT status, COUNT(*) AS count
       FROM WaMessageLog
      WHERE direction = 'out'
      GROUP BY status`,
  );

  const recentFailures = await query<any>(
    `SELECT id, tenantId, recipient, kind, channel, status,
            COALESCE(officialErrorCode, errorCode) AS errorCode,
            COALESCE(officialErrorMessage, errorMessage) AS errorMessage,
            createdAt
       FROM WaMessageLog
      WHERE direction = 'out' AND (status = 'failed' OR officialErrorCode IS NOT NULL)
      ORDER BY createdAt DESC
      LIMIT 20`,
  );

  return {
    recent: recent || [],
    breakdown: breakdown || {},
    statusTotals: statusTotals || [],
    recentFailures: recentFailures || [],
  };
}
