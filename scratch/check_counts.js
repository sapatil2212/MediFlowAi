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
    const user = await conn.query("SELECT id, subscriptionPlan FROM User WHERE tenantId = 'clinic-290547'");
    console.log("User:", user);

    const subUsers = await conn.query("SELECT id, name, role, tenantId FROM SubUser WHERE tenantId = 'clinic-290547'");
    console.log("SubUsers:", subUsers);

    const countRes = await conn.query("SELECT COUNT(*) as count FROM SubUser WHERE tenantId = 'clinic-290547' AND role = 'doctor'");
    console.log("Doctor subuser count:", countRes);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    if (conn) conn.release();
    pool.end();
  }
}

main();
