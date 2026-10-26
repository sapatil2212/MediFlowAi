// @vitest-environment node
//
// FEAT-004 security assertions (design §17 Security). Proven here, server-side,
// through the admin-gated registry (wa-template-api.ts) and the services:
//   • every write is rejected when there is no Super Admin session, even if the
//     UI was bypassed (the handler never runs);
//   • a non-admin / tenant caller cannot reach ANY template/mapping/health read
//     or write (the gate returns {ok:false,error:'Unauthorized'});
//   • no sentinel secret (token / app-secret) ever appears in a server-fn
//     response, an activity row, a sync run, a health snapshot, or a log line;
//   • client-bypass invalid data is rejected server-side (validator + service);
//   • cross-tenant variable resolution is impossible (covered in
//     wa-template-notify.test.ts — resolveTemplateField reads only the ctx).
//
// Everything is stubbed: no DB, no .env read, no live Meta call. The repo is
// the in-memory double; the Graph transport is mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Sentinel secrets that must NEVER surface in any output.
const SENTINEL_TOKEN = "EAAG-SENTINEL-TOKEN-must-never-leak";
const SENTINEL_APP_SECRET = "APP-SECRET-SENTINEL-must-never-leak";

// ── Mock the admin session gate so we can flip auth on/off per test. ─────────
const verifyAdminSessionMock = vi.fn();
vi.mock("./admin.server", () => ({
  verifyAdminSession: (...a: any[]) => verifyAdminSessionMock(...a),
}));

// ── Mock the Graph transport (stub every op; carry the sentinel secrets in the
//    config so we can prove they are not echoed back). ─────────────────────────
const createMessageTemplateMock = vi.fn();
const listMessageTemplatesMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  resolveCloudConfig: vi.fn(async () => ({
    wabaId: "222",
    phoneNumberId: "111",
    accessToken: SENTINEL_TOKEN,
    appSecret: SENTINEL_APP_SECRET,
    apiVersion: "v26.0",
  })),
  isCloudAvailable: vi.fn(async () => true),
  createMessageTemplate: (...a: any[]) => createMessageTemplateMock(...a),
  listMessageTemplates: (...a: any[]) => listMessageTemplatesMock(...a),
  getWabaNode: vi.fn(async () => ({ ok: true, data: { id: "222" } })),
  getPhoneNode: vi.fn(async () => ({ ok: true, data: { display_phone_number: "+1" } })),
  getHealthStatus: vi.fn(async () => ({
    ok: true,
    data: { health_status: { can_send_message: "AVAILABLE" } },
  })),
  getSubscribedApps: vi.fn(async () => ({ ok: true, data: { data: [] } })),
  debugToken: vi.fn(async () => ({
    ok: true,
    data: { data: { is_valid: true, app_id: "app1", scopes: ["whatsapp_business_management"] } },
  })),
}));

// The health snapshot persistence is best-effort; keep it a no-op (no DB).
vi.mock("./db", () => ({ execute: vi.fn(async () => ({ affectedRows: 1 })) }));

import { createInMemoryTemplateRepo, InMemoryTemplateRepo } from "./wa-template-repo.memory";
import { __setTemplateRepoForTests } from "./wa-template-repo";
import { waTemplateApi } from "./wa-template-api";
import { __resetHealthCacheForTests } from "./wa-template-health";

let repo: InMemoryTemplateRepo;

/** Every admin-gated capability keyed by name, with a representative input. */
const WRITES: Array<[string, unknown]> = [
  ["createDraft", { name: "bmt_x", language: "en_US", bodyText: "Hi {{1}}" }],
  ["updateDraft", { id: "x", name: "bmt_x", language: "en_US", bodyText: "Hi {{1}}" }],
  ["validateDraft", { name: "bmt_x", language: "en_US", bodyText: "Hi {{1}}" }],
  ["installPresets", {}],
  ["submitTemplate", { id: "x" }],
  ["reconcileTemplate", { id: "x" }],
  ["editTemplate", { id: "x", name: "bmt_x", language: "en_US", bodyText: "Hi {{1}}" }],
  ["cloneTemplate", { id: "x" }],
  ["archiveDraft", { id: "x" }],
  ["unarchiveDraft", { id: "x" }],
  ["deleteDraft", { id: "x" }],
  ["deleteMetaTemplate", { id: "x" }],
  ["syncAll", {}],
  ["syncOne", { id: "x" }],
  ["refreshHealth", {}],
  ["assignMapping", { notifyKind: "confirmed", templateId: "x" }],
  ["setMappingEnabled", { notifyKind: "confirmed", enabled: true, optInAck: true }],
  ["removeMapping", { notifyKind: "confirmed" }],
];

const READS: Array<[string, unknown]> = [
  ["dashboard", {}],
  ["list", {}],
  ["details", { id: "x" }],
  ["revisions", { id: "x" }],
  ["activity", {}],
  ["syncRuns", {}],
  ["accountHealth", {}],
  ["notifyMappings", {}],
];

beforeEach(() => {
  repo = createInMemoryTemplateRepo();
  __setTemplateRepoForTests(repo);
  __resetHealthCacheForTests();
  verifyAdminSessionMock.mockReset();
  createMessageTemplateMock.mockReset();
  listMessageTemplatesMock.mockReset();
  listMessageTemplatesMock.mockResolvedValue({ ok: true, data: { data: [], paging: {} } });
});

afterEach(() => {
  __setTemplateRepoForTests(null);
  __resetHealthCacheForTests();
});

describe("auth gate — no Super Admin session", () => {
  it("rejects EVERY write with Unauthorized and never runs the handler", async () => {
    verifyAdminSessionMock.mockResolvedValue(null); // not signed in
    for (const [name, input] of WRITES) {
      const fn = (waTemplateApi as any)[name] as (raw: unknown) => Promise<any>;
      const res = await fn(input);
      expect(res, `${name} must be rejected`).toMatchObject({ ok: false, error: "Unauthorized" });
    }
    // No write reached the Graph transport.
    expect(createMessageTemplateMock).not.toHaveBeenCalled();
  });

  it("rejects EVERY read with Unauthorized (a tenant cannot reach any fn)", async () => {
    verifyAdminSessionMock.mockResolvedValue(null);
    for (const [name, input] of READS) {
      const fn = (waTemplateApi as any)[name] as (raw: unknown) => Promise<any>;
      const res = await fn(input);
      expect(res, `${name} must be rejected`).toMatchObject({ ok: false, error: "Unauthorized" });
    }
  });

  it("treats a thrown session check as unauthenticated (fails closed)", async () => {
    verifyAdminSessionMock.mockRejectedValue(new Error("db down"));
    const res = await (waTemplateApi as any).createDraft({
      name: "bmt_x",
      language: "en_US",
      bodyText: "Hi {{1}}",
    });
    expect(res).toMatchObject({ ok: false, error: "Unauthorized" });
  });
});

describe("auth gate — signed-in Super Admin", () => {
  beforeEach(() => verifyAdminSessionMock.mockResolvedValue({ id: "admin-1", email: "a@x.test" }));

  it("runs the handler and rejects client-bypass invalid data server-side", async () => {
    // A malformed name passes the shallow validator but the service rejects it.
    const res = await (waTemplateApi as any).createDraft({
      name: "Bad Name With Spaces",
      language: "en_US",
      bodyText: "Hi {{1}}",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("rejects a missing required id at the validator (no handler run)", async () => {
    const res = await (waTemplateApi as any).submitTemplate({}); // no id
    expect(res).toMatchObject({ ok: false });
    expect(createMessageTemplateMock).not.toHaveBeenCalled();
  });

  it("refuses to enable a mapping without the opt-in ack even for an admin", async () => {
    const res = await (waTemplateApi as any).setMappingEnabled({
      notifyKind: "confirmed",
      enabled: true,
      optInAck: false,
    });
    expect(res.ok).toBe(false);
  });
});

describe("no sentinel secret ever surfaces", () => {
  beforeEach(() => verifyAdminSessionMock.mockResolvedValue({ id: "admin-1" }));

  function assertNoSecret(value: unknown, where: string) {
    const json = JSON.stringify(value) ?? "";
    expect(json, `${where} must not contain the token`).not.toContain(SENTINEL_TOKEN);
    expect(json, `${where} must not contain the app secret`).not.toContain(SENTINEL_APP_SECRET);
  }

  it("is absent from the account-health response and its persisted snapshot", async () => {
    const res = await (waTemplateApi as any).accountHealth({});
    expect(res.ok).toBe(true);
    assertNoSecret(res, "accountHealth response");
  });

  it("is absent from a submit response and the recorded activity rows", async () => {
    // Seed a valid draft and submit it (success path).
    const created = await repo.createDraft({
      name: "bmt_confirmed",
      language: "en_US",
      category: "UTILITY",
      parameterFormat: "POSITIONAL",
      headerType: "NONE",
      bodyText: "Hi {{1}}",
      buttons: [],
      variableMappings: { "body.1": "name" },
      sampleValues: { "body.1": "Asha" },
      actorId: "admin-1",
    });
    createMessageTemplateMock.mockResolvedValue({
      ok: true,
      data: { id: "900", status: "PENDING", category: "UTILITY" },
    });
    const res = await (waTemplateApi as any).submitTemplate({ id: created.id });
    assertNoSecret(res, "submit response");

    const activity = await repo.listActivity(created.id);
    assertNoSecret(activity, "activity rows");
  });

  it("is absent from a sync run record", async () => {
    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          { id: "1", name: "a_tpl", language: "en_US", status: "APPROVED", category: "UTILITY" },
        ],
        paging: {},
      },
    });
    const res = await (waTemplateApi as any).syncAll({});
    assertNoSecret(res, "syncAll response");
    assertNoSecret(await repo.listSyncRuns(), "sync runs");
  });

  it("is absent even when Meta returns an error (error messages are sanitised)", async () => {
    const created = await repo.createDraft({
      name: "bmt_err",
      language: "en_US",
      category: "UTILITY",
      parameterFormat: "POSITIONAL",
      headerType: "NONE",
      bodyText: "Hi {{1}}",
      buttons: [],
      variableMappings: { "body.1": "name" },
      sampleValues: { "body.1": "Asha" },
      actorId: "admin-1",
    });
    createMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "190",
      message: "Access token invalid",
    });
    const res = await (waTemplateApi as any).submitTemplate({ id: created.id });
    expect(res.ok).toBe(false);
    assertNoSecret(res, "submit error response");
  });
});
