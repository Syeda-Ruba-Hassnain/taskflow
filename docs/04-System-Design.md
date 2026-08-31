# 04 — System Design

This document details each functional module: its purpose, responsibilities, workflow, dependencies, error handling, and the design decisions behind it. See [03-System-Architecture.md](./03-System-Architecture.md) for how these modules relate to each other structurally.

## 1. Authentication Module

**Files:** `auth.ts`, `lib/services/auth.service.ts`, `lib/repositories/user.repository.ts`, `lib/auth/token.ts`, `app/api/register/route.ts`, `app/api/verify-email/route.ts`, `app/api/resend-verification/route.ts`, `app/api/forgot-password/route.ts`, `app/api/reset-password/route.ts`, `app/api/change-password/route.ts`, `app/api/delete-account/route.ts`

**Purpose:** Own the full account lifecycle — creation, verification, authentication, credential recovery, and deletion.

**Responsibilities:**
- Hash and verify passwords (bcrypt, cost factor 12).
- Issue, hash, and validate single-use tokens for email verification and password reset.
- Enforce rate limits on every credential-sensitive operation.
- Issue and validate JWT sessions (via NextAuth).

**Workflow (registration → verified account):**
1. `POST /api/register` validates name/email/password shape, then rate-limits by IP (5/hour).
2. `AuthService.prepareRegistration` checks for an existing account, hashes the password, and generates a raw token + its SHA-256 hash + a 1-hour expiry — but does not persist anything.
3. The route persists the user and the verification token together inside one `prisma.$transaction`, so the account is never created without a matching verification token (or vice versa).
4. `AuthService.completeRegistration` sends the verification email containing the **raw** token in the link; only the **hash** is stored in `VerificationToken.token`.
5. `POST /api/verify-email` hashes the incoming token, looks it up, checks expiry, and — again inside one transaction — marks the user verified and deletes the token row.

**Dependencies:** `bcryptjs`, `crypto` (Node's built-in, for `randomBytes` and the token hash), `resend` (email delivery), `lib/rate-limit.ts`.

**Error Handling:** Every failure mode is a specific `AppError` subclass (`ConflictError` for duplicate email, `ValidationError` for bad/expired tokens, `NotFoundError` for a missing account) so the route layer can map it to the correct status without inspecting error message strings.

**Design Decisions:**
- **Tokens are stored hashed, never raw.** A database read of the `VerificationToken`/`PasswordResetToken` tables cannot be used to impersonate a user, because the raw token (the only usable form) only ever exists in the emailed link and briefly in server memory while processing that one request.
- **Account existence is never revealed** by `forgot-password` or `resend-verification` — both return an identical success message regardless of whether the email matches an account, specifically to prevent account enumeration.
- **Same-password rejection on both password-change and password-reset** (`AuthService.changePassword`, `resetPassword`) — the new password is `bcrypt.compare`d against the current hash and rejected if identical, forcing an actual credential rotation.
- **`AuthService` cannot import Prisma directly** (see [03-System-Architecture.md § 2.3](./03-System-Architecture.md#23-business-logic-layer)), which is why several methods are split into a "prepare" half (service) and a "persist" half (route-owned transaction).

**Advantages:** No plaintext credential or usable secret is ever persisted; the prepare/persist split makes multi-table writes atomic without giving the service direct database access.

## 2. Task Management Module

**Files:** `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts`, `lib/services/task.service.ts`, `lib/repositories/task.repository.ts`, `lib/task/task-validator.ts`, `lib/task/task-serializer.ts`

**Purpose:** CRUD operations over a user's tasks, shared identically between the REST API and the AI pipeline.

**Responsibilities:** Validate task field input; enforce per-user ownership on every read/write; serialize `Date` fields to the client-facing `YYYY-MM-DD` string contract.

**Workflow:** See [03-System-Architecture.md § 5](./03-System-Architecture.md#5-request-lifecycle) for the full sequence diagram. In short: route validates input shape → `TaskService` method called → `TaskRepository` issues an ownership-scoped Prisma query → result serialized (`task-serializer.ts`) → JSON response.

**Dependencies:** `lib/task/task-validator.ts` (shared with the AI pipeline via `lib/ai/mappers/task.mapper.ts`), `@prisma/client` types.

**Error Handling:** `TaskValidationError` for bad field values (caught in the route, mapped to `400`); `NotFoundError` thrown by `TaskService.ensureFound` when an ownership-scoped update/delete matches zero rows (mapped to `404`).

**Design Decisions:**
- **`updateForUser`/`deleteForUser` are atomic ownership checks, not check-then-act.** `TaskRepository.updateForUser` calls `prisma.task.updateMany({ where: { id, userId }, data })` — the ownership filter is inside the same query as the mutation, not a separate `findFirst` beforehand. A comment on `PATCH /api/tasks/:id` documents that an earlier version *did* do a separate pre-check and it was removed in a "Phase 7 performance audit" specifically because it was a redundant round-trip — `updateMany`'s row count already tells the caller whether the row existed and was owned by this user.
- **`task-serializer.ts` is the single point where `Date → string` conversion happens**, used by both `app/api/tasks/*` and `app/api/ai/intent/route.ts`, so the client never has to handle two different due-date shapes depending on which path created/modified the task.
- **Category and priority are fixed allow-lists** (`VALID_CATEGORIES = ["Work", "Personal", "Study", "Other"]`, `VALID_PRIORITIES = ["Low", "Medium", "High"]`), not free text — rejecting an unrecognized value outright rather than coercing it, so a client (or the AI) can't silently introduce a category that doesn't render correctly in the fixed-style UI (`TaskCard.tsx`'s category/priority badge styling is keyed off these exact strings, falling back to a generic style for anything else).

**Advantages:** One validation implementation for two entry points (REST, AI); ownership enforcement that can't be bypassed by a service-layer oversight because it's baked into the repository query itself.

## 3. Dashboard Module

**Files:** `app/dashboard/page.tsx`, `app/dashboard/layout.tsx`, `app/dashboard/Dashboard.tsx`, `components/StatCard.tsx`, `components/TaskCard.tsx`, `components/Toast.tsx`

**Purpose:** The primary authenticated UI — task list, stats, filtering/sorting/search, task create/edit forms, and the AI assistant controls, all in one view.

**Responsibilities:** Fetch and locally cache the user's tasks; derive filtered/sorted views and summary stats (`total`, `completed`, `pending`, `overdue`) client-side; route both manual and AI-driven task changes through the same local state update path; surface toast feedback for every action.

**Workflow:** `app/dashboard/layout.tsx` resolves the session server-side and redirects unauthenticated visitors before any client code runs; `Dashboard.tsx` then owns all interactive state client-side, calling `/api/tasks/*` and `/api/ai/intent` via `fetch`.

**Dependencies:** `StatCard`, `TaskCard`, `Toast`, `VoiceControl`, `AITextControl` — all rendered from within `Dashboard.tsx`.

**Error Handling:** `runAICommand`/`handleVoiceCommand` wrap each fetch in `try/catch`, surfacing failures as an error-styled `Toast` (and, if voice feedback is on, spoken aloud) rather than letting a rejected promise go unhandled.

**Design Decisions:**
- **Filter/sort/clear/stats-readout voice commands are handled entirely client-side**, not routed through the AI backend — a comment in `Dashboard.tsx` explains these are "pure client-side view state" with no matching `AIIntent`, so round-tripping them through the LLM would add latency and cost for something regex matching already handles locally (`parseFilterCommand`, the `statsMatch` regex).
- **`SessionProvider` is scoped to `app/dashboard/layout.tsx` and `app/settings`**, not the root layout — per the "Phase 7 performance audit" comment discussed in [03-System-Architecture.md](./03-System-Architecture.md), avoiding an unnecessary client-side `/api/auth/session` fetch on pages that don't call `useSession()`.
- **A single large client component, by evolution rather than by design.** `Dashboard.tsx` is 2,584 lines combining task state, filters, AI routing, and modals. This is flagged as a maintainability observation in [03-System-Architecture.md § 9](./03-System-Architecture.md#9-tradeoffs-and-costs) and [13-Lessons-Learned.md](./13-Lessons-Learned.md) — it is functionally correct (covered by the passing build and no bugs identified in it during this audit) but is the one place the codebase's otherwise-consistent decomposition pattern doesn't apply.

**Advantages:** Manual and AI-driven changes converge on the same local-state update logic (`loadTasks()` after any successful mutation), so the UI never has two different code paths to keep in sync for "a task changed."

## 4. Settings & Profile Module

**Files:** `app/settings/page.tsx`, `app/api/profile/route.ts`, `app/api/change-password/route.ts`, `app/api/delete-account/route.ts`

**Purpose:** Self-service account management — display name, password, and account deletion — in one page.

**Responsibilities:** Client-side form state for three independent flows (profile edit, password change, account deletion), each with its own loading/error/success state.

**Workflow:** Uses NextAuth's `useSession()` with `update()` to refresh the client-side session's `name` immediately after a successful profile update, rather than waiting for the next natural session refresh — confirmed by `auth.ts`'s `jwt` callback, which explicitly handles a `trigger === "update"` case that reads the new name off the client-supplied `session` object.

**Dependencies:** `next-auth/react` (`useSession`, `signOut`).

**Error Handling:** Each of the three flows (profile, password, delete) has independent error state, so a failure in one doesn't affect the others' UI.

**Design Decisions:** Account deletion and password change both require re-entering the current password as a confirmation factor even though the user already holds a valid session — a deliberate defense against a stolen/XSS'd session cookie being used to take over or destroy an account without the attacker also knowing the password (documented explicitly in both routes' rate-limit comments).

## 5. AI Assistant Module

Documented in full in [07-AI-Module.md](./07-AI-Module.md). Summary for cross-reference:

**Purpose:** Translate natural-language voice/text input into one of ten structured task operations, with short-term conversational memory.

**Responsibilities:** LLM invocation, response parsing/validation, context resolution, intent execution, human-readable message generation.

**Design Decision (restated from Section 2):** shares `TaskService` and `task-validator.ts` with the REST API — the AI module has no independent task-mutation logic of its own.

## 6. Database Module

Documented in full in [05-Database-Design.md](./05-Database-Design.md). Summary: `lib/prisma.ts` exposes a single memoized `PrismaClient` instance; five models (`User`, `Task`, `VerificationToken`, `PasswordResetToken`, `RateLimit`) with `onDelete: Cascade` from `User` to `Task`.

## 7. Validation Module

**Files:** `lib/task/task-validator.ts`, `lib/ai/validator.ts` (Zod-based, AI-response-specific)

**Purpose:** Two distinct validation concerns, handled by two distinct mechanisms:
1. **Task field validation** (`task-validator.ts`) — hand-written functions, shared by REST and AI, enforcing length limits, allow-lists, and date format rules.
2. **AI response shape validation** (`lib/ai/validator.ts`) — a Zod schema (`AIResponseSchema`) validating the *structure* of untrusted LLM output before it's trusted enough to reach the task validators.

**Design Decision:** These are deliberately different tools for different jobs — Zod validates "is this JSON shaped the way I expect," which is exactly the problem of trusting external, non-deterministic LLM output; the hand-written task validators encode business rules (title ≤ 200 chars, category must be one of four values) that are simple enough not to need a schema library and are shared with code that predates the AI feature.

**Documented Inconsistency (preserved deliberately, not a bug):** `lib/task/task-validator.ts` contains two `TODO(Phase 2.2)` comments noting that the REST due-date parser (`parseDueDate`) and the AI due-date parser (`parseStrictDueDate`) intentionally differ — REST truncates a longer ISO string to its date portion and optionally treats whitespace as empty; the AI path requires an exact `YYYY-MM-DD` match. The comments explicitly state this divergence is preserved "rather than silently unified" to avoid changing either call site's existing behavior, and flagged for a future revisit.

## 8. Logging Module

**Files:** `lib/logger.ts`

**Purpose:** A single, consistent logging interface used in place of ad hoc `console.*` calls throughout the route/service layers.

**Design Decision:** Deliberately dependency-free — no Pino, Winston, or similar. `emit()` prefixes every call with an ISO-8601 timestamp and uppercase level and delegates to the matching native `console` method. This is a conscious minimalism tradeoff: no log levels configuration, no transport/shipping, no structured JSON output — appropriate for an application whose logs are captured by whatever the hosting platform captures from stdout, not for one feeding a dedicated log aggregator. See [11-Security.md](./11-Security.md) and [14-Future-Enhancements.md](./14-Future-Enhancements.md) for the observability implications.

## 9. Configuration Module

**Files:** `lib/ai/config.ts`, `instrumentation.ts`, `next.config.ts`, `prisma.config.ts`

**Purpose:** Centralize environment-variable resolution and validation for the AI subsystem specifically (the only subsystem with a dedicated config module — auth/email config is read inline where used, e.g. `process.env.RESEND_API_KEY` checks inside `AuthService`).

**Design Decision:** `getAIConfig()` is memoized after first successful resolution and is called from two different points for two different purposes: eagerly at server startup via `instrumentation.ts` (log-only — a missing key is reported but never crashes the process), and lazily by `lib/ai/client.ts` on each AI request (throws an `AppError`, becomes a clean `500` response). The source comment on `getAIConfig()` calls this out explicitly as "single source of truth for this validation," used both ways so a misconfigured deployment is visible in the logs immediately at boot *and* still fails safely per-request if someone missed the log line.

---
*Related documents: [03-System-Architecture.md](./03-System-Architecture.md), [05-Database-Design.md](./05-Database-Design.md), [07-AI-Module.md](./07-AI-Module.md), [08-Implementation.md](./08-Implementation.md)*
