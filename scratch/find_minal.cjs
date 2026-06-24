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
    const email = 'minalmsp67@gmail.com';
    const users = await conn.query("SELECT * FROM User WHERE email = ?", [email]);
    console.log("Users with email:", email);
    console.log(users);

    const subUsers = await conn.query("SELECT * FROM SubUser WHERE email = ?", [email]);
    console.log("\nSubUsers with email:", email);
    console.log(subUsers);

    conn.release();
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

run();
