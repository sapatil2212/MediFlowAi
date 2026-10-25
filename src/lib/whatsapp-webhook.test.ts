// @vitest-environment node
//
// Tests for whatsapp-webhook.ts. The pure pieces — signature verification,
// event-key building, and the monotonic status decision — are tested directly.
// The GET handshake, POST signature enforcement, inbound tenant resolution +
// auto-reply, and the async 'failed'-status Web fallback are tested through
// handleWaWebhook with the DB, the Cloud API client and the Web channel mocked,
// so no real network, database or Meta Graph API call is made.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { encryptSecret } from "./wa-crypto";

// ── Mocks ────────────────────────────────────────────────────────────────────

const resolveCloudConfigMock = vi.fn();
const isCloudAvailableMock = vi.fn();
const sendTextMessageMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  resolveCloudConfig: (...args: any[]) => resolveCloudConfigMock(...args),
  isCloudAvailable: (...args: any[]) => isCloudAvailableMock(...args),
  sendTextMessage: (...args: any[]) => sendTextMessageMock(...args),
}));

const executeMock = vi.fn();
const queryMock = vi.fn();
const queryOneMock = vi.fn();
const insertedKeys = new Set<string>();
vi.mock("./db", () => ({
  execute: (...args: any[]) => executeMock(...args),
  query: (...args: any[]) => queryMock(...args),
  queryOne: (...args: any[]) => queryOneMock(...args),
}));

const isWhatsAppReadyMock = vi.fn();
vi.mock("./appointment-notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./appointment-notify")>()),
  isWhatsAppReady: (...args: any[]) => isWhatsAppReadyMock(...args),
}));

const enqueueWAMock = vi.fn();
vi.mock("./whatsapp", () => ({
  enqueueWA: (...args: any[]) => enqueueWAMock(...args),
  getWAStatus: vi.fn(async () => ({ state: "DISCONNECTED" })),
}));

import {
  verifyMetaWebhookSignature,
  buildEventKey,
  shouldApplyStatus,
  handleWaWebhook,
  drainWaBackgroundTasks,
  FAILED_STATUS_RECHECK_MS,
  WA_WEBHOOK_PATH,
} from "./whatsapp-webhook";

/** Test-only AES key (hex, 32 bytes) for WA_CLOUD_ENC_KEY. */
const TEST_KEY_HEX = "b2".repeat(32);
const seal = (plain: string) => encryptSecret(plain, Buffer.from(TEST_KEY_HEX, "hex"));
const APP_SECRET = "test-app-secret-value";
const VERIFY_TOKEN = "my-verify-token";
const OUR_NUMBER = "15550001111";
const GENERIC =
  "This is an automated BookMyTime notification number and cannot receive replies. Please contact the business you booked with directly.";

function sign(body: string, secret = APP_SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function post(payload: unknown, signature?: string): Promise<Response> {
  const body = JSON.stringify(payload);
  return handleWaWebhook(
    new Request(`https://x.test${WA_WEBHOOK_PATH}`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature ?? sign(body) },
      body,
    }),
  );
}

/** Per-test queryOne answers, routed by SQL substring. */
let routes: {
  /** Tenant lookup by the quoted wamid (messages[].context.id). */
  context?: any;
  /** Newest outbound row that left the shared number (official, wamid, not failed). */
  latestOfficial?: any;
  /** Newest outbound row of any channel (last-resort tier). */
  latestAny?: any;
  cooldown?: any;
  profile?: any;
  user?: any;
  prior?: any;
  /** Successive answers for the failed-status row lookup (overrides `prior`). */
  priorSeq?: any[];
};
/** affectedRows returned by the async-fallback claim UPDATE. */
let claimAffectedRows = 1;

function sqlCalls(fragment: string) {
  return executeMock.mock.calls.filter((c) => typeof c[0] === "string" && c[0].includes(fragment));
}

beforeEach(() => {
  resolveCloudConfigMock.mockReset();
  isCloudAvailableMock.mockReset();
  sendTextMessageMock.mockReset();
  executeMock.mockReset();
  queryMock.mockReset();
  queryOneMock.mockReset();
  isWhatsAppReadyMock.mockReset();
  enqueueWAMock.mockReset();
  insertedKeys.clear();
  routes = {};
  claimAffectedRows = 1;

  resolveCloudConfigMock.mockResolvedValue({
    phoneNumberId: "123",
    wabaId: "456",
    accessToken: "tok",
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    apiVersion: "v21.0",
    isEnabled: true,
    source: "db",
  });
  isCloudAvailableMock.mockResolvedValue(true);
  sendTextMessageMock.mockResolvedValue({ ok: true, messageId: "wamid.REPLY" });
  isWhatsAppReadyMock.mockResolvedValue(true);
  enqueueWAMock.mockResolvedValue({ success: true });
  queryMock.mockResolvedValue([]);

  queryOneMock.mockImplementation(async (sql: string) => {
    if (sql.includes("kind = 'autoReply'")) return routes.cooldown ?? null;
    if (sql.includes("WHERE metaMessageId = ?")) {
      if (routes.priorSeq) return routes.priorSeq.shift() ?? null;
      return routes.prior ?? null;
    }
    if (sql.includes("AND metaMessageId = ?")) return routes.context ?? null;
    if (sql.includes("FROM ClinicProfile")) return routes.profile ?? null;
    if (sql.includes("FROM User")) return routes.user ?? null;
    if (sql.includes("ORDER BY createdAt DESC") && sql.includes("channel = 'official'")) {
      return routes.latestOfficial ?? null;
    }
    if (sql.includes("ORDER BY createdAt DESC")) return routes.latestAny ?? null;
    return null;
  });

  // Default execute: simulate the WebhookEvent idempotency insert succeeding
  // once per eventKey, and throwing on a duplicate.
  executeMock.mockImplementation(async (sql: string, params: any[]) => {
    if (typeof sql === "string" && sql.includes("INSERT INTO WebhookEvent")) {
      const key = params[1];
      if (insertedKeys.has(key)) throw new Error("duplicate");
      insertedKeys.add(key);
    }
    if (typeof sql === "string" && sql.includes("SET webFallbackAttempted = 1")) {
      return { affectedRows: claimAffectedRows, insertId: null };
    }
    return { affectedRows: 1, insertId: null };
  });

  vi.stubEnv("WA_CLOUD_ENC_KEY", TEST_KEY_HEX);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("verifyMetaWebhookSignature", () => {
  it("accepts a correct sha256=<hex> over the raw body", () => {
    const body = JSON.stringify({ a: 1 });
    expect(verifyMetaWebhookSignature(body, sign(body), APP_SECRET)).toBe(true);
  });

  it("rejects a wrong secret, altered body, and bad headers", () => {
    const body = JSON.stringify({ a: 1 });
    expect(verifyMetaWebhookSignature(body, sign(body, "other"), APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body + "x", sign(body), APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body, null, APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body, "md5=abc", APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body, "sha256=", APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body, "sha256=abcd", APP_SECRET)).toBe(false); // length mismatch
    expect(verifyMetaWebhookSignature(body, sign(body), "")).toBe(false);
  });

  it("property: any single-byte mutation of the signature fails", () => {
    const body = JSON.stringify({ event: "x" });
    const good = sign(body).slice("sha256=".length);
    const buf = Buffer.from(good, "hex");
    const i = 0;
    const mutated = Buffer.from(buf);
    mutated[i] = mutated[i] ^ 0x01;
    expect(verifyMetaWebhookSignature(body, "sha256=" + mutated.toString("hex"), APP_SECRET)).toBe(
      false,
    );
  });
});

describe("buildEventKey", () => {
  it("formats status and inbound keys", () => {
    expect(buildEventKey({ type: "status", id: "wamid.X", status: "delivered" })).toBe(
      "wa:wamid.X:delivered",
    );
    expect(buildEventKey({ type: "inbound", id: "wamid.Y" })).toBe("wa-in:wamid.Y");
  });
});

describe("shouldApplyStatus", () => {
  it("applies strictly higher ranks and never regresses read→delivered", () => {
    expect(shouldApplyStatus("queued", "sent")).toBe(true);
    expect(shouldApplyStatus("sent", "delivered")).toBe(true);
    expect(shouldApplyStatus("delivered", "read")).toBe(true);
    expect(shouldApplyStatus("read", "delivered")).toBe(false);
    expect(shouldApplyStatus("delivered", "sent")).toBe(false);
    expect(shouldApplyStatus("sent", "sent")).toBe(false);
  });

  it("always applies 'failed' (terminal) and handles null current", () => {
    expect(shouldApplyStatus("read", "failed")).toBe(true);
    expect(shouldApplyStatus(null, "failed")).toBe(true);
    expect(shouldApplyStatus(null, "sent")).toBe(true);
    expect(shouldApplyStatus(undefined, "queued")).toBe(false);
  });
});

// ── GET / signature / idempotency ────────────────────────────────────────────

describe("GET verify handshake", () => {
  it("echoes the challenge on a correct verify_token", async () => {
    const url = `https://x.test${WA_WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CHALLENGE_123`;
    const res = await handleWaWebhook(new Request(url, { method: "GET" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("CHALLENGE_123");
  });

  it("returns 403 on a wrong verify_token", async () => {
    const url = `https://x.test${WA_WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=CHALLENGE_123`;
    const res = await handleWaWebhook(new Request(url, { method: "GET" }));
    expect(res.status).toBe(403);
  });
});

describe("POST signature enforcement", () => {
  it("returns 401 and changes no state on an invalid HMAC", async () => {
    const res = await post(inboundPayload({ id: "wamid.BAD" }), "sha256=deadbeef");
    expect(res.status).toBe(401);
    await drainWaBackgroundTasks();
    expect(executeMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(queryOneMock).not.toHaveBeenCalled();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });

  it("returns 200 on a valid HMAC", async () => {
    const res = await post({ entry: [] });
    expect(res.status).toBe(200);
  });
});

describe("per-entry idempotency", () => {
  function statusPayload(id: string, status: string) {
    return {
      entry: [{ changes: [{ value: { statuses: [{ id, status }] } }] }],
    };
  }

  it("processes a new entry and skips a duplicate within a mixed batch", async () => {
    // First deliver a status so its eventKey is 'seen'.
    await post(statusPayload("wamid.A", "sent"));
    expect(insertedKeys.has("wa:wamid.A:sent")).toBe(true);

    executeMock.mockClear();

    // Batch with the already-seen entry + a new one.
    const res = await post({
      entry: [
        { changes: [{ value: { statuses: [{ id: "wamid.A", status: "sent" }] } }] },
        { changes: [{ value: { statuses: [{ id: "wamid.B", status: "delivered" }] } }] },
      ],
    });
    expect(res.status).toBe(200);
    expect(insertedKeys.has("wa:wamid.B:delivered")).toBe(true);

    // The duplicate 'wamid.A:sent' insert throws and is skipped: no status
    // UPDATE should run for it. The new one does run its UPDATE.
    const statusUpdates = sqlCalls("UPDATE WaMessageLog");
    expect(statusUpdates.length).toBe(1);
    // Non-failed statuses never read the row.
    expect(
      queryOneMock.mock.calls.filter((c) => String(c[0]).includes("WHERE metaMessageId = ?")),
    ).toEqual([]);
  });
});

describe("status UPDATE clears the stored body once the patient has the message", () => {
  const BODY_CASE =
    "body = CASE WHEN ? IN ('delivered','read') AND kind <> 'autoReply' THEN NULL ELSE body END";

  function statusPayload(id: string, status: string) {
    return { entry: [{ changes: [{ value: { statuses: [{ id, status }] } }] }] };
  }

  for (const status of ["delivered", "read"]) {
    it(`NULLs the body on '${status}' (tenant sends only, auto-replies keep theirs)`, async () => {
      await post(statusPayload(`wamid.${status}`, status));
      const updates = sqlCalls("FIELD(?, 'queued','sent','delivered','read')");
      expect(updates.length).toBe(1);
      expect(updates[0][0]).toContain(BODY_CASE);
      expect(updates[0][1][2]).toBe(status); // the CASE's status param
      expect(updates[0][1][7]).toBe(`wamid.${status}`); // still keyed on the wamid
    });
  }

  it("keeps the body on 'sent' (the row may still fall back)", async () => {
    await post(statusPayload("wamid.S", "sent"));
    const updates = sqlCalls("FIELD(?, 'queued','sent','delivered','read')");
    expect(updates[0][1][2]).toBe("sent");
  });
});

// ── Inbound: tenant resolution + auto-reply ─────────────────────────────────

function inboundPayload(opts: {
  id: string;
  from?: string;
  type?: string;
  text?: string;
  displayPhone?: string;
  /** wamid being swipe-replied to (messages[].context.id). */
  contextId?: string;
}) {
  const type = opts.type ?? "text";
  const message: any = {
    id: opts.id,
    from: opts.from ?? "918830553868",
    timestamp: "1760000000",
    type,
  };
  if (opts.contextId) message.context = { from: OUR_NUMBER, id: opts.contextId };
  if (type === "text") message.text = { body: opts.text ?? "Hi, is my appointment confirmed?" };
  if (type === "reaction") message.reaction = { message_id: "wamid.OUT", emoji: "👍" };
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: opts.displayPhone ?? OUR_NUMBER,
                phone_number_id: "123",
              },
              contacts: [{ wa_id: opts.from ?? "918830553868", profile: { name: "Asha" } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

function inboundInserts() {
  return sqlCalls("INSERT INTO WaMessageLog").filter((c) => c[0].includes("'in'"));
}
function autoReplyInserts() {
  return sqlCalls("INSERT INTO WaMessageLog").filter((c) => c[0].includes("'autoReply'"));
}

describe("inbound messages", () => {
  it("stores the message under the tenant of the latest outbound log and replies with the generic text", async () => {
    routes.latestOfficial = { tenantId: "t1" };
    routes.profile = { clinicName: "Sunrise Clinic", whatsappNo: "9876500000" };

    const res = await post(inboundPayload({ id: "wamid.IN1" }));
    expect(res.status).toBe(200);
    await drainWaBackgroundTasks();

    const resolution = queryOneMock.mock.calls.find((c) =>
      String(c[0]).includes("ORDER BY createdAt DESC"),
    )!;
    expect(resolution[0]).toContain("direction = 'out'");
    expect(resolution[0]).toContain("channel = 'official'");
    expect(resolution[1]).toContain("918830553868");

    // The inbound message is still attributed to the resolved tenant for the
    // tenant's own Monitoring view…
    const inbound = inboundInserts();
    expect(inbound.length).toBe(1);
    expect(inbound[0][1].slice(1)).toEqual([
      "t1",
      "918830553868",
      "Hi, is my appointment confirmed?",
    ]);

    // …but the REPLY is always the generic notification-only text — the
    // business name/contact is never disclosed on the shared number.
    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    const { to, body } = sendTextMessageMock.mock.calls[0][0];
    expect(to).toBe("918830553868");
    expect(body).toBe(GENERIC);

    const ar = autoReplyInserts();
    expect(ar.length).toBe(1);
    expect(ar[0][1][1]).toBe("t1");
    expect(ar[0][0]).toContain("'official'");
  });

  it("uses tenant 'global' and the generic text when the sender is unresolved", async () => {
    await post(inboundPayload({ id: "wamid.IN2" }));
    await drainWaBackgroundTasks();

    expect(inboundInserts()[0][1][1]).toBe("global");
    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    expect(sendTextMessageMock.mock.calls[0][0].body).toBe(GENERIC);
    expect(autoReplyInserts()[0][1][1]).toBe("global");
  });

  it("attributes the message to the tenant whose message left the shared number, not a later Web/failed row", async () => {
    // tA's message went out on the shared number; tB's later one went out from
    // tB's own Web number (or failed). The official tier answers first.
    routes.latestOfficial = { tenantId: "tA" };
    routes.latestAny = { tenantId: "tB" };
    routes.profile = { clinicName: "Clinic A", whatsappNo: "9000000001" };

    await post(inboundPayload({ id: "wamid.ATTR1" }));
    await drainWaBackgroundTasks();

    // Attribution (for the tenant's Monitoring view) resolves to tA…
    expect(inboundInserts()[0][1][1]).toBe("tA");
    expect(autoReplyInserts()[0][1][1]).toBe("tA");
    // …while the reply itself stays generic.
    expect(sendTextMessageMock.mock.calls[0][0].body).toBe(GENERIC);
    const officialTier = queryOneMock.mock.calls.find(
      (c) => String(c[0]).includes("ORDER BY") && String(c[0]).includes("channel = 'official'"),
    )!;
    expect(officialTier[0]).toContain("metaMessageId IS NOT NULL");
    expect(officialTier[0]).toContain("officialStatus <> 'failed'");
  });

  it("falls back to the newest outbound row of any channel when none left the shared number", async () => {
    routes.latestAny = { tenantId: "tB" };
    await post(inboundPayload({ id: "wamid.ATTR2" }));
    await drainWaBackgroundTasks();
    expect(inboundInserts()[0][1][1]).toBe("tB");
  });

  it("resolves the tenant from messages[].context.id (the quoted wamid) first", async () => {
    routes.context = { tenantId: "tC" };
    routes.latestOfficial = { tenantId: "tA" };
    routes.profile = { clinicName: "Clinic C", whatsappNo: "9000000003" };

    await post(inboundPayload({ id: "wamid.CTX1", contextId: "wamid.OUT.C" }));
    await drainWaBackgroundTasks();

    expect(inboundInserts()[0][1][1]).toBe("tC");
    expect(autoReplyInserts()[0][1][1]).toBe("tC");
    const ctxLookup = queryOneMock.mock.calls.find((c) =>
      String(c[0]).includes("AND metaMessageId = ?"),
    )!;
    expect(ctxLookup[1]).toEqual(["wamid.OUT.C", "918830553868", "8830553868"]);
    // Exact match found: the newest-outbound tiers are not consulted.
    expect(queryOneMock.mock.calls.some((c) => String(c[0]).includes("ORDER BY"))).toBe(false);
  });

  it("uses the newest shared-number row when the quoted wamid is unknown", async () => {
    routes.latestOfficial = { tenantId: "tA" };
    await post(inboundPayload({ id: "wamid.CTX2", contextId: "wamid.UNKNOWN" }));
    await drainWaBackgroundTasks();
    expect(inboundInserts()[0][1][1]).toBe("tA");
  });

  it("stores a reaction but does not reply", async () => {
    routes.latestOfficial = { tenantId: "t1" };
    await post(inboundPayload({ id: "wamid.IN3", type: "reaction" }));
    await drainWaBackgroundTasks();

    const inbound = inboundInserts();
    expect(inbound.length).toBe(1);
    expect(inbound[0][1][3]).toBeNull(); // no text body for a reaction
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("does not reply to our own display number", async () => {
    await post(
      inboundPayload({ id: "wamid.IN4", from: OUR_NUMBER, displayPhone: "+1 555-000-1111" }),
    );
    await drainWaBackgroundTasks();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("suppresses a second reply within the 6h cooldown", async () => {
    routes.cooldown = { id: "earlier-auto-reply" };
    await post(inboundPayload({ id: "wamid.IN5" }));
    await drainWaBackgroundTasks();
    expect(inboundInserts().length).toBe(1);
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("does not reply twice to a re-delivered message (same message id)", async () => {
    const payload = inboundPayload({ id: "wamid.DUP" });
    await post(payload);
    await drainWaBackgroundTasks();
    await post(payload);
    await drainWaBackgroundTasks();

    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    expect(inboundInserts().length).toBe(1);
  });

  it("does not reply when the Cloud API is unavailable, but still stores the message", async () => {
    isCloudAvailableMock.mockResolvedValue(false);
    await post(inboundPayload({ id: "wamid.IN6" }));
    await drainWaBackgroundTasks();
    expect(inboundInserts().length).toBe(1);
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("returns 200 without waiting for the auto-reply send", async () => {
    let release!: (v: unknown) => void;
    sendTextMessageMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const res = await post(inboundPayload({ id: "wamid.FAST" }));
    expect(res.status).toBe(200);

    // The send starts in the background and is still pending after the response.
    await vi.waitFor(() => expect(sendTextMessageMock).toHaveBeenCalledTimes(1));
    expect(sqlCalls("metaMessageId = ?").length).toBe(0);

    release({ ok: true, messageId: "wamid.LATE" });
    await drainWaBackgroundTasks();
    const done = sqlCalls("metaMessageId = ?");
    expect(done.length).toBe(1);
    expect(done[0][1][0]).toBe("wamid.LATE");
  });
});

// ── Async Web fallback on a 'failed' status ──────────────────────────────────

describe("async Web fallback", () => {
  const JOIN_BODY = "Join your video consultation:\nhttps://app.test/consult/TOKEN_abc123";
  // WaMessageLog.body holds the ENCRYPTED body (see whatsapp-router.ts).
  const PRIOR = {
    id: "log1",
    tenantId: "t1",
    direction: "out",
    recipient: "918830553868",
    kind: "booked",
    channel: "official",
    body: seal(JOIN_BODY),
    officialStatus: "sent",
    webFallbackAttempted: 0,
  };

  function statusLookups() {
    return queryOneMock.mock.calls.filter((c) => String(c[0]).includes("WHERE metaMessageId = ?"));
  }

  function failedPayload(id = "wamid.OUT1") {
    return {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id,
                    status: "failed",
                    errors: [{ code: 131047, title: "Re-engagement message" }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  it("sends the decrypted stored body via Web once and keeps the monotonic status UPDATE", async () => {
    routes.prior = { ...PRIOR };
    const res = await post(failedPayload());
    expect(res.status).toBe(200);
    await drainWaBackgroundTasks();

    expect(sqlCalls("FIELD(?, 'queued','sent','delivered','read')").length).toBe(1);
    const claim = sqlCalls("SET webFallbackAttempted = 1");
    expect(claim.length).toBe(1);
    expect(claim[0][0]).toContain("body = NULL"); // body cleared when the claim is taken
    expect(enqueueWAMock).toHaveBeenCalledTimes(1);
    expect(enqueueWAMock).toHaveBeenCalledWith("t1", "918830553868", JOIN_BODY);
    expect(sqlCalls("SET channel = 'web', status = 'sent'").length).toBe(1);

    // The plaintext join link never goes to the DB.
    for (const c of executeMock.mock.calls) {
      for (const p of Array.isArray(c[1]) ? c[1] : []) {
        if (typeof p === "string") expect(p).not.toContain("/consult/");
      }
    }
  });

  it("does not fall back twice for a re-delivered 'failed' webhook", async () => {
    routes.prior = { ...PRIOR };
    const payload = failedPayload();
    await post(payload);
    await drainWaBackgroundTasks();
    await post(payload);
    await drainWaBackgroundTasks();
    expect(enqueueWAMock).toHaveBeenCalledTimes(1);
  });

  it("does not send when the atomic claim loses (affectedRows 0)", async () => {
    routes.prior = { ...PRIOR };
    claimAffectedRows = 0;
    await post(failedPayload("wamid.OUT2"));
    await drainWaBackgroundTasks();
    expect(sqlCalls("SET webFallbackAttempted = 1").length).toBe(1);
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });

  it("never falls back for an auto-reply row", async () => {
    routes.prior = { ...PRIOR, kind: "autoReply" };
    await post(failedPayload("wamid.OUT3"));
    await drainWaBackgroundTasks();
    expect(sqlCalls("SET webFallbackAttempted = 1").length).toBe(0);
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });

  it("does not send or mark sent when Web is not connected", async () => {
    routes.prior = { ...PRIOR };
    isWhatsAppReadyMock.mockResolvedValue(false);
    await post(failedPayload("wamid.OUT4"));
    await drainWaBackgroundTasks();
    expect(enqueueWAMock).not.toHaveBeenCalled();
    expect(sqlCalls("status = 'sent'").length).toBe(0);
  });

  it("does not fall back when the message was already delivered", async () => {
    routes.prior = { ...PRIOR, officialStatus: "delivered" };
    await post(failedPayload("wamid.OUT5"));
    await drainWaBackgroundTasks();
    expect(sqlCalls("SET webFallbackAttempted = 1").length).toBe(0);
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });

  it("re-checks an unknown-wamid 'failed' once after a delay and falls back if the row appeared", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    // 1st lookup: the router's wamid UPDATE hasn't committed yet. 2nd: it has.
    routes.priorSeq = [null, { ...PRIOR }];

    const res = await post(failedPayload("wamid.RACE"));
    expect(res.status).toBe(200);
    expect(statusLookups().length).toBe(1);
    expect(enqueueWAMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1); // the re-check is scheduled, not awaited

    await vi.advanceTimersByTimeAsync(FAILED_STATUS_RECHECK_MS);
    await drainWaBackgroundTasks();
    vi.useRealTimers();

    expect(statusLookups().length).toBe(2);
    // Status UPDATE re-applied now that the wamid exists.
    expect(sqlCalls("FIELD(?, 'queued','sent','delivered','read')").length).toBe(2);
    expect(sqlCalls("SET webFallbackAttempted = 1").length).toBe(1);
    expect(enqueueWAMock).toHaveBeenCalledTimes(1);
    expect(enqueueWAMock).toHaveBeenCalledWith("t1", "918830553868", JOIN_BODY);
  });

  it("re-checks an unknown-wamid 'failed' only once and does nothing if it is still unknown", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    routes.priorSeq = [null, null];

    await post(failedPayload("wamid.GHOST"));
    await vi.advanceTimersByTimeAsync(FAILED_STATUS_RECHECK_MS);
    await drainWaBackgroundTasks();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();

    expect(statusLookups().length).toBe(2);
    expect(sqlCalls("FIELD(?, 'queued','sent','delivered','read')").length).toBe(1);
    expect(sqlCalls("SET webFallbackAttempted = 1").length).toBe(0);
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });
});
