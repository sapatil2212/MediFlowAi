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

    // Update with test split rich fields
    const testClinicName = "Super Dental Clinic";
    const testClinicianName = "Dr. Test Clinician";
    const testPhone = "+1 555-0100";
    const testPracticeSize = "2-5 Providers";
    const testAddress = "123 Practice Rd, Suite 400";
    const testEmail = "contact@superdental.com";
    const testContactNo = "+1 555-0111";
    const testWhatsappNo = "+1 555-0222";
    const testLandlineNo = "022-99887766";
    const testShortDesc = "A modern dental clinic specialized in implants and braces.";
    const testServices = "Teeth Cleaning, Root Canal, Dental Implants, Braces, Teeth Whitening";

    await conn.query(
      `INSERT INTO ClinicProfile (id, tenantId, clinicName, clinicianName, phone, practiceSize, address, email, contactNo, whatsappNo, landlineNo, shortDescription, services)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE clinicName = ?, clinicianName = ?, phone = ?, practiceSize = ?, address = ?, email = ?, contactNo = ?, whatsappNo = ?, landlineNo = ?, shortDescription = ?, services = ?`,
      [
        "test-id-split-fields",
        tenantId,
        testClinicName,
        testClinicianName,
        testPhone,
        testPracticeSize,
        testAddress,
        testEmail,
        testContactNo,
        testWhatsappNo,
        testLandlineNo,
        testShortDesc,
        testServices,
        testClinicName,
        testClinicianName,
        testPhone,
        testPracticeSize,
        testAddress,
        testEmail,
        testContactNo,
        testWhatsappNo,
        testLandlineNo,
        testShortDesc,
        testServices
      ]
    );
    console.log("✅ Successfully updated clinic profile in database.");

    // Query back to verify persistence (simulating getClinicContext)
    const [row] = await conn.query("SELECT * FROM ClinicProfile WHERE tenantId = ?", [tenantId]);
    console.log("\nVerified Database Entry:");
    console.log({
      clinicName: row.clinicName,
      address: row.address,
      email: row.email,
      contactNo: row.contactNo,
      whatsappNo: row.whatsappNo,
      landlineNo: row.landlineNo,
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
