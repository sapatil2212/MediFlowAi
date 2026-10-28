// @vitest-environment node
//
// Tenant notification-center authorization and isolation tests. All state is
// in memory; the tenant identity supplied here represents a verified session.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  execute: vi.fn(async () => ({ affectedRows: 1, insertId: null })),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}));

import {
  parseTenantSettingsPatch,
  saveTenantNotificationSettings,
  setTenantCustomerConsent,
  tenantNotificationCenter,
  type TenantSessionUser,
} from "./notify-tenant";
import { __setNotifyRepoForTests } from "./notify-repo";
import { createInMemoryNotifyRepo, type InMemoryNotifyRepo } from "./notify-repo.memory";
import { __setTemplateRepoForTests } from "./wa-template-repo";
import { createInMemoryTemplateRepo } from "./wa-template-repo.memory";

let repo: InMemoryNotifyRepo;

function user(overrides: Partial<TenantSessionUser> = {}): TenantSessionUser {
  return {
    id: "owner-a",
    tenantId: "tenant-a",
    role: "admin",
    profession: "Healthcare and medical",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: null,
    ...overrides,
  };
}

async function addEvent(tenantId: string, id: string, status: "pending" | "skipped" = "pending") {
  return repo.insertEvent({
    eventKey: `booking.created:${id}`,
    tenantId,
    businessCategory: "clinic",
    eventType: "booking.created",
    notifyKind: "booked",
    appointmentId: id,
    recipient: tenantId === "tenant-a" ? "919876543210" : "919999999999",
    source: "test",
    status,
    statusReason: status === "skipped" ? "test" : null,
    scheduledForMs: Date.now(),
    createdAtMs: Date.now(),
  });
}

beforeEach(() => {
  repo = createInMemoryNotifyRepo();
  __setNotifyRepoForTests(repo);
  __setTemplateRepoForTests(createInMemoryTemplateRepo());
});

afterEach(() => {
  __setNotifyRepoForTests(null);
  __setTemplateRepoForTests(null);
  vi.restoreAllMocks();
});

describe("tenant isolation", () => {
  it("returns only events and counts belonging to the verified session tenant", async () => {
    await addEvent("tenant-a", "appt-a1");
    await addEvent("tenant-a", "appt-a2", "skipped");
    await addEvent("tenant-b", "appt-b1");

    const center = await tenantNotificationCenter(user());
    expect(center).toMatchObject({ ok: true, available: true, canEdit: true });
    if (!("recent" in center) || !center.recent) throw new Error("center unavailable");
    expect(center.recent.map((event) => event.tenantId)).toEqual(["tenant-a", "tenant-a"]);
    expect(center.recent.map((event) => event.appointmentId).sort()).toEqual([
      "appt-a1",
      "appt-a2",
    ]);
    expect(center.counts).toEqual({ pending: 1, skipped: 1 });
    expect(JSON.stringify(center)).not.toContain("appt-b1");
    expect(JSON.stringify(center)).not.toContain("919999999999");
  });

  it("ignores a client-supplied tenantId and writes settings/consent only in session scope", async () => {
    const owner = user();
    const saved = await saveTenantNotificationSettings(owner, {
      tenantId: "tenant-b",
      confirmations: false,
      timezone: "Asia/Kolkata",
    });
    expect(saved).toMatchObject({
      ok: true,
      settings: { tenantId: "tenant-a", confirmations: false },
    });
    expect((await repo.getTenantSettings("tenant-a")).confirmations).toBe(false);
    expect((await repo.getTenantSettings("tenant-b")).confirmations).toBe(true);

    expect(await setTenantCustomerConsent(owner, { phone: "9876543210", optedIn: false })).toEqual({
      ok: true,
    });
    expect(await repo.getConsent("tenant-a", "919876543210")).toMatchObject({
      status: "opted_out",
      source: "tenant_admin",
    });
    expect(await repo.getConsent("tenant-b", "919876543210")).toBeNull();
  });
});

describe("owner authorization", () => {
  it.each(["reception", "doctor", "location"])(
    "does not let a %s session change settings or customer consent",
    async (role) => {
      const staff = user({ id: `staff-${role}`, role });
      expect(await saveTenantNotificationSettings(staff, { confirmations: false })).toMatchObject({
        ok: false,
        error: expect.stringContaining("workspace owner"),
      });
      expect(
        await setTenantCustomerConsent(staff, { phone: "9876543210", optedIn: false }),
      ).toMatchObject({ ok: false, error: expect.stringContaining("workspace owner") });
      expect((await repo.getTenantSettings("tenant-a")).confirmations).toBe(true);
      expect(await repo.getConsent("tenant-a", "919876543210")).toBeNull();
    },
  );

  it("validates booleans and IANA timezones before saving", () => {
    expect(parseTenantSettingsPatch({ reminder2h: true, timezone: "America/New_York" })).toEqual({
      reminder2h: true,
      timezone: "America/New_York",
    });
    expect(() => parseTenantSettingsPatch({ confirmations: "false" })).toThrow(/true or false/);
    expect(() => parseTenantSettingsPatch({ timezone: "Mars/Olympus" })).toThrow(/timezone/);
  });
});

describe("plan gating", () => {
  it("hides notification operations from Basic or inactive subscriptions", async () => {
    const basic = await tenantNotificationCenter(user({ subscriptionPlan: "Basic" }));
    expect(basic).toMatchObject({
      ok: true,
      available: false,
      message: expect.stringContaining("not included"),
    });
    expect(
      await saveTenantNotificationSettings(user({ subscriptionPlan: "Basic" }), {
        confirmations: false,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("not included"),
    });

    const inactive = await tenantNotificationCenter(user({ subscriptionStatus: "Cancelled" }));
    expect(inactive).toMatchObject({ ok: true, available: false });
  });

  it("allows Premium owners to operate while staff can only view", async () => {
    expect(await tenantNotificationCenter(user())).toMatchObject({
      ok: true,
      available: true,
      canEdit: true,
    });
    expect(await tenantNotificationCenter(user({ role: "reception" }))).toMatchObject({
      ok: true,
      available: true,
      canEdit: false,
    });
  });
});
