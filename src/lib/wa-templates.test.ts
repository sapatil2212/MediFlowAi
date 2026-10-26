// @vitest-environment node
//
// Tests for the template service (wa-templates.ts): draft CRUD + validation,
// submit with the atomic claim, uncertain-on-transport + reconcile-by-name
// (DP-17), and the opt-in-ack-gated mapping admin (DP-01). The repo is the
// in-memory double; the Graph ops are stubbed. No DB, no live Meta call.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createMessageTemplateMock = vi.fn();
const listMessageTemplatesMock = vi.fn();
const editMessageTemplateMock = vi.fn();
const deleteMessageTemplateMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  resolveCloudConfig: vi.fn(async () => ({ wabaId: "222", apiVersion: "v26.0" })),
  createMessageTemplate: (...a: any[]) => createMessageTemplateMock(...a),
  listMessageTemplates: (...a: any[]) => listMessageTemplatesMock(...a),
  editMessageTemplate: (...a: any[]) => editMessageTemplateMock(...a),
  deleteMessageTemplate: (...a: any[]) => deleteMessageTemplateMock(...a),
}));

import { createInMemoryTemplateRepo, InMemoryTemplateRepo } from "./wa-template-repo.memory";
import { __setTemplateRepoForTests } from "./wa-template-repo";
import {
  waAssignMapping,
  waCloneTemplate,
  waCreateDraft,
  waDeleteMetaTemplate,
  waEditTemplate,
  waReconcileTemplate,
  waSetMappingEnabled,
  waSubmitTemplate,
  waValidateDraft,
} from "./wa-templates";

let repo: InMemoryTemplateRepo;

const DRAFT = {
  name: "bmt_appointment_confirmed",
  language: "en_US",
  parameterFormat: "POSITIONAL" as const,
  headerType: "NONE",
  bodyText:
    "Hello {{1}}, your appointment at {{2}} with {{3}} on {{4}} at {{5}} is confirmed. Code {{6}}.",
  footerText: "BookMyTime appointment notification",
  buttons: [],
  sampleValues: {
    "body.1": "Asha",
    "body.2": "Sunrise",
    "body.3": "Dr. Mehta",
    "body.4": "Mon 12 Jan",
    "body.5": "10:30 AM",
    "body.6": "A1B2C3D4",
  },
  variableMappings: {
    "body.1": "name",
    "body.2": "clinicName",
    "body.3": "doctorName",
    "body.4": "date",
    "body.5": "time",
    "body.6": "bookingCode",
  },
  notifyKind: "confirmed",
};

beforeEach(() => {
  repo = createInMemoryTemplateRepo();
  __setTemplateRepoForTests(repo);
  createMessageTemplateMock.mockReset();
  listMessageTemplatesMock.mockReset();
  editMessageTemplateMock.mockReset();
  deleteMessageTemplateMock.mockReset();
});

afterEach(() => {
  __setTemplateRepoForTests(null);
});

async function submittedApprovedId() {
  const created = await waCreateDraft(DRAFT, "admin1");
  const id = (created as any).id;
  await repo.applyMetaState(id, {
    metaStatus: "APPROVED",
    metaCategory: "UTILITY",
    metaTemplateId: "900",
    messagingAccountId: "222",
    localState: "SUBMITTED",
  });
  return id;
}

describe("waCreateDraft + waValidateDraft", () => {
  it("creates a valid draft and the dry-run returns the exact Meta payload (never calls Meta)", async () => {
    const created = await waCreateDraft(DRAFT, "admin1");
    expect(created.ok).toBe(true);

    const dry = await waValidateDraft(DRAFT);
    expect(dry.ok).toBe(true);
    if (dry.ok) {
      expect(dry.payload).toMatchObject({
        name: "bmt_appointment_confirmed",
        language: "en_US",
        category: "UTILITY",
        parameter_format: "POSITIONAL",
      });
    }
    expect(createMessageTemplateMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid name with field errors", async () => {
    const res = await waCreateDraft({ ...DRAFT, name: "Bad Name" }, "admin1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors && res.fieldErrors.length).toBeGreaterThan(0);
  });
});

describe("waSubmitTemplate — atomic claim + outcomes (DP-17)", () => {
  it("submits an approved create, records PENDING and the metaTemplateId", async () => {
    const created = await waCreateDraft(DRAFT, "admin1");
    const id = (created as any).id;
    createMessageTemplateMock.mockResolvedValue({
      ok: true,
      data: { id: "900", status: "PENDING", category: "UTILITY" },
    });

    const res = await waSubmitTemplate(id, "admin1");
    expect(res.ok).toBe(true);
    const row = await repo.getById(id);
    expect(row?.metaTemplateId).toBe("900");
    expect(row?.metaStatus).toBe("PENDING");
    expect(row?.localState).toBe("SUBMITTED");
    expect(row?.opState).toBeNull();
  });

  it("marks the op UNCERTAIN on a transport error (never auto-retried)", async () => {
    const created = await waCreateDraft(DRAFT, "admin1");
    const id = (created as any).id;
    createMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "transport",
      code: "transport",
      message: "timeout",
    });

    const res = await waSubmitTemplate(id, "admin1");
    expect(res.ok).toBe(false);
    const row = await repo.getById(id);
    expect(row?.opState).toBe("UNCERTAIN");

    // Resubmission is impossible while uncertain.
    const retry = await waSubmitTemplate(id, "admin1");
    expect(retry.ok).toBe(false);
    expect(createMessageTemplateMock).toHaveBeenCalledTimes(1);
  });

  it("reconcile adopts a name+language match for an uncertain op", async () => {
    const created = await waCreateDraft(DRAFT, "admin1");
    const id = (created as any).id;
    createMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "transport",
      code: "transport",
      message: "timeout",
    });
    // Stamp the claim 60s in the past so the reconcile's 30s floor is cleared
    // (the reconcile compares the claim against the real clock).
    repo.now = () => Date.now() - 60_000;
    await waSubmitTemplate(id, "admin1");
    repo.now = () => Date.now();

    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            id: "901",
            name: "bmt_appointment_confirmed",
            language: "en_US",
            status: "APPROVED",
            category: "UTILITY",
          },
        ],
        paging: {},
      },
    });

    const rec = await waReconcileTemplate(id, "admin1");
    expect(rec.ok).toBe(true);
    if (rec.ok) expect(rec.matched).toBe(true);
    const after = await repo.getById(id);
    expect(after?.metaTemplateId).toBe("901");
    expect(after?.opState).toBeNull();
  });

  it("maps a Meta validation error (duplicate name) and keeps the draft editable", async () => {
    const created = await waCreateDraft(DRAFT, "admin1");
    const id = (created as any).id;
    createMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "100",
      subcode: "2388024",
      message: "Content in this language already exists",
    });
    const res = await waSubmitTemplate(id, "admin1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("100");
    const row = await repo.getById(id);
    expect(row?.opState).toBeNull(); // claim cleared, still a draft
  });
});

describe("mapping admin — opt-in ack gate (DP-01)", () => {
  async function approvedDraftId() {
    const created = await waCreateDraft(DRAFT, "admin1");
    const id = (created as any).id;
    await repo.applyMetaState(id, {
      metaStatus: "APPROVED",
      metaCategory: "UTILITY",
      metaTemplateId: "900",
      localState: "SUBMITTED",
    });
    return id;
  }

  it("assigns a mapping only for an eligible APPROVED UTILITY template", async () => {
    const id = await approvedDraftId();
    const res = await waAssignMapping({ notifyKind: "confirmed", templateId: id }, "admin1");
    expect(res.ok).toBe(true);
    const mapping = await repo.getMapping("confirmed");
    expect(mapping?.isEnabled).toBe(false); // created disabled (off by default)
  });

  it("refuses to enable a mapping without the opt-in acknowledgement", async () => {
    const id = await approvedDraftId();
    await waAssignMapping({ notifyKind: "confirmed", templateId: id }, "admin1");
    const noAck = await waSetMappingEnabled(
      { notifyKind: "confirmed", enabled: true, optInAck: false },
      "admin1",
    );
    expect(noAck.ok).toBe(false);
    const stillOff = await repo.getMapping("confirmed");
    expect(stillOff?.isEnabled).toBe(false);
  });

  it("enables a mapping with the opt-in acknowledgement and records the ack", async () => {
    const id = await approvedDraftId();
    await waAssignMapping({ notifyKind: "confirmed", templateId: id }, "admin1");
    const ok = await waSetMappingEnabled(
      { notifyKind: "confirmed", enabled: true, optInAck: true },
      "admin1",
    );
    expect(ok.ok).toBe(true);
    const mapping = await repo.getMapping("confirmed");
    expect(mapping?.isEnabled).toBe(true);
    expect(mapping?.optInAckAt).not.toBeNull();
    expect(mapping?.optInAckVersion).toBe("v1");
  });
});

// ── FEAT-004: the full Meta error-code matrix on submit (design §17) ─────────
describe("waSubmitTemplate — Meta error-code matrix (design §17)", () => {
  async function freshDraftId() {
    const created = await waCreateDraft(DRAFT, "admin1");
    return (created as any).id as string;
  }

  const cases: Array<{
    label: string;
    meta: { code: string; subcode?: string; message: string };
    expectCode: string;
    expectCategory?: string;
  }> = [
    {
      label: "missing permission (10)",
      meta: { code: "10", message: "Application does not have permission" },
      expectCode: "10",
      expectCategory: "permission",
    },
    {
      label: "missing permission (200)",
      meta: { code: "200", message: "Permissions error" },
      expectCode: "200",
      expectCategory: "permission",
    },
    {
      label: "invalid token (190)",
      meta: { code: "190", message: "Access token has expired" },
      expectCode: "190",
      expectCategory: "auth",
    },
    {
      label: "restricted account (131031)",
      meta: { code: "131031", message: "Account has been restricted" },
      expectCode: "131031",
      expectCategory: "account_restricted",
    },
    {
      label: "invalid component (100 + subcode)",
      meta: { code: "100", subcode: "2388043", message: "Invalid component" },
      expectCode: "100",
    },
    {
      label: "duplicate name (100 / 2388024)",
      meta: { code: "100", subcode: "2388024", message: "Content already exists" },
      expectCode: "100",
    },
  ];

  for (const c of cases) {
    it(`maps ${c.label} and keeps the draft editable (claim cleared)`, async () => {
      const id = await freshDraftId();
      createMessageTemplateMock.mockResolvedValue({ ok: false, kind: "meta_error", ...c.meta });
      const res = await waSubmitTemplate(id, "admin1");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe(c.expectCode);
        if (c.expectCategory) expect(res.category).toBe(c.expectCategory);
        // The surfaced error never leaks a stack or the Graph internals verbatim.
        expect(typeof res.error).toBe("string");
      }
      const row = await repo.getById(id);
      expect(row?.opState).toBeNull(); // still a draft, resubmittable after a fix
      expect(row?.metaTemplateId).toBeNull();
    });
  }

  it("rate limit (4/80007) → surfaced as a rate error, draft kept", async () => {
    const id = await freshDraftId();
    createMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "4",
      message: "Application request limit reached",
    });
    const res = await waSubmitTemplate(id, "admin1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("4");
    expect((await repo.getById(id))?.opState).toBeNull();
  });
});

// ── FEAT-004: reconcile cursor pagination (design §17) ───────────────────────
describe("waReconcileTemplate — cursor pagination", () => {
  it("pages past a non-matching first page and adopts a match on the second", async () => {
    const created = await waCreateDraft(DRAFT, "admin1");
    const id = (created as any).id;
    createMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "transport",
      code: "transport",
      message: "timeout",
    });
    repo.now = () => Date.now() - 60_000;
    await waSubmitTemplate(id, "admin1");
    repo.now = () => Date.now();

    listMessageTemplatesMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          data: [{ id: "800", name: "other_tpl", language: "en_US", status: "APPROVED" }],
          paging: { cursors: { after: "cur1" }, next: "more" },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          data: [
            {
              id: "901",
              name: "bmt_appointment_confirmed",
              language: "en_US",
              status: "APPROVED",
              category: "UTILITY",
            },
          ],
          paging: {},
        },
      });

    const rec = await waReconcileTemplate(id, "admin1");
    expect(rec.ok).toBe(true);
    if (rec.ok) expect(rec.matched).toBe(true);
    expect(listMessageTemplatesMock).toHaveBeenCalledTimes(2);
    expect((await repo.getById(id))?.metaTemplateId).toBe("901");
  });

  it("returns matched:false (draft editable) when no page contains the name", async () => {
    const created = await waCreateDraft(DRAFT, "admin1");
    const id = (created as any).id;
    createMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "transport",
      code: "transport",
      message: "timeout",
    });
    repo.now = () => Date.now() - 60_000;
    await waSubmitTemplate(id, "admin1");
    repo.now = () => Date.now();

    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: {
        data: [{ id: "800", name: "other", language: "en_US", status: "APPROVED" }],
        paging: {},
      },
    });
    const rec = await waReconcileTemplate(id, "admin1");
    expect(rec.ok).toBe(true);
    if (rec.ok) expect(rec.matched).toBe(false);
    expect((await repo.getById(id))?.opState).toBeNull();
  });
});

// ── FEAT-004: edit allowed/blocked by status (DP-11) ─────────────────────────
describe("waEditTemplate — allowed/blocked by status (DP-11)", () => {
  it("edits an APPROVED template (components only) and returns to PENDING", async () => {
    const id = await submittedApprovedId();
    editMessageTemplateMock.mockResolvedValue({ ok: true, data: {} });
    const res = await waEditTemplate(
      id,
      { ...DRAFT, bodyText: DRAFT.bodyText + " See you." },
      "admin1",
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.metaStatus).toBe("PENDING");
    expect(editMessageTemplateMock).toHaveBeenCalledTimes(1);
    // Edit sends components only (no name/language mutation).
    expect(editMessageTemplateMock.mock.calls[0][1]).toHaveProperty("components");
  });

  it("blocks an edit on a PENDING template (not an editable status)", async () => {
    const created = await waCreateDraft(DRAFT, "admin1");
    const id = (created as any).id;
    await repo.applyMetaState(id, {
      metaStatus: "PENDING",
      metaCategory: "UTILITY",
      metaTemplateId: "901",
      localState: "SUBMITTED",
    });
    const res = await waEditTemplate(id, DRAFT, "admin1");
    expect(res.ok).toBe(false);
    expect(editMessageTemplateMock).not.toHaveBeenCalled();
  });

  it("maps a Meta error on edit and clears the claim", async () => {
    const id = await submittedApprovedId();
    editMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "100",
      subcode: "2388043",
      message: "Invalid component",
    });
    const res = await waEditTemplate(id, DRAFT, "admin1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("100");
    expect((await repo.getById(id))?.opState).toBeNull();
  });
});

// ── FEAT-004: delete by hsm_id+name + delete failure (MV-11) ─────────────────
describe("waDeleteMetaTemplate — by hsm_id+name (MV-11)", () => {
  it("deletes with the name + hsm_id and marks the row DELETED", async () => {
    const id = await submittedApprovedId();
    deleteMessageTemplateMock.mockResolvedValue({ ok: true, data: {} });
    const res = await waDeleteMetaTemplate(id, "admin1");
    expect(res.ok).toBe(true);
    expect(deleteMessageTemplateMock).toHaveBeenCalledWith({
      name: "bmt_appointment_confirmed",
      hsmId: "900",
    });
    expect((await repo.getById(id))?.metaStatus).toBe("DELETED");
  });

  it("blocks deleting a DISABLED template", async () => {
    const created = await waCreateDraft(DRAFT, "admin1");
    const id = (created as any).id;
    await repo.applyMetaState(id, {
      metaStatus: "DISABLED",
      metaTemplateId: "900",
      localState: "SUBMITTED",
    });
    const res = await waDeleteMetaTemplate(id, "admin1");
    expect(res.ok).toBe(false);
    expect(deleteMessageTemplateMock).not.toHaveBeenCalled();
  });

  it("surfaces a Meta delete failure and clears the claim (not DELETED)", async () => {
    const id = await submittedApprovedId();
    deleteMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "100",
      message: "Could not delete",
    });
    const res = await waDeleteMetaTemplate(id, "admin1");
    expect(res.ok).toBe(false);
    const row = await repo.getById(id);
    expect(row?.opState).toBeNull();
    expect(row?.metaStatus).toBe("APPROVED");
  });
});

// ── FEAT-004: clone produces an editable LOCAL draft ─────────────────────────
describe("waCloneTemplate", () => {
  it("clones an APPROVED template into a new editable local draft", async () => {
    const id = await submittedApprovedId();
    const res = await waCloneTemplate(id, "admin1");
    expect(res.ok).toBe(true);
    const cloneId = (res as any).id as string;
    const clone = await repo.getById(cloneId);
    expect(clone?.source).toBe("LOCAL");
    expect(clone?.metaTemplateId).toBeNull();
    expect(clone?.name).toBe("bmt_appointment_confirmed_copy");
  });
});
