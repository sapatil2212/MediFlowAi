import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import { HowItWorks } from "@/components/site/HowItWorks";
import {
  Hero,
  LogosMarquee,
  Stats,
  BenefitsSection,
  BeforeAfter,
  AIFlowSection,
  SpecialtiesSection,
  Testimonials,
  CTA,
  QRShowcase,
  WhatsAppSection,
} from "@/components/site/sections";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MediFlow AI — The AI operating system for modern medicine" },
      {
        name: "description",
        content:
          "Cut admin work by 73%. AI clinical notes, voice receptionist, omnichannel booking, billing and analytics for clinics, hospitals, dental and aesthetic centers.",
      },
      {
        property: "og:title",
        content: "MediFlow AI — Clinical intelligence for modern medicine",
      },
      {
        property: "og:description",
        content:
          "Unified AI operating system for multi-tenant medical groups. Reduce admin load by 73%, see more patients, write zero notes.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <SiteShell>
      <Nav />
      <Hero />
      <LogosMarquee />
      <Stats />
      <BenefitsSection />
      <BeforeAfter />
      <HowItWorks />
      <QRShowcase />
      <WhatsAppSection />
      <AIFlowSection />
      <SpecialtiesSection />
      <Testimonials />
      <CTA />
    </SiteShell>
  );
}
