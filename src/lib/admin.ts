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
      adminEmail: process.env.SUPER_ADMIN_EMAIL || "admin@bookmytime.ai",
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
      return await disconnectWA("global");
    } else {
      return await initializeWA("global");
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
    const waStatus = await getWAStatus("global");

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

    // Insert new tenant as an active user by default
    await execute(
      `INSERT INTO User (id, tenantId, name, email, phone, clinicName, practiceSize, password, 
                         subscriptionStatus, subscriptionPlan, subscriptionExpiresAt, paymentMethod, paymentAmount, billingInterval,
                         createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', 'Trial', DATE_ADD(NOW(), INTERVAL 7 DAY), 'None', 0.00, 'monthly', NOW(), NOW())`,
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

    // Log initial active subscription log
    await execute(
      `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
       VALUES (?, ?, 'None', 'Active', 'None', 'Trial', 0.00, 'monthly', NOW(), 'System')`,
      [generateId(), userId]
    );

    return { success: true, tenantId, clinicName: data.clinicName, email: data.email, tempPassword: plainPassword };
  });

// ──────────────────────────────────────────────
// Toggle Tenant Status Server Function
// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// Delete Tenant Server Function
// ──────────────────────────────────────────────
export const deleteTenantServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("Tenant ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const user = await queryOne<any>("SELECT tenantId FROM User WHERE id = ? LIMIT 1", [data.id]);
    if (!user) throw new Error("Tenant not found");

    const tId = user.tenantId;
    if (tId) {
      // Clean up primary relational data
      await execute("DELETE FROM ClinicProfile WHERE tenantId = ?", [tId]);
      await execute("DELETE FROM SubUser WHERE tenantId = ?", [tId]);
      await execute("DELETE FROM Appointment WHERE tenantId = ?", [tId]);
      await execute("DELETE FROM Patient WHERE tenantId = ?", [tId]);
      await execute("DELETE FROM SoapNote WHERE tenantId = ?", [tId]);
      await execute("DELETE FROM WhatsAppConfig WHERE tenantId = ?", [tId]);
      await execute("DELETE FROM Doctor WHERE tenantId = ?", [tId]);
    }

    // Clean up base user and sessions
    await execute("DELETE FROM Session WHERE userId = ?", [data.id]);
    await execute("DELETE FROM SubscriptionHistory WHERE userId = ?", [data.id]);
    await execute("DELETE FROM User WHERE id = ?", [data.id]);

    return { success: true };
  });

export const toggleTenantStatusServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data.id) throw new Error("Tenant ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const prev = await queryOne<any>(
      "SELECT subscriptionStatus, subscriptionPlan FROM User WHERE id = ? LIMIT 1",
      [data.id]
    );

    if (!prev) throw new Error("Tenant not found");

    const newStatus = prev.subscriptionStatus === 'Active' ? 'Cancelled' : 'Active';

    await execute(
      "UPDATE User SET subscriptionStatus = ?, updatedAt = NOW() WHERE id = ?",
      [newStatus, data.id]
    );

    await execute(
      `INSERT INTO SubscriptionHistory (id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'monthly', NOW(), 'SuperAdmin')`,
      [
        generateId(),
        data.id,
        prev.subscriptionStatus,
        newStatus,
        prev.subscriptionPlan,
        prev.subscriptionPlan,
      ]
    );

    return { success: true, newStatus };
  });

// ──────────────────────────────────────────────
// Fetch Platform-wide Payment History (received/failed/cancelled/pending)
// ──────────────────────────────────────────────
export const getPaymentHistoryServerFn = createServerFn({ method: "GET" })
  .validator((data?: { status?: string; search?: string; limit?: number }) => data || {})
  .handler(async ({ data }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    const conditions: string[] = [];
    const params: any[] = [];

    if (data.status && data.status !== "all") {
      conditions.push("ph.status = ?");
      params.push(data.status);
    }
    if (data.search) {
      conditions.push("(ph.orderId LIKE ? OR ph.customerEmail LIKE ? OR ph.customerName LIKE ? OR ph.customerPhone LIKE ? OR ph.cfPaymentId LIKE ?)");
      const like = `%${data.search}%`;
      params.push(like, like, like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Number(data.limit) || 200, 1), 1000);

    const rows = await query<any>(
      `SELECT ph.id, ph.userId, ph.tenantId, ph.orderId, ph.cfPaymentId, ph.plan, ph.amount, ph.currency,
              ph.status, ph.orderStatus, ph.paymentMode, ph.failureReason,
              ph.customerName, ph.customerEmail, ph.customerPhone, ph.gateway,
              ph.createdAt, ph.updatedAt,
              u.clinicName
       FROM PaymentHistory ph
       LEFT JOIN User u ON u.tenantId COLLATE utf8mb4_unicode_ci = ph.tenantId COLLATE utf8mb4_unicode_ci
       ${where}
       ORDER BY ph.createdAt DESC
       LIMIT ?`,
      [...params, limit]
    );

    // Summary counts + totals for the header cards.
    const summary = await queryOne<any>(
      `SELECT
         COUNT(*) as totalCount,
         SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successCount,
         SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failedCount,
         SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelledCount,
         SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pendingCount,
         SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END) as totalReceived,
         SUM(CASE WHEN status = 'FAILED' THEN amount ELSE 0 END) as failedAmount,
         SUM(CASE WHEN status = 'CANCELLED' THEN amount ELSE 0 END) as cancelledAmount,
         SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END) as pendingAmount
       FROM PaymentHistory`
    );

    return {
      rows,
      summary: {
        totalCount: parseInt(summary?.totalCount || 0),
        successCount: parseInt(summary?.successCount || 0),
        failedCount: parseInt(summary?.failedCount || 0),
        cancelledCount: parseInt(summary?.cancelledCount || 0),
        pendingCount: parseInt(summary?.pendingCount || 0),
        totalReceived: parseFloat(summary?.totalReceived || 0),
        failedAmount: parseFloat(summary?.failedAmount || 0),
        cancelledAmount: parseFloat(summary?.cancelledAmount || 0),
        pendingAmount: parseFloat(summary?.pendingAmount || 0),
      },
    };
  });

// ──────────────────────────────────────────────
// Reconcile every non-terminal payment against Cashfree (real-time sync)
// ──────────────────────────────────────────────
// Pulls the live status/amount/mode/failure reason for orders that were never
// finalized locally (webhook not configured, user abandoned the return trip,
// etc.). SUCCESS is terminal and skipped. Never mutates user access — purely
// reconciles the ledger so the admin sees exact collected/failed/cancelled.
export const syncAllPaymentsFromCashfreeServerFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    // ── Step 1: Backfill ──
    // Some accounts are Active + paid (money collected by Cashfree) but have no
    // corresponding row in the PaymentHistory ledger — e.g. the payment was
    // completed but the return-trip verification never ran, the webhook was not
    // configured, or the activation predates ledger logging. For every such
    // account we synthesise a SUCCESS ledger entry from the stored account
    // payment fields so the collected revenue is always visible to the admin.
    // Idempotent: keyed on a deterministic backfill order id.
    let backfilled = 0;
    try {
      const paidUsers = await query<any>(
        `SELECT u.id, u.tenantId, u.name, u.email, u.phone, u.clinicName,
                u.subscriptionPlan, u.paymentAmount, u.paymentMethod, u.subscriptionExpiresAt, u.updatedAt
         FROM User u
         WHERE u.subscriptionStatus = 'Active' AND COALESCE(u.paymentAmount, 0) > 0
           AND NOT EXISTS (
             SELECT 1 FROM PaymentHistory ph
             WHERE ph.tenantId COLLATE utf8mb4_unicode_ci = u.tenantId COLLATE utf8mb4_unicode_ci
               AND ph.status = 'SUCCESS'
           )
         LIMIT 500`
      );

      for (const u of paidUsers) {
        try {
          await execute(
            `INSERT INTO PaymentHistory
               (id, userId, tenantId, orderId, plan, amount, currency, status, orderStatus, paymentMode, customerName, customerEmail, customerPhone, gateway, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, 'INR', 'SUCCESS', 'PAID', ?, ?, ?, ?, 'Cashfree', ?, NOW())
             ON DUPLICATE KEY UPDATE
               amount = VALUES(amount), status = 'SUCCESS', orderStatus = 'PAID',
               paymentMode = COALESCE(VALUES(paymentMode), paymentMode), updatedAt = NOW()`,
            [
              crypto.randomUUID(), u.id, u.tenantId, `backfill_${u.tenantId}`,
              u.subscriptionPlan || null, Number(u.paymentAmount) || 0,
              u.paymentMethod || "Cashfree", u.name || null, u.email || null, u.phone || null,
              u.updatedAt ? new Date(u.updatedAt) : new Date(),
            ]
          );
          backfilled++;
        } catch (e: any) {
          console.warn(`[AdminSync][backfill] Failed for tenant ${u.tenantId}:`, e.message);
        }
      }
    } catch (e: any) {
      console.warn("[AdminSync][backfill] Skipped:", e.message);
    }

    // ── Step 2: Reconcile non-terminal orders directly against Cashfree ──
    const pending = await query<any>(
      `SELECT orderId FROM PaymentHistory
       WHERE status <> 'SUCCESS' AND orderId IS NOT NULL AND orderId <> ''
         AND orderId NOT LIKE 'backfill_%'
       ORDER BY createdAt DESC
       LIMIT 300`
    );

    // Dynamically imported (not a static top-level import) so this server-only
    // module never gets pulled into the client bundle via auth.ts's other
    // exports (which include db.ts / dotenv — see incident where a static
    // import here leaked dotenv's Node-only code into the browser bundle).
    const { reconcileOrderPaymentHistory } = await import("./auth");

    let reconciled = 0;
    let promoted = 0; // became SUCCESS during this sync
    let failed = 0;

    for (const row of pending) {
      const result = await reconcileOrderPaymentHistory(row.orderId);
      if (result) {
        reconciled++;
        if (result === "SUCCESS") promoted++;
      } else {
        failed++;
      }
    }

    return {
      success: true,
      scanned: pending.length,
      reconciled,
      promoted,
      failed,
      backfilled,
    };
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

// ──────────────────────────────────────────────
// Fetch Full Tenant Profile Server Function
// ──────────────────────────────────────────────
export const getTenantFullProfileServerFn = createServerFn({ method: "GET" })
  .validator((userId: string) => {
    if (!userId) throw new Error("User ID is required");
    return userId;
  })
  .handler(async ({ data: userId }) => {
    const admin = await verifyAdminSession();
    if (!admin) throw new Error("Unauthorized");

    // 1. Fetch base User record
    const user = await queryOne<any>(
      "SELECT * FROM User WHERE id = ? LIMIT 1",
      [userId]
    );
    
    if (!user) throw new Error("Tenant not found");

    const tId = user.tenantId;

    // 2. Fetch ClinicProfile
    let profile = null;
    if (tId) {
      profile = await queryOne<any>(
        "SELECT * FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
        [tId]
      );
    }

    // 3. Aggregate metrics
    let docCount: any = { count: 0 }, patientCount: any = { count: 0 }, apptCount: any = { count: 0 }, soapCount: any = { count: 0 };
    if (tId) {
      const docRes = await query<any>("SELECT COUNT(*) as count FROM Doctor WHERE tenantId = ?", [tId]);
      if (docRes.length > 0) docCount = docRes[0];

      const patRes = await query<any>("SELECT COUNT(*) as count FROM Patient WHERE tenantId = ?", [tId]);
      if (patRes.length > 0) patientCount = patRes[0];

      const appRes = await query<any>("SELECT COUNT(*) as count FROM Appointment WHERE tenantId = ?", [tId]);
      if (appRes.length > 0) apptCount = appRes[0];

      const soapRes = await query<any>("SELECT COUNT(*) as count FROM SoapNote WHERE tenantId = ?", [tId]);
      if (soapRes.length > 0) soapCount = soapRes[0];
    }

    // 4. Fetch subscription history
    const history = await query<any>(
      `SELECT id, userId, previousStatus, newStatus, previousPlan, newPlan, amount, billingInterval, changedAt, changedBy
       FROM SubscriptionHistory 
       WHERE userId = ? 
       ORDER BY changedAt DESC`,
      [user.id]
    );

    return {
      user,
      profile: profile || null,
      metrics: {
        doctors: docCount?.count || docCount?.COUNT || 0,
        patients: patientCount?.count || patientCount?.COUNT || 0,
        appointments: apptCount?.count || apptCount?.COUNT || 0,
        soapNotes: soapCount?.count || soapCount?.COUNT || 0,
      },
      history
    };
  });
