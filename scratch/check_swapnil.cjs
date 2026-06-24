const mariadb = require('mariadb');
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
    const users = await conn.query("SELECT email, name FROM User WHERE email = 'swapnilpatil221298@gmail.com'");
    console.log('Query result:', users);
    conn.release();
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

run();
