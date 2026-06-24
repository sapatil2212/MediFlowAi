import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [{ title: "Refund Policy — BookMyTime" }],
  }),
  component: RefundPage,
});

function RefundPage() {
  return (
    <SiteShell>
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 mb-8">Refund Policy</h1>
        <div className="prose prose-zinc prose-sm sm:prose-base text-zinc-600">
          <p className="text-sm text-zinc-500 mb-8">Last Updated: June 2026</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Free Trial</h2>
          <p className="mb-6">All new users receive a 14-day free trial to evaluate the platform before purchasing.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Subscription Payments</h2>
          <p className="mb-6">Monthly and annual subscription payments are generally non-refundable once processed.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Eligible Refund Cases</h2>
          <p>Refunds may be considered if:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Duplicate payments occurred</li>
            <li>Billing errors were identified</li>
            <li>Service activation failed due to a verified platform issue</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Cancellation</h2>
          <p className="mb-6">Users may cancel subscriptions at any time. Access remains active until the end of the current billing cycle.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Refund Processing</h2>
          <p className="mb-6">Approved refunds are processed within 7–10 business days through the original payment method.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Contact</h2>
          <p>For billing and refund assistance:</p>
          
          <div className="mt-6">
            <h3 className="font-semibold text-zinc-900">Email</h3>
            <p>
              <a href="mailto:bookmytime1355@gmail.com" className="text-brand hover:underline" style={{ color: "#0059C6" }}>
                bookmytime1355@gmail.com
              </a>
            </p>
            <p className="text-sm text-zinc-500 mt-1">Confirmation and follow-up land here too</p>
          </div>
          
          <div className="mt-4">
            <h3 className="font-semibold text-zinc-900">Call or WhatsApp</h3>
            <p>
              <a href="tel:+919168081355" className="text-brand hover:underline" style={{ color: "#0059C6" }}>
                +91 9168 08 1355
              </a>
            </p>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
