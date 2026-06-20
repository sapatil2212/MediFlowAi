import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { CTA } from "@/components/site/sections";
import {
  Play,
  Pause,
  PhoneCall,
  Mic,
  CalendarCheck2,
  FileText,
  CreditCard,
  Sparkles,
  Check,
  Bot,
  User,
} from "lucide-react";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Live demo — MediFlow AI" },
      {
        name: "description",
        content:
          "Watch MediFlow handle a real patient call, book the appointment, draft the SOAP note, and send the invoice — in 90 seconds.",
      },
      { property: "og:title", content: "Live demo — MediFlow AI" },
      {
        property: "og:description",
        content:
          "Interactive walkthrough of the AI voice receptionist, scribe, and billing.",
      },
    ],
  }),
  component: DemoPage,
});

const transcript: { role: "patient" | "ai"; text: string; t: number }[] = [
  { role: "patient", t: 0, text: "Hi, I'd like to book an appointment with Dr. Rao for next week." },
  { role: "ai", t: 1, text: "Of course. I can offer Tuesday 2:30pm or Thursday 11am. Which works?" },
  { role: "patient", t: 2, text: "Thursday 11 works." },
  { role: "ai", t: 3, text: "Booked. I've sent a WhatsApp confirmation and a pre-visit intake form." },
  { role: "patient", t: 4, text: "Perfect, thanks." },
  { role: "ai", t: 5, text: "Anything else? I can also remind you 24h before." },
];

const steps = [
  { icon: PhoneCall, label: "Call answered", t: 0 },
  { icon: CalendarCheck2, label: "Slot booked", t: 3 },
  { icon: FileText, label: "Intake sent", t: 4 },
  { icon: CreditCard, label: "Pre-auth captured", t: 5 },
];

function DemoPage() {
  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setTick((t) => (t >= transcript.length - 1 ? 0 : t + 1));
    }, 1800);
    return () => clearInterval(id);
  }, [playing]);

  const visible = transcript.slice(0, tick + 1);
  const completed = steps.filter((s) => s.t <= tick).length;

  return (
    <SiteShell>
      <Nav />
      <section className="relative overflow-hidden border-b border-zinc-200">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute inset-0 bg-radial-fade" />
        <div className="relative mx-auto max-w-6xl px-6 py-16 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1 text-xs font-medium text-teal-700">
            <Sparkles className="h-3.5 w-3.5" /> 90-second interactive demo
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl text-5xl font-bold tracking-tight text-zinc-900 sm:text-6xl">
            See MediFlow{" "}
            <span className="text-gradient-brand">run a real patient call</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">
            No signup. Press play and watch the AI receptionist book, intake,
            and bill — exactly as it does in production.
          </p>
        </div>
      </section>

      {/* Player */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
          {/* Top bar */}
          <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              Live · Inbound call from +1 (415) 555 0142
            </div>
            <button
              onClick={() => setPlaying((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? "Pause" : "Play"}
            </button>
          </div>

          <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
            {/* Transcript */}
            <div className="min-h-[420px] space-y-3 p-6">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Mic className="h-3.5 w-3.5 text-emerald-400" /> Transcript
              </div>
              <AnimatePresence initial={false}>
                {visible.map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`flex max-w-[80%] gap-3 ${
                      m.role === "ai" ? "ml-auto flex-row-reverse" : ""
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        m.role === "ai"
                          ? "bg-teal-500/20 text-teal-300"
                          : "bg-white/10 text-zinc-200"
                      }`}
                    >
                      {m.role === "ai" ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        m.role === "ai"
                          ? "bg-teal-500/15 text-teal-50"
                          : "bg-white/5 text-zinc-100"
                      }`}
                    >
                      {m.text}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Voice waveform */}
              <div className="mt-6 flex items-end justify-center gap-1">
                {Array.from({ length: 32 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-gradient-to-t from-teal-500 to-emerald-300"
                    style={{
                      height: `${
                        playing
                          ? 6 + Math.abs(Math.sin((tick + i) * 0.6)) * 26
                          : 6
                      }px`,
                      transition: "height 200ms ease-out",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Sidebar workflow */}
            <div className="border-t border-white/5 bg-black/20 p-6 lg:border-l lg:border-t-0">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                What's happening
              </div>
              <div className="mt-4 space-y-3">
                {steps.map((s, i) => {
                  const done = i < completed;
                  const active = i === completed - 1;
                  return (
                    <div
                      key={s.label}
                      className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${
                        done
                          ? "border-teal-500/40 bg-teal-500/10"
                          : "border-white/5 bg-white/5"
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                          done
                            ? "bg-teal-500 text-white"
                            : "bg-white/10 text-zinc-400"
                        }`}
                      >
                        {done ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                      </div>
                      <div className="text-sm">
                        <div className={done ? "text-white" : "text-zinc-400"}>
                          {s.label}
                        </div>
                        {active && (
                          <div className="text-xs text-teal-300">running…</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-zinc-300">
                <div className="font-semibold text-white">SOAP draft</div>
                <div className="mt-2 leading-relaxed">
                  <span className="text-teal-300">S:</span> Patient requests
                  follow-up. No new symptoms reported.{" "}
                  <span className="text-teal-300">O:</span> Pending vitals at
                  visit. <span className="text-teal-300">A:</span> Routine
                  follow-up. <span className="text-teal-300">P:</span> Confirm
                  Thursday 11am, send intake.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics callout */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { v: "92%", l: "Calls resolved by AI" },
            { v: "1.4s", l: "Median response" },
            { v: "73%", l: "Less admin time" },
            { v: "0", l: "Missed bookings after hours" },
          ].map((s, i) => (
            <motion.div
              key={s.l}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border border-zinc-200 bg-white p-5 text-center"
            >
              <div className="text-3xl font-bold tracking-tight text-zinc-900">
                {s.v}
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {s.l}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <CTA />
    </SiteShell>
  );
}
