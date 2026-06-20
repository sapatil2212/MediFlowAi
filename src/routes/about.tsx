import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { CTA } from "@/components/site/sections";
import {
  Sparkles,
  HeartPulse,
  Globe2,
  Users,
  Lightbulb,
  ShieldCheck,
  Rocket,
  Award,
} from "lucide-react";
import doc1 from "@/assets/doctor-1.jpg";
import doc2 from "@/assets/doctor-2.jpg";
import doc3 from "@/assets/doctor-3.jpg";
import team from "@/assets/team.jpg";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — MediFlow AI" },
      {
        name: "description",
        content:
          "We're building the AI operating system that gives every clinician back time with patients. Meet the team behind MediFlow AI.",
      },
      { property: "og:title", content: "About MediFlow AI" },
      {
        property: "og:description",
        content:
          "Our mission: zero admin, full attention. Built by clinicians and AI engineers.",
      },
    ],
  }),
  component: AboutPage,
});

const values = [
  {
    icon: HeartPulse,
    title: "Patients first",
    desc: "Every feature is measured by minutes returned to the exam room.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy by design",
    desc: "HIPAA, SOC 2, ISO 27001. PHI never trains foundation models.",
  },
  {
    icon: Lightbulb,
    title: "Clinical truth",
    desc: "Built with practicing physicians — not a SaaS imagination of one.",
  },
  {
    icon: Globe2,
    title: "Global by default",
    desc: "Multilingual, multi-currency, multi-jurisdiction from day one.",
  },
];

const timeline = [
  { year: "2023", title: "Founded", desc: "Two doctors + three engineers in a garage in Bangalore." },
  { year: "2024", title: "First 100 clinics", desc: "Beta launch across 7 countries. 96% retention." },
  { year: "2025", title: "Series A", desc: "$28M to scale AI scribe + voice agent to hospitals." },
  { year: "2026", title: "1M patients served", desc: "Now powering 4,200 clinics in 31 countries." },
];

const stats = [
  { value: "4,200+", label: "Clinics live" },
  { value: "31", label: "Countries" },
  { value: "73%", label: "Less admin work" },
  { value: "4.9/5", label: "Clinician NPS" },
];

const leaders = [
  { name: "Dr. Anika Rao", role: "CEO & Co-founder", img: doc1, bio: "Internal medicine, ex-Mayo Clinic." },
  { name: "Marcus Chen", role: "CTO & Co-founder", img: doc2, bio: "Former staff ML at DeepMind Health." },
  { name: "Dr. Lena Park", role: "Chief Medical Officer", img: doc3, bio: "20 years in hospital operations." },
];

function AboutPage() {
  return (
    <SiteShell>
      <Nav />
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute inset-0 bg-radial-fade" />
        <div className="relative mx-auto max-w-6xl px-6 py-24 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1 text-xs font-medium text-teal-700"
          >
            <Sparkles className="h-3.5 w-3.5" /> Our story
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mx-auto mt-5 max-w-3xl text-5xl font-bold tracking-tight text-zinc-900 sm:text-6xl"
          >
            Built by clinicians.{" "}
            <span className="text-gradient-brand">Powered by AI.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mx-auto mt-5 max-w-2xl text-lg text-zinc-600"
          >
            MediFlow AI exists for one reason: give every clinician back the
            hours they lose to paperwork — so they can spend them on people.
          </motion.p>
        </div>
      </section>

      {/* Stats strip */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-4 rounded-3xl border border-zinc-200 bg-white p-6 sm:grid-cols-4">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="text-center"
            >
              <div className="text-3xl font-bold tracking-tight text-zinc-900">
                {s.value}
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {s.label}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Mission + photo */}
      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-24 lg:grid-cols-2 lg:items-center">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-teal-600">
            Our mission
          </div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-zinc-900">
            A world where doctors never write a chart at 11pm.
          </h2>
          <p className="mt-4 text-zinc-600">
            Clinicians spend up to 49% of their workday on paperwork. That's
            not what they trained for. We're rebuilding the entire admin layer
            of healthcare with an AI native architecture — multi-tenant, voice
            first, and embedded in every workflow from booking to billing.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {[
              { i: Rocket, t: "Ship weekly" },
              { i: Users, t: "Built with 500+ physicians" },
              { i: Award, t: "HIMSS 2025 Innovator" },
              { i: ShieldCheck, t: "Zero PHI in model training" },
            ].map((x) => (
              <div
                key={x.t}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
              >
                <x.i className="h-4 w-4 text-teal-600" />
                {x.t}
              </div>
            ))}
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative aspect-[4/3] overflow-hidden rounded-3xl ring-1 ring-zinc-200"
        >
          <img src={team} alt="MediFlow team" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-tr from-teal-900/30 via-transparent to-transparent" />
        </motion.div>
      </section>

      {/* Values */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-center text-3xl font-bold tracking-tight text-zinc-900">
          What we believe
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v, i) => (
            <motion.div
              key={v.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="group rounded-2xl border border-zinc-200 bg-white p-5 transition-colors hover:border-teal-300"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700 transition-colors group-hover:bg-teal-600 group-hover:text-white">
                <v.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold text-zinc-900">{v.title}</h3>
              <p className="mt-1 text-sm text-zinc-600">{v.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Timeline */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="text-center text-3xl font-bold tracking-tight text-zinc-900">
          Three years, one focus
        </h2>
        <div className="relative mt-12">
          <div className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-gradient-to-b from-teal-200 via-teal-400 to-teal-200 md:block" />
          <div className="space-y-12">
            {timeline.map((t, i) => (
              <motion.div
                key={t.year}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className={`relative md:grid md:grid-cols-2 md:gap-12 ${
                  i % 2 === 0 ? "" : "md:[&>*:first-child]:order-2"
                }`}
              >
                <div className={`md:text-right ${i % 2 === 0 ? "" : "md:text-left"}`}>
                  <div className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
                    {t.year}
                  </div>
                  <h3 className="mt-3 text-xl font-semibold text-zinc-900">
                    {t.title}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-600">{t.desc}</p>
                </div>
                <div className="hidden md:block" />
                <div className="absolute left-1/2 top-2 hidden h-3 w-3 -translate-x-1/2 rounded-full bg-teal-600 ring-4 ring-white md:block" />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Leaders */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-center text-3xl font-bold tracking-tight text-zinc-900">
          Led by builders who've shipped at scale
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {leaders.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <img src={p.img} alt={p.name} className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" />
              </div>
              <div className="p-5">
                <div className="font-semibold text-zinc-900">{p.name}</div>
                <div className="text-sm text-teal-700">{p.role}</div>
                <p className="mt-2 text-sm text-zinc-600">{p.bio}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <CTA />
    </SiteShell>
  );
}
