import { createServerFn } from "@tanstack/react-start";
import crypto from "crypto";
import { query, queryOne, withTransaction } from "./db";
import { overlapsBreak, resolveBreaks, type NormalizedBreak } from "./doctor-schedule-breaks";

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
    const profile = await queryOne<any>(
      "SELECT clinicName FROM ClinicProfile WHERE tenantId = ? LIMIT 1",
      [data.tenantId],
    );
    const userClinic = await queryOne<any>(
      "SELECT clinicName, profession FROM User WHERE tenantId = ? LIMIT 1",
      [data.tenantId],
    );
    if (userClinic) {
      profession = userClinic.profession || "Healthcare and medical";
      clinicName = profile ? profile.clinicName : userClinic.clinicName;
    } else if (profile) {
      clinicName = profile.clinicName;
    } else {
      throw new Error("Clinic not found");
    }

    // 2. Resolve active departments
    const departments = await query<any>(
      "SELECT * FROM Department WHERE tenantId = ? ORDER BY name ASC",
      [data.tenantId],
    );

    // 3. Resolve active doctors
    const doctors = await query<any>(
      `SELECT d.*, dept.name as departmentName
       FROM Doctor d
       LEFT JOIN Department dept ON d.departmentId = dept.id
       WHERE d.tenantId = ?
       ORDER BY d.name ASC`,
      [data.tenantId],
    );

    // 3b. Resolve active multi-location branches (publicly visible only when isActive)
    let locations: Array<{
      id: string;
      name: string;
      city: string | null;
      address: string | null;
    }> = [];
    try {
      locations = await query<any>(
        `SELECT id, name, city, address FROM Location
         WHERE tenantId = ? AND isActive = 1
         ORDER BY name ASC`,
        [data.tenantId],
      );
    } catch {
      // Location table may not exist on older deployments — silently treat as no locations
      locations = [];
    }

    // 4. If date and doctorId are selected, compute dynamic available slots
    const slots: string[] = [];
    const isEducation = profession === "Education institutions";
    const isGym = profession === "Fitness Gym etc";

    if (data.date && (data.doctorId || isEducation || isGym)) {
      const selectedDate = new Date(data.date);
      const dayOfWeek = selectedDate.getDay();
      const dateStr = selectedDate.toISOString().split("T")[0];

      // A. Check if the clinic/institution/gym is closed on this day
      const clinicHours = await queryOne<any>(
        "SELECT * FROM ClinicHours WHERE tenantId = ? AND dayOfWeek = ? LIMIT 1",
        [data.tenantId, dayOfWeek],
      );
      const clinicClosed = clinicHours
        ? !!clinicHours.isClosed
        : dayOfWeek === 0 || dayOfWeek === 6;

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
              [data.tenantId, dateStr],
            );
            const bookedSlots = existingBookings.map((b: any) => b.timeSlot || "");

            const temp = new Date(startObj);
            while (temp < endObj) {
              const slotTimeStr = temp.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
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
            [data.doctorId, dateStr],
          );

          if (!leave) {
            // C. Get doctor schedule for this day
            const docSchedule = await queryOne<any>(
              "SELECT * FROM DoctorSchedule WHERE doctorId = ? AND dayOfWeek = ? LIMIT 1",
              [data.doctorId, dayOfWeek],
            );

            // Resolve working hours: prefer DoctorSchedule, then fall back to
            // ClinicHours so doctors added without explicit weekly hours still
            // show available slots on the booking portal.
            let startTimeStr: string | null = null;
            let endTimeStr: string | null = null;
            let duration = 30;
            // Breaks (lunch etc.) configured for this weekday. Slots that
            // overlap one must not be offered.
            let breaks: NormalizedBreak[] = [];

            if (docSchedule) {
              startTimeStr = docSchedule.startTime;
              endTimeStr = docSchedule.endTime;
              duration = docSchedule.slotDuration || 30;
              breaks = resolveBreaks(docSchedule.breaks);
            } else if (clinicHours && clinicHours.openTime && clinicHours.closeTime) {
              // Fallback: use ClinicHours for this tenant & day
              startTimeStr = clinicHours.openTime;
              endTimeStr = clinicHours.closeTime;
              duration = clinicHours.slotDuration || 30;
            } else {
              // Last resort: sensible defaults (Mon–Sat 09:00–17:00)
              startTimeStr = "09:00";
              endTimeStr = "17:00";
              duration = 30;
            }

            if (startTimeStr && endTimeStr) {
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
                [data.doctorId, dateStr],
              );
              const bookedSlots = existingBookings.map((b: any) => b.timeSlot || "");

              // Generate slots
              const temp = new Date(startObj);
              while (temp < endObj) {
                const slotTimeStr = temp.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                });
                const slotStartMin = temp.getHours() * 60 + temp.getMinutes();
                if (
                  !bookedSlots.includes(slotTimeStr) &&
                  !overlapsBreak(slotStartMin, duration, breaks)
                ) {
                  slots.push(slotTimeStr);
                }
                temp.setMinutes(temp.getMinutes() + duration);
              }
            }
          }
        }
      }
    }

    // Whether this workspace can offer video consultations (healthcare + plan +
    // active subscription). Drives the public in-person/video choice (Req 3.4).
    let videoAvailable = false;
    try {
      const { isTenantVideoEligible } = await import("./video.server");
      videoAvailable = await isTenantVideoEligible(data.tenantId);
    } catch {
      videoAvailable = false;
    }

    return {
      clinicName: clinicName,
      profession: profession,
      departments,
      doctors,
      locations,
      slots,
      videoAvailable,
    };
  });

// ──────────────────────────────────────────────
// Public: Create Appointment (no auth needed)
// ──────────────────────────────────────────────
export const createAppointmentPublicServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      tenantId: string;
      name: string;
      email?: string;
      phone?: string;
      dateTime: string;
      reason: string;
      doctorId?: string;
      timeSlot?: string;
      whatsapp?: string;
      appointmentType?: string;
      locationId?: string;
      consultationMode?: string;
      /** Customer's choice on the WhatsApp booking-updates checkbox. */
      whatsappConsent?: boolean;
    }) => {
      if (!data.tenantId || !data.name || !data.dateTime || !data.reason) {
        throw new Error("Required booking fields missing");
      }
      if (data.whatsappConsent !== undefined && typeof data.whatsappConsent !== "boolean") {
        throw new Error("Invalid WhatsApp consent value");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const id = crypto.randomUUID();
    const dateVal = new Date(data.dateTime);
    const docId = data.doctorId || null;
    const tSlot = data.timeSlot || null;

    // Consultation mode (Req 3.2, 3.4, 3.5): default in_person; video requires
    // an eligible tenant. A patient booking their own video visit is legitimate,
    // so eligibility is a tenant-capability check, not a role check.
    const { normalizeConsultationMode } = await import("./video-consultation");
    const modeCheck = normalizeConsultationMode(data.consultationMode ?? "in_person");
    if (!modeCheck.ok) throw new Error("Invalid consultation mode");
    const consultationMode = modeCheck.mode;
    if (consultationMode === "video") {
      const { isTenantVideoEligible } = await import("./video.server");
      if (!(await isTenantVideoEligible(data.tenantId))) {
        throw new Error("Video consultation is not available for this clinic.");
      }
    }

    // Validate locationId if provided — must belong to this tenant and be active
    let locId: string | null = null;
    if (data.locationId) {
      try {
        const loc = await queryOne<any>(
          "SELECT id FROM Location WHERE id = ? AND tenantId = ? AND isActive = 1 LIMIT 1",
          [data.locationId, data.tenantId],
        );
        if (loc) locId = loc.id;
      } catch {
        // Location table may not exist on older deployments — ignore silently
        locId = null;
      }
    }

    // Provisional token (MAX + 1) keeps the row valid and unique on insert; the
    // final, time-ordered value is assigned by renumberDailyTokens just below.
    const tokenRow = await queryOne<any>(
      "SELECT COALESCE(MAX(tokenNo), 0) AS maxToken FROM Appointment WHERE tenantId = ? AND DATE(dateTime) = DATE(?)",
      [data.tenantId, dateVal],
    );
    let tokenNo = (Number(tokenRow?.maxToken) || 0) + 1;

    // Transactional outbox: the appointment and its "booking.created"
    // notification event commit together, so a confirmation can never be lost
    // between the booking write and dispatch. The notification engine never
    // throws, so a notification problem cannot fail the booking.
    let notifyEventId: string | null = null;
    await withTransaction(async (conn) => {
      await conn.query(
        `INSERT INTO Appointment (id, tenantId, name, email, phone, dateTime, reason, status, doctorId, timeSlot, whatsapp, appointmentType, tokenNo, locationId, consultationMode, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          id,
          data.tenantId,
          data.name,
          data.email || "",
          data.phone || "",
          dateVal,
          data.reason,
          docId,
          tSlot,
          data.whatsapp || null,
          data.appointmentType || null,
          tokenNo,
          locId,
          consultationMode,
        ],
      );
      if (typeof window === "undefined") {
        try {
          const { emitBookingEvent } = await import("./notify-engine");
          const emitted = await emitBookingEvent({
            tenantId: data.tenantId,
            appointmentId: id,
            type: "booking.created",
            source: "public_booking",
            consent:
              typeof data.whatsappConsent === "boolean"
                ? { optedIn: data.whatsappConsent, source: "public_booking_form" }
                : null,
            conn,
            // Held until the daily queue renumber below has run (released by
            // dispatchSoon); if this process stops first, the hold simply expires.
            delayMs: 30_000,
          });
          if (emitted.ok) notifyEventId = emitted.eventId;
        } catch {
          // A notification problem must never roll back the booking.
          console.error("[Notify] booking.created could not be recorded (booking kept).");
        }
      }
    });

    // Reorder the day's tokens by slot time, then read back this booking's token
    // so the confirmation/WhatsApp message shows the correct number. Token
    // ordering is a nicety — never let it break the booking or its notification.
    try {
      const { renumberDailyTokens } = await import("./token.server");
      // This booking gets its own confirmation below with the fresh token, so it
      // must not also be flagged for a "token changed" correction.
      await renumberDailyTokens(data.tenantId, dateVal, { skipNotifyId: id });
      const finalTok = await queryOne<any>("SELECT tokenNo FROM Appointment WHERE id = ? LIMIT 1", [
        id,
      ]);
      if (finalTok?.tokenNo != null) tokenNo = Number(finalTok.tokenNo);
    } catch (tokErr: any) {
      console.error("[Tokens] Daily renumber failed (booking still succeeds):", tokErr?.message);
    }

    // Dispatch the approved booking-confirmation template now that the final
    // queue number is in place (the durable worker retries if this process
    // stops). Business-initiated: no prior customer message is required.
    if (typeof window === "undefined" && notifyEventId) {
      const { dispatchSoon } = await import("./notify-engine");
      dispatchSoon(notifyEventId);
    }

    // Create the video room + patient join link when booked as a video visit.
    let joinLink: string | null = null;
    if (typeof window === "undefined" && consultationMode === "video") {
      try {
        const { syncVideoRoomForAppointment } = await import("./video.server");
        const synced = await syncVideoRoomForAppointment({
          appointmentId: id,
          tenantId: data.tenantId,
          from: null,
          to: "video",
          notify: true,
        });
        joinLink = synced.joinLink;
      } catch (e: any) {
        console.error("[Video] public room sync failed:", e?.message);
      }
    }

    return { success: true, appointmentId: id, tokenNo, joinLink, consultationMode };
  });
