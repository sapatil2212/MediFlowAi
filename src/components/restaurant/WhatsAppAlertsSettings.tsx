// ─────────────────────────────────────────────────────────────────────────────
// WhatsAppAlertsSettings.tsx — the `WhatsApp Alerts` Settings sub-tab
// (Req 7.1-7.13, 10.9, 10.10, 11.2).
//
// This panel is gated by the plan-gated `whatsapp` feature. It consumes the
// strict WhatsApp Settings service (task 9.1) which:
//
//   * loads the stored alert config separately from the strict session status,
//     so a status transport failure surfaces as an explicit `ERROR` state while
//     the previously stored config is still returned unchanged (Req 7.4, 7.13),
//   * requires `whatsapp: operate` for every state-changing action (config save,
//     initialize/pairing, disconnect, test-message queue) and refuses a
//     `view_only`/`none` account before any adapter/store call (Req 10.9, 10.10),
//   * never reports success for an unconfirmed or failed action, and never
//     mutates the stored config on a failed save or test enqueue (Req 7.11, 7.12).
//
// The panel drives the five-state session machine
// (`DISCONNECTED | CONNECTING | QR_READY | CONNECTED | ERROR`), renders the QR
// pairing surface while not connected, shows connected metrics/actions, and
// polls the strict status every 3 seconds while the state is anything other
// than `CONNECTED` — with overlapping polls suppressed and the interval torn
// down on tab switch/unmount so no poll runs after the panel leaves the DOM
// (Req 7.7).
//
// Every server interaction is an injected callback with a production default, so
// the DOM suite drives request/response timing (and fake-timer polling) exactly
// like `RestaurantProfilePanel` does — without touching auth, SQL, or the
// WhatsApp microservice.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  Send,
  Smartphone,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  disconnectWhatsAppSettingsServerFn,
  getWhatsAppSettingsStatusServerFn,
  initializeWhatsAppSettingsServerFn,
  saveWhatsAppSettingsConfigServerFn,
  sendWhatsAppSettingsTestMessageServerFn,
  type SaveWhatsAppSettingsConfigResult,
  type WhatsAppSettingsActionResult,
  type WhatsAppSettingsStatusView,
  type WhatsAppSettingsTestMessageResult,
} from "../../lib/restaurant-settings";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable callback contracts. Each mirrors the matching `createServerFn`
// signature so the production server function drops in as the default and a
// fake drops in for the DOM suite.
// ─────────────────────────────────────────────────────────────────────────────

export type FetchWhatsAppSettingsStatus = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<WhatsAppSettingsStatusView>;

export type SaveWhatsAppSettingsConfig = (opts: {
  data: { phoneNumber: string; isEnabled: boolean; requestedLocationId?: string | null };
}) => Promise<SaveWhatsAppSettingsConfigResult>;

export type InitializeWhatsAppSettings = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<WhatsAppSettingsActionResult>;

export type DisconnectWhatsAppSettings = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<WhatsAppSettingsActionResult>;

export type SendWhatsAppSettingsTestMessage = (opts: {
  data: { phone: string; body?: string; requestedLocationId?: string | null };
}) => Promise<WhatsAppSettingsTestMessageResult>;

/** The strict session state and the derived status view carried in the panel. */
type SessionStatus = WhatsAppSettingsStatusView["status"];
type SessionState = SessionStatus["state"];

/** The interval, in ms, between strict status polls while not connected (Req 7.7). */
export const WHATSAPP_POLL_INTERVAL_MS = 3000;

const inputClass =
  "mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-500";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1";
const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5";

function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() || fallback;
}

/** A defensive `ERROR` status used only when a status server call itself throws. */
const ERROR_STATUS: SessionStatus = {
  state: "ERROR",
  qrDataUrl: "",
  connectedNumber: "",
  queueCount: 0,
  sentCount: 0,
  sentLog: [],
};

/** Human labels for the strict session states (Req 7.4-7.6). */
const STATE_LABEL: Record<SessionState, string> = {
  DISCONNECTED: "Disconnected",
  CONNECTING: "Initializing...",
  QR_READY: "Waiting for scan",
  CONNECTED: "Connected",
  ERROR: "Connection error",
};

export interface WhatsAppAlertsSettingsProps {
  /** Owner-selected branch scope; forwarded verbatim to every server call. */
  requestedLocationId?: string | null;
  /** Optional host toast surface (used for the disconnect outcome). */
  showToast?: (type: "success" | "error" | "info", message: string) => void;
  /** Poll cadence while not connected; overridable so the DOM suite can pin it. */
  pollIntervalMs?: number;
  fetchStatus?: FetchWhatsAppSettingsStatus;
  saveConfig?: SaveWhatsAppSettingsConfig;
  initialize?: InitializeWhatsAppSettings;
  disconnect?: DisconnectWhatsAppSettings;
  sendTestMessage?: SendWhatsAppSettingsTestMessage;
}

export function WhatsAppAlertsSettings({
  requestedLocationId = null,
  showToast,
  pollIntervalMs = WHATSAPP_POLL_INTERVAL_MS,
  fetchStatus = getWhatsAppSettingsStatusServerFn as unknown as FetchWhatsAppSettingsStatus,
  saveConfig = saveWhatsAppSettingsConfigServerFn as unknown as SaveWhatsAppSettingsConfig,
  initialize = initializeWhatsAppSettingsServerFn as unknown as InitializeWhatsAppSettings,
  disconnect = disconnectWhatsAppSettingsServerFn as unknown as DisconnectWhatsAppSettings,
  sendTestMessage = sendWhatsAppSettingsTestMessageServerFn as unknown as SendWhatsAppSettingsTestMessage,
}: WhatsAppAlertsSettingsProps) {
  // Initial-load lifecycle.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Strict session status (refreshed by polling and manual refresh).
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [canOperate, setCanOperate] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Stored alert config, seeded once from the initial read (Req 7.2, 7.3).
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);

  // Config save lifecycle.
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSuccess, setConfigSuccess] = useState("");
  const [configError, setConfigError] = useState("");

  // Pairing/disconnect lifecycle.
  const [pairing, setPairing] = useState(false);

  // Test message lifecycle.
  const [testPhone, setTestPhone] = useState("");
  const [testBody, setTestBody] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testSuccess, setTestSuccess] = useState("");
  const [testError, setTestError] = useState("");

  const mountedRef = useRef(true);
  // Guards against overlapping in-flight status polls (Req 7.7): a poll that
  // starts while one is still pending is suppressed.
  const pollInFlightRef = useRef(false);

  // Applies a freshly read status view. On the initial read it also seeds the
  // editable config inputs; later polls only refresh the session status so a
  // user's unsaved config edits are never clobbered.
  const applyStatusView = useCallback((view: WhatsAppSettingsStatusView, seedConfig: boolean) => {
    if (!mountedRef.current) return;
    setStatus(view.status);
    setCanOperate(view.canOperate);
    setStatusMessage(view.statusMessage);
    if (seedConfig) {
      setPhoneNumber(view.config?.phoneNumber ?? "");
      setIsEnabled(Boolean(view.config?.isEnabled));
    }
  }, []);

  // A single guarded status read; overlapping calls are suppressed so a slow
  // request never stacks behind the 3s interval (Req 7.7).
  const refreshStatus = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const view = await fetchStatus({ data: { requestedLocationId } });
      applyStatusView(view, false);
    } catch (err) {
      // The strict service maps transport failures to `ERROR` itself; this only
      // fires if the transport call rejects outright. Surface `ERROR` too.
      if (mountedRef.current) {
        setStatus(ERROR_STATUS);
        setStatusMessage(errorText(err, "The WhatsApp session state could not be read"));
      }
    } finally {
      pollInFlightRef.current = false;
    }
  }, [fetchStatus, requestedLocationId, applyStatusView]);

  // Initial load: config + strict status in one read (Req 7.2).
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchStatus({ data: { requestedLocationId } })
      .then((view) => {
        if (cancelled) return;
        applyStatusView(view, true);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(errorText(err, "Could not load WhatsApp settings"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchStatus, requestedLocationId, applyStatusView]);

  // Poll every `pollIntervalMs` while the session is anything other than
  // CONNECTED; the interval is cleared on connect and on unmount/tab switch
  // (Req 7.7). Keying on `status?.state` keeps the interval stable across polls
  // that don't change the state string.
  const sessionState = status?.state;
  useEffect(() => {
    if (loading) return;
    if (!sessionState || sessionState === "CONNECTED") return;
    const id = window.setInterval(() => {
      void refreshStatus();
    }, pollIntervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [loading, sessionState, pollIntervalMs, refreshStatus]);

  // Final unmount guard so no late async callback touches an unmounted panel.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleSaveConfig() {
    if (!canOperate) return;
    setSavingConfig(true);
    setConfigSuccess("");
    setConfigError("");
    try {
      const result = await saveConfig({
        data: { phoneNumber: phoneNumber.trim(), isEnabled, requestedLocationId },
      });
      if (!mountedRef.current) return;
      if (result.status === "saved") {
        setPhoneNumber(result.config.phoneNumber);
        setIsEnabled(result.config.isEnabled);
        setConfigSuccess("WhatsApp alert settings saved");
      } else {
        // A failed save never reports success and never mutates the prior config;
        // reflect the server-returned prior config so the inputs stay truthful.
        if (result.config) {
          setPhoneNumber(result.config.phoneNumber);
          setIsEnabled(result.config.isEnabled);
        }
        setConfigError(result.message);
      }
    } catch (err) {
      if (mountedRef.current) setConfigError(errorText(err, "Could not save WhatsApp settings"));
    } finally {
      if (mountedRef.current) setSavingConfig(false);
    }
  }

  async function handleInitialize() {
    if (!canOperate) return;
    setPairing(true);
    setConfigError("");
    try {
      const result = await initialize({ data: { requestedLocationId } });
      if (!mountedRef.current) return;
      if (result.status === "error") {
        setConfigError(result.message);
      } else {
        await refreshStatus();
      }
    } catch (err) {
      if (mountedRef.current) setConfigError(errorText(err, "WhatsApp pairing could not be started"));
    } finally {
      if (mountedRef.current) setPairing(false);
    }
  }

  async function handleDisconnect() {
    if (!canOperate) return;
    try {
      const result = await disconnect({ data: { requestedLocationId } });
      if (!mountedRef.current) return;
      if (result.status === "error") {
        showToast?.("error", result.message);
      } else {
        showToast?.("success", "WhatsApp disconnected");
        await refreshStatus();
      }
    } catch (err) {
      if (mountedRef.current) showToast?.("error", errorText(err, "Failed to disconnect"));
    }
  }

  async function handleSendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!canOperate) return;
    setSendingTest(true);
    setTestSuccess("");
    setTestError("");
    try {
      const result = await sendTestMessage({
        data: { phone: testPhone.trim(), body: testBody.trim() || undefined, requestedLocationId },
      });
      if (!mountedRef.current) return;
      if (result.status === "queued") {
        setTestSuccess("Test message queued");
        setTestBody("");
      } else {
        // A failed enqueue reports no success and never mutates alert config.
        setTestError(result.message);
      }
    } catch (err) {
      if (mountedRef.current) setTestError(errorText(err, "Failed to queue test message"));
    } finally {
      if (mountedRef.current) setSendingTest(false);
    }
  }

  if (loading) {
    return (
      <div
        className="flex justify-center py-12"
        role="status"
        aria-live="polite"
        data-testid="whatsapp-loading"
      >
        <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
        <span className="sr-only">Loading WhatsApp settings</span>
      </div>
    );
  }

  if (loadError || !status) {
    return (
      <div
        role="alert"
        data-testid="whatsapp-load-error"
        className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
      >
        <AlertCircle className="h-4 w-4" /> {loadError ?? "Could not load WhatsApp settings"}
      </div>
    );
  }

  const connected = status.state === "CONNECTED";

  return (
    <div className="space-y-5" data-testid="whatsapp-panel">
      <div>
        <h3 className="text-sm font-bold text-zinc-850">WhatsApp alerts</h3>
        <p className="mt-1 text-[10px] font-semibold text-zinc-400">
          Configure WhatsApp device pairing and alert settings for table bookings.
        </p>
      </div>

      {/* Alert config (Req 7.2, 7.3) */}
      <div className={cn(cardClass, "space-y-4")}>
        <div className="flex items-center gap-2 border-b border-zinc-100 pb-2">
          <Smartphone className="h-4 w-4 text-brand" />
          <h5 className="text-xs font-bold text-zinc-800">Alert settings</h5>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-zinc-150 bg-zinc-50/30 p-3">
          <div>
            <p className="text-xs font-bold text-zinc-800">Enable automated alerts</p>
            <p className="mt-0.5 text-[10px] text-zinc-400">
              Send booking confirmations and updates to guests.
            </p>
          </div>
          <input
            type="checkbox"
            aria-label="Enable automated alerts"
            data-testid="whatsapp-enabled"
            checked={isEnabled}
            disabled={!canOperate}
            onChange={(e) => setIsEnabled(e.target.checked)}
          />
        </div>

        <label className="block">
          <span className={labelClass}>WhatsApp alert number</span>
          <input
            type="text"
            aria-label="WhatsApp alert number"
            data-testid="whatsapp-phone"
            placeholder="e.g. 919876543210"
            value={phoneNumber}
            disabled={!canOperate}
            onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ""))}
            className={inputClass}
          />
        </label>

        {configSuccess && (
          <p
            data-testid="whatsapp-config-success"
            className="flex items-center justify-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 p-2.5 text-[10px] font-bold text-emerald-600"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {configSuccess}
          </p>
        )}
        {configError && (
          <p
            data-testid="whatsapp-config-error"
            role="alert"
            className="flex items-center justify-center gap-1 rounded-full border border-red-100 bg-red-50 p-2.5 text-[10px] font-bold text-red-600"
          >
            <AlertCircle className="h-3.5 w-3.5" /> {configError}
          </p>
        )}

        {canOperate && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              data-testid="whatsapp-save"
              onClick={() => void handleSaveConfig()}
              disabled={savingConfig}
              className="flex cursor-pointer items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-xs font-semibold text-white transition-all hover:bg-zinc-850 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingConfig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save alert settings
            </button>
          </div>
        )}
      </div>

      {/* Connection / session status (Req 7.4, 7.5, 7.6, 7.8) */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {connected ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100">
                  <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                </span>
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100">
                  <WifiOff className="h-3.5 w-3.5 text-zinc-400" />
                </span>
              )}
              <div>
                <p
                  data-testid="whatsapp-status"
                  data-state={status.state}
                  className="text-xs font-black leading-none text-zinc-850"
                >
                  {STATE_LABEL[status.state]}
                </p>
                {status.connectedNumber && (
                  <p
                    data-testid="whatsapp-connected-number"
                    className="mt-0.5 text-[10px] font-semibold text-zinc-500"
                  >
                    +{status.connectedNumber}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="whatsapp-refresh"
                aria-label="Refresh status"
                onClick={() => void refreshStatus()}
                title="Refresh status"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-zinc-100 transition-colors hover:bg-zinc-200"
              >
                <RefreshCw className="h-3.5 w-3.5 text-zinc-500" />
              </button>
              {connected && canOperate && (
                <button
                  type="button"
                  data-testid="whatsapp-disconnect"
                  onClick={() => void handleDisconnect()}
                  className="cursor-pointer rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-600 transition-colors hover:bg-red-100"
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>

          {/* Req 7.13 — the strict `ERROR` state surfaces an explicit message. */}
          {status.state === "ERROR" && statusMessage && (
            <p
              data-testid="whatsapp-status-message"
              role="alert"
              className="rounded-xl border border-red-100 bg-red-50 p-3 text-[10px] font-bold text-red-600"
            >
              {statusMessage}
            </p>
          )}

          {/* QR pairing surface — shown while not connected (Req 7.6) */}
          {!connected && (
            <div className="rounded-xl border border-zinc-150 bg-zinc-50 p-4">
              {status.qrDataUrl ? (
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <div className="shrink-0 rounded-xl border border-zinc-200 bg-white p-3">
                    <img
                      data-testid="whatsapp-qr"
                      src={status.qrDataUrl}
                      alt="WhatsApp QR code to scan"
                      className="h-36 w-36 object-contain"
                    />
                  </div>
                  <div className="space-y-2 text-left" data-testid="whatsapp-instructions">
                    <p className="text-xs font-bold text-zinc-800">Scan to connect WhatsApp</p>
                    <ol className="list-decimal space-y-1.5 pl-4 text-[10px] font-semibold leading-relaxed text-zinc-500">
                      <li>Open WhatsApp on your phone</li>
                      <li>
                        Tap <strong>Settings → Linked Devices</strong>
                      </li>
                      <li>
                        Tap <strong>Link a Device</strong>
                      </li>
                      <li>Point your phone camera at the QR code</li>
                    </ol>
                  </div>
                </div>
              ) : (
                <div
                  className="flex items-center gap-3 p-2"
                  data-testid="whatsapp-session-placeholder"
                >
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-zinc-200" />
                  <p className="text-[10px] font-semibold text-zinc-400">
                    {status.state === "ERROR"
                      ? "The WhatsApp session is unavailable."
                      : "Starting WhatsApp browser session..."}
                  </p>
                </div>
              )}

              {/* Disconnected/error accounts with operate may (re-)start pairing. */}
              {canOperate && (status.state === "DISCONNECTED" || status.state === "ERROR") && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    data-testid="whatsapp-initialize"
                    onClick={() => void handleInitialize()}
                    disabled={pairing}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-[10px] font-bold text-white transition-all disabled:opacity-60"
                  >
                    {pairing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                    Connect WhatsApp
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Connected metrics (Req 7.8) */}
          {connected && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-center">
                <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-emerald-500">
                  Queue pending
                </p>
                <p data-testid="whatsapp-queue-count" className="text-xl font-black text-emerald-700">
                  {status.queueCount}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-150 bg-zinc-50 p-3 text-center">
                <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                  Messages sent
                </p>
                <p data-testid="whatsapp-sent-count" className="text-xl font-black text-zinc-800">
                  {status.sentCount}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Test broadcast — only when connected and operate (Req 7.9) */}
      {connected && canOperate && (
        <div className={cn(cardClass, "space-y-3")}>
          <div className="flex items-center gap-2">
            <Send className="h-3.5 w-3.5 text-brand" />
            <h5 className="text-xs font-bold text-zinc-800">Send test notification</h5>
          </div>

          <form onSubmit={(e) => void handleSendTest(e)} className="space-y-3" data-testid="whatsapp-test-form">
            <div className="space-y-1">
              <label className={labelClass} htmlFor="whatsapp-test-phone">
                Recipient number (with country code)
              </label>
              <input
                id="whatsapp-test-phone"
                data-testid="whatsapp-test-phone"
                type="text"
                placeholder="e.g. 919876543210"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value.replace(/\D/g, ""))}
                className={inputClass}
                required
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass} htmlFor="whatsapp-test-body">
                Message
              </label>
              <textarea
                id="whatsapp-test-body"
                data-testid="whatsapp-test-body"
                placeholder="Hello! This is a test notification..."
                value={testBody}
                onChange={(e) => setTestBody(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-xs text-zinc-800 focus:border-brand focus:outline-none"
              />
            </div>
            {testSuccess && (
              <p
                data-testid="whatsapp-test-success"
                className="flex items-center justify-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-[10px] font-bold text-emerald-600"
              >
                <CheckCircle2 className="h-3 w-3" /> {testSuccess}
              </p>
            )}
            {testError && (
              <p
                data-testid="whatsapp-test-error"
                role="alert"
                className="flex items-center justify-center gap-1 rounded-full border border-red-100 bg-red-50 px-4 py-2.5 text-[10px] font-bold text-red-600"
              >
                <AlertCircle className="h-3 w-3" /> {testError}
              </p>
            )}
            <button
              type="submit"
              data-testid="whatsapp-test-submit"
              disabled={sendingTest}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-zinc-950 py-2.5 text-xs font-bold text-white transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              {sendingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Queue message
            </button>
          </form>
        </div>
      )}

      {/* View-only accounts see status but no mutation controls (Req 7.10, 10.10) */}
      {!canOperate && (
        <div
          data-testid="whatsapp-view-only"
          className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-700"
        >
          <AlertCircle className="h-4 w-4" />
          You can view WhatsApp settings but cannot make changes with your current role.
        </div>
      )}
    </div>
  );
}

export default WhatsAppAlertsSettings;
