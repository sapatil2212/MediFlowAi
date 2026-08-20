// @vitest-environment jsdom
/**
 * WhatsAppAlertsSettings.test.tsx
 *
 * Focused DOM/integration suite for the `WhatsApp Alerts` Settings sub-tab
 * (spec `.kiro/specs/restaurant-dashboard-settings`, task 9.3,
 * Req 7.1-7.13, 10.9, 10.10, 11.2).
 *
 * Every server interaction is an injected callback, exactly like
 * `RestaurantProfilePanel.test.tsx`, so the tests never touch auth, SQL, or the
 * WhatsApp microservice. The production strict-service module is mocked at the
 * module boundary only so importing the component does not pull `db`/`auth`
 * into jsdom. Polling is driven with Vitest fake timers.
 *
 * Coverage:
 *   - all five session states (DISCONNECTED/CONNECTING/QR_READY/CONNECTED/ERROR),
 *   - manual refresh re-reads the strict status,
 *   - 3s non-overlapping polling while not connected, interval cleared on
 *     connect, and no polling after unmount (Req 7.7),
 *   - QR + pairing instructions rendering (Req 7.6),
 *   - connected metrics (queue/sent) and actions (Req 7.8),
 *   - view_only permission refusal: strict reads, no mutation controls (Req 10.10),
 *   - strict ERROR surfaced with the prior stored config retained (Req 7.13),
 *   - a failed save/init/disconnect/test never reports false success and never
 *     mutates the stored config (Req 7.11, 7.12, 11.2).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Keep the real strict-service module (and its db/auth imports) out of jsdom;
// the component only uses these as defaults, and every test injects its own.
vi.mock("../../lib/restaurant-settings", () => ({
  getWhatsAppSettingsStatusServerFn: vi.fn(),
  saveWhatsAppSettingsConfigServerFn: vi.fn(),
  initializeWhatsAppSettingsServerFn: vi.fn(),
  disconnectWhatsAppSettingsServerFn: vi.fn(),
  sendWhatsAppSettingsTestMessageServerFn: vi.fn(),
}));

import { WhatsAppAlertsSettings, WHATSAPP_POLL_INTERVAL_MS } from "./WhatsAppAlertsSettings";
import type { WhatsAppSettingsStatusView } from "../../lib/restaurant-settings";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type SessionState = WhatsAppSettingsStatusView["status"]["state"];

/** A poll interval large enough that plain (non-timer) tests never poll. */
const NO_POLL = 10_000_000;

const STORED_PHONE = "919876543210";

function statusOf(
  state: SessionState,
  overrides: Partial<WhatsAppSettingsStatusView["status"]> = {},
): WhatsAppSettingsStatusView["status"] {
  return {
    state,
    qrDataUrl: "",
    connectedNumber: "",
    queueCount: 0,
    sentCount: 0,
    sentLog: [],
    ...overrides,
  };
}

function buildView(
  overrides: Partial<WhatsAppSettingsStatusView> = {},
): WhatsAppSettingsStatusView {
  return {
    config: { id: "cfg-1", tenantId: "tenant-1", phoneNumber: STORED_PHONE, isEnabled: true },
    status: statusOf("DISCONNECTED"),
    canOperate: true,
    statusMessage: null,
    ...overrides,
  };
}

/** A fetchStatus that always resolves with the given view. */
const fetchOf = (view: WhatsAppSettingsStatusView) => vi.fn(async () => view);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Renders with a large poll interval and waits for the initial read to settle. */
async function mountPanel(props: Parameters<typeof WhatsAppAlertsSettings>[0]) {
  const utils = render(<WhatsAppAlertsSettings pollIntervalMs={NO_POLL} {...props} />);
  await screen.findByTestId("whatsapp-panel");
  return utils;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Session states (Req 7.4-7.6)
// ---------------------------------------------------------------------------

describe("Session states (Req 7.4-7.6)", () => {
  const STATES: ReadonlyArray<[SessionState, string]> = [
    ["DISCONNECTED", "Disconnected"],
    ["CONNECTING", "Initializing..."],
    ["QR_READY", "Waiting for scan"],
    ["CONNECTED", "Connected"],
    ["ERROR", "Connection error"],
  ];

  it.each(STATES)("renders the %s state with its label", async (state, label) => {
    await mountPanel({ fetchStatus: fetchOf(buildView({ status: statusOf(state) })) });
    const badge = screen.getByTestId("whatsapp-status");
    expect(badge.getAttribute("data-state")).toBe(state);
    expect(badge.textContent).toBe(label);
  });

  it("renders a load-failure alert when the initial read throws", async () => {
    const fetchStatus = vi.fn(async () => {
      throw new Error("boom");
    });
    render(<WhatsAppAlertsSettings pollIntervalMs={NO_POLL} fetchStatus={fetchStatus} />);
    await waitFor(() => expect(screen.getByTestId("whatsapp-load-error")).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------
// Manual refresh (Req 7.5)
// ---------------------------------------------------------------------------

describe("Manual refresh (Req 7.5)", () => {
  it("re-reads the strict status when the refresh control is used", async () => {
    const fetchStatus = vi
      .fn<() => Promise<WhatsAppSettingsStatusView>>()
      .mockResolvedValueOnce(buildView({ status: statusOf("DISCONNECTED") }))
      .mockResolvedValue(buildView({ status: statusOf("CONNECTED", { connectedNumber: "111" }) }));

    await mountPanel({ fetchStatus });
    expect(screen.getByTestId("whatsapp-status").getAttribute("data-state")).toBe("DISCONNECTED");

    await act(async () => {
      fireEvent.click(screen.getByTestId("whatsapp-refresh"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("whatsapp-status").getAttribute("data-state")).toBe("CONNECTED"),
    );
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Polling (Req 7.7) — fake timers
// ---------------------------------------------------------------------------

describe("Polling while not connected (Req 7.7)", () => {
  it("polls every 3 seconds while the session is not connected", async () => {
    vi.useFakeTimers();
    const fetchStatus = fetchOf(buildView({ status: statusOf("QR_READY", { qrDataUrl: "x" }) }));
    render(
      <WhatsAppAlertsSettings pollIntervalMs={WHATSAPP_POLL_INTERVAL_MS} fetchStatus={fetchStatus} />,
    );

    // Flush the initial read.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(WHATSAPP_POLL_INTERVAL_MS).toBe(3000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("suppresses an overlapping poll while one is still in flight", async () => {
    vi.useFakeTimers();
    const pending = deferred<WhatsAppSettingsStatusView>();
    const fetchStatus = vi
      .fn<() => Promise<WhatsAppSettingsStatusView>>()
      .mockResolvedValueOnce(buildView({ status: statusOf("QR_READY", { qrDataUrl: "x" }) }))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(buildView({ status: statusOf("QR_READY", { qrDataUrl: "x" }) }));

    render(
      <WhatsAppAlertsSettings pollIntervalMs={WHATSAPP_POLL_INTERVAL_MS} fetchStatus={fetchStatus} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    // First interval: a poll begins and stays pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);

    // Second interval while the first poll is still pending: suppressed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);

    // Once the in-flight poll resolves, the next interval is allowed to poll.
    await act(async () => {
      pending.resolve(buildView({ status: statusOf("QR_READY", { qrDataUrl: "x" }) }));
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("clears the polling interval once the session becomes connected", async () => {
    vi.useFakeTimers();
    const fetchStatus = vi
      .fn<() => Promise<WhatsAppSettingsStatusView>>()
      .mockResolvedValueOnce(buildView({ status: statusOf("QR_READY", { qrDataUrl: "x" }) }))
      .mockResolvedValue(buildView({ status: statusOf("CONNECTED", { connectedNumber: "111" }) }));

    render(
      <WhatsAppAlertsSettings pollIntervalMs={WHATSAPP_POLL_INTERVAL_MS} fetchStatus={fetchStatus} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    // One poll flips the state to CONNECTED, which tears down the interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);

    // No further polling happens once connected.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("stops polling after the panel unmounts (tab switch)", async () => {
    vi.useFakeTimers();
    const fetchStatus = fetchOf(buildView({ status: statusOf("DISCONNECTED") }));
    const { unmount } = render(
      <WhatsAppAlertsSettings pollIntervalMs={WHATSAPP_POLL_INTERVAL_MS} fetchStatus={fetchStatus} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    // No polls fired after unmount.
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// QR pairing (Req 7.6)
// ---------------------------------------------------------------------------

describe("QR pairing (Req 7.6)", () => {
  it("renders the QR image and pairing instructions when a QR is available", async () => {
    const qr = "data:image/png;base64,QQ==";
    await mountPanel({
      fetchStatus: fetchOf(buildView({ status: statusOf("QR_READY", { qrDataUrl: qr }) })),
    });
    const img = screen.getByTestId("whatsapp-qr") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(qr);
    expect(screen.getByTestId("whatsapp-instructions")).toBeTruthy();
  });

  it("renders no QR when connected", async () => {
    await mountPanel({
      fetchStatus: fetchOf(buildView({ status: statusOf("CONNECTED", { connectedNumber: "111" }) })),
    });
    expect(screen.queryByTestId("whatsapp-qr")).toBeNull();
    expect(screen.queryByTestId("whatsapp-instructions")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Connected metrics and actions (Req 7.8, 7.9)
// ---------------------------------------------------------------------------

describe("Connected metrics and actions (Req 7.8, 7.9)", () => {
  it("shows queue/sent metrics and the connected controls", async () => {
    await mountPanel({
      fetchStatus: fetchOf(
        buildView({
          status: statusOf("CONNECTED", { connectedNumber: "111", queueCount: 5, sentCount: 3 }),
        }),
      ),
    });
    expect(screen.getByTestId("whatsapp-queue-count").textContent).toBe("5");
    expect(screen.getByTestId("whatsapp-sent-count").textContent).toBe("3");
    expect(screen.getByTestId("whatsapp-disconnect")).toBeTruthy();
    expect(screen.getByTestId("whatsapp-test-form")).toBeTruthy();
  });

  it("disconnects and re-reads the status on a confirmed disconnect", async () => {
    const disconnect = vi.fn(async () => ({ status: "ok" as const }));
    const fetchStatus = vi
      .fn<() => Promise<WhatsAppSettingsStatusView>>()
      .mockResolvedValueOnce(buildView({ status: statusOf("CONNECTED", { connectedNumber: "111" }) }))
      .mockResolvedValue(buildView({ status: statusOf("DISCONNECTED") }));
    const showToast = vi.fn();

    await mountPanel({ fetchStatus, disconnect, showToast });

    await act(async () => {
      fireEvent.click(screen.getByTestId("whatsapp-disconnect"));
      await Promise.resolve();
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("whatsapp-status").getAttribute("data-state")).toBe("DISCONNECTED"),
    );
    expect(showToast).toHaveBeenCalledWith("success", expect.stringMatching(/disconnected/i));
  });
});

// ---------------------------------------------------------------------------
// Permission refusal (Req 10.9, 10.10, 7.10)
// ---------------------------------------------------------------------------

describe("Permission refusal for view_only (Req 10.10)", () => {
  it("renders status but no mutation controls when canOperate is false", async () => {
    await mountPanel({
      fetchStatus: fetchOf(
        buildView({
          canOperate: false,
          status: statusOf("CONNECTED", { connectedNumber: "111", queueCount: 1, sentCount: 1 }),
        }),
      ),
    });

    // Strict read still renders the connected metrics.
    expect(screen.getByTestId("whatsapp-queue-count").textContent).toBe("1");
    // But every mutation control is absent, and the view-only notice is shown.
    expect(screen.queryByTestId("whatsapp-save")).toBeNull();
    expect(screen.queryByTestId("whatsapp-disconnect")).toBeNull();
    expect(screen.queryByTestId("whatsapp-test-form")).toBeNull();
    expect(screen.queryByTestId("whatsapp-initialize")).toBeNull();
    expect(screen.getByTestId("whatsapp-view-only")).toBeTruthy();
    // The config inputs are disabled.
    expect((screen.getByTestId("whatsapp-phone") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("whatsapp-enabled") as HTMLInputElement).disabled).toBe(true);
  });

  it("does not offer a connect control while disconnected under view_only", async () => {
    await mountPanel({
      fetchStatus: fetchOf(buildView({ canOperate: false, status: statusOf("DISCONNECTED") })),
    });
    expect(screen.queryByTestId("whatsapp-initialize")).toBeNull();
    expect(screen.queryByTestId("whatsapp-save")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Strict ERROR (Req 7.13)
// ---------------------------------------------------------------------------

describe("Strict ERROR state (Req 7.13)", () => {
  it("surfaces the ERROR state and message while retaining the prior stored config", async () => {
    await mountPanel({
      fetchStatus: fetchOf(
        buildView({
          status: statusOf("ERROR"),
          statusMessage: "The WhatsApp session state could not be read",
          config: { id: "cfg-1", tenantId: "tenant-1", phoneNumber: STORED_PHONE, isEnabled: true },
        }),
      ),
    });

    expect(screen.getByTestId("whatsapp-status").getAttribute("data-state")).toBe("ERROR");
    expect(screen.getByTestId("whatsapp-status-message").textContent).toContain(
      "could not be read",
    );
    // The separately loaded stored config is still shown (config not lost on ERROR).
    expect((screen.getByTestId("whatsapp-phone") as HTMLInputElement).value).toBe(STORED_PHONE);
  });
});

// ---------------------------------------------------------------------------
// No false success and no config mutation on failure (Req 7.11, 7.12, 11.2)
// ---------------------------------------------------------------------------

describe("No false success / no config mutation on failure (Req 7.11, 7.12, 11.2)", () => {
  it("shows an error and keeps the prior config on a failed save", async () => {
    const prior = { id: "cfg-1", tenantId: "tenant-1", phoneNumber: STORED_PHONE, isEnabled: true };
    const saveConfig = vi.fn(async () => ({
      status: "error" as const,
      message: "The WhatsApp alert settings could not be saved",
      config: prior,
    }));
    await mountPanel({
      fetchStatus: fetchOf(buildView({ config: prior })),
      saveConfig,
    });

    fireEvent.change(screen.getByTestId("whatsapp-phone"), { target: { value: "911112223334" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("whatsapp-save"));
      await Promise.resolve();
    });

    expect(saveConfig).toHaveBeenCalledTimes(1);
    // No success is reported and the error is surfaced.
    await screen.findByTestId("whatsapp-config-error");
    expect(screen.queryByTestId("whatsapp-config-success")).toBeNull();
    // The server-returned prior config is restored (never mutated).
    expect((screen.getByTestId("whatsapp-phone") as HTMLInputElement).value).toBe(STORED_PHONE);
  });

  it("reports success only when the save is confirmed", async () => {
    const saveConfig = vi.fn(async () => ({
      status: "saved" as const,
      config: { id: "cfg-1", tenantId: "tenant-1", phoneNumber: "911112223334", isEnabled: false },
    }));
    await mountPanel({ fetchStatus: fetchOf(buildView()), saveConfig });

    fireEvent.change(screen.getByTestId("whatsapp-phone"), { target: { value: "911112223334" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("whatsapp-save"));
      await Promise.resolve();
    });

    await screen.findByTestId("whatsapp-config-success");
    expect(screen.queryByTestId("whatsapp-config-error")).toBeNull();
    expect((screen.getByTestId("whatsapp-phone") as HTMLInputElement).value).toBe("911112223334");
  });

  it("shows an error and does not advance the state on a failed initialize", async () => {
    const initialize = vi.fn(async () => ({
      status: "error" as const,
      message: "WhatsApp pairing could not be started",
    }));
    const fetchStatus = fetchOf(buildView({ status: statusOf("DISCONNECTED") }));
    await mountPanel({ fetchStatus, initialize });

    await act(async () => {
      fireEvent.click(screen.getByTestId("whatsapp-initialize"));
      await Promise.resolve();
    });

    expect(initialize).toHaveBeenCalledTimes(1);
    await screen.findByTestId("whatsapp-config-error");
    // The status is not re-read on a failed initialize (no false progression).
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("whatsapp-status").getAttribute("data-state")).toBe("DISCONNECTED");
  });

  it("surfaces a disconnect failure via toast and keeps the connected state", async () => {
    const disconnect = vi.fn(async () => ({
      status: "error" as const,
      message: "The WhatsApp session could not be disconnected",
    }));
    const showToast = vi.fn();
    const fetchStatus = fetchOf(
      buildView({ status: statusOf("CONNECTED", { connectedNumber: "111" }) }),
    );
    await mountPanel({ fetchStatus, disconnect, showToast });

    await act(async () => {
      fireEvent.click(screen.getByTestId("whatsapp-disconnect"));
      await Promise.resolve();
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("error", expect.stringMatching(/could not be disconnected/i));
    // Still connected; no status re-read happened on failure.
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("whatsapp-status").getAttribute("data-state")).toBe("CONNECTED");
  });

  it("shows an error with no success and never touches config on a failed test message", async () => {
    const sendTestMessage = vi.fn(async () => ({
      status: "error" as const,
      message: "The test message could not be queued",
    }));
    const saveConfig = vi.fn();
    await mountPanel({
      fetchStatus: fetchOf(buildView({ status: statusOf("CONNECTED", { connectedNumber: "111" }) })),
      sendTestMessage,
      saveConfig,
    });

    fireEvent.change(screen.getByTestId("whatsapp-test-phone"), { target: { value: "919999999999" } });
    fireEvent.change(screen.getByTestId("whatsapp-test-body"), { target: { value: "Hello" } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("whatsapp-test-form"));
      await Promise.resolve();
    });

    expect(sendTestMessage).toHaveBeenCalledTimes(1);
    await screen.findByTestId("whatsapp-test-error");
    expect(screen.queryByTestId("whatsapp-test-success")).toBeNull();
    // A failed test enqueue never re-saves or mutates the alert config.
    expect(saveConfig).not.toHaveBeenCalled();
    expect((screen.getByTestId("whatsapp-phone") as HTMLInputElement).value).toBe(STORED_PHONE);
  });

  it("queues a test message and clears the body on success", async () => {
    const sendTestMessage = vi.fn(async () => ({ status: "queued" as const }));
    await mountPanel({
      fetchStatus: fetchOf(buildView({ status: statusOf("CONNECTED", { connectedNumber: "111" }) })),
      sendTestMessage,
    });

    fireEvent.change(screen.getByTestId("whatsapp-test-phone"), { target: { value: "919999999999" } });
    fireEvent.change(screen.getByTestId("whatsapp-test-body"), { target: { value: "Hello" } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("whatsapp-test-form"));
      await Promise.resolve();
    });

    expect(sendTestMessage).toHaveBeenCalledWith({
      data: { phone: "919999999999", body: "Hello", requestedLocationId: null },
    });
    await screen.findByTestId("whatsapp-test-success");
    expect((screen.getByTestId("whatsapp-test-body") as HTMLTextAreaElement).value).toBe("");
  });
});
