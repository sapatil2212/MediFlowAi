import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  pool: true,
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: false, // true for 465, false for 587 (STARTTLS)
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
  maxConnections: 5,
  maxMessages: 100,
});

// Verify SMTP connection on startup (non-blocking)
if (typeof window === "undefined") {
  transporter.verify().then(() => {
    console.log("[Email] ✅ SMTP connection verified successfully");
  }).catch((err) => {
    console.error("[Email] ❌ SMTP connection failed:", err.message);
  });
}

/** Shared logo URL hosted on Cloudinary CDN */
const LOGO_URL =
  "https://res.cloudinary.com/drctoxvtl/image/upload/v1782838193/bookmytime-email-logo.png";

/** Shared email header HTML with BMT logo */
function emailHeader() {
  return `
    <div style="background: #ffffff; border-radius: 14px 14px 0 0; padding: 20px 28px; text-align: center; border-bottom: 1px solid #e4e4e7;">
      <img
        src="${LOGO_URL}"
        alt="BookMyTime"
        width="180"
        style="height: auto; max-height: 52px; object-fit: contain; display: inline-block;"
      />
    </div>
  `;
}

/** Shared email footer HTML */
function emailFooter() {
  return `
    <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0 16px;" />
    <p style="color: #d4d4d8; font-size: 10px; text-align: center; margin: 0; font-family: 'Segoe UI', Arial, sans-serif;">
      &copy; ${new Date().getFullYear()} BookMyTime &mdash; Intelligent Appointment & Workspace Platform
    </p>
  `;
}

export async function sendOtpEmail(
  email: string,
  code: string
): Promise<void> {
  const bcc = process.env.EMAIL_BCC || "";

  await transporter.sendMail({
    from: `"BookMyTime" <${process.env.EMAIL_USERNAME}>`,
    to: email,
    bcc: bcc || undefined,
    subject: `${code} — Your BookMyTime Verification Code`,
    html: `
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet" />
      <style>@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap');</style>

      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #ffffff; padding: 24px 16px;">

        <!-- Card -->
        <div style="background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e4e4e7;">

          ${emailHeader()}

          <!-- Body -->
          <div style="padding: 36px 32px 28px;">

            <!-- Title -->
            <h2 style="color: #18181b; font-size: 20px; font-weight: 600; text-align: center; margin: 0 0 8px; font-family: 'Poppins', 'Segoe UI', Arial, sans-serif; letter-spacing: -0.2px;">
              Email Verification
            </h2>
            <p style="color: #71717a; font-size: 13px; text-align: center; margin: 0 0 28px; line-height: 1.7;">
              Use the one-time code below to complete your sign-up.
            </p>

            <!-- Digit blocks -->
            <div style="text-align: center; margin: 0 0 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto; border-collapse: separate; border-spacing: 8px 0;">
                <tr>
                  ${code.split("").map(digit => `
                  <td>
                    <div style="
                      width: 56px;
                      height: 64px;
                      background: #ffffff;
                      border: 1.5px solid #d4d4d8;
                      border-radius: 10px;
                      text-align: center;
                      line-height: 64px;
                      font-size: 26px;
                      font-weight: 600;
                      color: #18181b;
                      font-family: 'Poppins', 'Segoe UI', Arial, sans-serif;
                      letter-spacing: 0;
                    ">${digit}</div>
                  </td>`).join("")}
                </tr>
              </table>
            </div>

            <!-- Expiry note -->
            <p style="color: #a1a1aa; font-size: 11px; text-align: center; margin: 0 0 24px; line-height: 1.6;">
              This code expires in <strong style="color: #71717a;">10 minutes</strong>.
            </p>

            <!-- Divider -->
            <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 0 0 16px;" />

            <!-- Warning note -->
            <p style="color: #a1a1aa; font-size: 11px; text-align: center; margin: 0; line-height: 1.7;">
              If you didn't request this code, you can safely ignore this email.<br/>
              Do not share this code with anyone.
            </p>

          </div>

          <!-- Footer -->
          <div style="background: #ffffff; border-top: 1px solid #e4e4e7; padding: 14px 28px; text-align: center;">
            <p style="color: #a1a1aa; font-size: 10px; margin: 0; line-height: 1.6;">
              &copy; ${new Date().getFullYear()} BookMyTime &mdash; Intelligent Appointment &amp; Workspace Platform
            </p>
          </div>

        </div>
      </div>
    `,
    text: `Your BookMyTime verification code is: ${code}\n\nThis code expires in 10 minutes.\nIf you didn't request this, please ignore this email.`,
  });
}

type DemoBookingMailData = {
  name: string;
  email: string;
  phone: string;
  organization: string;
  city: string;
  businessType: string;
  teamSize: string;
  preferredDate: string;
  preferredTime: string;
  preferredMode: string;
  message?: string;
  referenceId: string;
};

function formatDemoSchedule(date: string, time: string): string {
  if (!date) return time || "To be coordinated";

  const parsed = new Date(date);
  const friendlyDate = Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });

  return `${friendlyDate}${time ? ` at ${time}` : ""}`;
}

export async function sendDemoConfirmationEmail(data: DemoBookingMailData): Promise<void> {
  const scheduleLabel = formatDemoSchedule(data.preferredDate, data.preferredTime);

  await transporter.sendMail({
    from: `"BookMyTime" <${process.env.EMAIL_USERNAME}>`,
    to: data.email,
    bcc: process.env.EMAIL_BCC || undefined,
    subject: `Demo request received • ${data.referenceId}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e4e4e7;">

        ${emailHeader()}

        <div style="padding: 32px 28px; color: #18181b;">
          <h2 style="font-size: 22px; margin: 0 0 8px; font-weight: 700;">Your demo request is confirmed</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #52525b; margin: 0 0 20px;">
            Hi ${data.name}, thanks for booking a product walkthrough. Our team will reach out shortly on your shared phone or email to finalize the session.
          </p>

          <div style="border: 1px solid #e4e4e7; border-radius: 14px; padding: 20px; background: #fafafa; margin-bottom: 20px;">
            <p style="margin: 0 0 12px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #71717a; font-weight: 700;">Request Summary</p>
            <p style="margin: 0 0 8px; font-size: 14px;"><strong>Reference:</strong> ${data.referenceId}</p>
            <p style="margin: 0 0 8px; font-size: 14px;"><strong>Organization:</strong> ${data.organization}</p>
            <p style="margin: 0 0 8px; font-size: 14px;"><strong>Preferred slot:</strong> ${scheduleLabel}</p>
            <p style="margin: 0 0 8px; font-size: 14px;"><strong>Mode:</strong> ${data.preferredMode}</p>
            <p style="margin: 0; font-size: 14px;"><strong>City:</strong> ${data.city}</p>
          </div>

          <p style="font-size: 13px; line-height: 1.6; color: #71717a; margin: 0;">
            If anything changes, reply to this email or call us on +91 9168 08 1355.
          </p>

          ${emailFooter()}
        </div>

      </div>
    `,
    text: `Hi ${data.name}, your BookMyTime demo request (${data.referenceId}) has been received.\nOrganization: ${data.organization}\nPreferred slot: ${scheduleLabel}\nMode: ${data.preferredMode}\nCity: ${data.city}\n\nWe will contact you shortly on ${data.phone} or ${data.email}.`,
  });
}

export async function sendDemoAdminNotificationEmail(data: DemoBookingMailData): Promise<void> {
  const adminEmail =
    process.env.DEMO_ADMIN_EMAIL ||
    process.env.SUPER_ADMIN_EMAIL ||
    process.env.EMAIL_BCC ||
    process.env.EMAIL_USERNAME;

  if (!adminEmail) {
    throw new Error("No admin email configured for demo notifications");
  }

  const scheduleLabel = formatDemoSchedule(data.preferredDate, data.preferredTime);

  await transporter.sendMail({
    from: `"BookMyTime Alerts" <${process.env.EMAIL_USERNAME}>`,
    to: adminEmail,
    subject: `New demo request • ${data.organization} • ${data.referenceId}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e4e4e7;">

        ${emailHeader()}

        <div style="padding: 32px 28px; color: #18181b;">
          <h2 style="font-size: 22px; margin: 0 0 10px; font-weight: 700;">New demo appointment request</h2>
          <p style="font-size: 13px; color: #52525b; margin: 0 0 20px;">A new lead has been captured from the public contact page.</p>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tbody>
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a; width: 40%;">Reference</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; font-weight: 600;">${data.referenceId}</td></tr>
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a;">Contact</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; font-weight: 600;">${data.name}</td></tr>
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a;">Email</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">${data.email}</td></tr>
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a;">Phone</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">${data.phone}</td></tr>
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a;">Organization</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">${data.organization}</td></tr>
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a;">Business type</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">${data.businessType}</td></tr>
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a;">Team size</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">${data.teamSize}</td></tr>
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a;">Preferred slot</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">${scheduleLabel}</td></tr>
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a;">Preferred mode</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">${data.preferredMode}</td></tr>
              <tr><td style="padding: 10px 0; color: #71717a;">Notes</td><td style="padding: 10px 0;">${data.message || "No extra notes shared."}</td></tr>
            </tbody>
          </table>

          ${emailFooter()}
        </div>

      </div>
    `,
    text: `New demo request ${data.referenceId}\nName: ${data.name}\nEmail: ${data.email}\nPhone: ${data.phone}\nOrganization: ${data.organization}\nBusiness type: ${data.businessType}\nTeam size: ${data.teamSize}\nPreferred slot: ${scheduleLabel}\nMode: ${data.preferredMode}\nCity: ${data.city}\nNotes: ${data.message || "No extra notes"}`,
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Billing / Subscription (AutoPay) notifications
// ─────────────────────────────────────────────────────────────────────────────

export type BillingEventTone = "success" | "warning" | "danger" | "info";

const TONE_COLORS: Record<BillingEventTone, string> = {
  success: "#059669",
  warning: "#d97706",
  danger: "#dc2626",
  info: "#0059C6",
};

/**
 * Sends a branded billing/subscription notification email. Used for all AutoPay
 * lifecycle events (activation, renewal success/failure, cancellation, upcoming
 * renewal, invoice available). Non-blocking failures should be swallowed by the
 * caller so billing flows never break on email issues.
 */
export async function sendBillingNotificationEmail(params: {
  email: string;
  subject: string;
  title: string;
  message: string;
  tone?: BillingEventTone;
  details?: Array<{ label: string; value: string }>;
}): Promise<void> {
  const tone = params.tone || "info";
  const accent = TONE_COLORS[tone];
  const bcc = process.env.EMAIL_BCC || "";

  const detailRows = (params.details || [])
    .map(
      (d) => `
        <tr>
          <td style="padding: 8px 0; color: #71717a; font-size: 12px;">${d.label}</td>
          <td style="padding: 8px 0; color: #18181b; font-size: 12px; font-weight: 600; text-align: right;">${d.value}</td>
        </tr>`
    )
    .join("");

  await transporter.sendMail({
    from: `"BookMyTime Billing" <${process.env.EMAIL_USERNAME}>`,
    to: params.email,
    bcc: bcc || undefined,
    subject: params.subject,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #ffffff; padding: 24px 16px;">
        <div style="background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e4e4e7;">
          ${emailHeader()}
          <div style="padding: 32px 32px 24px;">
            <div style="height: 4px; width: 44px; background: ${accent}; border-radius: 4px; margin: 0 auto 20px;"></div>
            <h2 style="color: #18181b; font-size: 19px; font-weight: 600; text-align: center; margin: 0 0 10px; letter-spacing: -0.2px;">
              ${params.title}
            </h2>
            <p style="color: #52525b; font-size: 13px; text-align: center; margin: 0 0 22px; line-height: 1.7;">
              ${params.message}
            </p>
            ${
              detailRows
                ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; border-top: 1px solid #f4f4f5; margin-top: 8px;">${detailRows}</table>`
                : ""
            }
            ${emailFooter()}
          </div>
        </div>
      </div>
    `,
  });
}
