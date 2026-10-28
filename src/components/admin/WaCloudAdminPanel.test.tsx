// @vitest-environment jsdom
/**
 * WaCloudAdminPanel.test.tsx
 *
 * DOM suite for the Credentials tab of the super-admin WhatsApp Cloud API
 * panel: webhook callback URL, plain-text test send (confirm guard, payload,
 * result rendering incl. the Meta 24-hour hint) and the pre-flight "Verified
 * with Meta" box. Server functions are mocked at the module boundary, so no
 * auth, SQL or Meta Graph API call is made.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const getWaCloudConfigServerFn = vi.fn();
const saveWaCloudConfigServerFn = vi.fn();
const testWaCloudConfigServerFn = vi.fn();

// The Templates sub-tab now mounts <TemplatesModule/>, which (with its child
// views) imports the whole wa-template server-fn surface. Stub every one so no
// auth/SQL/Meta call is made and the module can mount.
vi.mock("../../lib/admin", () => {
  const ok = (extra: any = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  return {
    getWaCloudConfigServerFn: (...args: any[]) => getWaCloudConfigServerFn(...args),
    saveWaCloudConfigServerFn: (...args: any[]) => saveWaCloudConfigServerFn(...args),
    testWaCloudConfigServerFn: (...args: any[]) => testWaCloudConfigServerFn(...args),
    getWaCloudLogsServerFn: vi.fn(async () => ({ recent: [], breakdown: {} })),
    waTemplateDashboardServerFn: ok({
      summary: { total: 0, byBucket: {}, byStatus: {}, lastSyncOkAt: null, lastApiOkAt: null },
    }),
    waSyncAllServerFn: ok(),
    waTemplateListServerFn: ok({ rows: [], total: 0 }),
    waTemplateDetailsServerFn: ok({ row: null }),
    waTemplateRevisionsServerFn: ok({ rows: [] }),
    waTemplateActivityServerFn: ok({ rows: [] }),
    waTemplateSyncRunsServerFn: ok({ rows: [] }),
    waAccountHealthServerFn: ok({ health: null }),
    waRefreshHealthServerFn: ok(),
    waNotifyMappingsServerFn: ok({ rows: [] }),
    waCreateDraftServerFn: ok({ id: "x" }),
    waUpdateDraftServerFn: ok({ id: "x" }),
    waValidateDraftServerFn: ok({ payload: {}, warnings: [] }),
    waSubmitTemplateServerFn: ok({ metaStatus: "PENDING" }),
    waCloneTemplateServerFn: ok({ id: "x" }),
    waArchiveDraftServerFn: ok(),
    waDeleteDraftServerFn: ok(),
    waDeleteMetaTemplateServerFn: ok(),
    waReconcileTemplateServerFn: ok(),
    waAssignMappingServerFn: ok({ mapping: {} }),
    waSetMappingEnabledServerFn: ok({ mapping: {} }),
    waRemoveMappingServerFn: ok(),
    notifyOverviewServerFn: (...args: any[]) => notifyOverviewServerFn(...args),
    notifyResolveAlertServerFn: ok(),
    notifyLogsServerFn: (...args: any[]) => notifyLogsServerFn(...args),
    notifyEventDetailServerFn: ok({ event: null, timeline: [], attempts: [] }),
    notifyRetryServerFn: ok(),
    notifySettingsGetServerFn: ok({
      settings: {
        engineEnabled: true,
        consentMode: "implied_by_booking",
        autoActivateCatalog: true,
        categoryEnabled: { clinic: true },
      },
      testModeProcess: false,
    }),
    notifySettingsSaveServerFn: ok({ settings: {} }),
    notifyRoutesServerFn: ok({ rows: [] }),
    notifyRouteSetServerFn: ok(),
    notifyCatalogPlanServerFn: (...args: any[]) => notifyCatalogPlanServerFn(...args),
    notifyCatalogSubmitServerFn: ok({ results: [] }),
    notifyCatalogActivateServerFn: ok({ changes: [] }),
    notifyTestSendServerFn: ok({ messageId: "wamid.X" }),
  };
});

const notifyOverviewServerFn = vi.fn();
const notifyLogsServerFn = vi.fn();
const notifyCatalogPlanServerFn = vi.fn();

const OVERVIEW = {
  ok: true,
  provider: {
    configured: true,
    enabled: true,
    wabaId: "456",
    idsDistinct: true,
    apiVersion: "v21.0",
    apiVersionExpiresOn: "2027-01-21",
    senderNumber: "+91 81850 51355",
    verifiedName: "Bookmytime",
    qualityRating: "GREEN",
    phoneStatus: "CONNECTED",
    codeVerification: "VERIFIED",
    canSendMessage: "AVAILABLE",
    tokenValid: true,
    tokenScopesOk: true,
    lastApiOkAt: null,
  },
  templates: { total: 5, byStatus: { APPROVED: 5 }, lastSyncOkAt: null, lastSyncRun: null },
  queue: {
    engineEnabled: true,
    last24h: {
      byStatus: { delivered: 3, failed: 1 },
      byCategory: {},
      dueBacklog: 0,
      oldestDueMs: null,
      retries: 0,
      avgDispatchLatencyMs: 900,
      avgDeliveryLatencyMs: 2000,
    },
    lastHour: { byStatus: {}, byCategory: {}, dueBacklog: 0, oldestDueMs: null, retries: 0 },
  },
  webhook: { received24h: 12, errors24h: 0, lastReceivedAt: null },
  byCategory: [
    {
      category: "clinic",
      label: "Clinics & healthcare",
      enabled: true,
      total: 4,
      delivered: 3,
      failed: 1,
    },
  ],
  recentFailures: [],
  alerts: [
    {
      key: "queue:backlog",
      severity: "warning",
      title: "Notification queue backlog",
      detail: null,
      occurrences: 1,
    },
  ],
};

import { WaCloudAdminPanel } from "./WaCloudAdminPanel";

const CONFIG = {
  phoneNumberId: "123",
  wabaId: "456",
  apiVersion: "v21.0",
  apiVersionInfo: {
    value: "v21.0",
    source: "db",
    expiresOn: "2027-01-21",
    warning: "API version v21.0 expires on 2027-01-21 (soon); plan to update it in Credentials.",
  },
  isEnabled: true,
  tokenConfigured: true,
  tokenLast4: "AB12",
  appSecretConfigured: true,
  appSecretLast4: "CD34",
  verifyTokenConfigured: true,
  encKeyConfigured: true,
  recipientAllowlistActive: false,
  bookedRouteReady: true,
  source: "db",
};

beforeEach(() => {
  getWaCloudConfigServerFn.mockReset();
  saveWaCloudConfigServerFn.mockReset();
  testWaCloudConfigServerFn.mockReset();
  getWaCloudConfigServerFn.mockResolvedValue(CONFIG);
  notifyOverviewServerFn.mockReset();
  notifyOverviewServerFn.mockResolvedValue(OVERVIEW);
  notifyLogsServerFn.mockReset();
  notifyLogsServerFn.mockResolvedValue({ ok: true, total: 0, rows: [] });
  notifyCatalogPlanServerFn.mockReset();
  notifyCatalogPlanServerFn.mockResolvedValue({
    ok: true,
    rows: [],
    excluded: [],
    summary: { total: 0, approved: 0, pending: 0, rejected: 0, missing: 0, submittable: 0 },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Opens the Credentials tab (the panel now opens on Overview). */
async function renderPanel() {
  render(<WaCloudAdminPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Credentials" }));
  return await screen.findByLabelText("To phone (with country code)");
}

describe("WaCloudAdminPanel — Credentials", () => {
  it("shows the read-only webhook callback URL with a copy button", async () => {
    await renderPanel();
    const url = screen.getByLabelText("Webhook Callback URL") as HTMLInputElement;
    expect(url).toHaveValue(`${window.location.origin}/api/whatsapp/webhook`);
    expect(url.readOnly).toBe(true);
    expect(screen.getByRole("button", { name: "Copy webhook callback URL" })).toBeInTheDocument();
    expect(screen.getByText(/subscribe to the "messages" field/)).toBeInTheDocument();
  });

  it("offers a phone input and a message textarea with the default text", async () => {
    const phone = await renderPanel();
    expect(phone).toHaveAttribute("type", "tel");
    const message = screen.getByLabelText("Message");
    expect(message.tagName).toBe("TEXTAREA");
    expect(message).toHaveValue("Test message from BookMyTime");
    expect(screen.getByRole("button", { name: /Send test message/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Template name")).not.toBeInTheDocument();
  });

  it("does not call the server when the confirm dialog is declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const phone = await renderPanel();
    fireEvent.change(phone, { target: { value: "918830553868" } });
    fireEvent.click(screen.getByRole("button", { name: /Send test message/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(testWaCloudConfigServerFn).not.toHaveBeenCalled();
  });

  it("sends { toPhone, message } and shows the message id as accepted (not delivered)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    testWaCloudConfigServerFn.mockResolvedValue({ ok: true, messageId: "wamid.T1" });
    const phone = await renderPanel();
    fireEvent.change(phone, { target: { value: "918830553868" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello admin" } });
    fireEvent.click(screen.getByRole("button", { name: /Send test message/ }));

    await waitFor(() =>
      expect(testWaCloudConfigServerFn).toHaveBeenCalledWith({
        data: { toPhone: "918830553868", message: "Hello admin" },
      }),
    );
    expect(
      await screen.findByText(
        "Accepted by Meta. Message ID: wamid.T1. Check Monitoring for delivery.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the Meta error code, message and 24-hour hint on failure", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    testWaCloudConfigServerFn.mockResolvedValue({
      ok: false,
      code: "131047",
      message: "Re-engagement message",
      hint: "The recipient must message your business WhatsApp number first (Meta 24-hour rule).",
    });
    const phone = await renderPanel();
    fireEvent.change(phone, { target: { value: "918830553868" } });
    fireEvent.click(screen.getByRole("button", { name: /Send test message/ }));

    expect(await screen.findByText("Failed (131047): Re-engagement message")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The recipient must message your business WhatsApp number first (Meta 24-hour rule).",
      ),
    ).toBeInTheDocument();
  });

  it("labels the WABA field as the Messaging Account ID and shows the API version warning", async () => {
    await renderPanel();
    expect(screen.getByText("Messaging Account ID (legacy WABA ID)")).toBeInTheDocument();
    expect(screen.getByText(/v21\.0 expires on 2027-01-21/)).toBeInTheDocument();
    expect(screen.getByText(/message_template_status_update/)).toBeInTheDocument();
  });

  it("warns when the production recipient allow-list is active without exposing its values", async () => {
    const sentinel = "919999999999";
    getWaCloudConfigServerFn.mockResolvedValue({
      ...CONFIG,
      recipientAllowlistActive: true,
    });

    await renderPanel();

    expect(screen.getByText(/WA_CLOUD_TEST_RECIPIENTS/)).toBeInTheDocument();
    expect(
      screen.getByText(/official sends to patients outside the test allow-list/),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(sentinel);
  });

  it("shows the Meta-verified phone details after a save", async () => {
    saveWaCloudConfigServerFn.mockResolvedValue({
      ok: true,
      verified: {
        verifiedName: "BookMyTime",
        displayPhoneNumber: "+91 88305 53868",
        qualityRating: "GREEN",
      },
    });
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const box = await screen.findByRole("status");
    expect(box).toHaveTextContent("Verified with Meta");
    expect(box).toHaveTextContent("BookMyTime");
    expect(box).toHaveTextContent("+91 88305 53868");
    expect(box).toHaveTextContent("GREEN");
  });
});

describe("WaCloudAdminPanel — Templates sub-tab", () => {
  it("opens the industry catalog and mounts the full template module on demand", async () => {
    render(<WaCloudAdminPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    expect(await screen.findByTestId("template-catalog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All templates & editor" }));
    expect(await screen.findByTestId("templates-module")).toBeInTheDocument();
  });
});

describe("WaCloudAdminPanel — Overview, logs and automation", () => {
  it("opens on the Overview with provider, queue, webhook and alert health", async () => {
    render(<WaCloudAdminPanel />);
    expect(await screen.findByTestId("notify-overview")).toBeInTheDocument();
    expect(screen.getByText("+91 81850 51355")).toBeInTheDocument();
    expect(screen.getByText("Notification queue backlog")).toBeInTheDocument();
    expect(screen.getByText("Clinics & healthcare")).toBeInTheDocument();
    // Non-secret identifiers only.
    expect(document.body.textContent).not.toMatch(/EAA[A-Za-z0-9]{10,}/);
  });

  it("loads notification logs with server-side filters", async () => {
    render(<WaCloudAdminPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Notification Logs" }));
    expect(await screen.findByTestId("notify-logs")).toBeInTheDocument();
    await waitFor(() => expect(notifyLogsServerFn).toHaveBeenCalled());
    expect(screen.getByText("No notifications match these filters.")).toBeInTheDocument();
  });

  it("shows the automation policy and routing controls", async () => {
    render(<WaCloudAdminPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Automation" }));
    expect(await screen.findByTestId("notify-automation")).toBeInTheDocument();
    expect(screen.getByText("Notification engine enabled")).toBeInTheDocument();
    expect(screen.getByText("Event → template routing")).toBeInTheDocument();
  });
});
