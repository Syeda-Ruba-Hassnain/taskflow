# 11 — Security

This document explains the security controls actually implemented in the codebase, with the specific file/mechanism backing each claim. See [02-SRS § 3.4](./02-Software-Requirements-Specification.md#34-security) for the requirement-level summary and the standalone `SECURITY.md` at the repository root for the vulnerability-reporting process.

## 1. Authentication

NextAuth v5, Credentials provider, JWT session strategy (`auth.ts`). Login requires a matching bcrypt hash **and** a verified email (`emailVerified` non-null) — an unverified account cannot obtain a session even with correct credentials (`EmailNotVerifiedError`). Login is rate-limited to 5 attempts / 15 minutes per email.

## 2. Authorization

There is no role-based access control — every account has identical privileges over its own data (see [02-SRS § 1.5](./02-Software-Requirements-Specification.md#15-user-characteristics)). Authorization in this system is entirely **data ownership scoping**: every task query/mutation is filtered to `{ id, userId }` at the repository layer, so a valid session for user A structurally cannot read or affect user B's tasks. This is enforced identically for both the REST API and the AI pipeline, since both call `TaskRepository` through `TaskService`.

## 3. Password Hashing

`bcryptjs`, cost factor 12, applied at registration, password change, and password reset (`lib/services/auth.service.ts`). Verified via `bcrypt.compare` — never a manual string comparison. No plaintext password is logged, stored, or included in any response body anywhere in the codebase (confirmed by inspecting every route that touches a password).

## 4. Input Validation

- **Task fields:** allow-lists for `category`/`priority`, length caps for `title` (200) and `description` (2000), strict `YYYY-MM-DD` date parsing — `lib/task/task-validator.ts`, shared by REST and AI.
- **Auth fields:** email regex (`^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤254 chars), password length bounds (8–128), name length bounds (2–100) — repeated per route rather than centralized (see [08-Implementation.md § 4](./08-Implementation.md#4-validation-implementation)).
- **AI output:** Zod schema validation (`lib/ai/validator.ts`) treats the LLM's JSON response as untrusted external input, not as trusted application data, before it reaches the executor.
- **Token format:** verification/reset tokens are regex-checked (`/^[a-f0-9]{64}$/i`) before a database lookup is even attempted, rejecting obviously malformed input cheaply.

## 5. Output Validation / Response Shaping

- `task-serializer.ts` is the single point controlling what shape a `Task` takes in a response (`Date → YYYY-MM-DD` string) — the raw Prisma model is never returned to Prisma-model-shape-dependent client code without going through this.
- Unhandled/unexpected errors are logged server-side (`logger.error`) and returned to the client as a fixed generic message — no stack trace, SQL error text, or internal exception detail was found in any error response across the routes reviewed.

## 6. Rate Limiting

`lib/rate-limit.ts` — a PostgreSQL-backed fixed-window counter, applied to every sensitive endpoint:

| Endpoint | Limit | Key |
|---|---|---|
| Login | 5 / 15 min | `login:<email>` |
| Registration | 5 / hour | `register:<ip>` |
| Forgot password | 3 / 15 min | `forgot-password:<ip>:<email>` |
| Resend verification | 3 / 15 min | `resend-verification:<ip>:<email>` |
| Reset password | 5 / 15 min | `reset-password:<ip>:<tokenHash>` |
| Change password | 5 / 15 min | `change-password:<userId>` |
| Delete account | 5 / 15 min | `delete-account:<userId>` |
| AI intent | 20 / min | `ai-intent:<userId>` |

Rate-limited responses include a `Retry-After` header (seconds until the window resets). **Known limitation:** expired `RateLimit` rows are correctly ignored but never deleted except for the one specific case of a successful login clearing its own key (`auth.ts:136`) — the table grows unbounded over a long-lived deployment (see [05-Database-Design.md § 8](./05-Database-Design.md#8-database-lifecycle)).

## 7. Environment Variables & Secrets Management

- All secrets (`DATABASE_URL`, `AUTH_SECRET`, `RESEND_API_KEY`, `GROQ_API_KEY`) are read exclusively from `process.env`, never hardcoded.
- `.gitignore` excludes `.env*` broadly, with a specific `!.env.example` carve-out added during this documentation effort so the example template itself is committed while real `.env`/`.env.local` files are not.
- No secret value appears in any test file, fixture, or committed config — CI uses explicitly-named placeholder strings (`ci-placeholder-secret`, `ci-placeholder-key`) that are inert by construction, not real credentials with restricted scope.

## 8. SQL Injection Prevention

All database access goes through Prisma Client's parameterized query builder — no string-concatenated SQL was found anywhere in the codebase, with one deliberate, narrow exception: `app/api/health/route.ts` uses `prisma.$queryRaw\`SELECT 1\`` — a Prisma tagged-template raw query with **no interpolated values at all** (a static probe string), which the route's own comment explicitly calls out: "Static, non-parameterized probe query — no user input reaches this call, so there is no injection surface despite using `$queryRaw` instead of the query builder used everywhere else."

## 9. XSS Prevention

- **React's default output escaping** handles all UI-rendered data — no `dangerouslySetInnerHTML` usage was found in any component reviewed.
- **Email HTML** (`AuthService`'s verification/reset email templates) interpolates user-controlled data (the user's `name`) into raw HTML strings sent via Resend — this is the one place user input reaches an HTML context outside of React's automatic escaping, and it is explicitly handled: `escapeHtml()` (a small hand-written function in `auth.service.ts` escaping `&`, `<`, `>`, `"`, `'`) is applied to the name before interpolation in every email template.
- **CSP** (`next.config.ts`) provides defense-in-depth: `script-src 'self' 'unsafe-inline'`, `object-src 'none'`, `base-uri 'self'`. Note `'unsafe-inline'` is present for both `script-src` and `style-src` — the config's own comment explains this is required because there's no middleware to thread a per-request nonce through (a deliberate, documented tradeoff, not an oversight — see [03-System-Architecture.md § 2.2](./03-System-Architecture.md#22-api-layer)), which does meaningfully weaken the CSP's protection against inline-script-injection XSS specifically, while still restricting `object-src`, `frame-ancestors`, `base-uri`, `form-action`, and all external origins.

## 10. CSRF

There is **no explicit CSRF token mechanism** implemented in application code for the custom API routes (`/api/tasks`, `/api/register`, etc.) — no `X-CSRF-Token` header check, no synchronizer-token pattern. NextAuth's own credentials sign-in flow does include its own CSRF protection internally (a NextAuth library feature, not custom code in this repository). The practical exposure for the custom routes is reduced by two factors, neither of which is an intentional "CSRF defense" documented as such in the code, but both of which are real:
1. NextAuth's session cookie defaults to `SameSite=Lax`, which blocks the cookie from being sent on cross-site `fetch`/`XHR` requests (the mechanism a CSRF attack against a JSON API would need) — it is sent only on top-level, same-site navigations.
2. No CORS headers are configured anywhere, so a cross-origin page cannot read a response from these APIs even if it could trigger a request.

**This is flagged as a known limitation, not asserted as a solved problem** — `SameSite=Lax` is a browser default the application benefits from, not an application-level CSRF control the team explicitly built and tested. See [14-Future-Enhancements.md](./14-Future-Enhancements.md).

## 11. HTTP Security Headers

Applied globally via `next.config.ts`'s `headers()`:

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | See Section 9 | Restricts script/style/frame/origin surfaces |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Forces HTTPS for 2 years once seen (no `preload` — the config comments this is a deliberate separate decision requiring hstspreload.org submission) |
| `X-Frame-Options` | `DENY` | Prevents clickjacking via iframe embedding |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-sniffing-based attacks |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage to other origins |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=()` | Microphone scoped to same-origin specifically to support the voice assistant, camera and geolocation fully disabled |
| *(removed)* `X-Powered-By` | — | `poweredByHeader: false` — avoids disclosing the framework to any visitor |

## 12. Known Limitations

Consolidated from throughout this document and the rest of the documentation set:

1. **Committed database migration history exists** (`prisma/migrations/20260731112025_init/migration.sql`); this operational gap has been resolved in the repository. The migration history enables repeatable production provisioning via `npx prisma migrate deploy`.
2. **No explicit CSRF token mechanism** (Section 10) — relies on browser `SameSite` defaults and the absence of CORS rather than an application-level control.
3. **`RateLimit` table has no cleanup job** (Section 6) — availability/performance risk over a long deployment lifetime, not a confidentiality/integrity one.
4. **JWT sessions cannot be server-side revoked** — changing a password does not invalidate an already-issued session token elsewhere until it naturally expires ([03-System-Architecture.md § 6](./03-System-Architecture.md#6-authentication-flow)).
5. **CSP requires `'unsafe-inline'`** for script/style, a documented, deliberate tradeoff for avoiding middleware, which does narrow the CSP's effectiveness against inline-script XSS specifically.
6. **`next-auth` is a beta dependency** (`5.0.0-beta.32`) — a supply-chain/stability consideration for a production system, not a vulnerability per se.
7. **No secret-rotation or dependency-vulnerability-scanning process** is evidenced anywhere in the repository (no Dependabot config, no `npm audit` step in CI).

---
*Related documents: [05-Database-Design.md](./05-Database-Design.md), [06-API-Documentation.md](./06-API-Documentation.md), [10-Deployment.md](./10-Deployment.md), [14-Future-Enhancements.md](./14-Future-Enhancements.md), and the root-level `SECURITY.md`*
