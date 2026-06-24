import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [{ title: "Terms of Service — BookMyTime" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <SiteShell>
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 mb-8">Terms of Service</h1>
        <div className="prose prose-zinc prose-sm sm:prose-base text-zinc-600">
          <p className="text-sm text-zinc-500 mb-8">Last Updated: June 2026</p>

          <p>By accessing or using BookMyTime, you agree to these Terms of Service.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Service Usage</h2>
          <p>Users agree to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Provide accurate information</li>
            <li>Maintain account security</li>
            <li>Use the platform lawfully</li>
            <li>Avoid misuse or unauthorized access</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Account Responsibility</h2>
          <p className="mb-6">You are responsible for all activities conducted under your account.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Subscription & Billing</h2>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Subscription fees are billed according to the selected plan.</li>
            <li>Fees are non-transferable.</li>
            <li>Plans may be upgraded or downgraded at any time.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Platform Availability</h2>
          <p className="mb-6">While we strive for maximum uptime, BookMyTime does not guarantee uninterrupted service availability.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Intellectual Property</h2>
          <p className="mb-6">All platform content, branding, software, and technology remain the property of BookMyTime.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Termination</h2>
          <p className="mb-6">We reserve the right to suspend or terminate accounts violating these terms.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Limitation of Liability</h2>
          <p className="mb-6">BookMyTime shall not be liable for indirect, incidental, or consequential damages arising from platform use.</p>
        </div>
      </div>
    </SiteShell>
  );
}
