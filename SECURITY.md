# Security Policy

## Reporting a Vulnerability

If you believe you've found a security vulnerability in TaskFlow, please report it privately rather than opening a public issue.

- Email: hamadjan888@gmail.com
- Include: a description of the issue, steps to reproduce, and its potential impact.

Please allow a reasonable amount of time to investigate and address the issue before any public disclosure.

## Supported Versions

TaskFlow does not currently follow a formal versioning/release process. Security fixes are applied to the latest state of the default branch; there is no maintained set of older versions.

## Security Measures in Place

This is a summary of the security-relevant controls currently implemented, for reviewers and contributors — not an exhaustive audit.

### Authentication & Session Management

- Passwords are hashed with `bcryptjs` before storage; plaintext passwords are never persisted.
- Sessions use signed/encrypted JWTs (NextAuth, `AUTH_SECRET`).
- Email verification is required before a newly registered account can sign in.
- Password reset and email verification use single-use, randomly generated tokens; only their hash is stored in the database, and tokens expire.
- Sensitive account actions (change password, delete account) require re-entering the current password, in addition to a valid session.

### Rate Limiting

Database-backed rate limits (`lib/rate-limit.ts`) protect: login, registration, forgot-password, reset-password, resend-verification, change-password, delete-account, and the AI assistant endpoint. Limits are scoped per user, per IP, or per IP+email/token depending on the endpoint — see [docs/API.md](./docs/API.md) for specifics.

### Data Access Control

Every task read/write is scoped to the authenticated session's user ID at the repository layer (`{ id, userId }` in the query itself), not only checked in the route handler — a request cannot access or modify another user's tasks by manipulating an ID.

### HTTP Security Headers

Applied globally via `next.config.ts`:

- `Content-Security-Policy` (restrictive; no third-party script/style/frame origins)
- `Strict-Transport-Security`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — microphone access limited to same-origin (required for the voice assistant), camera and geolocation disabled
- `X-Powered-By` header removed

### Information Disclosure

- Forgot-password and resend-verification endpoints return an identical response whether or not an account exists for the given email, to avoid leaking account existence.
- Unhandled errors are logged server-side (`lib/logger.ts`) and returned to the client as a generic message — internal error detail (stack traces, query errors) is never included in API responses.
- The health check endpoint (`GET /api/health`) reports only liveness/readiness status, no internal state.

## Reporting Non-Security Bugs

For anything that isn't a security vulnerability, please open a regular issue instead — see [CONTRIBUTING.md](./CONTRIBUTING.md).
