// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const waAccountHealthServerFn = vi.fn();
const waRefreshHealthServerFn = vi.fn();

vi.mock("../../../lib/admin", () => ({
  waAccountHealthServerFn: (...a: any[]) => waAccountHealthServerFn(...a),
  waRefreshHealthServerFn: (...a: any[]) => waRefreshHealthServerFn(...a),
}));

import { AccountHealthPanel } from "./AccountHealthPanel";

const SECRET = "EAAG_super_secret_token_value";

function health(over: any = {}) {
  return {
    apiVersion: { value: "v26.0", expiresOn: null, warning: null },
    waba: { name: "BookMyTime", account_review_status: "APPROVED" },
    phone: {
      display_phone_number: "+91 88305 53868",
      quality_rating: "GREEN",
      status: "CONNECTED",
    },
    health: { can_send_message: "AVAILABLE" },
    subscribedApps: null,
    token: {
      valid: true,
      appId: "123",
      type: "SYSTEM_USER",
      expiresAt: null,
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      hasManagement: true,
      hasMessaging: true,
      note: null,
    },
    accountTypeOk: true,
    fetchedAt: "2026-01-01T00:00:00Z",
    notes: [],
    ...over,
  };
}

beforeEach(() => {
  waAccountHealthServerFn.mockReset();
  waRefreshHealthServerFn.mockReset();
});
afterEach(() => cleanup());

describe("AccountHealthPanel", () => {
  it("renders health values without ever showing a token/secret", async () => {
    waAccountHealthServerFn.mockResolvedValue({ ok: true, health: health() });
    const { container } = render(<AccountHealthPanel />);
    await waitFor(() => expect(screen.getByTestId("account-health")).toBeInTheDocument());
    expect(screen.getByText("BookMyTime")).toBeInTheDocument();
    expect(screen.getByText("Messaging account can send.")).toBeInTheDocument();
    expect(container.textContent).not.toContain(SECRET);
  });

  it("renders a restricted-state explanation with a noopener external link", async () => {
    waAccountHealthServerFn.mockResolvedValue({
      ok: true,
      health: health({ health: { can_send_message: "BLOCKED" } }),
    });
    render(<AccountHealthPanel />);
    await waitFor(() => expect(screen.getByTestId("restricted-health")).toBeInTheDocument());
    const link = screen.getByRole("link", { name: /Open WhatsApp Manager/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
