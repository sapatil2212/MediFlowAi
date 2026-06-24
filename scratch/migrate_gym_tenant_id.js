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

  const oldTenantId = 'clinic-616474';
  const newTenantId = 'gym-616474';

  const tables = [
    'User',
    'SubUser',
    'ClinicProfile',
    'Department',
    'Doctor',
    'Appointment',
    'ClinicHours',
    'WhatsAppConfig',
    'WAConversation',
    'WAAutoReply'
  ];

  try {
    const conn = await pool.getConnection();
    console.log(`Starting migration from ${oldTenantId} to ${newTenantId}...`);

    for (const table of tables) {
      const q = `UPDATE ${table} SET tenantId = ? WHERE tenantId = ?`;
      const res = await conn.query(q, [newTenantId, oldTenantId]);
      console.log(`Updated table ${table}: ${res.affectedRows} row(s) updated.`);
    }

    conn.release();
    console.log("Migration completed successfully!");
  } catch (err) {
    console.error("Migration failed:", err.message);
  } finally {
    await pool.end();
  }
}

run();
