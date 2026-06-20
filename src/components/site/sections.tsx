import { Link } from "@tanstack/react-router";
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
  AnimatePresence,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Calendar,
  Mic,
  FileText,
  Play,
  Check,
  Sparkles,
  Activity,
  Brain,
  Stethoscope,
  Bot,
  MessageSquare,
  CreditCard,
  BarChart3,
  Pill,
  Video,
  ArrowRight,
  Star,
  Quote,
  Building2,
  HeartPulse,
  Lock,
  Hospital,
  Smile,
  Plug,
  Workflow,
  Users,
  TrendingUp,
  Clock,
  ShieldCheck,
  Globe,
  Database,
  Search,
  Bell,
  Home,
  Package,
  User,
  Settings,
  RefreshCcw,
  ChevronRight,
  AlertTriangle,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  ClipboardList,
} from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import doc1 from "@/assets/doctor-1.jpg";
import doc2 from "@/assets/doctor-2.jpg";
import doc3 from "@/assets/doctor-3.jpg";
import team from "@/assets/team.jpg";

/* =========================================================
 * Shared primitives
 * ======================================================= */
export function Counter({
  to,
  suffix = "",
  duration = 1.8,
}: {
  to: number;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: duration * 1000, bounce: 0 });
  const display = useTransform(spring, (v) =>
    to >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(to % 1 === 0 ? 0 : 1),
  );
  useEffect(() => {
    if (inView) mv.set(to);
  }, [inView, mv, to]);
  return (
    <span ref={ref} className="tabular-nums">
      <motion.span>{display}</motion.span>
      {suffix}
    </span>
  );
}

export function SectionEyebrow({
  children,
  tone = "brand",
}: {
  children: React.ReactNode;
  tone?: "brand" | "dark";
}) {
  return (
    <span
      className={
        tone === "brand"
          ? "rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand"
          : "rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-brand-light backdrop-blur"
      }
    >
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  highlight,
  subtitle,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  highlight?: string;
  subtitle?: string;
  dark?: boolean;
}) {
  return (
    <section
      className={`relative overflow-hidden ${
        dark ? "bg-zinc-950 text-white" : "bg-gradient-to-b from-white to-zinc-50"
      } pt-20 pb-16`}
    >
      <div
        className={`pointer-events-none absolute inset-0 ${
          dark ? "bg-grid-dark" : "bg-grid"
        } bg-radial-fade opacity-60`}
      />
      <div className="pointer-events-none absolute -top-32 left-1/2 size-[600px] -translate-x-1/2 rounded-full bg-brand/20 blur-3xl" />
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <SectionEyebrow tone={dark ? "dark" : "brand"}>{eyebrow}</SectionEyebrow>
        <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight md:text-6xl">
          {title}{" "}
          {highlight && <span className="text-gradient-brand">{highlight}</span>}
        </h1>
        {subtitle && (
          <p className={`mx-auto mt-5 max-w-2xl text-lg ${dark ? "text-zinc-400" : "text-zinc-600"}`}>
            {subtitle}
          </p>
        )}
      </div>
    </section>
  );
}

/* =========================================================
 * HERO  (home)
 * ======================================================= */
export function Hero() {
  const words = ["Anywhere!", "Anytime!"];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % words.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative overflow-hidden pt-16 pb-20 lg:pt-20 lg:pb-28 min-h-screen flex flex-col items-center justify-start text-center" style={{ background: "linear-gradient(170deg, #E6F4F1 0%, #F0F9F8 35%, #E1F0ED 65%, #ECF7F5 100%)" }}>
      {/* Background orbs */}
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[900px] h-[550px] pointer-events-none z-0" style={{ background: "radial-gradient(ellipse, rgba(255,255,255,0.88) 0%, transparent 60%)" }} />
      <div className="absolute top-[60px] right-[-60px] w-[400px] h-[400px] pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(20,184,166,0.16) 0%, transparent 65%)" }} />
      <div className="absolute top-[80px] left-[-60px] w-[360px] h-[360px] pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(15,118,110,0.12) 0%, transparent 65%)" }} />

      {/* Rotating Stamp */}
      <div className="absolute right-[calc(5%+8px)] top-[135px] w-24 h-24 z-10 hidden md:block select-none pointer-events-none">
        <motion.svg 
          viewBox="0 0 96 96" 
          className="w-24 h-24"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 18, ease: "linear" }}
        >
          <defs>
            <path id="mn-sp" d="M 48,48 m -37,0 a 37,37 0 1,1 74,0 a 37,37 0 1,1 -74,0" fill="none" />
          </defs>
          <text fill="#0f766e" fontSize="9" fontWeight="600" letterSpacing="1.6" fontFamily="Inter, sans-serif">
            <textPath href="#mn-sp">One Platform • Complete Care • Health •</textPath>
          </text>
        </motion.svg>
        <motion.div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 bg-gradient-to-br from-[#0f766e] to-[#0b5a54] rounded-full flex items-center justify-center shadow-[0_4px_14px_rgba(15,118,110,0.4)]"
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 18, ease: "linear" }}
        >
          <Sparkles className="size-[15px] text-white" />
        </motion.div>
      </div>

      {/* Hero Content */}
      <div className="relative z-10 max-w-[820px] mx-auto w-full px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/90 border border-[#0f766e]/20 text-xs font-semibold text-[#0f766e] mb-7 shadow-[0_2px_10px_rgba(15,118,110,0.08)] backdrop-blur-md"
        >
          <Sparkles className="size-3 text-[#0f766e]" />
          Seamless healthcare
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="text-4xl md:text-5xl lg:text-[52px] font-semibold leading-[1.12] tracking-tight text-[#0F172A] mb-5"
        >
          Smarter healthcare connecting doctors and patients{" "}
          <span className="inline-block relative h-[1.15em] w-[160px] sm:w-[170px] md:w-[210px] lg:w-[230px] text-left align-bottom overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.span
                key={words[index]}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35 }}
                className="absolute left-0 font-serif italic font-medium text-[#0f766e]"
              >
                {words[index]}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-sm md:text-base text-[#64748B] leading-relaxed max-w-[480px] mx-auto mb-8 font-normal"
        >
          Connect doctors and patients with effortless scheduling, secure records, and smooth hospital operations — all in one platform.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            to="/demo"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-[#0f766e] to-[#0b5a54] shadow-[0_2px_12px_rgba(15,118,110,0.3)] hover:shadow-[0_6px_20px_rgba(15,118,110,0.4)] transition-all hover:-translate-y-[1px]"
          >
            <CalendarDays className="size-4" />
            Book Demo
          </Link>
          <a
            href="http://localhost:8080/signup"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-[#0F172A] bg-white/92 border border-[#0f766e]/16 hover:border-[#0f766e] hover:text-[#0f766e] shadow-[0_2px_10px_rgba(15,118,110,0.08)] hover:-translate-y-[1px] transition-all backdrop-blur-md"
          >
            free 14 days trial
          </a>
        </motion.div>
      </div>

      {/* Dashboard Preview Section */}
      <DashboardPreview />
    </section>
  );
}

function DashboardPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.25, duration: 0.7 }}
      className="relative mt-14 w-full max-w-[1040px] px-4 z-10"
    >
      {/* Floating Client Reviews Card */}
      <motion.div 
        className="absolute bottom-[30px] -left-6 bg-white rounded-xl shadow-[0_8px_28px_rgba(0,0,0,0.12)] p-3 border border-[#CCFBF1] min-w-[155px] z-20 hidden md:block text-left" 
        animate={{ y: [0, -8, 0] }} 
        transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
      >
        <div className="flex items-center gap-0.5 mb-1">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="size-[11px] fill-[#F59E0B] stroke-[#F59E0B]" />
          ))}
          <span className="text-[10px] font-bold text-[#0F172A] ml-1">4.9</span>
        </div>
        <div className="text-[11px] font-bold text-[#0F172A] mb-1.5">from client reviews</div>
        <div className="flex -space-x-1.5">
          <div className="w-5 h-5 rounded-full border border-white text-[7px] font-bold text-white flex items-center justify-center bg-[#0f766e]">PS</div>
          <div className="w-5 h-5 rounded-full border border-white text-[7px] font-bold text-white flex items-center justify-center bg-[#0EA5E9]">RN</div>
          <div className="w-5 h-5 rounded-full border border-white text-[7px] font-bold text-white flex items-center justify-center bg-[#059669]">AP</div>
          <div className="w-5 h-5 rounded-full border border-white text-[7px] font-bold text-white flex items-center justify-center bg-[#F59E0B]">SM</div>
        </div>
      </motion.div>

      {/* Floating Trusted Doctors Card */}
      <motion.div 
        className="absolute bottom-[140px] -right-4 bg-white rounded-xl shadow-[0_8px_28px_rgba(0,0,0,0.12)] p-3 border border-[#CCFBF1] flex items-center gap-2.5 z-20 hidden md:flex text-left" 
        animate={{ y: [0, -8, 0] }} 
        transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: 1.5 }}
      >
        <div className="w-[34px] h-[34px] rounded-full bg-gradient-to-br from-[#14b8a6] to-[#0f766e] flex items-center justify-center shrink-0">
          <Check className="size-[17px] text-white stroke-[3px]" />
        </div>
        <div>
          <div className="text-[11px] font-bold text-[#0F172A] leading-tight">Trusted by Doctors</div>
          <div className="text-[9px] text-[#64748B] mt-0.5">500+ clinics onboard</div>
        </div>
      </motion.div>

      {/* Window Wrapper */}
      <div className="rounded-3xl border border-white bg-white/80 p-2 shadow-[0_-4px_60px_rgba(15,118,110,0.12),0_24px_80px_rgba(0,0,0,0.07)] backdrop-blur-xl ring-1 ring-zinc-950/5 overflow-hidden">
        <div className="bg-white rounded-2xl overflow-hidden shadow-inner border border-zinc-100">
          
          {/* Main Layout Grid */}
          <div className="flex h-[550px] w-full overflow-hidden bg-zinc-50 font-sans text-zinc-900">
            
            {/* Sidebar Column */}
            <aside className="hidden w-56 border-r border-zinc-200 bg-white p-4 flex-col justify-between md:flex text-left select-none shrink-0">
              <div className="space-y-5">
                {/* Brand Logo Header */}
                <div className="flex items-center gap-2.5 px-1">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-light shadow-sm">
                    <HeartPulse className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <span className="text-xs font-bold tracking-tight block leading-none">
                      MediFlow AI
                    </span>
                    <span className="text-[8px] font-semibold text-zinc-400">
                      CLINICAL OS v1.2
                    </span>
                  </div>
                </div>

                {/* Clinician Card */}
                <div className="rounded-xl bg-zinc-50 border border-zinc-250/30 p-2.5 flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center text-brand font-bold text-[10px]">
                    Dr
                  </div>
                  <div className="overflow-hidden">
                    <h4 className="text-[10px] font-bold text-zinc-800 truncate leading-tight">
                      Dr. Clinician
                    </h4>
                    <span className="text-[8px] font-medium text-zinc-400 truncate block">
                      Medical Group
                    </span>
                  </div>
                </div>

                {/* Navigation Links */}
                <nav className="space-y-0.5">
                  {[
                    { id: "overview", label: "Overview", icon: LayoutDashboard, active: true },
                    { id: "scribe", label: "AI Clinical Scribe", icon: Mic },
                    { id: "appointments", label: "Appointments", icon: Calendar },
                    { id: "patients", label: "Patient Records", icon: Users },
                    { id: "analytics", label: "Practice Analytics", icon: TrendingUp },
                    { id: "settings", label: "Settings", icon: Settings },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <div
                        key={tab.id}
                        className={`flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-[10px] font-semibold transition-all cursor-pointer ${
                          tab.active
                            ? "bg-zinc-950 text-white shadow-sm"
                            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </div>
                    );
                  })}
                </nav>
              </div>

              {/* Sidebar Footer */}
              <div className="space-y-1">
                <div className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-[9px] font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer">
                  <Building2 className="h-3.5 w-3.5" />
                  Home Website
                </div>
                <div className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-[9px] font-semibold text-red-650 hover:bg-red-50 cursor-pointer text-red-650 transition-colors">
                  <LogOut className="h-3.5 w-3.5" />
                  Sign Out
                </div>
              </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col h-full overflow-hidden text-left bg-zinc-50">
              
              {/* Header Strip */}
              <header className="h-12 border-b border-zinc-200 bg-white px-4 sm:px-6 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-xs font-bold text-zinc-900">
                    Dashboard Overview
                  </h2>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[8px] font-bold text-emerald-600 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100">
                    Session Live
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-medium text-zinc-400 hidden sm:inline">
                    Today: {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                  <div className="h-3 w-[1px] bg-zinc-200 hidden sm:block" />
                  <div className="rounded-full bg-brand/10 text-brand text-[9px] font-bold px-3 py-1 flex items-center gap-1 cursor-pointer">
                    <Mic className="h-3 w-3" /> Quick Scribe
                  </div>
                </div>
              </header>

              {/* Scrollable Content Workspace */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                
                {/* 1. Statistics Cards Grid */}
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Today's Schedule", value: "3 Bookings", info: "1 pending review", icon: Calendar, color: "text-brand bg-brand/5 border-brand/10" },
                    { label: "Total Active Patients", value: "128 Patients", info: "Registered in directory", icon: Users, color: "text-amber-600 bg-amber-50 border-amber-100" },
                    { label: "All-Time Appointments", value: "1,420 Bookings", info: "1,240 confirmed, 180 completed", icon: ClipboardList, color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
                    { label: "Completion Rate", value: "94%", info: "Completed vs cancelled", icon: TrendingUp, color: "text-indigo-600 bg-indigo-50 border-indigo-100" }
                  ].map((stat, idx) => {
                    const Icon = stat.icon;
                    return (
                      <div key={idx} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] font-bold tracking-tight text-zinc-400 uppercase">
                            {stat.label}
                          </span>
                          <div className={`p-1 rounded-lg border ${stat.color}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                        </div>
                        <div>
                          <h3 className="text-sm font-extrabold text-zinc-900 leading-none">
                            {stat.value}
                          </h3>
                          <p className="text-[8.5px] font-semibold text-zinc-400 mt-1">
                            {stat.info}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 2. Main Row (Scribe Emulator & Timeline) */}
                <div className="grid gap-4 lg:grid-cols-3">
                  
                  {/* Left Column: Scribe Emulator Widget */}
                  <div className="lg:col-span-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Stethoscope className="h-3.5 w-3.5 text-brand" />
                        <h3 className="text-[10px] font-bold text-zinc-800 uppercase tracking-tight">
                          Real-time AI SOAP Dictation
                        </h3>
                      </div>
                      <div>
                        <select
                          className="rounded-full border border-zinc-250 bg-zinc-50 px-2 py-0.5 text-[8.5px] font-bold focus:outline-none pointer-events-none"
                          defaultValue="Family Medicine"
                        >
                          <option>Family Medicine</option>
                          <option>Cardiology</option>
                          <option>Pediatrics</option>
                          <option>Psychiatry</option>
                        </select>
                      </div>
                    </div>

                    {/* Idle Dictation Area */}
                    <div className="rounded-xl border border-zinc-150 bg-zinc-50/50 p-4 flex flex-col items-center justify-center text-center relative overflow-hidden min-h-[140px]">
                      <div className="space-y-2">
                        <div className="h-10 w-10 rounded-full bg-brand shadow flex items-center justify-center text-white cursor-pointer mx-auto">
                          <Mic className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <h4 className="text-[10px] font-bold text-zinc-800">
                            Start Scribing
                          </h4>
                          <p className="text-[8.5px] text-zinc-400 mt-0.5 max-w-[240px] mx-auto">
                            Click to dictate patient dialogue. AI will synthesize structured SOAP notes.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Timeline Widget */}
                  <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-brand" />
                        <h3 className="text-[10px] font-bold text-zinc-800 uppercase tracking-tight">
                          Today's Patient Timeline
                        </h3>
                      </div>
                      <span className="text-[8px] font-semibold text-zinc-400">4 Scheduled</span>
                    </div>

                    <div className="relative border-l border-zinc-200 pl-4 ml-1 space-y-3.5 text-left">
                      {[
                        { time: "09:00 AM", patient: "Eleanor Vance", reason: "Persistent cough & fever", status: "Completed", color: "bg-emerald-500 ring-emerald-100" },
                        { time: "10:30 AM", patient: "Arthur Pendelton", reason: "Angina follow-up", status: "In Progress", color: "bg-blue-500 ring-blue-100" },
                        { time: "02:00 PM", patient: "Maya Lin", reason: "Ear pain & congestion", status: "Pending Review", color: "bg-amber-500 ring-amber-100" },
                        { time: "04:15 PM", patient: "David Kross", reason: "Anxiety monitoring", status: "Scheduled", color: "bg-zinc-400 ring-zinc-100" },
                      ].map((item, idx) => (
                        <div key={idx} className="relative group text-left">
                          <div className={`absolute -left-[21px] mt-1 size-2 rounded-full ring-4 ${item.color}`} />
                          <div className="flex justify-between items-start">
                            <span className="text-[8px] font-bold text-zinc-450 tracking-tight">{item.time}</span>
                            <span className="text-[7.5px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-50 border border-zinc-200 text-zinc-500 scale-90 origin-right">{item.status}</span>
                          </div>
                          <h4 className="text-[9px] font-bold text-zinc-800 mt-0.5 truncate">{item.patient}</h4>
                          <p className="text-[8px] text-zinc-450 truncate">{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                </div>

              </div>
            </main>

          </div>

        </div>
      </div>
    </motion.div>
  );
}

/* =========================================================
 * LOGOS MARQUEE
 * ======================================================= */
export function LogosMarquee() {
  const logos = [
    "Cleveland Health",
    "Mayo Partners",
    "Apollo Clinics",
    "Bupa Group",
    "MedStar",
    "Sunrise Dental",
    "Pulse Aesthetics",
    "NovaCare",
    "BrightSmile",
    "VitalDx",
    "Carevida",
    "NorthernMed",
  ];
  return (
    <section className="relative border-y border-zinc-950/5 bg-white py-10">
      <div className="mx-auto mb-6 max-w-7xl px-6 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Trusted by 4,200+ practices in 38 countries
        </p>
      </div>
      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
        <div className="flex w-max animate-marquee gap-12 pr-12">
          {[...logos, ...logos].map((l, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-brand"
            >
              <Building2 className="size-5" />
              <span className="whitespace-nowrap text-base font-semibold tracking-tight">{l}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * STATS
 * ======================================================= */
export function Stats() {
  const stats = [
    { v: 73, suf: "%", label: "Less admin work", sub: "per doctor, per week" },
    { v: 18, suf: "h", label: "Hours saved weekly", sub: "average per provider" },
    { v: 4200, suf: "+", label: "Active practices", sub: "across 38 countries" },
    { v: 2.4, suf: "M", label: "Patient encounters", sub: "automated last quarter" },
  ];
  return (
    <section className="relative bg-gradient-to-b from-white to-zinc-50 py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-2 gap-y-10 md:grid-cols-4">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="text-center"
            >
              <p className="text-4xl font-semibold tracking-tight text-gradient-brand md:text-5xl">
                <Counter to={s.v} suffix={s.suf} />
              </p>
              <p className="mt-2 text-sm font-medium text-zinc-900">{s.label}</p>
              <p className="text-xs text-zinc-500">{s.sub}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * BENEFITS
 * ======================================================= */
export function BenefitsSection() {
  const before = [
    "Doctors typing notes after 8pm",
    "Front desk on hold with insurance",
    "Patients ghosting unconfirmed slots",
    "5 different SaaS tools that don't talk",
    "Manual coding errors costing $40k/yr",
    "Spreadsheets for clinic analytics",
  ];
  const after = [
    "AI drafts SOAP notes during the visit",
    "Voice agent verifies eligibility in 12s",
    "Smart reminders cut no-shows by 58%",
    "One platform, one login, one bill",
    "Auto ICD-10 + CPT with 99.2% accuracy",
    "Real-time multi-location dashboards",
  ];
  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 text-center">
          <SectionEyebrow>THE SHIFT</SectionEyebrow>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Stop running your practice on{" "}
            <span className="line-through decoration-red-400/60 decoration-4">paperwork</span>.
            <br />
            Start running it on <span className="text-gradient-brand">intelligence</span>.
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-red-200/60 bg-red-50/30 p-8"
          >
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-red-500">
              Without MediFlow
            </p>
            <h3 className="mb-6 text-xl font-semibold text-zinc-900">The chaos tax</h3>
            <ul className="space-y-3">
              {before.map((b, i) => (
                <motion.li
                  key={b}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-3 text-sm text-zinc-700"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-400" />
                  <span className="line-through decoration-red-300/60">{b}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative overflow-hidden rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/5 via-white to-cyan-50/40 p-8 ring-1 ring-brand/10"
          >
            <div className="absolute -right-20 -top-20 size-64 rounded-full bg-brand/10 blur-3xl" />
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand">
              With MediFlow AI
            </p>
            <h3 className="mb-6 text-xl font-semibold text-zinc-900">The compound advantage</h3>
            <ul className="relative space-y-3">
              {after.map((a, i) => (
                <motion.li
                  key={a}
                  initial={{ opacity: 0, x: 10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-3 text-sm text-zinc-800"
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand text-white">
                    <Check className="size-3" />
                  </span>
                  <span className="font-medium">{a}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * FEATURE BENTO  (interactive tabs added)
 * ======================================================= */
function VoiceWaveMock() {
  const bars = Array.from({ length: 28 });
  return (
    <div className="mt-4 flex items-end gap-1 h-16">
      {bars.map((_, i) => (
        <motion.div
          key={i}
          animate={{
            height: [
              `${20 + Math.random() * 60}%`,
              `${20 + Math.random() * 80}%`,
              `${20 + Math.random() * 60}%`,
            ],
          }}
          transition={{ duration: 1 + Math.random(), repeat: Infinity, delay: i * 0.05 }}
          className="w-1.5 rounded-full bg-gradient-to-t from-brand to-brand-light"
        />
      ))}
    </div>
  );
}

function MiniBarChart() {
  const d = [{ v: 30 }, { v: 55 }, { v: 42 }, { v: 78 }, { v: 65 }, { v: 90 }, { v: 72 }];
  return (
    <div className="h-24 w-32">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d}>
          <Bar dataKey="v" radius={[3, 3, 0, 0]} fill="#14b8a6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BentoCard({
  children,
  className = "",
  glow = false,
}: {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm transition-all hover:border-brand/40 hover:bg-white/[0.06] ${className}`}
    >
      {glow && (
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-brand/20 blur-3xl" />
      )}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-light/60 to-transparent" />
      </div>
      <div className="relative h-full">{children}</div>
    </motion.div>
  );
}

export function FeatureBento() {
  return (
    <section id="features" className="relative bg-zinc-950 py-24 text-white">
      <div className="pointer-events-none absolute inset-0 bg-grid-dark bg-radial-fade opacity-50" />
      <div className="pointer-events-none absolute left-1/2 top-0 size-[600px] -translate-x-1/2 rounded-full bg-brand/30 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <SectionEyebrow tone="dark">EVERYTHING IN ONE PLATFORM</SectionEyebrow>
          <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            The end of the <span className="text-gradient-brand">SaaS sprawl</span>
          </h2>
          <p className="mt-4 text-zinc-400">
            Twelve modules. One database. Built for how modern medicine actually runs.
          </p>
        </div>

        <div className="grid auto-rows-[14rem] grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <BentoCard className="md:col-span-2 md:row-span-2" glow>
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand/20 px-2.5 py-1">
                  <Bot className="size-3.5 text-brand-light" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-light">
                    Voice AI
                  </span>
                </div>
                <h3 className="text-2xl font-semibold tracking-tight">
                  AI receptionist that never sleeps
                </h3>
                <p className="mt-2 max-w-md text-sm text-zinc-400">
                  Answers in 38 languages, books appointments, verifies insurance, triages urgency
                  — all while writing directly into your EMR.
                </p>
              </div>
              <VoiceWaveMock />
            </div>
          </BentoCard>

          <BentoCard>
            <FileText className="size-5 text-brand-light" />
            <h3 className="mt-3 font-semibold">Auto SOAP notes</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Ambient listening generates structured documentation in 2.3 seconds.
            </p>
          </BentoCard>

          <BentoCard>
            <Calendar className="size-5 text-brand-light" />
            <h3 className="mt-3 font-semibold">Omnichannel booking</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Automated booking widgets. Real-time sync across all calendars and doctors.
            </p>
          </BentoCard>

          <BentoCard className="md:col-span-2">
            <div className="flex h-full items-center gap-6">
              <div className="flex-1">
                <CreditCard className="size-5 text-brand-light" />
                <h3 className="mt-3 font-semibold">Smart billing & RCM</h3>
                <p className="mt-1 text-xs text-zinc-400">
                  Auto ICD-10 + CPT coding with 99.2% first-pass accuracy. Eligibility checks in
                  12s.
                </p>
              </div>
              <MiniBarChart />
            </div>
          </BentoCard>

          <BentoCard>
            <Video className="size-5 text-brand-light" />
            <h3 className="mt-3 font-semibold">Telemedicine</h3>
            <p className="mt-1 text-xs text-zinc-400">
              HD video, e-prescriptions, embedded directly in the browser.
            </p>
          </BentoCard>

          <BentoCard>
            <Pill className="size-5 text-brand-light" />
            <h3 className="mt-3 font-semibold">e-Prescription</h3>
            <p className="mt-1 text-xs text-zinc-400">DEA-compliant with drug-interaction AI.</p>
          </BentoCard>

          <BentoCard>
            <BarChart3 className="size-5 text-brand-light" />
            <h3 className="mt-3 font-semibold">Real-time analytics</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Multi-tenant dashboards across every location.
            </p>
          </BentoCard>

          <BentoCard>
            <MessageSquare className="size-5 text-brand-light" />
            <h3 className="mt-3 font-semibold">Patient messaging</h3>
            <p className="mt-1 text-xs text-zinc-400">
              HIPAA SMS, WhatsApp, email — all in one inbox.
            </p>
          </BentoCard>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * INTERACTIVE FEATURE TABS
 * ======================================================= */
export function FeatureTabs() {
  const tabs = [
    {
      key: "scribe",
      icon: FileText,
      title: "Ambient AI Scribe",
      blurb:
        "Listens to your visit, drafts a clean SOAP note in your style, codes the encounter, and queues the claim — all before you reach the next door.",
      bullets: [
        "Multilingual (38 languages)",
        "Specialty-tuned templates",
        "Auto ICD-10 + CPT + HCC",
        "Edit and sign in one click",
      ],
      preview: (
        <div className="space-y-2 text-[11px] font-mono">
          {[
            { k: "S", t: "62M presents with intermittent chest pressure x3 days…" },
            { k: "O", t: "BP 142/88, HR 78, SpO2 98%. EKG: NSR, no ST changes." },
            { k: "A", t: "Atypical chest pain. R/o ACS. CAD risk elevated." },
            { k: "P", t: "Trop x3, stress test, ASA 81, statin, cardiology f/u." },
          ].map((row, i) => (
            <motion.div
              key={row.k}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="flex gap-2 rounded-md bg-zinc-50 px-2 py-1.5 ring-1 ring-zinc-950/5"
            >
              <span className="font-bold text-brand">{row.k}</span>
              <span className="text-zinc-700">{row.t}</span>
            </motion.div>
          ))}
        </div>
      ),
    },
    {
      key: "voice",
      icon: Mic,
      title: "Voice Receptionist",
      blurb:
        "A human-sounding agent answers every call, books slots, verifies insurance, and routes urgencies — 24/7 with zero hold time.",
      bullets: [
        "Avg. response: 800ms",
        "Books, reschedules, cancels",
        "Real-time insurance eligibility",
        "Escalates clinical urgency",
      ],
      preview: (
        <div className="space-y-2 text-[11px]">
          {[
            { who: "Patient", t: "Hi, I need to see Dr. Lee for my back pain." },
            { who: "MediFlow AI", t: "Of course. I have Tuesday 10:15 or Thursday 2pm." },
            { who: "Patient", t: "Tuesday works." },
            { who: "MediFlow AI", t: "Booked. Confirming insurance via Aetna… eligible. ✓" },
          ].map((row, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: i % 2 ? 8 : -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.12 }}
              className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${
                row.who === "Patient"
                  ? "bg-zinc-100 text-zinc-700"
                  : "ml-auto bg-brand text-white"
              }`}
            >
              {row.t}
            </motion.div>
          ))}
        </div>
      ),
    },
    {
      key: "billing",
      icon: CreditCard,
      title: "Autonomous Billing",
      blurb:
        "Submit clean claims the day of service. Catch denials before they happen. Recover lost revenue you didn't know existed.",
      bullets: [
        "99.2% first-pass acceptance",
        "Real-time eligibility & estimates",
        "Auto appeal denied claims",
        "Patient text-to-pay",
      ],
      preview: (
        <div className="space-y-2 text-[11px]">
          {[
            { c: "99213", d: "Office visit, established", $: "$112", ok: true },
            { c: "93000", d: "EKG, complete", $: "$58", ok: true },
            { c: "G0438", d: "Annual wellness, initial", $: "$167", ok: true },
            { c: "—", d: "Predicted denial: missing modifier", $: "—", ok: false },
          ].map((r) => (
            <div
              key={r.c}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 ring-1 ${
                r.ok ? "bg-emerald-50/60 ring-emerald-200" : "bg-amber-50/60 ring-amber-200"
              }`}
            >
              <span className="font-mono">{r.c}</span>
              <span className="flex-1 px-2 text-zinc-600">{r.d}</span>
              <span className="font-semibold">{r.$}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: "analytics",
      icon: BarChart3,
      title: "Live Analytics",
      blurb:
        "Watch revenue, occupancy, provider productivity and patient experience update in real time across every location.",
      bullets: [
        "Predictive no-show scoring",
        "Revenue per provider/service line",
        "Retention cohort analysis",
        "Custom KPIs + alerting",
      ],
      preview: <MiniAreaPreview />,
    },
  ];
  const [active, setActive] = useState(0);
  const tab = tabs[active];
  return (
    <section className="relative bg-white py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <SectionEyebrow>EXPLORE THE PLATFORM</SectionEyebrow>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Click through. <span className="text-gradient-brand">See it work.</span>
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="flex flex-row gap-2 overflow-x-auto lg:flex-col">
            {tabs.map((t, i) => {
              const Icon = t.icon;
              const isActive = i === active;
              return (
                <button
                  key={t.key}
                  onClick={() => setActive(i)}
                  className={`group relative flex w-full shrink-0 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                    isActive
                      ? "border-brand/30 bg-brand/5"
                      : "border-zinc-950/5 bg-zinc-50 hover:bg-zinc-100"
                  }`}
                >
                  <div
                    className={`flex size-9 items-center justify-center rounded-lg ${
                      isActive ? "bg-brand text-white" : "bg-white text-zinc-500 ring-1 ring-zinc-950/5"
                    }`}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${isActive ? "text-brand" : "text-zinc-900"}`}>
                      {t.title}
                    </p>
                  </div>
                  {isActive && (
                    <motion.span
                      layoutId="tabbar"
                      className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="grid gap-6 rounded-2xl border border-zinc-950/5 bg-gradient-to-br from-zinc-50 to-white p-8 md:grid-cols-2"
            >
              <div>
                <h3 className="text-2xl font-semibold tracking-tight">{tab.title}</h3>
                <p className="mt-3 text-sm text-zinc-600">{tab.blurb}</p>
                <ul className="mt-5 space-y-2">
                  {tab.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-2 text-sm text-zinc-700">
                      <Check className="size-4 text-brand" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-zinc-950/5 bg-white p-4">{tab.preview}</div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function MiniAreaPreview() {
  const data = Array.from({ length: 12 }, (_, i) => ({ m: i, v: 40 + Math.sin(i / 2) * 30 + i * 5 }));
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="pa" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke="#0f766e" strokeWidth={2.5} fill="url(#pa)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* =========================================================
 * AI FLOW
 * ======================================================= */
export function AIFlowSection() {
  const steps = [
    { icon: Mic, label: "Patient calls", sub: "or books online" },
    { icon: Brain, label: "AI triages intent", sub: "books + verifies eligibility" },
    { icon: Stethoscope, label: "Doctor sees patient", sub: "ambient AI listens" },
    { icon: FileText, label: "SOAP note drafted", sub: "in 2.3 seconds" },
    { icon: CreditCard, label: "Auto-coded & billed", sub: "99.2% first pass" },
  ];
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-zinc-50 via-white to-zinc-50 py-24">
      <div className="pointer-events-none absolute inset-0 bg-grid bg-radial-fade" />
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <SectionEyebrow>HOW IT WORKS</SectionEyebrow>
          <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            From phone ring to <span className="text-gradient-brand">paid claim</span> in one flow
          </h2>
          <p className="mt-4 text-zinc-600">
            The entire patient journey — automated, audited, and human-in-the-loop where it matters.
          </p>
        </div>

        <div className="relative">
          <svg
            className="absolute left-0 right-0 top-12 hidden h-2 w-full md:block"
            preserveAspectRatio="none"
            viewBox="0 0 1000 8"
          >
            <line
              x1="0"
              y1="4"
              x2="1000"
              y2="4"
              stroke="#e4e4e7"
              strokeWidth="2"
              strokeDasharray="6 6"
            />
            <line
              x1="0"
              y1="4"
              x2="1000"
              y2="4"
              stroke="url(#flowg)"
              strokeWidth="2"
              strokeDasharray="20 1000"
              className="animate-dash"
            />
            <defs>
              <linearGradient id="flowg" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#0f766e" stopOpacity="0" />
                <stop offset="50%" stopColor="#14b8a6" />
                <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>

          <div className="relative grid grid-cols-1 gap-8 md:grid-cols-5">
            {steps.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12 }}
                className="relative flex flex-col items-center text-center"
              >
                <div className="relative mb-4">
                  <div
                    className="absolute -inset-3 rounded-full bg-brand/10 blur-xl animate-pulse-soft"
                    style={{ animationDelay: `${i * 0.4}s` }}
                  />
                  <div className="relative flex size-24 items-center justify-center rounded-full bg-white ring-1 ring-zinc-950/5">
                    <div className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-white">
                      <s.icon className="size-7" />
                    </div>
                  </div>
                  <div className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
                    {i + 1}
                  </div>
                </div>
                <p className="text-sm font-semibold">{s.label}</p>
                <p className="text-xs text-zinc-500">{s.sub}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * ANALYTICS
 * ======================================================= */
export function AnalyticsSection() {
  const visits = Array.from({ length: 12 }, (_, i) => ({
    m: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i],
    manual: 200 - i * 6 + Math.random() * 10,
    ai: 200 + i * 28 + Math.random() * 12,
  }));
  const mix = [
    { name: "Primary care", value: 42, fill: "#0f766e" },
    { name: "Dental", value: 23, fill: "#14b8a6" },
    { name: "Aesthetic", value: 18, fill: "#5eead4" },
    { name: "Diagnostics", value: 17, fill: "#67e8f9" },
  ];
  return (
    <section className="relative bg-white py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionEyebrow>ANALYTICS COMMAND CENTER</SectionEyebrow>
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
              Every metric that matters, in <span className="text-gradient-brand">real time</span>
            </h2>
            <p className="mt-4 text-zinc-600">
              No more end-of-month spreadsheets. Watch revenue, occupancy, doctor productivity and
              patient satisfaction update live across every location.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Revenue per provider, per location, per service line",
                "Predictive no-show scoring 7 days out",
                "Insurance reimbursement aging & denial reasons",
                "Patient lifetime value & retention cohorts",
              ].map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm text-zinc-700">
                  <div className="flex size-5 items-center justify-center rounded-full bg-brand/10">
                    <Check className="size-3 text-brand" />
                  </div>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="rounded-2xl border border-zinc-950/5 bg-zinc-50 p-6"
            >
              <div className="mb-4 flex items-baseline justify-between">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Patient volume</p>
                  <p className="text-2xl font-semibold tracking-tight">
                    <Counter to={12480} />
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600">
                  +127% YoY
                </span>
              </div>
              <div className="h-48">
                <ResponsiveContainer>
                  <LineChart data={visits}>
                    <XAxis
                      dataKey="m"
                      stroke="#a1a1aa"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e4e4e7",
                        fontSize: 11,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="manual"
                      stroke="#a1a1aa"
                      strokeWidth={2}
                      dot={false}
                      strokeDasharray="4 4"
                      name="Before"
                    />
                    <Line
                      type="monotone"
                      dataKey="ai"
                      stroke="#0f766e"
                      strokeWidth={2.5}
                      dot={false}
                      name="With MediFlow"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <div className="grid grid-cols-2 gap-4">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="rounded-2xl border border-zinc-950/5 bg-zinc-50 p-5"
              >
                <p className="mb-2 text-xs font-medium text-zinc-500">Service mix</p>
                <div className="h-32">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={mix}
                        dataKey="value"
                        innerRadius={28}
                        outerRadius={48}
                        paddingAngle={3}
                      >
                        {mix.map((e) => (
                          <Cell key={e.name} fill={e.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.15 }}
                className="rounded-2xl border border-zinc-950/5 bg-zinc-50 p-5"
              >
                <p className="mb-2 text-xs font-medium text-zinc-500">Patient NPS</p>
                <p className="text-3xl font-semibold tracking-tight">
                  <Counter to={72} />
                </p>
                <div className="mt-3 flex gap-0.5">
                  {Array.from({ length: 14 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-8 flex-1 rounded-sm ${i < 11 ? "bg-brand" : "bg-zinc-200"}`}
                      style={{ opacity: 0.4 + (i / 14) * 0.6 }}
                    />
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * SPECIALTIES MARQUEE
 * ======================================================= */
export function SpecialtiesSection() {
  const specs = [
    { icon: Stethoscope, label: "General Practice", color: "from-brand to-brand-light" },
    { icon: Smile, label: "Dental", color: "from-cyan-500 to-sky-400" },
    { icon: Sparkles, label: "Aesthetic", color: "from-pink-400 to-rose-400" },
    { icon: Activity, label: "Diagnostics", color: "from-violet-500 to-fuchsia-400" },
    { icon: HeartPulse, label: "Cardiology", color: "from-red-400 to-orange-400" },
    { icon: Hospital, label: "Hospitals", color: "from-indigo-500 to-blue-400" },
  ];
  return (
    <section className="relative bg-zinc-50 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Built for <span className="text-gradient-brand">every specialty</span>
          </h2>
          <p className="mt-4 text-zinc-600">
            Configurable workflows, specialty-tuned AI models, and templates that match how your
            team works.
          </p>
        </div>
        <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
          <div className="flex w-max animate-marquee-fast gap-4">
            {[...specs, ...specs, ...specs].map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-full border border-zinc-950/5 bg-white px-5 py-3"
              >
                <div
                  className={`flex size-8 items-center justify-center rounded-full bg-gradient-to-br ${s.color} text-white`}
                >
                  <s.icon className="size-4" />
                </div>
                <span className="whitespace-nowrap text-sm font-semibold">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * TESTIMONIALS
 * ======================================================= */
export function Testimonials() {
  const ts = [
    {
      img: doc1,
      name: "Dr. Elena Rojas",
      role: "Family Medicine · Mercy Health Group",
      source: "via Google Reviews",
      quote:
        "I haven't written a SOAP note in 4 months. MediFlow's AI scribe captures everything during the visit. I see two more patients a day and I'm home for dinner with my family.",
      stat: "+38% patient throughput",
    },
    {
      img: doc2,
      name: "Dr. Arjun Patel",
      role: "Internal Medicine · Apollo Clinics",
      source: "via Trustpilot",
      quote:
        "The AI receptionist handles 71% of our inbound calls without any human intervention. Our front desk staff transitioned into revenue cycle specialists — we saved $184k in year one.",
      stat: "$184k saved in year one",
    },
    {
      img: doc3,
      name: "Dr. Amara Okafor",
      role: "Dental Director · BrightSmile Network",
      source: "via G2 Reviews",
      quote:
        "We rolled out MediFlow across 14 clinics in 9 days. No-shows dropped from 11% to 3.1% within the first month. The onboarding team was exceptional.",
      stat: "-58% no-show rate",
    },
    {
      img: team,
      name: "Dr. Marcus Webb",
      role: "Chief Medical Officer · NovaCare Health",
      source: "via Google Reviews",
      quote:
        "It feels like having an extra resident on the team — one who never sleeps. MediFlow listens, drafts, codes and learns your style within weeks of going live.",
      stat: "2× faster documentation",
    },
  ];

  const [active, setActive] = useState(0);
  const [direction, setDirection] = useState(1);
  const total = ts.length;

  const go = (next: number) => {
    setDirection(next > active ? 1 : -1);
    setActive((next + total) % total);
  };

  useEffect(() => {
    const id = setInterval(() => {
      setDirection(1);
      setActive((prev) => (prev + 1) % total);
    }, 5000);
    return () => clearInterval(id);
  }, [total]);

  const t = ts[active];

  return (
    <section id="customers" className="relative bg-white py-24 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">

        {/* Two-column grid — heading + quote left, image right, both top-aligned */}
        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">

          {/* Left column */}
          <div className="flex flex-col">
            {/* Heading — top-aligned with image */}
            <div className="mb-10">
              <SectionEyebrow>LOVED BY PROVIDERS</SectionEyebrow>
              <h2 className="mt-4 text-balance text-2xl font-semibold tracking-tight md:text-4xl">
                Real results from <span className="text-gradient-brand">real clinics</span>
              </h2>
            </div>

            {/* Quote content */}
            <div className="relative flex-1">
              <span className="absolute -top-2 -left-1 select-none pointer-events-none text-[60px] leading-none font-serif text-brand/20">
                "
              </span>

              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={active}
                  custom={direction}
                  initial={{ opacity: 0, x: direction * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: direction * -40 }}
                  transition={{ duration: 0.4, ease: "easeInOut" }}
                  className="relative pt-10"
                >
                  <blockquote className="text-base md:text-lg font-serif italic font-medium leading-relaxed text-zinc-800 mb-8">
                    "{t.quote}"
                  </blockquote>

                  <div className="mb-1">
                    <p className="text-xs font-bold uppercase tracking-widest text-brand">
                      {t.name}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {t.role} · <span className="text-zinc-400">{t.source}</span>
                    </p>
                  </div>

                  <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand/8 border border-brand/15 px-3 py-1">
                    <TrendingUp className="size-3 text-brand" />
                    <span className="text-xs font-semibold text-brand">{t.stat}</span>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Navigation */}
              <div className="flex items-center gap-3 mt-10">
                <button
                  onClick={() => go(active - 1)}
                  aria-label="Previous testimonial"
                  className="flex size-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:border-brand hover:text-brand transition-colors"
                >
                  <ChevronRight className="size-4 rotate-180" />
                </button>
                <button
                  onClick={() => go(active + 1)}
                  aria-label="Next testimonial"
                  className="flex size-9 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark transition-colors"
                >
                  <ChevronRight className="size-4" />
                </button>
                <div className="flex items-center gap-1.5 ml-2">
                  {ts.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => go(i)}
                      aria-label={`Testimonial ${i + 1}`}
                      className={`rounded-full transition-all duration-300 ${
                        i === active
                          ? "w-5 h-2 bg-brand"
                          : "w-2 h-2 bg-zinc-300 hover:bg-zinc-400"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right column — image top-aligned with heading */}
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
              className="relative aspect-[4/3] overflow-hidden rounded-3xl"
            >
              <img
                src={t.img}
                alt={t.name}
                className="size-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-transparent" />
              <div className="absolute top-4 right-4 flex items-center gap-1 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 shadow-sm">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className="size-3 fill-amber-400 text-amber-400" />
                ))}
                <span className="ml-1 text-xs font-bold text-zinc-800">5.0</span>
              </div>
            </motion.div>
          </AnimatePresence>

        </div>
      </div>
    </section>
  );
}
/* =========================================================
 * PRICING + ROI Calculator
 * ======================================================= */
export function Pricing() {
  const tiers = [
    {
      name: "Solo",
      price: "₹999",
      blurb: "1 doctor dashboard",
      features: [
        "1 doctor dashboard",
        "1 reception dashboard",
        "500 monthly appointments",
        "Upto 500 patients records",
        "AI prescription",
        "Standard support",
      ],
      cta: "Start free trial",
      variant: "default" as const,
    },
    {
      name: "Clinic",
      price: "₹1,499",
      blurb: "Growing multi-provider practices.",
      features: [
        "Up to 5 doctors",
        "1 reception dashboard",
        "2,000 monthly appointments",
        "Up to 5,000 patient records",
        "WhatsApp alerts",
        "AI prescription + SOAP dictation",
        "Priority support + onboarding",
        "Smart billing system",
      ],
      cta: "Start free trial",
      popular: true,
    },
    {
      name: "Hospital",
      price: "Custom",
      blurb: "Complete hospital management system.",
      features: [
        "Unlimited Doctors & Staff",
        "Multi-Hospital Super Admin",
        "All Pro Features",
        "Sub-department Dashboards",
        "Ambulance / Biomedical / Housekeeping",
        "Role-based Access (all roles)",
        "AI voice prescription",
        "AI Chatbot (Clinical Support)",
        "Blog & Content Management",
        "Receptionist & Nursing Admin Roles",
        "Priority SLA + 24/7 Phone Support",
      ],
      cta: "Contact sales",
      variant: "dark" as const,
    },
  ];

  return (
    <section id="pricing" className="relative bg-gradient-to-b from-zinc-50 to-white py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-grid bg-radial-fade opacity-40" />
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mb-16 text-center">
          <SectionEyebrow>SIMPLE PRICING</SectionEyebrow>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Predictable as your <span className="text-gradient-brand">network grows</span>
          </h2>
          <p className="mt-4 text-zinc-600">
            No per-patient fees. 14-day free trial. Cancel anytime.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {tiers.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`relative flex flex-col rounded-2xl p-8 transition-all ${
                t.popular
                  ? "bg-zinc-900 text-white ring-1 ring-brand/40 lg:scale-105"
                  : "bg-white text-zinc-900 ring-1 ring-zinc-950/5 hover:border-brand/20"
              }`}
            >
              {t.popular && (
                <>
                  <div className="absolute -inset-px -z-10 rounded-2xl bg-gradient-to-br from-brand via-brand-light to-cyan-400 opacity-40 blur" />
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand to-brand-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                    Most Popular
                  </span>
                </>
              )}
              <p
                className={`text-xs font-semibold uppercase tracking-wider ${
                  t.popular ? "text-brand-light" : "text-brand"
                }`}
              >
                {t.name}
              </p>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight md:text-5xl">{t.price}</span>
                {t.price !== "Custom" && (
                  <span className={`text-sm ${t.popular ? "text-zinc-400" : "text-zinc-500"}`}>
                    /mo
                  </span>
                )}
              </p>
              <p className={`mt-3 text-sm ${t.popular ? "text-zinc-300" : "text-zinc-600"}`}>
                {t.blurb}
              </p>
              <ul className="mt-6 flex-1 space-y-3">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check
                      className={`mt-0.5 size-4 shrink-0 ${
                        t.popular ? "text-brand-light" : "text-brand"
                      }`}
                    />
                    <span className={t.popular ? "text-zinc-200" : "text-zinc-700"}>{f}</span>
                  </li>
                ))}
              </ul>
              {t.price === "Custom" ? (
                <Link
                  to="/contact"
                  className={`mt-8 w-full rounded-lg py-2.5 text-center text-sm font-semibold transition-all ${
                    t.popular
                      ? "bg-white text-zinc-900 hover:bg-zinc-100"
                      : t.variant === "dark"
                        ? "bg-zinc-900 text-white hover:bg-zinc-800"
                        : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                  }`}
                >
                  {t.cta}
                </Link>
              ) : (
                <Link
                  to="/signup"
                  search={{ plan: t.name }}
                  className={`mt-8 w-full rounded-lg py-2.5 text-center text-sm font-semibold transition-all ${
                    t.popular
                      ? "bg-white text-zinc-900 hover:bg-zinc-100"
                      : t.variant === "dark"
                        ? "bg-zinc-900 text-white hover:bg-zinc-800"
                        : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                  }`}
                >
                  {t.cta}
                </Link>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ROICalculator() {
  const [providers, setProviders] = useState(8);
  const [patients, setPatients] = useState(24);
  const [hourlyCost, setHourlyCost] = useState(1500);

  const hoursSaved = providers * 18; // 18h/week per doctor
  const annualSavings = Math.round(hoursSaved * 52 * hourlyCost);
  const extraVisits = providers * Math.round(patients * 0.15) * 52;
  const extraRevenue = extraVisits * 500; // Average visit fee in Rupees

  return (
    <section className="relative overflow-hidden bg-zinc-950 py-24 text-white">
      <div className="pointer-events-none absolute inset-0 bg-grid-dark bg-radial-fade opacity-40" />
      <div className="pointer-events-none absolute -left-32 top-1/3 size-[500px] rounded-full bg-brand/30 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <SectionEyebrow tone="dark">ROI CALCULATOR</SectionEyebrow>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Drag the sliders. <span className="text-gradient-brand">See the impact.</span>
          </h2>
        </div>

        <div className="grid gap-8 rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-sm md:grid-cols-2">
          <div className="space-y-7">
            <Slider
              label="Number of providers"
              value={providers}
              min={1}
              max={50}
              onChange={setProviders}
              suffix=" providers"
            />
            <Slider
              label="Avg. daily patients per provider"
              value={patients}
              min={5}
              max={60}
              onChange={setPatients}
              suffix=" / day"
            />
            <Slider
              label="Provider hourly cost"
              value={hourlyCost}
              min={500}
              max={5000}
              step={100}
              onChange={setHourlyCost}
              prefix="₹"
              suffix="/hr"
            />
          </div>

          <div className="grid gap-4">
            <ROIMetric
              icon={Clock}
              label="Hours reclaimed weekly"
              value={`${hoursSaved.toLocaleString()}h`}
              tint="from-brand to-brand-light"
            />
            <ROIMetric
              icon={TrendingUp}
              label="Extra annual visits possible"
              value={extraVisits.toLocaleString()}
              tint="from-cyan-500 to-sky-400"
            />
            <ROIMetric
              icon={CreditCard}
              label="Estimated annual ROI"
              value={`₹${(annualSavings + extraRevenue).toLocaleString()}`}
              tint="from-emerald-500 to-teal-400"
              highlight
            />
            <Link
              to="/contact"
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-brand to-brand-light py-3 text-sm font-semibold text-white"
            >
              Lock in these savings <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  prefix = "",
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          {label}
        </label>
        <span className="text-lg font-semibold tabular-nums">
          {prefix}
          {value}
          {suffix}
        </span>
      </div>
      <div className="relative">
        <div className="absolute inset-y-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/10" />
        <div
          className="absolute inset-y-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-brand to-brand-light"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative h-6 w-full cursor-grab appearance-none bg-transparent [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-brand"
        />
      </div>
    </div>
  );
}

function ROIMetric({
  icon: Icon,
  label,
  value,
  tint,
  highlight = false,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  tint: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 ${
        highlight ? "border-brand/40 bg-brand/10" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center gap-4">
        <div className={`flex size-11 items-center justify-center rounded-xl bg-gradient-to-br ${tint}`}>
          <Icon className="size-5 text-white" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-zinc-400">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
 * FAQ
 * ======================================================= */
export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  const items = [
    {
      q: "How long does setup take?",
      a: "Most solo practices are live in under 12 minutes. Multi-location clinics typically complete onboarding in 3–5 days, including EMR data migration.",
    },
    {
      q: "Is MediFlow HIPAA compliant?",
      a: "Yes. We're HIPAA compliant, SOC 2 Type II certified, and offer BAAs at every tier. Data is encrypted at rest (AES-256) and in transit (TLS 1.3).",
    },
    {
      q: "Will it work with my existing EMR?",
      a: "Yes. We support HL7 v2, FHIR R4, and have prebuilt integrations with Epic, Athena, Cerner, eClinicalWorks, and 40+ other systems.",
    },
    {
      q: "How accurate is the AI scribe?",
      a: "Our ambient AI hits 99.1% accuracy on SOAP structure and 98.4% on clinical entity extraction. Every note is editable and requires provider sign-off.",
    },
    {
      q: "Can patients use it in different languages?",
      a: "The AI receptionist understands and responds in 38 languages, including Spanish, Mandarin, Hindi, Arabic, and French.",
    },
    {
      q: "What if I want to cancel?",
      a: "Cancel anytime — no contracts, no exit fees. We'll export all your patient and clinical data in standard FHIR format within 24 hours.",
    },
  ];
  return (
    <section className="relative bg-white py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            Questions, <span className="text-gradient-brand">answered</span>
          </h2>
        </div>
        <div className="space-y-3">
          {items.map((it, i) => (
            <div
              key={it.q}
              className="overflow-hidden rounded-xl border border-zinc-950/5 bg-zinc-50 transition-all"
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between gap-4 p-5 text-left"
              >
                <span className="text-sm font-semibold">{it.q}</span>
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-zinc-950/5 transition-transform ${
                    open === i ? "rotate-45" : ""
                  }`}
                >
                  <span className="text-brand">+</span>
                </span>
              </button>
              <motion.div
                initial={false}
                animate={{ height: open === i ? "auto" : 0, opacity: open === i ? 1 : 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <p className="px-5 pb-5 text-sm leading-relaxed text-zinc-600">{it.a}</p>
              </motion.div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * CTA
 * ======================================================= */
export function CTA() {
  return (
    <section className="relative overflow-hidden bg-zinc-950 py-24 text-white">
      <div className="pointer-events-none absolute inset-0 bg-grid-dark bg-radial-fade opacity-60" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/30 blur-3xl animate-pulse-soft" />
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-balance text-4xl font-semibold tracking-tight md:text-6xl"
        >
          Give your clinic its <span className="text-gradient-brand">superpower</span> back.
        </motion.h2>
        <p className="mt-6 text-lg text-zinc-300">
          Join 4,200+ practices using MediFlow AI to see more patients, write zero notes, and run
          smarter operations.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/signup"
            className="group relative overflow-hidden rounded-lg bg-gradient-to-br from-brand to-brand-light px-7 py-3.5 text-sm font-semibold text-white ring-1 ring-brand/40 transition-transform hover:scale-105"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            Start your 14-day free trial
          </Link>
          <Link
            to="/contact"
            className="rounded-lg border border-white/15 bg-white/5 px-7 py-3.5 text-sm font-semibold backdrop-blur transition-colors hover:bg-white/10"
          >
            Talk to sales
          </Link>
        </div>
        <p className="mt-6 text-xs text-zinc-500">
          No credit card · Cancel anytime · Setup in 12 minutes
        </p>
      </div>
    </section>
  );
}

/* =========================================================
 * INTEGRATIONS
 * ======================================================= */
export function IntegrationsGrid() {
  const items = [
    "Epic",
    "Cerner",
    "Athena",
    "eClinicalWorks",
    "Stripe",
    "Twilio",
    "Slack",
    "Google Calendar",
    "Outlook",
    "Zoom",
    "DocuSign",
    "Xero",
    "QuickBooks",
    "Salesforce",
    "Mailchimp",
    "Notion",
  ];
  return (
    <section className="relative bg-zinc-50 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <SectionEyebrow>WORKS WITH YOUR STACK</SectionEyebrow>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            40+ <span className="text-gradient-brand">integrations</span>, zero rip & replace
          </h2>
          <p className="mt-4 text-zinc-600">
            FHIR R4, HL7 v2, REST and webhooks. Connect what you have. Replace only when you're
            ready.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8">
          {items.map((name, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.03 }}
              className="group flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-zinc-950/5 bg-white p-3 transition-all hover:border-brand/30 hover:bg-brand/5"
            >
              <Plug className="size-5 text-zinc-400 transition-colors group-hover:text-brand" />
              <p className="text-xs font-medium text-zinc-700">{name}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * SOLUTIONS GRID
 * ======================================================= */
export function SolutionsGrid() {
  const sols = [
    {
      icon: Stethoscope,
      title: "Solo Practitioners",
      copy: "Run a one-doctor clinic like a 50-person hospital. AI handles intake, notes and billing so you can see patients.",
      bullets: ["No front desk required", "Auto SOAP + billing", "$149/mo"],
    },
    {
      icon: Building2,
      title: "Multi-Location Clinics",
      copy: "Unified scheduling, shared waitlist, cross-location analytics and centralized billing for 2-50 locations.",
      bullets: ["Real-time location sync", "Centralized RCM", "Tenant-level branding"],
    },
    {
      icon: Hospital,
      title: "Hospitals & Networks",
      copy: "FHIR-native integration with Epic, Cerner and Athena. On-prem deployment available for the strictest IT teams.",
      bullets: ["HL7 + FHIR R4", "Custom AI fine-tuning", "Named CSM + SRE"],
    },
    {
      icon: Smile,
      title: "Dental Groups",
      copy: "Tooth-numbered charting, perio scoring, treatment plans and dental-specific billing codes baked in.",
      bullets: ["Perio + restorative charting", "Treatment plan signoff", "ADA codes"],
    },
    {
      icon: Sparkles,
      title: "Aesthetic Centers",
      copy: "Before/after photo timelines, package memberships, gift cards and a beautiful booking experience.",
      bullets: ["Photo timelines", "Memberships & deposits", "Online booking"],
    },
    {
      icon: Activity,
      title: "Diagnostic Labs",
      copy: "Order management, sample tracking, results routing and HL7 integration with reference labs.",
      bullets: ["Order → result tracking", "Auto-routing reports", "Reference lab connectors"],
    },
  ];
  return (
    <section className="relative bg-white py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sols.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="group relative overflow-hidden rounded-2xl border border-zinc-950/5 bg-zinc-50 p-7 transition-all hover:border-brand/30 hover:bg-white"
            >
              <div className="absolute -right-12 -top-12 size-32 rounded-full bg-brand/5 blur-2xl opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative">
                <div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-light text-white">
                  <s.icon className="size-5" />
                </div>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">{s.copy}</p>
                <ul className="mt-4 space-y-1.5">
                  {s.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-2 text-xs text-zinc-700">
                      <Check className="size-3.5 text-brand" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
