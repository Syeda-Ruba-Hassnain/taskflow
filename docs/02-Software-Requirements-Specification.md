# 02 — Software Requirements Specification

*Format loosely follows the IEEE 830 structure, adapted for a single-application, repository-derived SRS. Every requirement below is either directly implemented (marked **Implemented**) or, in a small number of clearly marked cases, inferred as a reasonable requirement behind an existing implementation choice.*

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements of TaskFlow as built. Unlike a conventional SRS authored before implementation, this SRS was reverse-derived from the existing, working codebase, so it describes what the system *does*, with requirement statements phrased the way they would have been written prospectively.

### 1.2 Scope

TaskFlow is a web-based, multi-user task management system with an integrated natural-language AI assistant. It covers account lifecycle management, task CRUD, and AI-driven task operations via voice or text. See [01-Project-Overview.md § Scope](./01-Project-Overview.md#scope) for the in-scope/out-of-scope boundary.

### 1.3 Definitions, Acronyms, Abbreviations

| Term | Meaning |
|---|---|
| AI Intent | One of ten structured actions the AI pipeline can execute against a user's tasks (see [07-AI-Module.md](./07-AI-Module.md)) |
| JWT | JSON Web Token — used for NextAuth session state |
| LLM | Large Language Model — the Groq-hosted model used for intent parsing |
| Rate limit bucket | A row in the `RateLimit` table tracking request counts for a given key within a time window |
| Ownership scoping | Restricting a data query/mutation to rows where `userId` matches the authenticated session |

### 1.4 System Overview

TaskFlow is a single Next.js application serving both a server-rendered UI and a JSON API from one codebase. See [03-System-Architecture.md](./03-System-Architecture.md) for the full architectural breakdown.

### 1.5 User Characteristics

- End users are assumed to have a modern web browser and, for voice features, a browser implementing the Web Speech API (Chrome/Edge; Firefox and Safari have limited/no support, and `VoiceControl.tsx` explicitly detects and degrades for this).
- No administrative/privileged user role exists in the system — every account has identical capabilities over its own data. *(Confirmed: no `role` field on the `User` model in `prisma/schema.prisma`.)*

## 2. Functional Requirements

### Authentication & Account Lifecycle

**FR-1 — User Registration.** The system shall allow an unauthenticated user to create an account with a name (2–100 characters), a valid email address, and a password (8–128 characters). *(Implemented: `app/api/register/route.ts`)*

**FR-2 — Duplicate Email Prevention.** The system shall reject registration if an account already exists for the submitted email. *(Implemented: `AuthService.prepareRegistration`, throws `ConflictError`)*

**FR-3 — Email Verification.** The system shall require a newly registered account to verify its email address via a time-limited (1 hour), single-use token before it can sign in. *(Implemented: `verificationTokenRepository`, `EmailNotVerifiedError` in `auth.ts`)*

**FR-4 — Resend Verification Email.** The system shall allow a user to request a new verification email, invalidating any previously issued one, without revealing whether the submitted email belongs to an existing or already-verified account. *(Implemented: `app/api/resend-verification/route.ts`)*

**FR-5 — Credentials Login.** The system shall authenticate a user by email and password, issuing a JWT-based session on success. *(Implemented: `auth.ts`, NextAuth Credentials provider)*

**FR-6 — Login Rate Limiting.** The system shall limit login attempts to 5 per 15 minutes per email address. *(Implemented: `auth.ts`, key `login:${email}`)*

**FR-7 — Forgot Password.** The system shall allow a user to request a password-reset email by submitting their email address, without revealing whether an account exists for it. *(Implemented: `app/api/forgot-password/route.ts`)*

**FR-8 — Reset Password.** The system shall allow a user holding a valid, unexpired reset token to set a new password (8–128 characters), which must differ from the current password. *(Implemented: `app/api/reset-password/route.ts`, `AuthService.resetPassword`)*

**FR-9 — Change Password.** The system shall allow an authenticated user to change their password by supplying their current password and a new one, differing from the current password. *(Implemented: `app/api/change-password/route.ts`)*

**FR-10 — Update Profile.** The system shall allow an authenticated user to update their display name (2–100 characters). *(Implemented: `app/api/profile/route.ts`)*

**FR-11 — Delete Account.** The system shall allow an authenticated user to permanently delete their account (and all associated tasks and tokens) after re-confirming their password. *(Implemented: `app/api/delete-account/route.ts`)*

**FR-12 — Sign Out.** The system shall allow an authenticated user to end their session. *(Implemented: NextAuth `signOut`, `components/Navbar.tsx`)*

### Task Management

**FR-13 — Create Task.** The system shall allow an authenticated user to create a task with a required title (≤200 chars), an optional description (≤2000 chars), a category (`Work`, `Personal`, `Study`, `Other`; default `Other`), a priority (`Low`, `Medium`, `High`; default `Medium`), and an optional due date. *(Implemented: `POST /api/tasks`)*

**FR-14 — List Tasks.** The system shall return all tasks belonging to the authenticated user. *(Implemented: `GET /api/tasks`)*

**FR-15 — Update Task.** The system shall allow an authenticated user to update any subset of a task's fields, provided the task belongs to them. *(Implemented: `PATCH /api/tasks/:id`)*

**FR-16 — Complete/Uncomplete Task.** The system shall allow a task's completion state to be toggled. *(Implemented: `completed` field via `PATCH /api/tasks/:id`, and via the AI `complete_task`/`uncomplete_task` intents)*

**FR-17 — Delete Task.** The system shall allow an authenticated user to permanently delete a task they own. *(Implemented: `DELETE /api/tasks/:id`)*

**FR-18 — Task Ownership Isolation.** The system shall prevent a user from reading, modifying, or deleting a task owned by another user, including via ID guessing. *(Implemented: every repository method scopes the query to `{ id, userId }`, e.g. `lib/repositories/task.repository.ts`)*

**FR-19 — Client-Side Filtering & Sorting.** The system shall let a user filter their task list by completion status, priority, category, and due-date bucket (overdue/today/tomorrow/upcoming), and sort by newest, oldest, priority, or due date, without a server round-trip. *(Implemented: `app/dashboard/Dashboard.tsx`, filter/sort state and derived lists)*

### AI Assistant

**FR-20 — Voice Command Input.** The system shall allow an authenticated user to issue task commands by speech, using the browser's Web Speech API, with a graceful disabled state where unsupported. *(Implemented: `components/VoiceControl.tsx`)*

**FR-21 — Text Command Input.** The system shall allow an authenticated user to issue the same task commands by typing, as a functional equivalent to voice input. *(Implemented: `components/AITextControl.tsx`)*

**FR-22 — AI Intent Parsing.** The system shall parse a natural-language transcript into one of ten structured intents (create, update, delete, complete, uncomplete, list, search, change priority, change category, summarize today) using an LLM. *(Implemented: `lib/ai/client.ts`, `lib/ai/prompt.ts`)*

**FR-23 — AI Response Validation.** The system shall validate the AI's JSON response against a strict schema before executing any action, rejecting malformed or unexpected output. *(Implemented: `lib/ai/parser.ts`, `lib/ai/validator.ts`, Zod schema)*

**FR-24 — AI Conversational Context.** The system shall resolve ambiguous references ("mark **that** complete") against the most recent task or search the user interacted with in the current session, for up to 30 minutes of inactivity. *(Implemented: `lib/ai/context/context.manager.ts`, `context.store.ts`)*

**FR-25 — AI-Driven Task Execution.** The system shall execute a validated AI intent using the same task service and validation rules as the manual REST API, so AI-created/modified tasks are indistinguishable in validity from manually created ones. *(Implemented: `lib/ai/executor.ts` → `taskService`)*

**FR-26 — AI Delete Confirmation.** The system shall not delete a task directly from an AI command; it shall resolve the target task and require the user to confirm deletion through the existing UI confirmation flow. *(Implemented: `AIExecutor.deleteTask` only resolves the task; `Dashboard.tsx` gates the actual `DELETE` call behind a confirmation modal)*

**FR-27 — AI Rate Limiting.** The system shall limit AI requests to 20 per minute per authenticated user. *(Implemented: `app/api/ai/intent/route.ts`, `AI_RATE_LIMIT`)*

**FR-28 — AI Transcript Length Limit.** The system shall reject AI command transcripts longer than 2,000 characters. *(Implemented: `MAX_TRANSCRIPT_LENGTH` in `app/api/ai/intent/route.ts`)*

**FR-29 — Voice Feedback.** The system shall optionally speak the AI assistant's response back to the user using the browser's speech synthesis API. *(Implemented: `VoiceControl.tsx`, `speak()`, gated by `enableVoiceFeedback`)*

### Platform / Operations

**FR-30 — Health Check.** The system shall expose an unauthenticated endpoint reporting process liveness and database connectivity, suitable for load balancer/uptime-monitor polling. *(Implemented: `GET /api/health`)*

**FR-31 — Centralized Logging.** The system shall log significant events and errors through a single, consistently formatted logging interface rather than ad hoc console calls. *(Implemented: `lib/logger.ts`, used throughout route handlers)*

**FR-32 — Startup Configuration Validation.** The system shall validate AI-related environment configuration once at server startup and log a clear diagnostic if misconfigured, without preventing the rest of the application from serving traffic. *(Implemented: `instrumentation.ts`)*

## 3. Non-Functional Requirements

### 3.1 Performance

- API routes issue a bounded, small number of database queries per request (no N+1 patterns observed across the routes/repositories reviewed).
- The AI pipeline enforces a configurable request timeout (`AI_REQUEST_TIMEOUT_MS`, default 15,000 ms) against the upstream LLM call, failing cleanly with a `504`-equivalent `AppError` rather than hanging. *(`lib/ai/client.ts`)*
- *Assumption:* no explicit performance SLA (e.g., "p95 response time under Xms") is defined anywhere in the repository; this NFR is descriptive of implemented mechanisms, not a measured target.

### 3.2 Reliability

- Every route handler wraps its logic in a `try/catch` that maps known errors (`AppError` subclasses) to specific HTTP statuses and unknown errors to a generic `500`, so a single unexpected failure returns a controlled response instead of an unhandled crash.
- The AI pipeline validates untrusted LLM output before acting on it (Zod schema), so a malformed model response cannot corrupt task data.

### 3.3 Availability

- The health check endpoint (`GET /api/health`) is unauthenticated by design specifically so external monitoring infrastructure can poll it without a session, enabling automated availability monitoring.
- *Assumption:* no documented uptime target (e.g., "99.9%") exists in the repository; availability tooling exists, but a specific SLA is not asserted.

### 3.4 Security

See [11-Security.md](./11-Security.md) for full detail. Summary: bcrypt password hashing (cost factor 12), hashed single-use tokens for verification/reset flows, database-scoped rate limiting on every sensitive endpoint, CSP/HSTS/`X-Frame-Options`/`Permissions-Policy` headers applied globally, and repository-layer ownership scoping on all task data access.

### 3.5 Scalability

- The application is stateless at the HTTP layer with one documented exception: `lib/ai/context/context.store.ts` holds AI conversation memory in an in-process `Map`, which does not share state across multiple server instances. This is a genuine scalability constraint on the AI conversational-context feature specifically (not on the rest of the application) under a horizontally-scaled or serverless deployment. See [07-AI-Module.md § Limitations](./07-AI-Module.md#limitations) and [14-Future-Enhancements.md](./14-Future-Enhancements.md).
- Rate limiting is implemented against PostgreSQL rather than an in-memory store, which *is* consistent across multiple instances, at the cost of a DB round-trip per rate-limited request.

### 3.6 Maintainability

- Consistent layering (route → service → repository) across every feature area, verified by direct inspection of all API routes.
- A single shared validation module (`lib/task/task-validator.ts`) is the documented source of truth for task field rules, used by both the REST and AI code paths — reducing the risk of the two diverging.
- One notable exception: `app/dashboard/Dashboard.tsx` is currently a large, single client component combining task state, filtering, AI command routing, and modal management. It functions correctly today but is the primary candidate for future modularization to restore the otherwise-consistent decomposition pattern.

### 3.7 Usability

- The voice assistant degrades gracefully (disabled state with an explanatory message) in browsers without Web Speech API support, rather than failing silently or crashing.
- Toast notifications (`components/Toast.tsx`) use appropriate ARIA roles (`alert`/`status`) and `aria-live` regions for screen-reader users.
- A keyboard shortcut (Ctrl+Shift+V) is provided for toggling voice input without a mouse.

### 3.8 Portability

- The application depends on PostgreSQL specifically (`prisma/schema.prisma`, `datasource db { provider = "postgresql" }`) — not portable to another RDBMS without a schema/provider change.
- Deployable to any Node.js-capable host supporting Next.js; no cloud-provider-specific API is called directly in application code.

### 3.9 Compatibility

- Voice input requires a browser implementing `SpeechRecognition`/`webkitSpeechRecognition` (Chrome, Edge; not supported in Firefox, limited in Safari at the time of writing). The text input path (`AITextControl.tsx`) is the documented fallback and exercises the identical backend pipeline.
- Per `AGENTS.md`, this project runs on a Next.js version with breaking changes from the Next.js most developers know; contributors are directed to consult `node_modules/next/dist/docs/` before making framework-adjacent changes.

## 4. Constraints

- **Database:** PostgreSQL is required; no alternative datasource is supported by the current schema.
- **AI Provider:** The AI assistant requires a configured Groq API key (`GROQ_API_KEY`); without it, `instrumentation.ts` logs a startup warning and AI requests fail cleanly with a `500` `AppError`, but the rest of the application continues to function.
- **Email Provider:** Registration, verification, and password-reset flows require a configured Resend API key (`RESEND_API_KEY`) and `NEXT_PUBLIC_APP_URL`; missing either throws an `AppError` at the point those flows are used.
- **Committed Prisma migration history exists:** `prisma/migrations/20260731112025_init/migration.sql` is committed to the repository and matches `prisma/schema.prisma`. This enables a repeatable production deploy path with `npx prisma migrate deploy`.
- **No middleware/edge layer:** the application has no `middleware.ts`/`proxy.ts`; every route independently re-validates the session (confirmed by direct inspection of all route handlers), and CSP is applied without per-request nonces (documented tradeoff in `next.config.ts`'s own comments).

## 5. Assumptions

- Single-tenant-per-user data model: tasks are never shared or delegated between accounts.
- The intended deployment target is a standard Node.js/Next.js host (e.g., Vercel or an equivalent); no infrastructure-as-code (Terraform, Pulumi, Dockerfile) is present in the repository to confirm a specific target.
- The project is developed and maintained by a small team or individual, based on repository structure and git history (see [12-Project-Management.md](./12-Project-Management.md)).

## 6. Use Cases

### UC-1: Register and Verify an Account
**Actor:** Unauthenticated visitor
**Flow:** Visitor submits name/email/password → account created (unverified) → verification email sent → visitor clicks link → account marked verified → visitor can now log in.
**Related:** FR-1, FR-2, FR-3

### UC-2: Create a Task by Voice
**Actor:** Authenticated user
**Flow:** User clicks the mic (or presses Ctrl+Shift+V) → speaks "buy groceries tomorrow" → transcript sent to `/api/ai/intent` → AI returns `create_task` intent → task created via `taskService` → dashboard refreshes → confirmation toast and optional spoken confirmation.
**Related:** FR-20, FR-22, FR-23, FR-25, FR-29

### UC-3: Resolve a Follow-Up Command
**Actor:** Authenticated user
**Flow:** User says "buy groceries tomorrow" (task created, remembered as `lastTask`) → user says "make it high priority" → AI response omits an explicit task reference → `AIContextManager.resolve()` substitutes the remembered task → priority updated.
**Related:** FR-24, FR-25

### UC-4: Recover a Forgotten Password
**Actor:** Unauthenticated visitor with an existing account
**Flow:** Visitor submits their email on the forgot-password form → system sends a reset email if (and only if, silently) an account exists → visitor clicks the link within 1 hour → submits a new password → password updated, all reset tokens for that email cleared.
**Related:** FR-7, FR-8

### UC-5: Attempt to Access Another User's Task
**Actor:** Authenticated user (malicious or mistaken)
**Flow:** User issues `PATCH /api/tasks/{someone-else's-id}` → repository query `{ id, userId }` matches zero rows → `updateForUser` returns `null` → route returns `404 Not Found`, not the other user's data.
**Related:** FR-18

## 7. Acceptance Criteria (by feature area)

| Feature | Acceptance Criteria |
|---|---|
| Registration | Valid submissions create an unverified account and send exactly one verification email; duplicate emails are rejected with a clear error; the account cannot sign in until verified. |
| Login | Valid credentials for a verified account succeed; invalid credentials, unverified accounts, and rate-limit-exceeded attempts each fail with a distinguishable, appropriate error. |
| Task CRUD | A user can create, read, update, and delete only their own tasks; attempts against another user's task ID return `404`, not `403` or the data itself (avoiding existence leakage). |
| AI Assistant | A supported intent phrase results in the correct task-service call and an accurate, human-readable confirmation message; an unsupported or malformed model response fails cleanly without corrupting data. |
| Rate Limiting | Exceeding a documented limit returns `429` with a `Retry-After` header; requests under the limit are unaffected. |
| Health Check | Returns `200` with `status: "ok"` when the database is reachable; returns `503` with `status: "error"` when it is not. |

---
*Related documents: [01-Project-Overview.md](./01-Project-Overview.md), [03-System-Architecture.md](./03-System-Architecture.md), [06-API-Documentation.md](./06-API-Documentation.md), [11-Security.md](./11-Security.md)*
