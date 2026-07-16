import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { CTA, BuiltForSection } from "@/components/site/sections";
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
  {
    icon: Target,
    title: "Results-Driven",
    desc: "We focus on tangible outcomes — helping your business book more, grow faster, and operate smoothly.",
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
  { icon: ShieldCheck, text: "Ensure data privacy with enterprise-grade security" },
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
        <div className="relative mx-auto max-w-4xl px-6 pt-24 pb-8 text-center">
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


      {/* Mission */}
      <section className="mx-auto max-w-5xl px-6 pt-8 pb-16">
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
      <section className="relative py-24 overflow-hidden bg-slate-50">
        {/* Background Accents */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
        <div className="absolute top-0 right-0 -mr-40 -mt-40 w-96 h-96 rounded-full bg-[#0059C6]/5 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-40 -mb-40 w-96 h-96 rounded-full bg-[#0D83FF]/5 blur-3xl pointer-events-none" />

        <div className="relative mx-auto max-w-5xl px-6">
          <div className="text-center mb-16">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
              className="inline-flex items-center justify-center rounded-full px-4 py-1.5 mb-6 shadow-sm border border-[#0059C6]/20 bg-white"
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-[#0059C6]">What We Do</p>
            </motion.div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-zinc-900">
              All from one simple and <br className="hidden md:block" />
              <span className="text-gradient-brand">powerful dashboard</span>
            </h2>
          </div>
          
          <div className="grid md:grid-cols-2 gap-3 lg:gap-4">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.text}
                  initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05, ease: "easeOut" }}
                  className="group relative flex items-center gap-4 rounded-2xl bg-white border border-zinc-100 px-5 py-4 transition-colors duration-300 hover:border-zinc-200 hover:bg-zinc-50/50"
                >
                  <div className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50 border border-zinc-100 transition-colors duration-300 group-hover:bg-[#0059C6]/10 group-hover:border-[#0059C6]/20">
                    <Icon className="size-4 text-zinc-500 transition-colors duration-300 group-hover:text-[#0059C6]" strokeWidth={2} />
                  </div>
                  <span className="relative z-10 text-sm font-medium text-zinc-700 transition-colors duration-300 group-hover:text-zinc-900">{f.text}</span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>
      {/* Premium Built For Section */}
      <BuiltForSection />



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
          <p className="mt-8 text-xs font-medium uppercase tracking-widest text-zinc-400">
            BookMyTime is a product of Brightwave Digital Products LLP.
          </p>
        </motion.div>
      </section>

    </SiteShell>
  );
}
