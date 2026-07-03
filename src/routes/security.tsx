import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [{ title: "Security Policy — BookMyTime" }],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <SiteShell>
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 mb-8">Security Policy</h1>
        <div className="prose prose-zinc prose-sm sm:prose-base text-zinc-600">
          <p className="text-sm text-zinc-500 mb-2">Effective Date: July 1, 2026</p>
          <p className="text-sm text-zinc-500 mb-8">Last Updated: July 1, 2026</p>

          <p className="mb-4">
            At BookMyTime, protecting the confidentiality, integrity, and availability of customer
            information is a core priority. We continuously implement technical, administrative, and
            operational safeguards designed to protect our platform and the data entrusted to us.
          </p>
          <p className="mb-6">
            This Security Policy explains the measures we take to help secure our systems, infrastructure,
            and customer data.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">1. Our Commitment</h2>
          <p>BookMyTime is committed to maintaining a secure platform by:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Protecting customer information from unauthorized access.</li>
            <li>Safeguarding business and appointment data.</li>
            <li>Maintaining reliable and secure services.</li>
            <li>Continuously improving our security practices.</li>
            <li>Responding promptly to security incidents.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">2. Secure Infrastructure</h2>
          <p>BookMyTime operates on secure cloud infrastructure designed to provide:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>High availability</li>
            <li>Reliable uptime</li>
            <li>Secure networking</li>
            <li>Infrastructure monitoring</li>
            <li>Regular software updates</li>
          </ul>
          <p className="mb-6">
            Our hosting environment includes multiple layers of protection against common threats.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">3. Secure Communication</h2>
          <p className="mb-2">
            All communication between users and the BookMyTime platform is encrypted using HTTPS
            (SSL/TLS).
          </p>
          <p className="mb-6">
            This helps protect information exchanged between your device and our servers from interception
            or unauthorized access.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">4. Account Security</h2>
          <p>We use multiple measures to help protect user accounts, including:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Secure authentication</li>
            <li>Encrypted password storage</li>
            <li>Session management</li>
            <li>Login verification</li>
            <li>Role-based access controls</li>
            <li>Automatic session expiration where applicable</li>
          </ul>
          <p className="mb-6">Users are responsible for keeping their login credentials confidential.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">5. Password Protection</h2>
          <p className="mb-2">Passwords are never stored in plain text.</p>
          <p className="mb-2">Instead, passwords are securely hashed before being stored in our systems.</p>
          <p>We recommend users:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Use strong, unique passwords.</li>
            <li>Avoid sharing passwords with others.</li>
            <li>Change passwords periodically.</li>
            <li>Report suspected unauthorized access immediately.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">6. Data Protection</h2>
          <p>BookMyTime employs reasonable safeguards to protect customer information, including:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Access controls</li>
            <li>Database security</li>
            <li>Encrypted communications</li>
            <li>Application-level security</li>
            <li>Regular system maintenance</li>
          </ul>
          <p className="mb-6">
            Only authorized personnel have access to systems necessary for providing and maintaining our
            services.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">7. Payment Security</h2>
          <p>BookMyTime does not store:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Credit Card Numbers</li>
            <li>Debit Card Numbers</li>
            <li>CVV</li>
            <li>UPI PIN</li>
            <li>Internet Banking Credentials</li>
          </ul>
          <p className="mb-6">
            Payments are processed securely through trusted third-party payment gateways that are
            responsible for handling payment information according to their own security standards.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">8. User Responsibilities</h2>
          <p>Security is a shared responsibility. Users are encouraged to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Keep passwords confidential.</li>
            <li>Enable additional security features where available.</li>
            <li>Log out from shared or public devices.</li>
            <li>Maintain updated browsers and operating systems.</li>
            <li>Avoid sharing account credentials.</li>
            <li>Notify us immediately if suspicious activity is detected.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">9. Access Control</h2>
          <p className="mb-2">
            Access to customer information is limited based on operational requirements.
          </p>
          <p className="mb-6">
            Our platform supports role-based permissions to help ensure users only access information
            relevant to their responsibilities.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">10. Monitoring &amp; Maintenance</h2>
          <p>We regularly monitor our systems to help:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Detect unusual activity.</li>
            <li>Identify performance issues.</li>
            <li>Improve platform reliability.</li>
            <li>Maintain service availability.</li>
            <li>Support incident response.</li>
          </ul>
          <p className="mb-6">
            System updates and maintenance are performed periodically to enhance security and stability.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">11. Data Backup &amp; Recovery</h2>
          <p className="mb-2">
            We perform regular data backup procedures designed to support service continuity and recovery
            in the event of unexpected incidents.
          </p>
          <p className="mb-6">
            Recovery processes are periodically reviewed to help maintain operational reliability.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">12. Third-Party Services</h2>
          <p>BookMyTime integrates with trusted third-party providers for services such as:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Payment Processing</li>
            <li>Cloud Hosting</li>
            <li>Email Delivery</li>
            <li>SMS Notifications</li>
            <li>Analytics</li>
          </ul>
          <p className="mb-6">Each third-party provider maintains its own security practices and policies.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">13. Security Incidents</h2>
          <p>If we become aware of a security incident affecting our systems, we will:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Investigate the issue promptly.</li>
            <li>Take appropriate measures to contain and resolve the incident.</li>
            <li>Notify affected users when required by applicable law.</li>
            <li>Implement corrective actions to reduce the likelihood of recurrence.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">14. Platform Availability</h2>
          <p>While we strive to maintain continuous availability, temporary interruptions may occur due to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Scheduled maintenance</li>
            <li>Infrastructure upgrades</li>
            <li>Emergency maintenance</li>
            <li>Network failures</li>
            <li>Events beyond our reasonable control</li>
          </ul>
          <p className="mb-6">We work to minimize downtime and restore services as quickly as possible.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">15. Reporting Security Issues</h2>
          <p className="mb-2">
            If you believe you have discovered a security vulnerability or suspicious activity related to
            BookMyTime, please notify us immediately.
          </p>
          <p>Please include:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Description of the issue</li>
            <li>Steps to reproduce (if applicable)</li>
            <li>Screenshots or supporting information</li>
            <li>Contact details for follow-up</li>
          </ul>
          <p className="mb-6">
            We appreciate responsible disclosure and will review reported issues promptly.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">16. Policy Updates</h2>
          <p className="mb-2">
            BookMyTime may update this Security Policy from time to time to reflect improvements in our
            security practices or changes in legal or operational requirements.
          </p>
          <p className="mb-6">
            Updated versions will be published on this page with the revised effective date.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">17. Contact Us</h2>
          <p className="mb-2">
            For security-related questions or to report a potential security issue, please contact:
          </p>
          <p className="mb-6">
            <strong className="text-zinc-900">BookMyTime Security Team</strong>
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
            Business Hours: Monday – Saturday, 9:00 AM – 6:00 PM (IST)
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Our Security Principles</h2>
          <p>At BookMyTime, we are committed to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Protecting customer data.</li>
            <li>Maintaining platform reliability.</li>
            <li>Following secure development practices.</li>
            <li>Continuously improving our security posture.</li>
            <li>Responding responsibly to security concerns.</li>
          </ul>
        </div>
      </div>
    </SiteShell>
  );
}
