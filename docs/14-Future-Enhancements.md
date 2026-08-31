# 14 — Future Enhancements

This roadmap is grounded in gaps and limitations actually identified elsewhere in this documentation set — not a generic feature wishlist. Each item cross-references where the underlying issue was found.

## 1. Short-Term (next iteration — closes known gaps, no new features)

| Item | Why | Reference |
|---|---|---|
| Confirm and maintain committed Prisma migration history | The repository now contains baseline migration history under `prisma/migrations/20260731112025_init/migration.sql`; future schema changes should continue to use `prisma migrate dev`/`prisma migrate deploy` rather than `db push` for production databases | [05-Database-Design.md § 7](./05-Database-Design.md#7-migration-strategy), [10-Deployment.md § 4](./10-Deployment.md#4-database-setup) |
| Add a `RateLimit` cleanup job (scheduled task or a `DELETE ... WHERE resetAt < now()` run periodically) | Table currently grows unbounded — no expiry-based deletion exists beyond one narrow login-success case | [05-Database-Design.md § 8](./05-Database-Design.md#8-database-lifecycle), [11-Security.md § 6](./11-Security.md#6-rate-limiting) |
| Add dedicated unit tests for `lib/rate-limit.ts` and `components/**` | Currently outside the coverage-tracked scope entirely | [09-Testing.md § 3](./09-Testing.md#3-coverage-statistics) |
| Decompose `Dashboard.tsx` into smaller components/hooks | The one file that departs from the codebase's otherwise-consistent decomposition pattern | [04-System-Design.md § 3](./04-System-Design.md#3-dashboard-module) |
| Standardize `console.error` calls (e.g. in `lib/ai/parser.ts`, `AuthService` config checks) onto `lib/logger.ts` | Minor consistency gap in an otherwise centralized logging convention | [08-Implementation.md § 5](./08-Implementation.md#5-logging-implementation) |

## 2. Medium-Term

| Item | Why |
|---|---|
| Move AI conversational context (`AIContextStore`) to a shared store — Redis, or a new PostgreSQL table alongside `RateLimit` | Current in-memory `Map` doesn't share state across multiple server instances or serverless invocations, which is a real correctness risk the moment this deploys behind more than one running instance |
| Add an explicit CSRF token / synchronizer pattern for state-changing API routes | Current protection relies on `SameSite=Lax` cookie defaults and the absence of CORS rather than an application-level control the team explicitly built |
| Add a CD pipeline (deploy step after CI's existing test/lint/typecheck/build) | Only CI exists today; every release is currently a manual step |
| Introduce per-user timezone (a `timezone` field on `User`, or a client-supplied timezone header) | The AI's relative-date resolution is hardcoded to `Asia/Karachi`, which is correct for exactly one timezone's users |
| Add `npm audit` (or an equivalent dependency-vulnerability scan) to CI | No dependency-vulnerability scanning currently exists in the pipeline |
| Track and monitor the `next-auth` 5.x stable release and plan a deliberate upgrade off the beta | Currently pinned to `5.0.0-beta.32` |

## 3. Long-Term Vision

- **Multi-user task collaboration** (shared tasks, assignment, permissions) — a genuinely new data-model capability, not present in the current single-owner `Task.userId` schema. Would require a join table (e.g. `TaskCollaborator`) and a real authorization model beyond the current "owner-only" scoping.
- **Notifications** (due-date reminders, digest emails) — no scheduling/background-job infrastructure currently exists in the codebase; this would be new infrastructure, not an extension of anything present today.
- **Native mobile clients** — the current application is web-only; a mobile client would likely consume the existing REST API (`docs/06-API-Documentation.md` already documents it independently of the web UI) rather than requiring new backend work, aside from possibly relaxing the current same-origin-only CORS posture.

## 4. Scalability Roadmap

1. **Resolve the AI context store's single-instance assumption** (Section 2) before any horizontal scaling of the application — this is the one component in the current architecture that would misbehave, not merely underperform, under multiple instances.
2. **Revisit DB-backed rate limiting's cost** if request volume grows enough that the extra round-trip per protected request becomes measurable — a Redis-backed limiter would remove that cost but reintroduces the same cross-instance-consistency question the AI context store already has, so this should be solved once, consistently, for both.
3. **Confirm (or add) an index on `Task.userId`** — every task query filters on it, and its presence in the actual database is now auditable through the committed migration history. Reviewing the current migration file is the correct next step for this audit.

## 5. Enterprise Roadmap

*Framed conditionally — these are what a genuine multi-tenant/enterprise posture would require, not a claim that this is the project's current direction:*

- Role-based access control (currently every account is equally privileged over only its own data — no admin/org-owner concept exists).
- Audit logging of sensitive actions (password changes, account deletion, task deletion) beyond the current operational `logger.error`/`logger.warn` calls, which are not structured for compliance/audit review.
- SSO / enterprise identity provider support, alongside (not necessarily replacing) the current Credentials-only NextAuth configuration.
- Data export / GDPR-style "download my data" and formalized deletion-confirmation flows beyond the current password-confirmed hard delete.

## 6. AI Improvements

Cross-referenced from [07-AI-Module.md § 17](./07-AI-Module.md#17-future-improvements):

- Shared/persistent conversational context store (Section 2 above).
- User-configurable timezone for relative-date resolution.
- A bounded, deliberate application-level retry for transient Groq failures (none exists today — a timeout or network error surfaces immediately to the user).
- Usage/cost telemetry — no token consumption or per-request cost is currently logged or tracked anywhere.
- Consider exposing model choice as a genuine runtime configuration (today, `AI_MODEL` is an env var read once and effectively fixed for the process lifetime) if multi-model support ever becomes a requirement.

## 7. Performance Improvements

- `RateLimit` cleanup (Section 1) — the most concrete, already-identified item.
- Revisit whether the DB-backed rate limiter should be replaced or supplemented once request volume makes the extra round-trip measurable (Section 4).
- Investigate whether `Task.userId` needs an explicit index once the migration-history gap is resolved and the actual database can be inspected directly (Section 4).

## 8. Security Improvements

Cross-referenced from [11-Security.md § 12](./11-Security.md#12-known-limitations):

- Explicit CSRF protection for custom API routes (Section 2 above).
- Session revocation mechanism — currently a JWT cannot be invalidated server-side before its natural expiry, meaning a password change doesn't invalidate sessions issued before it.
- Dependency vulnerability scanning in CI (Section 2 above).
- A deliberate plan for the `next-auth` beta-to-stable transition (Section 2 above).

---
*Related documents: [05-Database-Design.md](./05-Database-Design.md), [07-AI-Module.md](./07-AI-Module.md), [11-Security.md](./11-Security.md), [13-Lessons-Learned.md](./13-Lessons-Learned.md)*
