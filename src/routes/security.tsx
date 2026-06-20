import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { CTA } from "@/components/site/sections";
import {
  ShieldCheck,
  Lock,
  KeyRound,
  ServerCog,
  FileCheck2,
  Eye,
  Globe2,
  AlertTriangle,
  CheckCircle2,
  Activity,
} from "lucide-react";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security & Trust — MediFlow AI" },
      {
        name: "description",
        content:
          "HIPAA, SOC 2 Type II, ISO 27001, GDPR. End-to-end encryption, regional residency, and zero PHI in model training.",
      },
      { property: "og:title", content: "Security & Trust — MediFlow AI" },
      {
        property: "og:description",
        content:
          "How MediFlow AI protects patient data: certifications, architecture, and operational controls.",
      },
    ],
  }),
  component: SecurityPage,
});

const badges = [
  { label: "HIPAA", sub: "Business Associate Agreement" },
  { label: "SOC 2", sub: "Type II audited" },
  { label: "ISO 27001", sub: "Certified" },
  { label: "GDPR", sub: "EU + UK compliant" },
  { label: "HITRUST", sub: "r2 in progress" },
  { label: "PCI DSS", sub: "Level 1" },
];

const pillars = [
  {
    icon: Lock,
    title: "Encryption everywhere",
    desc: "TLS 1.3 in transit. AES-256 at rest. Per-tenant envelope keys rotated quarterly.",
  },
  {
    icon: KeyRound,
    title: "Granular access control",
    desc: "Role + attribute based access. Break-glass workflows logged immutably for audit.",
  },
  {
    icon: ServerCog,
    title: "Regional data residency",
    desc: "US, EU, UAE, India, Singapore. Your data never leaves the region you pick.",
  },
  {
    icon: Eye,
    title: "Zero PHI in model training",
    desc: "Foundation models receive only synthetic or de-identified data. Verifiable in the audit log.",
  },
  {
    icon: FileCheck2,
    title: "Continuous compliance",
    desc: "Drata-monitored controls, quarterly pen tests, weekly dependency scanning.",
  },
  {
    icon: Activity,
    title: "99.99% uptime",
    desc: "Multi-region active-active. Live status, transparent post-mortems within 48 hours.",
  },
];

const controls = [
  "SAML 2.0 / OIDC SSO",
  "SCIM 2.0 provisioning",
  "MFA enforced for all admins",
  "Field-level PHI redaction",
  "Immutable audit log (7yr retention)",
  "Customer-managed keys (BYOK)",
  "Quarterly penetration tests",
  "Bug bounty program",
  "Vendor security review (SIG Lite)",
];

function SecurityPage() {
  return (
    <SiteShell>
      <Nav />
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-zinc-200">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute inset-0 bg-radial-fade" />
        <div className="relative mx-auto max-w-6xl px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1 text-xs font-medium text-teal-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Trust center
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl text-5xl font-bold tracking-tight text-zinc-900 sm:text-6xl">
            Security isn't a feature.{" "}
            <span className="text-gradient-brand">It's the foundation.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">
            Every byte of patient data is encrypted, audited, and isolated.
            Every model interaction is logged. Every workflow is HIPAA-eligible
            by default.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-700"
            >
              Request SOC 2 report
            </Link>
            <a
              href="#controls"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              View controls
            </a>
          </div>
        </div>
      </section>

      {/* Compliance badges */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {badges.map((b, i) => (
            <motion.div
              key={b.label}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border border-zinc-200 bg-white p-5 text-center"
            >
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-100 to-emerald-100 text-teal-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="mt-3 font-bold tracking-tight text-zinc-900">
                {b.label}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">{b.sub}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pillars */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-center text-3xl font-bold tracking-tight text-zinc-900">
          Six pillars of trust
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="group rounded-2xl border border-zinc-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-teal-300"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700 transition-colors group-hover:bg-teal-600 group-hover:text-white">
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-zinc-900">
                {p.title}
              </h3>
              <p className="mt-2 text-sm text-zinc-600">{p.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Architecture diagram */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-3xl border border-zinc-200 bg-white p-8">
          <div className="text-xs font-medium uppercase tracking-wide text-teal-600">
            Tenant isolation
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">
            Logical + physical isolation per tenant
          </h2>
          <div className="mt-8">
            <svg viewBox="0 0 800 240" className="w-full">
              <defs>
                <linearGradient id="secGrad" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="#14b8a6" />
                  <stop offset="100%" stopColor="#0b5a54" />
                </linearGradient>
              </defs>
              {/* Patient -> Edge */}
              <g>
                <rect x="20" y="100" width="120" height="40" rx="8" fill="white" stroke="#0f766e" />
                <text x="80" y="125" textAnchor="middle" fontSize="12" fill="#0f766e" fontWeight="600">Patient</text>
              </g>
              <g>
                <rect x="200" y="100" width="140" height="40" rx="8" fill="url(#secGrad)" />
                <text x="270" y="125" textAnchor="middle" fontSize="12" fill="white" fontWeight="600">TLS 1.3 Edge</text>
              </g>
              <g>
                <rect x="400" y="60" width="160" height="40" rx="8" fill="url(#secGrad)" />
                <text x="480" y="85" textAnchor="middle" fontSize="12" fill="white" fontWeight="600">Tenant A — DB</text>
              </g>
              <g>
                <rect x="400" y="140" width="160" height="40" rx="8" fill="url(#secGrad)" opacity="0.85" />
                <text x="480" y="165" textAnchor="middle" fontSize="12" fill="white" fontWeight="600">Tenant B — DB</text>
              </g>
              <g>
                <rect x="620" y="100" width="160" height="40" rx="8" fill="white" stroke="#0f766e" />
                <text x="700" y="118" textAnchor="middle" fontSize="11" fill="#0f766e" fontWeight="600">Audit log</text>
                <text x="700" y="132" textAnchor="middle" fontSize="10" fill="#0f766e">immutable · 7yr</text>
              </g>
              {/* Arrows */}
              <g stroke="#0f766e" strokeWidth="1.6" fill="none" strokeDasharray="4 4">
                <path d="M140 120 H200" />
                <path d="M340 120 Q370 80 400 80" />
                <path d="M340 120 Q370 160 400 160" />
                <path d="M560 80 Q590 100 620 120" />
                <path d="M560 160 Q590 140 620 120" />
              </g>
              <text x="270" y="210" textAnchor="middle" fontSize="11" fill="#52525b">
                Every request is signed, logged, and scoped to a single tenant's encryption envelope.
              </text>
            </svg>
          </div>
        </div>
      </section>

      {/* Controls */}
      <section id="controls" className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
              Operational controls
            </h2>
            <p className="mt-3 text-zinc-600">
              The boring stuff that matters. Every control below is reviewed
              quarterly and visible in your Trust Center dashboard.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {controls.map((c) => (
                <div
                  key={c}
                  className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                >
                  <CheckCircle2 className="h-4 w-4 text-teal-600" />
                  {c}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-zinc-200 bg-gradient-to-br from-zinc-950 to-zinc-900 p-8 text-zinc-200">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
              <Activity className="h-4 w-4" /> Live status
            </div>
            <div className="mt-4 space-y-3">
              {[
                { name: "API", up: 99.998 },
                { name: "AI Scribe", up: 99.992 },
                { name: "Voice Agent", up: 99.97 },
                { name: "Webhooks", up: 100 },
              ].map((s) => (
                <div key={s.name}>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{s.name}</span>
                    <span>{s.up.toFixed(2)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400"
                      style={{ width: `${s.up}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Voice Agent — degraded latency in ap-south-1 (resolved 14 min ago).
            </div>
            <div className="mt-6 flex items-center gap-2 text-xs text-zinc-500">
              <Globe2 className="h-3.5 w-3.5" /> Updated every 30s ·{" "}
              <Link to="/contact" className="text-emerald-400 underline">
                full status →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <CTA />
    </SiteShell>
  );
}
