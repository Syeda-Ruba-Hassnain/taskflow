# 01 — Project Overview

## Executive Summary

TaskFlow is a full-stack task management application built on Next.js 16 (App Router), combining conventional CRUD task management with a natural-language AI assistant. Users manage tasks the normal way — through forms and buttons — or by speaking/typing plain-English commands ("remind me to call the bank tomorrow", "mark the grocery task complete"), which are parsed by an LLM into structured operations against the same task-management backend used by the REST UI.

The system is a single deployable Next.js application: server-rendered pages, API route handlers, and the AI pipeline all live in one codebase and one deployment unit, backed by a PostgreSQL database via Prisma ORM.

This document set was produced by directly inspecting the repository as it exists today — source code, configuration, schema, and test suite — not from a specification written in advance. Where the implementation doesn't answer a question a standard SRS/architecture document would normally ask, that gap is called out explicitly as an assumption rather than filled in with invented detail.

## Introduction

Task management is a saturated product category, but most tools in it share the same interaction model: the user must translate what's in their head into the tool's own vocabulary of forms, dropdowns, and buttons before the tool can act on it. TaskFlow's premise is that for a meaningful slice of everyday task management — "add X", "mark Y done", "what's due today" — that translation step is unnecessary overhead. A user should be able to say or type the request in their own words and have the system do the translation.

TaskFlow is implemented as a conventional task manager (the reliable, predictable path) with an AI assistant layered on top as an alternative input method into the *same* underlying operations — not a separate, parallel feature. This design choice is visible directly in the code: `lib/ai/executor.ts` calls the same `taskService` that the REST API routes call, and `lib/task/task-validator.ts` is shared by both, with an explicit comment in the source stating it is "the single source of truth for task field validation, used by both the REST API routes... and the AI pipeline."

## Problem Statement

### Existing Problems

1. **Interaction overhead.** Traditional task managers require the user to open a form, select a category from a dropdown, pick a priority, and type into separate fields for a single quick capture like "call the dentist Friday" — several deliberate UI interactions for one simple thought.
2. **Context switching cost.** Capturing a task typically requires shifting from whatever the user is doing (often hands-busy or attention-elsewhere) to a structured input flow.
3. **Accessibility gap.** Users who prefer or need voice interaction (situational — driving, cooking, mobility constraints) are underserved by form-first task apps.
4. **No conversational continuity.** Most task apps that do offer any chat/voice layer treat each command in isolation, unable to resolve "mark **that** one complete" without the user re-specifying which task they mean.

### Proposed Solution

TaskFlow addresses this by:

- Providing a standard, fully-featured task manager (create/edit/complete/delete, categorize, prioritize, set due dates) as the reliable baseline.
- Adding a voice and text AI assistant (`components/VoiceControl.tsx`, `components/AITextControl.tsx`) that accepts natural-language commands and executes them through a validated, rate-limited pipeline (`app/api/ai/intent/route.ts`).
- Giving that assistant short-term conversational memory (`lib/ai/context/`) so follow-up commands referring to "it" or "that" resolve against the most recent task the conversation touched.
- Keeping the AI path and the manual path mechanically consistent by routing both through the same service and validation layer, so a task created by voice behaves identically to one created by hand.

## Project Objectives

1. Deliver a working, secure, multi-user task management application with full account lifecycle support (registration, email verification, authentication, password recovery, account deletion).
2. Implement a natural-language AI assistant capable of performing the core task-management operations (create, update, complete, delete, search, prioritize, categorize, summarize) via voice or text.
3. Maintain a codebase that is testable, consistently structured, and safe to extend — evidenced by the project's own layered architecture and 349-test suite (see [09-Testing.md](./09-Testing.md)).
4. Apply production-appropriate security controls (password hashing, rate limiting, security headers, ownership-scoped data access) proportionate to a real, internet-facing multi-tenant application.
5. Produce an application that is operable, not just functional: a health check endpoint, centralized logging, and CI verification exist and are exercised in this documentation set (see [10-Deployment.md](./10-Deployment.md), [11-Security.md](./11-Security.md)).

## Scope

### In Scope (implemented and verified in the repository)

- Email/password authentication with mandatory email verification.
- Task CRUD with title, description, category, priority, completion state, and due date.
- Client-side filtering, sorting, and search over the current user's tasks.
- An AI assistant (voice and text) covering ten intents: create, update, delete, complete, uncomplete, list, search, change priority, change category, and "summarize today."
- Multi-turn AI conversational context with a 30-minute expiry.
- Account self-service: profile update, password change, forgotten-password recovery, account deletion.
- Database-backed rate limiting across every sensitive endpoint.
- A health check endpoint, centralized logging, and CI pipeline (test, lint, type-check, build).

### Out of Scope (not present in the codebase — explicitly not claimed as implemented)

- Team/multi-user collaboration on tasks (the schema has no sharing/permission model — each `Task` belongs to exactly one `User`).
- Push notifications, reminders, or scheduled digest emails.
- Mobile native applications (the app is a responsive web app only).
- Third-party calendar integration.
- Payment/subscription/billing functionality.
- A continuous-deployment pipeline (CI exists; automated deployment does not — see [10-Deployment.md](./10-Deployment.md)).

## Stakeholders

| Stakeholder | Interest |
|---|---|
| Project owner / developer | Ships a working, secure, well-documented product; uses it as a portfolio-quality demonstration of full-stack and AI-integration engineering. |
| End users | A task manager that's fast to capture into and doesn't demand strict adherence to a rigid UI. |
| Future maintainers/contributors | A codebase that's consistently structured enough to extend without first reverse-engineering undocumented conventions. |

*Assumption: this is presented as a single-developer or small-team project based on the repository's structure (no CODEOWNERS, no multi-contributor git history, no organizational branch-protection artifacts observed). Treat "stakeholders" accordingly rather than as a large-organization matrix.*

## Target Users

- Individuals managing personal task lists who want faster capture than a traditional form-based to-do app.
- Users who want or need hands-free/voice-driven task capture.
- Developers evaluating the codebase as a reference implementation of a layered Next.js application with an integrated LLM feature.

## Key Features

| Feature | Implementation Evidence |
|---|---|
| Account registration + email verification | `app/api/register/route.ts`, `lib/services/auth.service.ts` |
| Login (credentials, JWT session) | `auth.ts` (NextAuth v5, Credentials provider) |
| Forgot / reset password | `app/api/forgot-password/route.ts`, `app/api/reset-password/route.ts` |
| Change password / delete account | `app/api/change-password/route.ts`, `app/api/delete-account/route.ts` |
| Profile update | `app/api/profile/route.ts` |
| Task CRUD | `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts` |
| Dashboard with filtering/sorting/search | `app/dashboard/Dashboard.tsx` |
| Voice AI assistant | `components/VoiceControl.tsx` (Web Speech API) |
| Text AI assistant | `components/AITextControl.tsx` |
| AI intent pipeline | `app/api/ai/intent/route.ts`, `lib/ai/*` |
| Multi-turn AI conversation memory | `lib/ai/context/context.manager.ts`, `context.store.ts` |
| Rate limiting | `lib/rate-limit.ts` (PostgreSQL-backed) |
| Health check | `app/api/health/route.ts` |
| Centralized logging | `lib/logger.ts` |

## Technology Stack

| Layer | Technology | Version (from `package.json`) |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.12 |
| UI Library | React | 19.2.4 |
| Styling | Tailwind CSS | 4.x |
| Language | TypeScript | 5.x |
| Database | PostgreSQL (via Prisma) | Prisma 6.19.3 |
| Authentication | NextAuth (Credentials provider, JWT) | 5.0.0-beta.32 |
| AI Provider | Groq (OpenAI-compatible API) via `openai` SDK | 7.x |
| Transactional Email | Resend | 6.18.0 |
| Password Hashing | bcryptjs | 3.0.3 |
| Schema Validation | Zod | 4.4.3 |
| Testing | Vitest + `@vitest/coverage-v8` | 4.1.10 |
| Linting | ESLint (`eslint-config-next`) | 9.x |

*Note: NextAuth 5 is still in beta (`5.0.0-beta.32`) at the time of this audit — a real, non-hypothetical dependency-stability consideration, called out in [11-Security.md](./11-Security.md) and [14-Future-Enhancements.md](./14-Future-Enhancements.md).*

## Software Development Life Cycle

The codebase shows evidence of an **iterative, phase-based development process** rather than a single up-front build. This is not an inference from general best practice — it's directly visible in the code and commit history:

- In-code comments reference specific named phases: *"Phase 6 security audit"* (`lib/task/task-validator.ts`, on adding a missing length check), *"Phase 7 performance audit"* (`app/api/tasks/[id]/route.ts` and `lib/ai/context/`, on removing a redundant DB round-trip), *"Phase 7 performance audit"* (`app/dashboard/layout.tsx`, on scoping `SessionProvider`).
- Commit history (`git log`) shows named milestones: `Initial TaskFlow project` → `Complete architecture refactor through Phase 3.2D` → `refactor(auth): complete AuthService migration (Phase 3.2D)` → `refactor(ui): production cleanup and React 19 compatibility fixes` → `feat: complete production readiness improvements`.

This indicates a **build → audit → refine** cycle repeated across multiple concerns (architecture, auth, security, performance, production-readiness) rather than a waterfall single-pass build. See [12-Project-Management.md](./12-Project-Management.md) for a full reconstruction of this timeline from repository evidence.

## Development Methodology

*Assumption, clearly flagged:* there is no issue tracker, sprint board, or ticket-reference convention in the repository to confirm a formal methodology (e.g., Scrum with fixed sprint lengths). What the evidence *does* support is a **phased, audit-driven iterative approach**: each phase appears to have had a specific focus (architecture, auth, security, performance, production readiness, documentation), was completed, and left a trail of self-documenting comments explaining what changed and why — a practice closer to disciplined solo/small-team iterative development than either strict Waterfall or a ceremony-heavy Agile framework.

## Deliverables

- A working, tested Next.js application (verified via `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` — see [09-Testing.md](./09-Testing.md)).
- This documentation set (`docs/01` through `docs/14`, plus `docs/diagrams/`).
- Supporting root-level documentation: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.env.example`.
- A CI pipeline (`.github/workflows/ci.yml`) that runs the full verification suite on every push and pull request.

## Success Criteria

| Criterion | Status (evidence) |
|---|---|
| All core task operations work via UI and AI | Verified: `app/api/tasks/*`, `app/api/ai/intent/route.ts`, both routing through `taskService` |
| Full auth lifecycle implemented | Verified: 8 auth-related API routes, `AuthService` |
| Automated tests pass | Verified this session: 349/349 tests passing |
| Type safety enforced | Verified this session: `npx tsc --noEmit` — zero errors |
| Lint-clean | Verified this session: `npm run lint` — zero errors |
| Production build succeeds | Verified this session: `npm run build` — succeeded, 23/23 routes generated |
| Security headers applied | Verified: `next.config.ts` (CSP, HSTS, X-Frame-Options, Permissions-Policy) |
| Repeatable production database provisioning | **Met** — committed Prisma migration history exists in `prisma/migrations/20260731112025_init/migration.sql`, matching `prisma/schema.prisma`. See [05-Database-Design.md](./05-Database-Design.md) and [10-Deployment.md](./10-Deployment.md). |

---
*Related documents: [02-Software-Requirements-Specification.md](./02-Software-Requirements-Specification.md), [03-System-Architecture.md](./03-System-Architecture.md)*
