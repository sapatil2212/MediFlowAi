import { query, queryOne } from "./db";
import { transporter } from "./email";
import {
  type DoctorReportData,
  buildDoctorReportPdf,
} from "./doctor-report-pdf";

/**
 * Format raw date to YYYY-MM-DD without UTC conversion shifts
 */
function toLocalDateStr(val: any): string {
  if (!val) return "";
  if (typeof val === "string") return val.slice(0, 10);
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

/**
 * Computes exact start and end dates for a given period
 */
function getPeriodWindow(period: "day" | "week" | "month" | "year", dateStr?: string) {
  const base = dateStr ? new Date(dateStr) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth(); // 0-indexed

  if (period === "day") {
    const d = toLocalDateStr(base);
    const dayLabel = base.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return {
      startDate: d,
      endDate: d,
      periodLabel: `Day (${dayLabel})`,
    };
  }

  if (period === "week") {
    // Current week: Monday to Sunday
    const currentDay = base.getDay();
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(base);
    monday.setDate(base.getDate() + distanceToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const sStr = toLocalDateStr(monday);
    const eStr = toLocalDateStr(sunday);
    const label = `${monday.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${sunday.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
    return {
      startDate: sStr,
      endDate: eStr,
      periodLabel: `Week (${label})`,
    };
  }

  if (period === "year") {
    const sStr = `${year}-01-01`;
    const eStr = `${year}-12-31`;
    return {
      startDate: sStr,
      endDate: eStr,
      periodLabel: `Year ${year}`,
    };
  }

  // Default: month
  const lastDay = new Date(year, month + 1, 0).getDate();
  const sStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const eStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const monthName = base.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return {
    startDate: sStr,
    endDate: eStr,
    periodLabel: monthName,
  };
}

/**
 * Fetches all metrics and computes smart analysis for a doctor in the specified period.
 * Server-only (accesses db).
 */
export async function getDoctorSmartAnalysisData({
  tenantId,
  doctorId,
  period = "month",
  dateStr,
}: {
  tenantId: string;
  doctorId: string;
  period?: "day" | "week" | "month" | "year";
  dateStr?: string;
}): Promise<DoctorReportData> {
  const { startDate, endDate, periodLabel } = getPeriodWindow(period, dateStr);

  // 1. Fetch Doctor
  const doctor = await queryOne<any>(
    `SELECT d.*, dept.name as departmentName
     FROM Doctor d
     LEFT JOIN Department dept ON d.departmentId = dept.id
     WHERE d.id = ? AND d.tenantId = ? LIMIT 1`,
    [doctorId, tenantId],
  );
  if (!doctor) {
    throw new Error("Doctor not found for this clinic");
  }

  // 2. Fetch Clinic Profile
  const clinicProfile = await queryOne<any>(
    `SELECT clinicName, clinicianName, phone, email, address
     FROM ClinicProfile WHERE tenantId = ? LIMIT 1`,
    [tenantId],
  );
  const clinicUser = await queryOne<any>(
    `SELECT clinicName, email, phone, name FROM User WHERE tenantId = ? LIMIT 1`,
    [tenantId],
  );

  const clinic = {
    clinicName: clinicProfile?.clinicName || clinicUser?.clinicName || "HealthSync Clinic",
    clinicianName: clinicProfile?.clinicianName || clinicUser?.name || "Medical Director",
    phone: clinicProfile?.phone || clinicUser?.phone || "",
    email: clinicProfile?.email || clinicUser?.email || "",
    address: clinicProfile?.address ? clinicProfile.address.trim() : "Main Healthcare Clinic",
  };

  // 3. Fetch Doctor Leaves in period
  const leaves = await query<any>(
    `SELECT leaveDate, reason, isHoliday
     FROM DoctorLeave
     WHERE doctorId = ? AND leaveDate BETWEEN ? AND ?
     ORDER BY leaveDate ASC`,
    [doctorId, startDate, endDate],
  );

  const leaveMap = new Map<string, { reason: string; isHoliday: boolean }>();
  for (const l of leaves) {
    const dStr = toLocalDateStr(l.leaveDate);
    leaveMap.set(dStr, {
      reason: l.reason || (l.isHoliday ? "Public Holiday" : "Leave"),
      isHoliday: !!l.isHoliday,
    });
  }

  // 4. Fetch Appointments in period
  const appointments = await query<any>(
    `SELECT id, name, phone, email, dateTime, status, reason, consultationMode, createdAt
     FROM Appointment
     WHERE tenantId = ? AND doctorId = ? AND DATE(dateTime) BETWEEN ? AND ?
     ORDER BY dateTime ASC`,
    [tenantId, doctorId, startDate, endDate],
  );

  // 5. Group appointments by day
  const apptsByDay = new Map<string, any[]>();
  for (const a of appointments) {
    const dStr = toLocalDateStr(a.dateTime);
    if (!apptsByDay.has(dStr)) apptsByDay.set(dStr, []);
    apptsByDay.get(dStr)!.push(a);
  }

  // 6. Check New vs Returning Patients
  const patientIdentifiers = new Set<string>();
  for (const a of appointments) {
    const ident = a.phone || a.email || a.name;
    if (ident) patientIdentifiers.add(ident);
  }

  let newPatientsCount = 0;
  let returningPatientsCount = 0;

  for (const ident of patientIdentifiers) {
    const prior = await queryOne<any>(
      `SELECT id FROM Appointment
       WHERE tenantId = ? AND (phone = ? OR email = ? OR name = ?) AND DATE(dateTime) < ? LIMIT 1`,
      [tenantId, ident, ident, ident, startDate],
    );
    if (prior) {
      returningPatientsCount++;
    } else {
      newPatientsCount++;
    }
  }

  // 7. Build daily breakdown
  const startObj = new Date(startDate);
  const endObj = new Date(endDate);
  const dailyBreakdown: DoctorReportData["dailyBreakdown"] = [];

  let cur = new Date(startObj);
  let workingDays = 0;
  let leavesCount = 0;
  let holidaysCount = 0;

  while (cur <= endObj) {
    const dateStr = toLocalDateStr(cur);
    const dayOfWeek = cur.getDay(); // 0 is Sun
    const dayName = cur.toLocaleDateString("en-IN", { weekday: "short" });
    const isSunday = dayOfWeek === 0;

    const dayAppts = apptsByDay.get(dateStr) || [];
    const opdCount = dayAppts.length;
    const completedCount = dayAppts.filter(
      (a) => a.status === "Completed" || a.status === "completed",
    ).length;

    const leaveInfo = leaveMap.get(dateStr);

    let status: "Present" | "On Leave" | "Holiday" | "Weekly Off" = "Present";
    let leaveReason: string | null = null;

    if (leaveInfo) {
      if (leaveInfo.isHoliday) {
        status = "Holiday";
        holidaysCount++;
      } else {
        status = "On Leave";
        leavesCount++;
      }
      leaveReason = leaveInfo.reason;
    } else if (isSunday) {
      status = "Weekly Off";
    } else {
      workingDays++;
    }

    const patientSample = dayAppts
      .slice(0, 2)
      .map((a) => a.name)
      .join(", ");

    dailyBreakdown.push({
      date: dateStr,
      dayName,
      status,
      leaveReason,
      opdCount,
      completedCount,
      patientSample: opdCount > 2 ? `${patientSample} +${opdCount - 2} more` : patientSample,
    });

    cur.setDate(cur.getDate() + 1);
  }

  const totalDays = dailyBreakdown.length;
  if (period === "day") {
    workingDays = leavesCount > 0 ? 0 : 1;
  }
  const presentDays = Math.max(0, workingDays - leavesCount);
  const attendanceRate =
    workingDays > 0 ? Math.min(100, Math.round((presentDays / workingDays) * 100)) : 100;

  const totalOpdBookings = appointments.length;
  const completedConsultations = appointments.filter(
    (a) => a.status === "Completed" || a.status === "completed",
  ).length;
  const cancelledAppointments = appointments.filter(
    (a) => a.status === "Cancelled" || a.status === "cancelled",
  ).length;
  const pendingAppointments = totalOpdBookings - completedConsultations - cancelledAppointments;

  const completionRate =
    totalOpdBookings > 0
      ? Math.round((completedConsultations / totalOpdBookings) * 100)
      : 0;

  return {
    doctor: {
      id: doctor.id,
      name: doctor.name,
      email: doctor.email || "",
      phone: doctor.phone || "",
      qualifications: doctor.qualifications || "Consultant Physician",
      departmentName: doctor.departmentName || "General Medicine",
    },
    clinic,
    period,
    periodLabel,
    startDate,
    endDate,
    totalDays,
    workingDays: workingDays || totalDays,
    leavesCount,
    holidaysCount,
    presentDays,
    attendanceRate,
    totalOpdBookings,
    completedConsultations,
    cancelledAppointments,
    pendingAppointments,
    newPatientsCount,
    returningPatientsCount,
    completionRate,
    dailyBreakdown,
  };
}

/**
 * Sends the monthly report email with PDF attached to both doctor and clinic email.
 * Server-only (uses transporter and fs/buffer).
 */
export async function sendDoctorMonthlyReportEmail({
  tenantId,
  doctorId,
  monthDateStr,
  overrideRecipient,
}: {
  tenantId: string;
  doctorId: string;
  monthDateStr?: string;
  overrideRecipient?: string;
}): Promise<{ success: boolean; recipient: string; filename: string }> {
  // Fetch report data
  const data = await getDoctorSmartAnalysisData({
    tenantId,
    doctorId,
    period: "month",
    dateStr: monthDateStr,
  });

  // Build PDF
  const { filename, getBuffer } = buildDoctorReportPdf(data);
  const pdfBuffer = getBuffer();

  const primaryRecipient = overrideRecipient || data.doctor.email || data.clinic.email;
  if (!primaryRecipient) {
    throw new Error("No registered email address found for doctor or clinic.");
  }

  // CC clinic email if sending to doctor
  const ccEmails: string[] = [];
  if (data.clinic.email && data.clinic.email !== primaryRecipient) {
    ccEmails.push(data.clinic.email);
  }
  if (data.doctor.email && data.doctor.email !== primaryRecipient) {
    ccEmails.push(data.doctor.email);
  }

  const subject = `Monthly Clinical Performance & Attendance Report — Dr. ${data.doctor.name} (${data.periodLabel})`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f4f5; margin: 0; padding: 24px; color: #18181b; }
        .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e4e4e7; overflow: hidden; }
        .header { background: #0059C6; padding: 28px 32px; color: #ffffff; }
        .header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 700; }
        .header p { margin: 0; font-size: 13px; opacity: 0.9; }
        .body { padding: 28px 32px; }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0; }
        .stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; text-align: center; }
        .stat-val { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 2px; }
        .stat-lbl { font-size: 11px; text-transform: uppercase; font-weight: 600; color: #64748b; letter-spacing: 0.5px; margin: 0; }
        .btn { display: inline-block; background: #0059C6; color: #ffffff; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 13px; text-decoration: none; margin-top: 16px; }
        .footer { border-top: 1px solid #f1f5f9; padding: 20px 32px; font-size: 11px; color: #94a3b8; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>${data.clinic.clinicName}</h1>
          <p>Monthly Clinical Performance & Attendance Audit — ${data.periodLabel}</p>
        </div>
        <div class="body">
          <p style="font-size: 14px; margin-top: 0;">Dear <strong>Dr. ${data.doctor.name}</strong> & Clinical Care Desk,</p>
          <p style="font-size: 13px; color: #52525b; line-height: 1.6;">
            Please find attached your official Clinical Performance &amp; Attendance Report for <strong>${data.periodLabel}</strong>. Below is your clinical summary:
          </p>

          <table width="100%" cellpadding="8" cellspacing="0" style="margin: 16px 0; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; font-size: 13px;">
            <tr>
              <td style="color: #64748b; width: 45%;">Practitioner:</td>
              <td style="font-weight: 600;">Dr. ${data.doctor.name} (${data.doctor.departmentName})</td>
            </tr>
            <tr>
              <td style="color: #64748b;">Attendance Rate:</td>
              <td style="font-weight: 700; color: #059669;">${data.attendanceRate}% (${data.presentDays} of ${data.workingDays} working days)</td>
            </tr>
            <tr>
              <td style="color: #64748b;">Days on Leave:</td>
              <td style="font-weight: 600; color: #dc2626;">${data.leavesCount} days (${data.holidaysCount} holidays)</td>
            </tr>
            <tr>
              <td style="color: #64748b;">Total OPD Bookings:</td>
              <td style="font-weight: 600;">${data.totalOpdBookings} appointments</td>
            </tr>
            <tr>
              <td style="color: #64748b;">Consultations Completed:</td>
              <td style="font-weight: 700; color: #0059C6;">${data.completedConsultations} (${data.completionRate}% completion)</td>
            </tr>
            <tr>
              <td style="color: #64748b;">Patient Demographics:</td>
              <td style="font-weight: 600;">${data.newPatientsCount} New Patients • ${data.returningPatientsCount} Returning</td>
            </tr>
          </table>

          <p style="font-size: 12px; color: #71717a; line-height: 1.5;">
            📎 A complete, itemized audit PDF report (<strong>${filename}</strong>) with daily attendance breakdowns, OPD records, and medical sign-off sections has been attached to this email.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} ${data.clinic.clinicName} • Powered by HealthSync AI Management System<br/>
          Confidential healthcare audit document intended only for the designated practitioner and clinic administrative staff.
        </div>
      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"${data.clinic.clinicName}" <${process.env.EMAIL_USERNAME || "no-reply@bookmytime.co"}>`,
    to: primaryRecipient,
    cc: ccEmails.length > 0 ? ccEmails.join(", ") : undefined,
    subject,
    html,
    attachments: [
      {
        filename,
        content: Buffer.from(pdfBuffer),
        contentType: "application/pdf",
      },
    ],
  });

  return {
    success: true,
    recipient: primaryRecipient,
    filename,
  };
}
