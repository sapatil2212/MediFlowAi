// @vitest-environment node
//
// Tests for wa-template-health.ts: the read-only account-health aggregate and
// the token-scope reporting (DP-16 — scopes, never the token). Every Graph op
// is stubbed; no DB, no live Meta call. The token value never appears in the
// result.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TOKEN = "EAAG-secret-token-value";

const getWabaNodeMock = vi.fn();
const getPhoneNodeMock = vi.fn();
const getHealthStatusMock = vi.fn();
const getSubscribedAppsMock = vi.fn();
const debugTokenMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  resolveCloudConfig: vi.fn(async () => ({
    wabaId: "222",
    phoneNumberId: "111",
    accessToken: TOKEN,
    apiVersion: "v26.0",
  })),
  getWabaNode: (...a: any[]) => getWabaNodeMock(...a),
  getPhoneNode: (...a: any[]) => getPhoneNodeMock(...a),
  getHealthStatus: (...a: any[]) => getHealthStatusMock(...a),
  getSubscribedApps: (...a: any[]) => getSubscribedAppsMock(...a),
  debugToken: (...a: any[]) => debugTokenMock(...a),
}));

vi.mock("./db", () => ({ execute: vi.fn(async () => ({ affectedRows: 1 })) }));

import { __resetHealthCacheForTests, waAccountHealth } from "./wa-template-health";

beforeEach(() => {
  __resetHealthCacheForTests();
  getWabaNodeMock.mockReset();
  getPhoneNodeMock.mockReset();
  getHealthStatusMock.mockReset();
  getSubscribedAppsMock.mockReset();
  debugTokenMock.mockReset();
  getWabaNodeMock.mockResolvedValue({ ok: true, data: { id: "222", name: "BMT" } });
  getPhoneNodeMock.mockResolvedValue({
    ok: true,
    data: { display_phone_number: "+91 88305 53868", quality_rating: "GREEN" },
  });
  getHealthStatusMock.mockResolvedValue({
    ok: true,
    data: { health_status: { can_send_message: "AVAILABLE" } },
  });
  getSubscribedAppsMock.mockResolvedValue({ ok: true, data: { data: [] } });
  debugTokenMock.mockResolvedValue({
    ok: true,
    data: {
      data: {
        is_valid: true,
        app_id: "app1",
        scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      },
    },
  });
});

afterEach(() => {
  __resetHealthCacheForTests();
});

describe("waAccountHealth", () => {
  it("aggregates the read-only nodes and reports token scopes without the token value", async () => {
    const res = await waAccountHealth();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.health.accountTypeOk).toBe(true);
    expect(res.health.token.hasManagement).toBe(true);
    expect(res.health.token.hasMessaging).toBe(true);
    expect(res.health.token.valid).toBe(true);
    // The token value is never surfaced.
    expect(JSON.stringify(res.health)).not.toContain(TOKEN);
  });

  it("marks the token Not verifiable and accountType unknown when the reads fail", async () => {
    getWabaNodeMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "190",
      message: "bad token",
    });
    debugTokenMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "190",
      message: "bad token",
    });
    const res = await waAccountHealth();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.health.accountTypeOk).toBeNull();
    expect(res.health.token.note).toBe("Not verifiable");
    expect(res.health.token.valid).toBeNull();
  });

  it("surfaces a restricted send state (BLOCKED) in the health node, no token leaked", async () => {
    getHealthStatusMock.mockResolvedValue({
      ok: true,
      data: { health_status: { can_send_message: "BLOCKED" } },
    });
    const res = await waAccountHealth({ force: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.health.health as any)?.health_status?.can_send_message).toBe("BLOCKED");
    expect(JSON.stringify(res.health)).not.toContain(TOKEN);
  });

  it("does not throw when the WABA node read is rate-limited (80007); accountType unknown", async () => {
    getWabaNodeMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "80007",
      message: "rate limit hit",
    });
    const res = await waAccountHealth({ force: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.health.accountTypeOk).toBeNull();
    expect(res.health.notes.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.health)).not.toContain(TOKEN);
  });

  it("warns when the API version is near expiry (v21.0)", async () => {
    const { resolveCloudConfig } = await import("./whatsapp-cloud");
    (resolveCloudConfig as any).mockResolvedValueOnce({
      wabaId: "222",
      phoneNumberId: "111",
      accessToken: TOKEN,
      apiVersion: "v21.0",
    });
    const res = await waAccountHealth({ force: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.health.apiVersion.value).toBe("v21.0");
    expect(res.health.apiVersion.warning).toBeTruthy();
  });
});
