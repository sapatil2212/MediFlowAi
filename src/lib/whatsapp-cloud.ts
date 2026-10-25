// ─────────────────────────────────────────────────────────────────────────────
// whatsapp-cloud.ts  (server-only)
//
// Low-level client for the Meta WhatsApp Cloud API (Graph). Holds NO
// createServerFn wrappers so both the webhook handler and the super-admin
// server functions can import it directly.
//
// Credentials resolve from the single WaCloudConfig row (id='central'), with a
// PER-FIELD fallback to environment variables (DB wins over env). Encrypted
// secrets are decrypted via wa-crypto. No secret ever appears in a return value
// or a log line.
//
// PLAIN-TEXT MODE:
//   The send path is sendTextMessage: the official channel sends exactly the
//   same free-form text as the WhatsApp Web channel. The template helpers below
//   (sendTemplateMessage, submitTemplate, syncTemplateStatus, sendTestTemplate)
//   are dormant: kept for the Templates tab, not used for patient sends.
//
// META 24-HOUR RULE:
//   Free-form text is only allowed within 24 hours of the recipient's last
//   inbound message to the business number. Outside that window Meta usually
//   ACCEPTS the send (returns a wamid) and reports error 131047 later in a
//   'failed' status webhook (it can also reject synchronously). Either way the
//   router falls back to WhatsApp Web when the tenant's Web session is
//   connected. Expected, not a bug. The webhook handshake and app secret must
//   be verified before the config is enabled, or the async failures are missed.
//
// A 2xx from Meta means "accepted", not "delivered". A send can still fail
// later; that arrives as a 'failed' status webhook (see whatsapp-webhook.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { queryOne } from "./db";
import { decryptSecret } from "./wa-crypto";

const GRAPH_HOST = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 10000;
export const DEFAULT_API_VERSION = "v21.0";
/** Meta's maximum length for a text message body. */
export const MAX_TEXT_BODY_LENGTH = 4096;

/**
 * Normalizes a phone number exactly like wa-server.cjs: strip every non-digit,
 * and a bare 10-digit number gets the Indian country code "91" prefixed.
 */
export function normalizeWaPhone(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length === 10 ? "91" + digits : digits;
}

/**
 * Local-testing safety net. When WA_CLOUD_TEST_RECIPIENTS is set (comma-separated
 * phone numbers), the official API only sends to those numbers. Every other
 * recipient is refused before any network call, so the router treats it as a
 * failed official send and falls back to WhatsApp Web exactly as before.
 * Leave it UNSET in production: unset or blank means no restriction.
 */
export function isOfficialRecipientAllowed(to: string | null | undefined): boolean {
  const raw = process.env.WA_CLOUD_TEST_RECIPIENTS;
  if (!raw || !raw.trim()) return true;
  const allowed = raw
    .split(",")
    .map((s) => normalizeWaPhone(s))
    .filter(Boolean);
  return allowed.includes(normalizeWaPhone(to));
}

const TEST_RECIPIENT_BLOCKED = "Recipient not in WA_CLOUD_TEST_RECIPIENTS (local test mode)";

export interface ResolvedCloudConfig {
  phoneNumberId: string | null;
  wabaId: string | null;
  accessToken: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  apiVersion: string;
  isEnabled: boolean;
  source: "db" | "env" | "mixed" | "none";
}

export type CloudSendResult =
  | { ok: true; messageId: string }
  | { ok: false; kind: "meta_error"; code: string; subcode?: string; message: string }
  | { ok: false; kind: "transport"; message: string };

/** Safe JSON parse mirroring cashfree.ts parseJsonSafe. */
async function parseJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function envOr(dbVal: string | null | undefined, envVal: string | undefined): string | null {
  if (dbVal != null && String(dbVal) !== "") return String(dbVal);
  if (envVal != null && String(envVal) !== "") return String(envVal);
  return null;
}

/**
 * Resolves the central Cloud API config. DB row wins per-field over env. On a
 * credential decrypt failure, logs WITHOUT the value and returns null.
 */
export async function resolveCloudConfig(): Promise<ResolvedCloudConfig | null> {
  let row: any = null;
  try {
    row = await queryOne<any>("SELECT * FROM WaCloudConfig WHERE id = 'central' LIMIT 1");
  } catch {
    row = null;
  }

  let dbAccessToken: string | null = null;
  let dbAppSecret: string | null = null;
  try {
    if (row?.accessTokenEnc) dbAccessToken = decryptSecret(String(row.accessTokenEnc));
    if (row?.appSecretEnc) dbAppSecret = decryptSecret(String(row.appSecretEnc));
  } catch {
    console.error("[WaCloud] credential decrypt failed");
    return null;
  }

  const phoneNumberId = envOr(row?.phoneNumberId, process.env.WA_CLOUD_PHONE_NUMBER_ID);
  const wabaId = envOr(row?.wabaId, process.env.WA_CLOUD_WABA_ID);
  const accessToken = envOr(dbAccessToken, process.env.WA_CLOUD_ACCESS_TOKEN);
  const appSecret = envOr(dbAppSecret, process.env.WA_CLOUD_APP_SECRET);
  const verifyToken = envOr(row?.verifyToken, process.env.WA_CLOUD_VERIFY_TOKEN);
  const apiVersion =
    envOr(row?.apiVersion, process.env.WA_CLOUD_API_VERSION) || DEFAULT_API_VERSION;

  const hasDb = !!row;
  const hasEnv =
    !!process.env.WA_CLOUD_PHONE_NUMBER_ID ||
    !!process.env.WA_CLOUD_ACCESS_TOKEN ||
    !!process.env.WA_CLOUD_APP_SECRET;
  const source: ResolvedCloudConfig["source"] =
    hasDb && hasEnv ? "mixed" : hasDb ? "db" : hasEnv ? "env" : "none";

  // isEnabled is a DB-only flag; env-only config is considered enabled when a
  // complete credential set is present via env.
  const isEnabled = row ? Number(row.isEnabled) === 1 : !!(phoneNumberId && accessToken);

  return {
    phoneNumberId,
    wabaId,
    accessToken,
    appSecret,
    verifyToken,
    apiVersion,
    isEnabled,
    source,
  };
}

/** True only when a complete config resolves (phoneNumberId + accessToken) AND isEnabled. */
export async function isCloudAvailable(): Promise<boolean> {
  const cfg = await resolveCloudConfig();
  if (!cfg) return false;
  return !!cfg.phoneNumberId && !!cfg.accessToken && cfg.isEnabled;
}

function metaErrorResult(data: any): CloudSendResult {
  const error = data?.error || {};
  return {
    ok: false,
    kind: "meta_error",
    code: error.code != null ? String(error.code) : "unknown",
    subcode: error.error_subcode != null ? String(error.error_subcode) : undefined,
    message: error.message || "Meta API error",
  };
}

/**
 * POST a plain-text message to the Cloud API. This is the official send path.
 *
 * Subject to Meta's 24-hour rule: outside 24h of the recipient's last inbound
 * message the send usually still returns ok (accepted) and fails later with
 * 131047 via the status webhook; a synchronous 131047 meta_error is possible
 * too. `ok:true` therefore means "accepted by Meta", not "delivered".
 * An empty or >4096-char body is rejected without a network call. Never throws.
 */
export async function sendTextMessage(args: {
  to: string;
  body: string;
}): Promise<CloudSendResult> {
  const text = typeof args.body === "string" ? args.body : "";
  if (text.trim() === "") {
    return { ok: false, kind: "transport", message: "Message body is empty" };
  }
  if (text.length > MAX_TEXT_BODY_LENGTH) {
    return {
      ok: false,
      kind: "transport",
      message: `Message body exceeds ${MAX_TEXT_BODY_LENGTH} characters`,
    };
  }
  if (!isOfficialRecipientAllowed(args.to)) {
    return { ok: false, kind: "transport", message: TEST_RECIPIENT_BLOCKED };
  }

  try {
    const cfg = await resolveCloudConfig();
    if (!cfg || !cfg.phoneNumberId || !cfg.accessToken) {
      return { ok: false, kind: "transport", message: "Cloud API not configured" };
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: args.to,
      type: "text",
      text: { preview_url: true, body: text },
    };

    const res = await fetch(`${GRAPH_HOST}/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await parseJsonSafe(res);
    if (res.ok) {
      const messageId = data?.messages?.[0]?.id;
      if (messageId) return { ok: true, messageId: String(messageId) };
      return { ok: false, kind: "transport", message: "No message id in response" };
    }
    if (res.status >= 400 && res.status < 500 && data?.error) {
      return metaErrorResult(data);
    }
    return { ok: false, kind: "transport", message: `Graph API returned ${res.status}` };
  } catch (err: any) {
    return { ok: false, kind: "transport", message: err?.message || "network error" };
  }
}

export type VerifyPhoneNumberResult =
  | {
      ok: true;
      verifiedName: string | null;
      displayPhoneNumber: string | null;
      qualityRating: string | null;
    }
  | { ok: false; code: string; message: string };

/**
 * Pre-flight credential check: GET the phone number object with the given
 * token. Used by the admin save to reject bad credentials before they are
 * written. Never throws; the token never appears in the result.
 */
export async function verifyPhoneNumber(args: {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
}): Promise<VerifyPhoneNumberResult> {
  try {
    const res = await fetch(
      `${GRAPH_HOST}/${args.apiVersion}/${encodeURIComponent(args.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${args.accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      const error = data?.error || {};
      return {
        ok: false,
        code: error.code != null ? String(error.code) : String(res.status),
        message: error.message || `Graph API returned ${res.status}`,
      };
    }
    return {
      ok: true,
      verifiedName: data?.verified_name != null ? String(data.verified_name) : null,
      displayPhoneNumber:
        data?.display_phone_number != null ? String(data.display_phone_number) : null,
      qualityRating: data?.quality_rating != null ? String(data.quality_rating) : null,
    };
  } catch (err: any) {
    return { ok: false, code: "transport", message: err?.message || "network error" };
  }
}

export interface SendTemplateArgs {
  to: string;
  templateName: string;
  language: string;
  bodyParams?: string[];
  headerImageUrl?: string | null;
}

/** POST a template message to the Cloud API. */
export async function sendTemplateMessage(args: SendTemplateArgs): Promise<CloudSendResult> {
  if (!isOfficialRecipientAllowed(args.to)) {
    return { ok: false, kind: "transport", message: TEST_RECIPIENT_BLOCKED };
  }
  const cfg = await resolveCloudConfig();
  if (!cfg || !cfg.phoneNumberId || !cfg.accessToken) {
    return { ok: false, kind: "transport", message: "Cloud API not configured" };
  }

  const components: any[] = [];
  if (args.headerImageUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: args.headerImageUrl } }],
    });
  }
  if (args.bodyParams && args.bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: args.bodyParams.map((text) => ({ type: "text", text })),
    });
  }

  const body = {
    messaging_product: "whatsapp",
    to: args.to,
    type: "template",
    template: {
      name: args.templateName,
      language: { code: args.language },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  try {
    const res = await fetch(`${GRAPH_HOST}/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await parseJsonSafe(res);
    if (res.ok) {
      const messageId = data?.messages?.[0]?.id;
      if (messageId) return { ok: true, messageId: String(messageId) };
      return { ok: false, kind: "transport", message: "No message id in response" };
    }
    if (res.status >= 400 && res.status < 500 && data?.error) {
      return metaErrorResult(data);
    }
    return { ok: false, kind: "transport", message: `Graph API returned ${res.status}` };
  } catch (err: any) {
    return { ok: false, kind: "transport", message: err?.message || "network error" };
  }
}

export interface SubmitTemplateArgs {
  name: string;
  language: string;
  category: string;
  components: any[];
}

/** POST a template definition to the WABA for Meta review. */
export async function submitTemplate(
  templateData: SubmitTemplateArgs,
): Promise<CloudSendResult & { metaTemplateId?: string }> {
  const cfg = await resolveCloudConfig();
  if (!cfg || !cfg.wabaId || !cfg.accessToken) {
    return { ok: false, kind: "transport", message: "Cloud API not configured" };
  }

  const body = {
    name: templateData.name,
    language: templateData.language,
    category: templateData.category,
    components: templateData.components,
  };

  try {
    const res = await fetch(`${GRAPH_HOST}/${cfg.apiVersion}/${cfg.wabaId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await parseJsonSafe(res);
    if (res.ok && data?.id) {
      return { ok: true, messageId: String(data.id), metaTemplateId: String(data.id) };
    }
    if (res.status >= 400 && res.status < 500 && data?.error) {
      return metaErrorResult(data);
    }
    return { ok: false, kind: "transport", message: `Graph API returned ${res.status}` };
  } catch (err: any) {
    return { ok: false, kind: "transport", message: err?.message || "network error" };
  }
}

export type TemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "DRAFT";

export type SyncTemplateResult =
  | { ok: true; status: TemplateStatus; reason?: string; metaTemplateId?: string }
  | { ok: false; code: string; message: string };

/** GET template review status from the WABA, filtered by name. */
export async function syncTemplateStatus(args: {
  name?: string;
  language?: string;
  metaTemplateId?: string;
}): Promise<SyncTemplateResult> {
  const cfg = await resolveCloudConfig();
  if (!cfg || !cfg.wabaId || !cfg.accessToken) {
    return { ok: false, code: "unconfigured", message: "Cloud API not configured" };
  }

  const params = new URLSearchParams();
  if (args.name) params.set("name", args.name);
  params.set("fields", "name,status,category,language,rejected_reason,id");

  try {
    const res = await fetch(
      `${GRAPH_HOST}/${cfg.apiVersion}/${cfg.wabaId}/message_templates?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      const error = data?.error || {};
      return {
        ok: false,
        code: error.code != null ? String(error.code) : String(res.status),
        message: error.message || `Graph API returned ${res.status}`,
      };
    }
    const list: any[] = Array.isArray(data?.data) ? data.data : [];
    const match =
      (args.language ? list.find((t) => t.language === args.language) : null) ||
      (args.metaTemplateId ? list.find((t) => String(t.id) === args.metaTemplateId) : null) ||
      list[0];
    if (!match) {
      return { ok: false, code: "not_found", message: "Template not found on Meta" };
    }
    const rawStatus = String(match.status || "").toUpperCase();
    const status: TemplateStatus =
      rawStatus === "APPROVED"
        ? "APPROVED"
        : rawStatus === "REJECTED"
          ? "REJECTED"
          : rawStatus === "PENDING" || rawStatus === "IN_APPEAL" || rawStatus === "PENDING_DELETION"
            ? "PENDING"
            : "DRAFT";
    return {
      ok: true,
      status,
      reason: match.rejected_reason || undefined,
      metaTemplateId: match.id ? String(match.id) : undefined,
    };
  } catch (err: any) {
    return { ok: false, code: "transport", message: err?.message || "network error" };
  }
}

/** Thin wrapper over sendTemplateMessage for the admin Test action. */
export async function sendTestTemplate(
  toPhone: string,
  templateName: string,
  language: string,
): Promise<CloudSendResult> {
  return sendTemplateMessage({ to: toPhone, templateName, language });
}
