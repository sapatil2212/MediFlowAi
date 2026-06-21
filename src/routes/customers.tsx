import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import {
  PageHeader,
  Testimonials,
  Stats,
  LogosMarquee,
  CTA,
} from "@/components/site/sections";
import { motion } from "motion/react";
import { TrendingUp, Clock, Users } from "lucide-react";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers — BookMyTime" },
      {
        name: "description",
        content:
          "4,200+ practices in 38 countries trust BookMyTime. Read real stories from clinics that cut admin work by 73% and grew throughput by 38%.",
      },
      { property: "og:title", content: "BookMyTime — Customer stories" },
      {
        property: "og:description",
        content: "Real metrics from real clinics using BookMyTime.",
      },
    ],
  }),
  component: CustomersPage,
});

const cases = [
  {
    name: "Mercy Health Group",
    type: "12 clinics · Primary care",
    quote:
      "After 90 days on BookMyTime, our providers reclaimed 22 hours per week and our front desk never picks up an insurance call again.",
    metrics: [
      { icon: TrendingUp, v: "+38%", l: "patient throughput" },
      { icon: Clock, v: "22h", l: "saved per provider / wk" },
      { icon: Users, v: "184k", l: "AI calls handled" },
    ],
  },
  {
    name: "BrightSmile Network",
    type: "14 dental clinics",
    quote:
      "Rolled out across 14 clinics in 9 days. No-shows dropped from 11% to 3.1%. Treatment plan acceptance jumped 19 points.",
    metrics: [
      { icon: TrendingUp, v: "+19pt", l: "plan acceptance" },
      { icon: Clock, v: "-58%", l: "no-show rate" },
      { icon: Users, v: "9 days", l: "to full rollout" },
    ],
  },
  {
    name: "Apollo Specialty Clinics",
    type: "Multi-specialty group",
    quote:
      "The AI receptionist handles 71% of inbound. Our three front-desk staff became revenue cycle specialists — and we recovered $184k in year one.",
    metrics: [
      { icon: TrendingUp, v: "$184k", l: "recovered Y1" },
      { icon: Clock, v: "71%", l: "calls automated" },
      { icon: Users, v: "3 → 0", l: "front-desk hires" },
    ],
  },
];

function CustomersPage() {
  return (
    <SiteShell>
      <Nav />
      <PageHeader
        eyebrow="CUSTOMERS"
        title="Real clinics."
        highlight="Real numbers."
        subtitle="The metrics below come straight from production tenants — anonymized only where they asked."
      />
      <Stats />
      <section className="bg-zinc-50 py-24">
        <div className="mx-auto max-w-7xl space-y-6 px-6">
          {cases.map((c, i) => (
            <motion.article
              key={c.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="grid gap-8 rounded-3xl border border-zinc-950/5 bg-white p-8 md:grid-cols-[2fr_3fr] md:p-12"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand">
                  Case study {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight">{c.name}</h3>
                <p className="mt-1 text-xs text-zinc-500">{c.type}</p>
                <blockquote className="mt-6 text-lg leading-relaxed text-zinc-800">
                  "{c.quote}"
                </blockquote>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {c.metrics.map((m) => (
                  <div
                    key={m.l}
                    className="flex flex-col rounded-2xl border border-zinc-950/5 bg-gradient-to-br from-brand/5 to-cyan-50/40 p-5"
                  >
                    <m.icon className="size-5 text-brand" />
                    <p className="mt-3 text-2xl font-semibold tracking-tight">{m.v}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">{m.l}</p>
                  </div>
                ))}
              </div>
            </motion.article>
          ))}
        </div>
      </section>
      <Testimonials />
      <LogosMarquee />
      <CTA />
    </SiteShell>
  );
}
