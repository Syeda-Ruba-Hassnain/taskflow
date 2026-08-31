# 12 — Project Management

*Everything in this document is reconstructed from repository evidence — `git log`, commit dates, and in-code comments referencing specific development phases. No external project-management artifact (issue tracker export, sprint board, meeting notes) exists in the repository; where this document infers process from evidence rather than quoting a source directly, that is stated explicitly.*

## 1. Reconstructed Timeline

From `git log --pretty=format:'%h|%ad|%s' --date=short`:

| Date | Commit | Milestone |
|---|---|---|
| 2026-07-27 | `a162d77` | Initial commit from Create Next App (project scaffolding) |
| 2026-07-29 | `34c8372` | Initial TaskFlow project (core features first implemented) |
| 2026-07-30 | `65165d7` | Complete architecture refactor through Phase 3.2D |
| 2026-07-30 | `811a2f8` | refactor(auth): complete AuthService migration (Phase 3.2D) |
| 2026-07-30 | `20a44a1` | refactor(ui): production cleanup and React 19 compatibility fixes |
| 2026-07-31 | `401cc1f` | feat: complete production readiness improvements |

Five working days from framework scaffold to a production-readiness-labeled commit. The compression of "architecture refactor," "auth migration," "UI cleanup," and "production readiness" into a 2-day window (July 30–31) suggests these were treated as sequential, focused passes over a mostly-complete feature set — consistent with the in-code phase comments discussed below, which name more granular phases (3.2D, 6, 7) than the six commits alone show, implying some phases were squashed or not all intermediate work was committed separately.

## 2. Evidence of a Phased Process

In-code comments name specific, numbered phases and explain what changed and why — these function as a self-documenting change log distributed through the source rather than a separate document:

| Phase (as named in code) | File | What Changed |
|---|---|---|
| Phase 2.2 | `lib/task/task-validator.ts` | Identified (and deliberately left unresolved) a divergence between REST and AI due-date parsing strictness |
| Phase 3.2D | Commit messages (`65165d7`, `811a2f8`) | Architecture refactor; `AuthService` migration completed |
| Phase 6 (security audit) | `lib/task/task-validator.ts` | Added a missing max-length check on `PATCH /api/tasks/:id`'s title/description (previously unbounded, unlike `POST`) |
| Phase 7 (performance audit) | `app/api/tasks/[id]/route.ts` | Removed a redundant ownership pre-check before task updates, relying on `updateMany`'s atomic result instead |
| Phase 7 (performance audit) | `app/dashboard/layout.tsx` | Scoped `SessionProvider` to only the routes that need it, avoiding an unnecessary client-side session fetch |

This is strong, direct evidence of an **audit-driven iterative process**: rather than one continuous build, the project appears to have gone through discrete, purpose-specific review passes (architecture, security, performance) after an initial feature-complete state, each leaving a trail explaining its own reasoning.

## 3. Planning

*Assumption:* no requirements document, backlog, or planning artifact predating the code exists in the repository. What can be said with evidence: the feature set delivered (full auth lifecycle, task CRUD, and an AI assistant sharing the task backend) is coherent and mutually consistent enough that it reads as a single planned scope rather than an accretion of unrelated features bolted on over time — the AI pipeline's deliberate reuse of `TaskService` (see [03-System-Architecture.md § 3](./03-System-Architecture.md#3-why-this-architecture-was-chosen)) in particular is not the kind of integration a team backs into accidentally; it implies the AI feature was planned *with* the existing task system in mind, not designed in isolation and reconciled afterward.

## 4. Requirement Gathering

No formal requirements-gathering artifact exists. The requirements documented in [02-Software-Requirements-Specification.md](./02-Software-Requirements-Specification.md) were derived from the implementation itself (reverse-engineered), not sourced from a pre-existing specification.

## 5. Architecture Design

Evidenced by the "Complete architecture refactor through Phase 3.2D" commit — the phrasing ("through Phase 3.2D") implies a numbered sequence of architectural sub-phases (at least 3.1 through 3.2D) that isn't fully reconstructable from the single squashed commit alone, but whose *destination* is directly inspectable: the layered route → service → repository structure documented throughout [03-System-Architecture.md](./03-System-Architecture.md) and [04-System-Design.md](./04-System-Design.md).

## 6. Implementation Phases

Reconstructed sequence, based on the evidence above:
1. **Scaffold** (`create-next-app`) → **initial feature build** (`34c8372`): core task manager and auth, likely without the fully layered architecture in its final form.
2. **Architecture refactor** (Phase 3.x, culminating in 3.2D): introduction/completion of the service and repository layers, and `AuthService` specifically.
3. **UI cleanup + React 19 compatibility**: adapting to a newer React major version and general UI polish.
4. **Security audit** (Phase 6): closing specific, identified gaps (e.g., the missing PATCH length validation).
5. **Performance audit** (Phase 7): removing redundant work (extra DB round-trips, unnecessary client-side session fetches).
6. **"Production readiness" pass** (most recent commit): the phase this documentation set and the two prior audit reports in this repository's history (`Phase-10-Production-Readiness-Audit.md` reference in earlier conversation context, `Phase-10-Production-Readiness-Audit-v2.md`) were themselves part of.

## 7. Testing Phase

Not a separate, single phase — test files are colocated with the code they test throughout (`*.test.ts` siblings), and the AI subsystem in particular has unusually granular per-module test coverage (nine dedicated AI test files — see [09-Testing.md § 4.5](./09-Testing.md#45-ai-specific-testing)), suggesting tests were written alongside each phase's changes rather than bolted on at the end in one pass.

## 8. Deployment Phase

**Not yet executed**, or at least not evidenced in the repository: there is no deployment configuration (no Dockerfile, no IaC, no `vercel.json`), no CD workflow (only CI exists — `.github/workflows/ci.yml`), and the repo still lacks an automated release pipeline. Committed database migration history now exists, so the prior blocker to first production deployment has been resolved in the repository.

## 9. Maintenance

Evidenced by the sheer existence of the "security audit" and "performance audit" phases — these are maintenance activities against an already-working system, not first-build work. The pattern (build, then come back and specifically audit for security issues, then come back and specifically audit for performance issues) is a deliberate maintenance discipline, not accidental.

## 10. Risk Management

No formal risk register exists. Risks that *were* identified and mitigated, evidenced directly in code comments:
- **Unbounded PATCH field length** (Phase 6) — identified and fixed.
- **Redundant DB round-trip on the hottest write path** (Phase 7) — identified and fixed.
- **Account enumeration via forgot-password/resend-verification** — mitigated by design (identical response regardless of account state), though not tied to a named phase in a comment.
- **Stolen-session account takeover via change-password/delete-account** — mitigated by requiring current-password re-confirmation, with the reasoning spelled out directly in both routes' rate-limit comments.

Risks that were **identified by this documentation effort** (see [11-Security.md § 12](./11-Security.md#12-known-limitations) and [14-Future-Enhancements.md](./14-Future-Enhancements.md)): committed migration history now exists, unbounded `RateLimit` growth remains, no CSRF token mechanism remains, and AI conversational context not scaling horizontally remains.

## 11. Challenges

Inferred from what the codebase's own comments describe as having been wrong before being fixed:
- Reconciling REST and AI validation behavior that had organically diverged (the `TODO(Phase 2.2)` comments) — a real challenge of building two entry points into the same data model at different times and needing to decide, per divergence found, whether to unify or document-and-preserve.
- Balancing a security-hardening pass (CSP headers) against a rendering-strategy change (adding middleware for nonces) — resolved by accepting `'unsafe-inline'` rather than converting several static pages to dynamic rendering, a tradeoff explicitly reasoned through in `next.config.ts`'s comments rather than silently defaulted into.
- Adapting to React 19 (a specific, named commit: "React 19 compatibility fixes") — implies real breaking-change friction was encountered and resolved, though the specific fixes aren't individually itemized in the squashed commit.

## 12. Milestones

| Milestone | Evidence |
|---|---|
| Working core product | `34c8372` |
| Layered architecture complete | `65165d7`, `811a2f8` |
| React 19 / UI production-ready | `20a44a1` |
| First "production readiness" pass | `401cc1f` |
| This documentation set | Current session |

## 13. Agile Methodology Assessment

**No evidence of a formal Scrum/Kanban process** (no sprint cadence artifacts, no ticket-ID references in commits or comments, no velocity/burndown data). What the evidence *does* support, stated precisely rather than rounded up to a familiar framework name: a **solo or small-team, audit-driven iterative process** — build a working slice, then run a named, focused review pass (architecture, then auth, then security, then performance, then production-readiness) and fix what that specific pass finds, documenting the reasoning inline as you go. This shares Agile's iterative-refinement spirit without the ceremony (no evidenced standups, retros, or sprint planning) — closer to a disciplined personal/small-team engineering practice than to a named methodology.

---
*Related documents: [01-Project-Overview.md § SDLC](./01-Project-Overview.md#software-development-life-cycle), [13-Lessons-Learned.md](./13-Lessons-Learned.md)*
