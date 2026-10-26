// @vitest-environment node
//
// Tests for the super-admin Cloud API handlers: pre-flight credential
// validation on save (rejects on a Meta error and writes nothing) and the
// plain-text test send (phone normalization, input validation before the 30s
// cooldown, 131047 hint). The DB, crypto and every Graph call are mocked: no
// live Meta API call is made.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryOneMock = vi.fn();
const executeMock = vi.fn();
vi.mock("./db", () => ({
  query: vi.fn(async () => []),
  queryOne: (...args: any[]) => queryOneMock(...args),
  execute: (...args: any[]) => executeMock(...args),
}));

vi.mock("./wa-crypto", () => ({
  isEncKeyConfigured: () => true,
  encryptSecret: () => "enc",
  last4: (s: string) => s.slice(-4),
}));

vi.mock("./whatsapp", () => ({
  enqueueWA: vi.fn(),
  getWAStatus: vi.fn(async () => ({ state: "DISCONNECTED" })),
}));

const resolveCloudConfigMock = vi.fn();
const verifyPhoneNumberMock = vi.fn();
const sendTextMessageMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  resolveCloudConfig: (...args: any[]) => resolveCloudConfigMock(...args),
  verifyPhoneNumber: (...args: any[]) => verifyPhoneNumberMock(...args),
  sendTextMessage: (...args: any[]) => sendTextMessageMock(...args),
}));

import { META_24H_HINT, saveWaCloudConfig, testWaCloudConfig } from "./wa-cloud-admin";

const SAVED_ROW = {
  id: "central",
  phoneNumberId: "111",
  wabaId: "222",
  apiVersion: "v21.0",
  verifyToken: "vt",
  accessTokenEnc: "enc-old",
  appSecretEnc: "enc-secret",
  tokenLast4: "OLD1",
  appSecretLast4: "SEC1",
  isEnabled: 1,
};

// Each test runs a minute after the previous one so the module-scoped 30s
// test-send cooldown never leaks between tests.
let clock = Date.UTC(2026, 0, 1, 0, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  clock += 60_000;
  vi.setSystemTime(clock);
  queryOneMock.mockReset();
  executeMock.mockReset();
  resolveCloudConfigMock.mockReset();
  verifyPhoneNumberMock.mockReset();
  sendTextMessageMock.mockReset();
  queryOneMock.mockResolvedValue(SAVED_ROW);
  executeMock.mockResolvedValue({ affectedRows: 1, insertId: null });
  resolveCloudConfigMock.mockResolvedValue({
    phoneNumberId: "111",
    wabaId: "222",
    accessToken: "saved-token",
    appSecret: "secret",
    verifyToken: "vt",
    apiVersion: "v21.0",
    isEnabled: true,
    source: "db",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saveWaCloudConfig — pre-flight validation", () => {
  it("rejects the save with Meta's message and writes nothing on a Meta error", async () => {
    verifyPhoneNumberMock.mockResolvedValue({
      ok: false,
      code: "190",
      message: "Invalid OAuth access token.",
    });
    const NEW_TOKEN = "EAAG-new-token-VALUE";

    let error: any = null;
    try {
      await saveWaCloudConfig({ accessToken: NEW_TOKEN });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Invalid OAuth access token.");
    expect(error.message).toContain("190");
    expect(error.message).not.toContain(NEW_TOKEN);
    expect(executeMock).not.toHaveBeenCalled();

    expect(verifyPhoneNumberMock).toHaveBeenCalledWith({
      phoneNumberId: "111",
      accessToken: NEW_TOKEN,
      apiVersion: "v21.0",
    });
  });

  it("verifies a new phone number ID with the saved token, then saves and returns the fields", async () => {
    verifyPhoneNumberMock.mockResolvedValue({
      ok: true,
      verifiedName: "BookMyTime",
      displayPhoneNumber: "+91 88305 53868",
      qualityRating: "GREEN",
    });

    const res = await saveWaCloudConfig({ phoneNumberId: "999" });

    expect(verifyPhoneNumberMock).toHaveBeenCalledWith({
      phoneNumberId: "999",
      accessToken: "saved-token",
      apiVersion: "v21.0",
    });
    expect(res).toEqual({
      ok: true,
      verified: {
        verifiedName: "BookMyTime",
        displayPhoneNumber: "+91 88305 53868",
        qualityRating: "GREEN",
      },
    });
    const updates = executeMock.mock.calls.filter((c) =>
      String(c[0]).includes("UPDATE WaCloudConfig"),
    );
    expect(updates.length).toBe(1);
    expect(updates[0][1][0]).toBe("999");
  });

  it("skips validation when neither the phone number ID nor the token changes", async () => {
    const res = await saveWaCloudConfig({ phoneNumberId: "111", isEnabled: true });
    expect(verifyPhoneNumberMock).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, verified: null });
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});

describe("testWaCloudConfig — plain-text test send", () => {
  it("normalizes the phone and sends the message as text", async () => {
    sendTextMessageMock.mockResolvedValue({ ok: true, messageId: "wamid.T" });
    const res = await testWaCloudConfig({ toPhone: "8830553868", message: "Hello test" });
    expect(sendTextMessageMock).toHaveBeenCalledWith({ to: "918830553868", body: "Hello test" });
    expect(res).toEqual({ ok: true, messageId: "wamid.T" });
  });

  it("returns the Meta code, message and the 24-hour hint for 131047", async () => {
    sendTextMessageMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "131047",
      message: "Re-engagement message",
    });
    const res = await testWaCloudConfig({ toPhone: "918830553868", message: "Hi" });
    expect(res).toEqual({
      ok: false,
      code: "131047",
      message: "Re-engagement message",
      hint: META_24H_HINT,
    });
    expect(META_24H_HINT).toBe(
      "The recipient must message your business WhatsApp number first (Meta 24-hour rule).",
    );
  });

  it("omits the hint for other Meta errors", async () => {
    sendTextMessageMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "100",
      message: "Invalid parameter",
    });
    const res = await testWaCloudConfig({ toPhone: "918830553868", message: "Hi" });
    expect(res).toEqual({ ok: false, code: "100", message: "Invalid parameter" });
  });

  it("rejects an invalid phone WITHOUT starting the cooldown", async () => {
    await expect(testWaCloudConfig({ toPhone: "12345", message: "Hi" })).rejects.toThrow(
      "Enter a valid WhatsApp number with country code",
    );
    expect(sendTextMessageMock).not.toHaveBeenCalled();

    sendTextMessageMock.mockResolvedValue({ ok: true, messageId: "wamid.N" });
    const res = await testWaCloudConfig({ toPhone: "918830553868", message: "Hi" });
    expect(res.ok).toBe(true);
  });

  it("rejects an empty or oversized message", async () => {
    await expect(testWaCloudConfig({ toPhone: "918830553868", message: "   " })).rejects.toThrow();
    await expect(
      testWaCloudConfig({ toPhone: "918830553868", message: "x".repeat(4097) }),
    ).rejects.toThrow();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("enforces the 30s cooldown between real sends", async () => {
    sendTextMessageMock.mockResolvedValue({ ok: true, messageId: "wamid.C" });
    await testWaCloudConfig({ toPhone: "918830553868", message: "One" });
    await expect(testWaCloudConfig({ toPhone: "918830553868", message: "Two" })).rejects.toThrow(
      "Please wait",
    );
    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(clock + 31_000);
    await testWaCloudConfig({ toPhone: "918830553868", message: "Three" });
    expect(sendTextMessageMock).toHaveBeenCalledTimes(2);
  });
});
