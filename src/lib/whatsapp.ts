/**
 * src/lib/whatsapp.ts
 * Thin HTTP client for the WhatsApp microservice (wa-server.cjs on port 3001).
 * This file is safe to import in TanStack/Vite SSR — no Puppeteer, no CJS globals.
 */

const WA_BASE = "http://127.0.0.1:3001";

export interface WASentLog {
  timestamp: string;
  recipient: string;
  message: string;
  status: "sent" | "failed";
}

export interface WAStatus {
  state: "DISCONNECTED" | "CONNECTING" | "QR_READY" | "CONNECTED" | "ERROR";
  qrDataUrl: string;
  connectedNumber: string;
  queueCount: number;
  sentLog: WASentLog[];
}

// ── Internal fetch helper ─────────────────────
async function waFetch(path: string, method = "GET", body?: object): Promise<any> {
  const res = await fetch(`${WA_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`WA API ${path} returned ${res.status}`);
  return res.json();
}

// ── Public API ────────────────────────────────

/** Get current connection status, QR code, and outbox log for a tenant */
export async function getWAStatus(tenantId = "global"): Promise<WAStatus> {
  try {
    return await waFetch(`/status?tenantId=${encodeURIComponent(tenantId)}`);
  } catch {
    return { state: "DISCONNECTED", qrDataUrl: "", connectedNumber: "", queueCount: 0, sentLog: [] };
  }
}

/** Enqueue a WhatsApp message for a tenant */
export async function enqueueWA(tenantId: string, phone: string, body: string): Promise<{ success: boolean }>;
export async function enqueueWA(phone: string, body: string): Promise<{ success: boolean }>;
export async function enqueueWA(arg1: string, arg2: string, arg3?: string): Promise<{ success: boolean }> {
  let tenantId = "global";
  let phone = arg1;
  let body = arg2;

  if (arg3 !== undefined) {
    tenantId = arg1;
    phone = arg2;
    body = arg3;
  }

  return waFetch("/enqueue", "POST", { tenantId, phone, body });
}

/** Disconnect a WhatsApp session and regenerate QR for a tenant */
export async function disconnectWA(tenantId = "global"): Promise<{ success: boolean }> {
  return waFetch("/disconnect", "POST", { tenantId });
}

/** Trigger (re-)initialization of the WhatsApp client for a tenant */
export async function initializeWA(tenantId = "global"): Promise<{ success: boolean }> {
  return waFetch("/initialize", "POST", { tenantId });
}

// ── Legacy compat object (used by auth.ts imports) ───
// Keeps backward compat with code that does whatsappService.enqueue(phone, body)
export const whatsappService = {
  get state(): string {
    return "UNKNOWN"; // synchronous state not available; use getWAStatus() instead
  },
  enqueue(phone: string, body: string) {
    enqueueWA("global", phone, body).catch((e) =>
      console.error("[WA Client] Failed to enqueue:", e?.message)
    );
  },
  getStatus: getWAStatus,
  disconnect: disconnectWA,
};

export default whatsappService;

