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

## 0.14.1 — Module 12 marked COMPLETE
- The first-Main-Admin real-database tests passed on the project owner's MariaDB (5 of 5). Two unrelated DB test failures seen in that run were caused by a phone-prefix collision in the new DB test file (it shared `+2010997` with `auth-sessions.test.ts`); fixed by giving it its own prefix `+2010995`. Module 12 status set to COMPLETE on the owner's instruction.

## 0.15.0 — Module 13: Main Organization
- Organization aggregate with the approved fields only (`id`, `code` ORG-000001 format, one `name` field Arabic or English, `status` ACTIVE/INACTIVE) and its `organizations` table. Name normalization/validation per the approved rules; `utf8mb4`.
- Exactly one organization in V1, enforced by the database (`v1_single_guard` CHECK + UNIQUE index), with the future multi-organization path documented. Unique code and CHECKs on code format, status and non-blank name.
- Idempotent creation: `OrganizationService.ensureMainOrganization` (existing organization returned unchanged; a lost creation race is rolled back and answered with the winner). CLI step shared by the new `npm run bootstrap:organization` and by `npm run bootstrap:main-admin` (which now runs it first and creates no Main Admin if it fails).
- Event `OrganizationCreated` (payload: ids only) written through the existing outbox in the same transaction; never duplicated on re-runs.
- Public contract `OrganizationLookup` (`getMainOrganization`, `requireMainOrganization`, `findById`) and `OrganizationDto`; errors `INVALID_ORGANIZATION_NAME`, `ORGANIZATION_ALREADY_EXISTS`, `ORGANIZATION_NOT_FOUND` (ar/en).
- Database: migration `create-organizations`. No foreign keys from this table. No endpoints, no permissions (authorization matrix unchanged).
- Tests: 29 unit tests added; MariaDB tests `tests/db/organizations.test.ts` added (always-rolled-back transaction; not yet run).
- Added `.env.example` (placeholders only; referenced by the spec and docs but missing from the repository).
- Known issues: `npm run db:migrate` and `npm run test:db` pending on the user machine. The "Main Admin relationship" for schools is unresolved (needed only by Module 16).

## 0.15.1 — Module 13 fix after the first MariaDB run
- The first real-database run showed the original code CHECK accepted a lowercase code (MariaDB `REGEXP` ignores case on a `_ci` collation). Corrective migration `fix-organizations-code-check` replaces the CHECK with a byte-exact prefix test (`BINARY LEFT(code, 4) = 'ORG-'`) plus a digits-only regex; the already-applied migration was not edited and no data is touched.
- DB tests: every read/write now uses the test's single transaction (the earlier read from another connection could not see the uncommitted row), a precondition checks the table is empty inside that transaction, and mixed-case / non-digit codes were added.

## 0.15.2 — Module 13 marked COMPLETE
- On the project owner's MariaDB: both Module 13 migrations applied and `tests/db/organizations.test.ts` passed (14 of 14). One unrelated pre-existing test in `tests/db/auth-sessions.test.ts` ("survives two simultaneous logins", Module 10) failed in that run although it passed in the two previous runs; it is being tracked separately and does not involve Module 13.

## 0.16.0 — Module 14: Geography
- Global shared reference data (decision: not organization-owned, no `organization_id`, no FK to `organizations`): separate tables `countries`, `governorates`, `centers` (one Center/City level with `kind` CENTER|CITY) and `villages`, each with `id`, `code`, one required `name` (Arabic or English), `status` ACTIVE/INACTIVE, timestamps, and a real foreign key to its parent with `ON DELETE RESTRICT`. Case-sensitive code CHECKs (`CNT-`/`GOV-`/`CTR-`/`VIL-`), unique names per parent (and kind for centers).
- Read-only public contract `GeographyLookup` (`get*`, `list*`, `validateHierarchy` with the Master Specification §28 rules; inactive nodes rejected by default) and `GeographyNodeDto`; error codes with ar/en messages.
- Idempotent reference seed `npm run seed:geography`: Egypt and its 27 governorates only. Centers, cities and villages are NOT seeded and the dataset is explicitly not complete.
- No delete/rename/reactivation operations, no HTTP endpoints, no permissions (authorization matrix unchanged), no outbox events.
- Database: migration `create-geography`. Tests: 30 unit tests added; MariaDB tests `tests/db/geography.test.ts` added (always-rolled-back transaction, transaction passed explicitly; not yet run).
- Known issues: `npm run db:migrate` and `npm run test:db` pending on the user machine; centers/cities/villages data source not defined.

## 0.16.1 — Module 10 fix: simultaneous logins no longer fail on an InnoDB deadlock
- Cause of the intermittent `tests/db/auth-sessions.test.ts` failure ("survives two simultaneous logins of the same user"): both logins run `SELECT ... FOR UPDATE` on an empty range and then insert; InnoDB resolves this by rolling one transaction back with a deadlock error (errno 1213), not a unique violation. `SessionService.startSession` retried only `SESSION_CONCURRENT_MODIFICATION`, so the deadlock escaped and one login failed.
- Fix (infrastructure only): `SequelizeSessionRepository` now reports a deadlock as the existing retryable `SESSION_CONCURRENT_MODIFICATION` (`isDeadlockError`, applied to the session/refresh-token inserts, updates and `FOR UPDATE` reads). No change to the service, schema, API or events.
- Tests: `tests/unit/sessions/session-repository-deadlock.test.ts` added. The real-database test is unchanged; whether the flake is gone must be confirmed by running `npm run test:db` several times on the project machine (not run here: no `node_modules` and no database in this environment).
- Docs: `IMPLEMENTATION-STATUS.md` intro now mentions Module 11.

## 0.17.0 — Module 15: Unified Address (Parent Address) and the Main Organization country
- Business rules (approved): Parent Address = Governorate (registered, id) / Center or City (free text) / Village (free text), stored in three separate fields, missing optional parts NULL, village needs center, free text normalized (NFC, whitespace) and limited to 200 characters, unregistered centers and villages accepted. The country is derived from the Main Organization and never entered; the Governorate must belong to it and be ACTIVE for new or changed addresses; historical addresses stay readable. School addresses, Student addresses (derived from the Parent) and Geography validation are unchanged.
- **Module 15** (`src/modules/15-unified-address`, pure application logic: no tables, no migration, no endpoints, no permissions, no events): `UnifiedAddressService` / `UnifiedAddressLookup` with `validateParentAddress`, `validateRawParentAddress` (Excel and any raw text: `/` is the only separator, exact Governorate-name match after NFC and whitespace normalization, no Arabic letter folding, empty components such as `A//C`, `A/B/`, `/A` rejected, `A` and `A/B` valid, same validation as structured input) and `describeStoredParentAddress` (reads a stored address without re-validating; uses the history name snapshot). `ParentAddress` returns `governorateName` so the Parents module can snapshot it. Errors (ar/en): `INVALID_PARENT_ADDRESS`, `PARENT_ADDRESS_GOVERNORATE_NOT_FOUND`, `PARENT_ADDRESS_GOVERNORATE_INACTIVE`, `PARENT_ADDRESS_COUNTRY_MISMATCH`. Composition root `src/config/unified-address.ts`.
- **Module 13**: `organizations.country_id` (nullable `CHAR(36)`, foreign key to `countries.id`, RESTRICT; migration `20261011100000-add-organizations-country`, no data change). `OrganizationDto.countryId`; `Organization.assignCountry` (set once, the same country is idempotent, a different one is rejected); atomic set-once `UPDATE ... WHERE country_id IS NULL`; `assignMainOrganizationCountry` (CLI only), `requireMainOrganizationCountryId` (fails closed with `ORGANIZATION_COUNTRY_NOT_SET`); event `OrganizationCountryAssigned` (ids only); errors `ORGANIZATION_COUNTRY_ALREADY_SET`, `ORGANIZATION_COUNTRY_NOT_SET`, `ORGANIZATION_COUNTRY_INVALID` (ar/en). No database trigger: direct SQL updates outside the application are not prevented (approved).
- **CLI**: `npm run bootstrap:organization` now also assigns Egypt after the organization step: resolves `CNT-000001`, requires name `مصر` and ACTIVE, stores the countries primary key (never the code), never overwrites a different country (conflict reported), interactive confirmation by default, `-- --yes` skips only the confirmation; idempotent. `bootstrap:main-admin` runs the same step (always interactive, advisory: its failure does not block creating the Main Admin).
- **Persistence contract for Module 17** (not created now): `docs/UNIFIED-ADDRESS.md` (current columns on `parents`, append-only `parent_address_history` with a `governorate_name` snapshot, constraints, one-transaction change).
- Tests: `tests/unit/unified-address/*` (text, parser, service, boundaries, messages), `tests/unit/organization/organization-country*.test.ts`; MariaDB `tests/db/organization-country.test.ts`. Updated: `organization-service.test.ts` (DTO fields), `tests/db/organizations.test.ts` (schema now has `country_id` and its foreign key), `tests/db/geography.test.ts` (detaches the organization country inside its rolled-back transaction).
- Documentation: Master Specification §27, §28, §32 and the Excel Parent Address note updated with the approved rules; `ORGANIZATION.md`, `GEOGRAPHY.md`, `DATABASE.md`, `ARCHITECTURE.md`, `IMPLEMENTATION-STATUS.md`, `README.md`, new `UNIFIED-ADDRESS.md`.
- Known issues: `npm run db:migrate`, `npm run typecheck`, `npm test` and `npm run test:db` must be run on the project machine (the unit tests were run here in a stub harness without the real dependencies, no database); the country must be assigned (`npm run bootstrap:organization`) before any Parent Address validates; centers, cities and villages still have no data source (not needed for Parent Addresses).

## 0.18.0 — Module 16: Schools
- Business rules (approved): Main School created ACTIVE by an authorized Main Admin; Sub-School request PENDING → ACTIVE (approval) or REJECTED (terminal, nonblank reason); ACTIVE ⇄ INACTIVE; official GPS correctable only while PENDING, accuracy ≤ 20 m, immutable after approval; 50 m geofence kept; names unique per organization (REJECTED releases the name), 200 characters, NFC; INACTIVE organization blocks creation; codes `SC-000001` gap-free; at most one active manager per school, one user may manage several schools, history kept; the requester becomes the Sub-School's School Manager only after approval, atomically, never MAIN_ADMIN; rejection grants nothing and deletes nothing; creator and manager are separate concepts.
- **Module 16** (`src/modules/16-schools`): `SchoolService` / read-only `SchoolLookup` (`isSchoolManager`, `findById`, `findByCode`, `listManagedSchoolIds`, `getActiveManagerUserId`, histories); entities `School` and `SchoolManagerAssignment`; GPS and geofence helpers; gap-free code sequence; in-memory and Sequelize (raw SQL) adapters; errors in Arabic/English; events `SchoolCreated`, `SchoolApproved`, `SchoolRejected`, `SchoolDeactivated`, `SchoolReactivated`, `SchoolGpsCorrected`, `SchoolManagerAssigned`, `SchoolManagerRevoked` (identifiers only). Address uses `GeographyLookup.validateHierarchy` (unchanged). Role assignment reuses Module 09 `RoleService` (only when the role is not held yet).
- **Database:** migration `20261012100000-create-schools` (`schools`, `school_managers`, `school_status_history`, `school_gps_history`, `school_code_sequence`; `RESTRICT` foreign keys; CHECKs; unique indexes for code, per-organization name and one active manager per school).
- **No endpoints and no permissions** (D-1/D-2 open): every write still requires an ACTIVE Main Admin actor (provisional deny-by-default check; matrix rows stay PROPOSED). Provisional choice: GPS correction, status changes and manager assignment are Main Admin only (the approved text says "authorized operation").
- **BLOCKER (not implemented):** creating the account of a brand-new applicant: IAM has no identity data to decide reuse vs conflict, a role-less applicant conflicts with §19, there is no applicant password rule and the submission channel is undecided. `requestSubSchool` accepts an existing ACTIVE user. Details in `docs/SCHOOLS.md`.
- Tests: `tests/unit/schools/*` (domain, service with simulated rollback incl. the failure-injection case, boundaries); MariaDB `tests/db/schools.test.ts` (schema, row-lock serialization of codes, constraints, atomic approval, failure injection). Updated: `tests/db/organizations.test.ts`, `organization-country.test.ts`, `geography.test.ts` (clear school tables first inside their rolled-back transactions).
- Documentation: new `docs/SCHOOLS.md`; updated `IMPLEMENTATION-STATUS.md`, `AUTHORIZATION-MATRIX.md` (rows PROPOSED), `ORGANIZATION.md`, `GEOGRAPHY.md`, `DATABASE.md`, `ARCHITECTURE.md`, `README.md`.
- Known issues: run `npm run db:migrate`, `npm run typecheck`, `npm test` and `npm run test:db` on the project machine (the unit tests were run here in a stub harness, no database); the new-applicant account creation is blocked; no endpoints until D-1/D-2 are approved.

## 0.19.0 — Module 16 completed with its REST API and the applicant-account workflow
- **Permanent rule recorded:** from now on every module ships with its own REST endpoints, tests and API documentation (`docs/MODULE-MAP.md`, `docs/IMPLEMENTATION-STATUS.md`).
- **Endpoints (`/api/v1/schools`, 11):** `POST /main-submissions` and `POST /sub-submissions` (public, login optional, per-IP abuse limit), `GET /`, `GET /:id`, `POST /:id/approve`, `POST /:id/reject`, `POST /:id/deactivate`, `POST /:id/reactivate`, `PATCH /:id/gps`, `PUT /:id/manager`, `DELETE /:id/manager`. Standard envelope, validation, stable localized error codes, request id; authentication on every non-public route; active-Main-Admin check for administrative actions.
- **Applicant account creation (approved rule):** the public form carries the school fields plus the applicant's name and phone. One transaction validates, creates the account through IAM (phone normalized to E.164) with an unguessable random password (the owner sets a real one through the existing OTP recovery flow), creates the school (Main → ACTIVE, Sub → PENDING) and stores the applicant as `created_by` and the typed name in the new `applicant_name` column. An existing phone is the IAM conflict (409): no reuse, merge or claim by phone. A logged-in applicant may submit as themselves (same phone). A public submission grants **no role, no manager link and never MAIN_ADMIN**.
- **Application:** `submitMainSchool`, `submitSubSchool`, `listSchools`, `getSchoolForActor` (visibility: Main Admin all; others submitted or managed). New errors `INVALID_APPLICANT_NAME`, `SCHOOL_APPLICANT_IDENTITY_MISMATCH`.
- **Database:** migration `20261013100000-add-schools-applicant-name` (nullable `applicant_name`, non-blank CHECK).
- **Infrastructure/presentation:** CSPRNG password generator; in-memory fixed-window limiter (`PUBLIC_SUBMISSION_RATE_LIMIT`, provisional 10/hour/IP); router, framework-free handlers and serializers; router mounted in `src/app/routes/index.ts`.
- **Deferred, unchanged:** permission matrix, D-1 and D-2 (no permission-registry entries, no new scopes or role grants).
- **Open isolated blockers** (details in `docs/SCHOOLS.md`): role mapping for the Main School applicant (MAIN_ADMIN / SCHOOL_MANAGER) and when it is granted; the conflict between "only Main Admin creates a Main School" and the public-submission rule (the later rule was implemented, granting nothing); phone-ownership verification during submission; the abuse-limit figure.
- **Tests:** unit `tests/unit/schools/*` (submissions, atomic rollback of the account, visibility, handlers, route inventory and protection, limiter, generator); API `tests/integration/schools.test.ts`; MariaDB `tests/db/schools.test.ts` extended; helpers `tests/helpers/schools-harness.ts`, `tests/helpers/schools-api-harness.ts`.
- **Verification status:** see the delivery report; the real-database, API (supertest), `typecheck` and `build` runs were not possible in the authoring environment and must be run on the project machine.

## 0.19.1 — Module 16 fixes after the first real test run
Results reported from the project machine for 0.19.0: `npm test` 736 passed, 1 failed; `npm run test:db` 96 passed, 18 failed. Causes and fixes:
- **API test (1):** the "no account takeover" test used the phone `+20 116 6666 7777`, which has one digit too many, so IAM correctly answered 400 instead of the expected conflict. Test corrected to `+20 116 666 7777` (the same number as `01166667777`). No application change.
- **Real defect found by the DB test:** the CHECK `ck_schools_holds_name` accepted a non-rejected school with `holds_name = NULL` (an UNKNOWN check result counts as satisfied). That would have disabled per-organization name uniqueness at the database level. New migration `20261013110000-fix-schools-holds-name-check` replaces the check (`holds_name IS NOT NULL AND holds_name = 1` for non-rejected schools). The application always wrote the correct value.
- **DB test bugs (9):** the service reads (`getById`, histories, `isSchoolManager`, `listManagedSchoolIds`, `listSchools`, `getSchoolForActor`) were called without the fixture's transaction, so they ran on another connection and could not see the uncommitted rows. They now pass `f.tx`. The password assertion read the user outside the transaction (it passed vacuously); it now compares the stored hash and also proves the generated password matches.
- **Deadlocks between DB test files (8):** my 0.18/0.19 test changes made several files lock the shared tables in different orders while Vitest ran files in parallel. `vitest.db.config.ts` now runs DB test files one at a time (`fileParallelism: false`) and `geography.test.ts` locks in the same order as the others.
- **Not changed, to be re-checked:** `tests/db/user-roles.test.ts > stays safe when two revocations race` failed once with a non-application error (`code` undefined). It is an existing test of Module 09 that I did not touch; the likely cause is the same lock contention. If it still fails after the DB test files run serially, the exact error message is needed.
- Status ordering of `school_status_history` now breaks timestamp ties with the creation row first.

## 0.20.0 — Organizations become many; organization address, country and school country inheritance (Modules 13, 15, 16)
- **Approved business rules** (also in the Master Specification §27): organization creation is independent of schools (no Main School prerequisite, no placeholder); an organization has a required name (unique across the whole system), a required country and its own address (governorate required, center optional, village only under a center); the applicant becomes the organization's manager with the MAIN_ADMIN role scoped to THAT organization only; every school has the same country as its organization (derived server-side, enforced in the application and the database); each school keeps its own address; the organization's country cannot change while schools exist.
- **Module 13:** many organizations (the V1 single-organization guard is superseded); `Organization.register`, `createOrganization`, `requireById`, `requireOrganizationCountryId`; administrator links (`organization_admins`, history kept) with `assignOrganizationAdmin`, `isOrganizationAdmin`, `listAdministeredOrganizationIds`; locked code sequence; errors `ORGANIZATION_NAME_ALREADY_EXISTS`, `INVALID_ORGANIZATION_ADDRESS`; event `OrganizationAdminAssigned`. `bootstrap:main-admin` links the new Main Admin to the first organization.
- **Module 15:** `validateOrganizationAddress` (country + governorate + optional center/village, all validated); Parent Address validation now takes the parent's `organizationId` (breaking contract change, no consumer exists yet: Module 17 is not built); error `ORGANIZATION_ADDRESS_COUNTRY_MISMATCH`.
- **Module 16:** `OrganizationRegistrationService` and endpoints `POST /organizations` (public, login optional, abuse limit), `GET /organizations`, `GET /organizations/:id`; one transaction creates the applicant account (IAM rules), the organization, the MAIN_ADMIN role assignment (Module 09) and the organization link. School operations now require the MAIN_ADMIN role AND an administrator link to the school's organization; reads are organization-scoped. `POST /schools` creates a Main School (authenticated administrator of the organization) and replaces the public `main-submissions` endpoint (breaking change to the 0.19 contract; it resolves the earlier conflict about who creates a Main School). Schools gain `country_id` (derived; `SCHOOL_COUNTRY_MISMATCH`). Shared `ApplicantAccountResolver`.
- **Database:** migrations `20261014100000-organizations-multi-organization` (drops the single-organization index/CHECK, address columns, unique name, `uq_organizations_id_country`, `organization_code_sequence`, `organization_admins`, backfill of administrator links for current MAIN_ADMIN holders) and `20261014110000-schools-country-invariant` (`uq_governorates_id_country`, `schools.country_id` backfilled from the governorate, composite foreign keys to organizations and governorates; stops with a report if existing data is inconsistent). Forward-only; no applied migration was edited.
- **Tests:** unit `organization-many`, `organization-registration` (registration, scope, country invariant, atomic rollback, concurrent duplicate name), updated Module 13/15/16 suites and harnesses; API `tests/integration/schools.test.ts` rewritten; MariaDB `tests/db/schools.test.ts` (registration, composite foreign keys, organization scope, real concurrency of the unique name) and `tests/db/organizations.test.ts` (the V1 single-organization tests were replaced by the new rules). `vitest.db.config.ts` still runs DB files serially.
- **Open decisions** (docs/SCHOOLS.md): granting MAIN_ADMIN before phone verification (mitigated by the unknown password and OTP recovery); platform-wide administrators (not defined, not invented); the deferred permission matrix, D-1 (superseded by the approved organization scope) and D-2.
- **Verification status:** unit tests were run only in a stand-in harness; migrations, `typecheck`, `npm test`, API and `test:db` runs were not possible in the authoring environment and must be run on the project machine.

## 0.20.1 — Fixes after the first real test runs of 0.20.0
- **Application (Module 16):** `approveSubSchool` now checks the school's status before the requester's eligibility. Approving a school that is no longer an approvable PENDING Sub-School (REJECTED is terminal, ACTIVE, INACTIVE, or a Main School) always answers `SCHOOL_INVALID_STATUS_TRANSITION`; before, a deactivated requester made it answer `SCHOOL_MANAGER_NOT_ELIGIBLE` for an already rejected school. Behaviour for a PENDING request is unchanged.
- **Tests:** `tests/db/geography.test.ts` now expects the `uq_governorates_id_country` unique index added by migration `20261014110000`. The API harness (`tests/helpers/schools-api-harness.ts`) gives `OrganizationRegistrationService` a unit of work that really rolls back the in-memory stores (the session harness's one is a pass-through), and `session-harness.ts` also returns its `users` and `roleRepo`. No migration and no contract change.

## 0.20.2 — Module 16 closure audit
- **Audit result:** all 14 Module 16 endpoints (11 under `/api/v1/schools`, 3 under `/api/v1/organizations`) are implemented, mounted in `src/app/routes/index.ts`, covered by the route-inventory unit test (authentication first on every non-public route) and by supertest API tests; schema, row locking, constraints, atomic approval, failure injection and real concurrency are covered by `tests/db/schools.test.ts`. Events are published through the outbox in the same transaction as the change.
- **Documentation only (no behaviour change):** removed stale statements ("no endpoint exists", the applicant-account "Blocker", the public Main School row, "tests pending") from `docs/SCHOOLS.md`, `docs/AUTHORIZATION-MATRIX.md` and one code comment in `school-service.ts`; added the "Closure" section to `docs/SCHOOLS.md`; no decision in the matrix was changed or approved.
- **Status:** Module 16 is COMPLETED and CLOSED. Deferred by decision, not Module 16 work: permission-registry entries and the SCHOOL scope resolver (D-1/D-2), delivery of the rejection notification (Modules 31/32). Next: Module 17 (Parents), after its own pre-implementation decisions.

## 0.21.0 — Project-wide API documentation (OpenAPI / Swagger UI)
- **Phase 1 (infrastructure):** `GET /api-docs` (Swagger UI) and `GET /api-docs.json` (outside `/api/v1`), enabled outside production and disabled in production unless `API_DOCS_ENABLED=true` (`AppConfig.apiDocs.enabled`, `docs/CONFIGURATION.md`, `.env.example`); a typed builder kit in Module 04 (`presentation/openapi/`, exported through `public/`); the assembler and the mount in `src/app/openapi/`; `createApp({ apiDocsEnabled })` (default from the configuration); documentation failures never block startup. New pinned dependencies: `swagger-ui-express@5.0.1`, `swagger-ui-dist@5.33.0` (runtime); `@types/swagger-ui-express@4.1.8`, `openapi-types@12.1.3`, `ajv@8.20.0`, `ajv-formats@3.0.1`, `@apidevtools/swagger-parser@12.1.0` (dev). The lockfile gained only these packages.
- **Phase 2 (contracts and verification):** the 23 existing endpoints are documented (app health 2, Module 10: 4, Module 11: 3, Module 16: 14) with authentication, roles/scope (copied from the authorization matrix, deferred decisions labelled), request schemas, validation constraints, examples, success and error responses. `tests/api-docs/`: real route inventory, completion gate, response conformance against the in-memory harnesses, request validation probes (including the boundary at `maxLength`), security drift against the real middleware, documented error code/status agreement with the real error kinds. `ORGANIZATION_LIST_SPEC` in `organization-routes.ts` is now exported (it was a private constant; the value is unchanged). No validator, handler, middleware, envelope or error code was changed.
- **Phase 3 (governance):** `docs/API-DOCUMENTATION.md`; the endpoint tables of `SCHOOLS.md`, `SESSIONS.md` and `PASSWORD-RECOVERY.md` now point to Swagger (business rules, architecture and authorization decisions kept); the completion criteria in `MODULE-MAP.md` and `IMPLEMENTATION-STATUS.md`; scripts `api:verify` and `api:export` (optional export to the git-ignored `dist/openapi.json`); `scripts/` is type-checked.
- **Documentation findings fixed while verifying (documentation only):** `error.details` is an object `{ fields }` for validation errors but a plain array of `{ field, code }` for address business errors; the recovery password policy (4–12 characters) was missing from the reset endpoint.

## 0.22.0: role separation, no Main/Sub school, PENDING-first approval, engine-based authorization, free-text address

**Status when authored: implemented and statically checked only (superseded by 0.22.1 below).** The authoring environment had no installed dependencies, no network and no MariaDB, so `npm run typecheck`, `npm run build`, `npm test`, `npm run db:migrate` and `npm run test:db` were **not run**. What was run: a TypeScript diagnostic diff (before/after, ignoring missing-dependency noise: zero new diagnostics except the missing `@types/node` ones) and `node --check` on every migration. Swagger/OpenAPI is a separate workstream and is not touched; its verification stays pending until merged.

### Implemented
- **Roles:** `ORGANIZATION_MANAGER` added (catalog, DB CHECK, docs). `MAIN_ADMIN` is the platform administrator with no school or organization permission. Organization registration assigns ORGANIZATION_MANAGER (never MAIN_ADMIN). `bootstrap:main-admin` is platform-level and no longer creates or links an organization.
- **Authorization:** Module 16 no longer checks roles itself. Permissions `schools.school.{create,list,read,approve,reject,deactivate,reactivate,correct-gps}`, `schools.manager.{assign,revoke}` (Module 16) and `organizations.organization.{list,read}` (Module 13) are registered through the Module 12 registry, with `ORGANIZATION` and `SCHOOL` MANAGEMENT scope resolvers that load data server-side and fail closed. Routes use `requirePermission`; denials are `403 ACCESS_DENIED`.
- **Schools:** no Main/Sub; every school starts PENDING; the owning organization's manager approves or rejects; `applicant_user_id` replaces the implicit "Sub-School requester"; `POST /schools/sub-submissions` became `POST /schools/submissions` (with `organizationId`); `SCHOOL_PARENT_INVALID` and `SCHOOL_ACTION_NOT_ALLOWED` removed.
- **Address:** organizations and schools use the Parent Address contract: registered governorate, free-text `centerName`/`villageName`. New `UnifiedAddressService.validateSchoolAddress`; `validateOrganizationAddress` takes free text.

### Migrations (forward-only; `down` refuses)
`20261015100000-organization-manager-role`, `20261015110000-free-text-center-village`, `20261015120000-schools-remove-main-sub` (archive tables `school_classification_archive`, `school_manager_source_archive`; `schools.applicant_user_id`). Run `npm run db:migrate` on a COPY of real data first and review the role-migration judgment call in `docs/ORGANIZATION.md`.

### Tests (written, not run)
Rewritten or extended: `tests/unit/schools/*` (incl. new `school-authorization.test.ts`), `tests/unit/{organization,unified-address,roles}`, `tests/integration/schools.test.ts`, `tests/db/schools.test.ts` (incl. the role-migration SQL on fixture rows), `tests/db/organizations.test.ts`; helpers `schools-harness.ts`, `schools-api-harness.ts`.

### Known issues and open decisions
See `docs/SCHOOLS.md` (OPEN DECISIONS): MAIN_ADMIN platform permissions (D-1), D-2, D-3 (partial), applicant visibility of a PENDING school, ORGANIZATION_MANAGER granted before phone verification, self-approval. Module 17 is not started.

## 0.22.1 — Module 16 reconciliation (typecheck, build, unit, integration and API-documentation gates green)
- **Why:** 0.22.0 (role separation, PENDING-first schools, engine-based authorization) and 0.21.0 (OpenAPI) were committed without being merged: `typecheck` and `build` failed and 14 test files failed.
- **Code:** `16-schools/public` now exports `organizationApiDoc` and `schoolApiDoc`; `ORGANIZATION_LIST_SPEC` is exported from `organization-routes.ts` (its documented export is restored); the obsolete `school-type.ts` (Main/Sub) was deleted together with `DELETE-THESE-FILES.txt`.
- **OpenAPI contracts rewritten for the current model** (`school.openapi.ts`, `organization.openapi.ts`): no Main/Sub, `POST /schools` creates a PENDING school, `POST /schools/submissions` (was `sub-submissions`), free-text `centerName`/`villageName`, `applicantUserId`, ORGANIZATION_MANAGER with registered permission ids, `403 ACCESS_DENIED`, manager source values `APPROVAL`/`ASSIGNMENT`, and `manager` nullable on approval. The route inventory and completion gates pass for all 14 Module 16 endpoints.
- **Tests:** `tests/api-docs/conformance/schools.test.ts` rewritten for the current endpoints; `requirePermission` supplied to the router test doubles; `tests/helpers/schools-api-harness.ts` has a unit of work that really rolls back accounts, roles, organizations, schools and outbox messages; stale expectations fixed (organization address keys, 9 assignable roles including ORGANIZATION_MANAGER, a duplicate school name in a fixture).
- **Documentation:** `CHANGELOG-ENTRY-0.21.0.md` merged here as 0.22.0 and removed; README delivery notes moved to `docs/DELIVERY-NOTES.md`; `SCHOOLS.md` and `IMPLEMENTATION-STATUS.md` updated. No business rule, migration or runtime behaviour was changed.
- **Verification:** `npm run typecheck`, `npm run build`, `npm test` (86 files, 855 tests) and `npm run api:verify` pass. There is no `lint` script.

## 0.22.2 — Fixes after the first real `test:db` run of 0.22.x
- **Application (Module 16):** `approveSchool` checks the school's status before the organization state and the requester's eligibility (same rule as 0.20.1, lost in the 0.22.0 rewrite): approving a school that is not PENDING (REJECTED is terminal, ACTIVE, INACTIVE) always answers `SCHOOL_INVALID_STATUS_TRANSITION`. Behaviour for a PENDING school is unchanged.
- **Tests only:** `tests/db/geography.test.ts` expects the `uq_governorates_id_country` index added by migration `20261014110000`; the role-separation fixture in `tests/db/schools.test.ts` gave one user two active links to the SAME organization (forbidden by `uq_organization_admins_active`), so its registration-creator link now points to a second organization.
- **Verification:** all migrations applied from scratch and `npm run test:db` passes (13 files, 129 tests) on MariaDB 10.11 in the authoring environment; unit (855) and API-documentation tests pass. Run `db:migrate` and `test:db` once more on your MariaDB 10.4 and, before production, on a copy of real data.

## 0.22.3 — Organization registration: the applicant chooses the password
- **Change (requested by the project owner):** `POST /organizations` now takes `applicant.password` (4-12 characters, Master Specification §23). For a NEW account (caller not logged in) it is required: missing or invalid -> 400 `INVALID_PASSWORD` (IAM password policy), longer than 12 -> 400 `VALIDATION_FAILED`. The account is created with that password (hashed by IAM) and the applicant can log in immediately. A logged-in applicant needs no password (the existing account is used; a password sent is ignored). The password is never returned, logged or stored in clear.
- **Unchanged:** public school submissions (`POST /schools/submissions`) still create the account with a generated password that nobody knows (recovery through OTP).
- **Code:** `ApplicantAccountResolver.resolve(..., chosenPassword, passwordRequired)`, `OrganizationRegistrationService`, route validation, OpenAPI (`organization.openapi.ts`), tests and `docs/SCHOOLS.md`.
- **Security note:** the phone is not verified at registration, so whoever types a not-yet-registered phone number owns the new account; the real owner of that number would then hit `USER_PHONE_ALREADY_EXISTS`. The role is still limited to the new organization. OTP verification of the phone (Module 11 sender) is the proper mitigation once a provider is chosen.
- **Verification:** `npm run typecheck`, `npm test` and `npm run api:verify` pass in the authoring environment.

## 0.22.4 — School requests: the applicant chooses the password
- **Change (requested by the project owner):** `POST /schools/submissions` now takes `applicant.password`, exactly like organization registration (0.22.3): 4-12 characters, required when the caller is not logged in (`INVALID_PASSWORD` / `VALIDATION_FAILED` otherwise), ignored for a logged-in applicant. The new account is created with that password, so the applicant can log in immediately; nothing is returned or logged. No generated password is used any more.
- **Code:** `SchoolService.submitSchool`, `ApplicantInput.password`, school route validation, `school.openapi.ts`, tests, `docs/SCHOOLS.md`.
- **Same security note as 0.22.3:** the phone is not verified at submission. The applicant still gets no role until the organization manager approves.
- **Verification:** `npm run typecheck`, `npm run build`, `npm test`, `npm run api:verify` and `npm run test:db` pass in the authoring environment.

## 0.23.0 — Module 17 (Parents) and the account-level mandatory password change
- **Approved by the project owner** (Module 17 decisions, see `docs/PARENTS.md`): School Manager registration of Parents with same-organization account reuse, identity conflicts instead of merges, Parent Address persistence with history (Module 15 keeps validating), Parent-to-School links with history, own-profile read for the PARENT role, no global deactivation (D-3), and a **mandatory first-login password change** for newly created Parent accounts.
- **Module 17 (new):** domain (`Parent`, `ParentSchoolLink`, three-part name rules, events), application (`ParentService`, `ParentLookup`, authorization registration, Arabic/English errors), infrastructure (SQL and in-memory repositories), presentation (`/api/v1/parents`: `POST /`, `GET /me`, `GET /schools/{schoolId}`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}/schools/{schoolId}`; OpenAPI `parent.openapi.ts`). Permissions `parents.parent.{create,list,read,update,read-own}` and `parents.school-link.remove` plus the MANAGEMENT/PARENT scope resolver are registered through the Module 12 engine; ORGANIZATION_MANAGER and MAIN_ADMIN get none.
- **Module 08 (Identity):** `users.must_change_password` (migration `20261018100000`, default 0), `User.mustChangePassword`, `UserDto.mustChangePassword`, `createUser({ mustChangePassword })`; any successful `changePassword` clears it. Existing accounts are unaffected.
- **Module 10 (Sessions):** `requireAuthentication` answers `403 PASSWORD_CHANGE_REQUIRED` while the flag is set; new `requireAuthenticationAllowingPasswordChange` (only for change-password and the logouts); new `POST /auth/change-password` (`CURRENT_PASSWORD_INCORRECT`, `NEW_PASSWORD_SAME_AS_CURRENT`, `INVALID_PASSWORD`); login/refresh responses carry `mustChangePassword`; `AuthPrincipal.mustChangePassword`.
- **Database:** migrations `20261018100000-users-must-change-password` and `20261018110000-create-parents` (`parents`, `parent_addresses`, `parent_schools`). The CHECK constraints use the NULL-safe `<=>`: the first draft with a plain `=` accepted a row that was neither current nor ended (found by the real-database test and fixed before release).
- **Master Specification:** two approved amendments recorded (§24 initial password change for new Parent accounts; §32 reuse limited to one organization, identity rules, permissions).
- **Tests:** `tests/unit/parents/*` (domain, service, authorization, boundaries), `tests/integration/parents.test.ts`, `tests/api-docs/conformance/parents.test.ts`, `tests/db/parents.test.ts`, new Module 08/10 cases (identity flag, change-password, enforcement); `tests/helpers/parents-harness.ts`, `parents-api-harness.ts`; `schools-api-harness.ts` can roll back extra stores.
- **Not implemented / open:** verified-name sources for existing non-Parent accounts (V1 default: identity conflict), the "has students" guard on unlinking (Module 19), global Parent deactivation/deletion and role removal (D-3).
- **Verification:** `npm run typecheck`, `npm run build`, `npm test`, `npm run api:verify`, `npm run db:migrate` (from scratch) and `npm run test:db` on MariaDB 10.11 in the authoring environment (results in the delivery notes). There is no `lint` script.

## 0.23.1 — Module 17 follow-up: canonical three-part personal name, real existing-account matching, unlink guard
- **Approved by the project owner:** personal name of the organization creator, the school applicant (School Manager) and the Parent is EXACTLY three parts; it is stored once on the account; existing accounts are matched by that stored name; one account may hold several permitted roles (ORGANIZATION_MANAGER + SCHOOL_MANAGER approved); no unsafe unlink; no Parent National ID.
- **Module 08:** `users.full_name` (nullable, migration `20261019100000`, no invented data), `normalizePersonName`/`checkPersonName`/`isSamePersonName`, `createUser({ fullName })`, `ensureFullName`, `UserDto.fullName`, errors `INVALID_PERSON_NAME` and `PERSON_NAME_MISMATCH`.
- **Module 16:** `normalizeApplicantName` now means exactly three parts (`INVALID_APPLICANT_NAME`); organization registration and school submission persist the name on the account (new account: stored; logged-in account without a name: set; different name: `PERSON_NAME_MISMATCH`, nothing created). The ORGANIZATION_MANAGER + SCHOOL_MANAGER case needed no code change (assignment already reuses the account and scopes the role to the school link) and is now covered by tests.
- **Module 17:** the stand-in name source (`VerifiedAccountNames`) is REMOVED; existing accounts are matched by `users.full_name`. The Parent record no longer stores a name (migration `20261019110000-parents-use-account-name`, stops safely if data is inconsistent); `PATCH /parents/{id}` takes the address only (`name` was removed because the name is the account's); the list sorts by `createdAt` only; new `ParentStudentDependencies` guard and `PARENT_HAS_STUDENTS_IN_SCHOOL` (422) on unlink; the `ParentUpdated` event was removed.
- **Operations:** `npm run person-names:report` / `person-names:apply` (accounts created before the name existed; fills only unambiguous exactly-three-part names).
- **Master Specification:** the §32 amendment was rewritten to separate approved business rules from implementation constraints (diff in the delivery notes); the §24 amendment is unchanged.
- **Tests:** `tests/unit/identity/person-name.test.ts`, `tests/unit/schools/person-name-persistence.test.ts`, `tests/unit/parents/parent-multi-role.test.ts`, `tests/unit/cli/person-names.test.ts`, updated Parents tests, DB regression tests for the CHECK constraints (`REGRESSION` block in `tests/db/parents.test.ts`), `users.full_name` assertions in `tests/db/schools.test.ts`. Existing Module 16 fixtures now use three-part names.

