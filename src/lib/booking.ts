import { createServerFn } from "@tanstack/react-start";
import crypto from "crypto";
import { query, queryOne, execute } from "./db";
import { enqueueWA, getWAStatus } from "./whatsapp";

// ──────────────────────────────────────────────
// Public: Get Clinic Info + Dynamic Available Slots
// ──────────────────────────────────────────────
export const getClinicInfoAndSlotsServerFn = createServerFn({ method: "GET" })
  .validator((data: { tenantId: string; date?: string; doctorId?: string }) => {
    if (!data.tenantId) throw new Error("Tenant ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    // 1. Resolve clinic details and business profession
    let clinicName = "";
    let profession = "Healthcare and medical";
    const profile = await queryOne<any>("SELECT clinicName FROM ClinicProfile WHERE tenantId = ? LIMIT 1", [data.tenantId]);
    const userClinic = await queryOne<any>("SELECT clinicName, profession FROM User WHERE tenantId = ? LIMIT 1", [data.tenantId]);
    if (userClinic) {
      profession = userClinic.profession || "Healthcare and medical";
      clinicName = profile ? profile.clinicName : userClinic.clinicName;
    } else if (profile) {
      clinicName = profile.clinicName;
    } else {
      throw new Error("Clinic not found");
    }

    // 2. Resolve active departments
    const departments = await query<any>("SELECT * FROM Department WHERE tenantId = ? ORDER BY name ASC", [data.tenantId]);

    // 3. Resolve active doctors
    const doctors = await query<any>(
      `SELECT d.*, dept.name as departmentName
       FROM Doctor d
       LEFT JOIN Department dept ON d.departmentId = dept.id
       WHERE d.tenantId = ?
       ORDER BY d.name ASC`,
      [data.tenantId]
    );

    // 4. If date and doctorId are selected, compute dynamic available slots
    let slots: string[] = [];
    const isEducation = profession === "Education institutions";
    const isGym = profession === "Fitness Gym etc";

    if (data.date && (data.doctorId || isEducation || isGym)) {
      const selectedDate = new Date(data.date);
      const dayOfWeek = selectedDate.getDay();
      const dateStr = selectedDate.toISOString().split("T")[0];

      // A. Check if the clinic/institution/gym is closed on this day
      const clinicHours = await queryOne<any>(
        "SELECT * FROM ClinicHours WHERE tenantId = ? AND dayOfWeek = ? LIMIT 1",
        [data.tenantId, dayOfWeek]
      );
      const clinicClosed = clinicHours ? !!clinicHours.isClosed : (dayOfWeek === 0 || dayOfWeek === 6);

      if (!clinicClosed) {
        if (isEducation || isGym) {
          // ── Education: generate slots from ClinicHours (working hours) ──
          if (clinicHours && clinicHours.openTime && clinicHours.closeTime) {
            const duration = clinicHours.slotDuration || 30;

            const [startHour, startMin] = clinicHours.openTime.split(":").map(Number);
            const [endHour, endMin] = clinicHours.closeTime.split(":").map(Number);

            const startObj = new Date(selectedDate);
            startObj.setHours(startHour, startMin, 0, 0);

            const endObj = new Date(selectedDate);
            endObj.setHours(endHour, endMin, 0, 0);

            // Get existing bookings for this tenant on this day
            const existingBookings = await query<any>(
              `SELECT timeSlot FROM Appointment
               WHERE tenantId = ? AND DATE(dateTime) = ? AND status != 'Cancelled'`,
              [data.tenantId, dateStr]
            );
            const bookedSlots = existingBookings.map((b: any) => b.timeSlot || "");

            const temp = new Date(startObj);
            while (temp < endObj) {
              const slotTimeStr = temp.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true
              });
              if (!bookedSlots.includes(slotTimeStr)) {
                slots.push(slotTimeStr);
              }
              temp.setMinutes(temp.getMinutes() + duration);
            }
          }
        } else {
          // ── Standard: generate slots from DoctorSchedule ──
          // B. Check if the doctor is on holiday/leave on this date
          const leave = await queryOne<any>(
            "SELECT id FROM DoctorLeave WHERE doctorId = ? AND leaveDate = ? LIMIT 1",
            [data.doctorId, dateStr]
          );

          if (!leave) {
            // C. Get doctor schedule for this day
            const docSchedule = await queryOne<any>(
              "SELECT * FROM DoctorSchedule WHERE doctorId = ? AND dayOfWeek = ? LIMIT 1",
              [data.doctorId, dayOfWeek]
            );

            if (docSchedule) {
              const startTimeStr = docSchedule.startTime;
              const endTimeStr = docSchedule.endTime;
              const duration = docSchedule.slotDuration || 30;

              const [startHour, startMin] = startTimeStr.split(":").map(Number);
              const [endHour, endMin] = endTimeStr.split(":").map(Number);

              const startObj = new Date(selectedDate);
              startObj.setHours(startHour, startMin, 0, 0);

              const endObj = new Date(selectedDate);
              endObj.setHours(endHour, endMin, 0, 0);

              // Get existing bookings for this doctor on this day
              const existingBookings = await query<any>(
                `SELECT dateTime, timeSlot FROM Appointment
                 WHERE doctorId = ? AND DATE(dateTime) = ? AND status != 'Cancelled'`,
                [data.doctorId, dateStr]
              );
              const bookedSlots = existingBookings.map((b: any) => b.timeSlot || "");

              // Generate slots
              const temp = new Date(startObj);
              while (temp < endObj) {
                const slotTimeStr = temp.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true
                });
                if (!bookedSlots.includes(slotTimeStr)) {
                  slots.push(slotTimeStr);
                }
                temp.setMinutes(temp.getMinutes() + duration);
              }
            }
          }
        }
      }
    }

    return {
      clinicName: clinicName,
      profession: profession,
      departments,
      doctors,
      slots
    };
  });

// ──────────────────────────────────────────────
// Public: Create Appointment (no auth needed)
// ──────────────────────────────────────────────
export const createAppointmentPublicServerFn = createServerFn({ method: "POST" })
  .validator((data: {
    tenantId: string;
    name: string;
    email: string;
    phone: string;
    dateTime: string;
    reason: string;
    doctorId?: string;
    timeSlot?: string;
    whatsapp?: string;
    appointmentType?: string;
  }) => {
    if (!data.tenantId || !data.name || !data.email || !data.phone || !data.dateTime || !data.reason) {
      throw new Error("Required booking fields missing");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const id = crypto.randomUUID();
    const dateVal = new Date(data.dateTime);
    const docId = data.doctorId || null;
    const tSlot = data.timeSlot || null;

    // Auto-assign sequential token number per tenant + date
    const tokenRow = await queryOne<any>(
      "SELECT COALESCE(MAX(tokenNo), 0) AS maxToken FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = DATE(?)",
      [data.tenantId, dateVal]
    );
    const tokenNo = (Number(tokenRow?.maxToken) || 0) + 1;

    await execute(
      `INSERT INTO Appointment (id, tenantId, name, email, phone, dateTime, reason, status, doctorId, timeSlot, whatsapp, appointmentType, tokenNo, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, NOW())`,
      [id, data.tenantId, data.name, data.email, data.phone, dateVal, data.reason, docId, tSlot, data.whatsapp || null, data.appointmentType || null, tokenNo]
    );

    // Queue WhatsApp notification if WA microservice is connected
    if (typeof window === "undefined") {
      try {
        const waConfig = await queryOne<any>("SELECT isEnabled FROM WhatsAppConfig WHERE tenantId = ? LIMIT 1", [data.tenantId]);
        if (waConfig && waConfig.isEnabled) {
          const waStatus = await getWAStatus(data.tenantId);
          if (waStatus.state === "CONNECTED") {
            const clinic = await queryOne<any>("SELECT clinicName FROM User WHERE tenantId = ? LIMIT 1", [data.tenantId]);
            const clinicName = clinic ? clinic.clinicName : "Clinic";

            let docName = "";
            if (docId) {
              const doc = await queryOne<any>("SELECT name FROM Doctor WHERE id = ? LIMIT 1", [docId]);
              if (doc) docName = doc.name;
            }

            const dateStr = dateVal.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
            const timeStr = tSlot || dateVal.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            const docText = docName ? ` with *${docName}*` : "";

            const waMessage = `Hello *${data.name}*,\n\nYour appointment at *${clinicName}*${docText} is confirmed for *${dateStr}* at *${timeStr}*.\n\n🎫 *Your Token No: #${tokenNo}*\n\nThank you for choosing HealthSync AI!\n\n_This is an automated notification message._`;
            await enqueueWA(data.tenantId, data.phone, waMessage);
          }
        }
      } catch (waErr: any) {
        console.error("[WhatsApp] Failed to send booking message:", waErr.message);
      }
    }

    return { success: true, appointmentId: id, tokenNo };
  });
