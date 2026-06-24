import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Check,
  Clock3,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
} from "lucide-react";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { PageHeader } from "@/components/site/sections";
import { createDemoAppointmentServerFn } from "@/lib/demo";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact - BookMyTime" },
      {
        name: "description",
        content:
          "Book a product demo, share your business workflow, and get a tailored onboarding plan for your team.",
      },
      { property: "og:title", content: "Contact BookMyTime" },
      {
        property: "og:description",
        content: "Speak with a workflow specialist and book your demo slot.",
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

function ContactPage() {
  return (
    <SiteShell>
      <Nav />
      <PageHeader
        eyebrow="BOOK A DEMO"
        title="Let's give your business"
        highlight="its time back"
        subtitle="Share your workflow, preferred slot, and current bottlenecks. We'll confirm your demo and send a tailored walkthrough plan."
      />
      <section className="bg-white py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[1.65fr_2.35fr]">
          <aside className="space-y-5">
            <InfoCard
              icon={Mail}
              title="Email"
              line="bookmytime1355@gmail.com"
              sub="Confirmation and follow-up land here too"
            />
            <InfoCard
              icon={Phone}
              title="Call or WhatsApp"
              line="+91 9168 08 1355"
              sub="Fastest way to coordinate your preferred demo slot"
            />
            <InfoCard
              icon={CalendarClock}
              title="Demo format"
              line="Live walkthrough in 20-30 minutes"
              sub="Google Meet, phone call, or WhatsApp call based on your preference"
            />

            <div className="rounded-[2rem] border border-zinc-950/5 bg-zinc-950 p-6 text-white">
              <span className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">
                What to expect
              </span>
              <div className="mt-5 space-y-4">
                {[
                  {
                    icon: Building2,
                    title: "Workflow-first setup",
                    text: "We tailor the demo around your front desk, staff schedules, billing, and follow-up flow.",
                  },
                  {
                    icon: Clock3,
                    title: "Quick response",
                    text: "A confirmation email goes to you and our admin team right after you submit the form.",
                  },
                  {
                    icon: BriefcaseBusiness,
                    title: "India-ready operations",
                    text: "Built for Indian phone formats, practical onboarding, and easy SaaS account management.",
                  },
                ].map(({ icon: Icon, title, text }) => (
                  <div key={title} className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                      <Icon className="size-4 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-white/70">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <ContactForm />
        </div>
      </section>
    </SiteShell>
  );
}

function ContactForm() {
  const [submitted, setSubmitted] = useState<null | { referenceId: string; name: string }>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [form, setForm] = useState<ContactFormState>(defaultForm);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError("");

    try {
      const result = await createDemoAppointmentServerFn({ data: form });
      setSubmitted({ referenceId: result.referenceId, name: form.name });
      setForm(defaultForm);
    } catch (error: any) {
      setSubmitError(error?.message || "We could not submit your request right now.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-brand/10 via-cyan-50/50 to-emerald-50/40 blur-2xl" />
      <form
        onSubmit={onSubmit}
        className="relative rounded-[2rem] border border-zinc-950/5 bg-white p-7 shadow-[0_20px_80px_rgba(15,23,42,0.08)] md:p-9"
      >
        {submitted ? (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center py-10 text-center"
          >
            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100">
              <Check className="size-8 text-emerald-600" />
            </div>
            <h3 className="mt-5 text-2xl font-semibold tracking-tight">
              Demo request received, {submitted.name || "there"}.
            </h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600">
              We have recorded your preferred slot and sent a confirmation email. Our team will reach
              out soon to finalize the session.
            </p>
            <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-800">
              Reference ID: {submitted.referenceId}
            </div>
          </motion.div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <MessageSquare className="size-5 text-brand" />
              <div>
                <h2 className="text-xl font-semibold">Tell us about your setup</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  We will use this to prepare a relevant demo, not a generic sales call.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                placeholder="e.g. John Doe"
                required
              />
              <Field
                label="Work email"
                type="email"
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
                placeholder="admin@yourbusiness.com"
                required
              />
              <Field
                label="Mobile number"
                value={form.phone}
                onChange={(v) => setForm({ ...form, phone: v })}
                placeholder="+91 98765 43210"
                required
              />
              <Field
                label="Clinic / business name"
                value={form.organization}
                onChange={(v) => setForm({ ...form, organization: v })}
                placeholder="Your Business Name"
                required
              />
              <Field
                label="City"
                value={form.city}
                onChange={(v) => setForm({ ...form, city: v })}
                placeholder="Pune"
                icon={MapPin}
                required
              />
              <Select
                label="Business type"
                value={form.businessType}
                onChange={(v) => setForm({ ...form, businessType: v })}
                options={[
                  "Clinic / Hospital",
                  "Dental",
                  "Aesthetic / Wellness",
                  "Diagnostic centre",
                  "Fitness / Gym",
                  "Professional services",
                ]}
              />
              <Select
                label="Team size"
                value={form.teamSize}
                onChange={(v) => setForm({ ...form, teamSize: v })}
                options={["1-5 staff", "6-15 staff", "16-40 staff", "41-100 staff", "100+ staff"]}
              />
              <Select
                label="Preferred demo mode"
                value={form.preferredMode}
                onChange={(v) => setForm({ ...form, preferredMode: v })}
                options={["Google Meet", "Phone call", "WhatsApp call", "In-person discussion"]}
              />
              <Field
                label="Preferred date"
                type="date"
                value={form.preferredDate}
                onChange={(v) => setForm({ ...form, preferredDate: v })}
                min={new Date().toISOString().split("T")[0]}
                required
              />
              <Field
                label="Preferred time"
                type="time"
                value={form.preferredTime}
                onChange={(v) => setForm({ ...form, preferredTime: v })}
                required
              />

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-zinc-600">
                  What should we focus on?
                </label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={5}
                  placeholder="Share your current booking issues, follow-up gaps, front-desk workload, WhatsApp needs, or reporting pain points."
                  className="w-full resize-none rounded-2xl border border-zinc-950/10 bg-zinc-50 px-4 py-3 text-sm outline-none transition-all focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
                />
              </div>
            </div>

            {submitError && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="group mt-6 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-dark py-3.5 text-sm font-semibold text-white ring-1 ring-brand/30 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-75"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Booking your demo
                </>
              ) : (
                <>
                  Book my demo slot
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
            <p className="mt-4 text-center text-[11px] text-zinc-500">
              You will receive a confirmation email, and our admin team gets the same booking instantly.
            </p>
          </>
        )}
      </form>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  title,
  line,
  sub,
}: {
  icon: typeof Mail;
  title: string;
  line: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-[1.5rem] border border-zinc-950/5 bg-zinc-50 p-5 transition-colors hover:border-brand/20 hover:bg-white">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand/10">
        <Icon className="size-5 text-brand" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
        <p className="mt-1 text-sm font-semibold text-zinc-900">{line}</p>
        <p className="text-xs text-zinc-500">{sub}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  className = "",
  min,
  icon: Icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  min?: string;
  icon?: typeof MapPin;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium text-zinc-600">
        {label} {required && <span className="text-brand">*</span>}
      </label>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />}
        <input
          type={type}
          value={value}
          min={min}
          required={required}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-2xl border border-zinc-950/10 bg-zinc-50 px-4 py-3 text-sm outline-none transition-all focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15 ${Icon ? "pl-10" : ""}`}
        />
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-600">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-zinc-950/10 bg-zinc-50 px-4 py-3 text-sm outline-none transition-all focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
