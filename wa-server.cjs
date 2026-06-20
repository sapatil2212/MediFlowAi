/**
 * wa-server.cjs
 * Standalone WhatsApp Web microservice — runs as a plain CJS Node.js process.
 * The Vite/TanStack SSR process communicates with this via HTTP on port 3001.
 *
 * Start: node wa-server.cjs
 */

const http = require("http");
const qrcode = require("qrcode");
const path = require("path");
const fs = require("fs");
const { Client, LocalAuth } = require("whatsapp-web.js");

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────
let waClient = null;
let waState = "DISCONNECTED"; // DISCONNECTED | CONNECTING | QR_READY | CONNECTED | ERROR
let waQrDataUrl = "";
let waConnectedNumber = "";
let waQueue = []; // { phone, body, retries }
let waSentLog = []; // { timestamp, recipient, message, status }
let isProcessingQueue = false;
let isInitializing = false;

// ──────────────────────────────────────────────
// Initialize WhatsApp Client
// ──────────────────────────────────────────────
async function initClient(force = false) {
  if (isInitializing) return;
  if (!force && waState === "CONNECTED") return;
  if (!force && (waState === "QR_READY" || waState === "CONNECTING")) return;

  isInitializing = true;
  waState = "CONNECTING";
  waQrDataUrl = "";
  console.log("[WA] 🚀 Initializing WhatsApp Web Client...");

  try {
    const sessionDir = path.resolve("./.wwebjs_auth");
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    if (waClient) {
      try { await waClient.destroy(); } catch (_) {}
      waClient = null;
    }

    waClient = new Client({
      authStrategy: new LocalAuth({
        clientId: "mediflow-session",
        dataPath: "./.wwebjs_auth",
      }),
      webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html",
      },
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-gpu",
          "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        ],
      },
    });

    waClient.on("qr", async (qr) => {
      waState = "QR_READY";
      try {
        waQrDataUrl = await qrcode.toDataURL(qr);
        console.log("[WA] 📲 QR Code ready — scan with WhatsApp");
      } catch (e) {
        console.error("[WA] QR generation error:", e.message);
      }
    });

    waClient.on("ready", () => {
      waState = "CONNECTED";
      waQrDataUrl = "";
      waConnectedNumber = waClient.info?.wid?.user || "Connected";
      isInitializing = false;
      console.log("[WA] ✅ Connected as +" + waConnectedNumber);
      processQueue();
    });

    waClient.on("authenticated", () => {
      console.log("[WA] ✅ Authenticated");
    });

    waClient.on("auth_failure", (msg) => {
      waState = "ERROR";
      isInitializing = false;
      console.error("[WA] ❌ Auth failure:", msg);
      console.log("[WA] ♻️ Clearing session and retrying in 5 seconds...");
      setTimeout(() => {
        const sessionDir = path.resolve("./.wwebjs_auth/session-mediflow-session");
        if (fs.existsSync(sessionDir)) {
          try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
        }
        initClient(true).catch(console.error);
      }, 5000);
    });

    waClient.on("disconnected", (reason) => {
      waState = "DISCONNECTED";
      waConnectedNumber = "";
      waQrDataUrl = "";
      isInitializing = false;
      console.log("[WA] 🔌 Disconnected:", reason);
      console.log("[WA] ♻️ Attempting to auto-reconnect in 5 seconds...");
      setTimeout(() => {
        initClient().catch(console.error);
      }, 5000);
    });

    await waClient.initialize();
  } catch (err) {
    waState = "ERROR";
    isInitializing = false;
    console.error("[WA] ❌ Init failed:", err.message);
    console.log("[WA] ♻️ Retrying initialization in 10 seconds...");
    setTimeout(() => {
      initClient().catch(console.error);
    }, 10000);
  }
}

// ──────────────────────────────────────────────
// Disconnect
// ──────────────────────────────────────────────
async function disconnect() {
  console.log("[WA] 🔌 Disconnecting...");
  if (waClient) {
    try { await waClient.logout(); } catch (_) {}
    try { await waClient.destroy(); } catch (_) {}
    waClient = null;
  }
  waState = "DISCONNECTED";
  waQrDataUrl = "";
  waConnectedNumber = "";
  isInitializing = false;

  // Clear session
  const sessionDir = path.resolve("./.wwebjs_auth/session-mediflow-session");
  if (fs.existsSync(sessionDir)) {
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
    console.log("[WA] Session cleared");
  }

  // Re-init for fresh QR
  setTimeout(() => initClient(true), 800);
}

// ──────────────────────────────────────────────
// Queue Processor (anti-ban: 8–15s between msgs)
// ──────────────────────────────────────────────
async function processQueue() {
  if (isProcessingQueue || waQueue.length === 0) return;
  isProcessingQueue = true;

  while (waQueue.length > 0 && waState === "CONNECTED") {
    const msg = waQueue[0];
    try {
      await waClient.sendMessage(`${msg.phone}@c.us`, msg.body);
      waSentLog.unshift({ timestamp: new Date().toISOString(), recipient: msg.phone, message: msg.body, status: "sent" });
      if (waSentLog.length > 100) waSentLog.pop();
      waQueue.shift();
      console.log("[WA] ✅ Sent to +" + msg.phone);
    } catch (err) {
      console.error("[WA] ❌ Send failed to +" + msg.phone + ":", err.message);
      msg.retries = (msg.retries || 0) + 1;
      if (msg.retries >= 3) {
        waSentLog.unshift({ timestamp: new Date().toISOString(), recipient: msg.phone, message: msg.body, status: "failed" });
        waQueue.shift();
      } else {
        waQueue.push(waQueue.shift());
      }
    }
    // Anti-ban delay: 8–15 seconds
    const delay = 8000 + Math.floor(Math.random() * 7000);
    await new Promise((r) => setTimeout(r, delay));
  }
  isProcessingQueue = false;
}

// ──────────────────────────────────────────────
// HTTP API Server (port 3001)
// ──────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { resolve({}); }
    });
    req.on("error", reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = req.url || "/";

  // GET /status
  if (req.method === "GET" && url === "/status") {
    return json(res, {
      state: waState,
      qrDataUrl: waQrDataUrl,
      connectedNumber: waConnectedNumber,
      queueCount: waQueue.length,
      sentLog: waSentLog.slice(0, 50),
    });
  }

  // POST /enqueue  { phone, body }
  if (req.method === "POST" && url === "/enqueue") {
    const body = await readBody(req);
    if (!body.phone || !body.body) return json(res, { error: "phone and body required" }, 400);
    let phone = String(body.phone).replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;
    waQueue.push({ phone, body: body.body, retries: 0 });
    console.log("[WA] 📬 Enqueued for +" + phone + ". Queue:", waQueue.length);
    if (waState === "CONNECTED") processQueue();
    return json(res, { success: true, queued: true });
  }

  // POST /disconnect
  if (req.method === "POST" && url === "/disconnect") {
    await disconnect();
    return json(res, { success: true });
  }

  // POST /initialize
  if (req.method === "POST" && url === "/initialize") {
    initClient(true).catch(console.error);
    return json(res, { success: true, message: "Initialization started" });
  }

  json(res, { error: "Not found" }, 404);
});

// Periodic health check every 60 seconds
setInterval(async () => {
  if (waState === "CONNECTED" && waClient) {
    try {
      const state = await Promise.race([
        waClient.getState(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000))
      ]);
      console.log("[WA] Health Check: Client state is", state);
      if (state !== "CONNECTED") {
        console.warn("[WA] Health Check: State is not CONNECTED. Re-initializing...");
        initClient(true).catch(console.error);
      }
    } catch (err) {
      console.error("[WA] Health Check failed (hanging or error):", err.message);
      initClient(true).catch(console.error);
    }
  }
}, 60000);

const PORT = 3001;

server.on("error", (err) => {
  console.error("[WA] Server error:", err.message);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("[WA] 🌐 WhatsApp microservice listening on http://127.0.0.1:" + PORT);
  // Auto-init on startup
  initClient().catch(console.error);
});
