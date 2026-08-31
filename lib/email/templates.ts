export function verificationHtml(name: string | null, verificationUrl: string) {
  return `
          <div
            style="
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 0 auto;
              padding: 24px;
            "
          >
            <h1 style="color: #111827;">Verify your TaskFlow email</h1>

            <p style="color: #4b5563; line-height: 1.6;">Hi ${escapeHtml(
              name?.trim() || "there"
            )},</p>

            <p style="color: #4b5563; line-height: 1.6;">You requested a new email
              verification link for your TaskFlow account.</p>

            <div style="margin: 30px 0;">
              <a href="${verificationUrl}" style="background: #111827; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Verify Email</a>
            </div>

            <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour.</p>

            <p style="color: #6b7280; font-size: 14px;">If you didn't request this
              email, you can safely ignore it.</p>
          </div>
        `;
}

export function resetPasswordHtml(name: string | null, resetUrl: string) {
  return `
          <div
            style="
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 0 auto;
              padding: 24px;
            "
          >
            <h1 style="color: #111827;">Reset your password</h1>

            <p style="color: #4b5563; line-height: 1.6;">Hi ${escapeHtml(
              name?.trim() || "there"
            )},</p>

            <p style="color: #4b5563; line-height: 1.6;">We received a request to
              reset your TaskFlow password.</p>

            <div style="margin: 32px 0;">
              <a href="${resetUrl}" style="display: inline-block; background: #111827; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Reset Password</a>
            </div>

            <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">This password reset link expires in 1 hour.</p>

            <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
          </div>
        `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
