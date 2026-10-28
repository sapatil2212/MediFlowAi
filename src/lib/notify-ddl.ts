// ─────────────────────────────────────────────────────────────────────────────
// notify-ddl.ts  (server-only)
//
// Runtime DDL for the notification engine, called from the self-heal block in
// db.ts (this repository's schema mechanism: idempotent CREATE TABLE IF NOT
// EXISTS + guarded SHOW COLUMNS / SHOW INDEX → ALTER TABLE; no ORM migrations).
//
// Everything here is additive. No existing row is updated or deleted. The only
// index change replaces WaNotifyMapping's single-column unique key with
// (notifyKind, businessCategory) in ONE ALTER statement, after the new column
// exists with default '*', so every existing mapping keeps its meaning.
//
// Scheduling columns are BIGINT epoch milliseconds (UTC instants), so dispatch
// timing never depends on the database time_zone or the Node process TZ.
//
// Rollback policy:
//   The safe application rollback is to revert the code and LEAVE this additive
//   schema in place; older builds ignore it. Destructive schema rollback is a
//   separate maintenance operation, not part of an incident rollback.
//
//   Before removing anything: pause the engine, stop every worker, back up all
//   Notification* tables plus WaNotifyMapping/WaMessageLog, and accept that
//   pending jobs, consent and audit history will be lost. MySQL DDL auto-commits
//   and is not atomic. Then, only after the rollback build is live:
//
//   DROP TABLE IF EXISTS NotificationEvent, NotificationConsent,
//     TenantNotificationSettings, NotificationPlatformSettings,
//     NotificationAudit, NotificationAlert;
//   ALTER TABLE WaMessageLog DROP COLUMN eventId, DROP COLUMN sentAtMs,
//     DROP COLUMN deliveredAtMs, DROP COLUMN readAtMs, DROP COLUMN failedAtMs;
//
//   Restoring the legacy WaNotifyMapping unique key also requires first
//   consolidating category rows to at most one row per notifyKind. Only then:
//   ALTER TABLE WaNotifyMapping DROP INDEX uq_wnm_kind_category,
//     DROP COLUMN businessCategory,
//     ADD UNIQUE KEY uq_wnm_kind_enabled (notifyKind);
//
// Full operator steps and loss warnings: docs/whatsapp-templates.md §8.
// ─────────────────────────────────────────────────────────────────────────────

interface DdlConn {
  query: (sql: string, params?: unknown[]) => Promise<any>;
}

const CHARSET = "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export const NOTIFY_TABLE_DDL: Record<string, string> = {
  NotificationEvent: `
    CREATE TABLE IF NOT EXISTS NotificationEvent (
      id VARCHAR(64) PRIMARY KEY,
      eventKey VARCHAR(191) NOT NULL,
      tenantId VARCHAR(255) NOT NULL,
      businessCategory VARCHAR(32) NOT NULL,
      eventType VARCHAR(48) NOT NULL,
      notifyKind VARCHAR(48) NOT NULL,
      appointmentId VARCHAR(255) NULL,
      channel VARCHAR(16) NOT NULL DEFAULT 'whatsapp',
      recipient VARCHAR(32) NULL,
      source VARCHAR(48) NULL,
      status VARCHAR(20) NOT NULL,
      statusReason VARCHAR(96) NULL,
      errorClass VARCHAR(32) NULL,
      errorCode VARCHAR(32) NULL,
      errorMessage VARCHAR(500) NULL,
      attempts INT NOT NULL DEFAULT 0,
      maxAttempts INT NOT NULL DEFAULT 5,
      scheduledForMs BIGINT NOT NULL,
      nextAttemptAtMs BIGINT NOT NULL,
      expiresAtMs BIGINT NULL,
      lockedBy VARCHAR(64) NULL,
      claimToken VARCHAR(64) NULL,
      lockedUntilMs BIGINT NULL,
      sendStartedAtMs BIGINT NULL,
      appointmentAtLocal VARCHAR(19) NULL,
      templateId VARCHAR(255) NULL,
      templateName VARCHAR(128) NULL,
      templateLanguage VARCHAR(16) NULL,
      waMessageLogId VARCHAR(255) NULL,
      providerMessageId VARCHAR(128) NULL,
      submittedAtMs BIGINT NULL,
      deliveredAtMs BIGINT NULL,
      readAtMs BIGINT NULL,
      failedAtMs BIGINT NULL,
      payload JSON NULL,
      createdAtMs BIGINT NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ne_event_key (eventKey),
      KEY idx_ne_due (status, nextAttemptAtMs),
      KEY idx_ne_tenant_created (tenantId, createdAtMs),
      KEY idx_ne_appointment (appointmentId, notifyKind),
      KEY idx_ne_provider (providerMessageId),
      KEY idx_ne_created (createdAtMs)
    ) ${CHARSET}`,
  NotificationConsent: `
    CREATE TABLE IF NOT EXISTS NotificationConsent (
      id VARCHAR(64) PRIMARY KEY,
      tenantId VARCHAR(255) NOT NULL,
      phone VARCHAR(32) NOT NULL,
      channel VARCHAR(16) NOT NULL DEFAULT 'whatsapp',
      status VARCHAR(16) NOT NULL,
      source VARCHAR(48) NOT NULL,
      noticeVersion VARCHAR(16) NULL,
      appointmentId VARCHAR(255) NULL,
      capturedAtMs BIGINT NOT NULL,
      withdrawnAtMs BIGINT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_nc_scope (tenantId, phone, channel),
      KEY idx_nc_phone (phone)
    ) ${CHARSET}`,
  TenantNotificationSettings: `
    CREATE TABLE IF NOT EXISTS TenantNotificationSettings (
      tenantId VARCHAR(255) PRIMARY KEY,
      whatsappEnabled TINYINT(1) NOT NULL DEFAULT 1,
      confirmations TINYINT(1) NOT NULL DEFAULT 1,
      reschedules TINYINT(1) NOT NULL DEFAULT 1,
      cancellations TINYINT(1) NOT NULL DEFAULT 1,
      completions TINYINT(1) NOT NULL DEFAULT 1,
      reminderDayBefore TINYINT(1) NOT NULL DEFAULT 1,
      reminder2h TINYINT(1) NOT NULL DEFAULT 0,
      queueUpdates TINYINT(1) NOT NULL DEFAULT 1,
      timezone VARCHAR(64) NULL,
      updatedBy VARCHAR(255) NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ${CHARSET}`,
  NotificationPlatformSettings: `
    CREATE TABLE IF NOT EXISTS NotificationPlatformSettings (
      id VARCHAR(32) PRIMARY KEY,
      settings JSON NOT NULL,
      updatedBy VARCHAR(255) NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ${CHARSET}`,
  NotificationAudit: `
    CREATE TABLE IF NOT EXISTS NotificationAudit (
      id VARCHAR(64) PRIMARY KEY,
      tenantId VARCHAR(255) NULL,
      eventId VARCHAR(64) NULL,
      action VARCHAR(48) NOT NULL,
      actor VARCHAR(255) NULL,
      detail JSON NULL,
      atMs BIGINT NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_na_event (eventId, atMs),
      KEY idx_na_tenant (tenantId, atMs),
      KEY idx_na_action (action, atMs)
    ) ${CHARSET}`,
  NotificationAlert: `
    CREATE TABLE IF NOT EXISTS NotificationAlert (
      alertKey VARCHAR(191) PRIMARY KEY,
      severity VARCHAR(16) NOT NULL,
      status VARCHAR(16) NOT NULL,
      title VARCHAR(255) NOT NULL,
      detail VARCHAR(1000) NULL,
      tenantId VARCHAR(255) NULL,
      firstSeenMs BIGINT NOT NULL,
      lastSeenMs BIGINT NOT NULL,
      occurrences INT NOT NULL DEFAULT 1,
      resolvedAtMs BIGINT NULL,
      notifiedAtMs BIGINT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_nal_status (status, lastSeenMs)
    ) ${CHARSET}`,
};

/** Tables created here that should join db.ts's collation normalization list. */
export const NOTIFY_TABLES = Object.keys(NOTIFY_TABLE_DDL);

async function columnNames(conn: DdlConn, table: string): Promise<string[]> {
  const cols: any[] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
  return cols.map((c: any) => String(c.Field || c.field || ""));
}

async function hasIndex(conn: DdlConn, table: string, name: string): Promise<boolean> {
  const rows: any[] = await conn.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [name]);
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Creates/extends the notification schema. Each step is isolated so one
 * failure (e.g. missing privilege) never blocks the others or the app boot.
 */
export async function ensureNotificationSchema(conn: DdlConn): Promise<boolean> {
  let tablesOk = true;
  for (const [table, ddl] of Object.entries(NOTIFY_TABLE_DDL)) {
    try {
      await conn.query(ddl);
    } catch (err: any) {
      tablesOk = false;
      console.error(`[DB] ❌ Failed to create ${table} table:`, err?.message);
    }
  }

  // WaNotifyMapping: one mapping per (notify kind, business category). '*' keeps
  // the previous "all categories" meaning for every existing row.
  try {
    const cols = await columnNames(conn, "WaNotifyMapping");
    if (!cols.includes("businessCategory")) {
      await conn.query(
        "ALTER TABLE WaNotifyMapping ADD COLUMN businessCategory VARCHAR(32) NOT NULL DEFAULT '*'",
      );
      console.log("[DB] ✅ Added businessCategory column to WaNotifyMapping");
    }
    if (!(await hasIndex(conn, "WaNotifyMapping", "uq_wnm_kind_category"))) {
      const dropOld = (await hasIndex(conn, "WaNotifyMapping", "uq_wnm_kind_enabled"))
        ? "DROP INDEX uq_wnm_kind_enabled, "
        : "";
      await conn.query(
        `ALTER TABLE WaNotifyMapping ${dropOld}ADD UNIQUE KEY uq_wnm_kind_category (notifyKind, businessCategory)`,
      );
      console.log("[DB] ✅ WaNotifyMapping is now unique per (notifyKind, businessCategory)");
    }
  } catch (err: any) {
    console.error("[DB] ❌ Could not extend WaNotifyMapping:", err?.message);
  }

  // WaMessageLog: correlate provider messages with notification events and keep
  // provider-reported status timestamps for the delivery timeline.
  try {
    const cols = await columnNames(conn, "WaMessageLog");
    const add = async (name: string, ddl: string) => {
      if (!cols.includes(name)) {
        await conn.query(`ALTER TABLE WaMessageLog ADD COLUMN ${ddl}`);
        console.log(`[DB] ✅ Added ${name} column to WaMessageLog`);
      }
    };
    await add("eventId", "eventId VARCHAR(64) NULL");
    await add("sentAtMs", "sentAtMs BIGINT NULL");
    await add("deliveredAtMs", "deliveredAtMs BIGINT NULL");
    await add("readAtMs", "readAtMs BIGINT NULL");
    await add("failedAtMs", "failedAtMs BIGINT NULL");
    if (!(await hasIndex(conn, "WaMessageLog", "idx_wml_event"))) {
      await conn.query("ALTER TABLE WaMessageLog ADD INDEX idx_wml_event (eventId)");
      console.log("[DB] ✅ Added idx_wml_event index to WaMessageLog");
    }
  } catch (err: any) {
    tablesOk = false;
    console.error("[DB] ❌ Could not extend WaMessageLog:", err?.message);
  }
  return tablesOk;
}

// ── Lazy readiness gate ──────────────────────────────────────────────────────
// db.ts runs the self-heal DDL in the background after the pool connects, so a
// request can arrive before it finishes. The engine and worker await this
// memoized gate instead; it shares one run with the self-heal block and is
// retried (after a cooldown) when it fails.
let schemaPromise: Promise<boolean> | null = null;
let lastFailureAt = 0;
const RETRY_COOLDOWN_MS = 60_000;

export function ensureNotifySchema(): Promise<boolean> {
  if (schemaPromise) return schemaPromise;
  if (lastFailureAt && Date.now() - lastFailureAt < RETRY_COOLDOWN_MS) {
    return Promise.resolve(false);
  }
  schemaPromise = (async () => {
    const { pool } = await import("./db");
    if (!pool) return false;
    const conn = await pool.getConnection();
    try {
      return await ensureNotificationSchema(conn);
    } finally {
      conn.release();
    }
  })()
    .catch((err: any) => {
      console.error("[DB] ❌ Notification schema check failed:", err?.message);
      return false;
    })
    .then((ok) => {
      if (!ok) {
        schemaPromise = null;
        lastFailureAt = Date.now();
      }
      return ok;
    });
  return schemaPromise;
}

/** Test seam: forget the memoized readiness result. */
export function __resetNotifySchemaForTests(): void {
  schemaPromise = null;
  lastFailureAt = 0;
}
