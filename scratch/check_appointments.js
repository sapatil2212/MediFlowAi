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
    const query1 = await conn.query("SELECT * FROM Appointment WHERE tenantId = 'clinic-290547'");
    console.log("Appointment table rows:", query1);

    const query2 = await conn.query("SELECT a.*, d.name as doctorName FROM Appointment a LEFT JOIN Doctor d ON a.doctorId = d.id WHERE a.tenantId = 'clinic-290547'");
    console.log("SQL Joined Query results:", query2);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    if (conn) conn.release();
    pool.end();
  }
}

main();
