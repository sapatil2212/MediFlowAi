// Unit tests for the pure template model + presets (design §17 "Unit").
// No I/O, no fetch, no .env — all functions under test are pure.
import { describe, expect, it } from "vitest";
import {
  allowedActions,
  attentionBucket,
  buildCreatePayload,
  buildPreviewModel,
  componentsFingerprint,
  describeMetaError,
  evaluateMappingEligibility,
  isValidLanguage,
  metaNodeToLocal,
  normalizeStatus,
  parsePlaceholders,
  validateButtons,
  validateDraft,
  validateFooter,
  validateHeaderType,
  validateLanguage,
  validateName,
  validateSampleValues,
  validateVariableMappings,
  type TemplateDraft,
} from "./wa-template-model";
import { TEMPLATE_PRESETS } from "./wa-template-presets";

function draft(overrides: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    name: "bmt_demo",
    language: "en_US",
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    headerType: "NONE",
    headerText: null,
    bodyText: "Hello {{1}}, your code is {{2}}.",
    footerText: "BookMyTime",
    buttons: [],
    sampleValues: { "body.1": "Asha", "body.2": "A1B2C3D4" },
    variableMappings: { "body.1": "name", "body.2": "bookingCode" },
    ...overrides,
  };
}

describe("validateName", () => {
  it("accepts a valid lowercase/underscore name", () => {
    expect(validateName("bmt_appointment_confirmed").ok).toBe(true);
  });
  it("rejects uppercase", () => {
    expect(validateName("BMT_Confirmed").ok).toBe(false);
  });
  it("rejects spaces", () => {
    expect(validateName("bmt confirmed").ok).toBe(false);
  });
  it("rejects hyphens", () => {
    expect(validateName("bmt-confirmed").ok).toBe(false);
  });
  it("rejects unicode", () => {
    expect(validateName("नमस्ते").ok).toBe(false);
  });
  it("rejects empty", () => {
    expect(validateName("").ok).toBe(false);
  });
  it("rejects too-long (>128)", () => {
    expect(validateName("a".repeat(129)).ok).toBe(false);
  });
  it("accepts exactly 128 chars", () => {
    expect(validateName("a".repeat(128)).ok).toBe(true);
  });
});

describe("parsePlaceholders", () => {
  it("parses sequential positional tokens", () => {
    const r = parsePlaceholders("Hi {{1}} and {{2}}.", "POSITIONAL", "body");
    expect(r.errors).toHaveLength(0);
    expect(r.placeholders.map((p) => p.key)).toEqual(["body.1", "body.2"]);
  });
  it("rejects a leading variable", () => {
    const r = parsePlaceholders("{{1}} hello", "POSITIONAL", "body");
    expect(r.errors.some((e) => e.includes("start"))).toBe(true);
  });
  it("rejects a trailing variable", () => {
    const r = parsePlaceholders("hello {{1}}", "POSITIONAL", "body");
    expect(r.errors.some((e) => e.includes("end"))).toBe(true);
  });
  it("rejects adjacent variables", () => {
    const r = parsePlaceholders("a {{1}} {{2}} b", "POSITIONAL", "body");
    expect(r.errors.some((e) => e.includes("next to each other"))).toBe(true);
  });
  it("rejects a positional gap", () => {
    const r = parsePlaceholders("a {{1}} b {{3}} c", "POSITIONAL", "body");
    expect(r.errors.some((e) => e.includes("sequential"))).toBe(true);
  });
  it("parses named tokens", () => {
    const r = parsePlaceholders("Hi {{patient_name}} end", "NAMED", "body");
    expect(r.errors).toHaveLength(0);
    expect(r.placeholders[0].key).toBe("body.patient_name");
    expect(r.placeholders[0].named).toBe(true);
  });
  it("rejects a numeric token in NAMED format", () => {
    const r = parsePlaceholders("Hi {{1}} end", "NAMED", "body");
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("language validation", () => {
  it("rejects an arbitrary code", () => {
    expect(validateLanguage("zz_ZZ").ok).toBe(false);
    expect(isValidLanguage("zz_ZZ")).toBe(false);
  });
  it("accepts hi and mr", () => {
    expect(validateLanguage("hi").ok).toBe(true);
    expect(validateLanguage("mr").ok).toBe(true);
  });
  it("accepts legacy en with a warning", () => {
    const r = validateLanguage("en");
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("round-trips Devanagari sample text (R-LANG-03)", () => {
    const d = draft({
      language: "hi",
      bodyText: "नमस्ते {{1}}, आपका कोड {{2}} है।",
      sampleValues: { "body.1": "आशा", "body.2": "A1B2C3D4" },
    });
    const preview = buildPreviewModel(d);
    expect(preview.body).toContain("आशा");
    const payload = buildCreatePayload(d);
    expect(payload.language).toBe("hi");
    expect(payload.components[0].text).toContain("नमस्ते");
  });
});

describe("sample-data + mapping rules", () => {
  it("requires a sample for every placeholder", () => {
    const d = draft({ sampleValues: { "body.1": "Asha" } });
    expect(validateSampleValues(d).ok).toBe(false);
  });
  it("rejects newlines in a sample", () => {
    const d = draft({ sampleValues: { "body.1": "A\nsha", "body.2": "X" } });
    expect(validateSampleValues(d).ok).toBe(false);
  });
  it("validates mappings against the kind catalogue", () => {
    const d = draft({ variableMappings: { "body.1": "name", "body.2": "doctorName" } });
    // completed does not resolve date/time but doctorName is fine; use a field
    // not allowed for the kind to force a failure.
    const bad = draft({ variableMappings: { "body.1": "name", "body.2": "date" } });
    expect(validateVariableMappings(d, "confirmed").ok).toBe(true);
    expect(validateVariableMappings(bad, "completed").ok).toBe(false);
  });
});

describe("component + button limits", () => {
  it("rejects a footer with a variable", () => {
    expect(validateFooter("Code {{1}}", "POSITIONAL").ok).toBe(false);
  });
  it("rejects more than two URL buttons", () => {
    const r = validateButtons(
      [
        { type: "URL", text: "a", url: "https://x.test/a" },
        { type: "URL", text: "b", url: "https://x.test/b" },
        { type: "URL", text: "c", url: "https://x.test/c" },
      ],
      "POSITIONAL",
    );
    expect(r.ok).toBe(false);
  });
  it("rejects more than one phone button", () => {
    const r = validateButtons(
      [
        { type: "PHONE_NUMBER", text: "a", phoneNumber: "+10000000000" },
        { type: "PHONE_NUMBER", text: "b", phoneNumber: "+10000000001" },
      ],
      "POSITIONAL",
    );
    expect(r.ok).toBe(false);
  });
  it("rejects quick replies that are not grouped", () => {
    const r = validateButtons(
      [
        { type: "QUICK_REPLY", text: "a" },
        { type: "URL", text: "b", url: "https://x.test/b" },
        { type: "QUICK_REPLY", text: "c" },
      ],
      "POSITIONAL",
    );
    expect(r.ok).toBe(false);
  });
  it("accepts grouped quick replies with a trailing URL", () => {
    const r = validateButtons(
      [
        { type: "QUICK_REPLY", text: "a" },
        { type: "QUICK_REPLY", text: "b" },
        { type: "URL", text: "c", url: "https://x.test/c" },
      ],
      "POSITIONAL",
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0); // mixed → desktop notice
  });
  it("rejects a URL button with a non-trailing variable", () => {
    const r = validateButtons(
      [{ type: "URL", text: "go", url: "https://x.test/{{1}}/end" }],
      "POSITIONAL",
    );
    expect(r.ok).toBe(false);
  });
  it("rejects a dynamic URL button in a NAMED template", () => {
    const r = validateButtons(
      [{ type: "URL", text: "go", url: "https://x.test/{{token}}" }],
      "NAMED",
    );
    expect(r.ok).toBe(false);
  });
});

describe("header type", () => {
  it("accepts TEXT and NONE", () => {
    expect(validateHeaderType("TEXT").ok).toBe(true);
    expect(validateHeaderType("NONE").ok).toBe(true);
  });
  it("rejects media headers", () => {
    expect(validateHeaderType("IMAGE").ok).toBe(false);
    expect(validateHeaderType("VIDEO").ok).toBe(false);
    expect(validateHeaderType("LOCATION").ok).toBe(false);
  });
});

describe("create-payload builder", () => {
  it("emits positional body example blocks", () => {
    const payload = buildCreatePayload(draft());
    expect(payload.parameter_format).toBe("POSITIONAL");
    const body = payload.components.find((c) => c.type === "BODY");
    expect(body?.example?.body_text).toEqual([["Asha", "A1B2C3D4"]]);
  });
  it("emits named param example blocks", () => {
    const d = draft({
      parameterFormat: "NAMED",
      bodyText: "Hi {{patient_name}}, code {{booking_code}} end",
      sampleValues: { "body.patient_name": "Asha", "body.booking_code": "A1B2C3D4" },
      variableMappings: { "body.patient_name": "name", "body.booking_code": "bookingCode" },
    });
    const payload = buildCreatePayload(d);
    const body = payload.components.find((c) => c.type === "BODY");
    expect(body?.example?.body_text_named_params).toEqual([
      { param_name: "patient_name", example: "Asha" },
      { param_name: "booking_code", example: "A1B2C3D4" },
    ]);
  });
  it("throws for a media header (builder cannot emit one)", () => {
    const d = draft({ headerType: "IMAGE" });
    expect(() => buildCreatePayload(d)).toThrow();
  });
});

describe("metaNodeToLocal", () => {
  it("marks a media header read-only", () => {
    const local = metaNodeToLocal({
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Hi {{1}}" },
      ],
    });
    expect(local.hasMediaHeader).toBe(true);
    expect(local.headerType).toBe("IMAGE");
  });
  it("reads a text header + buttons", () => {
    const local = metaNodeToLocal({
      parameter_format: "named",
      components: [
        { type: "HEADER", format: "TEXT", text: "Title" },
        { type: "BODY", text: "Body" },
        {
          type: "BUTTONS",
          buttons: [{ type: "URL", text: "Open", url: "https://x.test" }],
        },
      ],
    });
    expect(local.headerType).toBe("TEXT");
    expect(local.parameterFormat).toBe("NAMED");
    expect(local.buttons[0]).toMatchObject({ type: "URL", url: "https://x.test" });
  });
});

describe("componentsFingerprint", () => {
  it("is stable for the same draft and changes when the body changes", () => {
    const a = componentsFingerprint(draft());
    const b = componentsFingerprint(draft());
    const c = componentsFingerprint(draft({ bodyText: "Different {{1}} {{2}} body." }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("preview HTML escaping", () => {
  it("escapes sample values substituted into the body", () => {
    const d = draft({
      bodyText: "Hello {{1}} end",
      sampleValues: { "body.1": "<script>", "body.2": "x" },
      variableMappings: { "body.1": "name" },
    });
    const preview = buildPreviewModel(d);
    expect(preview.body).toContain("&lt;script&gt;");
    expect(preview.body).not.toContain("<script>");
  });
});

describe("status normalization + attention bucketing", () => {
  it("normalizes known statuses", () => {
    const n = normalizeStatus("approved");
    expect(n.normalized).toBe("APPROVED");
    expect(n.known).toBe(true);
  });
  it("keeps an unknown status raw and buckets it safely", () => {
    const n = normalizeStatus("SOME_FUTURE_STATUS");
    expect(n.known).toBe(false);
    expect(attentionBucket("SOME_FUTURE_STATUS")).toBe("unknown");
  });
  it("buckets each known status", () => {
    expect(attentionBucket("APPROVED")).toBe("approved");
    expect(attentionBucket("PENDING")).toBe("pending");
    expect(attentionBucket("REJECTED")).toBe("actionRequired");
    expect(attentionBucket("ARCHIVED")).toBe("inactive");
  });
});

describe("allowed-actions matrix", () => {
  it("allows submit/delete/edit/archive for a local draft", () => {
    const a = allowedActions({
      source: "LOCAL",
      metaStatus: null,
      localState: "DRAFT",
      opState: null,
    });
    expect(a.allowed.submit).toBe(true);
    expect(a.allowed.deleteDraft).toBe(true);
    expect(a.allowed.archive).toBe(true);
    expect(a.allowed.edit).toBe(true);
  });
  it("makes imported templates read-only", () => {
    const a = allowedActions({
      source: "META",
      metaStatus: "APPROVED",
      localState: "SUBMITTED",
      opState: null,
    });
    expect(a.allowed.edit).toBe(false);
    expect(a.reasons.edit).toBeTruthy();
  });
  it("only allows edit for APPROVED/REJECTED/PAUSED local submitted templates", () => {
    const approved = allowedActions({
      source: "LOCAL",
      metaStatus: "APPROVED",
      localState: "SUBMITTED",
      opState: null,
    });
    const pending = allowedActions({
      source: "LOCAL",
      metaStatus: "PENDING",
      localState: "SUBMITTED",
      opState: null,
    });
    expect(approved.allowed.edit).toBe(true);
    expect(pending.allowed.edit).toBe(false);
  });
  it("locks everything but reconcile while uncertain", () => {
    const a = allowedActions({
      source: "LOCAL",
      metaStatus: null,
      localState: "DRAFT",
      opState: "UNCERTAIN",
    });
    expect(a.allowed.reconcile).toBe(true);
    expect(a.allowed.submit).toBe(false);
  });
});

describe("describeMetaError", () => {
  it("maps auth, permission, rate-limit, restricted", () => {
    expect(describeMetaError(190).category).toBe("auth");
    expect(describeMetaError(10).category).toBe("permission");
    expect(describeMetaError(80007).category).toBe("rate_limited");
    expect(describeMetaError(131031).category).toBe("account_restricted");
  });
  it("maps 100 subcodes", () => {
    expect(describeMetaError(100, 2388024).explanation).toContain("already exists");
    expect(describeMetaError(100, 2388299).explanation).toContain("start or end");
  });
  it("falls back to unknown for an unmapped code", () => {
    expect(describeMetaError(999999).category).toBe("unknown");
  });
});

describe("mapping eligibility", () => {
  it("is eligible for APPROVED + UTILITY + resolvable", () => {
    const e = evaluateMappingEligibility({
      metaStatus: "APPROVED",
      metaCategory: "UTILITY",
      draft: draft(),
      kind: "confirmed",
    });
    expect(e.eligible).toBe(true);
  });
  it("is ineligible for non-APPROVED", () => {
    const e = evaluateMappingEligibility({
      metaStatus: "PENDING",
      metaCategory: "UTILITY",
      draft: draft(),
      kind: "confirmed",
    });
    expect(e.eligible).toBe(false);
  });
  it("is ineligible for MARKETING category", () => {
    const e = evaluateMappingEligibility({
      metaStatus: "APPROVED",
      metaCategory: "MARKETING",
      draft: draft(),
      kind: "confirmed",
    });
    expect(e.eligible).toBe(false);
  });
});

describe("preset integrity", () => {
  it("has all six presets", () => {
    expect(TEMPLATE_PRESETS.map((p) => p.draft.name)).toEqual([
      "bmt_appointment_confirmed",
      "bmt_appointment_reminder",
      "bmt_appointment_rescheduled",
      "bmt_appointment_cancelled",
      "bmt_appointment_completed",
      "bmt_booking_updated",
    ]);
  });
  it("all presets are UTILITY and pass full draft validation", () => {
    for (const p of TEMPLATE_PRESETS) {
      expect(p.draft.category).toBe("UTILITY");
      const r = validateDraft(p.draft, p.suggestedKind);
      expect(r.ok, `${p.draft.name}: ${r.errors.join("; ")}`).toBe(true);
    }
  });
  it("rescheduled preset is unmapped (no notify event exists)", () => {
    const resched = TEMPLATE_PRESETS.find((p) => p.draft.name === "bmt_appointment_rescheduled");
    expect(resched?.suggestedKind).toBeNull();
  });
  it("every mapped preset resolves all its variables for its kind", () => {
    for (const p of TEMPLATE_PRESETS) {
      if (!p.suggestedKind) continue;
      expect(validateVariableMappings(p.draft, p.suggestedKind).ok).toBe(true);
    }
  });
});
