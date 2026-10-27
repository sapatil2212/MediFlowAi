// @vitest-environment node
//
// Regression coverage for the public booking → awaited WhatsApp notification
// path. All database and messaging boundaries are mocked; no live patient
// message or Meta Graph request is made.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, queryOneMock, renumberDailyTokensMock, sendAppointmentNotificationMock } =
  vi.hoisted(() => ({
    executeMock: vi.fn(),
    queryOneMock: vi.fn(),
    renumberDailyTokensMock: vi.fn(),
    sendAppointmentNotificationMock: vi.fn(),
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

vi.mock("./db", () => ({
  execute: executeMock,
  query: vi.fn(async () => []),
  queryOne: queryOneMock,
}));

vi.mock("./token.server", () => ({
  renumberDailyTokens: renumberDailyTokensMock,
}));

vi.mock("./video-consultation", () => ({
  normalizeConsultationMode: () => ({ ok: true, mode: "in_person" }),
}));

vi.mock("./appointment-notify", () => ({
  resolveClinicName: vi.fn(async () => "Example Clinic"),
  resolveDoctorName: vi.fn(async () => "Dr. Example"),
  sendAppointmentNotification: sendAppointmentNotificationMock,
}));

import { createAppointmentPublicServerFn } from "./booking";

beforeEach(() => {
  executeMock.mockReset();
  queryOneMock.mockReset();
  renumberDailyTokensMock.mockReset();
  sendAppointmentNotificationMock.mockReset();

  executeMock.mockResolvedValue({ affectedRows: 1, insertId: null });
  renumberDailyTokensMock.mockResolvedValue(undefined);
  queryOneMock.mockImplementation(async (sql: string) => {
    if (sql.includes("MAX(tokenNo)")) return { maxToken: 6 };
    if (sql.includes("SELECT tokenNo FROM Appointment")) return { tokenNo: 7 };
    return null;
  });
});

describe("createAppointmentPublicServerFn WhatsApp Cloud notification", () => {
  it("creates the appointment and awaits booked notification with final token context", async () => {
    let finishSend: ((value: boolean) => void) | undefined;
    sendAppointmentNotificationMock.mockImplementation(
      () => new Promise<boolean>((resolve) => (finishSend = resolve)),
    );

    let settled = false;
    const bookingPromise = createAppointmentPublicServerFn({
      data: {
        tenantId: "clinic-example",
        name: "Example Patient",
        phone: "9876543210",
        dateTime: "2027-01-12T10:30:00.000Z",
        reason: "Consultation",
        doctorId: "doctor-example",
        timeSlot: "10:30 AM",
      },
    }).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(sendAppointmentNotificationMock).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    expect(
      executeMock.mock.calls.some((call) => String(call[0]).includes("INSERT INTO Appointment")),
    ).toBe(true);

    const [tenantId, phone, kind, ctx] = sendAppointmentNotificationMock.mock.calls[0];
    expect(tenantId).toBe("clinic-example");
    expect(phone).toBe("9876543210");
    expect(kind).toBe("booked");
    expect(ctx).toMatchObject({
      name: "Example Patient",
      clinicName: "Example Clinic",
      doctorName: "Dr. Example",
      tokenNo: 7,
      appointmentId: expect.any(String),
    });

    finishSend?.(true);
    await expect(bookingPromise).resolves.toMatchObject({ success: true, tokenNo: 7 });
  });

  it("keeps the created appointment successful when messaging throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendAppointmentNotificationMock.mockRejectedValue(new Error("mock messaging failure"));

    const result = await createAppointmentPublicServerFn({
      data: {
        tenantId: "clinic-example",
        name: "Example Patient",
        phone: "9876543210",
        dateTime: "2027-01-12T10:30:00.000Z",
        reason: "Consultation",
      },
    });

    expect(result).toMatchObject({ success: true, tokenNo: 7 });
    expect(sendAppointmentNotificationMock).toHaveBeenCalledTimes(1);
  });
});
