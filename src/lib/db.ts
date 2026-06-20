import "dotenv/config";
import mariadb, { Pool, PoolConnection } from "mariadb";

/**
 * Direct MariaDB pool for auth operations.
 * Bypasses the Prisma adapter layer which has internal pool timeout issues.
 *
 * The raw pool has been confirmed to connect successfully on every test.
 */

const globalForPool = globalThis as unknown as {
  dbPool: Pool;
};

function createDbPool(): Pool {
  let dbHost = process.env.DB_HOST || "localhost";
  let dbPort = parseInt(process.env.DB_PORT || "3306");
  let dbUser = process.env.DB_USER || "root";
  let dbPassword = process.env.DB_PASSWORD || "";
  let dbName = process.env.DB_NAME || "bookmytime";

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith("mysql://")) {
    try {
      const parsedUrl = new URL(dbUrl);
      dbHost = parsedUrl.hostname;
      dbPort = parsedUrl.port ? parseInt(parsedUrl.port) : 3306;
      dbUser = decodeURIComponent(parsedUrl.username);
      dbPassword = decodeURIComponent(parsedUrl.password);
      dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
    } catch (e) {
      console.error("[DB] Failed to parse DATABASE_URL:", e);
    }
  }

  // Disable SSL for localhost/127.0.0.1 or when DB_SSL is explicitly set to false
  const useSsl = dbHost !== "localhost" && dbHost !== "127.0.0.1" && process.env.DB_SSL !== "false";

  return mariadb.createPool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 5,
    connectTimeout: 30000,
    acquireTimeout: 30000,
    idleTimeout: 60000,
    minimumIdle: 1,
  });
}

let pool: any = null;

if (typeof window === "undefined") {
  pool = globalForPool.dbPool || createDbPool();

  if (process.env.NODE_ENV !== "production") {
    globalForPool.dbPool = pool;
  }

  pool.on("error", (err: any) => {
    console.error("[DB Pool] Error:", err.message);
  });

  // Non-blocking connectivity check
  pool
    .getConnection()
    .then(async (conn: PoolConnection) => {
      console.log("[DB] ✅ Database connection established successfully");
      try {
        // ── 0. Core tables fallback creation ──
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS User (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) UNIQUE NULL,
              name VARCHAR(255) NOT NULL,
              email VARCHAR(255) UNIQUE NOT NULL,
              phone VARCHAR(255) UNIQUE NOT NULL,
              clinicName VARCHAR(255) NOT NULL,
              practiceSize VARCHAR(255) NOT NULL,
              password VARCHAR(255) NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/create User table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS Session (
              id VARCHAR(255) PRIMARY KEY,
              userId VARCHAR(255) NOT NULL,
              token VARCHAR(255) UNIQUE NOT NULL,
              expiresAt TIMESTAMP NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/create Session table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS OtpCode (
              id VARCHAR(255) PRIMARY KEY,
              email VARCHAR(255) NOT NULL,
              code VARCHAR(255) NOT NULL,
              expiresAt TIMESTAMP NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/create OtpCode table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS Appointment (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              name VARCHAR(255) NOT NULL,
              email VARCHAR(255) NOT NULL,
              phone VARCHAR(255) NOT NULL,
              dateTime DATETIME(3) NOT NULL,
              reason TEXT NOT NULL,
              status VARCHAR(50) DEFAULT 'Pending',
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_tenant (tenantId)
            )
          `);
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/create Appointment table:", err.message);
        }

        // Collation normalization will be run at the end of initialization after all tables are created

        try {
          const result = await conn.query(
            "UPDATE User SET tenantId = CONCAT('clinic-', SUBSTRING(MD5(id), 1, 6)) WHERE tenantId IS NULL"
          );
          if (result.affectedRows > 0) {
            console.log(`[DB] ✅ Self-healed ${result.affectedRows} user records with missing tenantId`);
          }
        } catch (tenantErr: any) {
          console.warn("[DB] ⚠️ Could not self-heal tenantId for User:", tenantErr.message);
        }

        // Create ClinicHours Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS ClinicHours (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              dayOfWeek INT NOT NULL,
              openTime VARCHAR(10) NOT NULL,
              closeTime VARCHAR(10) NOT NULL,
              isClosed TINYINT(1) DEFAULT 0,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY tenant_day (tenantId, dayOfWeek)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create ClinicHours table:", err.message);
        }

        // Create Department Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS Department (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              name VARCHAR(255) NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create Department table:", err.message);
        }

        // Create Doctor Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS Doctor (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              name VARCHAR(255) NOT NULL,
              email VARCHAR(255) NOT NULL,
              phone VARCHAR(255) NOT NULL,
              qualifications VARCHAR(255) NOT NULL,
              departmentId VARCHAR(255) NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create Doctor table:", err.message);
        }

        // Create ClinicProfile Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS ClinicProfile (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL UNIQUE,
              clinicName VARCHAR(255) NOT NULL,
              clinicianName VARCHAR(255) NOT NULL,
              phone VARCHAR(255) NOT NULL,
              practiceSize VARCHAR(255) NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create ClinicProfile table:", err.message);
        }

        // Create WhatsAppConfig Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS WhatsAppConfig (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL UNIQUE,
              phoneNumber VARCHAR(50) NULL,
              isEnabled TINYINT(1) DEFAULT 0,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create WhatsAppConfig table:", err.message);
        }


        // Create DoctorSchedule Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS DoctorSchedule (
              id VARCHAR(255) PRIMARY KEY,
              doctorId VARCHAR(255) NOT NULL,
              dayOfWeek INT NOT NULL,
              startTime VARCHAR(10) NOT NULL,
              endTime VARCHAR(10) NOT NULL,
              slotDuration INT DEFAULT 30,
              breaks JSON DEFAULT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY doc_day (doctorId, dayOfWeek)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create DoctorSchedule table:", err.message);
        }

        // Migrate: add breaks column if it doesn't exist
        try {
          await conn.query(`ALTER TABLE DoctorSchedule ADD COLUMN breaks JSON DEFAULT NULL`);
        } catch (_) { /* column already exists */ }

        // Create DoctorLeave Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS DoctorLeave (
              id VARCHAR(255) PRIMARY KEY,
              doctorId VARCHAR(255) NOT NULL,
              leaveDate DATE NOT NULL,
              reason VARCHAR(255),
              isHoliday TINYINT(1) DEFAULT 0,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY doc_leave_date (doctorId, leaveDate)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create DoctorLeave table:", err.message);
        }

        // Check and add columns to Appointment
        try {
          const apptCols: any[] = await conn.query(
            "SHOW COLUMNS FROM Appointment"
          );
          const colNames = apptCols.map((c: any) => c.Field || c.field || c.ColumnName || "");
          
          if (!colNames.includes("doctorId")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN doctorId VARCHAR(255) NULL");
            console.log("[DB] ✅ Added doctorId column to Appointment table");
          }
          if (!colNames.includes("timeSlot")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN timeSlot VARCHAR(50) NULL");
            console.log("[DB] ✅ Added timeSlot column to Appointment table");
          }
          if (!colNames.includes("patientId")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN patientId VARCHAR(255) NULL");
            console.log("[DB] ✅ Added patientId column to Appointment table");
          }
          if (!colNames.includes("whatsapp")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN whatsapp VARCHAR(50) NULL");
            console.log("[DB] ✅ Added whatsapp column to Appointment table");
          }
          if (!colNames.includes("appointmentType")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN appointmentType VARCHAR(50) NULL");
            console.log("[DB] ✅ Added appointmentType column to Appointment table");
          }
          if (!colNames.includes("tokenNo")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN tokenNo INT NULL");
            console.log("[DB] ✅ Added tokenNo column to Appointment table");
          }
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/alter Appointment columns:", err.message);
        }

        // Create Patient Table (production patient registry)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS Patient (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              patientNo VARCHAR(50) NOT NULL,
              name VARCHAR(255) NOT NULL,
              age INT,
              gender VARCHAR(20),
              phone VARCHAR(50),
              email VARCHAR(255),
              address TEXT,
              chiefComplaint TEXT,
              notes TEXT,
              dob VARCHAR(50) NULL,
              bloodGroup VARCHAR(20) NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_tenant (tenantId),
              UNIQUE KEY tenant_patno (tenantId, patientNo)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create Patient table:", err.message);
        }

        // Check and add columns to Patient
        try {
          const patCols: any[] = await conn.query(
            "SHOW COLUMNS FROM Patient"
          );
          const patColNames = patCols.map((c: any) => c.Field || c.field || c.ColumnName || "");
          
          if (!patColNames.includes("dob")) {
            await conn.query("ALTER TABLE Patient ADD COLUMN dob VARCHAR(50) NULL");
            console.log("[DB] ✅ Added dob column to Patient table");
          }
          if (!patColNames.includes("bloodGroup")) {
            await conn.query("ALTER TABLE Patient ADD COLUMN bloodGroup VARCHAR(20) NULL");
            console.log("[DB] ✅ Added bloodGroup column to Patient table");
          }
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/alter Patient columns:", err.message);
        }

        // Create SoapNote Table (AI Scribe persistence)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS SoapNote (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              patientId VARCHAR(255) NOT NULL,
              appointmentId VARCHAR(255) NULL,
              specialty VARCHAR(100),
              subjective TEXT,
              objective TEXT,
              assessment TEXT,
              plan TEXT,
              rawTranscript TEXT,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_patient (patientId),
              INDEX idx_tenant (tenantId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create SoapNote table:", err.message);
        }

        // Create Prescription Table (voice prescriptions persistence)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS Prescription (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              patientId VARCHAR(255) NOT NULL,
              medications JSON NOT NULL,
              notes TEXT,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_patient (patientId),
              INDEX idx_tenant (tenantId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create Prescription table:", err.message);
        }

        // Create SuperAdmin Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS SuperAdmin (
              id VARCHAR(255) PRIMARY KEY,
              name VARCHAR(255) NOT NULL,
              email VARCHAR(255) UNIQUE NOT NULL,
              password VARCHAR(255) NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create SuperAdmin table:", err.message);
        }

        // Create SuperAdminSession Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS SuperAdminSession (
              id VARCHAR(255) PRIMARY KEY,
              adminId VARCHAR(255) NOT NULL,
              token VARCHAR(255) UNIQUE NOT NULL,
              expiresAt TIMESTAMP NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create SuperAdminSession table:", err.message);
        }

        // Create SubscriptionHistory Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS SubscriptionHistory (
              id VARCHAR(255) PRIMARY KEY,
              userId VARCHAR(255) NOT NULL,
              previousStatus VARCHAR(50),
              newStatus VARCHAR(50) NOT NULL,
              previousPlan VARCHAR(50),
              newPlan VARCHAR(50) NOT NULL,
              amount DECIMAL(10,2) NOT NULL,
              billingInterval VARCHAR(50) NOT NULL,
              changedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              changedBy VARCHAR(255) DEFAULT 'System'
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create SubscriptionHistory table:", err.message);
        }

        // Create SubUser Table (reception / doctor sub-accounts per tenant)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS SubUser (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              name VARCHAR(255) NOT NULL,
              email VARCHAR(255) NOT NULL,
              phone VARCHAR(50),
              role ENUM('reception','doctor') NOT NULL DEFAULT 'reception',
              doctorId VARCHAR(255) DEFAULT NULL,
              password VARCHAR(255) NOT NULL,
              isActive TINYINT(1) DEFAULT 1,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY subuser_email (tenantId, email)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create SubUser table:", err.message);
        }

        // Create SubUserSession Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS SubUserSession (
              id VARCHAR(255) PRIMARY KEY,
              subUserId VARCHAR(255) NOT NULL,
              token VARCHAR(255) UNIQUE NOT NULL,
              expiresAt TIMESTAMP NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create SubUserSession table:", err.message);
        }

        // Create WATemplate Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS WATemplate (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              name VARCHAR(255) NOT NULL,
              category VARCHAR(50) DEFAULT 'marketing',
              headerType VARCHAR(50) DEFAULT 'none',
              headerText VARCHAR(255) NULL,
              headerImageUrl VARCHAR(500) NULL,
              bodyText TEXT NOT NULL,
              footerText VARCHAR(255) NULL,
              ctaButtons JSON NULL,
              quickReplyButtons JSON NULL,
              variables JSON NULL,
              isActive TINYINT(1) DEFAULT 1,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_tenant (tenantId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create WATemplate table:", err.message);
        }

        // Create WACampaign Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS WACampaign (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              name VARCHAR(255) NOT NULL,
              templateId VARCHAR(255) NULL,
              status VARCHAR(50) DEFAULT 'draft',
              totalRecipients INT DEFAULT 0,
              sentCount INT DEFAULT 0,
              failedCount INT DEFAULT 0,
              scheduledAt TIMESTAMP NULL,
              startedAt TIMESTAMP NULL,
              completedAt TIMESTAMP NULL,
              minDelaySec INT DEFAULT 10,
              maxDelaySec INT DEFAULT 25,
              dailyLimit INT DEFAULT 200,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_tenant (tenantId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create WACampaign table:", err.message);
        }

        // Create WACampaignRecipient Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS WACampaignRecipient (
              id VARCHAR(255) PRIMARY KEY,
              campaignId VARCHAR(255) NOT NULL,
              phone VARCHAR(50) NOT NULL,
              name VARCHAR(255) NULL,
              variables JSON NULL,
              status VARCHAR(50) DEFAULT 'pending',
              sentAt TIMESTAMP NULL,
              errorMsg VARCHAR(500) NULL,
              INDEX idx_campaign (campaignId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create WACampaignRecipient table:", err.message);
        }

        // Create WAAutoReply Table
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS WAAutoReply (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              triggerKeyword VARCHAR(255) NOT NULL,
              matchType VARCHAR(50) DEFAULT 'contains',
              replyMessage TEXT NOT NULL,
              isActive TINYINT(1) DEFAULT 1,
              priority INT DEFAULT 0,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_tenant (tenantId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create WAAutoReply table:", err.message);
        }

        // Check and add SaaS columns to User (Tenant) table
        try {
          const userCols: any[] = await conn.query("SHOW COLUMNS FROM User");
          const userColNames = userCols.map((c: any) => c.Field || c.field || c.ColumnName || "");
          
          if (!userColNames.includes("subscriptionStatus")) {
            await conn.query("ALTER TABLE User ADD COLUMN subscriptionStatus VARCHAR(50) DEFAULT 'Trialing'");
            console.log("[DB] ✅ Added subscriptionStatus column to User table");
          }
          if (!userColNames.includes("subscriptionPlan")) {
            await conn.query("ALTER TABLE User ADD COLUMN subscriptionPlan VARCHAR(50) DEFAULT 'Trial'");
            console.log("[DB] ✅ Added subscriptionPlan column to User table");
          }
          if (!userColNames.includes("subscriptionExpiresAt")) {
            await conn.query("ALTER TABLE User ADD COLUMN subscriptionExpiresAt TIMESTAMP NULL");
            console.log("[DB] ✅ Added subscriptionExpiresAt column to User table");
          }
          if (!userColNames.includes("paymentMethod")) {
            await conn.query("ALTER TABLE User ADD COLUMN paymentMethod VARCHAR(100) DEFAULT 'None'");
            console.log("[DB] ✅ Added paymentMethod column to User table");
          }
          if (!userColNames.includes("paymentAmount")) {
            await conn.query("ALTER TABLE User ADD COLUMN paymentAmount DECIMAL(10,2) DEFAULT 0.00");
            console.log("[DB] ✅ Added paymentAmount column to User table");
          }
          if (!userColNames.includes("billingInterval")) {
            await conn.query("ALTER TABLE User ADD COLUMN billingInterval VARCHAR(50) DEFAULT 'monthly'");
            console.log("[DB] ✅ Added billingInterval column to User table");
          }
          if (!userColNames.includes("virtualPhoneNumber")) {
            await conn.query("ALTER TABLE User ADD COLUMN virtualPhoneNumber VARCHAR(50) DEFAULT '+1 (415) 555-0100'");
            console.log("[DB] ✅ Added virtualPhoneNumber column to User table");
          }
          if (!userColNames.includes("callLimit")) {
            await conn.query("ALTER TABLE User ADD COLUMN callLimit INT DEFAULT 100");
            console.log("[DB] ✅ Added callLimit column to User table");
          }
          if (!userColNames.includes("callsHandled")) {
            await conn.query("ALTER TABLE User ADD COLUMN callsHandled INT DEFAULT 0");
            console.log("[DB] ✅ Added callsHandled column to User table");
          }
          if (!userColNames.includes("profilePhoto")) {
            await conn.query("ALTER TABLE User ADD COLUMN profilePhoto VARCHAR(500) NULL");
            console.log("[DB] ✅ Added profilePhoto column to User table");
          }
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/alter User columns:", err.message);
        }

        // Seed default SuperAdmin if none exists
        try {
          const adminCountResult = await conn.query("SELECT COUNT(*) as count FROM SuperAdmin");
          const adminCount = adminCountResult[0]?.count || adminCountResult[0]?.COUNT || 0;
          const bcrypt = await import("bcryptjs");
          const cryptoModule = await import("crypto");

          if (parseInt(adminCount) === 0) {
            const hashedPassword = await (bcrypt.default || bcrypt).hash("admin123", 10);
            const adminId = cryptoModule.randomUUID();
            await conn.query(
              "INSERT INTO SuperAdmin (id, name, email, password) VALUES (?, ?, ?, ?)",
              [adminId, "SaaS Owner", "admin@mediflow.ai", hashedPassword]
            );
            console.log("[DB] ✅ Seeded default super admin: admin@mediflow.ai / admin123");
          }

          // Sync or seed custom SUPER_ADMIN from .env if defined
          const envEmail = process.env.SUPER_ADMIN_EMAIL;
          const envPassword = process.env.SUPER_ADMIN_PASSWORD;
          if (envEmail && envPassword) {
            const customAdmin = await conn.query("SELECT id FROM SuperAdmin WHERE email = ? LIMIT 1", [envEmail]);
            const hashedEnvPassword = await (bcrypt.default || bcrypt).hash(envPassword, 10);
            if (customAdmin.length === 0) {
              const adminId = cryptoModule.randomUUID();
              await conn.query(
                "INSERT INTO SuperAdmin (id, name, email, password) VALUES (?, ?, ?, ?)",
                [adminId, "MediFlow Admin", envEmail, hashedEnvPassword]
              );
              console.log(`[DB] ✅ Seeded custom super admin from .env: ${envEmail}`);
            } else {
              // Update password to match env just in case it changed
              await conn.query("UPDATE SuperAdmin SET password = ? WHERE email = ?", [hashedEnvPassword, envEmail]);
              console.log(`[DB] ✅ Synced password for custom super admin from .env: ${envEmail}`);
            }
          }
        } catch (adminErr: any) {
          console.warn("[DB] ⚠️ Could not seed/sync default super admins:", adminErr.message);
        }

        // Normalize characters and collations across all tables to avoid mixed collation JOIN / comparison errors
        const tablesToNormalize = [
          "User", "Session", "OtpCode", "Appointment", "ClinicHours", "Department",
          "Doctor", "ClinicProfile", "WhatsAppConfig", "DoctorSchedule", "DoctorLeave",
          "Patient", "SoapNote", "Prescription", "SuperAdmin", "SuperAdminSession",
          "SubscriptionHistory", "SubUser", "SubUserSession", "WATemplate", "WACampaign",
          "WACampaignRecipient", "WAAutoReply"
        ];
        for (const tbl of tablesToNormalize) {
          try {
            await conn.query(`ALTER TABLE \`${tbl}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
          } catch (colErr: any) {
            console.warn(`[DB] ⚠️ Could not normalize collation for table ${tbl}:`, colErr.message);
          }
        }
        console.log("[DB] ✅ Normalized database character set and collation to utf8mb4_unicode_ci for all tables");

        console.log("[DB] ✅ Self-healing database tables verify completed");

      } catch (err: any) {
        console.error("[DB] ❌ Self-heal and schema setup failed:", err.message);
      }
      conn.release();
    })
    .catch((err: any) => {
      console.error("[DB] ❌ Failed to connect:", err.message);
    });
}

/**
 * Execute a query with automatic connection management.
 * Gets a connection from the pool, runs the query, then releases.
 */
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  let conn: PoolConnection | undefined;
  try {
    conn = await pool.getConnection();
    const rows = await conn!.query(sql, params);
    return rows as T[];
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Execute a single-row query.
 */
export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Execute an INSERT/UPDATE/DELETE and return the result metadata.
 */
export async function execute(sql: string, params?: any[]): Promise<{ affectedRows: number; insertId: any }> {
  let conn: PoolConnection | undefined;
  try {
    conn = await pool.getConnection();
    const result = await conn!.query(sql, params);
    return { affectedRows: result.affectedRows || 0, insertId: result.insertId };
  } finally {
    if (conn) conn.release();
  }
}

export { pool };
export default { query, queryOne, execute, pool };
