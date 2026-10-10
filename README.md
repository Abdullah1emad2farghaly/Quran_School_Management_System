# Quran School Management System

Multi-school / multi-branch Quran school management backend. Authoritative spec: `docs/MASTER-SPECIFICATION.md`.

## Stack
Node.js 20+, Express, TypeScript (strict), Sequelize + MySQL, express-validator, jsonwebtoken, bcryptjs, Vitest. BullMQ + Redis arrive with the outbox module.

## Setup
```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # http://localhost:3000/api/v1/health
```

## Scripts
`npm run dev` · `build` · `start` · `typecheck` · `test` · `test:unit` · `test:integration` · `db:migrate` · `db:seed`

## Database
Create a MySQL database matching `DATABASE_NAME`, then `npm run db:migrate`. Schema changes go through migrations in `database/migrations` only.

## API
Base path `/api/v1`. Localization: `ar` (default), `en`. See `docs/ARCHITECTURE.md`.

## Status
See `docs/IMPLEMENTATION-STATUS.md`. Currently: Foundation phase complete (Modules 00–07); Modules 08 (Identity Core), 09 (Roles & Permissions), 10 (Sessions & JWT) 11 (OTP & Password Recovery) and 12 (Authorization Engine) implemented; 13 (Main Organization) implemented; next is Module 14 Geography. Fresh install: `npm run db:migrate`, then `npm run bootstrap:main-admin` (creates the Main Organization, then the first Main Admin). Authorization decisions: `docs/AUTHORIZATION-MATRIX.md`; first Main Admin: `npm run bootstrap:main-admin` (see `docs/AUTHORIZATION.md`).

# _____________________________________________________________________________________

# Module 00 — Shared Kernel (delta over bootstrap)

Extract at the project root, overwriting existing files.

## New
- src/modules/00-shared-kernel/** (entities, value objects, events, contracts, services, pagination, public/index.ts)
- src/app/middleware/http-status.ts
- tests/unit/shared-kernel/*.test.ts

## Modified (overwrite)
- src/app/middleware/error-handler.middleware.ts
- src/app/middleware/error-messages.ts
- docs/ARCHITECTURE.md, docs/IMPLEMENTATION-STATUS.md, docs/PROJECT-CHANGELOG.md (cumulative)

## Packages
No new dependencies. package.json is unchanged.

# _________________________________________________________________________________________
# Module 01 — Configuration & Environment (delta over Module 00)

Extract at the project root. Replace files listed under "Replace".

## New
- src/modules/01-configuration/** (config loader, redaction, ConfigurationError, locale value object, public/index.ts)
- tests/unit/configuration/config-loader.test.ts
- tests/unit/configuration/config-redaction.test.ts
- docs/CONFIGURATION.md

## Replace (existing files changed)
- src/config/env.ts            (now delegates to Module 01; same exports as before)
- src/app/bootstrap/create-app.ts   (one line: CORS origins copied to a mutable array)
- .env.example                 (documented; your real .env is not touched)
- docs/IMPLEMENTATION-STATUS.md
- docs/PROJECT-CHANGELOG.md

## Packages
No new dependencies. Do not run npm install again.

## Behavior change to be aware of
Invalid configuration now stops startup with a clear list of problems.
If your local .env has e.g. a trailing slash in CORS_ORIGINS, fix it.

# ___________________________________________________________________________________________

# Module 02 — Database & Transaction Infrastructure (delta over Module 01)

Extract at the project root. Replace files listed under "Replace".

## New
- src/modules/02-database/**
- database/helpers.cjs
- tests/unit/database/unit-of-work.test.ts
- tests/unit/database/sequelize-options.test.ts
- tests/db/database.test.ts          (real DB checks, NOT run by `npm test`)
- vitest.db.config.ts
- docs/DATABASE.md

## Replace (existing files changed)
- src/config/database.ts      (delegates to Module 02; adds getUnitOfWork(); same exports as before)
- vitest.config.ts            (excludes tests/db from the default run)
- package.json                (ONLY change: new script "test:db"; dependencies unchanged.
                               If you prefer, just add this line to "scripts":
                               "test:db": "vitest run --config vitest.db.config.ts")
- docs/ARCHITECTURE.md, docs/IMPLEMENTATION-STATUS.md, docs/PROJECT-CHANGELOG.md

## Packages
No new dependencies. Do not run npm install again.

## Verify
1. npm run typecheck
2. npm test
3. Start XAMPP MariaDB, create the database named in your .env (phpMyAdmin), then:
   npm run test:db

# _____________________________________________________________________________________

# Module 03 — Error & Localization (delta over Module 02)

Extract at the project root. Replace the files listed under "Replace" and DELETE the two listed under "Delete".

## New
- src/modules/03-error-localization/**
- tests/unit/localization/locale-resolver.test.ts
- tests/unit/localization/message-catalog.test.ts
- tests/unit/localization/error-response.test.ts
- tests/integration/localization.test.ts
- docs/LOCALIZATION.md

## Replace (existing files changed)
- src/modules/00-shared-kernel/domain/errors/app-error.ts   (adds optional `params`)
- src/modules/00-shared-kernel/public/index.ts              (exports ErrorMessageParams)
- src/app/middleware/error-handler.middleware.ts            (thin wrapper over Module 03)
- src/app/middleware/request-context.middleware.ts          (uses Module 03 locale resolver; sets Content-Language)
- tests/unit/request-context.test.ts                        (locale tests moved to Module 03)
- tests/unit/shared-kernel/errors.test.ts
- docs/ARCHITECTURE.md, docs/IMPLEMENTATION-STATUS.md, docs/PROJECT-CHANGELOG.md

## Delete (moved into Module 03)
- src/app/middleware/error-messages.ts
- src/app/middleware/http-status.ts

## Packages
No new dependencies. Do not run npm install again.

## Verify
npm run typecheck
npm test


# ____________________________________________________________________________

# Module 04 — Validation & API Standards (delta over Module 03)

Extract at the project root. Replace the files listed under "Replace".

## New
- src/modules/04-validation-api/**
- src/modules/00-shared-kernel/domain/errors/field-error.ts
- src/app/bootstrap/register-error-messages.ts
- tests/unit/validation/list-query.test.ts
- tests/unit/validation/responses.test.ts
- tests/integration/api-standards.test.ts
- docs/API-STANDARDS.md

## Replace (existing files changed)
- src/modules/00-shared-kernel/public/index.ts                      (exports FieldError)
- src/modules/03-error-localization/presentation/http/error-response.ts   (localizes details.fields)
- src/app/bootstrap/create-app.ts                                    (registers validation messages)
- tests/unit/localization/error-response.test.ts
- docs/LOCALIZATION.md, docs/IMPLEMENTATION-STATUS.md, docs/PROJECT-CHANGELOG.md

## Packages
No new dependencies (express-validator is already in package.json). Do not run npm install again.

## Verify
npm run typecheck
npm test


# Module 05 — Logging & Request Context (delta over Module 04)

Extract at the project root. Replace the files listed under "Replace".

## New
- src/modules/05-logging-request-context/domain/services/request-id.ts
- src/modules/05-logging-request-context/domain/services/redact.ts
- src/modules/05-logging-request-context/application/ports/logger.ts
- src/modules/05-logging-request-context/infrastructure/services/structured-logger.ts
- src/modules/05-logging-request-context/presentation/http/request-logger.middleware.ts
- src/modules/05-logging-request-context/public/index.ts
- src/modules/01-configuration/domain/value-objects/log-level.ts
- src/config/logger.ts
- tests/unit/logging/redact.test.ts
- tests/unit/logging/logger.test.ts
- tests/integration/request-logging.test.ts
- docs/LOGGING.md

## Replace (existing files changed)
- src/modules/05-logging-request-context/infrastructure/services/request-context.ts   (adds actorUserId + update())
- src/modules/01-configuration/application/dto/app-config.ts          (adds logLevel)
- src/modules/01-configuration/infrastructure/services/config-loader.ts   (LOG_LEVEL)
- src/modules/01-configuration/public/index.ts
- src/app/middleware/request-context.middleware.ts
- src/app/middleware/error-handler.middleware.ts                      (logs through the logger)
- src/app/bootstrap/create-app.ts                                     (access log middleware)
- tests/unit/configuration/config-loader.test.ts
- tests/unit/request-context.test.ts
- .env.example                                                        (adds LOG_LEVEL; your real .env is not touched)
- docs/CONFIGURATION.md, docs/IMPLEMENTATION-STATUS.md, docs/PROJECT-CHANGELOG.md

## Packages
No new dependencies. Do not run npm install again.

## Notes
- LOG_LEVEL is optional (default info). In development you will now see one JSON line per request.
- Tests stay quiet: logging is silent when NODE_ENV=test.

## Verify
npm run typecheck
npm test
___________________________________________________________________________________________


# Module 06 — Domain Events & Transactional Outbox (delta over Module 05)

Extract at the project root. Replace the files listed under "Replace".

## New
- src/modules/06-domain-events-outbox/**   (domain, application, infrastructure, public)
- database/migrations/20261007120000-create-outbox-messages.js
- src/config/outbox.ts
- tests/unit/outbox/retry-and-events.test.ts
- tests/unit/outbox/outbox-service.test.ts
- tests/unit/outbox/outbox-processor.test.ts
- tests/unit/outbox/outbox-scheduler.test.ts
- tests/db/outbox.test.ts          (real DB checks, NOT run by `npm test`)
- docs/EVENTS-OUTBOX.md

## Replace (existing files changed)
- src/app/server.ts                 (starts/stops the outbox processor)
- docs/ARCHITECTURE.md, docs/IMPLEMENTATION-STATUS.md, docs/PROJECT-CHANGELOG.md

## Packages
No new dependencies (no Redis/BullMQ needed yet). Do not run npm install again.

## Database step (required)
With XAMPP MariaDB running and the database from your .env created:
  npm run db:migrate
This creates the `outbox_messages` table (and sequelize-cli's `SequelizeMeta` bookkeeping table).
Until you migrate, `npm run dev` logs one "outbox processing failed" error per minute; that is expected.

## Verify
npm run typecheck
npm test
npm run test:db        (after migrating; uses rows with event type "Test.*" and year-2001 timestamps, then deletes them)


# _____________________________________________________________________________________

# Module 07 — File Infrastructure (delta over Module 06)

Extract at the project root. Replace the files listed under "Replace".

## New
- src/modules/07-file-infrastructure/**
- database/migrations/20261007130000-create-stored-files.js
- src/config/files.ts
- tests/helpers/zip-builder.ts
- tests/unit/files/file-name.test.ts
- tests/unit/files/excel-validator.test.ts
- tests/unit/files/file-service.test.ts
- tests/unit/files/local-file-storage.test.ts
- tests/db/files.test.ts          (real DB checks, NOT run by `npm test`)
- docs/FILES.md

## Replace (existing files changed)
- src/app/bootstrap/register-error-messages.ts   (registers file error messages)
- docs/IMPLEMENTATION-STATUS.md, docs/PROJECT-CHANGELOG.md

## Also replace (from the earlier fix, if you have not yet)
- tests/db/outbox.test.ts

## Packages
No new dependencies. Do not run npm install again.

## Database step (required for the DB test)
  npm run db:migrate        (creates the `stored_files` table)

## Verify
npm run typecheck
npm test
npm run test:db

## Notes
- FILE_STORAGE_PATH (default ./storage, already git-ignored) is created on first upload.
- Upload over HTTP (multipart) arrives with Module 36, which will add the upload library.
