// @vitest-environment node
//
// Catalog reconciliation and submission tests. Meta management calls and all
// repositories are test doubles; no production WABA or database is contacted.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMessageTemplateMock } = vi.hoisted(() => ({
  createMessageTemplateMock: vi.fn(),
}));

vi.mock("./db", () => ({
  execute: vi.fn(async () => ({ affectedRows: 1, insertId: null })),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}));

vi.mock("./whatsapp-cloud", () => ({
  resolveCloudConfig: vi.fn(async () => ({
    wabaId: "waba-catalog-test",
    phoneNumberId: "phone-test",
    accessToken: "test-token",
    appSecret: null,
    verifyToken: null,
    apiVersion: "v21.0",
    isEnabled: true,
    source: "env",
  })),
  createMessageTemplate: (...args: unknown[]) => createMessageTemplateMock(...args),
  listMessageTemplates: vi.fn(async () => ({ ok: true, data: { data: [] } })),
  getMessageTemplate: vi.fn(),
  editMessageTemplate: vi.fn(),
  deleteMessageTemplate: vi.fn(),
}));

import { catalogEntryToDraft, findCatalogTemplate, type CatalogTemplate } from "./notify-catalog";
import { __setNotifyRepoForTests } from "./notify-repo";
import { createInMemoryNotifyRepo } from "./notify-repo.memory";
import {
  activateCatalogRoutes,
  catalogState,
  contentMatches,
  planCatalog,
  submitCatalogTemplates,
} from "./notify-template-catalog";
import { __setTemplateRepoForTests } from "./wa-template-repo";
import { createInMemoryTemplateRepo, type InMemoryTemplateRepo } from "./wa-template-repo.memory";

let repo: InMemoryTemplateRepo;

function entry(name: string, language = "en_US"): CatalogTemplate {
  const found = findCatalogTemplate(name, language);
  if (!found) throw new Error(`Missing catalog entry ${name}/${language}`);
  return found;
}

async function seed(
  catalogEntry: CatalogTemplate,
  state: {
    status?: string | null;
    category?: string | null;
    metaId?: string | null;
    bodyText?: string;
    uncertain?: boolean;
  } = {},
) {
  const draft = catalogEntryToDraft(catalogEntry);
  const row = await repo.createDraft({
    ...draft,
    bodyText: state.bodyText ?? draft.bodyText,
    notifyKind: catalogEntry.kinds[0] ?? null,
    source: "META",
    actorId: "test",
  });
  if (state.metaId !== null && (state.metaId || state.status)) {
    await repo.applyMetaState(row.id, {
      metaTemplateId: state.metaId ?? `meta-${catalogEntry.name}`,
      metaStatus: state.status ?? "APPROVED",
      metaCategory: state.category ?? "UTILITY",
      messagingAccountId: "waba-catalog-test",
      localState: "SUBMITTED",
      lastSyncedAt: new Date("2026-10-27T00:00:00Z"),
    });
  }
  if (state.uncertain) {
    await repo.claimOp(row.id, "CREATE", "test");
    await repo.setOpState(row.id, "UNCERTAIN");
  }
  return repo.getById(row.id);
}

beforeEach(() => {
  repo = createInMemoryTemplateRepo();
  __setTemplateRepoForTests(repo);
  __setNotifyRepoForTests(createInMemoryNotifyRepo());
  createMessageTemplateMock.mockReset();
});

afterEach(() => {
  __setTemplateRepoForTests(null);
  __setNotifyRepoForTests(null);
  vi.restoreAllMocks();
});

describe("catalog plan", () => {
  it("distinguishes actual Meta state, category and content without inventing approval", async () => {
    const approved = entry("appointment_booked");
    const pending = entry("salon_booking_confirmed");
    const rejected = entry("gym_session_confirmed");
    const reclassified = entry("coaching_session_confirmed");
    const mismatch = entry("restaurant_reservation_confirmed");
    const draft = entry("booking_confirmed");
    const uncertain = entry("clinic_booking_confirmed");

    const approvedRow = await seed(approved, { status: "APPROVED" });
    await seed(pending, { status: "PENDING" });
    await seed(rejected, { status: "REJECTED" });
    await seed(reclassified, { status: "APPROVED", category: "MARKETING" });
    const mismatchRow = await seed(mismatch, {
      status: "APPROVED",
      bodyText: `${mismatch.bodyText} Changed after approval.`,
    });
    await seed(draft, { metaId: null });
    await seed(uncertain, { metaId: null, uncertain: true });

    expect(contentMatches(approved, approvedRow!)).toBe(true);
    expect(contentMatches(mismatch, mismatchRow!)).toBe(false);
    expect(catalogState(approved, approvedRow!)).toBe("approved");
    expect(catalogState(entry("salon_booking_rescheduled"), null)).toBe("missing");

    const plan = await planCatalog();
    const states = new Map(plan.rows.map((row) => [row.name, row.state]));
    expect(states.get(approved.name)).toBe("approved");
    expect(states.get(pending.name)).toBe("pending");
    expect(states.get(rejected.name)).toBe("rejected");
    expect(states.get(reclassified.name)).toBe("reclassified");
    expect(states.get(mismatch.name)).toBe("content_mismatch");
    expect(states.get(draft.name)).toBe("draft");
    expect(states.get(uncertain.name)).toBe("uncertain");
    expect(states.get("salon_booking_rescheduled")).toBe("missing");
    expect(plan.rows.find((row) => row.name === approved.name)?.sendable).toBe(true);
    expect(plan.rows.find((row) => row.name === pending.name)?.sendable).toBe(false);
    expect(plan.summary.total).toBe(plan.rows.length);
    expect(plan.excluded.some((row) => row.name.includes("payment"))).toBe(true);
  });
});

describe("catalog submission", () => {
  it("submits an exact UTILITY payload with examples, persists PENDING, and is idempotent", async () => {
    const catalogEntry = entry("salon_booking_confirmed");
    const draft = catalogEntryToDraft(catalogEntry);
    await repo.createDraft({
      ...draft,
      bodyText:
        "Hello {{1}}, your {{2}} appointment at {{3}} is confirmed for {{4}} at {{5}}. Reference {{6}}.",
      notifyKind: catalogEntry.kinds[0],
      source: "LOCAL",
      actorId: "earlier-catalog-run",
      description: catalogEntry.purpose,
      purpose: catalogEntry.appliesTo.join(","),
    });
    createMessageTemplateMock.mockResolvedValue({
      ok: true,
      data: { id: "meta-salon-1", status: "PENDING", category: "UTILITY" },
    });

    const first = await submitCatalogTemplates({
      names: [catalogEntry.name],
      actorId: "super-admin-test",
      pauseMs: 0,
    });
    expect(first.results).toEqual([
      expect.objectContaining({
        name: catalogEntry.name,
        language: "en_US",
        outcome: "submitted",
        metaTemplateId: "meta-salon-1",
        metaStatus: "PENDING",
      }),
    ]);
    expect(createMessageTemplateMock).toHaveBeenCalledTimes(1);
    const payload = createMessageTemplateMock.mock.calls[0][0] as Record<string, any>;
    expect(payload).toMatchObject({
      name: catalogEntry.name,
      language: "en_US",
      category: "UTILITY",
      parameter_format: "POSITIONAL",
    });
    const body = payload.components.find((component: any) => component.type === "BODY");
    expect(body.text).toBe(catalogEntry.bodyText);
    expect(body.example.body_text[0]).toEqual([
      "Rahul",
      "Hair Spa",
      "Glow Studio",
      "28 October 2026",
      "10:30 AM",
      "BK7Q2M9X",
    ]);
    expect(payload.components).toContainEqual({ type: "FOOTER", text: catalogEntry.footerText });

    const stored = await repo.getByNameLanguage(catalogEntry.name, catalogEntry.language);
    expect(stored).toMatchObject({
      metaTemplateId: "meta-salon-1",
      metaStatus: "PENDING",
      metaCategory: "UTILITY",
      messagingAccountId: "waba-catalog-test",
      localState: "SUBMITTED",
    });

    const second = await submitCatalogTemplates({
      names: [catalogEntry.name],
      actorId: "super-admin-test",
      pauseMs: 0,
    });
    expect(second.results[0]).toMatchObject({
      outcome: "already_exists",
      metaTemplateId: "meta-salon-1",
      metaStatus: "PENDING",
    });
    expect(createMessageTemplateMock).toHaveBeenCalledTimes(1);
  });

  it("stops subsequent submissions after an authentication error", async () => {
    createMessageTemplateMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "190",
      message: "Invalid OAuth access token",
    });

    const result = await submitCatalogTemplates({
      names: ["clinic_booking_confirmed", "clinic_booking_rescheduled"],
      actorId: "super-admin-test",
      pauseMs: 0,
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ outcome: "failed", code: "190" });
    expect(result.results[1]).toMatchObject({
      outcome: "stopped",
      detail: expect.stringContaining("Meta error 190"),
    });
    expect(createMessageTemplateMock).toHaveBeenCalledTimes(1);
  });
});

describe("catalog activation", () => {
  it("narrows legacy wildcard mappings and activates only exact APPROVED UTILITY templates", async () => {
    const clinic = entry("appointment_booked");
    const salon = entry("salon_booking_confirmed");
    const pendingGym = entry("gym_session_confirmed");
    const marketingCoaching = entry("coaching_session_confirmed");
    const mismatchedRestaurant = entry("restaurant_reservation_confirmed");

    const clinicRow = (await seed(clinic, { status: "APPROVED" }))!;
    const salonRow = (await seed(salon, { status: "APPROVED" }))!;
    await seed(pendingGym, { status: "PENDING" });
    await seed(marketingCoaching, { status: "APPROVED", category: "MARKETING" });
    await seed(mismatchedRestaurant, {
      status: "APPROVED",
      bodyText: `${mismatchedRestaurant.bodyText} Mismatch`,
    });

    await repo.upsertMapping({
      notifyKind: "booked",
      businessCategory: "*",
      templateId: clinicRow.id,
      language: clinic.language,
      actorId: "legacy",
    });
    await repo.setMappingEnabled("booked", true, { version: "v1", actorId: "legacy" }, "*");

    const result = await activateCatalogRoutes({ actorId: "catalog-test" });

    expect(await repo.getMapping("booked", "*")).toBeNull();
    expect(await repo.getMapping("booked", "clinic")).toMatchObject({
      templateId: clinicRow.id,
      businessCategory: "clinic",
      isEnabled: true,
      optInAckAt: expect.any(Date),
    });
    expect(await repo.getMapping("booked", "salon")).toMatchObject({
      templateId: salonRow.id,
      businessCategory: "salon",
      isEnabled: true,
    });
    expect(await repo.getMapping("booked", "gym")).toBeNull();
    expect(await repo.getMapping("booked", "coaching")).toBeNull();
    expect(await repo.getMapping("restaurantBooked", "restaurant")).toBeNull();
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "narrowed", businessCategory: "clinic" }),
        expect.objectContaining({ action: "mapped", businessCategory: "salon" }),
      ]),
    );
  });
});
