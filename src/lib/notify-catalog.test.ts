// Catalog integrity: every template is a valid, Meta-compliant UTILITY draft;
// the four approved WABA templates are reused verbatim (exact languages and
// variable order); every applicable (category, event) has a route; wording is
// non-promotional and healthcare templates carry no clinical detail.
import { describe, expect, it } from "vitest";
import {
  BUSINESS_CATEGORIES,
  businessCategoryFromProfession,
  buildTemplateCatalog,
  CATALOG_FOOTER,
  catalogEntryToDraft,
  catalogRouteFor,
  catalogRoutes,
  CATEGORY_KINDS,
  EXCLUDED_CANDIDATES,
  TEMPLATE_CATALOG,
} from "./notify-catalog";
import { PUBLISHED_TEMPLATE_SPECS } from "./wa-template-presets";
import { buildCreatePayload, collectPlaceholderKeys, validateDraft } from "./wa-template-model";

describe("business categories", () => {
  it.each([
    ["Healthcare and medical", "clinic"],
    ["Beauty and wellness", "salon"],
    ["Fitness Gym etc", "gym"],
    ["Education institutions", "coaching"],
    ["Restaurant and dining", "restaurant"],
    ["Professional services like law, consultant, real estate, CA", "professional"],
    [null, "clinic"],
    ["Something new", "clinic"],
  ])("maps profession %s → %s", (profession, category) => {
    expect(businessCategoryFromProfession(profession as any)).toBe(category);
  });
});

describe("template catalog", () => {
  it("has unique name + language pairs and valid Meta template names", () => {
    const keys = TEMPLATE_CATALOG.map((t) => `${t.name}|${t.language}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TEMPLATE_CATALOG) expect(t.name).toMatch(/^[a-z0-9_]{1,128}$/);
  });

  it.each(TEMPLATE_CATALOG.map((t) => [t.name, t]))(
    "%s validates as a UTILITY draft for each event it serves",
    (_name, t) => {
      const draft = catalogEntryToDraft(t);
      for (const kind of t.kinds) {
        const result = validateDraft(draft, kind);
        expect(result.errors).toEqual([]);
      }
      const payload = buildCreatePayload(draft);
      expect(payload.category).toBe("UTILITY");
      expect(payload.parameter_format).toBe("POSITIONAL");
      const body = payload.components.find((c) => c.type === "BODY")!;
      const keys = collectPlaceholderKeys(draft).filter((k) => k.startsWith("body."));
      expect(body.example?.body_text?.[0]).toHaveLength(keys.length);
      expect(body.example!.body_text![0].every((v) => v.trim() !== "")).toBe(true);
    },
  );

  it("reuses the four approved templates verbatim with their exact languages", () => {
    const existing = TEMPLATE_CATALOG.filter((t) => t.origin === "approved_existing");
    expect(existing.map((t) => [t.name, t.language])).toEqual([
      ["appointment_booked", "en_US"],
      ["appointment_cancelled", "en_US"],
      ["appointment_completed", "en"],
      ["appointment_reminder_day_before", "en"],
    ]);
    for (const t of existing) {
      const spec = PUBLISHED_TEMPLATE_SPECS.find((s) => s.name === t.name)!;
      expect(t.language).toBe(spec.language);
      expect(t.bodyText).toBe(spec.bodyText);
      expect(t.footerText).toBe(spec.footerText);
      expect(t.variableMappings).toEqual(spec.variableMappings);
      // Clinic wording ("at the clinic", "consultation") stays clinic-only.
      expect(t.appliesTo).toEqual(["clinic"]);
    }
  });

  it("routes every applicable event of every category to a template", () => {
    for (const category of BUSINESS_CATEGORIES) {
      for (const kind of CATEGORY_KINDS[category]) {
        expect(catalogRouteFor(category, kind), `${category}/${kind}`).not.toBeNull();
      }
    }
    // One route per (category, kind).
    const keys = catalogRoutes().map((r) => `${r.businessCategory}|${r.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses the existing approved templates for the clinic events they cover", () => {
    expect(catalogRouteFor("clinic", "booked")?.templateName).toBe("appointment_booked");
    expect(catalogRouteFor("clinic", "cancelled")?.templateName).toBe("appointment_cancelled");
    expect(catalogRouteFor("clinic", "completed")?.templateName).toBe("appointment_completed");
    expect(catalogRouteFor("clinic", "reminderDayBefore")?.templateName).toBe(
      "appointment_reminder_day_before",
    );
    expect(catalogRouteFor("salon", "completed")?.templateName).toBe("salon_service_completed");
    expect(catalogRouteFor("restaurant", "restaurantBooked")?.templateName).toBe(
      "restaurant_reservation_confirmed",
    );
  });

  it("keeps new templates transactional: no promotional wording", () => {
    const promo =
      /\b(offer|discount|sale|coupon|promo|deal|% ?off|free|limited time|buy|subscribe now|upgrade)\b/i;
    for (const t of TEMPLATE_CATALOG.filter((x) => x.origin === "catalog_new")) {
      expect(t.bodyText, t.name).not.toMatch(promo);
    }
  });

  it("carries no clinical detail in new healthcare templates", () => {
    const clinical = /diagnos|prescri|treatment|test result|report|medicine|symptom/i;
    for (const t of TEMPLATE_CATALOG.filter(
      (x) => x.appliesTo.includes("clinic") && x.origin === "catalog_new",
    )) {
      expect(t.bodyText, t.name).not.toMatch(clinical);
    }
  });

  it("gives new templates an opt-out footer within Meta's 60-character limit", () => {
    expect(CATALOG_FOOTER.length).toBeLessThanOrEqual(60);
    for (const t of TEMPLATE_CATALOG.filter((x) => x.origin === "catalog_new")) {
      expect(t.footerText).toBe(CATALOG_FOOTER);
    }
  });

  it("builds the video join button from the configured public origin", () => {
    const catalog = buildTemplateCatalog("https://example.test/");
    const video = catalog.find((t) => t.name === "clinic_video_consultation_link")!;
    expect(video.buttons[0]).toMatchObject({
      type: "URL",
      url: "https://example.test/consult/{{1}}",
    });
    expect(video.sampleValues["button.0.1"]).toMatch(/^https:\/\/example\.test\/consult\//);
  });

  it("documents why workflow-less candidates are not submitted", () => {
    const names = EXCLUDED_CANDIDATES.map((x) => x.name).join(" ");
    expect(names).toContain("gym_membership_payment_received");
    expect(names).toContain("restaurant_table_ready");
    expect(names).toContain("payment_received");
    for (const x of EXCLUDED_CANDIDATES) {
      expect(TEMPLATE_CATALOG.some((t) => t.name === x.name)).toBe(false);
    }
  });
});
