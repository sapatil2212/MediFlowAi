import { createServerFn } from "@tanstack/react-start";
import { verifyAdminSession } from "./admin.server";
import { query, queryOne, execute } from "./db";
import bcrypt from "bcryptjs";
import crypto from "crypto";

function generateId(): string {
  return crypto.randomUUID();
}

// ──────────────────────────────────────────────
// Admin Session Verification Server Function
// ──────────────────────────────────────────────
export const getSuperAdminSessionServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    return await verifyAdminSession();
  });

// ──────────────────────────────────────────────
// Login Server Function
// ──────────────────────────────────────────────
export const loginSuperAdminServerFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; password: string; securityKey?: string }) => {
    if (!data.email || !data.password) throw new Error("Email and password are required");
    return data;
  })
  .handler(async ({ data }) => {
    // Validate administrative security key from .env
    const envKey = process.env.SUPER_ADMIN_SECURITY_KEY;
    if (envKey && data.securityKey !== envKey) {
      throw new Error("Invalid administrative security key");
    }

    const admin = await queryOne<any>(
      "SELECT id, name, email, password FROM SuperAdmin WHERE email = ? LIMIT 1",
      [data.email]
    );

    if (!admin) throw new Error("Invalid admin credentials");

    const match = await bcrypt.compare(data.password, admin.password);
    if (!match) throw new Error("Invalid admin credentials");

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

    await execute(
      "INSERT INTO SuperAdminSession (id, adminId, token, expiresAt) VALUES (?, ?, ?, ?)",
      [generateId(), admin.id, token, expiresAt]
    );

    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie("admin_session_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return {
      success: true,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
      }
    };
  });

// ──────────────────────────────────────────────
// Get Public Config Hint Server Function
// ──────────────────────────────────────────────
export const getAdminConfigServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    return {
      adminEmail: process.env.SUPER_ADMIN_EMAIL || "admin@mediflow.ai",
      hasSecurityKey: !!process.env.SUPER_ADMIN_SECURITY_KEY,
    };
  });

// ──────────────────────────────────────────────
// Control WhatsApp Session Server Function
// ──────────────────────────────────────────────
export const controlWhatsAppServerFn = createServerFn({ method: "POST" })
  .validator((data: { action: "disconnect" | "initialize" }) => {
    if (data.action !== "disconnect" && data.action !== "initialize") {
      throw new Error("Invalid action");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const { disconnectWA, initializeWA } = await import("./whatsapp");
    if (data.action === "disconnect") {
      return await disconnectWA();
    } else {
      return await initializeWA();
    }
  });

// ──────────────────────────────────────────────
// Logout Server Function
// ──────────────────────────────────────────────
export const logoutSuperAdminServerFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const { getCookie, deleteCookie } = await import("@tanstack/react-start/server");
    const token = getCookie("admin_session_token");

    if (token) {
      await execute("DELETE FROM SuperAdminSession WHERE token = ?", [token]);
      deleteCookie("admin_session_token", { path: "/" });
    }

    return { success: true };
  });

// ──────────────────────────────────────────────
// Get Dashboard Data Server Function
// ──────────────────────────────────────────────

export const getSuperAdminDashboardDataServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    // Measure DB latency
    const dbStart = Date.now();
    await query("SELECT 1");
    const dbLatency = Date.now() - dbStart;

    // Fetch SMTP status dynamically
    let smtpState = "OFFLINE";
    try {
      const { transporter } = await import("./email");
      await transporter.verify();
      smtpState = "CONNECTED";
    } catch (err: any) {
      console.warn("[SMTP Check] Failed:", err.message);
    }

    // Fetch WhatsApp status
    const { getWAStatus } = await import("./whatsapp");
    const waStatus = await getWAStatus();

    // Global platform activity counts
    const apptsCountResult = await queryOne<any>("SELECT COUNT(*) as count FROM Appointment");
    const totalAppointments = parseInt(apptsCountResult?.count || 0);

    const doctorsCountResult = await queryOne<any>("SELECT COUNT(*) as count FROM Doctor");
    const totalDoctors = parseInt(doctorsCountResult?.count || 0);

    const soapNotesCountResult = await queryOne<any>("SELECT COUNT(*) as count FROM SoapNote");
    const totalSoapNotes = parseInt(soapNotesCountResult?.count || 0);

    // Fetch all tenants
    const tenants = await query<any>(
      `SELECT id, name, email, phone, clinicName, practiceSize, tenantId,
              subscriptionStatus, subscriptionPlan, subscriptionExpiresAt,
              paymentMethod, paymentAmount, billingInterval,
              virtualPhoneNumber, callLimit, callsHandled, createdAt
       FROM User 
       ORDER BY createdAt DESC`
    );

    // MRR: Sum of monthly equivalents for active paid plans
    const mrrResult = await queryOne<any>(
      `SELECT SUM(
         CASE 
           WHEN billingInterval = 'yearly' THEN paymentAmount / 12 
           ELSE paymentAmount 
         END
       ) as total FROM User WHERE subscriptionStatus = 'Active'`
    );
    const totalMRR = parseFloat(mrrResult?.total || 0);

    // Call metrics
    const callsResult = await queryOne<any>(
      "SELECT SUM(callsHandled) as total FROM User"
    );
    const totalCallsHandled = parseInt(callsResult?.total || 0);

    // Calculate dynamic past 6 months cumulative signup trend
    const monthsList = [];
    const date = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
      monthsList.push({
        name: d.toLocaleString("en-US", { month: "short" }),
        month: d.getMonth(),
        year: d.getFullYear(),
      });
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    let baseCount = tenants.filter((t: any) => new Date(t.createdAt) < sixMonthsAgo).length;

    const signupTrends = monthsList.map(m => {
      const monthSignups = tenants.filter((t: any) => {
        const d = new Date(t.createdAt);
        return d.getMonth() === m.month && d.getFullYear() === m.year;
      }).length;
      baseCount += monthSignups;
      return {
        month: m.name,
        count: baseCount,
      };
    });

    return {
      tenants,
      signupTrends,
      metrics: {
        totalTenants: tenants.length,
        totalMRR,
        totalCallsHandled,
        activePaid: tenants.filter(t => t.subscriptionStatus === 'Active' && t.subscriptionPlan !== 'Trial').length,
        trialing: tenants.filter(t => t.subscriptionStatus === 'Trialing' || t.subscriptionPlan === 'Trial').length,
        totalAppointments,
        totalDoctors,
        totalSoapNotes,
        dbLatency,
        whatsappState: waStatus.state,
        whatsappQrUrl: waStatus.qrDataUrl,
        whatsappNumber: waStatus.connectedNumber,
        whatsappQueue: waStatus.queueCount,
        whatsappLogs: waStatus.sentLog || [],
        smtpState,
      }
    };
  });

// Update Tenant SaaS Settings Server Function
// ──────────────────────────────────────────────
export const updateTenantSaasServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    id: string;
    subscriptionStatus: string;
    subscriptionPlan: string;
    subscriptionExpiresAt: string | null;
    paymentMethod: string;
    paymentAmount: number;
    billingInterval: string;
    virtualPhoneNumber: string;
    callLimit: number;
    callsHandled: number;
  }) => {
    if (!data.id) throw new Error("Tenant ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const expiry = data.subscriptionExpiresAt ? new Date(data.subscriptionExpiresAt) : null;

    // Fetch previous status to log changes
    const prev = await queryOne<any>(
      "SELECT subscriptionStatus, subscriptionPlan FROM User WHERE id = ? LIMIT 1",
      [data.id]
    );

    await execute(
      `UPDATE User SET 
         subscriptionStatus = ?, 
         subscriptionPlan = ?, 
         subscriptionExpiresAt = ?, 
         paymentMethod = ?, 
         paymentAmount = ?, 
         billingInterval = ?, 
         virtualPhoneNumber = ?, 
         callLimit = ?, 
         callsHandled = ?,
         updatedAt = NOW()
       WHERE id = ?`,
      [
        data.subscriptionStatus,
        data.subscriptionPlan,
        expiry,
        data.paymentMethod,
        data.paymentAmount,
        data.billingInterval,
        data.virtualPhoneNumber,
        data.callLimit,
        data.callsHandled,
        data.id,
      ]
    );

    // Insert history record
    if (prev) {
      await execute(
        `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'SuperAdmin')`,
        [
          generateId(),
          data.id,
          prev.subscriptionStatus,
          data.subscriptionStatus,
          prev.subscriptionPlan,
          data.subscriptionPlan,
          data.paymentAmount,
          data.billingInterval
        ]
      );
    }

    return { success: true };
  });

// ──────────────────────────────────────────────
// Create Tenant (Clinician User) Server Function
// ──────────────────────────────────────────────
export const createTenantAdminServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    name: string;
    email: string;
    phone: string;
    clinicName: string;
    practiceSize: string;
    password?: string;
  }) => {
    if (!data.name || !data.email || !data.phone || !data.clinicName || !data.practiceSize) {
      throw new Error("Missing required fields");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    // Check email or phone duplicate
    const existing = await queryOne("SELECT id FROM User WHERE email = ? OR phone = ? LIMIT 1", [data.email, data.phone]);
    if (existing) {
      throw new Error("Clinic email or phone is already registered.");
    }

    const userId = generateId();
    const tenantId = "clinic-" + crypto.createHash("md5").update(userId).digest("hex").substring(0, 6);

    const plainPassword = data.password || "clinic123";
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // Insert new tenant as a default trialing user
    await execute(
      `INSERT INTO User (id, tenantId, name, email, phone, clinicName, practiceSize, password, 
                         subscriptionStatus, subscriptionPlan, subscriptionExpiresAt, paymentMethod, paymentAmount, billingInterval,
                         createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Trialing', 'Trial', DATE_ADD(NOW(), INTERVAL 30 DAY), 'None', 0.00, 'monthly', NOW(), NOW())`,
      [
        userId,
        tenantId,
        data.name,
        data.email,
        data.phone,
        data.clinicName,
        data.practiceSize,
        hashedPassword,
      ]
    );

    // Log initial trialing subscription log
    await execute(
      `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
       VALUES (?, ?, 'None', 'Trialing', 'None', 'Trial', 0.00, 'monthly', NOW(), 'System')`,
      [generateId(), userId]
    );

    return { success: true, tenantId, clinicName: data.clinicName, email: data.email, tempPassword: plainPassword };
  });

// ──────────────────────────────────────────────
// Fetch Subscription History for Clinic Server Function
// ──────────────────────────────────────────────
export const getSubscriptionHistoryServerFn = createServerFn({ method: "GET" })
  .validator((userId: string) => {
    if (!userId) throw new Error("User ID is required");
    return userId;
  })
  .handler(async ({ data: userId }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    return await query<any>(
      `SELECT id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy
       FROM SubscriptionHistory 
       WHERE userId = ? 
       ORDER BY changedAt DESC`,
      [userId]
    );
  });
