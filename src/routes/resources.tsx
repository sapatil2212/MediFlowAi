import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { CTA } from "@/components/site/sections";
import {
  BookOpen,
  Newspaper,
  GraduationCap,
  Video,
  Search,
  ArrowRight,
  Clock,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/resources")({
  head: () => ({
    meta: [
      { title: "Resources — MediFlow AI" },
      {
        name: "description",
        content:
          "Guides, customer stories, product updates, and on-demand webinars for healthcare operators.",
      },
      { property: "og:title", content: "Resources — MediFlow AI" },
      {
        property: "og:description",
        content:
          "Everything you need to scale your practice with AI — written by clinicians and operators.",
      },
    ],
  }),
  component: ResourcesPage,
});

type Kind = "All" | "Guide" | "Article" | "Webinar" | "Case study";

const kinds: { id: Kind; icon: typeof BookOpen }[] = [
  { id: "All", icon: Sparkles },
  { id: "Guide", icon: BookOpen },
  { id: "Article", icon: Newspaper },
  { id: "Webinar", icon: Video },
  { id: "Case study", icon: GraduationCap },
];

const posts: {
  title: string;
  kind: Exclude<Kind, "All">;
  excerpt: string;
  read: string;
  author: string;
  tag: string;
  gradient: string;
}[] = [
  {
    title: "The 2026 State of AI in Healthcare Operations",
    kind: "Guide",
    excerpt:
      "We surveyed 1,200 clinics on AI adoption, ROI, and what's actually working.",
    read: "18 min",
    author: "Dr. Anika Rao",
    tag: "Featured",
    gradient: "from-teal-500 to-emerald-500",
  },
  {
    title: "How Sunrise Dental cut no-shows by 64% in 60 days",
    kind: "Case study",
    excerpt:
      "WhatsApp reminders + AI voice confirmations replaced their entire front desk.",
    read: "6 min",
    author: "Marcus Chen",
    tag: "Customer",
    gradient: "from-cyan-500 to-teal-500",
  },
  {
    title: "Designing a HIPAA-eligible AI scribe from scratch",
    kind: "Article",
    excerpt:
      "Inside the architecture decisions that keep PHI out of foundation models.",
    read: "12 min",
    author: "Engineering",
    tag: "Engineering",
    gradient: "from-emerald-500 to-teal-600",
  },
  {
    title: "Webinar: Multi-tenant ops for hospital networks",
    kind: "Webinar",
    excerpt:
      "Live walk-through with the COO of a 14-site cardiology network.",
    read: "45 min",
    author: "Dr. Lena Park",
    tag: "Live event",
    gradient: "from-teal-600 to-cyan-600",
  },
  {
    title: "Playbook: launching a med-spa chain in 30 days",
    kind: "Guide",
    excerpt:
      "Templates, automations, and SOPs for aesthetic centers from solo to scale.",
    read: "22 min",
    author: "Customer Success",
    tag: "Playbook",
    gradient: "from-emerald-400 to-teal-500",
  },
  {
    title: "Why we ditched per-seat pricing for hospital plans",
    kind: "Article",
    excerpt:
      "The pricing experiment that took us from 22 to 4,200 clinics.",
    read: "5 min",
    author: "Marcus Chen",
    tag: "Product",
    gradient: "from-teal-500 to-cyan-500",
  },
];

function ResourcesPage() {
  const [active, setActive] = useState<Kind>("All");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return posts.filter((p) => {
      const matchKind = active === "All" || p.kind === active;
      const matchQ =
        !q ||
        p.title.toLowerCase().includes(q.toLowerCase()) ||
        p.excerpt.toLowerCase().includes(q.toLowerCase());
      return matchKind && matchQ;
    });
  }, [active, q]);

  const [featured, ...rest] = filtered;

  return (
    <SiteShell>
      <Nav />
      <section className="relative overflow-hidden border-b border-zinc-200">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute inset-0 bg-radial-fade" />
        <div className="relative mx-auto max-w-6xl px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1 text-xs font-medium text-teal-700">
            <BookOpen className="h-3.5 w-3.5" /> Resources
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl text-5xl font-bold tracking-tight text-zinc-900 sm:text-6xl">
            Learn from clinics already{" "}
            <span className="text-gradient-brand">running on AI</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">
            Field-tested playbooks, technical deep-dives, and customer stories
            from teams operating at the edge of modern healthcare.
          </p>

          <div className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-2 focus-within:border-teal-400">
            <Search className="ml-2 h-4 w-4 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search articles, guides, webinars..."
              className="w-full bg-transparent px-2 py-2 text-sm outline-none"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button
              key={k.id}
              onClick={() => setActive(k.id)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${
                active === k.id
                  ? "border-teal-500 bg-teal-600 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-teal-300"
              }`}
            >
              <k.icon className="h-3.5 w-3.5" />
              {k.id}
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500">
            No matches. Try a different filter.
          </div>
        )}

        {featured && (
          <motion.article
            layout
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-10 grid overflow-hidden rounded-3xl border border-zinc-200 bg-white lg:grid-cols-2"
          >
            <div className={`relative flex min-h-[260px] items-end bg-gradient-to-br ${featured.gradient} p-8 text-white`}>
              <div className="absolute inset-0 bg-grid opacity-20" />
              <div className="relative">
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide backdrop-blur">
                  {featured.tag}
                </span>
                <h2 className="mt-4 text-3xl font-bold leading-tight">
                  {featured.title}
                </h2>
              </div>
            </div>
            <div className="flex flex-col justify-between p-8">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-teal-700">
                  {featured.kind}
                </div>
                <p className="mt-3 text-zinc-700">{featured.excerpt}</p>
              </div>
              <div className="mt-6 flex items-center justify-between text-sm text-zinc-500">
                <span>{featured.author}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {featured.read}
                </span>
              </div>
              <Link
                to="/contact"
                className="mt-6 inline-flex w-fit items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Read the report <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.article>
        )}

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((p, i) => (
            <motion.article
              key={p.title}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white transition-all hover:-translate-y-0.5 hover:border-teal-300"
            >
              <div className={`relative h-32 bg-gradient-to-br ${p.gradient}`}>
                <div className="absolute inset-0 bg-grid opacity-20" />
                <span className="absolute right-3 top-3 rounded-full bg-white/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
                  {p.kind}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h3 className="text-base font-semibold text-zinc-900 group-hover:text-teal-700">
                  {p.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-600">{p.excerpt}</p>
                <div className="mt-auto flex items-center justify-between pt-4 text-xs text-zinc-500">
                  <span>{p.author}</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {p.read}
                  </span>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      {/* Newsletter */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-3xl border border-zinc-200 bg-gradient-to-br from-teal-600 to-emerald-600 p-10 text-white">
          <div className="grid items-center gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">
                The Friday Chart Note
              </h2>
              <p className="mt-2 text-white/80">
                One short email every Friday. Trends, playbooks, and one
                interesting clinic story. Read in 3 minutes.
              </p>
            </div>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex gap-2 rounded-xl bg-white/10 p-2 ring-1 ring-white/20 backdrop-blur"
            >
              <input
                type="email"
                placeholder="you@clinic.com"
                className="w-full bg-transparent px-3 py-2 text-sm text-white placeholder-white/60 outline-none"
              />
              <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-zinc-100">
                Subscribe
              </button>
            </form>
          </div>
        </div>
      </section>

      <CTA />
    </SiteShell>
  );
}
