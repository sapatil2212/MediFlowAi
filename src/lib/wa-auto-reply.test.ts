// @vitest-environment node
//
// Tests for wa-auto-reply.ts: reply wording, business-contact priority, tenant
// resolution, the type allowlist, and dispatch (cloud gate, 6h cooldown,
// logging, failure handling, in-flight guard). The DB and the Cloud API client
// are mocked: no live Meta API call is made.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryOneMock = vi.fn();
const executeMock = vi.fn();
vi.mock("./db", () => ({
  query: vi.fn(async () => []),
  queryOne: (...args: any[]) => queryOneMock(...args),
  execute: (...args: any[]) => executeMock(...args),
}));

const isCloudAvailableMock = vi.fn();
const sendTextMessageMock = vi.fn();
vi.mock("./whatsapp-cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp-cloud")>()),
  isCloudAvailable: (...args: any[]) => isCloudAvailableMock(...args),
  sendTextMessage: (...args: any[]) => sendTextMessageMock(...args),
}));

import {
  buildAutoReplyText,
  dispatchAutoReply,
  getBusinessContact,
  resolveInboundTenant,
  shouldAutoReply,
} from "./wa-auto-reply";

const GENERIC =
  "This is an automated BookMyTime notification number and cannot receive replies. Please contact the business you booked with directly.";

/** Routes queryOne by SQL substring. */
function routeQueries(routes: {
  cooldown?: any;
  profile?: any;
  user?: any;
  context?: any;
  latestOfficial?: any;
  latestAny?: any;
}) {
  queryOneMock.mockImplementation(async (sql: string) => {
    if (sql.includes("kind = 'autoReply'")) return routes.cooldown ?? null;
    if (sql.includes("FROM ClinicProfile")) return routes.profile ?? null;
    if (sql.includes("FROM User")) return routes.user ?? null;
    if (sql.includes("AND metaMessageId = ?")) return routes.context ?? null;
    if (sql.includes("ORDER BY createdAt DESC") && sql.includes("channel = 'official'")) {
      return routes.latestOfficial ?? null;
    }
    if (sql.includes("ORDER BY createdAt DESC")) return routes.latestAny ?? null;
    return null;
  });
}

beforeEach(() => {
  queryOneMock.mockReset();
  executeMock.mockReset();
  isCloudAvailableMock.mockReset();
  sendTextMessageMock.mockReset();
  queryOneMock.mockResolvedValue(null);
  executeMock.mockResolvedValue({ affectedRows: 1, insertId: null });
  isCloudAvailableMock.mockResolvedValue(true);
  sendTextMessageMock.mockResolvedValue({ ok: true, messageId: "wamid.AR" });
  vi.stubEnv("WA_CLOUD_TEST_RECIPIENTS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildAutoReplyText", () => {
  it("always returns the generic notification-only reply, regardless of contact", () => {
    expect(buildAutoReplyText()).toBe(GENERIC);
    expect(buildAutoReplyText(null)).toBe(GENERIC);
    expect(buildAutoReplyText({ name: "Sunrise Clinic", phone: "9876500000" })).toBe(GENERIC);
    expect(buildAutoReplyText({ name: "Sunrise Clinic", phone: null })).toBe(GENERIC);
    expect(buildAutoReplyText({ name: null, phone: "9876500000" })).toBe(GENERIC);
  });
});

describe("getBusinessContact", () => {
  it("prefers whatsappNo > contactNo > ClinicProfile.phone > User.phone", async () => {
    routeQueries({
      profile: { clinicName: "Sunrise", whatsappNo: "111", contactNo: "222", phone: "333" },
      user: { clinicName: "Reg", phone: "444" },
    });
    expect(await getBusinessContact("t1")).toEqual({ name: "Sunrise", phone: "111" });

    routeQueries({
      profile: { clinicName: "Sunrise", whatsappNo: " ", contactNo: "222", phone: "333" },
    });
    expect(await getBusinessContact("t1")).toEqual({ name: "Sunrise", phone: "222" });

    routeQueries({
      profile: { clinicName: "Sunrise", whatsappNo: null, contactNo: "", phone: "333" },
    });
    expect(await getBusinessContact("t1")).toEqual({ name: "Sunrise", phone: "333" });

    routeQueries({
      profile: { clinicName: "", whatsappNo: null, contactNo: null, phone: "" },
      user: { clinicName: "Reg Name", phone: "444" },
    });
    expect(await getBusinessContact("t1")).toEqual({ name: "Reg Name", phone: "444" });
  });

  it("falls back to the User row when no ClinicProfile exists", async () => {
    routeQueries({ user: { clinicName: "Bistro 9", phone: "9000000000" } });
    expect(await getBusinessContact("t2")).toEqual({ name: "Bistro 9", phone: "9000000000" });
  });

  it("returns nulls when nothing is found or the DB throws", async () => {
    routeQueries({});
    expect(await getBusinessContact("t1")).toEqual({ name: null, phone: null });

    vi.spyOn(console, "error").mockImplementation(() => {});
    queryOneMock.mockRejectedValue(new Error("db down"));
    expect(await getBusinessContact("t1")).toEqual({ name: null, phone: null });
  });
});

describe("resolveInboundTenant", () => {
  it("first queries the newest row that left the shared number, for both phone forms", async () => {
    routeQueries({ latestOfficial: { tenantId: "t1" }, latestAny: { tenantId: "tWeb" } });
    expect(await resolveInboundTenant("918830553868")).toBe("t1");
    expect(queryOneMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryOneMock.mock.calls[0];
    expect(sql).toContain("direction = 'out'");
    expect(sql).toContain("tenantId <> 'global'");
    // Rows sent from a tenant's own Web number or never delivered don't count.
    expect(sql).toContain("channel = 'official'");
    expect(sql).toContain("metaMessageId IS NOT NULL");
    expect(sql).toContain("(officialStatus IS NULL OR officialStatus <> 'failed')");
    expect(sql).toContain("ORDER BY createdAt DESC");
    expect(sql).toContain("LIMIT 1");
    expect(params).toEqual(["918830553868", "8830553868"]);
  });

  it("uses the newest outbound row of any channel only when none left the shared number", async () => {
    routeQueries({ latestAny: { tenantId: "tWeb" } });
    expect(await resolveInboundTenant("918830553868")).toBe("tWeb");
    expect(queryOneMock).toHaveBeenCalledTimes(2);
    const [sql, params] = queryOneMock.mock.calls[1];
    expect(sql).not.toContain("channel = 'official'");
    expect(sql).toContain("tenantId <> 'global'");
    expect(sql).toContain("ORDER BY createdAt DESC");
    expect(params).toEqual(["918830553868", "8830553868"]);
  });

  it("resolves the quoted wamid (context.id) first, scoped to this sender", async () => {
    routeQueries({ context: { tenantId: "tQuoted" }, latestOfficial: { tenantId: "tNewer" } });
    expect(await resolveInboundTenant("918830553868", "wamid.Q")).toBe("tQuoted");
    expect(queryOneMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryOneMock.mock.calls[0];
    expect(sql).toContain("direction = 'out' AND metaMessageId = ?");
    expect(sql).toContain("recipient IN (?, ?)");
    expect(sql).toContain("tenantId <> 'global'");
    expect(params).toEqual(["wamid.Q", "918830553868", "8830553868"]);
  });

  it("falls through to the shared-number tier when the quoted wamid is unknown", async () => {
    routeQueries({ latestOfficial: { tenantId: "tNewer" } });
    expect(await resolveInboundTenant("918830553868", "wamid.UNKNOWN")).toBe("tNewer");
    expect(queryOneMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when no row exists or on a DB error", async () => {
    routeQueries({});
    expect(await resolveInboundTenant("918830553868")).toBeNull();
    vi.spyOn(console, "error").mockImplementation(() => {});
    queryOneMock.mockRejectedValue(new Error("db down"));
    expect(await resolveInboundTenant("918830553868")).toBeNull();
  });
});

describe("shouldAutoReply", () => {
  const base = { from: "918830553868", displayPhone: "+91 70000 00000" };

  it("allows the user message types", () => {
    for (const msgType of [
      "text",
      "image",
      "audio",
      "video",
      "document",
      "sticker",
      "location",
      "contacts",
      "button",
      "interactive",
    ]) {
      expect(shouldAutoReply({ ...base, msgType })).toBe(true);
    }
  });

  it("skips reaction, system, unsupported and unknown types", () => {
    for (const msgType of ["reaction", "system", "unsupported", "order", ""]) {
      expect(shouldAutoReply({ ...base, msgType })).toBe(false);
    }
  });

  it("skips messages from our own display number (compared after normalization)", () => {
    expect(
      shouldAutoReply({ msgType: "text", from: "917000000000", displayPhone: "+91 70000 00000" }),
    ).toBe(false);
  });
});

describe("dispatchAutoReply", () => {
  it("skips senders outside WA_CLOUD_TEST_RECIPIENTS in local test mode", async () => {
    vi.stubEnv("WA_CLOUD_TEST_RECIPIENTS", "8830553868");
    expect(await dispatchAutoReply({ from: "919999999999", tenantId: "t1" })).toBe("skipped");
    expect(executeMock).not.toHaveBeenCalled();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("does nothing when the Cloud API is unavailable", async () => {
    isCloudAvailableMock.mockResolvedValue(false);
    expect(await dispatchAutoReply({ from: "918830553868", tenantId: "t1" })).toBe("skipped");
    expect(executeMock).not.toHaveBeenCalled();
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("does not send when an auto-reply went to this sender within 6 hours", async () => {
    routeQueries({ cooldown: { id: "ar1" } });
    expect(await dispatchAutoReply({ from: "918830553868", tenantId: "t1" })).toBe("skipped");
    expect(sendTextMessageMock).not.toHaveBeenCalled();
    const cooldownSql = queryOneMock.mock.calls.find((c) => c[0].includes("autoReply"))![0];
    expect(cooldownSql).toContain("INTERVAL 6 HOUR");
    expect(cooldownSql).toContain("status <> 'failed'");
  });

  it("logs the reply as an outbound autoReply row with the generic text and records the wamid", async () => {
    expect(await dispatchAutoReply({ from: "918830553868", tenantId: "t1" })).toBe("sent");

    // The reply is always the generic text; the business contact is never looked up.
    expect(sendTextMessageMock).toHaveBeenCalledWith({ to: "918830553868", body: GENERIC });

    const insert = executeMock.mock.calls.find((c) => c[0].includes("INSERT INTO WaMessageLog"))!;
    expect(insert[0]).toContain("'autoReply', 'official', 'queued'");
    expect(insert[0]).toContain("'out'");
    expect(insert[1].slice(1)).toEqual(["t1", "918830553868", GENERIC]);

    const update = executeMock.mock.calls.find((c) => c[0].includes("metaMessageId = ?"))!;
    expect(update[1][0]).toBe("wamid.AR");
  });

  it("logs tenant 'global' and the generic text when unresolved", async () => {
    expect(await dispatchAutoReply({ from: "918830553868", tenantId: null })).toBe("sent");
    expect(sendTextMessageMock).toHaveBeenCalledWith({ to: "918830553868", body: GENERIC });
    const insert = executeMock.mock.calls.find((c) => c[0].includes("INSERT INTO WaMessageLog"))!;
    expect(insert[1][1]).toBe("global");
  });

  it("marks the row failed on a Meta error and resolves without throwing", async () => {
    sendTextMessageMock.mockResolvedValue({
      ok: false,
      kind: "meta_error",
      code: "131047",
      message: "Re-engagement message",
    });
    expect(await dispatchAutoReply({ from: "918830553868", tenantId: null })).toBe("failed");
    const failed = executeMock.mock.calls.find((c) => c[0].includes("status = 'failed'"))!;
    expect(failed[1].slice(0, 4)).toEqual([
      "131047",
      "Re-engagement message",
      "131047",
      "Re-engagement message",
    ]);
  });

  it("resolves 'failed' when the DB throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queryOneMock.mockRejectedValue(new Error("db down"));
    await expect(dispatchAutoReply({ from: "918830553868", tenantId: null })).resolves.toBe(
      "failed",
    );
    expect(sendTextMessageMock).not.toHaveBeenCalled();
  });

  it("sends once when two dispatches for the same sender race", async () => {
    const results = await Promise.all([
      dispatchAutoReply({ from: "918830553868", tenantId: null }),
      dispatchAutoReply({ from: "+91 88305 53868", tenantId: null }),
    ]);
    expect(results.sort()).toEqual(["sent", "skipped"]);
    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
  });
});
