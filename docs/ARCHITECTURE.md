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
