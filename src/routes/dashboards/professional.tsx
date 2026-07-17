import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import bmtLogo from "../../assets/bmt-logo.png";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  HeartPulse,
  LayoutDashboard,
  Mic,
  MicOff,
  Users,
  TrendingUp,
  Settings,
  LogOut,
  Calendar,
  Clock,
  ChevronRight,
  ClipboardList,
  Search,
  CheckCircle2,
  AlertCircle,
  Plus,
  Loader2,
  FileText,
  User,
  ShieldAlert,
  Save,
  Check,
  Send,
  Building2,
  Stethoscope,
  Info,
  Play,
  Pause,
  Lock,
  Mail,
  Phone,
  Copy,
  ExternalLink,
  QrCode,
  Wifi,
  WifiOff,
  RefreshCw,
  Smartphone,
  MapPin,
  Trash2,
  Edit3,
  Download,
  Filter,
  ChevronLeft,
  X,
  Menu,
  BarChart3,
  Activity,
  UserPlus,
  ClipboardCheck,
  CheckCheck,
  XCircle,
  CreditCard,
  Briefcase,
  CalendarDays,
  Sunrise,
  RotateCcw,
  Coffee,
  MinusCircle,
  Eye,
  Power,
  Printer,
  ChevronDown,
  Bell,
  Sparkles,
  FileDown,
  Camera,
  Upload,
  MessageCircle,
  FileSpreadsheet
} from "lucide-react";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from "recharts";
import {
  getCurrentUserServerFn,
  logoutServerFn,
  getClinicProfileServerFn,
  updateProfileServerFn,
  updatePasswordServerFn,
  sendEmailChangeOtpServerFn,
  updateEmailServerFn,
  getAppointmentsServerFn,
  createAppointmentServerFn,
  updateAppointmentServerFn,
  getClinicHoursServerFn,
  saveClinicHoursServerFn,
  getDepartmentsServerFn,
  createDepartmentServerFn,
  deleteDepartmentServerFn,
  getDoctorsServerFn,
  saveDoctorServerFn,
  deleteDoctorServerFn,
  getDoctorScheduleServerFn,
  saveDoctorScheduleServerFn,
  getDoctorLeavesServerFn,
  addDoctorLeaveServerFn,
  deleteDoctorLeaveServerFn,
  getWhatsAppStatusServerFn,
  disconnectWhatsAppServerFn,
  sendTestWaServerFn,
  getWhatsAppConfigServerFn,
  saveWhatsAppConfigServerFn,
  getClinicInfoAndSlotsServerFn,
  // NEW production server functions
  getDashboardStatsServerFn,
  getAnalyticsServerFn,
  getPatientsServerFn,
  createPatientServerFn,
  updatePatientServerFn,
  deletePatientServerFn,
  getPatientChartServerFn,
  checkPatientDuplicateServerFn,
  saveSoapNoteServerFn,
  deleteAppointmentServerFn,
  getAppointmentsPagedServerFn,
  getSubUsersServerFn,
  createSubUserServerFn,
  updateSubUserServerFn,
  deleteSubUserServerFn,
  generateSoapNoteServerFn,
  generatePrescriptionServerFn,
  savePrescriptionServerFn,
  aiAssistConsultationServerFn,
  voiceRxAnalyzeServerFn,
  uploadProfilePhotoServerFn,
} from "../../lib/auth";
import WhatsAppHub from "../../components/WhatsAppHub";
import MultiLocationSettings from "../../components/settings/MultiLocationSettings";
import { resolveFeatureAccess, type FeatureId } from "../../lib/feature-access";


export const Route = createFileRoute("/dashboards/professional")({
  head: () => ({
    meta: [
      { title: "Firm Dashboard — BookMyTime" },
      {
        name: "description",
        content: "Secure clinical EHR dashboard and AI scribe workspace.",
      },
    ],
  }),
  component: DashboardPage,
});

// ==========================================
// Mock Database & Constants
// ==========================================

interface Patient {
  id: string;
  name: string;
  age: number;
  gender: string;
  dob: string;
  phone: string;
  insurance: string;
  lastVisit: string;
  reason: string;
  status: "Completed" | "In Progress" | "Pending Review";
  notesHistory: Array<{
    date: string;
    specialty: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  }>;
}

const mockPatients: Patient[] = [
  {
    id: "P-101",
    name: "Eleanor Vance",
    age: 54,
    gender: "Female",
    dob: "1972-04-12",
    phone: "(555) 234-5678",
    insurance: "Blue Cross Blue Shield",
    lastVisit: "2026-06-12",
    reason: "Persistent productive cough and fatigue",
    status: "Completed",
    notesHistory: [
      {
        date: "2026-06-12",
        specialty: "Family Medicine",
        subjective: "54-year-old female presents with persistent cough for 10 days, worsening at night. Reports mild subjective fever, no chills. Denies shortness of breath.",
        objective: "Vitals: Temp 98.9F, BP 128/82, HR 76, SpO2 98% on room air. HEENT: Mild pharyngeal erythema. Lungs: Clear to auscultation bilaterally, no wheezes or crackles.",
        assessment: "Acute bronchitis, suspected viral.",
        plan: "1. Supportive care: hydration, rest.\n2. Benzonatate 100mg TID PRN for cough.\n3. Return to clinic if symptoms worsen or SpO2 drops."
      }
    ]
  },
  {
    id: "P-102",
    name: "Arthur Pendelton",
    age: 67,
    gender: "Male",
    dob: "1959-09-21",
    phone: "(555) 876-5432",
    insurance: "Medicare Part B",
    lastVisit: "2026-06-18",
    reason: "Angina follow-up and blood pressure monitoring",
    status: "In Progress",
    notesHistory: [
      {
        date: "2026-03-10",
        specialty: "Cardiology",
        subjective: "Routine follow-up of HTN and stable angina. Reports stable exercise tolerance, no chest pain on exertion. No orthopnea.",
        objective: "BP 132/78, HR 64 (regular). CVS: S1 S2 normal, no murmurs. JVP: Not elevated. Ext: No pedal edema.",
        assessment: "1. Essential hypertension - well controlled.\n2. Chronic stable angina - stable.",
        plan: "1. Continue Lisinopril 20mg daily.\n2. Continue Metoprolol Succinate 50mg daily.\n3. Schedule stress echo in 6 months."
      }
    ]
  },
  {
    id: "P-103",
    name: "Maya Lin",
    age: 4,
    gender: "Female",
    dob: "2022-02-14",
    phone: "(555) 901-2345",
    insurance: "UnitedHealthcare",
    lastVisit: "2026-06-17",
    reason: "Fever and bilateral ear scratching",
    status: "Pending Review",
    notesHistory: []
  },
  {
    id: "P-104",
    name: "David Kross",
    age: 29,
    gender: "Male",
    dob: "1997-11-05",
    phone: "(555) 345-6789",
    insurance: "Aetna PPO",
    lastVisit: "2026-06-15",
    reason: "Generalized anxiety and early insomnia",
    status: "Completed",
    notesHistory: [
      {
        date: "2026-06-15",
        specialty: "Psychiatry",
        subjective: "29-year-old male reports increased anxiety and difficulty concentrating over the last 3 weeks due to work stress. Reports early insomnia, poor appetite.",
        objective: "Mental Status Exam: Cooperative, anxious affect, congruent mood. Speech: Normal rate. Thought process: Linear.",
        assessment: "Generalized Anxiety Disorder (GAD) - acute exacerbation.",
        plan: "1. Start Escitalopram 10mg daily.\n2. Referral to Cognitive Behavioral Therapy (CBT).\n3. Follow-up in 2 weeks to monitor tolerability."
      }
    ]
  }
];

const soapTemplates = {
  "Family Medicine": {
    subjective: "54-year-old patient presents with persistent productive cough for 10 days, worsening at night. Reports mild subjective fever, body aches, and fatigue. Denies shortness of breath, chest pain, or changes in taste/smell.",
    objective: "Vitals: Temp 98.9F, BP 128/82, HR 76, RR 16, SpO2 98% on room air.\nHEENT: Normocephalic, mild pharyngeal injection, no tonsillar exudates.\nLungs: Clear to auscultation bilaterally, good air entry. No wheezing, rhonchi, or crackles.",
    assessment: "Acute bronchitis, suspected viral etiology.",
    plan: "1. Supportive care: rest, warm fluids, saline gargles.\n2. Benzonatate 100mg PO TID PRN for severe dry cough.\n3. Albuterol HFA inhaler 2 puffs Q4-6H PRN for chest tightness.\n4. Return immediately for dyspnea, high fever, or symptoms persisting > 14 days."
  },
  "Cardiology": {
    subjective: "67-year-old patient presents for routine follow-up of essential hypertension and stable coronary artery disease. Reports stable exercise tolerance (can walk 3 blocks without angina). Denies chest pressure, orthopnea, or paroxysmal nocturnal dyspnea.",
    objective: "Vitals: Temp 97.8F, BP 132/78, HR 64 (regular rhythm), RR 14, SpO2 99%.\nCVS: Normal S1, S2. No S3, S4, or cardiac murmurs. Radial pulses 2+ symmetric.\nJVP: ~6 cm H2O. Ext: Warm, no bilateral pretibial pitting edema.",
    assessment: "1. Essential hypertension - stable and controlled.\n2. Coronary artery disease / Chronic stable angina - asymptomatic on current regimen.",
    plan: "1. Continue Lisinopril 20mg PO daily.\n2. Continue Metoprolol Succinate 50mg PO daily.\n3. Continue Aspirin 81mg PO daily.\n4. Schedule routine stress echocardiogram in 6 months.\n5. Baseline lipid panel and CMP in 2 weeks."
  },
  "Pediatrics": {
    subjective: "4-year-old pediatric patient brought in by mother for 3-day history of bilateral ear pain, congestion, and low-grade fever (peak 100.4F). Mother reports child is irritable, pulling at the right ear, and sleeping poorly. Appetite slightly decreased, hydrating well.",
    objective: "Vitals: Temp 99.8F (tympanic), HR 110, RR 22, Wt: 16.5 kg.\nHEENT: Right tympanic membrane erythematous, bulging, with loss of light reflex and bony landmarks. Left TM slightly pink but non-bulging. Purulent nasal discharge noted.\nLungs: Clear, symmetric expansion, no retractions.",
    assessment: "Acute Otitis Media (AOM) - right ear.",
    plan: "1. Start Amoxicillin suspension 90 mg/kg/day split BID (7.4 mL BID) for 10 days.\n2. Ibuprofen 100mg/5ml suspension (8 ml) Q6H PRN for pain or fever > 101F.\n3. Follow up in 10-14 days for repeat otoscopy check.\n4. Educate mother to return immediately if child exhibits neck stiffness, lethargy, or persistent vomiting."
  },
  "Psychiatry": {
    subjective: "29-year-old patient reports increased global anxiety, muscle tension, and difficulty concentrating over the last 3 weeks due to project deadlines at work. Reports early-onset insomnia (takes 2 hours to fall asleep) and mild appetite loss. Denies suicidal ideation, panic attacks, or manic symptoms.",
    objective: "Mental Status Exam:\nAppearance: Well-groomed, cooperative, constant fidgeting of hands.\nMood: Anxious, overwhelmed. Affect: Congruent, restricted.\nSpeech: Normal rate and volume, slightly pressured.\nThought Process: Goal-directed, linear. Thought Content: No delusions or hallucinations.\nCognition: Intact orientation, memory, and concentration.",
    assessment: "Generalized Anxiety Disorder (GAD) - acute exacerbation due to psychosocial stressors.",
    plan: "1. Initiate Escitalopram (Lexapro) 10mg PO daily for anxiety/insomnia.\n2. Provide prescription for Hydroxyzine pamoate 25mg PO Q6H PRN for acute panic/severe anxiety episodes (Max 3/day).\n3. Referral to outpatient Cognitive Behavioral Therapy (CBT) weekly.\n4. Follow-up in 2 weeks to monitor compliance, side effects, and therapeutic response."
  }
};

// ==========================================
// DayScheduleCard — Per-day schedule row with multi-break support + copy-to-days
// ==========================================

type BreakSlot = { start: string; end: string; label: string };

function DayScheduleCard({
  dayName, idx, sched, breaks, slots, allSchedules,
  onUpdateField, onAddBreak, onUpdateBreak, onRemoveBreak, onCopyBreaks,
}: {
  dayName: string; idx: number; sched: any;
  breaks: BreakSlot[]; slots: number; allSchedules: any[];
  onUpdateField: (day: number, field: string, value: any) => void;
  onAddBreak: (day: number, br: BreakSlot) => void;
  onUpdateBreak: (day: number, bIdx: number, field: "start"|"end"|"label", value: string) => void;
  onRemoveBreak: (day: number, bIdx: number) => void;
  onCopyBreaks: (fromDay: number, toDays: number[]) => void;
}) {
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);
  const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const totalBreakMins = breaks.reduce((acc, b) => {
    if (!b.start || !b.end) return acc;
    const [bsh, bsm] = b.start.split(":").map(Number);
    const [beh, bem] = b.end.split(":").map(Number);
    const bm = (beh * 60 + bem) - (bsh * 60 + bsm);
    return acc + (bm > 0 ? bm : 0);
  }, 0);

  return (
    <div className="rounded-xl border border-brand/15 bg-brand/[0.025] animate-in fade-in duration-200 overflow-hidden">
      {/* Row 1: Day label + working hours + slot picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2 min-w-[80px]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-[9px] font-black">
            {dayName.slice(0,2)}
          </span>
          <span className="text-xs font-bold text-zinc-700">{dayName}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Working hours */}
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-zinc-400 shrink-0" />
            <input type="time" value={sched.startTime}
              onChange={e => onUpdateField(idx, "startTime", e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none focus:border-brand" />
            <span className="text-zinc-400 text-[10px] font-bold">→</span>
            <input type="time" value={sched.endTime}
              onChange={e => onUpdateField(idx, "endTime", e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none focus:border-brand" />
          </div>
          {/* Slot duration */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-400 font-semibold">Slot</span>
            <select value={sched.slotDuration}
              onChange={e => onUpdateField(idx, "slotDuration", parseInt(e.target.value))}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none focus:border-brand">
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
            </select>
          </div>
          {/* Slot count */}
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-[9px] font-bold text-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> {slots} slots
          </span>
          {/* Total break summary */}
          {totalBreakMins > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-600">
              <Coffee className="h-2.5 w-2.5" /> {totalBreakMins}min break
            </span>
          )}
          {/* Add Break button */}
          <button type="button"
            onClick={() => onAddBreak(idx, { start: "13:00", end: "14:00", label: "Lunch" })}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white hover:bg-amber-50 hover:border-amber-200 hover:text-amber-600 px-2.5 py-1 text-[9px] font-bold text-zinc-400 transition-all cursor-pointer">
            <Coffee className="h-3 w-3" /> <Plus className="h-2.5 w-2.5" /> Add Break
          </button>
        </div>
      </div>

      {/* Break rows */}
      {breaks.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50/40 divide-y divide-amber-100/70">
          {breaks.map((br, bIdx) => {
            const [bsh, bsm] = (br.start || "00:00").split(":").map(Number);
            const [beh, bem] = (br.end   || "00:00").split(":").map(Number);
            const bMins = (beh * 60 + bem) - (bsh * 60 + bsm);
            return (
              <div key={bIdx} className="flex flex-wrap items-center gap-2 px-3 py-2 animate-in fade-in duration-150">
                {/* Break number badge */}
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-200 text-[8px] font-black text-amber-800 shrink-0">
                  {bIdx + 1}
                </span>
                {/* Label input */}
                <input type="text" value={br.label}
                  placeholder="Break name (e.g. Lunch)"
                  onChange={e => onUpdateBreak(idx, bIdx, "label", e.target.value)}
                  className="w-28 rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-semibold focus:outline-none focus:border-amber-400 text-zinc-700" />
                <Coffee className="h-3 w-3 text-amber-400 shrink-0" />
                {/* Start time */}
                <input type="time" value={br.start}
                  onChange={e => onUpdateBreak(idx, bIdx, "start", e.target.value)}
                  className="rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none focus:border-amber-400" />
                <span className="text-amber-400 text-[10px] font-bold">→</span>
                {/* End time */}
                <input type="time" value={br.end}
                  onChange={e => onUpdateBreak(idx, bIdx, "end", e.target.value)}
                  className="rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none focus:border-amber-400" />
                {/* Duration badge */}
                {bMins > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[9px] font-bold text-amber-700">
                    <MinusCircle className="h-2.5 w-2.5" /> {bMins} min
                  </span>
                )}
                {/* Add same break to other days */}
                <div className="relative ml-auto">
                  <button type="button"
                    onClick={() => { setShowCopyMenu(v => !v); setCopyTargets([]); }}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white hover:bg-brand/5 hover:border-brand/30 hover:text-brand px-2 py-0.5 text-[9px] font-bold text-zinc-400 transition-all cursor-pointer">
                    <Copy className="h-2.5 w-2.5" /> Copy to days
                  </button>
                  {showCopyMenu && (
                    <div className="absolute right-0 top-6 z-30 bg-white border border-zinc-200 rounded-xl shadow-lg p-3 min-w-[180px] animate-in fade-in duration-150">
                      <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Copy this break to:</p>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {DAY_LABELS.map((dl, di) => {
                          if (di === idx) return null;
                          const isActive = allSchedules.find(s => s.dayOfWeek === di)?.enabled;
                          if (!isActive) return null;
                          const checked = copyTargets.includes(di);
                          return (
                            <button key={di} type="button"
                              onClick={() => setCopyTargets(prev => checked ? prev.filter(d => d !== di) : [...prev, di])}
                              className={`rounded-full px-2 py-0.5 text-[9px] font-bold border transition-all cursor-pointer ${
                                checked ? "bg-black text-white border-zinc-800" : "bg-zinc-50 border-zinc-200 text-zinc-500 hover:border-zinc-800/40"
                              }`}>
                              {dl}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-1.5 border-t border-zinc-100 pt-2">
                        <button type="button" onClick={() => setShowCopyMenu(false)}
                          className="flex-1 rounded-full border border-zinc-200 py-1 text-[9px] font-bold text-zinc-400 cursor-pointer">
                          Cancel
                        </button>
                        <button type="button"
                          disabled={copyTargets.length === 0}
                          onClick={() => { onCopyBreaks(idx, copyTargets); setShowCopyMenu(false); setCopyTargets([]); }}
                          className="flex-1 rounded-full bg-black text-white py-1 text-[9px] font-bold cursor-pointer disabled:opacity-40 flex items-center justify-center gap-1">
                          <Check className="h-2.5 w-2.5" /> Apply
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {/* Remove this break */}
                <button type="button" onClick={() => onRemoveBreak(idx, bIdx)}
                  className="inline-flex items-center gap-0.5 text-[9px] font-bold text-red-400 hover:text-red-600 cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {/* Add another break row */}
          <div className="px-3 py-1.5">
            <button type="button"
              onClick={() => onAddBreak(idx, { start: "", end: "", label: "Break" })}
              className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-500 hover:text-amber-700 cursor-pointer">
              <Plus className="h-3 w-3" /> Add another break
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// LeavesCalendarPanel — Interactive Month Calendar for Doctor Leaves
// ==========================================

function LeavesCalendarPanel({
  doc,
  docLeaves,
  setDocLeaves,
  addingLeave,
  setAddingLeave,
  onBack,
  onDeleteLeave,
}: {
  doc: any;
  docLeaves: any[];
  setDocLeaves: (leaves: any[]) => void;
  addingLeave: boolean;
  setAddingLeave: (v: boolean) => void;
  onBack: () => void;
  onDeleteLeave: (id: string) => void;
}) {
  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveIsHol, setLeaveIsHol] = useState(false);
  const [pendingDate, setPendingDate] = useState<string | null>(null);

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startDayOfWeek = new Date(calYear, calMonth, 1).getDay();

  const blockedDates = new Set(docLeaves.map(l => {
    const d = new Date(l.leaveDate);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }));

  const getLeaveForDate = (dateStr: string) => docLeaves.find(l => {
    const d = new Date(l.leaveDate);
    const s = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    return s === dateStr;
  });

  const prevMonth = () => { if(calMonth===0){setCalMonth(11);setCalYear(y=>y-1);}else setCalMonth(m=>m-1); };
  const nextMonth = () => { if(calMonth===11){setCalMonth(0);setCalYear(y=>y+1);}else setCalMonth(m=>m+1); };

  return (
    <div className="space-y-5 border border-rose-100 bg-gradient-to-br from-rose-50/40 to-white rounded-2xl p-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
        <div>
          <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-rose-100">
              <Calendar className="h-3.5 w-3.5 text-rose-500" />
            </span>
            Leaves &amp; Holidays Calendar
          </h4>
          <p className="text-[10px] text-zinc-400 mt-0.5 pl-8">
            Block dates for <strong className="text-zinc-600">{doc.name}</strong> — click a date to block / unblock
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-full px-3 py-1.5 transition-colors cursor-pointer"
        >
          <ChevronLeft className="h-3 w-3" /> Back
        </button>
      </div>

      {/* Month Navigator */}
      <div className="flex items-center justify-between bg-white border border-zinc-150 rounded-xl px-4 py-2.5">
        <button type="button" onClick={prevMonth} className="h-7 w-7 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center cursor-pointer transition-colors">
          <ChevronLeft className="h-3.5 w-3.5 text-zinc-600" />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-zinc-800">{monthNames[calMonth]} {calYear}</p>
          <p className="text-[9px] text-zinc-400">{docLeaves.filter(l => { const d = new Date(l.leaveDate); return d.getUTCMonth() === calMonth && d.getUTCFullYear() === calYear; }).length} blocked day(s) this month</p>
        </div>
        <button type="button" onClick={nextMonth} className="h-7 w-7 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center cursor-pointer transition-colors">
          <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white border border-zinc-150 rounded-xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-7 bg-zinc-50 border-b border-zinc-100">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <div key={d} className="text-center text-[9px] font-black text-zinc-400 uppercase py-2.5">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({length: startDayOfWeek}).map((_,i) => <div key={`e${i}`} className="aspect-square border-b border-r border-zinc-100/50" />)}
          {Array.from({length: daysInMonth}).map((_,i) => {
            const dayNum = i + 1;
            const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
            const isBlocked = blockedDates.has(dateStr);
            const leave = getLeaveForDate(dateStr);
            const isToday = dayNum === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
            const isPending = pendingDate === dateStr;
            const isPast = new Date(dateStr) < new Date(today.toDateString());
            return (
              <button
                key={dayNum}
                type="button"
                title={isBlocked ? `${leave?.reason || 'Blocked'} — click to unblock` : 'Click to block this date'}
                onClick={() => {
                  if (isBlocked) {
                    const lv = getLeaveForDate(dateStr);
                    if (lv) onDeleteLeave(lv.id);
                  } else {
                    setPendingDate(dateStr);
                    setLeaveReason("");
                    setLeaveIsHol(false);
                  }
                }}
                className={`aspect-square flex flex-col items-center justify-center text-[11px] font-bold border-b border-r border-zinc-100/70 transition-all cursor-pointer relative group ${
                  isBlocked
                    ? leave?.isHoliday
                      ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                      : "bg-rose-100 text-rose-700 hover:bg-rose-200"
                    : isPending
                      ? "bg-amber-100 text-amber-700 ring-2 ring-inset ring-amber-300"
                      : isToday
                        ? "bg-brand/10 text-brand ring-1 ring-inset ring-brand/30"
                        : isPast
                          ? "text-zinc-300 hover:bg-zinc-50"
                          : "hover:bg-rose-50 text-zinc-700"
                }`}
              >
                <span>{dayNum}</span>
                {isBlocked && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-current opacity-70" />}
                {isToday && !isBlocked && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-brand opacity-70" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[9px] font-bold text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-rose-100 border border-rose-200" /> Leave</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-indigo-100 border border-indigo-200" /> Public Holiday</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-brand/10 border border-brand/20" /> Today</span>
        <span className="text-zinc-350">· Click to block · Click blocked date to unblock</span>
      </div>

      {/* Inline reason form when a date is pending */}
      {pendingDate && (
        <form
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3 animate-in slide-in-from-bottom-2 duration-200"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!leaveReason.trim()) return;
            setAddingLeave(true);
            try {
              await addDoctorLeaveServerFn({ data: { doctorId: doc.id, leaveDate: pendingDate, reason: leaveReason.trim(), isHoliday: leaveIsHol } });
              const refreshed = await getDoctorLeavesServerFn({ data: doc.id });
              setDocLeaves(refreshed);
              setPendingDate(null);
              setLeaveReason("");
              setLeaveIsHol(false);
            } catch(err) { console.error(err); }
            finally { setAddingLeave(false); }
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📅</span>
            <p className="text-xs font-bold text-amber-800">
              Block {new Date(pendingDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Reason (e.g. Conference, Personal leave, Surgery day)"
              value={leaveReason}
              onChange={e => setLeaveReason(e.target.value)}
              className="flex-1 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold focus:outline-none focus:border-amber-400"
              required
              autoFocus
            />
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-700 cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={leaveIsHol} onChange={e => setLeaveIsHol(e.target.checked)} className="rounded" />
              Public Holiday
            </label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setPendingDate(null)} className="rounded-full border border-amber-300 px-3 py-1.5 text-[10px] font-bold text-amber-600 hover:bg-amber-100 cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={addingLeave} className="rounded-full bg-rose-500 text-white px-4 py-1.5 text-[10px] font-bold cursor-pointer flex items-center gap-1 hover:bg-rose-600">
                {addingLeave ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3 rotate-45" />} Block Day
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Blocked dates summary */}
      {docLeaves.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider pl-1">All Blocked Dates ({docLeaves.length})</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {[...docLeaves].sort((a,b) => new Date(a.leaveDate).getTime() - new Date(b.leaveDate).getTime()).map(leave => {
              const d = new Date(leave.leaveDate);
              return (
                <div key={leave.id} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${leave.isHoliday ? "bg-indigo-50 border-indigo-100" : "bg-rose-50 border-rose-100"}`}>
                  <div>
                    <p className="text-xs font-bold text-zinc-800">{d.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric', timeZone:'UTC' })}</p>
                    <p className="text-[9px] text-zinc-400 truncate max-w-[160px]">{leave.reason}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[8px] font-black rounded-full px-2 py-0.5 ${leave.isHoliday ? "bg-indigo-200 text-indigo-800" : "bg-rose-200 text-rose-800"}`}>
                      {leave.isHoliday ? "HOL" : "LEAVE"}
                    </span>
                    <button type="button" onClick={() => onDeleteLeave(leave.id)} className="h-5 w-5 rounded-full bg-white/80 hover:bg-red-50 border border-zinc-200 flex items-center justify-center cursor-pointer">
                      <X className="h-2.5 w-2.5 text-red-500" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-5 rounded-xl border border-dashed border-zinc-200 text-zinc-350 text-xs font-semibold">
          No dates blocked yet. Click any calendar date to mark it as leave or holiday.
        </div>
      )}
    </div>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"overview" | "calendar" | "patients" | "analytics" | "settings" | "appointments" | "plans" | "whatsapp">("overview");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day">("week");
  const [currentCalendarDate, setCurrentCalendarDate] = useState<Date>(new Date());

  useEffect(() => {
    setIsClient(true);
    // Restore the last active sidebar tab so a page refresh keeps the user on
    // the same view instead of jumping back to the overview. A ?tab= URL param
    // (used by the payment return flow / deep links) takes precedence.
    try {
      const validTabs = ["overview", "calendar", "patients", "analytics", "settings", "appointments", "plans", "whatsapp"];
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("tab");
      const stored = window.localStorage.getItem("bmt_active_tab");
      const restore = fromUrl && validTabs.includes(fromUrl)
        ? fromUrl
        : stored && validTabs.includes(stored)
          ? stored
          : null;
      if (restore) setActiveTab(restore as any);
    } catch { /* ignore storage/URL access errors */ }
  }, []);

  // Persist the active tab so it survives refreshes.
  useEffect(() => {
    if (!isClient) return;
    try {
      window.localStorage.setItem("bmt_active_tab", activeTab);
    } catch { /* ignore storage errors */ }
  }, [activeTab, isClient]);

  // Authentication states
  const [user, setUser] = useState<{
    id: string;
    name: string;
    email: string;
    phone?: string;
    clinicName?: string;
    practiceSize?: string;
    tenantId?: string;
    subscriptionStatus?: string;
    subscriptionPlan?: string;
    subscriptionExpiresAt?: string;
    paymentAmount?: number;
    billingInterval?: string;
    paymentMethod?: string;
    createdAt?: string;
    profilePhoto?: string | null;
    role?: "admin" | "reception" | "doctor" | "location";
    locationId?: string;
    locationName?: string;
  } | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Single source of truth for plan-gated feature access (availability + role permission).
  const featureAccess = useMemo(() => resolveFeatureAccess({
    role: (user?.role ?? "admin") as any,
    subscriptionPlan: user?.subscriptionPlan,
    subscriptionStatus: user?.subscriptionStatus,
    subscriptionExpiresAt: user?.subscriptionExpiresAt,
    isActive: true,
  }), [user]);

  // Advisor Scribe States
  const [scribeSpecialty, setScribeSpecialty] = useState<"Family Medicine" | "Cardiology" | "Pediatrics" | "Psychiatry">("Family Medicine");
  const [scribeLanguage, setScribeLanguage] = useState("English");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [scribeStep, setScribeStep] = useState<"idle" | "listening" | "transcribing" | "completed">("idle");
  const [soapSubjective, setSoapSubjective] = useState("");
  const [soapObjective, setSoapObjective] = useState("");
  const [soapAssessment, setSoapAssessment] = useState("");
  const [soapPlan, setSoapPlan] = useState("");
  const [scribePatientId, setScribePatientId] = useState("");
  const recordIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // New AI Scribe & Voice Prescription Sub-tab states
  const [scribeSubTab, setScribeSubTab] = useState<"scribe" | "prescription">("scribe");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [prescriptionInstructions, setPrescriptionInstructions] = useState("");
  const [prescriptionMedications, setPrescriptionMedications] = useState<Array<{ name: string; dosage: string; frequency: string; route: string; duration: string; instructions: string }>>([]);
  const [prescriptionNotes, setPrescriptionNotes] = useState("");
  const [isGeneratingPrescription, setIsGeneratingPrescription] = useState(false);
  const [isSavingPrescription, setIsSavingPrescription] = useState(false);
  
  // Unified Consultation & Prescription Form states
  const [consultationChiefComplaint, setConsultationChiefComplaint] = useState("");
  const [consultationDiagnosis, setConsultationDiagnosis] = useState("");
  const [consultationAdvice, setConsultationAdvice] = useState("");
  const [consultationLabTests, setConsultationLabTests] = useState<Array<{ name: string; instructions: string }>>([]);
  const [consultationReferrals, setConsultationReferrals] = useState<Array<{ departmentId: string; doctorId?: string; notes?: string }>>([]);
  const [consultationFollowUpDate, setConsultationFollowUpDate] = useState("");
  const [consultationFollowUpNotes, setConsultationFollowUpNotes] = useState("");
  const [consultationFee, setConsultationFee] = useState(1500);
  const [consultationPrivateNotes, setConsultationPrivateNotes] = useState("");
  const [recordingField, setRecordingField] = useState<string | null>(null);
  const [isAIAssisting, setIsAIAssisting] = useState(false);

  // Voice Rx popup modal states
  const [isVoiceRxModalOpen, setIsVoiceRxModalOpen] = useState(false);
  const [voiceRxTranscript, setVoiceRxTranscript] = useState("");
  const [voiceRxInterim, setVoiceRxInterim] = useState("");
  const [isVoiceRxAnalyzing, setIsVoiceRxAnalyzing] = useState(false);
  const [voiceRxResult, setVoiceRxResult] = useState<{
    chiefComplaint?: string;
    diagnosis?: string;
    medications?: Array<{ name: string; dosage: string; frequency: string; route: string; duration: string; instructions: string }>;
    advice?: string;
  } | null>(null);

  // Vitals states
  const [vitalBP, setVitalBP] = useState("120/80");
  const [vitalPulse, setVitalPulse] = useState("72");
  const [vitalTemp, setVitalTemp] = useState("98.6");
  const [vitalWeight, setVitalWeight] = useState("70");
  const [vitalHeight, setVitalHeight] = useState("170");
  const [vitalSpO2, setVitalSpO2] = useState("98");
  const [vitalRespRate, setVitalRespRate] = useState("16");

  const recognitionRef = useRef<any>(null);

  // Consultation interactive list and action states
  const [selectedAptForConsultation, setSelectedAptForConsultation] = useState<any | null>(null);
  const [consultationSearchQuery, setConsultationSearchQuery] = useState("");
  const [consultationDate, setConsultationDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [consultationShowAll, setConsultationShowAll] = useState(false);
  const [consultationStatus, setConsultationStatus] = useState("All");
  const [consultationSubTab, setConsultationSubTab] = useState<"appointments" | "followups">("appointments");
  const [selectedAptIds, setSelectedAptIds] = useState<string[]>([]);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [activeStatusDropdownId, setActiveStatusDropdownId] = useState<string | null>(null);
  const [aptToDelete, setAptToDelete] = useState<any | null>(null);

  // Navigation and Detail Drawers
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);
  const [patientProfileTab, setPatientProfileTab] = useState<"consultations" | "prescriptions">("consultations");
  const [patientChartData, setPatientChartData] = useState<any | null>(null);
  const patientDetails = patientChartData?.patient || selectedPatient;
  const [searchQuery, setSearchQuery] = useState("");

  // Professional: Add Advisory Note modal state
  const [showAddAdvisoryModal, setShowAddAdvisoryModal] = useState(false);
  const [advisoryDate, setAdvisoryDate] = useState("");
  const [advisoryClientInput, setAdvisoryClientInput] = useState("");
  const [advisoryObservations, setAdvisoryObservations] = useState("");
  const [advisoryAssessment, setAdvisoryAssessment] = useState("");
  const [advisoryNextSteps, setAdvisoryNextSteps] = useState("");
  const [isSavingAdvisory, setIsSavingAdvisory] = useState(false);

  // Professional: Add Action Plan modal state
  const [showAddActionPlanModal, setShowAddActionPlanModal] = useState(false);
  const [actionPlanDeliverables, setActionPlanDeliverables] = useState<Array<{ name: string; sets: string; reps: string; duration: string }>>([
    { name: "", sets: "", reps: "", duration: "" }
  ]);
  const [actionPlanNotes, setActionPlanNotes] = useState("");
  const [isSavingActionPlan, setIsSavingActionPlan] = useState(false);

  const [patientsList, setPatientsList] = useState<any[]>([]);
  const [patientsTotal, setPatientsTotal] = useState(0);
  const [patientsPage, setPatientsPage] = useState(1);
  const [loadingPatients, setLoadingPatients] = useState(true);

  // Dashboard overview stats (live)
  const [dashboardStats, setDashboardStats] = useState<any | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Analytics (live)
  const [analyticsData, setAnalyticsData] = useState<any | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);

  // Toast notification system
  const [toasts, setToasts] = useState<Array<{ id: string; type: "success" | "error" | "info"; message: string }>>([]);
  const showToast = useCallback((type: "success" | "error" | "info", message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState<{ plan: string; amount: number } | null>(null);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  // Verify a Cashfree payment when the gateway redirects back with ?order_id=.
  const verifyReturnedPayment = useCallback(async (orderId: string) => {
    setIsVerifyingPayment(true);
    try {
      const { verifyAndProcessPaymentServerFn } = await import("../../lib/auth");
      const res = await verifyAndProcessPaymentServerFn({ data: { orderId } });
      if (res.success) {
        setPaymentSuccess({ plan: res.plan as string, amount: Number(res.amount) });
        setActiveTab("plans");
        // Refresh the session user so plan/expiry/badges reflect the new state.
        try {
          const fresh = await getCurrentUserServerFn();
          if (fresh) setUser(fresh);
        } catch { /* non-fatal: modal already confirms success */ }
      } else {
        showToast("error", (res as any).message || "Payment was not completed.");
      }
    } catch (err: any) {
      showToast("error", err?.message || "We couldn't verify your payment. Please contact support if you were charged.");
    } finally {
      setIsVerifyingPayment(false);
      // Clear the order_id from the URL so a refresh doesn't re-verify.
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("order_id");
        window.history.replaceState({}, document.title, url.pathname + url.search);
      }
    }
  }, [showToast]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order_id");
    if (orderId) {
      verifyReturnedPayment(orderId);
    }
  }, [verifyReturnedPayment]);

  const handleUpgradeClick = useCallback(async (planName: string) => {
    if (planName === "Enterprise") {
      setActiveTab("settings");
      return;
    }
    if (!user || !user.email) {
      showToast("error", "Session expired. Please log in again.");
      return;
    }
    if (processingPlan) return; // guard against double-clicks
    setProcessingPlan(planName);
    showToast("info", "Initiating secure payment gateway...");
    try {
      const { createCashfreeOrderServerFn } = await import("../../lib/auth");
      // Return to this dashboard (plans tab) after payment so we can verify and
      // show a confirmation in-context, rather than bouncing through /login.
      const returnPath = `${window.location.pathname}?tab=plans`;
      const res = await createCashfreeOrderServerFn({
        data: { username: user.email, planName: planName as any, returnPath }
      });
      if (res.success && res.payment_session_id) {
        if (!(window as any).Cashfree) {
          throw new Error("Payment gateway SDK failed to load. Please refresh the page.");
        }
        const cashfree = (window as any).Cashfree({
          mode: res.environment === "production" ? "production" : "sandbox"
        });
        await cashfree.checkout({
          paymentSessionId: res.payment_session_id,
          returnUrl: res.return_url
        });
      } else {
        showToast("error", "Failed to initiate payment checkout. Please try again.");
      }
    } catch (err: any) {
      showToast("error", err.message || "Failed to trigger payment gateway.");
    } finally {
      setProcessingPlan(null);
    }
  }, [user, showToast, processingPlan]);

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void } | null>(null);
  const [isDialogConfirming, setIsDialogConfirming] = useState(false);

  // Patient CRUD modal states
  const [isAddingPatient, setIsAddingPatient] = useState(false);
  const [editingPatient, setEditingPatient] = useState<any | null>(null);
  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientAge, setNewPatientAge] = useState("");
  const [newPatientGender, setNewPatientGender] = useState("Female");
  const [newPatientPhone, setNewPatientPhone] = useState("");
  const [newPatientEmail, setNewPatientEmail] = useState("");
  const [newPatientAddress, setNewPatientAddress] = useState("");
  const [newPatientReason, setNewPatientReason] = useState("");
  const [newPatientNotes, setNewPatientNotes] = useState("");
  const [savingPatient, setSavingPatient] = useState(false);

  // AI Receptionist quick-toggle
  const [receptionistActive, setReceptionistActive] = useState(true);

  // Live database appointments state
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [appointmentSummary, setAppointmentSummary] = useState<any>({ total:0, pending:0, confirmed:0, completed:0, cancelled:0 });
  const [appointmentsTotal, setAppointmentsTotal] = useState(0);
  const [appointmentsPage, setAppointmentsPage] = useState(1);

  // Appointments CRUD tab States
  const [searchAptQuery, setSearchAptQuery] = useState("");
  const [filterAptStatus, setFilterAptStatus] = useState("All");
  const [filterAptDate, setFilterAptDate] = useState("all");
  const [isSchedulingApt, setIsSchedulingApt] = useState(false);
  const [editingApt, setEditingApt] = useState<any | null>(null);
  const [selectedAptDetails, setSelectedAptDetails] = useState<any | null>(null);

  // Create/Edit form values
  const [aptName, setAptName] = useState("");
  const [aptEmail, setAptEmail] = useState("");
  const [aptPhone, setAptPhone] = useState("");
  const [aptDateTime, setAptDateTime] = useState("");
  const [aptReason, setAptReason] = useState("");
  const [aptStatus, setAptStatus] = useState("Pending");
  const [aptError, setAptError] = useState("");
  const [aptSuccess, setAptSuccess] = useState("");
  const [savingApt, setSavingApt] = useState(false);



  // Settings Sub-tab and Clinic Management States
  const [settingsSubTab, setSettingsSubTab] = useState<"profile" | "hours" | "departments" | "doctors" | "whatsapp" | "users" | "locations">("profile");
  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);

  // Sub-Users State
  const [subUsers, setSubUsers] = useState<any[]>([]);
  const [selectedSubUsers, setSelectedSubUsers] = useState<any[]>([]);
  const [viewingSubUser, setViewingSubUser] = useState<any | null>(null);
  const [editModalSubUser, setEditModalSubUser] = useState<any | null>(null);
  const [subUsersLoading, setSubUsersLoading] = useState(false);
  const [showSubUserForm, setShowSubUserForm] = useState(false);
  const [editingSubUser, setEditingSubUser] = useState<any>(null);
  const [subUserForm, setSubUserForm] = useState({ name: "", email: "", phone: "", role: "reception" as "reception"|"doctor", doctorId: "", password: "", confirmPassword: "" });
  const [subUserError, setSubUserError] = useState("");
  const [subUserSuccess, setSubUserSuccess] = useState("");
  const [savingSubUser, setSavingSubUser] = useState(false);
  const [showSubUserPwd, setShowSubUserPwd] = useState(false);
  const [subUserToDelete, setSubUserToDelete] = useState<any | null>(null);
  const [isDeletingSubUser, setIsDeletingSubUser] = useState(false);

  // Clinic Hours States
  const [clinicHours, setClinicHours] = useState<any[]>([]);
  const [savingHours, setSavingHours] = useState(false);
  const [hoursSuccess, setHoursSuccess] = useState("");
  const [hoursError, setHoursError] = useState("");

  // Departments States
  const [departments, setDepartments] = useState<any[]>([]);
  const [newDeptName, setNewDeptName] = useState("");
  const [loadingDepts, setLoadingDepts] = useState(false);

  // Doctors States
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any | null>(null);
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [docName, setDocName] = useState("");
  const [docEmail, setDocEmail] = useState("");
  const [docPhone, setDocPhone] = useState("");
  const [docQualifications, setDocQualifications] = useState("");
  const [docDeptId, setDocDeptId] = useState("");
  const [docError, setDocError] = useState("");
  const [docSuccess, setDocSuccess] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);

  // Doctor Schedule & Leave States
  const [selectedDocForSchedule, setSelectedDocForSchedule] = useState<any | null>(null);
  const [docSchedules, setDocSchedules] = useState<any[]>([]);
  const [savingDocSchedule, setSavingDocSchedule] = useState(false);
  const [docScheduleSuccess, setDocScheduleSuccess] = useState("");
  const [selectedDocForLeaves, setSelectedDocForLeaves] = useState<any | null>(null);
  const [docLeaves, setDocLeaves] = useState<any[]>([]);
  const [newLeaveDate, setNewLeaveDate] = useState("");
  const [newLeaveReason, setNewLeaveReason] = useState("");
  const [newLeaveIsHoliday, setNewLeaveIsHoliday] = useState(false);
  const [addingLeave, setAddingLeave] = useState(false);

  // WhatsApp States
  const [waStatus, setWaStatus] = useState<string>("DISCONNECTED");
  const [waQrDataUrl, setWaQrDataUrl] = useState<string>("");
  const [waConnectedNumber, setWaConnectedNumber] = useState<string>("");
  const [waQueueCount, setWaQueueCount] = useState<number>(0);
  const [waSentLogs, setWaSentLogs] = useState<any[]>([]);
  const [checkingWa, setCheckingWa] = useState(false);
  const [testWaPhone, setTestWaPhone] = useState("");
  const [testWaBody, setTestWaBody] = useState("");
  const [testWaSuccess, setTestWaSuccess] = useState("");
  const [testWaError, setTestWaError] = useState("");
  const [sendingTestWa, setSendingTestWa] = useState(false);

  // Scheduling Doctor/Slots Selection States
  const [aptDoctorId, setAptDoctorId] = useState("");
  const [aptTimeSlot, setAptTimeSlot] = useState("");
  const [aptAvailableSlots, setAptAvailableSlots] = useState<string[]>([]);
  const [loadingAptSlots, setLoadingAptSlots] = useState(false);

  // Synced states and helpers for the appointment scheduling modal
  const [aptWhatsapp, setAptWhatsapp] = useState("");
  const [aptAppointmentType, setAptAppointmentType] = useState("First Time");
  const [aptDeptId, setAptDeptId] = useState("");
  const [aptDeptOpen, setAptDeptOpen] = useState(false);
  const [aptDocOpen, setAptDocOpen] = useState(false);
  const [aptTypeOpen, setAptTypeOpen] = useState(false);
  const [aptCalendarOpen, setAptCalendarOpen] = useState(false);
  const [aptClockOpen, setAptClockOpen] = useState(false);
  const [aptBloodGroupOpen, setAptBloodGroupOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dateError, setDateError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());

  // Wizard scheduling form states
  const [bookingStep, setBookingStep] = useState(1);
  const [aptGender, setAptGender] = useState("Female");
  const [aptDob, setAptDob] = useState("");
  const [aptBloodGroup, setAptBloodGroup] = useState("");
  const [aptAddress, setAptAddress] = useState("");
  const [dupWarning, setDupWarning] = useState<any | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  // Helper to calculate age from DOB
  const calculateAge = (dobString: string) => {
    if (!dobString) return undefined;
    const today = new Date();
    const birthDate = new Date(dobString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age >= 0 ? age : undefined;
  };

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


  const handleStep2Next = async () => {
    setAptError("");
    const newErrs: Record<string, string> = {};
    if (!aptEmail.trim() || !/\S+@\S+\.\S+/.test(aptEmail)) {
      newErrs.email = "Please enter a valid email address.";
    }
    if (!aptPhone.trim() || !/^\+?[\d\s-]{10,15}$/.test(aptPhone)) {
      newErrs.phone = "Please enter a valid phone number (10-15 digits).";
    }
    if (Object.keys(newErrs).length > 0) {
      setFieldErrors(newErrs);
      return;
    }
    setFieldErrors({});

    setSavingApt(true);
    try {
      const res = await checkPatientDuplicateServerFn({
        data: {
          email: aptEmail.trim(),
          phone: aptPhone.trim()
        }
      });
      
      if (res.exists && res.patient) {
        // If editing this exact patient, don't show duplicate warning
        if (editingApt && (res.patient.id === selectedPatientId || res.patient.id === editingApt.patientId)) {
          setBookingStep(3);
        } else {
          setDupWarning(res);
        }
      } else {
        setSelectedPatientId(null);
        setBookingStep(3);
      }
    } catch (err: any) {
      setAptError(err.message || "Failed to perform contact validation check.");
    } finally {
      setSavingApt(false);
    }
  };

  const handleStep3Next = () => {
    setAptError("");
    const newErrs: Record<string, string> = {};
    if (!aptDeptId) {
      newErrs.dept = "Department is required.";
    }
    if (!aptDoctorId) {
      newErrs.doctor = "Doctor is required.";
    }
    if (!aptDateTime) {
      newErrs.date = "Appointment Date is required.";
    }
    if (!aptTimeSlot) {
      newErrs.time = "Appointment Time slot is required.";
    }
    if (!aptReason.trim()) {
      newErrs.reason = "Reason for visit is required.";
    }

    if (Object.keys(newErrs).length > 0) {
      setFieldErrors(newErrs);
      return;
    }
    setFieldErrors({});
    setBookingStep(4);
  };

  const handleCreateOrUpdateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setAptError("");
    setAptSuccess("");

    const newErrs: Record<string, string> = {};
    if (!aptName.trim()) {
      newErrs.name = "Client Name is required.";
    }
    if (!aptEmail.trim() || !/\S+@\S+\.\S+/.test(aptEmail)) {
      newErrs.email = "Please enter a valid email address.";
    }
    if (!aptPhone.trim() || !/^\+?[\d\s-]{10,15}$/.test(aptPhone)) {
      newErrs.phone = "Please enter a valid phone number (10-15 digits).";
    }
    if (!aptDeptId) {
      newErrs.dept = "Department is required.";
    }
    if (!aptDoctorId) {
      newErrs.doctor = "Doctor is required.";
    }
    if (!aptDateTime) {
      newErrs.date = "Appointment Date is required.";
    }
    if (!aptTimeSlot) {
      newErrs.time = "Appointment Time slot is required.";
    }
    if (!aptReason.trim()) {
      newErrs.reason = "Reason for visit is required.";
    }

    if (Object.keys(newErrs).length > 0) {
      setFieldErrors(newErrs);
      if (newErrs.name) {
        setBookingStep(1);
      } else if (newErrs.email || newErrs.phone) {
        setBookingStep(2);
      } else {
        setBookingStep(3);
      }
      return;
    }
    setFieldErrors({});

    setSavingApt(true);
    try {
      let finalPatientId = selectedPatientId;
      const calculatedAge = calculateAge(aptDob);

      // Handle patient profile insertion or update
      if (finalPatientId) {
        await updatePatientServerFn({
          data: {
            id: finalPatientId,
            name: aptName,
            age: calculatedAge,
            gender: aptGender,
            phone: aptPhone,
            email: aptEmail,
            address: aptAddress,
            dob: aptDob,
            bloodGroup: aptBloodGroup
          }
        });
      } else {
        const resPatient = await createPatientServerFn({
          data: {
            name: aptName,
            age: calculatedAge,
            gender: aptGender,
            phone: aptPhone,
            email: aptEmail,
            address: aptAddress,
            dob: aptDob,
            bloodGroup: aptBloodGroup,
            chiefComplaint: aptReason
          }
        });
        if (resPatient.success && resPatient.patientId) {
          finalPatientId = resPatient.patientId;
          setSelectedPatientId(finalPatientId);
        }
      }

      if (editingApt) {
        // Edit mode
        const res = await updateAppointmentServerFn({
          data: {
            id: editingApt.id,
            name: aptName,
            email: aptEmail,
            phone: aptPhone,
            dateTime: aptDateTime,
            reason: aptReason,
            status: aptStatus,
            doctorId: aptDoctorId,
            timeSlot: aptTimeSlot,
            whatsapp: aptWhatsapp,
            appointmentType: aptAppointmentType,
            patientId: finalPatientId
          }
        });
        if (res.success) {
          setAptSuccess("Appointment updated successfully!");
          await fetchAppointments();
          try {
            fetchPatients();
            fetchDashboardStats();
            fetchAnalytics();
          } catch (_) {}
          setTimeout(() => {
            setIsSchedulingApt(false);
            setEditingApt(null);
            clearAptForm();
          }, 1000);
        }
      } else {
        // Create mode
        if (!user?.tenantId) throw new Error("No tenant ID found.");
        const res = await createAppointmentServerFn({
          data: {
            tenantId: user.tenantId,
            name: aptName,
            email: aptEmail,
            phone: aptPhone,
            dateTime: aptDateTime,
            reason: aptReason,
            doctorId: aptDoctorId,
            timeSlot: aptTimeSlot,
            whatsapp: aptWhatsapp,
            appointmentType: aptAppointmentType,
            patientId: finalPatientId
          }
        });
        if (res.success) {
          setAptSuccess("Appointment scheduled successfully!");
          await fetchAppointments();
          try {
            fetchPatients();
            fetchDashboardStats();
            fetchAnalytics();
          } catch (_) {}
          setTimeout(() => {
            setIsSchedulingApt(false);
            setEditingApt(null);
            clearAptForm();
          }, 1000);
        }
      }
    } catch (err: any) {
      setAptError(err.message || "Failed to save appointment. Please try again.");
    } finally {
      setSavingApt(false);
    }
  };

  const handleDeleteAppointment = async (id: string) => {
    try {
      const res = await deleteAppointmentServerFn({ data: id });
      if (res.success) {
        await fetchAppointments();
      }
    } catch (err: any) {
      console.error("Failed to delete appointment:", err);
    }
  };

  const handleUpdateStatus = async (apt: any, newStatus: string) => {
    setActiveStatusDropdownId(null);
    if (apt.status === newStatus) return;

    try {
      const res = await updateAppointmentServerFn({
        data: {
          id: apt.id,
          name: apt.name,
          email: apt.email,
          phone: apt.phone,
          dateTime: apt.dateTime,
          reason: apt.reason,
          status: newStatus,
          doctorId: apt.doctorId || undefined,
          timeSlot: apt.timeSlot || undefined,
          whatsapp: apt.whatsapp || undefined,
          appointmentType: apt.appointmentType || undefined,
          patientId: apt.patientId || null
        }
      });

      if (res.success) {
        showToast("success", `Appointment status updated to ${newStatus}`);
        await fetchAppointments();
        try {
          fetchDashboardStats();
          fetchAnalytics();
        } catch (_) {}
      }
    } catch (err: any) {
      showToast("error", err.message || "Failed to update appointment status.");
    }
  };

  const openCreateApt = () => {
    setEditingApt(null);
    clearAptForm();
    setIsSchedulingApt(true);
  };

  const openEditApt = (apt: any) => {
    setEditingApt(apt);
    setAptName(apt.name);
    setAptEmail(apt.email);
    setAptPhone(apt.phone);
    
    // Format ISO string to datetime-local value (YYYY-MM-DDTHH:MM)
    const d = new Date(apt.dateTime);
    const tzoffset = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(d.getTime() - tzoffset)).toISOString().slice(0, 16);
    setAptDateTime(localISOTime);
    
    setAptReason(apt.reason);
    setAptStatus(apt.status);
    setAptDoctorId(apt.doctorId || "");
    setAptTimeSlot(apt.timeSlot || "");
    setAptWhatsapp(apt.whatsapp || "");
    setAptAppointmentType(apt.appointmentType || "First Time");
    
    // Resolve department matching editing doctor
    const doc = doctors.find((docItem) => docItem.id === apt.doctorId);
    if (doc) {
      setAptDeptId(doc.departmentId || "");
    } else {
      setAptDeptId("");
    }

    if (!isNaN(d.getTime())) {
      setCalMonth(d.getMonth());
      setCalYear(d.getFullYear());
    }

    // Load Patient details
    const matchedPatientId = apt.patientId || resolvePatientForApt(apt);
    if (matchedPatientId) {
      setSelectedPatientId(matchedPatientId);
      getPatientChartServerFn({ data: { patientId: matchedPatientId } })
        .then((res: any) => {
          if (res && res.patient) {
            setAptGender(res.patient.gender || "Female");
            setAptDob(res.patient.dob || "");
            setAptBloodGroup(res.patient.bloodGroup || "");
            setAptAddress(res.patient.address || "");
          }
        })
        .catch(console.error);
    } else {
      setSelectedPatientId(null);
      setAptGender("Female");
      setAptDob("");
      setAptBloodGroup("");
      setAptAddress("");
    }

    setBookingStep(3); // Start at step 3 when editing
    setDupWarning(null);
    setAptError("");
    setAptSuccess("");
    setIsSchedulingApt(true);
  };

  const clearAptForm = () => {
    setAptName("");
    setAptEmail("");
    setAptPhone("");
    setAptDateTime("");
    setAptReason("");
    setAptStatus("Pending");
    setAptDoctorId("");
    setAptTimeSlot("");
    setAptWhatsapp("");
    setAptAppointmentType("First Time");
    setAptDeptId("");
    setAptDeptOpen(false);
    setAptDocOpen(false);
    setAptTypeOpen(false);
    setAptCalendarOpen(false);
    setAptClockOpen(false);
    setAptError("");
    setAptSuccess("");
    setDateError(null);
    setTimeError(null);

    // Reset wizard states
    setBookingStep(1);
    setAptGender("Female");
    setAptDob("");
    setAptBloodGroup("");
    setAptAddress("");
    setDupWarning(null);
    setSelectedPatientId(null);
    setEditingApt(null);
  };


  // Settings Form States
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileClinic, setProfileClinic] = useState("");
  const [profilePracticeSize, setProfilePracticeSize] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  // Profile photo upload
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // WhatsApp Alert Config States
  const [waConfigPhone, setWaConfigPhone] = useState("");
  const [waConfigEnabled, setWaConfigEnabled] = useState(false);
  const [savingWaConfig, setSavingWaConfig] = useState(false);
  const [waConfigSuccess, setWaConfigSuccess] = useState("");
  const [waConfigError, setWaConfigError] = useState("");

  // Password Change States
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [passSuccess, setPassSuccess] = useState("");
  const [passError, setPassError] = useState("");
  const [savingPass, setSavingPass] = useState(false);

  // Email Change States
  const [newEmail, setNewEmail] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [verifyingEmailOtp, setVerifyingEmailOtp] = useState(false);
  const [emailTimer, setEmailTimer] = useState(0);

  // Clipboard link state
  const [copiedLink, setCopiedLink] = useState(false);

  const fetchAppointments = async () => {
    setLoadingAppointments(true);
    try {
      const res = await getAppointmentsPagedServerFn({
        data: {
          search: searchAptQuery,
          status: filterAptStatus,
          dateFilter: filterAptDate,
          page: appointmentsPage
        }
      });
      setAppointments(res.appointments || []);
      setAppointmentsTotal(res.total || 0);
      setAppointmentSummary(res.summary || { total:0, pending:0, confirmed:0, completed:0, cancelled:0 });
    } catch (err) {
      console.error("Failed to fetch appointments:", err);
    } finally {
      setLoadingAppointments(false);
    }
  };

  const fetchPatients = async () => {
    setLoadingPatients(true);
    try {
      const res = await getPatientsServerFn({
        data: {
          search: searchQuery,
          page: patientsPage
        }
      });
      setPatientsList(res.patients || []);
      setPatientsTotal(res.total || 0);
    } catch (err) {
      console.error("Failed to fetch patients:", err);
      showToast("error", "Failed to fetch patients");
    } finally {
      setLoadingPatients(false);
    }
  };

  const fetchDashboardStats = async () => {
    setLoadingStats(true);
    try {
      const res = await getDashboardStatsServerFn();
      setDashboardStats(res);
    } catch (err) {
      console.error("Failed to fetch dashboard stats:", err);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchAnalytics = async () => {
    setLoadingAnalytics(true);
    try {
      const res = await getAnalyticsServerFn();
      setAnalyticsData(res);
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  // Email timer countdown
  useEffect(() => {
    if (emailTimer > 0) {
      const timer = setTimeout(() => setEmailTimer(emailTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [emailTimer]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccess("");
    setProfileError("");
    setSavingProfile(true);

    try {
      const res = await updateProfileServerFn({
        data: {
          name: profileName,
          phone: profilePhone,
          clinicName: profileClinic,
          practiceSize: profilePracticeSize,
        }
      });
      if (res.success) {
        setProfileSuccess("Clinic profile updated successfully!");
        setUser((prev) => prev ? {
          ...prev,
          name: profileName,
          phone: profilePhone,
          clinicName: profileClinic,
          practiceSize: profilePracticeSize,
        } : null);
      }
    } catch (err: any) {
      setProfileError(err.message || "Failed to update profile details.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassSuccess("");
    setPassError("");

    if (newPass !== confirmPass) {
      setPassError("New passwords do not match.");
      return;
    }

    setSavingPass(true);
    try {
      const res = await updatePasswordServerFn({
        data: {
          currentPass,
          newPass,
        }
      });
      if (res.success) {
        setPassSuccess("Password updated successfully.");
        setCurrentPass("");
        setNewPass("");
        setConfirmPass("");
      }
    } catch (err: any) {
      setPassError(err.message || "Incorrect current password or update failed.");
    } finally {
      setSavingPass(false);
    }
  };

  const handleSendEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailSuccess("");
    setEmailError("");

    if (!newEmail || !newEmail.includes("@")) {
      setEmailError("Please enter a valid email address.");
      return;
    }

    if (newEmail === user?.email) {
      setEmailError("This is already your registered email address.");
      return;
    }

    setSendingEmailOtp(true);
    try {
      const res = await sendEmailChangeOtpServerFn({ data: newEmail });
      if (res.success) {
        setEmailOtpSent(true);
        setEmailTimer(60);
        setEmailSuccess(`Verification code sent to ${newEmail}`);
      }
    } catch (err: any) {
      setEmailError(err.message || "Failed to send verification email.");
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const handleVerifyEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailSuccess("");
    setEmailError("");

    if (!emailOtpCode) {
      setEmailError("Please enter the 4-digit code.");
      return;
    }

    setVerifyingEmailOtp(true);
    try {
      const res = await updateEmailServerFn({
        data: {
          newEmail,
          code: emailOtpCode,
        }
      });
      if (res.success) {
        setEmailSuccess("Email address updated successfully!");
        setUser((prev) => prev ? { ...prev, email: newEmail } : null);
        setEmailOtpSent(false);
        setEmailOtpCode("");
        setNewEmail("");
      }
    } catch (err: any) {
      setEmailError(err.message || "Invalid or expired verification code.");
    } finally {
      setVerifyingEmailOtp(false);
    }
  };

  const handleCopyLink = (bookingUrl: string) => {
    navigator.clipboard.writeText(bookingUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Generate timeline events sorting live DB appointments and fallback mocks
  const getTimelineEvents = () => {
    const items = dashboardStats?.todayAppointments || [];
    return items.map((apt: any) => {
      const date = new Date(apt.dateTime);
      const timeString = apt.timeSlot || date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      });
      const hour = date.getHours().toString().padStart(2, "0");
      const min = date.getMinutes().toString().padStart(2, "0");

      const patientObj: Patient = {
        id: apt.patientId || apt.id,
        name: apt.name,
        age: 35,
        gender: "Not specified",
        dob: "N/A",
        phone: apt.phone,
        insurance: "Self-Pay / Online Booking",
        lastVisit: date.toISOString().split("T")[0],
        reason: apt.reason,
        status: apt.status === "Pending" ? "Pending Review" : "Completed",
        notesHistory: []
      };

      return {
        time: timeString,
        patient: apt.name,
        reason: apt.reason,
        color: apt.status === "Completed" ? "bg-emerald-500" :
               apt.status === "Confirmed" ? "bg-blue-500" :
               apt.status === "Cancelled" ? "bg-red-500" : "bg-amber-500",
        patientObj,
        sortTime: `${hour}:${min}`
      };
    }).sort((a: any, b: any) => a.sortTime.localeCompare(b.sortTime));
  };

  useEffect(() => {
    if (!isSchedulingApt) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".dropdown-container")) {
        setAptDeptOpen(false);
        setAptDocOpen(false);
        setAptTypeOpen(false);
        setAptCalendarOpen(false);
        setAptClockOpen(false);
        setAptBloodGroupOpen(false);
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [isSchedulingApt]);

  // ──────────────────────────────────────────────
  // 1. Session Verification
  // ──────────────────────────────────────────────
  useEffect(() => {
    getCurrentUserServerFn()
      .then((res) => {
        if (!res) {
          // Redirect to login if not authenticated
          navigate({ to: "/login" });
        } else {
          setUser(res);
        }
      })
      .catch((e) => {
        console.error("Auth check failed:", e);
        navigate({ to: "/login" });
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, [navigate]);

  useEffect(() => {
    if (user) {
      fetchAppointments();
    }
  }, [user, searchAptQuery, filterAptStatus, filterAptDate, appointmentsPage]);

  useEffect(() => {
    if (user) {
      if (activeTab === "overview") {
        fetchDashboardStats();
        fetchAnalytics();
      } else if (activeTab === "patients") {
        fetchPatients();
      } else if (activeTab === "analytics") {
        fetchAnalytics();
      }
    }
  }, [user, activeTab, searchQuery, patientsPage]);

  // Load patient chart (SOAP notes + appointments)
  useEffect(() => {
    if (selectedPatient && selectedPatient.id && user) {
      setPatientChartData(null);
      getPatientChartServerFn({ data: { patientId: selectedPatient.id } })
        .then((res) => {
          setPatientChartData(res);
        })
        .catch((e) => {
          console.error("Failed to load patient chart:", e);
          setPatientChartData({
            patient: selectedPatient,
            soapNotes: [],
            prescriptions: [],
            appointments: []
          });
          showToast("error", "Failed to load patient chart history");
        });
    } else {
      setPatientChartData(null);
    }
  }, [selectedPatient, user]);

  // ──────────────────────────────────────────────
  // Clinic & Doctor Management Handlers
  // ──────────────────────────────────────────────

  // Fetch WhatsApp status
  const fetchWhatsAppStatus = async () => {
    try {
      const res = await getWhatsAppStatusServerFn();
      setWaStatus(res.state);
      setWaQrDataUrl(res.qrDataUrl);
      setWaConnectedNumber(res.connectedNumber);
      setWaQueueCount(res.queueCount);
      setWaSentLogs(res.sentLog);
    } catch (e) {
      console.error("Failed to fetch WhatsApp status:", e);
    }
  };

  // WhatsApp connection poller
  useEffect(() => {
    let interval: any = null;
    if (activeTab === "settings" && settingsSubTab === "whatsapp") {
      // Poll fast when waiting for QR scan, slower when connected
      const pollMs = (waStatus === "CONNECTING" || waStatus === "QR_READY") ? 3000
                   : waStatus === "CONNECTED" ? 10000
                   : 0;
      if (pollMs > 0) {
        interval = setInterval(fetchWhatsAppStatus, pollMs);
      }
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTab, settingsSubTab, waStatus]);


  // Load sub-tab specific data
  useEffect(() => {
    if (activeTab === "settings" && user) {
      if (settingsSubTab === "profile") {
        setLoadingProfile(true);
        getClinicProfileServerFn()
          .then((res) => {
            if (res) {
              setProfileClinic(res.clinicName || "");
              setProfileName(res.clinicianName || "");
              setProfilePhone(res.phone || "");
              setProfilePracticeSize(res.practiceSize || "");
            } else {
              // If there's no data in database, show empty/blank
              setProfileClinic("");
              setProfileName("");
              setProfilePhone("");
              setProfilePracticeSize("Solo Practice");
            }
          })
          .catch((e) => console.error("Failed to load profile:", e))
          .finally(() => setLoadingProfile(false));
      } else if (settingsSubTab === "hours") {
        getClinicHoursServerFn()
          .then((res) => setClinicHours(res))
          .catch((e) => console.error(e));
      } else if (settingsSubTab === "users") {
        setSubUsersLoading(true);
        getSubUsersServerFn()
          .then(res => setSubUsers(res))
          .catch(console.error)
          .finally(() => setSubUsersLoading(false));
      } else if (settingsSubTab === "departments") {
        setLoadingDepts(true);
        getDepartmentsServerFn()
          .then((res) => setDepartments(res))
          .catch((e) => console.error(e))
          .finally(() => setLoadingDepts(false));
      } else if (settingsSubTab === "doctors") {
        setLoadingDocs(true);
        Promise.all([getDepartmentsServerFn(), getDoctorsServerFn()])
          .then(([deptsRes, docsRes]) => {
            setDepartments(deptsRes);
            setDoctors(docsRes);
          })
          .catch((e) => console.error(e))
          .finally(() => setLoadingDocs(false));
      } else if (settingsSubTab === "whatsapp") {
        fetchWhatsAppStatus();
        getWhatsAppConfigServerFn()
          .then((res) => {
            if (res) {
              setWaConfigPhone(res.phoneNumber || "");
              setWaConfigEnabled(!!res.isEnabled);
            } else {
              setWaConfigPhone("");
              setWaConfigEnabled(false);
            }
          })
          .catch((e) => console.error("Failed to load WhatsApp config:", e));
      }
    }
  }, [activeTab, settingsSubTab, user]);

  // Slots fetching logic for manual drawer
  const fetchAptAvailableSlots = async (docId: string, dateStr: string) => {
    if (!docId || !dateStr || !user?.tenantId) return;
    setLoadingAptSlots(true);
    try {
      const res = await getClinicInfoAndSlotsServerFn({
        data: {
          tenantId: user.tenantId,
          doctorId: docId,
          date: dateStr
        }
      });
      setAptAvailableSlots(res.slots);
    } catch (e) {
      console.error("Failed to fetch slots:", e);
    } finally {
      setLoadingAptSlots(false);
    }
  };

  useEffect(() => {
    if (aptDoctorId && aptDateTime) {
      const dateOnly = aptDateTime.split("T")[0];
      fetchAptAvailableSlots(aptDoctorId, dateOnly);
    } else {
      setAptAvailableSlots([]);
    }
  }, [aptDoctorId, aptDateTime]);

  // Load doctors and departments dynamically when scheduling modal is active
  useEffect(() => {
    if (user && isSchedulingApt) {
      if (doctors.length === 0) {
        getDoctorsServerFn().then((res) => setDoctors(res)).catch(console.error);
      }
      if (departments.length === 0) {
        getDepartmentsServerFn().then((res) => setDepartments(res)).catch(console.error);
      }
    }
  }, [user, isSchedulingApt, doctors.length, departments.length]);


  // Clinic working hours save
  const handleSaveHours = async (e: React.FormEvent) => {
    e.preventDefault();
    setHoursSuccess("");
    setHoursError("");
    setSavingHours(true);
    try {
      const res = await saveClinicHoursServerFn({ data: clinicHours });
      if (res.success) {
        setHoursSuccess("Timetable saved successfully!");
      }
    } catch (err: any) {
      setHoursError(err.message || "Failed to save hours.");
    } finally {
      setSavingHours(false);
    }
  };

  const handleSaveWhatsAppConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setWaConfigSuccess("");
    setWaConfigError("");
    setSavingWaConfig(true);
    try {
      const res = await saveWhatsAppConfigServerFn({
        data: {
          phoneNumber: waConfigPhone,
          isEnabled: waConfigEnabled
        }
      });
      if (res.success) {
        setWaConfigSuccess("WhatsApp alert settings updated successfully!");
      }
    } catch (err: any) {
      setWaConfigError(err.message || "Failed to save WhatsApp settings.");
    } finally {
      setSavingWaConfig(false);
    }
  };

  const handleUpdateHourField = (dayIndex: number, field: string, value: any) => {
    setClinicHours((prev) =>
      prev.map((h) => (h.dayOfWeek === dayIndex ? { ...h, [field]: value } : h))
    );
  };

  // Departments CRUD handlers
  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptName.trim()) return;
    try {
      const res = await createDepartmentServerFn({ data: newDeptName.trim() });
      if (res.success) {
        setNewDeptName("");
        const refreshed = await getDepartmentsServerFn();
        setDepartments(refreshed);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteDept = async (id: string) => {
    try {
      const res = await deleteDepartmentServerFn({ data: id });
      if (res.success) {
        const refreshed = await getDepartmentsServerFn();
        setDepartments(refreshed);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Doctors CRUD handlers
  const handleOpenAddDoctor = () => {
    setEditingDoc(null);
    clearDocForm();
    setIsEditingDoc(true);
  };

  const handleOpenEditDoctor = (doc: any) => {
    setEditingDoc(doc);
    setDocName(doc.name);
    setDocEmail(doc.email);
    setDocPhone(doc.phone);
    setDocQualifications(doc.qualifications);
    setDocDeptId(doc.departmentId);
    setDocError("");
    setDocSuccess("");
    setIsEditingDoc(true);
  };

  const clearDocForm = () => {
    setDocName("");
    setDocEmail("");
    setDocPhone("");
    setDocQualifications("");
    setDocDeptId("");
    setDocError("");
    setDocSuccess("");
  };

  const handleSaveDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setDocError("");
    setDocSuccess("");
    if (!docName || !docEmail || !docPhone || !docQualifications || !docDeptId) {
      setDocError("All fields are required.");
      return;
    }
    setSavingDoc(true);
    try {
      const res = await saveDoctorServerFn({
        data: {
          id: editingDoc?.id,
          name: docName,
          email: docEmail,
          phone: docPhone,
          qualifications: docQualifications,
          departmentId: docDeptId
        }
      });
      if (res.success) {
        setDocSuccess(editingDoc ? "Doctor profile updated successfully!" : "Doctor registered successfully!");
        const refreshed = await getDoctorsServerFn();
        setDoctors(refreshed);
        setTimeout(() => {
          setIsEditingDoc(false);
          setEditingDoc(null);
          clearDocForm();
        }, 1200);
      }
    } catch (err: any) {
      setDocError(err.message || "Failed to save doctor details.");
    } finally {
      setSavingDoc(false);
    }
  };

  const handleDeleteDoctor = async (id: string) => {
    try {
      const res = await deleteDoctorServerFn({ data: id });
      if (res.success) {
        const refreshed = await getDoctorsServerFn();
        setDoctors(refreshed);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Doctor availability schedule handlers
  const handleEditDoctorSchedule = async (doc: any) => {
    setSelectedDocForSchedule(doc);
    setDocScheduleSuccess("");
    try {
      const res = await getDoctorScheduleServerFn({ data: doc.id });
      const scheduleMap = Array.from({ length: 7 }, (_, day) => {
        const existing = res.find((s: any) => s.dayOfWeek === day);
        return {
          dayOfWeek: day,
          startTime: existing ? existing.startTime : "09:00",
          endTime:   existing ? existing.endTime   : "17:00",
          slotDuration: existing ? existing.slotDuration : 30,
          enabled: !!existing,
          breaks: ((existing as any)?.breaks as {start:string;end:string;label:string}[]) ?? [],
        };
      });
      setDocSchedules(scheduleMap);
    } catch (e) {
      console.error(e);
    }
  };

  // ---- Break helpers ----
  const addBreakToDay = (dayOfWeek: number, br: {start:string;end:string;label:string}) => {
    setDocSchedules(prev => prev.map(s =>
      s.dayOfWeek === dayOfWeek ? { ...s, breaks: [...(s.breaks ?? []), br] } : s
    ));
  };
  const updateBreak = (dayOfWeek: number, bIdx: number, field: "start"|"end"|"label", value: string) => {
    setDocSchedules(prev => prev.map(s => {
      if (s.dayOfWeek !== dayOfWeek) return s;
      const updated = (s.breaks ?? []).map((b: any, i: number) => i === bIdx ? { ...b, [field]: value } : b);
      return { ...s, breaks: updated };
    }));
  };
  const removeBreak = (dayOfWeek: number, bIdx: number) => {
    setDocSchedules(prev => prev.map(s =>
      s.dayOfWeek === dayOfWeek ? { ...s, breaks: (s.breaks ?? []).filter((_: any, i: number) => i !== bIdx) } : s
    ));
  };
  const copyBreaksToDay = (fromDay: number, toDays: number[]) => {
    const srcBreaks = docSchedules.find(s => s.dayOfWeek === fromDay)?.breaks ?? [];
    setDocSchedules(prev => prev.map(s =>
      toDays.includes(s.dayOfWeek) ? { ...s, breaks: srcBreaks.map((b: any) => ({ ...b })) } : s
    ));
  };


  const handleUpdateScheduleField = (dayOfWeek: number, field: string, value: any) => {
    setDocSchedules((prev) =>
      prev.map((s) => (s.dayOfWeek === dayOfWeek ? { ...s, [field]: value } : s))
    );
  };

  const handleSaveDoctorSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setDocScheduleSuccess("");
    setSavingDocSchedule(true);
    try {
      const activeSchedules = docSchedules
        .filter((s) => s.enabled)
        .map((s) => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          slotDuration: parseInt(s.slotDuration),
          breaks: (s.breaks ?? []).filter((b: any) => b.start && b.end),
        }));

      const res = await saveDoctorScheduleServerFn({
        data: {
          doctorId: selectedDocForSchedule.id,
          schedules: activeSchedules
        }
      });
      if (res.success) {
        setDocScheduleSuccess("Doctor weekly availability saved successfully!");
        setTimeout(() => {
          setSelectedDocForSchedule(null);
        }, 1200);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setSavingDocSchedule(false);
    }
  };

  // Doctor leaves & holidays handlers
  const handleEditDoctorLeaves = async (doc: any) => {
    setSelectedDocForLeaves(doc);
    try {
      const res = await getDoctorLeavesServerFn({ data: doc.id });
      setDocLeaves(res);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddDoctorLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeaveDate || !newLeaveReason) return;
    setAddingLeave(true);
    try {
      const res = await addDoctorLeaveServerFn({
        data: {
          doctorId: selectedDocForLeaves.id,
          leaveDate: newLeaveDate,
          reason: newLeaveReason,
          isHoliday: newLeaveIsHoliday
        }
      });
      if (res.success) {
        setNewLeaveDate("");
        setNewLeaveReason("");
        setNewLeaveIsHoliday(false);
        const refreshed = await getDoctorLeavesServerFn({ data: selectedDocForLeaves.id });
        setDocLeaves(refreshed);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAddingLeave(false);
    }
  };

  const handleDeleteDoctorLeave = async (id: string) => {
    try {
      const res = await deleteDoctorLeaveServerFn({ data: id });
      if (res.success) {
        const refreshed = await getDoctorLeavesServerFn({ data: selectedDocForLeaves.id });
        setDocLeaves(refreshed);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // WhatsApp connection control handlers
  const handleDisconnectWhatsApp = async () => {
    try {
      await disconnectWhatsAppServerFn();
      fetchWhatsAppStatus();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendTestWa = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestWaSuccess("");
    setTestWaError("");
    if (!testWaPhone || !testWaBody) return;
    setSendingTestWa(true);
    try {
      await sendTestWaServerFn({ data: { phone: testWaPhone, message: testWaBody } });
      setTestWaSuccess("Message queued successfully! It will be sent within 8-15 seconds.");
      setTestWaBody("");
      setTimeout(fetchWhatsAppStatus, 3000);
    } catch (err: any) {
      setTestWaError(err.message || "Failed to queue test message.");
    } finally {
      setSendingTestWa(false);
    }
  };

  // ──────────────────────────────────────────────
  // 2. Advisor Scribe Logic
  // ──────────────────────────────────────────────
  useEffect(() => {
    if (isRecording) {
      recordIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (recordIntervalRef.current) {
        clearInterval(recordIntervalRef.current);
        recordIntervalRef.current = null;
      }
    }
    return () => {
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    };
  }, [isRecording]);

  // Initialize speech recognition wrapper
  const startSpeechRecognition = (targetSetter: (text: string) => void, interimSetter?: (text: string) => void) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech recognition is not supported in this browser.");
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      
      // Map scribeLanguage to locale
      let langCode = "en-US";
      if (scribeLanguage === "Spanish (Español)") langCode = "es-ES";
      else if (scribeLanguage === "French (Français)") langCode = "fr-FR";
      else if (scribeLanguage === "Hindi (हिन्दी)") langCode = "hi-IN";
      rec.lang = langCode;

      rec.onresult = (event: any) => {
        let finalTrans = "";
        let interimTrans = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTrans += event.results[i][0].transcript + " ";
          } else {
            interimTrans += event.results[i][0].transcript;
          }
        }
        if (finalTrans) {
          targetSetter(finalTrans);
        }
        if (interimSetter) {
          interimSetter(interimTrans);
        }
      };

      rec.onerror = (e: any) => {
        console.error("Speech recognition error:", e);
      };

      rec.start();
      recognitionRef.current = rec;
    } catch (e) {
      console.error("Failed to start speech recognition:", e);
    }
  };

  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error(e);
      }
      recognitionRef.current = null;
    }
  };

  const resolvePatientForApt = (apt: any) => {
    if (apt.patientId) {
      const match = patientsList.find(p => p.id === apt.patientId);
      if (match) return match.id;
    }
    const matchByNameOrEmail = patientsList.find(p =>
      p.name.toLowerCase() === apt.name.toLowerCase() ||
      p.email.toLowerCase() === apt.email.toLowerCase() ||
      p.phone === apt.phone
    );
    return matchByNameOrEmail ? matchByNameOrEmail.id : "";
  };

  const handleViewProfileForApt = async (apt: any) => {
    const pid = resolvePatientForApt(apt);
    if (pid) {
      const matched = patientsList.find(p => p.id === pid);
      if (matched) {
        setSelectedPatient(matched);
        return;
      }
      setLoadingPatients(true);
      try {
        const res = await getPatientChartServerFn({ data: { patientId: pid } });
        if (res && res.patient) {
          setSelectedPatient(res.patient);
          return;
        }
      } catch (e) {
        console.error("Failed to load chart:", e);
      } finally {
        setLoadingPatients(false);
      }
    }
    
    // Fallback client profile object for professional
    setSelectedPatient({
      id: apt.patientId || apt.id,
      name: apt.name,
      email: apt.email || "",
      phone: apt.phone || "",
      age: apt.age || 35,
      gender: apt.gender || "Female",
      dob: "",
      insurance: "Self-Pay / Online Booking",
      lastVisit: apt.dateTime,
      reason: apt.reason || "",
      status: apt.status || "Pending",
      notesHistory: []
    });
  };

  const matchDate = (dateTimeStr: string, dateStr: string) => {
    if (!dateTimeStr || !dateStr) return false;
    const aptDate = new Date(dateTimeStr);
    const targetDate = new Date(dateStr);
    return (
      aptDate.getFullYear() === targetDate.getFullYear() &&
      aptDate.getMonth() === targetDate.getMonth() &&
      aptDate.getDate() === targetDate.getDate()
    );
  };

  const handleExportConsultations = (format: "pdf" | "word" | "excel") => {
    try {
      const filteredList = appointments.filter((apt) => {
        const query = consultationSearchQuery.trim().toLowerCase();
        const matchSearch =
          !query ||
          (apt.name && apt.name.toLowerCase().includes(query)) ||
          (apt.email && apt.email.toLowerCase().includes(query)) ||
          (apt.phone && apt.phone.includes(query)) ||
          (apt.reason && apt.reason.toLowerCase().includes(query));

        const matchStatus = consultationStatus === "All" || apt.status === consultationStatus;
        const matchDateFilter = consultationShowAll || matchDate(apt.dateTime, consultationDate);
        const isFollowUp = apt.reason && apt.reason.toLowerCase().includes("follow");
        const matchSubTab = consultationSubTab === "followups" ? isFollowUp : !isFollowUp;

        return matchSearch && matchStatus && matchDateFilter && matchSubTab;
      });

      const listToExport = selectedAptIds.length > 0
        ? filteredList.filter(apt => selectedAptIds.includes(apt.id))
        : filteredList;

      if (listToExport.length === 0) {
        showToast("info", "No appointments to export.");
        return;
      }

      if (format === "excel") {
        const headers = ["Client Name", "Age", "Gender", "Phone", "Email", "Date & Time", "Business Goals", "Status"];
        const rows = listToExport.map(apt => {
          const aptDate = new Date(apt.dateTime);
          const formattedTime = aptDate.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          });
          return [
            apt.name || "",
            apt.age || "",
            apt.gender || "",
            apt.phone || "",
            apt.email || "",
            formattedTime,
            apt.reason || "",
            apt.status || ""
          ];
        });
        const csvContent = [headers.join(","), ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", url);
        downloadAnchor.setAttribute("download", `consultations_export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast("success", `Exported ${listToExport.length} appointments to Excel (CSV)`);
      } else if (format === "word") {
        const htmlContent = `
          <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
          <head>
            <meta charset="utf-8">
            <title>Clinic Appointments Export</title>
            <style>
              body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; line-height: 1.5; }
              h2 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 8px; }
              table { border-collapse: collapse; width: 100%; margin-top: 20px; }
              th { background-color: #f3f4f6; color: #1f2937; font-weight: bold; border: 1px solid #d1d5db; padding: 10px; text-align: left; }
              td { border: 1px solid #e5e7eb; padding: 10px; text-align: left; }
              .status-badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: bold; }
            </style>
          </head>
          <body>
            <h2>Clinic Appointments Export - ${new Date().toLocaleDateString()}</h2>
            <p>Total Records: ${listToExport.length}</p>
            <table>
              <thead>
                <tr>
                  <th>Client Name</th>
                  <th>Age/Gender</th>
                  <th>Contact Details</th>
                  <th>Date & Time</th>
                  <th>Business Goals</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${listToExport.map(apt => `
                  <tr>
                    <td><strong>${apt.name || ""}</strong></td>
                    <td>${apt.age ? `${apt.age} Yrs` : ""} ${apt.gender || ""}</td>
                    <td>${apt.phone || ""}<br/>${apt.email || ""}</td>
                    <td>${new Date(apt.dateTime).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>${apt.reason || "General consultation"}</td>
                    <td><span class="status-badge">${apt.status || "Pending"}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </body>
          </html>
        `;
        const blob = new Blob(['\ufeff' + htmlContent], { type: "application/msword" });
        const url = URL.createObjectURL(blob);
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", url);
        downloadAnchor.setAttribute("download", `consultations_export_${new Date().toISOString().split('T')[0]}.doc`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast("success", `Exported ${listToExport.length} appointments to Word`);
      } else if (format === "pdf") {
        const doc = new jsPDF();
        
        // Add header info
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(20);
        doc.setTextColor(12, 114, 114); // Dark teal matching brand color
        doc.text("BookMyTime Clinic", 14, 20);
        
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(11);
        doc.setTextColor(74, 85, 104);
        doc.text("Appointment Consultations Summary", 14, 26);
        
        doc.setFontSize(9);
        doc.setTextColor(113, 128, 150);
        doc.text(`Exported: ${new Date().toLocaleString()}`, 196, 20, { align: "right" });
        doc.text(`Records: ${listToExport.length}`, 196, 26, { align: "right" });
        
        // Add divider line
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(14, 32, 196, 32);
        
        // Build table data
        const tableHeaders = [["Patient Info", "Date & Time", "Business Goals", "Status"]];
        const tableRows = listToExport.map(apt => {
          const aptDate = new Date(apt.dateTime);
          const formattedTime = aptDate.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          });
          const patientInfoStr = `${apt.name || ""}\n${apt.age ? `${apt.age} Yrs` : ""} ${apt.gender ? `· ${apt.gender}` : ""} ${apt.phone ? `· ${apt.phone}` : ""}`;
          return [
            patientInfoStr,
            formattedTime,
            apt.reason || "General consultation",
            apt.status || "Pending"
          ];
        });
        
        (doc as any).autoTable({
          startY: 38,
          head: tableHeaders,
          body: tableRows,
          theme: "striped",
          headStyles: {
            fillColor: [12, 114, 114], // Brand color
            textColor: [255, 255, 255],
            fontSize: 10,
            fontStyle: "bold"
          },
          bodyStyles: {
            fontSize: 9,
            textColor: [45, 55, 72]
          },
          columnStyles: {
            0: { cellWidth: 60 },
            1: { cellWidth: 45 },
            2: { cellWidth: 50 },
            3: { cellWidth: 27 }
          },
          margin: { top: 38, left: 14, right: 14 }
        });
        
        doc.save(`consultations_export_${new Date().toISOString().split('T')[0]}.pdf`);
        showToast("success", `Exported ${listToExport.length} appointments to PDF`);
      }
    } catch (e) {
      showToast("error", "Export failed");
    }
  };

  const handleStartScribe = () => {
    setIsRecording(true);
    setRecordingSeconds(0);
    setScribeStep("listening");
    setLiveTranscript("");
    setSoapSubjective("");
    setSoapObjective("");
    setSoapAssessment("");
    setSoapPlan("");
    
    startSpeechRecognition((text) => {
      setLiveTranscript((prev) => prev + text);
    });
  };

  const handleStopScribe = async () => {
    setIsRecording(false);
    stopSpeechRecognition();
    setScribeStep("transcribing");

    if (!liveTranscript.trim()) {
      showToast("error", "No transcript captured. Please dictate or type some encounter details.");
      setScribeStep("idle");
      return;
    }

    try {
      const res = await generateSoapNoteServerFn({
        data: {
          transcript: liveTranscript,
          specialty: scribeSpecialty,
          language: scribeLanguage
        }
      });
      if (res.success) {
        setSoapSubjective(res.subjective);
        setSoapObjective(res.objective);
        setSoapAssessment(res.assessment);
        setSoapPlan(res.plan);
        setScribeStep("completed");
        showToast("success", "Clinical SOAP notes synthesized successfully!");
      }
    } catch (e: any) {
      console.error(e);
      showToast("error", e.message || "Failed to synthesize SOAP note.");
      setScribeStep("idle");
    }
  };

  const handleSyncToEhr = async (patientId?: string) => {
    const targetId = patientId || selectedPatient?.id || scribePatientId;
    if (!targetId) {
      showToast("error", "No patient selected to save SOAP note.");
      return;
    }

    try {
      const res = await saveSoapNoteServerFn({
        data: {
          patientId: targetId,
          specialty: scribeSpecialty,
          subjective: soapSubjective,
          objective: soapObjective,
          assessment: soapAssessment,
          plan: soapPlan,
          rawTranscript: liveTranscript
        }
      });
      if (res.success) {
        showToast("success", "SOAP note successfully saved to chart!");
        setScribeStep("idle");
        setSoapSubjective("");
        setSoapObjective("");
        setSoapAssessment("");
        setSoapPlan("");
        setLiveTranscript("");
        setRecordingSeconds(0);
        setScribePatientId("");

        // Refresh chart history if drawer is open
        if (selectedPatient && selectedPatient.id === targetId) {
          const chartRes = await getPatientChartServerFn({ data: { patientId: targetId } });
          setPatientChartData(chartRes);
        }
      }
    } catch (e: any) {
      console.error(e);
      showToast("error", e.message || "Failed to save SOAP note.");
    }
  };

  // Voice Prescription Actions
  const handleStartPrescriptionRecording = () => {
    setIsRecording(true);
    setRecordingSeconds(0);
    setPrescriptionInstructions("");
    setPrescriptionMedications([]);
    setPrescriptionNotes("");
    
    startSpeechRecognition((text) => {
      setPrescriptionInstructions((prev) => prev + text);
    });
  };

  const handleStopPrescriptionRecording = () => {
    setIsRecording(false);
    stopSpeechRecognition();
  };

  const handleGeneratePrescription = async () => {
    if (!prescriptionInstructions.trim()) {
      showToast("error", "Please record or type the prescription instructions first.");
      return;
    }

    setIsGeneratingPrescription(true);
    try {
      const res = await generatePrescriptionServerFn({
        data: {
          transcript: prescriptionInstructions,
          language: scribeLanguage
        }
      });

      if (res.success) {
        setPrescriptionMedications(res.medications || []);
        setPrescriptionNotes(res.notes || "");
        showToast("success", "Prescription parsed successfully by Gemini!");
      }
    } catch (e: any) {
      console.error(e);
      showToast("error", e.message || "Failed to parse prescription.");
    } finally {
      setIsGeneratingPrescription(false);
    }
  };

  const handleSavePrescription = async () => {
    const targetId = selectedPatient?.id || scribePatientId;
    if (!targetId) {
      showToast("error", "Please select a patient to assign this prescription.");
      return;
    }

    if (prescriptionMedications.length === 0) {
      showToast("error", "Prescription medications list is empty.");
      return;
    }

    setIsSavingPrescription(true);
    try {
      const res = await savePrescriptionServerFn({
        data: {
          patientId: targetId,
          medications: prescriptionMedications,
          notes: prescriptionNotes
        }
      });

      if (res.success) {
        showToast("success", "Prescription saved to patient chart!");
        setPrescriptionInstructions("");
        setPrescriptionMedications([]);
        setPrescriptionNotes("");
        setScribePatientId("");

        // Refresh chart history if drawer is open
        if (selectedPatient && selectedPatient.id === targetId) {
          const chartRes = await getPatientChartServerFn({ data: { patientId: targetId } });
          setPatientChartData(chartRes);
        }
      }
    } catch (e: any) {
      console.error(e);
      showToast("error", e.message || "Failed to save prescription.");
    } finally {
      setIsSavingPrescription(false);
    }
  };

  const toggleRecordingForField = (fieldName: string, setter: (text: string) => void) => {
    if (recordingField === fieldName) {
      setIsRecording(false);
      setRecordingField(null);
      stopSpeechRecognition();
    } else {
      if (recordingField) {
        stopSpeechRecognition();
      }
      setIsRecording(true);
      setRecordingField(fieldName);
      setRecordingSeconds(0);
      startSpeechRecognition(setter);
    }
  };

  const handleStartVoiceRx = () => {
    setIsVoiceRxModalOpen(true);
    setVoiceRxTranscript("");
    setVoiceRxInterim("");
    setVoiceRxResult(null);
    setIsVoiceRxAnalyzing(false);
    
    setIsRecording(true);
    setRecordingField("voiceRx");
    setRecordingSeconds(0);
    startSpeechRecognition(
      (text) => {
        setVoiceRxTranscript((prev) => prev + text);
        setVoiceRxInterim("");
      },
      (text) => setVoiceRxInterim(text)
    );
  };

  const handleStopVoiceRx = () => {
    setIsRecording(false);
    setRecordingField(null);
    setVoiceRxInterim("");
    stopSpeechRecognition();
  };

  const handleResumeVoiceRx = () => {
    setIsRecording(true);
    setRecordingField("voiceRx");
    setVoiceRxInterim("");
    startSpeechRecognition(
      (text) => {
        setVoiceRxTranscript((prev) => prev + text);
        setVoiceRxInterim("");
      },
      (text) => setVoiceRxInterim(text)
    );
  };

  const handleAnalyzeVoiceRx = async () => {
    // Ensure recording is stopped first
    setIsRecording(false);
    setRecordingField(null);
    setVoiceRxInterim("");
    stopSpeechRecognition();

    if (!voiceRxTranscript.trim()) {
      showToast("error", "No transcript captured yet. Please speak into the mic.");
      return;
    }

    setIsVoiceRxAnalyzing(true);
    try {
      const res = await voiceRxAnalyzeServerFn({
        data: {
          transcript: voiceRxTranscript
        }
      });

      if (res.success) {
        setVoiceRxResult({
          chiefComplaint: res.chiefComplaint,
          diagnosis: res.diagnosis,
          medications: res.medications,
          advice: res.advice
        });
        showToast("success", "Clinical audio parsed and analyzed by Gemini AI!");
      }
    } catch (e: any) {
      console.error(e);
      showToast("error", e.message || "Failed to analyze voice prescription.");
    } finally {
      setIsVoiceRxAnalyzing(false);
    }
  };

  const handleApplyVoiceRx = () => {
    if (!voiceRxResult) return;

    if (voiceRxResult.chiefComplaint) {
      setConsultationChiefComplaint(voiceRxResult.chiefComplaint);
    }
    if (voiceRxResult.diagnosis) {
      setConsultationDiagnosis(voiceRxResult.diagnosis);
    }
    if (voiceRxResult.advice) {
      setConsultationAdvice(voiceRxResult.advice);
    }
    if (voiceRxResult.medications) {
      setPrescriptionMedications(voiceRxResult.medications);
    }

    setIsVoiceRxModalOpen(false);
    setVoiceRxTranscript("");
    setVoiceRxResult(null);
    showToast("success", "Clinical prescription populated successfully!");
  };

  const handleAIAssist = async () => {
    if (!consultationChiefComplaint.trim()) {
      showToast("error", "Please enter a Business Goals before using AI Assist.");
      return;
    }

    setIsAIAssisting(true);
    try {
      const vitalsText = `BP: ${vitalBP}, Pulse: ${vitalPulse} bpm, Temp: ${vitalTemp}°F, Wt: ${vitalWeight} kg, Ht: ${vitalHeight} cm, SpO2: ${vitalSpO2}%, RR: ${vitalRespRate}/min`;
      const res = await aiAssistConsultationServerFn({
        data: {
          chiefComplaint: consultationChiefComplaint,
          vitals: vitalsText
        }
      });

      if (res.success) {
        setConsultationDiagnosis(res.diagnosis || "");
        setPrescriptionMedications(res.medications || []);
        setConsultationAdvice(res.advice || "");
        showToast("success", "Clinical prescription populated successfully by Gemini AI!");
      }
    } catch (e: any) {
      console.error(e);
      showToast("error", e.message || "Failed to generate AI recommendations.");
    } finally {
      setIsAIAssisting(false);
    }
  };


  // Professional: Save Advisory/Session Note (uses saveSoapNoteServerFn)
  const handleSaveAdvisoryEntry = async () => {
    if (!selectedPatient?.id) return;
    if (!advisoryClientInput.trim() && !advisoryObservations.trim()) {
      showToast("error", "Please fill in at least one field.");
      return;
    }
    setIsSavingAdvisory(true);
    try {
      const res = await saveSoapNoteServerFn({
        data: {
          patientId: selectedPatient.id,
          specialty: "Professional Consulting",
          subjective: advisoryClientInput,
          objective: advisoryObservations,
          assessment: advisoryAssessment,
          plan: advisoryNextSteps,
          rawTranscript: advisoryDate ? `Session Date: ${advisoryDate}` : ""
        }
      });
      if (res.success) {
        showToast("success", "Advisory session note saved successfully!");
        setAdvisoryClientInput("");
        setAdvisoryObservations("");
        setAdvisoryAssessment("");
        setAdvisoryNextSteps("");
        setAdvisoryDate("");
        setShowAddAdvisoryModal(false);
        // Refresh chart
        const chartRes = await getPatientChartServerFn({ data: { patientId: selectedPatient.id } });
        setPatientChartData(chartRes);
      }
    } catch (e: any) {
      showToast("error", e.message || "Failed to save advisory note.");
    } finally {
      setIsSavingAdvisory(false);
    }
  };

  // Professional: Save Action Plan Entry (reuses savePrescriptionServerFn)
  const handleSaveActionPlan = async () => {
    if (!selectedPatient?.id) return;
    const validDeliverables = actionPlanDeliverables.filter(d => d.name.trim());
    if (validDeliverables.length === 0) {
      showToast("error", "Please add at least one deliverable.");
      return;
    }
    setIsSavingActionPlan(true);
    try {
      const res = await savePrescriptionServerFn({
        data: {
          patientId: selectedPatient.id,
          medications: validDeliverables.map(d => ({
            name: d.name,
            dosage: d.sets ? `${d.sets} scope` : "",
            frequency: d.reps ? `${d.reps} notes` : "",
            route: "",
            duration: d.duration,
            instructions: ""
          })),
          notes: actionPlanNotes
        }
      });
      if (res.success) {
        showToast("success", "Action plan saved successfully!");
        setActionPlanDeliverables([{ name: "", sets: "", reps: "", duration: "" }]);
        setActionPlanNotes("");
        setShowAddActionPlanModal(false);
        // Refresh chart
        const chartRes = await getPatientChartServerFn({ data: { patientId: selectedPatient.id } });
        setPatientChartData(chartRes);
      }
    } catch (e: any) {
      showToast("error", e.message || "Failed to save action plan.");
    } finally {
      setIsSavingActionPlan(false);
    }
  };

  const handleSaveConsultationAndPrescription = async () => {
    const targetId = selectedPatient?.id || scribePatientId;
    if (!targetId) {
      showToast("error", "No patient selected for this consultation.");
      return;
    }

    setIsSavingPrescription(true);
    try {
      // 1. Save SOAP Note
      const vitalsText = `BP: ${vitalBP}, Pulse: ${vitalPulse} bpm, Temp: ${vitalTemp}°F, Wt: ${vitalWeight} kg, Ht: ${vitalHeight} cm, SpO2: ${vitalSpO2}%, RR: ${vitalRespRate}/min`;
      const planText = `Advice: ${consultationAdvice}\nFollow-up: ${consultationFollowUpDate ? `${consultationFollowUpDate} (${consultationFollowUpNotes})` : 'None'}\nLab Tests: ${consultationLabTests.map(t => t.name).join(', ') || 'None'}\nReferrals: ${consultationReferrals.map(r => r.departmentId).join(', ') || 'None'}`;
      
      await saveSoapNoteServerFn({
        data: {
          patientId: targetId,
          specialty: scribeSpecialty,
          subjective: consultationChiefComplaint,
          objective: vitalsText,
          assessment: consultationDiagnosis,
          plan: planText,
          rawTranscript: liveTranscript
        }
      });

      // 2. Save Prescription (if medications added)
      if (prescriptionMedications.length > 0) {
        await savePrescriptionServerFn({
          data: {
            patientId: targetId,
            medications: prescriptionMedications,
            notes: consultationAdvice
          }
        });
      }

      // 3. Mark appointment as completed
      if (selectedAptForConsultation) {
        await updateAppointmentServerFn({
          data: {
            ...selectedAptForConsultation,
            status: "Completed",
            reason: consultationChiefComplaint
          }
        });
      }

      showToast("success", "Prescription & Consultation saved successfully to patient chart!");
      
      // Reset form
      setConsultationChiefComplaint("");
      setConsultationDiagnosis("");
      setConsultationAdvice("");
      setPrescriptionMedications([]);
      setConsultationLabTests([]);
      setConsultationReferrals([]);
      setConsultationFollowUpDate("");
      setConsultationFollowUpNotes("");
      setConsultationPrivateNotes("");
      setSelectedAptForConsultation(null);

      // Refresh appointments and patients lists
      await fetchAppointments();
      await fetchPatients();
    } catch (e: any) {
      console.error(e);
      showToast("error", e.message || "Failed to save consultation.");
    } finally {
      setIsSavingPrescription(false);
    }
  };

  const handleDownloadPrescriptionPDF = () => {
    const doc = new jsPDF();
    const clinicName = user?.clinicName || "BookMyTime Medical Center";
    const doctorName = user?.name || "Dr. Staff Advisor";
    const doctorQualifications = (user as any)?.qualifications || "M.D., General Medicine";

    // Colors
    const primaryColor = [12, 114, 114]; // Brand dark teal
    const textDark = [33, 37, 41];
    const textGray = [100, 110, 120];

    // Header
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(clinicName, 14, 20);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(textGray[0], textGray[1], textGray[2]);
    doc.text("HEALTHCARE MANAGEMENT SYSTEM PRESCRIPTION PAD", 14, 26);

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    doc.text(doctorName, 196, 20, { align: "right" });

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(textGray[0], textGray[1], textGray[2]);
    doc.text(doctorQualifications, 196, 25, { align: "right" });

    // Divider
    doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setLineWidth(1.5);
    doc.line(14, 29, 196, 29);

    // Patient Details
    const targetPatient = patientsList.find(p => p.id === (selectedPatient?.id || scribePatientId)) || selectedPatient;
    const patientName = targetPatient?.name || selectedAptForConsultation?.name || "N/A";
    const patientID = targetPatient?.patientNo || selectedAptForConsultation?.patientId || "PT-TEMP";
    const patientPhone = targetPatient?.phone || selectedAptForConsultation?.phone || "N/A";
    const aptDate = selectedAptForConsultation?.dateTime ? new Date(selectedAptForConsultation.dateTime).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "N/A";
    const aptTime = selectedAptForConsultation?.timeSlot || "N/A";
    const aptToken = selectedAptForConsultation?.tokenNo ? `#${selectedAptForConsultation.tokenNo}` : "N/A";
    const aptType = selectedAptForConsultation?.appointmentType || "OPD";

    doc.setFillColor(248, 250, 252); // Light slate background
    doc.rect(14, 34, 182, 28, "F");
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.rect(14, 34, 182, 28, "D");

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    doc.text(`Patient: ${patientName}`, 18, 40);
    doc.text(`ID: ${patientID}`, 18, 46);
    doc.text(`Phone: ${patientPhone}`, 18, 52);

    doc.text(`Date: ${aptDate}`, 110, 40);
    doc.text(`Time: ${aptTime}`, 110, 46);
    doc.text(`Token: ${aptToken}`, 110, 52);
    doc.text(`Type: ${aptType}`, 110, 58);

    let currentY = 70;

    // Vitals Section
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text("PATIENT VITALS", 14, currentY);
    
    doc.setDrawColor(226, 232, 240);
    doc.line(14, currentY + 2, 196, currentY + 2);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    doc.text(`Blood Pressure: ${vitalBP} mmHg`, 14, currentY + 8);
    doc.text(`Pulse: ${vitalPulse} bpm`, 70, currentY + 8);
    doc.text(`Temp: ${vitalTemp}°F`, 120, currentY + 8);
    
    doc.text(`Weight: ${vitalWeight} kg`, 14, currentY + 14);
    doc.text(`Height: ${vitalHeight} cm`, 70, currentY + 14);
    doc.text(`SpO2: ${vitalSpO2}%`, 120, currentY + 14);
    doc.text(`Resp Rate: ${vitalRespRate}/min`, 160, currentY + 14);

    currentY += 22;

    // Business Goals & Diagnosis
    if (consultationChiefComplaint) {
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("CHIEF COMPLAINT", 14, currentY);
      doc.line(14, currentY + 2, 196, currentY + 2);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(textDark[0], textDark[1], textDark[2]);
      const ccLines = doc.splitTextToSize(consultationChiefComplaint, 182);
      doc.text(ccLines, 14, currentY + 7);
      currentY += (ccLines.length * 5) + 10;
    }

    if (consultationDiagnosis) {
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("PRIMARY DIAGNOSIS", 14, currentY);
      doc.line(14, currentY + 2, 196, currentY + 2);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(textDark[0], textDark[1], textDark[2]);
      const diagLines = doc.splitTextToSize(consultationDiagnosis, 182);
      doc.text(diagLines, 14, currentY + 7);
      currentY += (diagLines.length * 5) + 10;
    }

    // Rx Medications Table
    if (prescriptionMedications.length > 0) {
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("Rx (MEDICATIONS)", 14, currentY);
      doc.line(14, currentY + 2, 196, currentY + 2);

      const tableHeaders = [["Drug Name", "Dosage", "Frequency", "Route", "Duration", "Instructions"]];
      const tableRows = prescriptionMedications.map(m => [
        m.name,
        m.dosage,
        m.frequency,
        m.route,
        m.duration,
        m.instructions
      ]);

      (doc as any).autoTable({
        startY: currentY + 5,
        head: tableHeaders,
        body: tableRows,
        theme: "striped",
        headStyles: { fillColor: primaryColor },
        margin: { left: 14, right: 14 },
        styles: { fontSize: 8.5 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 12;
    }

    // Lab Tests
    if (consultationLabTests.length > 0) {
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("RECOMMENDED LAB TESTS", 14, currentY);
      doc.line(14, currentY + 2, 196, currentY + 2);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(textDark[0], textDark[1], textDark[2]);
      consultationLabTests.forEach((t, idx) => {
        doc.text(`${idx + 1}. ${t.name} ${t.instructions ? `(${t.instructions})` : ''}`, 14, currentY + 8 + (idx * 5));
      });
      currentY += (consultationLabTests.length * 5) + 12;
    }

    // Advice & Instructions
    if (consultationAdvice) {
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("ADVICE & INSTRUCTIONS", 14, currentY);
      doc.line(14, currentY + 2, 196, currentY + 2);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(textDark[0], textDark[1], textDark[2]);
      const adviceLines = doc.splitTextToSize(consultationAdvice, 182);
      doc.text(adviceLines, 14, currentY + 7);
      currentY += (adviceLines.length * 5) + 12;
    }

    // Follow-up
    if (consultationFollowUpDate) {
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("FOLLOW-UP DETAILS", 14, currentY);
      doc.line(14, currentY + 2, 196, currentY + 2);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(textDark[0], textDark[1], textDark[2]);
      doc.text(`Follow-up Date: ${new Date(consultationFollowUpDate).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}`, 14, currentY + 7);
      if (consultationFollowUpNotes) {
        doc.text(`Notes: ${consultationFollowUpNotes}`, 14, currentY + 12);
        currentY += 5;
      }
      currentY += 14;
    }

    // Signature Area
    const pageHeight = doc.internal.pageSize.height;
    if (currentY > pageHeight - 40) {
      doc.addPage();
      currentY = 30;
    }
    
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    doc.line(140, pageHeight - 30, 190, pageHeight - 30);
    doc.text("Authorized Signature", 140, pageHeight - 25);
    doc.setFont("Helvetica", "italic");
    doc.setFontSize(8);
    doc.text(doctorName, 140, pageHeight - 21);

    // Footer info
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(textGray[0], textGray[1], textGray[2]);
    doc.text("This is an electronically generated prescription. No physical signature required.", 14, pageHeight - 15);

    doc.save(`Prescription_${patientName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast("success", "Prescription downloaded successfully!");
  };

  const handlePrintPrescription = () => {
    const targetPatient = patientsList.find(p => p.id === (selectedPatient?.id || scribePatientId)) || selectedPatient;
    if (!targetPatient) {
      showToast("error", "Please select or search a patient before printing.");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showToast("error", "Pop-up blocker prevented printing. Please allow popups for this site.");
      return;
    }

    const clinicName = user?.clinicName || "BookMyTime Medical Center";
    const doctorName = user?.name || "Dr. Staff Advisor";
    const doctorQualifications = (user as any)?.qualifications || "M.D., General Medicine";

    const medsHtml = prescriptionMedications.map(m => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold;">${m.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${m.dosage}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${m.frequency}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${m.route}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${m.duration}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; font-style: italic; color: #555;">${m.instructions}</td>
      </tr>
    `).join("");

    const htmlContent = `
      <html>
      <head>
        <title>Prescription Pad - ${targetPatient.name}</title>
        <style>
          body { font-family: 'Inter', sans-serif; color: #333; margin: 40px; line-height: 1.5; }
          .header { border-bottom: 2px solid #10b981; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-start; }
          .clinic-info { text-align: right; }
          .doc-name { font-size: 20px; font-weight: bold; color: #111827; }
          .doc-title { font-size: 13px; color: #6b7280; font-weight: 600; text-transform: uppercase; margin-top: 4px; }
          .patient-info { background: #f9fafb; padding: 15px; border-radius: 8px; margin-bottom: 30px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 15px; border: 1px solid #e5e7eb; font-size: 13px; }
          .patient-info div { flex: 1 1 200px; }
          .rx-symbol { font-size: 40px; font-weight: bold; color: #10b981; margin-bottom: 20px; font-family: Georgia, serif; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 13px; }
          th { background: #f3f4f6; padding: 12px 10px; text-align: left; font-weight: bold; border-bottom: 2px solid #e5e7eb; color: #374151; }
          .notes { background: #fffbeb; border: 1px solid #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 40px; font-size: 13px; color: #78350f; }
          .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 80px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
          .signature-box { border-bottom: 1px solid #9ca3af; width: 200px; text-align: center; font-size: 13px; color: #374151; font-weight: bold; padding-bottom: 5px; }
          @media print {
            body { margin: 20px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="doc-name">${doctorName}</div>
            <div class="doc-title">${doctorQualifications}</div>
          </div>
          <div class="clinic-info">
            <div style="font-weight: bold; font-size: 16px; color: #10b981;">${clinicName}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">BookMyTime EHR Automated Prescription</div>
          </div>
        </div>
        
        <div class="patient-info">
          <div><strong>Patient:</strong> ${targetPatient.name}</div>
          <div><strong>ID:</strong> ${targetPatient.id || targetPatient.patientNo || 'N/A'}</div>
          <div><strong>Age/Gender:</strong> ${targetPatient.age ? targetPatient.age + ' yrs' : 'N/A'} / ${targetPatient.gender || 'N/A'}</div>
          <div><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>

        <div class="rx-symbol">Rₓ</div>

        <table>
          <thead>
            <tr>
              <th>Medication</th>
              <th>Dosage</th>
              <th>Frequency</th>
              <th>Route</th>
              <th>Duration</th>
              <th>Instructions</th>
            </tr>
          </thead>
          <tbody>
            ${medsHtml}
          </tbody>
        </table>

        ${prescriptionNotes ? `
          <div class="notes">
            <strong>Clinical Directions:</strong><br/>
            ${prescriptionNotes}
          </div>
        ` : ''}

        <div class="footer">
          <div>Generated securely via BookMyTime Clinical Workspace</div>
          <div>
            <div class="signature-box">Signature Authorized</div>
            <div style="text-align: center; margin-top: 5px; font-size: 11px;">${doctorName}</div>
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
          }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // ──────────────────────────────────────────────
  // 3. Database & Patient Addition
  // ──────────────────────────────────────────────
  const handleAddPatientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientName || !newPatientAge) return;
    setSavingPatient(true);
    try {
      if (editingPatient) {
        const res = await updatePatientServerFn({
          data: {
            id: editingPatient.id,
            name: newPatientName,
            age: parseInt(newPatientAge),
            gender: newPatientGender,
            phone: newPatientPhone || null,
            email: newPatientEmail || null,
            address: newPatientAddress || null,
            chiefComplaint: newPatientReason,
            notes: newPatientNotes || null
          }
        });
        if (res.success) {
          showToast("success", "Patient profile updated successfully!");
          clearPatientForm();
          setIsAddingPatient(false);
          fetchPatients();
        }
      } else {
        const res = await createPatientServerFn({
          data: {
            name: newPatientName,
            age: parseInt(newPatientAge),
            gender: newPatientGender,
            phone: newPatientPhone || null,
            email: newPatientEmail || null,
            address: newPatientAddress || null,
            chiefComplaint: newPatientReason,
            notes: newPatientNotes || null
          }
        });
        if (res.success) {
          showToast("success", `Patient file created with ID ${res.patientNo}`);
          clearPatientForm();
          setIsAddingPatient(false);
          fetchPatients();
        }
      }
    } catch (err: any) {
      console.error("Failed to save patient:", err);
      showToast("error", err.message || "Failed to save patient record");
    } finally {
      setSavingPatient(false);
    }
  };

  const clearPatientForm = () => {
    setNewPatientName("");
    setNewPatientAge("");
    setNewPatientGender("Female");
    setNewPatientPhone("");
    setNewPatientEmail("");
    setNewPatientAddress("");
    setNewPatientReason("");
    setNewPatientNotes("");
    setEditingPatient(null);
  };

  const handleLogout = async () => {
    try {
      await logoutServerFn();
      navigate({ to: "/login" });
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const formatMonth = (monthStr: string) => {
    if (!monthStr) return "";
    try {
      const [year, month] = monthStr.split("-");
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      return date.toLocaleDateString("en-US", { month: "short" });
    } catch (e) {
      return monthStr;
    }
  };

  const getWeekRangeLabel = (date: Date) => {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay()); // Sunday
    const end = new Date(start);
    end.setDate(end.getDate() + 6); // Saturday

    const formatMonthDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const formatYear = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric" });

    if (start.getFullYear() !== end.getFullYear()) {
      return `${formatMonthDay(start)}, ${start.getFullYear()} – ${formatMonthDay(end)}, ${end.getFullYear()}`;
    }
    return `${formatMonthDay(start)} – ${formatMonthDay(end)}, ${formatYear(start)}`;
  };

  const handlePrevDate = () => {
    setCurrentCalendarDate((prev) => {
      const copy = new Date(prev);
      if (calendarView === "month") {
        copy.setMonth(copy.getMonth() - 1);
      } else if (calendarView === "week") {
        copy.setDate(copy.getDate() - 7);
      } else {
        copy.setDate(copy.getDate() - 1);
      }
      return copy;
    });
  };

  const handleNextDate = () => {
    setCurrentCalendarDate((prev) => {
      const copy = new Date(prev);
      if (calendarView === "month") {
        copy.setMonth(copy.getMonth() + 1);
      } else if (calendarView === "week") {
        copy.setDate(copy.getDate() + 7);
      } else {
        copy.setDate(copy.getDate() + 1);
      }
      return copy;
    });
  };

  const handleGoToday = () => {
    setCurrentCalendarDate(new Date());
  };

  const handleDragStart = (e: React.DragEvent, aptId: string) => {
    e.dataTransfer.setData("text/plain", aptId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDropAppointment = async (e: React.DragEvent, targetDay: Date, targetHour: number) => {
    e.preventDefault();
    const aptId = e.dataTransfer.getData("text/plain");
    if (!aptId) return;

    const apt = appointments.find((a) => a.id === aptId);
    if (!apt) return;

    // Construct new date object keeping minutes
    const originalDate = new Date(apt.dateTime);
    const targetDate = new Date(targetDay);
    targetDate.setHours(targetHour, originalDate.getMinutes(), 0, 0);

    // Formatted timeSlot
    const formattedHour = targetHour % 12 === 0 ? 12 : targetHour % 12;
    const ampm = targetHour >= 12 ? "PM" : "AM";
    const timeSlotStr = `${String(formattedHour).padStart(2, "0")}:${String(originalDate.getMinutes()).padStart(2, "0")} ${ampm}`;

    try {
      const res = await updateAppointmentServerFn({
        data: {
          id: apt.id,
          name: apt.name,
          email: apt.email,
          phone: apt.phone,
          dateTime: targetDate.toISOString(),
          reason: apt.reason,
          status: apt.status,
          doctorId: apt.doctorId,
          timeSlot: timeSlotStr
        }
      });

      if (res.success) {
        showToast("success", `Rescheduled ${apt.name} to ${targetDay.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${timeSlotStr}`);
        await fetchAppointments();
      }
    } catch (err: any) {
      showToast("error", err.message || "Failed to reschedule appointment.");
    }
  };

  const getWeekDates = (date: Date) => {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay()); // Sunday
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const getMonthDaysGrid = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDayOfWeek = firstDay.getDay(); // 0 is Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Get previous month padding days
    const prevMonthDays = [];
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      prevMonthDays.push(new Date(year, month - 1, prevMonthLastDay - i));
    }

    // Current month days
    const currentMonthDays = [];
    for (let i = 1; i <= daysInMonth; i++) {
      currentMonthDays.push(new Date(year, month, i));
    }

    // Next month padding days to round to 42 cells (6 rows * 7 days)
    const totalDays = prevMonthDays.length + currentMonthDays.length;
    const nextPaddingCount = 42 - totalDays;
    const nextMonthDays = [];
    for (let i = 1; i <= nextPaddingCount; i++) {
      nextMonthDays.push(new Date(year, month + 1, i));
    }

    return [...prevMonthDays, ...currentMonthDays, ...nextMonthDays];
  };

  const renderWeekView = () => {
    const weekDates = getWeekDates(currentCalendarDate);
    const hours = Array.from({ length: 11 }, (_, i) => i + 8); // 8am to 6pm

    return (
      <div className="min-w-[800px] border border-zinc-200 rounded-3xl overflow-hidden bg-white text-xs select-none">
        {/* Header row */}
        <div className="grid grid-cols-8 border-b border-zinc-150 bg-zinc-50 font-bold text-zinc-650 h-12 items-center text-center uppercase tracking-wider text-[10px]">
          <div className="border-r border-zinc-150 h-full flex items-center justify-center font-extrabold text-zinc-400">Time</div>
          {weekDates.map((day, idx) => {
            const isDayToday = isToday(day);
            return (
              <div
                key={idx}
                className={`h-full flex flex-col justify-center border-r border-zinc-150 last:border-0 ${
                  isDayToday ? "bg-brand/5 text-brand" : ""
                }`}
              >
                <span>{day.toLocaleDateString("en-US", { weekday: "short" })}</span>
                <span className="text-[9px] font-bold text-zinc-400 mt-0.5">
                  {day.getMonth() + 1}/{day.getDate()}
                </span>
              </div>
            );
          })}
        </div>

        {/* Hours grid */}
        <div className="divide-y divide-zinc-150">
          {hours.map((hour) => {
            const ampmLabel = hour === 12 ? "12pm" : hour > 12 ? `${hour - 12}pm` : `${hour}am`;
            return (
              <div key={hour} className="grid grid-cols-8 min-h-[64px] items-stretch relative">
                {/* Hour label */}
                <div className="border-r border-zinc-150 flex items-center justify-center font-bold text-zinc-400 bg-zinc-50 text-[10px] uppercase">
                  {ampmLabel}
                </div>

                {/* Day columns */}
                {weekDates.map((day, idx) => {
                  const slotAppointments = appointments.filter((apt) => {
                    const aptDate = new Date(apt.dateTime);
                    const matchDate =
                      aptDate.getFullYear() === day.getFullYear() &&
                      aptDate.getMonth() === day.getMonth() &&
                      aptDate.getDate() === day.getDate();
                    const matchHour = aptDate.getHours() === hour;
                    return matchDate && matchHour && apt.status !== "Cancelled";
                  });

                  const isDayToday = isToday(day);

                  return (
                    <div
                      key={idx}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDropAppointment(e, day, hour)}
                      className={`border-r border-zinc-150 last:border-0 p-1 flex gap-1.5 overflow-hidden min-h-[64px] relative group/cell hover:bg-zinc-50/50 transition-colors ${
                        isDayToday ? "bg-zinc-50/20" : ""
                      }`}
                    >
                      {slotAppointments.map((apt) => {
                        const colors: Record<string, string> = {
                          Pending: "bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100/80",
                          Confirmed: "bg-teal-50 text-teal-800 border-brand/20 hover:bg-teal-100/80",
                          Completed: "bg-zinc-100 text-zinc-800 border-zinc-200 hover:bg-zinc-200/70",
                          Cancelled: "bg-red-50 text-red-800 border-red-200 hover:bg-red-100/80",
                          "No Show": "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100/80",
                        };
                        const dotColors: Record<string, string> = {
                          Pending: "bg-sky-500",
                          Confirmed: "bg-brand",
                          Completed: "bg-zinc-500",
                          Cancelled: "bg-red-500",
                          "No Show": "bg-amber-500",
                        };
                        const statusClass = colors[apt.status] || "bg-indigo-50 text-indigo-800 border-indigo-200";
                        const dotClass = dotColors[apt.status] || "bg-indigo-500";

                        const aptTime = new Date(apt.dateTime);
                        const formattedStart = aptTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

                        return (
                          <div
                            key={apt.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, apt.id)}
                            onClick={() => setSelectedAptDetails(apt)}
                            className={`flex-1 rounded-xl border p-2 flex flex-col justify-between text-left cursor-grab active:cursor-grabbing select-none transition-all relative group/card border-l-[4px] shadow-none ${statusClass}`}
                            title={`${apt.name}: ${apt.reason}`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1 truncate">
                                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
                                  <span className="text-[10px] font-black text-zinc-800 truncate">
                                    {apt.name}
                                  </span>
                                </div>
                                {apt.tokenNo && (
                                  <span className="inline-flex items-center justify-center px-1 py-0.2 rounded bg-brand/5 border border-brand/15 text-brand text-[8px] font-black shrink-0">
                                    #{apt.tokenNo}
                                  </span>
                                )}
                              </div>

                              <div className="text-[8px] font-bold text-zinc-500 flex flex-wrap gap-1 leading-none uppercase">
                                <span>{formattedStart}</span>
                                {apt.appointmentType && (
                                  <>
                                    <span>•</span>
                                    <span className="text-zinc-400">{apt.appointmentType}</span>
                                  </>
                                )}
                              </div>

                              {apt.reason && (
                                <p className="text-[9px] text-zinc-650 font-semibold truncate leading-tight">
                                  {apt.reason}
                                </p>
                              )}
                            </div>

                            <div className="mt-1.5 flex items-center justify-between text-[8px] font-bold text-zinc-450 leading-none">
                              <span className="truncate bg-zinc-50 border border-zinc-150 px-1 py-0.2 rounded">
                                {doctors.find(d => d.id === apt.doctorId)?.name || "Unassigned"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const day = currentCalendarDate;
    const hours = Array.from({ length: 11 }, (_, i) => i + 8); // 8am to 6pm

    return (
      <div className="max-w-2xl mx-auto border border-zinc-200 rounded-3xl overflow-hidden bg-white text-xs select-none">
        {/* Header row */}
        <div className="grid grid-cols-5 border-b border-zinc-150 bg-zinc-50 font-bold text-zinc-650 h-12 items-center text-center uppercase tracking-wider text-[10px]">
          <div className="border-r border-zinc-150 h-full flex items-center justify-center font-extrabold text-zinc-400">Time</div>
          <div className="col-span-4 h-full flex flex-col justify-center bg-brand/5 text-brand">
            <span>{day.toLocaleDateString("en-US", { weekday: "long" })}</span>
            <span className="text-[9px] font-bold text-zinc-450 mt-0.5">
              {day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
        </div>

        {/* Hours grid */}
        <div className="divide-y divide-zinc-150">
          {hours.map((hour) => {
            const ampmLabel = hour === 12 ? "12pm" : hour > 12 ? `${hour - 12}pm` : `${hour}am`;
            return (
              <div key={hour} className="grid grid-cols-5 min-h-[64px] items-stretch relative">
                {/* Hour label */}
                <div className="border-r border-zinc-150 flex items-center justify-center font-bold text-zinc-400 bg-zinc-50 text-[10px] uppercase">
                  {ampmLabel}
                </div>

                {/* Day Column */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDropAppointment(e, day, hour)}
                  className="col-span-4 p-1.5 flex gap-2 overflow-hidden min-h-[64px] hover:bg-zinc-50/50 transition-colors"
                >
                  {appointments
                    .filter((apt) => {
                      const aptDate = new Date(apt.dateTime);
                      const matchDate =
                        aptDate.getFullYear() === day.getFullYear() &&
                        aptDate.getMonth() === day.getMonth() &&
                        aptDate.getDate() === day.getDate();
                      const matchHour = aptDate.getHours() === hour;
                      return matchDate && matchHour && apt.status !== "Cancelled";
                    })
                    .map((apt) => {
                      const colors: Record<string, string> = {
                        Pending: "bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100/80",
                        Confirmed: "bg-teal-50 text-teal-800 border-brand/20 hover:bg-teal-100/80",
                        Completed: "bg-zinc-100 text-zinc-800 border-zinc-200 hover:bg-zinc-200/70",
                        Cancelled: "bg-red-50 text-red-800 border-red-200 hover:bg-red-100/80",
                        "No Show": "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100/80",
                      };
                      const dotColors: Record<string, string> = {
                        Pending: "bg-sky-500",
                        Confirmed: "bg-brand",
                        Completed: "bg-zinc-500",
                        Cancelled: "bg-red-500",
                        "No Show": "bg-amber-500",
                      };
                      const statusClass = colors[apt.status] || "bg-indigo-50 text-indigo-800 border-indigo-200";
                      const dotClass = dotColors[apt.status] || "bg-indigo-500";

                      const aptTime = new Date(apt.dateTime);
                      const formattedTime = aptTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

                      return (
                        <div
                          key={apt.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, apt.id)}
                          onClick={() => setSelectedAptDetails(apt)}
                          className={`flex-1 rounded-xl border p-3 flex flex-col justify-between text-left cursor-grab active:cursor-grabbing border-l-[4px] transition-all hover:bg-white/85 shadow-none ${statusClass}`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
                                <span className="text-xs font-black text-zinc-800 leading-none">
                                  {apt.name}
                                </span>
                              </div>
                              {apt.tokenNo && (
                                <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-brand/5 border border-brand/20 text-brand text-[9px] font-black leading-none shrink-0">
                                  Token #{apt.tokenNo}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500 font-semibold leading-relaxed">
                              <div>
                                <span className="text-zinc-400 block text-[8px] uppercase font-bold tracking-wider">Scheduled Time</span>
                                <span className="text-zinc-700 font-bold">{formattedTime} ({apt.appointmentType || "Standard"})</span>
                              </div>
                              <div>
                                <span className="text-zinc-400 block text-[8px] uppercase font-bold tracking-wider">Assigned Advisor</span>
                                <span className="text-zinc-700 font-bold">
                                  {doctors.find(d => d.id === apt.doctorId)?.name || "Unassigned"}
                                </span>
                              </div>
                            </div>

                            {apt.reason && (
                              <div className="bg-zinc-50/50 p-2 rounded-lg border border-zinc-150/40">
                                <span className="text-zinc-400 block text-[8px] uppercase font-bold tracking-wider">Business Goals</span>
                                <p className="text-[10px] text-zinc-600 font-semibold mt-0.5 leading-tight">
                                  {apt.reason}
                                </p>
                              </div>
                            )}
                          </div>
                          
                          <div className="mt-3 pt-2 border-t border-zinc-100 flex items-center justify-between">
                            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">
                              Status: {apt.status}
                            </span>
                            <span className="text-[9px] font-bold text-zinc-455 truncate">
                              ID: {apt.id.substring(0,8).toUpperCase()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMonthView = () => {
    const monthDays = getMonthDaysGrid(currentCalendarDate);
    const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
      <div className="min-w-[700px] border border-zinc-200 rounded-3xl overflow-hidden bg-white text-xs select-none">
        {/* Week headers */}
        <div className="grid grid-cols-7 border-b border-zinc-150 bg-zinc-50 font-bold text-zinc-650 h-10 items-center text-center uppercase tracking-wider text-[10px]">
          {weekDays.map((day) => (
            <div key={day} className="border-r border-zinc-150 last:border-0 h-full flex items-center justify-center font-extrabold text-zinc-400">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days grid */}
        <div className="grid grid-cols-7 divide-y divide-x divide-zinc-150">
          {monthDays.map((day, idx) => {
            const isDayToday = isToday(day);
            const isCurrentMonth = day.getMonth() === currentCalendarDate.getMonth();
            
            // Filter appointments for this date
            const dayAppointments = appointments.filter((apt) => {
              const aptDate = new Date(apt.dateTime);
              return (
                aptDate.getFullYear() === day.getFullYear() &&
                aptDate.getMonth() === day.getMonth() &&
                aptDate.getDate() === day.getDate() &&
                apt.status !== "Cancelled"
              );
            }).sort((a,b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

            return (
              <div
                key={idx}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDropAppointment(e, day, 9)} // Drop on day defaults to 9 AM
                className={`min-h-[104px] p-2 flex flex-col justify-between text-left hover:bg-zinc-50/50 transition-colors ${
                  isCurrentMonth ? "bg-white" : "bg-zinc-50/30 text-zinc-400"
                } ${isDayToday ? "bg-brand/5" : ""}`}
              >
                {/* Day number */}
                <div className="flex justify-between items-center">
                  <span
                    className={`h-6 w-6 flex items-center justify-center font-bold text-[10px] rounded-full ${
                      isDayToday ? "bg-black text-white animate-pulse" : isCurrentMonth ? "text-zinc-800" : "text-zinc-400"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {dayAppointments.length > 0 && (
                    <span className="text-[9px] font-black text-brand bg-brand/5 border border-brand/10 rounded-full px-1.5 py-0.2">
                      {dayAppointments.length}
                    </span>
                  )}
                </div>

                {/* Compact list of appointments */}
                <div className="space-y-1.5 mt-2 flex-1 flex flex-col justify-end">
                  {dayAppointments.slice(0, 3).map((apt) => {
                    const dotColors: Record<string, string> = {
                      Pending: "bg-sky-500",
                      Confirmed: "bg-brand",
                      Completed: "bg-zinc-500",
                      Cancelled: "bg-red-500",
                      "No Show": "bg-amber-500",
                    };
                    const dotClass = dotColors[apt.status] || "bg-indigo-500";
                    const aptTime = new Date(apt.dateTime);
                    const timeStr = aptTime.toLocaleTimeString([], { hour: "numeric", hour12: true }).replace(" ", "");

                    return (
                      <div
                        key={apt.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, apt.id)}
                        onClick={() => setSelectedAptDetails(apt)}
                        className="flex items-center gap-1.5 p-0.5 rounded hover:bg-zinc-100 cursor-grab text-[9px] font-bold text-zinc-700 truncate"
                        title={`${apt.name}: ${apt.reason}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
                        {apt.tokenNo && (
                          <span className="text-zinc-450 font-black shrink-0">
                            #{apt.tokenNo}
                          </span>
                        )}
                        <span className="text-zinc-400 font-semibold">{timeStr}</span>
                        <span className="truncate">{apt.name}</span>
                      </div>
                    );
                  })}
                  {dayAppointments.length > 3 && (
                    <div className="text-[8px] font-bold text-zinc-400 uppercase text-center mt-1">
                      + {dayAppointments.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Filter patients based on query
  const filteredPatients = patientsList.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.reason.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ──────────────────────────────────────────────
  // Render Loading / Authenticating state
  // ──────────────────────────────────────────────
  if (checkingAuth) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-brand" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-zinc-50 font-sans text-zinc-900 relative">
      {/* Mobile Drawer (Sidebar Overlay) */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-zinc-950 z-50 md:hidden backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 bg-white border-r border-zinc-200 p-5 flex flex-col justify-between z-55 md:hidden shadow-2xl"
            >
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center px-4">
                    <img src={bmtLogo} alt="BookMyTime Logo" className="h-14 w-auto object-contain" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="p-1.5 rounded-full hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
                  >
                    <X className="h-4.5 w-4.5" />
                  </button>
                </div>



                <nav className="space-y-1">
                  {[
                    { id: "overview", label: "Overview", icon: LayoutDashboard },
                    { id: "scribe", label: "Consultation", icon: ClipboardCheck },
                    { id: "calendar", label: "Calendar", icon: Calendar },
                    { id: "appointments", label: "Appointments List", icon: ClipboardList },
                    { id: "patients", label: "Client Records", icon: Users },
                    { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
                    { id: "settings", label: "Settings", icon: Settings },
                    { id: "plans", label: "Manage Plans", icon: CreditCard },
                  ].filter(tab => {
                    const fa = featureAccess[tab.id as FeatureId];
                    if (fa && !fa.visible) return false;
                    return true;
                  }).map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        type="button"
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id as any);
                          setSelectedPatient(null);
                          setPatientChartData(null);
                          setIsMobileMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold transition-all duration-250 cursor-pointer active:scale-[0.98] ${
                          active
                            ? "bg-zinc-950 text-white shadow-sm"
                            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </button>
                    );
                  })}
                </nav>
              </div>
              {/* Sidebar Footer */}
              <div className="space-y-3">
                {/* Advisor Card — clickable opens profile modal */}
                <button
                  type="button"
                  onClick={() => { setActiveTab("settings"); setSettingsSubTab("profile"); setIsMobileMenuOpen(false); }}
                  className="w-full rounded-2xl bg-zinc-50 border border-zinc-200/60 p-3 flex items-center gap-3 hover:bg-brand/5 hover:border-brand/20 transition-colors cursor-pointer text-left group"
                >
                  <div className="h-9 w-9 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center text-brand font-bold text-xs shrink-0 group-hover:bg-brand/20 transition-colors overflow-hidden">
                    {user?.profilePhoto ? (
                      <img src={user.profilePhoto} alt={user.name} className="h-full w-full object-cover" />
                    ) : (
                      user?.name ? user.name.split(" ").map((n: string) => n[0]).slice(0,2).join("").toUpperCase() : "Dr"
                    )}
                  </div>
                  <div className="overflow-hidden text-left flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-zinc-850 truncate leading-tight">
                      {user?.name || "Dr. Advisor"}
                    </h4>
                    <span className="text-[9px] font-medium text-zinc-400 truncate block">
                      {user?.clinicName || "Medical Group"}
                    </span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-brand shrink-0 transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold text-red-650 hover:bg-red-50 cursor-pointer text-red-600 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ──────────────────────────────────────────────
          1. Sidebar Navigation Layout
          ────────────────────────────────────────────── */}
      <aside className="hidden w-64 border-r border-zinc-200 bg-white p-4 flex-col justify-between md:flex">
        <div className="space-y-6">
          {/* Brand Logo Header */}
          <div className="flex items-center px-4">
            <img src={bmtLogo} alt="BookMyTime Logo" className="h-14 w-auto object-contain" />
          </div>



          {/* Navigation Links */}
          <nav className="space-y-1">
            {[
              { id: "overview", label: "Overview", icon: LayoutDashboard },
              { id: "scribe", label: "Consultation", icon: ClipboardCheck },
              { id: "calendar", label: "Calendar", icon: Calendar },
              { id: "appointments", label: "Appointments List", icon: ClipboardList },
              { id: "patients", label: "Client Records", icon: Users },
              { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
              { id: "settings", label: "Settings", icon: Settings },
              { id: "plans", label: "Manage Plans", icon: CreditCard },
            ].filter(tab => {
              const fa = featureAccess[tab.id as FeatureId];
              if (fa && !fa.visible) return false;
              return true;
            }).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id as any); setSelectedPatient(null); setPatientChartData(null); }}
                  className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                    active
                      ? "bg-zinc-950 text-white shadow-sm"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="space-y-3">
          {/* Advisor Card — clickable opens profile modal */}
          <button
            type="button"
            onClick={() => { setActiveTab("settings"); setSettingsSubTab("profile"); }}
            className="w-full rounded-2xl bg-zinc-50 border border-zinc-200/60 p-3 flex items-center gap-3 hover:bg-brand/5 hover:border-brand/20 transition-colors cursor-pointer text-left group"
          >
            <div className="h-9 w-9 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center text-brand font-bold text-xs shrink-0 group-hover:bg-brand/20 transition-colors overflow-hidden">
              {user?.profilePhoto ? (
                <img src={user.profilePhoto} alt={user.name} className="h-full w-full object-cover" />
              ) : (
                user?.name ? user.name.split(" ").map((n: string) => n[0]).slice(0,2).join("").toUpperCase() : "Dr"
              )}
            </div>
            <div className="overflow-hidden text-left flex-1 min-w-0">
              <h4 className="text-xs font-bold text-zinc-850 truncate leading-tight">
                {user?.name || "Dr. Advisor"}
              </h4>
              <span className="text-[9px] font-medium text-zinc-400 truncate block">
                {user?.clinicName || "Medical Group"}
              </span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-brand shrink-0 transition-colors" />
          </button>

          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold text-red-650 hover:bg-red-50 cursor-pointer text-red-600 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ──────────────────────────────────────────────
          2. Main Content Workspace Area
          ────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header Strip */}
         <header className="h-16 border-b border-zinc-200 bg-white px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile Menu Button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-1.5 rounded-xl border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 cursor-pointer active:scale-95 transition-all"
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
          </div>

          {/* Right side — profile */}
          <div className="flex items-center gap-2.5">
            {/* Profile pill */}
            <button
              type="button"
              onClick={() => { setActiveTab("settings"); setSettingsSubTab("profile"); }}
              className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 px-2.5 py-1.5 transition-colors cursor-pointer group"
            >
              {/* Avatar */}
              <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-[11px] font-black shrink-0 overflow-hidden"
                style={{ background: user?.profilePhoto ? "transparent" : "linear-gradient(135deg, #14b8a6 0%, #6366f1 100%)" }}>
                {user?.profilePhoto ? (
                  <img src={user.profilePhoto} alt={user.name} className="h-full w-full object-cover" />
                ) : (
                  user?.name ? user.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase() : "DR"
                )}
              </div>
              {/* Name + role */}
              <div className="text-left hidden sm:block">
                <p className="text-xs font-bold text-zinc-900 leading-tight truncate max-w-[80px]">
                  {user?.name ? user.name.split(" ")[0] + "." : "Dr."}
                </p>
                <p className="text-[10px] text-zinc-400 leading-tight truncate max-w-[80px]">
                  {user?.role === "admin" ? "Hosp. Admin" : user?.role || "Doctor"}
                </p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-zinc-400 rotate-90 hidden sm:block group-hover:text-zinc-600 transition-colors" />
            </button>
          </div>
        </header>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <AnimatePresence mode="wait">
            {selectedPatient ? (
              <motion.div
                key="patient-profile-detail"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-6 animate-fade-in"
              >
                  {/* Header Section */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 pb-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedPatient(null)}
                        className="px-4 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-bold rounded-full cursor-pointer flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                      >
                        ← Back to List
                      </button>
                      <div>
                        <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2">
                          {patientDetails.name}
                          <span className="text-[10px] bg-brand/10 border border-brand/20 text-brand px-2.5 py-0.5 rounded-full font-bold uppercase">
                            Client Profile
                          </span>
                        </h3>
                        <p className="text-[10px] text-zinc-450 font-mono mt-0.5">Client ID: {patientDetails.id}</p>
                      </div>
                    </div>
                    
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          const matchedPatient = patientsList.find(p => p.id === patientDetails.id);
                          if (matchedPatient) {
                            setEditingPatient(matchedPatient);
                            setNewPatientName(matchedPatient.name);
                            setNewPatientAge(String(matchedPatient.age));
                            setNewPatientGender(matchedPatient.gender);
                            setNewPatientPhone(matchedPatient.phone || "");
                            setNewPatientEmail(matchedPatient.email || "");
                            setNewPatientAddress(matchedPatient.address || "");
                            setNewPatientReason(matchedPatient.chiefComplaint || matchedPatient.reason || "");
                            setNewPatientNotes(matchedPatient.notes || "");
                            setIsAddingPatient(true);
                            setActiveTab("patients");
                            setSelectedPatient(null);
                          } else {
                            setEditingPatient(patientDetails);
                            setNewPatientName(patientDetails.name);
                            setNewPatientAge(String(patientDetails.age || 35));
                            setNewPatientGender(patientDetails.gender || "Female");
                            setNewPatientPhone(patientDetails.phone || "");
                            setNewPatientEmail(patientDetails.email || "");
                            setNewPatientAddress(patientDetails.address || "");
                            setNewPatientReason(patientDetails.chiefComplaint || patientDetails.reason || "");
                            setNewPatientNotes(patientDetails.notes || "");
                            setIsAddingPatient(true);
                            setActiveTab("patients");
                            setSelectedPatient(null);
                          }
                        }}
                        className="px-4 py-2 border border-zinc-200 hover:bg-zinc-50 bg-white text-zinc-700 text-xs font-bold rounded-full cursor-pointer transition-all shadow-sm active:scale-95 flex items-center gap-1.5"
                      >
                        <Edit3 className="h-3.5 w-3.5 text-zinc-500" /> Edit Client Profile
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-3">
                    {/* Left Column: Demographics */}
                    <div className="lg:col-span-1 space-y-4">
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 space-y-4 shadow-sm">
                        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide border-b border-zinc-100 pb-2">
                          Client Information
                        </h4>
                        
                        <div className="space-y-3.5 text-xs text-left">
                          <div>
                            <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Full Name</span>
                            <span className="font-bold text-zinc-800">{patientDetails.name}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Age</span>
                              <span className="font-bold text-zinc-800">{patientDetails.age} Years</span>
                            </div>
                            <div>
                              <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Gender</span>
                              <span className="font-bold text-zinc-800">{patientDetails.gender}</span>
                            </div>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Date of Birth</span>
                            <span className="font-bold text-zinc-800">{patientDetails.dob || "Not Provided"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Phone Number</span>
                            <span className="font-bold text-zinc-800">{patientDetails.phone || "Not Provided"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Email Address</span>
                            <span className="font-bold text-zinc-800 truncate block">{patientDetails.email || "Not Provided"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">WhatsApp No</span>
                            <span className="font-bold text-zinc-800">{patientDetails.whatsapp || patientDetails.phone || "Not Provided"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Blood Group</span>
                            <span className="font-bold text-zinc-800 uppercase">{patientDetails.bloodGroup || "Unknown"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Insurance Provider</span>
                            <span className="font-bold text-zinc-800">{patientDetails.insurance || "None (Self Pay)"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Residential Address</span>
                            <span className="font-semibold text-zinc-700 leading-normal block">{patientDetails.address || "Not Provided"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9px] font-bold uppercase tracking-tight">Onboarding Date</span>
                            <span className="font-mono text-zinc-500 block">
                              {patientDetails.createdAt ? new Date(patientDetails.createdAt).toLocaleDateString() : new Date().toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                  {/* Right Column: History Tabs (Consultations, Prescriptions, Billing) */}
                  <div className="lg:col-span-2 space-y-4">
                    {/* Navigation Sub-Tabs */}
                    <div className="flex items-center gap-2 bg-zinc-100 p-1 rounded-xl w-max">
                      {[
                        { id: "consultations", label: "Consultation History" },
                        { id: "prescriptions", label: "Action Plans" }
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setPatientProfileTab(t.id as any)}
                          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                            patientProfileTab === t.id
                              ? "bg-black text-white shadow-sm"
                              : "text-zinc-500 hover:text-zinc-900"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* Tab content view */}
                    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 space-y-4 shadow-sm min-h-[400px]">
                      
                                            {/* CONSULTATION HISTORY */}
                      {patientProfileTab === "consultations" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                            <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                              Past Consultation &amp; Advisory Notes
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowAddAdvisoryModal(!showAddAdvisoryModal)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-black text-white text-[10px] font-bold hover:bg-black/90 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                            >
                              <Plus className="h-3 w-3" />
                              Add Advisory Note
                            </button>
                          </div>

                          {/* Inline Add Advisory Entry Form */}
                          {showAddAdvisoryModal && (
                            <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4 space-y-3 text-xs">
                              <h5 className="text-[10px] font-black text-brand uppercase tracking-wider">New Consultation/Advisory Note</h5>
                              <div className="grid grid-cols-1 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Session Date</label>
                                  <input
                                    type="date"
                                    value={advisoryDate}
                                    onChange={e => setAdvisoryDate(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 focus:outline-none focus:border-brand transition-all"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Client Input / Objectives</label>
                                  <textarea
                                    rows={2}
                                    placeholder="e.g. Wants to design tax structure, optimize business operations"
                                    value={advisoryClientInput}
                                    onChange={e => setAdvisoryClientInput(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Consultant Findings &amp; Observations</label>
                                  <textarea
                                    rows={2}
                                    placeholder="e.g. Tax liability is high, overhead operations need standardization"
                                    value={advisoryObservations}
                                    onChange={e => setAdvisoryObservations(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Advisory Assessment &amp; Focus</label>
                                    <textarea
                                      rows={2}
                                      placeholder="e.g. Corporate structuring, financial compliance"
                                      value={advisoryAssessment}
                                      onChange={e => setAdvisoryAssessment(e.target.value)}
                                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Next Steps / Deliverables</label>
                                    <textarea
                                      rows={2}
                                      placeholder="e.g. Prepare LLC operating agreement, submit Q3 tax filings"
                                      value={advisoryNextSteps}
                                      onChange={e => setAdvisoryNextSteps(e.target.value)}
                                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleSaveAdvisoryEntry}
                                  disabled={isSavingAdvisory}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-black text-white text-[10px] font-bold hover:bg-black/90 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  {isSavingAdvisory ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  {isSavingAdvisory ? "Saving..." : "Save Note"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowAddAdvisoryModal(false); setAdvisoryClientInput(""); setAdvisoryObservations(""); setAdvisoryAssessment(""); setAdvisoryNextSteps(""); setAdvisoryDate(""); }}
                                  className="px-4 py-2 rounded-full border border-zinc-200 text-zinc-500 text-[10px] font-bold hover:bg-zinc-50 transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {patientChartData === null ? (
                            <div className="flex items-center justify-center py-12">
                              <Loader2 className="h-6 w-6 animate-spin text-brand" />
                            </div>
                          ) : !patientChartData.soapNotes || patientChartData.soapNotes.length === 0 ? (
                            <div className="py-12 text-center text-zinc-400 italic text-xs">
                              No consultation or advisory notes logged yet. Click "Add Advisory Note" to get started.
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {patientChartData.soapNotes.map((note: any, idx: number) => (
                                <div key={note.id || idx} className="rounded-xl border border-zinc-150 bg-zinc-50/20 p-4 space-y-3 text-xs shadow-sm text-left">
                                  <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                                    <span className="font-extrabold text-zinc-700">
                                      {new Date(note.createdAt).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                      })}
                                    </span>
                                    <span className="font-black text-brand uppercase tracking-wider text-[10px] px-2 py-0.5 bg-brand/5 border border-brand/10 rounded-full">
                                      {note.specialty || "Professional Consulting"}
                                    </span>
                                  </div>
                                  <div className="grid gap-3 leading-relaxed">
                                    {note.subjective && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Client Objectives</strong>
                                        <p className="text-zinc-700">{note.subjective}</p>
                                      </div>
                                    )}
                                    {note.objective && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Consultant Findings &amp; Observations</strong>
                                        <p className="text-zinc-700">{note.objective}</p>
                                      </div>
                                    )}
                                    {note.assessment && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Advisory Assessment</strong>
                                        <p className="text-zinc-700">{note.assessment}</p>
                                      </div>
                                    )}
                                    {note.plan && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Next Steps / Deliverables</strong>
                                        <p className="text-zinc-700">{note.plan}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                                            {/* PRESCRIPTIONS */}
                      {patientProfileTab === "prescriptions" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                            <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                              Action &amp; Advisory Plans
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowAddActionPlanModal(!showAddActionPlanModal)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                            >
                              <Plus className="h-3 w-3" />
                              Add Action Plan
                            </button>
                          </div>

                          {/* Inline Add Action Plan Form */}
                          {showAddActionPlanModal && (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-4 text-xs">
                              <h5 className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">New Action Plan</h5>

                              {/* Deliverable Rows */}
                              <div className="space-y-2">
                                <div className="grid grid-cols-12 gap-1.5 text-[9px] font-black text-zinc-400 uppercase tracking-wider">
                                  <div className="col-span-5">Deliverable</div>
                                  <div className="col-span-2">Scope / Detail</div>
                                  <div className="col-span-2">Notes</div>
                                  <div className="col-span-2">Target Date</div>
                                  <div className="col-span-1"></div>
                                </div>
                                {actionPlanDeliverables.map((d, dIdx) => (
                                  <div key={dIdx} className="grid grid-cols-12 gap-1.5">
                                    <input
                                      type="text"
                                      placeholder="e.g. Operating Agreement"
                                      value={d.name}
                                      onChange={e => {
                                        const updated = [...actionPlanDeliverables];
                                        updated[dIdx] = { ...updated[dIdx], name: e.target.value };
                                        setActionPlanDeliverables(updated);
                                      }}
                                      className="col-span-5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Full draft"
                                      value={d.sets}
                                      onChange={e => {
                                        const updated = [...actionPlanDeliverables];
                                        updated[dIdx] = { ...updated[dIdx], sets: e.target.value };
                                        setActionPlanDeliverables(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Review with board"
                                      value={d.reps}
                                      onChange={e => {
                                        const updated = [...actionPlanDeliverables];
                                        updated[dIdx] = { ...updated[dIdx], reps: e.target.value };
                                        setActionPlanDeliverables(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Oct 15"
                                      value={d.duration}
                                      onChange={e => {
                                        const updated = [...actionPlanDeliverables];
                                        updated[dIdx] = { ...updated[dIdx], duration: e.target.value };
                                        setActionPlanDeliverables(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <div className="col-span-1 flex items-center justify-center">
                                      {actionPlanDeliverables.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => setActionPlanDeliverables(actionPlanDeliverables.filter((_, i) => i !== dIdx))}
                                          className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setActionPlanDeliverables([...actionPlanDeliverables, { name: "", sets: "", reps: "", duration: "" }])}
                                  className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-bold hover:text-emerald-700 transition-colors cursor-pointer"
                                >
                                  <Plus className="h-3 w-3" /> Add Deliverable
                                </button>
                              </div>

                              {/* Notes */}
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Consultant Notes / Directions</label>
                                <textarea
                                  rows={2}
                                  placeholder="e.g. Align stakeholders before the draft submission. Review local compliance rules."
                                  value={actionPlanNotes}
                                  onChange={e => setActionPlanNotes(e.target.value)}
                                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all resize-none"
                                />
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleSaveActionPlan}
                                  disabled={isSavingActionPlan}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  {isSavingActionPlan ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  {isSavingActionPlan ? "Saving..." : "Save Plan"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowAddActionPlanModal(false); setActionPlanDeliverables([{ name: "", sets: "", reps: "", duration: "" }]); setActionPlanNotes(""); }}
                                  className="px-4 py-2 rounded-full border border-zinc-200 text-zinc-500 text-[10px] font-bold hover:bg-zinc-50 transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {patientChartData === null ? (
                            <div className="flex items-center justify-center py-12">
                              <Loader2 className="h-6 w-6 animate-spin text-brand" />
                            </div>
                          ) : !patientChartData.prescriptions || patientChartData.prescriptions.length === 0 ? (
                            <div className="py-12 text-center text-zinc-400 italic text-xs">
                              No action plans mapped to this client profile. Click "Add Action Plan" to create one.
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {patientChartData.prescriptions.map((rx: any, idx: number) => (
                                <div key={rx.id || idx} className="rounded-xl border border-zinc-150 bg-zinc-50/20 p-4 space-y-3 shadow-sm text-xs text-left">
                                  <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                                    <span className="font-extrabold text-zinc-700">
                                      {new Date(rx.createdAt).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                      })}
                                    </span>
                                    <span className="font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-0.5 text-[9px] uppercase tracking-wide">
                                      Action Plan
                                    </span>
                                  </div>
                                  
                                  <div className="space-y-3">
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-left border-collapse text-[11px]">
                                        <thead>
                                          <tr className="border-b border-zinc-150 text-zinc-400 font-extrabold uppercase">
                                            <th className="py-1.5">Deliverable</th>
                                            <th className="py-1.5">Scope / Detail</th>
                                            <th className="py-1.5">Notes</th>
                                            <th className="py-1.5">Target Date</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 text-zinc-700 font-medium">
                                          {rx.medications.map((m: any, mIdx: number) => (
                                            <tr key={mIdx}>
                                              <td className="py-1.5 font-bold text-zinc-800">{m.name}</td>
                                              <td className="py-1.5">{m.dosage}</td>
                                              <td className="py-1.5">{m.frequency}</td>
                                              <td className="py-1.5">{m.duration}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    {rx.notes && (
                                      <p className="text-[11px] text-zinc-650 border-t border-zinc-100 pt-2 leading-relaxed">
                                        <strong className="text-[9px] font-bold uppercase text-zinc-400 block mb-0.5">Consultant Notes</strong>
                                        {rx.notes}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}


                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <>
                {/* ──────────────────────────────────────────────
                    TAB: OVERVIEW
                    ────────────────────────────────────────────── */}
                {activeTab === "overview" && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-6"
              >
                {/* 1. Statistics Cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {loadingStats ? (
                    Array.from({ length: 4 }).map((_, idx) => (
                      <div key={idx} className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-3 animate-pulse">
                        <div className="flex justify-between items-center">
                          <div className="h-2.5 w-24 bg-zinc-100 rounded" />
                          <div className="h-7 w-7 bg-zinc-100 rounded-lg" />
                        </div>
                        <div className="space-y-1.5">
                          <div className="h-5 w-32 bg-zinc-200 rounded" />
                          <div className="h-2 w-28 bg-zinc-100 rounded" />
                        </div>
                      </div>
                    ))
                  ) : (
                    [
                      { label: "Today's Schedule", value: `${dashboardStats?.todayCounts?.total || 0} Bookings`, info: `${dashboardStats?.todayCounts?.pending || 0} pending review`, icon: Calendar, color: "text-brand bg-brand/5 border-brand/10" },
                      { label: "Total Active Clients", value: `${dashboardStats?.totalPatients || 0} Clients`, info: "Registered in directory", icon: Users, color: "text-amber-600 bg-amber-50 border-amber-100" },
                      { label: "All-Time Appointments", value: `${dashboardStats?.allTimeCounts?.total || 0} Bookings`, info: `${dashboardStats?.allTimeCounts?.confirmed || 0} confirmed, ${dashboardStats?.allTimeCounts?.completed || 0} completed`, icon: ClipboardList, color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
                      { label: "Completion Rate", value: `${dashboardStats?.allTimeCounts?.total - dashboardStats?.allTimeCounts?.cancelled > 0 ? Math.round((dashboardStats?.allTimeCounts?.completed / (dashboardStats?.allTimeCounts?.total - dashboardStats?.allTimeCounts?.cancelled)) * 100) : 0}%`, info: "Completed vs cancelled", icon: TrendingUp, color: "text-indigo-600 bg-indigo-50 border-indigo-100" }
                    ].map((stat, idx) => {
                      const Icon = stat.icon;
                      return (
                        <div key={idx} className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold tracking-tight text-zinc-400 uppercase">
                              {stat.label}
                            </span>
                            <div className={`p-1.5 rounded-lg border ${stat.color}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                          </div>
                          <div>
                            <h3 className="text-lg font-extrabold text-zinc-900 leading-none">
                              {stat.value}
                            </h3>
                            <p className="text-[10px] font-semibold text-zinc-400 mt-1">
                              {stat.info}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 1.5. Interactive Analytics Charts Section */}
                <div className="grid gap-6 md:grid-cols-2">
                  {/* Chart A: Volume Trend */}
                  <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                          Appointment Volume Trends
                        </h4>
                        <p className="text-[10px] text-zinc-400 mt-0.5">Clinical consultation velocity over time</p>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-0.5">
                        Live Analytics
                      </span>
                    </div>

                    <div className="h-[240px] w-full">
                      {isClient && !loadingAnalytics && analyticsData ? (
                        analyticsData.monthlyTrend && analyticsData.monthlyTrend.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={analyticsData.monthlyTrend.map((t: any) => ({
                              name: formatMonth(t.month),
                              "Appointments": t.count,
                            }))}
                            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient id="colorAppointments" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#0f766e" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#0f766e" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                            <XAxis
                              dataKey="name"
                              stroke="#a1a1aa"
                              fontSize={10}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis
                              stroke="#a1a1aa"
                              fontSize={10}
                              tickLine={false}
                              axisLine={false}
                              allowDecimals={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "rgba(255, 255, 255, 0.9)",
                                border: "1px solid #e4e4e7",
                                borderRadius: "12px",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                                fontSize: "11px",
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey="Appointments"
                              stroke="#0f766e"
                              strokeWidth={2.5}
                              fillOpacity={1}
                              fill="url(#colorAppointments)"
                              animationDuration={1500}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                        ) : (
                          <div className="h-full w-full bg-zinc-50/60 rounded-xl flex flex-col items-center justify-center text-center px-4">
                            <BarChart3 className="h-7 w-7 text-zinc-300 mb-2" />
                            <p className="text-xs font-semibold text-zinc-500">No appointment data yet</p>
                            <p className="text-[10px] text-zinc-400 mt-0.5">Trends will appear here once you start receiving bookings.</p>
                          </div>
                        )
                      ) : (
                        <div className="h-full w-full bg-zinc-50 rounded-xl flex items-center justify-center animate-pulse">
                          <Loader2 className="h-6 w-6 text-zinc-300 animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chart B: Donut Breakdown */}
                  <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                          Appointment Distribution
                        </h4>
                        <p className="text-[10px] text-zinc-400 mt-0.5">Real-time status and outcome metrics</p>
                      </div>
                      <span className="text-[10px] font-bold text-zinc-500 bg-zinc-50 border border-zinc-200/50 rounded-full px-2.5 py-0.5">
                        Performance
                      </span>
                    </div>

                    <div className="h-[240px] w-full flex items-center justify-center relative">
                      {isClient && !loadingAnalytics && analyticsData ? (
                        analyticsData.statusBreakdown && analyticsData.statusBreakdown.length > 0 ? (
                        <div className="w-full h-full flex flex-col sm:flex-row items-center justify-center gap-4">
                          <div className="relative w-[160px] h-[160px] shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={analyticsData.statusBreakdown.map((s: any) => ({
                                    name: s.status === "Pending" ? "Pending Review" : s.status,
                                    value: s.count,
                                  }))}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={50}
                                  outerRadius={70}
                                  paddingAngle={3}
                                  dataKey="value"
                                  animationDuration={1200}
                                >
                                  {analyticsData.statusBreakdown.map((entry: any, index: number) => {
                                    const colors: Record<string, string> = {
                                      Completed: "#10b981",
                                      Confirmed: "#0f766e",
                                      Pending: "#f59e0b",
                                      Cancelled: "#ef4444",
                                    };
                                    const color = colors[entry.status] || "#6366f1";
                                    return <Cell key={`cell-${index}`} fill={color} />;
                                  })}
                                </Pie>
                                <Tooltip
                                  contentStyle={{
                                    background: "rgba(255, 255, 255, 0.9)",
                                    border: "1px solid #e4e4e7",
                                    borderRadius: "12px",
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                                    fontSize: "11px",
                                  }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Total</span>
                              <span className="text-xl font-extrabold text-zinc-800">
                                {analyticsData.scorecard?.totalAppointments || 0}
                              </span>
                            </div>
                          </div>

                          {/* Custom legend for status breakdown */}
                          <div className="flex flex-wrap sm:flex-col gap-2.5 text-[11px] justify-center sm:justify-start">
                            {[
                              { label: "Completed", color: "#10b981" },
                              { label: "Confirmed", color: "#0f766e" },
                              { label: "Pending", color: "#f59e0b" },
                              { label: "Cancelled", color: "#ef4444" },
                            ].map((item) => {
                              const match = analyticsData.statusBreakdown?.find(
                                (s: any) => s.status === item.label
                              );
                              const count = match ? match.count : 0;
                              return (
                                <div key={item.label} className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                                  <span className="font-semibold text-zinc-600">{item.label}:</span>
                                  <span className="font-bold text-zinc-850">{count}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        ) : (
                          <div className="h-full w-full bg-zinc-50/60 rounded-xl flex flex-col items-center justify-center text-center px-4">
                            <BarChart3 className="h-7 w-7 text-zinc-300 mb-2" />
                            <p className="text-xs font-semibold text-zinc-500">No appointment data yet</p>
                            <p className="text-[10px] text-zinc-400 mt-0.5">Status breakdown will appear once appointments are recorded.</p>
                          </div>
                        )
                      ) : (
                        <div className="h-full w-full bg-zinc-50 rounded-xl flex items-center justify-center animate-pulse">
                          <Loader2 className="h-6 w-6 text-zinc-300 animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </motion.div>
            )}

            {activeTab === "calendar" && (
              <motion.div
                key="calendar"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-6"
              >
                {/* Calendar Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 pb-4 bg-white p-6 rounded-3xl border border-zinc-200/50">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-brand/10 text-brand border border-brand/10">
                        <Calendar className="h-4.5 w-4.5 animate-pulse" />
                      </div>
                      <h3 className="text-base font-extrabold text-zinc-900 leading-none">
                        Calendar Schedule
                      </h3>
                    </div>
                    <p className="text-[10px] text-zinc-400 font-semibold tracking-wide uppercase">
                      Drag to reschedule • Click to view details
                    </p>
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap items-center gap-3.5 text-[10px] font-bold">
                    {[
                      { label: "Booked", color: "bg-sky-500" },
                      { label: "Confirmed", color: "bg-brand" },
                      { label: "Completed", color: "bg-zinc-500" },
                      { label: "Cancelled", color: "bg-red-500" },
                      { label: "No Show", color: "bg-amber-500" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-1.5">
                        <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
                        <span className="text-zinc-500">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Calendar Grid & Workspace Wrapper */}
                <div className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-6">
                  {/* Controls Header Row */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-zinc-100 pb-4">
                    {/* Navigation Controls */}
                    <div className="flex items-center gap-2.5">
                      <div className="inline-flex rounded-full border border-zinc-200 p-0.5 bg-zinc-50">
                        <button
                          type="button"
                          onClick={handlePrevDate}
                          className="p-1.5 rounded-full hover:bg-white text-zinc-650 transition-all cursor-pointer"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={handleNextDate}
                          className="p-1.5 rounded-full hover:bg-white text-zinc-650 transition-all cursor-pointer"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleGoToday}
                        className="rounded-full border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-bold px-4 py-2 transition-all cursor-pointer"
                      >
                        today
                      </button>
                    </div>

                    {/* Date Label Title */}
                    <h4 className="text-sm md:text-base font-extrabold text-zinc-800">
                      {calendarView === "month" && currentCalendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      {calendarView === "week" && getWeekRangeLabel(currentCalendarDate)}
                      {calendarView === "day" && currentCalendarDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
                    </h4>

                    {/* View Toggle Switches */}
                    <div className="inline-flex rounded-full border border-zinc-200 p-0.5 bg-zinc-50">
                      {(["month", "week", "day"] as const).map((view) => (
                        <button
                          key={view}
                          type="button"
                          onClick={() => setCalendarView(view)}
                          className={`text-[10px] font-bold px-4 py-1.5 rounded-full capitalize transition-all cursor-pointer ${
                            calendarView === view
                              ? "bg-zinc-950 text-white shadow-sm"
                              : "text-zinc-500 hover:text-zinc-800"
                          }`}
                        >
                          {view}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* View Grid Layout */}
                  <div className="overflow-x-auto w-full">
                    {calendarView === "week" && renderWeekView()}
                    {calendarView === "day" && renderDayView()}
                    {calendarView === "month" && renderMonthView()}
                  </div>
                </div>
              </motion.div>
            )}


            {/* ──────────────────────────────────────────────
                TAB: CLIENT RECORDS (PATIENTS)
                ────────────────────────────────────────────── */}
            {activeTab === "patients" && (
              <motion.div
                key="patients"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  {/* Search Bar */}
                  <div className="relative flex-1 min-w-[240px]">
                    <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Search client registry by name, ID, or goals..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all font-semibold"
                    />
                  </div>

                  {/* Add Client trigger */}
                  <button
                    onClick={() => setIsAddingPatient(!isAddingPatient)}
                    className="rounded-full bg-zinc-950 hover:bg-zinc-850 text-white text-xs font-semibold px-4 py-2 flex items-center gap-1.5 cursor-pointer transition-transform active:scale-[0.98]"
                  >
                    <Plus className="h-4 w-4" /> Add Client File
                  </button>
                </div>

                {/* Add Client Card Form */}
                <AnimatePresence>
                  {isAddingPatient && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <form onSubmit={handleAddPatientSubmit} className="rounded-2xl border border-zinc-200 bg-white p-5 grid gap-4 sm:grid-cols-4 items-end">
                        <div className="sm:col-span-4 font-bold text-xs text-zinc-800 border-b border-zinc-100 pb-2 mb-2">
                          {editingPatient ? `Edit Client Registry File (${editingPatient.patientNo})` : "Create New Client Registry File"}
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Client Name</label>
                          <input
                            type="text"
                            value={newPatientName}
                            onChange={(e) => setNewPatientName(e.target.value)}
                            placeholder="John Doe"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand font-semibold"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Age</label>
                          <input
                            type="number"
                            value={newPatientAge}
                            onChange={(e) => setNewPatientAge(e.target.value)}
                            placeholder="34"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand font-semibold"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Gender</label>
                          <select
                            value={newPatientGender}
                            onChange={(e) => setNewPatientGender(e.target.value)}
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand cursor-pointer font-bold"
                          >
                            <option>Female</option>
                            <option>Male</option>
                            <option>Other</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Phone Number</label>
                          <input
                            type="tel"
                            value={newPatientPhone}
                            onChange={(e) => setNewPatientPhone(e.target.value)}
                            placeholder="919876543210"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand font-semibold"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Email Address</label>
                          <input
                            type="email"
                            value={newPatientEmail}
                            onChange={(e) => setNewPatientEmail(e.target.value)}
                            placeholder="client@example.com"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand font-semibold"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-3">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Residential Address</label>
                          <input
                            type="text"
                            value={newPatientAddress}
                            onChange={(e) => setNewPatientAddress(e.target.value)}
                            placeholder="123 Main St, Apartment 4B"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand font-semibold"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Primary Consulting Goal</label>
                          <input
                            type="text"
                            value={newPatientReason}
                            onChange={(e) => setNewPatientReason(e.target.value)}
                            placeholder="Financial planning, legal advice, career coaching, etc."
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand font-semibold"
                            required
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Business Background / Context</label>
                          <input
                            type="text"
                            value={newPatientNotes}
                            onChange={(e) => setNewPatientNotes(e.target.value)}
                            placeholder="Prior consulting history, business constraints, etc."
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand font-semibold"
                          />
                        </div>
                        <div className="sm:col-span-4 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              clearPatientForm();
                              setIsAddingPatient(false);
                            }}
                            className="text-xs font-semibold text-zinc-400 hover:text-zinc-655 px-3 py-1 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={savingPatient}
                            className="rounded-full bg-black text-white text-xs font-semibold px-5 py-2.5 cursor-pointer shadow-md disabled:bg-zinc-150 disabled:text-zinc-400 flex items-center gap-1.5"
                          >
                            {savingPatient && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {editingPatient ? "Update Client Profile" : "Create Client Profile"}
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Client Table Grid / Card Grid */}
                <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                  {loadingPatients ? (
                    <div className="p-6 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-zinc-400 mb-2" />
                      <p className="text-xs text-zinc-400">Loading registry profiles...</p>
                    </div>
                  ) : filteredPatients.length === 0 ? ( (() => {
                    const confirmedApts = appointments.filter(apt => apt.status === "Confirmed");
                    if (confirmedApts.length === 0) {
                      return (
                        <div className="p-8 text-center bg-white rounded-2xl">
                          <Users className="mx-auto h-8 w-8 text-zinc-300 mb-2" />
                          <p className="text-xs text-zinc-400 font-bold">No client profiles match your query.</p>
                        </div>
                      );
                    }
                    
                    return (
                      <div className="space-y-4">
                        <div className="bg-zinc-50 border-b border-zinc-150 px-6 py-3 flex items-center justify-between">
                          <h4 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                            <ClipboardCheck className="h-4 w-4 text-emerald-500" />
                            Confirmed Consultations / Meetings
                          </h4>
                          <span className="text-[10px] font-bold text-zinc-400">
                            {confirmedApts.length} active
                          </span>
                        </div>
                        
                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="min-w-full divide-y divide-zinc-200 text-left">
                            <thead className="bg-zinc-50 text-[10px] font-bold text-zinc-400 uppercase">
                              <tr>
                                <th className="px-6 py-3">Client Info</th>
                                <th className="px-6 py-3">Date & Time</th>
                                <th className="px-6 py-3">Consultation / Goal</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-150 text-xs">
                              {confirmedApts.map((apt) => (
                                <tr key={apt.id} className="hover:bg-zinc-50/40 transition-colors">
                                  {/* Info */}
                                  <td className="px-6 py-3.5">
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        {apt.tokenNo && (
                                          <span className="inline-flex items-center justify-center px-1 rounded bg-brand/10 border border-brand/20 text-brand text-[8px] font-black shrink-0">
                                            #{apt.tokenNo}
                                          </span>
                                        )}
                                        <span className="font-extrabold text-zinc-800 text-xs sm:text-[13px]">{apt.name}</span>
                                        {apt.appointmentType && (
                                          <span className="inline-flex items-center justify-center px-1.5 py-0.2 rounded bg-brand/5 border border-brand/10 text-brand text-[8px] font-extrabold shrink-0">
                                            {apt.appointmentType}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400 font-semibold mt-1">
                                        {apt.phone && <span>{apt.phone}</span>}
                                        {apt.email && (
                                          <>
                                            <span className="w-1 h-1 rounded-full bg-zinc-300"></span>
                                            <span className="truncate max-w-[120px]">{apt.email}</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </td>

                                  {/* Date & Time */}
                                  <td className="px-6 py-3.5 font-bold text-zinc-700 whitespace-nowrap">
                                    {new Date(apt.dateTime).toLocaleString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </td>

                                  {/* Goal / Focus */}
                                  <td className="px-6 py-3.5 max-w-[200px] truncate text-zinc-550 font-medium">
                                    {apt.reason || "General consulting session"}
                                  </td>

                                  {/* Actions */}
                                  <td className="px-6 py-3.5 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        title="View Client Profile"
                                        onClick={() => handleViewProfileForApt(apt)}
                                        className="p-1.5 rounded-lg text-zinc-400 hover:text-brand hover:bg-brand/5 transition-colors cursor-pointer shrink-0"
                                      >
                                        <Eye className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Register / Edit Client File"
                                        onClick={() => {
                                          const pid = resolvePatientForApt(apt);
                                          const matched = patientsList.find(p => p.id === pid);
                                          if (matched) {
                                            setEditingPatient(matched);
                                            setNewPatientName(matched.name);
                                            setNewPatientAge(String(matched.age));
                                            setNewPatientGender(matched.gender);
                                            setNewPatientPhone(matched.phone || "");
                                            setNewPatientEmail(matched.email || "");
                                            setNewPatientAddress(matched.address || "");
                                            setNewPatientReason(matched.chiefComplaint || matched.reason || "");
                                            setNewPatientNotes(matched.notes || "");
                                          } else {
                                            setEditingPatient(null);
                                            setNewPatientName(apt.name);
                                            setNewPatientAge("35");
                                            setNewPatientGender(apt.gender || "Female");
                                            setNewPatientPhone(apt.phone || "");
                                            setNewPatientEmail(apt.email || "");
                                            setNewPatientAddress("");
                                            setNewPatientReason(apt.reason || "");
                                            setNewPatientNotes("");
                                          }
                                          setIsAddingPatient(true);
                                        }}
                                        className="p-1.5 rounded-lg text-zinc-400 hover:text-indigo-650 hover:bg-indigo-50 transition-colors cursor-pointer shrink-0"
                                      >
                                        <Edit3 className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Cancel / Delete Booking"
                                        onClick={() => setAptToDelete(apt)}
                                        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile List View */}
                        <div className="md:hidden divide-y divide-zinc-150">
                          {confirmedApts.map((apt) => (
                            <div key={apt.id} className="p-4 space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-1.5">
                                    {apt.tokenNo && (
                                      <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-md bg-brand/10 border border-brand/20 text-brand text-[9px] font-black">
                                        #{apt.tokenNo}
                                      </span>
                                    )}
                                    <span>{apt.name}</span>
                                    {apt.appointmentType && (
                                      <span className="text-[8px] font-extrabold text-brand bg-brand/5 border border-brand/10 rounded px-1.5 py-0.5">
                                        {apt.appointmentType}
                                      </span>
                                    )}
                                  </h4>
                                  <div className="flex flex-col text-[10px] text-zinc-400 gap-0.5 mt-0.5">
                                    <span>Phone: {apt.phone}</span>
                                  </div>
                                </div>
                                <span className="inline-block rounded-full px-2.5 py-0.5 text-[9px] font-bold border bg-brand/5 text-brand border-brand/10">
                                  Confirmed
                                </span>
                              </div>

                              <div className="space-y-1 text-xs border-t border-b border-zinc-100/70 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Schedule:</span>
                                  <span className="text-zinc-700 font-bold">
                                    {new Date(apt.dateTime).toLocaleString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Goal:</span>
                                  <span className="text-zinc-550 truncate">{apt.reason}</span>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-3 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleViewProfileForApt(apt)}
                                  className="text-brand font-bold text-xs cursor-pointer mr-auto"
                                >
                                  View Profile
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const pid = resolvePatientForApt(apt);
                                    const matched = patientsList.find(p => p.id === pid);
                                    if (matched) {
                                      setEditingPatient(matched);
                                      setNewPatientName(matched.name);
                                      setNewPatientAge(String(matched.age));
                                      setNewPatientGender(matched.gender);
                                      setNewPatientPhone(matched.phone || "");
                                      setNewPatientEmail(matched.email || "");
                                      setNewPatientAddress(matched.address || "");
                                      setNewPatientReason(matched.chiefComplaint || matched.reason || "");
                                      setNewPatientNotes(matched.notes || "");
                                    } else {
                                      setEditingPatient(null);
                                      setNewPatientName(apt.name);
                                      setNewPatientAge("35");
                                      setNewPatientGender(apt.gender || "Female");
                                      setNewPatientPhone(apt.phone || "");
                                      setNewPatientEmail(apt.email || "");
                                      setNewPatientAddress("");
                                      setNewPatientReason(apt.reason || "");
                                      setNewPatientNotes("");
                                    }
                                    setIsAddingPatient(true);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                  }}
                                  className="text-zinc-500 hover:text-zinc-850 font-bold text-xs cursor-pointer"
                                >
                                  Register / Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAptToDelete(apt)}
                                  className="text-red-500 font-bold text-xs cursor-pointer"
                                >
                                  Cancel Booking
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })() ) : (
                    <>
                      {/* Desktop Table View */}
                      <div className="hidden md:block">
                        <table className="min-w-full divide-y divide-zinc-200 text-left">
                          <thead className="bg-zinc-50 text-[10px] font-bold text-zinc-400 uppercase">
                            <tr>
                              <th className="px-6 h-10">Client ID</th>
                              <th className="px-6 h-10">Name</th>
                              <th className="px-6 h-10">Demographics</th>
                              <th className="px-6 h-10">Primary Goal</th>
                              <th className="px-6 h-10">Registry Date</th>
                              <th className="px-6 h-10 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-150 text-xs">
                            {filteredPatients.map((p) => (
                              <tr key={p.id} className="hover:bg-zinc-50/50">
                                <td className="px-6 py-4 font-mono font-bold text-zinc-400">{p.patientNo}</td>
                                <td className="px-6 py-4 font-bold text-zinc-800">{p.name}</td>
                                <td className="px-6 py-4 text-zinc-500">
                                  {p.age} y/o {p.gender}
                                </td>
                                <td className="px-6 py-4 text-zinc-500 max-w-[240px] truncate">{p.chiefComplaint || p.reason}</td>
                                <td className="px-6 py-4 text-zinc-400">{new Date(p.createdAt).toLocaleDateString()}</td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      title="View Client Profile"
                                      onClick={() => setSelectedPatient(p)}
                                      className="p-1.5 rounded-lg text-zinc-400 hover:text-brand hover:bg-brand/5 transition-colors cursor-pointer shrink-0"
                                    >
                                      <Eye className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Edit Client File"
                                      onClick={() => {
                                        setEditingPatient(p);
                                        setNewPatientName(p.name);
                                        setNewPatientAge(String(p.age));
                                        setNewPatientGender(p.gender);
                                        setNewPatientPhone(p.phone || "");
                                        setNewPatientEmail(p.email || "");
                                        setNewPatientAddress(p.address || "");
                                        setNewPatientReason(p.chiefComplaint || p.reason || "");
                                        setNewPatientNotes(p.notes || "");
                                        setIsAddingPatient(true);
                                      }}
                                      className="p-1.5 rounded-lg text-zinc-400 hover:text-indigo-650 hover:bg-indigo-50 transition-colors cursor-pointer shrink-0"
                                    >
                                      <Edit3 className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Delete Client File"
                                      onClick={() => {
                                        setConfirmDialog({
                                          open: true,
                                          title: "Delete Client File?",
                                          message: `Are you sure you want to delete ${p.name}'s client record? This will also purge all linked consultation history and strategy plans.`,
                                          onConfirm: async () => {
                                            try {
                                              const res = await deletePatientServerFn({ data: { id: p.id } });
                                              if (res.success) {
                                                showToast("success", "Client registry file deleted successfully.");
                                                fetchPatients();
                                              }
                                            } catch (err: any) {
                                              showToast("error", err.message || "Failed to delete client");
                                            } finally {
                                              setConfirmDialog(null);
                                            }
                                          }
                                        });
                                      }}
                                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-55 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Card View */}
                      <div className="md:hidden divide-y divide-zinc-150">
                        {filteredPatients.map((p) => (
                          <div key={p.id} className="p-4 space-y-3">
                            <div className="flex justify-between items-start">
                              <div>
                                <h4 className="text-sm font-bold text-zinc-800">{p.name}</h4>
                                <span className="text-[10px] text-zinc-400 font-mono">ID: {p.patientNo}</span>
                              </div>
                              <span className="text-[10px] text-zinc-500">
                                {p.age} y/o {p.gender}
                              </span>
                            </div>

                            <div className="space-y-1 text-xs border-t border-b border-zinc-100/70 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Goal:</span>
                                <span className="text-zinc-700 font-bold truncate">{p.chiefComplaint || p.reason}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Registered:</span>
                                <span className="text-zinc-500">{new Date(p.createdAt).toLocaleDateString()}</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-1">
                              <button
                                type="button"
                                onClick={() => setSelectedPatient(p)}
                                className="text-brand font-bold text-xs cursor-pointer mr-auto"
                              >
                                View Chart
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPatient(p);
                                  setNewPatientName(p.name);
                                  setNewPatientAge(String(p.age));
                                  setNewPatientGender(p.gender);
                                  setNewPatientPhone(p.phone || "");
                                  setNewPatientEmail(p.email || "");
                                  setNewPatientAddress(p.address || "");
                                  setNewPatientReason(p.chiefComplaint || p.reason || "");
                                  setNewPatientNotes(p.notes || "");
                                  setIsAddingPatient(true);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="text-zinc-500 hover:text-zinc-850 font-bold text-xs cursor-pointer"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmDialog({
                                    open: true,
                                    title: "Delete Client File?",
                                    message: `Are you sure you want to delete ${p.name}'s client record? This will also purge all linked consultation history and strategy plans.`,
                                    onConfirm: async () => {
                                      try {
                                        const res = await deletePatientServerFn({ data: { id: p.id } });
                                        if (res.success) {
                                          showToast("success", "Client registry file deleted successfully.");
                                          fetchPatients();
                                        }
                                      } catch (err: any) {
                                        showToast("error", err.message || "Failed to delete client");
                                      } finally {
                                        setConfirmDialog(null);
                                      }
                                    }
                                  });
                                }}
                                className="text-red-500 font-bold text-xs cursor-pointer"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Pagination for clients */}
                      {patientsTotal > 20 && (
                        <div className="flex items-center justify-between border-t border-zinc-100 bg-white px-6 py-4">
                          <div className="flex-1 flex justify-between sm:hidden">
                            <button
                              type="button"
                              onClick={() => setPatientsPage(prev => Math.max(prev - 1, 1))}
                              disabled={patientsPage === 1}
                              className="relative inline-flex items-center px-4 py-2 border border-zinc-200 text-xs font-semibold rounded-full text-zinc-500 bg-white hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Previous
                            </button>
                            <button
                              type="button"
                              onClick={() => setPatientsPage(prev => Math.min(prev + 1, Math.ceil(patientsTotal / 20)))}
                              disabled={patientsPage >= Math.ceil(patientsTotal / 20)}
                              className="ml-3 relative inline-flex items-center px-4 py-2 border border-zinc-200 text-xs font-semibold rounded-full text-zinc-500 bg-white hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Next
                            </button>
                          </div>
                          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                            <div>
                              <p className="text-[11px] text-zinc-500 font-medium">
                                Showing <span className="font-bold text-zinc-800">{(patientsPage - 1) * 20 + 1}</span> to{" "}
                                <span className="font-bold text-zinc-800">{Math.min(patientsPage * 20, patientsTotal)}</span> of{" "}
                                <span className="font-bold text-zinc-800">{patientsTotal}</span> clients
                              </p>
                            </div>
                            <div>
                              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                                <button
                                  type="button"
                                  onClick={() => setPatientsPage(prev => Math.max(prev - 1, 1))}
                                  disabled={patientsPage === 1}
                                  className="relative inline-flex items-center px-2.5 py-1.5 rounded-l-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-400 hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <span className="sr-only">Previous</span>
                                  <ChevronLeft className="h-3.5 w-3.5" />
                                </button>
                                {Array.from({ length: Math.ceil(patientsTotal / 20) }).map((_, idx) => {
                                  const pageNum = idx + 1;
                                  const isCurrent = pageNum === patientsPage;
                                  return (
                                    <button
                                      key={pageNum}
                                      type="button"
                                      onClick={() => setPatientsPage(pageNum)}
                                      className={`relative inline-flex items-center px-3 py-1.5 border text-[11px] font-bold cursor-pointer transition-all ${
                                        isCurrent
                                          ? "z-10 bg-zinc-950 border-zinc-950 text-white"
                                          : "bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                                      }`}
                                    >
                                      {pageNum}
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => setPatientsPage(prev => Math.min(prev + 1, Math.ceil(patientsTotal / 20)))}
                                  disabled={patientsPage >= Math.ceil(patientsTotal / 20)}
                                  className="relative inline-flex items-center px-2.5 py-1.5 rounded-r-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-400 hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <span className="sr-only">Next</span>
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                              </nav>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            )}

            {/* ──────────────────────────────────────────────
                TAB: BOOKINGS LIST (APPOINTMENTS)
                ────────────────────────────────────────────── */}
            {activeTab === "appointments" && (
              <motion.div
                key="appointments"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-6"
              >
                {/* 1. Statistics Bar */}
                <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase">Total Sessions</span>
                    <h3 className="text-xl font-extrabold text-zinc-900 mt-1">{appointmentsTotal}</h3>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase">Pending Review</span>
                    <h3 className="text-xl font-extrabold text-amber-600 mt-1">
                      {appointmentSummary?.pending || 0}
                    </h3>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase">Confirmed</span>
                    <h3 className="text-xl font-extrabold text-brand mt-1">
                      {appointmentSummary?.confirmed || 0}
                    </h3>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase">Completed</span>
                    <h3 className="text-xl font-extrabold text-emerald-600 mt-1">
                      {appointmentSummary?.completed || 0}
                    </h3>
                  </div>
                </div>

                {/* 2. Control & Filters Bar */}
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                  <div className="flex flex-1 flex-col sm:flex-row gap-3 items-stretch sm:items-center max-w-2xl">
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Search bookings by name, email, phone, or goal..."
                        value={searchAptQuery}
                        onChange={(e) => setSearchAptQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 text-xs rounded-full border border-zinc-200 bg-white placeholder-zinc-400 focus:outline-none focus:border-brand font-semibold"
                      />
                    </div>
                    <select
                      value={filterAptStatus}
                      onChange={(e) => setFilterAptStatus(e.target.value)}
                      className="px-4 py-2 text-xs rounded-full border border-zinc-200 bg-white font-bold text-zinc-700 focus:outline-none cursor-pointer"
                    >
                      <option value="All">All Statuses</option>
                      <option value="Pending">Pending Review</option>
                      <option value="Confirmed">Confirmed</option>
                      <option value="Completed">Completed</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      openCreateApt();
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-zinc-900 hover:bg-zinc-800 transition-all rounded-full shadow-sm cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Book Consultation
                  </button>
                </div>

                {/* 3. Responsive Table & Card View */}
                {loadingAppointments ? (
                  <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-zinc-400 mb-2" />
                    <p className="text-xs text-zinc-400">Loading bookings...</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                    {(() => {
                      if (appointments.length === 0) {
                        return (
                          <div className="p-8 text-center text-zinc-400 font-semibold text-xs">
                            No consulting sessions found matching constraints.
                          </div>
                        );
                      }

                      return (
                        <>
                          {/* Desktop Table view */}
                          <div className="hidden md:block overflow-x-auto">
                            <table className="min-w-full divide-y divide-zinc-200 text-left">
                              <thead className="bg-zinc-50 text-[10px] font-bold text-zinc-400 uppercase">
                                <tr>
                                  <th className="px-5 py-3">Client Info</th>
                                  <th className="px-5 py-3">Date & Time</th>
                                  <th className="px-5 py-3">Focus / Goal</th>
                                  <th className="px-5 py-3">Status</th>
                                  <th className="px-5 py-3 text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-150 text-xs">
                                {appointments.map((apt) => (
                                  <tr key={apt.id} className="hover:bg-zinc-50/40 transition-colors">
                                    {/* Client Info */}
                                    <td className="px-5 py-3.5">
                                      <div className="flex flex-col">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {apt.tokenNo && (
                                            <span className="inline-flex items-center justify-center px-1 rounded bg-brand/10 border border-brand/20 text-brand text-[8px] font-black shrink-0">
                                              #{apt.tokenNo}
                                            </span>
                                          )}
                                          <span className="font-extrabold text-zinc-800 text-xs sm:text-[13px]">{apt.name}</span>
                                          {apt.appointmentType && (
                                            <span className="inline-flex items-center justify-center px-1.5 py-0.2 rounded bg-brand/5 border border-brand/10 text-brand text-[8px] font-extrabold shrink-0">
                                              {apt.appointmentType}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400 font-semibold mt-1">
                                          {apt.phone && <span>{apt.phone}</span>}
                                          {apt.email && (
                                            <>
                                              <span className="w-1 h-1 rounded-full bg-zinc-300"></span>
                                              <span className="truncate max-w-[120px]">{apt.email}</span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </td>

                                    {/* Date & Time */}
                                    <td className="px-5 py-3.5 font-bold text-zinc-700 whitespace-nowrap">
                                      {new Date(apt.dateTime).toLocaleString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </td>

                                    {/* Focus / Goal */}
                                    <td className="px-5 py-3.5 max-w-[200px] truncate text-zinc-500 font-medium">
                                      {apt.reason || "General consulting session"}
                                    </td>

                                    {/* Status */}
                                    <td className="px-5 py-3.5 relative">
                                      <button
                                        type="button"
                                        onClick={() => setActiveStatusDropdownId(activeStatusDropdownId === apt.id ? null : apt.id)}
                                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-bold border transition-colors cursor-pointer hover:opacity-80 active:scale-[0.98] ${
                                          apt.status === "Confirmed"
                                            ? "bg-brand/5 text-brand border-brand/10"
                                            : apt.status === "Completed"
                                              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                              : apt.status === "Cancelled"
                                                ? "bg-red-50 text-red-700 border-red-100"
                                                : "bg-amber-50 text-amber-700 border-amber-100"
                                        }`}
                                      >
                                        <span>{apt.status}</span>
                                        <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                                      </button>

                                      {activeStatusDropdownId === apt.id && (
                                        <>
                                          <div 
                                            className="fixed inset-0 z-10" 
                                            onClick={() => setActiveStatusDropdownId(null)} 
                                          />
                                          <div className="absolute left-5 mt-1 w-32 rounded-xl bg-white border border-zinc-150 shadow-lg py-1 z-20 animate-in fade-in slide-in-from-top-1 duration-100">
                                            {(["Pending", "Confirmed", "Completed", "Cancelled"] as const).map((status) => (
                                              <button
                                                key={status}
                                                type="button"
                                                onClick={() => handleUpdateStatus(apt, status)}
                                                className={`w-full text-left px-3 py-1.5 text-[10px] font-bold transition-colors hover:bg-zinc-50 flex items-center justify-between cursor-pointer ${
                                                  apt.status === status ? "text-brand" : "text-zinc-600"
                                                }`}
                                              >
                                                <span>{status === "Pending" ? "Pending Review" : status}</span>
                                                {apt.status === status && <Check className="h-3 w-3 text-brand" />}
                                              </button>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                    </td>

                                    {/* Action buttons */}
                                    <td className="px-5 py-3.5">
                                      <div className="flex items-center justify-end gap-1.5">
                                        {/* View client profile */}
                                        <button
                                          type="button"
                                          title="View Client Profile"
                                          onClick={() => handleViewProfileForApt(apt)}
                                          className="p-1.5 rounded-lg text-zinc-400 hover:text-brand hover:bg-brand/5 transition-colors cursor-pointer shrink-0"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                        </button>

                                        {/* Edit button */}
                                        <button
                                          type="button"
                                          title="Edit Booking"
                                          onClick={() => openEditApt(apt)}
                                          className="p-1 rounded bg-zinc-50 hover:bg-zinc-100 text-zinc-550 border border-zinc-200 transition-colors cursor-pointer shrink-0"
                                        >
                                          <Edit3 className="h-3.5 w-3.5" />
                                        </button>

                                        {/* Delete button */}
                                        <button
                                          type="button"
                                          title="Delete Booking"
                                          onClick={() => setAptToDelete(apt)}
                                          className="p-1 rounded bg-red-50/10 hover:bg-red-50 text-red-500 border border-red-100 transition-colors cursor-pointer shrink-0"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Mobile Card list view */}
                          <div className="md:hidden divide-y divide-zinc-150">
                            {appointments.map((apt) => (
                              <div key={apt.id} className="p-4 space-y-3">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-1.5">
                                      {apt.tokenNo && (
                                        <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-md bg-brand/10 border border-brand/20 text-brand text-[9px] font-black">
                                          #{apt.tokenNo}
                                        </span>
                                      )}
                                      <span>{apt.name}</span>
                                      {apt.appointmentType && (
                                        <span className="text-[8px] font-extrabold text-brand bg-brand/5 border border-brand/10 rounded px-1.5 py-0.5">
                                          {apt.appointmentType}
                                        </span>
                                      )}
                                    </h4>
                                    <div className="flex flex-col text-[10px] text-zinc-400 gap-0.5 mt-0.5">
                                      <span>Phone: {apt.phone}</span>
                                    </div>
                                  </div>
                                  <span
                                    className={`inline-block rounded-full px-2.5 py-0.5 text-[9px] font-bold border ${
                                      apt.status === "Confirmed"
                                        ? "bg-brand/5 text-brand border-brand/10"
                                        : apt.status === "Completed"
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                          : apt.status === "Cancelled"
                                            ? "bg-red-50 text-red-700 border-red-100"
                                            : "bg-amber-50 text-amber-700 border-amber-100"
                                    }`}
                                  >
                                    {apt.status === "Pending" ? "Pending Review" : apt.status}
                                  </span>
                                </div>

                                <div className="space-y-1 text-xs border-t border-b border-zinc-100/70 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Schedule:</span>
                                    <span className="text-zinc-700 font-bold">
                                      {new Date(apt.dateTime).toLocaleString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Goal:</span>
                                    <span className="text-zinc-500 truncate">{apt.reason}</span>
                                  </div>
                                </div>

                                <div className="flex items-center justify-end gap-3 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => handleViewProfileForApt(apt)}
                                    className="text-brand font-bold text-xs cursor-pointer mr-auto"
                                  >
                                    View Profile
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      openEditApt(apt);
                                      window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    className="text-zinc-500 hover:text-zinc-855 font-bold text-xs cursor-pointer"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAptToDelete(apt)}
                                    className="text-red-500 font-bold text-xs cursor-pointer"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}

                    {/* Bookings Pagination Controls */}
                    {appointmentsTotal > 20 && (
                      <div className="flex items-center justify-between border-t border-zinc-100 bg-white px-6 py-4">
                        <div className="flex-1 flex justify-between sm:hidden">
                          <button
                            type="button"
                            onClick={() => setAppointmentsPage(prev => Math.max(prev - 1, 1))}
                            disabled={appointmentsPage === 1}
                            className="relative inline-flex items-center px-4 py-2 border border-zinc-200 text-xs font-semibold rounded-full text-zinc-500 bg-white hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            onClick={() => setAppointmentsPage(prev => Math.min(prev + 1, Math.ceil(appointmentsTotal / 20)))}
                            disabled={appointmentsPage >= Math.ceil(appointmentsTotal / 20)}
                            className="ml-3 relative inline-flex items-center px-4 py-2 border border-zinc-200 text-xs font-semibold rounded-full text-zinc-500 bg-white hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Next
                          </button>
                        </div>
                        <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                          <div>
                            <p className="text-[11px] text-zinc-500 font-medium">
                              Showing <span className="font-bold text-zinc-800">{(appointmentsPage - 1) * 20 + 1}</span> to{" "}
                              <span className="font-bold text-zinc-800">{Math.min(appointmentsPage * 20, appointmentsTotal)}</span> of{" "}
                              <span className="font-bold text-zinc-800">{appointmentsTotal}</span> bookings
                            </p>
                          </div>
                          <div>
                            <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                              <button
                                type="button"
                                onClick={() => setAppointmentsPage(prev => Math.max(prev - 1, 1))}
                                disabled={appointmentsPage === 1}
                                className="relative inline-flex items-center px-2.5 py-1.5 rounded-l-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-400 hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <span className="sr-only">Previous</span>
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                              {Array.from({ length: Math.ceil(appointmentsTotal / 20) }).map((_, idx) => {
                                const pageNum = idx + 1;
                                const isCurrent = pageNum === appointmentsPage;
                                return (
                                  <button
                                    key={pageNum}
                                    type="button"
                                    onClick={() => setAppointmentsPage(pageNum)}
                                    className={`relative inline-flex items-center px-3 py-1.5 border text-[11px] font-bold cursor-pointer transition-all ${
                                      isCurrent
                                        ? "z-10 bg-zinc-950 border-zinc-950 text-white"
                                        : "bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                                    }`}
                                  >
                                    {pageNum}
                                  </button>
                                );
                              })}
                              <button
                                type="button"
                                onClick={() => setAppointmentsPage(prev => Math.min(prev + 1, Math.ceil(appointmentsTotal / 20)))}
                                disabled={appointmentsPage >= Math.ceil(appointmentsTotal / 20)}
                                className="relative inline-flex items-center px-2.5 py-1.5 rounded-r-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-400 hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <span className="sr-only">Next</span>
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </nav>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}


            {/* ──────────────────────────────────────────────
                TAB: SETTINGS
                ────────────────────────────────────────────── */}
            {activeTab === "settings" && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="w-full transition-all duration-300 rounded-[1.75rem] border border-zinc-200 bg-white p-6 sm:p-8 space-y-6"
              >
                {/* Header */}
                <div className="border-b border-zinc-100 pb-4">
                  <h3 className="text-base font-bold text-zinc-900 leading-none">
                    Workspace & Firm Management
                  </h3>
                  <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
                    Configure firm profiles, working hours, departments, doctor directory schedules, and WhatsApp alerts.
                  </p>
                </div>

                {/* Nested Sub-Tab Navigation */}
                {/* Mobile: custom interactive dropdown */}
                {(() => {
                  const tabs = [
                    { id: "profile", label: "Firm Profile", icon: Building2 },
                    { id: "hours", label: "Working Hours", icon: Clock },
                    { id: "departments", label: "Departments", icon: LayoutDashboard },
                    { id: "doctors", label: "Doctors Directory", icon: Stethoscope },
                    { id: "whatsapp", label: "WhatsApp Alerts", icon: Smartphone },
                    { id: "users", label: "Manage Users", icon: Users },
                    { id: "locations", label: "Multi Location", icon: MapPin },
                  ].filter((sub) => {
                    const fa = featureAccess[sub.id as FeatureId];
                    if (fa && !fa.visible) return false;
                    return true;
                  });
                  const active = tabs.find(t => t.id === settingsSubTab) || tabs[0];
                  const ActiveIcon = active.icon;
                  return (
                    <>
                      {/* Mobile dropdown */}
                      <div className="relative md:hidden">
                        <button
                          type="button"
                          onClick={() => setSettingsDropdownOpen(v => !v)}
                          className="w-full flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs font-bold text-zinc-800 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <ActiveIcon className="h-3.5 w-3.5 text-brand" />
                            <span className="uppercase tracking-wider">{active.label}</span>
                          </div>
                          <ChevronRight className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-200 ${settingsDropdownOpen ? "rotate-90" : ""}`} />
                        </button>
                        <AnimatePresence>
                          {settingsDropdownOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: -6, scale: 0.97 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -6, scale: 0.97 }}
                              transition={{ duration: 0.15, ease: "easeOut" }}
                              className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 rounded-xl border border-zinc-200 bg-white shadow-lg overflow-hidden"
                            >
                              {tabs.map((tab) => {
                                const Icon = tab.icon;
                                const isActive = settingsSubTab === tab.id;
                                return (
                                  <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => { setSettingsSubTab(tab.id as any); setSettingsDropdownOpen(false); }}
                                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold transition-colors cursor-pointer ${
                                      isActive
                                        ? "bg-brand/5 text-brand border-l-2 border-brand"
                                        : "text-zinc-600 hover:bg-zinc-50 border-l-2 border-transparent"
                                    }`}
                                  >
                                    <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-brand" : "text-zinc-400"}`} />
                                    <span className="uppercase tracking-wider">{tab.label}</span>
                                    {isActive && <Check className="h-3 w-3 ml-auto text-brand" />}
                                  </button>
                                );
                              })}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Desktop tab bar */}
                      <div className="hidden md:flex pb-2 gap-4 scrollbar-none border-b border-zinc-150">
                        {tabs.map((sub) => (
                          <button
                            key={sub.id}
                            onClick={() => setSettingsSubTab(sub.id as any)}
                            className={`text-[10px] font-extrabold px-0 py-0 pb-2 border-b-2 transition-all whitespace-nowrap cursor-pointer uppercase tracking-wider ${
                              settingsSubTab === sub.id
                                ? "text-zinc-900 border-zinc-900"
                                : "text-zinc-400 border-transparent hover:text-zinc-600"
                            }`}
                          >
                            {sub.label}
                          </button>
                        ))}
                      </div>
                    </>
                  );
                })()}

                {/* ──────────────────────────────────────────────
                    SUB-TAB: CLINIC PROFILE (Original Settings content)
                    ────────────────────────────────────────────── */}
                {settingsSubTab === "profile" && (
                  loadingProfile ? (
                    <div className="flex justify-center items-center py-12 animate-in fade-in duration-300">
                      <Loader2 className="h-6 w-6 animate-spin text-brand" />
                    </div>
                  ) : (
                    <div className="space-y-6 animate-in fade-in duration-300">
                    {/* 1. Clinic Booking Portal Section */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-brand" />
                        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                          Patient Appointment Portal
                        </h4>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Booking Form URL</span>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={typeof window !== "undefined" ? `${window.location.origin}/book/${user?.tenantId}` : ""}
                              readOnly
                              className="w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-750 font-semibold focus:outline-none select-all"
                            />
                            <button
                              type="button"
                              onClick={() => handleCopyLink(typeof window !== "undefined" ? `${window.location.origin}/book/${user?.tenantId}` : "")}
                              className="rounded-full bg-zinc-950 hover:bg-zinc-850 px-4 py-2 text-xs font-semibold text-white transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                            >
                              {copiedLink ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5" /> Copy Link
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-zinc-50 border border-zinc-150">
                          {user?.tenantId ? (
                            <div className="bg-white p-2.5 rounded-xl border border-zinc-200 shrink-0">
                              <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(typeof window !== "undefined" ? `${window.location.origin}/book/${user?.tenantId}` : "")}`}
                                alt="Booking QR Code"
                                className="h-24 w-24 object-contain"
                              />
                            </div>
                          ) : (
                            <div className="h-24 w-24 bg-zinc-100 rounded-xl border border-zinc-200 animate-pulse shrink-0" />
                          )}
                          <div className="space-y-2 text-left w-full">
                            <h5 className="text-xs font-bold text-zinc-850">Firm Booking QR Code</h5>
                            <p className="text-[10px] text-zinc-400 leading-normal">
                              Display or print this QR code in your office/firm. All clients can scan it using any mobile device to immediately book appointments in your scheduling portal.
                            </p>
                            <div className="flex gap-2">
                              <a
                                href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(typeof window !== "undefined" ? `${window.location.origin}/book/${user?.tenantId}` : "")}`}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full bg-white hover:bg-zinc-100 text-zinc-700 border border-zinc-200 text-[10px] font-bold px-3 py-1.5 transition-colors cursor-pointer inline-flex items-center gap-1"
                              >
                                <ExternalLink className="h-3 w-3" /> View Large QR
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <hr className="border-zinc-105" />

                    {/* 2. Profile Photo Upload */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-brand" />
                        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Profile Photo</h4>
                      </div>
                      <div className="flex items-center gap-5">
                        {/* Avatar preview */}
                        <div className="relative shrink-0">
                          <div className="h-20 w-20 rounded-full overflow-hidden border-2 border-zinc-200 bg-zinc-100 flex items-center justify-center">
                            {photoPreview || user?.profilePhoto ? (
                              <img src={photoPreview || user?.profilePhoto || ""} alt="Profile" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-xl font-black text-brand">
                                {user?.name ? user.name.split(" ").map((n: string) => n[0]).slice(0,2).join("").toUpperCase() : "DR"}
                              </span>
                            )}
                          </div>
                          {/* Camera overlay button */}
                          <button
                            type="button"
                            onClick={() => photoInputRef.current?.click()}
                            className="absolute bottom-0 right-0 h-6 w-6 rounded-full bg-brand flex items-center justify-center shadow-md border-2 border-white hover:bg-brand-dark transition-colors cursor-pointer"
                          >
                            <Camera className="h-3 w-3 text-white" />
                          </button>
                        </div>
                        {/* Upload controls */}
                        <div className="flex-1 space-y-2">
                          <p className="text-xs font-semibold text-zinc-700">Upload a profile photo</p>
                          <p className="text-[10px] text-zinc-400">JPG, PNG or WEBP · Max 5MB · Recommended 400×400px</p>
                          <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.size > 5 * 1024 * 1024) { setPhotoError("File too large. Max 5MB."); return; }
                              setPhotoError("");
                              // Preview
                              const reader = new FileReader();
                              reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
                              reader.readAsDataURL(file);
                              // Upload to Cloudinary
                              setUploadingPhoto(true);
                              try {
                                const base64 = await new Promise<string>((resolve) => {
                                  const r = new FileReader();
                                  r.onload = (ev) => resolve(ev.target?.result as string);
                                  r.readAsDataURL(file);
                                });
                                const res = await uploadProfilePhotoServerFn({ data: { base64, fileName: file.name } });
                                if (res.success) {
                                  setUser(prev => prev ? { ...prev, profilePhoto: res.url } : null);
                                  setPhotoPreview(null);
                                  showToast("success", "Profile photo updated!");
                                }
                              } catch (err: any) {
                                setPhotoError(err.message || "Upload failed");
                              } finally {
                                setUploadingPhoto(false);
                                if (photoInputRef.current) photoInputRef.current.value = "";
                              }
                            }}
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => photoInputRef.current?.click()}
                              disabled={uploadingPhoto}
                              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-[10px] font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors cursor-pointer"
                            >
                              {uploadingPhoto ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                              {uploadingPhoto ? "Uploading…" : "Choose Photo"}
                            </button>
                            {(user?.profilePhoto) && !uploadingPhoto && (
                              <button
                                type="button"
                                onClick={async () => {
                                  setUploadingPhoto(true);
                                  try {
                                    await uploadProfilePhotoServerFn({ data: { base64: "", fileName: "remove" } });
                                  } catch {}
                                  setUser(prev => prev ? { ...prev, profilePhoto: null } : null);
                                  setPhotoPreview(null);
                                  setUploadingPhoto(false);
                                }}
                                className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-500 hover:bg-red-100 cursor-pointer transition-colors"
                              >
                                <Trash2 className="h-3 w-3" /> Remove
                              </button>
                            )}
                          </div>
                          {photoError && <p className="text-[10px] font-bold text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {photoError}</p>}
                        </div>
                      </div>
                    </div>

                    <hr className="border-zinc-105" />

                    {/* 3. Profile Details Form */}
                    <form onSubmit={handleUpdateProfile} className="space-y-4">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-brand" />
                        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                          Advisor Profile details
                        </h4>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Advisor Name</span>
                          <input
                            type="text"
                            value={profileName}
                            onChange={(e) => setProfileName(e.target.value)}
                            placeholder="Dr. Advisor"
                            required
                            className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Contact Phone</span>
                          <input
                            type="text"
                            value={profilePhone}
                            onChange={(e) => setProfilePhone(e.target.value)}
                            placeholder="(555) 000-0000"
                            required
                            className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all"
                          />
                        </label>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Clinic Affiliation</span>
                          <input
                            type="text"
                            value={profileClinic}
                            onChange={(e) => setProfileClinic(e.target.value)}
                            placeholder="Firm Name"
                            required
                            className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Firm Size</span>
                          <select
                            value={profilePracticeSize}
                            onChange={(e) => setProfilePracticeSize(e.target.value)}
                            className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-850 font-semibold focus:border-brand focus:outline-none transition-all"
                          >
                            <option value="Solo Practice">Solo Practice</option>
                            <option value="2-5 Providers">2-5 Providers</option>
                            <option value="6-15 Providers">6-15 Providers</option>
                            <option value="16-50 Providers">16-50 Providers</option>
                            <option value="50+ Providers">50+ Providers</option>
                          </select>
                        </label>
                      </div>

                      {/* Profile success/error inline message */}
                      {profileSuccess && (
                        <div className="rounded-full bg-emerald-50 border border-emerald-100 p-2.5 text-center">
                          <p className="text-[10px] font-bold text-emerald-600 flex items-center justify-center gap-1 leading-none">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {profileSuccess}
                          </p>
                        </div>
                      )}
                      {profileError && (
                        <div className="rounded-full bg-red-50 border border-red-100 p-2.5 text-center">
                          <p className="text-[10px] font-bold text-red-650 flex items-center justify-center gap-1 leading-none">
                            <AlertCircle className="h-3.5 w-3.5 text-red-500" /> {profileError}
                          </p>
                        </div>
                      )}

                      <div className="flex justify-end pt-1">
                        <button
                          type="submit"
                          disabled={savingProfile}
                          className="rounded-full bg-zinc-950 hover:bg-zinc-850 px-5 py-2 text-xs font-semibold text-white transition-all active:scale-[0.98] cursor-pointer flex items-center gap-1.5"
                        >
                          {savingProfile && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Save Profile Changes
                        </button>
                      </div>
                    </form>

                    <hr className="border-zinc-105" />

                    {/* 3. Secure Email Change Section */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-brand" />
                        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                          Update Secure Email Address
                        </h4>
                      </div>

                      <div className="space-y-3">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Current Registered Email</span>
                            <input
                              type="text"
                              value={user?.email || ""}
                              readOnly
                              className="mt-1 block w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-500 font-semibold focus:outline-none"
                            />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">New Email Address</span>
                            <input
                              type="email"
                              placeholder="newemail@example.com"
                              value={newEmail}
                              onChange={(e) => setNewEmail(e.target.value)}
                              disabled={emailOtpSent || sendingEmailOtp}
                              className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-805 font-semibold focus:border-brand focus:outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-500"
                            />
                          </div>
                        </div>

                        {/* Email Verification OTP Section */}
                        {emailOtpSent && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="rounded-2xl border border-zinc-150 bg-zinc-50 p-4 space-y-3 text-left animate-in fade-in slide-in-from-top-2 duration-300"
                          >
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-zinc-500 uppercase pl-1">Enter 4-Digit Verification Code</label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  maxLength={4}
                                  placeholder="Code"
                                  value={emailOtpCode}
                                  onChange={(e) => setEmailOtpCode(e.target.value.replace(/\D/g, ""))}
                                  disabled={verifyingEmailOtp}
                                  className="w-24 text-center tracking-widest rounded-full border border-zinc-250 bg-white px-3 py-1.5 text-xs text-zinc-805 font-mono font-bold focus:border-brand focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={handleVerifyEmailOtp}
                                  disabled={verifyingEmailOtp || !emailOtpCode}
                                  className="rounded-full bg-black hover:bg-black/90 text-white text-xs font-semibold px-4 py-1.5 transition-colors cursor-pointer flex items-center gap-1 disabled:bg-zinc-100 disabled:text-zinc-400"
                                >
                                  {verifyingEmailOtp && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                  Verify & Change Email
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px] text-zinc-400 font-bold">
                              <span>Verification code valid for 5 minutes</span>
                              {emailTimer > 0 ? (
                                <span>Resend code in {emailTimer}s</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={handleSendEmailOtp}
                                  disabled={sendingEmailOtp}
                                  className="text-brand hover:underline cursor-pointer"
                                >
                                  Resend Verification Code
                                </button>
                              )}
                            </div>
                          </motion.div>
                        )}

                        {/* Email success/error inline message */}
                        {emailSuccess && (
                          <div className="rounded-full bg-emerald-50 border border-emerald-100 p-2.5 text-center">
                            <p className="text-[10px] font-bold text-emerald-600 flex items-center justify-center gap-1 leading-none">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {emailSuccess}
                            </p>
                          </div>
                        )}
                        {emailError && (
                          <div className="rounded-full bg-red-50 border border-red-100 p-2.5 text-center">
                            <p className="text-[10px] font-bold text-red-600 flex items-center justify-center gap-1 leading-none">
                              <AlertCircle className="h-3.5 w-3.5 text-red-500" /> {emailError}
                            </p>
                          </div>
                        )}

                        {!emailOtpSent && (
                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={handleSendEmailOtp}
                              disabled={sendingEmailOtp || !newEmail}
                              className="rounded-full bg-zinc-950 hover:bg-zinc-850 px-5 py-2 text-xs font-semibold text-white transition-all active:scale-[0.98] cursor-pointer flex items-center gap-1.5 disabled:bg-zinc-100 disabled:text-zinc-400"
                            >
                              {sendingEmailOtp && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              Send OTP & Verify Email
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <hr className="border-zinc-105" />

                    {/* 4. Security (Change Password) */}
                    <form onSubmit={handleUpdatePassword} className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-brand" />
                        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                          Security & Password Management
                        </h4>
                      </div>

                      <div className="space-y-3">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <label className="block">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Current Password</span>
                            <input
                              type="password"
                              placeholder="••••••••"
                              value={currentPass}
                              onChange={(e) => setCurrentPass(e.target.value)}
                              required
                              className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-805 font-semibold focus:border-brand focus:outline-none transition-all"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">New Password</span>
                            <input
                              type="password"
                              placeholder="••••••••"
                              value={newPass}
                              onChange={(e) => setNewPass(e.target.value)}
                              required
                              className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-805 font-semibold focus:border-brand focus:outline-none transition-all"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Confirm Password</span>
                            <input
                              type="password"
                              placeholder="••••••••"
                              value={confirmPass}
                              onChange={(e) => setConfirmPass(e.target.value)}
                              required
                              className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-805 font-semibold focus:border-brand focus:outline-none transition-all"
                            />
                          </label>
                        </div>

                        {/* Password success/error inline message */}
                        {passSuccess && (
                          <div className="rounded-full bg-emerald-50 border border-emerald-100 p-2.5 text-center">
                            <p className="text-[10px] font-bold text-emerald-600 flex items-center justify-center gap-1 leading-none">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {passSuccess}
                            </p>
                          </div>
                        )}
                        {passError && (
                          <div className="rounded-full bg-red-50 border border-red-100 p-2.5 text-center">
                            <p className="text-[10px] font-bold text-red-650 flex items-center justify-center gap-1 leading-none">
                              <AlertCircle className="h-3.5 w-3.5 text-red-500" /> {passError}
                            </p>
                          </div>
                        )}

                        <div className="flex justify-end pt-1">
                          <button
                            type="submit"
                            disabled={savingPass}
                            className="rounded-full bg-zinc-950 hover:bg-zinc-850 px-5 py-2 text-xs font-semibold text-white transition-all active:scale-[0.98] cursor-pointer flex items-center gap-1.5"
                          >
                            {savingPass && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Update Passkey
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                )
              )}

                {/* ──────────────────────────────────────────────
                    SUB-TAB: WORKING HOURS
                    ────────────────────────────────────────────── */}
                {settingsSubTab === "hours" && (
                  <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-brand" />
                      <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                        Weekly Timetable & Hours
                      </h4>
                    </div>

                    {clinicHours.length === 0 ? (
                      <div className="text-center py-10 px-4 bg-zinc-50 border border-zinc-150 rounded-2xl space-y-4">
                        <div className="h-10 w-10 bg-brand/5 border border-brand/10 rounded-full flex items-center justify-center mx-auto animate-none">
                          <Clock className="h-5 w-5 text-brand" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-zinc-800">No Weekly Hours Set</p>
                          <p className="text-[10px] text-zinc-450 max-w-sm mx-auto leading-relaxed">
                            Initialize your weekly schedule to define the general timezone and daily hours your clinic accepts appointments.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setClinicHours([
                              { dayOfWeek: 0, openTime: "09:00", closeTime: "17:00", isClosed: true },
                              { dayOfWeek: 1, openTime: "09:00", closeTime: "17:00", isClosed: false },
                              { dayOfWeek: 2, openTime: "09:00", closeTime: "17:00", isClosed: false },
                              { dayOfWeek: 3, openTime: "09:00", closeTime: "17:00", isClosed: false },
                              { dayOfWeek: 4, openTime: "09:00", closeTime: "17:00", isClosed: false },
                              { dayOfWeek: 5, openTime: "09:00", closeTime: "17:00", isClosed: false },
                              { dayOfWeek: 6, openTime: "09:00", closeTime: "17:00", isClosed: true }
                            ]);
                          }}
                          className="rounded-full bg-zinc-950 hover:bg-zinc-850 px-5 py-2 text-xs font-semibold text-white transition-all active:scale-[0.98] cursor-pointer"
                        >
                          Setup Working Hours
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleSaveHours} className="space-y-6">
                        <div className="space-y-3">
                          {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((dayName, idx) => {
                            const dayHour = clinicHours.find((h) => h.dayOfWeek === idx) || {
                              dayOfWeek: idx,
                              openTime: "09:00",
                              closeTime: "17:00",
                              isClosed: idx === 0 || idx === 6
                            };
                            return (
                              <div key={idx} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-3 rounded-xl border border-zinc-150 bg-zinc-50/30">
                                <span className="text-xs font-bold text-zinc-700 w-24">{dayName}</span>
                                
                                <div className="flex items-center gap-4 flex-wrap">
                                  <label className="flex items-center gap-1.5 text-xs text-zinc-500 font-semibold cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={dayHour.isClosed}
                                      onChange={(e) => handleUpdateHourField(idx, "isClosed", e.target.checked)}
                                      className="rounded border-zinc-300 text-brand focus:ring-brand"
                                    />
                                    Closed
                                  </label>

                                  {!dayHour.isClosed && (
                                    <div className="flex items-center gap-2 animate-in fade-in duration-200">
                                      <input
                                        type="time"
                                        value={dayHour.openTime}
                                        onChange={(e) => handleUpdateHourField(idx, "openTime", e.target.value)}
                                        className="rounded-lg border border-zinc-200 bg-white px-2 py-0.5 text-xs font-semibold focus:outline-none"
                                      />
                                      <span className="text-[10px] text-zinc-400 font-bold">to</span>
                                      <input
                                        type="time"
                                        value={dayHour.closeTime}
                                        onChange={(e) => handleUpdateHourField(idx, "closeTime", e.target.value)}
                                        className="rounded-lg border border-zinc-200 bg-white px-2 py-0.5 text-xs font-semibold focus:outline-none"
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {hoursSuccess && (
                          <div className="rounded-full bg-emerald-50 border border-emerald-100 p-2.5 text-center">
                            <p className="text-[10px] font-bold text-emerald-600 flex items-center justify-center gap-1 leading-none">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {hoursSuccess}
                            </p>
                          </div>
                        )}
                        {hoursError && (
                          <div className="rounded-full bg-red-50 border border-red-100 p-2.5 text-center">
                            <p className="text-[10px] font-bold text-red-600 flex items-center justify-center gap-1 leading-none">
                              <AlertCircle className="h-3.5 w-3.5 text-red-500" /> {hoursError}
                            </p>
                          </div>
                        )}

                        <div className="flex justify-end pt-1">
                          <button
                            type="submit"
                            disabled={savingHours}
                            className="rounded-full bg-zinc-950 hover:bg-zinc-850 px-5 py-2 text-xs font-semibold text-white transition-all active:scale-[0.98] cursor-pointer flex items-center gap-1.5"
                          >
                            {savingHours && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Save Timetable Hours
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                    {/* ──────────────────────────────────────────────
                        SUB-TAB: DEPARTMENTS
                        ────────────────────────────────────────────── */}
                    {settingsSubTab === "departments" && (
                      <div className="space-y-6 animate-in fade-in duration-300">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-brand" />
                            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                              Practice Areas
                            </h4>
                          </div>
                        </div>

                        {/* Add department form */}
                        <form onSubmit={handleCreateDept} className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Department name (e.g. Cardiology)"
                            value={newDeptName}
                            onChange={(e) => setNewDeptName(e.target.value)}
                            className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all"
                            required
                          />
                          <button
                            type="submit"
                            className="rounded-full bg-black hover:bg-black/90 px-5 py-2 text-xs font-semibold text-white transition-all cursor-pointer whitespace-nowrap"
                          >
                            Add Department
                          </button>
                        </form>

                        {/* Departments list */}
                        {loadingDepts ? (
                          <div className="flex justify-center py-6">
                            <Loader2 className="h-6 w-6 animate-spin text-brand" />
                          </div>
                        ) : (
                          <div className="border border-zinc-150 rounded-2xl overflow-hidden bg-white">
                            <table className="min-w-full divide-y divide-zinc-200 text-left">
                              <thead className="bg-zinc-50 text-[10px] font-bold text-zinc-400 uppercase">
                                <tr>
                                  <th className="px-6 h-10">Department Name</th>
                                  <th className="px-6 h-10 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-150 text-xs">
                                {departments.map((dept) => (
                                  <tr key={dept.id} className="hover:bg-zinc-50/50">
                                    <td className="px-6 py-3 font-semibold text-zinc-800">{dept.name}</td>
                                    <td className="px-6 py-3 text-right">
                                      <button
                                        onClick={() => handleDeleteDept(dept.id)}
                                        className="text-red-500 font-bold hover:underline cursor-pointer"
                                      >
                                        Delete
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                                {departments.length === 0 && (
                                  <tr>
                                    <td colSpan={2} className="px-6 py-8 text-center text-zinc-400 font-semibold">
                                      No departments registered. Add one above.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ──────────────────────────────────────────────
                        SUB-TAB: DOCTORS DIRECTORY
                        ────────────────────────────────────────────── */}
                    {settingsSubTab === "doctors" && (
                      <div className="space-y-6 animate-in fade-in duration-300">
                        
                        {/* Render schedule editor if a doctor is selected */}
                        {selectedDocForSchedule ? (
                          <div className="space-y-5 border border-brand/20 bg-gradient-to-br from-brand/[0.02] to-indigo-50/30 rounded-2xl p-5">
                            {/* Header */}
                            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                              <div>
                                <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand/10">
                                    <Calendar className="h-3.5 w-3.5 text-brand" />
                                  </span>
                                  Weekly Availability Schedule
                                </h4>
                                <p className="text-[10px] text-zinc-400 mt-0.5 pl-8">
                                  Configure working hours for <strong className="text-zinc-600">{selectedDocForSchedule.name}</strong>
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setSelectedDocForSchedule(null)}
                                className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-full px-3 py-1.5 transition-colors cursor-pointer"
                              >
                                <ChevronLeft className="h-3 w-3" /> Back
                              </button>
                            </div>

                            {/* Quick Preset Buttons */}
                            <div className="bg-white rounded-xl border border-zinc-150 p-3.5 space-y-2.5">
                              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Quick Presets — Apply to all days at once</p>
                              <div className="flex flex-wrap gap-2">
                                {([
                                  { label: "Mon – Fri",     days: [1,2,3,4,5],       Icon: Briefcase   },
                                  { label: "Mon – Sat",     days: [1,2,3,4,5,6],     Icon: Building2   },
                                  { label: "All 7 Days",    days: [0,1,2,3,4,5,6],   Icon: CalendarDays},
                                  { label: "Weekends Only", days: [0,6],             Icon: Sunrise     },
                                  { label: "Clear All",     days: [],                Icon: RotateCcw   },
                                ] as { label: string; days: number[]; Icon: React.ElementType }[]).map(({ label, days, Icon }) => (
                                  <button
                                    key={label}
                                    type="button"
                                    onClick={() => {
                                      setDocSchedules(prev => prev.map(s => ({
                                        ...s,
                                        enabled: days.includes(s.dayOfWeek),
                                        startTime: s.startTime || "09:00",
                                        endTime:   s.endTime   || "18:00",
                                        slotDuration: s.slotDuration || 30,
                                      })));
                                    }}
                                    className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 hover:bg-brand/5 hover:border-brand/30 px-3 py-1.5 text-[10px] font-bold text-zinc-600 hover:text-brand transition-all cursor-pointer"
                                  >
                                    <Icon className="h-3 w-3" /> {label}
                                  </button>
                                ))}
                              </div>

                              {/* Global time apply */}
                              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-100">
                                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Apply same hours to all active days:</p>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <input
                                    type="time"
                                    id="globalStart"
                                    defaultValue="09:00"
                                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold focus:outline-none focus:border-brand"
                                  />
                                  <span className="text-zinc-400 text-xs">to</span>
                                  <input
                                    type="time"
                                    id="globalEnd"
                                    defaultValue="18:00"
                                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold focus:outline-none focus:border-brand"
                                  />
                                  <select
                                    id="globalSlot"
                                    defaultValue="30"
                                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold focus:outline-none focus:border-brand"
                                  >
                                    <option value={15}>15 min slots</option>
                                    <option value={30}>30 min slots</option>
                                    <option value={45}>45 min slots</option>
                                    <option value={60}>60 min slots</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const startEl = document.getElementById('globalStart') as HTMLInputElement;
                                      const endEl   = document.getElementById('globalEnd')   as HTMLInputElement;
                                      const slotEl  = document.getElementById('globalSlot')  as HTMLSelectElement;
                                      const st = startEl?.value || "09:00";
                                      const en = endEl?.value   || "18:00";
                                      const sl = parseInt(slotEl?.value || "30");
                                      setDocSchedules(prev => prev.map(s => s.enabled ? { ...s, startTime: st, endTime: en, slotDuration: sl } : s));
                                    }}
                                    className="rounded-full bg-black text-white text-[10px] font-bold px-3 py-1.5 hover:bg-black/90 cursor-pointer flex items-center gap-1"
                                  >
                                    <Check className="h-3 w-3" /> Apply
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Visual 7-day Calendar Grid */}
                            <div className="grid grid-cols-7 gap-1.5">
                              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayLabel, idx) => {
                                const sched = docSchedules.find(s => s.dayOfWeek === idx) || {
                                  dayOfWeek: idx, startTime: "09:00", endTime: "18:00", slotDuration: 30, enabled: false
                                };
                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => handleUpdateScheduleField(idx, "enabled", !sched.enabled)}
                                    className={`flex flex-col items-center rounded-xl border-2 px-1 py-2.5 text-center transition-all cursor-pointer ${
                                      sched.enabled
                                        ? "border-brand bg-brand/8 shadow-sm"
                                        : "border-zinc-150 bg-white hover:border-zinc-250"
                                    }`}
                                  >
                                    <span className={`text-[9px] font-black uppercase tracking-wider ${ sched.enabled ? "text-brand" : "text-zinc-400" }`}>{dayLabel}</span>
                                    <div className={`mt-1.5 h-7 w-7 rounded-full flex items-center justify-center ${
                                      sched.enabled ? "bg-black text-white" : "bg-zinc-100 text-zinc-350"
                                    }`}>
                                      {sched.enabled ? <CheckCircle2 className="h-4 w-4" /> : <X className="h-3.5 w-3.5" />}
                                    </div>
                                    {sched.enabled && (
                                      <span className="mt-1.5 text-[8px] font-bold text-brand/70 leading-tight">
                                        {sched.startTime}<br/>—<br/>{sched.endTime}
                                        {sched.breakStart && <><br/><span className="text-amber-500">☕ {sched.breakStart}</span></>}
                                      </span>
                                    )}
                                    {!sched.enabled && (
                                      <span className="mt-1.5 text-[8px] font-semibold text-zinc-300">Off</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Detailed Per-Day Config for enabled days */}
                            <div className="space-y-2">
                              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Adjust Hours per Active Day</p>
                              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((dayName, idx) => {
                                const sched = docSchedules.find(s => s.dayOfWeek === idx);
                                if (!sched?.enabled) return null;

                                const breaks: {start:string;end:string;label:string}[] = sched.breaks ?? [];

                                // Compute slot preview: total work mins minus all break durations
                                const [sh, sm] = (sched.startTime || "09:00").split(":").map(Number);
                                const [eh, em] = (sched.endTime   || "18:00").split(":").map(Number);
                                let workMins = (eh * 60 + em) - (sh * 60 + sm);
                                breaks.forEach(b => {
                                  if (b.start && b.end) {
                                    const [bsh, bsm] = b.start.split(":").map(Number);
                                    const [beh, bem] = b.end.split(":").map(Number);
                                    const bm = (beh * 60 + bem) - (bsh * 60 + bsm);
                                    if (bm > 0) workMins -= bm;
                                  }
                                });
                                const slots = workMins > 0 ? Math.floor(workMins / (sched.slotDuration || 30)) : 0;

                                return (
                                  <DayScheduleCard
                                    key={idx}
                                    dayName={dayName}
                                    idx={idx}
                                    sched={sched}
                                    breaks={breaks}
                                    slots={slots}
                                    allSchedules={docSchedules}
                                    onUpdateField={handleUpdateScheduleField}
                                    onAddBreak={addBreakToDay}
                                    onUpdateBreak={updateBreak}
                                    onRemoveBreak={removeBreak}
                                    onCopyBreaks={copyBreaksToDay}
                                  />
                                );
                              })}
                              {docSchedules.filter(s => s.enabled).length === 0 && (
                                <div className="text-center py-6 text-zinc-350 text-xs font-semibold">
                                  Click on days above to activate them ↑
                                </div>
                              )}
                            </div>

                            {docScheduleSuccess && (
                              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center animate-in fade-in">
                                <p className="text-xs font-bold text-emerald-600 flex items-center justify-center gap-1.5">
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {docScheduleSuccess}
                                </p>
                              </div>
                            )}

                            <div className="flex justify-between items-center border-t border-zinc-100 pt-3">
                              <span className="text-[10px] text-zinc-400">
                                {docSchedules.filter(s => s.enabled).length} working day{docSchedules.filter(s => s.enabled).length !== 1 ? 's' : ''} selected
                              </span>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedDocForSchedule(null)}
                                  className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-500 hover:bg-zinc-50 cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={savingDocSchedule}
                                  onClick={async () => {
                                    setDocScheduleSuccess("");
                                    setSavingDocSchedule(true);
                                    try {
                                      const activeSchedules = docSchedules
                                        .filter(s => s.enabled)
                                        .map(s => ({
                                          dayOfWeek: s.dayOfWeek,
                                          startTime: s.startTime,
                                          endTime: s.endTime,
                                          slotDuration: parseInt(s.slotDuration),
                                          breaks: (s.breaks ?? []).filter((b: any) => b.start && b.end),
                                        }));
                                      const res = await saveDoctorScheduleServerFn({ data: { doctorId: selectedDocForSchedule.id, schedules: activeSchedules } });
                                      if (res.success) {
                                        setDocScheduleSuccess("Weekly availability saved successfully!");
                                        setTimeout(() => setSelectedDocForSchedule(null), 1400);
                                      }
                                    } catch(err: any) { console.error(err); }
                                    finally { setSavingDocSchedule(false); }
                                  }}
                                  className="rounded-full bg-black text-white px-5 py-2 text-xs font-bold hover:bg-black/90 shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                                >
                                  {savingDocSchedule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                  Save Schedule
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : selectedDocForLeaves ? (
                          /* Render leaves manager — interactive month calendar */
                          <LeavesCalendarPanel
                            doc={selectedDocForLeaves}
                            docLeaves={docLeaves}
                            setDocLeaves={setDocLeaves}
                            addingLeave={addingLeave}
                            setAddingLeave={setAddingLeave}
                            onBack={() => setSelectedDocForLeaves(null)}
                            onDeleteLeave={handleDeleteDoctorLeave}
                          />
                        ) : isEditingDoc ? (
                          /* Doctor edit / create form */
                          <form onSubmit={handleSaveDoctor} className="space-y-4 border border-zinc-150 bg-zinc-50 rounded-2xl p-5 animate-in fade-in duration-300">
                            <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                              <h4 className="text-xs font-bold text-zinc-800 uppercase">
                                {editingDoc ? "Edit Doctor Profile" : "Register New Doctor"}
                              </h4>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsEditingDoc(false);
                                  setEditingDoc(null);
                                  clearDocForm();
                                }}
                                className="text-[10px] font-bold text-zinc-400 hover:text-zinc-650"
                              >
                                Back to List
                              </button>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <label className="block">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Doctor's Full Name</span>
                                <input
                                  type="text"
                                  value={docName}
                                  onChange={(e) => setDocName(e.target.value)}
                                  placeholder="Dr. John Watson"
                                  required
                                  className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Department Assignment</span>
                                <select
                                  value={docDeptId}
                                  onChange={(e) => setDocDeptId(e.target.value)}
                                  required
                                  className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all cursor-pointer"
                                >
                                  <option value="">Select Department</option>
                                  {departments.map((dept) => (
                                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <label className="block">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Work Email</span>
                                <input
                                  type="email"
                                  value={docEmail}
                                  onChange={(e) => setDocEmail(e.target.value)}
                                  placeholder="watson@bookmytime.com"
                                  required
                                  className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Mobile/Contact Phone</span>
                                <input
                                  type="text"
                                  value={docPhone}
                                  onChange={(e) => setDocPhone(e.target.value)}
                                  placeholder="(555) 123-4567"
                                  required
                                  className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all"
                                />
                              </label>
                            </div>

                            <label className="block">
                              <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Qualifications & Credentials</span>
                              <input
                                type="text"
                                value={docQualifications}
                                onChange={(e) => setDocQualifications(e.target.value)}
                                placeholder="MD, FACP - Family Medicine Specialist"
                                required
                                className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all"
                              />
                            </label>

                            {docSuccess && (
                              <div className="rounded-full bg-emerald-50 border border-emerald-100 p-2.5 text-center">
                                <p className="text-[10px] font-bold text-emerald-600 flex items-center justify-center gap-1 leading-none">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {docSuccess}
                                </p>
                              </div>
                            )}
                            {docError && (
                              <div className="rounded-2xl bg-red-50 border border-red-100 p-3.5 text-[10px] font-bold text-red-650 text-left space-y-2 flex flex-col items-start w-full">
                                <div className="flex items-center gap-1.5 text-red-800">
                                  <AlertCircle className="h-4 w-4 shrink-0 text-red-650" />
                                  <span>Plan Restriction Alert</span>
                                </div>
                                <p className="text-[11px] leading-relaxed text-red-750 font-medium">{docError}</p>
                                {docError.toLowerCase().includes("upgrade") && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveTab("plans");
                                      setDocError("");
                                      setIsEditingDoc(false);
                                      setEditingDoc(null);
                                      clearDocForm();
                                    }}
                                    className="rounded-full bg-red-650 hover:bg-red-700 text-white px-3.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer shadow-sm active:scale-[0.98]"
                                  >
                                    Upgrade Plan Now
                                  </button>
                                )}
                              </div>
                            )}

                            <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setIsEditingDoc(false);
                                  setEditingDoc(null);
                                  clearDocForm();
                                }}
                                className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-500 cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                disabled={savingDoc}
                                className="rounded-full bg-black text-white px-5 py-2 text-xs font-semibold hover:bg-black/90 shadow-md flex items-center gap-1.5 cursor-pointer"
                              >
                                {savingDoc && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {editingDoc ? "Update Doctor" : "Register Doctor"}
                              </button>
                            </div>
                          </form>
                        ) : (
                          /* Doctors List View */
                          <div className="space-y-4">
                            <div className="flex justify-end">
                              <button
                                onClick={handleOpenAddDoctor}
                                className="rounded-full bg-zinc-950 hover:bg-zinc-850 px-4 py-2 text-xs font-semibold text-white transition-all cursor-pointer inline-flex items-center gap-1"
                              >
                                <Plus className="h-3.5 w-3.5" /> Add Doctor File
                              </button>
                            </div>

                            {loadingDocs ? (
                              <div className="flex justify-center py-6">
                                <Loader2 className="h-6 w-6 animate-spin text-brand" />
                              </div>
                            ) : (
                              <div className="grid gap-4 md:grid-cols-2">
                                {doctors.map((doc) => (
                                  <div key={doc.id} className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col justify-between space-y-3.5 transition-shadow duration-200">
                                    <div>
                                      <div className="flex items-start justify-between">
                                        <div>
                                          <h4 className="text-xs font-bold text-zinc-800 leading-snug">{doc.name}</h4>
                                          <span className="text-[9px] font-bold text-brand bg-brand/5 border border-brand/10 rounded-full px-2.5 py-0.5 mt-1 inline-block">
                                            {doc.departmentName || "General Staff"}
                                          </span>
                                        </div>
                                        <div className="flex gap-1.5">
                                          <button
                                            onClick={() => handleOpenEditDoctor(doc)}
                                            className="text-[10px] font-bold text-zinc-400 hover:text-zinc-650"
                                          >
                                            Edit
                                          </button>
                                          <span className="text-zinc-200 text-[10px]">|</span>
                                          <button
                                            onClick={() => handleDeleteDoctor(doc.id)}
                                            className="text-[10px] font-bold text-red-400 hover:text-red-650"
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>

                                      <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
                                        <strong className="text-zinc-600 block uppercase text-[8px] tracking-wider font-extrabold mb-0.5">Credentials</strong>
                                        {doc.qualifications}
                                      </p>

                                      <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-400 font-semibold mt-3 pt-3 border-t border-zinc-100">
                                        <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3 shrink-0" /> {doc.email}</span>
                                        <span className="flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" /> {doc.phone}</span>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 pt-1">
                                      <button
                                        onClick={() => handleEditDoctorSchedule(doc)}
                                        className="rounded-full bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-[10px] font-bold py-1.5 cursor-pointer text-zinc-600 flex items-center justify-center gap-1"
                                      >
                                        <Clock className="h-3 w-3 animate-none" /> Weekly Hours
                                      </button>
                                      <button
                                        onClick={() => handleEditDoctorLeaves(doc)}
                                        className="rounded-full bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-[10px] font-bold py-1.5 cursor-pointer text-zinc-600 flex items-center justify-center gap-1"
                                      >
                                        <Calendar className="h-3 w-3" /> Leaves & Closed
                                      </button>
                                    </div>
                                  </div>
                                ))}
                                {doctors.length === 0 && (
                                  <div className="md:col-span-2 rounded-2xl border border-dashed border-zinc-250 p-8 text-center text-zinc-400 font-semibold">
                                    No doctors registered. Register a provider profile above.
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                {/* ──────────────────────────────────────────────
                    SUB-TAB: WHATSAPP WEB ALERTS
                    ────────────────────────────────────────────── */}
                {settingsSubTab === "whatsapp" && (
                  <div className="space-y-5 animate-in fade-in duration-300">

                    {/* Header */}
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4 text-brand" />
                      <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">WhatsApp Web Alerts</h4>
                    </div>

                    {/* Database Alert Config Card */}
                    <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
                      <div className="flex items-center gap-2 border-b border-zinc-100 pb-2">
                        <Smartphone className="h-4 w-4 text-brand animate-none" />
                        <h5 className="text-xs font-bold text-zinc-800">Alert Settings</h5>
                      </div>

                      <form onSubmit={handleSaveWhatsAppConfig} className="space-y-4 text-left">
                        <div className="flex items-center justify-between p-3 rounded-xl border border-zinc-150 bg-zinc-50/30">
                          <div>
                            <p className="text-xs font-bold text-zinc-800">Enable Automated Alerts</p>
                            <p className="text-[10px] text-zinc-400 mt-0.5">Send booking confirmations and updates directly to patients.</p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={waConfigEnabled}
                              onChange={(e) => setWaConfigEnabled(e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-zinc-250 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand"></div>
                          </label>
                        </div>

                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">WhatsApp Alert Mobile Number</span>
                          <input
                            type="text"
                            placeholder="e.g. 919876543210"
                            value={waConfigPhone}
                            onChange={(e) => setWaConfigPhone(e.target.value.replace(/\D/g, ""))}
                            className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all"
                          />
                        </label>

                        {waConfigSuccess && (
                          <div className="rounded-full bg-emerald-50 border border-emerald-100 p-2.5 text-center animate-in fade-in duration-200">
                            <p className="text-[10px] font-bold text-emerald-600 flex items-center justify-center gap-1 leading-none">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {waConfigSuccess}
                            </p>
                          </div>
                        )}
                        {waConfigError && (
                          <div className="rounded-full bg-red-50 border border-red-100 p-2.5 text-center animate-in fade-in duration-200">
                            <p className="text-[10px] font-bold text-red-600 flex items-center justify-center gap-1 leading-none">
                              <AlertCircle className="h-3.5 w-3.5 text-red-500" /> {waConfigError}
                            </p>
                          </div>
                        )}

                        <div className="flex justify-end pt-1">
                          <button
                            type="submit"
                            disabled={savingWaConfig}
                            className="rounded-full bg-zinc-950 hover:bg-zinc-850 px-5 py-2 text-xs font-semibold text-white transition-all active:scale-[0.98] cursor-pointer flex items-center gap-1.5"
                          >
                            {savingWaConfig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Save Alert Settings
                          </button>
                        </div>
                      </form>
                    </div>

                    {/* Connection Card */}
                    <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                      {/* Status bar */}
                      <div className={`h-1 w-full ${
                        waStatus === "CONNECTED" ? "bg-emerald-500" :
                        waStatus === "QR_READY" || waStatus === "CONNECTING" ? "bg-amber-400 animate-pulse" :
                        waStatus === "ERROR" ? "bg-red-500" : "bg-zinc-200"
                      }`} />

                      <div className="p-5 space-y-4">
                        {/* Status header row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            {waStatus === "CONNECTED" ? (
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100">
                                <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                              </span>
                            ) : (
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100">
                                <WifiOff className="h-3.5 w-3.5 text-zinc-400" />
                              </span>
                            )}
                            <div>
                              <p className="text-xs font-black text-zinc-850 leading-none">
                                {waStatus === "CONNECTED" ? "Connected" :
                                 waStatus === "QR_READY" ? "Waiting for Scan" :
                                 waStatus === "CONNECTING" ? "Initializing..." :
                                 waStatus === "ERROR" ? "Connection Error" : "Disconnected"}
                              </p>
                              {waConnectedNumber && (
                                <p className="text-[10px] text-zinc-500 font-semibold mt-0.5">+{waConnectedNumber}</p>
                              )}
                              {!waConnectedNumber && waStatus !== "CONNECTED" && (
                                <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">Not linked to any device</p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={fetchWhatsAppStatus}
                              title="Refresh status"
                              className="h-7 w-7 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center transition-colors cursor-pointer"
                            >
                              <RefreshCw className="h-3.5 w-3.5 text-zinc-500" />
                            </button>
                            {waStatus === "CONNECTED" && (
                              <button
                                type="button"
                                onClick={handleDisconnectWhatsApp}
                                className="rounded-full border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-bold px-3 py-1.5 transition-colors cursor-pointer"
                              >
                                Disconnect
                              </button>
                            )}
                          </div>
                        </div>

                        {/* QR Code area — shown when not connected */}
                        {waStatus !== "CONNECTED" && (
                          <div className="rounded-xl bg-zinc-50 border border-zinc-150 p-4">
                            {waQrDataUrl ? (
                              <div className="flex flex-col sm:flex-row items-center gap-4">
                                <div className="bg-white p-3 rounded-xl border border-zinc-200 shrink-0">
                                  <img
                                    src={waQrDataUrl}
                                    alt="WhatsApp QR Code to scan"
                                    className="h-36 w-36 object-contain"
                                  />
                                </div>
                                <div className="space-y-2 text-left">
                                  <p className="text-xs font-bold text-zinc-800">Scan to connect WhatsApp</p>
                                  <ol className="text-[10px] text-zinc-500 font-semibold space-y-1.5 leading-relaxed list-decimal pl-4">
                                    <li>Open WhatsApp on your phone</li>
                                    <li>Tap <strong>Settings → Linked Devices</strong></li>
                                    <li>Tap <strong>Link a Device</strong></li>
                                    <li>Point your phone camera at the QR code</li>
                                  </ol>
                                  <p className="text-[9px] text-zinc-400 pt-1">QR code refreshes automatically every 20s</p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3 p-2">
                                <div className="h-10 w-10 rounded-lg bg-zinc-200 animate-pulse shrink-0" />
                                <div className="space-y-1.5">
                                  <div className="h-2.5 w-32 rounded-full bg-zinc-200 animate-pulse" />
                                  <div className="h-2 w-48 rounded-full bg-zinc-200 animate-pulse" />
                                  <p className="text-[10px] text-zinc-400 font-semibold">Starting WhatsApp browser session...</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Connected state: real-time info */}
                        {waStatus === "CONNECTED" && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center">
                              <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider mb-1">Queue Pending</p>
                              <p className="text-xl font-black text-emerald-700">{waQueueCount}</p>
                            </div>
                            <div className="rounded-xl bg-zinc-50 border border-zinc-150 p-3 text-center">
                              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Messages Sent</p>
                              <p className="text-xl font-black text-zinc-800">{waSentLogs.filter((l: any) => l.status === "sent").length}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Test Broadcast — only shown when connected */}
                    {waStatus === "CONNECTED" && (
                      <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
                        <div className="flex items-center gap-2">
                          <Send className="h-3.5 w-3.5 text-brand" />
                          <h5 className="text-xs font-bold text-zinc-800">Send Test Notification</h5>
                        </div>

                        <form onSubmit={handleSendTestWa} className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-zinc-400 uppercase pl-1">Recipient Number (with country code)</label>
                            <input
                              type="text"
                              placeholder="e.g. 919876543210"
                              value={testWaPhone}
                              onChange={(e) => setTestWaPhone(e.target.value.replace(/\D/g, ""))}
                              className="w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all"
                              required
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-zinc-400 uppercase pl-1">Message</label>
                            <textarea
                              placeholder="Hello! This is a test notification from BookMyTime..."
                              value={testWaBody}
                              onChange={(e) => setTestWaBody(e.target.value)}
                              rows={2}
                              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:outline-none focus:border-brand transition-all"
                              required
                            />
                          </div>
                          {testWaSuccess && (
                            <div className="rounded-full bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-center">
                              <p className="text-[10px] font-bold text-emerald-600 flex items-center justify-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> {testWaSuccess}
                              </p>
                            </div>
                          )}
                          {testWaError && (
                            <div className="rounded-full bg-red-50 border border-red-100 px-4 py-2.5 text-center">
                              <p className="text-[10px] font-bold text-red-600 flex items-center justify-center gap-1">
                                <AlertCircle className="h-3 w-3" /> {testWaError}
                              </p>
                            </div>
                          )}
                          <button
                            type="submit"
                            disabled={sendingTestWa}
                            className="w-full rounded-full bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold py-2.5 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:bg-zinc-100 disabled:text-zinc-400"
                          >
                            {sendingTestWa ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            Queue Message
                          </button>
                        </form>
                      </div>
                    )}

                    {/* Sent Log */}
                    {waSentLogs.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Recent Outbox (anti-ban throttled)</p>
                        <div className="border border-zinc-150 rounded-2xl overflow-hidden bg-white">
                          <div className="max-h-52 overflow-y-auto">
                            <table className="min-w-full divide-y divide-zinc-100 text-left">
                              <thead className="bg-zinc-50 text-[9px] font-bold text-zinc-400 uppercase sticky top-0">
                                <tr>
                                  <th className="px-4 py-2">Time</th>
                                  <th className="px-4 py-2">Recipient</th>
                                  <th className="px-4 py-2">Message</th>
                                  <th className="px-4 py-2 text-right">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-50 text-[10px]">
                                {waSentLogs.map((log: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-zinc-50/70">
                                    <td className="px-4 py-2.5 text-zinc-400 font-semibold whitespace-nowrap">
                                      {new Date(log.timestamp).toLocaleTimeString()}
                                    </td>
                                    <td className="px-4 py-2.5 font-bold text-zinc-700">+{log.recipient}</td>
                                    <td className="px-4 py-2.5 text-zinc-600 max-w-[200px] truncate">{log.message}</td>
                                    <td className="px-4 py-2.5 text-right">
                                      <span className={`inline-block rounded-full px-2 py-0.5 text-[8px] font-black border ${
                                        log.status === "sent"
                                          ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                                          : "bg-red-50 border-red-100 text-red-600"
                                      }`}>
                                        {log.status === "sent" ? "SENT" : "FAILED"}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Info note about auto-notifications */}
                    <div className="rounded-2xl bg-blue-50/60 border border-blue-100 p-4 text-[10px] text-blue-700 font-semibold leading-relaxed space-y-1">
                      <p className="font-black text-blue-800">Auto-Notifications enabled when connected:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li>📅 New appointment booked (from public form or dashboard)</li>
                        <li>✅ Appointment status changes (Confirmed, Cancelled, Completed)</li>
                        <li>⏱️ Anti-ban throttling: 8–15 second gap between messages</li>
                      </ul>
                    </div>
                  </div>
                )}

                {/* Multi Location Tab */}
                {settingsSubTab === "locations" && (
                  <MultiLocationSettings
                    user={user}
                    onSwitchToPlans={() => setActiveTab("plans")}
                    professionLabels={{
                      sectionTitle: "Multi-Location Offices",
                      sectionDescription: "Create login credentials for each firm/office branch. Each location can log in with its own email and password to manage its bookings via the workspace dashboard.",
                      singular: "Office Location",
                    }}
                  />
                )}

                {/* Manage Users Tab */}
                {settingsSubTab === "users" && (
                  <div className="space-y-5 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-brand" />
                        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Manage Sub-Users</h4>
                      </div>
                      <button type="button"
                        onClick={() => { setEditingSubUser(null); setSubUserForm({ name: "", email: "", phone: "", role: "reception", doctorId: "", password: "", confirmPassword: "" }); setSubUserError(""); setSubUserSuccess(""); setShowSubUserForm(v => !v); }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-black text-white px-4 py-2 text-[10px] font-bold hover:bg-black/90 cursor-pointer transition-all">
                        <Plus className="h-3 w-3" /> Add User
                      </button>
                    </div>
                    {user && (() => {
                      const displayPlan = user.subscriptionPlan === "Solo" || !user.subscriptionPlan ? "Basic" : user.subscriptionPlan === "Clinic" ? "Premium" : user.subscriptionPlan;
                      return (
                        <div className="flex items-center gap-2 text-[10px] font-semibold text-zinc-500">
                          <Info className="h-3.5 w-3.5 text-brand/60 shrink-0" />
                          Current plan: <span className="font-black text-brand">{displayPlan}</span>
                          {(user.subscriptionPlan === "Solo" || user.subscriptionPlan === "Basic" || !user.subscriptionPlan) ? " — up to 1 receptionist account" : (user.subscriptionPlan === "Clinic" || user.subscriptionPlan === "Premium") ? " — up to 5 sub-user accounts" : " — unlimited"}
                        </div>
                      );
                    })()}
                    {showSubUserForm && (
                      <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                        <h5 className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                          <UserPlus className="h-3.5 w-3.5 text-brand" />
                          {editingSubUser ? "Edit Sub-User" : "Create New Sub-User"}
                        </h5>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Full Name *</span>
                            <input type="text" value={subUserForm.name} placeholder="Enter full name"
                              onChange={e => setSubUserForm(f => ({ ...f, name: e.target.value }))}
                              className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all" />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Email Address *</span>
                            <input type="email" value={subUserForm.email} placeholder="youremail@gmail.com" disabled={!!editingSubUser}
                              onChange={e => setSubUserForm(f => ({ ...f, email: e.target.value }))}
                              className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all disabled:opacity-50" />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Phone (optional)</span>
                            <input type="tel" value={subUserForm.phone} placeholder="+91 9876543210"
                              onChange={e => setSubUserForm(f => ({ ...f, phone: e.target.value }))}
                              className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all" />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Role *</span>
                            <select value={subUserForm.role} onChange={e => setSubUserForm(f => ({ ...f, role: e.target.value as "reception"|"doctor" }))}
                              className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all cursor-pointer">
                              <option value="reception">Reception</option>
                              <option value="doctor">Doctor</option>
                            </select>
                          </label>
                          {subUserForm.role === "doctor" && (
                            <label className="block sm:col-span-2">
                              <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Link to Doctor Profile</span>
                              <select value={subUserForm.doctorId} onChange={e => setSubUserForm(f => ({ ...f, doctorId: e.target.value }))}
                                className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all cursor-pointer">
                                <option value="">Select doctor profile</option>
                                {doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}{d.specialization ? ` (${d.specialization})` : ""}</option>)}
                              </select>
                            </label>
                          )}
                          <label className="block relative">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{editingSubUser ? "New Password (leave blank to keep)" : "Password *"}</span>
                            <input type={showSubUserPwd ? "text" : "password"} value={subUserForm.password}
                              placeholder={editingSubUser ? "Leave blank to keep current" : "Min 8 characters"}
                              onChange={e => setSubUserForm(f => ({ ...f, password: e.target.value }))}
                              className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 pr-10 text-xs font-semibold focus:outline-none focus:border-brand transition-all" />
                            <button type="button" onClick={() => setShowSubUserPwd(v => !v)} className="absolute right-3 top-7 text-zinc-400 hover:text-zinc-600 cursor-pointer"><Lock className="h-3.5 w-3.5" /></button>
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Confirm Password{!editingSubUser ? " *" : ""}</span>
                            <input type={showSubUserPwd ? "text" : "password"} value={subUserForm.confirmPassword} placeholder="Re-enter password"
                              onChange={e => setSubUserForm(f => ({ ...f, confirmPassword: e.target.value }))}
                              className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all" />
                          </label>
                        </div>
                        {subUserError && (
                          <div className="rounded-2xl bg-red-50 border border-red-100 p-3.5 text-[10px] font-bold text-red-650 text-left space-y-2 flex flex-col items-start w-full">
                            <div className="flex items-center gap-1.5 text-red-800">
                              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                              <span>Plan Restriction Alert</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-red-750 font-medium">{subUserError}</p>
                            {subUserError.toLowerCase().includes("upgrade") && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTab("plans");
                                  setSubUserError("");
                                  setShowSubUserForm(false);
                                  setEditingSubUser(null);
                                }}
                                className="rounded-full bg-red-650 hover:bg-red-700 text-white px-3.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer shadow-sm active:scale-[0.98]"
                              >
                                Upgrade Plan Now
                              </button>
                            )}
                          </div>
                        )}
                        {subUserSuccess && <div className="rounded-full bg-emerald-50 border border-emerald-100 px-4 py-2 text-[10px] font-bold text-emerald-600 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {subUserSuccess}</div>}
                        <div className="flex gap-2 justify-end pt-1 border-t border-zinc-100">
                          <button type="button" onClick={() => { setShowSubUserForm(false); setEditingSubUser(null); }}
                            className="rounded-full border border-zinc-200 px-5 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer">Cancel</button>
                          <button type="button" disabled={savingSubUser}
                            onClick={async () => {
                              setSubUserError(""); setSubUserSuccess("");
                              if (!subUserForm.name.trim() || !subUserForm.email.trim()) { setSubUserError("Name and email are required"); return; }
                              if (!editingSubUser && !subUserForm.password) { setSubUserError("Password is required"); return; }
                              if (subUserForm.password && subUserForm.password.length < 8) { setSubUserError("Password must be at least 8 characters"); return; }
                              if (subUserForm.password && subUserForm.password !== subUserForm.confirmPassword) { setSubUserError("Passwords do not match"); return; }
                              setSavingSubUser(true);
                              try {
                                if (editingSubUser) {
                                  await updateSubUserServerFn({ data: { id: editingSubUser.id, name: subUserForm.name, phone: subUserForm.phone, role: subUserForm.role, doctorId: subUserForm.doctorId || undefined, password: subUserForm.password || undefined } });
                                } else {
                                  await createSubUserServerFn({ data: { name: subUserForm.name, email: subUserForm.email, phone: subUserForm.phone, role: subUserForm.role, doctorId: subUserForm.doctorId || undefined, password: subUserForm.password } });
                                }
                                setSubUserSuccess(editingSubUser ? "Sub-user updated!" : "Sub-user created!");
                                const refreshed = await getSubUsersServerFn();
                                setSubUsers(refreshed);
                                setTimeout(() => { setShowSubUserForm(false); setEditingSubUser(null); setSubUserSuccess(""); }, 1200);
                              } catch (e: any) { setSubUserError(e.message || "Failed to save sub-user"); }
                              finally { setSavingSubUser(false); }
                            }}
                            className="rounded-full bg-black text-white px-5 py-2 text-xs font-bold hover:bg-black/90 disabled:opacity-60 cursor-pointer flex items-center gap-1.5">
                            {savingSubUser ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            {editingSubUser ? "Update User" : "Create User"}
                          </button>
                        </div>
                      </div>
                    )}
                    {subUsersLoading ? (
                      <div className="flex items-center justify-center py-10 gap-2 text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
                    ) : subUsers.length === 0 ? (
                      <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center space-y-2">
                        <Users className="h-8 w-8 text-zinc-200 mx-auto" />
                        <p className="text-xs font-bold text-zinc-400">No sub-users yet</p>
                        <p className="text-[10px] text-zinc-300">Click "Add User" to create logins for staff.</p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-zinc-100 bg-zinc-50">
                              <th className="w-10 px-4 py-3">
                                <input
                                  type="checkbox"
                                  className="rounded border-zinc-300 text-brand accent-brand cursor-pointer"
                                  onChange={e => {
                                    const all = e.target.checked ? subUsers.map((s: any) => s.id) : [];
                                    setSelectedSubUsers(all);
                                  }}
                                  checked={selectedSubUsers.length === subUsers.length && subUsers.length > 0}
                                />
                              </th>
                              <th className="px-4 py-3 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider">User</th>
                              <th className="px-4 py-3 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider hidden sm:table-cell">Contact</th>
                              <th className="px-4 py-3 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Role</th>
                              <th className="px-4 py-3 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider hidden md:table-cell">Status</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {subUsers.map((su: any) => (
                              <tr key={su.id} className="hover:bg-zinc-50 transition-colors">
                                <td className="px-4 py-3">
                                  <input
                                    type="checkbox"
                                    className="rounded border-zinc-300 accent-brand cursor-pointer"
                                    checked={selectedSubUsers.includes(su.id)}
                                    onChange={e => {
                                      setSelectedSubUsers(prev =>
                                        e.target.checked ? [...prev, su.id] : prev.filter((id: any) => id !== su.id)
                                      );
                                    }}
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2.5">
                                    <div className={`h-7 w-7 rounded-full flex items-center justify-center text-white text-[9px] font-black shrink-0 ${su.role === "doctor" ? "bg-indigo-500" : "bg-black"}`}>
                                      {su.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()}
                                    </div>
                                    <span className="font-semibold text-zinc-800 truncate max-w-[120px]">{su.name}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 hidden sm:table-cell">
                                  <span className="text-zinc-500 truncate max-w-[160px] block">{su.email}{su.phone ? <><br /><span className="text-zinc-400">{su.phone}</span></> : ""}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border ${su.role === "doctor" ? "bg-indigo-50 border-indigo-100 text-indigo-700" : "bg-brand/5 border-brand/15 text-brand"}`}>
                                    {su.role === "doctor" ? <Stethoscope className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
                                    {su.role === "reception" ? "Reception" : "Doctor"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 hidden md:table-cell">
                                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${su.isActive ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-400"}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${su.isActive ? "bg-emerald-500" : "bg-zinc-300"}`} />
                                    {su.isActive ? "Active" : "Inactive"}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center justify-center gap-1">
                                    {/* View */}
                                    <button
                                      type="button"
                                      title="View"
                                      onClick={() => setViewingSubUser(su)}
                                      className="p-1.5 rounded-lg text-zinc-400 hover:text-brand hover:bg-brand/5 transition-colors cursor-pointer"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                    </button>
                                    {/* Edit */}
                                    <button
                                      type="button"
                                      title="Edit"
                                      onClick={() => { setEditModalSubUser(su); setSubUserForm({ name: su.name, email: su.email, phone: su.phone || "", role: su.role, doctorId: su.doctorId || "", password: "", confirmPassword: "" }); setSubUserError(""); setSubUserSuccess(""); }}
                                      className="p-1.5 rounded-lg text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                    {/* Activate / Deactivate */}
                                    <button
                                      type="button"
                                      title={su.isActive ? "Deactivate" : "Activate"}
                                      onClick={async () => { const n = su.isActive ? 0 : 1; await updateSubUserServerFn({ data: { id: su.id, isActive: n } }); setSubUsers((prev: any[]) => prev.map(s => s.id === su.id ? { ...s, isActive: n } : s)); }}
                                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${su.isActive ? "text-emerald-500 hover:text-zinc-400 hover:bg-zinc-50" : "text-zinc-300 hover:text-emerald-500 hover:bg-emerald-50"}`}
                                    >
                                      <Power className="h-3.5 w-3.5" />
                                    </button>
                                    {/* Delete */}
                                    <button
                                      type="button"
                                      title="Delete"
                                      onClick={() => setSubUserToDelete(su)}
                                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                    <hr className="border-zinc-100" />

              </motion.div>
            )}

            {/* ── View Sub-User Modal ── */}
            <AnimatePresence>
              {viewingSubUser && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm"
                  onClick={() => setViewingSubUser(null)}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 16 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 16 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    onClick={e => e.stopPropagation()}
                    className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-zinc-200 overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-brand" />
                        <h3 className="text-sm font-bold text-zinc-900">User Details</h3>
                      </div>
                      <button type="button" onClick={() => setViewingSubUser(null)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 transition-colors cursor-pointer">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Body */}
                    <div className="px-6 py-5 space-y-5">
                      {/* Avatar + name */}
                      <div className="flex items-center gap-4">
                        <div className={`h-14 w-14 rounded-full flex items-center justify-center text-white text-lg font-black shrink-0 ${viewingSubUser.role === "doctor" ? "bg-indigo-500" : "bg-black"}`}>
                          {viewingSubUser.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-zinc-900">{viewingSubUser.name}</p>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border mt-1 ${viewingSubUser.role === "doctor" ? "bg-indigo-50 border-indigo-100 text-indigo-700" : "bg-brand/5 border-brand/15 text-brand"}`}>
                            {viewingSubUser.role === "doctor" ? <Stethoscope className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
                            {viewingSubUser.role === "reception" ? "Reception" : "Doctor"}
                          </span>
                        </div>
                      </div>
                      {/* Details grid */}
                      <div className="rounded-xl bg-zinc-50 border border-zinc-100 divide-y divide-zinc-100">
                        {[
                          { label: "Email", value: viewingSubUser.email, icon: Mail },
                          { label: "Phone", value: viewingSubUser.phone || "—", icon: Phone },
                          { label: "Status", value: viewingSubUser.isActive ? "Active" : "Inactive", icon: Power, color: viewingSubUser.isActive ? "text-emerald-600" : "text-zinc-400" },
                          { label: "User ID", value: `#${viewingSubUser.id}`, icon: Info },
                        ].map(({ label, value, icon: Icon, color }) => (
                          <div key={label} className="flex items-center gap-3 px-4 py-2.5">
                            <Icon className={`h-3.5 w-3.5 shrink-0 ${color || "text-zinc-400"}`} />
                            <span className="text-[10px] font-bold text-zinc-400 w-14 shrink-0">{label}</span>
                            <span className={`text-xs font-semibold truncate ${color || "text-zinc-700"}`}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Footer */}
                    <div className="px-6 py-3 border-t border-zinc-100 flex justify-end gap-2">
                      <button type="button" onClick={() => setViewingSubUser(null)} className="rounded-full border border-zinc-200 px-5 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer">Close</button>
                      <button type="button" onClick={() => { setEditModalSubUser(viewingSubUser); setSubUserForm({ name: viewingSubUser.name, email: viewingSubUser.email, phone: viewingSubUser.phone || "", role: viewingSubUser.role, doctorId: viewingSubUser.doctorId || "", password: "", confirmPassword: "" }); setSubUserError(""); setSubUserSuccess(""); setViewingSubUser(null); }} className="rounded-full bg-black text-white px-5 py-2 text-xs font-bold hover:bg-black/90 cursor-pointer flex items-center gap-1.5">
                        <Edit3 className="h-3 w-3" /> Edit
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Edit Sub-User Modal ── */}
            <AnimatePresence>
              {editModalSubUser && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm"
                  onClick={() => setEditModalSubUser(null)}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 16 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 16 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    onClick={e => e.stopPropagation()}
                    className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-zinc-200 overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                      <div className="flex items-center gap-2">
                        <Edit3 className="h-4 w-4 text-indigo-600" />
                        <h3 className="text-sm font-bold text-zinc-900">Edit User</h3>
                        <span className="text-xs text-zinc-400">— {editModalSubUser.name}</span>
                      </div>
                      <button type="button" onClick={() => setEditModalSubUser(null)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 transition-colors cursor-pointer">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Body */}
                    <div className="px-6 py-5 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Full Name *</span>
                          <input type="text" value={subUserForm.name} placeholder="Enter full name"
                            onChange={e => setSubUserForm(f => ({ ...f, name: e.target.value }))}
                            className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all" />
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Email</span>
                          <input type="email" value={subUserForm.email} disabled
                            className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-100 px-4 py-2 text-xs font-semibold opacity-50 cursor-not-allowed" />
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Phone</span>
                          <input type="tel" value={subUserForm.phone} placeholder="+91 9876543210"
                            onChange={e => setSubUserForm(f => ({ ...f, phone: e.target.value }))}
                            className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all" />
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Role *</span>
                          <select value={subUserForm.role} onChange={e => setSubUserForm(f => ({ ...f, role: e.target.value as "reception" | "doctor" }))}
                            className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all cursor-pointer">
                            <option value="reception">Reception</option>
                            <option value="doctor">Doctor</option>
                          </select>
                        </label>
                        <label className="block relative">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">New Password (leave blank to keep)</span>
                          <input type={showSubUserPwd ? "text" : "password"} value={subUserForm.password}
                            placeholder="Leave blank to keep current"
                            onChange={e => setSubUserForm(f => ({ ...f, password: e.target.value }))}
                            className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 pr-10 text-xs font-semibold focus:outline-none focus:border-brand transition-all" />
                          <button type="button" onClick={() => setShowSubUserPwd(v => !v)} className="absolute right-3 top-7 text-zinc-400 hover:text-zinc-600 cursor-pointer"><Lock className="h-3.5 w-3.5" /></button>
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Confirm Password</span>
                          <input type={showSubUserPwd ? "text" : "password"} value={subUserForm.confirmPassword} placeholder="Re-enter password"
                            onChange={e => setSubUserForm(f => ({ ...f, confirmPassword: e.target.value }))}
                            className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all" />
                        </label>
                      </div>
                      {subUserError && (
                        <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-[10px] font-bold text-red-600 flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {subUserError}
                        </div>
                      )}
                      {subUserSuccess && (
                        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-[10px] font-bold text-emerald-600 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {subUserSuccess}
                        </div>
                      )}
                    </div>
                    {/* Footer */}
                    <div className="px-6 py-3 border-t border-zinc-100 flex justify-end gap-2">
                      <button type="button" onClick={() => { setEditModalSubUser(null); setSubUserError(""); setSubUserSuccess(""); }} className="rounded-full border border-zinc-200 px-5 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer">Cancel</button>
                      <button
                        type="button"
                        disabled={savingSubUser}
                        onClick={async () => {
                          setSubUserError(""); setSubUserSuccess("");
                          if (!subUserForm.name.trim()) { setSubUserError("Name is required"); return; }
                          if (subUserForm.password && subUserForm.password.length < 8) { setSubUserError("Password must be at least 8 characters"); return; }
                          if (subUserForm.password && subUserForm.password !== subUserForm.confirmPassword) { setSubUserError("Passwords do not match"); return; }
                          setSavingSubUser(true);
                          try {
                            await updateSubUserServerFn({ data: { id: editModalSubUser.id, name: subUserForm.name, phone: subUserForm.phone, role: subUserForm.role, doctorId: subUserForm.doctorId || undefined, password: subUserForm.password || undefined } });
                            setSubUserSuccess("User updated successfully!");
                            const refreshed = await getSubUsersServerFn();
                            setSubUsers(refreshed);
                            setTimeout(() => { setEditModalSubUser(null); setSubUserSuccess(""); }, 1200);
                          } catch (e: any) { setSubUserError(e.message || "Failed to update user"); }
                          finally { setSavingSubUser(false); }
                        }}
                        className="rounded-full bg-black text-white px-5 py-2 text-xs font-bold hover:bg-black/90 disabled:opacity-60 cursor-pointer flex items-center gap-1.5"
                      >
                        {savingSubUser ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Update User
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ──────────────────────────────────────────────
                TAB: MANAGE PLANS & BILLING
                ────────────────────────────────────────────── */}
            {activeTab === "plans" && (() => {
              const rawPlan = (user?.subscriptionPlan || "").toLowerCase();
              // Canonical current tier (mirrors normalizePlan in feature-access).
              const currentTier: "Basic" | "Premium" | "Enterprise" =
                rawPlan.includes("enterprise") || rawPlan.includes("hospital")
                  ? "Enterprise"
                  : (rawPlan.includes("premium") || rawPlan.includes("clinic") || rawPlan.includes("1499") || rawPlan.includes("pro"))
                    ? "Premium"
                    : "Basic";
              const planDisplayName = currentTier;

              // A real, paid subscription has a recorded gateway payment. During
              // the free trial the account is "Active" but has no payment yet.
              const paymentMethodRaw = (user?.paymentMethod || "").toLowerCase();
              const hasPaid = Number(user?.paymentAmount) > 0
                && paymentMethodRaw !== ""
                && paymentMethodRaw !== "none"
                && paymentMethodRaw !== "trial";
              const isTrialing = !hasPaid;

              const expiryTime = user?.subscriptionExpiresAt
                ? new Date(user.subscriptionExpiresAt).getTime()
                : user?.createdAt
                  ? new Date(user.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000
                  : Date.now() + 7 * 24 * 60 * 60 * 1000;
              const trialEndsInDays = Math.max(0, Math.ceil((expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));
              const trialActive = isTrialing && expiryTime > Date.now();
              const expiryDateString = new Date(expiryTime).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              });

              return (
                <motion.div
                  key="plans"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="space-y-6"
                >
                  {/* Header card with plan summary */}
                  <div className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-6">
                    <div>
                      <h3 className="text-base font-bold text-zinc-900">Subscription & Billing</h3>
                      <p className="text-xs text-zinc-500 font-semibold mt-1">
                        Manage your workspace plan, view usage quotas, and check subscription expiration.
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {/* Active Plan Card */}
                      <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-4.5 space-y-3.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Current Plan</span>
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                            trialActive
                              ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                              : hasPaid
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : "bg-red-500/10 text-red-600 border-red-500/20"
                          }`}>
                            {trialActive ? "Free Trial" : hasPaid ? "Active" : "Trial Ended"}
                          </span>
                        </div>
                        <div>
                          <p className="text-2xl font-black text-zinc-800 tracking-tight">
                            {planDisplayName} Plan
                          </p>
                          <p className="text-xs text-zinc-400 font-medium mt-1">
                            {planDisplayName === "Premium" 
                              ? "₹1,499 / month" 
                              : planDisplayName === "Hospital" 
                                ? "Custom pricing" 
                                : "₹999 / month"}
                          </p>
                        </div>
                      </div>

                      {/* Expiration Card */}
                      <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-4.5 space-y-3.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Renewal Date / Expiration</span>
                          <Calendar className="h-4 w-4 text-zinc-400" />
                        </div>
                        <div>
                          <p className="text-lg font-black text-zinc-800">
                            {expiryDateString}
                          </p>
                          <p className={`text-xs font-medium mt-1 ${trialActive ? "text-amber-600" : "text-zinc-400"}`}>
                            {trialActive
                              ? `Free trial ends in ${trialEndsInDays} day${trialEndsInDays === 1 ? "" : "s"}`
                              : hasPaid
                                ? `Renews in ${trialEndsInDays} day${trialEndsInDays === 1 ? "" : "s"}`
                                : "Trial period has ended"}
                          </p>
                        </div>
                      </div>

                      {/* Billing Method Card */}
                      <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-4.5 space-y-3.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Payment Method</span>
                          <CreditCard className="h-4 w-4 text-zinc-400" />
                        </div>
                        <div>
                          <p className="text-lg font-black text-zinc-800">
                            {!hasPaid ? "No card on file" : user?.paymentMethod || "Cashfree"}
                          </p>
                          <p className="text-xs text-zinc-400 font-medium mt-1">
                            Amount: {hasPaid ? `₹${user?.paymentAmount}` : "₹0.00 during trial"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                {/* Free-trial activation banner — lets users pay while the trial is still active */}
                {trialActive && (
                  <div className="rounded-3xl border border-amber-300/60 bg-gradient-to-br from-amber-50 to-orange-50/60 p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-amber-500/15 p-2.5 shrink-0">
                          <CreditCard className="h-5 w-5 text-amber-600" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-zinc-900">
                            You're on a free trial of the {planDisplayName} plan
                          </h4>
                          <p className="text-xs text-zinc-600 font-medium mt-1 max-w-xl">
                            Your trial ends in <span className="font-bold text-amber-700">{trialEndsInDays} day{trialEndsInDays === 1 ? "" : "s"}</span>.
                            Activate now to avoid any interruption — you'll be charged{" "}
                            <span className="font-bold">{planDisplayName === "Premium" ? "₹1,499" : "₹999"}/month</span> and your subscription stays active without a break.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!!processingPlan}
                        onClick={() => handleUpgradeClick(planDisplayName === "Premium" ? "Premium" : "Basic")}
                        className="shrink-0 rounded-full bg-amber-500 px-5 py-2.5 text-xs font-bold text-white transition-all hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-amber-500/25"
                      >
                        {processingPlan ? "Processing…" : `Activate Now — Pay ${planDisplayName === "Premium" ? "₹1,499" : "₹999"}`}
                      </button>
                    </div>
                  </div>
                )}

                {/* Plan Packages comparison */}
                <div className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-6">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900">Available Packages</h4>
                    <p className="text-xs text-zinc-500 font-semibold mt-0.5">Upgrade or downgrade your current subscription at any time.</p>
                  </div>

                  <div className="grid gap-6 md:grid-cols-3">
                    {[
                      {
                        name: "Basic",
                        price: "₹999",
                        description: "Best for independent practices.",
                        features: [
                          "1 professional dashboard",
                          "multi QR Code Booking",
                          "meta verified whatsapp intigration",
                          "Priority Support",
                          "unlimited appointments / mo",
                          "unlimited client records",
                          "AI action plans standard"
                        ],
                        popular: false,
                        dark: false,
                        active: currentTier === "Basic"
                      },
                      {
                        name: "Premium",
                        price: "₹1,499",
                        description: "For growing multi-professional clinics.",
                        features: [
                          "1 sub location",
                          "Up to 5 professionals",
                          "multi QR Code Booking",
                          "meta verified whatsapp intigration",
                          "Priority Support",
                          "unlimited appointments / mo",
                          "unlimited client records",
                          "WhatsApp alerts included",
                          "Receptionist dashboard"
                        ],
                        popular: true,
                        dark: false,
                        active: currentTier === "Premium"
                      },
                      {
                        name: "Enterprise",
                        price: "Custom",
                        description: "For complete healthcare systems.",
                        features: ["Unlimited sub locations", "Unlimited professionals & locations", "Custom CRM & ERP integrations", "Dedicated AI fine-tuning", "Dedicated CSM & support"],
                        popular: false,
                        dark: false,
                        active: currentTier === "Enterprise"
                      }
                    ].map((plan) => (
                      <div
                        key={plan.name}
                        className={`relative flex flex-col rounded-2xl border p-6 transition-all ${
                          plan.active
                            ? "bg-white text-zinc-900 border-emerald-400/70"
                            : plan.popular
                              ? "bg-white text-zinc-900 border-brand/25 scale-[1.02]"
                              : plan.dark
                                ? "bg-zinc-900 text-white border-zinc-700/60"
                                : "bg-white text-zinc-900 border-zinc-200 hover:border-brand/20"
                        }`}
                      >
                        {plan.popular && !plan.active && (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand to-cyan-400 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white whitespace-nowrap">
                            Most Popular
                          </span>
                        )}
                        {plan.active && (
                          <span className={`absolute -top-3 left-4 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white whitespace-nowrap ${trialActive ? "bg-amber-500" : "bg-black"}`}>
                            {trialActive ? "Current · Trial" : "Current Plan"}
                          </span>
                        )}

                        <p className={`text-xs font-bold uppercase tracking-wider ${plan.dark ? "text-brand-light" : "text-brand"}`}>
                          {plan.name}
                        </p>
                        <p className="mt-4 flex items-baseline gap-1">
                          <span className="text-3xl font-black tracking-tight">{plan.price}</span>
                          {plan.price !== "Custom" && (
                            <span className={`text-sm ${plan.dark ? "text-zinc-400" : "text-zinc-500"}`}>/mo</span>
                          )}
                        </p>
                        <p className={`mt-2 text-xs font-medium ${plan.dark ? "text-zinc-300" : "text-zinc-600"}`}>
                          {plan.description}
                        </p>

                        <ul className={`mt-5 flex-1 space-y-2.5 border-t ${plan.dark ? "border-white/10" : "border-zinc-200"} pt-5`}>
                          {plan.features.map((feat) => (
                            <li key={feat} className="flex items-start gap-2 text-xs">
                              <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${plan.dark ? "text-cyan-400" : "text-brand"}`} />
                              <span className={plan.dark ? "text-zinc-200" : "text-zinc-700"}>{feat}</span>
                            </li>
                          ))}
                        </ul>

                        <button
                          type="button"
                          disabled={(plan.active && hasPaid) || processingPlan === plan.name}
                          className={`mt-6 w-full rounded-lg py-2.5 text-xs font-bold transition-all cursor-pointer disabled:cursor-not-allowed ${
                            plan.active && hasPaid
                              ? "bg-black/10 text-brand border border-zinc-800/25 cursor-default"
                              : plan.active && plan.name !== "Enterprise"
                                ? "bg-brand text-white hover:bg-brand/90 shadow-lg shadow-brand/25"
                                : plan.name === "Enterprise"
                                  ? "bg-zinc-900 text-white hover:bg-zinc-800"
                                  : plan.popular
                                    ? "bg-brand text-white hover:bg-brand/90"
                                    : "bg-zinc-900 text-white hover:bg-zinc-800"
                          }`}
                          onClick={() => {
                            if ((plan.active && hasPaid) || processingPlan) return;
                            if (plan.name === "Enterprise") {
                              setIsContactModalOpen(true);
                            } else {
                              handleUpgradeClick(plan.name);
                            }
                          }}
                        >
                          {processingPlan === plan.name
                            ? "Processing…"
                            : plan.active && hasPaid
                              ? "Current Plan"
                              : plan.active && plan.name !== "Enterprise"
                                ? (trialActive ? `Activate Now — Pay ${plan.price}` : `Renew Now — Pay ${plan.price}`)
                                : plan.name === "Enterprise"
                                  ? "Contact Support"
                                  : `Upgrade to ${plan.name}`}
                        </button>
                        {plan.active && trialActive && plan.name !== "Enterprise" && (
                          <p className="mt-2 text-center text-[10px] font-semibold text-amber-600">
                            Free trial active · {trialEndsInDays} day{trialEndsInDays === 1 ? "" : "s"} left
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )})()}

            {activeTab === "whatsapp" && (
              <motion.div
                key="whatsapp"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <WhatsAppHub
                  user={user}
                  showToast={showToast}
                  setConfirmDialog={setConfirmDialog}
                  canOperate={featureAccess.whatsapp.permission === "operate"}
                />
              </motion.div>
            )}
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile Bottom Navigation Bar */}
        <nav className="md:hidden h-16 bg-white border-t border-zinc-200 flex items-center justify-around px-2 z-40 select-none pb-safe shrink-0">
          {[
            { id: "overview", label: "Overview", icon: LayoutDashboard },
            { id: "scribe", label: "Consultation", icon: ClipboardCheck },
            { id: "appointments", label: "Bookings", icon: Calendar },
            { id: "patients", label: "All clients", icon: Users },
            { id: "settings", label: "Settings", icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => { setActiveTab(tab.id as any); setSelectedPatient(null); setPatientChartData(null); }}
                className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[9px] font-bold transition-all cursor-pointer active:scale-95 ${
                  active ? "text-brand" : "text-zinc-400 hover:text-zinc-655"
                }`}
              >
                <Icon className={`h-4.5 w-4.5 mb-1 ${active ? "text-brand animate-pulse" : "text-zinc-400"}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </main>

      {/* ──────────────────────────────────────────────
          3. Slide-over Sheet Drawer: Patient EHR Chart Detail
          ────────────────────────────────────────────── */}


      <AnimatePresence>
        {isSchedulingApt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 overflow-y-auto">
            {/* Click outside to close */}
            <div className="absolute inset-0" onClick={() => setIsSchedulingApt(false)} />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-[1.75rem] shadow-2xl flex flex-col border border-zinc-200/60 z-10 overflow-hidden my-auto max-h-[90vh] sm:max-h-[85vh]"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-zinc-200 bg-zinc-50/50 flex items-center justify-between shrink-0 rounded-t-[1.75rem]">
                <div className="flex items-center gap-3 text-left">
                  <div className="h-10 w-10 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-850 leading-none">
                      {editingApt ? `Edit Clinic Booking ${editingApt.tokenNo ? `(Token #${editingApt.tokenNo})` : ''}` : "Book Appointment"}
                    </h3>
                    <span className="text-[10px] text-zinc-400 mt-1 block">
                      {editingApt ? `Apt ID: ${editingApt.id.substring(0,8).toUpperCase()}` : "Manual scheduling form for EHR queue"}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setIsSchedulingApt(false)}
                  className="rounded-full p-1.5 hover:bg-zinc-150/60 text-zinc-455 hover:text-zinc-755 cursor-pointer font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Stepper progress indicator */}
              <div className="px-6 pt-5 pb-3 shrink-0 border-b border-zinc-100/60 bg-zinc-50/20">
                <div className="relative flex justify-between max-w-sm mx-auto">
                  {/* Line between steps */}
                  <div className="absolute top-[14px] left-[12.5%] right-[12.5%] h-0.5 bg-zinc-100 -translate-y-1/2 -z-10">
                    <div 
                      className="h-full bg-brand transition-all duration-300" 
                      style={{ width: `${((bookingStep - 1) / 3) * 100}%` }}
                    />
                  </div>

                  {[
                    { number: 1, label: "Personal Info" },
                    { number: 2, label: "Contact Info" },
                    { number: 3, label: "Schedule" },
                    { number: 4, label: "Review & Confirm" }
                  ].map((step) => {
                    const isActive = bookingStep === step.number;
                    const isCompleted = bookingStep > step.number;
                    return (
                      <div key={step.number} className="relative flex flex-col items-center flex-1 z-10">
                        <button
                          type="button"
                          onClick={() => {
                            if (step.number < bookingStep) {
                              setBookingStep(step.number);
                              setAptError("");
                              setFieldErrors({});
                            }
                          }}
                          className={`h-7 w-7 rounded-full flex items-center justify-center border font-bold text-xs transition-all cursor-pointer ${
                            isActive 
                              ? "bg-black border-zinc-800 text-white shadow-md shadow-brand/20 scale-110" 
                              : isCompleted
                              ? "bg-white border-zinc-800 text-brand"
                              : "bg-white border-zinc-200 text-zinc-400"
                          }`}
                        >
                          {isCompleted ? "✓" : step.number}
                        </button>
                        <span 
                          className={`text-[9px] uppercase tracking-wider font-bold mt-2 transition-all text-center leading-tight min-h-[22px] max-w-[85px] block ${
                            isActive ? "text-brand" : isCompleted ? "text-zinc-500" : "text-zinc-400"
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Form */}
              <form onSubmit={(e) => {
                e.preventDefault();
                if (bookingStep === 1) {
                  if (!aptName.trim()) {
                    setFieldErrors({ name: "Patient Full Name is required." });
                  } else {
                    setFieldErrors({});
                    setBookingStep(2);
                  }
                } else if (bookingStep === 2) {
                  handleStep2Next();
                } else if (bookingStep === 3) {
                  handleStep3Next();
                } else {
                  handleCreateOrUpdateAppointment(e);
                }
              }} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 p-5 sm:p-6 space-y-4 text-left overflow-y-auto min-h-0">
                  
                  {/* Step 1: Personal Information */}
                  {bookingStep === 1 && (
                    <div className="space-y-4 animate-fade-in">
                      {/* Client Name */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Patient Full Name</label>
                        <div className="relative">
                          <User className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                          <input
                            type="text"
                            placeholder="Enter Name"
                            value={aptName}
                            onChange={(e) => {
                              setAptName(e.target.value);
                              if (fieldErrors.name) setFieldErrors(prev => ({ ...prev, name: "" }));
                            }}
                            className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-805 focus:border-brand focus:outline-none transition-all placeholder:text-zinc-400 font-semibold"
                            disabled={savingApt}
                          />
                        </div>
                        {fieldErrors.name && (
                          <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.name}</p>
                        )}
                      </div>

                      {/* Gender Selector */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Gender</label>
                        <div className="grid grid-cols-3 gap-2">
                          {["Female", "Male", "Other"].map((g) => (
                            <button
                              key={g}
                              type="button"
                              onClick={() => setAptGender(g)}
                              className={`rounded-full py-1.5 px-3 text-xs font-semibold border transition-all ${
                                aptGender === g
                                  ? "bg-black border-zinc-800 text-white shadow-sm font-bold animate-pulse-once"
                                  : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-800/40"
                              }`}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* DOB & Blood Group Grid */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {/* Date of Birth */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Date of Birth</label>
                          <div className="relative">
                            <Calendar className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                            <input
                              type="date"
                              value={aptDob}
                              onChange={(e) => {
                                setAptDob(e.target.value);
                                if (fieldErrors.dob) setFieldErrors(prev => ({ ...prev, dob: "" }));
                              }}
                              className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-805 focus:border-brand focus:outline-none transition-all font-semibold"
                              disabled={savingApt}
                            />
                          </div>
                          {fieldErrors.dob && (
                            <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.dob}</p>
                          )}
                        </div>

                        {/* Blood Group */}
                        <div className="space-y-1 relative dropdown-container">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Blood Group</label>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                setAptBloodGroupOpen(!aptBloodGroupOpen);
                                setAptDeptOpen(false);
                                setAptDocOpen(false);
                                setAptTypeOpen(false);
                                setAptCalendarOpen(false);
                                setAptClockOpen(false);
                              }}
                              className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center font-semibold"
                              disabled={savingApt}
                            >
                              <span className={aptBloodGroup ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                                {aptBloodGroup ? aptBloodGroup : "Select Blood Group"}
                              </span>
                              <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${aptBloodGroupOpen ? "rotate-180" : ""}`} />
                            </button>

                            <AnimatePresence>
                              {aptBloodGroupOpen && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-2xl shadow-xl max-h-56 overflow-y-auto p-1.5 space-y-0.5"
                                >
                                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"].map((bg) => (
                                    <button
                                      key={bg}
                                      type="button"
                                      onClick={() => {
                                        setAptBloodGroup(bg);
                                        setAptBloodGroupOpen(false);
                                        if (fieldErrors.bloodGroup) setFieldErrors(prev => ({ ...prev, bloodGroup: "" }));
                                      }}
                                      className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                        aptBloodGroup === bg ? "bg-brand/5 text-brand font-bold" : "text-zinc-700"
                                      }`}
                                    >
                                      <span>{bg}</span>
                                      {aptBloodGroup === bg && <Check className="h-3.5 w-3.5 text-brand" />}
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          {fieldErrors.bloodGroup && (
                            <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.bloodGroup}</p>
                          )}
                        </div>
                      </div>

                      {/* Appointment Type Custom Dropdown */}
                      <div className="space-y-1 relative dropdown-container">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Appointment Type</label>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setAptTypeOpen(!aptTypeOpen);
                              setAptDeptOpen(false);
                              setAptDocOpen(false);
                              setAptCalendarOpen(false);
                              setAptClockOpen(false);
                              setAptBloodGroupOpen(false);
                            }}
                            className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center font-semibold"
                            disabled={savingApt}
                          >
                            <span className={aptAppointmentType ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                              {aptAppointmentType ? aptAppointmentType : "Select Type"}
                            </span>
                            <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${aptTypeOpen ? "rotate-180" : ""}`} />
                          </button>

                          <AnimatePresence>
                            {aptTypeOpen && (
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
                                      setAptAppointmentType(type);
                                      setAptTypeOpen(false);
                                      if (fieldErrors.type) setFieldErrors(prev => ({ ...prev, type: "" }));
                                    }}
                                    className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                      aptAppointmentType === type ? "bg-brand/5 text-brand font-bold" : "text-zinc-700"
                                    }`}
                                  >
                                    <span>{type}</span>
                                    {aptAppointmentType === type && <Check className="h-3.5 w-3.5 text-brand" />}
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        {fieldErrors.type && (
                          <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.type}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Step 2: Contact Information */}
                  {bookingStep === 2 && (
                    <div className="space-y-4 animate-fade-in">
                      {/* Email & Phone Grid */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {/* Email */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Email Address</label>
                          <div className="relative">
                            <Mail className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                            <input
                              type="email"
                              placeholder="jane@example.com"
                              value={aptEmail}
                              onChange={(e) => {
                                setAptEmail(e.target.value);
                                if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: "" }));
                              }}
                              className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-805 focus:border-brand focus:outline-none transition-all placeholder:text-zinc-400 font-semibold"
                              disabled={savingApt}
                            />
                          </div>
                          {fieldErrors.email && (
                            <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.email}</p>
                          )}
                        </div>
                        {/* Phone */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Phone Number</label>
                          <div className="relative">
                            <Phone className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                            <input
                              type="text"
                              placeholder="911234567890"
                              value={aptPhone}
                              onChange={(e) => {
                                setAptPhone(e.target.value);
                                if (fieldErrors.phone) setFieldErrors(prev => ({ ...prev, phone: "" }));
                              }}
                              className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-805 focus:border-brand focus:outline-none transition-all placeholder:text-zinc-400 font-semibold"
                              disabled={savingApt}
                            />
                          </div>
                          {fieldErrors.phone && (
                            <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.phone}</p>
                          )}
                        </div>
                      </div>

                      {/* WhatsApp No (optional) */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1 flex items-center gap-1">
                          WhatsApp No <span className="text-[9px] text-zinc-300 font-normal lowercase">(optional)</span>
                        </label>
                        <div className="relative">
                          <Phone className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                          <input
                            type="text"
                            placeholder="911234567890"
                            value={aptWhatsapp}
                            onChange={(e) => setAptWhatsapp(e.target.value)}
                            className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-805 focus:border-brand focus:outline-none transition-all placeholder:text-zinc-400 font-semibold"
                            disabled={savingApt}
                          />
                        </div>
                      </div>

                      {/* Address */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Address</label>
                        <div className="relative">
                          <textarea
                            placeholder="Enter Address details..."
                            value={aptAddress}
                            onChange={(e) => setAptAddress(e.target.value)}
                            rows={3}
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-805 focus:border-brand focus:outline-none transition-all placeholder:text-zinc-400 font-semibold resize-none"
                            disabled={savingApt}
                          />
                        </div>
                      </div>

                      {/* Duplicate Warning Box */}
                      {dupWarning && (
                        <div className="p-4 rounded-2xl border border-amber-250 bg-amber-50/50 space-y-3 animate-fade-in">
                          <div className="flex items-start gap-2.5">
                            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                            <div className="space-y-1 text-left">
                              <h4 className="text-xs font-bold text-amber-800">
                                Patient Profile Already Exists
                              </h4>
                              <p className="text-[11px] text-amber-700 leading-normal font-medium">
                                A patient named <strong>{dupWarning.patient.name}</strong> is already registered with these contact details (No: {dupWarning.patient.phone}, Email: {dupWarning.patient.email}).
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 pt-1 justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setDupWarning(null);
                              }}
                              className="rounded-full bg-white border border-amber-200 px-3 py-1 text-[10px] font-bold text-zinc-600 hover:bg-zinc-50 transition-all cursor-pointer"
                            >
                              Edit Contact Details
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPatientId(null);
                                setDupWarning(null);
                                setBookingStep(3);
                              }}
                              className="rounded-full bg-white border border-amber-200 px-3 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100/50 transition-all cursor-pointer"
                            >
                              Create New Patient
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPatientId(dupWarning.patient.id);
                                setAptName(dupWarning.patient.name);
                                setAptGender(dupWarning.patient.gender || "Female");
                                setAptDob(dupWarning.patient.dob || "");
                                setAptBloodGroup(dupWarning.patient.bloodGroup || "");
                                setAptAddress(dupWarning.patient.address || "");
                                setDupWarning(null);
                                setBookingStep(3);
                              }}
                              className="rounded-full bg-amber-600 px-3.5 py-1.5 text-[10px] font-bold text-white hover:bg-amber-700 transition-all cursor-pointer shadow-sm shadow-amber-600/10"
                            >
                              Continue with Existing
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 3: Schedule Options */}
                  {bookingStep === 3 && (
                    <div className="space-y-4 animate-fade-in">
                      {/* Department & Doctor Selection Grid */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {/* Select Department Custom Dropdown */}
                        <div className="space-y-1 relative dropdown-container">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Select Department</label>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                setAptDeptOpen(!aptDeptOpen);
                                setAptDocOpen(false);
                                setAptTypeOpen(false);
                                setAptCalendarOpen(false);
                                setAptClockOpen(false);
                              }}
                              className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center font-semibold"
                              disabled={savingApt}
                            >
                              <span className={aptDeptId ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                                {aptDeptId ? departments.find(d => d.id === aptDeptId)?.name : "Select Department"}
                              </span>
                              <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${aptDeptOpen ? "rotate-180" : ""}`} />
                            </button>

                            <AnimatePresence>
                              {aptDeptOpen && (
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
                                        setAptDeptId(dept.id);
                                        setAptDoctorId(""); // Reset doctor
                                        setAptDateTime(""); // Reset date/time slot since doctor changed
                                        setAptTimeSlot("");
                                        setAptDeptOpen(false);
                                        setDateError(null);
                                        setTimeError(null);
                                        if (fieldErrors.dept) setFieldErrors(prev => ({ ...prev, dept: "" }));
                                      }}
                                      className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                        aptDeptId === dept.id ? "bg-brand/5 text-brand font-bold" : "text-zinc-700"
                                      }`}
                                    >
                                      <span>{dept.name}</span>
                                      {aptDeptId === dept.id && <Check className="h-3.5 w-3.5 text-brand" />}
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          {fieldErrors.dept && (
                            <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.dept}</p>
                          )}
                        </div>

                        {/* Select Doctor Custom Dropdown */}
                        <div className="space-y-1 relative dropdown-container">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Select Doctor</label>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                setAptDocOpen(!aptDocOpen);
                                setAptDeptOpen(false);
                                setAptTypeOpen(false);
                                setAptCalendarOpen(false);
                                setAptClockOpen(false);
                              }}
                              className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center font-semibold"
                              disabled={savingApt}
                            >
                              <span className={aptDoctorId ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                                {aptDoctorId ? doctors.find(d => d.id === aptDoctorId)?.name : "Select Doctor"}
                              </span>
                              <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${aptDocOpen ? "rotate-180" : ""}`} />
                            </button>

                            <AnimatePresence>
                              {aptDocOpen && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-2xl shadow-xl max-h-56 overflow-y-auto p-1.5 space-y-0.5"
                                >
                                  {(aptDeptId ? doctors.filter((doc) => doc.departmentId === aptDeptId) : doctors).length > 0 ? (
                                    (aptDeptId ? doctors.filter((doc) => doc.departmentId === aptDeptId) : doctors).map((doc) => (
                                      <button
                                        key={doc.id}
                                        type="button"
                                        onClick={() => {
                                          setAptDoctorId(doc.id);
                                          setAptDateTime(""); // Reset date/time slot since doctor changed
                                          setAptTimeSlot("");
                                          setAptDocOpen(false);
                                          setDateError(null);
                                          setTimeError(null);
                                          if (fieldErrors.doctor) setFieldErrors(prev => ({ ...prev, doctor: "" }));
                                        }}
                                        className={`w-full text-left px-3.5 py-2 text-xs rounded-xl transition-all flex items-center justify-between hover:bg-zinc-50 ${
                                          aptDoctorId === doc.id ? "bg-brand/5 text-brand font-bold" : "text-zinc-700"
                                        }`}
                                      >
                                        <div className="flex flex-col">
                                          <span className="font-semibold">{doc.name}</span>
                                          <span className="text-[9px] text-zinc-400 font-normal">{doc.qualifications}</span>
                                        </div>
                                        {aptDoctorId === doc.id && <Check className="h-3.5 w-3.5 text-brand" />}
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
                          {fieldErrors.doctor && (
                            <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.doctor}</p>
                          )}
                        </div>
                      </div>

                      {/* Preferred Date & Available Slots Picker Grid */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {/* Custom Popover Calendar Date Picker */}
                        <div className="space-y-1 relative dropdown-container">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Select Appointment Date</label>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                if (!aptDeptId || !aptDoctorId) {
                                  const needsDept = !aptDeptId;
                                  const needsDoc = !aptDoctorId;
                                  if (needsDept && needsDoc) {
                                    setDateError("Please select department and doctor first.");
                                  } else if (needsDept) {
                                    setDateError("Please select a department first.");
                                  } else {
                                    setDateError("Please select a doctor first.");
                                  }
                                  return;
                                }
                                setDateError(null);
                                setAptCalendarOpen(!aptCalendarOpen);
                                setAptDeptOpen(false);
                                setAptDocOpen(false);
                                setAptTypeOpen(false);
                                setAptClockOpen(false);
                              }}
                              className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center font-semibold"
                              disabled={savingApt}
                            >
                              <Calendar className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-455" />
                              <span className={aptDateTime ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                                {aptDateTime
                                  ? new Date(aptDateTime).toLocaleDateString("en-US", {
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
                              {aptCalendarOpen && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="absolute z-50 mt-1 left-0 bg-white border border-zinc-200 rounded-2xl shadow-xl p-4 w-[280px]"
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
                                    <span className="text-xs font-bold text-zinc-850">
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
                                      const isSelected = aptDateTime ? aptDateTime.split("T")[0] === localDateStr : false;
                                      const past = isPastDate(day);

                                      return (
                                        <button
                                          key={day.toISOString()}
                                          type="button"
                                          onClick={() => {
                                            if (past) return;
                                            const datePart = localDateStr;
                                            const timePart = aptDateTime.includes("T") ? aptDateTime.split("T")[1] : "09:00";
                                            setAptDateTime(datePart + "T" + timePart);
                                            setAptTimeSlot(""); // Reset slot on date change
                                            setAptCalendarOpen(false);
                                            setTimeError(null);
                                            if (fieldErrors.date) setFieldErrors(prev => ({ ...prev, date: "" }));
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
                          {(fieldErrors.date || dateError) && (
                            <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.date || dateError}</p>
                          )}
                        </div>

                        {/* Custom Popover Time Slot Picker */}
                        <div className="space-y-1 relative dropdown-container">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Select Available Time Slot</label>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                if (!aptDeptId || !aptDoctorId) {
                                  const needsDept = !aptDeptId;
                                  const needsDoc = !aptDoctorId;
                                  if (needsDept && needsDoc) {
                                    setTimeError("Please select department and doctor first.");
                                  } else if (needsDept) {
                                    setTimeError("Please select a department first.");
                                  } else {
                                    setTimeError("Please select a doctor first.");
                                  }
                                  return;
                                }
                                if (!aptDateTime) {
                                  setTimeError("Please select a date first.");
                                  return;
                                }
                                setTimeError(null);
                                setAptClockOpen(!aptClockOpen);
                                setAptDeptOpen(false);
                                setAptDocOpen(false);
                                setAptTypeOpen(false);
                                setAptCalendarOpen(false);
                              }}
                              className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-left text-xs focus:outline-none transition-all flex justify-between items-center font-semibold"
                              disabled={savingApt}
                            >
                              <Clock className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-405" />
                              <span className={aptTimeSlot ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                                {aptTimeSlot ? aptTimeSlot : "Select Time Slot"}
                              </span>
                              <ChevronDown className="h-4 w-4 text-zinc-450" />
                            </button>

                            <AnimatePresence>
                              {aptClockOpen && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="absolute z-50 mt-1 right-0 bg-white border border-zinc-200 rounded-2xl shadow-xl p-3 w-[280px]"
                                >
                                  <div className="text-[9px] font-bold text-zinc-400 uppercase mb-2 px-1 flex items-center gap-1">
                                    <Clock className="h-3 w-3 text-brand" /> Available slots
                                  </div>

                                  {loadingAptSlots ? (
                                    <div className="flex justify-center py-4">
                                      <Loader2 className="h-4 w-4 animate-spin text-brand" />
                                    </div>
                                  ) : aptAvailableSlots.length > 0 ? (
                                    <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1">
                                      {aptAvailableSlots.map((slot) => {
                                        const isSelected = aptTimeSlot === slot;
                                        return (
                                          <button
                                            key={slot}
                                            type="button"
                                            onClick={() => {
                                              setAptTimeSlot(slot);
                                              const datePart = aptDateTime.split("T")[0];
                                              const [time, modifier] = slot.split(" ");
                                              let [hours, minutes] = time.split(":").map(Number);
                                              if (modifier === "PM" && hours < 12) hours += 12;
                                              if (modifier === "AM" && hours === 12) hours = 0;
                                              const timePart = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
                                              setAptDateTime(`${datePart}T${timePart}`);
                                              setAptClockOpen(false);
                                              if (fieldErrors.time) setFieldErrors(prev => ({ ...prev, time: "" }));
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
                          {(fieldErrors.time || timeError) && (
                            <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.time || timeError}</p>
                          )}
                        </div>
                      </div>

                      {/* Symptoms / Reason */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Reason for Visit / Business Goals</label>
                        <div className="relative">
                          <FileText className="absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
                          <input
                            type="text"
                            placeholder="Brief details of symptoms"
                            value={aptReason}
                            onChange={(e) => {
                              setAptReason(e.target.value);
                              if (fieldErrors.reason) setFieldErrors(prev => ({ ...prev, reason: "" }));
                            }}
                            className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-805 focus:border-brand focus:outline-none transition-all placeholder:text-zinc-400 font-semibold"
                            disabled={savingApt}
                          />
                        </div>
                        {fieldErrors.reason && (
                          <p className="text-[10px] text-red-500 font-bold mt-1 pl-1">{fieldErrors.reason}</p>
                        )}
                      </div>

                      {/* Status Selection (only visible when editing) */}
                      {editingApt && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Booking Status</label>
                          <select
                            value={aptStatus}
                            onChange={(e) => setAptStatus(e.target.value)}
                            className="w-full rounded-full border border-zinc-205 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none cursor-pointer"
                          >
                            <option value="Pending">Pending Review</option>
                            <option value="Confirmed">Confirmed</option>
                            <option value="Completed">Completed</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 4: Review & Confirm */}
                  {bookingStep === 4 && (
                    <div className="space-y-4 animate-fade-in">
                      {/* Summary Card */}
                      <div className="p-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/50 space-y-3">
                        <h4 className="text-[10px] font-bold text-zinc-450 uppercase tracking-wider border-b border-zinc-200 pb-1 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-brand" /> Review & Confirm Details
                        </h4>
                        
                        <div className="grid gap-3 sm:grid-cols-2 text-[11px] text-left">
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-zinc-400 uppercase block font-semibold">Patient Info</span>
                            <p className="font-bold text-zinc-700">{aptName}</p>
                            <p className="text-zinc-500 font-semibold">
                              {aptGender} • {aptDob ? `${aptDob} (${calculateAge(aptDob)} yrs)` : "No DOB"} • {aptBloodGroup || "Blood group not set"}
                            </p>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-zinc-400 uppercase block font-semibold">Contact Info</span>
                            <p className="text-zinc-650 font-bold">{aptPhone}</p>
                            <p className="text-zinc-500 font-medium truncate">{aptEmail}</p>
                            {aptWhatsapp && <p className="text-[10px] text-zinc-400">WA: {aptWhatsapp}</p>}
                            {aptAddress && <p className="text-[10px] text-zinc-400 line-clamp-1">Addr: {aptAddress}</p>}
                          </div>

                          <div className="space-y-1 sm:col-span-2 border-t border-zinc-200/60 pt-2">
                            <span className="text-[9px] font-bold text-zinc-400 uppercase block font-semibold">Consultation Booking</span>
                            <p className="font-semibold text-zinc-700">
                              Dr. {doctors.find(d => d.id === aptDoctorId)?.name || "Select Doctor"} ({departments.find(d => d.id === aptDeptId)?.name || "Select Department"})
                            </p>
                            <p className="text-brand font-bold text-xs mt-0.5">
                              {aptDateTime ? new Date(aptDateTime).toLocaleDateString("en-US", { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ""} at {aptTimeSlot}
                            </p>
                            <p className="text-zinc-500 mt-1 italic font-medium leading-relaxed">Complaint: {aptReason}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Inline Messages */}
                  {aptSuccess && (
                    <div className="rounded-full bg-emerald-50 border border-emerald-100 p-2.5 text-center">
                      <p className="text-[10px] font-bold text-emerald-600 flex items-center justify-center gap-1 leading-none">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {aptSuccess}
                      </p>
                    </div>
                  )}
                  {aptError && (
                    <div className="rounded-full bg-red-50 border border-red-100 p-2.5 text-center">
                      <p className="text-[10px] font-bold text-red-650 flex items-center justify-center gap-1 leading-none">
                        <AlertCircle className="h-3.5 w-3.5 text-red-500" /> {aptError}
                      </p>
                    </div>
                  )}

                </div>

                {/* Footer Controls */}
                <div className="p-4 border-t border-zinc-200 bg-zinc-50 flex justify-end gap-3 shrink-0 rounded-b-[1.75rem]">
                  {bookingStep > 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setBookingStep(bookingStep - 1);
                        setAptError("");
                      }}
                      className="rounded-full border border-zinc-200 hover:bg-zinc-150 px-4 py-2 text-xs font-semibold text-zinc-500 cursor-pointer"
                    >
                      Back
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsSchedulingApt(false)}
                      className="rounded-full border border-zinc-200 hover:bg-zinc-150 px-4 py-2 text-xs font-semibold text-zinc-500 cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  
                  {bookingStep < 4 ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (bookingStep === 1) {
                          if (!aptName.trim()) {
                            setFieldErrors({ name: "Patient Full Name is required." });
                          } else {
                            setFieldErrors({});
                            setBookingStep(2);
                          }
                        } else if (bookingStep === 2) {
                          handleStep2Next();
                        } else if (bookingStep === 3) {
                          handleStep3Next();
                        }
                      }}
                      disabled={savingApt}
                      className="rounded-full bg-black text-white px-5 py-2 text-xs font-semibold hover:bg-black/90 shadow-md flex items-center gap-1.5 cursor-pointer disabled:bg-zinc-150 disabled:text-zinc-400"
                    >
                      {savingApt && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Next
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={savingApt}
                      className="rounded-full bg-black text-white px-5 py-2 text-xs font-semibold hover:bg-black/90 shadow-md flex items-center gap-1.5 cursor-pointer disabled:bg-zinc-150 disabled:text-zinc-400"
                    >
                      {savingApt && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {editingApt ? "Update Appointment" : "Schedule Booking"}
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Appointment Details View Modal */}
      <AnimatePresence>
        {selectedAptDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 overflow-y-auto">
            {/* Click outside to close */}
            <div className="absolute inset-0" onClick={() => setSelectedAptDetails(null)} />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-[1.75rem] border border-zinc-150 p-6 shadow-none text-left space-y-5 z-10 transition-all hover:border-zinc-200/80 duration-300"
            >
              {/* Close button */}
              <button
                type="button"
                onClick={() => setSelectedAptDetails(null)}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>

              {/* Title / Header */}
              <div className="flex items-center gap-3 pb-3 border-b border-zinc-100">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 leading-none">Appointment Details</h3>
                  <span className="text-[10px] text-zinc-400 mt-1.5 block uppercase tracking-wider font-semibold">
                    Token #{selectedAptDetails.tokenNo || "N/A"}
                  </span>
                </div>
              </div>

              {/* Patient Basic Profile Card */}
              <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-zinc-50 border border-zinc-150/60">
                <div className="h-12 w-12 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-750 font-extrabold text-sm uppercase shrink-0">
                  {selectedAptDetails.name.slice(0, 2)}
                </div>
                <div className="space-y-0.5 min-w-0">
                  <h4 className="text-xs font-bold text-zinc-805 leading-none truncate">{selectedAptDetails.name}</h4>
                  <p className="text-[10px] text-zinc-500 font-semibold mt-1">
                    {selectedAptDetails.gender || "Gender N/A"} • {selectedAptDetails.age || selectedAptDetails.dob ? `${selectedAptDetails.age || "DOB N/A"} yrs` : "Age N/A"}
                  </p>
                  <p className="text-[10px] text-zinc-400 font-bold mt-0.5">{selectedAptDetails.phone || "No Phone Number"}</p>
                </div>
              </div>

              {/* Schedule and Clinical Details Grid */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block mb-0.5">Date & Time</span>
                  <p className="text-zinc-700 font-bold">
                    {new Date(selectedAptDetails.dateTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                  <p className="text-[10px] text-zinc-500 font-semibold mt-0.5">
                    {new Date(selectedAptDetails.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>

                <div>
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block mb-0.5">Appointment Type</span>
                  <p className="text-zinc-700 font-bold">{selectedAptDetails.appointmentType || "Standard"}</p>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold mt-1.5 shadow-none border leading-none ${
                    selectedAptDetails.status === "Confirmed" ? "bg-teal-50 border-teal-200 text-teal-700" :
                    selectedAptDetails.status === "Pending" ? "bg-sky-50 border-sky-200 text-sky-700" :
                    selectedAptDetails.status === "Completed" ? "bg-zinc-105 border-zinc-200 text-zinc-700" :
                    "bg-amber-50 border-amber-200 text-amber-700"
                  }`}>
                    {selectedAptDetails.status}
                  </span>
                </div>

                <div>
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block mb-0.5">Assigned Advisor</span>
                  <p className="text-zinc-700 font-bold">
                    {doctors.find(d => d.id === selectedAptDetails.doctorId)?.name || "Unassigned"}
                  </p>
                </div>

                <div>
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block mb-0.5">Department</span>
                  <p className="text-zinc-700 font-bold">
                    {departments.find(d => d.id === (doctors.find(doc => doc.id === selectedAptDetails.doctorId)?.departmentId || selectedAptDetails.departmentId))?.name || "General"}
                  </p>
                </div>
              </div>

              {/* Business Goals / Reason */}
              {selectedAptDetails.reason && (
                <div className="bg-zinc-50/30 border border-zinc-150 p-3 rounded-2xl">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Business Goals</span>
                  <p className="text-xs text-zinc-650 font-semibold leading-relaxed">
                    {selectedAptDetails.reason}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col gap-2">

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const apt = selectedAptDetails;
                      setSelectedAptDetails(null);
                      openEditApt(apt);
                    }}
                    className="inline-flex items-center justify-center gap-1 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 font-bold text-xs py-2 rounded-full transition-all active:scale-[0.98] cursor-pointer shadow-none"
                  >
                    <Edit3 className="h-3.5 w-3.5 text-zinc-500" />
                    Edit Booking
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      const apt = selectedAptDetails;
                      setSelectedAptDetails(null);
                      setAptToDelete(apt);
                    }}
                    className="inline-flex items-center justify-center gap-1 border border-red-200 bg-red-50/20 hover:bg-red-50 text-red-655 font-bold text-xs py-2 rounded-full transition-all active:scale-[0.98] cursor-pointer shadow-none"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    Delete Booking
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Generic Confirmation Modal (used for All clients, WhatsApp, etc.) */}
      <AnimatePresence>
        {confirmDialog && confirmDialog.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white rounded-[1.75rem] border border-zinc-150 p-6 max-w-sm w-full mx-4 shadow-none text-center space-y-4"
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
                disabled={isDialogConfirming}
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 border border-red-100 mx-auto text-red-650">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-zinc-900 leading-none">{confirmDialog.title}</h3>
                <p className="text-[11px] text-zinc-400 leading-relaxed font-medium">
                  {confirmDialog.message}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  disabled={isDialogConfirming}
                  className="w-full rounded-full border border-zinc-200 py-2.5 text-xs font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-all active:scale-95 cursor-pointer shadow-none"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setIsDialogConfirming(true);
                    try {
                      await confirmDialog.onConfirm();
                    } catch (e) {
                      console.error("Confirmation error:", e);
                    } finally {
                      setIsDialogConfirming(false);
                      setConfirmDialog(null);
                    }
                  }}
                  disabled={isDialogConfirming}
                  className="w-full rounded-full bg-red-600 hover:bg-red-700 py-2.5 text-xs font-bold text-white disabled:opacity-50 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-none"
                >
                  {isDialogConfirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sub-user Delete Confirmation Modal */}
      <AnimatePresence>
        {subUserToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white rounded-[1.75rem] border border-zinc-150 p-6 max-w-sm w-full mx-4 shadow-none text-center space-y-4"
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setSubUserToDelete(null)}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
                disabled={isDeletingSubUser}
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 border border-red-100 mx-auto text-red-650">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-zinc-900 leading-none">Delete Staff Account?</h3>
                <p className="text-[11px] text-zinc-400 leading-relaxed font-medium">
                  Are you sure you want to delete the account for <span className="font-semibold text-zinc-650">{subUserToDelete.name}</span>? This action cannot be undone and they will immediately lose access.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSubUserToDelete(null)}
                  disabled={isDeletingSubUser}
                  className="w-full rounded-full border border-zinc-200 py-2.5 text-xs font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-all active:scale-95 cursor-pointer shadow-none"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setIsDeletingSubUser(true);
                    try {
                      await deleteSubUserServerFn({ data: subUserToDelete.id });
                      setSubUsers(prev => prev.filter(s => s.id !== subUserToDelete.id));
                      showToast("success", `Account for ${subUserToDelete.name} deleted successfully`);
                      setSubUserToDelete(null);
                    } catch (err: any) {
                      showToast("error", err.message || "Failed to delete sub-user");
                    } finally {
                      setIsDeletingSubUser(false);
                    }
                  }}
                  disabled={isDeletingSubUser}
                  className="w-full rounded-full bg-red-600 hover:bg-red-700 py-2.5 text-xs font-bold text-white disabled:opacity-50 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-none"
                >
                  {isDeletingSubUser && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Voice Rx AI Dictation Popup Modal */}
      <AnimatePresence>
        {isVoiceRxModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative bg-white rounded-[2rem] border border-zinc-200 shadow-2xl max-w-4xl w-full overflow-hidden flex flex-col my-8"
              style={{ maxHeight: "calc(100vh - 4rem)" }}
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-5 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 rounded-xl backdrop-blur-sm">
                    <Mic className="h-5 w-5 text-white animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold tracking-tight">Voice Rx AI Dictation</h3>
                    <p className="text-[10px] text-emerald-100 font-medium">Record dialogue or dictate prescription instructions. AI will extract EHR fields.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleStopVoiceRx();
                    setIsVoiceRxModalOpen(false);
                  }}
                  className="rounded-full p-1.5 hover:bg-white/10 text-white transition-all cursor-pointer animate-fade-in"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable Content Area */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1 text-left">
                
                {/* 1. Live Capturing Section */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  
                  {/* Left panel: recording controls & waveform */}
                  <div className="md:col-span-1 border border-zinc-200 rounded-2xl p-5 bg-zinc-50/50 flex flex-col items-center justify-center text-center space-y-4 min-h-[220px]">
                    {isRecording && recordingField === "voiceRx" ? (
                      <>
                        {/* Soundwave animation */}
                        <div className="flex items-center justify-center gap-1 h-10 w-full px-2">
                          {[1, 2, 3, 4, 5, 6, 7].map((bar) => (
                            <motion.div
                              key={bar}
                              className="w-1 bg-emerald-500 rounded-full"
                              animate={{
                                height: [10, 32, 10],
                              }}
                              transition={{
                                duration: 0.7,
                                repeat: Infinity,
                                delay: bar * 0.08,
                              }}
                            />
                          ))}
                        </div>
                        <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 rounded-full px-3 py-0.5 animate-pulse">
                          Listening Live
                        </span>
                        <span className="text-xl font-mono font-bold text-zinc-700">
                          {formatTime(recordingSeconds)}
                        </span>
                        <button
                          type="button"
                          onClick={handleStopVoiceRx}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer"
                        >
                          <Pause className="h-4 w-4" /> Pause Capture
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="h-10 w-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">
                          <MicOff className="h-5 w-5" />
                        </div>
                        <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 border border-zinc-200 rounded-full px-3 py-0.5">
                          Dictation Paused
                        </span>
                        <span className="text-xl font-mono font-bold text-zinc-400">
                          {formatTime(recordingSeconds)}
                        </span>
                        <button
                          type="button"
                          onClick={handleResumeVoiceRx}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer animate-bounce"
                        >
                          <Play className="h-4 w-4" /> Resume Capture
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => setVoiceRxTranscript("")}
                      disabled={!voiceRxTranscript}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 border border-zinc-200 hover:bg-zinc-100 text-zinc-655 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-40"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Clear Text
                    </button>
                  </div>

                  {/* Right panel: text transcription pad */}
                  <div className="md:col-span-2 flex flex-col space-y-2">
                    <label className="block text-[10px] font-bold text-zinc-450 uppercase tracking-wider">
                      Live Transcription Pad (Editable)
                    </label>
                    <textarea
                      value={voiceRxTranscript}
                      onChange={(e) => setVoiceRxTranscript(e.target.value)}
                      placeholder="Captured speech will write here automatically... You can also type or edit this text directly."
                      className="flex-1 w-full rounded-2xl border border-zinc-200 bg-white p-4 text-xs text-zinc-700 focus:border-emerald-600 focus:outline-none transition-all resize-none min-h-[220px] font-medium leading-relaxed"
                    />
                  </div>
                </div>

                {/* 2. Analysis Results Section */}
                {isVoiceRxAnalyzing && (
                  <div className="border border-zinc-200 rounded-2xl p-8 bg-zinc-50/50 flex flex-col items-center justify-center text-center space-y-3.5 animate-pulse">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                    <div>
                      <h4 className="text-xs font-bold text-zinc-800">Analyzing clinical dialogue...</h4>
                      <p className="text-[10px] text-zinc-400 mt-1 max-w-md">Gemini AI is parsing the transcript to resolve medical terminology, assign diagnosis codes, structure medication schedules, and format clinician advice.</p>
                    </div>
                  </div>
                )}

                {voiceRxResult && !isVoiceRxAnalyzing && (
                  <div className="border border-zinc-200 rounded-2xl p-5 bg-emerald-50/5 space-y-5 animate-fade-in">
                    <div className="flex items-center gap-2 border-b border-zinc-150 pb-2">
                      <Sparkles className="h-4.5 w-4.5 text-purple-600 animate-pulse" />
                      <h4 className="text-xs font-extrabold text-zinc-850 uppercase tracking-wide">
                        Clinical AI Diagnostics & Recommendations
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs text-left">
                      
                      {/* Left: CC, Diagnosis, Advice */}
                      <div className="space-y-4">
                        <div className="space-y-1 bg-white p-3.5 border border-zinc-150 rounded-xl">
                          <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">Business Goals</span>
                          <p className="text-zinc-800 font-bold">{voiceRxResult.chiefComplaint || "None extracted."}</p>
                        </div>

                        <div className="space-y-1 bg-white p-3.5 border border-zinc-150 rounded-xl">
                          <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">Primary Diagnosis</span>
                          <p className="text-zinc-800 font-bold">{voiceRxResult.diagnosis || "None extracted."}</p>
                        </div>

                        <div className="space-y-1 bg-white p-3.5 border border-zinc-150 rounded-xl">
                          <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">Advice & Instructions</span>
                          <p className="text-zinc-500 font-semibold leading-relaxed">{voiceRxResult.advice || "None extracted."}</p>
                        </div>
                      </div>

                      {/* Right: Medications Table */}
                      <div className="space-y-2.5">
                        <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">Extracted Medications</span>
                        {voiceRxResult.medications && voiceRxResult.medications.length > 0 ? (
                          <div className="overflow-hidden border border-zinc-150 rounded-xl bg-white">
                            <table className="min-w-full divide-y divide-zinc-200 text-[10px] text-left">
                              <thead className="bg-zinc-50 font-bold text-zinc-400 uppercase">
                                <tr>
                                  <th className="p-2.5">Drug</th>
                                  <th className="p-2.5">Dosage</th>
                                  <th className="p-2.5">Freq</th>
                                  <th className="p-2.5">Dur</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-150 text-zinc-700">
                                {voiceRxResult.medications.map((m, idx) => (
                                  <tr key={idx} className="hover:bg-zinc-50/50">
                                    <td className="p-2.5 font-bold">{m.name}</td>
                                    <td className="p-2.5">{m.dosage}</td>
                                    <td className="p-2.5">{m.frequency}</td>
                                    <td className="p-2.5 font-semibold text-zinc-500">{m.duration}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="p-4 border border-dashed border-zinc-200 rounded-xl text-center text-zinc-400 italic bg-white">
                            No medications extracted.
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-zinc-50 border-t border-zinc-150 p-4 flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    handleStopVoiceRx();
                    setIsVoiceRxModalOpen(false);
                  }}
                  className="rounded-full border border-zinc-200 hover:bg-zinc-50 text-zinc-600 px-5 py-2.5 text-xs font-bold transition-all cursor-pointer"
                >
                  Discard & Exit
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleAnalyzeVoiceRx}
                    disabled={isVoiceRxAnalyzing || !voiceRxTranscript.trim()}
                    className="rounded-full bg-purple-600 hover:bg-purple-550 text-white px-5 py-2.5 text-xs font-extrabold shadow-md flex items-center gap-1.5 transition-all cursor-pointer disabled:bg-zinc-150 disabled:text-zinc-450 disabled:shadow-none"
                  >
                    {isVoiceRxAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Analyze with AI
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleApplyVoiceRx}
                    disabled={!voiceRxResult || isVoiceRxAnalyzing}
                    className="rounded-full bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 text-xs font-extrabold shadow-md flex items-center gap-1.5 transition-all cursor-pointer disabled:bg-zinc-150 disabled:text-zinc-455 disabled:shadow-none"
                  >
                    <Check className="h-4 w-4" />
                    Apply to Prescription
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {aptToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white rounded-[1.75rem] border border-zinc-150 p-6 max-w-sm w-full mx-4 shadow-none text-center space-y-4"
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setAptToDelete(null)}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 border border-red-100 mx-auto text-red-650">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-zinc-900 leading-none">Delete Appointment</h3>
                <p className="text-[11px] text-zinc-400 leading-relaxed font-medium">
                  Are you sure you want to delete the appointment for <span className="font-semibold text-zinc-650">{aptToDelete.name}</span>? This action is permanent and cannot be undone.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAptToDelete(null)}
                  className="w-full rounded-full border border-zinc-200 py-2.5 text-xs font-bold text-zinc-600 hover:bg-zinc-50 transition-all active:scale-95 cursor-pointer shadow-none"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const id = aptToDelete.id;
                    setAptToDelete(null);
                    await handleDeleteAppointment(id);
                  }}
                  className="w-full rounded-full bg-red-600 hover:bg-red-700 py-2.5 text-xs font-bold text-white transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-none"
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment verification processing overlay */}
      {isVerifyingPayment && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md text-white">
          <Loader2 className="h-10 w-10 animate-spin text-brand" />
          <p className="mt-4 text-sm font-bold tracking-wide">Verifying your payment...</p>
          <p className="text-xs text-zinc-300 mt-1">Please do not refresh the page or press back.</p>
        </div>
      )}

      {/* Enterprise "Contact Support" modal */}
      <AnimatePresence>
        {isContactModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="relative bg-white rounded-[1.75rem] border border-zinc-150 p-7 max-w-md w-full shadow-2xl text-center space-y-5"
            >
              <button
                type="button"
                onClick={() => setIsContactModalOpen(false)}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 border border-brand/20 mx-auto text-brand">
                <Building2 className="h-6 w-6" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-lg font-black text-zinc-900 leading-tight">Talk to Our Enterprise Team</h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                  For custom pricing, unlimited locations, and dedicated support — reach out and we'll get back to you shortly.
                </p>
              </div>

              <div className="space-y-2.5">
                <a
                  href="mailto:bookmytime1355@gmail.com"
                  className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/60 px-4 py-3 text-left hover:border-brand/30 hover:bg-brand/5 transition-all cursor-pointer"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-zinc-200 text-brand">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Email</p>
                    <p className="text-sm font-bold text-zinc-800">bookmytime1355@gmail.com</p>
                  </div>
                </a>
                <a
                  href="tel:+919168081355"
                  className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/60 px-4 py-3 text-left hover:border-brand/30 hover:bg-brand/5 transition-all cursor-pointer"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-zinc-200 text-brand">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Phone</p>
                    <p className="text-sm font-bold text-zinc-800">+91 9168 08 1355</p>
                  </div>
                </a>
              </div>

              <button
                type="button"
                onClick={() => setIsContactModalOpen(false)}
                className="w-full rounded-full bg-zinc-900 hover:bg-zinc-800 py-2.5 text-xs font-bold text-white transition-all active:scale-95 cursor-pointer"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment success confirmation modal */}
      <AnimatePresence>
        {paymentSuccess && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="relative bg-white rounded-[1.75rem] border border-zinc-150 p-7 max-w-md w-full shadow-2xl text-center space-y-4"
            >
              <button
                type="button"
                onClick={() => setPaymentSuccess(null)}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>

              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.05 }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 border border-emerald-100 mx-auto text-emerald-600"
              >
                <Check className="h-7 w-7" />
              </motion.div>

              <div className="space-y-2">
                <h3 className="text-lg font-black text-zinc-900 leading-tight">Payment Successful</h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                  Your <span className="font-bold text-zinc-800">{paymentSuccess.plan}</span> subscription is now active.
                  {typeof paymentSuccess.amount === "number" && !Number.isNaN(paymentSuccess.amount) && (
                    <> A payment of <span className="font-bold text-zinc-800">₹{paymentSuccess.amount.toLocaleString("en-IN")}</span> was received.</>
                  )}
                </p>
                <p className="text-[11px] text-zinc-400 font-medium">
                  A confirmation has been recorded on your account. Thank you for choosing BookMyTime.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPaymentSuccess(null)}
                className="w-full rounded-full bg-brand hover:bg-brand/90 py-2.5 text-xs font-bold text-white transition-all active:scale-95 cursor-pointer"
              >
                Done
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
