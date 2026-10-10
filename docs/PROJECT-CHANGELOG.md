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
- BullMQ/Redis intentionally not installed yet; not required by Module 06 (the outbox uses database polling) and to be added only if a later module needs it.

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

## 0.9.0 — Module 07: File Infrastructure
- Private file storage for Excel `.xlsx` (10 MB, row limit constant for Module 36); no public URLs.
- Content-based validation: ZIP/OOXML structure, macros, embedded objects, encryption, path tricks, zip-bomb limits; client content-type ignored.
- `FileService` (save/read/delete) with server-generated storage keys, sanitized display names, SHA-256 integrity verification.
- `LocalFileStorage` (path-safe, atomic writes), `SequelizeStoredFileRepository`, in-memory adapters; migration `create-stored-files`.
- Localized (ar/en) file error messages registered at startup; `getFileService()` in `src/config/files.ts`.
- Documented in `docs/FILES.md`.

## 0.10.0 — Module 08: Identity Core
- `User` aggregate: normalized E.164 phone (globally unique), bcrypt password hash, `ACTIVE`/`INACTIVE` lifecycle (reversible, history preserved), optimistic-lock version.
- Shared phone normalization: Egyptian local mobiles (010/011/012/015) become `+20…`; `+`/`00` international numbers are validated; Arabic-Indic digits and separators accepted; ambiguous input is rejected, never guessed.
- Password policy (4–12 characters) and initial-password helper (last 4 digits of the phone).
- `IdentityService` public contract (create, find, verify password, deactivate/activate, change password) with optional caller transaction; duplicate phone always conflicts (no silent merge).
- Events `UserCreated`, `UserDeactivated`, `UserActivated`, `UserPasswordChanged` through the outbox (payload `{ userId }` only).
- `SequelizeUserRepository`, `InMemoryUserRepository`, `BcryptPasswordHasher`, migration `create-users`; localized (ar/en) error messages registered at startup; `getIdentityService()` in `src/config/identity.ts`.
- No HTTP routes (authentication and authorization arrive with Modules 10 and 12).
- Documented in `docs/IDENTITY.md`.

## 0.11.0 — Module 09: Roles & Permissions
- Fixed V1 role catalog (exactly nine roles, Arabic/English names); Student is in the catalog but not assignable (no login).
- Role assignments with full history (`assignedAt/By`, `revokedAt/By`): one active assignment per user and role, re-assignment creates a new row, nothing is deleted, a user always keeps at least one active role (revocation is race-safe).
- `PermissionRegistry`: deny-by-default role -> permission grants, registered by each owning module; the V1 catalog starts empty (no permission is invented).
- `RoleService` public contract (assign, revoke, list active roles, history, hasRole, hasPermission, listPermissions) with optional caller transaction; no per-user permissions.
- Events `RoleAssigned`, `RoleRevoked` through the outbox.
- `SequelizeRoleAssignmentRepository`, `InMemoryRoleAssignmentRepository`, migrations `create-user-roles` (unique active-role index, CHECK constraints for the role list and assignment state) and `fix-user-roles-state-check` (makes the state CHECK null-safe so an inactive row without `revoked_at` is rejected); localized (ar/en) error messages; `getRoleService()` / `getPermissionRegistry()` in `src/config/roles.ts`.
- No HTTP routes (authorization of role changes arrives with Modules 10 and 12).
- Documented in `docs/ROLES.md`.

## 0.12.0 — Module 10: Sessions & JWT
- Authentication: `POST /api/v1/auth/login`, `/refresh`, `/logout`, `/logout-all`; `requireAuthentication` middleware sets `req.auth` (and the actor in the request log context).
- Access token: HS256 JWT, 15 minutes, claims `sub`/`sid` only (no roles). Refresh token: opaque 256-bit token, 30 days, stored only as an HMAC hash, rotated on every refresh.
- One active session per user: a new login revokes the previous session; sessions and tokens are never deleted (history kept). Enforced by the application and by a unique index.
- Reuse of a rotated refresh token is rejected and revokes the session (`REFRESH_TOKEN_REUSE`); the revocation is committed even though the request fails.
- Every authenticated request checks the session and the user, so logout, replacement and deactivation take effect immediately. `UserDeactivated` (Module 08) revokes the user's sessions.
- Login does not reveal whether the phone exists (same error and similar timing); token responses are `no-store`.
- Events `AuthSessionStarted` / `AuthSessionRevoked` through the outbox; `SessionService.revokeAllForUser` for Module 11.
- Migration `create-auth-sessions` (tables `auth_sessions`, `refresh_tokens`, null-safe CHECK constraints); localized (ar/en) errors; `src/config/sessions.ts`; handler registered in `server.ts` before the outbox starts.
- Token lifetimes are constants, not environment settings. Documented in `docs/SESSIONS.md`.

## 0.12.1 — Fix: timestamps shifted on non-UTC servers (Module 02)
- Found by the Module 10 real-database test: a refresh token's 30-day expiry read back 1 hour short on a machine in Cairo time (daylight-saving change between issue and expiry).
- Cause: Sequelize formats `Date` replacements in the Node process' local time zone (and drops milliseconds) but reads DATETIME values back as UTC, so every stored timestamp of every module was shifted by the server's offset.
- Fix: `createSequelize` now formats every `Date` replacement in UTC with milliseconds (`utc-replacements.ts`); no repository changes needed.
- Tests: unit tests run in UTC, Cairo and New York time zones; new `tests/db/datetime.test.ts`. Documented in `docs/DATABASE.md`.
- Also fixed a row-order assumption in `tests/db/auth-sessions.test.ts` (sessions created in the same millisecond have no fixed order).

## 0.13.0 — Module 11: OTP & Password Recovery
- Endpoints `POST /api/v1/auth/password-recovery/request`, `/verify`, `/reset`: phone -> OTP -> single-use reset token -> new password (4–12 characters).
- OTP: 6 digits, 5 minutes, single use, 5 wrong attempts invalidate it, a resend supersedes the previous one. Reset token: 256-bit, single use, 10 minutes, bound to the verifying user. Everything stored only as keyed HMAC hashes using the dedicated `OTP_HMAC_SECRET`.
- Rate limits (approved): first OTP + 3 resends per phone per rolling hour; 5 per phone+IP per rolling 15 minutes. Concurrency-safe in MySQL through a per-phone exclusive row lock; answered with HTTP 429 `RATE_LIMITED` and `Retry-After`. Every request counts, so limits reveal nothing about accounts.
- No account enumeration: identical answers for active, unknown and disabled accounts; OTP delivery runs in the background after the commit; delivery failures are invisible and logged by error name only.
- A successful reset changes the password, closes the recovery and revokes all sessions (`PASSWORD_RESET`) in one transaction.
- `OtpSender` port with `DisabledOtpSender` (default), `InMemoryOtpSender` (tests) and `DevFileOtpSender` (development only); the real provider is chosen later.
- Module 00/03/app: new error kind `RATE_LIMITED` (HTTP 429) and `Retry-After` header in the error handler. Module 01: `OTP_HMAC_SECRET`, `OTP_SENDER` and `TRUSTED_PROXIES` (explicit proxies only; trust-everything values rejected); `createApp` applies them. The existing production-config test now also requires `OTP_HMAC_SECRET`.
- Event `PasswordResetCompleted` through the outbox; migration `create-password-recovery` (3 tables, null-safe CHECKs); localized (ar/en) errors; `src/config/password-recovery.ts`.
- Documented in `docs/PASSWORD-RECOVERY.md` and `docs/CONFIGURATION.md`. The first-Main-Admin setup script remains deferred.

## 0.14.0 — Module 12: Authorization Engine
- Generic engine only: roles -> permissions -> scope -> ownership, deny by default and fail closed. `AuthorizationService` (implements the `Authorizer` contract), `AuthorizationPolicyRegistry` (permission registration and lookup; grants stay in Module 09, plus an explicit `MANAGEMENT` / `REPORTING` / `UNSCOPED` scope and per-role ownership), `AuthorizationResolvers` (scope resolvers per scope kind and target type; ownership resolvers per resource type), and the `requirePermission` Express middleware (sets `req.authorization`).
- Rules: unknown permission, inactive/unknown user, no active role, no grant, missing or invalid scope/ownership input, missing resolver, resolver error or non-`true` answer all deny. Scope and ownership must hold under the same role that holds the permission. Management and reporting scope are separate. Denials are 403 `ACCESS_DENIED` (ar/en) with no reason; reasons are logged only. Identity/role service failures propagate and never become an allow.
- Main Admin global scope is configuration (`GLOBAL_SCOPE_ROLES` in `src/config/authorization.ts`), PROPOSED in the matrix. No permissions are defined and no HTTP endpoints exist.
- One-time CLI `npm run bootstrap:main-admin`: interactive hidden prompts, one transaction under a row lock, refuses when an active Main Admin exists, reuses Module 08 (phone/password rules) and Module 09 (`assignedBy = null`). Never prints or logs secrets.
- Database: migration `create-authorization-bootstrap-lock` (single-row lock table with a CHECK).
- Module 09 (additive): `RoleService.countActiveByRole` and the matching repository port method (Sequelize and in-memory).
- Events: none new (the bootstrap emits the existing `UserCreated` and `RoleAssigned`).
- Tests: 48 unit and 8 integration tests added; real-database test `tests/db/authorization-bootstrap.test.ts` added (not yet run).
- Docs: `docs/AUTHORIZATION.md` and the central `docs/AUTHORIZATION-MATRIX.md` added; Architecture, Database, Roles, Implementation Status and README updated.
- Known issues: `npm run db:migrate` and `npm run test:db` are pending on the user machine; no recovery CLI for a lost Main Admin (open decision D-4).
