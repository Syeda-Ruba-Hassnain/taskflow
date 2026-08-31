# Architecture

## Overview

TaskFlow is a single Next.js application (App Router) that serves both the UI and its API from one deployable unit. There is no separate backend service.

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                           │
│  app/dashboard, app/login, ...  (React 19 client/server  │
│  components) + VoiceControl / AITextControl               │
└───────────────────────────┬────────────────────────────┘
                             │ fetch()
┌───────────────────────────▼────────────────────────────┐
│              Next.js Route Handlers (app/api/**)          │
│  auth check → request validation → delegate → map errors  │
└───────────┬───────────────────────────────┬─────────────┘
            │                               │
┌───────────▼─────────────┐   ┌─────────────▼─────────────┐
│   Services (lib/services)│   │   AI Pipeline (lib/ai)     │
│   auth.service            │   │  client → parser →         │
│   task.service             │   │  validator → context →     │
└───────────┬─────────────┘   │  executor → messages        │
            │                  └─────────────┬─────────────┘
┌───────────▼──────────────────────────────▼─────────────┐
│         Repositories (lib/repositories/**)                │
│   Prisma queries scoped to the authenticated user ID       │
└───────────────────────────┬──────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   PostgreSQL     │
                    │  (via Prisma)    │
                    └──────────────────┘
```

## Layers

### Route handlers (`app/api/**`)

Each route handler is responsible for:
1. Authenticating the request (`auth()` from `auth.ts`, backed by NextAuth JWT sessions).
2. Validating/parsing the request body.
3. Applying rate limits where relevant (`lib/rate-limit.ts`).
4. Delegating business logic to a service.
5. Mapping the result (or a thrown `AppError`) to an HTTP response.

Route handlers do not talk to Prisma directly for anything beyond simple, explicit transactions (`prisma.$transaction`) that coordinate multiple repository calls atomically — the actual queries still go through repositories.

### Services (`lib/services/**`)

`authService` and `taskService` hold business logic: password hashing, token generation/verification, orchestrating multi-step flows (e.g. registration = create user + create verification token + send email), and enforcing invariants that don't belong in a single repository call.

### Repositories (`lib/repositories/**`)

Thin, typed wrappers around Prisma Client for each model (`User`, `Task`, `VerificationToken`, `PasswordResetToken`). Task repository methods that mutate or read a specific task always scope the query to `{ id, userId }`, so ownership is enforced at the data-access layer rather than relying solely on a check in the route handler.

### AI pipeline (`lib/ai/**`)

The AI assistant is a separate entry point into the same task-management functionality, not a separate data model:

- `client.ts` — talks to the Groq API (OpenAI-compatible) to turn a transcript into a structured JSON response.
- `prompt.ts` — the system prompt that constrains the model's output format and resolves relative dates.
- `parser.ts` / `validator.ts` — parse and validate the model's JSON response before it's trusted.
- `context/` — resolves references to previous turns in the conversation (e.g. "mark **that** complete") and stores conversation state per user.
- `executor.ts` — maps a validated intent to a `taskService` call, so AI-driven and REST-driven task mutations share the same validation and persistence logic.
- `messages.ts` — builds the human-readable confirmation message returned to the client.

### Errors (`lib/errors/**`)

Domain errors extend `AppError`, which carries an HTTP status code and optional extra response fields. Route handlers have a single `catch` branch that checks `instanceof AppError` and returns its status/message directly; anything else is logged and returns a generic `500`. This keeps error-to-HTTP-status mapping in one place per error type instead of scattered through route handlers.

## Cross-Cutting Concerns

- **Rate limiting** (`lib/rate-limit.ts`) is implemented as a PostgreSQL-backed fixed-window counter (the `RateLimit` model), keyed by a caller-supplied string (e.g. `login:<email>`, `ai-intent:<userId>`). This avoids needing a separate in-memory store or external service like Redis, at the cost of a database round-trip per rate-limited request.
- **Logging** (`lib/logger.ts`) is a single, dependency-free wrapper around `console` used throughout the route/service layers instead of ad hoc `console.log` calls, so output is consistently timestamped and leveled.
- **Startup validation** (`instrumentation.ts`) runs once per server instance and validates the AI configuration eagerly, logging a clear warning if it's missing without preventing the rest of the app from serving traffic.
- **Security headers & CSP** (`next.config.ts`) are applied globally via `headers()`, including a Content-Security-Policy, HSTS, and a `Permissions-Policy` that explicitly scopes microphone access to same-origin (required by the voice assistant).

## Data Model

See [`prisma/schema.prisma`](../prisma/schema.prisma) for the full schema. Core models:

- **User** — account record; owns many `Task`s.
- **Task** — title, description, category, priority, completed flag, due date; belongs to one `User` (cascade-deleted with the user).
- **VerificationToken** / **PasswordResetToken** — short-lived, hashed tokens for email verification and password reset flows, keyed by email.
- **RateLimit** — fixed-window counters used by `lib/rate-limit.ts`.

## Why This Structure

The route → service → repository split exists so that the two entry points into task mutations — the REST API and the AI assistant — share exactly one implementation of validation and persistence (`taskService`, `lib/task/task-validator.ts`), instead of the AI executor reimplementing task rules independently and risking drift from the REST API's behavior.
