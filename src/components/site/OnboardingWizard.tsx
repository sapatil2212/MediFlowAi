import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Stethoscope,
  Building2,
  Hospital,
  Sparkles,
  Smile,
  Microscope,
  Users,
  Calendar,
  FileText,
  Phone,
  CreditCard,
  BarChart3,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  Check,
  Clock,
  TrendingUp,
} from "lucide-react";

type Persona = "doctor" | "clinic" | "hospital";
type Priority =
  | "scheduling"
  | "notes"
  | "reception"
  | "billing"
  | "analytics"
  | "compliance";

const personas: {
  id: Persona;
  title: string;
  subtitle: string;
  icon: typeof Stethoscope;
  accent: string;
  specialties: { id: string; label: string; icon: typeof Sparkles }[];
  sizes: string[];
}[] = [
  {
    id: "doctor",
    title: "Solo doctor",
    subtitle: "Independent practice or telehealth",
    icon: Stethoscope,
    accent: "from-teal-500/20 to-emerald-500/10",
    specialties: [
      { id: "gp", label: "General practice", icon: Stethoscope },
      { id: "aesthetic", label: "Aesthetic", icon: Sparkles },
      { id: "dental", label: "Dental", icon: Smile },
    ],
    sizes: ["Just me", "2–5 staff"],
  },
  {
    id: "clinic",
    title: "Multi-provider clinic",
    subtitle: "Group practice or specialty center",
    icon: Building2,
    accent: "from-cyan-500/20 to-teal-500/10",
    specialties: [
      { id: "multi", label: "Multi-specialty", icon: Users },
      { id: "dental", label: "Dental group", icon: Smile },
      { id: "aesthetic", label: "Med-spa chain", icon: Sparkles },
      { id: "diag", label: "Diagnostics", icon: Microscope },
    ],
    sizes: ["6–25 staff", "25–100 staff"],
  },
  {
    id: "hospital",
    title: "Hospital / network",
    subtitle: "Multi-site operations & enterprise",
    icon: Hospital,
    accent: "from-emerald-500/20 to-teal-500/10",
    specialties: [
      { id: "acute", label: "Acute care", icon: Hospital },
      { id: "network", label: "Clinic network", icon: Building2 },
      { id: "diag", label: "Diagnostic chain", icon: Microscope },
    ],
    sizes: ["100–500 staff", "500+ staff"],
  },
];

const priorities: { id: Priority; label: string; icon: typeof Calendar }[] = [
  { id: "scheduling", label: "Omnichannel booking", icon: Calendar },
  { id: "notes", label: "AI clinical notes", icon: FileText },
  { id: "reception", label: "Voice receptionist", icon: Phone },
  { id: "billing", label: "Billing & claims", icon: CreditCard },
  { id: "analytics", label: "Analytics & insights", icon: BarChart3 },
  { id: "compliance", label: "HIPAA / compliance", icon: ShieldCheck },
];

const recommendations: Record<
  Persona,
  { plan: string; price: string; hours: number; revenue: string; modules: string[] }
> = {
  doctor: {
    plan: "Solo",
    price: "₹999/mo",
    hours: 14,
    revenue: "+₹3.2k",
    modules: ["AI SOAP notes", "Smart calendar", "Stripe billing", "AI Prescription"],
  },
  clinic: {
    plan: "Clinic",
    price: "₹1,499/mo",
    hours: 96,
    revenue: "+₹28k",
    modules: [
      "Multi-provider scheduling",
      "Voice receptionist",
      "Claims automation",
      "Team analytics",
      "Inventory",
    ],
  },
  hospital: {
    plan: "Enterprise",
    price: "Custom",
    hours: 1240,
    revenue: "+₹410k",
    modules: [
      "Multi-tenant org tree",
      "HL7 / FHIR integrations",
      "RBAC + audit logs",
      "Bed & OT management",
      "Custom AI workflows",
      "SLA & dedicated CSM",
    ],
  },
};

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Priority[]>([]);

  const personaData = personas.find((p) => p.id === persona);
  const rec = persona ? recommendations[persona] : null;

  const canNext = useMemo(() => {
    if (step === 0) return !!persona;
    if (step === 1) return !!specialty && !!size;
    if (step === 2) return chosen.length > 0;
    return true;
  }, [step, persona, specialty, size, chosen]);

  const togglePriority = (id: Priority) => {
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };

  const reset = () => {
    setStep(0);
    setPersona(null);
    setSpecialty(null);
    setSize(null);
    setChosen([]);
  };

  return (
    <section
      id="onboarding"
      className="relative mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 lg:px-8"
    >
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1 text-xs font-medium text-teal-700 dark:text-teal-300">
          <Sparkles className="h-3.5 w-3.5" />
          Personalize in 30 seconds
        </div>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          See BookMyTime built for{" "}
          <span className="text-gradient-brand">your practice</span>
        </h2>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          Answer 3 quick questions and we'll tailor the platform, plan, and ROI
          to your workflow.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50">
        {/* Progress */}
        <div className="flex items-center justify-between border-b border-zinc-200/70 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ring-1 transition-all ${
                    i < step
                      ? "bg-teal-600 text-white ring-teal-600"
                      : i === step
                        ? "bg-teal-50 text-teal-700 ring-teal-500 dark:bg-teal-500/10 dark:text-teal-300"
                        : "bg-zinc-50 text-zinc-400 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
                  }`}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                {i < 3 && (
                  <div
                    className={`h-px w-8 sm:w-14 transition-colors ${
                      i < step ? "bg-teal-600" : "bg-zinc-200 dark:bg-zinc-800"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <span className="text-xs text-zinc-500">
            Step {Math.min(step + 1, 3)} of 3
          </span>
        </div>

        <div className="relative min-h-[420px] p-6 sm:p-10">
          <AnimatePresence mode="wait">
            {/* STEP 0: persona */}
            {step === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
              >
                <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  Which best describes you?
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  We'll adapt every module to your scale and team structure.
                </p>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  {personas.map((p) => {
                    const Icon = p.icon;
                    const selected = persona === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPersona(p.id);
                          setSpecialty(null);
                          setSize(null);
                        }}
                        className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition-all ${
                          selected
                            ? "border-teal-500 bg-gradient-to-br ring-2 ring-teal-500/30 " +
                              p.accent
                            : "border-zinc-200 bg-white hover:border-teal-300 dark:border-zinc-800 dark:bg-zinc-950"
                        }`}
                      >
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                            selected
                              ? "bg-teal-600 text-white"
                              : "bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="mt-4 font-semibold text-zinc-900 dark:text-zinc-50">
                          {p.title}
                        </div>
                        <div className="mt-1 text-sm text-zinc-500">
                          {p.subtitle}
                        </div>
                        {selected && (
                          <motion.div
                            layoutId="persona-check"
                            className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-white"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </motion.div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* STEP 1: specialty + size */}
            {step === 1 && personaData && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
              >
                <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  Tell us about your {personaData.title.toLowerCase()}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Pick a specialty and team size — this shapes templates and
                  pricing.
                </p>

                <div className="mt-6">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Specialty
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {personaData.specialties.map((s) => {
                      const Icon = s.icon;
                      const sel = specialty === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSpecialty(s.id)}
                          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all ${
                            sel
                              ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"
                              : "border-zinc-200 bg-white text-zinc-700 hover:border-teal-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-8">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Team size
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {personaData.sizes.map((s) => {
                      const sel = size === s;
                      return (
                        <button
                          key={s}
                          onClick={() => setSize(s)}
                          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition-all ${
                            sel
                              ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"
                              : "border-zinc-200 bg-white text-zinc-700 hover:border-teal-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            {s}
                          </span>
                          {sel && <Check className="h-4 w-4 text-teal-600" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 2: priorities */}
            {step === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
              >
                <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  What should we automate first?
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Pick everything that hurts today. We'll prioritize them in
                  onboarding.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {priorities.map((p) => {
                    const Icon = p.icon;
                    const sel = chosen.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => togglePriority(p.id)}
                        className={`flex items-center gap-3 rounded-xl border p-4 text-left text-sm transition-all ${
                          sel
                            ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"
                            : "border-zinc-200 bg-white text-zinc-700 hover:border-teal-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                            sel
                              ? "bg-teal-600 text-white"
                              : "bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"
                          }`}
                        >
                          <Icon className="h-4.5 w-4.5" />
                        </span>
                        <span className="font-medium">{p.label}</span>
                        {sel && (
                          <Check className="ml-auto h-4 w-4 text-teal-600" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* STEP 3: result */}
            {step === 3 && rec && personaData && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex items-center gap-2 text-xs font-medium text-teal-600 dark:text-teal-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  Tailored for you
                </div>
                <h3 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                  BookMyTime{" "}
                  <span className="text-gradient-brand">{rec.plan}</span> is the
                  right fit
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Based on a {personaData.title.toLowerCase()} ({size}) focused
                  on {chosen.length} workflow{chosen.length === 1 ? "" : "s"}.
                </p>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <ResultCard
                    icon={Clock}
                    label="Admin hours saved / month"
                    value={`${rec.hours}h`}
                    accent="teal"
                  />
                  <ResultCard
                    icon={TrendingUp}
                    label="Net revenue lift / month"
                    value={rec.revenue}
                    accent="emerald"
                  />
                  <ResultCard
                    icon={CreditCard}
                    label="Starting at"
                    value={rec.price}
                    accent="cyan"
                  />
                </div>

                <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Included modules
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {rec.modules.map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
                      >
                        <Check className="h-3 w-3 text-teal-600" />
                        {m}
                      </span>
                    ))}
                    {chosen.map((c) => {
                      const p = priorities.find((x) => x.id === c)!;
                      return (
                        <span
                          key={c}
                          className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 ring-1 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30"
                        >
                          <p.icon className="h-3 w-3" />
                          {p.label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="/contact"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
                  >
                    Book a tailored demo
                    <ArrowRight className="h-4 w-4" />
                  </a>
                  <button
                    onClick={reset}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Start over
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer nav */}
        {step < 3 && (
          <div className="flex items-center justify-between border-t border-zinc-200/70 px-6 py-4 dark:border-zinc-800">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              onClick={() => canNext && setStep((s) => s + 1)}
              disabled={!canNext}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {step === 2 ? "See my plan" : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ResultCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  accent: "teal" | "emerald" | "cyan";
}) {
  const accents: Record<string, string> = {
    teal: "from-teal-500/10 to-teal-500/0 text-teal-700 dark:text-teal-300",
    emerald:
      "from-emerald-500/10 to-emerald-500/0 text-emerald-700 dark:text-emerald-300",
    cyan: "from-cyan-500/10 to-cyan-500/0 text-cyan-700 dark:text-cyan-300",
  };
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br p-5 dark:border-zinc-800 ${accents[accent]}`}
    >
      <Icon className="h-5 w-5 opacity-80" />
      <div className="mt-3 text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs font-medium text-zinc-500">{label}</div>
    </div>
  );
}
