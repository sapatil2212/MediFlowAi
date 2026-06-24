import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";
import {
  Pricing,
  FAQ,
  CTA,
} from "@/components/site/sections";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — BookMyTime" },
      {
        name: "description",
        content:
          "Transparent pricing for solo practices, multi-location clinics, and hospital networks. 14-day free trial, no credit card.",
      },
      { property: "og:title", content: "BookMyTime — Pricing" },
      {
        property: "og:description",
        content: "Predictable as your network grows",
      },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <SiteShell>
      <Nav />
      <Pricing />
      <FAQ />
      <CTA />
    </SiteShell>
  );
}
