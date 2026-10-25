// @vitest-environment node
//
// Tests for whatsapp-router.ts in plain-text mode. The DB, the Cloud API
// client, the Web readiness check and the Web enqueue are all mocked: no real
// network, database or Meta Graph API call is made. The real normalizeWaPhone
// is kept so recipient normalization is exercised end to end.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { decryptSecret, encryptSecret } from "./wa-crypto";

const executeMock = vi.fn();
vi.mock("./db", () => ({
  execute: (...args: any[]) => executeMock(...args),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}));

const isCloudAvailableMock = vi.fn();
const sendTextMessageMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  isCloudAvailable: (...args: any[]) => isCloudAvailableMock(...args),
  sendTextMessage: (...args: any[]) => sendTextMessageMock(...args),
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
  decideRoute,
  isAsyncFallbackEligible,
  runAsyncWebFallback,
  sendPatientMessage,
  type SendPatientMessageParams,
} from "./whatsapp-router";
import { TEMPLATE_VAR_SPEC, type AptNotifyKind } from "./appointment-notify";

const ALL_KINDS = Object.keys(TEMPLATE_VAR_SPEC) as AptNotifyKind[];
const VIDEO_KINDS: AptNotifyKind[] = ["videoLinkIssued", "videoLinkReissued"];
const BODY = "Hello *Asha*, your appointment is booked.";
/** A body carrying a bearer join link, like videoLinkIssued and join-link reminders. */
const JOIN_TOKEN = "JoInToKeN_s3cret_0123456789";
const JOIN_BODY = `Hello *Asha*, your video consultation is booked.\n\n🎥 *Join your video consultation:*\nhttps://app.test/consult/${JOIN_TOKEN}`;
/** Test-only AES key (hex, 32 bytes) for WA_CLOUD_ENC_KEY. */
const TEST_KEY_HEX = "a1".repeat(32);

/** Every string param passed to execute(), for plaintext-leak assertions. */
function executeParamStrings(): string[] {
  return executeMock.mock.calls.flatMap((c) =>
    (Array.isArray(c[1]) ? c[1] : []).filter((p: unknown) => typeof p === "string"),
  );
}

function expectNoPlaintextJoinLink() {
  for (const s of executeParamStrings()) {
    expect(s).not.toContain("/consult/");
    expect(s).not.toContain(JOIN_TOKEN);
  }
}

function resetMocks() {
  executeMock.mockReset();
  isCloudAvailableMock.mockReset();
  sendTextMessageMock.mockReset();
  isWhatsAppReadyMock.mockReset();
  enqueueWAMock.mockReset();
  executeMock.mockResolvedValue({ affectedRows: 1, insertId: null });
  isCloudAvailableMock.mockResolvedValue(true);
  sendTextMessageMock.mockResolvedValue({ ok: true, messageId: "wamid.OK" });
  isWhatsAppReadyMock.mockResolvedValue(true);
  enqueueWAMock.mockResolvedValue({ success: true });
}

beforeEach(() => {
  resetMocks();
  vi.stubEnv("WA_CLOUD_ENC_KEY", TEST_KEY_HEX);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function params(overrides: Partial<SendPatientMessageParams> = {}): SendPatientMessageParams {
  return {
    tenantId: "t1",
    notifyKind: "booked",
    recipientPhone: "8830553868",
    ctx: { name: "Asha", clinicName: "Sunrise Clinic", dateTime: new Date("2026-01-01T10:00:00Z") },
    buildMessage: () => BODY,
    ...overrides,
  };
}

function sqlCalls(fragment: string) {
  return executeMock.mock.calls.filter((c) => typeof c[0] === "string" && c[0].includes(fragment));
}

describe("decideRoute", () => {
  it("returns 'official' iff the Cloud API is available, for every kind incl. video", () => {
    for (const kind of ALL_KINDS) {
      expect(decideRoute(kind, { available: true })).toBe("official");
      expect(decideRoute(kind, { available: false })).toBe("web");
    }
    for (const kind of VIDEO_KINDS) {
      expect(decideRoute(kind, { available: true })).toBe("official");
    }
  });

  it("is a total function returning exactly one of 'official'|'web'", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_KINDS), fc.boolean(), (kind, available) => {
        const route = decideRoute(kind, { available });
        expect(route).toBe(available ? "official" : "web");
      }),
      { numRuns: 200 },
    );
  });
});

describe("sendPatientMessage — official text send", () => {
  it("sends buildMessage() via sendTextMessage with no template lookup", async () => {
    const res = await sendPatientMessage(params());

    expect(res).toMatchObject({ delivered: true, channel: "official" });
    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    expect(sendTextMessageMock).toHaveBeenCalledWith({ to: "918830553868", body: BODY });
    expect(enqueueWAMock).not.toHaveBeenCalled();

    // No template table is touched anywhere.
    for (const call of executeMock.mock.calls) {
      expect(String(call[0])).not.toContain("WaCloudTemplate");
    }

    const inserts = sqlCalls("INSERT INTO WaMessageLog");
    expect(inserts.length).toBe(1);
    const [sql, p] = inserts[0];
    expect(sql).toContain("NULL"); // templateId stays NULL
    expect(sql).not.toContain("body"); // no body before Meta accepts
    expect(p).toEqual([res.logId, "t1", "918830553868", "booked", "official"]);

    // wamid + the ENCRYPTED body in one UPDATE.
    const success = sqlCalls("metaMessageId = ?");
    expect(success.length).toBe(1);
    expect(success[0][0]).toContain("body = ?");
    const [wamid, sealed, id] = success[0][1];
    expect(wamid).toBe("wamid.OK");
    expect(id).toBe(res.logId);
    expect(sealed).not.toContain(BODY);
    expect(decryptSecret(sealed)).toBe(BODY);
  });

  it("normalizes '8830553868' to '918830553868' for the log row and the official 'to'", async () => {
    await sendPatientMessage(params({ recipientPhone: "8830553868" }));
    expect(sqlCalls("INSERT INTO WaMessageLog")[0][1][2]).toBe("918830553868");
    expect(sendTextMessageMock.mock.calls[0][0].to).toBe("918830553868");
  });

  it("routes the video kinds official when available", async () => {
    for (const kind of VIDEO_KINDS) {
      resetMocks();
      const res = await sendPatientMessage(params({ notifyKind: kind }));
      expect(res.channel).toBe("official");
      expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
      expect(enqueueWAMock).not.toHaveBeenCalled();
    }
  });
});

describe("sendPatientMessage — stored body never holds a plaintext join link", () => {
  const scenarios: [string, Partial<SendPatientMessageParams>, () => void][] = [
    ["official accepted", {}, () => {}],
    [
      "official 131047 → Web",
      {},
      () =>
        sendTextMessageMock.mockResolvedValueOnce({
          ok: false,
          kind: "meta_error",
          code: "131047",
          message: "Re-engagement message",
        }),
    ],
    [
      "official transport failure, Web down",
      {},
      () => {
        sendTextMessageMock.mockResolvedValueOnce({ ok: false, kind: "transport", message: "x" });
        isWhatsAppReadyMock.mockResolvedValue(false);
      },
    ],
    ["cloud unavailable → Web", { cloudAvailable: false }, () => {}],
    ["explicit channel:'web'", { channel: "web" }, () => {}],
  ];

  for (const [label, overrides, arrange] of scenarios) {
    it(`never passes the plaintext join URL to the DB: ${label}`, async () => {
      arrange();
      await sendPatientMessage(
        params({ notifyKind: "videoLinkIssued", buildMessage: () => JOIN_BODY, ...overrides }),
      );
      expectNoPlaintextJoinLink();
    });
  }

  it("stores the body only (encrypted) for a Meta-accepted official send", async () => {
    await sendPatientMessage(
      params({ notifyKind: "videoLinkIssued", buildMessage: () => JOIN_BODY }),
    );
    const writes = executeMock.mock.calls.filter((c) => /\bbody\b/.test(String(c[0])));
    expect(writes.length).toBe(1);
    expect(writes[0][0]).toContain("metaMessageId = ?");
    expect(decryptSecret(writes[0][1][1])).toBe(JOIN_BODY);
  });

  it("writes no body at all for Web, failed-official or cloud-unavailable rows", async () => {
    for (const [, overrides, arrange] of scenarios.slice(1)) {
      resetMocks();
      arrange();
      await sendPatientMessage(params({ buildMessage: () => JOIN_BODY, ...overrides }));
      const writes = executeMock.mock.calls.filter((c) => /\bbody\b/.test(String(c[0])));
      expect(writes).toEqual([]);
    }
  });

  it("stores NULL instead of the body when no encryption key is configured", async () => {
    vi.stubEnv("WA_CLOUD_ENC_KEY", "");
    const res = await sendPatientMessage(params({ buildMessage: () => JOIN_BODY }));
    expect(res).toMatchObject({ delivered: true, channel: "official" });
    const success = sqlCalls("metaMessageId = ?");
    expect(success[0][1]).toEqual(["wamid.OK", null, res.logId]);
    expectNoPlaintextJoinLink();
  });
});

describe("sendPatientMessage — Web fallback", () => {
  const failures: [string, any, string][] = [
    [
      "meta_error 131047 (24h rule)",
      { ok: false, kind: "meta_error", code: "131047", message: "Re-engagement message" },
      "131047",
    ],
    [
      "other meta_error",
      { ok: false, kind: "meta_error", code: "100", message: "Invalid parameter" },
      "100",
    ],
    ["transport", { ok: false, kind: "transport", message: "timeout" }, "transport"],
  ];

  for (const [label, outcome, code] of failures) {
    it(`records the official failure then falls back to Web: ${label}`, async () => {
      sendTextMessageMock.mockResolvedValueOnce(outcome);
      const res = await sendPatientMessage(params());

      expect(res).toMatchObject({ delivered: true, channel: "web" });
      const failed = sqlCalls("officialStatus = 'failed'");
      expect(failed.length).toBe(1);
      expect(failed[0][1].slice(0, 4)).toEqual([code, outcome.message, code, outcome.message]);
      // Web gets the ORIGINAL phone and the same body.
      expect(enqueueWAMock).toHaveBeenCalledTimes(1);
      expect(enqueueWAMock).toHaveBeenCalledWith("t1", "8830553868", BODY);
    });
  }

  it("uses Web only when the cloud is unavailable (param)", async () => {
    const res = await sendPatientMessage(params({ cloudAvailable: false }));
    expect(res).toMatchObject({ delivered: true, channel: "web" });
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(isCloudAvailableMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).toHaveBeenCalledWith("t1", "8830553868", BODY);
  });

  it("uses Web only when isCloudAvailable() is false (no cached param)", async () => {
    isCloudAvailableMock.mockResolvedValue(false);
    const res = await sendPatientMessage(params());
    expect(res.channel).toBe("web");
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(sqlCalls("INSERT INTO WaMessageLog")[0][1][4]).toBe("web");
  });

  it("honors the explicit channel:'web' override even when the cloud is available", async () => {
    const res = await sendPatientMessage(params({ channel: "web", cloudAvailable: true }));
    expect(res.channel).toBe("web");
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).toHaveBeenCalledTimes(1);
  });

  it("reports not delivered when official fails and Web is not connected", async () => {
    sendTextMessageMock.mockResolvedValueOnce({ ok: false, kind: "transport", message: "down" });
    isWhatsAppReadyMock.mockResolvedValue(false);
    const res = await sendPatientMessage(params());
    expect(res.delivered).toBe(false);
    expect(enqueueWAMock).not.toHaveBeenCalled();
    expect(sqlCalls("SET status = 'failed'").length).toBe(1);
  });

  it("never throws when enqueueWA rejects", async () => {
    isCloudAvailableMock.mockResolvedValue(false);
    enqueueWAMock.mockRejectedValueOnce(new Error("wa-server down"));
    const res = await sendPatientMessage(params());
    expect(res.delivered).toBe(false);
    expect(res.error).toBe("wa-server down");
  });

  it("property: never rejects, one log row per call, at most one channel delivers", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_KINDS),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom("ok", "meta131047", "metaOther", "transport"),
        fc.boolean(),
        fc.boolean(),
        async (kind, available, channelWeb, officialOutcome, webReady, webThrows) => {
          resetMocks();
          sendTextMessageMock.mockResolvedValue(
            officialOutcome === "ok"
              ? { ok: true, messageId: "wamid.P" }
              : officialOutcome === "meta131047"
                ? { ok: false, kind: "meta_error", code: "131047", message: "outside 24h" }
                : officialOutcome === "metaOther"
                  ? { ok: false, kind: "meta_error", code: "100", message: "bad" }
                  : { ok: false, kind: "transport", message: "timeout" },
          );
          isWhatsAppReadyMock.mockResolvedValue(webReady);
          if (webThrows) enqueueWAMock.mockRejectedValue(new Error("web down"));

          const res = await sendPatientMessage(
            params({
              notifyKind: kind,
              cloudAvailable: available,
              channel: channelWeb ? "web" : undefined,
              buildMessage: () => JOIN_BODY,
            }),
          );

          expect(sqlCalls("INSERT INTO WaMessageLog").length).toBe(1);
          expectNoPlaintextJoinLink();

          let officialDeliveries = 0;
          for (const r of sendTextMessageMock.mock.results) {
            const v = await r.value;
            if (v?.ok) officialDeliveries++;
          }
          let webDeliveries = 0;
          for (const r of enqueueWAMock.mock.results) {
            try {
              await r.value;
              webDeliveries++;
            } catch {
              /* rejected enqueue is not a delivery */
            }
          }
          const deliveries = officialDeliveries + webDeliveries;
          expect(deliveries).toBeLessThanOrEqual(1);
          expect(res.delivered).toBe(deliveries === 1);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("isAsyncFallbackEligible", () => {
  const valid = {
    id: "log1",
    tenantId: "t1",
    direction: "out",
    recipient: "918830553868",
    kind: "booked",
    channel: "official",
    body: "Hello",
    officialStatus: "sent",
    webFallbackAttempted: 0,
  };

  it("accepts a valid official tenant send", () => {
    expect(isAsyncFallbackEligible(valid)).toBe(true);
    expect(isAsyncFallbackEligible({ ...valid, officialStatus: null })).toBe(true);
  });

  it("rejects every ineligible variant", () => {
    expect(isAsyncFallbackEligible(null)).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, kind: "autoReply" })).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, tenantId: "global" })).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, tenantId: "" })).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, direction: "in" })).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, channel: "web" })).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, webFallbackAttempted: 1 })).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, officialStatus: "delivered" })).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, officialStatus: "read" })).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, body: "" })).toBe(false);
    expect(isAsyncFallbackEligible({ ...valid, body: null })).toBe(false);
  });
});

describe("runAsyncWebFallback", () => {
  // The stored body is the encrypted value read from WaMessageLog.
  const sealedRow = () => ({
    id: "log1",
    tenantId: "t1",
    recipient: "918830553868",
    body: encryptSecret(JOIN_BODY, Buffer.from(TEST_KEY_HEX, "hex")),
  });
  let row: ReturnType<typeof sealedRow>;
  beforeEach(() => {
    row = sealedRow();
  });

  it("claims the row, sends the decrypted body via Web once, and marks it web/sent", async () => {
    const out = await runAsyncWebFallback(row);
    expect(out).toBe("fell_back");
    expect(sqlCalls("webFallbackAttempted = 1").length).toBe(1);
    expect(enqueueWAMock).toHaveBeenCalledTimes(1);
    expect(enqueueWAMock).toHaveBeenCalledWith("t1", "918830553868", JOIN_BODY);
    const sent = sqlCalls("SET channel = 'web', status = 'sent'");
    expect(sent.length).toBe(1);
    expect(sent[0][1]).toEqual(["log1"]);
    expectNoPlaintextJoinLink();
  });

  it("NULLs the stored body in the atomic claim (terminal: can never fall back again)", async () => {
    await runAsyncWebFallback(row);
    const claim = sqlCalls("webFallbackAttempted = 1")[0];
    expect(claim[0]).toContain("body = NULL");
    expect(claim[0]).toContain("webFallbackAttempted = 0"); // still atomic
  });

  it("resolves 'error' without sending when the stored body cannot be decrypted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await runAsyncWebFallback({ ...row, body: "not-an-encrypted-blob" });
    expect(out).toBe("error");
    expect(sqlCalls("body = NULL").length).toBe(1);
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });

  it("skips when the atomic claim affects no row", async () => {
    executeMock.mockResolvedValueOnce({ affectedRows: 0, insertId: null });
    const out = await runAsyncWebFallback(row);
    expect(out).toBe("skipped");
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });

  it("does not send or mark sent when Web is not connected", async () => {
    isWhatsAppReadyMock.mockResolvedValue(false);
    const out = await runAsyncWebFallback(row);
    expect(out).toBe("web_unavailable");
    expect(enqueueWAMock).not.toHaveBeenCalled();
    expect(sqlCalls("status = 'sent'").length).toBe(0);
  });

  it("resolves 'error' instead of throwing when enqueueWA rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    enqueueWAMock.mockRejectedValueOnce(new Error("down"));
    await expect(runAsyncWebFallback(row)).resolves.toBe("error");
  });
});
