import mariadb from "mariadb";

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
    const users = await conn.query("SELECT id, name, email, tenantId, password FROM User WHERE tenantId = 'clinic-290547'");
    console.log("Users:", users);

    const subusers = await conn.query("SELECT id, name, email, role, tenantId FROM SubUser WHERE tenantId = 'clinic-290547'");
    console.log("Subusers:", subusers);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    if (conn) conn.release();
    pool.end();
  }
}

main();
