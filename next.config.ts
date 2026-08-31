import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// No nonces: this app has no middleware/proxy.ts, and adding one just to
// thread a per-request nonce through would force every currently-static
// page (login, register, forgot-password, reset-password, settings, the
// marketing page) into dynamic rendering — a rendering-strategy change
// out of scope for a security-only pass. 'unsafe-inline' is required for
// script-src/style-src without nonces (Next.js's own hydration script and
// its injected styles are otherwise blocked); this still meaningfully
// restricts object-src, frame-ancestors, base-uri, form-action, and every
// external origin.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self' data:;
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`;

const nextConfig: NextConfig = {
  // Removes the `X-Powered-By: Next.js` response header, which otherwise
  // discloses the framework to any visitor for no functional benefit.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // `microphone=(self)` preserves the app's existing
            // voice-command feature (components/VoiceControl.tsx),
            // which relies on the browser's SpeechRecognition API.
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(self), geolocation=()",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Content-Security-Policy",
            value: cspHeader.replace(/\s{2,}/g, " ").trim(),
          },
          {
            // No `preload`: that requires a deliberate submission to the
            // browser preload list (hstspreload.org) once every
            // subdomain is confirmed to serve HTTPS, which is a
            // separate decision for deployment, not this audit.
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
