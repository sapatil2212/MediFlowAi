import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { CTA } from "@/components/site/sections";
import {
  Sparkles,
  Globe2,
  Users,
  Lightbulb,
  ShieldCheck,
  Zap,
  Target,
  TrendingUp,
  Heart,
  Calendar,
  QrCode,
  Bell,
  BarChart3,
  Bot,
  LayoutDashboard,
  Scissors,
  HeartPulse,
  Dumbbell,
  Scale,
  Home,
  BookOpen,
  Calculator,
  Brain,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — BookMyTime" },
      {
        name: "description",
        content:
          "BookMyTime was created to help businesses spend less time managing appointments and more time serving their customers.",
      },
      { property: "og:title", content: "About BookMyTime" },
      {
        property: "og:description",
        content: "Simplifying Bookings. Empowering Businesses.",
      },
    ],
  }),
  component: AboutPage,
});

const values = [
  {
    icon: Heart,
    title: "Customer Success",
    desc: "Your growth is our success. We measure everything by the value we deliver to your business.",
  },
  {
    icon: Lightbulb,
    title: "Innovation",
    desc: "We continuously improve our platform to meet evolving business needs and stay ahead of the curve.",
  },
  {
    icon: ShieldCheck,
    title: "Reliability",
    desc: "We build dependable solutions businesses can trust every day, without exception.",
  },
  {
    icon: Zap,
    title: "Simplicity",
    desc: "Powerful technology should be easy to use. No complexity, no barriers.",
  },
  {
    icon: Globe2,
    title: "Transparency",
    desc: "Clear pricing, honest communication, and customer-focused decisions — always.",
  },
];

const whyChoose = [
  {
    icon: Sparkles,
    title: "Simplicity First",
    desc: "No complicated setup. No technical expertise required. Get started in minutes.",
  },
  {
    icon: TrendingUp,
    title: "Affordable Pricing",
    desc: "Enterprise-grade features without enterprise-level costs. Fair pricing for every business size.",
  },
  {
    icon: Zap,
    title: "Automation That Saves Time",
    desc: "Reduce manual work with automated bookings, reminders, and customer communication.",
  },
  {
    icon: Bot,
    title: "AI-Powered Assistance",
    desc: "Leverage intelligent tools to support customers and streamline operations effortlessly.",
  },
  {
    icon: Globe2,
    title: "Scalable for Growth",
    desc: "Whether you're a solo professional or a multi-location business, BookMyTime grows with you.",
  },
];

const industries = [
  { icon: Scissors, label: "Beauty & Wellness Center" },
  { icon: HeartPulse, label: "Healthcare Clinic" },
  { icon: Dumbbell, label: "Fitness Studio or Gym" },
  { icon: Scale, label: "Law Firm or Consultancy" },
  { icon: Home, label: "Real Estate Agency" },
  { icon: BookOpen, label: "Educational Institute" },
  { icon: Calculator, label: "CA or Financial Practice" },
  { icon: Brain, label: "Coaching or Wellness Business" },
];

const features = [
  { icon: Calendar, text: "Manage appointments effortlessly" },
  { icon: LayoutDashboard, text: "Create dedicated booking pages" },
  { icon: QrCode, text: "Generate unique QR codes for instant bookings" },
  { icon: Bell, text: "Automate WhatsApp notifications and reminders" },
  { icon: Users, text: "Organize customer information with a smart CRM" },
  { icon: BarChart3, text: "Track performance through business analytics" },
  { icon: Bot, text: "Use AI-powered assistants to improve customer engagement" },
];

const stats = [
  { value: "5,000+", label: "Active Businesses" },
  { value: "1.8M+", label: "Appointments Managed" },
  { value: "85%", label: "Less Manual Work" },
  { value: "98%", label: "WhatsApp Open Rate" },
];

function AboutPage() {
  return (
    <SiteShell>
      <Nav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute inset-0 bg-radial-fade" />
        <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-3xl" style={{ background: "radial-gradient(ellipse, rgba(0,89,198,0.12) 0%, transparent 70%)" }} />
        <div className="relative mx-auto max-w-4xl px-6 py-24 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold mb-5"
            style={{ background: "rgba(0,89,198,0.07)", color: "#0059C6", border: "1px solid rgba(0,89,198,0.15)" }}
          >
            <Sparkles className="h-3.5 w-3.5" /> ABOUT BOOKMYTIME
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
            className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-zinc-900 mb-5"
          >
            Simplifying Bookings.{" "}
            <span className="text-gradient-brand">Empowering Businesses.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="mx-auto max-w-2xl text-base text-zinc-600 leading-relaxed"
          >
            BookMyTime was created with a simple mission — help businesses spend less time managing appointments and more time serving their customers.
          </motion.p>
        </div>
      </section>

      {/* Stats strip */}
      <section className="mx-auto max-w-5xl px-6 -mt-4 pb-16">
        <div className="grid grid-cols-2 gap-4 rounded-3xl border border-zinc-200 bg-white p-6 sm:grid-cols-4 shadow-sm">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
              className="text-center"
            >
              <div className="text-3xl font-bold tracking-tight text-gradient-brand">{s.value}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{s.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Mission */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "#0059C6" }}>Our Story</p>
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 mb-4">Why We Built BookMyTime</h2>
            <div className="space-y-3 text-sm text-zinc-600 leading-relaxed">
              <p>We noticed that many service-based businesses still rely on phone calls, spreadsheets, diaries, and multiple disconnected tools to manage bookings, customer information, and daily operations.</p>
              <p>This often leads to missed appointments, lost opportunities, and unnecessary administrative work.</p>
              <p>That's why we built BookMyTime — an all-in-one booking and customer management platform designed to make scheduling effortless, communication seamless, and business growth scalable.</p>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
            className="rounded-3xl p-8 space-y-4"
            style={{ background: "linear-gradient(135deg, rgba(0,89,198,0.06), rgba(13,131,255,0.03))", border: "1px solid rgba(0,89,198,0.12)" }}
          >
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#0059C6" }}>Our Vision</p>
            <p className="text-lg font-semibold text-zinc-900 leading-snug">To become the most trusted booking and business management platform for service-based businesses worldwide.</p>
            <p className="text-sm text-zinc-500 leading-relaxed">We believe every business, regardless of size, should have access to powerful tools that automate repetitive tasks, improve customer experiences, and drive sustainable growth.</p>
          </motion.div>
        </div>
      </section>

      {/* What We Do */}
      <section className="relative py-16" style={{ background: "linear-gradient(135deg, rgba(0,89,198,0.04), rgba(255,255,255,1))" }}>
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-10">
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#0059C6" }}>What We Do</p>
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
              All from one simple and <span className="text-gradient-brand">powerful dashboard</span>
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.text}
                  initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 rounded-xl bg-white border border-zinc-200 px-4 py-3 shadow-sm"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(0,89,198,0.08)" }}>
                    <Icon className="size-4" style={{ color: "#0059C6" }} />
                  </div>
                  <span className="text-sm font-medium text-zinc-700">{f.text}</span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Built for Modern Businesses */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#0059C6" }}>Built For</p>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900">Modern Businesses of Every Kind</h2>
          <p className="mt-3 text-sm text-zinc-500 max-w-xl mx-auto">BookMyTime adapts to your workflow and helps you deliver a better customer experience.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {industries.map((ind, i) => {
            const Icon = ind.icon;
            return (
              <motion.div
                key={ind.label}
                initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-center hover:border-[#A7D3FF] hover:shadow-sm transition-all"
              >
                <div className="flex size-9 items-center justify-center rounded-xl" style={{ background: "rgba(0,89,198,0.08)" }}>
                  <Icon className="size-4" style={{ color: "#0059C6" }} />
                </div>
                <span className="text-xs font-medium text-zinc-700 leading-tight">{ind.label}</span>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-16 bg-zinc-950">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-10">
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#A7D3FF" }}>Why BookMyTime</p>
            <h2 className="text-3xl font-bold tracking-tight text-white">Why Businesses <span className="text-gradient-brand">Choose BookMyTime</span></h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {whyChoose.map((w, i) => {
              const Icon = w.icon;
              return (
                <motion.div
                  key={w.title}
                  initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07 }}
                  className="rounded-2xl p-5 border"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(0,89,198,0.25)" }}
                >
                  <div className="flex size-9 items-center justify-center rounded-xl mb-3" style={{ background: "rgba(0,89,198,0.2)" }}>
                    <Icon className="size-4" style={{ color: "#A7D3FF" }} />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">{w.title}</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">{w.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Core Values */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#0059C6" }}>What We Stand For</p>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900">Our Core Values</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {values.map((v, i) => {
            const Icon = v.icon;
            return (
              <motion.div
                key={v.title}
                initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}
                className="group rounded-2xl border border-zinc-200 bg-white p-5 hover:border-[#A7D3FF] hover:shadow-md transition-all"
              >
                <div className="flex size-10 items-center justify-center rounded-xl mb-3 transition-colors group-hover:scale-110 duration-200"
                  style={{ background: "rgba(0,89,198,0.08)" }}>
                  <Icon className="size-5" style={{ color: "#0059C6" }} />
                </div>
                <h3 className="font-bold text-zinc-900 mb-1">{v.title}</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">{v.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Future vision */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="rounded-3xl p-10 text-center"
          style={{ background: "linear-gradient(135deg, #0059C6 0%, #0D83FF 100%)", boxShadow: "0 20px 60px rgba(0,89,198,0.25)" }}
        >
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "rgba(167,211,255,0.8)" }}>The Future</p>
          <h2 className="text-3xl font-bold text-white mb-4">The Future of Business Management</h2>
          <p className="text-sm text-white/80 leading-relaxed max-w-2xl mx-auto mb-6">
            We're building more than a booking platform. Our goal is to create a complete ecosystem that helps businesses automate operations, strengthen customer relationships, and unlock new opportunities for growth through technology and AI.
          </p>
          <p className="text-sm text-white/70 leading-relaxed max-w-xl mx-auto">
            As businesses continue to evolve, BookMyTime will continue to innovate — providing smarter tools, deeper insights, and better ways to connect with customers.
          </p>
        </motion.div>
      </section>

      {/* CTA Bottom */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="rounded-3xl border border-zinc-200 bg-white p-10 text-center shadow-sm"
        >
          <h2 className="text-2xl font-bold text-zinc-900 mb-2">Join Thousands of Businesses Growing Smarter</h2>
          <p className="text-sm text-zinc-500 mb-6 max-w-xl mx-auto">
            From appointment scheduling and customer management to AI-powered automation, BookMyTime helps businesses save time, improve efficiency, and focus on what matters most.
          </p>
          <p className="text-sm font-semibold mb-6" style={{ color: "#0059C6" }}>Bookings Simplified. Growth Automated.</p>
          <a
            href="/signup"
            className="inline-flex items-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-[1px]"
            style={{ background: "linear-gradient(135deg, #0059C6, #0D83FF)", boxShadow: "0 4px 20px rgba(0,89,198,0.3)" }}
          >
            <Check className="size-4" /> Get Started Free
          </a>
        </motion.div>
      </section>

    </SiteShell>
  );
}
