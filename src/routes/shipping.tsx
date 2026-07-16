import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";

export const Route = createFileRoute("/shipping")({
  head: () => ({
    meta: [{ title: "Shipping & Delivery Policy — BookMyTime" }],
  }),
  component: ShippingPage,
});

function ShippingPage() {
  return (
    <SiteShell>
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 mb-8">
          Shipping &amp; Delivery Policy
        </h1>
        <div className="prose prose-zinc prose-sm sm:prose-base text-zinc-600">
          <p className="text-sm text-zinc-500 mb-2">Effective Date: July 1, 2026</p>
          <p className="text-sm text-zinc-500 mb-2">Last Updated: July 1, 2026</p>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-8">
            A product of Brightwave Digital Products LLP.
          </p>

          <p className="mb-4">
            This Shipping &amp; Delivery Policy explains how BookMyTime delivers its digital services after
            a successful purchase.
          </p>
          <p className="mb-4">
            BookMyTime is a cloud-based Software-as-a-Service (SaaS) platform. Since our services are
            entirely digital, no physical products are shipped.
          </p>
          <p className="mb-6">By purchasing a subscription, you agree to this Shipping &amp; Delivery Policy.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">1. Nature of Delivery</h2>
          <p>BookMyTime provides digital services including:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Online Appointment Booking</li>
            <li>Calendar &amp; Schedule Management</li>
            <li>Customer Management</li>
            <li>Staff Management</li>
            <li>Business Dashboard</li>
            <li>Reports &amp; Analytics</li>
            <li>Notifications &amp; Reminders</li>
            <li>Subscription-Based Software Access</li>
          </ul>
          <p className="mb-6">No physical goods are delivered to customers.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">2. Account Activation</h2>
          <p>Once your payment is successfully processed and verified:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Your subscription is activated automatically.</li>
            <li>Premium features become available on your registered account.</li>
            <li>Activation usually occurs within a few minutes.</li>
          </ul>
          <p className="mb-6">
            In rare circumstances involving payment verification or technical issues, activation may take
            up to 24 hours.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">3. Free Trial</h2>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>
              Every new user receives a 7-day free trial to explore the platform before purchasing a
              subscription.
            </li>
            <li>No physical delivery is involved during the trial period.</li>
            <li>
              If you choose to subscribe after the trial, premium features are activated digitally upon
              successful payment.
            </li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">4. Delivery Method</h2>
          <p>All services are delivered electronically through:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Your BookMyTime account</li>
            <li>Secure web browser access</li>
            <li>Supported devices with an internet connection</li>
          </ul>
          <p className="mb-6">No installation media or physical package is sent.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">5. Subscription Confirmation</h2>
          <p>After successful payment, you may receive:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Payment confirmation</li>
            <li>Subscription confirmation</li>
            <li>Invoice or payment receipt</li>
            <li>Account activation notification</li>
          </ul>
          <p className="mb-6">
            These communications are sent to your registered email address and/or mobile number, where
            applicable.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">6. Delivery Time</h2>
          <p>Under normal circumstances:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Trial account activation: Immediate</li>
            <li>Paid subscription activation: Within a few minutes</li>
            <li>
              Enterprise or custom plans: Within 1–2 business days, depending on configuration requirements
            </li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">7. Delayed Delivery</h2>
          <p>Service activation may be delayed due to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Payment gateway verification</li>
            <li>Banking delays</li>
            <li>Technical maintenance</li>
            <li>Network interruptions</li>
            <li>Incorrect account information</li>
            <li>Scheduled platform updates</li>
          </ul>
          <p className="mb-6">
            If activation is delayed beyond 24 hours, please contact our support team.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">8. Customer Responsibilities</h2>
          <p>To ensure successful delivery of digital services, customers are responsible for:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Providing a valid email address.</li>
            <li>Providing accurate registration details.</li>
            <li>Maintaining internet connectivity.</li>
            <li>Using a supported browser or device.</li>
            <li>Keeping account credentials secure.</li>
          </ul>
          <p className="mb-6">
            BookMyTime is not responsible for delays caused by incorrect information provided by the
            customer.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">9. Availability</h2>
          <p>BookMyTime is a cloud-based platform accessible 24×7, except during:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Scheduled maintenance</li>
            <li>Emergency maintenance</li>
            <li>Infrastructure upgrades</li>
            <li>Circumstances beyond our reasonable control</li>
          </ul>
          <p className="mb-6">
            We strive to minimize downtime and notify users of planned maintenance whenever possible.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">10. Failed Activation</h2>
          <p>If your payment is successful but your subscription is not activated:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Wait a few minutes and refresh your account.</li>
            <li>Check your registered email for confirmation.</li>
            <li>Contact our support team with your transaction details.</li>
          </ul>
          <p className="mb-6">
            Our team will investigate and activate your subscription as quickly as possible if the payment
            has been successfully received.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">11. Geographic Availability</h2>
          <p className="mb-2">
            BookMyTime is accessible from most locations with an internet connection.
          </p>
          <p className="mb-6">
            However, certain features or payment methods may vary depending on local laws, regulations, or
            third-party service availability.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">12. Contact Us</h2>
          <p className="mb-2">
            If you have any questions regarding service delivery or account activation, please contact us:
          </p>
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

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">13. Policy Updates</h2>
          <p className="mb-2">
            BookMyTime reserves the right to modify this Shipping &amp; Delivery Policy at any time.
          </p>
          <p className="mb-2">
            Updated versions will be published on this page with the revised effective date.
          </p>
          <p className="mb-6">
            Continued use of the Platform after such updates constitutes acceptance of the revised policy.
          </p>

          <p className="mb-6 text-sm text-zinc-500">
            This Shipping &amp; Delivery Policy applies to all subscriptions and digital services purchased
            directly through BookMyTime or its authorized payment partners.
          </p>
        </div>
      </div>
    </SiteShell>
  );
}
