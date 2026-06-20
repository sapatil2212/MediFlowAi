import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import {
  PageHeader,
  SolutionsGrid,
  SpecialtiesSection,
  Testimonials,
  CTA,
} from "@/components/site/sections";

export const Route = createFileRoute("/solutions")({
  head: () => ({
    meta: [
      { title: "Solutions — MediFlow AI" },
      {
        name: "description",
        content:
          "Tailored deployments for solo practitioners, multi-location clinics, hospitals, dental groups, aesthetic centers and diagnostic labs.",
      },
      { property: "og:title", content: "MediFlow AI — Solutions" },
      {
        property: "og:description",
        content:
          "From a single doctor to a 200-location hospital network — one AI platform that flexes to your practice.",
      },
    ],
  }),
  component: SolutionsPage,
});

function SolutionsPage() {
  return (
    <SiteShell>
      <Nav />
      <PageHeader
        eyebrow="SOLUTIONS"
        title="Built for every kind of"
        highlight="medical practice"
        subtitle="Whether you're one provider or two hundred, MediFlow flexes to your workflows, your specialty, and your IT constraints."
      />
      <SolutionsGrid />
      <SpecialtiesSection />
      <Testimonials />
      <CTA />
    </SiteShell>
  );
}
