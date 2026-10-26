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
  };
});

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
  source: "db",
};

beforeEach(() => {
  getWaCloudConfigServerFn.mockReset();
  saveWaCloudConfigServerFn.mockReset();
  testWaCloudConfigServerFn.mockReset();
  getWaCloudConfigServerFn.mockResolvedValue(CONFIG);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPanel() {
  render(<WaCloudAdminPanel />);
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
  it("mounts the Utility Template Management module on the Templates tab", async () => {
    render(<WaCloudAdminPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    expect(await screen.findByTestId("templates-module")).toBeInTheDocument();
  });
});
