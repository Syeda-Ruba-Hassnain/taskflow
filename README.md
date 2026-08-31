# TaskFlow

TaskFlow is a full-stack task management app built on Next.js. Alongside standard CRUD task management, it includes an AI assistant that lets users manage tasks through natural-language voice or text commands ("remind me to call the bank tomorrow", "mark the grocery task complete").

> **Note:** This project runs on a Next.js version with breaking changes from the Next.js you may be familiar with. Before making changes, read the framework docs in `node_modules/next/dist/docs/` (see [AGENTS.md](./AGENTS.md)).

## Features

- **Task management** — create, edit, complete, and delete tasks with a title, description, category, priority, and due date.
- **Authentication** — email/password registration with mandatory email verification, session-based login (JWT), forgot/reset password, change password, profile updates, and account deletion.
- **AI assistant** — natural-language task management by voice or text (see below).
- **Rate limiting** — database-backed rate limits on login, registration, password reset/change, account deletion, verification email resends, and AI requests.
- **Health check endpoint** — for load balancers, uptime monitors, and container orchestrators.
- **Centralized structured logging** — timestamped, leveled log output used consistently across the API layer.
- **Security headers** — CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, and a restrictive `Permissions-Policy` applied to every response.

## AI Capabilities

TaskFlow's AI assistant is a natural-language interface to the task manager, backed by an LLM hosted on [Groq](https://groq.com) (OpenAI-compatible API, default model `llama-3.3-70b-versatile`).

Supported intents:

| Intent | Example phrase |
|---|---|
| Create task | "Buy groceries tomorrow" |
| Update task | "Change the groceries task to high priority" |
| Complete / uncomplete task | "Mark the grocery task complete" |
| Delete task | "Delete the dentist appointment task" |
| List tasks | "What are my tasks?" |
| Search tasks | "Show my work tasks" |
| Change priority | "Make that task high priority" |
| Change category | "Move that to the Work category" |
| Summarize today | "What's on my plate today?" |

Each request goes through a fixed pipeline (`app/api/ai/intent/route.ts`):

1. **Parse** — the transcript is sent to the LLM with a system prompt that constrains it to a single, structured JSON response (`lib/ai/client.ts`, `lib/ai/prompt.ts`).
2. **Parse & validate** — the raw JSON is parsed and validated against the expected shape (`lib/ai/parser.ts`, `lib/ai/validator.ts`).
3. **Resolve context** — pronouns and implicit references ("mark **that** complete") are resolved against the user's recent conversation history (`lib/ai/context/`).
4. **Execute** — the resolved intent is mapped to a task-service call (`lib/ai/executor.ts`).
5. **Remember** — the exchange is stored as context for the next command.

Requests are authenticated, rate-limited to 20 requests/minute per user, and capped at 2,000 characters per transcript.

### Voice & Text AI Assistant

The assistant is available from the dashboard through two interchangeable input methods that both feed the same `/api/ai/intent` pipeline:

- **Voice (`components/VoiceControl.tsx`)** — uses the browser's Web Speech API (`SpeechRecognition`). Click the mic button or press **Ctrl+Shift+V** to start/stop listening. Optional spoken confirmation ("Command received.") via `SpeechSynthesis`. Falls back to a disabled state with a message in browsers that don't support speech recognition (e.g. Firefox).
- **Text (`components/AITextControl.tsx`)** — a plain text input for typing the same commands, useful when voice isn't available or practical.

Microphone access is scoped via the `Permissions-Policy` header (`microphone=(self)`) in `next.config.ts`.

## Architecture

TaskFlow follows a layered architecture on top of the Next.js App Router:

```
Route handlers (app/api/**)
        │  auth, request validation, HTTP status mapping
        ▼
Services (lib/services/**)
        │  business logic, orchestration, transactions
        ▼
Repositories (lib/repositories/**)
        │  Prisma queries, scoped to the authenticated user
        ▼
Prisma Client → PostgreSQL
```

- **Errors** are modeled as typed subclasses of `AppError` (`lib/errors/`), each carrying an HTTP status code; route handlers catch `AppError` and translate it directly into a JSON response.
- **AI pipeline** (`lib/ai/`) sits alongside the services layer and calls into `taskService` the same way the REST routes do, so task creation/update logic isn't duplicated between the two entry points.
- **Startup validation** (`instrumentation.ts`) checks the AI configuration once when the server boots and logs a clear warning if it's missing — the rest of the app still starts and serves traffic.
- **Data ownership**: every task query and mutation is scoped to the authenticated session's user ID at the repository layer, not just checked in the route handler.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for more detail and [docs/API.md](./docs/API.md) for the full API reference.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js](https://nextjs.org) 16 (App Router) |
| UI | [React](https://react.dev) 19, [Tailwind CSS](https://tailwindcss.com) 4 |
| Language | TypeScript 5 |
| Database / ORM | PostgreSQL via [Prisma](https://www.prisma.io) 6 |
| Auth | [NextAuth](https://authjs.dev) 5 (Credentials provider, JWT sessions) |
| AI | [OpenAI SDK](https://github.com/openai/openai-node) against the [Groq](https://groq.com) API |
| Email | [Resend](https://resend.com) |
| Password hashing | bcryptjs |
| Validation | Zod |
| Testing | [Vitest](https://vitest.dev) + `@vitest/coverage-v8` |
| Linting | ESLint 9 (`eslint-config-next`) |

## Installation

**Prerequisites:** Node.js 20+, npm, and a PostgreSQL database.

```bash
git clone <repository-url>
cd taskflow
npm install
```

## Environment Variables

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

See [.env.example](./.env.example) for the full list with descriptions. Never commit real secrets — `.env*` is already git-ignored.

## Running Locally

```bash
# Apply database migrations
npx prisma migrate dev

# Start the dev server
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Testing

```bash
npm test              # run the test suite once (vitest run)
npm run test:coverage # run with coverage (v8 provider)
```

Tests live alongside the code they cover (`*.test.ts`). Coverage is currently tracked for the AI pipeline, task management, auth flows, and their corresponding API routes — see `vitest.config.mts`.

## Build

```bash
npm run build
npm run start   # serve the production build
```

Also run before shipping:

```bash
npm run lint
npx tsc --noEmit
```

## Deployment

TaskFlow is a standard Next.js app and deploys to any Node.js hosting platform that supports Next.js (e.g. Vercel, a container, or a Node server).

1. Provision a PostgreSQL database and set `DATABASE_URL`.
2. Set the remaining required environment variables (see [.env.example](./.env.example)).
3. Run database migrations against the target database: `npx prisma migrate deploy`.
4. Build and start: `npm run build && npm run start`.
5. Point your load balancer / uptime monitor at `GET /api/health`.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: install, `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`, using placeholder env values (no real secrets are used in CI).

## Health Endpoint

```
GET /api/health
```

Unauthenticated by design, so it's reachable by infrastructure that doesn't hold a session. Reports process liveness and database readiness:

- `200 OK` — `{ "status": "ok", "timestamp": "...", "checks": { "database": { "status": "ok", "latencyMs": <number> } } }`
- `503 Service Unavailable` — `{ "status": "error", "timestamp": "...", "checks": { "database": { "status": "error" } } }` if the database is unreachable.

## Logger

`lib/logger.ts` is a small, dependency-free wrapper around `console` used everywhere the app logs instead of calling `console.*` directly:

```ts
import { logger } from "@/lib/logger";

logger.info("Task created", { taskId });
logger.warn("Rate limit exceeded", { userId });
logger.error("Health check failed", error);
```

Every call is prefixed with an ISO-8601 timestamp and an uppercase level (`[2026-01-01T00:00:00.000Z] [INFO] ...`) so output stays consistent and greppable regardless of which module logged it.

## Project Structure

```
app/
  api/                 API route handlers (REST + AI)
  dashboard/           Main authenticated dashboard UI
  login/, register/,   Auth-related pages
  forgot-password/,
  reset-password/,
  verify-email/,
  settings/
  generated/prisma/    Generated Prisma client (git-ignored)
components/            Shared React components (VoiceControl, AITextControl, Navbar, ...)
lib/
  ai/                  AI pipeline: client, parser, validator, context, executor, prompt
  auth/                Token helpers used by auth flows
  email/               Transactional email (Resend)
  errors/              Typed AppError subclasses
  repositories/        Prisma data-access layer
  services/            Business logic (auth, tasks)
  task/                Task validation and serialization
  logger.ts            Centralized logger
  prisma.ts            Prisma client singleton
  rate-limit.ts         Database-backed rate limiter
prisma/
  schema.prisma        Database schema
  migrations/           Migration history
public/                 Static assets
instrumentation.ts       Startup validation (AI config)
auth.ts                  NextAuth configuration
next.config.ts            Security headers, CSP
```

## Screenshots

<!-- TODO: add screenshots of the dashboard, AI assistant, and auth flows. -->

## Future Improvements

- Additional AI providers/models as alternatives to Groq.
- Push/email notifications for upcoming due dates.
- End-to-end (browser-level) test coverage alongside the existing unit/integration tests.
- Multi-language support for both the UI and the AI assistant.
- Offline support / optimistic sync for the task list.

## License

Proprietary — All rights reserved. This code is not licensed for reuse, modification, or redistribution without explicit permission from the project owner.
