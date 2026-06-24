require('dotenv').config();
const mariadb = require('mariadb');

async function testConnection() {
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
      console.error("[DB] Failed to parse DATABASE_URL:", e.message);
    }
  }

  const pool = mariadb.createPool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    ssl: { rejectUnauthorized: false },
    connectionLimit: 1,
    connectTimeout: 10000,
  });

  try {
    const conn = await pool.getConnection();
    console.log("SUCCESS: Connected to database!");
    
    const users = await conn.query("SELECT id, tenantId, name, email, profession FROM `User`");
    console.log("All registered users in DB:");
    console.dir(users, { depth: null });
    
    const appointments = await conn.query("SELECT id, tenantId, name, email, reason, status FROM `Appointment`");
    console.log("All appointments in DB:");
    console.dir(appointments, { depth: null });
    
    conn.release();
  } catch (err) {
    console.error("ERROR: Failed to query database:", err.message);
  } finally {
    await pool.end();
  }
}

testConnection();
