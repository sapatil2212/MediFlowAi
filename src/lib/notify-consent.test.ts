import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyConsentKeyword,
  decideConsent,
  evaluateConsent,
  parseConsentKeyword,
  recordConsent,
} from "./notify-consent";
import { __setNotifyRepoForTests, type ConsentRow } from "./notify-repo";
import { createInMemoryNotifyRepo, type InMemoryNotifyRepo } from "./notify-repo.memory";

const row = (status: ConsentRow["status"], tenantId = "t1"): ConsentRow => ({
  id: "c",
  tenantId,
  phone: "919876543210",
  channel: "whatsapp",
  status,
  source: "public_booking_form",
  noticeVersion: "v",
  appointmentId: null,
  capturedAtMs: 1,
  withdrawnAtMs: null,
});

describe("decideConsent", () => {
  it("platform opt-out (STOP) beats everything", () => {
    expect(decideConsent(row("opted_out", "*"), row("opted_in"), "implied_by_booking")).toEqual({
      allowed: false,
      reason: "opted_out_platform",
    });
  });
  it("tenant opt-out is honoured", () => {
    expect(decideConsent(null, row("opted_out"), "implied_by_booking").allowed).toBe(false);
  });
  it("explicit opt-in allows in both modes", () => {
    expect(decideConsent(null, row("opted_in"), "explicit_only")).toEqual({
      allowed: true,
      basis: "explicit_opt_in",
    });
  });
  it("no record: implied by booking vs explicit-only", () => {
    expect(decideConsent(null, null, "implied_by_booking")).toEqual({
      allowed: true,
      basis: "booking_provided_number",
    });
    expect(decideConsent(null, null, "explicit_only")).toEqual({
      allowed: false,
      reason: "consent_missing",
    });
  });
});

describe("parseConsentKeyword", () => {
  it.each([
    ["STOP", "stop"],
    [" stop. ", "stop"],
    ["Unsubscribe", "stop"],
    ["START", "start"],
    ["subscribe!", "start"],
    ["please stop sending these", null],
    ["", null],
  ])("%j → %j", (text, kw) => {
    expect(parseConsentKeyword(text)).toBe(kw);
  });
});

describe("recording consent", () => {
  let repo: InMemoryNotifyRepo;
  beforeEach(() => {
    repo = createInMemoryNotifyRepo();
    __setNotifyRepoForTests(repo);
  });
  afterEach(() => __setNotifyRepoForTests(null));

  it("stores the normalized number, source and notice version, then a later opt-out wins", async () => {
    await recordConsent({
      tenantId: "t1",
      phone: "98765 43210",
      optedIn: true,
      source: "public_booking_form",
      appointmentId: "a1",
      nowMs: 10,
    });
    expect(await repo.getConsent("t1", "919876543210")).toMatchObject({
      status: "opted_in",
      source: "public_booking_form",
      appointmentId: "a1",
      capturedAtMs: 10,
    });
    await recordConsent({
      tenantId: "t1",
      phone: "+91 9876543210",
      optedIn: false,
      source: "tenant_admin",
      nowMs: 20,
    });
    expect((await repo.getConsent("t1", "919876543210"))?.status).toBe("opted_out");
    expect(repo.audit.map((a) => a.action)).toEqual(["consent_opt_in", "consent_opt_out"]);
  });

  it("STOP to the shared number blocks every tenant; START lifts it", async () => {
    const reply = await applyConsentKeyword({ from: "919876543210", keyword: "stop", nowMs: 5 });
    expect(reply).toMatch(/no longer receive/);
    expect(
      await evaluateConsent({
        tenantId: "any-tenant",
        phone: "919876543210",
        mode: "implied_by_booking",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "opted_out_platform",
    });
    await applyConsentKeyword({ from: "919876543210", keyword: "start", nowMs: 6 });
    expect(
      (
        await evaluateConsent({
          tenantId: "any-tenant",
          phone: "919876543210",
          mode: "implied_by_booking",
        })
      ).allowed,
    ).toBe(true);
  });

  it("a new booking-form opt-in never overturns a recorded opt-out", async () => {
    await recordConsent({
      tenantId: "t1",
      phone: "9876543210",
      optedIn: false,
      source: "tenant_admin",
      nowMs: 1,
    });
    expect(
      await recordConsent({
        tenantId: "t1",
        phone: "9876543210",
        optedIn: true,
        source: "public_booking_form",
        nowMs: 2,
      }),
    ).toBe(false);
    expect((await repo.getConsent("t1", "919876543210"))?.status).toBe("opted_out");
    // An explicit owner choice can still re-enable it.
    await recordConsent({
      tenantId: "t1",
      phone: "9876543210",
      optedIn: true,
      source: "tenant_admin",
      nowMs: 3,
    });
    expect((await repo.getConsent("t1", "919876543210"))?.status).toBe("opted_in");
  });

  it("refuses an invalid number", async () => {
    expect(
      await recordConsent({ tenantId: "t1", phone: "123", optedIn: true, source: "tenant_admin" }),
    ).toBe(false);
  });
});
