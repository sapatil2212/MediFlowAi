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
import { query, queryOne, execute } from "./db";
import { encryptSecret, isEncKeyConfigured, last4 } from "./wa-crypto";
import {
  API_VERSION_EXPIRY,
  DEFAULT_API_VERSION,
  MAX_TEXT_BODY_LENGTH,
  normalizeWaPhone,
  resolveCloudConfig,
  sendTextMessage,
  verifyPhoneNumber,
} from "./whatsapp-cloud";
import { getTemplateRepo } from "./wa-template-repo";
import { findPublishedTemplateSpec } from "./wa-template-presets";
import { parsePlaceholders } from "./wa-template-model";

// ── Config ───────────────────────────────────────────────────────────────────

export interface ApiVersionInfo {
  value: string;
  source: "db" | "env" | "default";
  expiresOn: string | null;
  warning: string | null;
}

/** Days until a given ISO date; null when the date is null/invalid. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.ceil((then - Date.now()) / 86_400_000);
}

/** Builds the API-version expiry info + warning (DP-03). */
function buildApiVersionInfo(row: any): ApiVersionInfo {
  const dbVersion = row?.apiVersion ? String(row.apiVersion) : null;
  const envVersion =
    process.env.WA_CLOUD_API_VERSION && process.env.WA_CLOUD_API_VERSION !== ""
      ? process.env.WA_CLOUD_API_VERSION
      : null;
  const value = dbVersion || envVersion || DEFAULT_API_VERSION;
  const source: ApiVersionInfo["source"] = dbVersion ? "db" : envVersion ? "env" : "default";
  const expiresOn = Object.prototype.hasOwnProperty.call(API_VERSION_EXPIRY, value)
    ? API_VERSION_EXPIRY[value]
    : null;
  let warning: string | null = null;
  if (!Object.prototype.hasOwnProperty.call(API_VERSION_EXPIRY, value)) {
    warning = `API version ${value} is not recognised; verify it is still supported by Meta.`;
  } else {
    const days = daysUntil(expiresOn);
    if (days != null && days <= 120) {
      warning =
        days <= 0
          ? `API version ${value} has reached its Meta expiry (${expiresOn}); update it in Credentials.`
          : `API version ${value} expires on ${expiresOn} (${days} days); plan to update it in Credentials.`;
    }
  }
  return { value, source, expiresOn, warning };
}

export interface BookedRouteReadiness {
  mappingExists: boolean;
  mappingEnabled: boolean;
  optInAcknowledged: boolean;
  templateApproved: boolean;
  templateUtility: boolean;
  languageCompatible: boolean;
  accountCompatible: boolean;
  templateContractCompatible: boolean;
  ready: boolean;
}

const EMPTY_BOOKED_READINESS: BookedRouteReadiness = {
  mappingExists: false,
  mappingEnabled: false,
  optInAcknowledged: false,
  templateApproved: false,
  templateUtility: false,
  languageCompatible: false,
  accountCompatible: false,
  templateContractCompatible: false,
  ready: false,
};

/** Computes booked-template readiness without returning any secret or patient data. */
async function getBookedRouteReadiness(
  resolved: Awaited<ReturnType<typeof resolveCloudConfig>>,
): Promise<BookedRouteReadiness> {
  try {
    const spec = findPublishedTemplateSpec("appointment_booked", "en_US");
    if (!spec) return { ...EMPTY_BOOKED_READINESS };

    const repo = getTemplateRepo();
    const mapping = await repo.getMapping("booked");
    const template = mapping ? await repo.getById(mapping.templateId) : null;
    const parsed = template
      ? parsePlaceholders(template.bodyText, template.parameterFormat, "body")
      : null;
    const expectedKeys = Object.keys(spec.variableMappings);
    const templateContractCompatible = !!(
      template &&
      template.name === spec.name &&
      template.language === spec.language &&
      template.parameterFormat === spec.parameterFormat &&
      (template.headerType ?? "NONE") === spec.headerType &&
      (template.buttons?.length ?? 0) === 0 &&
      parsed &&
      parsed.errors.length === 0 &&
      parsed.placeholders.length === expectedKeys.length &&
      parsed.placeholders.every(
        (placeholder, index) =>
          placeholder.key === expectedKeys[index] &&
          template.variableMappings?.[placeholder.key] === spec.variableMappings[placeholder.key],
      )
    );

    const readiness: BookedRouteReadiness = {
      mappingExists: !!mapping,
      mappingEnabled: mapping?.isEnabled === true,
      optInAcknowledged: !!mapping?.optInAckAt,
      templateApproved: (template?.metaStatus ?? "").toUpperCase() === "APPROVED",
      templateUtility: (template?.metaCategory ?? "").toUpperCase() === "UTILITY",
      languageCompatible: !!(
        mapping &&
        template &&
        mapping.language === spec.language &&
        template.language === spec.language
      ),
      accountCompatible: !!(
        template?.messagingAccountId &&
        resolved?.wabaId &&
        template.messagingAccountId === resolved.wabaId
      ),
      templateContractCompatible,
      ready: false,
    };
    readiness.ready = Object.entries(readiness)
      .filter(([key]) => key !== "ready")
      .every(([, value]) => value === true);
    return readiness;
  } catch {
    return { ...EMPTY_BOOKED_READINESS };
  }
}

/** Returns the masked central config (never the ciphertext/plaintext). */
export async function getWaCloudConfig() {
  const row = await queryOne<any>("SELECT * FROM WaCloudConfig WHERE id = 'central' LIMIT 1");
  const resolved = await resolveCloudConfig();
  const bookedRoute = await getBookedRouteReadiness(resolved);
  return {
    phoneNumberId: row?.phoneNumberId ?? resolved?.phoneNumberId ?? null,
    wabaId: row?.wabaId ?? resolved?.wabaId ?? null,
    apiVersion: row?.apiVersion ?? resolved?.apiVersion ?? DEFAULT_API_VERSION,
    apiVersionInfo: buildApiVersionInfo(row),
    isEnabled: row ? Number(row.isEnabled) === 1 : false,
    tokenConfigured: !!(row?.accessTokenEnc || process.env.WA_CLOUD_ACCESS_TOKEN),
    tokenLast4: row?.tokenLast4 ?? null,
    appSecretConfigured: !!(row?.appSecretEnc || process.env.WA_CLOUD_APP_SECRET),
    appSecretLast4: row?.appSecretLast4 ?? null,
    verifyTokenConfigured: !!(row?.verifyToken || process.env.WA_CLOUD_VERIFY_TOKEN),
    encKeyConfigured: isEncKeyConfigured(),
    recipientAllowlistActive: !!process.env.WA_CLOUD_TEST_RECIPIENTS?.trim(),
    bookedRouteReady: bookedRoute.ready,
    bookedRouteChecks: bookedRoute,
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
    throw new Error("Invalid apiVersion (expected like v21.0)");
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

export interface VerifiedPhoneInfo {
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  qualityRating: string | null;
}

export async function saveWaCloudConfig(
  data: SaveWaCloudConfigInput,
): Promise<{ ok: true; verified: VerifiedPhoneInfo | null }> {
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
  const apiVersion = data.apiVersion || row?.apiVersion || DEFAULT_API_VERSION;
  const verifyToken =
    data.verifyToken != null && data.verifyToken !== ""
      ? data.verifyToken
      : (row?.verifyToken ?? null);
  const isEnabled = data.isEnabled != null ? (data.isEnabled ? 1 : 0) : (row?.isEnabled ?? 0);

  // Pre-flight validation: when the phone number ID or access token changes,
  // ask Meta about the phone number with the NEW token (or the saved one when
  // the token isn't changing) BEFORE writing. A Meta error rejects the save and
  // nothing is written. The token never appears in the error.
  let verified: VerifiedPhoneInfo | null = null;
  const phoneChanging = !!data.phoneNumberId && data.phoneNumberId !== (row?.phoneNumberId ?? null);
  if (phoneChanging || hasNewToken) {
    const resolved = await resolveCloudConfig();
    const effPhone = data.phoneNumberId || row?.phoneNumberId || resolved?.phoneNumberId || null;
    const effToken = hasNewToken ? data.accessToken!.trim() : resolved?.accessToken || null;
    if (effPhone && effToken) {
      const check = await verifyPhoneNumber({
        phoneNumberId: String(effPhone),
        accessToken: effToken,
        apiVersion,
      });
      if (!check.ok) {
        throw new Error(`Meta rejected these credentials (code ${check.code}): ${check.message}`);
      }
      verified = {
        verifiedName: check.verifiedName,
        displayPhoneNumber: check.displayPhoneNumber,
        qualityRating: check.qualityRating,
      };
    }
  }

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
  return { ok: true, verified };
}

// Server-side cooldown for admin test-sends: each test sends a real WhatsApp
// text message to a real number, so throttle repeated calls. Module-scoped
// (single-process boot).
const TEST_SEND_COOLDOWN_MS = 30_000;
let lastTestSendAt = 0;

/** Shown with Meta error 131047 (recipient outside the 24-hour window). */
export const META_24H_HINT =
  "The recipient must message your business WhatsApp number first (Meta 24-hour rule).";

export interface TestWaCloudConfigResult {
  ok: boolean;
  messageId?: string;
  code?: string;
  message?: string;
  hint?: string;
}

/**
 * Sends a plain-text test message through the Cloud API. Free-form text only
 * reaches a recipient who messaged the business number within the last 24h.
 * Outside it Meta usually ACCEPTS the send ({ok:true, messageId}) and reports
 * 131047 later in a 'failed' status webhook (visible in Monitoring); only a
 * synchronous 131047 returns here with META_24H_HINT. So ok:true means
 * "accepted by Meta", not "delivered".
 */
export async function testWaCloudConfig(data: {
  toPhone: string;
  message: string;
}): Promise<TestWaCloudConfigResult> {
  // Validate BEFORE reserving the cooldown so a typo doesn't lock the admin out.
  const to = normalizeWaPhone(data?.toPhone);
  if (to.length < 11 || to.length > 15) {
    throw new Error("Enter a valid WhatsApp number with country code");
  }
  const text = String(data?.message ?? "").trim();
  if (text === "") throw new Error("Message is required");
  if (text.length > MAX_TEXT_BODY_LENGTH) {
    throw new Error(`Message must be ${MAX_TEXT_BODY_LENGTH} characters or fewer`);
  }

  const now = Date.now();
  const elapsed = now - lastTestSendAt;
  if (lastTestSendAt > 0 && elapsed < TEST_SEND_COOLDOWN_MS) {
    const wait = Math.ceil((TEST_SEND_COOLDOWN_MS - elapsed) / 1000);
    throw new Error(`Please wait ${wait}s before sending another test message.`);
  }
  // Reserve the window before the network call so concurrent calls are throttled.
  lastTestSendAt = now;
  const result = await sendTextMessage({ to, body: text });
  if (result.ok) return { ok: true, messageId: result.messageId };
  if (result.kind === "meta_error") {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      ...(result.code === "131047" ? { hint: META_24H_HINT } : {}),
    };
  }
  return { ok: false, message: result.message };
}

// ── Monitoring (cross-tenant) ───────────────────────────────────────────────

export async function getWaCloudLogs(data?: { limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(Number(data?.limit) || 50, 1), 200);
  const offset = Math.max(Number(data?.offset) || 0, 0);

  const recent = await query<any>(
    `SELECT l.id, l.tenantId, l.recipient, l.kind, l.channel, l.status, l.metaMessageId,
            l.officialAttempted, l.officialStatus, l.templateId, t.name AS templateName,
            COALESCE(l.officialErrorCode, l.errorCode) AS errorCode,
            COALESCE(l.officialErrorMessage, l.errorMessage) AS errorMessage,
            l.createdAt
       FROM WaMessageLog l
       LEFT JOIN WaCloudTemplate t ON t.id = l.templateId
      WHERE l.direction = 'out'
      ORDER BY l.createdAt DESC
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
    `SELECT l.id, l.tenantId, l.recipient, l.kind, l.channel, l.status,
            l.templateId, t.name AS templateName,
            COALESCE(l.officialErrorCode, l.errorCode) AS errorCode,
            COALESCE(l.officialErrorMessage, l.errorMessage) AS errorMessage,
            l.createdAt
       FROM WaMessageLog l
       LEFT JOIN WaCloudTemplate t ON t.id = l.templateId
      WHERE l.direction = 'out' AND (l.status = 'failed' OR l.officialErrorCode IS NOT NULL)
      ORDER BY l.createdAt DESC
      LIMIT 20`,
  );

  return {
    recent: recent || [],
    breakdown: breakdown || {},
    statusTotals: statusTotals || [],
    recentFailures: recentFailures || [],
  };
}
