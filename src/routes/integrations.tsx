import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { CTA } from "@/components/site/sections";
import {
  Search,
  Plug,
  Zap,
  Check,
  ArrowRight,
  CreditCard,
  MessageSquare,
  Calendar,
  FileText,
  Stethoscope,
  Database,
  ShieldCheck,
  Cloud,
} from "lucide-react";

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations — BookMyTime" },
      {
        name: "description",
        content:
          "120+ native integrations: Stripe, Twilio, WhatsApp, Google Calendar, Epic, Cerner, HL7 / FHIR and more.",
      },
      { property: "og:title", content: "Integrations — BookMyTime" },
      {
        property: "og:description",
        content:
          "Connect BookMyTime to your EHR, payments, messaging, calendar, and lab partners in one click.",
      },
    ],
  }),
  component: IntegrationsPage,
});

type Cat =
  | "All"
  | "Payments"
  | "Messaging"
  | "Calendar"
  | "EHR / EMR"
  | "Labs"
  | "Analytics"
  | "Identity";

const categories: Cat[] = [
  "All",
  "Payments",
  "Messaging",
  "Calendar",
  "EHR / EMR",
  "Labs",
  "Analytics",
  "Identity",
];

const integrations: {
  name: string;
  category: Exclude<Cat, "All">;
  desc: string;
  icon: typeof CreditCard;
  popular?: boolean;
}[] = [
  { name: "Stripe", category: "Payments", desc: "Cards, ACH, subscription billing", icon: CreditCard, popular: true },
  { name: "Razorpay", category: "Payments", desc: "UPI, cards, EMI for India", icon: CreditCard },
  { name: "Paddle", category: "Payments", desc: "Global merchant of record", icon: CreditCard },
  { name: "Twilio", category: "Messaging", desc: "SMS, voice, programmable IVR", icon: MessageSquare, popular: true },
  { name: "WhatsApp Business", category: "Messaging", desc: "Patient chat & reminders", icon: MessageSquare, popular: true },
  { name: "Slack", category: "Messaging", desc: "Clinical alerts & ops channels", icon: MessageSquare },
  { name: "Google Calendar", category: "Calendar", desc: "Two-way sync per provider", icon: Calendar, popular: true },
  { name: "Outlook 365", category: "Calendar", desc: "Microsoft 365 + Teams", icon: Calendar },
  { name: "Calendly", category: "Calendar", desc: "Patient self-booking flows", icon: Calendar },
  { name: "Epic", category: "EHR / EMR", desc: "FHIR R4 + HL7 v2 bidirectional", icon: FileText, popular: true },
  { name: "Cerner / Oracle Health", category: "EHR / EMR", desc: "Encounters & document sync", icon: FileText },
  { name: "Athenahealth", category: "EHR / EMR", desc: "Practice + clinical data", icon: FileText },
  { name: "DrChrono", category: "EHR / EMR", desc: "Templates & e-prescribe", icon: FileText },
  { name: "LabCorp", category: "Labs", desc: "Orders + results ingestion", icon: Stethoscope },
  { name: "Quest Diagnostics", category: "Labs", desc: "Lab + pathology results", icon: Stethoscope },
  { name: "Snowflake", category: "Analytics", desc: "Mirror to your warehouse", icon: Database },
  { name: "BigQuery", category: "Analytics", desc: "Streaming export", icon: Database },
  { name: "Looker", category: "Analytics", desc: "Pre-built dashboards", icon: Database },
  { name: "Okta", category: "Identity", desc: "SSO + SCIM provisioning", icon: ShieldCheck },
  { name: "Azure AD", category: "Identity", desc: "Enterprise SSO", icon: ShieldCheck },
  { name: "Auth0", category: "Identity", desc: "Patient identity flows", icon: ShieldCheck },
];

function IntegrationsPage() {
  const [active, setActive] = useState<Cat>("All");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return integrations.filter((it) => {
      const matchCat = active === "All" || it.category === active;
      const matchQ =
        !q ||
        it.name.toLowerCase().includes(q.toLowerCase()) ||
        it.desc.toLowerCase().includes(q.toLowerCase());
      return matchCat && matchQ;
    });
  }, [active, q]);

  return (
    <SiteShell>
      <Nav />
      <section className="relative overflow-hidden border-b border-zinc-200">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute inset-0 bg-radial-fade" />
        <div className="relative mx-auto max-w-6xl px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1 text-xs font-medium text-teal-700">
            <Plug className="h-3.5 w-3.5" /> 120+ integrations
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl text-5xl font-bold tracking-tight text-zinc-900 sm:text-6xl">
            One platform.{" "}
            <span className="text-gradient-brand">Every tool you already use.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">
            Plug BookMyTime into your EHR, payments, messaging, identity, and
            analytics stack — no middleware, no consultants, no surprises.
          </p>

          {/* Search */}
          <div className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-2 ring-1 ring-zinc-200/50 focus-within:border-teal-400 focus-within:ring-teal-300">
            <Search className="ml-2 h-4 w-4 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search 120+ integrations..."
              className="w-full bg-transparent px-2 py-2 text-sm outline-none"
            />
            <kbd className="hidden rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 sm:block">
              ⌘ K
            </kbd>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setActive(c)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${
                active === c
                  ? "border-teal-500 bg-teal-600 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-teal-300"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((it, i) => {
            const Icon = it.icon;
            return (
              <motion.div
                key={it.name}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-teal-300"
              >
                {it.popular && (
                  <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    <Zap className="h-3 w-3" /> Popular
                  </span>
                )}
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-teal-50 to-emerald-50 text-teal-700 ring-1 ring-teal-200/50">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-4 font-semibold text-zinc-900">{it.name}</div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {it.category}
                </div>
                <p className="mt-3 text-sm text-zinc-600">{it.desc}</p>
                <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-700 opacity-0 transition-opacity group-hover:opacity-100">
                  Connect <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </motion.div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500">
              No integrations match "{q}". Need it?{" "}
              <Link to="/contact" className="font-medium text-teal-700 underline">
                Request one
              </Link>
              .
            </div>
          )}
        </div>
      </section>

      {/* Open API strip */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid items-center gap-10 rounded-3xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-teal-50/40 p-10 lg:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1 text-xs font-medium text-teal-700">
              <Cloud className="h-3.5 w-3.5" /> Open by default
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900">
              REST + GraphQL + Webhooks
            </h2>
            <p className="mt-3 text-zinc-600">
              Build anything we haven't. Full FHIR R4 surface, signed webhooks,
              and granular RBAC tokens — versioned, documented, and rate-limited
              fairly.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-zinc-700">
              {[
                "FHIR R4 + HL7 v2 endpoints",
                "Signed webhooks with replay",
                "OAuth 2 + service accounts",
                "Sandbox env for every tenant",
              ].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-teal-600" /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-xs font-mono text-zinc-300 ring-1 ring-zinc-900">
            <div className="mb-3 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="ml-3 text-zinc-500">POST /v1/appointments</span>
            </div>
            <pre className="leading-relaxed">
{`{
  "patient_id": "pat_8K2",
  "provider_id": "prv_AR3",
  "starts_at": "2026-06-20T14:30:00Z",
  "channel": "whatsapp",
  "reminder": "ai_voice"
}

→ 201 Created
  "appointment_id": "apt_91XQ",
  "confirmation_sent": true,
  "ai_intake_link": "https://m.mfl.ai/i/91XQ"`}
            </pre>
          </div>
        </div>
      </section>

      <CTA />
    </SiteShell>
  );
}
