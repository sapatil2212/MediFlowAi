// @vitest-environment node
//
// Tests for wa-template-sync.ts: full sync with cursor paging under the lease
// lock, the webhook change applier (status/quality/category + monotonic guard +
// mapping-invalidation signal), and the scheduled-sync interval parsing. The
// repo is the in-memory double; the Graph list/get ops are stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listMessageTemplatesMock = vi.fn();
const getMessageTemplateMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  resolveCloudConfig: vi.fn(async () => ({ wabaId: "222", apiVersion: "v26.0" })),
  listMessageTemplates: (...a: any[]) => listMessageTemplatesMock(...a),
  getMessageTemplate: (...a: any[]) => getMessageTemplateMock(...a),
}));

import { createInMemoryTemplateRepo, InMemoryTemplateRepo } from "./wa-template-repo.memory";
import { __setTemplateRepoForTests } from "./wa-template-repo";
import { applyWebhookChange, runFullSync, scheduledSyncMinutes } from "./wa-template-sync";

let repo: InMemoryTemplateRepo;

function appointmentBookedNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "booked-meta-1",
    name: "appointment_booked",
    language: "en_US",
    status: "APPROVED",
    category: "UTILITY",
    parameter_format: "POSITIONAL",
    components: [
      {
        type: "BODY",
        text: "Hello {{1}}, appointment at {{2}} with {{3}} on {{4}} at {{5}}, queue {{6}}.",
      },
      { type: "FOOTER", text: "This is an automated notification message." },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  repo = createInMemoryTemplateRepo();
  __setTemplateRepoForTests(repo);
  listMessageTemplatesMock.mockReset();
  getMessageTemplateMock.mockReset();
});

afterEach(() => {
  __setTemplateRepoForTests(null);
  vi.unstubAllEnvs();
});

describe("runFullSync", () => {
  it("pages the list, imports META rows and records the run", async () => {
    listMessageTemplatesMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          data: [
            { id: "1", name: "a_tpl", language: "en_US", status: "APPROVED", category: "UTILITY" },
          ],
          paging: { cursors: { after: "cur1" }, next: "x" },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          data: [
            { id: "2", name: "b_tpl", language: "hi", status: "PENDING", category: "UTILITY" },
          ],
          paging: {},
        },
      });

    const res = await runFullSync("manual");
    expect(res.ok).toBe(true);
    expect(res.scanned).toBe(2);
    expect(res.created).toBe(2);
    const runs = await repo.listSyncRuns();
    expect(runs[0].status).toBe("ok");
    expect(listMessageTemplatesMock).toHaveBeenCalledTimes(2);
  });

  it("hydrates the exact appointment_booked/en_US Meta import with runtime mappings", async () => {
    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: { data: [appointmentBookedNode()], paging: {} },
    });

    const res = await runFullSync("manual");

    expect(res).toMatchObject({ ok: true, created: 1 });
    const row = await repo.getByMetaTemplateId("booked-meta-1");
    expect(row).toMatchObject({
      source: "META",
      notifyKind: "booked",
      metaStatus: "APPROVED",
      metaCategory: "UTILITY",
      messagingAccountId: "222",
      variableMappings: {
        "body.1": "name",
        "body.2": "clinicName",
        "body.3": "doctorName",
        "body.4": "date",
        "body.5": "time",
        "body.6": "tokenNo",
      },
    });
  });

  it("repairs an existing blank META import of appointment_booked", async () => {
    const existing = await repo.createDraft({
      name: "appointment_booked",
      language: "en_US",
      category: "UTILITY",
      parameterFormat: "POSITIONAL",
      headerType: "NONE",
      bodyText: "",
      buttons: [],
      variableMappings: {},
      sampleValues: {},
      source: "META",
      actorId: "sync",
    });
    await repo.applyMetaState(existing.id, {
      metaTemplateId: "booked-meta-1",
      messagingAccountId: "222",
      localState: "SUBMITTED",
    });
    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: { data: [appointmentBookedNode()], paging: {} },
    });

    const res = await runFullSync("manual");

    expect(res).toMatchObject({ ok: true, updated: 1 });
    const repaired = await repo.getById(existing.id);
    expect(repaired?.notifyKind).toBe("booked");
    expect(repaired?.variableMappings?.["body.6"]).toBe("tokenNo");
    expect(repaired?.sampleValues?.["body.6"]).toBe("7");
  });

  it.each([
    ["wrong language", { language: "en" }],
    [
      "unsupported header",
      {
        components: [
          { type: "HEADER", format: "TEXT", text: "Appointment" },
          { type: "BODY", text: "Hello {{1}} {{2}} {{3}} {{4}} {{5}} {{6}} done." },
        ],
      },
    ],
    [
      "wrong parameter count",
      { components: [{ type: "BODY", text: "Hello {{1}} {{2}} {{3}} {{4}} {{5}} done." }] },
    ],
  ])("does not hydrate a shape-mismatched published template: %s", async (_label, overrides) => {
    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: { data: [appointmentBookedNode(overrides)], paging: {} },
    });

    await runFullSync("manual");

    const row = await repo.getByMetaTemplateId("booked-meta-1");
    expect(row?.notifyKind).toBeNull();
    expect(row?.variableMappings).toEqual({});
  });

  it("imports approved/rejected/paused/disabled statuses from the list (normalized)", async () => {
    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          { id: "11", name: "a_tpl", language: "en_US", status: "APPROVED", category: "UTILITY" },
          { id: "12", name: "b_tpl", language: "en_US", status: "REJECTED", category: "UTILITY" },
          { id: "13", name: "c_tpl", language: "en_US", status: "PAUSED", category: "UTILITY" },
          { id: "14", name: "d_tpl", language: "en_US", status: "DISABLED", category: "UTILITY" },
        ],
        paging: {},
      },
    });
    const res = await runFullSync("manual");
    expect(res.ok).toBe(true);
    expect(res.created).toBe(4);
    expect((await repo.getByMetaTemplateId("11"))?.metaStatus).toBe("APPROVED");
    expect((await repo.getByMetaTemplateId("12"))?.metaStatus).toBe("REJECTED");
    expect((await repo.getByMetaTemplateId("13"))?.metaStatus).toBe("PAUSED");
    expect((await repo.getByMetaTemplateId("14"))?.metaStatus).toBe("DISABLED");
  });

  it("applies a category change pulled from the list onto an existing row", async () => {
    const row = await repo.createDraft({
      name: "a_tpl",
      language: "en_US",
      category: "UTILITY",
      parameterFormat: "POSITIONAL",
      headerType: "NONE",
      bodyText: "Hi {{1}}",
      buttons: [],
      variableMappings: {},
      sampleValues: {},
      actorId: "admin1",
    });
    await repo.applyMetaState(row.id, {
      metaTemplateId: "500",
      metaStatus: "APPROVED",
      metaCategory: "UTILITY",
      messagingAccountId: "222",
      localState: "SUBMITTED",
    });
    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            id: "500",
            name: "a_tpl",
            language: "en_US",
            status: "APPROVED",
            category: "MARKETING",
          },
        ],
        paging: {},
      },
    });
    const res = await runFullSync("manual");
    expect(res.ok).toBe(true);
    expect(res.updated).toBe(1);
    expect((await repo.getById(row.id))?.metaCategory).toBe("MARKETING");
  });

  it("records an error run and stops when the list op fails", async () => {
    listMessageTemplatesMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "190",
      message: "bad token",
    });
    const res = await runFullSync("manual");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("190");
    const runs = await repo.listSyncRuns();
    expect(runs[0].status).toBe("error");
  });

  it("skips a META row bound to a different Messaging account (DP-15)", async () => {
    const row = await repo.createDraft({
      name: "a_tpl",
      language: "en_US",
      category: "UTILITY",
      parameterFormat: "POSITIONAL",
      headerType: "NONE",
      bodyText: "Hi",
      buttons: [],
      variableMappings: {},
      sampleValues: {},
      source: "META",
      actorId: "sync",
    });
    await repo.applyMetaState(row.id, { messagingAccountId: "999", localState: "SUBMITTED" });
    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: {
        data: [{ id: "500", name: "a_tpl", language: "en_US", status: "APPROVED" }],
        paging: {},
      },
    });
    const res = await runFullSync("manual");
    expect(res.skipped).toBe(1);
    expect(res.updated).toBe(0);
  });

  it("skips templates whose name exceeds 128 chars", async () => {
    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: {
        data: [{ id: "9", name: "x".repeat(130), language: "en_US", status: "APPROVED" }],
        paging: {},
      },
    });
    const res = await runFullSync("manual");
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(1);
    expect(res.created).toBe(0);
  });

  it("does not overlap: a sync is blocked while the lease is held", async () => {
    listMessageTemplatesMock.mockResolvedValue({ ok: true, data: { data: [], paging: {} } });
    // Hold the lease from outside; a sync must not run while it is held.
    const got = await repo.acquireSyncLease("other-holder");
    expect(got).toBe(true);
    const blocked = await runFullSync("scheduled");
    expect(blocked.ok).toBe(false);
    expect(listMessageTemplatesMock).not.toHaveBeenCalled();
    // Once released, a sync can run.
    await repo.releaseSyncLease("other-holder");
    const ran = await runFullSync("manual");
    expect(ran.ok).toBe(true);
  });
});

describe("applyWebhookChange", () => {
  async function seedSubmitted(metaUpdatedAt?: Date) {
    const row = await repo.createDraft({
      name: "a_tpl",
      language: "en_US",
      category: "UTILITY",
      parameterFormat: "POSITIONAL",
      headerType: "NONE",
      bodyText: "Hi {{1}}",
      buttons: [],
      variableMappings: { "body.1": "name" },
      sampleValues: {},
      actorId: "admin1",
    });
    await repo.applyMetaState(row.id, {
      metaTemplateId: "500",
      metaStatus: "PENDING",
      metaCategory: "UTILITY",
      localState: "SUBMITTED",
      messagingAccountId: "222",
      ...(metaUpdatedAt ? { metaUpdatedAt } : {}),
    });
    return row;
  }

  it("applies a status update matched by metaTemplateId", async () => {
    const row = await seedSubmitted();
    const res = await applyWebhookChange({
      field: "message_template_status_update",
      metaTemplateId: "500",
      name: "a_tpl",
      language: "en-US",
      entryTime: Math.floor(Date.now() / 1000),
      value: { event: "APPROVED" },
    });
    expect(res.applied).toBe(true);
    const after = await repo.getById(row.id);
    expect(after?.metaStatus).toBe("APPROVED");
  });

  it("drops an out-of-order change (monotonic guard)", async () => {
    const future = new Date(Date.now() + 3_600_000);
    const row = await seedSubmitted(future);
    const res = await applyWebhookChange({
      field: "message_template_status_update",
      metaTemplateId: "500",
      name: "a_tpl",
      language: "en_US",
      entryTime: Math.floor(Date.now() / 1000),
      value: { event: "REJECTED" },
    });
    expect(res.applied).toBe(false);
    const after = await repo.getById(row.id);
    expect(after?.metaStatus).toBe("PENDING"); // unchanged
  });

  it("signals mappingInvalidated when a mapped template becomes non-APPROVED", async () => {
    const row = await seedSubmitted();
    await repo.applyMetaState(row.id, { metaStatus: "APPROVED" });
    await repo.upsertMapping({
      notifyKind: "confirmed",
      templateId: row.id,
      language: "en_US",
      actorId: "a",
    });
    await repo.setMappingEnabled("confirmed", true, { version: "v1", actorId: "a" });

    const res = await applyWebhookChange({
      field: "message_template_status_update",
      metaTemplateId: "500",
      name: "a_tpl",
      language: "en_US",
      entryTime: Math.floor(Date.now() / 1000),
      value: { event: "PAUSED" },
    });
    expect(res.applied).toBe(true);
    expect(res.mappingInvalidated).toBe(true);
  });

  it("returns applied:false when no template matches", async () => {
    const res = await applyWebhookChange({
      field: "message_template_status_update",
      metaTemplateId: "does-not-exist",
      name: null,
      language: null,
      entryTime: 1,
      value: { event: "APPROVED" },
    });
    expect(res.applied).toBe(false);
  });

  it("matches by name+language (with '-'→'_') when the id is absent", async () => {
    const row = await seedSubmitted();
    const res = await applyWebhookChange({
      field: "message_template_status_update",
      metaTemplateId: null,
      name: "a_tpl",
      language: "en-US", // hyphen form from Meta
      entryTime: Math.floor(Date.now() / 1000),
      value: { event: "REJECTED" },
    });
    expect(res.applied).toBe(true);
    expect((await repo.getById(row.id))?.metaStatus).toBe("REJECTED");
  });

  for (const event of ["APPROVED", "REJECTED", "PAUSED", "DISABLED"]) {
    it(`applies the '${event}' status event`, async () => {
      const row = await seedSubmitted();
      const res = await applyWebhookChange({
        field: "message_template_status_update",
        metaTemplateId: "500",
        name: "a_tpl",
        language: "en_US",
        entryTime: Math.floor(Date.now() / 1000),
        value: { event },
      });
      expect(res.applied).toBe(true);
      expect((await repo.getById(row.id))?.metaStatus).toBe(event);
    });
  }

  it("applies a completed category recategorization (template_category_update)", async () => {
    const row = await seedSubmitted();
    const res = await applyWebhookChange({
      field: "template_category_update",
      metaTemplateId: "500",
      name: "a_tpl",
      language: "en_US",
      entryTime: Math.floor(Date.now() / 1000),
      value: { previous_category: "UTILITY", new_category: "MARKETING" },
    });
    expect(res.applied).toBe(true);
    expect((await repo.getById(row.id))?.metaCategory).toBe("MARKETING");
  });

  it("applies a quality update (message_template_quality_update)", async () => {
    const row = await seedSubmitted();
    const res = await applyWebhookChange({
      field: "message_template_quality_update",
      metaTemplateId: "500",
      name: "a_tpl",
      language: "en_US",
      entryTime: Math.floor(Date.now() / 1000),
      value: { new_quality_score: "RED" },
    });
    expect(res.applied).toBe(true);
    expect((await repo.getById(row.id))?.qualityScore).toBe("RED");
  });

  it("signals needsRefresh for a components_update (shape changed on Meta)", async () => {
    await seedSubmitted();
    const res = await applyWebhookChange({
      field: "message_template_components_update",
      metaTemplateId: "500",
      name: "a_tpl",
      language: "en_US",
      entryTime: Math.floor(Date.now() / 1000),
      value: {},
    });
    expect(res.applied).toBe(true);
    expect(res.needsRefresh).toBe(true);
  });

  it("tolerates a malformed/unknown value (no status) without throwing", async () => {
    const row = await seedSubmitted();
    const res = await applyWebhookChange({
      field: "message_template_status_update",
      metaTemplateId: "500",
      name: "a_tpl",
      language: "en_US",
      entryTime: Math.floor(Date.now() / 1000),
      value: { unexpected: "garbage" },
    });
    // Applied (the metaUpdatedAt bump), but the status is unchanged.
    expect(res.applied).toBe(true);
    expect((await repo.getById(row.id))?.metaStatus).toBe("PENDING");
  });

  it("does not regress a mapped template that is already non-APPROVED (idempotent re-delivery)", async () => {
    const row = await seedSubmitted();
    await repo.applyMetaState(row.id, { metaStatus: "APPROVED" });
    const first = await applyWebhookChange({
      field: "message_template_status_update",
      metaTemplateId: "500",
      name: "a_tpl",
      language: "en_US",
      entryTime: Math.floor(Date.now() / 1000),
      value: { event: "APPROVED" },
    });
    expect(first.applied).toBe(true);
    expect((await repo.getById(row.id))?.metaStatus).toBe("APPROVED");
  });
});

describe("scheduledSyncMinutes", () => {
  it("is off when unset or 0", () => {
    vi.stubEnv("WA_CLOUD_TEMPLATE_SYNC_MINUTES", "");
    expect(scheduledSyncMinutes()).toBeNull();
    vi.stubEnv("WA_CLOUD_TEMPLATE_SYNC_MINUTES", "0");
    expect(scheduledSyncMinutes()).toBeNull();
  });

  it("accepts 30–1440 and rejects out-of-range as off", () => {
    vi.stubEnv("WA_CLOUD_TEMPLATE_SYNC_MINUTES", "360");
    expect(scheduledSyncMinutes()).toBe(360);
    vi.stubEnv("WA_CLOUD_TEMPLATE_SYNC_MINUTES", "5");
    expect(scheduledSyncMinutes()).toBeNull();
  });
});
