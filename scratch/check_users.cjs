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

  try {
    const conn = await pool.getConnection();
    const phone = '8830553868';
    const users = await conn.query("SELECT id, name, email, phone, tenantId FROM User WHERE phone = ?", [phone]);
    console.log("Users with phone:", phone);
    console.log(users);

    const allUsers = await conn.query("SELECT id, name, email, phone, tenantId FROM User LIMIT 10");
    console.log("\nAll Users:");
    console.log(allUsers);
    conn.release();
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

run();
