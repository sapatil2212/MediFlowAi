// @vitest-environment node
//
// Notification engine + dispatcher integration tests. The real catalog gate,
// template parameter resolver, router and Cloud payload builder run together;
// persistence is in memory and fetch/SQL are mocked, so no database or real
// WhatsApp recipient can be touched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, queryMock, queryOneMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));

vi.mock("./db", () => ({
  execute: (...args: unknown[]) => executeMock(...args),
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: (...args: unknown[]) => queryOneMock(...args),
}));

import type { AptNotifyKind } from "./appointment-notify";
import { catalogEntryToDraft, findCatalogTemplate, type BusinessCategory } from "./notify-catalog";
import type { BookingSnapshot, TenantSnapshot } from "./notify-context";
import {
  __setDispatcherDepsForTests,
  dispatchDue,
  dispatchEventNow,
  invalidatePlatformSettingsCache,
} from "./notify-dispatcher";
import { __setEngineDepsForTests, emitBookingEvent, reminderEventKey } from "./notify-engine";
import { __setNotifyRepoForTests } from "./notify-repo";
import { createInMemoryNotifyRepo, type InMemoryNotifyRepo } from "./notify-repo.memory";
import { parseWallClock, wallClockToUtcMs } from "./notify-time";
import { invalidateMappingCache } from "./wa-template-notify";
import { __setTemplateRepoForTests } from "./wa-template-repo";
import { createInMemoryTemplateRepo, type InMemoryTemplateRepo } from "./wa-template-repo.memory";

const WABA_ID = "waba-test-222";
const PHONE_ID = "phone-test-111";
const RECIPIENT = "919876543210";
const IST = "Asia/Kolkata";
const BASE_NOW = Date.parse("2026-10-27T06:30:00.000Z"); // 12:00 IST

let nowMs = BASE_NOW;
let notifyRepo: InMemoryNotifyRepo;
let templateRepo: InMemoryTemplateRepo;
let tenants: Map<string, TenantSnapshot>;
let bookings: Map<string, BookingSnapshot>;
let fetchMock: ReturnType<typeof vi.fn>;
let wamidNo = 0;
let eventNo = 0;

function tenant(category: BusinessCategory, tenantId = `tenant-${category}`): TenantSnapshot {
  return {
    tenantId,
    businessName: {
      clinic: "City Care Clinic",
      salon: "Glow Studio",
      gym: "FitZone Gym",
      coaching: "Bright Minds Academy",
      restaurant: "Spice Garden",
      professional: "Sharma & Associates",
    }[category],
    clinicianName: category === "clinic" ? "Dr. Mehta" : null,
    profession: null,
    category,
    timezone: IST,
  };
}

function booking(
  appointmentId: string,
  tenantId: string,
  overrides: Partial<BookingSnapshot> = {},
): BookingSnapshot {
  return {
    appointmentId,
    tenantId,
    status: "Pending",
    name: "Rahul",
    phone: "9876543210",
    whatsapp: null,
    email: "rahul@example.test",
    wallClock: "2026-10-28 10:30:00",
    timeSlot: "10:30 AM",
    tokenNo: 12,
    doctorName: "Dr. Mehta",
    appointmentType: "Initial Consultation",
    consultationMode: "in_person",
    partySize: 4,
    tableName: "T4",
    remDayBefore: false,
    rem2h: false,
    ...overrides,
  };
}

async function approveRoute(
  category: BusinessCategory,
  kind: AptNotifyKind,
  templateName?: string,
) {
  const entry = templateName
    ? findCatalogTemplate(
        templateName,
        templateName.startsWith("appointment_") &&
          ["appointment_completed", "appointment_reminder_day_before"].includes(templateName)
          ? "en"
          : "en_US",
      )
    : null;
  const catalogEntry =
    entry ??
    (() => {
      throw new Error(`No catalog entry supplied for ${category}/${kind}`);
    })();
  let row = await templateRepo.getByNameLanguage(catalogEntry.name, catalogEntry.language);
  if (!row) {
    const draft = catalogEntryToDraft(catalogEntry);
    row = await templateRepo.createDraft({
      ...draft,
      notifyKind: kind,
      source: "META",
      actorId: "test",
    });
  }
  await templateRepo.applyMetaState(row.id, {
    metaTemplateId: `meta-${catalogEntry.name}`,
    metaStatus: "APPROVED",
    metaCategory: "UTILITY",
    messagingAccountId: WABA_ID,
    localState: "SUBMITTED",
    lastSyncedAt: new Date(nowMs),
  });
  await templateRepo.upsertMapping({
    notifyKind: kind,
    businessCategory: category,
    templateId: row.id,
    language: catalogEntry.language,
    actorId: "test",
  });
  await templateRepo.setMappingEnabled(kind, true, { version: "v1", actorId: "test" }, category);
  invalidateMappingCache();
  return row.id;
}

async function insertEvent(input: {
  tenantId: string;
  category: BusinessCategory;
  appointmentId: string;
  kind: AptNotifyKind;
  appointmentAtLocal?: string | null;
  recipient?: string;
}) {
  const res = await notifyRepo.insertEvent({
    eventKey: `test:${input.kind}:${input.appointmentId}:${++eventNo}`,
    tenantId: input.tenantId,
    businessCategory: input.category,
    eventType: input.kind.startsWith("reminder") ? "booking.reminder_due" : "booking.created",
    notifyKind: input.kind,
    appointmentId: input.appointmentId,
    recipient: input.recipient ?? RECIPIENT,
    source: "test",
    scheduledForMs: nowMs,
    expiresAtMs: null,
    appointmentAtLocal: input.appointmentAtLocal ?? null,
    maxAttempts: 5,
    createdAtMs: nowMs,
  });
  return res.id;
}

function graphBodies(): Array<Record<string, any>> {
  return fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
}

function graphBodyParams(body: Record<string, any>): string[] {
  const component = body.template.components?.find((c: any) => c.type === "body");
  return component?.parameters?.map((p: any) => p.text) ?? [];
}

function okResponse(id = `wamid.TEST.${++wamidNo}`) {
  return new Response(JSON.stringify({ messages: [{ id }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function metaErrorResponse(code: number, status = 400) {
  return new Response(
    JSON.stringify({
      error: { code, message: `Meta test error ${code}`, is_transient: code === 131000 },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  nowMs = BASE_NOW;
  wamidNo = 0;
  eventNo = 0;
  notifyRepo = createInMemoryNotifyRepo();
  templateRepo = createInMemoryTemplateRepo();
  tenants = new Map();
  bookings = new Map();

  executeMock.mockReset();
  queryMock.mockReset();
  queryOneMock.mockReset();
  executeMock.mockResolvedValue({ affectedRows: 1, insertId: null });
  queryMock.mockResolvedValue([]);
  queryOneMock.mockResolvedValue(null);

  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("WA_CLOUD_PHONE_NUMBER_ID", PHONE_ID);
  vi.stubEnv("WA_CLOUD_ACCESS_TOKEN", "test-token-not-secret");
  vi.stubEnv("WA_CLOUD_WABA_ID", WABA_ID);
  vi.stubEnv("WA_CLOUD_API_VERSION", "v21.0");
  vi.stubEnv("WA_CLOUD_TEST_RECIPIENTS", "");

  __setNotifyRepoForTests(notifyRepo);
  __setTemplateRepoForTests(templateRepo);
  __setEngineDepsForTests({
    repo: notifyRepo,
    now: () => nowMs,
    loadTenant: async (tenantId) => tenants.get(tenantId) ?? null,
    loadBooking: async (_tenantId, appointmentId) => bookings.get(appointmentId) ?? null,
    ensureSchema: async () => true,
    kick: () => {},
  });
  __setDispatcherDepsForTests({
    repo: notifyRepo,
    now: () => nowMs,
    workerId: "test-worker",
    allowList: null,
    loadTenant: async (tenantId) => tenants.get(tenantId) ?? null,
    loadBooking: async (_tenantId, appointmentId) => bookings.get(appointmentId) ?? null,
    isCloudAvailable: async () => true,
    random: () => 0.5,
    acquireSendSlot: async () => {},
    markLegacyReminder: async () => {},
    raiseAlert: async (input) => {
      await notifyRepo.upsertAlert({ ...input, nowMs });
    },
  });
  invalidateMappingCache();
  invalidatePlatformSettingsCache();
});

afterEach(() => {
  __setDispatcherDepsForTests(null);
  __setEngineDepsForTests(null);
  __setNotifyRepoForTests(null);
  __setTemplateRepoForTests(null);
  invalidateMappingCache();
  invalidatePlatformSettingsCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("template-only first-contact delivery", () => {
  it("uses the same approved template payload with no customer-service-window dependency", async () => {
    const t = tenant("clinic");
    tenants.set(t.tenantId, t);
    await approveRoute("clinic", "booked", "appointment_booked");

    for (const label of ["first-contact", "window-closed", "window-open"]) {
      const b = booking(`appt-${label}`, t.tenantId);
      bookings.set(b.appointmentId, b);
      const id = await insertEvent({
        tenantId: t.tenantId,
        category: "clinic",
        appointmentId: b.appointmentId,
        kind: "booked",
      });
      expect(await dispatchEventNow(id)).toMatchObject({ status: "submitted" });
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const body of graphBodies()) {
      expect(body).toMatchObject({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: RECIPIENT,
        type: "template",
        template: {
          name: "appointment_booked",
          language: { code: "en_US" },
        },
      });
      expect(body).not.toHaveProperty("text");
    }
    const sql = queryOneMock.mock.calls.map((call) => String(call[0]));
    expect(sql.every((statement) => statement.includes("WaCloudConfig"))).toBe(true);
    expect(sql.join(" ")).not.toMatch(/inbound|24.?hour|WaMessageLog/i);
  });

  it("preserves each approved template's exact language and variable order", async () => {
    const t = tenant("clinic");
    tenants.set(t.tenantId, t);
    await approveRoute("clinic", "booked", "appointment_booked");
    await approveRoute("clinic", "cancelled", "appointment_cancelled");
    await approveRoute("clinic", "completed", "appointment_completed");
    await approveRoute("clinic", "reminderDayBefore", "appointment_reminder_day_before");

    const cases: Array<{
      id: string;
      kind: AptNotifyKind;
      status: string;
      name: string;
      language: string;
      params: string[];
    }> = [
      {
        id: "appt-booked",
        kind: "booked",
        status: "Pending",
        name: "appointment_booked",
        language: "en_US",
        params: ["Rahul", "City Care Clinic", "Dr. Mehta", "28 October 2026", "10:30 AM", "12"],
      },
      {
        id: "appt-cancelled",
        kind: "cancelled",
        status: "Cancelled",
        name: "appointment_cancelled",
        language: "en_US",
        params: ["Rahul", "City Care Clinic", "28 October 2026", "10:30 AM"],
      },
      {
        id: "appt-completed",
        kind: "completed",
        status: "Completed",
        name: "appointment_completed",
        language: "en",
        params: ["Rahul", "City Care Clinic", "Dr. Mehta"],
      },
      {
        id: "appt-reminder",
        kind: "reminderDayBefore",
        status: "Confirmed",
        name: "appointment_reminder_day_before",
        language: "en",
        params: ["Rahul", "City Care Clinic", "Dr. Mehta", "28 October 2026", "10:30 AM", "12"],
      },
    ];

    for (const c of cases) {
      const b = booking(c.id, t.tenantId, { status: c.status });
      bookings.set(c.id, b);
      const eventId = await insertEvent({
        tenantId: t.tenantId,
        category: "clinic",
        appointmentId: c.id,
        kind: c.kind,
        appointmentAtLocal: c.kind === "reminderDayBefore" ? b.wallClock : null,
      });
      expect(await dispatchEventNow(eventId)).toMatchObject({ status: "submitted" });
    }

    const bodies = graphBodies();
    expect(bodies).toHaveLength(cases.length);
    cases.forEach((c, index) => {
      expect(bodies[index].template.name).toBe(c.name);
      expect(bodies[index].template.language.code).toBe(c.language);
      expect(graphBodyParams(bodies[index])).toEqual(c.params);
    });
  });
});

describe("engine scheduling and idempotency", () => {
  it("schedules the day-before reminder in the tenant timezone and quiet-hours window", async () => {
    nowMs = Date.parse("2026-10-26T00:00:00.000Z");
    const t = tenant("clinic");
    const b = booking("appt-early", t.tenantId, {
      wallClock: "2026-10-28 06:00:00",
      timeSlot: "6:00 AM",
    });
    tenants.set(t.tenantId, t);
    bookings.set(b.appointmentId, b);

    const result = await emitBookingEvent({
      tenantId: t.tenantId,
      appointmentId: b.appointmentId,
      type: "booking.created",
      source: "test",
    });
    expect(result.ok).toBe(true);

    const reminder = await notifyRepo.getEventByKey(
      reminderEventKey("reminderDayBefore", b.appointmentId, b.wallClock),
    );
    const expectedWallClock = parseWallClock("2026-10-27 08:00:00");
    expect(expectedWallClock).not.toBeNull();
    expect(reminder).toMatchObject({
      notifyKind: "reminderDayBefore",
      status: "pending",
      appointmentAtLocal: b.wallClock,
      scheduledForMs: wallClockToUtcMs(expectedWallClock!, IST),
    });
  });

  it("supersedes stale reschedule/reminder jobs and cancels current jobs on cancellation", async () => {
    nowMs = Date.parse("2026-10-27T00:00:00.000Z");
    const t = tenant("clinic");
    const b = booking("appt-moving", t.tenantId, { wallClock: "2026-11-01 10:30:00" });
    tenants.set(t.tenantId, t);
    bookings.set(b.appointmentId, b);

    await emitBookingEvent({
      tenantId: t.tenantId,
      appointmentId: b.appointmentId,
      type: "booking.created",
      source: "test",
    });
    const firstReminderKey = reminderEventKey("reminderDayBefore", b.appointmentId, b.wallClock);

    b.wallClock = "2026-11-02 10:30:00";
    await emitBookingEvent({
      tenantId: t.tenantId,
      appointmentId: b.appointmentId,
      type: "booking.rescheduled",
      source: "test",
    });
    const firstRescheduleKey = `booking.rescheduled:${b.appointmentId}:${b.wallClock}`;

    b.wallClock = "2026-11-03 10:30:00";
    await emitBookingEvent({
      tenantId: t.tenantId,
      appointmentId: b.appointmentId,
      type: "booking.rescheduled",
      source: "test",
    });
    const currentReminderKey = reminderEventKey("reminderDayBefore", b.appointmentId, b.wallClock);

    expect(await notifyRepo.getEventByKey(firstReminderKey)).toMatchObject({
      status: "superseded",
    });
    expect(await notifyRepo.getEventByKey(firstRescheduleKey)).toMatchObject({
      status: "superseded",
    });
    expect(await notifyRepo.getEventByKey(currentReminderKey)).toMatchObject({ status: "pending" });

    b.status = "Cancelled";
    await emitBookingEvent({
      tenantId: t.tenantId,
      appointmentId: b.appointmentId,
      type: "booking.cancelled",
      source: "test",
    });

    expect(await notifyRepo.getEventByKey(currentReminderKey)).toMatchObject({
      status: "cancelled",
      statusReason: "booking_cancelled",
    });
    const rows = await notifyRepo.listEventsForAppointment(t.tenantId, b.appointmentId);
    expect(
      rows.filter((row) => row.notifyKind === "cancelled" && row.status === "pending"),
    ).toHaveLength(1);
  });

  it("deduplicates one business event into one Cloud send", async () => {
    const t = tenant("clinic");
    const b = booking("appt-duplicate", t.tenantId);
    tenants.set(t.tenantId, t);
    bookings.set(b.appointmentId, b);
    await approveRoute("clinic", "booked", "appointment_booked");

    const input = {
      tenantId: t.tenantId,
      appointmentId: b.appointmentId,
      type: "booking.created" as const,
      source: "test",
      skipReminders: true,
    };
    const first = await emitBookingEvent(input);
    const second = await emitBookingEvent(input);
    expect(first).toMatchObject({ ok: true, inserted: true });
    expect(second).toMatchObject({
      ok: true,
      inserted: false,
      eventId: first.ok ? first.eventId : null,
    });

    expect(await dispatchDue()).toBe(1);
    expect(await dispatchDue()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("dispatch policy and failure handling", () => {
  it("blocks a clinic-only completion template for a salon", async () => {
    const t = tenant("salon");
    const b = booking("appt-salon-wrong", t.tenantId, { status: "Completed" });
    tenants.set(t.tenantId, t);
    bookings.set(b.appointmentId, b);

    const entry = findCatalogTemplate("appointment_completed", "en")!;
    const draft = catalogEntryToDraft(entry);
    const row = await templateRepo.createDraft({
      ...draft,
      notifyKind: "completed",
      source: "META",
    });
    await templateRepo.applyMetaState(row.id, {
      metaTemplateId: "meta-clinic-completed",
      metaStatus: "APPROVED",
      metaCategory: "UTILITY",
      messagingAccountId: WABA_ID,
    });
    await templateRepo.upsertMapping({
      notifyKind: "completed",
      businessCategory: "*",
      templateId: row.id,
      language: "en",
      actorId: "test",
    });
    await templateRepo.setMappingEnabled(
      "completed",
      true,
      { version: "v1", actorId: "test" },
      "*",
    );
    invalidateMappingCache();

    const id = await insertEvent({
      tenantId: t.tenantId,
      category: "salon",
      appointmentId: b.appointmentId,
      kind: "completed",
    });
    expect(await dispatchEventNow(id)).toMatchObject({
      status: "blocked",
      reason: "template_not_ready:category_mismatch",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP 503", () => new Response("{}", { status: 503 })],
    ["Meta 131000", () => metaErrorResponse(131000)],
  ])("retries %s with backoff, then succeeds", async (_label, firstResponse) => {
    const t = tenant("clinic");
    const b = booking(`appt-retry-${String(_label)}`, t.tenantId);
    tenants.set(t.tenantId, t);
    bookings.set(b.appointmentId, b);
    await approveRoute("clinic", "booked", "appointment_booked");
    fetchMock.mockResolvedValueOnce(firstResponse()).mockImplementation(async () => okResponse());

    const id = await insertEvent({
      tenantId: t.tenantId,
      category: "clinic",
      appointmentId: b.appointmentId,
      kind: "booked",
    });
    expect(await dispatchEventNow(id)).toMatchObject({
      status: "retry",
      reason: "retry_scheduled",
    });
    const retry = await notifyRepo.getEvent(id);
    expect(retry).toMatchObject({ status: "retry", attempts: 1, errorClass: "retryable" });
    expect(retry!.nextAttemptAtMs).toBeGreaterThan(nowMs);

    nowMs = retry!.nextAttemptAtMs;
    expect(await dispatchEventNow(id)).toMatchObject({ status: "submitted" });
    expect(await notifyRepo.getEvent(id)).toMatchObject({ status: "submitted", attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks an undeliverable recipient failed and a timeout ambiguous without retrying", async () => {
    const t = tenant("clinic");
    tenants.set(t.tenantId, t);
    await approveRoute("clinic", "booked", "appointment_booked");

    const permanent = booking("appt-permanent", t.tenantId);
    bookings.set(permanent.appointmentId, permanent);
    const permanentId = await insertEvent({
      tenantId: t.tenantId,
      category: "clinic",
      appointmentId: permanent.appointmentId,
      kind: "booked",
    });
    fetchMock.mockResolvedValueOnce(metaErrorResponse(131026));
    expect(await dispatchEventNow(permanentId)).toMatchObject({ status: "failed" });
    expect(await notifyRepo.getEvent(permanentId)).toMatchObject({
      status: "failed",
      errorClass: "permanent",
      errorCode: "131026",
    });

    const unknown = booking("appt-timeout", t.tenantId);
    bookings.set(unknown.appointmentId, unknown);
    const unknownId = await insertEvent({
      tenantId: t.tenantId,
      category: "clinic",
      appointmentId: unknown.appointmentId,
      kind: "booked",
    });
    fetchMock.mockRejectedValueOnce(new Error("The operation timed out"));
    expect(await dispatchEventNow(unknownId)).toMatchObject({ status: "ambiguous" });
    expect(await notifyRepo.getEvent(unknownId)).toMatchObject({
      status: "ambiguous",
      statusReason: "send_outcome_unknown",
      attempts: 1,
    });
    expect(await dispatchEventNow(unknownId)).toBeNull();
  });

  it("blocks a rejected mapped template before any Graph request", async () => {
    const t = tenant("clinic");
    const b = booking("appt-rejected", t.tenantId);
    tenants.set(t.tenantId, t);
    bookings.set(b.appointmentId, b);
    const templateId = await approveRoute("clinic", "booked", "appointment_booked");
    await templateRepo.applyMetaState(templateId, {
      metaStatus: "REJECTED",
      rejectionDetail: "test rejection",
    });
    invalidateMappingCache();

    const id = await insertEvent({
      tenantId: t.tenantId,
      category: "clinic",
      appointmentId: b.appointmentId,
      kind: "booked",
    });
    expect(await dispatchEventNow(id)).toMatchObject({
      status: "blocked",
      reason: "template_not_ready:template_not_approved",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honours tenant opt-out, platform STOP and the tenant master switch", async () => {
    const t = tenant("clinic");
    tenants.set(t.tenantId, t);
    await approveRoute("clinic", "booked", "appointment_booked");

    const create = async (id: string) => {
      const b = booking(id, t.tenantId);
      bookings.set(id, b);
      return insertEvent({
        tenantId: t.tenantId,
        category: "clinic",
        appointmentId: id,
        kind: "booked",
      });
    };

    await notifyRepo.upsertConsent({
      tenantId: t.tenantId,
      phone: RECIPIENT,
      status: "opted_out",
      source: "tenant_admin",
      noticeVersion: "v1",
      appointmentId: null,
      capturedAtMs: nowMs,
      withdrawnAtMs: nowMs,
    });
    const tenantOptOutId = await create("appt-optout");
    expect(await dispatchEventNow(tenantOptOutId)).toMatchObject({
      status: "skipped",
      reason: "consent_withdrawn",
    });

    await notifyRepo.upsertConsent({
      tenantId: t.tenantId,
      phone: RECIPIENT,
      status: "opted_in",
      source: "tenant_admin",
      noticeVersion: "v1",
      appointmentId: null,
      capturedAtMs: nowMs + 1,
      withdrawnAtMs: null,
    });
    await notifyRepo.upsertConsent({
      tenantId: "*",
      phone: RECIPIENT,
      status: "opted_out",
      source: "whatsapp_keyword",
      noticeVersion: "v1",
      appointmentId: null,
      capturedAtMs: nowMs + 2,
      withdrawnAtMs: nowMs + 2,
    });
    const stopId = await create("appt-stop");
    expect(await dispatchEventNow(stopId)).toMatchObject({
      status: "skipped",
      reason: "consent_withdrawn",
    });

    await notifyRepo.upsertConsent({
      tenantId: "*",
      phone: RECIPIENT,
      status: "opted_in",
      source: "whatsapp_keyword",
      noticeVersion: "v1",
      appointmentId: null,
      capturedAtMs: nowMs + 3,
      withdrawnAtMs: null,
    });
    await notifyRepo.saveTenantSettings(t.tenantId, { whatsappEnabled: false }, "owner");
    const disabledId = await create("appt-disabled");
    expect(await dispatchEventNow(disabledId)).toMatchObject({
      status: "skipped",
      reason: "tenant_whatsapp_disabled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a test worker only claims allow-listed recipients", async () => {
    const t = tenant("clinic");
    tenants.set(t.tenantId, t);
    await approveRoute("clinic", "booked", "appointment_booked");
    const allowed = booking("appt-allowed", t.tenantId);
    const other = booking("appt-other", t.tenantId, { phone: "9123456789" });
    bookings.set(allowed.appointmentId, allowed);
    bookings.set(other.appointmentId, other);
    await insertEvent({
      tenantId: t.tenantId,
      category: "clinic",
      appointmentId: allowed.appointmentId,
      kind: "booked",
      recipient: RECIPIENT,
    });
    const otherId = await insertEvent({
      tenantId: t.tenantId,
      category: "clinic",
      appointmentId: other.appointmentId,
      kind: "booked",
      recipient: "919123456789",
    });

    __setDispatcherDepsForTests({
      repo: notifyRepo,
      now: () => nowMs,
      workerId: "test-allow-worker",
      allowList: [RECIPIENT],
      loadTenant: async (tenantId) => tenants.get(tenantId) ?? null,
      loadBooking: async (_tenantId, appointmentId) => bookings.get(appointmentId) ?? null,
      isCloudAvailable: async () => true,
      random: () => 0.5,
      acquireSendSlot: async () => {},
      markLegacyReminder: async () => {},
      raiseAlert: async () => {},
    });

    expect(await dispatchDue()).toBe(1);
    expect(await notifyRepo.getEvent(otherId)).toMatchObject({ status: "pending", attempts: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers an expired pre-send lease and marks a mid-send crash ambiguous", async () => {
    const t = tenant("clinic");
    const beforeSend = booking("appt-stale-before", t.tenantId);
    const midSend = booking("appt-stale-mid", t.tenantId);
    tenants.set(t.tenantId, t);
    bookings.set(beforeSend.appointmentId, beforeSend);
    bookings.set(midSend.appointmentId, midSend);
    const beforeId = await insertEvent({
      tenantId: t.tenantId,
      category: "clinic",
      appointmentId: beforeSend.appointmentId,
      kind: "booked",
    });
    const midId = await insertEvent({
      tenantId: t.tenantId,
      category: "clinic",
      appointmentId: midSend.appointmentId,
      kind: "booked",
    });
    const beforeClaim = await notifyRepo.claimById({
      id: beforeId,
      workerId: "dead-worker",
      nowMs,
      leaseMs: 100,
    });
    const midClaim = await notifyRepo.claimById({
      id: midId,
      workerId: "dead-worker",
      nowMs,
      leaseMs: 100,
    });
    await notifyRepo.markSendStarted(midId, midClaim!.claimToken!, nowMs + 10);

    expect(await notifyRepo.recoverStale(nowMs + 101)).toEqual({ requeued: 1, ambiguous: 1 });
    expect(beforeClaim).not.toBeNull();
    expect(await notifyRepo.getEvent(beforeId)).toMatchObject({
      status: "retry",
      statusReason: "lease_expired_requeued",
    });
    expect(await notifyRepo.getEvent(midId)).toMatchObject({
      status: "ambiguous",
      statusReason: "worker_stopped_mid_send",
    });
  });
});

describe("multi-industry lifecycle routing", () => {
  it("routes booking creation to the approved category-specific template for every industry", async () => {
    const cases: Array<[BusinessCategory, string, AptNotifyKind]> = [
      ["clinic", "appointment_booked", "booked"],
      ["salon", "salon_booking_confirmed", "booked"],
      ["gym", "gym_session_confirmed", "booked"],
      ["coaching", "coaching_session_confirmed", "booked"],
      ["restaurant", "restaurant_reservation_confirmed", "restaurantBooked"],
    ];

    for (const [category, templateName, kind] of cases) {
      const t = tenant(category);
      const b = booking(`appt-${category}`, t.tenantId, {
        wallClock: category === "coaching" ? "2026-10-28 00:00:00" : "2026-10-28 10:30:00",
        timeSlot: category === "coaching" ? null : "10:30 AM",
        doctorName: category === "clinic" ? "Dr. Mehta" : null,
      });
      tenants.set(t.tenantId, t);
      bookings.set(b.appointmentId, b);
      await approveRoute(category, kind, templateName);
      await insertEvent({
        tenantId: t.tenantId,
        category,
        appointmentId: b.appointmentId,
        kind,
      });
    }

    expect(await dispatchDue()).toBe(cases.length);
    const names = graphBodies()
      .map((body) => body.template.name)
      .sort();
    expect(names).toEqual(cases.map(([, name]) => name).sort());
    expect(graphBodies().every((body) => body.type === "template")).toBe(true);
  });
});
