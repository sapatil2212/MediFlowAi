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
//     (eventType='whatsapp', UNIQUE eventKey). Duplicate entries are skipped.
//
// Uses crypto.randomUUID() directly (NIT-4 — generateId in subscription-webhook
// is private). Inbound rows use tenantId='global' (NIT-3 sentinel).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { execute } from "./db";
import { resolveCloudConfig } from "./whatsapp-cloud";

export const WA_WEBHOOK_PATH = "/api/whatsapp/webhook";

const STATUS_RANK = ["queued", "sent", "delivered", "read"] as const;

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
  entry: { type: "status"; id: string; status: string } | { type: "inbound"; id: string },
): string {
  if (entry.type === "status") return `wa:${entry.id}:${entry.status}`;
  return `wa-in:${entry.id}`;
}

interface StatusEntry {
  type: "status";
  id: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
}

interface InboundEntry {
  type: "inbound";
  id: string;
  from: string;
}

type FlatEntry = StatusEntry | InboundEntry;

/** Flattens a Meta webhook payload into status + inbound entries. */
function flattenPayload(payload: any): { raw: any; entries: FlatEntry[] }[] {
  const out: { raw: any; entries: FlatEntry[] }[] = [];
  const topEntries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of topEntries) {
    const flat: FlatEntry[] = [];
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const statuses: any[] = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const s of statuses) {
        if (!s?.id || !s?.status) continue;
        const err = Array.isArray(s?.errors) ? s.errors[0] : null;
        flat.push({
          type: "status",
          id: String(s.id),
          status: String(s.status).toLowerCase(),
          errorCode: err?.code != null ? String(err.code) : null,
          errorMessage: err?.title || err?.message || null,
        });
      }
      const messages: any[] = Array.isArray(value?.messages) ? value.messages : [];
      for (const m of messages) {
        if (!m?.id) continue;
        flat.push({ type: "inbound", id: String(m.id), from: String(m.from || "") });
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

async function applyStatusEntry(entry: StatusEntry): Promise<void> {
  // Monotonic UPDATE keyed on metaMessageId. read→delivered never applies;
  // 'failed' is terminal; unknown wamid → 0 rows (still 200).
  await execute(
    `UPDATE WaMessageLog
        SET officialStatus = ?,
            status = CASE WHEN channel = 'official' THEN ? ELSE status END,
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
      entry.errorCode,
      entry.errorMessage,
      entry.errorCode,
      entry.errorMessage,
      entry.id,
      entry.status,
      entry.status,
    ],
  );
}

async function applyInboundEntry(entry: InboundEntry): Promise<void> {
  await execute(
    `INSERT INTO WaMessageLog
       (id, tenantId, direction, recipient, kind, channel, status, createdAt)
     VALUES (?, 'global', 'in', ?, 'inbound', 'official', 'delivered', NOW())`,
    [crypto.randomUUID(), entry.from],
  );
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
  for (const group of groups) {
    const rawPayload = JSON.stringify(group.raw).slice(0, 60000);
    for (const entry of group.entries) {
      const eventKey = buildEventKey(entry);
      // Per-entry idempotency: attempt an independent insert; duplicate → skip.
      try {
        await execute(
          `INSERT INTO WebhookEvent
             (id, eventKey, eventType, referenceId, signatureValid, status, rawPayload, createdAt)
           VALUES (?, ?, 'whatsapp', ?, 1, 'received', ?, NOW())`,
          [crypto.randomUUID(), eventKey, entry.id, rawPayload],
        );
      } catch {
        continue; // duplicate eventKey — already processed
      }

      try {
        if (entry.type === "status") {
          await applyStatusEntry(entry);
        } else {
          await applyInboundEntry(entry);
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

  return jsonResponse(200, { ok: true });
}

/** Routes the WhatsApp webhook by HTTP method. */
export async function handleWaWebhook(req: Request): Promise<Response> {
  if (req.method === "GET") return handleGet(req);
  if (req.method === "POST") return handlePost(req);
  return new Response("", { status: 405 });
}
