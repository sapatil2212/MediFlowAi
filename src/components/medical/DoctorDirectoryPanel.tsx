import React, { useState, useMemo } from "react";
import {
  Stethoscope,
  Plus,
  Search,
  Filter,
  Users,
  Clock,
  Calendar,
  AlertTriangle,
  ShieldAlert,
  Mail,
  Phone,
  Edit3,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Building2,
  Award,
  Sparkles,
  ChevronRight,
  MessageCircle,
  CalendarDays,
  RotateCcw,
  BarChart3,
} from "lucide-react";
import { DoctorEmergencyLeaveModal } from "./DoctorEmergencyLeaveModal";
import { DoctorCancelLeaveModal } from "./DoctorCancelLeaveModal";
import { DoctorSmartAnalysisModal } from "./DoctorSmartAnalysisModal";

export interface DoctorDirectoryPanelProps {
  doctors: any[];
  departments: any[];
  appointments: any[];
  loadingDocs: boolean;
  onRefreshDoctors: () => void;
  onSaveDoctor: (e: React.FormEvent) => void;
  onDeleteDoctor: (id: string) => void;
  // Doctor form states & handlers passed from parent or controlled internally
  isEditingDoc: boolean;
  setIsEditingDoc: (v: boolean) => void;
  editingDoc: any | null;
  setEditingDoc: (d: any | null) => void;
  docName: string;
  setDocName: (v: string) => void;
  docEmail: string;
  setDocEmail: (v: string) => void;
  docPhone: string;
  setDocPhone: (v: string) => void;
  docQualifications: string;
  setDocQualifications: (v: string) => void;
  docDeptId: string;
  setDocDeptId: (v: string) => void;
  savingDoc: boolean;
  docError: string;
  setDocError: (v: string) => void;
  docSuccess: string;
  setDocSuccess: (v: string) => void;
  onOpenAddDoctor: () => void;
  onOpenEditDoctor: (doc: any) => void;
  onEditDoctorSchedule: (doc: any) => void;
  onEditDoctorLeaves: (doc: any) => void;
  onUpgradePlan?: () => void;
  /** May add / edit / delete doctor profiles (owner & branch). Defaults to true. */
  canManageDoctors?: boolean;
  /** May message patients over WhatsApp. When false, absence notices are skipped. */
  canSendWhatsApp?: boolean;
  clinicName?: string;
  waStatus?: string;
  waConnectedNumber?: string;
}

export function DoctorDirectoryPanel({
  doctors,
  departments,
  appointments,
  loadingDocs,
  onRefreshDoctors,
  onSaveDoctor,
  onDeleteDoctor,
  isEditingDoc,
  setIsEditingDoc,
  editingDoc,
  setEditingDoc,
  docName,
  setDocName,
  docEmail,
  setDocEmail,
  docPhone,
  setDocPhone,
  docQualifications,
  setDocQualifications,
  docDeptId,
  setDocDeptId,
  savingDoc,
  docError,
  setDocError,
  docSuccess,
  setDocSuccess,
  onOpenAddDoctor,
  onOpenEditDoctor,
  onEditDoctorSchedule,
  onEditDoctorLeaves,
  onUpgradePlan,
  canManageDoctors = true,
  canSendWhatsApp = true,
  clinicName = "HealthSync Clinic",
  waStatus = "DISCONNECTED",
  waConnectedNumber = "",
}: DoctorDirectoryPanelProps) {
  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDeptFilter, setSelectedDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "leave">("all");

  // Emergency Leave, Cancel Leave & Smart Analysis Modal state
  const [emergencyModalDoctor, setEmergencyModalDoctor] = useState<any | null>(null);
  const [cancelLeaveModalDoctor, setCancelLeaveModalDoctor] = useState<any | null>(null);
  const [analysisModalDoctor, setAnalysisModalDoctor] = useState<any | null>(null);
  const [toastMessage, setToastMessage] = useState<string>("");

  // Local date — toISOString() is UTC and reported yesterday until 05:30 IST.
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Compute metrics
  const stats = useMemo(() => {
    const total = doctors.length;
    // Count appointments for today across all doctors
    const todayAppts = appointments.filter((a) => {
      if (!a.dateTime) return false;
      const d = a.dateTime instanceof Date ? a.dateTime : new Date(a.dateTime);
      if (Number.isNaN(d.getTime())) return false;
      const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return dStr === todayStr;
    }).length;

    return {
      totalDoctors: total,
      totalDepartments: departments.length,
      todayAppointments: todayAppts,
    };
  }, [doctors, departments, appointments, todayStr]);

  // Filtered doctors list
  const filteredDoctors = useMemo(() => {
    return doctors.filter((doc) => {
      const matchSearch =
        !searchQuery ||
        doc.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.qualifications?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.departmentName?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchDept = selectedDeptFilter === "all" || doc.departmentId === selectedDeptFilter;

      return matchSearch && matchDept;
    });
  }, [doctors, searchQuery, selectedDeptFilter]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 rounded-2xl bg-zinc-950 text-white px-5 py-3 shadow-2xl text-xs font-bold flex items-center gap-2.5 animate-in slide-in-from-top-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
                Doctor &amp; Specialist Directory
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Manage practitioner profiles, clinical availability schedules, and emergency leave
                broadcasts
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isEditingDoc && canManageDoctors && (
            <button
              onClick={onOpenAddDoctor}
              className="rounded-lg bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 px-4 py-2 text-xs font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Register New Doctor</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
              Total Doctors
            </p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
              {stats.totalDoctors}
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Verified clinicians</p>
          </div>
          <div className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
            <Users className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
              Departments Active
            </p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
              {stats.totalDepartments}
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Clinical specializations</p>
          </div>
          <div className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
            <Building2 className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-zinc-400" />
              <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                Emergency Absence System
              </p>
            </div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-1">
              AI WhatsApp Patient Notice
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Instant multi-date block &amp; notify
            </p>
          </div>
          <div className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
            <CalendarDays className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Conditional: Doctor Register / Edit Form */}
      {isEditingDoc ? (
        <form
          onSubmit={onSaveDoctor}
          className="space-y-4 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-850/60 rounded-3xl p-6 shadow-xs animate-in fade-in duration-200"
        >
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700/60 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-7 w-7 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center text-xs font-bold">
                <Stethoscope className="h-3.5 w-3.5" />
              </span>
              <h4 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 uppercase tracking-tight">
                {editingDoc ? "Edit Practitioner Profile" : "Register New Practitioner"}
              </h4>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsEditingDoc(false);
                setEditingDoc(null);
                setDocName("");
                setDocEmail("");
                setDocPhone("");
                setDocQualifications("");
                setDocDeptId("");
                setDocError("");
                setDocSuccess("");
              }}
              className="text-xs font-bold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
            >
              Cancel &amp; Back to Directory
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">
                Doctor Full Name *
              </span>
              <input
                type="text"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="Dr. Vikram Rao"
                required
                className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-semibold focus:border-brand focus:outline-none transition-colors"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">
                Department Assignment *
              </span>
              <select
                value={docDeptId}
                onChange={(e) => setDocDeptId(e.target.value)}
                required
                className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-semibold focus:border-brand focus:outline-none transition-colors cursor-pointer"
              >
                <option value="">Select Department</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">
                Work Email Address *
              </span>
              <input
                type="email"
                value={docEmail}
                onChange={(e) => setDocEmail(e.target.value)}
                placeholder="dr.vikram@healthsync.com"
                required
                className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-semibold focus:border-brand focus:outline-none transition-colors"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">
                Mobile / WhatsApp Phone Number *
              </span>
              <input
                type="text"
                value={docPhone}
                onChange={(e) => setDocPhone(e.target.value)}
                placeholder="+91 98765 43210"
                required
                className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-semibold focus:border-brand focus:outline-none transition-colors"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider pl-1">
              Qualifications &amp; Specialty Credentials *
            </span>
            <input
              type="text"
              value={docQualifications}
              onChange={(e) => setDocQualifications(e.target.value)}
              placeholder="e.g. MBBS, MD (Cardiology), FACC - Interventional Cardiologist"
              required
              className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-semibold focus:border-brand focus:outline-none transition-colors"
            />
          </label>

          {docSuccess && (
            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 text-center">
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> {docSuccess}
              </p>
            </div>
          )}

          {docError && (
            <div className="rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-xs font-bold">
                <AlertCircle className="h-4 w-4" />
                <span>Notice</span>
              </div>
              <p className="text-xs text-red-600 dark:text-red-300 font-medium leading-relaxed">
                {docError}
              </p>
              {docError.toLowerCase().includes("upgrade") && onUpgradePlan && (
                <button
                  type="button"
                  onClick={onUpgradePlan}
                  className="rounded-full bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 text-xs font-bold transition-all shadow-xs cursor-pointer"
                >
                  Upgrade Subscription Plan
                </button>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2.5 border-t border-zinc-200 dark:border-zinc-800 pt-4">
            <button
              type="button"
              onClick={() => {
                setIsEditingDoc(false);
                setEditingDoc(null);
              }}
              className="rounded-full border border-zinc-300 dark:border-zinc-700 px-5 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingDoc}
              className="rounded-full bg-zinc-950 hover:bg-zinc-850 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 px-6 py-2 text-xs font-extrabold shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {savingDoc && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{editingDoc ? "Update Practitioner Profile" : "Register Doctor"}</span>
            </button>
          </div>
        </form>
      ) : (
        /* Doctors Directory List & Controls */
        <div className="space-y-4">
          {/* Search & Department Filters */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search doctors by name, specialty, phone..."
                className="w-full rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-10 pr-4 py-2 text-xs text-zinc-800 dark:text-zinc-200 font-medium focus:border-brand focus:outline-none transition-colors shadow-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={selectedDeptFilter}
                  onChange={(e) => setSelectedDeptFilter(e.target.value)}
                  className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:outline-none cursor-pointer shadow-xs"
                >
                  <option value="all">All Departments ({doctors.length})</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Directory Cards Grid */}
          {loadingDocs ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-brand" />
              <p className="text-xs font-bold text-zinc-400">Loading Doctor Directory...</p>
            </div>
          ) : filteredDoctors.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredDoctors.map((doc) => {
                const initials = (doc.name || "Dr")
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((n: string) => n[0])
                  .join("")
                  .toUpperCase();

                return (
                  <div
                    key={doc.id}
                    className="group rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-md transition-all duration-200"
                  >
                    {/* Row 1: Doctor Identity + Quick Actions */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand/10 to-indigo-500/10 dark:from-brand/20 dark:to-indigo-500/20 text-brand font-black text-xs flex items-center justify-center border border-brand/20 shrink-0 shadow-xs">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 leading-tight group-hover:text-brand transition-colors truncate">
                            {doc.name}
                          </h4>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] font-bold text-brand bg-brand/8 border border-brand/15 rounded-full px-2 py-0.5">
                              {doc.departmentName || "General Staff"}
                            </span>
                            <span className="text-[10px] font-semibold text-zinc-400">
                              ID: #{doc.id.slice(0, 6)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Quick actions — profile changes are owner/branch only */}
                      {canManageDoctors && (
                        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={() => onOpenEditDoctor(doc)}
                            className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                            title="Edit Doctor Details"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              // Deletes the profile with its schedule and leaves;
                              // one mis-click used to do that with no prompt.
                              if (
                                window.confirm(
                                  `Delete ${doc.name}? Their weekly schedule and leaves will be removed too. This cannot be undone.`,
                                )
                              ) {
                                onDeleteDoctor(doc.id);
                              }
                            }}
                            className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-950/40 text-zinc-400 hover:text-red-500 transition-colors cursor-pointer"
                            title="Delete Doctor"
                            aria-label={`Delete ${doc.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Row 2: Qualifications & Contact — side by side, equal size, no background */}
                    <div className="grid grid-cols-2 gap-4 mt-3 text-xs">
                      <div className="min-w-0">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                          Qualifications &amp; Practice
                        </span>
                        <p className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                          {doc.qualifications}
                        </p>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-medium truncate">
                          <Mail className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                          <span className="truncate">{doc.email}</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-medium truncate">
                          <Phone className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          <span className="truncate">{doc.phone}</span>
                        </span>
                      </div>
                    </div>

                    {/* Row 3: Action Buttons — 2×2 grid */}
                    <div className="space-y-2 pt-3 mt-3 border-t border-zinc-150 dark:border-zinc-800">
                      <div className="grid grid-cols-2 gap-2">
                        {/* Urgent Absence */}
                        <button
                          type="button"
                          onClick={() => setEmergencyModalDoctor(doc)}
                          className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white py-1.5 px-2.5 text-xs font-medium transition-colors flex items-center justify-center cursor-pointer group/btn"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <CalendarDays className="h-3.5 w-3.5 text-white shrink-0" />
                            <span className="truncate">Urgent Absence</span>
                          </div>
                        </button>

                        {/* Cancel Leave */}
                        <button
                          type="button"
                          onClick={() => setCancelLeaveModalDoctor(doc)}
                          className="rounded-lg border border-zinc-200 dark:border-zinc-750 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-750 text-zinc-800 dark:text-zinc-200 py-1.5 px-2.5 text-xs font-medium transition-colors flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <RotateCcw className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                            <span className="truncate">Cancel Leave</span>
                          </div>
                          <span className="text-[9px] text-zinc-400 shrink-0 ml-1">Reinstate</span>
                        </button>

                        {/* Weekly Hours */}
                        <button
                          type="button"
                          onClick={() => onEditDoctorSchedule(doc)}
                          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-750 text-zinc-700 dark:text-zinc-300 py-1.5 px-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Clock className="h-3.5 w-3.5 text-zinc-400" />
                          <span>Weekly Hours</span>
                        </button>

                        {/* Leaves */}
                        <button
                          type="button"
                          onClick={() => onEditDoctorLeaves(doc)}
                          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-750 text-zinc-700 dark:text-zinc-300 py-1.5 px-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                          <span>Leaves</span>
                        </button>
                      </div>

                      {/* Clinical Audit — full width below */}
                      <button
                        type="button"
                        onClick={() => setAnalysisModalDoctor(doc)}
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/70 hover:bg-zinc-100 dark:bg-zinc-800/80 dark:hover:bg-zinc-750 text-zinc-800 dark:text-zinc-200 py-1.5 px-3 text-xs font-medium transition-colors flex items-center justify-between cursor-pointer group/audit"
                      >
                        <div className="flex items-center gap-1.5">
                          <BarChart3 className="h-3.5 w-3.5 text-zinc-500 group-hover/audit:text-zinc-800 dark:group-hover/audit:text-zinc-200 transition-colors" />
                          <span>Smart Analysis & Audit Report</span>
                        </div>
                        <ChevronRight className="h-3 w-3 text-zinc-400 group-hover/audit:text-zinc-700 dark:group-hover/audit:text-zinc-200 transition-colors" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800 p-12 text-center text-zinc-400 space-y-3">
              <Stethoscope className="h-8 w-8 mx-auto text-zinc-300 dark:text-zinc-700" />
              <div>
                <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                  {searchQuery || selectedDeptFilter !== "all"
                    ? "No doctors matched your search filters."
                    : "No doctors registered in directory yet."}
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Add a practitioner profile to start configuring schedules and emergency absence
                  broadcasts.
                </p>
              </div>
              {canManageDoctors && (
                <button
                  type="button"
                  onClick={onOpenAddDoctor}
                  className="rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-5 py-2 text-xs font-bold cursor-pointer transition-transform active:scale-95"
                >
                  + Register First Doctor
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Emergency Leave Modal */}
      {emergencyModalDoctor && (
        <DoctorEmergencyLeaveModal
          isOpen={!!emergencyModalDoctor}
          onClose={() => setEmergencyModalDoctor(null)}
          doctor={emergencyModalDoctor}
          clinicName={clinicName}
          waStatus={waStatus}
          waConnectedNumber={waConnectedNumber}
          onSuccess={(res) => {
            showToast(
              res.whatsappSkippedForRole || !canSendWhatsApp
                ? `Emergency leave declared for ${res.leavesCreated} date(s). WhatsApp notices were not sent — ask the owner or a doctor to notify patients.`
                : `Emergency leave declared for ${res.leavesCreated} date(s). ${res.notifiedPatientsCount} WhatsApp alert(s) dispatched!`,
            );
            onRefreshDoctors();
          }}
        />
      )}

      {/* Cancel Leave & Reinstate Appointments Modal */}
      {cancelLeaveModalDoctor && (
        <DoctorCancelLeaveModal
          isOpen={!!cancelLeaveModalDoctor}
          onClose={() => setCancelLeaveModalDoctor(null)}
          doctor={cancelLeaveModalDoctor}
          clinicName={clinicName}
          waStatus={waStatus}
          waConnectedNumber={waConnectedNumber}
          onSuccess={(res) => {
            showToast(
              `Leave cancelled for ${res.leavesCancelledCount} date(s). ${res.reinstatedAppointmentsCount} appointment(s) successfully reinstated!` +
                (res.whatsappSkippedForRole || !canSendWhatsApp
                  ? " WhatsApp notices were not sent."
                  : ""),
            );
            onRefreshDoctors();
          }}
        />
      )}

      {/* Clinical Performance & Audit Report Modal */}
      {analysisModalDoctor && (
        <DoctorSmartAnalysisModal
          isOpen={!!analysisModalDoctor}
          onClose={() => setAnalysisModalDoctor(null)}
          doctor={analysisModalDoctor}
          clinicName={clinicName}
        />
      )}
    </div>
  );
}

export default DoctorDirectoryPanel;
