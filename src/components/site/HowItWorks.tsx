import { motion } from "motion/react";

type Card = {
  title: string;
  description: string;
  bg: string;
  illustration: React.ReactNode;
};

function BrowserFrame({ children, tint = "#0f766e" }: { children: React.ReactNode; tint?: string }) {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-white/70 bg-white/90 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-rose-300" />
        <span className="h-2 w-2 rounded-full bg-amber-300" />
        <span className="h-2 w-2 rounded-full bg-emerald-300" />
      </div>
      <div className="p-3" style={{ color: tint }}>
        {children}
      </div>
    </div>
  );
}

const grad = "url(#mfGrad)";

function Defs() {
  return (
    <defs>
      <linearGradient id="mfGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#14b8a6" />
        <stop offset="100%" stopColor="#0b5a54" />
      </linearGradient>
      <linearGradient id="mfGradLight" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#5eead4" />
        <stop offset="100%" stopColor="#14b8a6" />
      </linearGradient>
    </defs>
  );
}

/* 1. Booking flow */
function BookingFlow() {
  return (
    <BrowserFrame>
      <svg viewBox="0 0 260 130" className="w-full">
        <Defs />
        {/* Node: calendar */}
        <g>
          <rect x="14" y="40" width="42" height="42" rx="8" fill={grad} />
          <rect x="20" y="50" width="30" height="24" rx="3" fill="white" opacity="0.9" />
          <rect x="20" y="50" width="30" height="6" rx="2" fill={grad} />
          <circle cx="27" cy="64" r="1.6" fill={grad} />
          <circle cx="35" cy="64" r="1.6" fill={grad} />
          <circle cx="43" cy="64" r="1.6" fill={grad} />
        </g>
        {/* Node: clock */}
        <g>
          <rect x="109" y="40" width="42" height="42" rx="8" fill={grad} />
          <circle cx="130" cy="61" r="13" fill="white" opacity="0.9" />
          <line x1="130" y1="61" x2="130" y2="53" stroke="#0f766e" strokeWidth="2" strokeLinecap="round" />
          <line x1="130" y1="61" x2="137" y2="61" stroke="#0f766e" strokeWidth="2" strokeLinecap="round" />
        </g>
        {/* Node: patient */}
        <g>
          <rect x="204" y="40" width="42" height="42" rx="8" fill={grad} />
          <circle cx="225" cy="56" r="5" fill="white" opacity="0.9" />
          <path d="M214 74c2-6 8-9 11-9s9 3 11 9" fill="white" opacity="0.9" />
        </g>
        {/* Node: small bottom */}
        <g>
          <rect x="109" y="98" width="42" height="20" rx="6" fill="url(#mfGradLight)" />
        </g>
        {/* Arrows */}
        <g fill="none" stroke="#0f766e" strokeWidth="1.4" strokeDasharray="3 3" opacity="0.7">
          <path d="M58 61 H107" markerEnd="url(#arr)" />
          <path d="M153 61 H202" markerEnd="url(#arr)" />
          <path d="M35 84 Q35 108 107 108" markerEnd="url(#arr)" />
          <path d="M153 108 Q225 108 225 84" markerEnd="url(#arr)" />
        </g>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#0f766e" />
          </marker>
        </defs>
      </svg>
    </BrowserFrame>
  );
}

/* 2. AI scribe / SOAP notes */
function ScribeIllustration() {
  return (
    <div className="relative">
      <svg viewBox="0 0 260 150" className="w-full">
        <Defs />
        {/* Doctor figure */}
        <g transform="translate(20,30)">
          <circle cx="30" cy="18" r="10" fill="#fbd4b4" />
          <path d="M20 14 Q30 4 40 14 L40 18 L20 18 Z" fill="#1f2937" />
          <rect x="18" y="30" width="24" height="34" rx="6" fill={grad} />
          <rect x="22" y="64" width="7" height="28" rx="3" fill="#1f2937" />
          <rect x="31" y="64" width="7" height="28" rx="3" fill="#1f2937" />
          {/* Tablet */}
          <rect x="40" y="38" width="22" height="16" rx="2" fill="#0f172a" />
          <rect x="42" y="40" width="18" height="12" rx="1" fill="white" />
        </g>
        {/* Clipboard / SOAP note */}
        <g transform="translate(120,18)">
          <rect x="14" y="10" width="100" height="120" rx="8" fill="url(#mfGradLight)" opacity="0.25" stroke={grad} strokeWidth="2" />
          <rect x="48" y="4" width="32" height="14" rx="3" fill={grad} />
          <rect x="58" y="0" width="12" height="8" rx="2" fill="#0f766e" />
          {/* Checklist rows */}
          {[0, 1, 2, 3].map((i) => (
            <g key={i} transform={`translate(22, ${28 + i * 20})`}>
              <rect x="0" y="0" width="14" height="14" rx="3" fill="white" stroke={grad} strokeWidth="1.5" />
              <path d="M3 7 L6 10 L11 4" fill="none" stroke={grad} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="20" y="3" width="60" height="3" rx="1.5" fill={grad} opacity="0.7" />
              <rect x="20" y="9" width="44" height="3" rx="1.5" fill={grad} opacity="0.35" />
            </g>
          ))}
          {/* Big check badge */}
          <circle cx="118" cy="36" r="18" fill="white" stroke={grad} strokeWidth="2.5" />
          <path d="M109 36 L116 43 L128 30" fill="none" stroke={grad} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
}

/* 3. Analytics dashboard */
function AnalyticsIllustration() {
  return (
    <BrowserFrame>
      <svg viewBox="0 0 260 130" className="w-full">
        <Defs />
        {/* Sidebar */}
        <rect x="6" y="6" width="34" height="118" rx="6" fill="#f0fdfa" />
        {[0, 1, 2].map((i) => (
          <rect key={i} x="14" y={18 + i * 22} width="18" height="14" rx="3" fill={grad} opacity={0.7 - i * 0.2} />
        ))}
        {/* Donut */}
        <g transform="translate(80,65)">
          <circle r="32" fill="none" stroke="#e0f2f1" strokeWidth="12" />
          <circle r="32" fill="none" stroke={grad} strokeWidth="12" strokeDasharray="120 201" strokeLinecap="round" transform="rotate(-90)" />
          <circle r="32" fill="none" stroke="url(#mfGradLight)" strokeWidth="12" strokeDasharray="55 201" strokeDashoffset="-120" strokeLinecap="round" transform="rotate(-90)" />
          <circle r="14" fill="white" />
        </g>
        {/* Legend lines */}
        <g transform="translate(132,38)">
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(0, ${i * 14})`}>
              <circle cx="3" cy="4" r="3" fill={grad} opacity={1 - i * 0.3} />
              <rect x="12" y="2" width="40" height="4" rx="2" fill={grad} opacity="0.4" />
            </g>
          ))}
        </g>
        {/* Bar chart card */}
        <g transform="translate(176,58)">
          <rect x="0" y="0" width="78" height="62" rx="6" fill="#ffffff" stroke="#e0f2f1" />
          {[14, 22, 18, 30, 26, 36].map((h, i) => (
            <rect key={i} x={6 + i * 11} y={56 - h} width="7" height={h} rx="2" fill={i % 2 ? grad : "url(#mfGradLight)"} />
          ))}
        </g>
      </svg>
    </BrowserFrame>
  );
}

/* 4. Security & growth */
function SecurityIllustration() {
  return (
    <BrowserFrame>
      <svg viewBox="0 0 260 130" className="w-full">
        <Defs />
        {/* Lines */}
        <g transform="translate(14,14)">
          {[0, 1, 2].map((i) => (
            <rect key={i} x="0" y={i * 8} width={70 - i * 10} height="3" rx="1.5" fill={grad} opacity={0.4 - i * 0.1} />
          ))}
        </g>
        {/* Growth arrow */}
        <g transform="translate(120,30)">
          <polyline points="0,70 20,55 40,60 60,30 80,38 100,10" fill="none" stroke={grad} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="100,10 92,12 96,20" fill={grad} />
          {/* Bars below arrow */}
          {[20, 30, 24, 38, 32, 46].map((h, i) => (
            <rect key={i} x={i * 16} y={90 - h} width="10" height={h} rx="2" fill={i % 2 ? grad : "url(#mfGradLight)"} opacity="0.9" />
          ))}
        </g>
        {/* Shield with lock */}
        <g transform="translate(40,50)">
          <path d="M30 0 L58 10 V32 C58 50 44 62 30 68 C16 62 2 50 2 32 V10 Z" fill="url(#mfGradLight)" stroke={grad} strokeWidth="2" />
          <rect x="22" y="30" width="16" height="14" rx="2" fill={grad} />
          <path d="M24 30 V24 a6 6 0 0 1 12 0 V30" fill="none" stroke={grad} strokeWidth="2.2" />
        </g>
      </svg>
    </BrowserFrame>
  );
}

const cards: Card[] = [
  {
    title: "Omnichannel Booking",
    description:
      "Automate appointment scheduling, reminders, and follow-ups across web, WhatsApp, and voice — no front desk needed.",
    bg: "from-teal-50 to-emerald-50",
    illustration: <BookingFlow />,
  },
  {
    title: "AI Clinical Scribe",
    description:
      "Capture every visit hands-free. MediFlow drafts SOAP notes, codes, and prescriptions while you focus on the patient.",
    bg: "from-sky-50 to-teal-50",
    illustration: <ScribeIllustration />,
  },
  {
    title: "Operations Analytics",
    description:
      "Live dashboards for revenue, capacity, no-shows, and clinician load — across every site and specialty in real time.",
    bg: "from-cyan-50 to-emerald-50",
    illustration: <AnalyticsIllustration />,
  },
  {
    title: "Secure & Scalable",
    description:
      "HIPAA, SOC 2, and ISO 27001 ready. Multi-tenant architecture that scales from solo clinic to hospital network.",
    bg: "from-emerald-50 to-teal-50",
    illustration: <SecurityIllustration />,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto mb-14 max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1 text-xs font-medium text-teal-700">
          How it works
        </div>
        <h2 className="mt-4 text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl">
          How It Works
        </h2>
        <p className="mt-3 text-zinc-600">
          Four building blocks that turn manual healthcare ops into an
          autonomous, AI-powered practice.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => (
          <motion.div
            key={c.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${c.bg} p-6 ring-1 ring-zinc-200/60 transition-transform hover:-translate-y-1`}
          >
            <div className="flex h-40 items-center justify-center">
              {c.illustration}
            </div>
            <h3 className="mt-6 text-xl font-bold text-zinc-900">{c.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              {c.description}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
