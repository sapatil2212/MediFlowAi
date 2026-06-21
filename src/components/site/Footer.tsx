import { Link } from "@tanstack/react-router";
import { HeartPulse, ShieldCheck, Globe, Lock, Database } from "lucide-react";

const cols = [
  {
    title: "Product",
    links: [
      { label: "Features", to: "/features" as const },
      { label: "AI Receptionist", to: "/features" as const },
      { label: "Clinical Notes", to: "/features" as const },
      { label: "Billing", to: "/features" as const },
      { label: "Analytics", to: "/features" as const },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Solo Practice", to: "/solutions" as const },
      { label: "Multi-clinic", to: "/solutions" as const },
      { label: "Hospitals", to: "/solutions" as const },
      { label: "Dental", to: "/solutions" as const },
      { label: "Aesthetic", to: "/solutions" as const },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Customers", to: "/customers" as const },
      { label: "Pricing", to: "/pricing" as const },
      { label: "Contact", to: "/contact" as const },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-zinc-950/5 bg-zinc-50 py-16">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-12 md:grid-cols-[1.5fr_3fr]">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-light">
                <HeartPulse className="size-4 text-white" />
              </div>
              <span className="text-sm font-semibold tracking-tight">BookMyTime</span>
            </div>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
              The AI operating system for modern medicine. Built for clinics, hospitals, dental and
              aesthetic centers — by engineers who shipped at Epic, Mayo and Stripe.
            </p>
            <div className="mt-6 flex gap-2">
              {[Globe, ShieldCheck, Lock, Database].map((Icon, i) => (
                <div
                  key={i}
                  className="flex size-8 items-center justify-center rounded-lg bg-white ring-1 ring-zinc-950/5"
                >
                  <Icon className="size-3.5 text-zinc-500" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 md:grid-cols-3">
            {cols.map((c) => (
              <div key={c.title}>
                <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                  {c.title}
                </p>
                <ul className="space-y-2.5">
                  {c.links.map((l, i) => (
                    <li key={i}>
                      <Link
                        to={l.to}
                        className="text-xs text-zinc-600 transition-colors hover:text-brand"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-zinc-950/5 pt-8 md:flex-row">
          <p className="text-[11px] text-zinc-500">
            © 2026 BookMyTime Systems Inc. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-brand" />
              HIPAA
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-brand" />
              SOC 2 Type II
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-brand" />
              GDPR
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-brand" />
              ISO 27001
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 selection:bg-brand/15 flex flex-col">
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
