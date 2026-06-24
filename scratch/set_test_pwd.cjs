const mariadb = require('mariadb');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function run() {
  const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const conn = await pool.getConnection();
    const hash = await bcrypt.hash("password123", 10);
    await conn.query("UPDATE User SET password = ? WHERE email = 'swapnilpatil221298@gmail.com'", [hash]);
    console.log("Successfully updated password of swapnilpatil221298@gmail.com to password123");
    conn.release();
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

run();
