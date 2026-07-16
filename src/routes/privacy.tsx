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
          <p className="text-sm text-zinc-500 mb-2">Effective Date: July 1, 2026</p>
          <p className="text-sm text-zinc-500 mb-2">Last Updated: July 1, 2026</p>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-8">
            A product of Brightwave Digital Products LLP.
          </p>

          <p className="mb-4">
            Welcome to BookMyTime ("BookMyTime", "we", "our", or "us"). BookMyTime is an online
            appointment scheduling and business management platform designed for healthcare
            professionals, clinics, salons, gyms, educational institutions, consultants, and other
            service-based businesses.
          </p>
          <p className="mb-4">
            Your privacy is important to us. This Privacy Policy explains how we collect, use, store,
            process, and protect your personal information when you access our website, mobile
            applications, APIs, and services (collectively referred to as the "Platform").
          </p>
          <p className="mb-6">
            By using BookMyTime, you agree to the practices described in this Privacy Policy.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">1. Information We Collect</h2>
          <p className="mb-4">We collect information that helps us provide and improve our services.</p>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">A. Personal Information</h3>
          <p>When you register an account, subscribe to our services, or contact us, we may collect:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Full Name</li>
            <li>Email Address</li>
            <li>Mobile Number</li>
            <li>Business Name</li>
            <li>Clinic or Organization Name</li>
            <li>Business Address</li>
            <li>GST Number (if applicable)</li>
            <li>Profile Photo</li>
            <li>Professional Information</li>
            <li>Designation</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">B. Account Information</h3>
          <p>We collect information related to your account, including:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Username</li>
            <li>Encrypted Password</li>
            <li>Account Preferences</li>
            <li>Login History</li>
            <li>Authentication Tokens</li>
            <li>Subscription Details</li>
          </ul>
          <p className="mb-6">Passwords are never stored in plain text.</p>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">C. Appointment &amp; Customer Data</h3>
          <p>Depending on how you use the Platform, BookMyTime may process:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Customer Name</li>
            <li>Appointment Date &amp; Time</li>
            <li>Appointment Status</li>
            <li>Service Booked</li>
            <li>Assigned Staff Member</li>
            <li>Notes entered by authorized users</li>
          </ul>
          <p className="mb-6">
            The data entered into BookMyTime remains under the control of the account owner.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">D. Payment Information</h3>
          <p className="mb-2">
            BookMyTime does not collect or store complete debit card numbers, credit card numbers,
            CVV, UPI PINs, or internet banking credentials.
          </p>
          <p className="mb-2">Payments are securely processed through trusted third-party payment gateways.</p>
          <p>We may store:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Payment Status</li>
            <li>Transaction ID</li>
            <li>Invoice Details</li>
            <li>Subscription Information</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">E. Device Information</h3>
          <p>When you access BookMyTime, we automatically collect:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>IP Address</li>
            <li>Browser Type</li>
            <li>Operating System</li>
            <li>Device Information</li>
            <li>Language Settings</li>
            <li>Time Zone</li>
            <li>Device Identifier</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">F. Usage Information</h3>
          <p>We collect information regarding your interaction with the Platform, including:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Pages Visited</li>
            <li>Features Used</li>
            <li>Login Frequency</li>
            <li>Session Duration</li>
            <li>Error Logs</li>
            <li>Activity Logs</li>
          </ul>
          <p className="mb-6">This helps improve system performance and user experience.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">2. How We Use Your Information</h2>
          <p>Your information is used only for legitimate business purposes including:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Creating and managing your account</li>
            <li>Providing appointment scheduling services</li>
            <li>Managing business operations</li>
            <li>Sending appointment reminders</li>
            <li>Processing subscription payments</li>
            <li>Providing customer support</li>
            <li>Improving platform functionality</li>
            <li>Detecting fraudulent activity</li>
            <li>Preventing unauthorized access</li>
            <li>Complying with legal obligations</li>
            <li>Generating reports and analytics</li>
          </ul>
          <p className="mb-6">We never sell your personal information.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">3. Customer Data Ownership</h2>
          <p className="mb-2">
            All appointment information, customer records, and operational data uploaded by you remain
            your property.
          </p>
          <p className="mb-2">
            BookMyTime acts only as a technology service provider and processes such information on your
            behalf.
          </p>
          <p className="mb-6">
            You remain responsible for obtaining any legally required consent from your customers before
            collecting or storing their information.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">4. Payment Processing</h2>
          <p className="mb-2">
            Payments made through BookMyTime are securely processed using trusted payment service
            providers.
          </p>
          <p>BookMyTime never stores:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Credit Card Numbers</li>
            <li>Debit Card Numbers</li>
            <li>CVV</li>
            <li>UPI PIN</li>
            <li>Internet Banking Passwords</li>
          </ul>
          <p className="mb-6">
            Payment gateways independently process payment information according to applicable PCI-DSS
            standards.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">5. Cookies</h2>
          <p>BookMyTime uses cookies and similar technologies to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Keep users logged in</li>
            <li>Remember preferences</li>
            <li>Improve website performance</li>
            <li>Enhance security</li>
            <li>Analyze website traffic</li>
          </ul>
          <p className="mb-6">
            Users may disable cookies through browser settings; however, certain features may not
            function properly.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">6. Third-Party Services</h2>
          <p>We may use trusted third-party service providers for:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Payment Processing</li>
            <li>Cloud Hosting</li>
            <li>Email Delivery</li>
            <li>SMS Notifications</li>
            <li>Analytics</li>
            <li>Error Monitoring</li>
            <li>Customer Support</li>
          </ul>
          <p className="mb-6">Each provider operates under its own privacy policy.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">7. Data Sharing</h2>
          <p className="mb-2">We do not sell, trade, or rent personal information.</p>
          <p>Information may only be shared:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>With payment gateway providers</li>
            <li>With cloud infrastructure providers</li>
            <li>With email or SMS delivery providers</li>
            <li>With government authorities when legally required</li>
            <li>To protect our legal rights</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">8. Data Retention</h2>
          <p>We retain your information only as long as necessary to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Provide services</li>
            <li>Fulfill contractual obligations</li>
            <li>Comply with legal requirements</li>
            <li>Resolve disputes</li>
            <li>Enforce agreements</li>
          </ul>
          <p className="mb-6">
            Upon account deletion, data may be retained for a limited period where required by applicable
            law.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">9. Security Measures</h2>
          <p>We implement reasonable administrative, technical, and organizational safeguards including:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>HTTPS Encryption</li>
            <li>SSL Security</li>
            <li>Password Hashing</li>
            <li>Secure Authentication</li>
            <li>Access Controls</li>
            <li>Firewall Protection</li>
            <li>Database Security</li>
            <li>Activity Monitoring</li>
            <li>Regular Software Updates</li>
          </ul>
          <p className="mb-6">
            While we take appropriate precautions, no online platform can guarantee absolute security.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">10. International Data Transfers</h2>
          <p className="mb-6">
            If you access BookMyTime from outside India, your information may be processed and stored on
            servers located in India or other jurisdictions where our service providers operate.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">11. Children's Privacy</h2>
          <p className="mb-2">BookMyTime is intended for users aged 18 years or older.</p>
          <p className="mb-6">We do not knowingly collect personal information from children.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">12. Your Rights</h2>
          <p>Subject to applicable laws, you may request to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Access your personal information</li>
            <li>Correct inaccurate information</li>
            <li>Update your profile</li>
            <li>Delete your account</li>
            <li>Export your data</li>
            <li>Withdraw consent where applicable</li>
          </ul>
          <p className="mb-6">Requests can be submitted using the contact details below.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">13. Account Security</h2>
          <p>Users are responsible for:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Maintaining password confidentiality</li>
            <li>Preventing unauthorized access</li>
            <li>Logging out from shared devices</li>
            <li>Reporting suspicious activity immediately</li>
          </ul>
          <p className="mb-6">
            BookMyTime shall not be responsible for losses resulting from unauthorized access caused by
            failure to protect account credentials.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">14. Third-Party Links</h2>
          <p className="mb-2">Our Platform may contain links to third-party websites.</p>
          <p className="mb-2">
            BookMyTime is not responsible for the privacy practices or content of external websites.
          </p>
          <p className="mb-6">
            Users should review the privacy policies of such websites before providing personal
            information.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">15. Policy Updates</h2>
          <p className="mb-2">We may update this Privacy Policy periodically.</p>
          <p className="mb-2">
            Changes become effective immediately upon publication on this page unless otherwise specified.
          </p>
          <p className="mb-6">Users are encouraged to review this page regularly.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">16. Contact Information</h2>
          <p className="mb-2">
            If you have questions regarding this Privacy Policy or our data practices, please contact:
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
            Business Hours: Monday to Saturday, 9:00 AM – 6:00 PM (IST)
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">17. Consent</h2>
          <p className="mb-6">
            By accessing or using BookMyTime, you acknowledge that you have read, understood, and agree to
            this Privacy Policy.
          </p>
        </div>
      </div>
    </SiteShell>
  );
}
