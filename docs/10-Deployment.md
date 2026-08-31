# 10 — Deployment

## 1. Prerequisites

- Node.js 20+ (matches CI: `.github/workflows/ci.yml` uses `node-version: 20`)
- npm
- A PostgreSQL database (any Postgres-compatible provider — the schema uses no provider-specific extensions)
- A [Groq](https://groq.com) API key (for the AI assistant; the rest of the app functions without one, degraded — see Section 7)
- A [Resend](https://resend.com) API key (for account emails — registration, verification, password reset are non-functional without one)

## 2. Installation

```bash
git clone <repository-url>
cd taskflow
npm install
```

`npm install` triggers `@prisma/client`'s own postinstall hook, which runs `prisma generate` automatically (no explicit `postinstall` script is defined in `package.json`, and none is needed — confirmed by this session's successful `npm run build`).

## 3. Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | NextAuth JWT signing/encryption secret (generate via `npx auth secret`) |
| `RESEND_API_KEY` | Yes for email flows | Transactional email (verification, password reset) |
| `NEXT_PUBLIC_APP_URL` | Yes for email flows | Base URL used to build links inside emails |
| `GROQ_API_KEY` | Yes for AI features | Groq API key for the AI assistant |
| `AI_PROVIDER` | No | Informational label only — not read by application code |
| `AI_MODEL` | No | Defaults to `llama-3.3-70b-versatile` if unset |
| `AI_REQUEST_TIMEOUT_MS` | No | Defaults to `15000` if unset |

See `.env.example` (repository root) for the canonical, up-to-date list — this table is kept consistent with it.

## 4. Database Setup

```bash
# Point DATABASE_URL at a real PostgreSQL instance, then:
npx prisma migrate dev --name init
```

This step now works in a fresh clone of this repository because committed migration history exists under `prisma/migrations/20260731112025_init/migration.sql`, which matches `prisma/schema.prisma`.

A fresh database can be provisioned with:

```bash
npx prisma migrate deploy
```

The prior gap described in this document has been resolved by committing the baseline migration history. `npx prisma db push` remains an acceptable local-development convenience for disposable databases, but production deployment should use `prisma migrate deploy` against the committed migration history.

## 5. Migration (Ongoing)

Once a baseline migration exists (Section 4):

```bash
# Local development, after changing schema.prisma:
npx prisma migrate dev --name <descriptive-name>

# Production / CI, applying already-committed migrations:
npx prisma migrate deploy
```

`prisma.config.ts` already points `migrations.path` at `prisma/migrations`, so no configuration change is needed once the directory exists — only the missing migration files themselves.

## 6. Build

```bash
npm run build     # next build (Turbopack)
npm run start     # serve the production build
```

Verified this session: `npm run build` completes successfully — "Compiled successfully in 12.0s," type-check finished in 16.9s, all 23 routes generated (14 dynamic `ƒ`, 9 static `○`, matching the mixed rendering strategy discussed in [03-System-Architecture.md § 2.1](./03-System-Architecture.md#21-presentation-layer)).

Pre-build verification (also CI's sequence, and this document's Section 9 references it):
```bash
npm test
npm run lint
npx tsc --noEmit
```

## 7. Production Deployment

TaskFlow is a standard Next.js application with no cloud-provider-specific code (no direct AWS/GCP/Azure SDK calls, no Vercel-specific APIs referenced in application code) — it deploys to any Node.js host capable of running `next start`, or to a platform with native Next.js support (e.g., Vercel).

**Deployment steps:**
1. Provision PostgreSQL; set `DATABASE_URL`.
2. Set all required environment variables (Section 3).
3. Apply migrations: `npx prisma migrate deploy`.
4. `npm run build && npm run start`.
5. Point uptime monitoring / load balancer health checks at `GET /api/health`.

**Graceful-degradation behavior worth knowing before deploying:**
- If `GROQ_API_KEY` is missing/invalid, `instrumentation.ts` logs a startup warning but the rest of the application starts normally — every non-AI feature works; AI requests fail with a clean `500` (`"AI features are not configured."`).
- If `RESEND_API_KEY`/`NEXT_PUBLIC_APP_URL` are missing, registration/verification/password-reset requests fail with a `500` *at the point they're used* — there is no startup-time check for these (unlike the AI config), so this would only surface the first time a user tries one of those flows.

## 8. Environment Configuration Notes

- `NODE_ENV` is read in two places with different effects: `lib/prisma.ts` (whether to cache the Prisma client on `globalThis`) and `next.config.ts` (whether to allow `'unsafe-eval'` in the CSP for dev-mode tooling). Both are standard Next.js-managed values — not something a deployer sets manually in most hosting setups.
- No `.env` file is read in production by Next.js itself beyond what the hosting platform injects as real process environment variables; `.env`/`.env.local` are development conveniences (loaded via `dotenv/config` in `prisma.config.ts` specifically for CLI usage outside the Next.js runtime).

## 9. Troubleshooting

| Symptom | Likely Cause | Where to Look |
|---|---|---|
| `GET /api/health` returns `503` | Database unreachable or `DATABASE_URL` incorrect | `app/api/health/route.ts`; check `logger.error("Health check failed...")` output |
| AI requests fail with "AI features are not configured." | `GROQ_API_KEY` missing/invalid | Check startup logs for `instrumentation.ts`'s `[startup] AI configuration is invalid` line |
| Registration/password-reset return 500 | `RESEND_API_KEY` or `NEXT_PUBLIC_APP_URL` missing | `AuthService`'s inline config checks; no startup-time warning exists for this today (Section 7) |
| Fresh-database deploy has no tables | Missing migration history | This gap has been resolved by the committed baseline migration in `prisma/migrations/20260731112025_init/migration.sql`. |
| `429 Too Many Requests` unexpectedly | Rate limit bucket not yet expired, or `RateLimit` table growing large enough to slow lookups over a long-lived deployment | `lib/rate-limit.ts`; see [05-Database-Design.md § 8](./05-Database-Design.md#8-database-lifecycle) on unbounded `RateLimit` growth |
| Build fails with a Prisma type error after a schema change | `prisma generate` didn't re-run | Re-run `npm install` or `npx prisma generate` directly |

## 10. Maintenance

- **No automated deployment pipeline exists** — `.github/workflows/ci.yml` verifies (test/lint/typecheck/build) but does not deploy. Any release today is a manual step. See [14-Future-Enhancements.md](./14-Future-Enhancements.md).
- **`RateLimit` table has no cleanup job** (Section 9 above, and [05-Database-Design.md § 8](./05-Database-Design.md#8-database-lifecycle)) — a periodic `DELETE FROM "RateLimit" WHERE "resetAt" < now()` (manual or scheduled) is advisable for a long-lived production deployment, though not yet implemented.
- **Dependency currency:** `next-auth` is on a beta release (`5.0.0-beta.32`) at time of writing — worth monitoring for a stable 5.x release and upgrading deliberately rather than incidentally via `npm update`.

---
*Related documents: [05-Database-Design.md](./05-Database-Design.md), [09-Testing.md](./09-Testing.md), [11-Security.md](./11-Security.md), [14-Future-Enhancements.md](./14-Future-Enhancements.md)*
