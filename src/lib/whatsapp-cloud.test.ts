// @vitest-environment node
//
// Tests for the plain-text Cloud API client: normalizeWaPhone (must match
// wa-server.cjs exactly), sendTextMessage and verifyPhoneNumber. fetch is
// mocked: no live Meta Graph API call is ever made. Credentials come from
// stubbed env vars; the DB lookup returns no row.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

vi.mock("./db", () => ({
  queryOne: vi.fn(async () => null),
}));

import {
  DEFAULT_API_VERSION,
  isOfficialRecipientAllowed,
  normalizeWaPhone,
  sendTextMessage,
  verifyPhoneNumber,
} from "./whatsapp-cloud";

const TOKEN = "test-token-SECRET";
const fetchMock = vi.fn();

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The wa-server.cjs algorithm, reimplemented verbatim for comparison. */
function waServerNormalize(raw: string): string {
  let phone = String(raw).replace(/\D/g, "");
  if (phone.length === 10) phone = "91" + phone;
  return phone;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("WA_CLOUD_PHONE_NUMBER_ID", "123");
  vi.stubEnv("WA_CLOUD_ACCESS_TOKEN", TOKEN);
  vi.stubEnv("WA_CLOUD_API_VERSION", "");
  vi.stubEnv("WA_CLOUD_TEST_RECIPIENTS", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("normalizeWaPhone", () => {
  it("matches wa-server.cjs on known inputs", () => {
    expect(normalizeWaPhone("8830553868")).toBe("918830553868");
    expect(normalizeWaPhone("+91 88305-53868")).toBe("918830553868");
    expect(normalizeWaPhone("918830553868")).toBe("918830553868");
    expect(normalizeWaPhone("00918830553868")).toBe("00918830553868");
    expect(normalizeWaPhone("")).toBe("");
    expect(normalizeWaPhone(null)).toBe("");
    expect(normalizeWaPhone(undefined)).toBe("");
  });

  it("property: identical to the wa-server.cjs algorithm for any string", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(normalizeWaPhone(s)).toBe(waServerNormalize(s));
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[+\d\s()-]{0,20}$/), (s) => {
        expect(normalizeWaPhone(s)).toBe(waServerNormalize(s));
      }),
      { numRuns: 300 },
    );
  });
});

describe("sendTextMessage", () => {
  it("POSTs a text payload to the v26.0 messages endpoint and returns the wamid", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { messages: [{ id: "wamid.X" }] }));

    const res = await sendTextMessage({ to: "918830553868", body: "Hello there" });

    expect(DEFAULT_API_VERSION).toBe("v26.0");
    expect(res).toEqual({ ok: true, messageId: "wamid.X" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v26.0/123/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "918830553868",
      type: "text",
      text: { preview_url: true, body: "Hello there" },
    });
  });

  it("maps a Meta error (131047) to meta_error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(400, { error: { code: 131047, message: "Re-engagement message" } }),
    );
    const res = await sendTextMessage({ to: "918830553868", body: "Hi" });
    expect(res).toEqual({
      ok: false,
      kind: "meta_error",
      code: "131047",
      subcode: undefined,
      message: "Re-engagement message",
    });
  });

  it("maps a network failure and a 5xx to transport", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const a = await sendTextMessage({ to: "918830553868", body: "Hi" });
    expect(a).toMatchObject({ ok: false, kind: "transport" });

    fetchMock.mockResolvedValueOnce(jsonRes(500, { error: { message: "boom" } }));
    const b = await sendTextMessage({ to: "918830553868", body: "Hi" });
    expect(b).toEqual({ ok: false, kind: "transport", message: "Graph API returned 500" });
  });

  it("rejects an empty or oversized body without calling fetch or throwing", async () => {
    const empty = await sendTextMessage({ to: "918830553868", body: "" });
    const blank = await sendTextMessage({ to: "918830553868", body: "   " });
    const big = await sendTextMessage({ to: "918830553868", body: "x".repeat(4097) });
    expect(empty).toMatchObject({ ok: false, kind: "transport" });
    expect(blank).toMatchObject({ ok: false, kind: "transport" });
    expect(big).toMatchObject({ ok: false, kind: "transport" });
    expect(fetchMock).not.toHaveBeenCalled();

    // Exactly 4096 is allowed.
    fetchMock.mockResolvedValueOnce(jsonRes(200, { messages: [{ id: "wamid.MAX" }] }));
    const max = await sendTextMessage({ to: "918830553868", body: "x".repeat(4096) });
    expect(max).toEqual({ ok: true, messageId: "wamid.MAX" });
  });

  it("returns transport when the Cloud API is not configured", async () => {
    vi.stubEnv("WA_CLOUD_ACCESS_TOKEN", "");
    const res = await sendTextMessage({ to: "918830553868", body: "Hi" });
    expect(res).toEqual({ ok: false, kind: "transport", message: "Cloud API not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never logs the access token", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    fetchMock.mockResolvedValueOnce(jsonRes(200, { messages: [{ id: "wamid.1" }] }));
    await sendTextMessage({ to: "918830553868", body: "Hi" });
    fetchMock.mockResolvedValueOnce(jsonRes(400, { error: { code: 100, message: "bad" } }));
    await sendTextMessage({ to: "918830553868", body: "Hi" });
    fetchMock.mockRejectedValueOnce(new Error("down"));
    await sendTextMessage({ to: "918830553868", body: "Hi" });

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(TOKEN);
      }
    }
  });
});

describe("WA_CLOUD_TEST_RECIPIENTS (local test mode)", () => {
  it("allows every recipient when unset or blank", () => {
    vi.stubEnv("WA_CLOUD_TEST_RECIPIENTS", "");
    expect(isOfficialRecipientAllowed("918830553868")).toBe(true);
    vi.stubEnv("WA_CLOUD_TEST_RECIPIENTS", "   ");
    expect(isOfficialRecipientAllowed("917000000000")).toBe(true);
  });

  it("allows only listed numbers, normalized like wa-server.cjs", () => {
    vi.stubEnv("WA_CLOUD_TEST_RECIPIENTS", " 8830553868 , +91 70000-00001");
    expect(isOfficialRecipientAllowed("918830553868")).toBe(true);
    expect(isOfficialRecipientAllowed("8830553868")).toBe(true);
    expect(isOfficialRecipientAllowed("917000000001")).toBe(true);
    expect(isOfficialRecipientAllowed("919999999999")).toBe(false);
    expect(isOfficialRecipientAllowed("")).toBe(false);
  });

  it("refuses a non-listed recipient without calling Meta", async () => {
    vi.stubEnv("WA_CLOUD_TEST_RECIPIENTS", "8830553868");
    const blocked = await sendTextMessage({ to: "919999999999", body: "Hi" });
    expect(blocked).toMatchObject({ ok: false, kind: "transport" });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonRes(200, { messages: [{ id: "wamid.OK" }] }));
    const allowed = await sendTextMessage({ to: "918830553868", body: "Hi" });
    expect(allowed).toEqual({ ok: true, messageId: "wamid.OK" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("verifyPhoneNumber", () => {
  it("GETs the phone number fields with the given token and parses them", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(200, {
        id: "999",
        verified_name: "BookMyTime",
        display_phone_number: "+91 88305 53868",
        quality_rating: "GREEN",
      }),
    );
    const res = await verifyPhoneNumber({
      phoneNumberId: "999",
      accessToken: "new-token",
      apiVersion: "v21.0",
    });
    expect(res).toEqual({
      ok: true,
      verifiedName: "BookMyTime",
      displayPhoneNumber: "+91 88305 53868",
      qualityRating: "GREEN",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://graph.facebook.com/v21.0/999?fields=display_phone_number,verified_name,quality_rating",
    );
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer new-token");
  });

  it("returns Meta's code and message on an error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(401, { error: { code: 190, message: "Invalid OAuth access token." } }),
    );
    const res = await verifyPhoneNumber({
      phoneNumberId: "999",
      accessToken: "bad",
      apiVersion: "v21.0",
    });
    expect(res).toEqual({ ok: false, code: "190", message: "Invalid OAuth access token." });
  });

  it("returns code 'transport' when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const res = await verifyPhoneNumber({
      phoneNumberId: "999",
      accessToken: "x",
      apiVersion: "v21.0",
    });
    expect(res).toEqual({ ok: false, code: "transport", message: "timeout" });
  });
});
