// @vitest-environment node
//
// Tests for the runtime notification gate (wa-template-notify.ts). The repo is
// the in-memory double; isCloudAvailable/resolveCloudConfig are stubbed. No DB,
// no Meta call. The core invariant: with no enabled mapping resolveTemplatePlan
// returns null (→ the router's byte-identical text path).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const isCloudAvailableMock = vi.fn();
const resolveCloudConfigMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  isCloudAvailable: (...a: any[]) => isCloudAvailableMock(...a),
  resolveCloudConfig: (...a: any[]) => resolveCloudConfigMock(...a),
}));

import { createInMemoryTemplateRepo, InMemoryTemplateRepo } from "./wa-template-repo.memory";
import { __setTemplateRepoForTests } from "./wa-template-repo";
import { invalidateMappingCache, resolveTemplatePlan } from "./wa-template-notify";
import type { AptNotifyContext } from "./appointment-notify";

let repo: InMemoryTemplateRepo;

const CTX: AptNotifyContext & { recipientPhone?: string | null } = {
  name: "Asha Patel",
  clinicName: "Sunrise Clinic",
  doctorName: "Dr. Mehta",
  dateTime: new Date("2026-01-12T10:30:00Z"),
  appointmentId: "a1b2c3d4e5f6",
  recipientPhone: "8830553868",
};

/** Seeds an APPROVED UTILITY template for `confirmed` and an enabled mapping. */
async function seedApprovedMapping(overrides?: {
  metaStatus?: string;
  metaCategory?: string;
  enabled?: boolean;
  ack?: boolean;
  messagingAccountId?: string | null;
  mappings?: Record<string, any>;
}) {
  const tpl = await repo.createDraft({
    name: "bmt_appointment_confirmed",
    language: "en_US",
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    headerType: "NONE",
    bodyText:
      "Hello {{1}}, your appointment at {{2}} with {{3}} on {{4}} at {{5}} is confirmed. Code {{6}}.",
    buttons: [],
    variableMappings: overrides?.mappings ?? {
      "body.1": "name",
      "body.2": "clinicName",
      "body.3": "doctorName",
      "body.4": "date",
      "body.5": "time",
      "body.6": "bookingCode",
    },
    sampleValues: {},
    actorId: "admin1",
  });
  await repo.applyMetaState(tpl.id, {
    metaStatus: overrides?.metaStatus ?? "APPROVED",
    metaCategory: overrides?.metaCategory ?? "UTILITY",
    metaTemplateId: "100",
    messagingAccountId:
      overrides?.messagingAccountId === undefined
        ? "222"
        : (overrides.messagingAccountId ?? undefined),
    localState: "SUBMITTED",
  });
  await repo.upsertMapping({
    notifyKind: "confirmed",
    templateId: tpl.id,
    language: "en_US",
    actorId: "admin1",
  });
  if (overrides?.enabled ?? true) {
    await repo.setMappingEnabled(
      "confirmed",
      true,
      overrides?.ack === false ? null : { version: "v1", actorId: "admin1" },
    );
  }
  return tpl;
}

beforeEach(() => {
  repo = createInMemoryTemplateRepo();
  __setTemplateRepoForTests(repo);
  invalidateMappingCache();
  isCloudAvailableMock.mockReset();
  resolveCloudConfigMock.mockReset();
  isCloudAvailableMock.mockResolvedValue(true);
  resolveCloudConfigMock.mockResolvedValue({ wabaId: "222", apiVersion: "v26.0" });
});

afterEach(() => {
  __setTemplateRepoForTests(null);
  invalidateMappingCache();
});

describe("resolveTemplatePlan — gates", () => {
  it("returns null when there is NO mapping (byte-identical text path, the incident fix)", async () => {
    const plan = await resolveTemplatePlan("confirmed", CTX);
    expect(plan).toBeNull();
  });

  it("returns a plan with body params in placeholder order when every gate passes", async () => {
    await seedApprovedMapping();
    invalidateMappingCache();
    const plan = await resolveTemplatePlan("confirmed", CTX);
    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe("bmt_appointment_confirmed");
    expect(plan!.language).toBe("en_US");
    expect(plan!.bodyParams.map((p) => p.text)).toEqual([
      "Asha Patel",
      "Sunrise Clinic",
      "Dr. Mehta",
      // date/time come from fmtDate/fmtTime; just assert they resolved non-empty
      expect.any(String),
      expect.any(String),
      "A1B2C3D4", // bookingCode = first 8 chars upper-cased (DP-08)
    ]);
  });

  it("returns null when Cloud is unavailable", async () => {
    await seedApprovedMapping();
    invalidateMappingCache();
    isCloudAvailableMock.mockResolvedValue(false);
    expect(await resolveTemplatePlan("confirmed", CTX)).toBeNull();
  });

  it("returns null when the recipient phone is missing", async () => {
    await seedApprovedMapping();
    invalidateMappingCache();
    expect(await resolveTemplatePlan("confirmed", { ...CTX, recipientPhone: null })).toBeNull();
  });

  it("returns null when the mapping is disabled or lacks an opt-in ack", async () => {
    await seedApprovedMapping({ enabled: false });
    invalidateMappingCache();
    expect(await resolveTemplatePlan("confirmed", CTX)).toBeNull();
  });

  it("returns null when the template is not APPROVED", async () => {
    await seedApprovedMapping({ metaStatus: "PENDING" });
    invalidateMappingCache();
    expect(await resolveTemplatePlan("confirmed", CTX)).toBeNull();
  });

  it("returns null when the Meta category is not UTILITY", async () => {
    await seedApprovedMapping({ metaCategory: "MARKETING" });
    invalidateMappingCache();
    expect(await resolveTemplatePlan("confirmed", CTX)).toBeNull();
  });

  it("returns null when a mapped placeholder cannot resolve (never sends a blank param)", async () => {
    await seedApprovedMapping();
    invalidateMappingCache();
    // No appointmentId → bookingCode cannot resolve → fall back to text.
    expect(await resolveTemplatePlan("confirmed", { ...CTX, appointmentId: null })).toBeNull();
  });

  it("returns null when the template belongs to a different Messaging account", async () => {
    await seedApprovedMapping({ messagingAccountId: "999" });
    invalidateMappingCache();
    expect(await resolveTemplatePlan("confirmed", CTX)).toBeNull();
  });
});

// ── FEAT-004: cross-tenant variable resolution is impossible (design §17) ────
describe("resolveTemplatePlan — tenant isolation of variable resolution", () => {
  it("resolves ONLY from the passed appointment ctx (no cross-tenant bleed)", async () => {
    await seedApprovedMapping();
    invalidateMappingCache();

    const tenantA = await resolveTemplatePlan("confirmed", {
      ...CTX,
      name: "Alice A",
      clinicName: "Clinic A",
      appointmentId: "AAAA1111bbbb",
    });
    const tenantB = await resolveTemplatePlan("confirmed", {
      ...CTX,
      name: "Bob B",
      clinicName: "Clinic B",
      appointmentId: "BBBB2222cccc",
    });

    // Each plan carries ONLY its own ctx values; nothing from the other tenant.
    expect(tenantA!.bodyParams[0].text).toBe("Alice A");
    expect(tenantA!.bodyParams[1].text).toBe("Clinic A");
    expect(tenantA!.bodyParams[5].text).toBe("AAAA1111"); // bookingCode from A's id
    expect(tenantB!.bodyParams[0].text).toBe("Bob B");
    expect(tenantB!.bodyParams[1].text).toBe("Clinic B");
    expect(tenantB!.bodyParams[5].text).toBe("BBBB2222");

    const aJson = JSON.stringify(tenantA);
    expect(aJson).not.toContain("Bob B");
    expect(aJson).not.toContain("Clinic B");
    expect(aJson).not.toContain("BBBB2222");
  });

  it("never emits a Meta-side secret (no app secret / token appears in a plan)", async () => {
    await seedApprovedMapping();
    invalidateMappingCache();
    const plan = await resolveTemplatePlan("confirmed", CTX);
    const json = JSON.stringify(plan);
    expect(json).not.toMatch(/accessToken|appSecret|Bearer|EAA[A-Za-z0-9]/);
  });
});
