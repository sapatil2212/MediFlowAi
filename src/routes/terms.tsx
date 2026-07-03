import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [{ title: "Terms & Conditions — BookMyTime" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <SiteShell>
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 mb-8">Terms &amp; Conditions</h1>
        <div className="prose prose-zinc prose-sm sm:prose-base text-zinc-600">
          <p className="text-sm text-zinc-500 mb-2">Effective Date: July 1, 2026</p>
          <p className="text-sm text-zinc-500 mb-8">Last Updated: July 1, 2026</p>

          <p className="mb-4">
            Welcome to BookMyTime ("BookMyTime", "Company", "we", "our", or "us"). These Terms &amp;
            Conditions ("Terms") govern your access to and use of the BookMyTime website, applications,
            APIs, software, and related services (collectively referred to as the "Platform").
          </p>
          <p className="mb-6">
            By accessing or using BookMyTime, you acknowledge that you have read, understood, and agree to
            be legally bound by these Terms.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">1. About BookMyTime</h2>
          <p>
            BookMyTime is a Software-as-a-Service (SaaS) platform that enables businesses and professionals
            to manage:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Online Appointment Scheduling</li>
            <li>Customer Management</li>
            <li>Staff Management</li>
            <li>Calendar Management</li>
            <li>Notifications</li>
            <li>Payment Collection</li>
            <li>Business Operations</li>
          </ul>
          <p className="mb-6">
            BookMyTime is a technology platform and does not provide medical, legal, financial, or
            professional advice.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">2. Eligibility</h2>
          <p>To use BookMyTime, you must:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Be at least 18 years old.</li>
            <li>Have the legal authority to enter into binding agreements.</li>
            <li>Provide accurate registration information.</li>
            <li>Maintain updated account information.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">3. Account Registration</h2>
          <p className="mb-2">To access certain features, users must create an account.</p>
          <p>You agree to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Provide accurate information.</li>
            <li>Keep your password secure.</li>
            <li>Maintain confidentiality of login credentials.</li>
            <li>Notify us immediately of unauthorized account access.</li>
          </ul>
          <p className="mb-6">You are responsible for all activities performed through your account.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">4. Subscription Plans</h2>
          <p className="mb-2">BookMyTime offers both free and paid subscription plans.</p>
          <p>Paid subscriptions may include:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Monthly Plans</li>
            <li>Quarterly Plans</li>
            <li>Annual Plans</li>
            <li>Enterprise Plans</li>
          </ul>
          <p className="mb-2">Features available depend on your selected subscription.</p>
          <p className="mb-6">
            New users may be eligible for a 7-day free trial. The availability, features, and duration of
            the trial are determined by BookMyTime and may be modified or withdrawn at any time without
            prior notice.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">5. Payments</h2>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>All subscription payments are processed securely through authorized payment gateways.</li>
            <li>Applicable taxes may be charged as required by law.</li>
            <li>Failure to complete payment may result in suspension or termination of paid services.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">6. Automatic Renewal</h2>
          <p className="mb-2">
            If enabled, subscription plans may renew automatically at the end of the billing cycle.
          </p>
          <p className="mb-6">Users may cancel automatic renewal before the renewal date.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">7. Cancellation</h2>
          <p className="mb-2">
            Users may cancel their subscription at any time through their account dashboard or by
            contacting support.
          </p>
          <p className="mb-6">
            Cancellation prevents future renewals but does not automatically entitle users to refunds
            unless specifically stated in the Refund Policy.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">8. Acceptable Use</h2>
          <p>Users agree NOT to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Violate any applicable law.</li>
            <li>Upload malicious software.</li>
            <li>Attempt unauthorized access.</li>
            <li>Disrupt platform operations.</li>
            <li>Abuse APIs.</li>
            <li>Reverse engineer the Platform.</li>
            <li>Use BookMyTime for fraudulent activities.</li>
            <li>Interfere with other users' accounts.</li>
            <li>Misuse customer information.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">9. User Content</h2>
          <p>Users retain ownership of all information uploaded to BookMyTime, including:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Customer Data</li>
            <li>Appointment Records</li>
            <li>Images</li>
            <li>Files</li>
            <li>Business Information</li>
          </ul>
          <p className="mb-6">
            By uploading content, you grant BookMyTime permission to process and store such information
            solely for providing the services.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">10. Data Responsibility</h2>
          <p>Users are solely responsible for:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Accuracy of uploaded information.</li>
            <li>Obtaining required customer consent.</li>
            <li>Compliance with applicable laws.</li>
            <li>Managing customer communications.</li>
          </ul>
          <p className="mb-6">BookMyTime acts only as a technology platform.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">11. Intellectual Property</h2>
          <p className="mb-2">
            All software, trademarks, logos, source code, designs, graphics, and documentation remain the
            exclusive property of BookMyTime.
          </p>
          <p>Users may not:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Copy</li>
            <li>Modify</li>
            <li>Distribute</li>
            <li>Resell</li>
            <li>License</li>
            <li>Reverse engineer</li>
          </ul>
          <p className="mb-6">any part of the Platform without prior written permission.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">12. Availability</h2>
          <p className="mb-2">
            We strive to provide uninterrupted services but do not guarantee continuous availability.
          </p>
          <p className="mb-6">
            Scheduled maintenance, upgrades, or unforeseen technical issues may temporarily affect access.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">13. Third-Party Services</h2>
          <p>BookMyTime may integrate with:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Payment Gateways</li>
            <li>SMS Providers</li>
            <li>Email Providers</li>
            <li>Cloud Storage Services</li>
            <li>Analytics Providers</li>
          </ul>
          <p className="mb-6">
            We are not responsible for the services, policies, or availability of third-party providers.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">14. Limitation of Liability</h2>
          <p>To the maximum extent permitted by law, BookMyTime shall not be liable for:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Loss of profits</li>
            <li>Business interruption</li>
            <li>Data loss</li>
            <li>Revenue loss</li>
            <li>Indirect damages</li>
            <li>Incidental damages</li>
            <li>Consequential damages</li>
          </ul>
          <p className="mb-6">Users use the Platform at their own risk.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">15. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless BookMyTime, its directors, employees, affiliates, and
            partners from any claims, damages, liabilities, or expenses arising from:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Violation of these Terms</li>
            <li>Misuse of the Platform</li>
            <li>Violation of applicable laws</li>
            <li>Infringement of third-party rights</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">16. Suspension and Termination</h2>
          <p>
            BookMyTime reserves the right to suspend or terminate accounts without prior notice if users:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Violate these Terms.</li>
            <li>Engage in fraudulent activity.</li>
            <li>Abuse the Platform.</li>
            <li>Fail to pay subscription fees.</li>
            <li>Attempt unauthorized access.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">17. Privacy</h2>
          <p className="mb-2">
            Your use of BookMyTime is also governed by our{" "}
            <a href="/privacy" className="text-brand hover:underline font-medium" style={{ color: "#0059C6" }}>
              Privacy Policy
            </a>
            .
          </p>
          <p className="mb-6">We encourage all users to review our Privacy Policy carefully.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">18. Modifications</h2>
          <p className="mb-2">BookMyTime may modify these Terms from time to time.</p>
          <p className="mb-2">
            Updated Terms become effective immediately upon publication unless otherwise specified.
          </p>
          <p className="mb-6">
            Continued use of the Platform constitutes acceptance of the updated Terms.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">19. Force Majeure</h2>
          <p>
            BookMyTime shall not be liable for failure or delay caused by circumstances beyond our
            reasonable control, including but not limited to:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Natural disasters</li>
            <li>Government actions</li>
            <li>Internet outages</li>
            <li>Power failures</li>
            <li>Cyber attacks</li>
            <li>Pandemics</li>
            <li>War</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">20. Governing Law</h2>
          <p className="mb-6">
            These Terms shall be governed by and interpreted in accordance with the laws of India.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">21. Dispute Resolution</h2>
          <p className="mb-2">
            Any dispute arising out of these Terms shall first be attempted to be resolved through mutual
            discussion.
          </p>
          <p className="mb-6">
            If unresolved, disputes shall be subject to the exclusive jurisdiction of the competent courts
            located in Pune, Maharashtra, India.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">22. Contact Information</h2>
          <p className="mb-2">For any questions regarding these Terms, please contact:</p>
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
            Business Hours: Monday to Saturday, 9:00 AM – 6:00 PM (IST)
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">23. Entire Agreement</h2>
          <p className="mb-6">
            These Terms constitute the complete agreement between you and BookMyTime regarding your use of
            the Platform and supersede all prior agreements or understandings related to the services.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Acceptance</h2>
          <p className="mb-6">
            By accessing or using BookMyTime, you confirm that you have read, understood, and agree to
            these Terms &amp; Conditions.
          </p>
        </div>
      </div>
    </SiteShell>
  );
}
