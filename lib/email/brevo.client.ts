/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getBrevoClient() {
  const apiKey = process.env.BREVO_API_KEY;

  // Defer throwing to the call-site; allow builds that only import types to succeed.
  // Calls that actually send mail should validate presence and fail fast.

  const mod = await import("@getbrevo/brevo");

  // The SDK exports a `BrevoClient` constructor (named export).
  const BrevoClient = (mod as any).BrevoClient || (mod as any).Brevo?.BrevoClient || (mod as any).default?.BrevoClient;

  if (!BrevoClient) {
    throw new Error("BrevoClient constructor not found in @getbrevo/brevo module");
  }

  return new BrevoClient({ apiKey });
}
