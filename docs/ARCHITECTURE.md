# Architecture

Modular monolith with Clean Architecture, strong module boundaries, domain events with a transactional outbox, and selective CQRS (reporting). No microservices.

## Layers per module
`domain` (no Express/Sequelize) → `application` (use cases, ports) → `infrastructure` (Sequelize, queues, storage) → `presentation/http` (thin controllers, validators, serializers) → `public` (contracts/DTOs/events other modules may use).

## Rules
- Cross-module access only via `public/` contracts, DTOs, and events.
- Sequelize models are private to their owning module.
- No circular dependencies; use shared kernel, contracts, or events instead.
- Backend is the final security boundary.
- Business and persistence changes + outbox event commit in one transaction.

## Foundation conventions (bootstrap)
- Base path: `/api/v1`.
- Success: `{ "success": true, "data": ..., "requestId": "..." }`.
- Error: `{ "success": false, "error": { "code", "message", "locale", "requestId" } }`. Codes are language-independent.
- Request ID: reuse a safe `X-Request-Id`/`X-Correlation-Id` (`[A-Za-z0-9._-]{8,64}`), else generate; echoed in `X-Request-Id`.
- Locale: user preference > `Accept-Language` > default `ar`; fallback `en`.
- Timestamps stored in UTC; business timezone `Africa/Cairo`.
- Request context via `AsyncLocalStorage` (Module 05 area).

## Bootstrap placement notes
Bootstrap pieces live in `src/app` and `src/config`; their module homes (01–05) are filled in during their phases. Base `AppError` and error codes sit in `00-shared-kernel`.

## Shared Kernel (Module 00)
Generic, business-free building blocks only: errors (code + kind), entity/aggregate/value-object bases, UUID helpers, domain event shape, `Clock`, `UnitOfWork`, business-time and pagination helpers. It contains no business concepts and imports nothing from other modules.

## Database & transactions (Module 02)
Business operations that touch several resources run inside `UnitOfWork.run`. Sequelize transactions never leave infrastructure; see `docs/DATABASE.md`.

## Errors & localization (Module 03)
Domain code throws `AppError(code, kind, details?, params?)`. Only the HTTP boundary turns it into a localized response via Module 03; see `docs/LOCALIZATION.md`.

## Events & outbox (Module 06)
Asynchronous side effects go through `Business Action → Domain Event → Outbox → Handlers`; see `docs/EVENTS-OUTBOX.md`.

## Files (Module 07)
Uploaded Excel files are stored privately (no public URLs) behind `FileService`, with content-based validation and SHA-256 integrity checks; see `docs/FILES.md`.

## Identity (Module 08)
The login identity (normalized phone, bcrypt hash, ACTIVE/INACTIVE) is owned by `IdentityService`; other modules use only its public contract and authorize their own callers. No HTTP routes until Modules 10 and 12; see `docs/IDENTITY.md`.

## Roles & permissions (Module 09)
Roles are a fixed catalog; assignments keep full history; role -> permission grants are registered by each owning module and are deny-by-default. Module 09 does not authorize its callers and has no HTTP routes until Modules 10 and 12; see `docs/ROLES.md`.

## Sessions & authentication (Module 10)
Login, refresh-token rotation, logout and access-token verification. One active session per user; refresh tokens stored only as keyed hashes; each protected request checks the session and the user. Authentication only: authorization is Module 12. See `docs/SESSIONS.md`.

## OTP & password recovery (Module 11)
Forgot-password with an OTP and a single-use reset token; keyed-hash storage, no account enumeration, concurrency-safe MySQL rate limits, OTP delivery behind the `OtpSender` port (provider chosen later). A reset revokes all sessions through Module 10. See `docs/PASSWORD-RECOVERY.md`.

## Authorization engine (Module 12)
Roles -> permissions -> scope -> ownership, deny by default and fail closed. Each module registers its own permissions (with an explicit management/reporting/unscoped policy) and the scope/ownership resolvers for the data it owns; routes use `requirePermission`, other code injects `Authorizer`. Module 12 defines no permissions or endpoints and owns no organizational data. It also provides the one-time first-Main-Admin CLI. See `docs/AUTHORIZATION.md` and the central `docs/AUTHORIZATION-MATRIX.md`.
