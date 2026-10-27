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
// OUTBOUND MESSAGING POLICY:
//   Business notifications fail closed and use only mapped, enabled,
//   opt-in-acknowledged, Meta-approved UTILITY templates through the official
//   Cloud API. There is no WhatsApp Web or free-form fallback. The remaining
//   sendTextMessage callers are the customer-window inbound auto-reply and the
//   explicit super-admin Cloud connection test.
//
// TEMPLATE MANAGEMENT (v26.0):
//   Every Meta management call (create/list/get/edit/delete templates, WABA /
//   phone / health / subscribed-apps / debug_token reads) goes through the
//   single typed graphRequest<T> helper below, which fixes the host, applies a
//   10s timeout, maps errors to a GraphResult union (MV-16), and records
//   lastApiOkAt via the template repo on any 2xx. No token is ever logged.
//
// META 24-HOUR RULE:
//   Free-form text is limited to customer-window auto-replies and explicit
//   super-admin connection tests. Outside 24 hours of the recipient's last
//   inbound message, Meta may reject synchronously or report error 131047 in a
//   later status webhook. Business notifications do not use this path: their
//   approved-template gate fails closed without a Web or free-form fallback.
//   The webhook handshake and app secret must be verified before the config is
//   enabled, or asynchronous status updates are missed.
//
// A 2xx from Meta means "accepted", not "delivered". A send can still fail
// later; that arrives as a 'failed' status webhook (see whatsapp-webhook.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { queryOne } from "./db";
import { decryptSecret } from "./wa-crypto";

const GRAPH_HOST = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 10000;
export const DEFAULT_API_VERSION = "v26.0";
/** Meta's maximum length for a text message body. */
export const MAX_TEXT_BODY_LENGTH = 4096;

/**
 * Graph API version expiry dates (MV-02, source S16 — retrieved 25 Oct 2026).
 * `null` means "released, expiry TBD". The Account Health panel warns when the
 * effective version expires within 120 days or is unknown. The code default
 * (v26.0) is intentionally not the saved production row (likely v21.0, which
 * expires 21 Jan 2027); saved rows are left untouched (D2).
 */
export const API_VERSION_EXPIRY: Record<string, string | null> = {
  "v26.0": null,
  "v25.0": "2028-07-29",
  "v24.0": "2028-02-18",
  "v23.0": "2027-10-08",
  "v22.0": "2027-05-20",
  "v21.0": "2027-01-21",
};

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
 * recipient is refused before any network call. Business notifications record
 * that refusal as a failed official send and do not use another transport.
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
  | {
      ok: false;
      kind: "meta_error";
      httpStatus: number;
      code: string;
      subcode?: string;
      message: string;
      userTitle?: string;
      userMessage?: string;
      isTransient?: boolean;
      fbtraceId?: string;
    }
  | { ok: false; kind: "transport"; message: string; httpStatus?: number };

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

function metaErrorResult(data: any, httpStatus: number): CloudSendResult {
  const error = data?.error || {};
  return {
    ok: false,
    kind: "meta_error",
    httpStatus,
    code: error.code != null ? String(error.code) : "unknown",
    subcode: error.error_subcode != null ? String(error.error_subcode) : undefined,
    message: error.message || "Meta API error",
    userTitle: error.error_user_title != null ? String(error.error_user_title) : undefined,
    userMessage: error.error_user_msg != null ? String(error.error_user_msg) : undefined,
    isTransient:
      error.is_transient != null ? String(error.is_transient).toLowerCase() === "true" : undefined,
    fbtraceId: error.fbtrace_id != null ? String(error.fbtrace_id) : undefined,
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
      return metaErrorResult(data, res.status);
    }
    return {
      ok: false,
      kind: "transport",
      message: `Graph API returned ${res.status}`,
      httpStatus: res.status,
    };
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

// ─────────────────────────────────────────────────────────────────────────────
// Template runtime send (MV-17). Rewritten to the documented runtime shape:
//   POST /{phoneNumberId}/messages with template.language.code, body params
//   {type:'text', text} (+ parameter_name when NAMED) in placeholder order, a
//   header component for a TEXT-header parameter, and URL-button components
//   {type:'button', sub_type:'url', index, parameters:[{type:'text', text}]}
//   whose suffix value is percent-encoded. A Meta rejection is returned to the
//   template-only router for sanitized logging; no alternate transport runs.
// ─────────────────────────────────────────────────────────────────────────────
export interface SendTemplateMessageArgs {
  to: string;
  templateName: string;
  language: string;
  parameterFormat?: "POSITIONAL" | "NAMED";
  /** Ordered body params (placeholder order); `name` only for NAMED. */
  bodyParams?: Array<{ text: string; name?: string }>;
  /** Single TEXT-header param, if the template has a parameterised text header. */
  headerParams?: Array<{ text: string; name?: string }>;
  /** URL-button dynamic suffixes, keyed by the button index. */
  urlButtons?: Array<{ index: number; suffix: string }>;
}

/** POST a template message to the Cloud API (documented runtime shape, MV-17). */
export async function sendTemplateMessage(args: SendTemplateMessageArgs): Promise<CloudSendResult> {
  if (!isOfficialRecipientAllowed(args.to)) {
    return { ok: false, kind: "transport", message: TEST_RECIPIENT_BLOCKED };
  }
  const cfg = await resolveCloudConfig();
  if (!cfg || !cfg.phoneNumberId || !cfg.accessToken) {
    return { ok: false, kind: "transport", message: "Cloud API not configured" };
  }

  const named = args.parameterFormat === "NAMED";
  const toParam = (p: { text: string; name?: string }) =>
    named && p.name
      ? { type: "text", parameter_name: p.name, text: p.text }
      : { type: "text", text: p.text };

  const components: any[] = [];
  if (args.headerParams && args.headerParams.length > 0) {
    components.push({ type: "header", parameters: args.headerParams.map(toParam) });
  }
  if (args.bodyParams && args.bodyParams.length > 0) {
    components.push({ type: "body", parameters: args.bodyParams.map(toParam) });
  }
  for (const btn of args.urlButtons ?? []) {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(btn.index),
      parameters: [{ type: "text", text: encodeURIComponent(btn.suffix) }],
    });
  }

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
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
      return metaErrorResult(data, res.status);
    }
    return {
      ok: false,
      kind: "transport",
      message: `Graph API returned ${res.status}`,
      httpStatus: res.status,
    };
  } catch (err: any) {
    return { ok: false, kind: "transport", message: err?.message || "network error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed Graph transport for template management + account health (design §9).
//
// graphRequest<T> is the single place every management call flows through. It
// fixes the host, applies a 10s timeout, parses safely, maps data.error to a
// meta_error (MV-16 fields) and 5xx/network/timeout to transport, records
// lastApiOkAt via the repo on any 2xx, and logs ONLY {method,path,status,code,
// fbtrace_id} — never a token or a full URL carrying one.
// ─────────────────────────────────────────────────────────────────────────────
export type GraphResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: "meta_error" | "transport";
      code: string;
      subcode?: string;
      message: string;
      userTitle?: string;
      userMsg?: string;
      isTransient?: boolean;
      fbtraceId?: string;
    };

/** Records lastApiOkAt best-effort; never throws into the caller. */
async function recordApiOk(): Promise<void> {
  try {
    const { getTemplateRepo } = await import("./wa-template-repo");
    await getTemplateRepo().markApiOk();
  } catch {
    /* best effort — a missing repo/DB must never fail a Graph call */
  }
}

export async function graphRequest<T>(args: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  accessToken: string;
  apiVersion: string;
}): Promise<GraphResult<T>> {
  const qs = args.query
    ? "?" +
      Object.entries(args.query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";
  const url = `${GRAPH_HOST}/${args.apiVersion}/${args.path}${qs}`;
  try {
    const res = await fetch(url, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        ...(args.body != null ? { "Content-Type": "application/json" } : {}),
      },
      ...(args.body != null ? { body: JSON.stringify(args.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await parseJsonSafe(res);
    if (res.ok) {
      void recordApiOk();
      return { ok: true, data: data as T };
    }
    const error = data?.error;
    if (error && res.status >= 400 && res.status < 500) {
      console.warn(
        `[WaCloud] graph ${args.method} ${args.path} status=${res.status} code=${
          error.code ?? "?"
        } fbtrace=${error.fbtrace_id ?? "?"}`,
      );
      return {
        ok: false,
        kind: "meta_error",
        code: error.code != null ? String(error.code) : "unknown",
        subcode: error.error_subcode != null ? String(error.error_subcode) : undefined,
        message: error.message || "Meta API error",
        userTitle: error.error_user_title != null ? String(error.error_user_title) : undefined,
        userMsg: error.error_user_msg != null ? String(error.error_user_msg) : undefined,
        isTransient: error.is_transient === true,
        fbtraceId: error.fbtrace_id != null ? String(error.fbtrace_id) : undefined,
      };
    }
    console.warn(`[WaCloud] graph ${args.method} ${args.path} status=${res.status}`);
    return {
      ok: false,
      kind: "transport",
      code: String(res.status),
      message: `Graph API returned ${res.status}`,
    };
  } catch (err: any) {
    console.warn(`[WaCloud] graph ${args.method} ${args.path} transport error`);
    return {
      ok: false,
      kind: "transport",
      code: "transport",
      message: err?.message || "network error",
    };
  }
}

/** Resolves {accessToken, apiVersion, wabaId, phoneNumberId} or an error result. */
async function graphCreds(): Promise<
  | {
      ok: true;
      accessToken: string;
      apiVersion: string;
      wabaId: string | null;
      phoneNumberId: string | null;
    }
  | { ok: false; kind: "transport"; code: string; message: string }
> {
  const cfg = await resolveCloudConfig();
  if (!cfg || !cfg.accessToken) {
    return {
      ok: false,
      kind: "transport",
      code: "unconfigured",
      message: "Cloud API not configured",
    };
  }
  return {
    ok: true,
    accessToken: cfg.accessToken,
    apiVersion: cfg.apiVersion,
    wabaId: cfg.wabaId,
    phoneNumberId: cfg.phoneNumberId,
  };
}

const TEMPLATE_LIST_FIELDS =
  "id,name,language,category,parameter_format,status,components,quality_score,rejected_reason,correct_category,previous_category,last_updated_time";

export interface MetaTemplateCreateResult {
  id: string;
  status?: string;
  category?: string;
}

/** Create: POST /{wabaId}/message_templates (MV-09). */
export async function createMessageTemplate(payload: {
  name: string;
  language: string;
  category: string;
  parameter_format?: string;
  components: unknown[];
}): Promise<GraphResult<MetaTemplateCreateResult>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  if (!creds.wabaId) {
    return {
      ok: false,
      kind: "transport",
      code: "unconfigured",
      message: "Messaging account ID not configured",
    };
  }
  return graphRequest<MetaTemplateCreateResult>({
    method: "POST",
    path: `${creds.wabaId}/message_templates`,
    body: payload,
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}

export interface MetaTemplateListResult {
  data: any[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

/** List: GET /{wabaId}/message_templates (cursor paging; no undocumented name filter, MV-09). */
export async function listMessageTemplates(args?: {
  after?: string;
  limit?: number;
}): Promise<GraphResult<MetaTemplateListResult>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  if (!creds.wabaId) {
    return {
      ok: false,
      kind: "transport",
      code: "unconfigured",
      message: "Messaging account ID not configured",
    };
  }
  const query: Record<string, string> = {
    fields: TEMPLATE_LIST_FIELDS,
    limit: String(Math.min(Math.max(args?.limit ?? 100, 1), 100)),
  };
  if (args?.after) query.after = args.after;
  return graphRequest<MetaTemplateListResult>({
    method: "GET",
    path: `${creds.wabaId}/message_templates`,
    query,
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}

/** Get one: GET /{templateId}?fields=... (MV-09). */
export async function getMessageTemplate(id: string): Promise<GraphResult<any>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  return graphRequest<any>({
    method: "GET",
    path: encodeURIComponent(id),
    query: { fields: TEMPLATE_LIST_FIELDS },
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}

/** Edit: POST /{templateId} body {components} (components replaced wholesale, MV-10). */
export async function editMessageTemplate(
  id: string,
  body: { components: unknown[] },
): Promise<GraphResult<{ success?: boolean }>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  return graphRequest<{ success?: boolean }>({
    method: "POST",
    path: encodeURIComponent(id),
    body,
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}

/** Delete: DELETE /{wabaId}/message_templates?name=X&hsm_id=Y (single language, MV-11). */
export async function deleteMessageTemplate(args: {
  name: string;
  hsmId: string;
}): Promise<GraphResult<{ success?: boolean }>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  if (!creds.wabaId) {
    return {
      ok: false,
      kind: "transport",
      code: "unconfigured",
      message: "Messaging account ID not configured",
    };
  }
  return graphRequest<{ success?: boolean }>({
    method: "DELETE",
    path: `${creds.wabaId}/message_templates`,
    query: { name: args.name, hsm_id: args.hsmId },
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}

/** WABA node: GET /{wabaId}?fields=... (MV-01, MV-15). */
export async function getWabaNode(): Promise<GraphResult<any>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  if (!creds.wabaId) {
    return {
      ok: false,
      kind: "transport",
      code: "unconfigured",
      message: "Messaging account ID not configured",
    };
  }
  return graphRequest<any>({
    method: "GET",
    path: encodeURIComponent(creds.wabaId),
    query: {
      fields: "id,name,account_review_status,business_verification_status,country,ownership_type",
    },
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}

/** Phone node: GET /{phoneNumberId}?fields=... (MV-15). */
export async function getPhoneNode(): Promise<GraphResult<any>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  if (!creds.phoneNumberId) {
    return {
      ok: false,
      kind: "transport",
      code: "unconfigured",
      message: "Phone number ID not configured",
    };
  }
  return graphRequest<any>({
    method: "GET",
    path: encodeURIComponent(creds.phoneNumberId),
    query: {
      fields: "display_phone_number,verified_name,quality_rating,code_verification_status,status",
    },
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}

/** Health status: GET /{node}?fields=health_status (MV-15). */
export async function getHealthStatus(node: string): Promise<GraphResult<any>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  return graphRequest<any>({
    method: "GET",
    path: encodeURIComponent(node),
    query: { fields: "health_status" },
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}

/** Subscribed apps: GET /{wabaId}/subscribed_apps (MV-15). */
export async function getSubscribedApps(): Promise<GraphResult<any>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  if (!creds.wabaId) {
    return {
      ok: false,
      kind: "transport",
      code: "unconfigured",
      message: "Messaging account ID not configured",
    };
  }
  return graphRequest<any>({
    method: "GET",
    path: `${creds.wabaId}/subscribed_apps`,
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}

/** Token scopes: GET /debug_token?input_token={token} (MV-15, DP-16). */
export async function debugToken(): Promise<GraphResult<any>> {
  const creds = await graphCreds();
  if (!creds.ok) return creds;
  return graphRequest<any>({
    method: "GET",
    path: "debug_token",
    query: { input_token: creds.accessToken },
    accessToken: creds.accessToken,
    apiVersion: creds.apiVersion,
  });
}
