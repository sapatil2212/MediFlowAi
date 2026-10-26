// @vitest-environment node
//
// FEAT-004 E2E flow test (design §17 E2E; task.md §22, the 12 steps). Pure
// vitest — NO browser. One test walks the whole feature against the in-memory
// TemplateRepo double, a stubbed Graph transport, and a REAL signed webhook
// request through handleWaWebhook:
//
//   1. open the module          → waTemplateDashboard loads
//   2. create a local draft      → waCreateDraft
//   3. insert variables          → variableMappings on the draft
//   4. preview                   → buildPreviewModel (HTML-escaped, not sent)
//   5. save                      → waUpdateDraft
//   6. submit via mocked Meta     → waSubmitTemplate ⇒ PENDING (NEVER APPROVED)
//   7. view Pending              → waTemplateDetails shows PENDING
//   8. signed APPROVED webhook    → handleWaWebhook(message_template_status_update)
//   9. see Approved              → waTemplateDetails shows APPROVED
//  10. assign + enable mapping   → waAssignMapping + waSetMappingEnabled(optInAck)
//  11. waSyncAll (mocked list)   → runFullSync pages the mocked Meta list
//  12. archive a draft           → waArchiveDraft (a never-submitted draft)
//
// No live Meta call and no .env read: fetch/transport is stubbed everywhere and
// the webhook config is provided by a mocked resolveCloudConfig.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const APP_SECRET = "e2e-app-secret";
const WABA_ID = "222";

// ── Stub the Graph transport (create + list) and the webhook config. ─────────
const createMessageTemplateMock = vi.fn();
const listMessageTemplatesMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  resolveCloudConfig: vi.fn(async () => ({
    wabaId: WABA_ID,
    phoneNumberId: "111",
    accessToken: "e2e-token",
    appSecret: APP_SECRET,
    apiVersion: "v26.0",
    isEnabled: true,
    source: "db",
  })),
  isCloudAvailable: vi.fn(async () => true),
  createMessageTemplate: (...a: any[]) => createMessageTemplateMock(...a),
  listMessageTemplates: (...a: any[]) => listMessageTemplatesMock(...a),
}));

// The webhook only touches the DB for the WebhookEvent idempotency insert; the
// template state goes through the in-memory repo. A per-key insert double makes
// re-delivery idempotent, matching production.
const insertedKeys = new Set<string>();
vi.mock("./db", () => ({
  execute: vi.fn(async (sql: string, params: any[]) => {
    if (typeof sql === "string" && sql.includes("INSERT INTO WebhookEvent")) {
      const key = params[1];
      if (insertedKeys.has(key)) throw new Error("duplicate");
      insertedKeys.add(key);
    }
    return { affectedRows: 1, insertId: null };
  }),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}));

import { createInMemoryTemplateRepo, InMemoryTemplateRepo } from "./wa-template-repo.memory";
import { __setTemplateRepoForTests } from "./wa-template-repo";
import {
  waArchiveDraft,
  waAssignMapping,
  waCreateDraft,
  waSetMappingEnabled,
  waSubmitTemplate,
  waTemplateDashboard,
  waTemplateDetails,
  waUpdateDraft,
  type DraftPayload,
} from "./wa-templates";
import { waSyncAll } from "./wa-template-sync";
import { attentionBucket, buildPreviewModel } from "./wa-template-model";
import { payloadToDraft } from "./wa-templates";
import { handleWaWebhook, WA_WEBHOOK_PATH } from "./whatsapp-webhook";
import { invalidateMappingCache } from "./wa-template-notify";

let repo: InMemoryTemplateRepo;

const DRAFT: DraftPayload = {
  name: "bmt_appointment_confirmed",
  language: "en_US",
  parameterFormat: "POSITIONAL",
  headerType: "NONE",
  bodyText: "Hello {{1}}, your appointment at {{2}} on {{3}} is confirmed.",
  footerText: "BookMyTime appointment notification",
  buttons: [],
  sampleValues: { "body.1": "Asha", "body.2": "Sunrise Clinic", "body.3": "Mon 12 Jan" },
  variableMappings: { "body.1": "name", "body.2": "clinicName", "body.3": "date" },
  notifyKind: "confirmed",
};

function sign(body: string): string {
  return "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
}

/** A signed APPROVED status-update webhook request for the given Meta id. */
function approvedWebhook(metaTemplateId: string): Request {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA_ID,
        // The webhook arrives after submission; a small margin keeps it ahead of
        // the sub-second metaUpdatedAt stamped at submit time (monotonic guard).
        time: Math.floor(Date.now() / 1000) + 5,
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: "APPROVED",
              message_template_id: Number(metaTemplateId),
              message_template_name: DRAFT.name,
              message_template_language: "en_US",
            },
          },
        ],
      },
    ],
  };
  const body = JSON.stringify(payload);
  return new Request(`https://x.test${WA_WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "x-hub-signature-256": sign(body) },
    body,
  });
}

beforeEach(() => {
  repo = createInMemoryTemplateRepo();
  __setTemplateRepoForTests(repo);
  invalidateMappingCache();
  insertedKeys.clear();
  createMessageTemplateMock.mockReset();
  listMessageTemplatesMock.mockReset();
});

afterEach(() => {
  __setTemplateRepoForTests(null);
  invalidateMappingCache();
});

describe("WhatsApp template management — 12-step E2E flow (T§22)", () => {
  it("walks open → create → variables → preview → save → submit(PENDING) → webhook(APPROVED) → mapping → sync → archive", async () => {
    // 1 ── open the module: the dashboard loads with an empty summary.
    const opened = await waTemplateDashboard();
    expect(opened.ok).toBe(true);

    // 2 ── create a local draft (placeholders mapped to booking fields).
    const created = await waCreateDraft(DRAFT, "admin-1");
    expect(created.ok).toBe(true);
    const id = (created as any).id as string;
    const afterCreate = await waTemplateDetails(id);
    expect(afterCreate.ok).toBe(true);
    if (afterCreate.ok) {
      expect(afterCreate.row.source).toBe("LOCAL");
      expect(afterCreate.row.metaStatus).toBeNull(); // not submitted yet
    }

    // 3 ── insert variables: refine the mapping + sample values for the preview.
    const withVars: DraftPayload & { id: string } = {
      ...DRAFT,
      id,
      variableMappings: { "body.1": "name", "body.2": "clinicName", "body.3": "date" },
      sampleValues: { "body.1": "Asha", "body.2": "Sunrise Clinic", "body.3": "Mon 12 Jan" },
    };

    // 4 ── preview: the model is built client-side, HTML-escaped, NOT sent.
    const preview = buildPreviewModel(payloadToDraft(withVars));
    expect(preview.body).toContain("Asha"); // sample value substituted
    expect(createMessageTemplateMock).not.toHaveBeenCalled(); // preview never calls Meta

    // 5 ── save: persist the variable mapping.
    const saved = await waUpdateDraft(withVars, "admin-1");
    expect(saved.ok).toBe(true);
    expect((await repo.getById(id))?.variableMappings).toMatchObject({
      "body.1": "name",
      "body.2": "clinicName",
      "body.3": "date",
    });

    // 6 ── submit via mocked Meta → PENDING (the invariant: NEVER APPROVED here).
    createMessageTemplateMock.mockResolvedValue({
      ok: true,
      data: { id: "900", status: "PENDING", category: "UTILITY" },
    });
    const submitted = await waSubmitTemplate(id, "admin-1");
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.metaStatus).toBe("PENDING");
      expect(submitted.metaStatus).not.toBe("APPROVED");
      expect(submitted.metaTemplateId).toBe("900");
    }

    // 7 ── view Pending: details reflect the submitted, pending state.
    const pending = await waTemplateDetails(id);
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.row.metaStatus).toBe("PENDING");
      expect(pending.row.localState).toBe("SUBMITTED");
      expect(attentionBucket(pending.row.metaStatus)).toBe("pending");
    }

    // 8 ── signed APPROVED webhook: a real HMAC-signed request is processed.
    const res = await handleWaWebhook(approvedWebhook("900"));
    expect(res.status).toBe(200);

    // 9 ── see Approved: the webhook moved the row to APPROVED.
    const approved = await waTemplateDetails(id);
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.row.metaStatus).toBe("APPROVED");
      expect(attentionBucket(approved.row.metaStatus)).toBe("approved");
    }

    // 10 ── assign + enable the mapping (opt-in acknowledgement required).
    const assign = await waAssignMapping({ notifyKind: "confirmed", templateId: id }, "admin-1");
    expect(assign.ok).toBe(true);
    // Enabling without the ack is refused …
    const noAck = await waSetMappingEnabled(
      { notifyKind: "confirmed", enabled: true, optInAck: false },
      "admin-1",
    );
    expect(noAck.ok).toBe(false);
    // … with the ack it enables and records the acknowledgement.
    const enabled = await waSetMappingEnabled(
      { notifyKind: "confirmed", enabled: true, optInAck: true },
      "admin-1",
    );
    expect(enabled.ok).toBe(true);
    const mapping = await repo.getMapping("confirmed");
    expect(mapping?.isEnabled).toBe(true);
    expect(mapping?.optInAckAt).not.toBeNull();

    // 11 ── waSyncAll with a mocked Meta list: the row is refreshed, plus a new
    //        META-source import is created from the second list entry.
    listMessageTemplatesMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            id: "900",
            name: DRAFT.name,
            language: "en_US",
            status: "APPROVED",
            category: "UTILITY",
          },
          {
            id: "901",
            name: "an_imported_tpl",
            language: "hi",
            status: "APPROVED",
            category: "UTILITY",
          },
        ],
        paging: {},
      },
    });
    const sync = await waSyncAll();
    expect(sync.ok).toBe(true);
    expect(sync.scanned).toBe(2);
    expect(await repo.getByMetaTemplateId("901")).not.toBeNull();

    // 12 ── archive a draft: a fresh never-submitted draft can be archived.
    const draft2 = await waCreateDraft({ ...DRAFT, name: "bmt_to_archive" }, "admin-1");
    expect(draft2.ok).toBe(true);
    const archive = await waArchiveDraft((draft2 as any).id, "admin-1");
    expect(archive.ok).toBe(true);
    expect((await repo.getById((draft2 as any).id))?.archivedAt).not.toBeNull();

    // End-to-end invariant: not one live Meta create happened outside submit,
    // and PENDING was only ever promoted to APPROVED by the signed webhook.
    expect(createMessageTemplateMock).toHaveBeenCalledTimes(1);
  });
});
