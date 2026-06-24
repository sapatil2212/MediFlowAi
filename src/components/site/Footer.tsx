import { Link } from "@tanstack/react-router";
import { ShieldCheck, Globe, Lock, Database } from "lucide-react";
import bmtLogo from "@/assets/bmt-logo.png";

const cols = [
  {
    title: "Features",
    links: [
      { label: "AI Booking Assistant", to: "/features" as const },
      { label: "Online Scheduling", to: "/features" as const },
      { label: "WhatsApp Notifications", to: "/features" as const },
      { label: "Booking Portal", to: "/features" as const },
      { label: "QR Code Booking", to: "/features" as const },
      { label: "Customer Management", to: "/features" as const },
      { label: "Analytics & Reports", to: "/features" as const },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Pricing", to: "/pricing" as const },
      { label: "Contact", to: "/contact" as const },
      { label: "Privacy Policy", to: "/privacy" as const },
      { label: "Terms", to: "/terms" as const },
      { label: "Refund Policy", to: "/refund" as const },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-zinc-950/5 bg-zinc-50 py-16">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-12 md:grid-cols-[1.5fr_3fr]">
          <div>
            <Link to="/" className="mb-4 inline-flex items-center gap-2">
              <img src={bmtLogo} alt="BMT Logo" className="h-20 w-auto object-contain" />
            </Link>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
              The AI-Powered Booking Engine for Modern Businesses.
              Automate appointments, deliver seamless booking experiences with intelligent scheduling and customer engagement.
            </p>
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
            {/* Contact Info Column */}
            <div>
              <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                Contact Us
              </p>
              <ul className="space-y-4">

                <li>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    <span className="block font-semibold text-zinc-900">Email:</span>
                    bookmytime1355@gmail.com
                  </p>
                </li>
                <li>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    <span className="block font-semibold text-zinc-900">Phone:</span>
                    +91 98765 43210
                  </p>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-12 border-t border-zinc-950/5 pt-8 text-center">
          <p className="text-[11px] text-zinc-500">
            © 2026 BookMyTime Systems Inc. All rights reserved.
            <span className="hidden sm:inline"> | </span>
            <br className="sm:hidden" />
            A product of Brightwave Digital Products
          </p>
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
