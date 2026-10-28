// @vitest-environment node
//
// Public booking → transactional notification outbox. The appointment INSERT
// and its booking.created event are written on the SAME transaction
// connection; dispatch is released only after the daily queue renumber, so the
// confirmation carries the final queue number. All database and messaging
// boundaries are mocked; no live patient message or Meta request is made.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connQueryMock,
  queryOneMock,
  renumberDailyTokensMock,
  emitBookingEventMock,
  dispatchSoonMock,
  order,
} = vi.hoisted(() => ({
  connQueryMock: vi.fn(),
  queryOneMock: vi.fn(),
  renumberDailyTokensMock: vi.fn(),
  emitBookingEventMock: vi.fn(),
  dispatchSoonMock: vi.fn(),
  order: [] as string[],
}));

type ServerFnValidator = (data: unknown) => unknown | Promise<unknown>;
type ServerFnHandler = (payload: {
  data: unknown;
  context: Record<string, never>;
}) => unknown | Promise<unknown>;
interface ServerFnDouble {
  validator(next: ServerFnValidator): ServerFnDouble;
  inputValidator(next: ServerFnValidator): ServerFnDouble;
  middleware(): ServerFnDouble;
  handler(handler: ServerFnHandler): (payload?: { data?: unknown }) => Promise<unknown>;
}

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const createServerFn = (_options?: unknown) => {
    let validator: ServerFnValidator | undefined;
    const api: ServerFnDouble = {
      validator: (next) => {
        validator = next;
        return api;
      },
      inputValidator: (next) => {
        validator = next;
        return api;
      },
      middleware: () => api,
      handler: (handler) => async (payload) => {
        const data = validator ? await validator(payload?.data) : payload?.data;
        return handler({ data, context: {} });
      },
    };
    return api;
  };
  return { ...actual, createServerFn };
});

const conn = { query: connQueryMock };
vi.mock("./db", () => ({
  execute: vi.fn(async () => ({ affectedRows: 1, insertId: null })),
  query: vi.fn(async () => []),
  queryOne: queryOneMock,
  withTransaction: vi.fn(async (fn: (c: unknown) => Promise<unknown>) => {
    order.push("tx:begin");
    const result = await fn(conn);
    order.push("tx:commit");
    return result;
  }),
}));

vi.mock("./token.server", () => ({
  renumberDailyTokens: renumberDailyTokensMock,
}));

vi.mock("./video-consultation", () => ({
  normalizeConsultationMode: () => ({ ok: true, mode: "in_person" }),
}));

vi.mock("./notify-engine", () => ({
  emitBookingEvent: emitBookingEventMock,
  dispatchSoon: dispatchSoonMock,
  POST_COMMIT_HOLD_MS: 30_000,
}));

import { createAppointmentPublicServerFn } from "./booking";

const BASE = {
  tenantId: "clinic-example",
  name: "Example Patient",
  phone: "9876543210",
  dateTime: "2027-01-12T10:30:00.000Z",
  reason: "Consultation",
  doctorId: "doctor-example",
  timeSlot: "10:30 AM",
};

beforeEach(() => {
  order.length = 0;
  connQueryMock.mockReset();
  queryOneMock.mockReset();
  renumberDailyTokensMock.mockReset();
  emitBookingEventMock.mockReset();
  dispatchSoonMock.mockReset();

  connQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("INSERT INTO Appointment")) order.push("insert");
    return { affectedRows: 1 };
  });
  renumberDailyTokensMock.mockImplementation(async () => {
    order.push("renumber");
  });
  emitBookingEventMock.mockImplementation(async () => {
    order.push("emit");
    return { ok: true, eventId: "evt-1", inserted: true, kind: "booked" };
  });
  dispatchSoonMock.mockImplementation(() => {
    order.push("dispatch");
  });
  queryOneMock.mockImplementation(async (sql: string) => {
    if (sql.includes("MAX(tokenNo)")) return { maxToken: 6 };
    if (sql.includes("SELECT tokenNo FROM Appointment")) return { tokenNo: 7 };
    return null;
  });
});

describe("createAppointmentPublicServerFn → notification outbox", () => {
  it("writes the appointment and booking.created event in one transaction, dispatching after renumber", async () => {
    const result = await createAppointmentPublicServerFn({
      data: { ...BASE, whatsappConsent: true },
    });

    expect(result).toMatchObject({ success: true, tokenNo: 7 });
    expect(order).toEqual(["tx:begin", "insert", "emit", "tx:commit", "renumber", "dispatch"]);

    const [input] = emitBookingEventMock.mock.calls[0];
    expect(input).toMatchObject({
      tenantId: "clinic-example",
      type: "booking.created",
      source: "public_booking",
      consent: { optedIn: true, source: "public_booking_form" },
      conn,
    });
    expect(input.delayMs).toBeGreaterThan(0);
    expect(input.appointmentId).toBe((result as any).appointmentId);
    expect(dispatchSoonMock).toHaveBeenCalledWith("evt-1");
  });

  it("records an explicit opt-out from the booking form", async () => {
    await createAppointmentPublicServerFn({ data: { ...BASE, whatsappConsent: false } });
    expect(emitBookingEventMock.mock.calls[0][0].consent).toEqual({
      optedIn: false,
      source: "public_booking_form",
    });
  });

  it("does not invent consent when an older client sends no choice", async () => {
    await createAppointmentPublicServerFn({ data: { ...BASE } });
    expect(emitBookingEventMock.mock.calls[0][0].consent).toBeNull();
  });

  it("rejects a non-boolean consent value", async () => {
    await expect(
      createAppointmentPublicServerFn({ data: { ...BASE, whatsappConsent: "yes" as any } }),
    ).rejects.toThrow(/consent/);
  });

  it("keeps the booking when the notification event cannot be recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    emitBookingEventMock.mockResolvedValue({ ok: false, error: "schema unavailable" });

    const result = await createAppointmentPublicServerFn({ data: { ...BASE } });

    expect(result).toMatchObject({ success: true, tokenNo: 7 });
    expect(order).toContain("tx:commit");
    expect(dispatchSoonMock).not.toHaveBeenCalled();
  });

  it("keeps the booking even if the notification engine throws unexpectedly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    emitBookingEventMock.mockRejectedValue(new Error("unexpected"));

    const result = await createAppointmentPublicServerFn({ data: { ...BASE } });

    expect(result).toMatchObject({ success: true });
    expect(order).toContain("tx:commit");
  });
});
