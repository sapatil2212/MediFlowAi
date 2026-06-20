import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HeartPulse, Calendar, Clock, User, Mail, Phone, FileText, CheckCircle2, AlertCircle, Loader2, ChevronDown, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { getClinicInfoAndSlotsServerFn, createAppointmentPublicServerFn as createAppointmentServerFn } from "../lib/booking";

export const Route = createFileRoute("/book/$tenantId")({
  head: () => ({
    meta: [
      { title: "Book Appointment — MediFlow AI" },
      {
        name: "description",
        content: "Schedule your appointment online with our integrated patient portal.",
      },
    ],
  }),
  component: PatientBookingPage,
});function PatientBookingPage() {
  const { tenantId } = Route.useParams();
  
  // Clinic states
  const [clinicName, setClinicName] = useState("");
  const [fetchingClinic, setFetchingClinic] = useState(true);
  const [clinicError, setClinicError] = useState(false);

  // Lists from backend
  const [departments, setDepartments] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);

  // Selection states
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [appointmentType, setAppointmentType] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  // Custom Popover/Dropdown Open States
  const [deptOpen, setDeptOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);

  // Calendar month/year navigation states
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  // Success state
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [appointmentId, setAppointmentId] = useState("");

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
      data: { tenantId }
    })
      .then((res) => {
        setClinicName(res.clinicName);
        setDepartments(res.departments || []);
        setDoctors(res.doctors || []);
      })
      .catch((err) => {
        console.error("Failed to load clinic details:", err);
        setClinicError(true);
      })
      .finally(() => {
        setFetchingClinic(false);
      });
  }, [tenantId]);

  // Load slots dynamically
  useEffect(() => {
    if (!selectedDoctorId || !selectedDate || !tenantId) {
      setAvailableSlots([]);
      setSelectedSlot("");
      return;
    }

    setLoadingSlots(true);
    getClinicInfoAndSlotsServerFn({
      data: {
        tenantId,
        doctorId: selectedDoctorId,
        date: selectedDate
      }
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
  }, [selectedDoctorId, selectedDate, tenantId]);

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
    setValidationError("");
    setErrors({});

    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Patient Name is required";
    
    if (!email.trim()) {
      newErrors.email = "Email Address is required";
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = "Please enter a valid email address";
    }
    
    if (!phone.trim()) {
      newErrors.phone = "Phone Number is required";
    } else if (!/^\+?[\d\s-]{10,15}$/.test(phone)) {
      newErrors.phone = "Please enter a valid contact number (10-15 digits)";
    }
    
    if (!selectedDeptId) newErrors.department = "Department is required";
    if (!selectedDoctorId) newErrors.doctor = "Doctor is required";
    if (!selectedDate) newErrors.date = "Appointment Date is required";
    if (!selectedSlot) newErrors.timeSlot = "Appointment Time is required";
    if (!appointmentType) newErrors.appointmentType = "Appointment Type is required";
    if (!reason.trim()) newErrors.reason = "Reason for visit is required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      const result = await createAppointmentServerFn({
        data: {
          tenantId,
          name,
          email,
          phone,
          dateTime,
          reason,
          doctorId: selectedDoctorId,
          timeSlot: selectedSlot,
          whatsapp,
          appointmentType
        },
      });

      if (result.success) {
        setAppointmentId(result.appointmentId);
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
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
        <div className="relative flex items-center justify-center mb-4">
          <div className="absolute h-12 w-12 animate-ping rounded-full bg-brand/10" />
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-light shadow-sm">
            <HeartPulse className="h-4 w-4 text-white" />
          </div>
        </div>
        <p className="text-xs font-semibold text-zinc-500 animate-pulse">
          Loading clinic workspace details...
        </p>
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
            <h2 className="text-sm font-bold text-zinc-900">Clinic Portal Not Found</h2>
            <p className="mt-1 text-xs text-zinc-400">
              The booking link you followed seems to be invalid or the clinic does not exist. Please check the URL and try again.
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

  const selectedDoctor = doctors.find((d) => d.id === selectedDoctorId);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-8">
      <div className="w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-zinc-200/60 bg-white p-6 sm:p-8">
        
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
                <h2 className="text-lg font-bold text-zinc-900">Appointment Scheduled!</h2>
                <p className="mt-1 text-xs text-zinc-400">
                  Your appointment at <strong className="text-zinc-700">{clinicName}</strong> has been successfully booked.
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-150 bg-zinc-50/50 p-4 text-left space-y-2 text-xs">
                <div className="flex justify-between border-b border-zinc-150 pb-2">
                  <span className="text-zinc-400 font-bold uppercase text-[9px]">Confirmation Code</span>
                  <span className="font-mono font-bold text-zinc-800">{appointmentId.substring(0, 8).toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400 font-bold uppercase text-[9px]">Patient Name</span>
                  <span className="font-semibold text-zinc-750">{name}</span>
                </div>
                {selectedDoctor && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400 font-bold uppercase text-[9px]">Provider / Doctor</span>
                    <span className="font-semibold text-zinc-750">{selectedDoctor.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-zinc-400 font-bold uppercase text-[9px]">Scheduled Time</span>
                  <span className="font-semibold text-zinc-750">
                    {new Date(dateTime).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric"
                    })} at {selectedSlot}
                  </span>
                </div>
                {whatsapp && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400 font-bold uppercase text-[9px]">WhatsApp Number</span>
                    <span className="font-semibold text-zinc-750">{whatsapp}</span>
                  </div>
                )}
                {appointmentType && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400 font-bold uppercase text-[9px]">Appointment Type</span>
                    <span className="font-semibold text-zinc-750">{appointmentType}</span>
                  </div>
                )}
              </div>

              <p className="text-[10px] text-zinc-400 px-6">
                A confirmation has been sent to your registered contact details. Please arrive 15 minutes before your scheduled slot.
              </p>
            </motion.div>
          ) : (
            <motion.div key="form" className="space-y-6">
              {/* Header */}
              <div className="text-center space-y-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-light mx-auto">
                  <HeartPulse className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-zinc-900">Book an Appointment</h1>
                  <p className="text-xs text-zinc-400">
                    Scheduling online portal for <strong className="text-brand">{clinicName}</strong>
                  </p>
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleBookingSubmit} className="space-y-4" noValidate>
                
                {/* Patient Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Patient Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Enter your name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (errors.name) setErrors(prev => ({ ...prev, name: "" }));
                      }}
                      className={`w-full rounded-full border bg-white pl-10 pr-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all ${
                        errors.name ? "border-red-500" : "border-zinc-200"
                      }`}
                      disabled={loading}
                    />
                  </div>
                  {errors.name && (
                    <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">{errors.name}</p>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Email */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="youremail@gmail.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (errors.email) setErrors(prev => ({ ...prev, email: "" }));
                        }}
                        className={`w-full rounded-full border bg-white pl-10 pr-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all ${
                          errors.email ? "border-red-500" : "border-zinc-200"
                        }`}
                        disabled={loading}
                      />
                    </div>
                    {errors.email && (
                      <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">{errors.email}</p>
                    )}
                  </div>

                  {/* Phone */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Phone Number</label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="+91 1234567890"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          if (errors.phone) setErrors(prev => ({ ...prev, phone: "" }));
                        }}
                        className={`w-full rounded-full border bg-white pl-10 pr-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all ${
                          errors.phone ? "border-red-500" : "border-zinc-200"
                        }`}
                        disabled={loading}
                      />
                    </div>
                    {errors.phone && (
                      <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">{errors.phone}</p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {/* WhatsApp No (optional) */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1 flex items-center gap-1">
                      WhatsApp No <span className="text-[9px] text-zinc-300 font-normal lowercase">(optional)</span>
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="+91 1234567890"
                        value={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.value)}
                        className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  {/* Appointment Type Custom Dropdown */}
                  <div className="space-y-1 relative">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Appointment Type</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setTypeOpen(!typeOpen);
                          setDeptOpen(false);
                          setDocOpen(false);
                          setCalendarOpen(false);
                          setClockOpen(false);
                        }}
                        className={`w-full rounded-full border bg-white px-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center ${
                          errors.appointmentType ? "border-red-500" : "border-zinc-200"
                        }`}
                        disabled={loading}
                      >
                        <span className={appointmentType ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                          {appointmentType ? appointmentType : "Select Type"}
                        </span>
                        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${typeOpen ? "rotate-180" : ""}`} />
                      </button>

                      <AnimatePresence>
                        {typeOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-2xl shadow-xl p-1.5 space-y-0.5"
                          >
                            {["First Time", "Follow up"].map((type) => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => {
                                  setAppointmentType(type);
                                  setTypeOpen(false);
                                  if (errors.appointmentType) setErrors(prev => ({ ...prev, appointmentType: "" }));
                                }}
                                className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                  appointmentType === type ? "bg-brand/5 text-brand font-bold" : "text-zinc-700"
                                }`}
                              >
                                <span>{type}</span>
                                {appointmentType === type && <Check className="h-3.5 w-3.5 text-brand" />}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {errors.appointmentType && (
                      <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">{errors.appointmentType}</p>
                    )}
                  </div>
                </div>

                <hr className="border-zinc-100 my-2" />

                {/* Step 1: Select Department Custom Dropdown */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1 relative">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Select Department</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setDeptOpen(!deptOpen);
                          setDocOpen(false);
                          setTypeOpen(false);
                          setCalendarOpen(false);
                          setClockOpen(false);
                        }}
                        className={`w-full rounded-full border bg-white px-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center ${
                          errors.department ? "border-red-500" : "border-zinc-200"
                        }`}
                        disabled={loading}
                      >
                        <span className={selectedDeptId ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                          {selectedDeptId ? departments.find(d => d.id === selectedDeptId)?.name : "Select Department"}
                        </span>
                        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${deptOpen ? "rotate-180" : ""}`} />
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
                                  if (errors.department) setErrors(prev => ({ ...prev, department: "" }));
                                }}
                                className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                  selectedDeptId === dept.id ? "bg-brand/5 text-brand font-bold" : "text-zinc-700"
                                }`}
                              >
                                <span>{dept.name}</span>
                                {selectedDeptId === dept.id && <Check className="h-3.5 w-3.5 text-brand" />}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {errors.department && (
                      <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">{errors.department}</p>
                    )}
                  </div>

                  {/* Step 2: Select Doctor Custom Dropdown */}
                  <div className="space-y-1 relative">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Select Doctor</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setDocOpen(!docOpen);
                          setDeptOpen(false);
                          setTypeOpen(false);
                          setCalendarOpen(false);
                          setClockOpen(false);
                        }}
                        className={`w-full rounded-full border bg-white px-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center ${
                          errors.doctor ? "border-red-500" : "border-zinc-200"
                        }`}
                        disabled={loading}
                      >
                        <span className={selectedDoctorId ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                          {selectedDoctorId ? doctors.find(d => d.id === selectedDoctorId)?.name : "Select Doctor"}
                        </span>
                        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${docOpen ? "rotate-180" : ""}`} />
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
                                    if (errors.doctor) setErrors(prev => ({ ...prev, doctor: "" }));
                                  }}
                                  className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                    selectedDoctorId === doc.id ? "bg-brand/5 text-brand font-bold" : "text-zinc-700"
                                  }`}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-semibold">{doc.name}</span>
                                    <span className="text-[9px] text-zinc-400 font-normal">{doc.qualifications}</span>
                                  </div>
                                  {selectedDoctorId === doc.id && <Check className="h-3.5 w-3.5 text-brand" />}
                                </button>
                              ))
                            ) : (
                              <div className="px-3.5 py-3 text-xs text-zinc-450 italic text-center">
                                Please select a department first
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {errors.doctor && (
                      <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">{errors.doctor}</p>
                    )}
                  </div>
                </div>

                {selectedDoctor && (
                  <p className="text-[10px] text-zinc-455 italic pl-1 leading-normal">
                    Qualifications: <strong className="text-zinc-650">{selectedDoctor.qualifications}</strong>
                  </p>
                )}

                {/* Step 3: Custom Popover Calendar Date Picker */}
                <div className="space-y-1 relative">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Select Appointment Date</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedDoctorId) {
                          setErrors(prev => ({ ...prev, date: "Please select a doctor first" }));
                          return;
                        }
                        setCalendarOpen(!calendarOpen);
                        setDeptOpen(false);
                        setDocOpen(false);
                        setTypeOpen(false);
                        setClockOpen(false);
                      }}
                      className={`w-full rounded-full border bg-white pl-10 pr-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center ${
                        errors.date ? "border-red-500" : "border-zinc-200"
                      }`}
                      disabled={loading || !selectedDoctorId}
                    >
                      <Calendar className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                      <span className={selectedDate ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                        {selectedDate
                          ? new Date(selectedDate).toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              year: "numeric"
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
                              {new Date(calYear, calMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
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
                            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
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
                                    if (errors.date) setErrors(prev => ({ ...prev, date: "" }));
                                  }}
                                  disabled={past}
                                  className={`h-7 w-7 text-[10px] font-bold rounded-lg flex items-center justify-center transition-all ${
                                    isSelected
                                      ? "bg-brand text-white font-black"
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

                {/* Step 4: Custom Popover Time Slot Picker */}
                {selectedDoctorId && selectedDate && (
                  <div className="space-y-1 relative">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1 font-semibold flex items-center gap-1.5">
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
                        }}
                        className={`w-full rounded-full border bg-white pl-10 pr-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center ${
                          errors.timeSlot ? "border-red-500" : "border-zinc-200"
                        }`}
                        disabled={loading}
                      >
                        <Clock className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                        <span className={selectedSlot ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                          {selectedSlot ? selectedSlot : "Select Time Slot"}
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
                                        if (errors.timeSlot) setErrors(prev => ({ ...prev, timeSlot: "" }));
                                      }}
                                      className={`rounded-xl py-2 px-1 text-[10px] font-bold border transition-all cursor-pointer text-center ${
                                        isSelected
                                          ? "bg-brand border-brand text-white font-black scale-[1.02]"
                                          : "bg-white border-zinc-200 text-zinc-650 hover:border-brand/40"
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
                      <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">{errors.timeSlot}</p>
                    )}
                  </div>
                )}

                {/* Symptoms / Reason */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Reason for Visit / Chief Complaint</label>
                  <div className="relative">
                    <FileText className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Brief details of your symptoms"
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        if (errors.reason) setErrors(prev => ({ ...prev, reason: "" }));
                      }}
                      className={`w-full rounded-full border bg-white pl-10 pr-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all ${
                        errors.reason ? "border-red-500" : "border-zinc-200"
                      }`}
                      disabled={loading}
                    />
                  </div>
                  {errors.reason && (
                    <p className="text-[10px] text-red-500 font-bold mt-0.5 pl-1">{errors.reason}</p>
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
                  className="w-full rounded-full bg-zinc-950 hover:bg-zinc-850 py-2.5 text-xs font-semibold text-white transition-all active:scale-[0.99] flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:bg-zinc-150 disabled:text-zinc-400"
                >
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Schedule Appointment
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

