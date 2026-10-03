import { createServerFn } from "@tanstack/react-start";
import { verifySession } from "./auth.server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { query, queryOne, execute, withTransaction } from "./db";
import { PROFESSION_RESTAURANT, DEFAULT_SETTINGS } from "./restaurant-availability";
import { DEFAULT_PROFESSION, generateTenantId } from "./tenant-provisioning";
import {
  normalizeBreaks,
  overlapsBreak,
  parseBreaksColumn,
  parseTimeToMinutes,
  resolveBreaks,
  type NormalizedBreak,
} from "./doctor-schedule-breaks";
import {
  buildAppointmentDateFilter,
  buildAppointmentOrderBy,
  buildAppointmentSearch,
  isIsoDate,
  toLocalIsoDate,
} from "./appointment-query";
import {
  emailConflictMessage,
  isDuplicateKeyError,
  isPlausibleEmail,
  normalizeEmail,
  type EmailConflictKind,
} from "./account-email";
import { assertCanPerform, canPerform } from "./staff-permissions";
import { renumberDailyTokens } from "./token.server";
import { sendOtpEmail, sendBillingNotificationEmail } from "./email";

// WhatsApp HTTP client — pure ESM, safe to import (no Puppeteer/CJS globals)
import {
  enqueueWA,
  getWAStatus,
  disconnectWA,
  resetWASession,
  initializeWA,
  enqueueWABulk,
  sendWAMedia,
  pauseWACampaign,
} from "./whatsapp";
import {
  canUseFeature,
  canOperateFeature,
  type AccountContext,
  type AccountRole,
} from "./feature-access";

// Builds the AccountContext consumed by the pure feature-access resolver from a
// verifySession result. Child sessions only exist while active (verifySession
// gates on isActive), so isActive is always true here.
function buildAccountContext(user: any): AccountContext {
  return {
    role: (user.role ?? "admin") as AccountRole,
    // verifySession already resolves this from the PARENT User row for admin,
    // sub-user, and sub-location sessions, so a child account's profession-gated
    // eligibility derives from its tenant owner.
    profession: user.profession,
    subscriptionPlan: user.subscriptionPlan,
    subscriptionStatus: user.subscriptionStatus,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
    isActive: true,
  };
}

// ── Tenant-ownership guards ────────────────────────────────────────────────
// Ids arrive from the client, so every write keyed by a doctor / patient id has
// to prove that id belongs to the caller's workspace first.

async function assertDoctorInTenant(doctorId: unknown, tenantId: string): Promise<void> {
  if (typeof doctorId !== "string" || !doctorId) throw new Error("Doctor ID is required");
  const row = await queryOne<any>("SELECT id FROM Doctor WHERE id = ? AND tenantId = ? LIMIT 1", [
    doctorId,
    tenantId,
  ]);
  if (!row) throw new Error("Doctor not found or unauthorized");
}

/**
 * Resolve a client-supplied patient reference. Clinical screens pass either a
 * Patient id or, for walk-ins with no registry file yet, the Appointment id.
 * Either must belong to the tenant; anything else is refused.
 */
async function assertPatientRefInTenant(patientId: unknown, tenantId: string): Promise<void> {
  if (typeof patientId !== "string" || !patientId) throw new Error("Patient ID is required");
  const patient = await queryOne<any>(
    "SELECT id FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1",
    [patientId, tenantId],
  );
  if (patient) return;
  const apt = await queryOne<any>(
    "SELECT id FROM Appointment WHERE id = ? AND tenantId = ? LIMIT 1",
    [patientId, tenantId],
  );
  if (!apt) throw new Error("Patient not found or unauthorized");
}

/** Statuses an appointment may be set to. Anything else is rejected. */
const APPOINTMENT_STATUSES = new Set([
  "Pending",
  "Scheduled",
  "Confirmed",
  "Completed",
  "Cancelled",
  "No Show",
  "Reschedule Needed",
]);
/** Statuses that no longer occupy the doctor's slot. */
const RELEASED_STATUSES = new Set(["Cancelled", "No Show"]);

/**
 * Another live appointment already holding this doctor's slot, if any.
 * Matches on the slot label when there is one (that is what the slot picker
 * books), otherwise on the exact start time.
 */
async function findSlotConflict(opts: {
  tenantId: string;
  doctorId: string | null;
  dateVal: Date;
  timeSlot: string | null;
  excludeId?: string;
}): Promise<{ id: string; name: string } | null> {
  if (!opts.doctorId) return null;
  const params: any[] = [opts.tenantId, opts.doctorId, opts.dateVal];
  let slotClause: string;
  if (opts.timeSlot) {
    slotClause = "a.timeSlot = ?";
    params.push(opts.timeSlot);
  } else {
    slotClause = "a.dateTime = ?";
    params.push(opts.dateVal);
  }
  params.push(opts.excludeId ?? "");
  const row = await queryOne<any>(
    `SELECT a.id, a.name FROM Appointment a
      WHERE a.tenantId = ? AND a.doctorId = ? AND DATE(a.dateTime) = DATE(?)
        AND ${slotClause}
        AND (a.status IS NULL OR a.status NOT IN ('Cancelled', 'No Show'))
        AND a.id != ?
      LIMIT 1`,
    params,
  );
  return row ? { id: String(row.id), name: String(row.name || "another patient") } : null;
}

/** Escape text before interpolating it into an HTML email body. */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Helper to generate a 4-digit OTP
function generateOtp(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Helper to generate a UUID
function generateId(): string {
  return crypto.randomUUID();
}

export const AI_FALLBACK_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.0-flash-001",
  "google/gemini-2.0-flash-lite-preview-02-05:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "openrouter/free",
];

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 1. Check Email Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const checkEmailServerFn = createServerFn({ method: "POST" })
  .validator((email: string) => {
    if (!email || !email.includes("@")) throw new Error("Invalid email");
    return email;
  })
  .handler(async ({ data: email }) => {
    const existingUser = await queryOne<any>("SELECT id FROM User WHERE email = ? LIMIT 1", [
      email,
    ]);
    return { exists: !!existingUser };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 2. Send OTP Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const sendOtpServerFn = createServerFn({ method: "POST" })
  .validator((email: string) => {
    if (!email || !email.includes("@")) throw new Error("Invalid email");
    return email;
  })
  .handler(async ({ data: email }) => {
    // Check if email already registered
    const existingUser = await queryOne<any>("SELECT id FROM User WHERE email = ? LIMIT 1", [
      email,
    ]);

    if (existingUser) {
      throw new Error("Email already registered");
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    // Clean up previous OTPs for this email
    await execute("DELETE FROM OtpCode WHERE email = ?", [email]);

    // Globally clean up expired OTPs from the database
    await execute("DELETE FROM OtpCode WHERE expiresAt < ?", [new Date()]);

    // Create new OTP
    await execute(
      "INSERT INTO OtpCode (id, email, code, expiresAt, createdAt) VALUES (?, ?, ?, ?, NOW())",
      [generateId(), email, code, expiresAt],
    );

    // Send OTP via email in the background (non-blocking) to optimize performance
    sendOtpEmail(email, code)
      .then(() => {
        console.log(`[OTP] âœ… Verification code sent to ${email}`);
      })
      .catch((err: any) => {
        console.error(`[OTP] âŒ Failed to send email to ${email}:`, err.message);
      });

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 2. Verify OTP Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const sendPasswordResetOtpServerFn = createServerFn({ method: "POST" })
  .validator((email: string) => {
    if (!email || !email.includes("@")) throw new Error("Invalid email");
    return email;
  })
  .handler(async ({ data: email }) => {
    const existingUser = await queryOne<any>("SELECT id FROM User WHERE email = ? LIMIT 1", [
      email,
    ]);

    if (!existingUser) {
      throw new Error("No account found with this email address");
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    // Clean up previous OTPs for this email
    await execute("DELETE FROM OtpCode WHERE email = ?", [email]);

    // Globally clean up expired OTPs from the database
    await execute("DELETE FROM OtpCode WHERE expiresAt < ?", [new Date()]);

    // Create new OTP
    await execute(
      "INSERT INTO OtpCode (id, email, code, expiresAt, createdAt) VALUES (?, ?, ?, ?, NOW())",
      [generateId(), email, code, expiresAt],
    );

    // Send OTP via email in the background (non-blocking) to optimize performance
    sendOtpEmail(email, code)
      .then(() => {
        console.log(`[OTP] Password reset code sent to ${email}`);
      })
      .catch((err: any) => {
        console.error(`[OTP] Failed to send reset email to ${email}:`, err.message);
      });

    return { success: true };
  });

export const verifyOtpServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; code: string }) => {
    if (!data.email || !data.code) throw new Error("Invalid inputs");
    return data;
  })
  .handler(async ({ data }) => {
    // Allow test bypass for development domains
    if (
      data.code === "1234" &&
      (data.email.endsWith("@example.com") || data.email.endsWith("@bookmytime.com"))
    ) {
      return { success: true };
    }

    const validCode = await queryOne<any>(
      "SELECT * FROM OtpCode WHERE email = ? AND code = ? AND expiresAt > ? ORDER BY createdAt DESC LIMIT 1",
      [data.email, data.code, new Date()],
    );

    if (!validCode) {
      throw new Error("Invalid or expired verification code");
    }

    // Clean up all OTPs for this email after successful verification
    await execute("DELETE FROM OtpCode WHERE email = ?", [data.email]);

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 3. Signup Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const signupServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name: string;
      phone: string;
      email: string;
      clinicName: string;
      practiceSize: string;
      password?: string;
      plan?: string;
      profession?: string;
    }) => {
      if (!data.name || !data.phone || !data.email || !data.clinicName || !data.practiceSize) {
        throw new Error("Required fields missing");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    // Check if email already exists
    const existingEmail = await queryOne<any>("SELECT id FROM User WHERE email = ? LIMIT 1", [
      data.email,
    ]);
    if (existingEmail) {
      throw new Error("Email already registered");
    }

    // Check if phone number already exists
    const existingPhone = await queryOne<any>("SELECT id FROM User WHERE phone = ? LIMIT 1", [
      data.phone,
    ]);
    if (existingPhone) {
      throw new Error("Phone number already registered");
    }

    const rawPassword = data.password || "BookMyTime123";
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const userId = generateId();
    const profession = data.profession || DEFAULT_PROFESSION;
    // The profession -> tenantId prefix mapping lives in tenant-provisioning so
    // that this path and custom-plan activation cannot assign different prefixes
    // to the same profession.
    const tenantId = generateTenantId(profession);
    const selectedPlan = data.plan || "Basic";

    const ownerInsertSql = `INSERT INTO User (id, tenantId, name, email, phone, clinicName, practiceSize, password, subscriptionStatus, subscriptionPlan, subscriptionExpiresAt, createdAt, updatedAt, profession)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW(), NOW(), ?)`;
    const ownerInsertParams = [
      userId,
      tenantId,
      data.name,
      data.email,
      data.phone,
      data.clinicName,
      data.practiceSize,
      hashedPassword,
      selectedPlan,
      profession,
    ];

    if (profession === PROFESSION_RESTAURANT) {
      // Restaurant signup: the Owner_Account row (which carries the tenant
      // assignment) and the default Service_Settings row are created in one
      // transaction, so a failure in either step leaves no partially created
      // tenant and surfaces an error to the form (Req 1.5, 1.8).
      await withTransaction(async (conn) => {
        await conn.query(ownerInsertSql, ownerInsertParams);
        await conn.query(
          `INSERT INTO RestaurantSettings (id, tenantId, slotInterval, turnTime, maxPartySize, advanceBookingWindow, minLeadTime, timezone, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            generateId(),
            tenantId,
            DEFAULT_SETTINGS.slotInterval,
            DEFAULT_SETTINGS.turnTime,
            DEFAULT_SETTINGS.maxPartySize,
            DEFAULT_SETTINGS.advanceBookingWindow,
            DEFAULT_SETTINGS.minLeadTime,
            DEFAULT_SETTINGS.timezone,
          ],
        );
      });
    } else {
      await execute(ownerInsertSql, ownerInsertParams);
    }

    // Log initial Active subscription log
    await execute(
      `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
       VALUES (?, ?, 'None', 'Active', 'None', ?, 0.00, 'monthly', NOW(), 'System')`,
      [generateId(), userId, selectedPlan],
    );

    return { success: true, userId };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 4. Login Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** The three independent login sessions, each with its own cookie and table. */
const SESSION_KINDS = {
  owner: { cookie: "session_token", table: "Session" },
  sub: { cookie: "sub_session_token", table: "SubUserSession" },
  location: { cookie: "location_session_token", table: "LocationSession" },
} as const;
type SessionKind = keyof typeof SESSION_KINDS;

/**
 * End every session on this browser except the one about to be issued.
 *
 * verifySession() checks the owner cookie first, then sub-user, then location.
 * Logging in as a receptionist used to set only `sub_session_token`, leaving an
 * admin's `session_token` (e.g. the admin who just created that receptionist,
 * on the same browser) in place — so the reception login landed on the admin
 * dashboard with admin rights. Exactly one session per browser removes that.
 * The old session rows are deleted too, so the tokens are dead, not just hidden.
 */
async function endOtherSessions(keep: SessionKind): Promise<void> {
  const { getCookie, deleteCookie } = await import("@tanstack/react-start/server");
  for (const [kind, { cookie, table }] of Object.entries(SESSION_KINDS)) {
    if (kind === keep) continue;
    const token = getCookie(cookie);
    if (!token) continue;
    try {
      await execute(`DELETE FROM ${table} WHERE token = ?`, [token]);
    } catch (e: any) {
      // Never block a valid login on cleanup; the cookie is still removed below.
      console.error(`[Auth] Failed to revoke ${table} on login:`, e?.message);
    }
    deleteCookie(cookie, { path: "/" });
  }
}

export const loginServerFn = createServerFn({ method: "POST" })
  .validator((data: { username: string; password?: string; rememberMe?: boolean }) => {
    if (!data.username) throw new Error("Username/Email is required");
    return data;
  })
  .handler(async ({ data }) => {
    const rawPassword = data.password || "BookMyTime123";
    const { setCookie } = await import("@tanstack/react-start/server");

    // ── 1. Try main clinic owner (User table) ──
    const user = await queryOne<any>("SELECT * FROM User WHERE email = ? OR phone = ? LIMIT 1", [
      data.username,
      data.username,
    ]);

    if (user) {
      const passwordMatch = await bcrypt.compare(rawPassword, user.password);
      if (!passwordMatch) throw new Error("Incorrect password");

      if (user.subscriptionStatus === "Cancelled") {
        throw new Error(
          "Your clinic account is deactivated. Please contact BookMyTime support at bookmytime1355@gmail.com.",
        );
      }
      if (user.subscriptionExpiresAt) {
        const expiry = new Date(user.subscriptionExpiresAt);
        if (expiry < new Date()) {
          throw new Error(
            "Your subscription or trial period has ended. Please contact support at bookmytime1355@gmail.com to renew.",
          );
        }
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(
        Date.now() + (data.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000),
      );
      await execute(
        "INSERT INTO Session (id, userId, token, expiresAt, createdAt) VALUES (?, ?, ?, ?, NOW())",
        [generateId(), user.id, token, expiresAt],
      );
      await endOtherSessions("owner");
      setCookie("session_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: data.rememberMe ? 30 * 24 * 60 * 60 : undefined,
      });
      // A custom-plan workspace that is provisioned but not yet paid signs in
      // normally but lands on the paywall instead of the dashboard.
      const paymentLocked = user.subscriptionStatus === "PaymentPending";
      return {
        success: true,
        role: "admin",
        redirectTo: paymentLocked ? "/unlock" : "/dashboard",
        paymentLocked,
        user: { id: user.id, name: user.name, email: user.email, clinicName: user.clinicName },
      };
    }

    // ── 2. Try sub-user (SubUser table — reception / doctor) ──
    const subUser = await queryOne<any>(
      "SELECT su.*, u.subscriptionStatus, u.subscriptionExpiresAt FROM SubUser su JOIN User u ON su.tenantId COLLATE utf8mb4_unicode_ci = u.tenantId COLLATE utf8mb4_unicode_ci WHERE su.email COLLATE utf8mb4_unicode_ci = ? OR su.phone COLLATE utf8mb4_unicode_ci = ? LIMIT 1",
      [data.username, data.username],
    );

    if (subUser) {
      if (!subUser.isActive) {
        throw new Error(
          "Your staff account has been deactivated. Please contact your clinic administrator.",
        );
      }
      const passwordMatch = await bcrypt.compare(rawPassword, subUser.password);
      if (!passwordMatch) throw new Error("Incorrect password");

      // Check parent clinic subscription
      if (subUser.subscriptionStatus === "Cancelled") {
        throw new Error("Your clinic account is deactivated. Please contact your clinic admin.");
      }
      if (subUser.subscriptionStatus === "PaymentPending") {
        throw new Error(
          "Your workspace isn't active yet. Please ask the account owner to complete the plan payment.",
        );
      }
      if (subUser.subscriptionExpiresAt) {
        const expiry = new Date(subUser.subscriptionExpiresAt);
        if (expiry < new Date()) {
          throw new Error(
            "Your clinic subscription has expired. Please contact your clinic admin.",
          );
        }
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
      await execute(
        "INSERT INTO SubUserSession (id, subUserId, token, expiresAt) VALUES (?, ?, ?, ?)",
        [crypto.randomUUID(), subUser.id, token, expiresAt],
      );
      await endOtherSessions("sub");
      setCookie("sub_session_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 60 * 60,
      });
      return {
        success: true,
        role: subUser.role, // "reception" | "doctor"
        redirectTo: "/dashboard", // both redirect to clinic dashboard for now
        user: { id: subUser.id, name: subUser.name, email: subUser.email, clinicName: "" },
      };
    }

    // ── 3. Try location login (Location table) ──
    const location = await queryOne<any>(
      `SELECT l.*, u.subscriptionStatus, u.subscriptionExpiresAt
       FROM Location l
       JOIN User u ON l.tenantId COLLATE utf8mb4_unicode_ci = u.tenantId COLLATE utf8mb4_unicode_ci
       WHERE l.email COLLATE utf8mb4_unicode_ci = ?
          OR l.phone COLLATE utf8mb4_unicode_ci = ?
       LIMIT 1`,
      [data.username, data.username],
    );

    if (location) {
      if (!location.isActive) {
        throw new Error(
          "This location account has been deactivated. Please contact your workspace administrator.",
        );
      }
      const passwordMatch = await bcrypt.compare(rawPassword, location.password);
      if (!passwordMatch) throw new Error("Incorrect password");

      // Check parent workspace subscription
      if (location.subscriptionStatus === "Cancelled") {
        throw new Error(
          "Your workspace account is deactivated. Please contact your workspace admin.",
        );
      }
      if (location.subscriptionStatus === "PaymentPending") {
        throw new Error(
          "Your workspace isn't active yet. Please ask the account owner to complete the plan payment.",
        );
      }
      if (location.subscriptionExpiresAt) {
        const expiry = new Date(location.subscriptionExpiresAt);
        if (expiry < new Date()) {
          throw new Error(
            "Your workspace subscription has expired. Please contact your workspace admin.",
          );
        }
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(
        Date.now() + (data.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000),
      );
      await execute(
        "INSERT INTO LocationSession (id, locationId, token, expiresAt) VALUES (?, ?, ?, ?)",
        [crypto.randomUUID(), location.id, token, expiresAt],
      );
      await endOtherSessions("location");
      setCookie("location_session_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: data.rememberMe ? 30 * 24 * 60 * 60 : 8 * 60 * 60,
      });
      return {
        success: true,
        role: "location" as const,
        redirectTo: "/dashboard",
        user: {
          id: location.id,
          name: location.name,
          email: location.email,
          clinicName: location.name,
        },
      };
    }

    // ── 4. Nothing found ──
    throw new Error("No account found with this email or phone number");
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 5. Logout Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const logoutServerFn = createServerFn({ method: "POST" }).handler(async () => {
  const { getCookie, deleteCookie } = await import("@tanstack/react-start/server");
  const token = getCookie("session_token");
  const subToken = getCookie("sub_session_token");
  const locToken = getCookie("location_session_token");

  if (token) {
    await execute("DELETE FROM Session WHERE token = ?", [token]);
    deleteCookie("session_token", {
      path: "/",
    });
  }

  if (subToken) {
    await execute("DELETE FROM SubUserSession WHERE token = ?", [subToken]);
    deleteCookie("sub_session_token", {
      path: "/",
    });
  }

  if (locToken) {
    await execute("DELETE FROM LocationSession WHERE token = ?", [locToken]);
    deleteCookie("location_session_token", {
      path: "/",
    });
  }

  return { success: true };
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 6. Reset Password Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const resetPasswordServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; password?: string }) => {
    if (!data.email) throw new Error("Email is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await queryOne<any>("SELECT id FROM User WHERE email = ? LIMIT 1", [data.email]);

    if (!user) {
      throw new Error("No user registered with this email address");
    }

    const rawPassword = data.password || "BookMyTime123";
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    await execute("UPDATE User SET password = ?, updatedAt = NOW() WHERE email = ?", [
      hashedPassword,
      data.email,
    ]);

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 7. Get Current User Server Function
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const getCurrentUserServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getCookie, deleteCookie } = await import("@tanstack/react-start/server");
  const token = getCookie("session_token");
  const subToken = getCookie("sub_session_token");
  const locToken = getCookie("location_session_token");

  if (!token && !subToken && !locToken) return null;

  const user = await verifySession();
  if (!user) {
    if (token) {
      deleteCookie("session_token", {
        path: "/",
      });
    }
    if (subToken) {
      deleteCookie("sub_session_token", {
        path: "/",
      });
    }
    if (locToken) {
      deleteCookie("location_session_token", {
        path: "/",
      });
    }
    return null;
  }

  // Staff need the plan/status for feature gating, but not the owner's payment
  // details (amount, billing interval, payment method).
  if (!canPerform(user.role, "view_billing")) {
    const { paymentAmount: _a, billingInterval: _b, paymentMethod: _c, ...rest } = user as any;
    return rest as typeof user;
  }
  return user;
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 8. Settings & Profile CRUD Server Functions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getClinicProfileServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");

  const profile = await queryOne<any>("SELECT * FROM ClinicProfile WHERE tenantId = ? LIMIT 1", [
    user.tenantId,
  ]);

  if (profile) return profile;

  // Fallback: no ClinicProfile row yet (newly registered users).
  // Return the registration data stored in the User table so the settings
  // form fields are pre-populated instead of appearing empty.
  const userRow = await queryOne<any>(
    "SELECT name, phone, clinicName, practiceSize, profession FROM User WHERE tenantId = ? LIMIT 1",
    [user.tenantId],
  );
  if (userRow) {
    return {
      clinicianName: userRow.name || "",
      phone: userRow.phone || "",
      clinicName: userRow.clinicName || "",
      practiceSize: userRow.practiceSize || "",
      profession: userRow.profession || "",
    };
  }

  return null;
});

export const updateProfileServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name: string;
      phone: string;
      clinicName: string;
      practiceSize: string;
      address?: string;
      contactDetails?: string;
      shortDescription?: string;
      services?: string;
      email?: string;
      contactNo?: string;
      whatsappNo?: string;
      landlineNo?: string;
      profession?: string;
    }) => {
      if (!data.name || !data.phone || !data.clinicName || !data.practiceSize) {
        throw new Error("Required fields missing");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    // The clinic's identity (name, owner name, phone) belongs to the owner.
    assertCanPerform(user.role, "manage_clinic_profile");

    // A phone already used by ANOTHER workspace's owner. Comparing by tenant
    // (not by user.id) keeps the owner's own number from "conflicting".
    const existingPhoneUser = await queryOne<any>(
      "SELECT id FROM User WHERE phone = ? AND tenantId != ? LIMIT 1",
      [data.phone, user.tenantId],
    );
    if (existingPhoneUser) {
      throw new Error("This phone number is already registered under another account.");
    }

    // Only fields the caller actually sent are updated. The dashboard form
    // sends four fields; the old upsert wrote NULL into every other column and
    // silently erased the clinic's address, services and public contact numbers.
    const optionalKeys = [
      "address",
      "contactDetails",
      "shortDescription",
      "services",
      "email",
      "contactNo",
      "whatsappNo",
      "landlineNo",
    ] as const;
    const insertProfession = data.profession || "Healthcare and medical";

    const updateCols = ["clinicName = ?", "clinicianName = ?", "phone = ?", "practiceSize = ?"];
    const updateParams: any[] = [data.clinicName, data.name, data.phone, data.practiceSize];
    for (const key of optionalKeys) {
      if (data[key] !== undefined) {
        updateCols.push(`${key} = ?`);
        updateParams.push(data[key] || null);
      }
    }
    if (data.profession !== undefined) {
      updateCols.push("profession = ?");
      updateParams.push(insertProfession);
    }

    await execute(
      `INSERT INTO ClinicProfile (id, tenantId, clinicName, clinicianName, phone, practiceSize, address, contactDetails, shortDescription, services, email, contactNo, whatsappNo, landlineNo, profession)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ${updateCols.join(", ")}`,
      [
        generateId(),
        user.tenantId,
        data.clinicName,
        data.name,
        data.phone,
        data.practiceSize,
        ...optionalKeys.map((k) => data[k] || null),
        insertProfession,
        ...updateParams,
      ],
    );

    // Sync to the owner's User row (one per tenant) for session compatibility.
    const userCols = ["name = ?", "phone = ?", "clinicName = ?", "practiceSize = ?"];
    const userParams: any[] = [data.name, data.phone, data.clinicName, data.practiceSize];
    if (data.profession !== undefined) {
      userCols.push("profession = ?");
      userParams.push(insertProfession);
    }
    await execute(`UPDATE User SET ${userCols.join(", ")}, updatedAt = NOW() WHERE tenantId = ?`, [
      ...userParams,
      user.tenantId,
    ]);

    return { success: true };
  });

/** True when any login account other than (table, ownId) already uses `email`. */
async function isLoginEmailTakenByOther(
  email: string,
  table: "User" | "SubUser" | "Location",
  ownId: string,
): Promise<boolean> {
  for (const t of ["User", "SubUser", "Location"] as const) {
    const row = await queryOne<any>(
      `SELECT id FROM ${t} WHERE LOWER(TRIM(email)) = ? ${t === table ? "AND id != ?" : ""} LIMIT 1`,
      t === table ? [email, ownId] : [email],
    );
    if (row) return true;
  }
  return false;
}

/** Which table holds the signed-in account's own row. */
function accountTableFor(role: unknown): "User" | "SubUser" | "Location" {
  if (role === "reception" || role === "doctor") return "SubUser";
  if (role === "location") return "Location";
  return "User";
}

// ~5 MB of image bytes once base64-encoded (4/3 overhead + data-URI prefix).
const MAX_PHOTO_DATA_URI_LENGTH = Math.ceil((5 * 1024 * 1024 * 4) / 3) + 64;

export const uploadProfilePhotoServerFn = createServerFn({ method: "POST" })
  .validator((data: { base64: string; fileName: string; remove?: boolean }) => {
    // Removal is an explicit flag. It used to be sent as base64: "", which
    // this validator rejected, so "Remove" never worked.
    if (data?.remove || data?.fileName === "remove") return { ...data, remove: true };
    if (!data?.base64) throw new Error("No image data provided");
    // Only an inline image may be uploaded — never a remote URL for the
    // server to fetch on the caller's behalf.
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(data.base64)) {
      throw new Error("Please upload a JPEG, PNG or WebP image.");
    }
    if (data.base64.length > MAX_PHOTO_DATA_URI_LENGTH) {
      throw new Error("File too large. Max 5MB.");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    // Staff accounts have their own row; writing to User by a SubUser id
    // matched nothing, so their photo was "saved" and then vanished.
    const table = accountTableFor(user.role);

    if (data.remove) {
      await execute(`UPDATE ${table} SET profilePhoto = NULL WHERE id = ?`, [user.id]);
      return { success: true, url: null as string | null };
    }

    const cloudinary = await import("cloudinary");
    const cloud = cloudinary.v2;
    cloud.config({
      cloud_name: process.env["CLOUDINARY_CLOUD_NAME"],
      api_key: process.env["CLOUDINARY_API_KEY"],
      api_secret: process.env["CLOUDINARY_API_SECRET"],
    });

    const result = await cloud.uploader.upload(data.base64, {
      folder: "bookmytime/profiles",
      public_id: `profile_${user.id}`,
      overwrite: true,
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
    });

    const photoUrl: string | null = result.secure_url;
    await execute(`UPDATE ${table} SET profilePhoto = ? WHERE id = ?`, [photoUrl, user.id]);

    return { success: true, url: photoUrl };
  });

export const updatePasswordServerFn = createServerFn({ method: "POST" })
  .validator((data: { currentPass: string; newPass: string }) => {
    if (!data.currentPass || !data.newPass) {
      throw new Error("Passwords cannot be empty");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    if (data.newPass.length < 8) throw new Error("New password must be at least 8 characters");

    // Owner → User, reception/doctor → SubUser, branch → Location.
    const table = accountTableFor(user.role);
    const row = await queryOne<any>(`SELECT password FROM ${table} WHERE id = ? LIMIT 1`, [
      user.id,
    ]);
    if (!row) throw new Error("User not found");

    const match = await bcrypt.compare(data.currentPass, row.password);
    if (!match) throw new Error("Incorrect current password");

    const hashedNew = await bcrypt.hash(data.newPass, 10);
    await execute(`UPDATE ${table} SET password = ? WHERE id = ?`, [hashedNew, user.id]);
    return { success: true };
  });

export const sendEmailChangeOtpServerFn = createServerFn({ method: "POST" })
  .validator((email: string) => {
    if (!email || !email.includes("@")) throw new Error("Invalid email address");
    return email;
  })
  .handler(async ({ data: rawEmail }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const newEmail = normalizeEmail(rawEmail);
    if (!isPlausibleEmail(newEmail)) throw new Error("Invalid email address");
    // Login resolves emails across owners, staff and branches, so the new
    // address must be free in all three (the caller's own row excepted).
    if (await isLoginEmailTakenByOther(newEmail, accountTableFor(user.role), user.id)) {
      throw new Error("Email already registered by another user");
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    await execute("DELETE FROM OtpCode WHERE email = ?", [newEmail]);
    await execute(
      "INSERT INTO OtpCode (id, email, code, expiresAt, createdAt) VALUES (?, ?, ?, ?, NOW())",
      [crypto.randomUUID(), newEmail, code, expiresAt],
    );

    // Send OTP in background
    sendOtpEmail(newEmail, code).catch((err) => {
      console.error("[Email Change OTP] Background send failed:", err.message);
    });

    return { success: true };
  });

export const updateEmailServerFn = createServerFn({ method: "POST" })
  .validator((data: { newEmail: string; code: string }) => {
    if (!data.newEmail || !data.code) throw new Error("Required verification details missing");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const newEmail = normalizeEmail(data.newEmail);
    const table = accountTableFor(user.role);

    // Verify OTP
    const valid = await queryOne<any>(
      "SELECT id FROM OtpCode WHERE email = ? AND code = ? AND expiresAt > ? LIMIT 1",
      [newEmail, data.code, new Date()],
    );
    if (!valid) throw new Error("Invalid or expired verification code");

    // Re-check: the address may have been taken since the OTP was sent.
    if (await isLoginEmailTakenByOther(newEmail, table, user.id)) {
      throw new Error("Email already registered by another user");
    }

    // Update the caller's own row (User / SubUser / Location by role).
    await execute(`UPDATE ${table} SET email = ? WHERE id = ?`, [newEmail, user.id]);

    // Cleanup OTP
    await execute("DELETE FROM OtpCode WHERE email = ?", [newEmail]);

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 9. Booking & Appointment Server Functions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getClinicByTenantIdServerFn = createServerFn({ method: "GET" })
  .validator((tenantId: string) => {
    if (!tenantId) throw new Error("Tenant ID is required");
    return tenantId;
  })
  .handler(async ({ data: tenantId }) => {
    let clinic = await queryOne<any>(
      "SELECT clinicName, practiceSize FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [tenantId],
    );
    if (!clinic) {
      clinic = await queryOne<any>(
        "SELECT clinicName, practiceSize FROM User WHERE tenantId = ? LIMIT 1",
        [tenantId],
      );
    }
    if (!clinic) throw new Error("Clinic not found");
    return { name: clinic.clinicName, practiceSize: clinic.practiceSize };
  });

export const createAppointmentServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      tenantId: string;
      name: string;
      email?: string;
      phone: string;
      dateTime: string;
      reason: string;
      doctorId?: string;
      timeSlot?: string;
      whatsapp?: string;
      appointmentType?: string;
      patientId?: string | null;
      consultationMode?: string;
    }) => {
      // Email is optional; phone is the required contact channel.
      if (!data.tenantId || !data.name || !data.phone || !data.dateTime || !data.reason) {
        throw new Error("Required booking fields missing");
      }
      return data;
    },
  )
  .handler(async ({ data: input }) => {
    // Staff booking from the dashboard. (The public portal uses
    // createAppointmentPublicServerFn in booking.ts.) This used to run with no
    // session and trust the client's tenantId, so anyone could insert bookings
    // into any clinic and trigger its WhatsApp notifications.
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    const data = { ...input, tenantId: user.tenantId as string };

    if (data.doctorId) await assertDoctorInTenant(data.doctorId, data.tenantId);
    // A patient reference from another workspace is dropped, never linked.
    let linkedPatientId: string | null = null;
    if (data.patientId) {
      const p = await queryOne<any>(
        "SELECT id FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1",
        [data.patientId, data.tenantId],
      );
      linkedPatientId = p ? String(p.id) : null;
    }

    // Plan check: Basic/Solo limit is 500 appointments booked per month.
    const tenant = await queryOne<any>(
      "SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1",
      [data.tenantId],
    );
    const plan = tenant?.subscriptionPlan || "Basic";
    if (plan === "Solo" || plan === "Basic") {
      // Count bookings MADE this month (createdAt), not appointments dated from
      // this month onwards — future-dated bookings were eating the quota.
      const [monthCount] = await query<any>(
        "SELECT COUNT(*) as count FROM Appointment WHERE tenantId = ? AND createdAt >= DATE_FORMAT(NOW(), '%Y-%m-01')",
        [data.tenantId],
      );
      const count = monthCount?.count || monthCount?.COUNT || 0;
      if (Number(count) >= 500) {
        throw new Error(
          "This business has reached the monthly limit of 500 appointments under the Basic plan. Please contact the administrator to upgrade.",
        );
      }
    }

    const id = crypto.randomUUID();
    const dateVal = new Date(data.dateTime);
    const docId = data.doctorId || null;
    const tSlot = data.timeSlot || null;

    // Consultation mode: defaults to in_person; video requires an eligible tenant.
    const { normalizeConsultationMode } = await import("./video-consultation");
    const modeCheck = normalizeConsultationMode(data.consultationMode ?? "in_person");
    if (!modeCheck.ok) throw new Error("Invalid consultation mode");
    const consultationMode = modeCheck.mode;
    if (consultationMode === "video") {
      // Video is clinical staff only (ROLE_PERMISSIONS.video).
      assertCanPerform(user.role, "video");
      const { isTenantVideoEligible } = await import("./video.server");
      if (!(await isTenantVideoEligible(data.tenantId))) {
        throw new Error("Video consultation is not available on this workspace's plan.");
      }
    }

    if (Number.isNaN(dateVal.getTime())) throw new Error("Invalid appointment date");
    // The slot picker only hides taken slots; two receptionists (or a stale
    // list) could still book the same doctor twice. Refuse it here.
    const conflict = await findSlotConflict({
      tenantId: data.tenantId,
      doctorId: docId,
      dateVal,
      timeSlot: tSlot,
    });
    if (conflict) {
      throw new Error(
        `This slot is already booked for ${conflict.name}. Please choose another time.`,
      );
    }

    // Provisional token (MAX + 1) keeps the row valid on insert; the final,
    // time-ordered value is assigned by renumberDailyTokens just below.
    const tokenRow = await queryOne<any>(
      "SELECT COALESCE(MAX(tokenNo), 0) AS maxToken FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = DATE(?)",
      [data.tenantId, dateVal],
    );
    let tokenNo = (Number(tokenRow?.maxToken) || 0) + 1;

    await execute(
      `INSERT INTO Appointment (id, tenantId, name, email, phone, dateTime, reason, status, doctorId, timeSlot, whatsapp, appointmentType, patientId, tokenNo, consultationMode, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        data.tenantId,
        data.name,
        data.email || "",
        data.phone,
        dateVal,
        data.reason,
        docId,
        tSlot,
        data.whatsapp || null,
        data.appointmentType || null,
        linkedPatientId,
        tokenNo,
        consultationMode,
      ],
    );

    // Tokens follow slot time, not booking order: reorder the day then read back
    // this appointment's final token for the confirmation / WhatsApp message.
    // Never let a token-ordering hiccup break the booking or its notification.
    try {
      // This appointment gets its own confirmation below with the fresh token,
      // so it must not also be flagged for a "token changed" correction.
      await renumberDailyTokens(data.tenantId, dateVal, { skipNotifyId: id });
      const finalTok = await queryOne<any>("SELECT tokenNo FROM Appointment WHERE id = ? LIMIT 1", [
        id,
      ]);
      if (finalTok?.tokenNo != null) tokenNo = Number(finalTok.tokenNo);
    } catch (tokErr: any) {
      console.error("[Tokens] Daily renumber failed (booking still succeeds):", tokErr?.message);
    }

    // Queue the "appointment booked" WhatsApp notification (server-side only).
    if (typeof window === "undefined") {
      const { sendAppointmentNotification, resolveClinicName, resolveDoctorName } =
        await import("./appointment-notify");
      const [clinicName, doctorName] = await Promise.all([
        resolveClinicName(data.tenantId),
        resolveDoctorName(docId),
      ]);
      await sendAppointmentNotification(data.tenantId, data.phone, "booked", {
        name: data.name,
        clinicName,
        doctorName,
        dateTime: dateVal,
        timeSlot: tSlot,
        tokenNo,
      });
    }

    // Create the video room + join link when booked as a video consultation (Req 3.3).
    let joinLink: string | null = null;
    if (typeof window === "undefined" && consultationMode === "video") {
      try {
        const { syncVideoRoomForAppointment } = await import("./video.server");
        const synced = await syncVideoRoomForAppointment({
          appointmentId: id,
          tenantId: data.tenantId,
          from: null,
          to: "video",
          notify: true,
        });
        joinLink = synced.joinLink;
      } catch (e: any) {
        console.error("[Video] room sync on create failed:", e?.message);
      }
    }

    return { success: true, appointmentId: id, tokenNo, joinLink, consultationMode };
  });

export const getAppointmentsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");

  const isDoctor = user.role === "doctor" && user.doctorId;
  let sql = `SELECT apt.*, d.name as doctorName
       FROM Appointment apt
       LEFT JOIN Doctor d ON apt.doctorId = d.id
       WHERE apt.tenantId = ?`;
  const params = [user.tenantId];
  if (isDoctor) {
    sql += ` AND apt.doctorId = ?`;
    params.push(user.doctorId);
  }
  sql += ` ORDER BY apt.dateTime ASC`;

  const appointments = await query<any>(sql, params);

  return appointments.map((apt) => ({
    id: apt.id,
    tenantId: apt.tenantId,
    name: apt.name,
    email: apt.email,
    phone: apt.phone,
    dateTime:
      apt.dateTime instanceof Date
        ? apt.dateTime.toISOString()
        : new Date(apt.dateTime).toISOString(),
    reason: apt.reason,
    status: apt.status,
    doctorId: apt.doctorId,
    doctorName: apt.doctorName || "",
    timeSlot: apt.timeSlot,
    whatsapp: apt.whatsapp || "",
    appointmentType: apt.appointmentType || "",
    patientId: apt.patientId || "",
    tokenNo: apt.tokenNo || null,
    consultationMode: apt.consultationMode || "in_person",
    createdAt:
      apt.createdAt instanceof Date
        ? apt.createdAt.toISOString()
        : new Date(apt.createdAt).toISOString(),
  }));
});

// ──────────────────────────────────────────────
// Sub-Location (Multi-Location) Bookings
// Returns bookings made for sub-locations.
//  • Admin: every booking tied to any sub-location (grouped/filterable by location)
//  • Location user: only bookings tied to their own location
// ──────────────────────────────────────────────
export const getSubLocationBookingsServerFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role !== "admin" && user.role !== "location") throw new Error("Unauthorized");

    // Resolve the tenant's locations (for grouping / filter chips + name mapping)
    let locations: any[] = [];
    try {
      locations = await query<any>(
        "SELECT id, name, city, address, isActive FROM Location WHERE tenantId = ? ORDER BY name ASC",
        [user.tenantId],
      );
    } catch {
      locations = [];
    }
    const locMap = new Map<string, any>();
    locations.forEach((l) => locMap.set(l.id, l));

    // Avoid joining the Location table directly (its collation can differ and break the join);
    // location names are mapped in JS from the list fetched above.
    let sql = `SELECT apt.*, d.name as doctorName, dept.name as departmentName
               FROM Appointment apt
               LEFT JOIN Doctor d ON apt.doctorId = d.id
               LEFT JOIN Department dept ON d.departmentId = dept.id
               WHERE apt.tenantId = ? AND apt.locationId IS NOT NULL AND apt.locationId != ''`;
    const params: any[] = [user.tenantId];

    // Location-scoped users only see their own location's bookings
    if (user.role === "location" && user.locationId) {
      sql += ` AND apt.locationId = ?`;
      params.push(user.locationId);
    }
    sql += ` ORDER BY apt.dateTime DESC`;

    let rows: any[] = [];
    try {
      rows = await query<any>(sql, params);
    } catch (e: any) {
      console.error("[DB] getSubLocationBookings failed:", e.message);
      rows = [];
    }

    const bookings = rows.map((apt) => {
      const loc = locMap.get(apt.locationId);
      return {
        id: apt.id,
        name: apt.name,
        email: apt.email,
        phone: apt.phone,
        dateTime:
          apt.dateTime instanceof Date
            ? apt.dateTime.toISOString()
            : new Date(apt.dateTime).toISOString(),
        reason: apt.reason,
        status: apt.status,
        doctorId: apt.doctorId,
        doctorName: apt.doctorName || "",
        departmentName: apt.departmentName || "",
        timeSlot: apt.timeSlot,
        whatsapp: apt.whatsapp || "",
        appointmentType: apt.appointmentType || "",
        tokenNo: apt.tokenNo || null,
        locationId: apt.locationId,
        locationName: loc ? loc.name : "",
        locationCity: loc ? loc.city || "" : "",
        createdAt:
          apt.createdAt instanceof Date
            ? apt.createdAt.toISOString()
            : new Date(apt.createdAt).toISOString(),
      };
    });

    return {
      bookings,
      locations,
      isLocationUser: user.role === "location",
      currentLocationId: (user as any).locationId || null,
    };
  },
);

// Create a booking tied to a sub-location (admin or location-scoped user)
export const createSubLocationBookingServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name: string;
      phone?: string;
      email?: string;
      locationId: string;
      doctorId?: string;
      dateTime: string;
      timeSlot?: string;
      reason: string;
      appointmentType?: string;
      status?: string;
    }) => {
      if (!data.name || !data.dateTime || !data.reason || !data.locationId) {
        throw new Error("Patient name, location, date and reason are required");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role !== "admin" && user.role !== "location") throw new Error("Unauthorized");

    // Location-scoped users can only create bookings for their own location
    const locationId =
      user.role === "location" && user.locationId ? user.locationId : data.locationId;

    // Verify the location belongs to this tenant
    const loc = await queryOne<any>(
      "SELECT id FROM Location WHERE id = ? AND tenantId = ? LIMIT 1",
      [locationId, user.tenantId],
    );
    if (!loc) throw new Error("Invalid location");

    const id = crypto.randomUUID();
    const dateVal = new Date(data.dateTime);
    // Provisional token (MAX + 1); the final, time-ordered value is assigned by
    // renumberDailyTokens just below.
    const tokenRow = await queryOne<any>(
      "SELECT COALESCE(MAX(tokenNo), 0) AS maxToken FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = DATE(?)",
      [user.tenantId, dateVal],
    );
    let tokenNo = (Number(tokenRow?.maxToken) || 0) + 1;
    const status = data.status || "Pending";

    await execute(
      `INSERT INTO Appointment (id, tenantId, name, email, phone, dateTime, reason, status, doctorId, timeSlot, whatsapp, appointmentType, tokenNo, locationId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        user.tenantId,
        data.name,
        data.email || "",
        data.phone || "",
        dateVal,
        data.reason,
        status,
        data.doctorId || null,
        data.timeSlot || null,
        data.phone || null,
        data.appointmentType || null,
        tokenNo,
        locationId,
      ],
    );

    // Tokens follow slot time, not booking order: reorder the day then read back
    // this booking's final token for the WhatsApp message and return value.
    // Never let a token-ordering hiccup break the booking or its notification.
    try {
      // This booking gets its own confirmation below with the fresh token, so it
      // must not also be flagged for a "token changed" correction.
      await renumberDailyTokens(user.tenantId, dateVal, { skipNotifyId: id });
      const finalTok = await queryOne<any>("SELECT tokenNo FROM Appointment WHERE id = ? LIMIT 1", [
        id,
      ]);
      if (finalTok?.tokenNo != null) tokenNo = Number(finalTok.tokenNo);
    } catch (tokErr: any) {
      console.error("[Tokens] Daily renumber failed (booking still succeeds):", tokErr?.message);
    }

    // Queue the "appointment booked" WhatsApp notification.
    if (typeof window === "undefined" && data.phone) {
      const { sendAppointmentNotification, resolveClinicName, resolveDoctorName } =
        await import("./appointment-notify");
      const [clinicName, doctorName] = await Promise.all([
        resolveClinicName(user.tenantId),
        resolveDoctorName(data.doctorId),
      ]);
      await sendAppointmentNotification(user.tenantId, data.phone, "booked", {
        name: data.name,
        clinicName,
        doctorName,
        dateTime: dateVal,
        timeSlot: data.timeSlot || null,
        tokenNo,
      });
    }

    return { success: true, id, tokenNo };
  });

// Update a sub-location booking (lenient on email; preserves/updates locationId)
export const updateSubLocationBookingServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      name?: string;
      phone?: string;
      email?: string;
      locationId?: string;
      doctorId?: string;
      dateTime?: string;
      timeSlot?: string;
      reason?: string;
      appointmentType?: string;
      status?: string;
    }) => {
      if (!data.id) throw new Error("Booking ID is required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role !== "admin" && user.role !== "location") throw new Error("Unauthorized");

    // Ensure the booking belongs to this tenant (and to the location, for location
    // users). Keep its current date so we can renumber the day it leaves.
    let checkSql = "SELECT id, locationId, dateTime FROM Appointment WHERE id = ? AND tenantId = ?";
    const checkParams: any[] = [data.id, user.tenantId];
    if (user.role === "location" && user.locationId) {
      checkSql += " AND locationId = ?";
      checkParams.push(user.locationId);
    }
    checkSql += " LIMIT 1";
    const existing = await queryOne<any>(checkSql, checkParams);
    if (!existing) throw new Error("Booking not found or unauthorized");

    const fields: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined) {
      fields.push("name = ?");
      params.push(data.name);
    }
    if (data.email !== undefined) {
      fields.push("email = ?");
      params.push(data.email || "");
    }
    if (data.phone !== undefined) {
      fields.push("phone = ?");
      params.push(data.phone || "");
    }
    if (data.reason !== undefined) {
      fields.push("reason = ?");
      params.push(data.reason);
    }
    if (data.status !== undefined) {
      fields.push("status = ?");
      params.push(data.status);
    }
    if (data.doctorId !== undefined) {
      fields.push("doctorId = ?");
      params.push(data.doctorId || null);
    }
    if (data.timeSlot !== undefined) {
      fields.push("timeSlot = ?");
      params.push(data.timeSlot || null);
    }
    if (data.appointmentType !== undefined) {
      fields.push("appointmentType = ?");
      params.push(data.appointmentType || null);
    }
    if (data.dateTime !== undefined) {
      fields.push("dateTime = ?");
      params.push(new Date(data.dateTime));
    }
    // Only an admin may move a booking to a different location
    if (data.locationId !== undefined && user.role === "admin") {
      const loc = await queryOne<any>(
        "SELECT id FROM Location WHERE id = ? AND tenantId = ? LIMIT 1",
        [data.locationId, user.tenantId],
      );
      if (loc) {
        fields.push("locationId = ?");
        params.push(data.locationId);
      }
    }

    if (fields.length === 0) return { success: true };
    params.push(data.id, user.tenantId);
    await execute(
      `UPDATE Appointment SET ${fields.join(", ")} WHERE id = ? AND tenantId = ?`,
      params,
    );

    // If the slot moved, renumber the affected day(s) so tokens stay ordered by
    // time (the new day, plus the old day it may have left).
    if (data.dateTime !== undefined) {
      try {
        await renumberDailyTokens(user.tenantId, new Date(data.dateTime));
        if (existing.dateTime) {
          const oldDay = new Date(existing.dateTime).toISOString().slice(0, 10);
          const newDay = new Date(data.dateTime).toISOString().slice(0, 10);
          if (oldDay !== newDay) await renumberDailyTokens(user.tenantId, existing.dateTime);
        }
      } catch (tokErr: any) {
        console.error("[Tokens] Daily renumber failed (update still succeeds):", tokErr?.message);
      }
    }
    return { success: true };
  });

// Delete a sub-location booking
export const deleteSubLocationBookingServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("Booking ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role !== "admin" && user.role !== "location") throw new Error("Unauthorized");

    let sql = "SELECT id, dateTime FROM Appointment WHERE id = ? AND tenantId = ?";
    const params: any[] = [id, user.tenantId];
    if (user.role === "location" && user.locationId) {
      sql += " AND locationId = ?";
      params.push(user.locationId);
    }
    sql += " LIMIT 1";
    const apt = await queryOne<any>(sql, params);
    if (!apt) throw new Error("Booking not found or unauthorized");

    await execute("DELETE FROM Appointment WHERE id = ?", [id]);

    // Close the gap so remaining tokens stay sequential by slot time.
    if (apt.dateTime) {
      try {
        await renumberDailyTokens(user.tenantId, apt.dateTime);
      } catch (tokErr: any) {
        console.error("[Tokens] Daily renumber failed (delete still succeeds):", tokErr?.message);
      }
    }
    return { success: true };
  });

export const updateAppointmentServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      name: string;
      email?: string;
      phone: string;
      dateTime: string;
      reason: string;
      status: string;
      doctorId?: string;
      timeSlot?: string;
      whatsapp?: string;
      appointmentType?: string;
      patientId?: string | null;
      consultationMode?: string;
    }) => {
      // Email is optional; phone is the required contact channel.
      if (!data.id || !data.name || !data.phone || !data.dateTime || !data.reason || !data.status) {
        throw new Error("Required fields missing");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    // Verify appointment belongs to the same tenantId
    const existingApt = await queryOne<any>(
      `SELECT id, dateTime, tokenNo, consultationMode, status, doctorId, timeSlot,
              whatsapp, appointmentType, patientId
         FROM Appointment WHERE id = ? AND tenantId = ? LIMIT 1`,
      [data.id, user.tenantId],
    );
    if (!existingApt) throw new Error("Appointment not found or unauthorized");

    // New statuses must be known ones; re-saving a row with its existing
    // status is always allowed (data also holds e.g. restaurant "Seated").
    if (
      !APPOINTMENT_STATUSES.has(data.status) &&
      data.status !== String(existingApt.status || "")
    ) {
      throw new Error("Invalid appointment status");
    }

    const dateVal = new Date(data.dateTime);
    if (Number.isNaN(dateVal.getTime())) throw new Error("Invalid appointment date");
    const docId = data.doctorId || null;
    const tSlot = data.timeSlot || null;
    if (docId && docId !== existingApt.doctorId) await assertDoctorInTenant(docId, user.tenantId);

    // Omitted fields keep their stored value. Callers that send a partial
    // payload (calendar drag-and-drop, quick status change) used to null out
    // the WhatsApp number, visit type and patient link on every save.
    const whatsappVal =
      data.whatsapp !== undefined ? data.whatsapp || null : (existingApt.whatsapp ?? null);
    const appointmentTypeVal =
      data.appointmentType !== undefined
        ? data.appointmentType || null
        : (existingApt.appointmentType ?? null);
    let patientIdVal: string | null = existingApt.patientId ?? null;
    if (data.patientId !== undefined) {
      patientIdVal = null;
      if (data.patientId) {
        const p = await queryOne<any>(
          "SELECT id FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1",
          [data.patientId, user.tenantId],
        );
        patientIdVal = p ? String(p.id) : (existingApt.patientId ?? null);
      }
    }

    const prevStatus = String(existingApt.status || "");
    const statusChanged = data.status !== prevStatus;
    const prevDate =
      existingApt.dateTime instanceof Date ? existingApt.dateTime : new Date(existingApt.dateTime);
    const slotMoved =
      docId !== (existingApt.doctorId || null) ||
      tSlot !== (existingApt.timeSlot || null) ||
      prevDate.getTime() !== dateVal.getTime();
    const reactivated = RELEASED_STATUSES.has(prevStatus) && !RELEASED_STATUSES.has(data.status);
    // Only check when the booking moves or comes back to life, so editing an
    // existing (possibly legacy double-booked) appointment's notes still works.
    if (!RELEASED_STATUSES.has(data.status) && (slotMoved || reactivated)) {
      const conflict = await findSlotConflict({
        tenantId: user.tenantId,
        doctorId: docId,
        dateVal,
        timeSlot: tSlot,
        excludeId: data.id,
      });
      if (conflict) {
        throw new Error(
          `This slot is already booked for ${conflict.name}. Please choose another time.`,
        );
      }
    }

    // Resolve the target consultation mode (Req 3.5). When omitted, preserve the
    // existing mode rather than silently reverting to in_person.
    const { normalizeConsultationMode } = await import("./video-consultation");
    const prevMode = existingApt.consultationMode === "video" ? "video" : "in_person";
    let consultationMode: "in_person" | "video" = prevMode;
    if (data.consultationMode !== undefined) {
      const modeCheck = normalizeConsultationMode(data.consultationMode);
      if (!modeCheck.ok) throw new Error("Invalid consultation mode");
      consultationMode = modeCheck.mode;
    }
    if (consultationMode === "video" && prevMode !== "video") {
      assertCanPerform(user.role, "video");
      const { isTenantVideoEligible } = await import("./video.server");
      if (!(await isTenantVideoEligible(user.tenantId))) {
        throw new Error("Video consultation is not available on this workspace's plan.");
      }
    }
    // Cancelling the appointment also cancels a video room.
    const effectiveMode = data.status === "Cancelled" ? "in_person" : consultationMode;

    // Token bookkeeping. Tokens follow slot time, so any change to the date OR
    // the time within a day can reshuffle the sequence. We keep a provisional
    // value for the UPDATE below (a fresh MAX+1 when the date moved, otherwise
    // the existing token) and then renumber both affected days afterwards.
    const oldDate = prevDate;
    // Local calendar days, matching DATE(dateTime). UTC slicing misread IST
    // appointments before 05:30 as being on the previous day.
    const oldDateStr = toLocalIsoDate(oldDate);
    const newDateStr = toLocalIsoDate(dateVal);
    let tokenNo = existingApt.tokenNo;

    if (oldDateStr !== newDateStr) {
      const tokenRow = await queryOne<any>(
        "SELECT COALESCE(MAX(tokenNo), 0) AS maxToken FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = DATE(?) AND id != ?",
        [user.tenantId, dateVal, data.id],
      );
      tokenNo = (Number(tokenRow?.maxToken) || 0) + 1;
    }

    await execute(
      `UPDATE Appointment SET name = ?, email = ?, phone = ?, dateTime = ?, reason = ?, status = ?, doctorId = ?, timeSlot = ?, whatsapp = ?, appointmentType = ?, patientId = ?, tokenNo = ?, consultationMode = ? WHERE id = ?`,
      [
        data.name,
        data.email || "",
        data.phone,
        dateVal,
        data.reason,
        data.status,
        docId,
        tSlot,
        whatsappVal,
        appointmentTypeVal,
        patientIdVal,
        tokenNo,
        consultationMode,
        data.id,
      ],
    );

    // Reorder tokens by slot time for the affected day(s). A time-only change
    // still reshuffles the current day; a date move also re-tightens the day it
    // left. Then read back this appointment's final token for the notification.
    // Never let a token-ordering hiccup break the update or its notification.
    try {
      // When this update also sends its own status message (below), that message
      // already carries the fresh token — so don't queue a separate correction
      // for it. A status-less change (e.g. time only) sends nothing, so in that
      // case the row is left eligible for a token correction.
      const sendsOwnStatusMessage =
        statusChanged && ["Confirmed", "Cancelled", "Completed"].includes(data.status);
      const renumberOpts = sendsOwnStatusMessage ? { skipNotifyId: data.id } : {};
      await renumberDailyTokens(user.tenantId, dateVal, renumberOpts);
      if (oldDateStr !== newDateStr) {
        await renumberDailyTokens(user.tenantId, oldDate, renumberOpts);
      }
      const finalTok = await queryOne<any>("SELECT tokenNo FROM Appointment WHERE id = ? LIMIT 1", [
        data.id,
      ]);
      if (finalTok?.tokenNo != null) tokenNo = Number(finalTok.tokenNo);
    } catch (tokErr: any) {
      console.error("[Tokens] Daily renumber failed (update still succeeds):", tokErr?.message);
    }

    // Queue WhatsApp notification for status change (confirmed / cancelled / completed).
    if (typeof window === "undefined") {
      const kindMap: Record<string, "confirmed" | "cancelled" | "completed" | undefined> = {
        Confirmed: "confirmed",
        Cancelled: "cancelled",
        Completed: "completed",
      };
      // Only on an actual status change: re-saving a confirmed booking (edit
      // notes, drag to a new time) used to re-send "confirmed" every time.
      const kind = statusChanged ? kindMap[data.status] : undefined;
      if (kind) {
        const { sendAppointmentNotification, resolveClinicName, resolveDoctorName } =
          await import("./appointment-notify");
        const [clinicName, doctorName] = await Promise.all([
          resolveClinicName(user.tenantId),
          resolveDoctorName(docId),
        ]);
        await sendAppointmentNotification(user.tenantId, data.phone, kind, {
          name: data.name,
          clinicName,
          doctorName,
          dateTime: dateVal,
          timeSlot: tSlot,
          tokenNo,
        });
      }

      // Sync the video room to the (effective) consultation mode. Cancelling the
      // appointment forces the room to cancel; switching to in_person cancels it;
      // switching to video creates it. Never blocks the appointment write (Req 3.6-3.8).
      try {
        const { syncVideoRoomForAppointment, refreshRoomWindow } = await import("./video.server");
        await syncVideoRoomForAppointment({
          appointmentId: data.id,
          tenantId: user.tenantId,
          from: prevMode,
          to: effectiveMode,
          notify: true,
        });
        // Keep the join window honest if the appointment was rescheduled.
        if (effectiveMode === "video") {
          await refreshRoomWindow(data.id, user.tenantId);
        }
      } catch (e: any) {
        console.error("[Video] room sync on update failed:", e?.message);
      }
    }

    return { success: true };
  });

export const deleteAppointmentServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    // Verify appointment belongs to the same tenantId (keep its date so we can
    // re-tighten that day's token sequence after removal).
    const apt = await queryOne<any>(
      "SELECT id, dateTime FROM Appointment WHERE id = ? AND tenantId = ? LIMIT 1",
      [id, user.tenantId],
    );
    if (!apt) throw new Error("Appointment not found or unauthorized");

    await execute("DELETE FROM Appointment WHERE id = ?", [id]);

    // Close the gap left behind so remaining tokens stay sequential by slot time.
    if (apt.dateTime) {
      try {
        await renumberDailyTokens(user.tenantId, apt.dateTime);
      } catch (tokErr: any) {
        console.error("[Tokens] Daily renumber failed (delete still succeeds):", tokErr?.message);
      }
    }

    return { success: true };
  });

/**
 * Deletes several appointments in one request (multi-select in the dashboard).
 *
 * Tenant scoping is enforced in SQL rather than trusted from the client: ids
 * belonging to another tenant simply do not match and are reported back as not
 * deleted. Each calendar day touched by the deletion is renumbered once (not
 * once per row) so the remaining tokens stay sequential by slot time.
 */
export const deleteAppointmentsBulkServerFn = createServerFn({ method: "POST" })
  .validator((data: { ids: string[] }) => {
    if (!data || !Array.isArray(data.ids) || data.ids.length === 0) {
      throw new Error("At least one appointment must be selected");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    // De-duplicate so a repeated id cannot inflate the reported count.
    const requestedIds = Array.from(new Set(data.ids.map((id) => String(id))));
    const placeholders = requestedIds.map(() => "?").join(", ");

    // Read the owned rows first so we know which days need renumbering after
    // the delete, and so foreign/unknown ids are excluded up front.
    const owned = await query<any>(
      `SELECT id, dateTime FROM Appointment WHERE tenantId = ? AND id IN (${placeholders})`,
      [user.tenantId, ...requestedIds],
    );
    if (owned.length === 0) return { success: true, deleted: 0 };

    const ownedIds = owned.map((row: any) => String(row.id));
    const ownedPlaceholders = ownedIds.map(() => "?").join(", ");
    await execute(`DELETE FROM Appointment WHERE tenantId = ? AND id IN (${ownedPlaceholders})`, [
      user.tenantId,
      ...ownedIds,
    ]);

    // Collapse the affected dates so a multi-row delete on one day renumbers once.
    const affectedDays = new Set<string>();
    for (const row of owned) {
      if (!row.dateTime) continue;
      const d = new Date(row.dateTime);
      if (!Number.isNaN(d.getTime())) affectedDays.add(d.toISOString().slice(0, 10));
    }
    for (const day of affectedDays) {
      try {
        await renumberDailyTokens(user.tenantId, day);
      } catch (tokErr: any) {
        console.error("[Tokens] Daily renumber failed (delete still succeeds):", tokErr?.message);
      }
    }

    return { success: true, deleted: ownedIds.length };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Clinic Timetable Settings Server Functions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getClinicHoursServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");

  const hours = await query<any>(
    "SELECT * FROM ClinicHours WHERE tenantId = ? ORDER BY dayOfWeek ASC",
    [user.tenantId],
  );

  return hours.map((h) => ({
    id: h.id,
    tenantId: h.tenantId,
    dayOfWeek: h.dayOfWeek,
    openTime: h.openTime,
    closeTime: h.closeTime,
    isClosed: !!h.isClosed,
  }));
});

export const saveClinicHoursServerFn = createServerFn({ method: "POST" })
  .validator(
    (
      data: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }>,
    ) => {
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_clinic_config");

    if (!Array.isArray(data)) throw new Error("Invalid working hours");
    const seen = new Set<number>();
    const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const h of data) {
      const day = Number(h?.dayOfWeek);
      if (!Number.isInteger(day) || day < 0 || day > 6 || seen.has(day)) {
        throw new Error("Invalid or duplicate day in working hours");
      }
      seen.add(day);
      if (h.isClosed) continue;
      const open = parseTimeToMinutes(h.openTime);
      const close = parseTimeToMinutes(h.closeTime);
      if (open === null || close === null) throw new Error(`Enter valid times for ${DAY[day]}`);
      // An inverted range generates zero booking slots for that day.
      if (close <= open) throw new Error(`${DAY[day]}: closing time must be after opening time`);
    }

    for (const h of data) {
      await execute(
        `INSERT INTO ClinicHours (id, tenantId, dayOfWeek, openTime, closeTime, isClosed)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE openTime = ?, closeTime = ?, isClosed = ?`,
        [
          crypto.randomUUID(),
          user.tenantId,
          h.dayOfWeek,
          h.openTime,
          h.closeTime,
          h.isClosed ? 1 : 0,
          h.openTime,
          h.closeTime,
          h.isClosed ? 1 : 0,
        ],
      );
    }
    return { success: true };
  });

// ──────────────────────────────────────────────
// Departments Settings Server Functions
// ──────────────────────────────────────────────

export const getDepartmentsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");

  const list = await query<any>("SELECT * FROM Department WHERE tenantId = ? ORDER BY name ASC", [
    user.tenantId,
  ]);
  return list;
});

export const createDepartmentServerFn = createServerFn({ method: "POST" })
  .validator((name: string) => {
    if (!name) throw new Error("Name is required");
    return name;
  })
  .handler(async ({ data: rawName }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_clinic_config");

    const name = String(rawName ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name) throw new Error("Name is required");
    if (name.length > 100) throw new Error("Department name is too long");
    const dup = await queryOne<any>(
      "SELECT id FROM Department WHERE tenantId = ? AND LOWER(name) = LOWER(?) LIMIT 1",
      [user.tenantId, name],
    );
    if (dup) throw new Error(`A department named "${name}" already exists`);

    await execute("INSERT INTO Department (id, tenantId, name) VALUES (?, ?, ?)", [
      crypto.randomUUID(),
      user.tenantId,
      name,
    ]);
    return { success: true };
  });

export const deleteDepartmentServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_clinic_config");

    // Doctors keep their departmentId, so deleting an in-use department left
    // them pointing at nothing (blank department everywhere, incl. booking).
    const [inUse] = await query<any>(
      "SELECT COUNT(*) AS n FROM Doctor WHERE tenantId = ? AND departmentId = ?",
      [user.tenantId, id],
    );
    const n = Number(inUse?.n || 0);
    if (n > 0) {
      throw new Error(
        `This department has ${n} doctor${n === 1 ? "" : "s"} assigned. Move them to another department first.`,
      );
    }

    await execute("DELETE FROM Department WHERE id = ? AND tenantId = ?", [id, user.tenantId]);
    return { success: true };
  });

// ──────────────────────────────────────────────
// Doctors Management Server Functions
// ──────────────────────────────────────────────

export const getDoctorsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");

  const doctors = await query<any>(
    `SELECT d.*, dept.name as departmentName
       FROM Doctor d
       LEFT JOIN Department dept ON d.departmentId = dept.id
       WHERE d.tenantId = ?
       ORDER BY d.name ASC`,
    [user.tenantId],
  );

  return doctors;
});

export const saveDoctorServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id?: string;
      name: string;
      email: string;
      phone: string;
      qualifications: string;
      departmentId: string;
      designation?: string;
      employeeId?: string;
      joiningDate?: string;
      subjectsTaught?: string;
    }) => {
      if (!data.name || !data.email || !data.phone || !data.qualifications || !data.departmentId) {
        throw new Error("Missing required fields");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_clinic_config");

    const dept = await queryOne<any>(
      "SELECT id FROM Department WHERE id = ? AND tenantId = ? LIMIT 1",
      [data.departmentId, user.tenantId],
    );
    if (!dept) throw new Error("Please choose a valid department");

    // Plan check: Basic/Solo limit is 1 doctor profile in directory
    if (!data.id) {
      const tenant = await queryOne<any>(
        "SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1",
        [user.tenantId],
      );
      const plan = tenant?.subscriptionPlan || "Basic";
      if (plan === "Solo" || plan === "Basic") {
        const [docsCount] = await query<any>(
          "SELECT COUNT(*) as count FROM Doctor WHERE tenantId = ?",
          [user.tenantId],
        );
        const count = docsCount?.count || docsCount?.COUNT || 0;
        if (Number(count) >= 1) {
          throw new Error(
            "Your current plan (Basic) only allows 1 Doctor Profile. Please upgrade your plan to add more doctors to the directory.",
          );
        }
      }
    }

    if (data.id) {
      await execute(
        `UPDATE Doctor SET name = ?, email = ?, phone = ?, qualifications = ?, departmentId = ?, designation = ?, employeeId = ?, joiningDate = ?, subjectsTaught = ?
         WHERE id = ? AND tenantId = ?`,
        [
          data.name,
          data.email,
          data.phone,
          data.qualifications,
          data.departmentId,
          data.designation || null,
          data.employeeId || null,
          data.joiningDate || null,
          data.subjectsTaught || null,
          data.id,
          user.tenantId,
        ],
      );
      return { success: true, doctorId: data.id };
    } else {
      const id = crypto.randomUUID();
      await execute(
        `INSERT INTO Doctor (id, tenantId, name, email, phone, qualifications, departmentId, designation, employeeId, joiningDate, subjectsTaught)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          user.tenantId,
          data.name,
          data.email,
          data.phone,
          data.qualifications,
          data.departmentId,
          data.designation || null,
          data.employeeId || null,
          data.joiningDate || null,
          data.subjectsTaught || null,
        ],
      );

      // Auto-create default DoctorSchedule entries (Mon–Sat) so that the
      // doctor is immediately bookable on the public booking portal.
      // If ClinicHours are configured for the tenant we use those times;
      // otherwise fall back to sensible defaults (09:00–17:00, 30-min slots).
      try {
        const clinicHoursRows = await query<any>(
          "SELECT dayOfWeek, openTime, closeTime, isClosed FROM ClinicHours WHERE tenantId = ? ORDER BY dayOfWeek ASC",
          [user.tenantId],
        );
        const clinicHoursMap = new Map<number, any>();
        for (const ch of clinicHoursRows) {
          clinicHoursMap.set(ch.dayOfWeek, ch);
        }

        // Days 1-6 = Mon-Sat (skip Sunday = 0 by default)
        for (let day = 0; day <= 6; day++) {
          const ch = clinicHoursMap.get(day);

          // If ClinicHours marks this day as closed, skip it
          if (ch && ch.isClosed) continue;

          // Default: skip Sunday if no ClinicHours override says it's open
          if (day === 0 && !ch) continue;

          const startTime = ch?.openTime || "09:00";
          const endTime = ch?.closeTime || "17:00";

          await execute(
            `INSERT INTO DoctorSchedule (id, doctorId, dayOfWeek, startTime, endTime, slotDuration, breaks)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE startTime = VALUES(startTime), endTime = VALUES(endTime)`,
            [crypto.randomUUID(), id, day, startTime, endTime, 30, "[]"],
          );
        }
      } catch (schedErr: any) {
        // Non-fatal: doctor is still created; schedule can be set manually
        console.error("[Doctor] Failed to auto-create default schedule:", schedErr.message);
      }

      return { success: true, doctorId: id };
    }
  });

export const deleteDoctorServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_clinic_config");

    const doc = await queryOne("SELECT id FROM Doctor WHERE id = ? AND tenantId = ? LIMIT 1", [
      id,
      user.tenantId,
    ]);
    if (!doc) throw new Error("Doctor not found or unauthorized");

    await withTransaction(async (conn) => {
      await conn.query("DELETE FROM DoctorSchedule WHERE doctorId = ?", [id]);
      await conn.query("DELETE FROM DoctorLeave WHERE doctorId = ?", [id]);
      await conn.query("DELETE FROM Doctor WHERE id = ? AND tenantId = ?", [id, user.tenantId]);
    });
    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Doctor schedules & leaves server functions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getDoctorScheduleServerFn = createServerFn({ method: "GET" })
  .validator((doctorId: string) => {
    if (!doctorId) throw new Error("Doctor ID is required");
    return doctorId;
  })
  .handler(async ({ data: doctorId }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    await assertDoctorInTenant(doctorId, user.tenantId);

    const schedules = await query<any>(
      "SELECT * FROM DoctorSchedule WHERE doctorId = ? ORDER BY dayOfWeek ASC",
      [doctorId],
    );
    return schedules.map((s) => ({
      id: s.id,
      doctorId: s.doctorId,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      slotDuration: s.slotDuration,
      breaks: parseBreaksColumn(s.breaks),
    }));
  });

export const saveDoctorScheduleServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      doctorId: string;
      schedules: Array<{
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        slotDuration: number;
        breaks?: Array<{ start: string; end: string; label: string }>;
      }>;
    }) => {
      if (!data.doctorId || !data.schedules) throw new Error("Required parameters missing");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_doctor_availability");
    // Without this, any signed-in user could wipe another clinic's schedule.
    await assertDoctorInTenant(data.doctorId, user.tenantId);
    if (!Array.isArray(data.schedules)) throw new Error("Invalid schedule");

    const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const seen = new Set<number>();
    const rows = data.schedules.map((s) => {
      const day = Number(s?.dayOfWeek);
      if (!Number.isInteger(day) || day < 0 || day > 6 || seen.has(day)) {
        throw new Error("Invalid or duplicate day in schedule");
      }
      seen.add(day);
      const start = parseTimeToMinutes(s.startTime);
      const end = parseTimeToMinutes(s.endTime);
      if (start === null || end === null) throw new Error(`Enter valid times for ${DAY[day]}`);
      if (end <= start) throw new Error(`${DAY[day]}: end time must be after start time`);
      const slot = Math.round(Number(s.slotDuration) || 30);
      if (slot < 5 || slot > 240) throw new Error(`${DAY[day]}: slot length must be 5–240 minutes`);
      // Drop malformed / inverted breaks. A well-formed break outside the
      // working window is kept: it is harmless (removes no slot) and the
      // editor already flags it as "outside hours".
      const validBreaks = (Array.isArray(s.breaks) ? s.breaks : []).filter(
        (b) => normalizeBreaks([b]).length === 1,
      );
      return {
        day,
        startTime: s.startTime,
        endTime: s.endTime,
        slot,
        breaksJson: JSON.stringify(validBreaks),
      };
    });

    // Atomic: a failure mid-way used to leave the doctor with no schedule at all.
    await withTransaction(async (conn) => {
      await conn.query("DELETE FROM DoctorSchedule WHERE doctorId = ?", [data.doctorId]);
      for (const r of rows) {
        await conn.query(
          `INSERT INTO DoctorSchedule (id, doctorId, dayOfWeek, startTime, endTime, slotDuration, breaks)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), data.doctorId, r.day, r.startTime, r.endTime, r.slot, r.breaksJson],
        );
      }
    });
    return { success: true };
  });

export const getDoctorLeavesServerFn = createServerFn({ method: "GET" })
  .validator((doctorId: string) => {
    if (!doctorId) throw new Error("Doctor ID is required");
    return doctorId;
  })
  .handler(async ({ data: doctorId }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    await assertDoctorInTenant(doctorId, user.tenantId);

    const leaves = await query<any>(
      "SELECT * FROM DoctorLeave WHERE doctorId = ? ORDER BY leaveDate ASC",
      [doctorId],
    );

    // Normalize date to exact YYYY-MM-DD without UTC conversion shifting local midnight
    const normalizeDateToYMD = (val: any): string => {
      if (!val) return "";
      if (typeof val === "string") return val.slice(0, 10);
      if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, "0");
        const d = String(val.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
      return String(val).slice(0, 10);
    };

    return leaves.map((l) => ({
      id: l.id,
      doctorId: l.doctorId,
      leaveDate: normalizeDateToYMD(l.leaveDate),
      reason: l.reason,
      isHoliday: !!l.isHoliday,
    }));
  });

export const addDoctorLeaveServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: { doctorId: string; leaveDate: string; reason: string; isHoliday?: boolean }) => {
      if (!data.doctorId || !data.leaveDate) throw new Error("Required leave details missing");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_doctor_availability");
    await assertDoctorInTenant(data.doctorId, user.tenantId);

    const id = crypto.randomUUID();
    const dateStr = typeof data.leaveDate === "string" ? data.leaveDate.slice(0, 10) : "";
    if (!isIsoDate(dateStr)) throw new Error("Invalid leave date");

    await execute(
      `INSERT INTO DoctorLeave (id, doctorId, leaveDate, reason, isHoliday)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = ?, isHoliday = ?`,
      [
        id,
        data.doctorId,
        dateStr,
        data.reason || "Scheduled Leave",
        data.isHoliday ? 1 : 0,
        data.reason || "Scheduled Leave",
        data.isHoliday ? 1 : 0,
      ],
    );
    return { success: true };
  });

export const addDoctorLeavesBulkServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: { doctorId: string; leaveDates: string[]; reason: string; isHoliday?: boolean }) => {
      if (!data.doctorId || !data.leaveDates || data.leaveDates.length === 0) {
        throw new Error("Doctor ID and leave dates are required");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_doctor_availability");
    await assertDoctorInTenant(data.doctorId, user.tenantId);

    let count = 0;
    for (const raw of data.leaveDates) {
      const dateStr = typeof raw === "string" ? raw.slice(0, 10) : "";
      if (!isIsoDate(dateStr)) continue;
      const id = crypto.randomUUID();
      await execute(
        `INSERT INTO DoctorLeave (id, doctorId, leaveDate, reason, isHoliday)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE reason = ?, isHoliday = ?`,
        [
          id,
          data.doctorId,
          dateStr,
          data.reason || "Scheduled Leave",
          data.isHoliday ? 1 : 0,
          data.reason || "Scheduled Leave",
          data.isHoliday ? 1 : 0,
        ],
      );
      count++;
    }
    return { success: true, count };
  });

export const deleteDoctorLeaveServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_doctor_availability");

    // Scoped to the caller's doctors (COLLATE: these id columns can carry
    // mismatched collations in this database, see account-lifecycle.ts).
    await execute(
      `DELETE FROM DoctorLeave WHERE id = ?
         AND doctorId COLLATE utf8mb4_unicode_ci IN
             (SELECT id COLLATE utf8mb4_unicode_ci FROM Doctor WHERE tenantId = ?)`,
      [id, user.tenantId],
    );
    return { success: true };
  });

export const deleteDoctorLeavesBulkServerFn = createServerFn({ method: "POST" })
  .validator((ids: string[]) => {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new Error("At least one leave ID is required");
    }
    return ids;
  })
  .handler(async ({ data: ids }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_doctor_availability");

    const placeholders = ids.map(() => "?").join(",");
    const res: any = await execute(
      `DELETE FROM DoctorLeave WHERE id IN (${placeholders})
         AND doctorId COLLATE utf8mb4_unicode_ci IN
             (SELECT id COLLATE utf8mb4_unicode_ci FROM Doctor WHERE tenantId = ?)`,
      [...ids, user.tenantId],
    );
    const affected = Number(res?.affectedRows ?? ids.length);
    return { success: true, count: affected };
  });

// ──────────────────────────────────────────────
// Doctor Smart Clinical Analysis & Monthly Audit Report
// ──────────────────────────────────────────────

export const getDoctorSmartAnalysisServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: { doctorId: string; period?: "day" | "week" | "month" | "year"; dateStr?: string }) => {
      if (!data.doctorId) throw new Error("Doctor ID is required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const { getDoctorSmartAnalysisData } = await import("./doctor-report.server");
    const result = await getDoctorSmartAnalysisData({
      tenantId: user.tenantId,
      doctorId: data.doctorId,
      period: data.period || "month",
      dateStr: data.dateStr,
    });
    return result;
  });

export const sendDoctorMonthlyReportEmailServerFn = createServerFn({ method: "POST" })
  .validator((data: { doctorId: string; monthDateStr?: string; overrideRecipient?: string }) => {
    if (!data.doctorId) throw new Error("Doctor ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    await assertDoctorInTenant(data.doctorId, user.tenantId);
    // The report contains patient names, phones and emails. Only the owner may
    // redirect it to an arbitrary address; everyone else sends to the doctor /
    // clinic on file (the dashboard never passes an override anyway).
    const override =
      user.role === "admin" && data.overrideRecipient
        ? normalizeEmail(data.overrideRecipient)
        : undefined;
    if (override !== undefined && !isPlausibleEmail(override)) {
      throw new Error("Please provide a valid recipient email.");
    }

    const { sendDoctorMonthlyReportEmail } = await import("./doctor-report.server");
    const res = await sendDoctorMonthlyReportEmail({
      tenantId: user.tenantId,
      doctorId: data.doctorId,
      monthDateStr: data.monthDateStr,
      overrideRecipient: override,
    });
    return res;
  });

// ──────────────────────────────────────────────
// Doctor Emergency Leave & AI Patient WhatsApp Broadcast
// ──────────────────────────────────────────────

export const getDoctorAffectedAppointmentsServerFn = createServerFn({ method: "POST" })
  .validator((data: { doctorId: string; dates: string[] }) => {
    if (!data.doctorId) throw new Error("Doctor ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    if (!data.dates || data.dates.length === 0) {
      return { appointments: [] };
    }

    const placeholders = data.dates.map(() => "?").join(",");
    const appts = await query<any>(
      `SELECT id, name, phone, dateTime, timeSlot, reason, status, tokenNo
       FROM Appointment
       WHERE tenantId = ?
         AND doctorId = ?
         AND DATE(dateTime) IN (${placeholders})
         AND (status IS NULL OR status NOT IN ('Cancelled', 'No Show', 'Completed'))
       ORDER BY dateTime ASC`,
      [user.tenantId, data.doctorId, ...data.dates],
    );

    return {
      appointments: appts.map((a: any) => ({
        id: a.id,
        name: a.name,
        phone: a.phone,
        dateTime:
          a.dateTime instanceof Date
            ? a.dateTime.toISOString()
            : new Date(a.dateTime).toISOString(),
        timeSlot: a.timeSlot || "",
        reason: a.reason || "",
        status: a.status || "Pending",
        tokenNo: a.tokenNo ?? null,
      })),
    };
  });

export const generateDoctorLeaveWaMessageServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      doctorName: string;
      leaveDates: string[];
      reason: string;
      clinicName?: string;
      tone?: "empathetic" | "urgent" | "reassuring";
    }) => {
      if (!data.doctorName || !data.leaveDates || data.leaveDates.length === 0) {
        throw new Error("Doctor name and at least one leave date required.");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const apiKey = process.env.OPENROUTER_API_KEY;
    const formattedDates = data.leaveDates
      .map((d) => {
        try {
          return new Date(d).toLocaleDateString("en-IN", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
        } catch {
          return d;
        }
      })
      .join(", ");

    const systemPrompt = `You are a medical clinic communications assistant writing a WhatsApp message for patients.
The patient has a confirmed appointment, but *Dr. ${data.doctorName}* at *${data.clinicName || "our clinic"}* is on urgent/emergency leave on ${formattedDates} due to: "${data.reason || "an unforeseen medical/personal emergency"}".

Write a warm, empathetic, clear WhatsApp broadcast notification.
Requirements:
1. Use WhatsApp styling (*bold* for clinic & doctor name, dates, times).
2. Use EXACT placeholders:
   - {{patient_name}} for patient's name
   - {{appointment_date}} for their appointment date
   - {{appointment_time}} for their scheduled time
3. Express genuine regret and explain the urgent unavailability respectfully.
4. Provide immediate reassurance: explain that our care desk will prioritize rescheduling them to the next earliest slot or offer an immediate alternate doctor.
5. Invite them to reply to this WhatsApp message to reschedule or ask questions.
6. Tone: ${data.tone || "empathetic"}.
7. Keep length between 70 to 120 words. Concise, respectful, highly professional.
8. Output ONLY the message text. Do not wrap in markdown quotes or code fences.`;

    if (apiKey) {
      for (const model of AI_FALLBACK_MODELS) {
        try {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "http://localhost:8080",
              "X-Title": "HealthSync AI",
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "system", content: systemPrompt }],
              max_tokens: 350,
              temperature: 0.6,
            }),
          });
          if (response.ok) {
            const jsonRes = await response.json();
            const text = jsonRes.choices?.[0]?.message?.content?.trim();
            if (text) {
              return { success: true, message: text, source: "ai", model };
            }
          }
        } catch (err: any) {
          console.warn(`[AI Leave WA] Model ${model} error:`, err?.message);
        }
      }
    }

    // High quality deterministic fallback template:
    const fallback = `Hello *{{patient_name}}*,\n\nWe regret to inform you that *Dr. ${data.doctorName}* at *${data.clinicName || "our clinic"}* has an unexpected emergency (${data.reason || "Urgent Absence"}) and will be unavailable on *{{appointment_date}}*.\n\nYour appointment scheduled at *{{appointment_time}}* is placed on priority reschedule. We sincerely apologize for this inconvenience.\n\nOur clinic team will contact you shortly with alternate priority slots, or you can reply directly to this WhatsApp message to pick a convenient time or consult with an alternate doctor.\n\nWarm regards,\n*${data.clinicName || "Clinic Care Team"}*`;

    return { success: true, message: fallback, source: "template" };
  });

export const processDoctorEmergencyLeaveServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      doctorId: string;
      leaveDates: string[];
      reason: string;
      customMessage?: string;
      selectedAppointmentIds?: string[];
    }) => {
      if (!data.doctorId || !data.leaveDates || data.leaveDates.length === 0) {
        throw new Error("Doctor ID and leave dates are required");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_doctor_availability");
    // Front desk records the leave AND notifies the booked patients. Messages go
    // through the clinic's own session (enqueueWA by tenantId) — the number the
    // owner connected — so reception needs no WhatsApp admin rights for this.
    const canSendWA = canPerform(user.role, "send_patient_notices");
    data.leaveDates = data.leaveDates.map((d) => String(d).slice(0, 10)).filter(isIsoDate);
    if (data.leaveDates.length === 0) throw new Error("Please select valid leave dates");

    // 1. Fetch Doctor details
    const doc = await queryOne<any>(
      "SELECT id, name, phone, email FROM Doctor WHERE id = ? AND tenantId = ? LIMIT 1",
      [data.doctorId, user.tenantId],
    );
    if (!doc) throw new Error("Doctor not found or unauthorized");

    // 2. Fetch Clinic Profile details
    const clinicProfile = await queryOne<any>(
      "SELECT clinicName, clinicianName, phone FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [user.tenantId],
    );
    const clinicName = clinicProfile?.clinicName || user.clinicName || "HealthSync Clinic";

    // 3. Insert leaves for each selected date
    let leavesCreated = 0;
    for (const dateStr of data.leaveDates) {
      const id = crypto.randomUUID();
      const ymd = typeof dateStr === "string" ? dateStr.slice(0, 10) : "";
      if (!ymd) continue;
      await execute(
        `INSERT INTO DoctorLeave (id, doctorId, leaveDate, reason, isHoliday)
         VALUES (?, ?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE reason = ?, isHoliday = 0`,
        [
          id,
          data.doctorId,
          ymd,
          data.reason || "Emergency Leave",
          data.reason || "Emergency Leave",
        ],
      );
      leavesCreated++;
    }

    // 4. Query all affected appointments
    const placeholders = data.leaveDates.map(() => "?").join(",");
    const appts = await query<any>(
      `SELECT id, name, phone, dateTime, timeSlot, reason, status, tokenNo
       FROM Appointment
       WHERE tenantId = ?
         AND doctorId = ?
         AND DATE(dateTime) IN (${placeholders})
         AND (status IS NULL OR status NOT IN ('Cancelled', 'No Show', 'Completed'))
       ORDER BY dateTime ASC`,
      [user.tenantId, data.doctorId, ...data.leaveDates],
    );

    // An explicit list (even an empty one) is honoured. Empty used to mean
    // "everyone", so unticking every patient messaged and flagged all of them.
    const targetAppts = Array.isArray(data.selectedAppointmentIds)
      ? appts.filter((a: any) => data.selectedAppointmentIds!.includes(a.id))
      : appts;

    // 5. Send personalized WhatsApp messages
    const template =
      data.customMessage ||
      `Hello *{{patient_name}}*,\n\nWe regret to inform you that *Dr. ${doc.name}* at *${clinicName}* has an unexpected emergency (${data.reason || "Urgent Absence"}) and will be unavailable on *{{appointment_date}}*.\n\nYour appointment scheduled at *{{appointment_time}}* has been placed on priority reschedule. We sincerely apologize for this inconvenience.\n\nOur team will reach out with priority slots, or you can reply to this message to reschedule.\n\nWarm regards,\n*${clinicName}*`;

    const notifiedPatients: Array<{
      id: string;
      name: string;
      phone: string;
      date: string;
      time: string;
      status: "sent" | "failed" | "skipped";
    }> = [];

    for (const apt of targetAppts) {
      const aptDate = apt.dateTime instanceof Date ? apt.dateTime : new Date(apt.dateTime);
      const dateFormatted = aptDate.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const timeFormatted =
        apt.timeSlot ||
        aptDate.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        });

      const personalizedMessage = template
        .replace(/{{patient_name}}/g, apt.name || "Patient")
        .replace(/{{doctor_name}}/g, doc.name)
        .replace(/{{appointment_date}}/g, dateFormatted)
        .replace(/{{appointment_time}}/g, timeFormatted)
        .replace(/{{reason}}/g, data.reason || "Emergency Absence")
        .replace(/{{clinic_name}}/g, clinicName);

      let sendStatus: "sent" | "failed" | "skipped" = "skipped";

      if (apt.phone && canSendWA) {
        try {
          const res = await enqueueWA(user.tenantId, apt.phone, personalizedMessage);
          sendStatus = res.success ? "sent" : "failed";
        } catch (err: any) {
          console.error(`[Emergency Leave WA] Failed for ${apt.phone}:`, err?.message);
          sendStatus = "failed";
        }
      }

      // Mark appointment as 'Reschedule Needed'
      try {
        await execute(
          `UPDATE Appointment 
           SET status = 'Reschedule Needed',
               reason = CONCAT(COALESCE(reason, ''), ' [Urgent Leave: ', ?, ']')
           WHERE id = ? AND tenantId = ?`,
          [data.reason || "Emergency Leave", apt.id, user.tenantId],
        );
      } catch (err: any) {
        console.warn(`[Emergency Leave Appt Update] Failed:`, err?.message);
      }

      notifiedPatients.push({
        id: apt.id,
        name: apt.name,
        phone: apt.phone,
        date: dateFormatted,
        time: timeFormatted,
        status: sendStatus,
      });
    }

    return {
      success: true,
      leavesCreated,
      affectedAppointmentsCount: appts.length,
      notifiedPatientsCount: notifiedPatients.filter((p) => p.status === "sent").length,
      whatsappSkippedForRole: !canSendWA,
      patients: notifiedPatients,
    };
  });

export const getDoctorScheduledLeavesServerFn = createServerFn({ method: "POST" })
  .validator((data: { doctorId: string }) => {
    if (!data.doctorId) throw new Error("Doctor ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    await assertDoctorInTenant(data.doctorId, user.tenantId);

    const leaves = await query<any>(
      `SELECT dl.id, dl.doctorId, dl.leaveDate, dl.reason, dl.isHoliday,
              (SELECT COUNT(*) FROM Appointment a 
               WHERE a.tenantId = ? 
                 AND a.doctorId = dl.doctorId 
                 AND DATE(a.dateTime) = DATE(dl.leaveDate)
                 AND (a.status = 'Reschedule Needed' OR a.status NOT IN ('Cancelled', 'No Show', 'Completed'))) as affectedCount
       FROM DoctorLeave dl
       WHERE dl.doctorId = ?
       ORDER BY dl.leaveDate ASC`,
      [user.tenantId, data.doctorId],
    );

    return leaves.map((l) => ({
      id: l.id,
      doctorId: l.doctorId,
      leaveDate:
        l.leaveDate instanceof Date
          ? l.leaveDate.toISOString().split("T")[0]
          : new Date(l.leaveDate).toISOString().split("T")[0],
      reason: l.reason,
      isHoliday: !!l.isHoliday,
      affectedCount: Number(l.affectedCount || 0),
    }));
  });

export const generateDoctorLeaveReinstatementWaMessageServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      doctorName: string;
      dates: string[];
      clinicName?: string;
      tone?: "reassuring" | "cheerful" | "formal";
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    const formattedDates = (data.dates || [])
      .map((d) =>
        new Date(d).toLocaleDateString("en-IN", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
      )
      .join(", ");

    const fallback = `Hello *{{patient_name}}*,\n\nGood news! We are pleased to inform you that *Dr. ${data.doctorName}* at *${data.clinicName || "our clinic"}* has resumed availability and will be consulting as scheduled on *{{appointment_date}}*.\n\nYour scheduled appointment at *{{appointment_time}}* has been *reinstated and confirmed*. You do not need to reschedule, and your slot is reserved for you.\n\nWe look forward to seeing you. If you have any questions, feel free to reply directly to this WhatsApp message.\n\nWarm regards,\n*${data.clinicName || "Clinic Care Team"}*`;

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
    if (apiKey) {
      const prompt = `You are a medical clinic communications assistant writing a WhatsApp message for patients.
Dr. ${data.doctorName} at ${data.clinicName || "our clinic"} was previously on leave on ${formattedDates}, but that leave has now been CANCELED and the doctor has resumed clinic consultations.
Write a warm, reassuring WhatsApp notification letting the patient know their original scheduled appointment is REINSTATED and CONFIRMED.
Requirements:
1. Use WhatsApp styling (*bold* for clinic & doctor name, dates, times).
2. Use EXACT placeholders:
   - {{patient_name}} for patient's name
   - {{appointment_date}} for their appointment date
   - {{appointment_time}} for their scheduled time
3. Express genuine delight that the doctor is back and that the patient's appointment is fully back on track.
4. Invite them to reply to this WhatsApp message if they have any questions.
5. Tone: ${data.tone || "reassuring"}.
6. Keep length between 60 to 100 words. Concise, clear, professional.
7. Output ONLY the message text.`;

      for (const model of AI_FALLBACK_MODELS) {
        try {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "http://localhost:8080",
              "X-Title": "HealthSync AI",
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.3,
              max_tokens: 350,
            }),
          });
          if (response.ok) {
            const jsonRes = await response.json();
            const text = jsonRes.choices?.[0]?.message?.content?.trim();
            if (text) {
              return { success: true, message: text, source: "ai", model };
            }
          }
        } catch (err: any) {
          console.warn(`[AI Reinstatement WA] Model ${model} error:`, err?.message);
        }
      }
    }

    return { success: true, message: fallback, source: "template" };
  });

export const cancelDoctorLeaveAndReinstateAppointmentsServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      doctorId: string;
      leaveDates: string[];
      sendWhatsAppNotice?: boolean;
      customMessage?: string;
      selectedAppointmentIds?: string[];
    }) => {
      if (!data.doctorId || !data.leaveDates || data.leaveDates.length === 0) {
        throw new Error("Doctor ID and leave dates are required");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_doctor_availability");
    const canSendWA = canPerform(user.role, "send_patient_notices");
    data.leaveDates = data.leaveDates.map((d) => String(d).slice(0, 10)).filter(isIsoDate);
    if (data.leaveDates.length === 0) throw new Error("Please select valid leave dates");

    // 1. Fetch Doctor details
    const doc = await queryOne<any>(
      "SELECT id, name, phone, email FROM Doctor WHERE id = ? AND tenantId = ? LIMIT 1",
      [data.doctorId, user.tenantId],
    );
    if (!doc) throw new Error("Doctor not found or unauthorized");

    // 2. Fetch Clinic Profile details
    const clinicProfile = await queryOne<any>(
      "SELECT clinicName, clinicianName, phone FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [user.tenantId],
    );
    const clinicName = clinicProfile?.clinicName || user.clinicName || "HealthSync Clinic";

    // 3. Delete DoctorLeave records for the specified dates
    const placeholders = data.leaveDates.map(() => "?").join(",");
    await execute(
      `DELETE FROM DoctorLeave 
       WHERE doctorId = ? AND DATE(leaveDate) IN (${placeholders})`,
      [data.doctorId, ...data.leaveDates],
    );

    // 4. Query affected appointments that were previously marked 'Reschedule Needed' or booked on those dates
    const appts = await query<any>(
      `SELECT id, name, phone, dateTime, timeSlot, reason, status, tokenNo
       FROM Appointment
       WHERE tenantId = ?
         AND doctorId = ?
         AND DATE(dateTime) IN (${placeholders})
         AND (status = 'Reschedule Needed' OR status = 'Scheduled' OR status IS NULL)
       ORDER BY dateTime ASC`,
      [user.tenantId, data.doctorId, ...data.leaveDates],
    );

    // Explicit list honoured even when empty (empty used to mean "everyone").
    const targetAppts = Array.isArray(data.selectedAppointmentIds)
      ? appts.filter((a: any) => data.selectedAppointmentIds!.includes(a.id))
      : appts;

    // 5. Update appointment status back to 'Confirmed'
    for (const apt of targetAppts) {
      try {
        await execute(
          `UPDATE Appointment 
           SET status = 'Confirmed',
               reason = REPLACE(COALESCE(reason, ''), ' [Urgent Leave:', ' [Reinstated:')
           WHERE id = ? AND tenantId = ?`,
          [apt.id, user.tenantId],
        );
      } catch (err: any) {
        console.warn(`[Reinstate Appointment Update] Failed:`, err?.message);
      }
    }

    // 6. Optionally dispatch WhatsApp reinstatement messages
    const notifiedPatients: Array<{
      id: string;
      name: string;
      phone: string;
      date: string;
      time: string;
      status: "sent" | "failed" | "skipped";
    }> = [];

    if (canSendWA && data.sendWhatsAppNotice !== false && targetAppts.length > 0) {
      const template =
        data.customMessage ||
        `Hello *{{patient_name}}*,\n\nGood news! We are pleased to inform you that *Dr. ${doc.name}* at *${clinicName}* has resumed availability and will be consulting on *{{appointment_date}}*.\n\nYour scheduled appointment at *{{appointment_time}}* has been *reinstated and confirmed*. You do not need to reschedule, and your slot is reserved for you.\n\nWe look forward to seeing you. If you have any questions, feel free to reply directly to this WhatsApp message.\n\nWarm regards,\n*${clinicName}*`;

      for (const apt of targetAppts) {
        const aptDate = apt.dateTime instanceof Date ? apt.dateTime : new Date(apt.dateTime);
        const dateFormatted = aptDate.toLocaleDateString("en-IN", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const timeFormatted =
          apt.timeSlot ||
          aptDate.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          });

        const personalizedMessage = template
          .replace(/{{patient_name}}/g, apt.name || "Patient")
          .replace(/{{doctor_name}}/g, doc.name)
          .replace(/{{appointment_date}}/g, dateFormatted)
          .replace(/{{appointment_time}}/g, timeFormatted)
          .replace(/{{clinic_name}}/g, clinicName);

        let sendStatus: "sent" | "failed" | "skipped" = "skipped";

        if (apt.phone) {
          try {
            const res = await enqueueWA(user.tenantId, apt.phone, personalizedMessage);
            sendStatus = res.success ? "sent" : "failed";
          } catch (err: any) {
            console.error(`[Reinstatement WA] Failed for ${apt.phone}:`, err?.message);
            sendStatus = "failed";
          }
        }

        notifiedPatients.push({
          id: apt.id,
          name: apt.name,
          phone: apt.phone,
          date: dateFormatted,
          time: timeFormatted,
          status: sendStatus,
        });
      }
    }

    return {
      success: true,
      leavesCancelledCount: data.leaveDates.length,
      reinstatedAppointmentsCount: targetAppts.length,
      notifiedPatientsCount: notifiedPatients.filter((p) => p.status === "sent").length,
      whatsappSkippedForRole: !canSendWA,
      patients: notifiedPatients,
    };
  });

// ──────────────────────────────────────────────
// WhatsApp Management Server Functions
// ──────────────────────────────────────────────

const lastAutoInitMap = new Map<string, number>();

export const getWhatsAppStatusServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  if (!canUseFeature(buildAccountContext(user), "whatsapp")) {
    throw new Error("Your plan does not include WhatsApp alerts.");
  }

  let status = await getWAStatus(user.tenantId);
  // Auto-trigger initialization only if DISCONNECTED and not requested in the last 45s.
  // This prevents destroying and recreating sessions on rapid 3-second frontend poll intervals.
  // Only for accounts that may operate WhatsApp: a view-only receptionist's
  // poll used to restart a session the owner had deliberately disconnected.
  if (status.state === "DISCONNECTED" && canPerform(user.role, "whatsapp_operate")) {
    const now = Date.now();
    const lastInit = lastAutoInitMap.get(user.tenantId) || 0;
    if (now - lastInit > 45000) {
      lastAutoInitMap.set(user.tenantId, now);
      initializeWA(user.tenantId).catch(() => {});
      status = await getWAStatus(user.tenantId);
    }
  }

  return status;
});

export const initializeWhatsAppServerFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  const ctx = buildAccountContext(user);
  if (!canUseFeature(ctx, "whatsapp")) {
    throw new Error("Your plan does not include WhatsApp alerts.");
  }
  if (!canOperateFeature(ctx, "whatsapp")) {
    throw new Error("You do not have permission to perform this action.");
  }
  await initializeWA(user.tenantId);
  return { success: true };
});

export const resetWhatsAppSessionServerFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  const ctx = buildAccountContext(user);
  if (!canUseFeature(ctx, "whatsapp")) {
    throw new Error("Your plan does not include WhatsApp alerts.");
  }
  if (!canOperateFeature(ctx, "whatsapp")) {
    throw new Error("You do not have permission to perform this action.");
  }
  // Clear auto-init cooldown so next status fetch reflects fresh state
  lastAutoInitMap.delete(user.tenantId);
  await resetWASession(user.tenantId);
  return { success: true };
});

export const disconnectWhatsAppServerFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  const ctx = buildAccountContext(user);
  if (!canUseFeature(ctx, "whatsapp")) {
    throw new Error("Your plan does not include WhatsApp alerts.");
  }
  if (!canOperateFeature(ctx, "whatsapp")) {
    throw new Error("You do not have permission to perform this action.");
  }
  lastAutoInitMap.delete(user.tenantId);
  await disconnectWA(user.tenantId);
  return { success: true };
});

export const sendTestWaServerFn = createServerFn({ method: "POST" })
  .validator((data: { phone: string; message: string }) => {
    if (!data.phone || !data.message) throw new Error("Phone and message are required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    const ctx = buildAccountContext(user);
    if (!canUseFeature(ctx, "whatsapp")) {
      throw new Error("Your plan does not include WhatsApp alerts.");
    }
    if (!canOperateFeature(ctx, "whatsapp")) {
      throw new Error("You do not have permission to perform this action.");
    }
    const status = await getWAStatus(user.tenantId);
    if (status.state !== "CONNECTED") {
      throw new Error("WhatsApp is not connected. Please scan the QR code first.");
    }
    await enqueueWA(user.tenantId, data.phone, data.message);
    return { success: true, queued: true };
  });

export const getWhatsAppConfigServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  if (!canUseFeature(buildAccountContext(user), "whatsapp")) {
    throw new Error("Your plan does not include WhatsApp alerts.");
  }

  const config = await queryOne<any>("SELECT * FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1", [
    user.tenantId,
  ]);

  return config || null;
});

export const saveWhatsAppConfigServerFn = createServerFn({ method: "POST" })
  .validator((data: { phoneNumber: string; isEnabled: boolean }) => {
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    const ctx = buildAccountContext(user);
    if (!canUseFeature(ctx, "whatsapp")) {
      throw new Error("Your plan does not include WhatsApp alerts.");
    }
    if (!canOperateFeature(ctx, "whatsapp")) {
      throw new Error("You do not have permission to perform this action.");
    }

    await execute(
      `INSERT INTO WhatsAppConfig (id, tenantId, phoneNumber, isEnabled)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE phoneNumber = ?, isEnabled = ?`,
      [
        generateId(),
        user.tenantId,
        data.phoneNumber || null,
        data.isEnabled ? 1 : 0,
        data.phoneNumber || null,
        data.isEnabled ? 1 : 0,
      ],
    );

    return { success: true };
  });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Public Clinic Info & Slots Retrieval
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getClinicInfoAndSlotsServerFn = createServerFn({ method: "GET" })
  .validator((data: { tenantId: string; date?: string; doctorId?: string }) => {
    if (!data.tenantId) throw new Error("Tenant ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    // 1. Resolve clinic details
    let clinicName = "";
    const profile = await queryOne<any>(
      "SELECT clinicName FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [data.tenantId],
    );
    if (profile) {
      clinicName = profile.clinicName;
    } else {
      const userClinic = await queryOne<any>(
        "SELECT clinicName FROM User WHERE tenantId = ? LIMIT 1",
        [data.tenantId],
      );
      if (!userClinic) throw new Error("Clinic not found");
      clinicName = userClinic.clinicName;
    }

    // 2. Resolve active departments
    const departments = await query<any>(
      "SELECT * FROM Department WHERE tenantId = ? ORDER BY name ASC",
      [data.tenantId],
    );

    // 3. Resolve active doctors
    const doctors = await query<any>(
      `SELECT d.*, dept.name as departmentName
       FROM Doctor d
       LEFT JOIN Department dept ON d.departmentId = dept.id
       WHERE d.tenantId = ?
       ORDER BY d.name ASC`,
      [data.tenantId],
    );

    // 4. If date and doctorId are selected, compute dynamic available slots
    const slots: string[] = [];
    if (data.date && data.doctorId) {
      const selectedDate = new Date(data.date);
      const dayOfWeek = selectedDate.getDay(); // 0 is Sunday, 6 is Saturday
      const dateStr = selectedDate.toISOString().split("T")[0];

      // A. Check if the clinic is closed on this day
      const clinicHours = await queryOne<any>(
        "SELECT * FROM ClinicHours WHERE tenantId = ? AND dayOfWeek = ? LIMIT 1",
        [data.tenantId, dayOfWeek],
      );

      const clinicClosed = clinicHours
        ? !!clinicHours.isClosed
        : dayOfWeek === 0 || dayOfWeek === 6; // fallback Sat/Sun closed

      if (!clinicClosed) {
        // B. Check if the doctor is on holiday/leave on this date
        const leave = await queryOne<any>(
          "SELECT id FROM DoctorLeave WHERE doctorId = ? AND leaveDate = ? LIMIT 1",
          [data.doctorId, dateStr],
        );

        if (!leave) {
          // C. Get doctor schedule for this day of the week
          const docSchedule = await queryOne<any>(
            "SELECT * FROM DoctorSchedule WHERE doctorId = ? AND dayOfWeek = ? LIMIT 1",
            [data.doctorId, dayOfWeek],
          );

          // Resolve working hours: prefer DoctorSchedule, then fall back to
          // ClinicHours so doctors without explicit weekly hours still show slots.
          let startTimeStr: string | null = null;
          let endTimeStr: string | null = null;
          let duration = 30;
          // Breaks (lunch etc.) configured for this weekday. Slots that overlap
          // one must not be offered.
          let breaks: NormalizedBreak[] = [];

          if (docSchedule) {
            startTimeStr = docSchedule.startTime;
            endTimeStr = docSchedule.endTime;
            duration = docSchedule.slotDuration || 30;
            breaks = resolveBreaks(docSchedule.breaks);
          } else if (clinicHours && clinicHours.openTime && clinicHours.closeTime) {
            startTimeStr = clinicHours.openTime;
            endTimeStr = clinicHours.closeTime;
            duration = clinicHours.slotDuration || 30;
          } else {
            startTimeStr = "09:00";
            endTimeStr = "17:00";
            duration = 30;
          }

          if (startTimeStr && endTimeStr) {
            // Parse start and end times
            const [startHour, startMin] = startTimeStr.split(":").map(Number);
            const [endHour, endMin] = endTimeStr.split(":").map(Number);

            const startObj = new Date(selectedDate);
            startObj.setHours(startHour, startMin, 0, 0);

            const endObj = new Date(selectedDate);
            endObj.setHours(endHour, endMin, 0, 0);

            // Get existing bookings for this doctor on this day
            const existingBookings = await query<any>(
              `SELECT dateTime, timeSlot FROM Appointment
               WHERE doctorId = ? AND DATE(dateTime) = ? AND status != 'Cancelled'`,
              [data.doctorId, dateStr],
            );

            const bookedSlots = existingBookings.map((b) => b.timeSlot || "");

            // Generate time slots
            const temp = new Date(startObj);
            while (temp < endObj) {
              const slotTimeStr = temp.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              });

              // Only include if not already booked and not inside a break
              const slotStartMin = temp.getHours() * 60 + temp.getMinutes();
              if (
                !bookedSlots.includes(slotTimeStr) &&
                !overlapsBreak(slotStartMin, duration, breaks)
              ) {
                slots.push(slotTimeStr);
              }

              temp.setMinutes(temp.getMinutes() + duration);
            }
          }
        }
      }
    }

    return {
      clinicName: clinicName,
      departments,
      doctors,
      slots,
    };
  });

// ══════════════════════════════════════════════════════════════
// DASHBOARD OVERVIEW — Live Stats & Timeline
// ══════════════════════════════════════════════════════════════

export const getDashboardStatsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user) throw new Error("Unauthorized");
  // Local calendar date (the server runs in the clinic's timezone, matching
  // DATE(dateTime)); toISOString() gave yesterday until 05:30 IST.
  const todayStr = toLocalIsoDate(new Date());
  const isDoctor = user.role === "doctor" && user.doctorId;

  let todayAppointments: any[] = [];
  try {
    let todayAppointmentsQuery = `SELECT a.*, d.name as doctorName FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id WHERE a.tenantId = ? AND DATE(a.dateTime) = ?`;
    const todayAppointmentsParams = [user.tenantId, todayStr];
    if (isDoctor) {
      todayAppointmentsQuery += ` AND a.doctorId = ?`;
      todayAppointmentsParams.push(user.doctorId);
    }
    todayAppointmentsQuery += ` ORDER BY a.dateTime ASC`;
    todayAppointments = await query<any>(todayAppointmentsQuery, todayAppointmentsParams);
  } catch (e: any) {
    console.error("[DB] getDashboardStats - todayAppointmentsQuery failed:", e.message);
  }

  let allCounts: any = { total: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
  try {
    let allCountsQuery = `SELECT COUNT(*) as total, SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status='Confirmed' THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled FROM Appointment WHERE tenantId = ?`;
    const allCountsParams = [user.tenantId];
    if (isDoctor) {
      allCountsQuery += ` AND doctorId = ?`;
      allCountsParams.push(user.doctorId);
    }
    const [resAllCounts] = await query<any>(allCountsQuery, allCountsParams);
    if (resAllCounts) allCounts = resAllCounts;
  } catch (e: any) {
    console.error("[DB] getDashboardStats - allCountsQuery failed:", e.message);
  }

  let todayCounts: any = { total: 0, pending: 0, confirmed: 0, completed: 0 };
  try {
    let todayCountsQuery = `SELECT COUNT(*) as total, SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status='Confirmed' THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = ?`;
    const todayCountsParams = [user.tenantId, todayStr];
    if (isDoctor) {
      todayCountsQuery += ` AND doctorId = ?`;
      todayCountsParams.push(user.doctorId);
    }
    const [resTodayCounts] = await query<any>(todayCountsQuery, todayCountsParams);
    if (resTodayCounts) todayCounts = resTodayCounts;
  } catch (e: any) {
    console.error("[DB] getDashboardStats - todayCountsQuery failed:", e.message);
  }

  let patientCount: any = { total: 0 };
  try {
    let patientCountQuery = "SELECT COUNT(*) as total FROM Patient WHERE tenantId = ?";
    let patientCountParams = [user.tenantId];
    if (isDoctor) {
      patientCountQuery =
        "SELECT COUNT(DISTINCT patientId) as total FROM Appointment WHERE tenantId = ? AND doctorId = ?";
      patientCountParams = [user.tenantId, user.doctorId];
    }
    const [resPatientCount] = await query<any>(patientCountQuery, patientCountParams);
    if (resPatientCount) patientCount = resPatientCount;
  } catch (e: any) {
    console.error("[DB] getDashboardStats - patientCountQuery failed:", e.message);
  }

  let recentAppointments: any[] = [];
  try {
    let recentAppointmentsQuery = `SELECT a.*, d.name as doctorName FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id WHERE a.tenantId = ?`;
    const recentAppointmentsParams = [user.tenantId];
    if (isDoctor) {
      recentAppointmentsQuery += ` AND a.doctorId = ?`;
      recentAppointmentsParams.push(user.doctorId);
    }
    recentAppointmentsQuery += ` ORDER BY a.createdAt DESC LIMIT 5`;
    recentAppointments = await query<any>(recentAppointmentsQuery, recentAppointmentsParams);
  } catch (e: any) {
    console.error("[DB] getDashboardStats - recentAppointmentsQuery failed:", e.message);
  }

  return {
    todayAppointments,
    allTimeCounts: {
      total: Number(allCounts?.total || 0),
      pending: Number(allCounts?.pending || 0),
      confirmed: Number(allCounts?.confirmed || 0),
      completed: Number(allCounts?.completed || 0),
      cancelled: Number(allCounts?.cancelled || 0),
    },
    todayCounts: {
      total: Number(todayCounts?.total || 0),
      pending: Number(todayCounts?.pending || 0),
      confirmed: Number(todayCounts?.confirmed || 0),
      completed: Number(todayCounts?.completed || 0),
    },
    totalPatients: Number(patientCount?.total || 0),
    recentAppointments,
  };
});

// ══════════════════════════════════════════════════════════════
// ANALYTICS — Live Chart Data
// ══════════════════════════════════════════════════════════════

export const getAnalyticsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user) throw new Error("Unauthorized");
  const isDoctor = user.role === "doctor" && user.doctorId;

  let byDayOfWeek: any[] = [];
  try {
    let byDayOfWeekQuery = `SELECT DAYOFWEEK(dateTime) as dow, COUNT(*) as count FROM Appointment WHERE tenantId = ? AND dateTime >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    const byDayOfWeekParams = [user.tenantId];
    if (isDoctor) {
      byDayOfWeekQuery += ` AND doctorId = ?`;
      byDayOfWeekParams.push(user.doctorId);
    }
    byDayOfWeekQuery += ` GROUP BY DAYOFWEEK(dateTime) ORDER BY dow`;
    byDayOfWeek = await query<any>(byDayOfWeekQuery, byDayOfWeekParams);
  } catch (e: any) {
    console.error("[DB] getAnalytics - byDayOfWeekQuery failed:", e.message);
  }

  let monthlyTrend: any[] = [];
  try {
    let monthlyTrendQuery = `SELECT DATE_FORMAT(dateTime, '%Y-%m') as month, COUNT(*) as count FROM Appointment WHERE tenantId = ? AND dateTime >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`;
    const monthlyTrendParams = [user.tenantId];
    if (isDoctor) {
      monthlyTrendQuery += ` AND doctorId = ?`;
      monthlyTrendParams.push(user.doctorId);
    }
    monthlyTrendQuery += ` GROUP BY DATE_FORMAT(dateTime, '%Y-%m') ORDER BY month`;
    monthlyTrend = await query<any>(monthlyTrendQuery, monthlyTrendParams);
  } catch (e: any) {
    console.error("[DB] getAnalytics - monthlyTrendQuery failed:", e.message);
  }

  let statusBreakdown: any[] = [];
  try {
    let statusBreakdownQuery =
      "SELECT status, COUNT(*) as count FROM Appointment WHERE tenantId = ?";
    const statusBreakdownParams = [user.tenantId];
    if (isDoctor) {
      statusBreakdownQuery += ` AND doctorId = ?`;
      statusBreakdownParams.push(user.doctorId);
    }
    statusBreakdownQuery += ` GROUP BY status`;
    statusBreakdown = await query<any>(statusBreakdownQuery, statusBreakdownParams);
  } catch (e: any) {
    console.error("[DB] getAnalytics - statusBreakdownQuery failed:", e.message);
  }

  let topDoctors: any[] = [];
  try {
    let topDoctorsQuery = `SELECT d.name, COUNT(a.id) as count FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id WHERE a.tenantId = ? AND d.name IS NOT NULL`;
    const topDoctorsParams = [user.tenantId];
    if (isDoctor) {
      topDoctorsQuery += ` AND a.doctorId = ?`;
      topDoctorsParams.push(user.doctorId);
    }
    topDoctorsQuery += ` GROUP BY a.doctorId, d.name ORDER BY count DESC LIMIT 5`;
    topDoctors = await query<any>(topDoctorsQuery, topDoctorsParams);
  } catch (e: any) {
    console.error("[DB] getAnalytics - topDoctorsQuery failed:", e.message);
  }

  let patientCount: any = { total: 0 };
  try {
    let patientCountQuery = "SELECT COUNT(*) as total FROM Patient WHERE tenantId = ?";
    let patientCountParams = [user.tenantId];
    if (isDoctor) {
      patientCountQuery =
        "SELECT COUNT(DISTINCT patientId) as total FROM Appointment WHERE tenantId = ? AND doctorId = ?";
      patientCountParams = [user.tenantId, user.doctorId];
    }
    const [resPatientCount] = await query<any>(patientCountQuery, patientCountParams);
    if (resPatientCount) patientCount = resPatientCount;
  } catch (e: any) {
    console.error("[DB] getAnalytics - patientCountQuery failed:", e.message);
  }

  let total = 0;
  let completed = 0;
  let cancelled = 0;
  try {
    let totalsQuery = `SELECT COUNT(*) as total, SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled FROM Appointment WHERE tenantId = ?`;
    const totalsParams = [user.tenantId];
    if (isDoctor) {
      totalsQuery += ` AND doctorId = ?`;
      totalsParams.push(user.doctorId);
    }
    const [totals] = await query<any>(totalsQuery, totalsParams);
    if (totals) {
      total = Number(totals.total || 0);
      completed = Number(totals.completed || 0);
      cancelled = Number(totals.cancelled || 0);
    }
  } catch (e: any) {
    console.error("[DB] getAnalytics - totalsQuery failed:", e.message);
  }

  const completionRate =
    total - cancelled > 0 ? Math.round((completed / (total - cancelled)) * 100) : 0;
  const dowMap: Record<number, string> = {
    1: "Sun",
    2: "Mon",
    3: "Tue",
    4: "Wed",
    5: "Thu",
    6: "Fri",
    7: "Sat",
  };

  return {
    byDayOfWeek: byDayOfWeek.map((r: any) => ({
      day: dowMap[Number(r.dow)] || String(r.dow),
      count: Number(r.count),
    })),
    monthlyTrend: monthlyTrend.map((r: any) => ({ month: r.month, count: Number(r.count) })),
    statusBreakdown: statusBreakdown.map((r: any) => ({
      status: r.status,
      count: Number(r.count),
    })),
    topDoctors: topDoctors.map((r: any) => ({ name: r.name, count: Number(r.count) })),
    scorecard: {
      totalPatients: Number(patientCount?.total || 0),
      totalAppointments: total,
      completionRate,
    },
  };
});

// ══════════════════════════════════════════════════════════════
// PATIENT CRUD
// ══════════════════════════════════════════════════════════════

export const getPatientsServerFn = createServerFn({ method: "GET" })
  .validator((data: { search?: string; page?: number }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const page = data.page || 1;
    const pageSize = 20;
    const offset = (page - 1) * pageSize;
    const search = data.search ? `%${data.search}%` : "%";
    const patients = await query<any>(
      `SELECT p.*, (SELECT MAX(a.dateTime) FROM Appointment a WHERE a.patientId = p.id OR (a.name = p.name AND a.tenantId = p.tenantId)) as lastVisit FROM Patient p WHERE p.tenantId = ? AND (p.name LIKE ? OR p.patientNo LIKE ? OR p.phone LIKE ? OR p.email LIKE ?) ORDER BY p.createdAt DESC LIMIT ? OFFSET ?`,
      [user.tenantId, search, search, search, search, pageSize, offset],
    );
    const [countRow] = await query<any>(
      `SELECT COUNT(*) as total FROM Patient WHERE tenantId = ? AND (name LIKE ? OR patientNo LIKE ? OR phone LIKE ? OR email LIKE ?)`,
      [user.tenantId, search, search, search, search],
    );
    return { patients, total: Number(countRow?.total || 0), page, pageSize };
  });

export const checkPatientDuplicateServerFn = createServerFn({ method: "POST" })
  .validator((data: { email?: string | null; phone?: string | null }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    if (!data.email && !data.phone) return { exists: false };

    let sql = "SELECT * FROM Patient WHERE tenantId = ? AND (";
    const params: any[] = [user.tenantId];
    const subConds: string[] = [];
    if (data.email) {
      subConds.push("email = ?");
      params.push(data.email);
    }
    if (data.phone) {
      subConds.push("phone = ?");
      params.push(data.phone);
    }
    sql += subConds.join(" OR ") + ") LIMIT 1";

    const existing = await queryOne<any>(sql, params);
    if (existing) {
      return { exists: true, patient: existing };
    }
    return { exists: false };
  });

export const createPatientServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name: string;
      age?: number;
      gender?: string;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      chiefComplaint?: string;
      notes?: string | null;
      dob?: string | null;
      bloodGroup?: string | null;
    }) => {
      if (!data.name) throw new Error("Patient name is required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    // Plan check: Basic/Solo limit is 500 patients
    const tenant = await queryOne<any>(
      "SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1",
      [user.tenantId],
    );
    const plan = tenant?.subscriptionPlan || "Basic";
    if (plan === "Solo" || plan === "Basic") {
      const [patientCount] = await query<any>(
        "SELECT COUNT(*) as total FROM Patient WHERE tenantId = ?",
        [user.tenantId],
      );
      const total = patientCount?.total || patientCount?.TOTAL || 0;
      if (Number(total) >= 500) {
        throw new Error(
          "You have reached the maximum limit of 500 patient records under the Basic plan. Please upgrade your plan to add more patients.",
        );
      }
    }

    const name = String(data.name || "").trim();
    if (!name) throw new Error("Patient name is required");
    if (data.age !== undefined && data.age !== null) {
      const age = Number(data.age);
      if (!Number.isFinite(age) || age < 0 || age > 150)
        throw new Error("Please enter a valid age");
    }

    // Next number = numeric MAX + 1. "Newest by createdAt" (second resolution)
    // picked an arbitrary row on ties and re-issued a deleted newest number.
    const [maxRow] = await query<any>(
      `SELECT MAX(CAST(SUBSTRING(patientNo, 3) AS UNSIGNED)) AS maxNo
         FROM Patient WHERE tenantId = ? AND patientNo LIKE 'P-%'`,
      [user.tenantId],
    );
    const nextNum = (Number(maxRow?.maxNo) || 0) + 1;
    const patientNo = `P-${String(nextNum).padStart(3, "0")}`;
    const cryptoMod = await import("crypto");
    const id = cryptoMod.randomUUID();
    await execute(
      `INSERT INTO Patient (id,tenantId,patientNo,name,age,gender,phone,email,address,chiefComplaint,notes,dob,bloodGroup,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        id,
        user.tenantId,
        patientNo,
        name,
        data.age || null,
        data.gender || null,
        data.phone || null,
        data.email || null,
        data.address || null,
        data.chiefComplaint || null,
        data.notes || null,
        data.dob || null,
        data.bloodGroup || null,
      ],
    );
    return { success: true, patientId: id, patientNo };
  });

export const updatePatientServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      name?: string;
      age?: number;
      gender?: string;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      chiefComplaint?: string;
      notes?: string | null;
      dob?: string | null;
      bloodGroup?: string | null;
    }) => {
      if (!data.id) throw new Error("Patient ID is required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const existing = await queryOne<any>(
      "SELECT * FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1",
      [data.id, user.tenantId],
    );
    if (!existing) throw new Error("Patient not found");
    // `undefined` = not sent, keep. `null` / "" = cleared by the user. The old
    // `??` treated null as "not sent", so a field could never be emptied.
    const pick = (value: any, current: any) =>
      value === undefined ? current : value === "" ? null : value;
    if (data.name !== undefined && !String(data.name).trim()) {
      throw new Error("Patient name is required");
    }
    await execute(
      `UPDATE Patient SET name=?,age=?,gender=?,phone=?,email=?,address=?,chiefComplaint=?,notes=?,dob=?,bloodGroup=? WHERE id=? AND tenantId=?`,
      [
        data.name !== undefined ? String(data.name).trim() : existing.name,
        pick(data.age, existing.age),
        pick(data.gender, existing.gender),
        pick(data.phone, existing.phone),
        pick(data.email, existing.email),
        pick(data.address, existing.address),
        pick(data.chiefComplaint, existing.chiefComplaint),
        pick(data.notes, existing.notes),
        pick(data.dob, existing.dob),
        pick(data.bloodGroup, existing.bloodGroup),
        data.id,
        user.tenantId,
      ],
    );
    return { success: true };
  });

export const deletePatientServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("Patient ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    // Ownership first. The SOAP-note delete used to run unscoped BEFORE this,
    // so another clinic's patient id wiped that clinic's notes.
    const owned = await queryOne<any>(
      "SELECT id FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1",
      [data.id, user.tenantId],
    );
    if (!owned) throw new Error("Patient not found or unauthorized");
    await withTransaction(async (conn) => {
      await conn.query("DELETE FROM SoapNote WHERE patientId = ? AND tenantId = ?", [
        data.id,
        user.tenantId,
      ]);
      // Prescriptions were never deleted and were left orphaned.
      await conn.query("DELETE FROM Prescription WHERE patientId = ? AND tenantId = ?", [
        data.id,
        user.tenantId,
      ]);
      await conn.query("DELETE FROM Patient WHERE id = ? AND tenantId = ?", [
        data.id,
        user.tenantId,
      ]);
    });
    return { success: true };
  });

export const getPatientChartServerFn = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => {
    if (!data.patientId) throw new Error("Patient ID required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");

    let patient = await queryOne<any>(
      "SELECT * FROM Patient WHERE id = ? AND tenantId = ? LIMIT 1",
      [data.patientId, user.tenantId],
    );

    if (!patient) {
      // Try to resolve from Appointment table if it's an appointment ID or virtual
      const apt = await queryOne<any>(
        "SELECT * FROM Appointment WHERE id = ? AND tenantId = ? LIMIT 1",
        [data.patientId, user.tenantId],
      );
      if (apt) {
        patient = {
          id: data.patientId,
          tenantId: user.tenantId,
          patientNo: "Walk-in",
          name: apt.name,
          email: apt.email,
          phone: apt.phone,
          dob: "",
          bloodGroup: "",
          age: 35,
          gender: "Not specified",
          address: "Walk-in / Online Booking",
          chiefComplaint: apt.reason,
          notes: "",
          createdAt: apt.createdAt,
        };
      } else {
        // Ultimate fallback
        patient = {
          id: data.patientId,
          tenantId: user.tenantId,
          patientNo: "N/A",
          name: "Unregistered Patient",
          email: "",
          phone: "",
          dob: "",
          bloodGroup: "",
          age: 35,
          gender: "Not specified",
          address: "None Provided",
          chiefComplaint: "",
          notes: "",
          createdAt: new Date().toISOString(),
        };
      }
    }

    const soapNotes = await query<any>(
      "SELECT * FROM SoapNote WHERE patientId = ? AND tenantId = ? ORDER BY createdAt DESC LIMIT 20",
      [data.patientId, user.tenantId],
    );

    // Fetch prescriptions for this patient. Scoped by tenantId (like the SoapNote
    // read above): without it, a patientId belonging to another clinic would
    // return that clinic's prescriptions.
    const prescriptionsRaw = await query<any>(
      "SELECT * FROM Prescription WHERE patientId = ? AND tenantId = ? ORDER BY createdAt DESC LIMIT 20",
      [data.patientId, user.tenantId],
    );
    const prescriptions = prescriptionsRaw.map((r: any) => ({
      id: r.id,
      patientId: r.patientId,
      medications: (() => {
        try {
          return typeof r.medications === "string" ? JSON.parse(r.medications) : r.medications;
        } catch {
          return [];
        }
      })(),
      notes: r.notes,
      createdAt: r.createdAt,
    }));

    const isDoctor = user.role === "doctor" && user.doctorId;
    // tenantId must bind every branch. It used to bind only the name match, so
    // a patientId / appointment id returned other clinics' appointments.
    let aptSql = `SELECT a.*, d.name as doctorName FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id WHERE a.tenantId = ? AND (a.patientId = ? OR a.id = ? OR a.name = ?)`;
    const aptParams = [user.tenantId, data.patientId, data.patientId, patient.name];
    if (isDoctor) {
      aptSql += ` AND a.doctorId = ?`;
      aptParams.push(user.doctorId);
    }
    aptSql += ` ORDER BY a.dateTime DESC LIMIT 10`;

    const appointments = await query<any>(aptSql, aptParams);
    return { patient, soapNotes, prescriptions, appointments };
  });

// ══════════════════════════════════════════════════════════════
// SOAP NOTES — AI Scribe Persistence & Generation
// ══════════════════════════════════════════════════════════════

export const generateSoapNoteServerFn = createServerFn({ method: "POST" })
  .validator((data: { transcript: string; specialty: string; language: string }) => {
    if (!data.transcript) throw new Error("Transcript is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    assertCanPerform(user.role, "clinical_records");

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key is not configured in .env file.");
    }

    const specialtyPrompt = `You are an expert AI clinical scribe. Synthesize the following doctor-patient encounter transcript into a professional, structured SOAP note for the specialty "${data.specialty}" in the language "${data.language}".
Provide the response in raw JSON format with the following keys:
- subjective: A detailed subjective description of the patient's narrative, chief complaint, history of present illness (HPI), etc.
- objective: Objective findings including physical exams, vitals, general appearance, etc.
- assessment: Clinical assessment, differential diagnosis, and findings.
- plan: Treatment plan, medications, referrals, patient education, and follow-ups.

Only return a valid JSON object matching this structure. Do not wrap the JSON in markdown code blocks or add any other text outside the JSON object.

Transcript:
"${data.transcript}"`;

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:8080",
          "X-Title": "HealthSync AI",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You are an accurate, secure clinical note generator. You output only clean JSON.",
            },
            { role: "user", content: specialtyPrompt },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenRouter API error:", errorText);
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }

      const resJson = await response.json();
      const content = resJson.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from AI scribe model.");
      }

      const soapNote = JSON.parse(content.trim());
      return {
        success: true,
        subjective: soapNote.subjective || "",
        objective: soapNote.objective || "",
        assessment: soapNote.assessment || "",
        plan: soapNote.plan || "",
      };
    } catch (e: any) {
      console.error("Failed to generate SOAP note via OpenRouter:", e);
      throw new Error(e.message || "Failed to generate SOAP note.");
    }
  });

export const saveSoapNoteServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      patientId: string;
      appointmentId?: string;
      specialty?: string;
      subjective: string;
      objective: string;
      assessment: string;
      plan: string;
      rawTranscript?: string;
    }) => {
      if (!data.patientId) throw new Error("Patient ID is required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "clinical_records");
    await assertPatientRefInTenant(data.patientId, user.tenantId);
    if (data.appointmentId) {
      const apt = await queryOne<any>(
        "SELECT id FROM Appointment WHERE id = ? AND tenantId = ? LIMIT 1",
        [data.appointmentId, user.tenantId],
      );
      if (!apt) throw new Error("Appointment not found or unauthorized");
    }
    const cryptoMod = await import("crypto");
    const id = cryptoMod.randomUUID();
    await execute(
      `INSERT INTO SoapNote (id,tenantId,patientId,appointmentId,specialty,subjective,objective,assessment,plan,rawTranscript,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        id,
        user.tenantId,
        data.patientId,
        data.appointmentId || null,
        data.specialty || null,
        data.subjective,
        data.objective,
        data.assessment,
        data.plan,
        data.rawTranscript || null,
      ],
    );
    return { success: true, soapNoteId: id };
  });

// ══════════════════════════════════════════════════════════════
// PRESCRIPTIONS — Voice Prescription Parsing & Saving
// ══════════════════════════════════════════════════════════════

export const generatePrescriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { transcript: string; language: string }) => {
    if (!data.transcript) throw new Error("Voice prescription instructions are required.");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    assertCanPerform(user.role, "clinical_records");

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key is not configured in .env file.");
    }

    const prompt = `You are a medical AI assistant. Your task is to extract and generate a structured medical prescription from the following doctor's voice prescription instructions.

CRITICAL INSTRUCTION:
If the voice instructions only specify a diagnosis, symptom, or general complaint (e.g., "patient has a cold", "kidney pain", or "cough and fever") without listing specific drug names, dosages, durations, or frequencies, you MUST recommend and generate a complete list of standard, clinically appropriate medications (with name, dosage, frequency, route, duration, and instructions) and clinical advice/notes based on your medical knowledge for the described clinical context. Do not leave the medications list empty if symptoms or a diagnosis are mentioned.

Format the output in raw JSON format with the following structure:
{
  "medications": [
    {
      "name": "Drug name (e.g., Amoxicillin)",
      "dosage": "Dosage (e.g., 500mg)",
      "frequency": "Frequency (e.g., Three times daily / TID)",
      "route": "Route (e.g., Oral)",
      "duration": "Duration (e.g., 7 days)",
      "instructions": "Specific instructions (e.g., Take with meals)"
    }
  ],
  "notes": "Any clinical directions or additional notes (e.g., avoid alcohol, drink plenty of water, rest)"
}

Only return a valid JSON object matching this structure. Do not wrap the JSON in markdown code blocks or add any other text outside the JSON object.

Voice Instructions:
"${data.transcript}"`;

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:8080",
          "X-Title": "HealthSync AI",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "You output only clean JSON." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1500,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenRouter API error in Prescription Generation:", errorText);
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }

      const resJson = await response.json();
      const content = resJson.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from prescription model.");
      }

      const prescription = JSON.parse(content.trim());
      return {
        success: true,
        medications: prescription.medications || [],
        notes: prescription.notes || "",
      };
    } catch (e: any) {
      console.error("Failed to generate prescription via OpenRouter:", e);
      throw new Error(e.message || "Failed to generate prescription.");
    }
  });

function cleanAndExtractJson(content: string): any {
  let cleaned = String(content || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && (firstBrace > 0 || lastBrace < cleaned.length - 1)) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

export const aiAssistConsultationServerFn = createServerFn({ method: "POST" })
  .validator((data: { chiefComplaint: string; vitals?: string }) => {
    if (!data.chiefComplaint) throw new Error("Chief complaint is required for AI Assist.");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    assertCanPerform(user.role, "clinical_records");

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key is not configured in .env file.");
    }

    const prompt = `You are a medical AI assistant helping a clinician write a consultation and prescription.
Given the patient's Chief Complaint:
"${data.chiefComplaint}"
And Vitals:
"${data.vitals || "N/A"}"

Generate a primary diagnosis (including common ICD-10 codes if applicable), a list of recommended medications, and clinical advice.
Format the output in raw JSON format with the exact structure below:
{
  "diagnosis": "Primary diagnosis with ICD-10 codes (e.g., Acute pharyngitis (J02.9))",
  "medications": [
    {
      "name": "Drug name (e.g., Paracetamol)",
      "dosage": "Dosage (e.g., 650mg)",
      "frequency": "Frequency (e.g., Three times daily / TID)",
      "route": "Route (e.g., Oral)",
      "duration": "Duration (e.g., 5 days)",
      "instructions": "Specific instructions (e.g., Take after food as needed for pain)"
    }
  ],
  "advice": "Diet, lifestyle, precautions, and instructions (e.g., Warm saline gargles, avoid cold items, rest)"
}

Only return a valid JSON object matching this structure. Do not wrap the JSON in markdown code blocks or add any other text outside the JSON object.`;

    let lastError: Error | null = null;
    for (const model of AI_FALLBACK_MODELS) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:8080",
            "X-Title": "HealthSync AI",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "You output only clean JSON." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[AI Assist] Model ${model} returned ${response.status}:`, errorText);
          continue;
        }

        const resJson = await response.json();
        const content = resJson.choices?.[0]?.message?.content;
        if (!content) continue;

        const parsed = cleanAndExtractJson(content);
        return {
          success: true,
          diagnosis: parsed.diagnosis || "",
          medications: Array.isArray(parsed.medications) ? parsed.medications : [],
          advice: parsed.advice || "",
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[AI Assist] Failed with model ${model}:`, err.message);
      }
    }

    throw new Error(
      lastError?.message ||
        "Failed to generate AI recommendations. Please check API credits or try again.",
    );
  });

export const voiceRxAnalyzeServerFn = createServerFn({ method: "POST" })
  .validator((data: { transcript: string }) => {
    if (!data.transcript) throw new Error("Transcript is required for Voice Rx Analysis.");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    assertCanPerform(user.role, "clinical_records");

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key is not configured in .env file.");
    }

    const prompt = `You are a medical AI assistant helping a clinician parse an audio dictation or dialogue transcript into a structured prescription form.
Here is the recorded transcript of patient-doctor interaction or doctor's prescription dictation:
"${data.transcript}"

Analyze this transcript and extract or generate:
1. "chiefComplaint": The patient's chief complaints and symptoms (e.g. Tooth pain for 3 days). If not explicitly stated, infer them from the clinical context.
2. "diagnosis": The primary diagnosis (including common ICD-10 codes if applicable, e.g. Dental caries (K02.9)). If not explicitly stated, infer the most likely diagnosis from the complaints/symptoms.
3. "medications": A list of prescribed medications. 
   - CRITICAL CLINICAL REQUIREMENT: If medications, dosages, frequencies, routes, durations, or instructions are not explicitly or fully dictated in the transcript, but a diagnosis, symptom, or chief complaint is present, you MUST use your medical knowledge to recommend and generate a complete list of standard, clinically appropriate medications (with name, dosage, frequency, route, duration, and instructions) suitable for the diagnosed condition. Do not leave this list empty or incomplete if a clinical condition or symptoms are described.
   - For each medication, output:
     - "name" (e.g., Paracetamol)
     - "dosage" (e.g., 650mg)
     - "frequency" (e.g., TID / Three times daily)
     - "route" (e.g., Oral)
     - "duration" (e.g., 5 days)
     - "instructions" (e.g., Take after food)
4. "advice": Advice, instructions, diet or lifestyle recommendations. If not explicitly dictated, generate standard advice/precautions/lifestyle recommendations appropriate for the diagnosed condition.

Format the output in raw JSON format with the exact structure below:
{
  "chiefComplaint": "Extracted or inferred chief complaints",
  "diagnosis": "Primary diagnosis with ICD-10 codes",
  "medications": [
    {
      "name": "Drug name",
      "dosage": "Dosage",
      "frequency": "Frequency",
      "route": "Route",
      "duration": "Duration",
      "instructions": "Instructions"
    }
  ],
  "advice": "Diet, lifestyle, precautions and instructions"
}

Only return a valid JSON object matching this structure. Do not wrap the JSON in markdown code blocks or add any other text outside the JSON object.`;

    let lastError: Error | null = null;
    for (const model of AI_FALLBACK_MODELS) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:8080",
            "X-Title": "HealthSync AI",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "You output only clean JSON." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[Voice Rx] Model ${model} returned ${response.status}:`, errorText);
          continue;
        }

        const resJson = await response.json();
        const content = resJson.choices?.[0]?.message?.content;
        if (!content) continue;

        const parsed = cleanAndExtractJson(content);
        return {
          success: true,
          chiefComplaint: parsed.chiefComplaint || "",
          diagnosis: parsed.diagnosis || "",
          medications: Array.isArray(parsed.medications) ? parsed.medications : [],
          advice: parsed.advice || "",
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[Voice Rx] Failed with model ${model}:`, err.message);
      }
    }

    throw new Error(
      lastError?.message || "Failed to analyze transcript. Please check API credits or try again.",
    );
  });

export const sendPrescriptionEmailServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      patientEmail: string;
      patientName: string;
      doctorName?: string;
      clinicName?: string;
      chiefComplaint?: string;
      diagnosis?: string;
      medications: Array<{
        name: string;
        dosage: string;
        frequency: string;
        route?: string;
        duration: string;
        instructions?: string;
      }>;
      advice?: string;
    }) => {
      if (!data.patientEmail) throw new Error("Patient email address is required.");
      return data;
    },
  )
  .handler(async ({ data: input }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "clinical_records");

    const recipient = normalizeEmail(input.patientEmail);
    if (!isPlausibleEmail(recipient)) throw new Error("Please provide a valid patient email.");

    // Every client-supplied field is escaped before it reaches the HTML body:
    // unescaped, this was a branded open mail relay for arbitrary HTML.
    const data = {
      ...input,
      patientName: escapeHtml(input.patientName),
      doctorName: input.doctorName ? escapeHtml(input.doctorName) : "",
      chiefComplaint: input.chiefComplaint ? escapeHtml(input.chiefComplaint) : "",
      diagnosis: input.diagnosis ? escapeHtml(input.diagnosis) : "",
      advice: input.advice ? escapeHtml(input.advice).replace(/\n/g, "<br/>") : "",
      medications: (Array.isArray(input.medications) ? input.medications : []).map((m) => ({
        name: escapeHtml(m?.name),
        dosage: escapeHtml(m?.dosage),
        frequency: escapeHtml(m?.frequency),
        route: escapeHtml(m?.route),
        duration: escapeHtml(m?.duration),
        instructions: escapeHtml(m?.instructions),
      })),
    };

    const { transporter } = await import("./email");
    // The sender name comes from the workspace, never from the request.
    const profileRow = await queryOne<any>(
      "SELECT clinicName FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [user.tenantId],
    );
    const rawClinicName = profileRow?.clinicName || user.clinicName || "BookMyTime Healthcare";
    const clinicName = escapeHtml(rawClinicName);
    const doctorName = data.doctorName || escapeHtml(user.name) || "Attending Physician";

    const medsRows =
      data.medications && data.medications.length > 0
        ? data.medications
            .map(
              (m, i) => `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 8px; font-weight: 600; color: #1e293b;">${i + 1}. ${m.name}</td>
            <td style="padding: 10px 8px; color: #334155;">${m.dosage || "-"}</td>
            <td style="padding: 10px 8px; color: #334155;">${m.frequency || "-"}</td>
            <td style="padding: 10px 8px; color: #334155;">${m.duration || "-"}</td>
            <td style="padding: 10px 8px; color: #64748b; font-size: 11px;">${m.instructions || "-"}</td>
          </tr>
        `,
            )
            .join("")
        : `<tr><td colspan="5" style="padding: 12px; text-align: center; color: #94a3b8;">No medications listed.</td></tr>`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #0d9488, #0f766e); padding: 24px 28px; color: #ffffff;">
          <h1 style="margin: 0 0 4px; font-size: 22px; font-weight: 700;">${clinicName}</h1>
          <p style="margin: 0; font-size: 12px; opacity: 0.9;">Official Clinical Prescription &amp; Consultation Summary</p>
        </div>

        <div style="padding: 24px 28px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px;">
            <table style="width: 100%; font-size: 12px;">
              <tr>
                <td style="color: #64748b; width: 50%;"><strong>Patient:</strong> ${data.patientName}</td>
                <td style="color: #64748b; text-align: right;"><strong>Doctor:</strong> ${doctorName}</td>
              </tr>
              <tr>
                <td style="color: #64748b; padding-top: 6px;"><strong>Date:</strong> ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</td>
                <td style="color: #64748b; text-align: right; padding-top: 6px;"><strong>Diagnosis:</strong> ${data.diagnosis || "General Consultation"}</td>
              </tr>
            </table>
          </div>

          ${
            data.chiefComplaint
              ? `
            <div style="margin-bottom: 18px;">
              <h3 style="margin: 0 0 6px; font-size: 13px; font-weight: 700; color: #0f766e; text-transform: uppercase; letter-spacing: 0.5px;">Chief Complaint</h3>
              <p style="margin: 0; font-size: 13px; color: #334155; line-height: 1.5;">${data.chiefComplaint}</p>
            </div>
          `
              : ""
          }

          ${
            data.diagnosis
              ? `
            <div style="margin-bottom: 18px;">
              <h3 style="margin: 0 0 6px; font-size: 13px; font-weight: 700; color: #0f766e; text-transform: uppercase; letter-spacing: 0.5px;">Primary Diagnosis</h3>
              <p style="margin: 0; font-size: 13px; color: #334155; font-weight: 600; line-height: 1.5;">${data.diagnosis}</p>
            </div>
          `
              : ""
          }

          <div style="margin-bottom: 20px;">
            <h3 style="margin: 0 0 10px; font-size: 13px; font-weight: 700; color: #0f766e; text-transform: uppercase; letter-spacing: 0.5px;">Rx (Prescribed Medications)</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr style="background: #f1f5f9; text-align: left; font-size: 11px; color: #475569;">
                  <th style="padding: 8px;">Drug</th>
                  <th style="padding: 8px;">Dosage</th>
                  <th style="padding: 8px;">Frequency</th>
                  <th style="padding: 8px;">Duration</th>
                  <th style="padding: 8px;">Instructions</th>
                </tr>
              </thead>
              <tbody>
                ${medsRows}
              </tbody>
            </table>
          </div>

          ${
            data.advice
              ? `
            <div style="margin-bottom: 20px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px 18px;">
              <h3 style="margin: 0 0 6px; font-size: 12px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.5px;">Doctor's Advice &amp; Instructions</h3>
              <p style="margin: 0; font-size: 12px; color: #15803d; line-height: 1.6;">${data.advice}</p>
            </div>
          `
              : ""
          }

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px; text-align: center; font-size: 11px; color: #94a3b8;">
            <p style="margin: 0;">Prescription electronically generated by <strong>${doctorName}</strong> at <strong>${clinicName}</strong>.</p>
            <p style="margin: 4px 0 0;">Powered by BookMyTime Healthcare System</p>
          </div>
        </div>
      </div>
    `;

    // Strip characters that could break out of the quoted display name.
    const fromName = String(rawClinicName)
      .replace(/["\r\n<>]/g, "")
      .slice(0, 80);
    await transporter.sendMail({
      from: `"${fromName}" <${process.env.EMAIL_USERNAME}>`,
      to: recipient,
      bcc: process.env.EMAIL_BCC || undefined,
      subject: `Your Prescription & Consultation Summary — ${fromName}`,
      html: htmlContent,
    });

    return { success: true };
  });

export const savePrescriptionServerFn = createServerFn({ method: "POST" })
  .validator((data: { patientId: string; medications: any[]; notes?: string }) => {
    if (!data.patientId) throw new Error("Patient ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "clinical_records");
    await assertPatientRefInTenant(data.patientId, user.tenantId);
    const cryptoMod = await import("crypto");
    const id = cryptoMod.randomUUID();
    const medsJson = JSON.stringify(Array.isArray(data.medications) ? data.medications : []);
    await execute(
      `INSERT INTO Prescription (id, tenantId, patientId, medications, notes, createdAt) VALUES (?, ?, ?, ?, ?, NOW())`,
      [id, user.tenantId, data.patientId, medsJson, data.notes || null],
    );
    return { success: true, prescriptionId: id };
  });

export const getAppointmentsPagedServerFn = createServerFn({ method: "GET" })
  .validator(
    (data: {
      search?: string;
      status?: string;
      dateFilter?: string;
      page?: number;
      sortBy?: string;
      sortDir?: string;
      /** A specific calendar day, "YYYY-MM-DD". Overrides `dateFilter`. */
      date?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    const page = Math.max(1, Math.floor(Number(data.page) || 1));
    const pageSize = 20;
    const offset = (page - 1) * pageSize;
    const conditions: string[] = ["a.tenantId = ?"];
    const params: any[] = [user.tenantId];

    const isDoctor = user.role === "doctor" && user.doctorId;
    if (isDoctor) {
      conditions.push("a.doctorId = ?");
      params.push(user.doctorId);
    }

    // Search across name, email, phone, complaint, doctor and token. Every
    // whitespace-separated term must match, and all values stay bound.
    const search = buildAppointmentSearch(data.search);
    conditions.push(...search.clauses);
    params.push(...search.params);

    if (data.status && data.status !== "All") {
      conditions.push("a.status = ?");
      params.push(data.status);
    }

    if (isIsoDate(data.date)) {
      // The client sends its own local date, so "today" is the clinic's today
      // rather than the server's CURDATE().
      conditions.push("DATE(a.dateTime) = ?");
      params.push(data.date);
    } else {
      const dateClause = buildAppointmentDateFilter(data.dateFilter);
      if (dateClause) conditions.push(dateClause);
    }

    // The search predicate can reference `d.name`, so the JOIN has to be
    // present in the COUNT query too — otherwise searching by doctor threw.
    const from = "FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id";
    const where = `WHERE ${conditions.join(" AND ")}`;
    const orderBy = buildAppointmentOrderBy(data.sortBy, data.sortDir);

    const appointments = await query<any>(
      `SELECT a.*, d.name as doctorName ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const [countRow] = await query<any>(`SELECT COUNT(*) as total ${from} ${where}`, params);

    let summaryQuery = `SELECT COUNT(*) as total, SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status='Confirmed' THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END) as cancelled FROM Appointment WHERE tenantId = ?`;
    const summaryParams = [user.tenantId];
    if (isDoctor) {
      summaryQuery += " AND doctorId = ?";
      summaryParams.push(user.doctorId);
    }
    // Scope the stat cards to the selected day (but not to search/status, so
    // the per-status counts stay meaningful while filtering).
    if (isIsoDate(data.date)) {
      summaryQuery += " AND DATE(dateTime) = ?";
      summaryParams.push(data.date);
    }
    const [summary] = await query<any>(summaryQuery, summaryParams);

    return {
      appointments,
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      summary: {
        total: Number(summary?.total || 0),
        pending: Number(summary?.pending || 0),
        confirmed: Number(summary?.confirmed || 0),
        completed: Number(summary?.completed || 0),
        cancelled: Number(summary?.cancelled || 0),
      },
    };
  });

// ─────────────────────────────────────────────────────────────
// Sub-User Management (Reception / Doctor accounts per tenant)
// ─────────────────────────────────────────────────────────────

export const getSubUsersServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  assertCanPerform(user.role, "manage_users");
  const rows = await query<any>(
    "SELECT id, name, email, phone, role, doctorId, isActive, createdAt FROM SubUser WHERE tenantId = ? ORDER BY createdAt DESC",
    [user.tenantId],
  );
  return rows;
});

/**
 * Find any existing account that already owns `email` as a login.
 *
 * Checked globally because login resolves usernames across every tenant (see
 * account-email.ts). Precedence puts the caller's own workspace first so the
 * most actionable message wins. Comparison is trim + case-insensitive; the old
 * check used exact equality, so "Dr.Smith@Clinic.com" slipped past an existing
 * "dr.smith@clinic.com" in another tenant (or the owner account) entirely.
 */
async function findLoginEmailConflict(
  tenantId: string,
  email: string,
): Promise<EmailConflictKind | null> {
  const sameTenantSub = await queryOne<any>(
    "SELECT id FROM SubUser WHERE tenantId = ? AND LOWER(TRIM(email)) = ? LIMIT 1",
    [tenantId, email],
  );
  if (sameTenantSub) return "same_workspace_sub_user";

  const owner = await queryOne<any>("SELECT id FROM User WHERE LOWER(TRIM(email)) = ? LIMIT 1", [
    email,
  ]);
  if (owner) return "owner_account";

  const otherSub = await queryOne<any>(
    "SELECT id FROM SubUser WHERE LOWER(TRIM(email)) = ? LIMIT 1",
    [email],
  );
  if (otherSub) return "other_sub_user";

  const location = await queryOne<any>(
    "SELECT id FROM Location WHERE LOWER(TRIM(email)) = ? LIMIT 1",
    [email],
  );
  if (location) return "location_account";

  return null;
}

/**
 * Live availability check for the "Create New Sub-User" modal. Same auth as
 * creating a sub-user. Advisory only — createSubUserServerFn re-checks, so a
 * stale "available" can never produce a duplicate.
 */
export const checkSubUserEmailServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_users");

    const email = normalizeEmail(data?.email);
    if (!email || !isPlausibleEmail(email)) {
      return { available: false, message: "Enter a valid email address." };
    }
    const conflict = await findLoginEmailConflict(user.tenantId, email);
    return conflict
      ? { available: false, message: emailConflictMessage(conflict) }
      : { available: true, message: "" };
  });

export const createSubUserServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name: string;
      email: string;
      phone?: string;
      role: "reception" | "doctor";
      doctorId?: string;
      password: string;
    }) => {
      if (!data.name || !data.email || !data.role || !data.password)
        throw new Error("Name, email, role, and password are required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    // Only the owner mints staff logins. Previously any signed-in staff member
    // could create accounts — including a doctor login with a password of their
    // choosing, an escalation path into clinical features.
    assertCanPerform(user.role, "manage_users");
    if (data.role !== "reception" && data.role !== "doctor") throw new Error("Invalid role");
    if (String(data.password).length < 8) throw new Error("Password must be at least 8 characters");
    if (data.doctorId) await assertDoctorInTenant(data.doctorId, user.tenantId);

    // Email uniqueness first: it's about what the admin just typed, so it
    // should win over a plan-limit message.
    const email = normalizeEmail(data.email);
    if (!isPlausibleEmail(email)) throw new Error("Enter a valid email address.");
    const conflict = await findLoginEmailConflict(user.tenantId, email);
    if (conflict) throw new Error(emailConflictMessage(conflict));

    // Plan check for user limits
    const tenant = await queryOne<any>(
      "SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1",
      [user.tenantId],
    );
    const plan = tenant?.subscriptionPlan || "Trial";

    if (plan !== "Enterprise" && plan !== "Hospital") {
      const isBasic = plan === "Trial" || plan === "Basic" || plan === "Solo";

      if (data.role === "doctor") {
        const [docsCount] = await query<any>(
          "SELECT COUNT(*) as count FROM SubUser WHERE tenantId = ? AND role = 'doctor'",
          [user.tenantId],
        );
        const count = docsCount?.count || docsCount?.COUNT || 0;

        if (isBasic && Number(count) >= 1) {
          throw new Error(
            "Your current plan (Basic) allows only 1 Professional Dashboard. Please upgrade your plan.",
          );
        } else if (!isBasic && Number(count) >= 5) {
          throw new Error(
            "Your current plan (Premium) allows a maximum of 5 Professional Dashboards. Upgrade to Enterprise for unlimited.",
          );
        }
      } else if (data.role === "reception") {
        if (isBasic) {
          throw new Error(
            "Receptionist dashboards are only available on the Premium plan. Please upgrade your plan.",
          );
        }
      }
    }

    const hashed = await bcrypt.hash(data.password, 10);
    const id = crypto.randomUUID();
    try {
      await execute(
        `INSERT INTO SubUser (id, tenantId, name, email, phone, role, doctorId, password, isActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          id,
          user.tenantId,
          data.name.trim(),
          email, // stored normalized so future comparisons stay exact
          data.phone || null,
          data.role,
          data.doctorId || null,
          hashed,
        ],
      );
    } catch (err) {
      // Two admins submitting the same address at once: the UNIQUE
      // (tenantId, email) key rejects the loser. Surface the friendly message
      // instead of a raw "Duplicate entry" driver error.
      if (isDuplicateKeyError(err)) {
        throw new Error(emailConflictMessage("same_workspace_sub_user"));
      }
      throw err;
    }
    return { success: true, id };
  });

export const updateSubUserServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      name?: string;
      phone?: string;
      role?: string;
      doctorId?: string;
      password?: string;
      isActive?: number;
    }) => {
      if (!data.id) throw new Error("Sub-user ID required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    // Owner only: staff could reset a doctor's password and sign in as them,
    // deactivate colleagues, or promote themselves to doctor.
    assertCanPerform(user.role, "manage_users");
    if (data.role !== undefined && data.role !== "reception" && data.role !== "doctor") {
      throw new Error("Invalid role");
    }
    if (data.password && String(data.password).length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    if (data.doctorId) await assertDoctorInTenant(data.doctorId, user.tenantId);
    const target = await queryOne<any>(
      "SELECT id FROM SubUser WHERE id = ? AND tenantId = ? LIMIT 1",
      [data.id, user.tenantId],
    );
    if (!target) throw new Error("User not found or unauthorized");

    // Plan check for role updates
    if (data.role) {
      const existingSub = await queryOne<any>(
        "SELECT role FROM SubUser WHERE id = ? AND tenantId = ? LIMIT 1",
        [data.id, user.tenantId],
      );
      if (existingSub && existingSub.role !== data.role) {
        const tenant = await queryOne<any>(
          "SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1",
          [user.tenantId],
        );
        const plan = tenant?.subscriptionPlan || "Trial";

        if (plan !== "Enterprise" && plan !== "Hospital") {
          const isBasic = plan === "Trial" || plan === "Basic" || plan === "Solo";

          if (data.role === "doctor") {
            const [docsCount] = await query<any>(
              "SELECT COUNT(*) as count FROM SubUser WHERE tenantId = ? AND role = 'doctor'",
              [user.tenantId],
            );
            const count = docsCount?.count || docsCount?.COUNT || 0;

            if (isBasic && Number(count) >= 1) {
              throw new Error(
                "Your current plan (Basic) allows only 1 Professional Dashboard. Please upgrade your plan.",
              );
            } else if (!isBasic && Number(count) >= 5) {
              throw new Error(
                "Your current plan (Premium) allows a maximum of 5 Professional Dashboards.",
              );
            }
          } else if (data.role === "reception") {
            if (isBasic) {
              throw new Error(
                "Receptionist dashboards are only available on the Premium plan. Please upgrade your plan.",
              );
            }
          }
        }
      }
    }

    const fields: string[] = [];
    const params: any[] = [];

    if (data.name) {
      fields.push("name = ?");
      params.push(data.name);
    }
    if (data.phone !== undefined) {
      fields.push("phone = ?");
      params.push(data.phone || null);
    }
    if (data.role) {
      fields.push("role = ?");
      params.push(data.role);
    }
    if (data.doctorId !== undefined) {
      fields.push("doctorId = ?");
      params.push(data.doctorId || null);
    }
    if (data.isActive !== undefined) {
      fields.push("isActive = ?");
      params.push(data.isActive);
    }
    if (data.password) {
      const hashed = await bcrypt.hash(data.password, 10);
      fields.push("password = ?");
      params.push(hashed);
    }

    if (fields.length === 0) return { success: true };

    params.push(data.id, user.tenantId);
    await execute(`UPDATE SubUser SET ${fields.join(", ")} WHERE id = ? AND tenantId = ?`, params);
    return { success: true };
  });

export const deleteSubUserServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("Sub-user ID required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "manage_users");
    // Ownership first: the session delete used to run unscoped, so any id
    // force-logged-out another clinic's staff member.
    const target = await queryOne<any>(
      "SELECT id FROM SubUser WHERE id = ? AND tenantId = ? LIMIT 1",
      [id, user.tenantId],
    );
    if (!target) throw new Error("User not found or unauthorized");
    await execute("DELETE FROM SubUserSession WHERE subUserId = ?", [id]);
    await execute("DELETE FROM SubUser WHERE id = ? AND tenantId = ?", [id, user.tenantId]);
    return { success: true };
  });
export const subUserLoginServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; password: string; tenantId: string }) => {
    if (!data.email || !data.password || !data.tenantId)
      throw new Error("Email, password, and clinic ID are required");
    return data;
  })
  .handler(async ({ data }) => {
    const subUser = await queryOne<any>(
      "SELECT * FROM SubUser WHERE email = ? AND tenantId = ? LIMIT 1",
      [data.email, data.tenantId],
    );
    if (!subUser) throw new Error("No account found with this email in this clinic");
    if (!subUser.isActive)
      throw new Error("This account has been deactivated. Please contact your clinic admin.");

    const match = await bcrypt.compare(data.password, subUser.password);
    if (!match) throw new Error("Incorrect password");

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hrs
    await execute(
      "INSERT INTO SubUserSession (id, subUserId, token, expiresAt) VALUES (?, ?, ?, ?)",
      [crypto.randomUUID(), subUser.id, token, expiresAt],
    );

    await endOtherSessions("sub");
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie("sub_session_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });

    return {
      success: true,
      user: {
        id: subUser.id,
        name: subUser.name,
        email: subUser.email,
        role: subUser.role,
        tenantId: subUser.tenantId,
      },
    };
  });

// ──────────────────────────────────────────────
// Multi-Location Server Functions
// ──────────────────────────────────────────────

// Helper: derive normalized plan tier for location gating
function getLocationPlanTier(plan: string | null | undefined): "basic" | "premium" | "enterprise" {
  const p = (plan || "Trial").toString();
  if (p === "Enterprise" || p === "Hospital" || p === "Custom") return "enterprise";
  if (p === "Premium" || p === "Clinic") return "premium";
  return "basic";
}

export const getLocationsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  // Exposes branch login emails; owner and branches only.
  assertCanPerform(user.role, "view_locations");
  const rows = await query<any>(
    `SELECT id, name, address, city, state, pincode, phone, email, managerName, isActive, createdAt
       FROM Location WHERE tenantId = ? ORDER BY createdAt DESC`,
    [user.tenantId],
  );
  return rows;
});

export const getLocationLimitsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  const tenant = await queryOne<any>(
    "SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1",
    [user.tenantId],
  );
  const plan = tenant?.subscriptionPlan || "Trial";
  const tier = getLocationPlanTier(plan);
  const [countRow] = await query<any>("SELECT COUNT(*) as count FROM Location WHERE tenantId = ?", [
    user.tenantId,
  ]);
  const count = Number(countRow?.count || countRow?.COUNT || 0);
  let max: number | null;
  if (tier === "enterprise")
    max = null; // unlimited
  else if (tier === "premium") max = 1;
  else max = 0;
  return { plan, tier, count, max };
});

export const createLocationServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name: string;
      email: string;
      password: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      pincode?: string;
      managerName?: string;
    }) => {
      if (!data.name || !data.email || !data.password) {
        throw new Error("Location name, login email, and password are required");
      }
      if (!/\S+@\S+\.\S+/.test(data.email)) throw new Error("Please enter a valid email address");
      if (data.password.length < 8) throw new Error("Password must be at least 8 characters long");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role !== "admin") throw new Error("Only the workspace admin can create locations");

    // Plan gating
    const tenant = await queryOne<any>(
      "SELECT subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1",
      [user.tenantId],
    );
    const plan = tenant?.subscriptionPlan || "Trial";
    const tier = getLocationPlanTier(plan);

    if (tier === "basic") {
      throw new Error(
        "Multi-Location is not available on the Basic plan. Please upgrade to Premium or Enterprise.",
      );
    }

    const [countRow] = await query<any>(
      "SELECT COUNT(*) as count FROM Location WHERE tenantId = ?",
      [user.tenantId],
    );
    const count = Number(countRow?.count || countRow?.COUNT || 0);

    if (tier === "premium" && count >= 1) {
      throw new Error(
        "Your current plan (Premium) allows only 1 sub-location. Please upgrade to Enterprise to add more.",
      );
    }

    // Email must be globally unique across User and SubUser too, so login routing is unambiguous
    const existingUser = await queryOne<any>("SELECT id FROM User WHERE email = ? LIMIT 1", [
      data.email,
    ]);
    if (existingUser) throw new Error("This email is already in use by another account");
    const existingSub = await queryOne<any>("SELECT id FROM SubUser WHERE email = ? LIMIT 1", [
      data.email,
    ]);
    if (existingSub) throw new Error("This email is already in use by another sub-user");
    const existingLoc = await queryOne<any>(
      "SELECT id FROM Location WHERE tenantId = ? AND email = ? LIMIT 1",
      [user.tenantId, data.email],
    );
    if (existingLoc) throw new Error("A location with this login email already exists");

    const hashed = await bcrypt.hash(data.password, 10);
    const id = crypto.randomUUID();
    await execute(
      `INSERT INTO Location (id, tenantId, name, address, city, state, pincode, phone, email, password, managerName, isActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        user.tenantId,
        data.name,
        data.address || null,
        data.city || null,
        data.state || null,
        data.pincode || null,
        data.phone || null,
        data.email,
        hashed,
        data.managerName || null,
      ],
    );
    return { success: true, id };
  });

export const updateLocationServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      name?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      pincode?: string;
      managerName?: string;
      password?: string;
      isActive?: number;
    }) => {
      if (!data.id) throw new Error("Location ID is required");
      if (data.password && data.password.length < 8)
        throw new Error("Password must be at least 8 characters long");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role !== "admin") throw new Error("Only the workspace admin can update locations");

    const fields: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined) {
      fields.push("name = ?");
      params.push(data.name);
    }
    if (data.phone !== undefined) {
      fields.push("phone = ?");
      params.push(data.phone || null);
    }
    if (data.address !== undefined) {
      fields.push("address = ?");
      params.push(data.address || null);
    }
    if (data.city !== undefined) {
      fields.push("city = ?");
      params.push(data.city || null);
    }
    if (data.state !== undefined) {
      fields.push("state = ?");
      params.push(data.state || null);
    }
    if (data.pincode !== undefined) {
      fields.push("pincode = ?");
      params.push(data.pincode || null);
    }
    if (data.managerName !== undefined) {
      fields.push("managerName = ?");
      params.push(data.managerName || null);
    }
    if (data.isActive !== undefined) {
      fields.push("isActive = ?");
      params.push(data.isActive);
    }
    if (data.password) {
      const hashed = await bcrypt.hash(data.password, 10);
      fields.push("password = ?");
      params.push(hashed);
    }
    if (fields.length === 0) return { success: true };
    params.push(data.id, user.tenantId);
    await execute(`UPDATE Location SET ${fields.join(", ")} WHERE id = ? AND tenantId = ?`, params);
    return { success: true };
  });

export const deleteLocationServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => {
    if (!id) throw new Error("Location ID is required");
    return id;
  })
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    if (user.role !== "admin") throw new Error("Only the workspace admin can delete locations");
    await execute("DELETE FROM LocationSession WHERE locationId = ?", [id]);
    await execute("DELETE FROM Location WHERE id = ? AND tenantId = ?", [id, user.tenantId]);
    return { success: true };
  });

// ──────────────────────────────────────────────
// WhatsApp Hub Server Functions
// ──────────────────────────────────────────────

export const getWATemplatesServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  return query("SELECT * FROM WATemplate WHERE tenantId = ? ORDER BY createdAt DESC", [
    user.tenantId,
  ]);
});

export const saveWATemplateServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id?: string;
      name: string;
      category: string;
      headerType: string;
      headerText?: string | null;
      headerImageUrl?: string | null;
      bodyText: string;
      footerText?: string | null;
      ctaButtons?: any;
      quickReplyButtons?: any;
      variables?: any;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");

    const id = data.id || crypto.randomUUID();
    const ctaJson = data.ctaButtons ? JSON.stringify(data.ctaButtons) : null;
    const qrJson = data.quickReplyButtons ? JSON.stringify(data.quickReplyButtons) : null;
    const varsJson = data.variables ? JSON.stringify(data.variables) : null;

    if (data.id) {
      await execute(
        `UPDATE WATemplate SET 
          name = ?, category = ?, headerType = ?, headerText = ?, headerImageUrl = ?, 
          bodyText = ?, footerText = ?, ctaButtons = ?, quickReplyButtons = ?, variables = ? 
         WHERE id = ? AND tenantId = ?`,
        [
          data.name,
          data.category,
          data.headerType,
          data.headerText || null,
          data.headerImageUrl || null,
          data.bodyText,
          data.footerText || null,
          ctaJson,
          qrJson,
          varsJson,
          id,
          user.tenantId,
        ],
      );
    } else {
      await execute(
        `INSERT INTO WATemplate (
          id, tenantId, name, category, headerType, headerText, headerImageUrl, 
          bodyText, footerText, ctaButtons, quickReplyButtons, variables
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          user.tenantId,
          data.name,
          data.category,
          data.headerType,
          data.headerText || null,
          data.headerImageUrl || null,
          data.bodyText,
          data.footerText || null,
          ctaJson,
          qrJson,
          varsJson,
        ],
      );
    }
    return { success: true, id };
  });

export const deleteWATemplateServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");
    await execute("DELETE FROM WATemplate WHERE id = ? AND tenantId = ?", [id, user.tenantId]);
    return { success: true };
  });

export const getWACampaignsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  return query(
    `
      SELECT c.*, t.name as templateName 
      FROM WACampaign c
      LEFT JOIN WATemplate t ON c.templateId = t.id
      WHERE c.tenantId = ? ORDER BY c.createdAt DESC
    `,
    [user.tenantId],
  );
});

export const createWACampaignServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name: string;
      templateId: string | null;
      minDelaySec: number;
      maxDelaySec: number;
      dailyLimit: number;
      recipients: { phone: string; name?: string | null; variables?: any }[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");

    const campaignId = crypto.randomUUID();

    await execute(
      `INSERT INTO WACampaign (
        id, tenantId, name, templateId, status, totalRecipients, sentCount, failedCount, minDelaySec, maxDelaySec, dailyLimit
       ) VALUES (?, ?, ?, ?, 'draft', ?, 0, 0, ?, ?, ?)`,
      [
        campaignId,
        user.tenantId,
        data.name,
        data.templateId,
        data.recipients.length,
        data.minDelaySec,
        data.maxDelaySec,
        data.dailyLimit,
      ],
    );

    for (const r of data.recipients) {
      const recipientId = crypto.randomUUID();
      const varsJson = r.variables ? JSON.stringify(r.variables) : null;
      await execute(
        `INSERT INTO WACampaignRecipient (id, campaignId, phone, name, variables, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
        [recipientId, campaignId, r.phone, r.name || null, varsJson],
      );
    }

    return { success: true, campaignId };
  });

export const startWACampaignServerFn = createServerFn({ method: "POST" })
  .validator((campaignId: string) => campaignId)
  .handler(async ({ data: campaignId }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");

    const campaign = await queryOne<any>("SELECT * FROM WACampaign WHERE id = ? AND tenantId = ?", [
      campaignId,
      user.tenantId,
    ]);
    if (!campaign) throw new Error("Campaign not found");

    let template: any = null;
    if (campaign.templateId) {
      template = await queryOne<any>("SELECT * FROM WATemplate WHERE id = ? AND tenantId = ?", [
        campaign.templateId,
        user.tenantId,
      ]);
    }

    const recipients = await query<any>(
      "SELECT * FROM WACampaignRecipient WHERE campaignId = ? AND status = 'pending'",
      [campaignId],
    );

    if (recipients.length === 0) {
      throw new Error("No pending recipients in this campaign");
    }

    const messages = [];
    for (const r of recipients) {
      let body = template ? template.bodyText : "Hello";

      if (r.variables) {
        const variablesObj =
          typeof r.variables === "string" ? JSON.parse(r.variables) : r.variables;
        if (variablesObj && typeof variablesObj === "object") {
          for (const key of Object.keys(variablesObj)) {
            const replacement = String(variablesObj[key]);
            body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), replacement);
          }
        }
      }

      if (template && template.headerType === "text" && template.headerText) {
        body = `*${template.headerText}*\n\n` + body;
      }

      if (template && template.footerText) {
        body = body + `\n\n_${template.footerText}_`;
      }

      if (template && template.ctaButtons) {
        try {
          const ctas =
            typeof template.ctaButtons === "string"
              ? JSON.parse(template.ctaButtons)
              : template.ctaButtons;
          if (Array.isArray(ctas) && ctas.length > 0) {
            body += "\n\n-------------------";
            for (const btn of ctas) {
              if (btn.type === "url") {
                body += `\n🔗 *${btn.label}*: ${btn.value}`;
              } else if (btn.type === "phone") {
                body += `\n📞 *${btn.label}*: ${btn.value}`;
              }
            }
          }
        } catch (e) {
          console.error("Failed to parse ctaButtons in campaign send:", e);
        }
      }

      if (template && template.quickReplyButtons) {
        try {
          const qrs =
            typeof template.quickReplyButtons === "string"
              ? JSON.parse(template.quickReplyButtons)
              : template.quickReplyButtons;
          if (Array.isArray(qrs) && qrs.length > 0) {
            body += `\n\n💡 *Replies*: ` + qrs.map((q: string) => `"${q}"`).join(" | ");
          }
        } catch (e) {
          console.error("Failed to parse quickReplyButtons in campaign send:", e);
        }
      }

      const headerUrl = template?.headerImageUrl || null;

      messages.push({
        recipientId: r.id,
        phone: r.phone,
        body,
        mediaUrl: headerUrl,
      });
    }

    await enqueueWABulk(
      user.tenantId,
      campaignId,
      messages,
      campaign.minDelaySec,
      campaign.maxDelaySec,
    );

    return { success: true };
  });

export const pauseWACampaignServerFn = createServerFn({ method: "POST" })
  .validator((campaignId: string) => campaignId)
  .handler(async ({ data: campaignId }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");

    await pauseWACampaign(user.tenantId, campaignId);
    return { success: true };
  });

export const deleteWACampaignServerFn = createServerFn({ method: "POST" })
  .validator((campaignId: string) => campaignId)
  .handler(async ({ data: campaignId }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");

    try {
      await pauseWACampaign(user.tenantId, campaignId);
    } catch (_) {}

    const campaign = await queryOne<any>(
      "SELECT id FROM WACampaign WHERE id = ? AND tenantId = ? LIMIT 1",
      [campaignId, user.tenantId],
    );
    if (!campaign) throw new Error("Campaign not found or unauthorized");

    await execute("DELETE FROM WACampaignRecipient WHERE campaignId = ?", [campaignId]);
    await execute("DELETE FROM WACampaign WHERE id = ? AND tenantId = ?", [
      campaignId,
      user.tenantId,
    ]);

    return { success: true };
  });

export const getCampaignRecipientsServerFn = createServerFn({ method: "GET" })
  .validator((campaignId: string) => campaignId)
  .handler(async ({ data: campaignId }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");

    const campaign = await queryOne<any>(
      "SELECT id FROM WACampaign WHERE id = ? AND tenantId = ? LIMIT 1",
      [campaignId, user.tenantId],
    );
    if (!campaign) throw new Error("Campaign not found or unauthorized");

    return query("SELECT * FROM WACampaignRecipient WHERE campaignId = ?", [campaignId]);
  });

export const getWAAutoRepliesServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  return query(
    "SELECT * FROM WAAutoReply WHERE tenantId = ? ORDER BY priority DESC, createdAt DESC",
    [user.tenantId],
  );
});

export const saveWAAutoReplyServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id?: string;
      triggerKeyword: string;
      matchType: string;
      replyMessage: string;
      isActive: number;
      priority: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");

    const id = data.id || crypto.randomUUID();
    if (data.id) {
      await execute(
        `UPDATE WAAutoReply SET triggerKeyword = ?, matchType = ?, replyMessage = ?, isActive = ?, priority = ? 
         WHERE id = ? AND tenantId = ?`,
        [
          data.triggerKeyword,
          data.matchType,
          data.replyMessage,
          data.isActive,
          data.priority,
          id,
          user.tenantId,
        ],
      );
    } else {
      await execute(
        `INSERT INTO WAAutoReply (id, tenantId, triggerKeyword, matchType, replyMessage, isActive, priority) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          user.tenantId,
          data.triggerKeyword,
          data.matchType,
          data.replyMessage,
          data.isActive,
          data.priority,
        ],
      );
    }
    return { success: true, id };
  });

export const deleteWAAutoReplyServerFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");
    await execute("DELETE FROM WAAutoReply WHERE id = ? AND tenantId = ?", [id, user.tenantId]);
    return { success: true };
  });

export const sendBulkWAServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: { numbers: string[]; message: string; minDelay: number; maxDelay: number }) => data,
  )
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");

    const formattedMessages = data.numbers.map((num) => ({
      recipientId: crypto.randomUUID(),
      phone: num,
      body: data.message,
    }));

    await enqueueWABulk(user.tenantId, null, formattedMessages, data.minDelay, data.maxDelay);
    return { success: true, count: formattedMessages.length };
  });

export const getWACampaignStatsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");

  const totalCampaignsResult = await queryOne<any>(
    "SELECT COUNT(*) as count FROM WACampaign WHERE tenantId = ?",
    [user.tenantId],
  );
  const totalSentResult = await queryOne<any>(
    "SELECT SUM(sentCount) as sent, SUM(failedCount) as failed FROM WACampaign WHERE tenantId = ?",
    [user.tenantId],
  );
  const activeRulesResult = await queryOne<any>(
    "SELECT COUNT(*) as count FROM WAAutoReply WHERE tenantId = ? AND isActive = 1",
    [user.tenantId],
  );

  return {
    totalCampaigns: totalCampaignsResult?.count || totalCampaignsResult?.COUNT || 0,
    totalSent: totalSentResult?.sent || totalSentResult?.SENT || 0,
    totalFailed: totalSentResult?.failed || totalSentResult?.FAILED || 0,
    activeAutoReplies: activeRulesResult?.count || activeRulesResult?.COUNT || 0,
  };
});

export const uploadWATemplateHeaderImageServerFn = createServerFn({ method: "POST" })
  .validator((data: { base64: string }) => {
    if (!data.base64) throw new Error("No image data provided");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");

    const cloudinary = await import("cloudinary");
    const cloud = cloudinary.v2;
    cloud.config({
      cloud_name: process.env["CLOUDINARY_CLOUD_NAME"],
      api_key: process.env["CLOUDINARY_API_KEY"],
      api_secret: process.env["CLOUDINARY_API_SECRET"],
    });

    const result = await cloud.uploader.upload(data.base64, {
      folder: `bookmytime/whatsapp_templates/${user.tenantId}`,
      overwrite: true,
    });

    return { success: true, url: result.secure_url };
  });

export const generateWATemplateServerFn = createServerFn({ method: "POST" })
  .validator((data: { prompt: string }) => {
    if (!data.prompt) throw new Error("Prompt is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key is not configured in .env file.");
    }

    const aiPrompt = `You are a professional copywriting assistant specialized in creating WhatsApp Business message templates.
Based on the user's description, create a highly engaging and context-appropriate WhatsApp template.
User prompt/request: "${data.prompt}"

Provide the response in raw JSON format with the following keys:
- name: A URL-safe, snake_case, lowercase template name (maximum 30 characters, no spaces, e.g. "appointment_followup").
- category: One of "marketing", "utility", "greeting", "followup".
- headerType: One of "none", "text", "image" (default to "none" unless explicitly requested).
- headerText: Header text if headerType is "text", else null or empty.
- bodyText: The main message body text. Use variables like {{1}}, {{2}}, {{3}} for placeholders (e.g., patient name, appointment time, clinic name). Be clear and concise.
- footerText: Small footer text (e.g. "Reply STOP to unsubscribe" or "HealthSync AI Automated").
- ctaButtons: A JSON array of call-to-action buttons (maximum 2). Each button should have:
  - type: either "url" or "phone"
  - label: button text (e.g. "Visit Website", "Call Clinic")
  - value: URL string (starting with https://) or phone number
  If no buttons are appropriate, return an empty array [].
- quickReplyButtons: A JSON array of quick reply button labels (maximum 3, e.g. ["Confirm Slot", "Reschedule"]). If none, return [].

Only return a valid JSON object matching this structure. Do not wrap the JSON in markdown code blocks or add any other text outside the JSON object.`;

    try {
      const modelsToTry = [
        "google/gemini-2.5-flash",
        "openrouter/free",
        "deepseek/deepseek-r1:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "qwen/qwen-2.5-72b-instruct:free",
      ];

      let response: any = null;
      let resJson: any = null;
      let lastError: Error | null = null;

      for (let i = 0; i < modelsToTry.length; i++) {
        const model = modelsToTry[i];
        try {
          if (i > 0) {
            console.warn(`[AI Template Copilot] Trying fallback model: ${model}`);
          }
          const currentResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "http://localhost:8080",
              "X-Title": "HealthSync AI",
            },
            body: JSON.stringify({
              model: model,
              messages: [
                {
                  role: "system",
                  content:
                    "You are a professional copywriting assistant that outputs only clean JSON.",
                },
                { role: "user", content: aiPrompt },
              ],
              response_format: { type: "json_object" },
              max_tokens: 1000,
            }),
          });

          if (currentResponse.ok) {
            const bodyJson = await currentResponse.clone().json();
            if (bodyJson.error) {
              throw new Error(bodyJson.error.message || JSON.stringify(bodyJson.error));
            }
            response = currentResponse;
            resJson = bodyJson;
            break;
          } else {
            let errMsg = `Status ${currentResponse.status} ${currentResponse.statusText}`;
            try {
              const errJson = await currentResponse.clone().json();
              if (errJson?.error?.message) {
                errMsg = errJson.error.message;
              }
            } catch (_) {}
            throw new Error(errMsg);
          }
        } catch (err: any) {
          lastError = err;
          console.warn(`[AI Template Copilot] Model ${model} failed:`, err.message);
        }
      }

      if (!response || !resJson) {
        throw (
          lastError || new Error("Failed to generate template via AI with all available models.")
        );
      }
      const content = resJson.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from AI model.");
      }

      const generated = JSON.parse(content.trim());
      return {
        success: true,
        template: {
          name: generated.name || "custom_template",
          category: generated.category || "utility",
          headerType: generated.headerType || "none",
          headerText: generated.headerText || null,
          bodyText: generated.bodyText || "",
          footerText: generated.footerText || null,
          ctaButtons: Array.isArray(generated.ctaButtons) ? generated.ctaButtons : [],
          quickReplyButtons: Array.isArray(generated.quickReplyButtons)
            ? generated.quickReplyButtons
            : [],
        },
      };
    } catch (e: any) {
      console.error("Failed to generate WhatsApp template via AI:", e);
      throw new Error(e.message || "Failed to generate template via AI.");
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// AI SMART REPLY SERVER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const getWAAIStatusServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  const config = await queryOne<any>(
    "SELECT aiEnabled FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1",
    [user.tenantId],
  );
  return { aiEnabled: config?.aiEnabled === 1 || config?.aiEnabled === "1" };
});

export const toggleWAAIReplyServerFn = createServerFn({ method: "POST" })
  .validator((data: { enable: boolean }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    assertCanPerform(user.role, "whatsapp_operate");
    // Upsert the WhatsAppConfig row
    const existing = await queryOne<any>(
      "SELECT id FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1",
      [user.tenantId],
    );
    if (existing) {
      await execute("UPDATE WhatsAppConfig SET aiEnabled = ? WHERE tenantId = ?", [
        data.enable ? 1 : 0,
        user.tenantId,
      ]);
    } else {
      await execute(
        "INSERT INTO WhatsAppConfig (id, tenantId, isEnabled, aiEnabled) VALUES (?, ?, 0, ?)",
        [crypto.randomUUID(), user.tenantId, data.enable ? 1 : 0],
      );
    }
    return { success: true, aiEnabled: data.enable };
  });

export const getWAConversationsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  // Get distinct senders with the latest message snippet per sender
  const rows = await query<any>(
    `SELECT 
        senderPhone,
        MAX(senderName) as senderName,
        MAX(createdAt) as lastActivity,
        COUNT(*) as messageCount,
        SUBSTRING(
          (SELECT message FROM WAConversation c2 
           WHERE c2.senderPhone = c.senderPhone 
             AND c2.tenantId = c.tenantId 
           ORDER BY c2.createdAt DESC LIMIT 1),
          1, 100
        ) as lastMessage,
        (SELECT direction FROM WAConversation c3 
         WHERE c3.senderPhone = c.senderPhone 
           AND c3.tenantId = c.tenantId 
         ORDER BY c3.createdAt DESC LIMIT 1) as lastDirection
      FROM WAConversation c
      WHERE tenantId = ?
      GROUP BY senderPhone
      ORDER BY lastActivity DESC
      LIMIT 50`,
    [user.tenantId],
  );
  return rows;
});

export const getWAConversationHistoryServerFn = createServerFn({ method: "POST" })
  .validator((data: { phone: string }) => data)
  .handler(async ({ data }) => {
    const user = await verifySession();
    if (!user || !user.tenantId) throw new Error("Unauthorized");
    const rows = await query<any>(
      `SELECT id, senderPhone, senderName, direction, message, createdAt
       FROM WAConversation
       WHERE tenantId = ? AND senderPhone = ?
       ORDER BY createdAt ASC
       LIMIT 200`,
      [user.tenantId, data.phone],
    );
    return rows;
  });

// ─────────────────────────────────────────────────────────────────────────────
// CASHFREE PAYMENT GATEWAY SUBSCRIPTION RENEWAL SERVER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const getExpiredUserPlanDetailsServerFn = createServerFn({ method: "POST" })
  .validator((data: { username: string }) => data)
  .handler(async ({ data }) => {
    const user = await queryOne<any>(
      "SELECT id, name, email, phone, tenantId, subscriptionPlan, subscriptionExpiresAt, subscriptionStatus FROM User WHERE email = ? OR phone = ? LIMIT 1",
      [data.username, data.username],
    );
    if (!user) throw new Error("Account not found");
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      tenantId: user.tenantId,
      subscriptionPlan: user.subscriptionPlan,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      subscriptionStatus: user.subscriptionStatus,
    };
  });

/**
 * Writes/updates a row in PaymentHistory keyed by orderId. Used to record
 * every Cashfree payment attempt — pending, success, failed, and cancelled —
 * so the Super Admin dashboard has a complete transaction ledger. Never
 * throws: a logging failure must never block the underlying payment flow.
 */
async function upsertPaymentHistory(fields: {
  userId?: string | null;
  tenantId?: string | null;
  orderId: string;
  cfPaymentId?: string | null;
  plan?: string | null;
  amount: number;
  currency?: string;
  status: string;
  orderStatus?: string | null;
  paymentMode?: string | null;
  failureReason?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO PaymentHistory
         (id, userId, tenantId, orderId, cfPaymentId, plan, amount, currency, status, orderStatus, paymentMode, failureReason, customerName, customerEmail, customerPhone, gateway, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Cashfree', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         userId = COALESCE(?, userId),
         tenantId = COALESCE(?, tenantId),
         cfPaymentId = COALESCE(?, cfPaymentId),
         plan = COALESCE(?, plan),
         amount = ?,
         status = ?,
         orderStatus = COALESCE(?, orderStatus),
         paymentMode = COALESCE(?, paymentMode),
         failureReason = ?,
         customerName = COALESCE(?, customerName),
         customerEmail = COALESCE(?, customerEmail),
         customerPhone = COALESCE(?, customerPhone),
         updatedAt = NOW()`,
      [
        crypto.randomUUID(),
        fields.userId ?? null,
        fields.tenantId ?? null,
        fields.orderId,
        fields.cfPaymentId ?? null,
        fields.plan ?? null,
        fields.amount,
        fields.currency || "INR",
        fields.status,
        fields.orderStatus ?? null,
        fields.paymentMode ?? null,
        fields.failureReason ?? null,
        fields.customerName ?? null,
        fields.customerEmail ?? null,
        fields.customerPhone ?? null,
        // ON DUPLICATE KEY UPDATE params
        fields.userId ?? null,
        fields.tenantId ?? null,
        fields.cfPaymentId ?? null,
        fields.plan ?? null,
        fields.amount,
        fields.status,
        fields.orderStatus ?? null,
        fields.paymentMode ?? null,
        fields.failureReason ?? null,
        fields.customerName ?? null,
        fields.customerEmail ?? null,
        fields.customerPhone ?? null,
      ],
    );
  } catch (err: any) {
    console.warn(
      "[PaymentHistory] Failed to upsert record for order",
      fields.orderId,
      ":",
      err.message,
    );
  }
}

export const createCashfreeOrderServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: { username: string; planName: "Basic" | "Premium"; returnPath?: string }) => data,
  )
  .handler(async ({ data }) => {
    const user = await queryOne<any>(
      "SELECT id, name, email, phone, tenantId FROM User WHERE email = ? OR phone = ? LIMIT 1",
      [data.username, data.username],
    );
    if (!user) throw new Error("Account not found");

    const amount = data.planName === "Basic" ? 999 : 1499;
    const orderId = `order_renew_${user.tenantId}_${Date.now()}`;

    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    const environment = process.env.CASHFREE_ENV || "production";
    const host = environment === "production" ? "api.cashfree.com" : "sandbox.cashfree.com";

    // Resolve the origin the user actually came from (so the post-payment
    // redirect returns to the same host/port — e.g. localhost:8080 in dev,
    // https://bookmytime.tech in prod) instead of a hardcoded value. Falls back
    // to env/production defaults when no request headers are available.
    let origin =
      process.env.APP_ORIGIN ||
      (environment === "production" ? "https://bookmytime.tech" : "http://localhost:3000");
    try {
      const { getRequestHeaders } = await import("@tanstack/react-start/server");
      const headers = getRequestHeaders();
      const referer = headers.get("referer");
      const originHeader = headers.get("origin") || (referer ? new URL(referer).origin : null);
      if (originHeader) origin = originHeader;
    } catch {
      /* no request context — keep fallback */
    }

    // Callers may specify where the user should land after payment (e.g. their
    // dashboard). Default preserves the original /login renewal flow. Only
    // relative, same-origin paths are accepted to prevent open-redirects.
    let basePath = "/login";
    if (
      typeof data.returnPath === "string" &&
      data.returnPath.startsWith("/") &&
      !data.returnPath.startsWith("//")
    ) {
      basePath = data.returnPath;
    }
    const returnUrl = `${origin}${basePath}${basePath.includes("?") ? "&" : "?"}order_id=${orderId}`;

    const payload = {
      order_id: orderId,
      order_amount: amount,
      order_currency: "INR",
      customer_details: {
        customer_id: user.id,
        customer_phone: user.phone || "9999999999",
        customer_email: user.email,
        customer_name: user.name,
      },
      order_meta: {
        return_url: returnUrl,
      },
    };

    console.log(`[CASHFREE] Creating order ${orderId} on ${host} for plan ${data.planName}...`);

    try {
      const response = await fetch(`https://${host}/pg/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": appId ?? "",
          "x-client-secret": secretKey ?? "",
          "x-api-version": "2023-08-01",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[CASHFREE] Create Order API Error:", errorText);
        throw new Error(`Failed to initiate payment gateway: ${response.statusText}`);
      }

      const orderData = await response.json();
      console.log(
        `[CASHFREE] Order ${orderId} created successfully. Session ID: ${orderData.payment_session_id}`,
      );

      // Record the attempt immediately so it shows up in the admin ledger even
      // if the user abandons checkout before Cashfree ever reports a terminal
      // status (never blocks checkout — logging failures are swallowed).
      await upsertPaymentHistory({
        userId: user.id,
        tenantId: user.tenantId,
        orderId,
        plan: data.planName,
        amount,
        status: "PENDING",
        orderStatus: "ACTIVE",
        customerName: user.name,
        customerEmail: user.email,
        customerPhone: user.phone,
      });

      return {
        success: true,
        payment_session_id: orderData.payment_session_id,
        order_id: orderId,
        environment,
        return_url: returnUrl,
        amount,
      };
    } catch (err: any) {
      console.error("[CASHFREE] Exception creating order:", err);
      throw new Error(err.message || "Failed to create payment order");
    }
  });

/**
 * Maps a Cashfree `payment_group` to a human-readable label shown in the
 * dashboard's Payment Method card (e.g. "UPI", "Visa Card", "Net Banking").
 */
function formatCashfreePaymentMode(paymentGroup: string, paymentMethod: any): string {
  const group = (paymentGroup || "").toLowerCase();
  switch (group) {
    case "upi":
    case "upi_ppi":
    case "upi_ppi_offline":
    case "upi_credit_card":
      return "UPI";
    case "credit_card":
    case "credit_card_emi": {
      const network = paymentMethod?.card?.card_network || paymentMethod?.card?.card_type;
      return network ? `${network} Credit Card` : "Credit Card";
    }
    case "debit_card":
    case "debit_card_emi": {
      const network = paymentMethod?.card?.card_network || paymentMethod?.card?.card_type;
      return network ? `${network} Debit Card` : "Debit Card";
    }
    case "prepaid_card":
      return "Prepaid Card";
    case "net_banking":
      return "Net Banking";
    case "wallet":
      return "Wallet";
    case "pay_later":
      return "Pay Later";
    case "cardless_emi":
      return "Cardless EMI";
    case "bank_transfer":
      return "Bank Transfer";
    case "cash":
      return "Cash";
    case "paypal":
      return "PayPal";
    default:
      return "Cashfree";
  }
}

/**
 * Fetches all payment attempts for a Cashfree order and returns the most
 * recent one regardless of outcome (SUCCESS, FAILED, USER_DROPPED, PENDING).
 * Used to capture the actual payment mode and failure reason for the ledger.
 * Never throws — returns null on any lookup issue.
 */
async function getLatestCashfreePaymentAttempt(
  host: string,
  appId: string | undefined,
  secretKey: string | undefined,
  orderId: string,
): Promise<any | null> {
  try {
    const response = await fetch(`https://${host}/pg/orders/${orderId}/payments`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": appId || "",
        "x-client-secret": secretKey || "",
        "x-api-version": "2023-08-01",
      },
    });
    if (!response.ok) return null;

    const payments = await response.json();
    if (!Array.isArray(payments) || payments.length === 0) return null;

    return payments
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.payment_completion_time || b.payment_time).getTime() -
          new Date(a.payment_completion_time || a.payment_time).getTime(),
      )[0];
  } catch (err: any) {
    console.warn("[CASHFREE] Could not fetch payment attempts:", err.message);
    return null;
  }
}

export const verifyAndProcessPaymentServerFn = createServerFn({ method: "POST" })
  .validator((data: { orderId: string }) => data)
  .handler(async ({ data }) => {
    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    const environment = process.env.CASHFREE_ENV || "production";
    const host = environment === "production" ? "api.cashfree.com" : "sandbox.cashfree.com";

    console.log(`[CASHFREE] Verifying payment for order ${data.orderId}...`);

    try {
      const response = await fetch(`https://${host}/pg/orders/${data.orderId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": appId ?? "",
          "x-client-secret": secretKey ?? "",
          "x-api-version": "2023-08-01",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[CASHFREE] Get Order Status API Error:`, errorText);
        throw new Error(`Failed to fetch payment status from Cashfree: ${response.statusText}`);
      }

      const orderData = await response.json();
      const orderStatus = orderData.order_status;
      const orderAmount = Number(orderData.order_amount);

      console.log(
        `[CASHFREE] Order ${data.orderId} status: ${orderStatus}, amount: ${orderAmount}`,
      );

      if (orderStatus === "PAID") {
        const parts = data.orderId.split("_");
        let tenantId = "";
        if (parts[1] === "renew") {
          tenantId = parts[2];
        }

        if (!tenantId) {
          throw new Error("Invalid Order ID format: Could not extract tenant details.");
        }

        const user = await queryOne<any>(
          "SELECT id, name, email, clinicName, subscriptionStatus, subscriptionPlan FROM User WHERE tenantId = ? LIMIT 1",
          [tenantId],
        );
        if (!user) {
          throw new Error(`User not found for tenantId: ${tenantId}`);
        }

        const selectedPlan = orderAmount >= 1400 ? "Premium" : "Basic";

        // Detect the actual payment mode used (UPI, Card, Net Banking, Wallet,
        // etc.) by looking up the order's payment attempts. Falls back to a
        // generic "Cashfree" label if the lookup fails for any reason — this
        // must never block activation of a already-confirmed PAID order.
        const latestAttempt = await getLatestCashfreePaymentAttempt(
          host,
          appId,
          secretKey,
          data.orderId,
        );
        const paymentMethodLabel = latestAttempt
          ? formatCashfreePaymentMode(latestAttempt.payment_group, latestAttempt.payment_method)
          : "Cashfree";

        await execute(
          `UPDATE User 
           SET subscriptionStatus = 'Active', 
               subscriptionPlan = ?, 
               subscriptionExpiresAt = DATE_ADD(NOW(), INTERVAL 1 MONTH),
               paymentAmount = ?, 
               paymentMethod = ?, 
               billingInterval = 'monthly',
               updatedAt = NOW() 
           WHERE id = ?`,
          [selectedPlan, orderAmount, paymentMethodLabel, user.id],
        );

        console.log(
          `[CASHFREE] Updated User table for user ${user.id} to active plan ${selectedPlan}`,
        );

        // Insert SubscriptionHistory log
        await execute(
          `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
           VALUES (?, ?, ?, 'Active', ?, ?, ?, 'monthly', NOW(), 'Cashfree')`,
          [
            crypto.randomUUID(),
            user.id,
            user.subscriptionStatus || "Expired",
            user.subscriptionPlan || "Trial",
            selectedPlan,
            orderAmount,
          ],
        );

        // Record the successful (received) payment in the ledger.
        await upsertPaymentHistory({
          userId: user.id,
          tenantId,
          orderId: data.orderId,
          cfPaymentId: latestAttempt?.cf_payment_id ?? null,
          plan: selectedPlan,
          amount: orderAmount,
          status: "SUCCESS",
          orderStatus,
          paymentMode: paymentMethodLabel,
        });

        console.log(`[CASHFREE] Successfully recorded transaction log for order ${data.orderId}`);

        // Send a payment-received confirmation email on behalf of the portal.
        // Best-effort: never block/breaks the confirmed payment on email issues.
        if (user.email) {
          try {
            const paidOn = new Date().toLocaleString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            await sendBillingNotificationEmail({
              email: user.email,
              subject: `Payment received — BookMyTime ${selectedPlan} plan`,
              title: "Payment Received",
              message: `Hi ${user.name || "there"}, we've received your payment and your BookMyTime ${selectedPlan} subscription is now active. Thank you for choosing BookMyTime.`,
              tone: "success",
              details: [
                { label: "Plan", value: `${selectedPlan}` },
                {
                  label: "Amount Paid",
                  value: `Rs ${orderAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                },
                { label: "Payment Mode", value: paymentMethodLabel },
                { label: "Order ID", value: data.orderId },
                ...(latestAttempt?.cf_payment_id
                  ? [{ label: "Transaction ID", value: String(latestAttempt.cf_payment_id) }]
                  : []),
                { label: "Paid On", value: paidOn },
                { label: "Valid Till", value: "1 month from today" },
              ],
            });
            console.log(`[CASHFREE] Payment confirmation email sent to ${user.email}`);
          } catch (mailErr: any) {
            console.warn(`[CASHFREE] Failed to send payment confirmation email:`, mailErr.message);
          }
        }

        return {
          success: true,
          plan: selectedPlan,
          amount: orderAmount,
          tenantId,
        };
      } else {
        // Order did not result in a successful payment (FAILED, CANCELLED,
        // USER_DROPPED, EXPIRED, VOID, or still ACTIVE/pending). Record the
        // outcome in the ledger so it's visible to the Super Admin instead of
        // silently disappearing.
        const parts = data.orderId.split("_");
        const tenantId = parts[1] === "renew" ? parts[2] : null;
        const user = tenantId
          ? await queryOne<any>("SELECT id FROM User WHERE tenantId = ? LIMIT 1", [tenantId])
          : null;

        const latestAttempt = await getLatestCashfreePaymentAttempt(
          host,
          appId,
          secretKey,
          data.orderId,
        );
        const paymentMode = latestAttempt
          ? formatCashfreePaymentMode(latestAttempt.payment_group, latestAttempt.payment_method)
          : null;

        // Prefer the granular payment-attempt status (Cashfree reports
        // USER_DROPPED/CANCELLED/VOID/FAILED/PENDING/NOT_ATTEMPTED at the
        // payment level) over the coarser order-level status, so cancelled
        // checkouts are distinguished from genuine failures.
        const attemptStatus = (latestAttempt?.payment_status || "").toUpperCase();
        let ledgerStatus: string;
        if (
          attemptStatus === "USER_DROPPED" ||
          attemptStatus === "CANCELLED" ||
          attemptStatus === "VOID"
        ) {
          ledgerStatus = "CANCELLED";
        } else if (attemptStatus === "FAILED") {
          ledgerStatus = "FAILED";
        } else if (
          attemptStatus === "PENDING" ||
          attemptStatus === "NOT_ATTEMPTED" ||
          orderStatus === "ACTIVE"
        ) {
          ledgerStatus = "PENDING";
        } else if (orderStatus === "EXPIRED" || orderStatus === "TERMINATED") {
          ledgerStatus = "CANCELLED";
        } else {
          ledgerStatus = "FAILED";
        }

        const failureReason =
          latestAttempt?.payment_message ||
          latestAttempt?.error_details?.error_description ||
          `Order status: ${orderStatus}`;

        await upsertPaymentHistory({
          userId: user?.id ?? null,
          tenantId,
          orderId: data.orderId,
          cfPaymentId: latestAttempt?.cf_payment_id ?? null,
          amount: orderAmount,
          status: ledgerStatus,
          orderStatus,
          paymentMode,
          failureReason: ledgerStatus === "PENDING" ? null : failureReason,
        });

        return {
          success: false,
          status: orderStatus,
          message: `The payment is not completed. Current status: ${orderStatus}`,
        };
      }
    } catch (err: any) {
      console.error("[CASHFREE] Exception verifying payment:", err);
      throw new Error(err.message || "Failed to verify payment");
    }
  });

/**
 * Returns the signed-in user's one-time Cashfree payment history (from the
 * PaymentHistory ledger) so the billing view can list every transaction and
 * offer a downloadable/viewable invoice for each — including single-rupee
 * mandate/auth charges. Scoped strictly to the caller's tenant.
 */
export const getMyPaymentHistoryServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");

  const rows = await query<any>(
    `SELECT id, orderId, cfPaymentId, plan, amount, currency, status, orderStatus,
              paymentMode, failureReason, customerName, customerEmail, customerPhone,
              gateway, createdAt, updatedAt
       FROM PaymentHistory
       WHERE tenantId = ?
       ORDER BY createdAt DESC
       LIMIT 100`,
    [user.tenantId],
  );

  return { rows };
});
