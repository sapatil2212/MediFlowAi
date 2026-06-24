const mariadb = require('mariadb');
require('dotenv').config();

async function run() {
  const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    connectionLimit: 1
  });

  const tenantId = 'clinic-8e8d57'; // User's active clinic tenant ID

  try {
    const conn = await pool.getConnection();
    console.log("Connected to DB successfully.");

    // Fix profile phone field
    await conn.query("UPDATE ClinicProfile SET phone = '7745868073' WHERE tenantId = ?", [tenantId]);
    console.log("✅ Updated phone number in ClinicProfile back to '7745868073' for tenant clinic-8e8d57");

    // Fetch values to confirm
    const [profile] = await conn.query("SELECT clinicianName, phone FROM ClinicProfile WHERE tenantId = ?", [tenantId]);
    console.log("ClinicProfile Values after Fix:");
    console.log(profile);

    const [user] = await conn.query("SELECT name, phone FROM User WHERE tenantId = ?", [tenantId]);
    console.log("User Table Values:");
    console.log(user);

    conn.release();
  } catch (err) {
    console.error("Error repairing DB entries:", err.message);
  } finally {
    await pool.end();
  }
}

run();
