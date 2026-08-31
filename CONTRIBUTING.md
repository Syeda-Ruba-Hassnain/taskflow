# Contributing to TaskFlow

## Getting Started

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in the required values (see the file for descriptions of each variable).
3. Apply database migrations:
   ```bash
   npx prisma migrate dev
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```

## Before Opening a Pull Request

Run the same checks CI runs (`.github/workflows/ci.yml`) locally first:

```bash
npm test              # vitest run
npm run lint           # eslint
npx tsc --noEmit       # type check
npm run build           # production build
```

All four must pass before a PR is merged.

## Code Organization

TaskFlow follows a layered structure — route handlers stay thin and delegate to services, which delegate to repositories for data access. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) before adding a new feature so it lands in the right layer:

- New API endpoints go in `app/api/`, following the existing pattern of: auth check → validate → rate limit (if applicable) → delegate to a service → map errors via `AppError`.
- Business logic belongs in `lib/services/`, not in route handlers.
- Prisma queries belong in `lib/repositories/`, scoped to the authenticated user where applicable — never trust a client-supplied user ID.
- New AI-assistant intents go through `lib/ai/` (prompt, validator, executor) and should reuse `taskService` rather than duplicating task logic.

## Tests

- Add or update `*.test.ts` files alongside the code you change.
- Prefer testing at the service/route level for business logic; the AI pipeline has its own integration tests (`lib/ai/integration.test.ts`) for the full parse → validate → execute flow.
- Coverage is tracked (`npm run test:coverage`) for the areas listed in `vitest.config.mts` — if you touch one of those areas, keep it covered.

## Commit Style

Recent history uses a loose Conventional Commits style, e.g.:

```
feat: complete production readiness improvements
refactor(auth): complete AuthService migration
```

Use a `type: description` (or `type(scope): description`) summary line where it fits (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`), and explain the *why* in the body for anything non-obvious.

## Security

Do not open a public issue for a security vulnerability — see [SECURITY.md](./SECURITY.md) for how to report it privately.

## Environment & Secrets

Never commit `.env`, `.env.local`, or any file containing real credentials — they're already covered by `.gitignore`. If you add a new required environment variable, add it to `.env.example` (with a placeholder, never a real value) and document it in the README.
