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
    from: `"MediFlow AI" <${process.env.EMAIL_USERNAME}>`,
    to: email,
    bcc: bcc || undefined,
    subject: `${code} — Your MediFlow AI Verification Code`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 28px;">
          <div style="display: inline-block; background: linear-gradient(135deg, #10b981, #059669); border-radius: 12px; padding: 10px 14px;">
            <span style="color: #fff; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">MediFlow AI</span>
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
          &copy; ${new Date().getFullYear()} MediFlow AI — Intelligent Healthcare Workspace
        </p>
      </div>
    `,
    text: `Your MediFlow AI verification code is: ${code}\n\nThis code expires in 10 minutes.\nIf you didn't request this, please ignore this email.`,
  });
}
