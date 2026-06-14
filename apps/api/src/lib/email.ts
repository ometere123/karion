import nodemailer from "nodemailer";

// Lazy-initialized: built on first send so env vars are guaranteed to be loaded
let _transport: nodemailer.Transporter | null | undefined = undefined;

function getTransport(): nodemailer.Transporter | null {
  if (_transport !== undefined) return _transport;
  if (!process.env.SMTP_HOST) {
    _transport = null;
    return null;
  }
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // false → STARTTLS on 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transport;
}

export async function sendPasswordResetEmail(
  to: string,
  resetLink: string
): Promise<void> {
  const transport = getTransport();

  if (!transport) {
    // Development fallback: print to console — never reaches a mail server
    console.log("\n======== KARION DEV EMAIL ========");
    console.log(`To:      ${to}`);
    console.log(`Subject: Reset your Karion password`);
    console.log(`Link:    ${resetLink}`);
    console.log("==================================\n");
    return;
  }

  const from = process.env.EMAIL_FROM || "noreply@karion.app";

  try {
    await transport.sendMail({
      from,
      to,
      subject: "Reset your Karion password",
      text: `Reset your Karion password:\n\n${resetLink}\n\nExpires in 1 hour. If you did not request this, ignore the email.`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
        <h2 style="color:#6D5DF6;margin-bottom:8px;">Reset your Karion password</h2>
        <p style="color:#374151;">Click the button below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetLink}" style="display:inline-block;margin:24px 0;padding:12px 28px;background:#6D5DF6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Reset Password</a>
        <p style="color:#9CA3AF;font-size:13px;">If you did not request a password reset, you can safely ignore this email. Your password will not change.</p>
      </div>`,
    });
  } catch (err) {
    // In development, fall back to console so the flow can be tested even when
    // SMTP is configured but unreachable (wrong creds, firewall, no relay, etc.).
    if (process.env.NODE_ENV !== "production") {
      console.log("\n======== KARION DEV EMAIL (SMTP failed — using console fallback) ========");
      console.log(`To:      ${to}`);
      console.log(`Subject: Reset your Karion password`);
      console.log(`Link:    ${resetLink}`);
      console.log("=========================================================================\n");
      return;
    }
    throw err;
  }
}
