# API Reference

All routes are Next.js App Router route handlers under `app/api/`. Unless noted otherwise:

- Request and response bodies are JSON.
- Authenticated routes require a valid NextAuth session cookie (set via `POST /api/auth/callback/credentials`) and return `401` if the session is missing or invalid.
- Error responses have the shape `{ "error": "<message>" }`, sometimes with extra fields merged in (e.g. `{ "error": "...", "accountCreated": true }`).
- Rate-limited routes return `429` with a `Retry-After` header (seconds) when the limit is exceeded.

## Health

### `GET /api/health`

Unauthenticated. Reports process liveness and database readiness for load balancers / uptime monitors.

**200 OK**
```json
{
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": { "database": { "status": "ok", "latencyMs": 4 } }
}
```

**503 Service Unavailable** (database unreachable)
```json
{
  "status": "error",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": { "database": { "status": "error" } }
}
```

## Authentication

### `GET /api/auth/*`, `POST /api/auth/*`

Handled by NextAuth (`auth.ts`) via its catch-all route (`app/api/auth/[...nextauth]/route.ts`). Includes `POST /api/auth/callback/credentials` (sign in), `POST /api/auth/signout`, and NextAuth's session/CSRF endpoints. Credentials sign-in is rate-limited to 5 attempts / 15 minutes per email, and fails with a specific error code when the account's email isn't verified yet.

### `POST /api/register`

Creates a new account and sends a verification email. Rate-limited to 5 attempts / hour per IP.

**Body**
```json
{ "name": "Jane Doe", "email": "jane@example.com", "password": "at least 8 characters" }
```

**201 Created**
```json
{ "message": "Account created. Please check your email to verify your account.", "accountCreated": true, "user": { "...": "..." } }
```

### `POST /api/verify-email`

Verifies a user's email using the token sent by `/api/register` or `/api/resend-verification`.

**Body**: `{ "token": "<64-char hex token>" }`
**200 OK**: `{ "message": "Your email has been verified successfully." }`

### `POST /api/resend-verification`

Re-sends the verification email if an unverified account exists for the given email. Rate-limited to 3 attempts / 15 minutes per IP+email. Always returns the same success message regardless of whether the account exists, to avoid leaking account existence.

**Body**: `{ "email": "jane@example.com" }`

### `POST /api/forgot-password`

Sends a password-reset email if an account exists for the given email. Rate-limited to 3 attempts / 15 minutes per IP+email. Always returns the same success message regardless of account existence.

**Body**: `{ "email": "jane@example.com" }`

### `POST /api/reset-password`

Resets a password using the token from the forgot-password email. Rate-limited to 5 attempts / 15 minutes per IP+token.

**Body**: `{ "token": "<64-char hex token>", "password": "new password, 8-128 chars" }`
**200 OK**: `{ "message": "Your password has been reset successfully." }`

### `PATCH /api/change-password`

Authenticated. Changes the current user's password. Rate-limited to 5 attempts / 15 minutes per user.

**Body**: `{ "currentPassword": "...", "newPassword": "8-128 chars" }`
**200 OK**: `{ "message": "Password changed successfully." }`

### `PATCH /api/profile`

Authenticated. Updates the current user's display name.

**Body**: `{ "name": "2-100 chars" }`
**200 OK**: `{ "message": "Profile updated successfully.", "user": { "...": "..." } }`

### `DELETE /api/delete-account`

Authenticated. Deletes the current user's account (and cascades to their tasks and tokens) after verifying their password. Rate-limited to 5 attempts / 15 minutes per user.

**Body**: `{ "password": "..." }`
**200 OK**: `{ "message": "Your account has been deleted successfully." }`

## Tasks

All task routes are authenticated and scoped to the signed-in user — a user can never read, modify, or delete another user's task, even by guessing an ID.

### `GET /api/tasks`

Returns all tasks owned by the current user.

**200 OK**: `Task[]`

### `POST /api/tasks`

Creates a task for the current user.

**Body**
```json
{
  "title": "required",
  "description": "optional, nullable",
  "category": "optional, one of the valid categories, defaults to \"Other\"",
  "priority": "optional, one of the valid priorities, defaults to \"Medium\"",
  "dueDate": "optional, ISO date string or null"
}
```

**201 Created**: the created `Task`.

### `PATCH /api/tasks/:id`

Updates one or more fields of a task owned by the current user. Only the fields present in the body are changed.

**Body** (all fields optional): `{ "title", "description", "category", "priority", "completed", "dueDate" }`

**200 OK**: the updated `Task`.
**404 Not Found**: the task doesn't exist or isn't owned by the current user.

### `DELETE /api/tasks/:id`

Deletes a task owned by the current user.

**200 OK**: `{ "message": "Task deleted successfully" }`
**404 Not Found**: the task doesn't exist or isn't owned by the current user.

## AI Assistant

### `POST /api/ai/intent`

Authenticated. Parses a natural-language voice/text transcript into a task-management intent and executes it. See the [README's AI Capabilities section](../README.md#ai-capabilities) for the supported intents and pipeline. Rate-limited to 20 requests / minute per user; transcripts are capped at 2,000 characters.

**Body**: `{ "transcript": "mark the grocery task complete" }`

**200 OK**
```json
{
  "success": true,
  "intent": "complete_task",
  "message": "Marked \"Buy groceries\" as complete.",
  "result": { "...": "serialized Task or Task[]" }
}
```

**4xx/5xx** (validation failure, rate limit, AI misconfiguration, or upstream AI timeout)
```json
{ "success": false, "error": "..." }
```

## Task Object Shape

```ts
{
  id: number;
  title: string;
  description: string | null;
  category: "Work" | "Personal" | "Study" | "Other";
  priority: "Low" | "Medium" | "High";
  completed: boolean;
  dueDate: string | null; // "YYYY-MM-DD"
  createdAt: string;
  updatedAt: string;
}
```
