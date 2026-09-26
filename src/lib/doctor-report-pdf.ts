import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface DoctorReportData {
  doctor: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    qualifications?: string;
    departmentName?: string;
  };
  clinic: {
    clinicName: string;
    clinicianName?: string;
    phone?: string;
    email?: string;
    address?: string;
  };
  period: "day" | "week" | "month" | "year";
  periodLabel: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  workingDays: number;
  leavesCount: number;
  holidaysCount: number;
  presentDays: number;
  attendanceRate: number;
  totalOpdBookings: number;
  completedConsultations: number;
  cancelledAppointments: number;
  pendingAppointments: number;
  newPatientsCount: number;
  returningPatientsCount: number;
  completionRate: number;
  dailyBreakdown: Array<{
    date: string;
    dayName: string;
    status: "Present" | "On Leave" | "Holiday" | "Weekly Off";
    leaveReason: string | null;
    opdCount: number;
    completedCount: number;
    patientSample?: string;
  }>;
}

/**
 * Builds the branded Doctor Smart Analysis Report PDF matching the exact BookMyTime / HealthSync Invoice style.
 * Purely client-safe (no Node/db/dotenv dependencies).
 */
export function buildDoctorReportPdf(d: DoctorReportData) {
  const doc = new jsPDF();
  const brand: [number, number, number] = [0, 89, 198]; // #0059C6 Brand Blue
  const dark: [number, number, number] = [24, 24, 27]; // #18181b
  const gray: [number, number, number] = [113, 113, 122]; // #71717a
  const success: [number, number, number] = [5, 150, 105]; // Emerald
  const borderCol: [number, number, number] = [228, 228, 231];

  const reportNo = `DOC-AUDIT-${d.startDate.replace(/-/g, "")}-${d.doctor.id.slice(0, 4).toUpperCase()}`;
  const nowStr = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // ── Header: Clinic Title (left) & Report Metadata (right) ──
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...brand);
  doc.text(d.clinic.clinicName, 14, 18);

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...gray);
  doc.text("CLINICAL PERFORMANCE & ATTENDANCE AUDIT", 14, 24);

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  doc.text(d.clinic.address || "Healthcare Care Facility", 14, 29);

  // Meta (right aligned)
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...dark);
  doc.text("DOCTOR CLINICAL REPORT", 196, 18, { align: "right" });

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...gray);
  doc.text(`Report Ref: ${reportNo}`, 196, 24, { align: "right" });
  doc.text(`Generated: ${nowStr}`, 196, 29, { align: "right" });
  doc.text(`Period: ${d.periodLabel}`, 196, 34, { align: "right" });

  // Divider
  doc.setDrawColor(...borderCol);
  doc.setLineWidth(0.4);
  doc.line(14, 38, 196, 38);

  // ── Doctor & Facility Info Cards ──
  // Left: Doctor Info
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...gray);
  doc.text("PRACTITIONER CREDENTIALS", 14, 46);

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...dark);
  doc.text(`Dr. ${d.doctor.name.replace(/^Dr\.\s*/i, "")}`, 14, 52);

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.text(d.doctor.qualifications || "Consultant Practitioner", 14, 57);
  doc.text(`Department: ${d.doctor.departmentName || "General Medicine"}`, 14, 62);
  if (d.doctor.email || d.doctor.phone) {
    doc.text(`Contact: ${[d.doctor.phone, d.doctor.email].filter(Boolean).join(" • ")}`, 14, 67);
  }

  // Right: Key Performance Badges
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...gray);
  doc.text("EXECUTIVE CLINICAL SUMMARY", 120, 46);

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...dark);
  doc.text(`Attendance Rate:`, 120, 52);
  doc.setTextColor(...success);
  doc.text(`${d.attendanceRate}% (${d.presentDays} of ${d.workingDays} working days)`, 155, 52);

  doc.setTextColor(...dark);
  doc.text(`Total OPD Bookings:`, 120, 58);
  doc.text(`${d.totalOpdBookings} visits`, 160, 58);

  doc.text(`Consultations Done:`, 120, 64);
  doc.setTextColor(...brand);
  doc.text(`${d.completedConsultations} (${d.completionRate}% completion)`, 160, 64);

  // ── KPI Summary Table (Invoice Metric Cards block) ──
  const kpiTop = 73;
  autoTable(doc, {
    startY: kpiTop,
    head: [
      [
        "Days Present",
        "Days on Leave",
        "Total OPDs",
        "Completed Consults",
        "New Patients",
        "Attendance %",
      ],
    ],
    body: [
      [
        `${d.presentDays} days`,
        `${d.leavesCount} days`,
        `${d.totalOpdBookings}`,
        `${d.completedConsultations}`,
        `${d.newPatientsCount}`,
        `${d.attendanceRate}%`,
      ],
    ],
    theme: "striped",
    headStyles: {
      fillColor: brand,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      halign: "center",
    },
    bodyStyles: {
      fontSize: 9.5,
      textColor: [24, 24, 27],
      fontStyle: "bold",
      halign: "center",
      cellPadding: 4,
    },
    margin: { left: 14, right: 14 },
  });

  const afterKpi = ((doc as any).lastAutoTable?.finalY ?? kpiTop) + 6;

  // ── Daily Breakdown Table ──
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...dark);
  doc.text(`Clinical Activity & Attendance Breakdown (${d.periodLabel})`, 14, afterKpi);

  const tableRows = d.dailyBreakdown.map((row) => {
    const formattedDate = new Date(row.date + "T00:00:00").toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
    });
    return [
      `${formattedDate} (${row.dayName})`,
      row.status,
      row.leaveReason || (row.status === "Present" ? "On Duty / Consultation" : "Scheduled Off"),
      String(row.opdCount),
      String(row.completedCount),
      row.patientSample || "—",
    ];
  });

  autoTable(doc, {
    startY: afterKpi + 4,
    head: [["Date", "Status", "Remarks / Duty", "OPD", "Completed", "Patient Sample"]],
    body: tableRows,
    theme: "striped",
    headStyles: {
      fillColor: [39, 39, 42],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: [39, 39, 42],
      cellPadding: 2.5,
    },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 24, fontStyle: "bold" },
      2: { cellWidth: 50 },
      3: { cellWidth: 15, halign: "center" },
      4: { cellWidth: 20, halign: "center" },
      5: { cellWidth: 41 },
    },
    didParseCell: (data) => {
      if (data.column.index === 1) {
        if (data.cell.raw === "Present") {
          data.cell.styles.textColor = [5, 150, 105]; // Green
        } else if (data.cell.raw === "On Leave") {
          data.cell.styles.textColor = [220, 38, 38]; // Red
        } else if (data.cell.raw === "Holiday") {
          data.cell.styles.textColor = [79, 70, 229]; // Indigo
        } else {
          data.cell.styles.textColor = [113, 113, 122];
        }
      }
    },
    margin: { left: 14, right: 14 },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? 200;

  // If table went too close to bottom of page, add page for signatures
  let signY = finalY + 12;
  if (signY > 250) {
    doc.addPage();
    signY = 30;
  }

  // ── Sign-off and Verification Box ──
  doc.setDrawColor(...borderCol);
  doc.setLineWidth(0.4);
  doc.line(14, signY, 196, signY);

  signY += 12;
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...dark);
  doc.text("PRACTITIONER ATTESTATION", 14, signY);
  doc.text("CLINIC MEDICAL DESK & SEAL", 125, signY);

  signY += 14;
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...gray);
  doc.text(`Dr. ${d.doctor.name} — Practitioner Signature`, 14, signY);
  doc.text(`${d.clinic.clinicName} — Authorized Signature & Stamp`, 125, signY);

  // ── Footer ──
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...borderCol);
    doc.setLineWidth(0.3);
    doc.line(14, 285, 196, 285);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...gray);
    doc.text(
      `HealthSync AI Healthcare Management System • Confidential Clinical Performance Report`,
      14,
      290,
    );
    doc.text(`Page ${i} of ${pageCount}`, 196, 290, { align: "right" });
  }

  const filename = `Clinical_Report_${d.doctor.name.replace(/[^a-zA-Z0-9]/g, "_")}_${d.startDate}_${d.endDate}.pdf`;

  return {
    doc,
    filename,
    getBuffer: () => {
      // In browser or Node.js environment
      if (typeof Buffer !== "undefined") {
        return Buffer.from(doc.output("arraybuffer"));
      }
      return new Uint8Array(doc.output("arraybuffer"));
    },
    getDataUrl: () => doc.output("dataurlstring"),
  };
}
