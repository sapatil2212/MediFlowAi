import { createFileRoute } from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import { useState, useMemo } from "react";
import {
  ArrowRight,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  HelpCircle,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { PageHeader } from "@/components/site/sections";
import { createDemoAppointmentServerFn } from "@/lib/demo";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact & Book a Demo - BookMyTime" },
      {
        name: "description",
        content:
          "Book a personalized product demo, speak with our workflow specialists, and discover how BookMyTime streamlines your business operations.",
      },
      { property: "og:title", content: "Contact BookMyTime & Book a Demo" },
      {
        property: "og:description",
        content: "Speak with a workflow specialist and schedule your live demo walkthrough.",
      },
    ],
  }),
  component: ContactPage,
});

type ContactFormState = {
  name: string;
  email: string;
  phone: string;
  organization: string;
  city: string;
  businessType: string;
  teamSize: string;
  preferredDate: string;
  preferredTime: string;
  preferredMode: string;
  message: string;
};

const defaultForm: ContactFormState = {
  name: "",
  email: "",
  phone: "",
  organization: "",
  city: "",
  businessType: "Clinic / Hospital",
  teamSize: "1-5 staff",
  preferredDate: "",
  preferredTime: "",
  preferredMode: "Google Meet",
  message: "",
};

const DEMO_MODES = [
  { id: "Google Meet", label: "Google Meet", icon: Video, desc: "Screen share & live demo" },
  { id: "Phone call", label: "Phone Call", icon: Phone, desc: "Quick voice discussion" },
  { id: "WhatsApp call", label: "WhatsApp", icon: MessageCircle, desc: "Chat or voice call" },
  { id: "In-person discussion", label: "In-Person", icon: Building2, desc: "Office / Clinic visit" },
];

const FAQS = [
  {
    q: "Is the product demo completely free?",
    a: "Yes, 100% free with zero commitment or payment details required. We want to understand your workflow and see if BookMyTime is the right fit.",
  },
  {
    q: "Can I invite other team members to the demo?",
    a: "Absolutely! We will send a calendar invite link that you can forward to your doctors, receptionists, partners, or IT administrators.",
  },
  {
    q: "How long is the demo session?",
    a: "Sessions typically take 20 to 30 minutes. We focus straight on your specific business requirements and live Q&A rather than a generic slide deck.",
  },
  {
    q: "How quickly can we go live after the demo?",
    a: "Most businesses and clinics go live within 24 to 48 hours. Our team assists with WhatsApp API setup, service catalog configuration, and staff training.",
  },
];

function ContactPage() {
  return (
    <SiteShell>
      <Nav />
      <PageHeader
        eyebrow="SCHEDULE A LIVE WALKTHROUGH"
        title="Let's give your business"
        highlight="its time back"
        subtitle="Share your workflow requirements and pick a slot that suits you. We will confirm your demo and send a customized onboarding preview."
      />

      <section className="relative overflow-hidden bg-gradient-to-b from-zinc-50/50 via-white to-zinc-50/30 py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
            {/* Left Column: Direct channels & what to expect */}
            <aside className="space-y-5 lg:col-span-5">
              {/* Direct channels */}
              <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Direct Reach &amp; Support
                  </h3>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Online &bull; &lt; 15 min reply
                  </span>
                </div>

                <div className="mt-4 space-y-2.5">
                  <a
                    href="https://wa.me/919168081355?text=Hi%20BookMyTime%20team,%20I'd%20like%20to%20schedule%20a%20product%20demo%20and%20know%20more."
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 text-left transition-all hover:border-emerald-200 hover:bg-emerald-50/40"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                        <MessageCircle className="size-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-900 group-hover:text-emerald-900">
                          WhatsApp Specialist
                        </div>
                        <div className="text-[11px] text-zinc-500">+91 9168 08 1355</div>
                      </div>
                    </div>
                    <span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 shadow-xs group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                      Chat Now
                    </span>
                  </a>

                  <a
                    href="tel:+919168081355"
                    className="group flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 text-left transition-all hover:border-brand/20 hover:bg-brand/[0.03]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                        <Phone className="size-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-900 group-hover:text-brand">
                          Phone Helpline
                        </div>
                        <div className="text-[11px] text-zinc-500">+91 9168 08 1355 (9 AM - 8 PM)</div>
                      </div>
                    </div>
                    <span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-zinc-700 shadow-xs group-hover:bg-brand group-hover:text-white transition-colors">
                      Call
                    </span>
                  </a>

                  <a
                    href="mailto:bookmytime1355@gmail.com"
                    className="group flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 text-left transition-all hover:border-brand/20 hover:bg-brand/[0.03]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
                        <Mail className="size-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-900 group-hover:text-brand">
                          Email Enquiries
                        </div>
                        <div className="text-[11px] text-zinc-500">bookmytime1355@gmail.com</div>
                      </div>
                    </div>
                    <span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-zinc-700 shadow-xs group-hover:bg-brand group-hover:text-white transition-colors">
                      Email
                    </span>
                  </a>

                  <div className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 text-left">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
                      <MapPin className="size-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-zinc-900">Headquarters</div>
                      <div className="text-[11px] text-zinc-500">Pune, Maharashtra, India</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* What to expect card */}
              <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5 text-white shadow-md sm:p-6">
                <div className="flex items-center gap-2">
                  <span className="inline-flex rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90">
                    What to expect
                  </span>
                </div>
                <div className="mt-4 space-y-3.5">
                  {[
                    {
                      icon: Building2,
                      title: "Tailored to your workflow",
                      text: "We demonstrate booking queues, staff rosters, billing, and automated WhatsApp reminders for your industry.",
                    },
                    {
                      icon: Clock,
                      title: "Quick 20-30 min session",
                      text: "No fluff or aggressive sales pitch — direct answers to your team's operational needs and custom requirements.",
                    },
                    {
                      icon: ShieldCheck,
                      title: "Complete security & SLA",
                      text: "Enterprise data isolation, daily backups, and seamless migration from your existing spreadsheets or legacy software.",
                    },
                  ].map(({ icon: Icon, title, text }) => (
                    <div key={title} className="flex items-start gap-3">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">{title}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">{text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            {/* Right Column: Interactive Demo Booking Form */}
            <main className="lg:col-span-7">
              <ContactForm />
            </main>
          </div>

          {/* FAQ Section */}
          <div className="mt-16 rounded-2xl border border-zinc-200/90 bg-white p-6 sm:p-10">
            <div className="text-center">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
                <HelpCircle className="size-3.5" />
                Got questions?
              </div>
              <h2 className="mt-2 text-xl font-bold text-zinc-900 sm:text-2xl">
                Frequently Asked Questions
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Everything you need to know about our demo sessions and onboarding process.
              </p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {FAQS.map((faq, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4 transition-colors hover:border-zinc-200 hover:bg-zinc-50"
                >
                  <h4 className="text-xs font-bold text-zinc-900">{faq.q}</h4>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}

function ContactForm() {
  const [submitted, setSubmitted] = useState<null | {
    referenceId: string;
    name: string;
    email: string;
    date: string;
    time: string;
    mode: string;
  }>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [form, setForm] = useState<ContactFormState>(defaultForm);
  const [copied, setCopied] = useState(false);

  // Minimum date is today
  const todayDate = useMemo(() => new Date().toISOString().split("T")[0], []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError("");

    try {
      const result = await createDemoAppointmentServerFn({ data: form });
      setSubmitted({
        referenceId: result.referenceId,
        name: form.name,
        email: form.email,
        date: form.preferredDate,
        time: form.preferredTime,
        mode: form.preferredMode,
      });
      setForm(defaultForm);
    } catch (error: any) {
      setSubmitError(error?.message || "We could not submit your request right now. Please check your fields.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyReference = () => {
    if (!submitted?.referenceId) return;
    navigator.clipboard.writeText(submitted.referenceId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sm sm:p-7">
      {submitted ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="py-6 text-center sm:py-8"
        >
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
            <CheckCircle2 className="size-6" />
          </div>

          <h3 className="mt-4 text-lg font-bold text-zinc-900">
            Demo Request Received!
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500">
            Thanks, <span className="font-semibold text-zinc-800">{submitted.name}</span>! We have
            recorded your requested slot for{" "}
            <span className="font-semibold text-zinc-800">
              {submitted.date} at {submitted.time} ({submitted.mode})
            </span>
            . A confirmation email has been sent to{" "}
            <span className="font-semibold text-zinc-800">{submitted.email}</span>.
          </p>

          <div className="mx-auto mt-4 inline-flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3.5 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Booking Reference
            </span>
            <span className="font-mono text-xs font-bold text-zinc-900">
              {submitted.referenceId}
            </span>
            <button
              type="button"
              onClick={copyReference}
              title="Copy Reference ID"
              className="text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              {copied ? (
                <Check className="size-3 text-emerald-600" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
          </div>

          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={`https://wa.me/919168081355?text=Hi,%20I%20just%20booked%20a%20demo%20with%20reference%20${submitted.referenceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              <MessageCircle className="size-3.5" />
              Coordinate on WhatsApp
            </a>
            <button
              type="button"
              onClick={() => setSubmitted(null)}
              className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg border border-zinc-200 px-4 py-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              Book another demo
            </button>
          </div>
        </motion.div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Schedule Your Personalized Demo</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Fill in your business details and choose your preferred walkthrough slot.
            </p>
          </div>

          {/* Section 1: Contact Details */}
          <div className="space-y-2.5 pt-1">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                  Full name <span className="text-brand">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Aarav Sharma"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                  Work email <span className="text-brand">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="admin@yourclinic.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                  Mobile number <span className="text-brand">*</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="+91 98765 43210"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                  Clinic / Business name <span className="text-brand">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Metro Care Hospital"
                  value={form.organization}
                  onChange={(e) => setForm({ ...form, organization: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                  City <span className="text-brand">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Pune"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Business Profile */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 pt-1 border-t border-zinc-100">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                Business type <span className="text-brand">*</span>
              </label>
              <select
                value={form.businessType}
                onChange={(e) => setForm({ ...form, businessType: e.target.value })}
                className="w-full rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all cursor-pointer font-medium"
              >
                <option value="Clinic / Hospital">Clinic / Hospital</option>
                <option value="Dental">Dental Clinic</option>
                <option value="Aesthetic / Wellness">Aesthetic / Wellness / Spa</option>
                <option value="Diagnostic centre">Diagnostic Centre / Lab</option>
                <option value="Fitness / Gym">Fitness / Gym Studio</option>
                <option value="Professional services">Professional Services (Law, CA, Consulting)</option>
                <option value="Education institutions">Education / Coaching</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                Team size <span className="text-brand">*</span>
              </label>
              <select
                value={form.teamSize}
                onChange={(e) => setForm({ ...form, teamSize: e.target.value })}
                className="w-full rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all cursor-pointer font-medium"
              >
                <option value="1-5 staff">Solo &bull; 1-5 staff</option>
                <option value="6-15 staff">Small Team &bull; 6-15 staff</option>
                <option value="16-40 staff">Mid-Size &bull; 16-40 staff</option>
                <option value="41-100 staff">Large Practice &bull; 41-100 staff</option>
                <option value="100+ staff">Enterprise &bull; 100+ staff</option>
              </select>
            </div>
          </div>

          {/* Section 3: Demo Mode & Preferred Slot */}
          <div className="pt-1 border-t border-zinc-100 space-y-2.5">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-zinc-600">
                Preferred demo mode <span className="text-brand">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DEMO_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const isSelected = form.preferredMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setForm({ ...form, preferredMode: mode.id })}
                      className={`flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-all cursor-pointer ${
                        isSelected
                          ? "border-brand bg-brand/5 text-brand shadow-xs font-semibold ring-1 ring-brand/20"
                          : "border-zinc-200/80 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                      }`}
                    >
                      <Icon className={`size-4 ${isSelected ? "text-brand" : "text-zinc-500"}`} />
                      <span className="mt-1 text-[11px] font-medium">{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                  Preferred date <span className="text-brand">*</span>
                </label>
                <input
                  type="date"
                  required
                  min={todayDate}
                  value={form.preferredDate}
                  onChange={(e) => setForm({ ...form, preferredDate: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                  Preferred time <span className="text-brand">*</span>
                </label>
                <input
                  type="time"
                  required
                  value={form.preferredTime}
                  onChange={(e) => setForm({ ...form, preferredTime: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Section 4: What should we focus on? */}
          <div className="pt-1 border-t border-zinc-100">
            <label className="mb-1 block text-[11px] font-medium text-zinc-600">
              What should we focus on? <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              rows={2}
              placeholder="Share current bottlenecks, WhatsApp automation, billing flow, staff scheduling, or multi-branch requirements..."
              className="w-full resize-none rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10 transition-all"
            />
          </div>

          {submitError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50/80 px-3 py-2 text-center"
            >
              <p className="text-[11px] font-medium text-red-600">{submitError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 py-2.5 text-xs font-semibold text-white transition-all hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-60 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>Scheduling your demo...</span>
              </>
            ) : (
              <>
                <span>Confirm Demo Booking</span>
                <ArrowRight className="size-3.5" />
              </>
            )}
          </button>

          <p className="text-center text-[10px] text-zinc-400">
            You will receive a confirmation email and Google calendar invite with all details.
          </p>
        </form>
      )}
    </div>
  );
}
