# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project does not currently follow semantic versioning with tagged releases; entries are grouped by development milestone instead.

## [Unreleased]

- Added production-quality documentation: README, `.env.example`, `docs/API.md`, `docs/ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md`, and this changelog.
- Added `.gitattributes` to normalize line endings to LF across platforms.
- Documented and committed baseline Prisma migration history under `prisma/migrations/20260731112025_init/migration.sql`.
- Established `Implementation-Baseline.md` as the authoritative technical reference for the repository.
- Completed documentation verification and synchronized the repository docs with the current implementation.

## 2026-07-31 — Production readiness improvements

- Completed a production-readiness pass across the app: health check endpoint, centralized logger, security headers/CSP, startup validation for AI configuration, and CI pipeline (test, lint, type-check, build).

## 2026-07-30 — UI cleanup & React 19 compatibility

- Production cleanup of the UI layer and compatibility fixes for React 19.
- Completed the `AuthService` migration (Phase 3.2D), consolidating authentication business logic behind a single service.
- Completed the broader architecture refactor through Phase 3.2D: layered route → service → repository structure, typed `AppError` hierarchy, and the AI assistant pipeline (voice + text intent parsing, execution, and conversational context).

## 2026-07-29 — Initial TaskFlow project

- Initial implementation of TaskFlow: task CRUD, authentication (registration, email verification, login, password reset), and the PostgreSQL/Prisma data layer.

## 2026-07-27 — Initial commit

- Project bootstrapped with `create-next-app`.
