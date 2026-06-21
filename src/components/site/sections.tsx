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
  Scissors,
  Dumbbell,
  GraduationCap,
  Scale,
  Calculator,
  Handshake,
  Leaf,
  BookOpen,
  Briefcase,
  Zap,
  MapPin,
  WifiOff,
  QrCode,
  CheckCircle2,
  Smartphone,
  CheckCheck,
  Send,
  X,
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
  const features = [
    "Dedicated Booking Link", "Unique QR Code for Every Business",
    "WhatsApp Appointment Notifications", "AI-Powered Customer Assistant",
    "Customer & Staff Management", "Smart CRM Dashboard",
    "Multi-Location Support", "Affordable Subscription Plans",
  ];

  return (
    <section
      className="relative overflow-hidden pt-16 pb-20 lg:pt-20 lg:pb-28"
      style={{ background: "linear-gradient(170deg, #EEF5FF 0%, #F5F9FF 35%, #EAF2FF 65%, #F0F6FF 100%)" }}
    >
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[900px] h-[550px] pointer-events-none z-0" style={{ background: "radial-gradient(ellipse, rgba(255,255,255,0.9) 0%, transparent 60%)" }} />
      <div className="absolute top-[60px] right-[-60px] w-[400px] h-[400px] pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(13,131,255,0.14) 0%, transparent 65%)" }} />
      <div className="absolute top-[80px] left-[-60px] w-[360px] h-[360px] pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(0,89,198,0.1) 0%, transparent 65%)" }} />

      {/* Rotating stamp */}
      <div className="absolute right-[calc(5%+8px)] top-[135px] w-24 h-24 z-10 hidden md:block select-none pointer-events-none">
        <motion.svg viewBox="0 0 96 96" className="w-24 h-24" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 18, ease: "linear" }}>
          <defs><path id="bmt-sp" d="M 48,48 m -37,0 a 37,37 0 1,1 74,0 a 37,37 0 1,1 -74,0" fill="none" /></defs>
          <text fill="#0059C6" fontSize="9" fontWeight="600" letterSpacing="1.6" fontFamily="Inter, sans-serif">
            <textPath href="#bmt-sp">BookMyTime • Automate • Grow • Book •</textPath>
          </text>
        </motion.svg>
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center shadow-[0_4px_14px_rgba(0,89,198,0.4)]"
          style={{ background: "linear-gradient(135deg, #0059C6, #00246D)" }}
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 18, ease: "linear" }}
        >
          <Sparkles className="size-[15px] text-white" />
        </motion.div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">

          {/* Left */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/90 border border-[#0059C6]/20 text-xs font-semibold text-[#0059C6] mb-7 shadow-[0_2px_10px_rgba(0,89,198,0.08)] backdrop-blur-md"
            >
              <Zap className="size-3 text-[#0059C6]" /> Trusted by Growing Businesses Across Multiple Industries
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="text-4xl md:text-5xl lg:text-[52px] font-semibold leading-[1.12] tracking-tight text-[#0F172A] mb-5"
            >
              One Platform to Manage{" "}
              <span className="text-gradient-brand">Bookings, Customers</span>{" "}
              & Business Growth
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="text-sm md:text-base text-[#64748B] leading-relaxed max-w-[540px] mb-6 font-normal"
            >
              Automate bookings, manage customers, send WhatsApp reminders, and grow your business with AI-powered tools.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="flex flex-wrap items-center gap-3 mb-6"
            >
              <Link to="/signup" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:-translate-y-[1px]"
                style={{ background: "linear-gradient(135deg, #0059C6, #0D83FF)", boxShadow: "0 2px 12px rgba(0,89,198,0.35)" }}
              >
                <Sparkles className="size-4" /> Get Started Free
              </Link>
              <Link to="/demo" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all hover:-translate-y-[1px] bg-white border hover:border-[#0059C6] hover:text-[#0059C6]"
                style={{ borderColor: "rgba(0,89,198,0.2)", color: "#0F172A", boxShadow: "0 2px 10px rgba(0,89,198,0.08)" }}
              >
                <CalendarDays className="size-4" /> Book a Demo
              </Link>
            </motion.div>
          </div>

          {/* Right: Dashboard mockup */}
          <motion.div
            initial={{ opacity: 0, x: 30, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.7 }}
            className="relative"
          >
            <motion.div
              className="absolute -left-6 bottom-12 bg-white rounded-xl shadow-[0_8px_28px_rgba(0,0,0,0.12)] p-3 border border-[#A7D3FF]/60 min-w-[155px] z-20 hidden md:block"
              animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
            >
              <div className="flex items-center gap-0.5 mb-1">
                {[...Array(5)].map((_, i) => <Star key={i} className="size-[11px] fill-[#F59E0B] stroke-[#F59E0B]" />)}
                <span className="text-[10px] font-bold text-[#0F172A] ml-1">4.9</span>
              </div>
              <div className="text-[11px] font-bold text-[#0F172A] mb-1.5">from verified customers</div>
              <div className="flex -space-x-1.5">
                {["BS","RK","AP","SM"].map((init, i) => (
                  <div key={i} className="w-5 h-5 rounded-full border border-white text-[7px] font-bold text-white flex items-center justify-center" style={{ background: ["#0059C6","#0D83FF","#00246D","#A7D3FF"][i], color: i === 3 ? "#00246D" : "white" }}>{init}</div>
                ))}
              </div>
            </motion.div>

            <motion.div
              className="absolute -right-4 top-10 bg-white rounded-xl shadow-[0_8px_28px_rgba(0,0,0,0.12)] p-3 border border-[#A7D3FF]/60 flex items-center gap-2.5 z-20 hidden md:flex"
              animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: 1.5 }}
            >
              <div className="w-[34px] h-[34px] rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #0D83FF, #0059C6)" }}>
                <Check className="size-[17px] text-white stroke-[3px]" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[#0F172A] leading-tight">5,000+ Businesses</div>
                <div className="text-[9px] text-[#64748B] mt-0.5">Across India</div>
              </div>
            </motion.div>

            <div className="rounded-3xl border border-white bg-white/80 p-2 shadow-[0_-4px_60px_rgba(0,89,198,0.1),0_24px_80px_rgba(0,0,0,0.07)] backdrop-blur-xl ring-1 ring-[#0059C6]/10 overflow-hidden">
              <div className="bg-white rounded-2xl overflow-hidden border border-zinc-100">
                <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: "#00246D" }}>
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  </div>
                  <span className="text-[10px] text-[#A7D3FF] ml-2">BookMyTime — Smart Booking Dashboard</span>
                </div>
                <div className="p-4 space-y-3 bg-zinc-50">
                  <div className="text-center pb-2 border-b border-zinc-100">
                    <p className="text-[11px] font-bold text-zinc-800">Smart Booking Management for Every Business</p>
                    <p className="text-[9px] text-zinc-400 mt-0.5">Manage appointments, customers, staff, payments, reminders, and communication from one powerful dashboard.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Today's Bookings", value: "24", icon: Calendar, bg: "#EEF5FF", color: "#0059C6" },
                      { label: "Active Customers", value: "1,248", icon: Users, bg: "#FEF3C7", color: "#D97706" },
                      { label: "This Month", value: "₹84,200", icon: TrendingUp, bg: "#ECFDF5", color: "#059669" },
                      { label: "Completion Rate", value: "96%", icon: Check, bg: "#EEF2FF", color: "#4F46E5" },
                    ].map((s, i) => {
                      const Icon = s.icon;
                      return (
                        <div key={i} className="bg-white rounded-xl border border-zinc-200 p-2.5 flex items-center gap-2">
                          <div className="p-1.5 rounded-lg" style={{ background: s.bg }}>
                            <Icon className="h-3 w-3" style={{ color: s.color }} />
                          </div>
                          <div>
                            <p className="text-[9px] text-zinc-400">{s.label}</p>
                            <p className="text-xs font-bold text-zinc-900">{s.value}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="bg-white rounded-xl border border-zinc-200 p-3">
                    <p className="text-[9px] font-bold uppercase tracking-wider mb-2" style={{ color: "#0059C6" }}>Platform Features</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {features.map((f) => (
                        <div key={f} className="flex items-center gap-1">
                          <Check className="h-2.5 w-2.5 shrink-0" style={{ color: "#0059C6" }} />
                          <span className="text-[8.5px] text-zinc-600 font-medium">{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-center text-[9px] text-zinc-400 italic pb-1">
                    Built for businesses that want enterprise-level booking automation without enterprise-level costs.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * LOGOS MARQUEE
 * ======================================================= */
export function LogosMarquee() {
  const logos = [
    { icon: Scissors, label: "Beauty Studios" },
    { icon: HeartPulse, label: "Healthcare Clinics" },
    { icon: Dumbbell, label: "Fitness Centers" },
    { icon: Scale, label: "Law Firms" },
    { icon: Calculator, label: "CA Offices" },
    { icon: Handshake, label: "Consultants" },
    { icon: GraduationCap, label: "Coaching Institutes" },
    { icon: Building2, label: "Real Estate Agencies" },
    { icon: Stethoscope, label: "Dental Clinics" },
    { icon: Leaf, label: "Wellness Centers" },
    { icon: BookOpen, label: "Training Academies" },
    { icon: Briefcase, label: "Professional Services" },
  ];
  return (
    <section className="relative border-y border-zinc-950/5 bg-white py-10">
      <div className="mx-auto mb-6 max-w-7xl px-6 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          TRUSTED BY BUSINESSES ACROSS MULTIPLE INDUSTRIES
        </p>
      </div>
      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
        <div className="flex w-max animate-marquee gap-10 pr-10">
          {[...logos, ...logos].map((l, i) => {
            const Icon = l.icon;
            return (
              <div key={i} className="flex items-center gap-2 text-zinc-500 transition-colors hover:text-brand whitespace-nowrap">
                <Icon className="size-4 shrink-0" />
                <span className="text-sm font-semibold tracking-tight">{l.label}</span>
              </div>
            );
          })}
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
    { v: 85, suf: "%", label: "Reduction in Manual Booking Work", sub: "Average across all industries" },
    { v: 25, suf: "h", label: "Saved Every Week", sub: "Through automation & reminders" },
    { v: 5000, suf: "+", label: "Active Businesses", sub: "Using BookMyTime daily" },
    { v: 1.8, suf: "M+", label: "Appointments Managed", sub: "Across multiple industries" },
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
    "Missed calls turning into lost bookings",
    "Manual appointment tracking in spreadsheets",
    "Customers forgetting appointments",
    "No dedicated booking system",
    "Managing customers across multiple tools",
    "No centralized CRM or customer history",
    "Staff spending hours on repetitive tasks",
    "No automation for reminders and follow-ups",
  ];
  const after = [
    "Dedicated booking page and QR code",
    "Online appointment booking 24/7",
    "Automated WhatsApp reminders & updates",
    "Smart customer and staff management",
    "AI-powered chatbot for instant responses",
    "Centralized CRM for all customer interactions",
    "Real-time booking and business insights",
    "One platform, one dashboard, complete control",
  ];
  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 text-center">
          <SectionEyebrow>THE DIFFERENCE</SectionEyebrow>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Stop managing bookings{" "}
            <span className="relative inline-block">
              <span className="text-zinc-400">manually</span>
              <motion.svg
                viewBox="0 0 120 20"
                className="absolute left-0 w-full overflow-visible pointer-events-none"
                style={{ top: "45%", transform: "translateY(-50%)" }}
              >
                <motion.path
                  d="M 0 18 L 120 2"
                  stroke="#ef4444"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  initial={{ pathLength: 0, opacity: 0 }}
                  whileInView={{ pathLength: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.3 }}
                />
              </motion.svg>
            </span>.
            <br />
            Start growing your business <span className="text-gradient-brand">smarter</span>.
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
              Without BookMyTime
            </p>
            <h3 className="mb-6 text-xl font-semibold text-zinc-900">The Daily Struggle</h3>
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
                  <span className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-500 text-[10px] font-bold">✕</span>
                  <span>{b}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative overflow-hidden rounded-2xl border p-8 ring-1"
            style={{ borderColor: "rgba(0,89,198,0.2)", background: "linear-gradient(135deg, rgba(0,89,198,0.04) 0%, #ffffff 50%, rgba(167,211,255,0.15) 100%)", boxShadow: "0 0 0 1px rgba(0,89,198,0.1)" }}
          >
            <div className="absolute -right-20 -top-20 size-64 rounded-full blur-3xl" style={{ background: "rgba(13,131,255,0.08)" }} />
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "#0059C6" }}>
              With BookMyTime
            </p>
            <h3 className="mb-6 text-xl font-semibold text-zinc-900">The Smart Advantage</h3>
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
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-white" style={{ background: "#0059C6" }}>
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
 * QR CODE BOOKING SHOWCASE
 * ======================================================= */
export function QRShowcase() {
  const points = [
    { icon: MapPin, text: "Place your QR anywhere" },
    { icon: Smartphone, text: "Customers scan and book instantly" },
    { icon: WifiOff, text: "No app download required" },
    { icon: Clock, text: "Available 24/7" },
  ];

  return (
    <section className="relative overflow-hidden py-20 bg-zinc-950">
      {/* Subtle dot grid */}
      <div className="pointer-events-none absolute inset-0 opacity-10"
        style={{ backgroundImage: "radial-gradient(rgba(167,211,255,0.6) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
      {/* Top glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full blur-3xl"
        style={{ background: "radial-gradient(ellipse, rgba(0,89,198,0.3) 0%, transparent 70%)" }} />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">

          {/* ── Left: content ── */}
          <div>
            <motion.span
              initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold tracking-widest mb-5"
              style={{ background: "rgba(167,211,255,0.1)", color: "#A7D3FF", border: "1px solid rgba(167,211,255,0.2)" }}
            >
              <QrCode className="size-3" /> QR CODE BOOKING
            </motion.span>

            <motion.h2
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.05 }}
              className="text-3xl md:text-4xl font-bold leading-tight tracking-tight text-white mb-4"
            >
              Turn Every{" "}
              <span className="relative inline-block">
                <span className="text-gradient-brand">Walk-In</span>
                <motion.svg viewBox="0 0 100 8" className="absolute -bottom-1 left-0 w-full" preserveAspectRatio="none">
                  <motion.path d="M 0 6 Q 50 0 100 6" stroke="#0D83FF" strokeWidth="2" strokeLinecap="round" fill="none"
                    initial={{ pathLength: 0, opacity: 0 }} whileInView={{ pathLength: 1, opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.4 }} />
                </motion.svg>
              </span>{" "}
              <span className="text-gradient-brand">Into a Future Customer</span>
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
              className="text-sm leading-relaxed mb-8" style={{ color: "rgba(167,211,255,0.75)" }}
            >
              One QR code. Infinite bookings. Print it, share it, pin it — and let customers schedule themselves while you focus on serving them.
            </motion.p>

            <ul className="space-y-3 mb-8">
              {points.map((p, i) => {
                const Icon = p.icon;
                return (
                  <motion.li
                    key={p.text}
                    initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.12 + i * 0.07 }}
                    className="flex items-center gap-3"
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: "rgba(167,211,255,0.12)", border: "1px solid rgba(167,211,255,0.2)" }}>
                      <Icon className="size-3.5" style={{ color: "#A7D3FF" }} />
                    </div>
                    <span className="text-sm text-white/90">{p.text}</span>
                  </motion.li>
                );
              })}
            </ul>

            <motion.a
              href="/signup"
              initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.45 }}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all hover:-translate-y-[1px]"
              style={{ background: "linear-gradient(135deg, #0059C6, #0D83FF)", color: "#ffffff", boxShadow: "0 4px 24px rgba(0,89,198,0.4)" }}
            >
              <QrCode className="size-4" /> Get Your Free QR Code
            </motion.a>
          </div>

          {/* ── Right: QR code card ── */}
          <div className="flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }}
              className="relative"
            >
              {/* Outer glow */}
              <motion.div
                className="absolute -inset-4 rounded-3xl blur-2xl"
                style={{ background: "rgba(13,131,255,0.2)" }}
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
              />

              {/* Card */}
              <div className="relative rounded-3xl p-7 shadow-2xl overflow-hidden"
                style={{ background: "linear-gradient(135deg, #0a0f1e 0%, #0d1a3a 50%, #0a1628 100%)", boxShadow: "0 25px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,89,198,0.3)" }}>
                {/* Subtle circuit grid overlay */}
                <div className="pointer-events-none absolute inset-0 opacity-10"
                  style={{ backgroundImage: "radial-gradient(rgba(13,131,255,0.8) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
                {/* Blue glow top-right */}
                <div className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full blur-2xl" style={{ background: "rgba(13,131,255,0.2)" }} />
                {/* Header */}
                <div className="relative flex items-center justify-between mb-5">
                  <div>
                    <p className="text-xs font-bold text-white leading-none">BookMyTime</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "rgba(167,211,255,0.7)" }}>Scan to book instantly</p>
                  </div>
                  <div className="flex size-8 items-center justify-center rounded-lg" style={{ background: "#0059C6" }}>
                    <QrCode className="size-4 text-white" />
                  </div>
                </div>

                {/* QR pattern — proper 21x21 matrix */}
                <div className="relative mx-auto">
                  {(() => {
                    const M = 9, Q = 6, color = "#A7D3FF";
                    const matrix = [
                      [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
                      [1,0,0,0,0,0,1,0,0,1,0,1,0,0,1,0,0,0,0,0,1],
                      [1,0,1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,0,1],
                      [1,0,1,1,1,0,1,0,0,1,0,1,0,0,1,0,1,1,1,0,1],
                      [1,0,1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,0,1],
                      [1,0,0,0,0,0,1,0,0,0,0,1,0,0,1,0,0,0,0,0,1],
                      [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
                      [0,0,0,0,0,0,0,0,1,1,0,1,0,1,0,0,0,0,0,0,0],
                      [1,1,0,1,1,0,1,1,0,0,1,0,1,0,1,0,1,1,0,1,1],
                      [0,1,0,0,1,0,0,1,1,0,0,1,0,1,0,0,1,0,1,1,0],
                      [1,0,1,1,0,1,1,0,0,1,1,0,1,1,0,1,0,0,1,0,1],
                      [0,1,1,0,1,0,0,1,0,1,0,1,0,0,1,0,1,1,0,1,0],
                      [1,0,0,1,0,1,1,0,1,0,1,0,1,1,0,0,1,0,1,0,1],
                      [0,0,0,0,0,0,0,0,1,0,0,1,0,0,0,1,0,1,1,0,0],
                      [1,1,1,1,1,1,1,0,0,1,1,0,1,0,1,0,1,0,0,1,0],
                      [1,0,0,0,0,0,1,0,1,0,0,1,0,1,0,1,0,0,1,0,1],
                      [1,0,1,1,1,0,1,1,0,1,1,0,1,0,0,0,1,0,0,1,0],
                      [1,0,1,1,1,0,1,0,0,1,0,1,1,1,0,1,0,1,0,0,1],
                      [1,0,1,1,1,0,1,0,1,0,1,0,0,0,1,0,1,0,1,1,0],
                      [1,0,0,0,0,0,1,0,0,1,0,1,0,1,0,1,0,0,0,1,0],
                      [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,0,0,1,1,0,1],
                    ] as const;
                    const els: React.ReactElement[] = [];
                    (matrix as readonly (readonly number[])[]).forEach((row, r) => {
                      row.forEach((cell, c) => {
                        if (!cell) return;
                        const inFinder =
                          (r < 7 && c < 7) ||
                          (r < 7 && c > 13) ||
                          (r > 13 && c < 7);
                        els.push(
                          <rect
                            key={`${r}-${c}`}
                            x={Q + c * M + 0.5}
                            y={Q + r * M + 0.5}
                            width={M - 1}
                            height={M - 1}
                            rx={inFinder ? 0 : 2}
                            fill={color}
                          />
                        );
                      });
                    });
                    return (
                      <svg viewBox={`0 0 ${Q*2+21*M} ${Q*2+21*M}`} className="w-64 h-64" xmlns="http://www.w3.org/2000/svg">
                        <rect width={Q*2+21*M} height={Q*2+21*M} fill="#0d1a3a"/>
                        {els}
                      </svg>
                    );
                  })()}
                  {/* Scan laser */}
                  <motion.div
                    className="absolute left-1 right-1 h-[2px] rounded-full pointer-events-none"
                    style={{ background: "linear-gradient(90deg, transparent, #0D83FF 30%, #0D83FF 70%, transparent)", boxShadow: "0 0 8px 2px rgba(13,131,255,0.55)" }}
                    animate={{ top: ["4%", "93%", "4%"] }}
                    transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
                  />
                </div>

              </div>
            </motion.div>
          </div>

        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * WHATSAPP AUTOMATION
 * ======================================================= */
export function WhatsAppSection() {
  const messages = [
    {
      type: "out" as const,
      icon: CheckCircle2,
      label: "Booking Confirmation",
      text: "Your appointment is confirmed for Tomorrow at 10:00 AM. See you soon! 🎉",
      time: "9:42 AM",
      color: "#25D366",
    },
    {
      type: "out" as const,
      icon: Bell,
      label: "Appointment Reminder",
      text: "Reminder: You have an appointment in 1 hour. Please arrive 5 minutes early. ⏰",
      time: "9:00 AM",
      color: "#0059C6",
    },
    {
      type: "out" as const,
      icon: RefreshCcw,
      label: "Reschedule Notification",
      text: "Your appointment has been rescheduled to Friday at 3:00 PM. Need help? Reply here.",
      time: "Yesterday",
      color: "#F59E0B",
    },
    {
      type: "out" as const,
      icon: MessageSquare,
      label: "Follow-up Message",
      text: "How was your experience? We'd love your feedback! ⭐ Reply to rate us.",
      time: "Mon",
      color: "#8B5CF6",
    },
    {
      type: "out" as const,
      icon: Star,
      label: "Promotional Campaign",
      text: "🎁 Exclusive offer for you: Book this week and get 20% off your next visit!",
      time: "Sun",
      color: "#EC4899",
    },
  ];

  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setActive(p => (p + 1) % messages.length), 2800);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="relative py-14 bg-white overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid bg-radial-fade opacity-20" />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid lg:grid-cols-2 items-center">

          {/* ── Left: Phone mockup ── */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="flex justify-center lg:justify-end lg:pr-0"
          >
            <div className="relative">
              <div className="absolute inset-0 rounded-[3rem] blur-3xl scale-90"
                style={{ background: "radial-gradient(circle, rgba(37,211,102,0.12) 0%, rgba(0,89,198,0.08) 60%, transparent 100%)" }} />
              <div className="relative w-60 rounded-[2rem] border-[5px] border-zinc-900 bg-zinc-900 shadow-2xl overflow-hidden">
                {/* Status bar */}
                <div className="bg-zinc-900 px-4 pt-2.5 pb-1 flex justify-between items-center">
                  <span className="text-[8px] text-white font-bold">9:41</span>
                  <div className="w-7 h-2 rounded-full bg-black border border-zinc-700" />
                  <div className="w-2.5 h-1.5 rounded-sm bg-white opacity-70" />
                </div>
                {/* WhatsApp header */}
                <div className="flex items-center gap-2 px-2.5 py-2" style={{ background: "#075E54" }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-black shrink-0"
                    style={{ background: "linear-gradient(135deg, #25D366, #128C7E)" }}>B</div>
                  <div>
                    <p className="text-[10px] font-bold text-white leading-none">BookMyTime</p>
                    <p className="text-[8px]" style={{ color: "#A8E6B0" }}>Business · Online</p>
                  </div>
                </div>
                {/* Chat area */}
                <div className="px-2.5 py-2.5 space-y-2 min-h-[320px]" style={{ background: "#E5DDD5" }}>
                  <p className="text-center text-[7px] text-zinc-500 bg-white/60 rounded-full px-2 py-0.5 w-fit mx-auto">Today</p>
                  <AnimatePresence mode="wait">
                    {messages.map((msg, i) =>
                      i === active ? (
                        <motion.div key={msg.label}
                          initial={{ opacity: 0, y: 10, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6, scale: 0.97 }}
                          transition={{ duration: 0.3 }}
                          className="flex justify-end"
                        >
                          <div className="max-w-[88%] rounded-xl rounded-tr-sm px-2.5 py-1.5 shadow-sm" style={{ background: "#DCF8C6" }}>
                            <p className="text-[7px] font-bold mb-0.5" style={{ color: msg.color }}>{msg.label}</p>
                            <p className="text-[8px] text-zinc-800 leading-relaxed">{msg.text}</p>
                            <div className="flex items-center justify-end gap-1 mt-0.5">
                              <span className="text-[6px] text-zinc-400">{msg.time}</span>
                              <CheckCheck className="size-2" style={{ color: "#4FC3F7" }} />
                            </div>
                          </div>
                        </motion.div>
                      ) : null
                    )}
                  </AnimatePresence>
                  <div className="flex justify-start">
                    <div className="bg-white rounded-xl rounded-tl-sm px-2 py-1.5 shadow-sm flex items-center gap-1">
                      {[0,1,2].map(i => (
                        <motion.div key={i} className="w-1 h-1 rounded-full bg-zinc-400"
                          animate={{ y: [0, -3, 0] }}
                          transition={{ repeat: Infinity, duration: 0.7, delay: i * 0.15 }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                {/* Input bar */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5" style={{ background: "#F0F0F0" }}>
                  <div className="flex-1 bg-white rounded-full px-2.5 py-1 text-[8px] text-zinc-400">Type a message</div>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "#25D366" }}>
                    <Send className="size-2.5 text-white" />
                  </div>
                </div>
              </div>
              {/* Floating open rate */}
              <motion.div
                className="absolute -right-4 top-12 bg-white rounded-lg shadow-lg px-2.5 py-1.5 border border-zinc-100"
                animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
              >
                <p className="text-[8px] text-zinc-400">Open Rate</p>
                <p className="text-base font-black leading-none" style={{ color: "#25D366" }}>98%</p>
                <p className="text-[7px] text-zinc-400">vs 22% email</p>
              </motion.div>
              {/* Floating auto-sent */}
              <motion.div
                className="absolute -left-4 bottom-16 bg-white rounded-lg shadow-lg px-2.5 py-1.5 border border-zinc-100 flex items-center gap-1.5"
                animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut", delay: 1 }}
              >
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(37,211,102,0.15)" }}>
                  <Send className="size-2.5" style={{ color: "#25D366" }} />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-zinc-900 leading-none">Auto-sent</p>
                  <p className="text-[7px] text-zinc-400">Zero manual work</p>
                </div>
              </motion.div>
            </div>
          </motion.div>

          {/* ── Right: Content ── */}
          <div className="lg:pl-10">
            <motion.span
              initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold mb-3 border"
              style={{ background: "rgba(37,211,102,0.08)", color: "#128C7E", borderColor: "rgba(37,211,102,0.2)" }}
            >
              <MessageSquare className="size-2.5" /> WHATSAPP AUTOMATION
            </motion.span>

            <motion.h2
              initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.05 }}
              className="text-2xl md:text-3xl font-semibold leading-tight tracking-tight text-zinc-900 mb-2"
            >
              Never Let Customers{" "}
              <span className="text-gradient-brand">Forget Their Appointments</span>
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
              className="text-xs text-zinc-500 leading-relaxed mb-5"
            >
              BookMyTime sends automated WhatsApp messages at every stage — so you never follow up manually again.
            </motion.p>

            {/* Feature list */}
            <div className="space-y-1.5">
              {messages.map((msg, i) => {
                const Icon = msg.icon;
                const isActive = i === active;
                return (
                  <motion.button
                    key={msg.label}
                    type="button"
                    onClick={() => setActive(i)}
                    initial={{ opacity: 0, x: 16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.08 + i * 0.06 }}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 cursor-pointer"
                    style={{
                      background: isActive ? "rgba(0,89,198,0.06)" : "transparent",
                      border: isActive ? "1px solid rgba(0,89,198,0.2)" : "1px solid transparent",
                    }}
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: `${msg.color}18` }}>
                      <Icon className="size-3.5" style={{ color: msg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-900 leading-tight">{msg.label}</p>
                      <p className="text-[10px] text-zinc-400 truncate mt-0.5">{msg.text}</p>
                    </div>
                    <motion.div
                      animate={{ scale: isActive ? 1 : 0 }}
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "#0059C6" }}
                    />
                  </motion.button>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

/* =========================================================
 * BEFORE VS AFTER
 * ======================================================= */
export function BeforeAfter() {
  const before = [
    "Missed calls",
    "Manual diary",
    "No reminders",
    "Lost customers",
    "Scattered customer data",
  ];
  const after = [
    "Online booking",
    "Automated reminders",
    "Centralized CRM",
    "Better customer retention",
    "More bookings",
  ];

  return (
    <section className="relative py-20 bg-white overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid bg-radial-fade opacity-20" />

      <div className="relative mx-auto max-w-5xl px-6">
        {/* Header */}
        <div className="text-center mb-12">
          <motion.span
            initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold tracking-widest mb-4"
            style={{ background: "rgba(0,89,198,0.07)", color: "#0059C6", border: "1px solid rgba(0,89,198,0.15)" }}
          >
            BEFORE VS AFTER
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.05 }}
            className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900"
          >
            See the <span className="text-gradient-brand">difference BookMyTime makes</span>
          </motion.h2>
        </div>

        {/* Cards */}
        <div className="grid md:grid-cols-2 gap-5">

          {/* Before */}
          <motion.div
            initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="rounded-2xl border border-red-100 bg-red-50/40 p-6"
          >
            <div className="flex items-center gap-2 mb-5">
              <div className="flex size-7 items-center justify-center rounded-lg bg-red-100">
                <X className="size-3.5 text-red-500" />
              </div>
              <h3 className="text-sm font-bold text-zinc-900">Before BookMyTime</h3>
            </div>
            <ul className="space-y-3">
              {before.map((item, i) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}
                  className="flex items-center gap-3 text-sm text-zinc-600"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-500 text-[10px] font-bold">✕</span>
                  {item}
                </motion.li>
              ))}
            </ul>
          </motion.div>

          {/* After */}
          <motion.div
            initial={{ opacity: 0, x: 24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-2xl p-6 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(0,89,198,0.06) 0%, rgba(13,131,255,0.04) 100%)", border: "1px solid rgba(0,89,198,0.15)" }}
          >
            <div className="pointer-events-none absolute -top-8 -right-8 w-32 h-32 rounded-full blur-2xl" style={{ background: "rgba(13,131,255,0.1)" }} />
            <div className="flex items-center gap-2 mb-5">
              <div className="flex size-7 items-center justify-center rounded-lg" style={{ background: "rgba(0,89,198,0.1)" }}>
                <Check className="size-3.5" style={{ color: "#0059C6" }} />
              </div>
              <h3 className="text-sm font-bold text-zinc-900">After BookMyTime</h3>
            </div>
            <ul className="space-y-3">
              {after.map((item, i) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: 12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 + i * 0.06 }}
                  className="flex items-center gap-3 text-sm text-zinc-700"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-white text-[10px]"
                    style={{ background: "linear-gradient(135deg, #0059C6, #0D83FF)" }}>✓</span>
                  <span className="font-medium">{item}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>

        </div>

        {/* Bottom arrow connector */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }} whileInView={{ opacity: 1, scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3 }}
          className="hidden md:flex items-center justify-center mt-6 gap-3"
        >
          <div className="h-px flex-1 max-w-[160px]" style={{ background: "linear-gradient(90deg, transparent, #ef4444)" }} />
          <div className="flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #0059C6, #0D83FF)" }}>
            <ArrowRight className="size-3.5" /> Switch to BookMyTime
          </div>
          <div className="h-px flex-1 max-w-[160px]" style={{ background: "linear-gradient(90deg, #0059C6, transparent)" }} />
        </motion.div>
      </div>
    </section>
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
                      name="With BookMyTime"
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
        "I haven't written a SOAP note in 4 months. BookMyTime's AI scribe captures everything during the visit. I see two more patients a day and I'm home for dinner with my family.",
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
        "We rolled out BookMyTime across 14 clinics in 9 days. No-shows dropped from 11% to 3.1% within the first month. The onboarding team was exceptional.",
      stat: "-58% no-show rate",
    },
    {
      img: team,
      name: "Dr. Marcus Webb",
      role: "Chief Medical Officer · NovaCare Health",
      source: "via Google Reviews",
      quote:
        "It feels like having an extra resident on the team — one who never sleeps. BookMyTime listens, drafts, codes and learns your style within weeks of going live.",
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
      q: "Is BookMyTime HIPAA compliant?",
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
          Join 4,200+ practices using BookMyTime to see more patients, write zero notes, and run
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
