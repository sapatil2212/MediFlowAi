import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { SiteShell } from "@/components/site/Footer";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [{ title: "Cookie Policy — BookMyTime" }],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  return (
    <SiteShell>
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 mb-8">Cookie Policy</h1>
        <div className="prose prose-zinc prose-sm sm:prose-base text-zinc-600">
          <p className="text-sm text-zinc-500 mb-2">Effective Date: July 1, 2026</p>
          <p className="text-sm text-zinc-500 mb-2">Last Updated: July 1, 2026</p>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-8">
            A product of Brightwave Digital Products LLP.
          </p>

          <p className="mb-4">
            This Cookie Policy explains how BookMyTime ("BookMyTime", "we", "our", or "us") uses cookies and
            similar technologies when you visit our website, web application, or use our services.
          </p>
          <p className="mb-6">
            By continuing to use BookMyTime, you consent to our use of cookies in accordance with this
            Cookie Policy.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">1. What Are Cookies?</h2>
          <p className="mb-2">
            Cookies are small text files stored on your computer, tablet, or mobile device when you visit a
            website.
          </p>
          <p className="mb-2">
            Cookies help websites remember information about your visit, making your experience faster,
            more secure, and more personalized.
          </p>
          <p className="mb-6">
            Cookies do not typically contain information that directly identifies you, but they may be
            linked to information associated with your account.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">2. Why We Use Cookies</h2>
          <p>BookMyTime uses cookies to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Authenticate users after login.</li>
            <li>Keep users signed in during a session.</li>
            <li>Remember account preferences.</li>
            <li>Improve website performance.</li>
            <li>Enhance website security.</li>
            <li>Analyze website traffic.</li>
            <li>Improve user experience.</li>
            <li>Store language and regional preferences.</li>
            <li>Detect suspicious or fraudulent activity.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">3. Types of Cookies We Use</h2>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">Essential Cookies</h3>
          <p className="mb-2">
            These cookies are required for the proper functioning of the website. They enable features such
            as:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Secure Login</li>
            <li>Session Management</li>
            <li>User Authentication</li>
            <li>Account Security</li>
            <li>Navigation</li>
          </ul>
          <p className="mb-6">Without these cookies, the Platform may not function correctly.</p>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">Performance Cookies</h3>
          <p className="mb-2">These cookies help us understand how visitors use BookMyTime. Examples include:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Page Visits</li>
            <li>Feature Usage</li>
            <li>Session Duration</li>
            <li>Error Tracking</li>
            <li>Performance Monitoring</li>
          </ul>
          <p className="mb-6">This information is used to improve our services.</p>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">Functional Cookies</h3>
          <p>These cookies remember your preferences, such as:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Language Selection</li>
            <li>Theme Preferences</li>
            <li>Dashboard Settings</li>
            <li>Remember Me Login</li>
            <li>Notification Preferences</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">Security Cookies</h3>
          <p>Security cookies help protect both users and our platform by:</p>
          <ul className="list-disc pl-5 space-y-1 mb-6">
            <li>Detecting unauthorized login attempts.</li>
            <li>Preventing fraudulent activity.</li>
            <li>Protecting user sessions.</li>
            <li>Maintaining secure authentication.</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2 text-zinc-900">Analytics Cookies</h3>
          <p>We may use analytics services to understand:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Number of visitors</li>
            <li>Popular pages</li>
            <li>Traffic sources</li>
            <li>Device types</li>
            <li>Browser usage</li>
            <li>User interactions</li>
          </ul>
          <p className="mb-6">
            This information is aggregated and used solely to improve the Platform.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">4. Third-Party Cookies</h2>
          <p className="mb-2">
            Some third-party services integrated with BookMyTime may place cookies on your device. These
            may include services for:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Payment Processing</li>
            <li>Website Analytics</li>
            <li>Customer Support</li>
            <li>Email Communications</li>
            <li>Security Monitoring</li>
          </ul>
          <p className="mb-6">
            These third parties operate under their own privacy and cookie policies.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">5. Managing Cookies</h2>
          <p>Most web browsers allow you to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>View stored cookies</li>
            <li>Delete cookies</li>
            <li>Block cookies</li>
            <li>Configure cookie preferences</li>
          </ul>
          <p className="mb-6">
            Please note that disabling certain cookies may affect the functionality of BookMyTime.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">6. Browser Controls</h2>
          <p className="mb-2">You can manage cookies through your browser settings. Common browsers include:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Google Chrome</li>
            <li>Mozilla Firefox</li>
            <li>Microsoft Edge</li>
            <li>Safari</li>
            <li>Opera</li>
          </ul>
          <p className="mb-6">
            Refer to your browser's help documentation for instructions on managing cookies.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">7. Impact of Disabling Cookies</h2>
          <p>If cookies are disabled:</p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Login sessions may not persist.</li>
            <li>User preferences may not be saved.</li>
            <li>Certain features may become unavailable.</li>
            <li>Overall user experience may be affected.</li>
          </ul>
          <p className="mb-6">For the best experience, we recommend enabling cookies.</p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">8. Similar Technologies</h2>
          <p>
            In addition to cookies, BookMyTime may use similar technologies such as:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>Local Storage</li>
            <li>Session Storage</li>
            <li>Browser Cache</li>
            <li>Security Tokens</li>
          </ul>
          <p className="mb-6">
            These technologies help improve performance, maintain secure sessions, and enhance
            functionality.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">9. Updates to This Policy</h2>
          <p className="mb-2">
            BookMyTime may update this Cookie Policy from time to time to reflect changes in technology,
            legal requirements, or our services.
          </p>
          <p className="mb-6">
            Any updates will be published on this page with the revised effective date.
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">10. Contact Us</h2>
          <p className="mb-2">If you have any questions regarding our use of cookies, please contact us.</p>
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
            Business Hours: Monday – Saturday, 9:00 AM – 6:00 PM (IST)
          </p>

          <h2 className="text-xl font-semibold mt-8 mb-4 text-zinc-900">Consent</h2>
          <p className="mb-6">
            By continuing to use BookMyTime, you acknowledge that you have read and understood this Cookie
            Policy and consent to our use of cookies as described herein.
          </p>
        </div>
      </div>
    </SiteShell>
  );
}
