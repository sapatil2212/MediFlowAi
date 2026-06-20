import mariadb from "mariadb";
import bcrypt from "bcryptjs";

const pool = mariadb.createPool({
  host: "gateway01.ap-southeast-1.prod.aws.tidbcloud.com",
  port: 4000,
  user: "Q2KCvyDGKFFGWYC.root",
  password: "Vti3a3KAnPc9C4Cm",
  database: "mediflowai",
  ssl: { rejectUnauthorized: false },
});

async function main() {
  let conn;
  try {
    conn = await pool.getConnection();
    const hash = await bcrypt.hash("password123", 10);
    await conn.query("UPDATE User SET password = ? WHERE email = 'swapnilpatil221298@gmail.com'", [hash]);
    console.log("Successfully updated password of swapnilpatil221298@gmail.com to password123");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    if (conn) conn.release();
    pool.end();
  }
}

main();
