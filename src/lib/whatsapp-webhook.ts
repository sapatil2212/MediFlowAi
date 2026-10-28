// ─────────────────────────────────────────────────────────────────────────────
// whatsapp-webhook.ts  (server-only)
//
// Meta WhatsApp Cloud API webhook handler. Mounted BEFORE the TanStack handler
// in src/server.ts. Handles:
//   • GET  — the Meta verification handshake (hub.mode/hub.verify_token/hub.challenge)
//   • POST — delivery status callbacks + inbound messages
//
// Security:
//   • The X-Hub-Signature-256 HMAC is verified BEFORE any body parse or state
//     change. Invalid signature → 401, no side effects.
//   • A signature-valid POST always returns 200 so Meta does not storm retries.
//   • Each flattened entry is idempotent via the shared WebhookEvent table
//     (eventType='whatsapp', UNIQUE eventKey). Duplicate entries are skipped,
//     so a re-delivered inbound message never triggers a second auto-reply and
//     a re-delivered status never applies twice.
//
// Inbound messages:
//   • Stored with the tenantId of the business whose message the sender is
//     answering ('global' only when unresolved; see resolveInboundTenant in
//     wa-auto-reply.ts, which prefers the quoted wamid in messages[].context.id),
//     plus the text body for text messages.
//   • Eligible user messages get ONE plain-text auto-reply naming the business
//     (see wa-auto-reply.ts).
//
// Status callbacks:
//   • A 2xx from Meta on send means "accepted", not "delivered". Signed status
//     webhooks are authoritative for delivered/read/failed state. Outbound
//     notifications never fall back to whatsapp-web.js after any Cloud result.
//   • A 'failed' status whose wamid is not in WaMessageLog yet (the router's
//     wamid UPDATE may not have committed) is re-checked ONCE after
//     FAILED_STATUS_RECHECK_MS, in the background.
//   • delivered/read NULL the stored (encrypted) body of a tenant send: the
//     patient has the message, so any stale legacy body can be discarded.
//
// Background work (auto-reply and failed-status re-check) is fire-and-forget:
// fire-and-forget: it is never awaited inside the request, so Meta always gets
// a fast 200.
//
// Uses crypto.randomUUID() directly (NIT-4 — generateId in subscription-webhook
// is private).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { execute, queryOne } from "./db";
import { normalizeWaPhone, resolveCloudConfig } from "./whatsapp-cloud";
import { dispatchAutoReply, resolveInboundTenant, shouldAutoReply } from "./wa-auto-reply";
import { applyConsentKeyword, parseConsentKeyword } from "./notify-consent";

export const WA_WEBHOOK_PATH = "/api/whatsapp/webhook";

const STATUS_RANK = ["queued", "sent", "delivered", "read"] as const;

/** Inbound text stored in WaMessageLog.body is capped at Meta's text limit. */
const MAX_INBOUND_BODY = 4096;

/** Delay before the one-time re-check of a 'failed' status with an unknown wamid. */
export const FAILED_STATUS_RECHECK_MS = 5000;

// ── Background runner ─────────────────────────────────────────────────────────
// Tracks fire-and-forget work so tests can wait for it. The request handler
// NEVER awaits these promises.
const backgroundTasks = new Set<Promise<void>>();

function runInBackground(label: string, fn: () => Promise<unknown>): void {
  const task: Promise<void> = Promise.resolve()
    .then(fn)
    .then(() => undefined)
    .catch((err: any) => {
      console.error(`[WaWebhook] ${label} failed:`, err?.message);
    })
    .finally(() => {
      backgroundTasks.delete(task);
    });
  backgroundTasks.add(task);
}

/** Test helper: resolves once every tracked background task has settled. */
export async function drainWaBackgroundTasks(): Promise<void> {
  while (backgroundTasks.size > 0) {
    await Promise.allSettled([...backgroundTasks]);
  }
}

/**
 * Verifies a Meta webhook signature. The header is `sha256=<hex>` of
 * HMAC-SHA256(rawBody, appSecret). Constant-time compare; false on any missing
 * or malformed input.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  if (!header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  if (!provided) return false;
  try {
    const computed = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(computed, "utf8");
    const b = Buffer.from(provided, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Pure monotonic status decision. Returns true when `incoming` should overwrite
 * `current`:
 *   • a strictly higher rank (queued < sent < delivered < read) applies
 *   • 'failed' is always applied (terminal)
 *   • a lower/equal rank (e.g. read→delivered) is ignored
 */
export function shouldApplyStatus(current: string | null | undefined, incoming: string): boolean {
  if (incoming === "failed") return true;
  const incomingRank = (STATUS_RANK as readonly string[]).indexOf(incoming);
  if (incomingRank === -1) return false;
  const currentRank = (STATUS_RANK as readonly string[]).indexOf(current || "queued");
  return incomingRank > currentRank;
}

/** Builds the idempotency key for a flattened entry. */
export function buildEventKey(
  entry:
    | { type: "status"; id: string; status: string }
    | { type: "inbound"; id: string }
    | { type: "template"; field: string; metaTemplateId: string | null; entryTime: number },
): string {
  if (entry.type === "status") return `wa:${entry.id}:${entry.status}`;
  if (entry.type === "template") {
    return `wa-tpl:${entry.field}:${entry.metaTemplateId ?? "?"}:${entry.entryTime}`;
  }
  return `wa-in:${entry.id}`;
}

interface StatusEntry {
  type: "status";
  id: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  /** Meta's status timestamp (statuses[].timestamp, Unix seconds) in ms. */
  timestampMs: number | null;
}

interface InboundEntry {
  type: "inbound";
  id: string;
  from: string;
  /** Meta message type (text, image, reaction, ...). */
  msgType: string;
  /** Text body, only for type 'text'. */
  text: string | null;
  /** Our business display number from value.metadata. */
  displayPhone: string | null;
  /** wamid of the message being replied to (messages[].context.id), if any. */
  contextId: string | null;
}

/** A template-management field change (MV-13), routed by change.field. */
interface TemplateEntry {
  type: "template";
  field:
    | "message_template_status_update"
    | "message_template_quality_update"
    | "template_category_update"
    | "message_template_components_update";
  /** Meta's message_template_id (string form), when present. */
  metaTemplateId: string | null;
  name: string | null;
  language: string | null;
  /** entry.time (Unix seconds) — used for idempotency + the monotonic guard. */
  entryTime: number;
  /** The Messaging account (WABA) id = entry.id (MV-01). */
  entryId: string | null;
  value: any;
}

type FlatEntry = StatusEntry | InboundEntry | TemplateEntry;

const TEMPLATE_FIELDS = new Set([
  "message_template_status_update",
  "message_template_quality_update",
  "template_category_update",
  "message_template_components_update",
]);

/** Flattens a Meta webhook payload into status + inbound entries. */
function flattenPayload(payload: any): { raw: any; entries: FlatEntry[] }[] {
  const out: { raw: any; entries: FlatEntry[] }[] = [];
  const topEntries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of topEntries) {
    const flat: FlatEntry[] = [];
    const entryTime = Number(entry?.time) || 0;
    const entryId = entry?.id != null ? String(entry.id) : null;
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const field = change?.field != null ? String(change.field) : "";

      // Template-management fields (MV-13). Routed AFTER messages/statuses so the
      // existing message handling is untouched; a change carrying statuses or
      // messages is never treated as a template change.
      const statusesArr: any[] = Array.isArray(value?.statuses) ? value.statuses : [];
      const messagesArr: any[] = Array.isArray(value?.messages) ? value.messages : [];
      if (TEMPLATE_FIELDS.has(field) && statusesArr.length === 0 && messagesArr.length === 0) {
        flat.push({
          type: "template",
          field: field as TemplateEntry["field"],
          metaTemplateId:
            value?.message_template_id != null ? String(value.message_template_id) : null,
          name: value?.message_template_name != null ? String(value.message_template_name) : null,
          language:
            value?.message_template_language != null
              ? String(value.message_template_language)
              : null,
          entryTime,
          entryId,
          value,
        });
        continue;
      }

      const statuses: any[] = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const s of statuses) {
        if (!s?.id || !s?.status) continue;
        const err = Array.isArray(s?.errors) ? s.errors[0] : null;
        const ts = Number(s?.timestamp);
        flat.push({
          type: "status",
          id: String(s.id),
          status: String(s.status).toLowerCase(),
          errorCode: err?.code != null ? String(err.code) : null,
          errorMessage: err?.title || err?.message || null,
          timestampMs: Number.isFinite(ts) && ts > 0 ? ts * 1000 : null,
        });
      }
      const messages: any[] = Array.isArray(value?.messages) ? value.messages : [];
      const displayPhone =
        value?.metadata?.display_phone_number != null
          ? String(value.metadata.display_phone_number)
          : null;
      for (const m of messages) {
        if (!m?.id) continue;
        const msgType = String(m.type || "");
        flat.push({
          type: "inbound",
          id: String(m.id),
          from: String(m.from || ""),
          msgType,
          text: msgType === "text" && typeof m.text?.body === "string" ? m.text.body : null,
          displayPhone,
          contextId: m.context?.id != null ? String(m.context.id) : null,
        });
      }
    }
    out.push({ raw: entry, entries: flat });
  }
  return out;
}

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handleGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  const cfg = await resolveCloudConfig();
  const expected = cfg?.verifyToken || null;

  if (mode === "subscribe" && expected && token) {
    const a = Buffer.from(token, "utf8");
    const b = Buffer.from(expected, "utf8");
    let match = false;
    if (a.length === b.length) {
      try {
        match = crypto.timingSafeEqual(a, b);
      } catch {
        match = false;
      }
    }
    if (match) {
      return new Response(challenge, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
  }
  return new Response("", { status: 403 });
}

/** Reads whether a status wamid already exists. Throws on DB error. */
async function lookupStatusRow(wamid: string): Promise<any> {
  return queryOne<any>("SELECT id FROM WaMessageLog WHERE metaMessageId = ? LIMIT 1", [wamid]);
}

/**
 * Monotonic UPDATE keyed on metaMessageId. read→delivered never applies;
 * 'failed' is terminal; unknown wamid → 0 rows (still 200). delivered/read
 * also NULL the stored body of a tenant send (it can no longer fall back);
 * auto-reply rows keep their reply text.
 */
async function applyStatusUpdate(entry: StatusEntry): Promise<void> {
  await execute(
    `UPDATE WaMessageLog
        SET officialStatus = ?,
            status = CASE WHEN channel = 'official' THEN ? ELSE status END,
            body = CASE WHEN ? IN ('delivered','read') AND kind <> 'autoReply' THEN NULL ELSE body END,
            errorCode = COALESCE(?, errorCode),
            errorMessage = COALESCE(?, errorMessage),
            officialErrorCode = COALESCE(?, officialErrorCode),
            officialErrorMessage = COALESCE(?, officialErrorMessage),
            updatedAt = NOW()
      WHERE metaMessageId = ?
        AND ( FIELD(?, 'queued','sent','delivered','read')
                > FIELD(officialStatus, 'queued','sent','delivered','read')
              OR ? = 'failed' )`,
    [
      entry.status,
      entry.status,
      entry.status,
      entry.errorCode,
      entry.errorMessage,
      entry.errorCode,
      entry.errorMessage,
      entry.id,
      entry.status,
      entry.status,
    ],
  );
  await applyStatusTimestamps(entry);
  await applyEventStatus(entry);
}

const STATUS_TIMESTAMP_COLUMN: Record<string, string> = {
  sent: "sentAtMs",
  delivered: "deliveredAtMs",
  read: "readAtMs",
  failed: "failedAtMs",
};

/** Provider-reported status time on the message log (first report wins). */
async function applyStatusTimestamps(entry: StatusEntry): Promise<void> {
  const column = STATUS_TIMESTAMP_COLUMN[entry.status];
  if (!column) return;
  try {
    await execute(
      `UPDATE WaMessageLog SET ${column} = COALESCE(${column}, ?) WHERE metaMessageId = ?`,
      [entry.timestampMs ?? Date.now(), entry.id],
    );
  } catch {
    /* columns are added by notify-ddl; older schemas simply skip this */
  }
}

/**
 * Advances the notification event linked to this wamid. Monotonic (sent <
 * delivered < read; failed only before delivery), so out-of-order and duplicate
 * callbacks can never regress the state.
 */
async function applyEventStatus(entry: StatusEntry): Promise<boolean> {
  if (!["sent", "delivered", "read", "failed"].includes(entry.status)) return false;
  try {
    const { getNotifyRepo } = await import("./notify-repo");
    const repo = getNotifyRepo();
    const ev = await repo.findByProviderMessageId(entry.id);
    if (!ev) return false;
    let errorClass: any = null;
    let errorMessage: string | null = null;
    if (entry.status === "failed") {
      const { classifyMetaError } = await import("./wa-error-classify");
      const c = classifyMetaError({ code: entry.errorCode });
      errorClass = c.errorClass;
      errorMessage = `${c.hint}${entry.errorMessage ? ` (${entry.errorMessage})` : ""}`.slice(
        0,
        500,
      );
    }
    const atMs = entry.timestampMs ?? Date.now();
    const applied = await repo.applyDeliveryStatus({
      id: ev.id,
      status: entry.status as "sent" | "delivered" | "read" | "failed",
      atMs,
      errorCode: entry.errorCode,
      errorMessage,
      errorClass,
    });
    await repo.addAudit({
      tenantId: ev.tenantId,
      eventId: ev.id,
      action: applied ? `webhook_${entry.status}` : `webhook_${entry.status}_ignored`,
      actor: "meta_webhook",
      detail: applied
        ? { errorCode: entry.errorCode ?? null }
        : { reason: "out_of_order_or_duplicate", current: ev.status },
      atMs,
    });
    return true;
  } catch (err: any) {
    console.error("[WaWebhook] event status update failed:", err?.message);
    return false;
  }
}

/**
 * One-time delayed re-check of a 'failed' status whose wamid was not found:
 * the router writes the wamid only after Meta's response, so a very fast
 * 'failed' webhook can arrive first. Runs in the background only.
 */
async function recheckFailedStatus(entry: StatusEntry): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, FAILED_STATUS_RECHECK_MS));
  const row = await lookupStatusRow(entry.id);
  if (!row) return;
  await applyStatusUpdate(entry);
}

async function applyStatusEntry(entry: StatusEntry): Promise<void> {
  // Check whether the wamid exists before the status UPDATE: a very fast
  // callback (any status) can arrive before the sender stored the wamid, so it
  // is re-applied once in the background after a short delay.
  let prior: any = null;
  let lookedUp = false;
  try {
    prior = await lookupStatusRow(entry.id);
    lookedUp = true;
  } catch (err: any) {
    console.error("[WaWebhook] status row lookup error:", err?.message);
    prior = null;
  }

  await applyStatusUpdate(entry);

  if (lookedUp && !prior) {
    runInBackground("status recheck", () => recheckFailedStatus(entry));
  }
}

/**
 * Stores an inbound message under the tenant that last messaged this sender
 * ('global' when unresolved). Returns the resolved tenantId (or null).
 */
async function applyInboundEntry(entry: InboundEntry): Promise<string | null> {
  const tenantId = await resolveInboundTenant(entry.from, entry.contextId);
  await execute(
    `INSERT INTO WaMessageLog
       (id, tenantId, direction, recipient, kind, channel, status, body, createdAt)
     VALUES (?, ?, 'in', ?, 'inbound', 'official', 'delivered', ?, NOW())`,
    [
      crypto.randomUUID(),
      tenantId ?? "global",
      normalizeWaPhone(entry.from),
      entry.text ? entry.text.slice(0, MAX_INBOUND_BODY) : null,
    ],
  );
  return tenantId;
}

/**
 * Applies a template-field change (§14, MV-13): ignores a change whose entry.id
 * is not the configured Messaging account ID (MV-01), delegates the state write
 * to wa-template-sync.applyWebhookChange (match → monotonic guard → apply), and
 * invalidates the runtime mapping cache when a mapped template became
 * ineligible so the next send falls back to text. A DB failure throws so the
 * caller marks the WebhookEvent 'error' (a Meta retry reprocesses it); 200.
 */
async function applyTemplateEntry(entry: TemplateEntry): Promise<void> {
  // Ignore template changes for a different Messaging account (MV-01).
  const cfg = await resolveCloudConfig();
  if (cfg?.wabaId && entry.entryId && entry.entryId !== cfg.wabaId) {
    return;
  }
  const { applyWebhookChange } = await import("./wa-template-sync");
  const result = await applyWebhookChange({
    field: entry.field,
    metaTemplateId: entry.metaTemplateId,
    name: entry.name,
    language: entry.language,
    entryTime: entry.entryTime,
    value: entry.value,
  });
  if (result.applied && result.mappingInvalidated) {
    try {
      const { invalidateMappingCache } = await import("./wa-template-notify");
      invalidateMappingCache();
    } catch {
      /* the gate may not be loaded; the TTL cache will refresh anyway */
    }
  }
}

async function handlePost(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const cfg = await resolveCloudConfig();
  const appSecret = cfg?.appSecret || "";

  // Verify signature BEFORE any parse or state change.
  if (!verifyMetaWebhookSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret)) {
    console.warn("[WaWebhook] Rejected webhook: invalid signature");
    return jsonResponse(401, { ok: false, error: "invalid signature" });
  }

  let payload: any = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonResponse(200, { ok: true, ignored: "unparseable body" });
  }

  const groups = flattenPayload(payload);
  let storageFailed = false;
  for (const group of groups) {
    const rawPayload = JSON.stringify(group.raw).slice(0, 60000);
    for (const entry of group.entries) {
      const eventKey = buildEventKey(entry);
      const referenceId = entry.type === "template" ? (entry.metaTemplateId ?? eventKey) : entry.id;
      // Per-entry idempotency: an independent insert. A duplicate is skipped
      // unless its earlier processing errored (then it is claimed and retried);
      // any other storage error makes Meta redeliver the payload later.
      const claim = await claimWebhookEvent(eventKey, referenceId, rawPayload);
      if (claim === "duplicate") continue;
      if (claim === "storage_error") {
        storageFailed = true;
        continue;
      }

      try {
        if (entry.type === "status") {
          await applyStatusEntry(entry);
        } else if (entry.type === "template") {
          await applyTemplateEntry(entry);
        } else {
          const tenantId = await applyInboundEntry(entry);
          const keyword = entry.msgType === "text" ? parseConsentKeyword(entry.text) : null;
          if (keyword && shouldAutoReply(entry)) {
            const from = entry.from;
            // STOP / START: record the platform-wide choice and confirm it once.
            runInBackground("consent keyword", () => handleConsentKeyword(from, keyword, tenantId));
          } else if (shouldAutoReply(entry)) {
            const from = entry.from;
            // Fire-and-forget: never awaited, so the 200 goes back immediately.
            runInBackground("auto-reply", () => dispatchAutoReply({ from, tenantId }));
          }
        }
        await execute("UPDATE WebhookEvent SET status = 'processed' WHERE eventKey = ?", [
          eventKey,
        ]).catch(() => {});
      } catch (err: any) {
        console.error("[WaWebhook] entry processing error:", err?.message);
        await execute("UPDATE WebhookEvent SET status = 'error' WHERE eventKey = ?", [
          eventKey,
        ]).catch(() => {});
      }
    }
  }

  if (storageFailed) {
    // Nothing for these entries was recorded: ask Meta to redeliver.
    return jsonResponse(503, { ok: false, error: "temporarily unable to store webhook" });
  }
  return jsonResponse(200, { ok: true });
}

/** Age after which a 'received' (never finished) webhook entry may be retried. */
const STUCK_WEBHOOK_MS = 5 * 60_000;

/**
 * Records a webhook entry exactly once. Returns "new" to process it, "retry"
 * when an earlier attempt errored (or stalled) and this delivery claimed it,
 * "duplicate" to skip, or "storage_error" when the database is unavailable.
 */
async function claimWebhookEvent(
  eventKey: string,
  referenceId: string,
  rawPayload: string,
): Promise<"new" | "retry" | "duplicate" | "storage_error"> {
  try {
    await execute(
      `INSERT INTO WebhookEvent
         (id, eventKey, eventType, referenceId, signatureValid, status, rawPayload, createdAt)
       VALUES (?, ?, 'whatsapp', ?, 1, 'received', ?, NOW())`,
      [crypto.randomUUID(), eventKey, referenceId, rawPayload],
    );
    return "new";
  } catch (err: any) {
    if (!(err?.errno === 1062 || err?.code === "ER_DUP_ENTRY")) {
      console.error("[WaWebhook] could not record webhook entry:", err?.message);
      return "storage_error";
    }
  }
  try {
    const res = await execute(
      `UPDATE WebhookEvent SET status = 'received'
        WHERE eventKey = ?
          AND (status = 'error'
               OR (status = 'received' AND createdAt < NOW() - INTERVAL ? SECOND))`,
      [eventKey, Math.round(STUCK_WEBHOOK_MS / 1000)],
    );
    return res.affectedRows > 0 ? "retry" : "duplicate";
  } catch {
    return "duplicate";
  }
}

/** Applies a STOP/START keyword and sends one in-window confirmation. */
async function handleConsentKeyword(
  from: string,
  keyword: "stop" | "start",
  tenantId: string | null,
): Promise<void> {
  const reply = await applyConsentKeyword({ from, keyword });
  if (!reply) return;
  const phone = normalizeWaPhone(from);
  const { isCloudAvailable, isOfficialRecipientAllowed, sendTextMessage } =
    await import("./whatsapp-cloud");
  if (!(await isCloudAvailable()) || !isOfficialRecipientAllowed(phone)) return;
  // The customer just messaged us, so the 24-hour service window is open and a
  // free-form reply is permitted for this one confirmation.
  const logId = crypto.randomUUID();
  await execute(
    `INSERT INTO WaMessageLog
       (id, tenantId, direction, recipient, kind, channel, status, officialAttempted, body, createdAt)
     VALUES (?, ?, 'out', ?, 'consentReply', 'official', 'queued', 1, ?, NOW())`,
    [logId, tenantId || "global", phone, reply],
  );
  const result = await sendTextMessage({ to: phone, body: reply });
  await execute(
    result.ok
      ? "UPDATE WaMessageLog SET status = 'sent', officialStatus = 'sent', metaMessageId = ?, updatedAt = NOW() WHERE id = ?"
      : "UPDATE WaMessageLog SET status = 'failed', officialStatus = 'failed', errorCode = ?, updatedAt = NOW() WHERE id = ?",
    [
      result.ok ? result.messageId : result.kind === "meta_error" ? result.code : "transport",
      logId,
    ],
  );
}

/** Routes the WhatsApp webhook by HTTP method. */
export async function handleWaWebhook(req: Request): Promise<Response> {
  if (req.method === "GET") return handleGet(req);
  if (req.method === "POST") return handlePost(req);
  return new Response("", { status: 405 });
}
