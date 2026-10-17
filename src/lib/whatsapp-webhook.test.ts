// @vitest-environment node
//
// Tests for whatsapp-webhook.ts. The pure pieces — signature verification,
// event-key building, and the monotonic status decision — are tested directly.
// The GET verify handshake and the POST invalid-HMAC rejection are tested
// through handleWaWebhook with resolveCloudConfig and the DB layer mocked, so no
// real network or database is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// Mock the Cloud config resolver and the DB execute so the handler is hermetic.
const resolveCloudConfigMock = vi.fn();
vi.mock("./whatsapp-cloud", () => ({
  resolveCloudConfig: (...args: any[]) => resolveCloudConfigMock(...args),
}));

const executeMock = vi.fn();
const insertedKeys = new Set<string>();
vi.mock("./db", () => ({
  execute: (...args: any[]) => executeMock(...args),
}));

import {
  verifyMetaWebhookSignature,
  buildEventKey,
  shouldApplyStatus,
  handleWaWebhook,
  WA_WEBHOOK_PATH,
} from "./whatsapp-webhook";

const APP_SECRET = "test-app-secret-value";
const VERIFY_TOKEN = "my-verify-token";

function sign(body: string, secret = APP_SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

beforeEach(() => {
  resolveCloudConfigMock.mockReset();
  executeMock.mockReset();
  insertedKeys.clear();
  resolveCloudConfigMock.mockResolvedValue({
    phoneNumberId: "123",
    wabaId: "456",
    accessToken: "tok",
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    apiVersion: "v20.0",
    isEnabled: true,
    source: "db",
  });
  // Default execute: simulate the WebhookEvent idempotency insert succeeding
  // once per eventKey, and throwing on a duplicate.
  executeMock.mockImplementation(async (sql: string, params: any[]) => {
    if (typeof sql === "string" && sql.includes("INSERT INTO WebhookEvent")) {
      const key = params[1];
      if (insertedKeys.has(key)) throw new Error("duplicate");
      insertedKeys.add(key);
    }
    return undefined;
  });
});

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
    const body = JSON.stringify({ entry: [] });
    const res = await handleWaWebhook(
      new Request(`https://x.test${WA_WEBHOOK_PATH}`, {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
        body,
      }),
    );
    expect(res.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns 200 on a valid HMAC", async () => {
    const body = JSON.stringify({ entry: [] });
    const res = await handleWaWebhook(
      new Request(`https://x.test${WA_WEBHOOK_PATH}`, {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body) },
        body,
      }),
    );
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
    const first = JSON.stringify(statusPayload("wamid.A", "sent"));
    await handleWaWebhook(
      new Request(`https://x.test${WA_WEBHOOK_PATH}`, {
        method: "POST",
        headers: { "x-hub-signature-256": sign(first) },
        body: first,
      }),
    );
    expect(insertedKeys.has("wa:wamid.A:sent")).toBe(true);

    executeMock.mockClear();

    // Batch with the already-seen entry + a new one.
    const batch = JSON.stringify({
      entry: [
        { changes: [{ value: { statuses: [{ id: "wamid.A", status: "sent" }] } }] },
        { changes: [{ value: { statuses: [{ id: "wamid.B", status: "delivered" }] } }] },
      ],
    });
    const res = await handleWaWebhook(
      new Request(`https://x.test${WA_WEBHOOK_PATH}`, {
        method: "POST",
        headers: { "x-hub-signature-256": sign(batch) },
        body: batch,
      }),
    );
    expect(res.status).toBe(200);
    expect(insertedKeys.has("wa:wamid.B:delivered")).toBe(true);

    // The duplicate 'wamid.A:sent' insert throws and is skipped: no status
    // UPDATE should run for it. The new one does run its UPDATE.
    const statusUpdates = executeMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("UPDATE WaMessageLog"),
    );
    expect(statusUpdates.length).toBe(1);
  });
});
