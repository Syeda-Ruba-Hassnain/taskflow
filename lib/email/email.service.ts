/* eslint-disable @typescript-eslint/no-explicit-any */
import { getBrevoClient } from "./brevo.client";
import { verificationHtml, resetPasswordHtml } from "./templates";
import { logger } from "@/lib/logger";

type SendResult = { error: null } | { error: unknown };

const senderName = process.env.BREVO_SENDER_NAME || "TaskFlow";
const senderEmail = process.env.BREVO_SENDER_EMAIL || "onboarding@taskflow.example";

async function sendTransacEmail(payload: any) {
  try {
    // The official SDK exposes TransactionalEmailsApi as a constructor on the
    // client. Construct and call `sendTransacEmail` which matches Brevo's
    // documented API surface. The client is created dynamically to avoid
    // executing provider code at module import time during builds.
    const client = await getBrevoClient();

    // Use the SDK's transactional emails client.
    const sendPromise = client.transactionalEmails.sendTransacEmail(payload);

    // `sendTransacEmail` returns an HttpResponsePromise; use withRawResponse
    // to capture status and body for detailed logging when needed.
    const { data, rawResponse } = await sendPromise.withRawResponse();

    // If we have a rawResponse, ensure status is 2xx.
    if (rawResponse && rawResponse.status >= 400) {
      // Treat as failure and throw to be handled below.
      const err: any = new Error("Brevo returned non-2xx status");
      err.status = rawResponse.status;
      err.body = data;
      throw err;
    }

    return { error: null } as SendResult;
  } catch (err: any) {
    // Sanitize and log useful debugging info without secrets.
    const status = err?.statusCode ?? err?.status ?? err?.rawResponse?.status;
    const body = err?.body ?? (err?.rawResponse ? err.rawResponse.body : undefined);

    logger.error("Email send failed", {
      status: status ?? "unknown",
      body,
      message: err?.message ?? String(err),
      stack: err?.stack,
    });

    return { error: { message: "delivery failed", status, body } } as SendResult;
  }
}

export async function sendVerificationEmail(opts: { name: string | null; email: string; rawToken: string; }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!process.env.BREVO_API_KEY || !appUrl) {
    logger.error("Missing BREVO_API_KEY or NEXT_PUBLIC_APP_URL");
    throw new Error("Email verification is not configured.");
  }

  const verificationUrl = `${appUrl}/verify-email?token=${opts.rawToken}`;

  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: opts.email, name: opts.name || undefined }],
    subject: "Verify your TaskFlow email",
    htmlContent: verificationHtml(opts.name, verificationUrl),
  };

  return await sendTransacEmail(payload);
}

export async function sendPasswordResetEmail(opts: { name: string | null; email: string; resetUrl: string; }) {
  if (!process.env.BREVO_API_KEY || !opts.resetUrl) {
    logger.error("Missing BREVO_API_KEY or NEXT_PUBLIC_APP_URL");
    throw new Error("Password reset is temporarily unavailable.");
  }

  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: opts.email, name: opts.name || undefined }],
    subject: "Reset your TaskFlow password",
    htmlContent: resetPasswordHtml(opts.name, opts.resetUrl),
  };

  return await sendTransacEmail(payload);
}

export default {
  sendVerificationEmail,
  sendPasswordResetEmail,
};
