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
  Testimonials,
  CTA,
  QRShowcase,
  WhatsAppSection,
  BuiltForSection,
} from "@/components/site/sections";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BookMyTime — Multi-Tenant AI Booking System & CRM for Indian Businesses" },
      {
        name: "description",
        content:
          "Cut scheduling overhead by 85%. Automated multi-tenant booking portals, WhatsApp reminders, AI customer assistant, and smart CRM for clinics, salons, gyms, and coaching institutes across India.",
      },
      {
        property: "og:title",
        content: "BookMyTime — Multi-Tenant AI Booking System & CRM",
      },
      {
        property: "og:description",
        content:
          "Launch custom-branded booking portals in 5 minutes. Streamline calendars, send automated WhatsApp updates, and manage customers across multiple branches.",
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
      <BuiltForSection />
      <Testimonials />
      <CTA />
    </SiteShell>
  );
}


