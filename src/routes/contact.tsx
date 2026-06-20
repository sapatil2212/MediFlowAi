import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { PageHeader } from "@/components/site/sections";
import { motion } from "motion/react";
import { useState } from "react";
import { Mail, Phone, MapPin, Check, ArrowRight, MessageSquare, CalendarClock } from "lucide-react";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — MediFlow AI" },
      {
        name: "description",
        content:
          "Book a demo, talk to sales, or get a custom onboarding plan for your clinic, hospital network or specialty group.",
      },
      { property: "og:title", content: "Contact MediFlow AI" },
      {
        property: "og:description",
        content: "Talk to a healthcare specialist. Average response: under 4 hours.",
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <SiteShell>
      <Nav />
      <PageHeader
        eyebrow="GET IN TOUCH"
        title="Let's give your clinic"
        highlight="its time back"
        subtitle="Tell us about your practice. A healthcare specialist will respond within 4 business hours with a tailored demo plan."
      />
      <section className="bg-white py-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[2fr_3fr]">
          <aside className="space-y-5">
            <InfoCard
              icon={Mail}
              title="Email"
              line="hello@mediflow.ai"
              sub="Replies within 4 business hours"
            />
            <InfoCard
              icon={Phone}
              title="Sales"
              line="+1 (800) 555-0144"
              sub="Mon–Fri · 8am–8pm EST"
            />
            <InfoCard
              icon={CalendarClock}
              title="Book a live demo"
              line="30 minutes, screen-share"
              sub="A real clinician walks you through your workflow"
            />
            <InfoCard
              icon={MapPin}
              title="HQ"
              line="Boston, MA · NYC · Lisbon"
              sub="Distributed team across 14 countries"
            />
          </aside>
          <ContactForm />
        </div>
      </section>
    </SiteShell>
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
    <div className="flex items-start gap-4 rounded-2xl border border-zinc-950/5 bg-zinc-50 p-5 transition-colors hover:bg-white hover:border-brand/20">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10">
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

function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    org: "",
    role: "Practice owner",
    size: "1–5 providers",
    message: "",
  });
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-brand/10 via-cyan-50/40 to-emerald-50/30 blur-2xl" />
      <form
        onSubmit={onSubmit}
        className="relative rounded-3xl border border-zinc-950/5 bg-white p-7 md:p-10"
      >
        {submitted ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center py-10 text-center"
          >
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-100">
              <Check className="size-7 text-emerald-600" />
            </div>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight">Got it, {form.name || "doc"}.</h3>
            <p className="mt-2 max-w-md text-sm text-zinc-600">
              A MediFlow specialist will reach out within 4 business hours with a custom demo plan
              for your practice.
            </p>
          </motion.div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <MessageSquare className="size-5 text-brand" />
              <h2 className="text-xl font-semibold">Tell us about your practice</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                required
              />
              <Field
                label="Work email"
                type="email"
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
                required
              />
              <Field
                label="Organization"
                value={form.org}
                onChange={(v) => setForm({ ...form, org: v })}
                className="sm:col-span-2"
              />
              <Select
                label="Your role"
                value={form.role}
                onChange={(v) => setForm({ ...form, role: v })}
                options={["Practice owner", "Doctor", "Practice manager", "IT / Tech", "Other"]}
              />
              <Select
                label="Practice size"
                value={form.size}
                onChange={(v) => setForm({ ...form, size: v })}
                options={["1–5 providers", "6–25 providers", "26–100 providers", "100+ providers"]}
              />
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-zinc-600">
                  How can we help?
                </label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={4}
                  placeholder="Tell us about your specialty, current stack, and what you're hoping to fix…"
                  className="w-full resize-none rounded-lg border border-zinc-950/10 bg-zinc-50 px-3 py-2.5 text-sm outline-none transition-all focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
                />
              </div>
            </div>
            <button
              type="submit"
              className="group mt-6 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-br from-brand to-brand-dark py-3 text-sm font-semibold text-white ring-1 ring-brand/30 transition-transform hover:scale-[1.01]"
            >
              Request my demo
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <p className="mt-4 text-center text-[11px] text-zinc-500">
              We respect your privacy. We'll only use this to schedule your demo.
            </p>
          </>
        )}
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium text-zinc-600">
        {label} {required && <span className="text-brand">*</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-950/10 bg-zinc-50 px-3 py-2.5 text-sm outline-none transition-all focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
      />
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
        className="w-full rounded-lg border border-zinc-950/10 bg-zinc-50 px-3 py-2.5 text-sm outline-none transition-all focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
