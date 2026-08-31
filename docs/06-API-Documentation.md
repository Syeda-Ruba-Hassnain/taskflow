# 06 — API Documentation

All endpoints are Next.js Route Handlers under `app/api/`. Base conventions, applicable to every endpoint below unless stated otherwise:

- **Content-Type:** `application/json` for both request and response bodies.
- **Authentication:** via the NextAuth session cookie, established by `POST /api/auth/callback/credentials`. Authenticated routes call `await auth()` and return `401` if no valid session exists.
- **Error shape:** `{ "error": "<message>" }`, sometimes with extra fields merged in (e.g. `accountCreated: true`).
- **CORS:** no CORS headers are set anywhere in the codebase — the API is same-origin only by default browser behavior.

---

## Health

### `GET /api/health`

**Purpose:** Liveness/readiness probe for load balancers, uptime monitors, and container orchestrators.
**Authentication:** None (unauthenticated by design).
**Headers:** None required.
**Parameters:** None.
**Request Body:** None.
**Validation:** None.
**Business Logic:** Runs `SELECT 1` against the database via `prisma.$queryRaw` and measures elapsed time.

**Response — 200 OK**
```json
{
  "status": "ok",
  "timestamp": "2026-07-31T12:00:00.000Z",
  "checks": { "database": { "status": "ok", "latencyMs": 4 } }
}
```

**Response — 503 Service Unavailable**
```json
{
  "status": "error",
  "timestamp": "2026-07-31T12:00:00.000Z",
  "checks": { "database": { "status": "error" } }
}
```

**Errors:** Any database exception is caught, logged via `logger.error`, and results in the `503` above — no internal error detail reaches the response.
**Security Considerations:** Deliberately reveals nothing beyond up/down status and query latency; safe to expose publicly.

---

## Authentication

### `GET/POST /api/auth/*`

Handled entirely by NextAuth (`auth.ts` via `app/api/auth/[...nextauth]/route.ts`). Notable sub-routes:
- `POST /api/auth/callback/credentials` — sign in with email/password.
- `POST /api/auth/signout` — end the session.
- NextAuth's own CSRF-token and session endpoints.

**Business Logic (credentials sign-in):** rate-limited 5 attempts / 15 minutes per email (`login:<email>`); rejects with `EmailNotVerifiedError` if `emailVerified` is null; rejects with `TooManyLoginAttemptsError` when rate-limited; clears the login rate-limit bucket on success.
**Security Considerations:** Password comparison uses `bcrypt.compare` (timing-safe); generic failure (no distinction between "wrong password" and "no such user") except for the two specific, intentionally-surfaced cases (unverified email, rate limited).

---

### `POST /api/register`

**Purpose:** Create a new (unverified) account.
**Authentication:** None.
**Headers:** `Content-Type: application/json`.
**Request Body:**
```json
{ "name": "Jane Doe", "email": "jane@example.com", "password": "at least 8 characters" }
```
**Validation:** `name` 2–100 chars (trimmed); `email` regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤254 chars, lowercased; `password` 8–128 chars.
**Business Logic:** Rate-limited 5/hour per IP (`register:<ip>`) → `AuthService.prepareRegistration` (duplicate-email check, bcrypt hash cost 12, raw+hashed verification token, 1-hour expiry) → user + token created in one `prisma.$transaction` → `AuthService.completeRegistration` sends the verification email.

**Response — 201 Created**
```json
{
  "message": "Account created. Please check your email to verify your account.",
  "accountCreated": true,
  "user": { "id": 1, "name": "Jane Doe", "email": "jane@example.com", "createdAt": "2026-07-31T12:00:00.000Z" }
}
```

**Errors:**
| Status | Condition |
|---|---|
| 400 | Invalid name/email/password |
| 409 | Email already registered (`ConflictError`) |
| 429 | Rate limit exceeded (`Retry-After` header present) |
| 500 | Email service misconfigured, or the verification email failed to send (account is still created; response includes `accountCreated: true` so the client can direct the user to resend) |

**Security Considerations:** Duplicate-email response does confirm account existence (unlike forgot-password/resend-verification) — this is an accepted, narrower disclosure specific to registration, where the alternative (a silent success) would be actively confusing UX for a legitimate user re-registering by mistake.

---

### `POST /api/verify-email`

**Purpose:** Activate an account using the token from the registration/resend email.
**Authentication:** None.
**Request Body:** `{ "token": "<64-hex-char token>" }`
**Validation:** Token required, must match `/^[a-f0-9]{64}$/i` (the exact shape of `crypto.randomBytes(32).toString("hex")`).
**Business Logic:** Hashes the token, looks it up, checks expiry (deletes and rejects if expired), confirms the user exists and isn't already verified, then marks verified + deletes the token in one transaction.

**Response — 200 OK:** `{ "message": "Your email has been verified successfully." }`

**Errors:** `400` for missing/malformed token; `400` (via `ValidationError` → its mapped status) for invalid, expired, already-used, or already-verified tokens — all return the same generic message so a client can't distinguish "expired" from "already used" from "never existed."
**Security Considerations:** The strict 64-hex-char regex rejects obviously malformed input before it ever reaches a database lookup.

---

### `POST /api/resend-verification`

**Purpose:** Issue a new verification email, replacing any previous one.
**Authentication:** None.
**Request Body:** `{ "email": "jane@example.com" }`
**Validation:** Same email regex as registration.
**Business Logic:** Rate-limited 3/15min per IP+email → `AuthService.prepareVerificationResend` returns `{ shouldSend: false }` silently for a non-existent or already-verified account → if sending, old token deleted and new one created in one transaction, then email sent.

**Response — 200 OK (always, regardless of outcome):**
```json
{ "message": "If an unverified account exists for this email, a verification email has been sent." }
```

**Security Considerations:** Identical response whether or not the account exists or is already verified — deliberate anti-enumeration design, confirmed by the route's own comment.

---

### `POST /api/forgot-password`

**Purpose:** Request a password-reset email.
**Authentication:** None.
**Request Body:** `{ "email": "jane@example.com" }`
**Validation:** Same email regex.
**Business Logic:** Rate-limited 3/15min per IP+email → `AuthService.forgotPassword` no-ops silently if no account matches → otherwise deletes any prior reset tokens, creates a new one (1-hour expiry), emails the **raw** token in the reset link.

**Response — 200 OK (always):** `{ "message": "If an account exists for this email, a password reset link has been sent." }`

**Security Considerations:** Same anti-enumeration pattern as resend-verification.

---

### `POST /api/reset-password`

**Purpose:** Set a new password using a reset-email token.
**Authentication:** None.
**Request Body:** `{ "token": "<64-hex-char token>", "password": "new password" }`
**Validation:** Token format identical to verify-email; password 8–128 chars.
**Business Logic:** Rate-limited 5/15min per IP+token-hash → `AuthService.resetPassword` validates token existence/expiry, rejects if the new password equals the current one, hashes the new password → route updates the password and deletes all of that email's reset tokens in one `prisma.$transaction`.

**Response — 200 OK:** `{ "message": "Your password has been reset successfully." }`

**Errors:** `400` invalid token format or new-password validation failure; `400`-class `ValidationError` for invalid/expired/reused token, or a new password identical to the current one.
**Security Considerations:** The rate-limit key includes the token's hash (not the raw token), so the raw token is never persisted anywhere, including transient rate-limit bucket keys.

---

### `PATCH /api/change-password`

**Purpose:** Change the password of the currently authenticated account.
**Authentication:** Required.
**Request Body:** `{ "currentPassword": "...", "newPassword": "8-128 chars" }`
**Validation:** Both fields required; `newPassword` length-checked.
**Business Logic:** Rate-limited 5/15min per user ID → `AuthService.changePassword` verifies `currentPassword` via bcrypt, rejects if `newPassword` matches the current hash, hashes and persists the new password, and deletes any outstanding password-reset tokens for that email (so a stale reset link can't undo the change).

**Response — 200 OK:** `{ "message": "Password changed successfully." }`

**Errors:** `401` no/invalid session; `400` missing/invalid input or incorrect current password; `429` rate limited.
**Security Considerations:** Requiring the current password defends specifically against a hijacked session (stolen cookie) being used to lock the real owner out by changing their password — see [04-System-Design.md § Settings](./04-System-Design.md#4-settings--profile-module).

---

### `PATCH /api/profile`

**Purpose:** Update the authenticated user's display name.
**Authentication:** Required.
**Request Body:** `{ "name": "2-100 chars" }`
**Validation:** Trimmed, 2–100 chars.
**Business Logic:** `AuthService.updateProfile` → `UserRepository.updateProfile`.

**Response — 200 OK:**
```json
{ "message": "Profile updated successfully.", "user": { "id": 1, "name": "Jane Doe", "email": "jane@example.com" } }
```

**Security Considerations:** No re-authentication required (unlike password/deletion) — a name change is judged low-risk enough not to need the current-password confirmation pattern used elsewhere.

---

### `DELETE /api/delete-account`

**Purpose:** Permanently delete the authenticated user's account and all owned data.
**Authentication:** Required.
**Request Body:** `{ "password": "..." }`
**Validation:** Password required, ≤128 chars.
**Business Logic:** Rate-limited 5/15min per user ID → `AuthService.deleteAccount` verifies the password → route deletes verification tokens, reset tokens, and the user row inside one `prisma.$transaction`; `Task` rows cascade-delete at the database level via the `onDelete: Cascade` relation.

**Response — 200 OK:** `{ "message": "Your account has been deleted successfully." }`

**Errors:** `401` no session; `400` missing/incorrect password; `429` rate limited.
**Security Considerations:** Same re-authentication pattern as change-password, for the same reason — this is the single most destructive endpoint in the API.

---

## Tasks

All task routes are authenticated and ownership-scoped — see [03-System-Architecture.md § 5](./03-System-Architecture.md#5-request-lifecycle) for the exact mechanism.

### `GET /api/tasks`

**Purpose:** List all tasks owned by the current user.
**Authentication:** Required.
**Parameters:** None.
**Business Logic:** `TaskService.getUserTasks` → `TaskRepository.findByUserId`, ordered `createdAt: "desc"`.

**Response — 200 OK:**
```json
[
  { "id": 1, "title": "Buy groceries", "description": null, "category": "Personal", "priority": "Medium", "completed": false, "dueDate": "2026-08-01", "createdAt": "...", "updatedAt": "..." }
]
```

**Errors:** `401` no session; `500` on unexpected failure (logged server-side, generic message returned).

---

### `POST /api/tasks`

**Purpose:** Create a task for the current user.
**Authentication:** Required.
**Request Body:**
```json
{
  "title": "required, ≤200 chars",
  "description": "optional, nullable, ≤2000 chars",
  "category": "optional: Work | Personal | Study | Other (default Other)",
  "priority": "optional: Low | Medium | High (default Medium)",
  "dueDate": "optional, YYYY-MM-DD or null"
}
```
**Validation:** `validateTitleForCreate`, `validateDescriptionForCreate`, `validateCategory`, `validatePriority`, `parseDueDate` — all from `lib/task/task-validator.ts`. An explicitly-supplied invalid `category`/`priority` is rejected, not silently coerced to the default.
**Business Logic:** `TaskService.createTask` → `TaskRepository.create`, with `user: { connect: { id: userId } }` — `userId` always comes from the session, never the request body.

**Response — 201 Created:** the created task, serialized (`dueDate` as `YYYY-MM-DD` or `null`).

**Example Request**
```http
POST /api/tasks
Content-Type: application/json
Cookie: authjs.session-token=...

{ "title": "Buy groceries", "dueDate": "2026-08-01" }
```

**Example Response**
```json
{ "id": 1, "title": "Buy groceries", "description": null, "category": "Other", "priority": "Medium", "completed": false, "dueDate": "2026-08-01", "createdAt": "2026-07-31T12:00:00.000Z", "updatedAt": "2026-07-31T12:00:00.000Z", "userId": 1 }
```

**Errors:** `401` no session; `400` for any field validation failure (specific message per field).
**Security Considerations:** `userId` is never accepted from the client, closing the obvious "create a task for someone else" vector.

---

### `PATCH /api/tasks/:id`

**Purpose:** Update one or more fields of a task owned by the current user.
**Authentication:** Required.
**Parameters:** `id` (path) — numeric task ID.
**Request Body:** Any subset of `{ title, description, category, priority, completed, dueDate }`.
**Validation:** Same per-field validators as create, applied only to fields present in the body; `completed` must be strictly boolean; body must contain at least one recognized field or the route returns `400`.
**Business Logic:** `TaskService.updateTask` → `TaskRepository.updateForUser` — the ownership check and the update happen in one atomic `updateMany({ where: { id, userId } })` call, not a separate pre-check (see [04-System-Design.md § 2](./04-System-Design.md#2-task-management-module)).

**Response — 200 OK:** the updated task, serialized.
**Errors:** `401` no session; `400` invalid field value or empty body; `404` task doesn't exist or isn't owned by this user (indistinguishable from each other).
**Security Considerations:** The `404`-for-both-cases behavior prevents an attacker from using this endpoint to probe which task IDs exist.

---

### `DELETE /api/tasks/:id`

**Purpose:** Delete a task owned by the current user.
**Authentication:** Required.
**Parameters:** `id` (path).
**Business Logic:** `TaskService.deleteTask` → `TaskRepository.deleteForUser` (ownership-scoped lookup, then delete).

**Response — 200 OK:** `{ "message": "Task deleted successfully" }`
**Errors:** `401` no session; `400` invalid ID format; `404` not found/not owned.

---

## AI Assistant

### `POST /api/ai/intent`

**Purpose:** Parse a natural-language transcript into a task-management intent and execute it.
**Authentication:** Required.
**Request Body:** `{ "transcript": "mark the grocery task complete" }`
**Validation:** `transcript` must be a non-empty string after trimming, ≤2,000 characters.
**Business Logic:** See [07-AI-Module.md](./07-AI-Module.md) for the full pipeline (parse → validate → resolve context → execute → build message → remember context). Rate-limited 20/minute per authenticated user (`ai-intent:<userId>`).

**Response — 200 OK:**
```json
{
  "success": true,
  "intent": "complete_task",
  "message": "Marked \"Buy groceries\" as completed.",
  "result": { "id": 1, "title": "Buy groceries", "...": "serialized Task or Task[]" }
}
```

**Response — Error (4xx/5xx):**
```json
{ "success": false, "error": "..." }
```

**Errors:**
| Status | Condition |
|---|---|
| 401 | No/invalid session |
| 400 | Empty/oversized transcript, or malformed request body |
| 429 | AI rate limit exceeded |
| 500 | AI misconfigured (missing `GROQ_API_KEY`), malformed/unvalidatable AI response, or an unexpected failure |
| 504-equivalent (`AppError`, surfaced as its own status) | Upstream AI request timeout (`AI_REQUEST_TIMEOUT_MS`) |

**Security Considerations:**
- The transcript is user-controlled free text sent to a third-party LLM (Groq) — no PII beyond what the user chooses to type is transmitted, and the transcript is not persisted beyond the in-memory conversational context (30-minute TTL).
- The LLM's JSON response is never trusted directly: it passes through `parseAIResponse` (JSON parsing with fence-stripping) and `validateAIResponse` (Zod schema) before any task mutation occurs, so a malformed or adversarially-crafted model response cannot execute an unintended operation shape.
- `delete_task` never deletes directly from this endpoint — it only resolves the target task; deletion requires a subsequent, separate `DELETE /api/tasks/:id` call after client-side user confirmation.

---

## Task Object Shape (client-facing)

```ts
{
  id: number;
  title: string;
  description: string | null;
  category: "Work" | "Personal" | "Study" | "Other";
  priority: "Low" | "Medium" | "High";
  completed: boolean;
  dueDate: string | null;   // "YYYY-MM-DD"
  createdAt: string;         // ISO 8601
  updatedAt: string;         // ISO 8601
  userId: number;
}
```

---
*Related documents: [02-Software-Requirements-Specification.md](./02-Software-Requirements-Specification.md), [07-AI-Module.md](./07-AI-Module.md), [11-Security.md](./11-Security.md). A condensed version of this reference also exists at `../docs/API.md` from an earlier documentation pass; this document is the canonical, more detailed version.*
