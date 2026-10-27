// @vitest-environment node
//
// Regression coverage for official-only, template-only outbound notifications.
// Database and transport boundaries are mocked; no live Meta request or patient
// message is made.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
vi.mock("./db", () => ({
  execute: (...args: unknown[]) => executeMock(...args),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}));

const isCloudAvailableMock = vi.fn();
const sendTemplateMessageMock = vi.fn();
const sendTextMessageMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  isCloudAvailable: (...args: unknown[]) => isCloudAvailableMock(...args),
  sendTemplateMessage: (...args: unknown[]) => sendTemplateMessageMock(...args),
  sendTextMessage: (...args: unknown[]) => sendTextMessageMock(...args),
}));

const resolveTemplatePlanResultMock = vi.fn();
vi.mock("./wa-template-notify", () => ({
  resolveTemplatePlanResult: (...args: unknown[]) => resolveTemplatePlanResultMock(...args),
  invalidateMappingCache: vi.fn(),
}));

const enqueueWAMock = vi.fn();
vi.mock("./whatsapp", () => ({
  enqueueWA: (...args: unknown[]) => enqueueWAMock(...args),
}));

import { sendPatientMessage, type SendPatientMessageParams } from "./whatsapp-router";
import { TEMPLATE_VAR_SPEC, type AptNotifyKind } from "./appointment-notify";

const ALL_KINDS = Object.keys(TEMPLATE_VAR_SPEC) as AptNotifyKind[];
const PLAN = {
  templateId: "tpl-1",
  templateName: "appointment_booked",
  language: "en_US",
  parameterFormat: "POSITIONAL" as const,
  bodyParams: [
    { text: "Asha" },
    { text: "Sunrise Clinic" },
    { text: "Dr. Mehta" },
    { text: "Thursday, January 1, 2026" },
    { text: "10:00 AM" },
    { text: "7" },
  ],
  headerParams: [],
  urlButtons: [],
};

function params(overrides: Partial<SendPatientMessageParams> = {}): SendPatientMessageParams {
  return {
    tenantId: "tenant-example",
    notifyKind: "booked",
    recipientPhone: "9876543210",
    ctx: {
      name: "Asha",
      clinicName: "Sunrise Clinic",
      doctorName: "Dr. Mehta",
      dateTime: new Date("2026-01-01T10:00:00Z"),
      tokenNo: 7,
      appointmentId: "appointment-example",
    },
    ...overrides,
  };
}

function sqlCalls(fragment: string) {
  return executeMock.mock.calls.filter(
    (call) => typeof call[0] === "string" && call[0].includes(fragment),
  );
}

beforeEach(() => {
  executeMock.mockReset();
  isCloudAvailableMock.mockReset();
  sendTemplateMessageMock.mockReset();
  sendTextMessageMock.mockReset();
  resolveTemplatePlanResultMock.mockReset();
  enqueueWAMock.mockReset();

  executeMock.mockResolvedValue({ affectedRows: 1, insertId: null });
  isCloudAvailableMock.mockResolvedValue(true);
  resolveTemplatePlanResultMock.mockResolvedValue({
    status: "not_ready",
    reason: "mapping_missing",
  });
  sendTemplateMessageMock.mockResolvedValue({ ok: true, messageId: "wamid.TEMPLATE" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendPatientMessage — official template-only routing", () => {
  it("records an actionable expected-readiness failure without any free-form or Web send", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendPatientMessage(params());

    expect(result).toMatchObject({
      delivered: false,
      deliveryStatus: "failed",
      channel: null,
      error: expect.stringContaining("reason=mapping_missing"),
    });
    expect(sendTemplateMessageMock).not.toHaveBeenCalled();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).not.toHaveBeenCalled();
    expect(sqlCalls("INSERT INTO WaMessageLog")[0][0]).toContain("'official'");
    expect(sqlCalls("errorCode = ?")[0][1]).toEqual([
      "template_not_ready",
      expect.stringContaining("reason=mapping_missing"),
      result.logId,
    ]);
    expect(JSON.stringify(error.mock.calls)).not.toContain("9876543210");
  });

  it("does not route to Web or free-form Cloud when Cloud is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    isCloudAvailableMock.mockResolvedValue(false);
    resolveTemplatePlanResultMock.mockResolvedValue({
      status: "not_ready",
      reason: "cloud_unavailable",
    });

    const result = await sendPatientMessage(params());

    expect(result.delivered).toBe(false);
    expect(resolveTemplatePlanResultMock).toHaveBeenCalledWith(
      "booked",
      expect.objectContaining({ recipientPhone: "9876543210" }),
      { cloudAvailable: false },
    );
    expect(sendTemplateMessageMock).not.toHaveBeenCalled();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });

  it("submits appointment_booked to the normalized arbitrary recipient and records acceptance", async () => {
    resolveTemplatePlanResultMock.mockResolvedValue({ status: "ready", plan: PLAN });

    const result = await sendPatientMessage(params());

    expect(result).toMatchObject({
      delivered: true,
      deliveryStatus: "accepted",
      channel: "official",
    });
    expect(sendTemplateMessageMock).toHaveBeenCalledWith({
      to: "919876543210",
      templateName: "appointment_booked",
      language: "en_US",
      parameterFormat: "POSITIONAL",
      bodyParams: PLAN.bodyParams,
      headerParams: [],
      urlButtons: [],
    });
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).not.toHaveBeenCalled();
    expect(sqlCalls("INSERT INTO WaMessageLog")[0][1]).toEqual([
      result.logId,
      "tenant-example",
      "919876543210",
      "booked",
      "tpl-1",
    ]);
    expect(sqlCalls("metaMessageId = ?")[0][0]).toContain("body = NULL");
    expect(sqlCalls("metaMessageId = ?")[0][1]).toEqual(["wamid.TEMPLATE", result.logId]);
  });

  it("uses an approved template for every registered business notification kind", async () => {
    resolveTemplatePlanResultMock.mockResolvedValue({ status: "ready", plan: PLAN });

    for (const kind of ALL_KINDS) {
      const result = await sendPatientMessage(params({ notifyKind: kind }));
      expect(result.deliveryStatus).toBe("accepted");
    }

    expect(sendTemplateMessageMock).toHaveBeenCalledTimes(ALL_KINDS.length);
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });

  it("classifies an unexpected template-resolution exception separately and sanitizes it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    resolveTemplatePlanResultMock.mockRejectedValue(
      new Error("database unavailable for Asha using Bearer EAAsecretTokenValue12345"),
    );

    const result = await sendPatientMessage(params());

    expect(result).toMatchObject({
      delivered: false,
      deliveryStatus: "failed",
      channel: null,
      error: expect.stringContaining("internal error"),
    });
    expect(sqlCalls("errorCode = ?")[0][1]).toEqual([
      "template_gate_error",
      expect.stringContaining("internal error"),
      result.logId,
    ]);
    const output = JSON.stringify(error.mock.calls);
    expect(output).not.toContain("Asha");
    expect(output).not.toContain("EAAsecretTokenValue12345");
    expect(sendTemplateMessageMock).not.toHaveBeenCalled();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });

  it("records safe Meta fields and never falls back after a rejected official template", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveTemplatePlanResultMock.mockResolvedValue({ status: "ready", plan: PLAN });
    sendTemplateMessageMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      httpStatus: 400,
      code: "132000",
      subcode: "2494073",
      message: "Invalid Asha value for 9876543210 using Bearer EAAsecretTokenValue12345",
      fbtraceId: "trace-safe-1",
    });

    const result = await sendPatientMessage(params());

    expect(result).toMatchObject({
      delivered: false,
      deliveryStatus: "failed",
      channel: "official",
    });
    const output = JSON.stringify(warn.mock.calls);
    expect(output).toContain("http_status=400");
    expect(output).toContain("code=132000");
    expect(output).toContain("subcode=2494073");
    expect(output).toContain("trace-safe-1");
    expect(output).not.toContain("Asha");
    expect(output).not.toContain("9876543210");
    expect(output).not.toContain("EAAsecretTokenValue12345");
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).not.toHaveBeenCalled();
    expect(sqlCalls("officialStatus = 'failed'")).toHaveLength(1);
  });

  it("returns a sanitized internal failure when persistence fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    resolveTemplatePlanResultMock.mockResolvedValue({ status: "ready", plan: PLAN });
    executeMock.mockRejectedValue(new Error("database row for Asha failed"));

    const result = await sendPatientMessage(params());

    expect(result).toMatchObject({
      delivered: false,
      deliveryStatus: "failed",
      channel: null,
      error: expect.stringContaining("internal error"),
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("Asha");
    expect(sendTemplateMessageMock).not.toHaveBeenCalled();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    expect(enqueueWAMock).not.toHaveBeenCalled();
  });
});
