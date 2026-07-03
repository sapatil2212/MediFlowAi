import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [{ title: "Refund & Cancellation Policy — BookMyTime" }],
  }),
  component: RefundPage,
});

function RefundPage() {
  return (
    <SiteShell>
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 mb-8">
          Refund &amp; Cancellation Policy
        </h1>
        <div className="prose prose-zinc prose-sm sm:prose-base text-zinc-600">
          <p className="text-sm text-zinc-500 mb-2">Effective Date: July 1, 2026</p>
          <p className="text-sm text-zinc-500 mb-8">Last Updated: July 1, 2026</p>

          <p className="mb-4">
            BookMyTime ("BookMyTime", "we", "our", or "us") is committed to providing high-quality
            appointment scheduling and business management software. This Refund &amp; Cancellation Policy
            explains how subscription cancellations and refunds are handled for all services offered
            through the BookMyTime platform.
          </p>
          <p className="mb-6">
            By purchasing any subscription or paid service from BookMyTime, you agree to this Refund &amp;
            Cancellation Policy.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">1. Nature of Services</h2>
          <p>
            BookMyTime is a Software-as-a-Service (SaaS) platform that provides digital services, including
            but not limited to:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Online Appointment Booking</li>
            <li>Business Management</li>
            <li>Staff Scheduling</li>
            <li>Customer Management</li>
            <li>Calendar Management</li>
            <li>Notification Services</li>
            <li>Subscription-Based Software Access</li>
          </ul>
          <p className="mb-6">
            Since BookMyTime provides digital services, no physical goods are shipped.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">2. Subscription Plans</h2>
          <p>BookMyTime offers various subscription plans, including:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Monthly Plans</li>
            <li>Quarterly Plans</li>
            <li>Annual Plans</li>
            <li>Enterprise Plans</li>
            <li>Custom Business Plans</li>
          </ul>
          <p className="mb-6">
            Subscription details, pricing, billing cycle, and included features are displayed before
            payment.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">3. Cancellation Policy</h2>
          <p>Customers may cancel their subscription at any time through:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Their BookMyTime account dashboard, where available, or</li>
            <li>By contacting our support team via email.</li>
          </ul>
          <p>Once a subscription is cancelled:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Access to premium features will remain active until the end of the current billing period.</li>
            <li>No further recurring charges will be made after the current subscription period expires.</li>
            <li>Cancellation does not automatically generate a refund unless eligible under this policy.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">4. Refund Eligibility</h2>
          <p className="mb-2">Refund requests may be considered in the following situations:</p>
          <h3 className="text-base font-semibold mt-4 mb-2 text-zinc-900">Eligible Cases</h3>
          <p>A refund may be approved if:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>A customer is charged multiple times for the same subscription due to a technical error.</li>
            <li>
              Payment is successfully processed, but the subscription is not activated because of a
              verified system issue.
            </li>
            <li>An incorrect amount is charged due to a billing error caused by BookMyTime.</li>
            <li>Duplicate transactions occur because of payment gateway processing issues.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">5. Non-Refundable Situations</h2>
          <p>Refunds will generally not be provided in the following situations:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Change of mind after purchasing a subscription.</li>
            <li>Partial use or non-use of the platform.</li>
            <li>Failure to use available features.</li>
            <li>Lack of technical knowledge.</li>
            <li>Business closure.</li>
            <li>Internet connectivity issues.</li>
            <li>Device compatibility issues outside our stated requirements.</li>
            <li>Failure to cancel before automatic renewal.</li>
            <li>Violation of our Terms &amp; Conditions resulting in account suspension or termination.</li>
            <li>Subscription period has already expired.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">6. Free Trial</h2>
          <p className="mb-2">
            BookMyTime offers a 7-day free trial for all new users, allowing them to explore and evaluate
            the platform's features before purchasing a subscription.
          </p>
          <p className="mb-2">
            During the trial period, users can access eligible features without being charged. We encourage
            all users to thoroughly evaluate the platform during this period to ensure it meets their
            business requirements.
          </p>
          <p>At the end of the trial period:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Users may choose to subscribe to a paid plan to continue using premium features.</li>
            <li>If no subscription is purchased, access to premium features may be restricted or discontinued.</li>
            <li>No payment is collected during the free trial unless the user voluntarily purchases a subscription.</li>
          </ul>
          <p className="mb-6">
            Since users have the opportunity to fully evaluate the platform during the 7-day trial, refund
            requests based solely on feature expectations, change of mind, or non-usage after purchasing a
            subscription are generally not eligible.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">7. Refund Request Process</h2>
          <p>To request a refund, customers should contact us with:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Full Name</li>
            <li>Registered Email Address</li>
            <li>Transaction ID</li>
            <li>Payment Date</li>
            <li>Reason for Refund Request</li>
            <li>Supporting information, if applicable</li>
          </ul>
          <p className="mb-6">Requests may be submitted through our official support email.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">8. Refund Review</h2>
          <p className="mb-2">Each refund request is reviewed individually.</p>
          <p>BookMyTime reserves the right to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Request additional information.</li>
            <li>Verify payment details.</li>
            <li>Confirm account activity.</li>
            <li>Reject fraudulent or abusive refund requests.</li>
          </ul>
          <p className="mb-6">
            The decision made by BookMyTime after review shall be final, subject to applicable law.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">9. Refund Timeline</h2>
          <p>If a refund is approved:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Refunds will be initiated within 7 business days of approval.</li>
            <li>
              The credited amount may take additional time to reflect, depending on the payment method and
              banking institution.
            </li>
            <li>Processing times are controlled by the respective payment gateway or financial institution.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">10. Payment Gateway Charges</h2>
          <p className="mb-2">Where applicable:</p>
          <p className="mb-6">
            Payment gateway processing fees, taxes, or government charges that are non-refundable may be
            deducted from the refunded amount, if permitted by applicable law and disclosed during the
            refund process.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">11. Failed or Pending Transactions</h2>
          <p>If your payment fails or remains pending:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>No subscription will be activated until payment is successfully received.</li>
            <li>
              Any amount debited but not acknowledged due to a technical issue will be handled according to
              the payment gateway's reconciliation process.
            </li>
            <li>Customers are encouraged to wait for confirmation before attempting another payment.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">12. Automatic Renewal</h2>
          <p>For subscriptions with automatic renewal enabled:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Renewal charges will be processed automatically at the end of the billing cycle.</li>
            <li>Customers may disable automatic renewal before the renewal date to avoid future charges.</li>
            <li>
              Refunds will generally not be issued for renewal charges if cancellation was not completed
              before the renewal date.
            </li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">13. Account Termination</h2>
          <p>If an account is terminated due to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Fraudulent activity</li>
            <li>Violation of Terms &amp; Conditions</li>
            <li>Abuse of the Platform</li>
            <li>Illegal activities</li>
          </ul>
          <p className="mb-6">
            No refund shall be provided for any unused portion of the subscription, unless required by
            applicable law.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">14. Exceptional Circumstances</h2>
          <p className="mb-2">
            BookMyTime may, at its sole discretion, approve refunds outside this policy in exceptional
            situations, including verified technical failures attributable to the platform.
          </p>
          <p className="mb-6">
            Such approvals are made on a case-by-case basis and do not establish a precedent for future
            requests.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">15. Changes to This Policy</h2>
          <p className="mb-2">
            BookMyTime reserves the right to modify this Refund &amp; Cancellation Policy at any time.
          </p>
          <p className="mb-2">
            Updated versions will be published on this page with the revised effective date.
          </p>
          <p className="mb-6">
            Continued use of the Platform after updates constitutes acceptance of the revised policy.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">16. Contact Us</h2>
          <p className="mb-2">For refund or cancellation requests, please contact:</p>
          <p className="mb-6">
            <strong className="text-zinc-900">BookMyTime Support</strong>
            <br />
            Email:{" "}
            <a
              href="mailto:bookmytime1355@gmail.com"
              className="text-brand hover:underline font-medium"
              style={{ color: "#0059C6" }}
            >
              bookmytime1355@gmail.com
            </a>
            <br />
            Website:{" "}
            <a
              href="https://bookmytime.tech"
              className="text-brand hover:underline font-medium"
              style={{ color: "#0059C6" }}
            >
              https://bookmytime.tech
            </a>
            <br />
            Call or WhatsApp:{" "}
            <a
              href="tel:+919168081355"
              className="text-brand hover:underline font-medium"
              style={{ color: "#0059C6" }}
            >
              +91 9168 08 1355
            </a>
            <br />
            Support Hours: Monday to Saturday, 9:00 AM – 6:00 PM (IST)
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Important Note</h2>
          <p className="mb-6">
            This policy applies only to subscriptions and services purchased directly through BookMyTime or
            its authorized payment partners.
          </p>
        </div>
      </div>
    </SiteShell>
  );
}
