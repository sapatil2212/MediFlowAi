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
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 28px;">
          <div style="display: inline-block; background: linear-gradient(135deg, #10b981, #059669); border-radius: 12px; padding: 10px 14px;">
            <span style="color: #fff; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">BookMyTime</span>
          </div>
        </div>

        <h2 style="color: #18181b; font-size: 20px; font-weight: 700; text-align: center; margin: 0 0 8px;">
          Email Verification
        </h2>
        <p style="color: #71717a; font-size: 13px; text-align: center; margin: 0 0 24px; line-height: 1.5;">
          Use the verification code below to complete your sign-up.<br/>
          This code expires in <strong>10 minutes</strong>.
        </p>

        <div style="background: #f4f4f5; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 24px;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 12px; color: #18181b; font-family: 'Courier New', monospace;">
            ${code}
          </span>
        </div>

        <p style="color: #a1a1aa; font-size: 11px; text-align: center; margin: 0; line-height: 1.5;">
          If you didn't request this code, you can safely ignore this email.<br/>
          Do not share this code with anyone.
        </p>

        <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0 16px;" />

        <p style="color: #d4d4d8; font-size: 10px; text-align: center; margin: 0;">
          &copy; ${new Date().getFullYear()} BookMyTime — Intelligent Healthcare Workspace
        </p>
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
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 28px 24px; background: #ffffff; color: #18181b;">
        <div style="display: inline-block; background: linear-gradient(135deg, #0f172a, #1f2937); border-radius: 14px; padding: 10px 14px; margin-bottom: 20px;">
          <span style="color: #fff; font-size: 18px; font-weight: 700;">BookMyTime</span>
        </div>

        <h2 style="font-size: 22px; margin: 0 0 8px;">Your demo request is confirmed</h2>
        <p style="font-size: 14px; line-height: 1.6; color: #52525b; margin: 0 0 18px;">
          Hi ${data.name}, thanks for booking a product walkthrough. Our team will reach out shortly on your shared phone or email to finalize the session.
        </p>

        <div style="border: 1px solid #e4e4e7; border-radius: 18px; padding: 18px; background: #fafafa; margin-bottom: 18px;">
          <p style="margin: 0 0 10px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #71717a; font-weight: 700;">Request Summary</p>
          <p style="margin: 0 0 8px; font-size: 14px;"><strong>Reference:</strong> ${data.referenceId}</p>
          <p style="margin: 0 0 8px; font-size: 14px;"><strong>Organization:</strong> ${data.organization}</p>
          <p style="margin: 0 0 8px; font-size: 14px;"><strong>Preferred slot:</strong> ${scheduleLabel}</p>
          <p style="margin: 0 0 8px; font-size: 14px;"><strong>Mode:</strong> ${data.preferredMode}</p>
          <p style="margin: 0; font-size: 14px;"><strong>City:</strong> ${data.city}</p>
        </div>

        <p style="font-size: 13px; line-height: 1.6; color: #71717a; margin: 0;">
          If anything changes, reply to this email or call us on +91 9168 08 1355.
        </p>
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
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 28px 24px; background: #ffffff; color: #18181b;">
        <h2 style="font-size: 22px; margin: 0 0 10px;">New demo appointment request</h2>
        <p style="font-size: 13px; color: #52525b; margin: 0 0 18px;">A new lead has been captured from the public contact page.</p>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tbody>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; color: #71717a;">Reference</td><td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; font-weight: 600;">${data.referenceId}</td></tr>
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
      </div>
    `,
    text: `New demo request ${data.referenceId}\nName: ${data.name}\nEmail: ${data.email}\nPhone: ${data.phone}\nOrganization: ${data.organization}\nBusiness type: ${data.businessType}\nTeam size: ${data.teamSize}\nPreferred slot: ${scheduleLabel}\nMode: ${data.preferredMode}\nCity: ${data.city}\nNotes: ${data.message || "No extra notes"}`,
  });
}
