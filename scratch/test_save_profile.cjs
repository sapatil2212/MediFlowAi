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

  const tenantId = 'clinic-118827'; // Test Clinician's tenantId

  try {
    const conn = await pool.getConnection();
    console.log("Connected to database successfully.");

    // Update with test rich fields
    const testClinicName = "Test Dental Clinic Plus";
    const testClinicianName = "Test Clinician Updated";
    const testPhone = "+1 555-0100";
    const testPracticeSize = "2-5 Providers";
    const testAddress = "456 Dental Way, Suite A";
    const testContactDetails = "Phone: +1 555-0199, Email: info@testclinic.com";
    const testShortDesc = "A modern dental clinic providing advanced care.";
    const testServices = "Teeth Cleaning, Root Canal, General Checkup, Teeth Whitening";

    await conn.query(
      `INSERT INTO ClinicProfile (id, tenantId, clinicName, clinicianName, phone, practiceSize, address, contactDetails, shortDescription, services)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE clinicName = ?, clinicianName = ?, phone = ?, practiceSize = ?, address = ?, contactDetails = ?, shortDescription = ?, services = ?`,
      [
        "test-id-123",
        tenantId,
        testClinicName,
        testClinicianName,
        testPhone,
        testPracticeSize,
        testAddress,
        testContactDetails,
        testShortDesc,
        testServices,
        testClinicName,
        testClinicianName,
        testPhone,
        testPracticeSize,
        testAddress,
        testContactDetails,
        testShortDesc,
        testServices
      ]
    );
    console.log("✅ Successfully updated clinic profile in database.");

    // Query back to verify persistence
    const [row] = await conn.query("SELECT * FROM ClinicProfile WHERE tenantId = ?", [tenantId]);
    console.log("Verified Database Entry:");
    console.log({
      clinicName: row.clinicName,
      clinicianName: row.clinicianName,
      phone: row.phone,
      address: row.address,
      contactDetails: row.contactDetails,
      shortDescription: row.shortDescription,
      services: row.services
    });

    conn.release();
  } catch (err) {
    console.error("Error during profile database update test:", err.message);
  } finally {
    await pool.end();
  }
}

run();
