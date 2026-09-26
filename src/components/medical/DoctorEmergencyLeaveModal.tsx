import React, { useState, useEffect, useMemo } from "react";
import { motion } from "motion/react";
import {
  Calendar,
  Clock,
  Sparkles,
  MessageCircle,
  Users,
  CheckCircle2,
  X,
  Loader2,
  Send,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  FileText,
  CalendarDays,
  CalendarRange,
  ArrowRight,
} from "lucide-react";
import {
  getDoctorAffectedAppointmentsServerFn,
  generateDoctorLeaveWaMessageServerFn,
  processDoctorEmergencyLeaveServerFn,
} from "@/lib/auth";

export interface DoctorEmergencyLeaveModalProps {
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
    leavesCreated: number;
    notifiedPatientsCount: number;
    dates: string[];
  }) => void;
}

const PRESET_REASONS = [
  { label: "Medical Emergency", value: "Medical Emergency" },
  { label: "Severe Health Illness", value: "Severe Health Illness & Doctor Bed Rest" },
  { label: "Family Emergency", value: "Urgent Family Emergency" },
  { label: "Critical On-Call Duty", value: "Emergency Hospital Surgery / Critical On-Call Duty" },
  { label: "Emergency Travel", value: "Unavoidable Emergency Travel" },
  { label: "Personal Emergency", value: "Unforeseen Personal Emergency" },
];

/**
 * Returns all dates between start and end (inclusive) formatted as YYYY-MM-DD
 */
function getDatesBetween(startDateStr: string, endDateStr: string): string[] {
  if (!startDateStr || !endDateStr) return [];
  const [start, end] =
    startDateStr <= endDateStr ? [startDateStr, endDateStr] : [endDateStr, startDateStr];

  const dates: string[] = [];
  const [sYear, sMonth, sDay] = start.split("-").map(Number);
  const [eYear, eMonth, eDay] = end.split("-").map(Number);

  const current = new Date(sYear, sMonth - 1, sDay);
  const targetEnd = new Date(eYear, eMonth - 1, eDay);

  while (current <= targetEnd) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, "0");
    const d = String(current.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * Formats YYYY-MM-DD into a localized friendly date (e.g. Sat, 26 Sep 2026)
 */
function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) return dateStr;
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function DoctorEmergencyLeaveModal({
  isOpen,
  onClose,
  doctor,
  clinicName = "HealthSync Clinic",
  waStatus = "DISCONNECTED",
  waConnectedNumber = "",
  onSuccess,
}: DoctorEmergencyLeaveModalProps) {
  // Calendar & Date state
  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => today.toISOString().split("T")[0], [today]);

  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [selectedDates, setSelectedDates] = useState<string[]>([todayStr]);

  // Date Selection Mode: "range" (From - To) or "individual"
  const [dateSelectionMode, setDateSelectionMode] = useState<"range" | "individual">("range");
  const [rangeFrom, setRangeFrom] = useState<string>(todayStr);
  const [rangeTo, setRangeTo] = useState<string>(todayStr);
  const [isRangeSelecting, setIsRangeSelecting] = useState<boolean>(false);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [showAllDateChips, setShowAllDateChips] = useState<boolean>(false);

  // Reason state
  const [reason, setReason] = useState<string>("Medical Emergency");
  const [customReasonNote, setCustomReasonNote] = useState<string>("");

  // Affected appointments
  const [loadingAppts, setLoadingAppts] = useState<boolean>(false);
  const [affectedAppts, setAffectedAppts] = useState<any[]>([]);
  const [selectedApptIds, setSelectedApptIds] = useState<string[]>([]);

  // AI WhatsApp Message state
  const [messageTemplate, setMessageTemplate] = useState<string>("");
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [aiTone, setAiTone] = useState<"empathetic" | "urgent" | "reassuring">("empathetic");
  const [aiSource, setAiSource] = useState<"ai" | "template" | "custom">("template");

  // Submission & Results
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submissionResult, setSubmissionResult] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Month navigation
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startDayOfWeek = new Date(calYear, calMonth, 1).getDay();

  // Reset & initialize when modal opens
  useEffect(() => {
    if (isOpen && doctor) {
      setSelectedDates([todayStr]);
      setRangeFrom(todayStr);
      setRangeTo(todayStr);
      setIsRangeSelecting(false);
      setHoverDate(null);
      setDateSelectionMode("range");
      setReason("Medical Emergency");
      setCustomReasonNote("");
      setSubmissionResult(null);
      setErrorMsg("");
      setAiTone("empathetic");
    }
  }, [isOpen, doctor, todayStr]);

  // Fetch affected appointments whenever selected dates change (debounced to avoid typing lag)
  useEffect(() => {
    if (!isOpen || !doctor?.id || selectedDates.length === 0) {
      setAffectedAppts([]);
      setSelectedApptIds([]);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(() => {
      setLoadingAppts(true);
      getDoctorAffectedAppointmentsServerFn({
        data: {
          doctorId: doctor.id,
          dates: selectedDates,
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
    }, 250);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isOpen, doctor?.id, selectedDates]);

  // Combined reason text
  const effectiveReason = useMemo(() => {
    return customReasonNote.trim() ? `${reason}: ${customReasonNote.trim()}` : reason;
  }, [reason, customReasonNote]);

  // AI message generation
  const handleGenerateAiMessage = async (tone = aiTone) => {
    if (!doctor) return;
    setIsGeneratingAi(true);
    setErrorMsg("");
    try {
      const res = await generateDoctorLeaveWaMessageServerFn({
        data: {
          doctorName: doctor.name,
          leaveDates: selectedDates,
          reason: effectiveReason,
          clinicName,
          tone,
        },
      });
      if (res.success && res.message) {
        setMessageTemplate(res.message);
        setAiSource(res.source === "ai" ? "ai" : "template");
      }
    } catch (err: any) {
      console.warn("AI generation fallback to standard template:", err?.message);
      const fallback = `Dear {{patient_name}},\n\nWe regret to inform you that your upcoming appointment with *Dr. ${doctor.name}* at *${clinicName}* on *{{appointment_date}}* at {{appointment_time}} needs to be rescheduled. Dr. ${doctor.name} is unexpectedly unavailable due to a ${effectiveReason}.\n\nWe sincerely apologize for any inconvenience. Our clinic care desk will contact you shortly to reschedule your consultation to the earliest available slot.\n\nPlease feel free to reply directly to this message if you have any urgent queries.\n\nThank you for your understanding.`;
      setMessageTemplate(fallback);
      setAiSource("template");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Initial generation on open or doctor change or reason change
  useEffect(() => {
    if (isOpen && doctor && selectedDates.length > 0) {
      handleGenerateAiMessage(aiTone);
    }
  }, [isOpen, doctor?.id, reason]);

  // Toggle individual date selection
  const toggleDate = (dateStr: string) => {
    setSelectedDates((prev) => {
      if (prev.includes(dateStr)) {
        if (prev.length === 1) return prev; // Keep at least 1 date
        return prev.filter((d) => d !== dateStr);
      } else {
        return [...prev, dateStr].sort();
      }
    });
  };

  // Calendar date click handler (Supports Range click & Individual click)
  const handleCalendarDateClick = (dateStr: string) => {
    if (dateSelectionMode === "individual") {
      toggleDate(dateStr);
      return;
    }

    // Range selection mode
    if (!isRangeSelecting || !rangeFrom) {
      // First click: sets Start of range
      setRangeFrom(dateStr);
      setRangeTo("");
      setSelectedDates([dateStr]);
      setIsRangeSelecting(true);
      setHoverDate(null);
    } else {
      // Second click: completes range
      const [start, end] = rangeFrom <= dateStr ? [rangeFrom, dateStr] : [dateStr, rangeFrom];
      setRangeFrom(start);
      setRangeTo(end);
      const all = getDatesBetween(start, end);
      setSelectedDates(all);
      setIsRangeSelecting(false);
      setHoverDate(null);
    }
  };

  // From date input change — safe typing without clobbering To Date
  const handleRangeFromInputChange = (val: string) => {
    setRangeFrom(val);
    if (!val) return;

    // Auto navigate calendar if valid year/month
    const parts = val.split("-").map(Number);
    if (parts.length === 3) {
      const [y, m, d] = parts;
      if (!isNaN(y) && !isNaN(m) && !isNaN(d) && y >= 2020 && y <= 2050 && m >= 1 && m <= 12) {
        setCalYear(y);
        setCalMonth(m - 1);
      }
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      if (rangeTo && /^\d{4}-\d{2}-\d{2}$/.test(rangeTo)) {
        if (val <= rangeTo) {
          setSelectedDates(getDatesBetween(val, rangeTo));
        } else {
          // Keep rangeTo as is; select current start date
          setSelectedDates([val]);
        }
      } else {
        setSelectedDates([val]);
      }
    }
    setIsRangeSelecting(false);
  };

  // To date input change — NEVER mutates rangeFrom while user types
  const handleRangeToInputChange = (val: string) => {
    setRangeTo(val);
    if (!val) return;

    // Auto navigate calendar if valid year/month
    const parts = val.split("-").map(Number);
    if (parts.length === 3) {
      const [y, m, d] = parts;
      if (!isNaN(y) && !isNaN(m) && !isNaN(d) && y >= 2020 && y <= 2050 && m >= 1 && m <= 12) {
        setCalYear(y);
        setCalMonth(m - 1);
      }
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const effectiveFrom =
        rangeFrom && /^\d{4}-\d{2}-\d{2}$/.test(rangeFrom) ? rangeFrom : todayStr;
      if (effectiveFrom <= val) {
        setSelectedDates(getDatesBetween(effectiveFrom, val));
      } else {
        // Crucial: NEVER overwrite rangeFrom! Keep rangeFrom intact.
        setSelectedDates([val]);
      }
    }
    setIsRangeSelecting(false);
  };

  // Swap From and To dates if reversed
  const handleSwapDates = () => {
    if (!rangeFrom || !rangeTo) return;
    const newFrom = rangeTo;
    const newTo = rangeFrom;
    setRangeFrom(newFrom);
    setRangeTo(newTo);
    const [start, end] = newFrom <= newTo ? [newFrom, newTo] : [newTo, newFrom];
    setSelectedDates(getDatesBetween(start, end));
  };

  // When either input loses focus, ensure range is synced if both are valid
  const handleRangeInputsBlur = () => {
    if (
      rangeFrom &&
      rangeTo &&
      /^\d{4}-\d{2}-\d{2}$/.test(rangeFrom) &&
      /^\d{4}-\d{2}-\d{2}$/.test(rangeTo)
    ) {
      if (rangeFrom <= rangeTo) {
        setSelectedDates(getDatesBetween(rangeFrom, rangeTo));
      }
    }
  };

  // Clear all dates
  const handleClearDates = () => {
    setSelectedDates([]);
    setRangeFrom("");
    setRangeTo("");
    setIsRangeSelecting(false);
    setHoverDate(null);
  };

  // Quick Range Presets
  const applyPreset = (
    preset: "today" | "tomorrow" | "2days" | "3days" | "7days" | "14days" | "wholeMonth",
  ) => {
    const base = new Date();
    let startStr = todayStr;
    let endStr = todayStr;

    if (preset === "today") {
      startStr = todayStr;
      endStr = todayStr;
    } else if (preset === "tomorrow") {
      const tom = new Date(base);
      tom.setDate(tom.getDate() + 1);
      startStr = tom.toISOString().split("T")[0];
      endStr = startStr;
    } else if (preset === "2days") {
      startStr = todayStr;
      const end = new Date(base);
      end.setDate(end.getDate() + 1);
      endStr = end.toISOString().split("T")[0];
    } else if (preset === "3days") {
      startStr = todayStr;
      const end = new Date(base);
      end.setDate(end.getDate() + 2);
      endStr = end.toISOString().split("T")[0];
    } else if (preset === "7days") {
      startStr = todayStr;
      const end = new Date(base);
      end.setDate(end.getDate() + 6);
      endStr = end.toISOString().split("T")[0];
    } else if (preset === "14days") {
      startStr = todayStr;
      const end = new Date(base);
      end.setDate(end.getDate() + 13);
      endStr = end.toISOString().split("T")[0];
    } else if (preset === "wholeMonth") {
      startStr = todayStr;
      const lastDay = new Date(calYear, calMonth + 1, 0).getDate();
      endStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }

    setRangeFrom(startStr);
    setRangeTo(endStr);
    setIsRangeSelecting(false);
    setHoverDate(null);
    const all = getDatesBetween(startStr, endStr);
    setSelectedDates(all);

    // Jump calendar to start date
    const [sYear, sMonth] = startStr.split("-").map(Number);
    if (!isNaN(sYear) && !isNaN(sMonth)) {
      setCalYear(sYear);
      setCalMonth(sMonth - 1);
    }
  };

  // Month navigation
  const prevMonth = () => {
    if (calMonth === 0) {
      setCalMonth(11);
      setCalYear((y) => y - 1);
    } else {
      setCalMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0);
      setCalYear((y) => y + 1);
    } else {
      setCalMonth((m) => m + 1);
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

  // Placeholder insertion helper
  const insertPlaceholder = (tag: string) => {
    setMessageTemplate((prev) => `${prev} {{${tag}}}`);
    setAiSource("custom");
  };

  // Live WhatsApp preview
  const previewSample = useMemo(() => {
    const firstApt = affectedAppts[0];
    const sampleDate = selectedDates[0]
      ? new Date(selectedDates[0]).toLocaleDateString("en-IN", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "Upcoming Date";
    const sampleTime = firstApt?.timeSlot || "10:30 AM";
    const samplePatient = firstApt?.name || "Patient";

    return (messageTemplate || "")
      .replace(/{{patient_name}}/g, samplePatient)
      .replace(/{{doctor_name}}/g, doctor?.name || "Doctor")
      .replace(/{{appointment_date}}/g, sampleDate)
      .replace(/{{appointment_time}}/g, sampleTime)
      .replace(/{{reason}}/g, effectiveReason)
      .replace(/{{clinic_name}}/g, clinicName);
  }, [messageTemplate, affectedAppts, selectedDates, doctor?.name, effectiveReason, clinicName]);

  // Submit emergency leave & dispatch
  const handleConfirmEmergencyLeave = async () => {
    if (!doctor || selectedDates.length === 0) {
      setErrorMsg("Please select at least one leave date.");
      return;
    }
    if (!messageTemplate.trim()) {
      setErrorMsg("WhatsApp message content cannot be empty.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const res = await processDoctorEmergencyLeaveServerFn({
        data: {
          doctorId: doctor.id,
          leaveDates: selectedDates,
          reason: effectiveReason,
          customMessage: messageTemplate,
          selectedAppointmentIds: selectedApptIds,
        },
      });

      if (res.success) {
        setSubmissionResult(res);
        onSuccess({
          leavesCreated: res.leavesCreated,
          notifiedPatientsCount: res.notifiedPatientsCount,
          dates: selectedDates,
        });
      } else {
        setErrorMsg("Failed to process emergency leave. Please try again.");
      }
    } catch (err: any) {
      console.error("Emergency leave execution error:", err);
      setErrorMsg(err?.message || "An unexpected error occurred while processing leave.");
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
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Clinical Emergency Protocol
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Block multiple dates &amp; notify booked patients automatically via AI WhatsApp
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
            <span>WhatsApp Service:</span>
            {waStatus === "CONNECTED" ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Active ({waConnectedNumber || "Connected"})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">
                Offline (Messages will queue)
              </span>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {submissionResult ? (
            /* Clean Confirmation View */
            <div className="py-8 px-4 text-center space-y-5 max-w-md mx-auto">
              <div className="h-12 w-12 mx-auto rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Emergency Leave Declared &amp; Broadcast Queued
                </h4>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                  Doctor availability has been blocked and patient notices have been enqueued.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-3">
                  <span className="text-[11px] text-zinc-500 font-medium">Dates Blocked</span>
                  <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {submissionResult.leavesCreated}
                  </p>
                  <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                    {selectedDates
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
                  <span className="text-[11px] text-zinc-500 font-medium">WhatsApp Notices</span>
                  <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {submissionResult.notifiedPatientsCount}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {submissionResult.notifiedPatientsCount === 0
                      ? "No bookings affected"
                      : "Recipients enqueued"}
                  </p>
                </div>
              </div>

              {submissionResult.patients && submissionResult.patients.length > 0 && (
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden text-left">
                  <div className="bg-zinc-50 dark:bg-zinc-800 px-3.5 py-1.5 text-[11px] font-medium text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
                    Patient Outbox
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
                        <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium">
                          Enqueued
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
              {/* LEFT COLUMN: Step 1 (Dates Selection) & Step 2 (Reason) */}
              <div className="lg:col-span-6 space-y-6">
                {/* Step 1: Select Leave Dates */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                        1
                      </span>
                      <span>Select Emergency Leave Dates</span>
                    </label>

                    {/* Mode Toggle: Date Range vs Individual */}
                    <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5 border border-zinc-200 dark:border-zinc-700 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setDateSelectionMode("range");
                          setIsRangeSelecting(false);
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                          dateSelectionMode === "range"
                            ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                            : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        }`}
                      >
                        From — To Range
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDateSelectionMode("individual");
                          setIsRangeSelecting(false);
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                          dateSelectionMode === "individual"
                            ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                            : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        }`}
                      >
                        Single / Multi Pick
                      </button>
                    </div>
                  </div>

                  {/* Date Range Inputs Bar (Direct From - To selection to reduce manual work) */}
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                          Date Range Selection (From — To)
                        </span>
                        {selectedDates.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-700/80 text-zinc-700 dark:text-zinc-200 font-medium">
                            {selectedDates.length} {selectedDates.length === 1 ? "day" : "days"}
                          </span>
                        )}
                      </div>
                      {selectedDates.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearDates}
                          className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 underline cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 items-start">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                            From Date
                          </label>
                          {rangeFrom && (
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                              {formatDisplayDate(rangeFrom)}
                            </span>
                          )}
                        </div>
                        <input
                          type="date"
                          value={rangeFrom}
                          onChange={(e) => handleRangeFromInputChange(e.target.value)}
                          onBlur={handleRangeInputsBlur}
                          className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-zinc-800 cursor-pointer"
                        />
                        {rangeFrom && rangeFrom < todayStr && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                            ⚠️ Note: Date is in the past
                          </p>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                            To Date
                          </label>
                          {rangeTo && (
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                              {formatDisplayDate(rangeTo)}
                            </span>
                          )}
                        </div>
                        <input
                          type="date"
                          value={rangeTo}
                          onChange={(e) => handleRangeToInputChange(e.target.value)}
                          onBlur={handleRangeInputsBlur}
                          className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-zinc-800 cursor-pointer"
                        />
                        {rangeFrom && rangeTo && rangeTo < rangeFrom && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] text-amber-600 dark:text-amber-400">
                              Earlier than From Date
                            </span>
                            <button
                              type="button"
                              onClick={handleSwapDates}
                              className="text-[10px] text-zinc-900 dark:text-zinc-100 underline font-semibold cursor-pointer"
                            >
                              Swap Dates
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quick Select Presets */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-zinc-400 font-medium mr-1">Quick Select:</span>
                    {[
                      { label: "Today", key: "today" as const },
                      { label: "Tomorrow", key: "tomorrow" as const },
                      { label: "2 Days", key: "2days" as const },
                      { label: "Next 3 Days", key: "3days" as const },
                      { label: "Next 7 Days", key: "7days" as const },
                      { label: "Next 14 Days", key: "14days" as const },
                      { label: "Whole Month", key: "wholeMonth" as const },
                    ].map((preset) => (
                      <button
                        type="button"
                        key={preset.key}
                        onClick={() => applyPreset(preset.key)}
                        className="px-2 py-0.5 rounded-md text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-750 transition-colors cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  {/* Clean Month Calendar */}
                  <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-lg p-3.5">
                    {/* Calendar Month Header */}
                    <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2 mb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {monthNames[calMonth]} {calYear}
                        </span>
                        {dateSelectionMode === "range" && (
                          <span className="text-[10px] text-zinc-400 font-normal">
                            {isRangeSelecting
                              ? "(Click end date)"
                              : "(Click start, then click end date)"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={prevMonth}
                          className="h-6 w-6 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-500 cursor-pointer"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={nextMonth}
                          className="h-6 w-6 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-500 cursor-pointer"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Day of Week Labels */}
                    <div className="grid grid-cols-7 text-center text-[10px] font-medium text-zinc-400 uppercase mb-1">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day, i) => (
                        <span key={i} className="py-1">
                          {day}
                        </span>
                      ))}
                    </div>

                    {/* Calendar Grid */}
                    <div
                      className="grid grid-cols-7 gap-y-1"
                      onMouseLeave={() => setHoverDate(null)}
                    >
                      {Array.from({ length: startDayOfWeek }).map((_, i) => (
                        <div key={`empty-${i}`} className="h-8" />
                      ))}

                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const dayNum = i + 1;
                        const dateObj = new Date(calYear, calMonth, dayNum);
                        const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
                        const isPast =
                          dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());

                        const isSelected = selectedDates.includes(dateStr);
                        const isCurrentToday = dateStr === todayStr;

                        // Range boundary states
                        const isStart =
                          dateStr === (rangeFrom || selectedDates[0]);
                        const isEnd =
                          dateStr ===
                          (rangeTo || selectedDates[selectedDates.length - 1]);

                        // Hover range preview
                        const isInHoverRange =
                          isRangeSelecting && rangeFrom && hoverDate
                            ? rangeFrom <= hoverDate
                              ? dateStr >= rangeFrom && dateStr <= hoverDate
                              : dateStr >= hoverDate && dateStr <= rangeFrom
                            : false;

                        return (
                          <button
                            key={dateStr}
                            type="button"
                            disabled={isPast}
                            onMouseEnter={() => {
                              if (isRangeSelecting) setHoverDate(dateStr);
                            }}
                            onClick={() => handleCalendarDateClick(dateStr)}
                            className={`h-8 text-xs transition-colors relative flex items-center justify-center cursor-pointer ${
                              isPast
                                ? "opacity-30 cursor-not-allowed text-zinc-400"
                                : isStart || isEnd
                                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold rounded-md z-10"
                                  : isSelected || isInHoverRange
                                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                                    : isCurrentToday
                                      ? "border border-zinc-400 text-zinc-900 dark:text-zinc-100 font-medium rounded-md"
                                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-md"
                            }`}
                          >
                            <span>{dayNum}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Summary of Selected Dates */}
                  {selectedDates.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {selectedDates.length === 1 ? (
                            new Date(selectedDates[0]).toLocaleDateString("en-IN", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          ) : (
                            <>
                              From{" "}
                              {new Date(selectedDates[0]).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                              })}{" "}
                              to{" "}
                              {new Date(
                                selectedDates[selectedDates.length - 1],
                              ).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}{" "}
                              <span className="text-zinc-500 font-normal">
                                ({selectedDates.length} days total)
                              </span>
                            </>
                          )}
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {selectedDates.length} date{selectedDates.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      {/* Date Badges (Collapsible) */}
                      <div className="flex flex-wrap gap-1.5">
                        {selectedDates
                          .slice(0, showAllDateChips ? selectedDates.length : 6)
                          .map((d) => {
                            const dateObj = new Date(d);
                            const formatted = dateObj.toLocaleDateString("en-IN", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            });
                            return (
                              <span
                                key={d}
                                className="inline-flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 px-2 py-0.5 rounded text-xs font-medium"
                              >
                                <Calendar className="h-3 w-3 text-zinc-500" />
                                {formatted}
                                <button
                                  type="button"
                                  onClick={() => toggleDate(d)}
                                  className="hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full h-3.5 w-3.5 flex items-center justify-center cursor-pointer text-zinc-500"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            );
                          })}
                        {selectedDates.length > 6 && (
                          <button
                            type="button"
                            onClick={() => setShowAllDateChips(!showAllDateChips)}
                            className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 cursor-pointer"
                          >
                            {showAllDateChips
                              ? "Show less"
                              : `+${selectedDates.length - 6} more`}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Step 2: Emergency Reason & Clinical Context */}
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <span className="h-5 w-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                      2
                    </span>
                    <span>Emergency Reason &amp; Clinical Context</span>
                  </label>

                  {/* Clean reason buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    {PRESET_REASONS.map((p) => {
                      const active = reason === p.value;
                      return (
                        <button
                          type="button"
                          key={p.value}
                          onClick={() => setReason(p.value)}
                          className={`p-2.5 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                            active
                              ? "border-zinc-900 dark:border-zinc-200 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold"
                              : "border-zinc-200 dark:border-zinc-750 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>

                  <input
                    type="text"
                    value={customReasonNote}
                    onChange={(e) => setCustomReasonNote(e.target.value)}
                    placeholder="Add specific reason details (e.g. High fever with doctor rest advised until Monday)..."
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-750 bg-white dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200 focus:border-zinc-800 dark:focus:border-zinc-400 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {/* RIGHT COLUMN: Step 3 (Booked Patients) & Step 4 (AI WhatsApp Broadcast) */}
              <div className="lg:col-span-6 space-y-6">
                {/* Step 3: Booked Patients on Selected Dates */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                        3
                      </span>
                      <span>Booked Patients on Selected Dates</span>
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
                    <div className="py-5 flex items-center justify-center gap-2 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 text-xs text-zinc-500">
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
                      Scanning booked appointments for {doctor.name}...
                    </div>
                  ) : affectedAppts.length > 0 ? (
                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
                      <div className="bg-zinc-50 dark:bg-zinc-800/60 px-3.5 py-2 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
                        <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                          {affectedAppts.length} Booking{affectedAppts.length === 1 ? "" : "s"} Found
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {selectedApptIds.length} marked for notice
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

                              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                                Reschedule
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-4 text-center text-xs text-zinc-500 space-y-0.5">
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">
                        ✨ No booked appointments found on the selected date(s).
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        Declaring emergency leave will block slots so no new appointments can be booked on the public booking portal.
                      </p>
                    </div>
                  )}
                </div>

                {/* Step 4: AI-Crafted WhatsApp Broadcast Message */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                        4
                      </span>
                      <span>AI-Crafted WhatsApp Broadcast Message</span>
                    </label>

                    <div className="flex items-center gap-2">
                      {/* Tone Pills */}
                      <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5 border border-zinc-200 dark:border-zinc-700 text-xs">
                        {(
                          [
                            { id: "empathetic", label: "Empathetic" },
                            { id: "urgent", label: "Urgent" },
                            { id: "reassuring", label: "Reassuring" },
                          ] as const
                        ).map((t) => (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => {
                              setAiTone(t.id);
                              handleGenerateAiMessage(t.id);
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                              aiTone === t.id
                                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>

                      {/* AI Regenerate Button */}
                      <button
                        type="button"
                        disabled={isGeneratingAi}
                        onClick={() => handleGenerateAiMessage(aiTone)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-750 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isGeneratingAi ? (
                          <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />
                        ) : (
                          <Sparkles className="h-3 w-3 text-zinc-600 dark:text-zinc-400" />
                        )}
                        <span>Regenerate with AI</span>
                      </button>
                    </div>
                  </div>

                  {/* Clean WhatsApp Preview Card */}
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500 pb-1 border-b border-zinc-200/80 dark:border-zinc-800">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                        <MessageCircle className="h-3.5 w-3.5 text-zinc-500" />
                        WhatsApp Message Preview (for first recipient)
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono">
                        {aiSource === "ai" ? "AI Generated" : "Template"}
                      </span>
                    </div>

                    {/* Preview Bubble */}
                    <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed space-y-1.5 whitespace-pre-wrap border border-zinc-200 dark:border-zinc-700/80">
                      <div>{previewSample}</div>
                      <div className="flex justify-end items-center gap-1 text-[10px] text-zinc-400 pt-1">
                        <span>
                          {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="text-zinc-500">✓✓</span>
                      </div>
                    </div>
                  </div>

                  {/* Editable Message Textarea */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="font-medium">Edit Template Text (Variables Supported):</span>
                      <div className="flex flex-wrap gap-1">
                        {["patient_name", "appointment_date", "appointment_time"].map((ph) => (
                          <button
                            key={ph}
                            type="button"
                            onClick={() => insertPlaceholder(ph)}
                            className="text-[10px] bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-mono px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 cursor-pointer transition-colors"
                          >
                            + {ph}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      rows={4}
                      value={messageTemplate}
                      onChange={(e) => {
                        setMessageTemplate(e.target.value);
                        setAiSource("custom");
                      }}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-750 bg-white dark:bg-zinc-900 p-2.5 text-xs text-zinc-800 dark:text-zinc-200 font-mono leading-relaxed focus:border-zinc-800 dark:focus:border-zinc-400 focus:outline-none transition-colors"
                    />
                  </div>
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
                {selectedDates.length} date{selectedDates.length === 1 ? "" : "s"} •{" "}
                {selectedApptIds.length} WhatsApp notice{selectedApptIds.length === 1 ? "" : "s"}
              </span>

              <button
                type="button"
                disabled={isSubmitting || selectedDates.length === 0}
                onClick={handleConfirmEmergencyLeave}
                className="px-5 py-2 rounded-lg bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing &amp; Broadcasting...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Confirm Emergency Leave &amp; Send AI WhatsApp</span>
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

export default DoctorEmergencyLeaveModal;
