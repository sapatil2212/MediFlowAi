import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  Loader2,
  CheckCircle2,
  X,
  Stethoscope,
  Users,
  Clock,
  FileText,
  AlertCircle,
  TrendingUp,
  Percent,
} from "lucide-react";
import {
  getDoctorSmartAnalysisServerFn,
  sendDoctorMonthlyReportEmailServerFn,
} from "@/lib/auth";
import { buildDoctorReportPdf, type DoctorReportData } from "@/lib/doctor-report-pdf";

export interface DoctorSmartAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  doctor: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    qualifications?: string;
    departmentName?: string;
  } | null;
  clinicName?: string;
}

export function DoctorSmartAnalysisModal({
  isOpen,
  onClose,
  doctor,
  clinicName = "HealthSync Clinic",
}: DoctorSmartAnalysisModalProps) {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("month");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState<boolean>(true);
  const [reportData, setReportData] = useState<DoctorReportData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Email sending state
  const [isSendingEmail, setIsSendingEmail] = useState<boolean>(false);
  const [emailStatus, setEmailStatus] = useState<{
    success: boolean;
    recipient?: string;
    message?: string;
  } | null>(null);

  // PDF downloading state
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);

  // Fetch report data on open or when parameters change
  useEffect(() => {
    if (!isOpen || !doctor?.id) return;

    let isMounted = true;
    setLoading(true);
    setErrorMsg("");
    setEmailStatus(null);

    const dateStr = currentDate.toISOString().split("T")[0];

    getDoctorSmartAnalysisServerFn({
      data: {
        doctorId: doctor.id,
        period,
        dateStr,
      },
    })
      .then((res) => {
        if (!isMounted) return;
        setReportData(res);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load doctor smart analysis:", err);
        setErrorMsg(err?.message || "Failed to load clinical analysis report");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, doctor?.id, period, currentDate]);

  // Navigate date window
  const handlePrev = () => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (period === "day") next.setDate(next.getDate() - 1);
      else if (period === "week") next.setDate(next.getDate() - 7);
      else if (period === "month") next.setMonth(next.getMonth() - 1);
      else if (period === "year") next.setFullYear(next.getFullYear() - 1);
      return next;
    });
  };

  const handleNext = () => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (period === "day") next.setDate(next.getDate() + 1);
      else if (period === "week") next.setDate(next.getDate() + 7);
      else if (period === "month") next.setMonth(next.getMonth() + 1);
      else if (period === "year") next.setFullYear(next.getFullYear() + 1);
      return next;
    });
  };

  const handleResetToCurrent = () => {
    setCurrentDate(new Date());
  };

  // Export PDF Handler (Direct Download)
  const handleDownloadPdf = async () => {
    if (!reportData) return;
    setIsDownloadingPdf(true);
    try {
      const { doc, filename } = buildDoctorReportPdf(reportData);
      doc.save(filename);
    } catch (err: any) {
      console.error("PDF generation failed:", err);
      alert("Failed to generate PDF: " + err.message);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // Send Email Handler
  const handleSendEmail = async () => {
    if (!doctor?.id || !reportData) return;
    setIsSendingEmail(true);
    setEmailStatus(null);
    try {
      const dateStr = currentDate.toISOString().split("T")[0];
      const res = await sendDoctorMonthlyReportEmailServerFn({
        data: {
          doctorId: doctor.id,
          monthDateStr: dateStr,
        },
      });
      setEmailStatus({
        success: true,
        recipient: res.recipient,
        message: `Report successfully dispatched to ${res.recipient} with attached PDF.`,
      });
    } catch (err: any) {
      console.error("Failed to email report:", err);
      setEmailStatus({
        success: false,
        message: err?.message || "Failed to send email report.",
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  if (!isOpen || !doctor) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50/70 dark:bg-zinc-850/60">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center shadow-xs">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  Clinical Performance &amp; Attendance Audit
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  <strong className="text-zinc-800 dark:text-zinc-200">Dr. {doctor.name}</strong> •{" "}
                  {doctor.departmentName || "General Medicine"} • {clinicName}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Filter & Period Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 px-6 py-3 bg-white dark:bg-zinc-900">
            {/* Period Tabs */}
            <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
              {(
                [
                  { id: "day", label: "Day" },
                  { id: "week", label: "Weekly" },
                  { id: "month", label: "Monthly" },
                  { id: "year", label: "Yearly" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPeriod(tab.id)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    period === tab.id
                      ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Date Navigator */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrev}
                className="h-8 w-8 rounded-lg border border-zinc-200 dark:border-zinc-700 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
                title="Previous Period"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 min-w-36 text-center px-2 py-1 rounded bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700">
                {reportData?.periodLabel || "Loading..."}
              </span>

              <button
                type="button"
                onClick={handleNext}
                className="h-8 w-8 rounded-lg border border-zinc-200 dark:border-zinc-700 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
                title="Next Period"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={handleResetToCurrent}
                className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 px-2 py-1 underline cursor-pointer"
              >
                Current
              </button>
            </div>

            {/* Quick Actions (Download PDF + Email Report) */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={loading || isDownloadingPdf || !reportData}
                className="rounded-lg bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isDownloadingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>Export PDF</span>
              </button>

              <button
                type="button"
                onClick={handleSendEmail}
                disabled={loading || isSendingEmail || !reportData}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                title="Send official monthly audit report with PDF to doctor and clinic registered email"
              >
                {isSendingEmail ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mail className="h-3.5 w-3.5" />
                )}
                <span>Email Report</span>
              </button>
            </div>
          </div>

          {/* Email dispatch toast/banner */}
          {emailStatus && (
            <div
              className={`px-6 py-2.5 text-xs font-medium flex items-center justify-between border-b ${
                emailStatus.success
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                  : "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800"
              }`}
            >
              <div className="flex items-center gap-2">
                {emailStatus.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                )}
                <span>{emailStatus.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setEmailStatus(null)}
                className="text-xs font-bold underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {loading ? (
              <div className="py-16 text-center space-y-3">
                <Loader2 className="h-7 w-7 mx-auto animate-spin text-zinc-400" />
                <p className="text-xs text-zinc-500 font-medium">
                  Aggregating clinical records, attendance logs, and consultations...
                </p>
              </div>
            ) : errorMsg ? (
              <div className="p-8 text-center text-red-600 dark:text-red-400 space-y-2">
                <AlertCircle className="h-8 w-8 mx-auto" />
                <p className="text-sm font-semibold">{errorMsg}</p>
              </div>
            ) : reportData ? (
              <>
                {/* 5-Metric Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {/* Present Days */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-850/40 p-3.5 space-y-1">
                    <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                      Days Present
                    </p>
                    <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                      {reportData.presentDays}{" "}
                      <span className="text-xs font-normal text-zinc-400">
                        / {reportData.workingDays}d
                      </span>
                    </p>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        {reportData.attendanceRate}% Attendance
                      </span>
                    </div>
                  </div>

                  {/* Leaves & Holidays */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-850/40 p-3.5 space-y-1">
                    <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                      Days on Leave
                    </p>
                    <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                      {reportData.leavesCount}{" "}
                      <span className="text-xs font-normal text-zinc-400">days</span>
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      +{reportData.holidaysCount} Public Holidays
                    </p>
                  </div>

                  {/* OPD Bookings */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-850/40 p-3.5 space-y-1">
                    <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                      Total OPDs
                    </p>
                    <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                      {reportData.totalOpdBookings}
                    </p>
                    <p className="text-[11px] text-zinc-400">Appointments scheduled</p>
                  </div>

                  {/* Consultations Done */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-850/40 p-3.5 space-y-1">
                    <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                      Consults Done
                    </p>
                    <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                      {reportData.completedConsultations}
                    </p>
                    <p className="text-[11px] text-zinc-500 font-medium">
                      {reportData.completionRate}% completed
                    </p>
                  </div>

                  {/* Patients New vs Return */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-850/40 p-3.5 space-y-1 col-span-2 sm:col-span-1">
                    <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                      New Patients
                    </p>
                    <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                      {reportData.newPatientsCount}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      +{reportData.returningPatientsCount} follow-ups
                    </p>
                  </div>
                </div>

                {/* Detailed Day-by-Day Activity & Attendance Table */}
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900">
                  <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-850/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-zinc-500" />
                      <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                        Activity Breakdown ({reportData.periodLabel})
                      </h4>
                    </div>
                    <span className="text-[11px] text-zinc-400">
                      {reportData.dailyBreakdown.length} days logged
                    </span>
                  </div>

                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-850/70 text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Duty Status</th>
                          <th className="py-2.5 px-3">Remarks / Reason</th>
                          <th className="py-2.5 px-3 text-center">OPD Visits</th>
                          <th className="py-2.5 px-3 text-center">Completed</th>
                          <th className="py-2.5 px-3">Patient Sample</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {reportData.dailyBreakdown.map((row) => (
                          <tr
                            key={row.date}
                            className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40 transition-colors"
                          >
                            <td className="py-2 px-3 font-mono font-medium text-zinc-700 dark:text-zinc-300">
                              {new Date(row.date + "T00:00:00").toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                              })}{" "}
                              <span className="text-zinc-400 text-[10px]">({row.dayName})</span>
                            </td>

                            <td className="py-2 px-3">
                              {row.status === "Present" ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                                  Present
                                </span>
                              ) : row.status === "On Leave" ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-full">
                                  On Leave
                                </span>
                              ) : row.status === "Holiday" ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-full">
                                  Holiday
                                </span>
                              ) : (
                                <span className="text-[11px] text-zinc-400 font-medium">
                                  Weekly Off
                                </span>
                              )}
                            </td>

                            <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400 truncate max-w-xs">
                              {row.leaveReason ||
                                (row.status === "Present" ? "Regular OPD Consultation" : "—")}
                            </td>

                            <td className="py-2 px-3 text-center font-bold text-zinc-800 dark:text-zinc-200">
                              {row.opdCount}
                            </td>

                            <td className="py-2 px-3 text-center font-bold text-zinc-800 dark:text-zinc-200">
                              {row.completedCount}
                            </td>

                            <td className="py-2 px-3 text-zinc-500 truncate max-w-xs">
                              {row.patientSample || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Audit Notice Box */}
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-850/50 p-4 text-xs text-zinc-500 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Automated Monthly Audit &amp; Dispatch Policy
                    </span>
                    <span className="text-[10px] font-mono bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 px-1.5 py-0.5 rounded">
                      Active
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    This clinical performance audit is automatically compiled on the 1st of every
                    month. A certified PDF in invoice format is emailed directly to Dr.{" "}
                    {doctor.name} ({doctor.email || "Registered email"}) and clinic administrators.
                  </p>
                </div>
              </>
            ) : null}
          </div>

          {/* Modal Footer */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 px-6 py-3.5 bg-zinc-50/70 dark:bg-zinc-850/60 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={loading || !reportData || isDownloadingPdf}
                className="rounded-lg bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDownloadingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Download Report PDF
              </button>

              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default DoctorSmartAnalysisModal;
