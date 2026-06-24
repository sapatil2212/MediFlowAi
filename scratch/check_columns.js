const mariadb = require('mariadb');
require('dotenv').config();

async function run() {
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
      console.error("Failed to parse DATABASE_URL:", e);
    }
  }

  const useSsl = dbHost !== "localhost" && dbHost !== "127.0.0.1" && process.env.DB_SSL !== "false";

  const pool = mariadb.createPool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 1
  });

  try {
    const conn = await pool.getConnection();
    console.log("Connected to DB successfully.");
    const columns = await conn.query("SHOW COLUMNS FROM ClinicProfile");
    console.log("Columns in ClinicProfile:");
    console.log(columns);
    conn.release();
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

run();
