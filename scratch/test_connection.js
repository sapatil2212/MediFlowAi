require('dotenv').config();
const mariadb = require('mariadb');

async function testConnection() {
  console.log("Testing connection with fallback env variables...");
  console.log("Host:", process.env.DB_HOST);
  console.log("Port:", process.env.DB_PORT);
  console.log("User:", process.env.DB_USER);
  console.log("Database:", process.env.DB_NAME);
  
  let dbHost = process.env.DB_HOST || "localhost";
  let dbPort = parseInt(process.env.DB_PORT || "3306");
  let dbUser = process.env.DB_USER || "root";
  let dbPassword = process.env.DB_PASSWORD || "";
  let dbName = process.env.DB_NAME || "bookmytime";

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith("mysql://")) {
    try {
      console.log("Attempting to parse DATABASE_URL...");
      const parsedUrl = new URL(dbUrl);
      dbHost = parsedUrl.hostname;
      dbPort = parsedUrl.port ? parseInt(parsedUrl.port) : 3306;
      dbUser = decodeURIComponent(parsedUrl.username);
      dbPassword = decodeURIComponent(parsedUrl.password);
      dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
      console.log("Successfully parsed DATABASE_URL!");
    } catch (e) {
      console.error("[DB] Failed to parse DATABASE_URL:", e.message);
    }
  }

  console.log("Creating pool with host:", dbHost, "user:", dbUser, "database:", dbName);
  
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
    const rows = await conn.query("SELECT 1 as val");
    console.log("Query test result:", rows);
    conn.release();
  } catch (err) {
    console.error("ERROR: Failed to connect to database:", err.message);
  } finally {
    await pool.end();
  }
}

testConnection();
