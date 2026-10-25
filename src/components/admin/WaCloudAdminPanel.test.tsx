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

vi.mock("../../lib/admin", () => ({
  getWaCloudConfigServerFn: (...args: any[]) => getWaCloudConfigServerFn(...args),
  saveWaCloudConfigServerFn: (...args: any[]) => saveWaCloudConfigServerFn(...args),
  testWaCloudConfigServerFn: (...args: any[]) => testWaCloudConfigServerFn(...args),
  listWaCloudTemplatesServerFn: vi.fn(async () => []),
  saveWaCloudTemplateServerFn: vi.fn(),
  submitWaCloudTemplateServerFn: vi.fn(),
  syncWaCloudTemplateStatusServerFn: vi.fn(),
  getWaCloudLogsServerFn: vi.fn(async () => ({ recent: [], breakdown: {} })),
}));

vi.mock("../../lib/auth", () => ({
  uploadWATemplateHeaderImageServerFn: vi.fn(),
}));

import { WaCloudAdminPanel } from "./WaCloudAdminPanel";

const CONFIG = {
  phoneNumberId: "123",
  wabaId: "456",
  apiVersion: "v21.0",
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
