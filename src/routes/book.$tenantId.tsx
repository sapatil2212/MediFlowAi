import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useReducer, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  HeartPulse,
  Calendar,
  Clock,
  User,
  Mail,
  Phone,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Copy,
  Video,
  Users,
  Utensils,
} from "lucide-react";
import {
  getClinicInfoAndSlotsServerFn,
  createAppointmentPublicServerFn as createAppointmentServerFn,
} from "../lib/booking";
import {
  getRestaurantAvailabilityServerFn,
  createRestaurantBookingPublicServerFn,
} from "../lib/restaurant";
import { getPublicRestaurantMenuServerFn } from "../lib/restaurant-public";
import type { MenuCategory } from "../lib/restaurant-settings-model";
import {
  DEFAULT_SETTINGS,
  MSG_MULTIPLE_TABLES_NEEDED,
  MSG_CLOSED_ON_DATE,
  MSG_NO_TABLE_FREE,
  TABLE_SELECTION_ANY,
  TABLE_SELECTION_ANY_LABEL,
  isRestaurantTenant,
  orderTables,
  type AvailabilitySlot,
  type DiningTable,
} from "../lib/restaurant-availability";
import {
  INITIAL_TABLE_SELECTION,
  TableLayoutView,
  selectStateOf,
  tableSelectionReducer,
  type LayoutTable,
  type TableSelectionState,
} from "../components/restaurant/TableLayoutView";

export const Route = createFileRoute("/book/$tenantId")({
  head: () => ({
    meta: [
      { title: "Book Appointment — BookMyTime" },
      {
        name: "description",
        content: "Schedule your appointment online with our integrated patient portal.",
      },
    ],
  }),
  component: PatientBookingPage,
});

// Sentinel id representing the main workspace (head office) location option
const MAIN_LOCATION_ID = "__main__";

function PatientBookingPage() {
  const { tenantId } = Route.useParams();

  // Clinic states
  const [clinicName, setClinicName] = useState("");
  const [profession, setProfession] = useState("Healthcare and medical");
  const [fetchingClinic, setFetchingClinic] = useState(true);
  const isGym =
    profession === "Fitness Gym etc" || (tenantId ? tenantId.startsWith("gym-") : false);
  const isEducation =
    profession === "Education institutions" || (tenantId ? tenantId.startsWith("edu-") : false);
  const isBeauty =
    profession === "Beauty and wellness" || (tenantId ? tenantId.startsWith("beauty-") : false);
  const isProfessional =
    profession === "Professional services like law, consultant, real estate, CA" ||
    (tenantId ? tenantId.startsWith("prof-") : false);
  // Req 6.1 — the sixth category is an ADDED arm: when it is false every existing
  // path below runs exactly as before.
  const isRestaurant = isRestaurantTenant(tenantId, profession);
  const [clinicError, setClinicError] = useState(false);

  // Lists from backend
  const [departments, setDepartments] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [locations, setLocations] = useState<
    Array<{ id: string; name: string; city: string | null; address: string | null }>
  >([]);

  // Selection states
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const whatsapp = phone; // Use same value for both phone and whatsapp
  const [appointmentType, setAppointmentType] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  // Video consultation: only offered when the workspace is eligible.
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [consultationMode, setConsultationMode] = useState<"in_person" | "video">("in_person");

  // Custom Popover/Dropdown Open States
  const [deptOpen, setDeptOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);

  // Calendar month/year navigation states
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  // Success state
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [appointmentId, setAppointmentId] = useState("");
  const [videoJoinLink, setVideoJoinLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Validation states
  const [validationError, setValidationError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Calendar helpers
  const getDaysInMonth = (month: number, year: number) => {
    const date = new Date(year, month, 1);
    const days = [];
    const firstDayIndex = date.getDay();
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }
    while (date.getMonth() === month) {
      days.push(new Date(date));
      date.setDate(date.getDate() + 1);
    }
    return days;
  };

  const isPastDate = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  // Initial load
  useEffect(() => {
    if (!tenantId) {
      setClinicError(true);
      setFetchingClinic(false);
      return;
    }

    getClinicInfoAndSlotsServerFn({
      data: { tenantId },
    })
      .then((res) => {
        setClinicName(res.clinicName);
        const resolvedProfession = res.profession || "Healthcare and medical";
        setProfession(resolvedProfession);
        setDepartments(res.departments || []);
        setDoctors(res.doctors || []);
        setVideoAvailable(!!(res as any).videoAvailable);
        const locs = (res as any).locations || [];
        setLocations(locs);

        // The main workspace counts as the head-office location. Default to it
        // so the patient explicitly confirms which branch they are booking at.
        if (locs.length > 0) {
          setSelectedLocationId(MAIN_LOCATION_ID);
        }

        const isGymTenant = resolvedProfession === "Fitness Gym etc" || tenantId.startsWith("gym-");
        const isEduTenant =
          resolvedProfession === "Education institutions" || tenantId.startsWith("edu-");
        if (isGymTenant || isEduTenant) {
          if (res.departments && res.departments.length > 0) {
            setSelectedDeptId(res.departments[0].id);
          }
          if (res.doctors && res.doctors.length > 0) {
            setSelectedDoctorId(res.doctors[0].id);
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load clinic details:", err);
        setClinicError(true);
      })
      .finally(() => {
        setFetchingClinic(false);
      });
  }, [tenantId]);

  // Load slots dynamically (not needed for education or gym).
  // The restaurant path loads its own availability (Req 6.4), so this effect is
  // guarded off there and never calls the clinic server function.
  useEffect(() => {
    if (!selectedDate || !tenantId || isEducation || isGym || isRestaurant) {
      setAvailableSlots([]);
      setSelectedSlot("");
      return;
    }

    // For non-gym, non-education: require a doctor selection
    if (!isGym && !selectedDoctorId) {
      setAvailableSlots([]);
      setSelectedSlot("");
      return;
    }

    setLoadingSlots(true);
    getClinicInfoAndSlotsServerFn({
      data: {
        tenantId,
        doctorId: selectedDoctorId,
        date: selectedDate,
      },
    })
      .then((res) => {
        setAvailableSlots(res.slots || []);
        setSelectedSlot("");
      })
      .catch((err) => {
        console.error("Failed to load slots:", err);
      })
      .finally(() => {
        setLoadingSlots(false);
      });
  }, [selectedDoctorId, selectedDate, tenantId, isGym, isRestaurant]);

  // Auto-populate dateTime for gyms when a date is selected, since gyms don't have slots
  useEffect(() => {
    if (isGym && !isRestaurant && selectedDate) {
      const dateObj = new Date(selectedDate);
      dateObj.setHours(9, 0, 0, 0); // Default to 9:00 AM
      const tzoffset = dateObj.getTimezoneOffset() * 60000;
      const localISOTime = new Date(dateObj.getTime() - tzoffset).toISOString().slice(0, 16);
      setDateTime(localISOTime);
    }
  }, [selectedDate, isGym]);

  const handleSelectSlot = (slot: string) => {
    setSelectedSlot(slot);

    // Construct local date time YYYY-MM-DDTHH:MM
    const dateObj = new Date(selectedDate);
    const [time, modifier] = slot.split(" ");
    let [hours, minutes] = time.split(":").map(Number);
    if (modifier === "PM" && hours < 12) {
      hours += 12;
    }
    if (modifier === "AM" && hours === 12) {
      hours = 0;
    }
    dateObj.setHours(hours, minutes, 0, 0);

    const tzoffset = dateObj.getTimezoneOffset() * 60000;
    const localISOTime = new Date(dateObj.getTime() - tzoffset).toISOString().slice(0, 16);
    setDateTime(localISOTime);
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The restaurant path submits through `RestaurantBookingForm` and never
    // reaches this validation block (Req 6.11, 12.1).
    if (isRestaurant) return;
    setValidationError("");
    setErrors({});

    const newErrors: Record<string, string> = {};
    if (!name.trim())
      newErrors.name =
        isGym || isBeauty || isProfessional
          ? "Client Name is required"
          : isEducation
            ? "Student Name is required"
            : "Patient Name is required";

    if (email.trim() && !/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = "Please enter a valid email address";
    }

    if (phone.trim() && !/^\+?[\d\s-]{10,15}$/.test(phone)) {
      newErrors.phone = "Please enter a valid contact number (10-15 digits)";
    }

    // Require location selection when the business has branch locations
    if (locations.length >= 1 && !selectedLocationId) {
      newErrors.location = "Please select a location";
    }

    if (!isGym && !isEducation) {
      if (!selectedDeptId) newErrors.department = "Department is required";
      if (!selectedDoctorId) newErrors.doctor = "Doctor is required";
    }
    if (isEducation) {
      if (!selectedDeptId) newErrors.department = "Subject is required";
    }
    if (!selectedDate)
      newErrors.date =
        isGym || isEducation
          ? "Session Date is required"
          : isBeauty
            ? "Service Date is required"
            : isProfessional
              ? "Consultation Date is required"
              : "Appointment Date is required";
    if (!isEducation && !isGym) {
      if (!selectedSlot)
        newErrors.timeSlot = isBeauty
          ? "Service Time is required"
          : isProfessional
            ? "Consultation Time is required"
            : "Appointment Time is required";
    }
    if (!isEducation) {
      if (!appointmentType)
        newErrors.appointmentType = isGym
          ? "Session Type is required"
          : isBeauty
            ? "Service Type is required"
            : isProfessional
              ? "Consultation Type is required"
              : "Appointment Type is required";
    }
    if (!reason.trim())
      newErrors.reason = isGym
        ? "Training goals are required"
        : isEducation
          ? "Purpose of visit is required"
          : isBeauty
            ? "Service requests are required"
            : isProfessional
              ? "Consultation objectives are required"
              : "Reason for visit is required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      // For education, build dateTime from selectedDate (no time slot)
      const effectiveDateTime = isEducation
        ? (() => {
            const d = new Date(selectedDate);
            const tzoffset = d.getTimezoneOffset() * 60000;
            return new Date(d.getTime() - tzoffset).toISOString().slice(0, 16);
          })()
        : dateTime;

      const result = await createAppointmentServerFn({
        data: {
          tenantId,
          name,
          email,
          phone,
          dateTime: effectiveDateTime,
          reason,
          doctorId: selectedDoctorId,
          timeSlot: isEducation ? undefined : selectedSlot,
          whatsapp,
          appointmentType: isEducation ? undefined : appointmentType,
          locationId:
            selectedLocationId && selectedLocationId !== MAIN_LOCATION_ID
              ? selectedLocationId
              : undefined,
          consultationMode: videoAvailable ? consultationMode : undefined,
        },
      });

      if (result.success) {
        setAppointmentId(result.appointmentId);
        setVideoJoinLink((result as any).joinLink ?? null);
        setBookingSuccess(true);
      }
    } catch (err: any) {
      setValidationError(err.message || "Failed to schedule appointment. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Filter doctors list based on selected department
  const filteredDoctors = selectedDeptId
    ? doctors.filter((doc) => doc.departmentId === selectedDeptId)
    : doctors;

  if (fetchingClinic) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
        <div
          role="status"
          aria-label="Loading"
          className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-brand"
        />
      </div>
    );
  }

  if (clinicError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
        <div className="max-w-md w-full rounded-2xl border border-zinc-200 bg-white p-6 text-center space-y-4">
          <div className="h-10 w-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mx-auto text-red-500">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-zinc-900">
              {isRestaurant
                ? "Restaurant Portal Not Found"
                : isGym
                  ? "Gym Portal Not Found"
                  : isEducation
                    ? "Academy Portal Not Found"
                    : isBeauty
                      ? "Salon Portal Not Found"
                      : isProfessional
                        ? "Firm Portal Not Found"
                        : "Clinic Portal Not Found"}
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              {isRestaurant
                ? "The booking link you followed seems to be invalid or the restaurant does not exist. Please check the URL and try again."
                : isGym
                  ? "The booking link you followed seems to be invalid or the gym does not exist. Please check the URL and try again."
                  : isEducation
                    ? "The booking link you followed seems to be invalid or the academy does not exist. Please check the URL and try again."
                    : isBeauty
                      ? "The booking link you followed seems to be invalid or the salon/spa does not exist. Please check the URL and try again."
                      : isProfessional
                        ? "The booking link you followed seems to be invalid or the firm does not exist. Please check the URL and try again."
                        : "The booking link you followed seems to be invalid or the clinic does not exist. Please check the URL and try again."}
            </p>
          </div>
          <div className="pt-2">
            <Link
              to="/"
              className="inline-flex w-full justify-center rounded-full bg-zinc-950 py-2 text-xs font-semibold text-white hover:bg-zinc-850 transition-colors"
            >
              Go to Home Page
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Req 6.1 — the added arm. Every hook above has already run, and the guards
  // added to the slot-loading effects keep the shared clinic paths idle here.
  if (isRestaurant) {
    return <RestaurantBookingForm tenantId={tenantId} restaurantName={clinicName} />;
  }

  const selectedDoctor = doctors.find((d) => d.id === selectedDoctorId);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-3 sm:px-4 py-6 sm:py-8">
      <div className="w-full max-w-lg rounded-2xl sm:rounded-[1.75rem] border border-zinc-200/60 bg-white p-4 sm:p-6 md:p-8">
        {/* Success Screen */}
        <AnimatePresence mode="wait">
          {bookingSuccess ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-5 py-4"
            >
              <div className="h-14 w-14 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </div>

              <div>
                <h2 className="text-lg font-bold text-zinc-900">
                  {isGym
                    ? "Training Session Scheduled!"
                    : isEducation
                      ? "Session Booked!"
                      : isBeauty
                        ? "Service Scheduled!"
                        : isProfessional
                          ? "Consultation Scheduled!"
                          : "Appointment Scheduled!"}
                </h2>
                <p className="mt-1 text-xs text-zinc-400">
                  Your{" "}
                  {isGym
                    ? "session"
                    : isEducation
                      ? "class/session"
                      : isBeauty
                        ? "service"
                        : isProfessional
                          ? "consultation"
                          : "appointment"}{" "}
                  at <strong className="text-zinc-700">{clinicName}</strong> has been successfully
                  booked.
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-150 bg-zinc-50/50 p-4 text-left space-y-2 text-xs">
                <div className="flex justify-between border-b border-zinc-150 pb-2">
                  <span className="text-zinc-400 font-bold uppercase text-[9px]">
                    Confirmation Code
                  </span>
                  <span className="font-mono font-bold text-zinc-800">
                    {appointmentId.substring(0, 8).toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400 font-bold uppercase text-[9px]">
                    {isGym
                      ? "Client Name"
                      : isEducation
                        ? "Student Name"
                        : isBeauty || isProfessional
                          ? "Client Name"
                          : "Patient Name"}
                  </span>
                  <span className="font-semibold text-zinc-750">{name}</span>
                </div>
                {selectedDoctor && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400 font-bold uppercase text-[9px]">
                      {isGym
                        ? "Coach / Trainer"
                        : isEducation
                          ? "Teacher / Instructor"
                          : isBeauty
                            ? "Stylist / Therapist"
                            : isProfessional
                              ? "Advisor / Consultant"
                              : "Provider / Doctor"}
                    </span>
                    <span className="font-semibold text-zinc-750">{selectedDoctor.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-zinc-400 font-bold uppercase text-[9px]">
                    Scheduled Time
                  </span>
                  <span className="font-semibold text-zinc-750">
                    {new Date(dateTime).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {!isEducation && !isGym && selectedSlot ? ` at ${selectedSlot}` : ""}
                  </span>
                </div>
                {whatsapp && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400 font-bold uppercase text-[9px]">
                      WhatsApp Number
                    </span>
                    <span className="font-semibold text-zinc-750">{whatsapp}</span>
                  </div>
                )}
                {appointmentType && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400 font-bold uppercase text-[9px]">
                      {isGym
                        ? "Session Type"
                        : isBeauty
                          ? "Service Type"
                          : isProfessional
                            ? "Consultation Type"
                            : "Appointment Type"}
                    </span>
                    <span className="font-semibold text-zinc-750">{appointmentType}</span>
                  </div>
                )}
                {selectedLocationId &&
                  (() => {
                    const loc =
                      selectedLocationId === MAIN_LOCATION_ID
                        ? {
                            name: clinicName ? `${clinicName} (Main Branch)` : "Main Branch",
                            city: null as string | null,
                          }
                        : locations.find((l) => l.id === selectedLocationId);
                    if (!loc) return null;
                    return (
                      <div className="flex justify-between">
                        <span className="text-zinc-400 font-bold uppercase text-[9px]">
                          Location
                        </span>
                        <span className="font-semibold text-zinc-750 text-right">
                          {loc.name}
                          {loc.city ? `, ${loc.city}` : ""}
                        </span>
                      </div>
                    );
                  })()}
              </div>

              {videoJoinLink && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-left space-y-2">
                  <div className="flex items-center gap-2 text-blue-800">
                    <Video className="h-4 w-4" />
                    <p className="text-xs font-bold">Your video consultation link</p>
                  </div>
                  <p className="text-[10px] text-blue-700/80">
                    Open this link at any time before or during your appointment. Share it only with
                    people who should join the call.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2 py-1.5 text-[10px] text-zinc-700 ring-1 ring-blue-100">
                      {videoJoinLink}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(videoJoinLink);
                          setLinkCopied(true);
                          setTimeout(() => setLinkCopied(false), 2000);
                        } catch {
                          /* clipboard unavailable */
                        }
                      }}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-700 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-blue-800"
                    >
                      {linkCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {linkCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <a
                    href={videoJoinLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex text-[10px] font-semibold text-blue-700 underline"
                  >
                    Open consultation room
                  </a>
                </div>
              )}

              <p className="text-[10px] text-zinc-400 px-6">
                A confirmation has been sent to your registered contact details.{" "}
                {isGym
                  ? "Please arrive 10 minutes before your scheduled session."
                  : isEducation
                    ? "Please arrive 5 minutes before your class."
                    : isBeauty
                      ? "Please arrive 10 minutes before your scheduled service."
                      : isProfessional
                        ? "Please arrive 5 minutes before your consultation."
                        : "Please arrive 15 minutes before your scheduled slot."}
              </p>
            </motion.div>
          ) : (
            <motion.div key="form" className="space-y-6">
              {/* Header */}
              <div className="text-center space-y-2">
                <div>
                  <h1 className="text-base sm:text-lg font-bold text-zinc-900">
                    {isGym
                      ? "Book Session"
                      : isEducation
                        ? "Book Session"
                        : isBeauty
                          ? "Book Service"
                          : isProfessional
                            ? "Book Consultation"
                            : "Book Appointment"}
                  </h1>
                  <p className="text-[10px] sm:text-xs text-zinc-400">
                    {isGym
                      ? "Booking portal for "
                      : isEducation
                        ? "Academy scheduling portal for "
                        : isBeauty
                          ? "Salon booking portal for "
                          : isProfessional
                            ? "Firm consultation portal for "
                            : "Scheduling online portal for "}
                    <strong className="text-brand">{clinicName}</strong>
                  </p>
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleBookingSubmit} className="space-y-3 sm:space-y-4" noValidate>
                {/* Patient Name */}
                <div className="space-y-1">
                  <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                    {isGym
                      ? "Full Name"
                      : isEducation
                        ? "Student / Visitor Full Name"
                        : isBeauty || isProfessional
                          ? "Client Full Name"
                          : "Patient Full Name"}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Enter your name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (errors.name) setErrors((prev) => ({ ...prev, name: "" }));
                      }}
                      className={`w-full rounded-full border bg-white pl-9 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 text-[11px] sm:text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all ${
                        errors.name ? "border-red-500" : "border-zinc-200"
                      }`}
                      disabled={loading}
                    />
                  </div>
                  {errors.name && (
                    <p className="text-[9px] sm:text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                      {errors.name}
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                  {/* Email */}
                  <div className="space-y-1">
                    <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="youremail@gmail.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (errors.email) setErrors((prev) => ({ ...prev, email: "" }));
                        }}
                        className={`w-full rounded-full border bg-white pl-9 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 text-[11px] sm:text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all ${
                          errors.email ? "border-red-500" : "border-zinc-200"
                        }`}
                        disabled={loading}
                      />
                    </div>
                    {errors.email && (
                      <p className="text-[9px] sm:text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                        {errors.email}
                      </p>
                    )}
                  </div>

                  {/* Phone / WhatsApp No */}
                  <div className="space-y-1">
                    <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                      Phone / WhatsApp No
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="+91 1234567890"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          if (errors.phone) setErrors((prev) => ({ ...prev, phone: "" }));
                        }}
                        className={`w-full rounded-full border bg-white pl-9 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 text-[11px] sm:text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all ${
                          errors.phone ? "border-red-500" : "border-zinc-200"
                        }`}
                        disabled={loading}
                      />
                    </div>
                    {errors.phone && (
                      <p className="text-[9px] sm:text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                        {errors.phone}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                  {/* Appointment Type Custom Dropdown — hidden for education */}
                  {!isEducation && (
                    <div className={`space-y-1 relative ${typeOpen ? "z-40" : "z-10"}`}>
                      <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                        {isGym
                          ? "Session Type"
                          : isBeauty
                            ? "Service Type"
                            : isProfessional
                              ? "Consultation Type"
                              : "Appointment Type"}
                      </label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setTypeOpen(!typeOpen);
                            setDeptOpen(false);
                            setDocOpen(false);
                            setCalendarOpen(false);
                            setClockOpen(false);
                            setLocationOpen(false);
                          }}
                          className={`w-full rounded-full border bg-white px-3 sm:px-4 py-1.5 sm:py-2 text-left text-[11px] sm:text-xs focus:outline-none transition-all flex justify-between items-center ${
                            errors.appointmentType ? "border-red-500" : "border-zinc-200"
                          }`}
                          disabled={loading}
                        >
                          <span
                            className={
                              appointmentType ? "font-semibold text-zinc-800" : "text-zinc-400"
                            }
                          >
                            {appointmentType
                              ? appointmentType
                              : isGym
                                ? "Select Session Type"
                                : isBeauty
                                  ? "Select Service Type"
                                  : isProfessional
                                    ? "Select Consultation Type"
                                    : "Select Type"}
                          </span>
                          <ChevronDown
                            className={`h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400 transition-transform ${typeOpen ? "rotate-180" : ""}`}
                          />
                        </button>

                        <AnimatePresence>
                          {typeOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-2xl shadow-xl p-1.5 space-y-0.5"
                            >
                              {(isGym
                                ? ["Trial Session", "Regular Training"]
                                : isBeauty
                                  ? ["Standard Service", "Premium Treatment"]
                                  : isProfessional
                                    ? ["Initial Consultation", "Follow-up Advisory"]
                                    : ["First Time", "Follow up"]
                              ).map((type) => (
                                <button
                                  key={type}
                                  type="button"
                                  onClick={() => {
                                    setAppointmentType(type);
                                    setTypeOpen(false);
                                    if (errors.appointmentType)
                                      setErrors((prev) => ({ ...prev, appointmentType: "" }));
                                  }}
                                  className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                    appointmentType === type
                                      ? "bg-brand/5 text-brand font-bold"
                                      : "text-zinc-700"
                                  }`}
                                >
                                  <span>{type}</span>
                                  {appointmentType === type && (
                                    <Check className="h-3.5 w-3.5 text-brand" />
                                  )}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      {errors.appointmentType && (
                        <p className="text-[9px] sm:text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                          {errors.appointmentType}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Multi-Location: shown when business has at least one branch.
                    The main workspace is included as the head-office option. */}
                  {locations.length >= 1 &&
                    (() => {
                      const locationOptions = [
                        {
                          id: MAIN_LOCATION_ID,
                          name: clinicName ? `${clinicName} (Main Branch)` : "Main Branch",
                          city: null as string | null,
                          address: null as string | null,
                        },
                        ...locations,
                      ];
                      const selectedLoc = locationOptions.find((l) => l.id === selectedLocationId);
                      return (
                        <div className={`space-y-1 relative ${locationOpen ? "z-40" : "z-10"}`}>
                          <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                            Select Location
                          </label>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                setLocationOpen(!locationOpen);
                                setDeptOpen(false);
                                setDocOpen(false);
                                setTypeOpen(false);
                                setCalendarOpen(false);
                                setClockOpen(false);
                              }}
                              className={`w-full rounded-full border bg-white pl-9 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 text-left text-[11px] sm:text-xs focus:outline-none transition-all flex justify-between items-center ${
                                errors.location ? "border-red-500" : "border-zinc-200"
                              }`}
                              disabled={loading}
                            >
                              <MapPin className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                              <span
                                className={
                                  selectedLoc ? "font-semibold text-zinc-800" : "text-zinc-400"
                                }
                              >
                                {selectedLoc
                                  ? selectedLoc.name +
                                    (selectedLoc.city ? ` — ${selectedLoc.city}` : "")
                                  : "Select Location"}
                              </span>
                              <ChevronDown
                                className={`h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400 transition-transform ${locationOpen ? "rotate-180" : ""}`}
                              />
                            </button>

                            <AnimatePresence>
                              {locationOpen && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-2xl shadow-xl max-h-56 overflow-y-auto p-1.5 space-y-0.5"
                                >
                                  {locationOptions.map((loc) => (
                                    <button
                                      key={loc.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedLocationId(loc.id);
                                        setLocationOpen(false);
                                        if (errors.location)
                                          setErrors((prev) => ({ ...prev, location: "" }));
                                      }}
                                      className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                        selectedLocationId === loc.id
                                          ? "bg-brand/5 text-brand font-bold"
                                          : "text-zinc-700"
                                      }`}
                                    >
                                      <div className="flex flex-col min-w-0 pr-2">
                                        <span className="font-semibold truncate">{loc.name}</span>
                                        {(loc.city || loc.address) && (
                                          <span className="text-[9px] text-zinc-400 font-normal truncate">
                                            {[loc.city, loc.address].filter(Boolean).join(" • ")}
                                          </span>
                                        )}
                                      </div>
                                      {selectedLocationId === loc.id && (
                                        <Check className="h-3.5 w-3.5 text-brand shrink-0" />
                                      )}
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          {errors.location && (
                            <p className="text-[9px] sm:text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                              {errors.location}
                            </p>
                          )}
                        </div>
                      );
                    })()}
                </div>

                {isEducation && (
                  <>
                    <hr className="border-zinc-100 my-2" />

                    {/* Education: Select Subject (full width) */}
                    <div className={`space-y-1 relative ${deptOpen ? "z-40" : "z-10"}`}>
                      <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                        Select Subject
                      </label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setDeptOpen(!deptOpen);
                            setDocOpen(false);
                            setTypeOpen(false);
                            setCalendarOpen(false);
                            setClockOpen(false);
                            setLocationOpen(false);
                          }}
                          className={`w-full rounded-full border bg-white px-3 sm:px-4 py-1.5 sm:py-2 text-left text-[11px] sm:text-xs focus:outline-none transition-all flex justify-between items-center ${
                            errors.department ? "border-red-500" : "border-zinc-200"
                          }`}
                          disabled={loading}
                        >
                          <span
                            className={
                              selectedDeptId ? "font-semibold text-zinc-800" : "text-zinc-400"
                            }
                          >
                            {selectedDeptId
                              ? departments.find((d) => d.id === selectedDeptId)?.name
                              : "Select Subject"}
                          </span>
                          <ChevronDown
                            className={`h-4 w-4 text-zinc-400 transition-transform ${deptOpen ? "rotate-180" : ""}`}
                          />
                        </button>

                        <AnimatePresence>
                          {deptOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-2xl shadow-xl max-h-56 overflow-y-auto p-1.5 space-y-0.5"
                            >
                              {departments.map((dept) => (
                                <button
                                  key={dept.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedDeptId(dept.id);
                                    setDeptOpen(false);
                                    if (errors.department)
                                      setErrors((prev) => ({ ...prev, department: "" }));
                                  }}
                                  className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                    selectedDeptId === dept.id
                                      ? "bg-brand/5 text-brand font-bold"
                                      : "text-zinc-700"
                                  }`}
                                >
                                  <span>{dept.name}</span>
                                  {selectedDeptId === dept.id && (
                                    <Check className="h-3.5 w-3.5 text-brand" />
                                  )}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      {errors.department && (
                        <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                          {errors.department}
                        </p>
                      )}
                    </div>
                  </>
                )}

                {!isGym && !isEducation && (
                  <>
                    <hr className="border-zinc-100 my-2" />

                    {/* Step 1: Select Department Custom Dropdown */}
                    <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                      <div className={`space-y-1 relative ${deptOpen ? "z-40" : "z-10"}`}>
                        <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                          {isBeauty
                            ? "Select Service Category"
                            : isProfessional
                              ? "Select Practice Area"
                              : "Select Department"}
                        </label>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setDeptOpen(!deptOpen);
                              setDocOpen(false);
                              setTypeOpen(false);
                              setCalendarOpen(false);
                              setClockOpen(false);
                              setLocationOpen(false);
                            }}
                            className={`w-full rounded-full border bg-white px-3 sm:px-4 py-1.5 sm:py-2 text-left text-[11px] sm:text-xs focus:outline-none transition-all flex justify-between items-center ${
                              errors.department ? "border-red-500" : "border-zinc-200"
                            }`}
                            disabled={loading}
                          >
                            <span
                              className={
                                selectedDeptId ? "font-semibold text-zinc-800" : "text-zinc-400"
                              }
                            >
                              {selectedDeptId
                                ? departments.find((d) => d.id === selectedDeptId)?.name
                                : isBeauty
                                  ? "Select Service Category"
                                  : isProfessional
                                    ? "Select Practice Area"
                                    : "Select Department"}
                            </span>
                            <ChevronDown
                              className={`h-4 w-4 text-zinc-400 transition-transform ${deptOpen ? "rotate-180" : ""}`}
                            />
                          </button>

                          <AnimatePresence>
                            {deptOpen && (
                              <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-2xl shadow-xl max-h-56 overflow-y-auto p-1.5 space-y-0.5"
                              >
                                {departments.map((dept) => (
                                  <button
                                    key={dept.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedDeptId(dept.id);
                                      setSelectedDoctorId(""); // Reset doctor
                                      setSelectedDate(""); // Reset date/time slot since doctor changed
                                      setSelectedSlot("");
                                      setDeptOpen(false);
                                      if (errors.department)
                                        setErrors((prev) => ({ ...prev, department: "" }));
                                    }}
                                    className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                      selectedDeptId === dept.id
                                        ? "bg-brand/5 text-brand font-bold"
                                        : "text-zinc-700"
                                    }`}
                                  >
                                    <span>{dept.name}</span>
                                    {selectedDeptId === dept.id && (
                                      <Check className="h-3.5 w-3.5 text-brand" />
                                    )}
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        {errors.department && (
                          <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                            {errors.department}
                          </p>
                        )}
                      </div>

                      {/* Step 2: Select Doctor Custom Dropdown */}
                      <div className={`space-y-1 relative ${docOpen ? "z-40" : "z-10"}`}>
                        <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                          {isBeauty
                            ? "Select Stylist / Therapist"
                            : isProfessional
                              ? "Select Advisor / Consultant"
                              : "Select Doctor"}
                        </label>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setDocOpen(!docOpen);
                              setDeptOpen(false);
                              setTypeOpen(false);
                              setCalendarOpen(false);
                              setClockOpen(false);
                              setLocationOpen(false);
                            }}
                            className={`w-full rounded-full border bg-white px-3 sm:px-4 py-1.5 sm:py-2 text-left text-[11px] sm:text-xs focus:outline-none transition-all flex justify-between items-center ${
                              errors.doctor ? "border-red-500" : "border-zinc-200"
                            }`}
                            disabled={loading}
                          >
                            <span
                              className={
                                selectedDoctorId ? "font-semibold text-zinc-800" : "text-zinc-400"
                              }
                            >
                              {selectedDoctorId
                                ? doctors.find((d) => d.id === selectedDoctorId)?.name
                                : isBeauty
                                  ? "Select Stylist / Therapist"
                                  : isProfessional
                                    ? "Select Advisor / Consultant"
                                    : "Select Doctor"}
                            </span>
                            <ChevronDown
                              className={`h-4 w-4 text-zinc-400 transition-transform ${docOpen ? "rotate-180" : ""}`}
                            />
                          </button>

                          <AnimatePresence>
                            {docOpen && (
                              <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-2xl shadow-xl max-h-56 overflow-y-auto p-1.5 space-y-0.5"
                              >
                                {filteredDoctors.length > 0 ? (
                                  filteredDoctors.map((doc) => (
                                    <button
                                      key={doc.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedDoctorId(doc.id);
                                        setSelectedDate(""); // Reset date/time slot since doctor changed
                                        setSelectedSlot("");
                                        setDocOpen(false);
                                        if (errors.doctor)
                                          setErrors((prev) => ({ ...prev, doctor: "" }));
                                      }}
                                      className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                        selectedDoctorId === doc.id
                                          ? "bg-brand/5 text-brand font-bold"
                                          : "text-zinc-700"
                                      }`}
                                    >
                                      <div className="flex flex-col">
                                        <span className="font-semibold">{doc.name}</span>
                                        <span className="text-[9px] text-zinc-400 font-normal">
                                          {doc.qualifications}
                                        </span>
                                      </div>
                                      {selectedDoctorId === doc.id && (
                                        <Check className="h-3.5 w-3.5 text-brand" />
                                      )}
                                    </button>
                                  ))
                                ) : (
                                  <div className="px-3.5 py-3 text-xs text-zinc-455 italic text-center">
                                    Please select a department first
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        {errors.doctor && (
                          <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                            {errors.doctor}
                          </p>
                        )}
                      </div>
                    </div>

                    {selectedDoctor && (
                      <p className="text-[10px] text-zinc-455 italic pl-1 leading-normal">
                        Qualifications:{" "}
                        <strong className="text-zinc-650">{selectedDoctor.qualifications}</strong>
                      </p>
                    )}
                  </>
                )}

                {/* Step 3: Custom Popover Calendar Date Picker */}
                <div className={`space-y-1 relative ${calendarOpen ? "z-40" : "z-10"}`}>
                  <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                    {isGym
                      ? "Select Session Date"
                      : isEducation
                        ? "Select Date"
                        : isBeauty
                          ? "Select Service Date"
                          : isProfessional
                            ? "Select Consultation Date"
                            : "Select Date"}
                  </label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isGym && !isEducation && !selectedDoctorId) {
                          setErrors((prev) => ({ ...prev, date: "Please select a doctor first" }));
                          return;
                        }
                        setCalendarOpen(!calendarOpen);
                        setDeptOpen(false);
                        setDocOpen(false);
                        setTypeOpen(false);
                        setClockOpen(false);
                        setLocationOpen(false);
                      }}
                      className={`w-full rounded-full border bg-white pl-9 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 text-left text-[11px] sm:text-xs focus:outline-none transition-all flex justify-between items-center ${
                        errors.date ? "border-red-500" : "border-zinc-200"
                      }`}
                      disabled={loading || (!isGym && !isEducation && !selectedDoctorId)}
                    >
                      <Calendar className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                      <span
                        className={selectedDate ? "font-semibold text-zinc-800" : "text-zinc-400"}
                      >
                        {selectedDate
                          ? new Date(selectedDate).toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "Select Date"}
                      </span>
                      <ChevronDown className="h-4 w-4 text-zinc-450" />
                    </button>

                    <AnimatePresence>
                      {calendarOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-50 mt-1 left-0 sm:left-auto right-0 bg-white border border-zinc-200 rounded-2xl shadow-xl p-4 w-[280px]"
                        >
                          {/* Calendar Navigation */}
                          <div className="flex justify-between items-center mb-3">
                            <button
                              type="button"
                              onClick={() => {
                                if (calMonth === 0) {
                                  setCalMonth(11);
                                  setCalYear(calYear - 1);
                                } else {
                                  setCalMonth(calMonth - 1);
                                }
                              }}
                              className="p-1 hover:bg-zinc-100 rounded-lg text-zinc-600"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-xs font-bold text-zinc-800">
                              {new Date(calYear, calMonth).toLocaleDateString("en-US", {
                                month: "long",
                                year: "numeric",
                              })}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (calMonth === 11) {
                                  setCalMonth(0);
                                  setCalYear(calYear + 1);
                                } else {
                                  setCalMonth(calMonth + 1);
                                }
                              }}
                              className="p-1 hover:bg-zinc-100 rounded-lg text-zinc-600"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>

                          {/* Weekdays Header */}
                          <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold text-zinc-400 mb-1">
                            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                              <div key={d}>{d}</div>
                            ))}
                          </div>

                          {/* Monthly Days Grid */}
                          <div className="grid grid-cols-7 gap-1 text-center">
                            {getDaysInMonth(calMonth, calYear).map((day, idx) => {
                              if (!day) return <div key={`empty-${idx}`} />;

                              const localDateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
                              const isSelected = selectedDate === localDateStr;
                              const past = isPastDate(day);

                              return (
                                <button
                                  key={day.toISOString()}
                                  type="button"
                                  onClick={() => {
                                    if (past) return;
                                    setSelectedDate(localDateStr);
                                    setCalendarOpen(false);
                                    if (errors.date) setErrors((prev) => ({ ...prev, date: "" }));
                                  }}
                                  disabled={past}
                                  className={`h-7 w-7 text-[10px] font-bold rounded-lg flex items-center justify-center transition-all ${
                                    isSelected
                                      ? "bg-black text-white font-black"
                                      : past
                                        ? "text-zinc-200 cursor-not-allowed"
                                        : "text-zinc-700 hover:bg-zinc-100"
                                  }`}
                                >
                                  {day.getDate()}
                                </button>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {errors.date && (
                    <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">{errors.date}</p>
                  )}
                </div>

                {/* Step 4: Custom Popover Time Slot Picker — hidden for education/gym */}
                {!isEducation && !isGym && selectedDoctorId && selectedDate && (
                  <div className={`space-y-1 relative ${clockOpen ? "z-40" : "z-10"}`}>
                    <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1 font-semibold flex items-center gap-1.5">
                      Select Available Time Slot
                    </label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setClockOpen(!clockOpen);
                          setDeptOpen(false);
                          setDocOpen(false);
                          setTypeOpen(false);
                          setCalendarOpen(false);
                          setLocationOpen(false);
                        }}
                        className={`w-full rounded-full border bg-white pl-9 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 text-left text-[11px] sm:text-xs focus:outline-none transition-all flex justify-between items-center ${
                          errors.timeSlot ? "border-red-500" : "border-zinc-200"
                        }`}
                        disabled={loading}
                      >
                        <Clock className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                        <span
                          className={selectedSlot ? "font-semibold text-zinc-800" : "text-zinc-400"}
                        >
                          {selectedSlot
                            ? selectedSlot
                            : isBeauty
                              ? "Select Service Time"
                              : isProfessional
                                ? "Select Consultation Time"
                                : "Select Time Slot"}
                        </span>
                        <ChevronDown className="h-4 w-4 text-zinc-400" />
                      </button>

                      <AnimatePresence>
                        {clockOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="absolute z-50 mt-1 left-0 sm:left-auto right-0 bg-white border border-zinc-200 rounded-2xl shadow-xl p-3 w-[280px]"
                          >
                            <div className="text-[9px] font-bold text-zinc-400 uppercase mb-2 px-1 flex items-center gap-1">
                              <Clock className="h-3 w-3 text-brand" /> Available slots
                            </div>

                            {loadingSlots ? (
                              <div className="flex justify-center py-4">
                                <Loader2 className="h-4 w-4 animate-spin text-brand" />
                              </div>
                            ) : availableSlots.length > 0 ? (
                              <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1">
                                {availableSlots.map((slot) => {
                                  const isSelected = selectedSlot === slot;
                                  return (
                                    <button
                                      key={slot}
                                      type="button"
                                      onClick={() => {
                                        handleSelectSlot(slot);
                                        setClockOpen(false);
                                        if (errors.timeSlot)
                                          setErrors((prev) => ({ ...prev, timeSlot: "" }));
                                      }}
                                      className={`rounded-xl py-2 px-1 text-[10px] font-bold border transition-all cursor-pointer text-center ${
                                        isSelected
                                          ? "bg-black border-zinc-800 text-white font-black scale-[1.02]"
                                          : "bg-white border-zinc-200 text-zinc-650 hover:border-zinc-800/40"
                                      }`}
                                    >
                                      {slot}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-center py-3 text-[10px] text-red-500 font-bold bg-red-50/50 rounded-xl border border-red-100">
                                No slots available on this date.
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {errors.timeSlot && (
                      <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                        {errors.timeSlot}
                      </p>
                    )}
                  </div>
                )}

                {/* Consultation mode — only when the clinic offers video */}
                {videoAvailable && (
                  <div className="space-y-1">
                    <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                      How would you like to consult?
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { value: "in_person", label: "In person" },
                          { value: "video", label: "Video call" },
                        ] as const
                      ).map((opt) => (
                        <button
                          type="button"
                          key={opt.value}
                          onClick={() => setConsultationMode(opt.value)}
                          className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${
                            consultationMode === opt.value
                              ? "border-brand bg-brand/5 text-brand"
                              : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {consultationMode === "video" && (
                      <p className="pl-1 text-[9px] text-zinc-400">
                        A secure join link is created instantly so you and the doctor can connect
                        before or at the appointment time.
                      </p>
                    )}
                  </div>
                )}

                {/* Symptoms / Reason */}
                <div className="space-y-1">
                  <label className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1">
                    {isGym
                      ? "Training Goals / Focus Area"
                      : isEducation
                        ? "Purpose of Visit"
                        : isBeauty
                          ? "Service Requests / Style Goals"
                          : isProfessional
                            ? "Consultation Objectives"
                            : "Reason for Visit / Chief Complaint"}
                  </label>
                  <div className="relative">
                    <FileText className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                    <input
                      type="text"
                      placeholder={
                        isGym
                          ? "e.g. weight loss, build muscle, stamina"
                          : isEducation
                            ? "e.g. academic counselling, exam inquiry, subject query"
                            : isBeauty
                              ? "e.g. haircut, facial, hair coloring, massage"
                              : isProfessional
                                ? "e.g. tax advisory, business coaching, contract review"
                                : "Brief details of your symptoms"
                      }
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        if (errors.reason) setErrors((prev) => ({ ...prev, reason: "" }));
                      }}
                      className={`w-full rounded-full border bg-white pl-9 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 text-[11px] sm:text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all ${
                        errors.reason ? "border-red-500" : "border-zinc-200"
                      }`}
                      disabled={loading}
                    />
                  </div>
                  {errors.reason && (
                    <p className="text-[9px] sm:text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                      {errors.reason}
                    </p>
                  )}
                </div>

                {/* Validation Error Banner */}
                {validationError && (
                  <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
                    <p className="text-[10px] font-bold text-red-650 flex items-center justify-center gap-1 leading-none">
                      <AlertCircle className="h-3.5 w-3.5 text-red-500" /> {validationError}
                    </p>
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-zinc-950 hover:bg-zinc-850 py-2 sm:py-2.5 text-[11px] sm:text-xs font-semibold text-white transition-all active:scale-[0.99] flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:bg-zinc-150 disabled:text-zinc-400"
                >
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isGym
                    ? "Schedule Session"
                    : isEducation
                      ? "Book Appointment"
                      : isBeauty
                        ? "Book Service"
                        : isProfessional
                          ? "Schedule Consultation"
                          : "Schedule Appointment"}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// The restaurant arm (Requirement 6, tasks 10.1 and 10.2)
//
// Everything below this line is additive. It runs only when `isRestaurant` is
// true, and the five existing category paths above never reach it (Req 12).
//
// The stale-response discipline (Req 6.4) and the selection reset (Req 6.13) live
// in the exported pure reducer `restaurantFormReducer`, so Properties 33 and 34
// are assertable without a router, a session, or a database — and the component
// below is the only consumer of that reducer, so the DOM and the reducer cannot
// drift apart.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Availability is requested this long after the last Party_Size / booking date
 * change, so a burst of changes issues one request. Well inside the Req 6.4
 * budget below.
 */
export const AVAILABILITY_DEBOUNCE_MS = 150;

/** Req 6.4 — the returned Booking_Slots must render within this budget. */
export const AVAILABILITY_RENDER_BUDGET_MS = 2000;

/** Req 6.11 — the field-level messages for the three required selections. */
export const MSG_FIELD_PARTY_SIZE_REQUIRED = "Party size is required";
export const MSG_FIELD_DATE_REQUIRED = "Booking date is required";
export const MSG_FIELD_SLOT_REQUIRED = "Booking slot is required";

/** Req 5.9 — shown for the out-of-window indicator. */
export const MSG_OUT_OF_WINDOW =
  "That date is beyond the booking window. Please pick an earlier date";

/** Req 6.2 — the Party_Size control offers exactly 1 through Max_Party_Size. */
export function partySizeOptions(maxPartySize: unknown): number[] {
  const max = Number(maxPartySize);
  if (!Number.isInteger(max) || max < 1) return [];
  return Array.from({ length: max }, (_, i) => i + 1);
}

/** The availability payload the public form consumes, with its Req 6.4 echoes. */
export interface RestaurantAvailabilityResponse {
  /** Echo of the `reqId` the form issued. */
  reqId: number;
  /** Echo of the requested booking date. */
  requestedDate: string;
  /** Echo of the requested Party_Size. */
  requestedPartySize: number;
  restaurantName?: string;
  maxPartySize: number;
  closed: boolean;
  outOfWindow: boolean;
  requiresMultipleTables: boolean;
  activeTableCount: number;
  largestCapacity: number;
  slots: AvailabilitySlot[];
  tables: DiningTable[];
}

/** What the form needs back from a created Table_Booking (Req 7.9, 7.10). */
export interface RestaurantBookingResponse {
  success: boolean;
  bookingId: string;
  tokenNo: number;
  /** The assigned Table_Group. */
  tables: { id: string; name: string }[];
  /** The Table_Group rendered for display, e.g. `T1 + T2`. */
  tableName: string;
  date: string;
  slotLabel: string;
  startMinutes: number;
  partySize: number;
  status: string;
}

/** Injectable so the DOM suite can drive request/response interleavings. */
export type FetchRestaurantAvailability = (opts: {
  data: { tenantId: string; date: string; partySize: number; reqId: number };
}) => Promise<RestaurantAvailabilityResponse>;

export type CreateRestaurantBooking = (opts: {
  data: {
    tenantId: string;
    guestName: string;
    phone: string;
    email?: string;
    partySize: number;
    date: string;
    slotStartMinutes: number;
    slotLabel: string;
    /** The Table_Group; `[TABLE_SELECTION_ANY]` means `Any available table`. */
    tableIds: string[];
    specialRequests?: string;
  };
}) => Promise<RestaurantBookingResponse>;

// ---------------------------------------------------------------------------
// The form state machine (Req 6.4, 6.13)
// ---------------------------------------------------------------------------

export interface RestaurantFormState {
  /** null = nothing chosen yet, which is what Req 6.11 validates against. */
  partySize: number | null;
  /** "" = nothing chosen yet. */
  date: string;
  /** The highest `reqId` issued so far. */
  latestReqId: number;
  /** The `reqId` currently in flight, or null. */
  pendingReqId: number | null;
  /** The applied availability — always the one matching the current selection. */
  availability: RestaurantAvailabilityResponse | null;
  selectedSlotStart: number | null;
  /** `Any available table` plus the live-region message (Req 6.3, 6.7, 6.8). */
  selection: TableSelectionState;
}

export const INITIAL_RESTAURANT_FORM_STATE: RestaurantFormState = {
  partySize: null,
  date: "",
  latestReqId: 0,
  pendingReqId: null,
  availability: null,
  selectedSlotStart: null,
  selection: INITIAL_TABLE_SELECTION,
};

export type RestaurantFormAction =
  | { type: "setPartySize"; partySize: number | null }
  | { type: "setDate"; date: string }
  | { type: "requestIssued"; reqId: number }
  | { type: "responseReceived"; response: RestaurantAvailabilityResponse }
  | { type: "requestFailed"; reqId: number }
  | { type: "selectSlot"; startMinutes: number }
  | { type: "activateTable"; table: LayoutTable }
  | { type: "clearTableSelection" };

/**
 * Req 6.4 — a response is applied only when its echoed booking date and Party_Size
 * equal the current selection AND its `reqId` is the latest issued. Every other
 * response is discarded, whatever order it arrives in.
 */
export function isApplicableAvailabilityResponse(
  state: RestaurantFormState,
  response: RestaurantAvailabilityResponse,
): boolean {
  if (!response) return false;
  if (response.reqId !== state.latestReqId) return false;
  if (state.partySize === null || state.date === "") return false;
  return response.requestedDate === state.date && response.requestedPartySize === state.partySize;
}

/** The Available_Table ids of the Booking_Slot currently selected. */
export function availableTableIdsForSlot(state: RestaurantFormState): string[] {
  const slot = (state.availability?.slots ?? []).find(
    (s) => s.startMinutes === state.selectedSlotStart,
  );
  return slot ? [...slot.availableTableIds] : [];
}

/** Req 6.5 — every `active` Dining_Table, in the canonical order. */
export function layoutTablesFor(state: RestaurantFormState): DiningTable[] {
  return orderTables((state.availability?.tables ?? []).filter((t) => t.state === "active"));
}

/** Req 6.11 — a field-level message for exactly the empty required fields. */
export function restaurantEmptyFieldErrors(state: RestaurantFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (state.partySize === null) errors.partySize = MSG_FIELD_PARTY_SIZE_REQUIRED;
  if (String(state.date ?? "").trim() === "") errors.date = MSG_FIELD_DATE_REQUIRED;
  if (state.selectedSlotStart === null) errors.slot = MSG_FIELD_SLOT_REQUIRED;
  return errors;
}

/**
 * The one place the Req 6.4 discipline and the Req 6.13 reset are implemented.
 *
 * A Party_Size or booking date change drops the applied availability and resets
 * the Table selection to `Any available table` BEFORE any fresh response can be
 * applied, so what renders always corresponds to the current selection.
 */
export function restaurantFormReducer(
  state: RestaurantFormState,
  action: RestaurantFormAction,
): RestaurantFormState {
  switch (action.type) {
    case "setPartySize": {
      if (action.partySize === state.partySize) return state;
      return {
        ...state,
        partySize: action.partySize,
        // Req 6.13 — the reset happens now, not when the response lands.
        availability: null,
        pendingReqId: null,
        selectedSlotStart: null,
        selection: tableSelectionReducer(state.selection, { type: "reset" }),
      };
    }
    case "setDate": {
      const date = String(action.date ?? "");
      if (date === state.date) return state;
      return {
        ...state,
        date,
        availability: null,
        pendingReqId: null,
        selectedSlotStart: null,
        selection: tableSelectionReducer(state.selection, { type: "reset" }),
      };
    }
    case "requestIssued": {
      const reqId = Number(action.reqId);
      if (!Number.isFinite(reqId) || reqId <= state.latestReqId) return state;
      return { ...state, latestReqId: reqId, pendingReqId: reqId };
    }
    case "responseReceived": {
      // Every non-matching response — stale reqId, superseded date, superseded
      // party size — is discarded here.
      if (!isApplicableAvailabilityResponse(state, action.response)) return state;
      const slots = action.response.slots ?? [];
      const slotStillOffered =
        state.selectedSlotStart !== null &&
        slots.some((s) => s.startMinutes === state.selectedSlotStart);
      return {
        ...state,
        availability: action.response,
        pendingReqId: null,
        selectedSlotStart: slotStillOffered ? state.selectedSlotStart : null,
      };
    }
    case "requestFailed": {
      if (action.reqId !== state.latestReqId) return state;
      return { ...state, pendingReqId: null };
    }
    case "selectSlot": {
      if (action.startMinutes === state.selectedSlotStart) return state;
      return {
        ...state,
        selectedSlotStart: action.startMinutes,
        // The Available_Table set changes with the slot, so the selection starts
        // again from `Any available table`.
        selection: tableSelectionReducer(state.selection, { type: "reset" }),
      };
    }
    case "activateTable": {
      return {
        ...state,
        selection: tableSelectionReducer(state.selection, {
          type: "activate",
          table: action.table,
          availableTableIds: availableTableIdsForSlot(state),
        }),
      };
    }
    case "clearTableSelection":
      return { ...state, selection: { ...INITIAL_TABLE_SELECTION } };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Public menu (Req 6.9-6.11)
// ---------------------------------------------------------------------------

/**
 * The public-menu read is injectable so the DOM suite can drive the projection
 * without touching the settings row-access layer. The server projection (task
 * 8.3) already returns primary-scope, canonically ordered categories that hold
 * only `available` items and drops every empty category, so the caller renders
 * exactly what it receives.
 */
export type FetchPublicRestaurantMenu = (opts: {
  data: { tenantId: string };
}) => Promise<{ categories: MenuCategory[] }>;

/**
 * Renders an Item_Price from its stored whole-minor-unit value. The rest of the
 * product prices in Indian rupees, so the guest menu matches (`₹` plus two
 * fraction digits).
 */
export function formatMenuItemPrice(priceMinor: number): string {
  const safe = Number.isFinite(priceMinor) ? Math.max(0, priceMinor) : 0;
  return `₹${(safe / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Req 6.9-6.11 — the read-only guest menu of the restaurant booking form. It
 * shows each Menu_Category name with its `available` Menu_Items (Item_Name,
 * Item_Price, Item_Description) in the projection's order. When the projection
 * is empty (no `available` item), the whole section is omitted so every other
 * booking control renders unchanged.
 */
export function PublicRestaurantMenu({ categories }: { categories: readonly MenuCategory[] }) {
  // Req 6.11 — an empty available menu renders no menu section at all.
  if (!categories || categories.length === 0) return null;

  return (
    <section
      data-testid="public-restaurant-menu"
      aria-label="Menu"
      className="mt-6 space-y-4 rounded-2xl border border-zinc-150 bg-zinc-50/50 p-4"
    >
      <h2 className="text-sm font-bold text-zinc-900">Menu</h2>
      <div className="space-y-4">
        {categories.map((category) => (
          <div key={category.id} data-testid={`menu-category-${category.id}`} className="space-y-2">
            <h3
              data-testid={`menu-category-name-${category.id}`}
              className="text-[11px] font-bold uppercase tracking-wide text-zinc-500"
            >
              {category.name}
            </h3>
            <ul className="space-y-2">
              {category.items.map((item) => (
                <li
                  key={item.id}
                  data-testid={`menu-item-${item.id}`}
                  className="flex flex-col gap-0.5 border-b border-zinc-150 pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      data-testid={`menu-item-name-${item.id}`}
                      className="text-xs font-semibold text-zinc-800"
                    >
                      {item.name}
                    </span>
                    <span
                      data-testid={`menu-item-price-${item.id}`}
                      className="shrink-0 text-xs font-bold text-zinc-700"
                    >
                      {formatMenuItemPrice(item.priceMinor)}
                    </span>
                  </div>
                  {item.description.trim() !== "" && (
                    <p
                      data-testid={`menu-item-description-${item.id}`}
                      className="text-[10px] leading-snug text-zinc-500"
                    >
                      {item.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The rendered field set (Req 6.1-6.14, 7.10)
// ---------------------------------------------------------------------------

export interface RestaurantBookingFormProps {
  tenantId: string;
  restaurantName?: string;
  /** Defaults to the real server functions; injected by the DOM suite. */
  fetchAvailability?: FetchRestaurantAvailability;
  createBooking?: CreateRestaurantBooking;
  /** Public menu read; defaults to the real server function, injected in tests. */
  fetchMenu?: FetchPublicRestaurantMenu;
}

const inputClasses = (invalid: boolean) =>
  `w-full rounded-full border bg-white pl-9 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 text-[11px] sm:text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all ${
    invalid ? "border-red-500" : "border-zinc-200"
  }`;

export function RestaurantBookingForm({
  tenantId,
  restaurantName,
  fetchAvailability = getRestaurantAvailabilityServerFn as unknown as FetchRestaurantAvailability,
  createBooking = createRestaurantBookingPublicServerFn as unknown as CreateRestaurantBooking,
  fetchMenu = getPublicRestaurantMenuServerFn as unknown as FetchPublicRestaurantMenu,
}: RestaurantBookingFormProps) {
  const [state, dispatch] = useReducer(restaurantFormReducer, INITIAL_RESTAURANT_FORM_STATE);

  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [booking, setBooking] = useState<RestaurantBookingResponse | null>(null);
  // Req 6.9-6.11 — the guest menu, empty until the projection lands. A read
  // failure keeps it empty, so a menu outage never blocks the booking controls.
  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([]);

  const reqIdRef = useRef(0);

  // Req 6.9-6.11 — load the primary-scope, available-only menu projection once
  // per tenant. This read is independent of availability and booking.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    fetchMenu({ data: { tenantId } })
      .then((response) => {
        if (!cancelled) setMenuCategories(response?.categories ?? []);
      })
      .catch((err) => {
        console.error("Failed to load restaurant menu:", err);
        if (!cancelled) setMenuCategories([]);
      });
    return () => {
      cancelled = true;
    };
    // `fetchMenu` is stable for the lifetime of the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const availability = state.availability;
  const maxPartySize = availability?.maxPartySize ?? DEFAULT_SETTINGS.maxPartySize;
  const loading = state.pendingReqId !== null;

  // Req 6.4 — one request per Party_Size / booking date change, and the response
  // is handed to the reducer, which decides whether it still applies.
  useEffect(() => {
    if (!tenantId) return;
    if (state.partySize === null || state.date === "") return;

    const partySize = state.partySize;
    const date = state.date;

    const handle = setTimeout(() => {
      const reqId = ++reqIdRef.current;
      dispatch({ type: "requestIssued", reqId });
      fetchAvailability({ data: { tenantId, date, partySize, reqId } })
        .then((response) => {
          dispatch({
            type: "responseReceived",
            response: { ...response, reqId: response?.reqId ?? reqId },
          });
        })
        .catch((err) => {
          console.error("Failed to load restaurant availability:", err);
          dispatch({ type: "requestFailed", reqId });
        });
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => clearTimeout(handle);
    // `fetchAvailability` is stable for the lifetime of the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, state.partySize, state.date]);

  const slots =
    availability && !availability.closed && !availability.outOfWindow ? availability.slots : [];
  const layoutTables = useMemo(() => layoutTablesFor(state), [state]);
  const availableTableIds = useMemo(() => availableTableIdsForSlot(state), [state]);
  const selectedSlot = slots.find((s) => s.startMinutes === state.selectedSlotStart) ?? null;
  // The chosen Table_Group, rendered in the canonical layout order rather than
  // activation order so the summary matches what the layout shows.
  const selectedTables = useMemo(
    () => layoutTables.filter((t) => state.selection.selectedTableIds.includes(t.id)),
    [layoutTables, state.selection.selectedTableIds],
  );
  const selectedSeats = selectedTables.reduce((sum, t) => sum + (t.seatCapacity ?? 0), 0);

  // Req 6.10 — a zero-availability slot stays selectable and says why.
  const layoutMessage =
    state.selection.message ??
    (selectedSlot && selectedSlot.availableCount === 0 ? MSG_NO_TABLE_FREE : null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");

    // Req 6.11 — a field-level message for each empty field, and NO request.
    const emptyFieldErrors = restaurantEmptyFieldErrors(state);
    if (Object.keys(emptyFieldErrors).length > 0) {
      setErrors(emptyFieldErrors);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      const result = await createBooking({
        data: {
          tenantId,
          guestName,
          phone,
          email,
          partySize: state.partySize as number,
          date: state.date,
          slotStartMinutes: state.selectedSlotStart as number,
          slotLabel: selectedSlot?.label ?? "",
          // An empty Table_Group is `Any available table`, which the server
          // resolves to the fewest tables that seat the party.
          tableIds:
            state.selection.selectedTableIds.length > 0
              ? [...state.selection.selectedTableIds]
              : [TABLE_SELECTION_ANY],
          specialRequests,
        },
      });
      if (result?.success) setBooking(result);
    } catch (err: any) {
      setSubmitError(err?.message || "Failed to book your table. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Req 7.10 — the success view reports the assigned table, date, slot, party
  // size and Booking_Token.
  if (booking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-3 sm:px-4 py-6 sm:py-8">
        <div className="w-full max-w-lg rounded-2xl sm:rounded-[1.75rem] border border-zinc-200/60 bg-white p-4 sm:p-6 md:p-8">
          <div className="text-center space-y-5 py-4">
            <div className="h-14 w-14 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Table Booked!</h2>
              <p className="mt-1 text-xs text-zinc-400">
                Your table at <strong className="text-zinc-700">{restaurantName}</strong> is
                reserved.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-150 bg-zinc-50/50 p-4 text-left space-y-2 text-xs">
              <div className="flex justify-between border-b border-zinc-150 pb-2">
                <span className="text-zinc-400 font-bold uppercase text-[9px]">Token</span>
                <span data-testid="booking-token" className="font-mono font-bold text-zinc-800">
                  #{booking.tokenNo}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400 font-bold uppercase text-[9px]">Table</span>
                <span data-testid="booking-table" className="font-semibold text-zinc-750">
                  {booking.tableName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400 font-bold uppercase text-[9px]">Booking date</span>
                <span data-testid="booking-date" className="font-semibold text-zinc-750">
                  {booking.date}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400 font-bold uppercase text-[9px]">Booking slot</span>
                <span data-testid="booking-slot" className="font-semibold text-zinc-750">
                  {booking.slotLabel}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400 font-bold uppercase text-[9px]">Party size</span>
                <span data-testid="booking-party-size" className="font-semibold text-zinc-750">
                  {booking.partySize}
                </span>
              </div>
            </div>

            <p className="text-[10px] text-zinc-400 px-6">
              A confirmation has been sent to your registered contact details. Please arrive 10
              minutes before your booking slot.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-3 sm:px-4 py-6 sm:py-8">
      <div className="w-full max-w-lg rounded-2xl sm:rounded-[1.75rem] border border-zinc-200/60 bg-white p-4 sm:p-6 md:p-8">
        <div className="text-center space-y-2">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-zinc-900">Book a Table</h1>
            <p className="text-[10px] sm:text-xs text-zinc-400">
              Table booking portal for <strong className="text-brand">{restaurantName}</strong>
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3 sm:space-y-4" noValidate>
          {/* Guest name */}
          <div className="space-y-1">
            <label
              htmlFor="resto-guest-name"
              className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1"
            >
              Guest name
            </label>
            <div className="relative">
              <User className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
              <input
                id="resto-guest-name"
                type="text"
                placeholder="Enter your name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className={inputClasses(false)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
            {/* Phone */}
            <div className="space-y-1">
              <label
                htmlFor="resto-phone"
                className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1"
              >
                Phone
              </label>
              <div className="relative">
                <Phone className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                <input
                  id="resto-phone"
                  type="text"
                  placeholder="+91 1234567890"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClasses(false)}
                  disabled={submitting}
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label
                htmlFor="resto-email"
                className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                <input
                  id="resto-email"
                  type="text"
                  placeholder="youremail@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClasses(false)}
                  disabled={submitting}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
            {/* Party size — Req 6.2 */}
            <div className="space-y-1">
              <label
                htmlFor="resto-party-size"
                className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1"
              >
                Party size
              </label>
              <div className="relative">
                <Users className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                <select
                  id="resto-party-size"
                  value={state.partySize === null ? "" : String(state.partySize)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    dispatch({ type: "setPartySize", partySize: raw === "" ? null : Number(raw) });
                    setErrors((prev) => ({ ...prev, partySize: "", slot: "" }));
                  }}
                  className={inputClasses(!!errors.partySize)}
                  disabled={submitting}
                >
                  <option value="">Select party size</option>
                  {partySizeOptions(maxPartySize).map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              {errors.partySize && (
                <p className="text-[9px] sm:text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                  {errors.partySize}
                </p>
              )}
            </div>

            {/* Booking date */}
            <div className="space-y-1">
              <label
                htmlFor="resto-date"
                className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1"
              >
                Booking date
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
                <input
                  id="resto-date"
                  type="date"
                  value={state.date}
                  onChange={(e) => {
                    dispatch({ type: "setDate", date: e.target.value });
                    setErrors((prev) => ({ ...prev, date: "", slot: "" }));
                  }}
                  className={inputClasses(!!errors.date)}
                  disabled={submitting}
                />
              </div>
              {errors.date && (
                <p className="text-[9px] sm:text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                  {errors.date}
                </p>
              )}
            </div>
          </div>

          {/* Booking slot */}
          <div className="space-y-1">
            <span className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1 flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-brand" /> Booking slot
            </span>

            {loading && (
              <div className="flex justify-center py-4" data-testid="availability-loading">
                <Loader2 className="h-4 w-4 animate-spin text-brand" />
              </div>
            )}

            {/* Req 6.14 — closed: the message, no slot, no layout. */}
            {!loading && availability?.closed && (
              <p
                data-testid="closed-message"
                className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center text-[10px] font-bold text-amber-700"
              >
                {MSG_CLOSED_ON_DATE}
              </p>
            )}

            {/* Req 5.9 */}
            {!loading && availability && !availability.closed && availability.outOfWindow && (
              <p
                data-testid="out-of-window-message"
                className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center text-[10px] font-bold text-amber-700"
              >
                {MSG_OUT_OF_WINDOW}
              </p>
            )}

            {/* Req 6.12 — guidance, not a dead end: the party is bookable by
                combining tables. */}
            {!loading && availability?.requiresMultipleTables && (
              <p
                data-testid="multiple-tables-message"
                className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center text-[10px] font-bold text-amber-700"
              >
                {MSG_MULTIPLE_TABLES_NEEDED}
              </p>
            )}

            {!loading && slots.length > 0 && (
              <div data-testid="slot-list" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {slots.map((slot) => {
                  const isSelected = state.selectedSlotStart === slot.startMinutes;
                  return (
                    <button
                      key={slot.startMinutes}
                      type="button"
                      data-testid={`slot-${slot.startMinutes}`}
                      data-slot-available-count={slot.availableCount}
                      aria-pressed={isSelected}
                      onClick={() => {
                        dispatch({ type: "selectSlot", startMinutes: slot.startMinutes });
                        setErrors((prev) => ({ ...prev, slot: "" }));
                      }}
                      className={`rounded-xl py-2 px-1.5 text-[10px] font-bold border transition-all cursor-pointer text-center ${
                        isSelected
                          ? "bg-black border-zinc-800 text-white"
                          : "bg-white border-zinc-200 text-zinc-650 hover:border-zinc-800/40"
                      }`}
                    >
                      <span className="block">{slot.label}</span>
                      {/* Req 6.10 — selectable, and it says why it is empty. */}
                      <span
                        className={`mt-0.5 block text-[9px] font-semibold ${isSelected ? "text-white/80" : "text-zinc-400"}`}
                      >
                        {slot.availableCount === 0
                          ? MSG_NO_TABLE_FREE
                          : `${slot.availableCount} free`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {!loading &&
              availability &&
              !availability.closed &&
              !availability.outOfWindow &&
              slots.length === 0 && (
                <p className="rounded-xl bg-zinc-50 border border-zinc-150 p-3 text-center text-[10px] font-bold text-zinc-400">
                  No slots available on this date.
                </p>
              )}

            {errors.slot && (
              <p className="text-[9px] sm:text-[10px] text-red-500 font-bold mt-0.5 pl-1">
                {errors.slot}
              </p>
            )}
          </div>

          {/* Table selection — Req 6.3, 6.5-6.9 */}
          {!loading && availability && !availability.closed && selectedSlot && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 pl-1">
                <span className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase flex items-center gap-1.5">
                  <Utensils className="h-3 w-3 text-brand" /> Table selection
                </span>
                <span
                  data-testid="table-selection-value"
                  className="text-[10px] font-bold text-zinc-600"
                >
                  {selectedTables.length > 0
                    ? selectedTables.map((t) => t.name).join(" + ")
                    : TABLE_SELECTION_ANY_LABEL}
                </span>
              </div>

              <TableLayoutView
                tables={layoutTables}
                stateOf={selectStateOf(availableTableIds, state.selection.selectedTableIds)}
                onActivate={(t) => dispatch({ type: "activateTable", table: t })}
                mode="select"
                message={layoutMessage}
              />

              {/* Tap to add or remove — several tables may be combined, and a
                  party may take more seats than it needs. */}
              {selectedTables.length > 0 && (
                <div className="flex items-center justify-between gap-2 pl-1">
                  <span
                    data-testid="table-selection-seats"
                    className="text-[9px] sm:text-[10px] font-bold text-zinc-500"
                  >
                    {selectedTables.length} {selectedTables.length === 1 ? "table" : "tables"} ·
                    seats {selectedSeats}
                  </span>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "clearTableSelection" })}
                    className="text-[10px] font-bold text-zinc-500 underline"
                  >
                    Use {TABLE_SELECTION_ANY_LABEL}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Special requests */}
          <div className="space-y-1">
            <label
              htmlFor="resto-special-requests"
              className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase pl-1"
            >
              Special requests
            </label>
            <div className="relative">
              <FileText className="absolute left-3 sm:left-3.5 top-2 sm:top-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-zinc-400" />
              <input
                id="resto-special-requests"
                type="text"
                placeholder="e.g. window seat, birthday cake, high chair"
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                className={inputClasses(false)}
                disabled={submitting}
              />
            </div>
          </div>

          {submitError && (
            <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
              <p
                data-testid="submit-error"
                className="text-[10px] font-bold text-red-650 flex items-center justify-center gap-1 leading-none"
              >
                <AlertCircle className="h-3.5 w-3.5 text-red-500" /> {submitError}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-zinc-950 hover:bg-zinc-850 py-2 sm:py-2.5 text-[11px] sm:text-xs font-semibold text-white transition-all active:scale-[0.99] flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:bg-zinc-150 disabled:text-zinc-400"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Book Table
          </button>
        </form>

        {/* Req 6.9-6.11 — the read-only guest menu; omitted when no available item. */}
        <PublicRestaurantMenu categories={menuCategories} />
      </div>
    </div>
  );
}
