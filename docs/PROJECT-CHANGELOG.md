# Project Changelog

## 0.1.0 — Bootstrap
- Created repository structure and all 41 module skeleton folders (no business logic).
- TypeScript (strict), Express 4, Sequelize 6 + MySQL, dotenv, CORS, JWT/bcryptjs/express-validator dependencies.
- Environment loading with validation; `.env.example`.
- Request/correlation ID and locale resolution (ar default, en fallback).
- Centralized error handler with stable codes, localized messages, request ID.
- `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (database readiness).
- sequelize-cli configuration and empty migrations/seeders folders.
- Vitest + supertest testing foundation.
- BullMQ/Redis intentionally not installed yet; added with Module 06 (Outbox).

## 0.2.0 — Module 00: Shared Kernel
- `AppError` is now transport-agnostic (`code` + `kind`); HTTP status mapping moved to `src/app/middleware/http-status.ts`.
- Added `Entity`, `AggregateRoot` (records domain events), `ValueObject`, `Uuid` helpers, `DomainEvent` contract.
- Added ports: `Clock` (`SystemClock`, `FixedClock`) and `UnitOfWork`/`TransactionContext` (implemented by Module 02).
- Added business time helpers (`Africa/Cairo`, `businessDateOf`, `isIsoDate`).
- Added pagination helpers (default 20, max 100; invalid input falls back to defaults).
- Public surface: `src/modules/00-shared-kernel/public/index.ts`. Other modules import only from there.
- 15 unit tests added under `tests/unit/shared-kernel`.

## 0.3.0 — Module 01: Configuration & Environment
- `loadConfig` (pure): typed, validated, deeply frozen `AppConfig`; reports all problems at once without leaking values.
- Production rules: DB name/user/password and both JWT secrets required; secrets ≥ 32 chars and different.
- Validation for ports, timezone (IANA), locale, CORS origins (explicit, no wildcard), file size.
- `redactConfig` for safe logging; `ConfigurationError`.
- `src/config/env.ts` is now the single composition root that reads `.env`; existing imports unchanged.
- `.env.example` documented; added `docs/CONFIGURATION.md`.

## 0.4.0 — Module 02: Database & Transaction Infrastructure
- `SequelizeUnitOfWork` implements the Shared Kernel `UnitOfWork` port (commit/rollback, nested calls join the active transaction).
- Opaque transaction context; only infrastructure unwraps it via `sequelizeTransactionOf`.
- Connection options for MariaDB 10.4: dialect `mysql`, UTC, utf8mb4, snake_case, bounded pool.
- `src/config/database.ts` now delegates to the module and exposes `getUnitOfWork()`.
- `database/helpers.cjs` migration conventions (utf8mb4, CHAR(36) UUID, DATETIME(3) timestamps).
- `npm run test:db`: opt-in real-database checks.
- Documented in `docs/DATABASE.md`.

## 0.5.0 — Module 03: Error & Localization
- Message catalog: each error code requires Arabic and English messages; duplicates/invalid codes rejected atomically.
- `{param}` interpolation; `AppError` gained optional `params` (backward compatible).
- Locale resolver moved here: user preference > Accept-Language (q-values, regions, wildcard) > default; never returns an unsupported locale.
- `toErrorResponse`/`normalizeError`: standard error shape, kind→HTTP status mapping moved here, details hidden for internal errors.
- Responses now send `Content-Language` and `Vary: Accept-Language`.
- Express error handler is a thin wrapper over the module. Removed `src/app/middleware/error-messages.ts` and `http-status.ts`.
- Documented in `docs/LOCALIZATION.md`.

## 0.6.0 — Module 04: Validation & API Standards
- Standard success envelope and helpers (`sendSuccess`, `sendCreated`, `sendPaginated`, `sendNoContent`).
- `parseListQuery`: pagination (default 20, max 100), whitelisted sorting and filtering, optional search, unknown parameters rejected, all problems reported at once.
- `ValidationError` with field-level errors (`FieldError` added to the Shared Kernel); Module 03 now localizes `details.fields[].message`.
- `validate(...chains)`: express-validator integration using stable error codes as messages.
- Arabic/English messages for all validation codes; registered once at startup.
- Documented in `docs/API-STANDARDS.md`.

## 0.7.0 — Module 05: Logging & Request Context
- Dependency-free structured JSON logger with levels, child loggers, and automatic request context fields.
- Central redaction: sensitive keys (password, OTP, tokens, secrets, authorization, cookies…), JWTs, Bearer tokens, and URL credentials; circular/deep/large values handled safely.
- Access log middleware (method, path without query, status, duration; never headers or bodies).
- Request ID policy moved into the module; request context now supports `actorUserId`.
- New `LOG_LEVEL` setting in Module 01 (default `info`, `silent` in test).
- Error handler logs unhandled errors through the logger (full detail in logs only).
- Documented in `docs/LOGGING.md`.

## 0.8.0 — Module 06: Domain Events & Transactional Outbox
- `createDomainEvent` (UUID id, clock time, request-context metadata) and validation.
- `OutboxService.publish/publishFrom`: events written inside the caller's transaction (atomic with the business change).
- `OutboxProcessor`: at-least-once delivery, exponential backoff (30 s … 1 h), dead after 5 attempts, per-handler failure isolation, handlers run in the original request context.
- Safe concurrent claiming with lock leases (works on MariaDB 10.4, no SKIP LOCKED).
- `OutboxScheduler`: non-overlapping polling, graceful stop, log-flood protection. No Redis/BullMQ required yet.
- `SequelizeOutboxStore`, `InMemoryOutboxStore`, migration `create-outbox-messages`.
- `startOutbox()/stopOutbox()` wired into `server.ts`; handlers register on `getEventHandlerRegistry()`.
- Documented in `docs/EVENTS-OUTBOX.md`.
