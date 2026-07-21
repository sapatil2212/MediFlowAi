/**
 * wa-server.cjs
 * Multi-Tenant WhatsApp Web microservice — runs as a plain CJS Node.js process.
 * The Vite/TanStack SSR process communicates with this via HTTP on port 3001.
 *
 * Start: node wa-server.cjs
 */

require("dotenv").config();
const http = require("http");
const qrcode = require("qrcode");
const path = require("path");
const fs = require("fs");
const { Client, LocalAuth } = require("whatsapp-web.js");
const mariadb = require("mariadb");

// Direct MariaDB connection pool for the WhatsApp microservice
let dbPoolInstance = null;
function getDbPool() {
  if (dbPoolInstance) return dbPoolInstance;
  
  let dbHost = process.env.DB_HOST || "localhost";
  let dbPort = parseInt(process.env.DB_PORT || "3306");
  let dbUser = process.env.DB_USER || "root";
  let dbPassword = process.env.DB_PASSWORD || "";
  let dbName = process.env.DB_NAME || "bookmytime";

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && (dbUrl.startsWith("mysql://") || dbUrl.startsWith("mysqls://") || dbUrl.startsWith("mariadb://") || dbUrl.startsWith("mariadbs://"))) {
    try {
      const parsedUrl = new URL(dbUrl);
      dbHost = parsedUrl.hostname;
      dbPort = parsedUrl.port ? parseInt(parsedUrl.port) : 3306;
      dbUser = decodeURIComponent(parsedUrl.username);
      dbPassword = decodeURIComponent(parsedUrl.password);
      dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
    } catch (e) {
      console.error("[WA DB] Failed to parse DATABASE_URL:", e.message);
    }
  }

  const useSsl = dbHost !== "localhost" && dbHost !== "127.0.0.1" && process.env.DB_SSL !== "false";

  dbPoolInstance = mariadb.createPool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 5,
    connectTimeout: 30000,
  });
  return dbPoolInstance;
}

async function dbQuery(sql, params) {
  let conn;
  try {
    conn = await getDbPool().getConnection();
    const rows = await conn.query(sql, params);
    return rows;
  } catch (err) {
    console.error("[WA DB Query Error]", err.message);
    return [];
  } finally {
    if (conn) conn.release();
  }
}

// ──────────────────────────────────────────────
// In-memory Conversation Context (30-min TTL)
// ──────────────────────────────────────────────
const conversationContexts = new Map();
// Key: `${tenantId}:${senderPhone}`
// Value: { messages: [{role, content}], lastActivity: number, senderName: string }

setInterval(() => {
  const now = Date.now();
  for (const [key, ctx] of conversationContexts.entries()) {
    if (now - ctx.lastActivity > 30 * 60 * 1000) {
      conversationContexts.delete(key);
      console.log(`[WA AI] 🗑️ Cleared stale conversation context for: ${key}`);
    }
  }
}, 10 * 60 * 1000);

// ──────────────────────────────────────────────
// AI Helper: Call OpenRouter with Free Models
// ──────────────────────────────────────────────
async function callOpenRouter(systemPrompt, messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const modelsToTry = [
    "google/gemini-2.5-flash",
    "openrouter/free",
    "deepseek/deepseek-r1:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen-2.5-72b-instruct:free"
  ];

  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:8080",
          "X-Title": "HealthSync AI WA Bot"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages
          ],
          max_tokens: 500,
          temperature: 0.7
        })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error("Empty AI response");
        console.log(`[WA AI] ✅ Used model: ${model}`);
        return content.trim();
      } else {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errBody}`);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[WA AI] Model ${model} failed:`, err.message);
    }
  }
  throw lastError || new Error("All AI models failed");
}

// ──────────────────────────────────────────────
// Helper: Get formatted availability for next 5 days
// ──────────────────────────────────────────────
async function getClinicAvailabilityText(tenantId) {
  try {
    const doctors = await dbQuery("SELECT id, name FROM Doctor WHERE tenantId = ? LIMIT 5", [tenantId]);
    if (doctors.length === 0) {
      return "No doctors registered at the clinic yet.";
    }

    const hours = await dbQuery("SELECT dayOfWeek, isClosed FROM ClinicHours WHERE tenantId = ?", [tenantId]);
    const closedDays = new Set(hours.filter(h => h.isClosed === 1 || Number(h.isClosed) === 1).map(h => h.dayOfWeek));

    const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    let text = "";

    for (const doc of doctors) {
      text += `\n*Dr. ${doc.name}* (ID: ${doc.id}):\n`;
      let docAvailabilityCount = 0;

      for (let i = 0; i < 5; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const dayOfWeek = d.getDay();

        if (closedDays.has(dayOfWeek)) continue;

        const dateStr = d.toISOString().split('T')[0];
        
        // Check doctor leave
        const leave = await dbQuery("SELECT id FROM DoctorLeave WHERE doctorId = ? AND leaveDate = ? LIMIT 1", [doc.id, dateStr]);
        if (leave.length > 0) continue;

        const slots = await getAvailableSlots(tenantId, doc.id, dateStr);
        if (slots.length > 0) {
          docAvailabilityCount++;
          // limit slots to first 4 for display
          const displaySlots = slots.slice(0, 4).join(', ');
          const extraCount = slots.length > 4 ? ` (+${slots.length - 4} more)` : "";
          text += `  - ${dateStr} (${weekdays[dayOfWeek]}): ${displaySlots}${extraCount}\n`;
        }
      }
      if (docAvailabilityCount === 0) {
        text += "  No slots available in the next 5 days.\n";
      }
    }
    return text.trim();
  } catch (err) {
    console.error("[WA AI] Error compiling availability text:", err.message);
    return "Error fetching available slots.";
  }
}

// ──────────────────────────────────────────────
// Helper: Fetch Clinic Context from DB
// ──────────────────────────────────────────────
async function getClinicContext(tenantId) {
  try {
    const profiles = await dbQuery(
      "SELECT clinicName, clinicianName, phone, address, shortDescription, services, email, contactNo, whatsappNo, landlineNo FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [tenantId]
    );
    const users = await dbQuery(
      "SELECT name, clinicName, phone FROM User WHERE tenantId = ? LIMIT 1",
      [tenantId]
    );
    const profile = profiles[0] || {};
    const user = users[0] || {};

    const hours = await dbQuery(
      "SELECT dayOfWeek, openTime, closeTime, isClosed FROM ClinicHours WHERE tenantId = ? ORDER BY dayOfWeek",
      [tenantId]
    );
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const hoursStr = hours.length > 0
      ? hours.map(h => `${days[h.dayOfWeek]}: ${h.isClosed ? 'Closed' : `${h.openTime}-${h.closeTime}`}`).join(', ')
      : 'Mon-Sat: 9:00-18:00';

    const doctors = await dbQuery(
      `SELECT d.id, d.name, d.qualifications, dep.name as department 
       FROM Doctor d
       LEFT JOIN Department dep ON d.departmentId = dep.id
       WHERE d.tenantId = ? LIMIT 10`,
      [tenantId]
    );
    const doctorsList = doctors.length > 0
      ? doctors.map(d => `Dr. ${d.name} (${d.qualifications || 'General'}) [ID:${d.id}]`).join('\n')
      : 'General Physician [ID:auto]';

    return {
      clinicName: profile.clinicName || user.clinicName || 'Our Clinic',
      phone: profile.phone || user.phone || '',
      address: profile.address || 'Address not specified',
      email: profile.email || '',
      contactNo: profile.contactNo || '',
      whatsappNo: profile.whatsappNo || '',
      landlineNo: profile.landlineNo || '',
      shortDescription: profile.shortDescription || '',
      services: profile.services || '',
      hoursStr,
      doctors,
      doctorsList
    };
  } catch (err) {
    console.error('[WA AI] Clinic context error:', err.message);
    return { clinicName: 'Our Clinic', phone: '', address: 'Address not specified', email: '', contactNo: '', whatsappNo: '', landlineNo: '', shortDescription: '', services: '', hoursStr: 'Mon-Sat 9AM-6PM', doctors: [], doctorsList: 'General Physician [ID:auto]' };
  }
}

// ──────────────────────────────────────────────
// Helper: Get Available Appointment Slots
// ──────────────────────────────────────────────
async function getAvailableSlots(tenantId, doctorId, dateStr) {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = date.getDay();
    const schedules = await dbQuery(
      "SELECT startTime, endTime, slotDuration FROM DoctorSchedule WHERE doctorId = ? AND dayOfWeek = ? LIMIT 1",
      [doctorId, dayOfWeek]
    );
    if (schedules.length === 0) return [];
    const sched = schedules[0];
    const slotMin = sched.slotDuration || 30;
    let [sh, sm] = sched.startTime.split(':').map(Number);
    let [eh, em] = sched.endTime.split(':').map(Number);
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;
    const slots = [];
    while (cur + slotMin <= end) {
      const h = Math.floor(cur / 60);
      const m = cur % 60;
      slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
      cur += slotMin;
    }
    const booked = await dbQuery(
      `SELECT timeSlot FROM Appointment WHERE tenantId = ? AND doctorId = ? 
       AND DATE(dateTime) = ? AND status != 'Cancelled'`,
      [tenantId, doctorId, dateStr]
    );
    const bookedSet = new Set(booked.map(b => b.timeSlot));
    return slots.filter(s => !bookedSet.has(s));
  } catch (err) {
    console.error('[WA AI] Slots error:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────
// Helper: Book Appointment from WhatsApp
// ──────────────────────────────────────────────
async function bookAppointmentFromWA(tenantId, senderPhone, name, dateStr, timeSlot, doctorId, reason) {
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  let finalDoctorId = (doctorId && doctorId !== 'auto') ? doctorId : null;
  if (!finalDoctorId) {
    const docs = await dbQuery("SELECT id FROM Doctor WHERE tenantId = ? LIMIT 1", [tenantId]);
    if (docs.length > 0) finalDoctorId = docs[0].id;
  } else {
    const docs = await dbQuery("SELECT id FROM Doctor WHERE id = ? AND tenantId = ? LIMIT 1", [finalDoctorId, tenantId]);
    if (docs.length === 0) {
      const fallback = await dbQuery("SELECT id FROM Doctor WHERE tenantId = ? LIMIT 1", [tenantId]);
      finalDoctorId = fallback.length > 0 ? fallback[0].id : null;
    }
  }
  const dateTime = `${dateStr} ${timeSlot}:00`;
  await dbQuery(
    `INSERT INTO Appointment (id, tenantId, name, email, phone, whatsapp, dateTime, timeSlot, doctorId, reason, status, appointmentType)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, 'Pending', 'WhatsApp')`,
    [id, tenantId, name, senderPhone, senderPhone, dateTime, timeSlot, finalDoctorId, reason || 'General Checkup']
  );
  console.log(`[WA AI] ✅ Booked appointment [${id.substring(0,8)}] for ${name} on ${dateStr} at ${timeSlot}`);
  return { id, dateTime, timeSlot };
}

// ──────────────────────────────────────────────
// Helper: Persist Conversation to DB
// ──────────────────────────────────────────────
async function logConversation(tenantId, phone, name, direction, message) {
  const { randomUUID } = require('crypto');
  try {
    await dbQuery(
      `INSERT INTO WAConversation (id, tenantId, senderPhone, senderName, direction, message) VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), tenantId, phone, name || null, direction, message]
    );
  } catch (err) {
    console.error('[WA AI] Log conversation error:', err.message);
  }
}

// ──────────────────────────────────────────────
// Helper: Extract booking entities from chat history
// ──────────────────────────────────────────────
async function extractBookingEntities(tenantId, messages, doctorsList, today) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { date: null, doctorId: null };

  const systemPrompt = `You are a helper that extracts booking details from a chat history.
Today's date is: ${today}

Available Doctors:
${doctorsList}

Analyze the chat history and extract:
1. The preferred appointment date chosen by the user. Convert relative terms (e.g., "tomorrow", "next Monday", "25th", "25 June") to YYYY-MM-DD.
2. The preferred doctor name/ID chosen by the user. If they selected a doctor, match it to their Doctor ID from the list. If they didn't specify or you're unsure, output "auto".

Respond ONLY with a valid JSON object. Do not wrap in markdown code blocks.
Example output:
{
  "date": "2026-06-25",
  "doctorId": "doc-uuid"
}`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8080",
        "X-Title": "HealthSync AI Extractor"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-6)
        ],
        max_tokens: 150,
        temperature: 0.1
      })
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) {
        const cleanContent = content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleanContent);
        return {
          date: parsed.date || null,
          doctorId: parsed.doctorId || null
        };
      }
    }
  } catch (err) {
    console.error("[WA AI] Entity extraction failed:", err.message);
  }
  return { date: null, doctorId: null };
}

// ──────────────────────────────────────────────
// AI Reply Handler (called from message listener)
// ──────────────────────────────────────────────
async function handleAIReply(tenantId, senderPhone, incomingText, session, senderJid) {
  const targetJid = senderJid || `${senderPhone}@c.us`;
  const contextKey = `${tenantId}:${senderPhone}`;
  let ctx = conversationContexts.get(contextKey);
  if (!ctx) {
    ctx = { messages: [], lastActivity: Date.now(), senderName: null };
    conversationContexts.set(contextKey, ctx);
  }
  ctx.lastActivity = Date.now();

  await logConversation(tenantId, senderPhone, ctx.senderName, 'incoming', incomingText);
  ctx.messages.push({ role: 'user', content: incomingText });

  const clinic = await getClinicContext(tenantId);
  const today = new Date().toISOString().split('T')[0];
  
  // Extract selected entities from conversation history using LLM helper
  const entities = await extractBookingEntities(tenantId, ctx.messages, clinic.doctorsList, today);
  
  let targetDoctorId = entities.doctorId;
  let dateSpecificSlotsText = "No date has been chosen yet.";
  if (entities.date) {
    if (targetDoctorId === "auto" || !targetDoctorId) {
      if (clinic.doctors && clinic.doctors.length > 0) {
        targetDoctorId = clinic.doctors[0].id;
      }
    }
    const slots = await getAvailableSlots(tenantId, targetDoctorId, entities.date);
    if (slots && slots.length > 0) {
      dateSpecificSlotsText = `Available slots for ${entities.date} under doctor ID ${targetDoctorId}:\n` + slots.join(', ');
    } else {
      dateSpecificSlotsText = `No slots available for ${entities.date} under doctor ID ${targetDoctorId}. Please request another date.`;
    }
  }

  const systemPrompt = `You are a friendly, professional WhatsApp assistant for *${clinic.clinicName}* medical clinic.

You help patients with:
1. Warm greetings (only if the user message is a simple hello/hi/greeting).
2. Booking clinic appointments.
3. Basic clinic FAQs (doctors, departments, timings, address, contact info, treatments, services).

Clinic Info:
- Name: ${clinic.clinicName}
- Phone: ${clinic.phone}
- Address: ${clinic.address}
- Email: ${clinic.email || 'Not specified'}
- Contact No: ${clinic.contactNo || clinic.phone || 'Not specified'}
- WhatsApp No: ${clinic.whatsappNo || 'Not specified'}
- Landline No: ${clinic.landlineNo || 'Not specified'}
- Hours: ${clinic.hoursStr}
- About Clinic: ${clinic.shortDescription || 'A trusted healthcare provider.'}
- Treatments & Services Offered: ${clinic.services || 'General consultations and primary care.'}

Available Doctors:
${clinic.doctorsList}

Today: ${today}

Current User Selections (from history):
- Selected Date: ${entities.date || 'None'}
- Selected Doctor ID: ${targetDoctorId || 'None'}

Real-time slots for their selected date (if any date has been chosen):
${dateSpecificSlotsText}

APPOINTMENT BOOKING FLOW (Follow strictly):
When a user asks to book an appointment (e.g., "Want to book appointment", "book slot"), guide them through this exact sequence:

Step 1: First Booking Message
Reply ONLY with the personal details form. Do not include any dates, doctors, or slots yet.
🏥 *Book an Appointment Form*
Please copy, fill, and reply with these details:
1. *Full Name*: 
2. *Gender*: [Male/Female/Other]
3. *Phone Number*: 
4. *WhatsApp Number*: 
5. *Reason for Visit*: 

Step 2: Second Booking Message (After they reply with the Step 1 details)
Acknowledge receipt of their details. Do NOT list any pre-defined dates. Instead, ask them to reply with *any* preferred date and choose a preferred doctor from the available doctors list:
- Doctors: [Show the list of Doctors]

Step 3: Third Booking Message (After they select the date and doctor)
Check the "Real-time slots for their selected date" above.
Show the list of available time slots for their selected date and doctor, and ask them to select a preferred time slot.
If the database returned "No slots available", kindly inform them and ask them to choose another date.

Step 4: Fourth Booking Message (After they select the slot)
Show the summary of their selected details and ask for explicit confirmation. Do NOT output the [BOOK:...] tag yet!
Example format to show:
"You've selected [Time] for your appointment with [Doctor Name] on [Date].
Please confirm if these details are correct:
- Name: [Patient Name]
- Doctor: [Doctor Name]
- Date: [Date]
- Time: [Time]
- Reason: [Reason]
Is this correct?"

Step 5: Fifth Booking Message (After they explicitly confirm with "Yes", "Correct", "Ok", or similar)
Once they confirm, output the final confirmation message and append the exact booking marker at the very end of your reply on a new line (use 'auto' for doctorId if unsure or not mapped):
[BOOK:name=FULL_NAME|date=YYYY-MM-DD|time=HH:MM|doctorId=DOCTOR_ID|reason=REASON]

RULES:
- Do not show any time slots until Step 3.
- Do not list a limited set of dates in Step 2; ask the user to choose any date of their choice.
- Never output the [BOOK:...] tag in Step 4. It MUST only be output in Step 5 after the user has explicitly replied confirming the details.
- Always use the exact dates and slots provided in the "Real-time slots for their selected date" section above.
- For clinic FAQs (timings, address, doctors, contact info), check the Clinic Info above and reply directly. Keep replies short (2-4 lines).`;

  let aiReply;
  try {
    aiReply = await callOpenRouter(systemPrompt, ctx.messages.slice(-12));
  } catch (err) {
    console.error(`[WA AI] [${tenantId}] AI call failed:`, err.message);
    aiReply = "I'm sorry, I'm having a technical issue right now. Please call us directly for assistance.";
  }

  // Parse booking marker
  const bookingMatch = aiReply.match(/\[BOOK:name=([^|]+)\|date=([^|]+)\|time=([^|]+)\|doctorId=([^|]+)\|reason=([^\]]+)\]/);
  let bookingConfirmMsg = null;

  if (bookingMatch) {
    const [, name, date, time, doctorId, reason] = bookingMatch;
    try {
      const appt = await bookAppointmentFromWA(
        tenantId, senderPhone,
        name.trim(), date.trim(), time.trim(),
        doctorId.trim(), reason.trim()
      );
      ctx.senderName = name.trim();
      bookingConfirmMsg = `✅ *Appointment Confirmed!*\n\n📅 Date: ${date.trim()}\n⏰ Time: ${time.trim()}\n👤 Name: ${name.trim()}\n📋 Ref: ${appt.id.substring(0,8).toUpperCase()}\n\nPlease arrive 10 minutes early. See you soon! 🏥`;
    } catch (bookErr) {
      console.error(`[WA AI] [${tenantId}] Booking failed:`, bookErr.message);
      bookingConfirmMsg = "I tried to book your appointment but ran into an issue. Please call us directly to confirm your slot.";
    }
  }

  // Strip booking marker from AI reply text
  let cleanReply = aiReply.replace(/\[BOOK:[^\]]+\]/g, '').trim();
  if (!cleanReply && !bookingConfirmMsg) cleanReply = "How can I help you today? 😊";

  if (cleanReply) {
    await session.client.sendMessage(targetJid, cleanReply);
    session.sentLog.unshift({ timestamp: new Date().toISOString(), recipient: senderPhone, message: `[AI] ${cleanReply}`, status: 'sent' });
    if (session.sentLog.length > 100) session.sentLog.pop();
    await logConversation(tenantId, senderPhone, ctx.senderName, 'outgoing', cleanReply);
    ctx.messages.push({ role: 'assistant', content: cleanReply });
  }

  if (bookingConfirmMsg) {
    await new Promise(r => setTimeout(r, 1500));
    await session.client.sendMessage(targetJid, bookingConfirmMsg);
    await logConversation(tenantId, senderPhone, ctx.senderName, 'outgoing', bookingConfirmMsg);
  }

  if (ctx.messages.length > 14) ctx.messages = ctx.messages.slice(-14);
}

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
        dataPath: path.resolve("./.wwebjs_auth"),
      }),
      webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html",
      },
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        // NOTE: do NOT use --single-process or --no-zygote here. On Linux servers
        // those flags break WhatsApp Web's linking handshake and cause the phone
        // to show "Couldn't link device, try again later" when scanning the QR.
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
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

    // Message handler: AI-powered with keyword fallback
    session.client.on("message", async (msg) => {
      try {
        if (msg.fromMe || msg.isGroup || !msg.body || msg.from.includes("@broadcast")) return;
        const sender = msg.from.split("@")[0];
        const incomingText = msg.body.trim();
        
        console.log(`[WA Incoming] [${tenantId}] Received from +${sender}: "${incomingText}"`);

        // Check if AI smart reply is enabled for this tenant
        const configRows = await dbQuery(
          "SELECT aiEnabled FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1",
          [tenantId]
        );
        const aiEnabled = configRows[0]?.aiEnabled === 1 || Number(configRows[0]?.aiEnabled) === 1;

        if (aiEnabled) {
          await handleAIReply(tenantId, sender, incomingText, session, msg.from);
          return;
        }

        // ── Legacy keyword-based auto-reply (fallback when AI is OFF) ──
        const rules = await dbQuery(
          "SELECT * FROM WAAutoReply WHERE tenantId = ? AND isActive = 1 ORDER BY priority DESC, createdAt ASC",
          [tenantId]
        );

        for (const rule of rules) {
          let matched = false;
          const kw = rule.triggerKeyword.toLowerCase().trim();
          const bodyLower = incomingText.toLowerCase();

          if (rule.matchType === "exact" && bodyLower === kw) {
            matched = true;
          } else if (rule.matchType === "contains" && bodyLower.includes(kw)) {
            matched = true;
          } else if (rule.matchType === "startsWith" && bodyLower.startsWith(kw)) {
            matched = true;
          } else if (rule.matchType === "regex") {
            try {
              const regex = new RegExp(rule.triggerKeyword, "i");
              matched = regex.test(incomingText);
            } catch (regErr) {
              console.error(`Invalid regex rule: ${rule.triggerKeyword}`, regErr.message);
            }
          }

          if (matched) {
            console.log(`[WA AutoReply] [${tenantId}] Match found for rule "${rule.triggerKeyword}". Replying with: "${rule.replyMessage}"`);
            await session.client.sendMessage(msg.from, rule.replyMessage);
            session.sentLog.unshift({
              timestamp: new Date().toISOString(),
              recipient: sender,
              message: `[Auto-Reply] ${rule.replyMessage}`,
              status: "sent"
            });
            if (session.sentLog.length > 100) session.sentLog.pop();
            break;
          }
        }
      } catch (err) {
        console.error(`[WA AutoReply Error] [${tenantId}]:`, err.message);
      }
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
// Queue Processor per Tenant (anti-ban: configurable delay with jitter)
// ──────────────────────────────────────────────
async function processQueue(tenantId) {
  const session = clients.get(tenantId);
  if (!session || session.isProcessingQueue || session.queue.length === 0) return;
  session.isProcessingQueue = true;

  while (session.queue.length > 0 && session.state === "CONNECTED") {
    const msg = session.queue[0];
    try {
      if (msg.mediaUrl) {
        const { MessageMedia } = require("whatsapp-web.js");
        const media = await MessageMedia.fromUrl(msg.mediaUrl);
        await session.client.sendMessage(`${msg.phone}@c.us`, media, { caption: msg.body });
      } else {
        await session.client.sendMessage(`${msg.phone}@c.us`, msg.body);
      }

      session.sentLog.unshift({ timestamp: new Date().toISOString(), recipient: msg.phone, message: msg.body, status: "sent" });
      if (session.sentLog.length > 100) session.sentLog.pop();
      session.queue.shift();
      console.log(`[WA] [${tenantId}] ✅ Sent to +` + msg.phone);

      // Update Database for Campaign Recipient
      if (msg.recipientId) {
        await dbQuery("UPDATE WACampaignRecipient SET status = 'sent', sentAt = NOW() WHERE id = ?", [msg.recipientId]);
      }
      if (msg.campaignId) {
        await dbQuery("UPDATE WACampaign SET sentCount = sentCount + 1 WHERE id = ?", [msg.campaignId]);
        
        // Auto-complete campaign status if queue is empty of this campaign
        const remainingInQueue = session.queue.some(item => item.campaignId === msg.campaignId);
        if (!remainingInQueue) {
          const pending = await dbQuery("SELECT COUNT(*) as count FROM WACampaignRecipient WHERE campaignId = ? AND status = 'pending'", [msg.campaignId]);
          const pendingCount = pending[0]?.count || pending[0]?.COUNT || 0;
          if (parseInt(pendingCount) === 0) {
            await dbQuery("UPDATE WACampaign SET status = 'completed', completedAt = NOW() WHERE id = ?", [msg.campaignId]);
            console.log(`[WA] [${tenantId}] Campaign ${msg.campaignId} marked as COMPLETED.`);
          }
        }
      }
    } catch (err) {
      console.error(`[WA] [${tenantId}] ❌ Send failed to +` + msg.phone + ":", err.message);
      msg.retries = (msg.retries || 0) + 1;
      if (msg.retries >= 3) {
        session.sentLog.unshift({ timestamp: new Date().toISOString(), recipient: msg.phone, message: msg.body, status: "failed" });
        session.queue.shift();

        // Update DB as failed
        if (msg.recipientId) {
          await dbQuery("UPDATE WACampaignRecipient SET status = 'failed', errorMsg = ?, sentAt = NOW() WHERE id = ?", [err.message, msg.recipientId]);
        }
        if (msg.campaignId) {
          await dbQuery("UPDATE WACampaign SET failedCount = failedCount + 1 WHERE id = ?", [msg.campaignId]);
          
          const remainingInQueue = session.queue.some(item => item.campaignId === msg.campaignId);
          if (!remainingInQueue) {
            const pending = await dbQuery("SELECT COUNT(*) as count FROM WACampaignRecipient WHERE campaignId = ? AND status = 'pending'", [msg.campaignId]);
            const pendingCount = pending[0]?.count || pending[0]?.COUNT || 0;
            if (parseInt(pendingCount) === 0) {
              await dbQuery("UPDATE WACampaign SET status = 'completed', completedAt = NOW() WHERE id = ?", [msg.campaignId]);
            }
          }
        }
      } else {
        session.queue.push(session.queue.shift());
      }
    }
    
    // Anti-ban delay: randomized delay between minDelay and maxDelay (default 8–15s)
    const minD = msg.minDelay || 8;
    const maxD = msg.maxDelay || 15;
    const delay = (minD * 1000) + Math.floor(Math.random() * ((maxD - minD) * 1000));
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

  // POST /enqueue-bulk { tenantId, campaignId, messages: [{recipientId, phone, body, mediaUrl}], minDelay, maxDelay }
  if (req.method === "POST" && pathname === "/enqueue-bulk") {
    const body = await readBody(req);
    const tenantId = body.tenantId || "global";
    const campaignId = body.campaignId;
    const messages = body.messages || [];
    const minDelay = parseInt(body.minDelay) || 10;
    const maxDelay = parseInt(body.maxDelay) || 25;

    if (!Array.isArray(messages)) return json(res, { error: "messages array required" }, 400);

    let session = clients.get(tenantId);
    if (!session) {
      const sessionDir = path.resolve(`./.wwebjs_auth/session-${tenantId}`);
      if (fs.existsSync(sessionDir)) {
        await initClient(tenantId);
        session = clients.get(tenantId);
      }
    }

    if (!session) {
      return json(res, { error: `WhatsApp session not initialized for tenant: ${tenantId}` }, 400);
    }

    session.lastActive = Date.now();

    for (const msg of messages) {
      let phone = String(msg.phone).replace(/\D/g, "");
      if (phone.length === 10) phone = "91" + phone;

      session.queue.push({
        recipientId: msg.recipientId,
        campaignId,
        phone,
        body: msg.body,
        mediaUrl: msg.mediaUrl,
        minDelay,
        maxDelay,
        retries: 0
      });
    }

    console.log(`[WA] [${tenantId}] 📬 Enqueued bulk of ${messages.length} messages. Queue size: ${session.queue.length}`);
    
    if (campaignId) {
      await dbQuery("UPDATE WACampaign SET status = 'sending', startedAt = NOW() WHERE id = ?", [campaignId]);
    }

    if (session.state === "CONNECTED") processQueue(tenantId);
    return json(res, { success: true, queued: true, count: messages.length });
  }

  // POST /pause-campaign { tenantId, campaignId }
  if (req.method === "POST" && pathname === "/pause-campaign") {
    const body = await readBody(req);
    const tenantId = body.tenantId || "global";
    const campaignId = body.campaignId;

    if (!campaignId) return json(res, { error: "campaignId required" }, 400);

    let session = clients.get(tenantId);
    if (session) {
      session.queue = session.queue.filter(item => item.campaignId !== campaignId);
      console.log(`[WA] [${tenantId}] Paused campaign ${campaignId}. Cleared messages from memory queue.`);
    }

    await dbQuery("UPDATE WACampaign SET status = 'paused' WHERE id = ?", [campaignId]);
    return json(res, { success: true });
  }

  // POST /send-media { tenantId, phone, mediaUrl, caption }
  if (req.method === "POST" && pathname === "/send-media") {
    const body = await readBody(req);
    const tenantId = body.tenantId || "global";
    const phone = body.phone;
    const mediaUrl = body.mediaUrl;
    const caption = body.caption || "";

    if (!phone || !mediaUrl) return json(res, { error: "phone and mediaUrl required" }, 400);

    let targetPhone = String(phone).replace(/\D/g, "");
    if (targetPhone.length === 10) targetPhone = "91" + targetPhone;

    let session = clients.get(tenantId);
    if (!session) {
      const sessionDir = path.resolve(`./.wwebjs_auth/session-${tenantId}`);
      if (fs.existsSync(sessionDir)) {
        await initClient(tenantId);
        session = clients.get(tenantId);
      }
    }

    if (!session) {
      return json(res, { error: `WhatsApp session not initialized for tenant: ${tenantId}` }, 400);
    }

    session.lastActive = Date.now();

    session.queue.push({
      phone: targetPhone,
      body: caption,
      mediaUrl: mediaUrl,
      retries: 0
    });

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
        if (tenantId && tenantId !== "bookmytime-session") {
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

const PORT = parseInt(process.env.WA_PORT || "3001");

server.on("error", (err) => {
  console.error("[WA Server Error] Server crash:", err.message);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("[WA] 🌐 Multi-Tenant WhatsApp microservice listening on http://127.0.0.1:" + PORT);
  // Auto-restore previously active sessions on boot
  autoRestoreSessions();
});

// Graceful shutdown handling to prevent zombie puppeteer chrome processes
async function gracefulShutdown(signal) {
  console.log(`[WA Server] 🛑 Received ${signal}. Cleaning up active WhatsApp sessions...`);
  
  const activeClients = Array.from(clients.entries());
  for (const [tenantId, session] of activeClients) {
    if (session.client) {
      try {
        console.log(`[WA Server] Destroying client for tenant: ${tenantId}`);
        await session.client.destroy();
        console.log(`[WA Server] Client for tenant ${tenantId} destroyed.`);
      } catch (err) {
        console.error(`[WA Server] Error destroying client for ${tenantId}:`, err.message);
      }
    }
  }
  
  console.log("[WA Server] Cleanup complete. Exiting.");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
