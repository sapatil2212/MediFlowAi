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
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || "15"),
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

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS DemoAppointment (
              id VARCHAR(255) PRIMARY KEY,
              referenceId VARCHAR(100) NOT NULL UNIQUE,
              name VARCHAR(255) NOT NULL,
              email VARCHAR(255) NOT NULL,
              phone VARCHAR(50) NOT NULL,
              organization VARCHAR(255) NOT NULL,
              city VARCHAR(120) NOT NULL,
              businessType VARCHAR(120) NOT NULL,
              teamSize VARCHAR(120) NOT NULL,
              preferredDate DATE NOT NULL,
              preferredTime VARCHAR(40) NOT NULL,
              preferredMode VARCHAR(60) NOT NULL,
              message TEXT NULL,
              status VARCHAR(50) DEFAULT 'New',
              adminNotes TEXT NULL,
              source VARCHAR(100) DEFAULT 'contact-page',
              lastContactedAt TIMESTAMP NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_demo_status (status),
              INDEX idx_demo_created (createdAt)
            )
          `);
        } catch (err: any) {
          console.warn("[DB] Could not verify/create DemoAppointment table:", err.message);
        }

        // Collation normalization will be run at the end of initialization after all tables are created

        try {
          const result = await conn.query(
            "UPDATE User SET tenantId = CONCAT('clinic-', SUBSTRING(MD5(id), 1, 6)) WHERE tenantId IS NULL",
          );
          if (result.affectedRows > 0) {
            console.log(
              `[DB] ✅ Self-healed ${result.affectedRows} user records with missing tenantId`,
            );
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
              designation VARCHAR(255) NULL,
              employeeId VARCHAR(255) NULL,
              joiningDate VARCHAR(255) NULL,
              subjectsTaught VARCHAR(255) NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create Doctor table:", err.message);
        }

        // Migrate: add extra teacher fields to Doctor if they don't exist
        try {
          await conn.query(`ALTER TABLE Doctor ADD COLUMN designation VARCHAR(255) NULL`);
        } catch (_) {}
        try {
          await conn.query(`ALTER TABLE Doctor ADD COLUMN employeeId VARCHAR(255) NULL`);
        } catch (_) {}
        try {
          await conn.query(`ALTER TABLE Doctor ADD COLUMN joiningDate VARCHAR(255) NULL`);
        } catch (_) {}
        try {
          await conn.query(`ALTER TABLE Doctor ADD COLUMN subjectsTaught VARCHAR(255) NULL`);
        } catch (_) {}

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

        // Migrate: add address column to ClinicProfile if it doesn't exist
        try {
          await conn.query(`ALTER TABLE ClinicProfile ADD COLUMN address VARCHAR(500) NULL`);
          console.log("[DB] ✅ Added address column to ClinicProfile table");
        } catch (_) {
          /* column already exists */
        }

        // Migrate: add rich info columns to ClinicProfile if they don't exist
        try {
          await conn.query(`ALTER TABLE ClinicProfile ADD COLUMN contactDetails VARCHAR(500) NULL`);
          console.log("[DB] ✅ Added contactDetails column to ClinicProfile table");
        } catch (_) {
          /* column already exists */
        }

        try {
          await conn.query(`ALTER TABLE ClinicProfile ADD COLUMN shortDescription TEXT NULL`);
          console.log("[DB] ✅ Added shortDescription column to ClinicProfile table");
        } catch (_) {
          /* column already exists */
        }

        try {
          await conn.query(`ALTER TABLE ClinicProfile ADD COLUMN services TEXT NULL`);
          console.log("[DB] ✅ Added services column to ClinicProfile table");
        } catch (_) {
          /* column already exists */
        }

        try {
          await conn.query(`ALTER TABLE ClinicProfile ADD COLUMN email VARCHAR(255) NULL`);
          console.log("[DB] ✅ Added email column to ClinicProfile table");
        } catch (_) {
          /* column already exists */
        }

        try {
          await conn.query(`ALTER TABLE ClinicProfile ADD COLUMN contactNo VARCHAR(50) NULL`);
          console.log("[DB] ✅ Added contactNo column to ClinicProfile table");
        } catch (_) {
          /* column already exists */
        }

        try {
          await conn.query(`ALTER TABLE ClinicProfile ADD COLUMN whatsappNo VARCHAR(50) NULL`);
          console.log("[DB] ✅ Added whatsappNo column to ClinicProfile table");
        } catch (_) {
          /* column already exists */
        }

        try {
          await conn.query(`ALTER TABLE ClinicProfile ADD COLUMN landlineNo VARCHAR(50) NULL`);
          console.log("[DB] ✅ Added landlineNo column to ClinicProfile table");
        } catch (_) {
          /* column already exists */
        }

        try {
          await conn.query(
            `ALTER TABLE ClinicProfile ADD COLUMN profession VARCHAR(100) DEFAULT 'Healthcare and medical' NULL`,
          );
          console.log("[DB] ✅ Added profession column to ClinicProfile table");
        } catch (_) {
          /* column already exists */
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
        } catch (_) {
          /* column already exists */
        }

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
          const apptCols: any[] = await conn.query("SHOW COLUMNS FROM Appointment");
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
          if (!colNames.includes("locationId")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN locationId VARCHAR(255) NULL");
            console.log("[DB] ✅ Added locationId column to Appointment table");
          }
          // Reminder-tracking flags (WhatsApp appointment reminders). Each is set
          // to 1 once the corresponding reminder has been sent so it never repeats.
          if (!colNames.includes("remDayBefore")) {
            await conn.query(
              "ALTER TABLE Appointment ADD COLUMN remDayBefore TINYINT(1) DEFAULT 0",
            );
            console.log("[DB] ✅ Added remDayBefore column to Appointment table");
          }
          if (!colNames.includes("remDayOf")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN remDayOf TINYINT(1) DEFAULT 0");
            console.log("[DB] ✅ Added remDayOf column to Appointment table");
          }
          if (!colNames.includes("rem2h")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN rem2h TINYINT(1) DEFAULT 0");
            console.log("[DB] ✅ Added rem2h column to Appointment table");
          }
          if (!colNames.includes("rem1h")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN rem1h TINYINT(1) DEFAULT 0");
            console.log("[DB] ✅ Added rem1h column to Appointment table");
          }
          // Set to 1 when time-ordered renumbering changes this appointment's
          // token AFTER the patient was already told the old number. The reminder
          // scheduler picks these up once per cycle and sends a single corrected
          // token message, which debounces a burst of bookings into one message.
          if (!colNames.includes("tokenNotifyPending")) {
            await conn.query(
              "ALTER TABLE Appointment ADD COLUMN tokenNotifyPending TINYINT(1) DEFAULT 0",
            );
            console.log("[DB] ✅ Added tokenNotifyPending column to Appointment table");
          }
          // Delivery channel of the consultation (in_person | video). This is a
          // separate axis from appointmentType, which holds the clinical category
          // ("First Time", "OPD") and is left untouched. NOT NULL DEFAULT
          // 'in_person' backfills every pre-existing appointment row.
          if (!colNames.includes("consultationMode")) {
            await conn.query(
              "ALTER TABLE Appointment ADD COLUMN consultationMode VARCHAR(32) NOT NULL DEFAULT 'in_person'",
            );
            console.log("[DB] ✅ Added consultationMode column to Appointment table");
          }
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/alter Appointment columns:", err.message);
        }

        // Index for tenant-scoped consultation-mode lookups. SHOW COLUMNS cannot
        // tell us whether an index exists, so this runs in its own try/catch.
        try {
          await conn.query(
            "ALTER TABLE Appointment ADD INDEX idx_apt_tenant_mode (tenantId, consultationMode)",
          );
          console.log("[DB] ✅ Added idx_apt_tenant_mode index to Appointment table");
        } catch (_) {
          /* index already exists */
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
          const patCols: any[] = await conn.query("SHOW COLUMNS FROM Patient");
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

        // ---------------------------------------------------------------
        // Video consultation tables (first-party WebRTC video feature).
        // These six tables hold only control-plane state: room lifecycle,
        // hashed join tokens, participant presence, short-lived signalling
        // messages, consent acknowledgements, and the audit trail.
        // Media (audio/video) is peer-to-peer and is NEVER persisted here
        // or anywhere else server-side.
        // ---------------------------------------------------------------

        // Create VideoRoom Table (one room per appointment)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoRoom (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              appointmentId VARCHAR(255) NOT NULL,
              doctorId VARCHAR(255) NULL,
              state VARCHAR(32) NOT NULL DEFAULT 'scheduled',
              joinOpensAt DATETIME(3) NULL,
              joinClosesAt DATETIME(3) NULL,
              tokenVersion INT NOT NULL DEFAULT 0,
              signalSeq INT NOT NULL DEFAULT 0,
              admittedParticipantId VARCHAR(255) NULL,
              admissionDecisionAt DATETIME(3) NULL,
              activatedAt DATETIME(3) NULL,
              endedAt DATETIME(3) NULL,
              endReason VARCHAR(64) NULL,
              outcome VARCHAR(32) NULL,
              connectedSeconds INT NOT NULL DEFAULT 0,
              disconnectedSinceAt DATETIME(3) NULL,
              disconnectedTotalMs INT NOT NULL DEFAULT 0,
              noticeVersion VARCHAR(32) NOT NULL DEFAULT 'v1',
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_room_appointment (appointmentId),
              KEY idx_room_tenant_state (tenantId, state),
              KEY idx_room_sweep (state, joinClosesAt)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoRoom table:", err.message);
        }

        // Migrate VideoRoom for ad-hoc ("instant" / "scheduled link") meetings that
        // are NOT tied to an Appointment row. appointmentId becomes nullable —
        // MySQL/MariaDB UNIQUE keys permit multiple NULLs, so the one-room-per-
        // appointment guarantee is preserved for real appointments while ad-hoc
        // rooms simply carry NULL.
        try {
          const vrCols: any[] = await conn.query("SHOW COLUMNS FROM VideoRoom");
          const vrColNames = vrCols.map((c: any) => c.Field || c.field || "");

          // Relax NOT NULL on appointmentId (safe/idempotent).
          try {
            await conn.query("ALTER TABLE VideoRoom MODIFY COLUMN appointmentId VARCHAR(255) NULL");
          } catch (_) {
            /* already nullable */
          }

          if (!vrColNames.includes("kind")) {
            await conn.query(
              "ALTER TABLE VideoRoom ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'appointment'",
            );
            console.log("[DB] ✅ Added kind column to VideoRoom table");
          }
          if (!vrColNames.includes("title")) {
            await conn.query("ALTER TABLE VideoRoom ADD COLUMN title VARCHAR(255) NULL");
          }
          if (!vrColNames.includes("meetingCode")) {
            await conn.query("ALTER TABLE VideoRoom ADD COLUMN meetingCode VARCHAR(32) NULL");
            try {
              await conn.query("ALTER TABLE VideoRoom ADD UNIQUE KEY uq_room_code (meetingCode)");
            } catch (_) {
              /* key exists */
            }
            console.log("[DB] ✅ Added meetingCode column to VideoRoom table");
          }
          if (!vrColNames.includes("scheduledAt")) {
            await conn.query("ALTER TABLE VideoRoom ADD COLUMN scheduledAt DATETIME(3) NULL");
          }
          if (!vrColNames.includes("hostAccountId")) {
            await conn.query("ALTER TABLE VideoRoom ADD COLUMN hostAccountId VARCHAR(255) NULL");
          }
          if (!vrColNames.includes("guestName")) {
            await conn.query("ALTER TABLE VideoRoom ADD COLUMN guestName VARCHAR(255) NULL");
          }
          if (!vrColNames.includes("guestPhone")) {
            await conn.query("ALTER TABLE VideoRoom ADD COLUMN guestPhone VARCHAR(50) NULL");
          }
          if (!vrColNames.includes("guestEmail")) {
            await conn.query("ALTER TABLE VideoRoom ADD COLUMN guestEmail VARCHAR(255) NULL");
          }
          // Instant meetings skip the waiting room when the host opts in.
          if (!vrColNames.includes("autoAdmit")) {
            await conn.query(
              "ALTER TABLE VideoRoom ADD COLUMN autoAdmit TINYINT(1) NOT NULL DEFAULT 0",
            );
          }
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/alter VideoRoom columns:", err.message);
        }

        // Create VideoJoinToken Table (join links, stored only as a one-way hash)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoJoinToken (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              roomId VARCHAR(255) NOT NULL,
              tokenHash VARCHAR(64) NOT NULL,
              version INT NOT NULL DEFAULT 1,
              purpose VARCHAR(32) NOT NULL DEFAULT 'created',
              issuedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              revokedAt DATETIME(3) NULL,
              lastUsedAt DATETIME(3) NULL,
              useCount INT NOT NULL DEFAULT 0,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uq_token_hash (tokenHash),
              KEY idx_token_room (roomId, revokedAt)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoJoinToken table:", err.message);
        }

        // Create VideoParticipant Table (presence as a set of rows, keeps multi-party open)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoParticipant (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              roomId VARCHAR(255) NOT NULL,
              role VARCHAR(32) NOT NULL,
              participantKey VARCHAR(64) NOT NULL,
              accountId VARCHAR(255) NULL,
              displayName VARCHAR(255) NULL,
              status VARCHAR(32) NOT NULL DEFAULT 'requested',
              peerState VARCHAR(32) NULL,
              micEnabled TINYINT(1) NOT NULL DEFAULT 1,
              cameraEnabled TINYINT(1) NOT NULL DEFAULT 1,
              quality VARCHAR(16) NULL,
              joinedAt DATETIME(3) NULL,
              admittedAt DATETIME(3) NULL,
              leftAt DATETIME(3) NULL,
              connectedMs INT NOT NULL DEFAULT 0,
              lastSeenAt DATETIME(3) NULL,
              lastPolledAt DATETIME(3) NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_participant_identity (roomId, participantKey),
              KEY idx_participant_room_role (roomId, role),
              KEY idx_participant_room_status (roomId, status)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoParticipant table:", err.message);
        }

        // Create VideoSignal Table (short-lived signalling mailbox, strict per-room total order)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoSignal (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              roomId VARCHAR(255) NOT NULL,
              seq INT NOT NULL,
              senderRole VARCHAR(32) NOT NULL,
              kind VARCHAR(32) NOT NULL,
              payload TEXT NOT NULL,
              createdAt TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
              UNIQUE KEY uq_signal_room_seq (roomId, seq),
              KEY idx_signal_room_seq (roomId, seq, senderRole)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoSignal table:", err.message);
        }

        // Create VideoConsent Table (recording/notice acknowledgement per room and notice version)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoConsent (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              roomId VARCHAR(255) NOT NULL,
              appointmentId VARCHAR(255) NOT NULL,
              participantId VARCHAR(255) NULL,
              noticeVersion VARCHAR(32) NOT NULL,
              tokenVersion INT NOT NULL DEFAULT 1,
              acknowledgedAt TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
              userAgentHash VARCHAR(64) NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              KEY idx_consent_room (roomId),
              UNIQUE KEY uq_consent_room_notice (roomId, noticeVersion, tokenVersion)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoConsent table:", err.message);
        }

        // Create VideoAuditEvent Table (append-only; detail is a short label, never SDP/ICE)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoAuditEvent (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              roomId VARCHAR(255) NOT NULL,
              appointmentId VARCHAR(255) NOT NULL,
              participantRole VARCHAR(32) NULL,
              kind VARCHAR(48) NOT NULL,
              detail VARCHAR(255) NULL,
              occurredAt TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              KEY idx_audit_room_time (roomId, occurredAt),
              KEY idx_audit_tenant_apt (tenantId, appointmentId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoAuditEvent table:", err.message);
        }

        // Ad-hoc (instant / share-link) rooms have no Appointment row, so the
        // audit and consent appointment columns must tolerate NULL. Runs after
        // both tables exist so it succeeds on a first boot too.
        try {
          await conn.query(
            "ALTER TABLE VideoAuditEvent MODIFY COLUMN appointmentId VARCHAR(255) NULL",
          );
        } catch (_) {
          /* already nullable */
        }
        try {
          await conn.query(
            "ALTER TABLE VideoConsent MODIFY COLUMN appointmentId VARCHAR(255) NULL",
          );
        } catch (_) {
          /* already nullable */
        }

        // Patients identify themselves before entering the waiting room so the
        // clinician knows who is knocking. Name reuses displayName; age is new.
        try {
          const vpCols: any[] = await conn.query("SHOW COLUMNS FROM VideoParticipant");
          const vpColNames = vpCols.map((c: any) => c.Field || c.field || "");
          if (!vpColNames.includes("displayAge")) {
            await conn.query("ALTER TABLE VideoParticipant ADD COLUMN displayAge INT NULL");
            console.log("[DB] ✅ Added displayAge column to VideoParticipant table");
          }
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/alter VideoParticipant columns:", err.message);
        }

        // ---------------------------------------------------------------
        // Restaurant & dining tables (sixth business category).
        // Additive only: four new tables plus four nullable Appointment
        // columns. Nothing existing is dropped, retyped, or tightened, and
        // ClinicHours is neither read nor written here — restaurant
        // operating hours live in their own RestaurantHours table so the
        // five existing categories keep computing slots exactly as before.
        // Charset/collation is pinned to utf8mb4 / utf8mb4_unicode_ci to
        // match the surrounding tables, which also makes table-name
        // uniqueness case-insensitive.
        // ---------------------------------------------------------------

        // Create RestaurantTable Table (dining tables; locationId NULL = primary location)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS RestaurantTable (
              id            VARCHAR(255) PRIMARY KEY,
              tenantId      VARCHAR(255) NOT NULL,
              locationId    VARCHAR(255) NULL,
              name          VARCHAR(40)  NOT NULL,
              seatCapacity  INT          NOT NULL,
              area          VARCHAR(30)  NOT NULL DEFAULT 'Main',
              displayOrder  INT          NOT NULL DEFAULT 1,
              state         VARCHAR(16)  NOT NULL DEFAULT 'active',
              createdAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_resto_table_name (tenantId, name),
              KEY idx_resto_table_tenant (tenantId, state),
              KEY idx_resto_table_loc (tenantId, locationId)
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create RestaurantTable table:", err.message);
        }

        // Create RestaurantSettings Table (one row per tenant; defaults carry the spec defaults)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS RestaurantSettings (
              id                   VARCHAR(255) PRIMARY KEY,
              tenantId             VARCHAR(255) NOT NULL UNIQUE,
              slotInterval         INT NOT NULL DEFAULT 30,
              turnTime             INT NOT NULL DEFAULT 90,
              maxPartySize         INT NOT NULL DEFAULT 12,
              advanceBookingWindow INT NOT NULL DEFAULT 60,
              minLeadTime          INT NOT NULL DEFAULT 30,
              timezone             VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
              createdAt            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create RestaurantSettings table:", err.message);
        }

        // Create RestaurantHours Table (dayOfWeek 0 = Sunday, matching ClinicHours)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS RestaurantHours (
              id        VARCHAR(255) PRIMARY KEY,
              tenantId  VARCHAR(255) NOT NULL,
              dayOfWeek INT NOT NULL,
              openTime  VARCHAR(5) NOT NULL,
              closeTime VARCHAR(5) NOT NULL,
              isClosed  TINYINT(1) NOT NULL DEFAULT 0,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_resto_hours (tenantId, dayOfWeek)
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create RestaurantHours table:", err.message);
        }

        // Create RestaurantTokenCounter Table. The (tenantId, bookingDate)
        // primary key is the concurrency guarantee: INSERT ... ON DUPLICATE KEY
        // UPDATE lastToken = lastToken + 1 is atomic, so two concurrent bookings
        // on the same tenant and date can never read the same token.
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS RestaurantTokenCounter (
              tenantId    VARCHAR(255) NOT NULL,
              bookingDate DATE NOT NULL,
              lastToken   INT NOT NULL DEFAULT 0,
              PRIMARY KEY (tenantId, bookingDate)
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create RestaurantTokenCounter table:", err.message);
        }

        // Restaurant settings parity tables. Each statement is isolated so one
        // unavailable record type cannot hide failures for the remaining types.
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS RestaurantDiningArea (
              id           VARCHAR(255) PRIMARY KEY,
              tenantId     VARCHAR(255) NOT NULL,
              locationId   VARCHAR(255) NULL,
              name         VARCHAR(30) NOT NULL,
              displayOrder INT NOT NULL DEFAULT 1,
              createdAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_area_tenant_name (tenantId, name),
              KEY idx_area_scope_order (tenantId, locationId, displayOrder, name)
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create RestaurantDiningArea table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS RestaurantClosureDay (
              id           VARCHAR(255) PRIMARY KEY,
              tenantId     VARCHAR(255) NOT NULL,
              locationId   VARCHAR(255) NULL,
              locationKey  VARCHAR(255) NOT NULL,
              closureDate  DATE NOT NULL,
              scopeType    VARCHAR(16) NOT NULL,
              tableId      VARCHAR(255) NULL,
              scopeKey     VARCHAR(255) NOT NULL,
              reason       VARCHAR(100) NOT NULL DEFAULT '',
              isHoliday    TINYINT(1) NOT NULL DEFAULT 0,
              createdAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_closure (tenantId, locationKey, closureDate, scopeKey),
              KEY idx_closure_month (tenantId, locationId, closureDate),
              KEY idx_closure_table (tenantId, locationId, tableId, closureDate)
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create RestaurantClosureDay table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS RestaurantMenuCategory (
              id           VARCHAR(255) PRIMARY KEY,
              tenantId     VARCHAR(255) NOT NULL,
              locationId   VARCHAR(255) NULL,
              name         VARCHAR(40) NOT NULL,
              displayOrder INT NOT NULL DEFAULT 1,
              createdAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_menu_category_name (tenantId, name),
              KEY idx_menu_category_scope (tenantId, locationId, displayOrder, name)
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create RestaurantMenuCategory table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS RestaurantMenuItem (
              id           VARCHAR(255) PRIMARY KEY,
              tenantId     VARCHAR(255) NOT NULL,
              locationId   VARCHAR(255) NULL,
              categoryId   VARCHAR(255) NOT NULL,
              name         VARCHAR(80) NOT NULL,
              priceMinor   INT NOT NULL,
              description  VARCHAR(300) NOT NULL DEFAULT '',
              displayOrder INT NOT NULL DEFAULT 1,
              state        VARCHAR(16) NOT NULL DEFAULT 'available',
              createdAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              -- Index budget: InnoDB caps a key at 3072 bytes and utf8mb4 costs
              -- 4 bytes per character, so three VARCHAR(255) identifier columns
              -- (3 x 1020 = 3060) is the whole budget. displayOrder/name are
              -- deliberately excluded: listMenu sorts on LOWER(item.name), which
              -- no index can satisfy, so the tail only overflowed the limit and
              -- left the table uncreated.
              KEY idx_menu_item_category (tenantId, locationId, categoryId),
              KEY idx_menu_item_public (tenantId, locationId, state)
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create RestaurantMenuItem table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS AccountEmailVerification (
              id                VARCHAR(255) PRIMARY KEY,
              accountType       VARCHAR(16) NOT NULL,
              accountId         VARCHAR(255) NOT NULL,
              targetEmail       VARCHAR(255) NOT NULL,
              codeHash          VARCHAR(255) NOT NULL,
              expiresAt         TIMESTAMP NOT NULL,
              resendAvailableAt TIMESTAMP NOT NULL,
              consumedAt        TIMESTAMP NULL,
              createdAt         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              KEY idx_email_verify_account (accountType, accountId, consumedAt, expiresAt),
              KEY idx_email_verify_target (targetEmail)
            ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create AccountEmailVerification table:", err.message);
        }

        // Existing tables receive nullable compatibility columns without
        // rewriting legacy area strings or any booking data.
        try {
          const tableCols: any[] = await conn.query("SHOW COLUMNS FROM RestaurantTable");
          const tableColNames = tableCols.map((c: any) => c.Field || c.field || c.ColumnName || "");
          if (!tableColNames.includes("areaId")) {
            await conn.query("ALTER TABLE RestaurantTable ADD COLUMN areaId VARCHAR(255) NULL");
            console.log("[DB] ✅ Added areaId column to RestaurantTable table");
          }
        } catch (err: any) {
          console.error("[DB] ❌ Could not verify/add RestaurantTable.areaId:", err.message);
        }

        try {
          const areaIndexes: any[] = await conn.query(
            "SHOW INDEX FROM RestaurantTable WHERE Key_name = 'idx_resto_table_area'",
          );
          if (!areaIndexes || areaIndexes.length === 0) {
            await conn.query(
              "ALTER TABLE RestaurantTable ADD INDEX idx_resto_table_area (tenantId, locationId, areaId)",
            );
            console.log("[DB] ✅ Added idx_resto_table_area index to RestaurantTable table");
          }
        } catch (err: any) {
          console.error("[DB] ❌ Could not verify/add RestaurantTable area index:", err.message);
        }

        // Backfill one canonical registry row for every non-blank legacy area in
        // its original tenant/location scope. IDs and display orders depend only
        // on canonical source values, while INSERT IGNORE makes retries harmless
        // when an earlier startup completed all or part of this step. The binary
        // tie-breaker makes casing deterministic after case-insensitive grouping.
        try {
          const areaBackfillResult = await conn.query(`
            INSERT IGNORE INTO RestaurantDiningArea
              (id, tenantId, locationId, name, displayOrder)
            SELECT
              CONCAT(
                'legacy-area-',
                LEFT(
                  SHA2(
                    CONCAT(
                      ranked.tenantId,
                      ':',
                      COALESCE(ranked.locationId, '__primary__'),
                      ':',
                      LOWER(ranked.name)
                    ),
                    256
                  ),
                  48
                )
              ) AS id,
              ranked.tenantId,
              ranked.locationId,
              ranked.name,
              ranked.displayOrder
            FROM (
              SELECT
                canonical.tenantId,
                canonical.locationId,
                canonical.name,
                ROW_NUMBER() OVER (
                  PARTITION BY canonical.tenantId, canonical.locationId
                  ORDER BY LOWER(canonical.name), BINARY canonical.name
                ) AS displayOrder
              FROM (
                SELECT
                  tenantId,
                  locationId,
                  CAST(MIN(BINARY TRIM(area)) AS CHAR CHARACTER SET utf8mb4) AS name
                FROM RestaurantTable
                WHERE NULLIF(TRIM(area), '') IS NOT NULL
                GROUP BY tenantId, locationId, LOWER(TRIM(area))
              ) AS canonical
            ) AS ranked
            ORDER BY
              ranked.tenantId,
              LOWER(ranked.name),
              ranked.locationId IS NOT NULL,
              ranked.locationId,
              BINARY ranked.name
          `);
          console.log(
            `[DB] ✅ Backfilled ${areaBackfillResult.affectedRows || 0} legacy dining areas`,
          );
        } catch (err: any) {
          console.error("[DB] ❌ Failed to backfill RestaurantDiningArea rows:", err.message);
        }

        // Resolve only previously-unresolved tables against a canonical row in
        // the exact same tenant/location scope. The compatibility `area` string
        // is deliberately never assigned here; blanks and unmatched values keep
        // a NULL areaId and are surfaced later through the effective Main area.
        try {
          const areaResolutionResult = await conn.query(`
            UPDATE RestaurantTable AS restaurantTable
            INNER JOIN RestaurantDiningArea AS diningArea
              ON diningArea.tenantId = restaurantTable.tenantId
             AND diningArea.locationId <=> restaurantTable.locationId
             AND diningArea.name = TRIM(restaurantTable.area)
            SET restaurantTable.areaId = diningArea.id
            WHERE restaurantTable.areaId IS NULL
              AND NULLIF(TRIM(restaurantTable.area), '') IS NOT NULL
          `);
          console.log(
            `[DB] ✅ Resolved ${areaResolutionResult.affectedRows || 0} legacy table dining areas`,
          );
        } catch (err: any) {
          console.error("[DB] ❌ Failed to resolve RestaurantTable.areaId:", err.message);
        }

        // Restaurant booking columns on Appointment. All four are nullable and
        // stay NULL for the five existing categories. turnTimeMinutes is the
        // turn-time snapshot taken at creation, so changing the setting later
        // cannot retroactively move an existing occupancy; tableNameAtBooking
        // is why a deleted table's bookings still show the name booked against.
        try {
          const restoApptCols: any[] = await conn.query("SHOW COLUMNS FROM Appointment");
          const colNames = restoApptCols.map((c: any) => c.Field || c.field || c.ColumnName || "");

          if (!colNames.includes("tableId")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN tableId VARCHAR(255) NULL");
            console.log("[DB] ✅ Added tableId column to Appointment table");
          }
          if (!colNames.includes("partySize")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN partySize INT NULL");
            console.log("[DB] ✅ Added partySize column to Appointment table");
          }
          if (!colNames.includes("turnTimeMinutes")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN turnTimeMinutes INT NULL");
            console.log("[DB] ✅ Added turnTimeMinutes column to Appointment table");
          }
          if (!colNames.includes("tableNameAtBooking")) {
            await conn.query(
              "ALTER TABLE Appointment ADD COLUMN tableNameAtBooking VARCHAR(40) NULL",
            );
            console.log("[DB] ✅ Added tableNameAtBooking column to Appointment table");
          }
          // A reservation may span several Dining_Tables (a Table_Group). Each
          // table keeps its own row, so per-table occupancy and the availability
          // scan are unchanged; the rows of one reservation share a
          // bookingGroupId. For a single-table booking the group id equals the
          // row's own id, which is why existing rows backfill to `id`.
          if (!colNames.includes("bookingGroupId")) {
            await conn.query("ALTER TABLE Appointment ADD COLUMN bookingGroupId VARCHAR(255) NULL");
            await conn.query(
              "UPDATE Appointment SET bookingGroupId = id WHERE bookingGroupId IS NULL",
            );
            console.log("[DB] ✅ Added bookingGroupId column to Appointment table");
          }
        } catch (err: any) {
          console.warn(
            "[DB] ⚠️ Could not verify/alter Appointment restaurant columns:",
            err.message,
          );
        }

        // Index for the per-table availability window scan. SHOW COLUMNS cannot
        // tell us whether an index exists, so this runs in its own try/catch.
        try {
          await conn.query(
            "ALTER TABLE Appointment ADD INDEX idx_apt_table_window (tenantId, tableId, dateTime)",
          );
          console.log("[DB] ✅ Added idx_apt_table_window index to Appointment table");
        } catch (_) {
          /* index already exists */
        }

        // Reads that collapse a Table_Group back into one reservation.
        try {
          await conn.query(
            "ALTER TABLE Appointment ADD INDEX idx_apt_booking_group (tenantId, bookingGroupId)",
          );
          console.log("[DB] ✅ Added idx_apt_booking_group index to Appointment table");
        } catch (_) {
          /* index already exists */
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

        // Create PaymentHistory Table (every Cashfree payment attempt —
        // received/success, failed, cancelled/user-dropped, pending, expired)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS PaymentHistory (
              id VARCHAR(255) PRIMARY KEY,
              userId VARCHAR(255) NULL,
              tenantId VARCHAR(255) NULL,
              orderId VARCHAR(255) NOT NULL,
              cfPaymentId VARCHAR(255) NULL,
              plan VARCHAR(50) NULL,
              amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
              currency VARCHAR(10) NOT NULL DEFAULT 'INR',
              status VARCHAR(50) NOT NULL,
              orderStatus VARCHAR(50) NULL,
              paymentMode VARCHAR(100) NULL,
              failureReason VARCHAR(500) NULL,
              customerName VARCHAR(255) NULL,
              customerEmail VARCHAR(255) NULL,
              customerPhone VARCHAR(50) NULL,
              gateway VARCHAR(50) NOT NULL DEFAULT 'Cashfree',
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_payment_order (orderId),
              INDEX idx_payment_user (userId),
              INDEX idx_payment_status (status),
              INDEX idx_payment_created (createdAt)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create PaymentHistory table:", err.message);
        }

        // Migrate: add columns to PaymentHistory if upgrading from an older version
        try {
          const phCols: any[] = await conn.query("SHOW COLUMNS FROM PaymentHistory");
          const phColNames = phCols.map((c: any) => c.Field || c.field || c.ColumnName || "");
          if (!phColNames.includes("failureReason")) {
            await conn.query(
              "ALTER TABLE PaymentHistory ADD COLUMN failureReason VARCHAR(500) NULL",
            );
          }
          if (!phColNames.includes("customerName")) {
            await conn.query(
              "ALTER TABLE PaymentHistory ADD COLUMN customerName VARCHAR(255) NULL",
            );
          }
          if (!phColNames.includes("customerEmail")) {
            await conn.query(
              "ALTER TABLE PaymentHistory ADD COLUMN customerEmail VARCHAR(255) NULL",
            );
          }
          if (!phColNames.includes("customerPhone")) {
            await conn.query(
              "ALTER TABLE PaymentHistory ADD COLUMN customerPhone VARCHAR(50) NULL",
            );
          }
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/alter PaymentHistory columns:", err.message);
        }

        // Migrate: ensure the UNIQUE(orderId) key exists. Tables created before
        // this key was introduced allow duplicate orderId rows, which breaks the
        // ON DUPLICATE KEY UPDATE upsert (every reconcile inserts a NEW row
        // instead of updating). De-duplicate first (keep the SUCCESS row, else
        // the most-recently-updated), then add the unique key.
        try {
          const phIdx: any[] = await conn.query(
            "SHOW INDEX FROM PaymentHistory WHERE Key_name = 'uniq_payment_order'",
          );
          if (!phIdx || phIdx.length === 0) {
            await conn.query("SET SESSION group_concat_max_len = 1000000");
            await conn.query(`
              DELETE ph FROM PaymentHistory ph
              JOIN (
                SELECT orderId,
                       SUBSTRING_INDEX(
                         GROUP_CONCAT(id ORDER BY (status = 'SUCCESS') DESC, updatedAt DESC, createdAt DESC),
                         ',', 1
                       ) AS keepId
                FROM PaymentHistory
                GROUP BY orderId
                HAVING COUNT(*) > 1
              ) dup ON ph.orderId = dup.orderId AND ph.id <> dup.keepId
            `);
            await conn.query(
              "ALTER TABLE PaymentHistory ADD UNIQUE KEY uniq_payment_order (orderId)",
            );
            console.log("[DB] ✅ De-duplicated PaymentHistory and added UNIQUE(orderId) key");
          }
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not add UNIQUE(orderId) to PaymentHistory:", err.message);
        }

        // Create Subscription Table (Cashfree recurring AutoPay mandates)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS Subscription (
              id VARCHAR(255) PRIMARY KEY,
              userId VARCHAR(255) NOT NULL,
              tenantId VARCHAR(255) NULL,
              subscriptionRef VARCHAR(255) NOT NULL,
              cfSubscriptionId VARCHAR(255) NULL,
              cfPlanId VARCHAR(255) NULL,
              planTier VARCHAR(50) NOT NULL,
              amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
              currency VARCHAR(10) NOT NULL DEFAULT 'INR',
              intervalType VARCHAR(20) NOT NULL DEFAULT 'MONTH',
              intervals INT NOT NULL DEFAULT 1,
              status VARCHAR(50) NOT NULL DEFAULT 'INITIALIZED',
              authStatus VARCHAR(50) NULL,
              paymentMethod VARCHAR(100) NULL,
              mandateReference VARCHAR(255) NULL,
              sessionId VARCHAR(512) NULL,
              currentPeriodStart TIMESTAMP NULL,
              currentPeriodEnd TIMESTAMP NULL,
              nextChargeAt TIMESTAMP NULL,
              gracePeriodEnds TIMESTAMP NULL,
              cancelAtPeriodEnd TINYINT(1) NOT NULL DEFAULT 0,
              customerName VARCHAR(255) NULL,
              customerEmail VARCHAR(255) NULL,
              customerPhone VARCHAR(50) NULL,
              gateway VARCHAR(50) NOT NULL DEFAULT 'Cashfree',
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_subscription_ref (subscriptionRef),
              INDEX idx_sub_user (userId),
              INDEX idx_sub_tenant (tenantId),
              INDEX idx_sub_status (status),
              INDEX idx_sub_cf (cfSubscriptionId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create Subscription table:", err.message);
        }

        // Create SubscriptionPayment Table (per-cycle charge / renewal ledger)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS SubscriptionPayment (
              id VARCHAR(255) PRIMARY KEY,
              subscriptionRef VARCHAR(255) NOT NULL,
              cfSubscriptionId VARCHAR(255) NULL,
              userId VARCHAR(255) NULL,
              tenantId VARCHAR(255) NULL,
              cfPaymentId VARCHAR(255) NULL,
              paymentRef VARCHAR(255) NULL,
              amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
              currency VARCHAR(10) NOT NULL DEFAULT 'INR',
              status VARCHAR(50) NOT NULL,
              paymentMethod VARCHAR(100) NULL,
              cycle INT NULL,
              failureReason VARCHAR(500) NULL,
              scheduledAt TIMESTAMP NULL,
              paidAt TIMESTAMP NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_subpay_ref (subscriptionRef),
              INDEX idx_subpay_user (userId),
              INDEX idx_subpay_status (status),
              INDEX idx_subpay_cfpay (cfPaymentId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create SubscriptionPayment table:", err.message);
        }

        // Migrate: add full Cashfree transaction detail columns to SubscriptionPayment.
        try {
          const spCols: any[] = await conn.query("SHOW COLUMNS FROM SubscriptionPayment");
          const spNames = spCols.map((c: any) => c.Field || c.field || c.ColumnName || "");
          if (!spNames.includes("cfTxnId"))
            await conn.query(
              "ALTER TABLE SubscriptionPayment ADD COLUMN cfTxnId VARCHAR(255) NULL",
            );
          if (!spNames.includes("cfOrderId"))
            await conn.query(
              "ALTER TABLE SubscriptionPayment ADD COLUMN cfOrderId VARCHAR(255) NULL",
            );
          if (!spNames.includes("paymentType"))
            await conn.query(
              "ALTER TABLE SubscriptionPayment ADD COLUMN paymentType VARCHAR(40) NULL",
            );
          if (!spNames.includes("remarks"))
            await conn.query(
              "ALTER TABLE SubscriptionPayment ADD COLUMN remarks VARCHAR(500) NULL",
            );
        } catch (err: any) {
          console.warn("[DB] ⚠️ Could not verify/alter SubscriptionPayment columns:", err.message);
        }

        // Create WebhookEvent Table (idempotency + audit for gateway webhooks)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS WebhookEvent (
              id VARCHAR(255) PRIMARY KEY,
              eventKey VARCHAR(512) NOT NULL,
              eventType VARCHAR(120) NULL,
              subscriptionRef VARCHAR(255) NULL,
              referenceId VARCHAR(255) NULL,
              signatureValid TINYINT(1) NOT NULL DEFAULT 0,
              status VARCHAR(50) NOT NULL DEFAULT 'processed',
              rawPayload MEDIUMTEXT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_webhook_event (eventKey),
              INDEX idx_webhook_type (eventType),
              INDEX idx_webhook_created (createdAt)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create WebhookEvent table:", err.message);
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

        // Create Location Table (multi-branch / multi-location sub-accounts per tenant)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS Location (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              name VARCHAR(255) NOT NULL,
              address TEXT NULL,
              city VARCHAR(120) NULL,
              state VARCHAR(120) NULL,
              pincode VARCHAR(20) NULL,
              phone VARCHAR(50) NULL,
              email VARCHAR(255) NOT NULL,
              password VARCHAR(255) NOT NULL,
              managerName VARCHAR(255) NULL,
              isActive TINYINT(1) DEFAULT 1,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY location_email (tenantId, email),
              INDEX idx_location_tenant (tenantId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create Location table:", err.message);
        }

        // Profile photos are self-service account data for every account type.
        // Keep these migrations independent so failure in one account table does
        // not prevent the other table from being checked on the same startup.
        try {
          const subUserCols: any[] = await conn.query("SHOW COLUMNS FROM SubUser");
          const subUserColNames = subUserCols.map(
            (c: any) => c.Field || c.field || c.ColumnName || "",
          );
          if (!subUserColNames.includes("profilePhoto")) {
            await conn.query("ALTER TABLE SubUser ADD COLUMN profilePhoto VARCHAR(500) NULL");
            console.log("[DB] ✅ Added profilePhoto column to SubUser table");
          }
        } catch (err: any) {
          console.error("[DB] ❌ Could not verify/add SubUser.profilePhoto:", err.message);
        }

        try {
          const locationCols: any[] = await conn.query("SHOW COLUMNS FROM Location");
          const locationColNames = locationCols.map(
            (c: any) => c.Field || c.field || c.ColumnName || "",
          );
          if (!locationColNames.includes("profilePhoto")) {
            await conn.query("ALTER TABLE Location ADD COLUMN profilePhoto VARCHAR(500) NULL");
            console.log("[DB] ✅ Added profilePhoto column to Location table");
          }
        } catch (err: any) {
          console.error("[DB] ❌ Could not verify/add Location.profilePhoto:", err.message);
        }

        // Create LocationSession Table (auth tokens for location logins)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS LocationSession (
              id VARCHAR(255) PRIMARY KEY,
              locationId VARCHAR(255) NOT NULL,
              token VARCHAR(255) UNIQUE NOT NULL,
              expiresAt TIMESTAMP NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_location_session (locationId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create LocationSession table:", err.message);
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

        // Create WAConversation Table (AI chat log per tenant+sender)
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS WAConversation (
              id VARCHAR(255) PRIMARY KEY,
              tenantId VARCHAR(255) NOT NULL,
              senderPhone VARCHAR(50) NOT NULL,
              senderName VARCHAR(255) NULL,
              direction ENUM('incoming', 'outgoing') NOT NULL DEFAULT 'incoming',
              message TEXT NOT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_tenant_phone (tenantId, senderPhone)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create WAConversation table:", err.message);
        }

        // Migrate: add aiEnabled column to WhatsAppConfig if missing
        try {
          await conn.query(`ALTER TABLE WhatsAppConfig ADD COLUMN aiEnabled TINYINT(1) DEFAULT 0`);
          console.log("[DB] ✅ Added aiEnabled column to WhatsAppConfig table");
        } catch (_) {
          /* column already exists */
        }

        // Check and add SaaS columns to User (Tenant) table
        try {
          const userCols: any[] = await conn.query("SHOW COLUMNS FROM User");
          const userColNames = userCols.map((c: any) => c.Field || c.field || c.ColumnName || "");

          if (!userColNames.includes("subscriptionStatus")) {
            await conn.query(
              "ALTER TABLE User ADD COLUMN subscriptionStatus VARCHAR(50) DEFAULT 'Trialing'",
            );
            console.log("[DB] ✅ Added subscriptionStatus column to User table");
          }
          if (!userColNames.includes("subscriptionPlan")) {
            await conn.query(
              "ALTER TABLE User ADD COLUMN subscriptionPlan VARCHAR(50) DEFAULT 'Trial'",
            );
            console.log("[DB] ✅ Added subscriptionPlan column to User table");
          }
          if (!userColNames.includes("subscriptionExpiresAt")) {
            await conn.query("ALTER TABLE User ADD COLUMN subscriptionExpiresAt TIMESTAMP NULL");
            console.log("[DB] ✅ Added subscriptionExpiresAt column to User table");
          }
          if (!userColNames.includes("paymentMethod")) {
            await conn.query(
              "ALTER TABLE User ADD COLUMN paymentMethod VARCHAR(100) DEFAULT 'None'",
            );
            console.log("[DB] ✅ Added paymentMethod column to User table");
          }
          if (!userColNames.includes("paymentAmount")) {
            await conn.query(
              "ALTER TABLE User ADD COLUMN paymentAmount DECIMAL(10,2) DEFAULT 0.00",
            );
            console.log("[DB] ✅ Added paymentAmount column to User table");
          }
          if (!userColNames.includes("billingInterval")) {
            await conn.query(
              "ALTER TABLE User ADD COLUMN billingInterval VARCHAR(50) DEFAULT 'monthly'",
            );
            console.log("[DB] ✅ Added billingInterval column to User table");
          }
          if (!userColNames.includes("virtualPhoneNumber")) {
            await conn.query(
              "ALTER TABLE User ADD COLUMN virtualPhoneNumber VARCHAR(50) DEFAULT '+91 98765 43210'",
            );
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
          if (!userColNames.includes("profession")) {
            await conn.query(
              "ALTER TABLE User ADD COLUMN profession VARCHAR(100) DEFAULT 'Healthcare and medical'",
            );
            console.log("[DB] ✅ Added profession column to User table");
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
              [adminId, "SaaS Owner", "admin@bookmytime.ai", hashedPassword],
            );
            console.log("[DB] ✅ Seeded default super admin: admin@bookmytime.ai / admin123");
          }

          // Sync or seed custom SUPER_ADMIN from .env if defined
          const envEmail = process.env.SUPER_ADMIN_EMAIL;
          const envPassword = process.env.SUPER_ADMIN_PASSWORD;
          if (envEmail && envPassword) {
            const customAdmin = await conn.query(
              "SELECT id FROM SuperAdmin WHERE email = ? LIMIT 1",
              [envEmail],
            );
            const hashedEnvPassword = await (bcrypt.default || bcrypt).hash(envPassword, 10);
            if (customAdmin.length === 0) {
              const adminId = cryptoModule.randomUUID();
              await conn.query(
                "INSERT INTO SuperAdmin (id, name, email, password) VALUES (?, ?, ?, ?)",
                [adminId, "BookMyTime Admin", envEmail, hashedEnvPassword],
              );
              console.log(`[DB] ✅ Seeded custom super admin from .env: ${envEmail}`);
            } else {
              // Update password to match env just in case it changed
              await conn.query("UPDATE SuperAdmin SET password = ? WHERE email = ?", [
                hashedEnvPassword,
                envEmail,
              ]);
              console.log(`[DB] ✅ Synced password for custom super admin from .env: ${envEmail}`);
            }
          }
        } catch (adminErr: any) {
          console.warn("[DB] ⚠️ Could not seed/sync default super admins:", adminErr.message);
        }

        // ─────────────────────────────────────────────────────────────────
        // Video consultation tables (Requirements 4, 6, 7, 12, 15).
        //
        // One room per appointment, first-party signalling, join tokens stored
        // only as hashes, consent, and an append-only audit trail. No Prisma
        // migration — created the same way every other table in this file is.
        // ─────────────────────────────────────────────────────────────────
        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoRoom (
              id                    VARCHAR(255) PRIMARY KEY,
              tenantId              VARCHAR(255) NOT NULL,
              appointmentId         VARCHAR(255) NOT NULL,
              doctorId              VARCHAR(255) NULL,
              state                 VARCHAR(32)  NOT NULL DEFAULT 'scheduled',
              joinOpensAt           DATETIME(3)  NULL,
              joinClosesAt          DATETIME(3)  NULL,
              tokenVersion          INT          NOT NULL DEFAULT 0,
              signalSeq             INT          NOT NULL DEFAULT 0,
              admittedParticipantId VARCHAR(255) NULL,
              admissionDecisionAt   DATETIME(3)  NULL,
              activatedAt           DATETIME(3)  NULL,
              endedAt               DATETIME(3)  NULL,
              endReason             VARCHAR(64)  NULL,
              outcome               VARCHAR(32)  NULL,
              connectedSeconds      INT          NOT NULL DEFAULT 0,
              disconnectedSinceAt   DATETIME(3)  NULL,
              disconnectedTotalMs   INT          NOT NULL DEFAULT 0,
              noticeVersion         VARCHAR(32)  NOT NULL DEFAULT 'v1',
              createdAt             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
              updatedAt             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_room_appointment (appointmentId),
              KEY idx_room_tenant_state (tenantId, state),
              KEY idx_room_sweep (state, joinClosesAt)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoRoom table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoJoinToken (
              id           VARCHAR(255) PRIMARY KEY,
              tenantId     VARCHAR(255) NOT NULL,
              roomId       VARCHAR(255) NOT NULL,
              tokenHash    VARCHAR(64)  NOT NULL,
              version      INT          NOT NULL DEFAULT 1,
              purpose      VARCHAR(32)  NOT NULL DEFAULT 'created',
              issuedAt     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
              revokedAt    DATETIME(3)  NULL,
              lastUsedAt   DATETIME(3)  NULL,
              useCount     INT          NOT NULL DEFAULT 0,
              createdAt    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uq_token_hash (tokenHash),
              KEY idx_token_room (roomId, revokedAt)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoJoinToken table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoParticipant (
              id             VARCHAR(255) PRIMARY KEY,
              tenantId       VARCHAR(255) NOT NULL,
              roomId         VARCHAR(255) NOT NULL,
              role           VARCHAR(32)  NOT NULL,
              participantKey VARCHAR(64)  NOT NULL,
              accountId      VARCHAR(255) NULL,
              displayName    VARCHAR(255) NULL,
              status         VARCHAR(32)  NOT NULL DEFAULT 'requested',
              peerState      VARCHAR(32)  NULL,
              micEnabled     TINYINT(1)   NOT NULL DEFAULT 1,
              cameraEnabled  TINYINT(1)   NOT NULL DEFAULT 1,
              quality        VARCHAR(16)  NULL,
              joinedAt       DATETIME(3)  NULL,
              admittedAt     DATETIME(3)  NULL,
              leftAt         DATETIME(3)  NULL,
              connectedMs    INT          NOT NULL DEFAULT 0,
              lastSeenAt     DATETIME(3)  NULL,
              lastPolledAt   DATETIME(3)  NULL,
              createdAt      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
              updatedAt      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_participant_identity (roomId, participantKey),
              KEY idx_participant_room_role (roomId, role),
              KEY idx_participant_room_status (roomId, status)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoParticipant table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoSignal (
              id          VARCHAR(255) PRIMARY KEY,
              tenantId    VARCHAR(255) NOT NULL,
              roomId      VARCHAR(255) NOT NULL,
              seq         INT          NOT NULL,
              senderRole  VARCHAR(32)  NOT NULL,
              kind        VARCHAR(32)  NOT NULL,
              payload     TEXT         NOT NULL,
              createdAt   TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
              UNIQUE KEY uq_signal_room_seq (roomId, seq),
              KEY idx_signal_room_seq (roomId, seq, senderRole)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoSignal table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoConsent (
              id              VARCHAR(255) PRIMARY KEY,
              tenantId        VARCHAR(255) NOT NULL,
              roomId          VARCHAR(255) NOT NULL,
              appointmentId   VARCHAR(255) NOT NULL,
              participantId   VARCHAR(255) NULL,
              noticeVersion   VARCHAR(32)  NOT NULL,
              tokenVersion    INT          NOT NULL DEFAULT 1,
              acknowledgedAt  TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
              userAgentHash   VARCHAR(64)  NULL,
              createdAt       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
              KEY idx_consent_room (roomId),
              UNIQUE KEY uq_consent_room_notice (roomId, noticeVersion, tokenVersion)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoConsent table:", err.message);
        }

        try {
          await conn.query(`
            CREATE TABLE IF NOT EXISTS VideoAuditEvent (
              id              VARCHAR(255) PRIMARY KEY,
              tenantId        VARCHAR(255) NOT NULL,
              roomId          VARCHAR(255) NOT NULL,
              appointmentId   VARCHAR(255) NOT NULL,
              participantRole VARCHAR(32)  NULL,
              kind            VARCHAR(48)  NOT NULL,
              detail          VARCHAR(255) NULL,
              occurredAt      TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
              createdAt       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
              KEY idx_audit_room_time (roomId, occurredAt),
              KEY idx_audit_tenant_apt (tenantId, appointmentId)
            )
          `);
        } catch (err: any) {
          console.error("[DB] ❌ Failed to create VideoAuditEvent table:", err.message);
        }

        // Normalize characters and collations across all tables to avoid mixed collation JOIN / comparison errors
        const tablesToNormalize = [
          "User",
          "Session",
          "OtpCode",
          "Appointment",
          "DemoAppointment",
          "ClinicHours",
          "Department",
          "Doctor",
          "ClinicProfile",
          "WhatsAppConfig",
          "DoctorSchedule",
          "DoctorLeave",
          "Patient",
          "SoapNote",
          "Prescription",
          "SuperAdmin",
          "SuperAdminSession",
          "SubscriptionHistory",
          "SubUser",
          "SubUserSession",
          "WATemplate",
          "WACampaign",
          "WACampaignRecipient",
          "WAAutoReply",
          "WAConversation",
          // Video consultation tables — required, not cosmetic. These join to Appointment,
          // Doctor, and Patient, and this codebase has a live mismatched-collation problem:
          // queries in src/lib/auth.server.ts are forced to write explicit
          // `COLLATE utf8mb4_unicode_ci` clauses in their JOIN conditions to work around it.
          // Normalising these tables up front avoids adding to that debt.
          "VideoRoom",
          "VideoJoinToken",
          "VideoParticipant",
          "VideoSignal",
          "VideoConsent",
          "VideoAuditEvent",
          // Restaurant tables. RestaurantTable.name uniqueness relies on
          // utf8mb4_unicode_ci being case-insensitive, and these rows join to
          // Appointment and Patient, so the collation has to match.
          "RestaurantTable",
          "RestaurantSettings",
          "RestaurantHours",
          "RestaurantTokenCounter",
          "RestaurantDiningArea",
          "RestaurantClosureDay",
          "RestaurantMenuCategory",
          "RestaurantMenuItem",
          "AccountEmailVerification",
        ];
        for (const tbl of tablesToNormalize) {
          try {
            await conn.query(
              `ALTER TABLE \`${tbl}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
            );
          } catch (colErr: any) {
            console.warn(`[DB] ⚠️ Could not normalize collation for table ${tbl}:`, colErr.message);
          }
        }
        console.log(
          "[DB] ✅ Normalized database character set and collation to utf8mb4_unicode_ci for all tables",
        );

        // Migrate WhatsApp tables from user.id to user.tenantId
        try {
          const waTables = ["WATemplate", "WACampaign", "WAAutoReply", "WAConversation"];
          for (const tbl of waTables) {
            const migRes = await conn.query(
              `UPDATE \`${tbl}\` t
               JOIN User u ON t.tenantId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
               SET t.tenantId = u.tenantId`,
            );
            if (migRes.affectedRows > 0) {
              console.log(
                `[DB] ✅ Migrated ${migRes.affectedRows} records in ${tbl} from user.id to user.tenantId`,
              );
            }
          }
        } catch (migErr: any) {
          console.warn("[DB] ⚠️ Could not run WhatsApp tenantId migration:", migErr.message);
        }

        console.log("[DB] ✅ Self-healing database tables verify completed");
      } catch (err: any) {
        console.error("[DB] ❌ Self-heal and schema setup failed:", err.message);
      } finally {
        if (conn) conn.release();
      }
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
export async function execute(
  sql: string,
  params?: any[],
): Promise<{ affectedRows: number; insertId: any }> {
  let conn: PoolConnection | undefined;
  try {
    conn = await pool.getConnection();
    const result = await conn!.query(sql, params);
    return { affectedRows: result.affectedRows || 0, insertId: result.insertId };
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Run a callback inside a single database transaction.
 *
 * Acquires one pooled connection, begins a transaction, hands that connection
 * to the callback, and commits when it resolves. Any throw rolls back and
 * rethrows, and the connection is always released in `finally`.
 *
 * Every statement in a transactional flow must go through the passed `conn`.
 * Calling the pool-level `query()` / `execute()` helpers inside the callback
 * runs outside the transaction and defeats the point.
 *
 * `opts.isolationLevel` applies to THIS transaction only: `SET TRANSACTION
 * ISOLATION LEVEL ...` without a scope keyword affects the next transaction on
 * the session and then reverts, so a pooled connection cannot leak the level to
 * the next borrower. Omitted, the server default (REPEATABLE READ) is used.
 */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
  opts?: { isolationLevel?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE" },
): Promise<T> {
  let conn: PoolConnection | undefined;
  try {
    conn = await pool.getConnection();
    if (opts?.isolationLevel) {
      await conn!.query(`SET TRANSACTION ISOLATION LEVEL ${opts.isolationLevel}`);
    }
    await conn!.beginTransaction();
    try {
      const result = await fn(conn!);
      await conn!.commit();
      return result;
    } catch (err) {
      try {
        await conn!.rollback();
      } catch (_) {
        /* connection already gone; the original error is what matters */
      }
      throw err;
    }
  } finally {
    if (conn) conn.release();
  }
}

export { pool };
export default { query, queryOne, execute, withTransaction, pool };
