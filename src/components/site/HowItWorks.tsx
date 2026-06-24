import { motion } from "motion/react";
import {
  UserPlus,
  Link2,
  Share2,
  CalendarCheck,
  BellRing,
  LayoutDashboard,
} from "lucide-react";

const steps = [
  {
    number: "1",
    icon: UserPlus,
    title: "Create Your Account",
    description: "Sign up in minutes. No credit card required. Your business profile is ready instantly.",
  },
  {
    number: "2",
    icon: Link2,
    title: "Get Your Booking Link & QR Code",
    description: "A dedicated booking page and unique QR code are generated automatically for your business.",
  },
  {
    number: "3",
    icon: Share2,
    title: "Share Anywhere",
    description: "Post on your website, WhatsApp, Instagram, or Google Business Profile — customers find you everywhere.",
  },
  {
    number: "4",
    icon: CalendarCheck,
    title: "Customers Book Instantly",
    description: "Clients pick a time, confirm details, and secure their slot — 24/7 without any manual effort.",
  },
  {
    number: "5",
    icon: BellRing,
    title: "Automated Reminders & Updates",
    description: "WhatsApp reminders, booking confirmations, and follow-ups go out automatically — zero no-shows.",
  },
  {
    number: "6",
    icon: LayoutDashboard,
    title: "Manage Everything From One Dashboard",
    description: "View bookings, customers, staff, payments, and analytics — all from one powerful dashboard.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 bg-white overflow-hidden">
      {/* Subtle background grid */}
      <div className="pointer-events-none absolute inset-0 bg-grid bg-radial-fade opacity-30" />

      <div className="relative mx-auto max-w-7xl px-6">
        {/* Header */}
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold mb-4"
            style={{ background: "rgba(0,89,198,0.08)", color: "#0059C6", border: "1px solid rgba(0,89,198,0.15)" }}
          >
            HOW IT WORKS
          </span>
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-900 md:text-5xl">
            From Setup to{" "}
            <span className="text-gradient-brand">First Booking</span>{" "}
            in Minutes
          </h2>
          <p className="mt-4 text-zinc-500 text-base">
            Six simple steps to automate your bookings and start growing.
          </p>
        </div>

        {/* Steps grid */}
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="relative group rounded-2xl border border-zinc-200/70 bg-white p-6 hover:border-[#A7D3FF] hover:shadow-lg hover:shadow-[rgba(0,89,198,0.08)] transition-all duration-300"
              >
                {/* Step number badge */}
                <div className="absolute -top-3 -left-3 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-md"
                  style={{ background: "linear-gradient(135deg, #0059C6, #0D83FF)" }}>
                  {step.number}
                </div>

                {/* Icon */}
                <div
                  className="mb-4 w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(0,89,198,0.08)" }}
                >
                  <Icon className="size-5" style={{ color: "#0059C6" }} />
                </div>

                {/* Content */}
                <h3 className="text-sm font-bold text-zinc-900 mb-2">{step.title}</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">{step.description}</p>

                {/* Connecting arrow for non-last items in each row */}
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute -right-4 top-1/2 -translate-y-1/2 z-10 text-[#A7D3FF]">
                    {(i + 1) % 3 !== 0 && (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M4 8h8M8 4l4 4-4 4" stroke="#0059C6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
                      </svg>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
