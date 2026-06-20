import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import {
  PageHeader,
  FeatureBento,
  FeatureTabs,
  AIFlowSection,
  AnalyticsSection,
  IntegrationsGrid,
  CTA,
} from "@/components/site/sections";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Features — MediFlow AI" },
      {
        name: "description",
        content:
          "Explore MediFlow AI: ambient SOAP scribe, voice receptionist, autonomous billing, real-time analytics, telemedicine and 40+ integrations.",
      },
      { property: "og:title", content: "MediFlow AI — Features" },
      {
        property: "og:description",
        content:
          "Twelve modules. One database. AI scribe, voice agent, billing, telemedicine, analytics and more.",
      },
    ],
  }),
  component: FeaturesPage,
});

function FeaturesPage() {
  return (
    <SiteShell>
      <Nav />
      <PageHeader
        eyebrow="THE PLATFORM"
        title="Everything you need to run a modern practice,"
        highlight="in one workspace"
        subtitle="Twelve deeply-integrated modules — designed to replace your EMR, scheduler, receptionist, biller and analytics stack."
      />
      <FeatureTabs />
      <FeatureBento />
      <AIFlowSection />
      <AnalyticsSection />
      <IntegrationsGrid />
      <CTA />
    </SiteShell>
  );
}
