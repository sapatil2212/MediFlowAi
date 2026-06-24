import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: "Privacy Policy — BookMyTime" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <SiteShell>
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 mb-8">Privacy Policy</h1>
        <div className="prose prose-zinc prose-sm sm:prose-base text-zinc-600">
          <p className="text-sm text-zinc-500 mb-8">Last Updated: June 2026</p>

          <p>At BookMyTime, we value your privacy and are committed to protecting your personal information.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Information We Collect</h2>
          <p>We may collect:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Name and contact information</li>
            <li>Business information</li>
            <li>Appointment and booking details</li>
            <li>Payment-related information</li>
            <li>Device and browser information</li>
            <li>Usage analytics</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">How We Use Information</h2>
          <p>We use collected information to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Provide our services</li>
            <li>Process bookings and appointments</li>
            <li>Send notifications and reminders</li>
            <li>Improve platform performance</li>
            <li>Provide customer support</li>
            <li>Ensure platform security</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Data Security</h2>
          <p className="mb-6">We implement industry-standard security measures to protect your data against unauthorized access, disclosure, or misuse.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Third-Party Services</h2>
          <p>BookMyTime may integrate with services such as:</p>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>WhatsApp Business</li>
            <li>Google Services</li>
            <li>Payment Providers</li>
            <li>Analytics Platforms</li>
          </ul>
          <p className="mb-6">These providers maintain their own privacy policies.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Your Rights</h2>
          <p>You may request:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Access to your data</li>
            <li>Correction of information</li>
            <li>Data deletion</li>
            <li>Account closure</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Contact</h2>
          <p>For privacy-related concerns, contact:<br />
            <a href="mailto:bookmytime1355@gmail.com" className="text-brand hover:underline font-medium" style={{ color: "#0059C6" }}>bookmytime1355@gmail.com</a></p>
        </div>
      </div>
    </SiteShell>
  );
}
