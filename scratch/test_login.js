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
    console.log("Successfully connected to DB!");

    const user = await conn.query("SELECT * FROM User WHERE tenantId = 'clinic-290547'");
    console.log("\nParent Tenant User:");
    console.log(user);

    const joined = await conn.query("SELECT su.*, u.subscriptionStatus, u.subscriptionExpiresAt FROM SubUser su JOIN User u ON su.tenantId = u.tenantId WHERE su.email = 'lumsid123@gmail.com'");
    console.log("\nJoined Result:");
    console.log(joined);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    if (conn) conn.release();
    pool.end();
  }
}

main();
