/**
 * wa-server.cjs
 * Multi-Tenant WhatsApp Web microservice — runs as a plain CJS Node.js process.
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
// State (Multi-Tenant Sessions Map)
// ──────────────────────────────────────────────
// Map<tenantId, SessionState>
// SessionState: { client, state, qrDataUrl, connectedNumber, queue, sentLog, isProcessingQueue, isInitializing, lastActive }
const clients = new Map();

// ──────────────────────────────────────────────
// Initialize WhatsApp Client per Tenant
// ──────────────────────────────────────────────
async function initClient(tenantId, force = false) {
  let session = clients.get(tenantId);
  if (!session) {
    session = {
      client: null,
      state: "DISCONNECTED",
      qrDataUrl: "",
      connectedNumber: "",
      queue: [],
      sentLog: [],
      isProcessingQueue: false,
      isInitializing: false,
      lastActive: Date.now(),
    };
    clients.set(tenantId, session);
  }

  if (session.isInitializing) return;
  if (!force && session.state === "CONNECTED") return;
  if (!force && (session.state === "QR_READY" || session.state === "CONNECTING")) return;

  session.isInitializing = true;
  session.state = "CONNECTING";
  session.qrDataUrl = "";
  session.lastActive = Date.now();
  console.log(`[WA] [${tenantId}] 🚀 Initializing WhatsApp Web Client...`);

  try {
    const sessionDir = path.resolve("./.wwebjs_auth");
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    if (session.client) {
      try { await session.client.destroy(); } catch (_) {}
      session.client = null;
    }

    session.client = new Client({
      authStrategy: new LocalAuth({
        clientId: tenantId,
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

    session.client.on("qr", async (qr) => {
      session.state = "QR_READY";
      session.lastActive = Date.now();
      try {
        session.qrDataUrl = await qrcode.toDataURL(qr);
        console.log(`[WA] [${tenantId}] 📲 QR Code ready — scan with WhatsApp`);
      } catch (e) {
        console.error(`[WA] [${tenantId}] QR generation error:`, e.message);
      }
    });

    session.client.on("ready", () => {
      session.state = "CONNECTED";
      session.qrDataUrl = "";
      session.connectedNumber = session.client.info?.wid?.user || "Connected";
      session.isInitializing = false;
      session.lastActive = Date.now();
      console.log(`[WA] [${tenantId}] ✅ Connected as +` + session.connectedNumber);
      processQueue(tenantId);
    });

    session.client.on("authenticated", () => {
      console.log(`[WA] [${tenantId}] ✅ Authenticated`);
    });

    session.client.on("auth_failure", (msg) => {
      session.state = "ERROR";
      session.isInitializing = false;
      console.error(`[WA] [${tenantId}] ❌ Auth failure:`, msg);
      console.log(`[WA] [${tenantId}] ♻️ Clearing session and retrying in 5 seconds...`);
      setTimeout(() => {
        const sessionDir = path.resolve(`./.wwebjs_auth/session-${tenantId}`);
        if (fs.existsSync(sessionDir)) {
          try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
        }
        initClient(tenantId, true).catch(console.error);
      }, 5000);
    });

    session.client.on("disconnected", (reason) => {
      session.state = "DISCONNECTED";
      session.connectedNumber = "";
      session.qrDataUrl = "";
      session.isInitializing = false;
      console.log(`[WA] [${tenantId}] 🔌 Disconnected:`, reason);
      console.log(`[WA] [${tenantId}] ♻️ Attempting to auto-reconnect in 5 seconds...`);
      setTimeout(() => {
        initClient(tenantId).catch(console.error);
      }, 5000);
    });

    await session.client.initialize();
  } catch (err) {
    session.state = "ERROR";
    session.isInitializing = false;
    console.error(`[WA] [${tenantId}] ❌ Init failed:`, err.message);
    console.log(`[WA] [${tenantId}] ♻️ Retrying initialization in 10 seconds...`);
    setTimeout(() => {
      initClient(tenantId).catch(console.error);
    }, 10000);
  }
}

// ──────────────────────────────────────────────
// Disconnect Tenant Session
// ──────────────────────────────────────────────
async function disconnect(tenantId) {
  console.log(`[WA] [${tenantId}] 🔌 Disconnecting...`);
  const session = clients.get(tenantId);
  if (session) {
    if (session.client) {
      try { await session.client.logout(); } catch (_) {}
      try { await session.client.destroy(); } catch (_) {}
      session.client = null;
    }
    session.state = "DISCONNECTED";
    session.qrDataUrl = "";
    session.connectedNumber = "";
    session.isInitializing = false;
  }

  // Clear session directories
  const sessionDir = path.resolve(`./.wwebjs_auth/session-${tenantId}`);
  if (fs.existsSync(sessionDir)) {
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
    console.log(`[WA] [${tenantId}] Session folder cleared`);
  }
  
  clients.delete(tenantId);
}

// ──────────────────────────────────────────────
// Queue Processor per Tenant (anti-ban: 8–15s between msgs)
// ──────────────────────────────────────────────
async function processQueue(tenantId) {
  const session = clients.get(tenantId);
  if (!session || session.isProcessingQueue || session.queue.length === 0) return;
  session.isProcessingQueue = true;

  while (session.queue.length > 0 && session.state === "CONNECTED") {
    const msg = session.queue[0];
    try {
      await session.client.sendMessage(`${msg.phone}@c.us`, msg.body);
      session.sentLog.unshift({ timestamp: new Date().toISOString(), recipient: msg.phone, message: msg.body, status: "sent" });
      if (session.sentLog.length > 100) session.sentLog.pop();
      session.queue.shift();
      console.log(`[WA] [${tenantId}] ✅ Sent to +` + msg.phone);
    } catch (err) {
      console.error(`[WA] [${tenantId}] ❌ Send failed to +` + msg.phone + ":", err.message);
      msg.retries = (msg.retries || 0) + 1;
      if (msg.retries >= 3) {
        session.sentLog.unshift({ timestamp: new Date().toISOString(), recipient: msg.phone, message: msg.body, status: "failed" });
        session.queue.shift();
      } else {
        session.queue.push(session.queue.shift());
      }
    }
    // Anti-ban delay: 8–15 seconds
    const delay = 8000 + Math.floor(Math.random() * 7000);
    await new Promise((r) => setTimeout(r, delay));
  }
  session.isProcessingQueue = false;
}

// ──────────────────────────────────────────────
// Helper for Request Processing
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
  res.writeHead(status, { 
    "Content-Type": "application/json", 
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(data));
}

// ──────────────────────────────────────────────
// HTTP API Server (port 3001)
// ──────────────────────────────────────────────
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

  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // GET /status?tenantId=...
  if (req.method === "GET" && pathname === "/status") {
    const tenantId = parsedUrl.searchParams.get("tenantId") || "global";
    let session = clients.get(tenantId);
    
    // Lazy load the client status if folder exists on disk and not loaded in memory
    if (!session) {
      const sessionDir = path.resolve(`./.wwebjs_auth/session-${tenantId}`);
      if (fs.existsSync(sessionDir)) {
        console.log(`[WA Status] 🔄 Lazy initializing session on status check for tenant: ${tenantId}`);
        initClient(tenantId).catch(console.error);
        session = clients.get(tenantId);
      }
    }
    
    if (!session) {
      return json(res, {
        state: "DISCONNECTED",
        qrDataUrl: "",
        connectedNumber: "",
        queueCount: 0,
        sentLog: [],
      });
    }
    session.lastActive = Date.now();
    return json(res, {
      state: session.state,
      qrDataUrl: session.qrDataUrl,
      connectedNumber: session.connectedNumber,
      queueCount: session.queue.length,
      sentLog: session.sentLog.slice(0, 50),
    });
  }

  // POST /enqueue  { tenantId, phone, body }
  if (req.method === "POST" && pathname === "/enqueue") {
    const body = await readBody(req);
    const tenantId = body.tenantId || "global";
    if (!body.phone || !body.body) return json(res, { error: "phone and body required" }, 400);
    
    let phone = String(body.phone).replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;

    let session = clients.get(tenantId);
    
    // Lazy load previously-paired sessions if data exists
    if (!session) {
      const sessionDir = path.resolve(`./.wwebjs_auth/session-${tenantId}`);
      if (fs.existsSync(sessionDir)) {
        console.log(`[WA Lazy Load] 🔄 Initializing session on demand for tenant: ${tenantId}`);
        await initClient(tenantId);
        session = clients.get(tenantId);
      }
    }

    if (!session) {
      return json(res, { error: `WhatsApp session not initialized for tenant: ${tenantId}` }, 400);
    }

    session.lastActive = Date.now();
    session.queue.push({ phone, body: body.body, retries: 0 });
    console.log(`[WA] [${tenantId}] 📬 Enqueued for +${phone}. Queue size: ${session.queue.length}`);
    if (session.state === "CONNECTED") processQueue(tenantId);
    return json(res, { success: true, queued: true });
  }

  // POST /disconnect  { tenantId }
  if (req.method === "POST" && pathname === "/disconnect") {
    const body = await readBody(req);
    const tenantId = body.tenantId || "global";
    await disconnect(tenantId);
    return json(res, { success: true });
  }

  // POST /initialize  { tenantId }
  if (req.method === "POST" && pathname === "/initialize") {
    const body = await readBody(req);
    const tenantId = body.tenantId || "global";
    initClient(tenantId, true).catch(console.error);
    return json(res, { success: true, message: `Initialization started for tenant: ${tenantId}` });
  }

  json(res, { error: "Not found" }, 404);
});

// ──────────────────────────────────────────────
// Startup Restoration of Existing Active Sessions
// ──────────────────────────────────────────────
function autoRestoreSessions() {
  const authDir = path.resolve("./.wwebjs_auth");
  if (!fs.existsSync(authDir)) return;

  try {
    const files = fs.readdirSync(authDir);
    for (const file of files) {
      if (file.startsWith("session-")) {
        const tenantId = file.replace("session-", "");
        // Do not restore the legacy name
        if (tenantId && tenantId !== "mediflow-session") {
          console.log(`[WA Startup] 🔄 Restoring active session for tenant: ${tenantId}`);
          initClient(tenantId).catch(err => {
            console.error(`[WA Startup] Failed to restore session for ${tenantId}:`, err.message);
          });
        }
      }
    }
  } catch (err) {
    console.error("[WA Startup] Failed to scan auth directory for restoration:", err.message);
  }
}

// ──────────────────────────────────────────────
// Garbage Collection for Idle QR/Connecting Clients
// ──────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [tenantId, session] of clients.entries()) {
    // Only GC clients that have not paired (QR_READY or CONNECTING) and been idle for > 5 mins
    if (session.state === "QR_READY" || session.state === "CONNECTING") {
      if (now - session.lastActive > 300000) { // 5 minutes
        console.log(`[WA GC] 🧹 Garbage collecting idle session for tenant: ${tenantId}`);
        if (session.client) {
          try { session.client.destroy(); } catch (_) {}
          session.client = null;
        }
        clients.delete(tenantId);
      }
    }
  }
}, 60000); // GC runs every minute

// ──────────────────────────────────────────────
// Periodic Health Check
// ──────────────────────────────────────────────
setInterval(async () => {
  for (const [tenantId, session] of clients.entries()) {
    if (session.state === "CONNECTED" && session.client) {
      try {
        const state = await Promise.race([
          session.client.getState(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000))
        ]);
        console.log(`[WA Health Check] [${tenantId}] Client state is:`, state);
        if (state !== "CONNECTED") {
          console.warn(`[WA Health Check] [${tenantId}] State is not CONNECTED. Re-initializing...`);
          initClient(tenantId, true).catch(console.error);
        }
      } catch (err) {
        console.error(`[WA Health Check Failed] [${tenantId}] Error (hanging or crash):`, err.message);
        initClient(tenantId, true).catch(console.error);
      }
    }
  }
}, 60000);

const PORT = 3001;

server.on("error", (err) => {
  console.error("[WA Server Error] Server crash:", err.message);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("[WA] 🌐 Multi-Tenant WhatsApp microservice listening on http://127.0.0.1:" + PORT);
  // Auto-restore previously active sessions on boot
  autoRestoreSessions();
});
