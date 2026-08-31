# 08 — Implementation

This document explains *how* TaskFlow was built at the code level — concrete mechanisms, not restated architecture. See [03-System-Architecture.md](./03-System-Architecture.md) and [04-System-Design.md](./04-System-Design.md) for the higher-level structure this implements.

## 1. Authentication Implementation

### 1.1 Password Hashing

`bcryptjs`, cost factor **12**, used consistently in three places: `AuthService.prepareRegistration`, `changePassword`, and `resetPassword`. All three call `bcrypt.hash(password, 12)`. Verification uses `bcrypt.compare` (`auth.ts`'s `authorize()`, and both `changePassword`/`deleteAccount` for current-password confirmation) — never a manual hash comparison, avoiding timing-attack-prone `===` checks on hash output.

### 1.2 JWT Session Handling

NextAuth v5 (`auth.ts`) with `session: { strategy: "jwt" }` — no database-backed session table. The `jwt` callback copies `id`/`name`/`email` onto the token on initial sign-in, and handles a `trigger === "update"` case that lets the client (specifically the settings page, after a profile-name change) push a new name into the token without a full re-login. The `session` callback then projects the token's fields onto `session.user` for client consumption. Session validity is therefore purely a function of JWT signature validity and expiry (`AUTH_SECRET`) — there is no server-side session record to revoke.

### 1.3 Email Verification

Implemented as a token-based flow, not a magic-link-only or code-based one:
1. `crypto.randomBytes(32).toString("hex")` generates a 64-hex-char raw token.
2. `hashToken()` (`lib/auth/token.ts`, `crypto.createHash("sha256")`) hashes it.
3. The **raw** token goes into the emailed URL (`${appUrl}/verify-email?token=${rawToken}`); the **hash** is what's stored in `VerificationToken.token`.
4. On verification, the incoming token is re-hashed and looked up by hash — the raw token is never persisted, so a database compromise alone cannot be used to verify/reset accounts using stored data.
5. Expiry is checked in application code (`resetToken.expiresAt < new Date()`), not enforced by the database (no TTL/expiry mechanism at the Postgres level).

### 1.4 Password Reset

Structurally identical mechanism to email verification, using the separate `PasswordResetToken` table (see [05-Database-Design.md § 3.3](./05-Database-Design.md#33-verificationtoken--passwordresettoken) for why two tables rather than one). Both `forgotPassword` and `resetPassword` in `AuthService` return the same generic messages regardless of internal state, to avoid account-existence leakage (see [11-Security.md](./11-Security.md)).

## 2. Task CRUD Implementation

### 2.1 Repository Pattern

Every Prisma query lives in `lib/repositories/*.ts`, never inline in a route or service. The pattern used throughout (`TaskRepository`, `UserRepository`, etc.) is a plain class with an async method per query shape, instantiated once and exported as a singleton (`export const taskRepository = new TaskRepository();`) — not a DI container, not a factory. This keeps the pattern simple and the call sites (`import { taskRepository } from "@/lib/repositories/task.repository"`) explicit about their dependency.

**Generic `select` typing:** `UserRepository.findById`/`findByEmail` and the token repositories' `findByHash` use a TypeScript generic (`T extends Prisma.UserSelect | undefined`) so the same method can return either the full model or a narrowed `Prisma.UserGetPayload<{ select: T }>` shape depending on whether a `select` object was passed — avoiding a proliferation of near-duplicate repository methods for different field subsets (e.g., one method for "get user for auth" needing `password`, another for "get user for profile" that shouldn't).

**Raw `Prisma.PrismaPromise` returns:** Several repository methods (`UserRepository.updatePassword`, `markEmailVerified`; both token repositories' `create`/`deleteMany`/`deleteByEmail`) are declared without `async` and return the Prisma call directly. This is required — not stylistic — for these calls to be usable inside a `prisma.$transaction([queryA, queryB])` array form, which needs the original un-awaited query promise object, not a value returned from an `async` wrapper function.

### 2.2 Service Layer

`TaskService` (`lib/services/task.service.ts`) is intentionally thin relative to `AuthService` — task operations don't have the same multi-step orchestration needs (no external email calls, no token generation). Its main value-adds beyond pass-through repository calls:
- `ensureFound()` — centralizes "repository returned null → throw `NotFoundError`" so every one of `updateTask`/`deleteTask`/`completeTask`/`uncompleteTask` doesn't repeat that check.
- `findMatchingTask()`/`toTaskWhereInput()` — the search/matching logic shared between the AI executor's task-resolution step and the general search intent, translating a loosely-typed `AITaskQuery` into a proper `Prisma.TaskWhereInput` with case-insensitive `contains`/`equals` matching.

### 2.3 Prisma Usage Patterns

- **Single shared client** (`lib/prisma.ts`), `globalThis`-memoized outside production to survive Next.js dev-mode hot reloads without exhausting database connections — the standard documented Prisma-with-Next.js pattern.
- **`server-only` import guard** at the top of `lib/prisma.ts` — a build-time assertion (via the `server-only` package convention) that this module can never be accidentally imported into client-bundled code.
- **Transactions for multi-table atomicity**, used at every point where two or more tables must change together or not at all: registration (user + verification token), account deletion (tokens + user), password reset (password update + token cleanup), email verification (user flag + token cleanup).

## 3. AI Implementation

Covered in full in [07-AI-Module.md](./07-AI-Module.md). The implementation-level summary: the pipeline is a straight-line sequence of pure(ish) functions (`parseIntent` → `parseAIResponse` → `validateAIResponse` → `AIContextManager.resolve` → `AIExecutor.execute` → `buildIntentMessage` → `AIContextManager.remember`), each with a single, narrow responsibility and its own typed error — no single function in the pipeline does more than one of "call the LLM," "parse JSON," "validate shape," "resolve context," "execute," or "format a message."

## 4. Validation Implementation

Two layers, deliberately not unified into one (see [04-System-Design.md § 7](./04-System-Design.md#7-validation-module)):
- **Zod** for AI response shape validation only (`lib/ai/validator.ts`) — appropriate for validating the structure of untrusted, non-deterministic external (LLM) output.
- **Hand-written functions** for task field business rules (`lib/task/task-validator.ts`) — length limits, allow-lists, date parsing — shared verbatim between the REST routes and the AI mapper (`lib/ai/mappers/task.mapper.ts`).

Both REST create/update paths call the *same* underlying validator functions with different entry points (`validateTitleForCreate` vs. `validateTitleForUpdate`, etc.) rather than one function branching on a mode flag — a deliberate readability choice, at the documented cost of two near-duplicate implementations per field that must be kept in sync manually (visible in the `TODO(Phase 2.2)` comments noting where create/update, or REST/AI, already drifted slightly and were left that way rather than silently unified).

## 5. Logging Implementation

`lib/logger.ts` — four methods (`debug`/`info`/`warn`/`error`), each a thin wrapper calling `emit()`, which prefixes the message with `[ISO-timestamp] [LEVEL]` and delegates to the matching native `console` method. Used via `import { logger } from "@/lib/logger"` throughout route handlers and services in place of direct `console.*` calls — though not universally: `lib/ai/parser.ts` and several `AuthService` config-check branches still call `console.error` directly rather than `logger.error`, a minor inconsistency worth noting for anyone standardizing further.

## 6. Environment Configuration

- **AI config** (`lib/ai/config.ts`) is the only subsystem with a dedicated, memoized config-resolution module — see [04-System-Design.md § 9](./04-System-Design.md#9-configuration-module) for why.
- **Auth/email config** (`RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, `AUTH_SECRET`) is checked inline, at the point of use, inside `AuthService` methods and NextAuth's own configuration — not centralized.
- **`.env` vs `.env.local`:** the repository's own files (not committed; inspected for variable names only) split `DATABASE_URL`/`AUTH_SECRET`/`RESEND_API_KEY`/`NEXT_PUBLIC_APP_URL` into `.env` and `GROQ_API_KEY`/`AI_PROVIDER`/`AI_MODEL` into `.env.local` — Next.js loads both, with `.env.local` taking precedence; this split appears to be a developer convenience (core vs. AI-specific config) rather than a functional requirement.
- **CI environment:** `.github/workflows/ci.yml` sets `DATABASE_URL`, `AUTH_SECRET`, `RESEND_API_KEY`, and `NEXT_PUBLIC_APP_URL` to placeholder values, with an explicit comment noting these are build-time-only placeholders since CI never talks to a real database or email provider and `next build` never executes a route handler — the values exist purely so module-level `process.env` reads at import time (e.g. `resend.ts`'s `new Resend(...)`) don't throw during the build.

## 7. Project Structure & Code Organization

```
app/            Routes (pages + api/), colocated with their .test.ts files
components/     Shared client components
lib/
  ai/           AI pipeline (client, prompt, parser, validator, executor, context/, mappers/)
  auth/         Token hashing helper
  email/        Resend client
  errors/       AppError + typed subclasses
  repositories/ Prisma data-access layer
  services/     Business logic (auth, tasks)
  task/         Task validation + serialization
  types/        Shared AI-related TypeScript types
  logger.ts, prisma.ts, rate-limit.ts
prisma/         schema.prisma (no migrations/ — see 05-Database-Design.md)
```

**Organizational conventions observed consistently across the codebase:**
- **Section-banner comments** (`// ==================================`) delimit logical blocks within a file — used pervasively in route handlers, `Dashboard.tsx`, and services, functioning as in-file table-of-contents markers.
- **Colocated tests:** every `*.ts`/`.tsx` file with meaningful logic has a sibling `*.test.ts` in the same directory (e.g., `lib/ai/config.ts` + `lib/ai/config.test.ts`), rather than a parallel `__tests__/` tree.
- **One class instance exported per module** for services/repositories (`export const taskService = new TaskService();`), consumed as a singleton import everywhere — no dependency-injection framework.
- **Named, dated audit comments** ("Phase 6 security audit," "Phase 7 performance audit") mark points where a specific past review changed the code and explain why — functioning as inline architectural-decision records rather than a separate ADR document set.

---
*Related documents: [03-System-Architecture.md](./03-System-Architecture.md), [04-System-Design.md](./04-System-Design.md), [07-AI-Module.md](./07-AI-Module.md), [09-Testing.md](./09-Testing.md)*
