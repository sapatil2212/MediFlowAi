import React, { useState, useEffect, useMemo } from "react";
import { motion } from "motion/react";
import {
  Calendar,
  CalendarCheck,
  CheckCircle2,
  X,
  Loader2,
  Send,
  MessageCircle,
  Users,
  AlertCircle,
  CalendarDays,
  Clock,
  RotateCcw,
} from "lucide-react";
import {
  getDoctorScheduledLeavesServerFn,
  getDoctorAffectedAppointmentsServerFn,
  cancelDoctorLeaveAndReinstateAppointmentsServerFn,
} from "@/lib/auth";
import { findCatalogTemplate } from "@/lib/notify-catalog";
import { formatTemplateDate, normalizeSlotLabel, parseWallClock } from "@/lib/notify-time";

/** The approved Meta utility template sent when a doctor's absence is cancelled. */
const REINSTATED_TEMPLATE = findCatalogTemplate("clinic_booking_reinstated", "en_US");

export interface DoctorCancelLeaveModalProps {
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
  waStatus?: string;
  waConnectedNumber?: string;
  onSuccess: (result: {
    leavesCancelledCount: number;
    reinstatedAppointmentsCount: number;
    notifiedPatientsCount: number;
    /** True when the server skipped WhatsApp because the caller may not send. */
    whatsappSkippedForRole?: boolean;
    dates: string[];
  }) => void;
}

export function DoctorCancelLeaveModal({
  isOpen,
  onClose,
  doctor,
  clinicName = "HealthSync Clinic",
  onSuccess,
}: DoctorCancelLeaveModalProps) {
  // Leaves state
  const [loadingLeaves, setLoadingLeaves] = useState<boolean>(false);
  const [scheduledLeaves, setScheduledLeaves] = useState<any[]>([]);
  const [selectedDatesToCancel, setSelectedDatesToCancel] = useState<string[]>([]);

  // Appointments state
  const [loadingAppts, setLoadingAppts] = useState<boolean>(false);
  const [affectedAppts, setAffectedAppts] = useState<any[]>([]);
  const [selectedApptIds, setSelectedApptIds] = useState<string[]>([]);

  // WhatsApp Reinstatement Message state
  const [sendWhatsApp, setSendWhatsApp] = useState<boolean>(true);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submissionResult, setSubmissionResult] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Load leaves when modal opens
  useEffect(() => {
    if (!isOpen || !doctor?.id) {
      setScheduledLeaves([]);
      setSelectedDatesToCancel([]);
      setAffectedAppts([]);
      setSelectedApptIds([]);
      setSubmissionResult(null);
      setErrorMsg("");
      return;
    }

    let isMounted = true;
    setLoadingLeaves(true);
    setErrorMsg("");

    getDoctorScheduledLeavesServerFn({
      data: { doctorId: doctor.id },
    })
      .then((res) => {
        if (!isMounted) return;
        const leaves = res || [];
        setScheduledLeaves(leaves);
        // By default select all scheduled leave dates
        const dateStrs = leaves.map((l: any) => l.leaveDate);
        setSelectedDatesToCancel(dateStrs);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load doctor leaves:", err);
        setErrorMsg("Failed to load scheduled leaves for this doctor.");
      })
      .finally(() => {
        if (isMounted) setLoadingLeaves(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, doctor?.id]);

  // Load affected appointments whenever selected leave dates change
  useEffect(() => {
    if (!isOpen || !doctor?.id || selectedDatesToCancel.length === 0) {
      setAffectedAppts([]);
      setSelectedApptIds([]);
      return;
    }

    let isMounted = true;
    setLoadingAppts(true);

    getDoctorAffectedAppointmentsServerFn({
      data: {
        doctorId: doctor.id,
        dates: selectedDatesToCancel,
      },
    })
      .then((res) => {
        if (!isMounted) return;
        const appts = res.appointments || [];
        setAffectedAppts(appts);
        // Default to all selected
        setSelectedApptIds(appts.map((a: any) => a.id));
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load affected appointments:", err);
      })
      .finally(() => {
        if (isMounted) setLoadingAppts(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, doctor?.id, selectedDatesToCancel]);

  // Toggle date selection
  const toggleDateToCancel = (dateStr: string) => {
    setSelectedDatesToCancel((prev) =>
      prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr].sort(),
    );
  };

  const selectAllDates = () => {
    if (selectedDatesToCancel.length === scheduledLeaves.length) {
      setSelectedDatesToCancel([]);
    } else {
      setSelectedDatesToCancel(scheduledLeaves.map((l) => l.leaveDate));
    }
  };

  // Toggle patient selection
  const toggleApptSelect = (id: string) => {
    setSelectedApptIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const selectAllAppts = () => {
    if (selectedApptIds.length === affectedAppts.length) {
      setSelectedApptIds([]);
    } else {
      setSelectedApptIds(affectedAppts.map((a) => a.id));
    }
  };

  // Preview of the approved template with the first recipient's values.
  const previewSample = useMemo(() => {
    if (!REINSTATED_TEMPLATE) return "";
    const firstApt = affectedAppts[0];
    const day = parseWallClock(selectedDatesToCancel[0]);
    const values: Record<string, string> = {
      name: firstApt?.name || "Patient",
      doctorName: doctor?.name || "Doctor",
      clinicName: clinicName || "the clinic",
      date: day ? formatTemplateDate(day) : "the selected date",
      time: normalizeSlotLabel(firstApt?.timeSlot) || "your booked time",
    };
    let text = REINSTATED_TEMPLATE.bodyText;
    for (const [key, field] of Object.entries(REINSTATED_TEMPLATE.variableMappings)) {
      const n = key.split(".")[1];
      text = text.replace(`{{${n}}}`, values[field] ?? "");
    }
    return text;
  }, [affectedAppts, selectedDatesToCancel, doctor?.name, clinicName]);

  // Submit cancellation & reinstatement
  const handleConfirmCancelLeave = async () => {
    if (!doctor || selectedDatesToCancel.length === 0) {
      setErrorMsg("Please select at least one leave date to cancel.");
      return;
    }
    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const res = await cancelDoctorLeaveAndReinstateAppointmentsServerFn({
        data: {
          doctorId: doctor.id,
          leaveDates: selectedDatesToCancel,
          sendWhatsAppNotice: sendWhatsApp,
          selectedAppointmentIds: selectedApptIds,
        },
      });

      if (res.success) {
        setSubmissionResult(res);
        onSuccess({
          leavesCancelledCount: res.leavesCancelledCount,
          reinstatedAppointmentsCount: res.reinstatedAppointmentsCount,
          notifiedPatientsCount: res.notifiedPatientsCount,
          whatsappSkippedForRole: res.whatsappSkippedForRole,
          dates: selectedDatesToCancel,
        });
      } else {
        setErrorMsg("Failed to cancel leave. Please try again.");
      }
    } catch (err: any) {
      console.error("Cancel leave execution error:", err);
      setErrorMsg(err?.message || "An unexpected error occurred while cancelling leave.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !doctor) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-zinc-900/40 backdrop-blur-xs overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="relative w-full max-w-4xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl overflow-hidden flex flex-col my-auto max-h-[92vh]"
      >
        {/* Simple Clean Header */}
        <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Cancel Leave &amp; Reinstate Appointments
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Restore doctor availability and notify patients that their appointment is confirmed
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Doctor Summary Sub-Bar */}
        <div className="bg-zinc-50 dark:bg-zinc-800/40 border-b border-zinc-200 dark:border-zinc-800 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-semibold flex items-center justify-center text-xs">
              {doctor.name
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((n) => n[0])
                .join("")
                .toUpperCase()}
            </div>
            <div>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 mr-2">
                {doctor.name}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">
                {doctor.departmentName || "Clinician"} • {doctor.qualifications || "Consultant"} •{" "}
                {doctor.phone || "No phone"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span>WhatsApp:</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Official API (approved template)
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {submissionResult ? (
            /* Clean Success View */
            <div className="py-8 px-4 text-center space-y-5 max-w-md mx-auto">
              <div className="h-12 w-12 mx-auto rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Doctor Leave Cancelled &amp; Appointments Reinstated
                </h4>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                  {submissionResult.whatsappSkippedForRole
                    ? "Doctor availability has been restored and appointments marked Confirmed. WhatsApp notices were not sent for your role."
                    : "Doctor availability has been restored and appointments marked Confirmed. Delivery and read receipts appear in the notification log."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-3">
                  <span className="text-[11px] text-zinc-500 font-medium">Leaves Cancelled</span>
                  <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {submissionResult.leavesCancelledCount}
                  </p>
                  <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                    {selectedDatesToCancel
                      .map((d) =>
                        new Date(d).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        }),
                      )
                      .join(", ")}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-3">
                  <span className="text-[11px] text-zinc-500 font-medium">
                    Appointments Reinstated
                  </span>
                  <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {submissionResult.reinstatedAppointmentsCount}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {[
                      `${submissionResult.notifiedPatientsCount} WhatsApp notices sent`,
                      submissionResult.queuedPatientsCount
                        ? `${submissionResult.queuedPatientsCount} retrying`
                        : null,
                      submissionResult.failedPatientsCount
                        ? `${submissionResult.failedPatientsCount} not sent`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>

              {submissionResult.patients && submissionResult.patients.length > 0 && (
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden text-left">
                  <div className="bg-zinc-50 dark:bg-zinc-800 px-3.5 py-1.5 text-[11px] font-medium text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
                    Patient Reinstatement Outbox
                  </div>
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-40 overflow-y-auto">
                    {submissionResult.patients.map((p: any) => (
                      <div key={p.id} className="p-2.5 text-xs flex items-center justify-between">
                        <div>
                          <p className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</p>
                          <p className="text-[11px] text-zinc-400">
                            {p.date} • {p.time} • {p.phone}
                          </p>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                            p.status === "sent"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : p.status === "failed"
                                ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                          }`}
                        >
                          {p.status === "sent"
                            ? "Sent"
                            : p.status === "queued"
                              ? "Retrying"
                              : p.status === "failed"
                                ? "Not sent"
                                : "Skipped"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 py-2.5 text-xs font-medium transition-colors cursor-pointer"
              >
                Close &amp; Return to Directory
              </button>
            </div>
          ) : (
            /* Main Form - Balanced 2-Column Clean Layout */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* LEFT COLUMN: Select Scheduled Leaves to Cancel */}
              <div className="lg:col-span-6 space-y-6">
                {/* Step 1: Select Leaves to Cancel */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                        1
                      </span>
                      <span>Scheduled Leaves to Cancel</span>
                    </label>

                    {scheduledLeaves.length > 0 && (
                      <button
                        type="button"
                        onClick={selectAllDates}
                        className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:underline cursor-pointer"
                      >
                        {selectedDatesToCancel.length === scheduledLeaves.length
                          ? "Deselect All"
                          : "Select All"}
                      </button>
                    )}
                  </div>

                  {loadingLeaves ? (
                    <div className="py-6 flex items-center justify-center gap-2 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 text-xs text-zinc-500">
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
                      Loading scheduled leaves for {doctor.name}...
                    </div>
                  ) : scheduledLeaves.length > 0 ? (
                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
                      <div className="bg-zinc-50 dark:bg-zinc-800/60 px-3.5 py-2 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
                        <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                          {scheduledLeaves.length} Scheduled Leave Date
                          {scheduledLeaves.length === 1 ? "" : "s"}
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {selectedDatesToCancel.length} selected for cancel
                        </span>
                      </div>

                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-56 overflow-y-auto">
                        {scheduledLeaves.map((l) => {
                          const isChecked = selectedDatesToCancel.includes(l.leaveDate);
                          const formattedDate = new Date(l.leaveDate).toLocaleDateString("en-IN", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          });

                          return (
                            <div
                              key={l.id}
                              onClick={() => toggleDateToCancel(l.leaveDate)}
                              className="p-3 text-xs flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-pointer transition-colors"
                            >
                              <div className="flex items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  className="h-3.5 w-3.5 rounded text-zinc-900 focus:ring-zinc-800 border-zinc-300 cursor-pointer"
                                />
                                <div>
                                  <p className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                                    <span>{formattedDate}</span>
                                    {l.isHoliday && (
                                      <span className="text-[10px] text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1 py-0.2 rounded font-medium">
                                        Holiday
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-[11px] text-zinc-500">
                                    Reason: {l.reason || "Scheduled Leave"}
                                  </p>
                                </div>
                              </div>

                              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                                {l.affectedCount > 0
                                  ? `${l.affectedCount} Booked Patient${l.affectedCount === 1 ? "" : "s"}`
                                  : "0 Bookings"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-6 text-center text-xs text-zinc-500 space-y-1">
                      <CalendarDays className="h-6 w-6 mx-auto text-zinc-400" />
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">
                        No upcoming scheduled leaves found for {doctor.name}.
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        The doctor is currently available according to their standard weekly
                        schedule.
                      </p>
                    </div>
                  )}
                </div>

                {/* Step 2: Booked Patients to be Reinstated */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                        2
                      </span>
                      <span>Appointments to Reinstate &amp; Regain</span>
                    </label>

                    {affectedAppts.length > 0 && (
                      <button
                        type="button"
                        onClick={selectAllAppts}
                        className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:underline cursor-pointer"
                      >
                        {selectedApptIds.length === affectedAppts.length
                          ? "Deselect All"
                          : "Select All"}
                      </button>
                    )}
                  </div>

                  {loadingAppts ? (
                    <div className="py-4 flex items-center justify-center gap-2 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 text-xs text-zinc-500">
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
                      Scanning appointments for selected dates...
                    </div>
                  ) : affectedAppts.length > 0 ? (
                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
                      <div className="bg-zinc-50 dark:bg-zinc-800/60 px-3.5 py-2 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
                        <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                          {affectedAppts.length} Booking{affectedAppts.length === 1 ? "" : "s"}{" "}
                          Found
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {selectedApptIds.length} marked to reinstate
                        </span>
                      </div>

                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-44 overflow-y-auto">
                        {affectedAppts.map((apt) => {
                          const isChecked = selectedApptIds.includes(apt.id);
                          const aptDate = new Date(apt.dateTime).toLocaleDateString("en-IN", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          });

                          return (
                            <div
                              key={apt.id}
                              onClick={() => toggleApptSelect(apt.id)}
                              className="p-2.5 text-xs flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-pointer transition-colors"
                            >
                              <div className="flex items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  className="h-3.5 w-3.5 rounded text-zinc-900 focus:ring-zinc-800 border-zinc-300 cursor-pointer"
                                />
                                <div>
                                  <p className="font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                                    <span>{apt.name}</span>
                                    {apt.tokenNo && (
                                      <span className="text-[10px] text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1 py-0.2 rounded font-mono">
                                        #{apt.tokenNo}
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-[11px] text-zinc-500">
                                    {aptDate} • {apt.timeSlot || "Scheduled Slot"} • {apt.phone}
                                  </p>
                                </div>
                              </div>

                              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                Will Reinstate
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-4 text-center text-xs text-zinc-500 space-y-0.5">
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">
                        No previously booked appointments on these dates.
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        Canceling leave will reopen these dates on the booking schedule for new
                        patient bookings.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: WhatsApp Reinstatement Message & Notice */}
              <div className="lg:col-span-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <span className="h-5 w-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                      3
                    </span>
                    <span>WhatsApp Notice (Meta-approved utility template)</span>
                  </label>

                  {/* Toggle Checkbox for WhatsApp notification */}
                  <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={sendWhatsApp}
                      onChange={(e) => setSendWhatsApp(e.target.checked)}
                      className="h-4 w-4 rounded text-zinc-900 focus:ring-zinc-800 border-zinc-300 cursor-pointer"
                    />
                    <span className="font-medium">
                      Notify booked patients via WhatsApp that their appointment is regained &amp;
                      confirmed
                    </span>
                  </label>

                  {sendWhatsApp && (
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-zinc-500 pb-1 border-b border-zinc-200/80 dark:border-zinc-800">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                          <MessageCircle className="h-3.5 w-3.5 text-zinc-500" />
                          Preview (for first recipient)
                        </span>
                        <span className="text-[10px] text-zinc-400 font-mono">
                          {REINSTATED_TEMPLATE?.name ?? "clinic_booking_reinstated"}
                        </span>
                      </div>

                      <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap border border-zinc-200 dark:border-zinc-700/80">
                        {previewSample}
                      </div>

                      <p className="text-[10.5px] text-zinc-500 leading-relaxed">
                        Sent through the official WhatsApp API using a Meta-approved utility
                        template, so it reaches patients who have never messaged the clinic. The
                        wording is fixed by Meta and cannot be edited. Patients who replied STOP are
                        skipped.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 p-2.5 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {!submissionResult && (
          <div className="bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500 font-medium hidden sm:inline">
                {selectedDatesToCancel.length} leave date
                {selectedDatesToCancel.length === 1 ? "" : "s"} • {selectedApptIds.length} patient
                {selectedApptIds.length === 1 ? "" : "s"} to reinstate
              </span>

              <button
                type="button"
                disabled={isSubmitting || selectedDatesToCancel.length === 0}
                onClick={handleConfirmCancelLeave}
                className="px-5 py-2 rounded-lg bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing Reinstatements...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Cancel Leave &amp; Reinstate Appointments</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default DoctorCancelLeaveModal;
