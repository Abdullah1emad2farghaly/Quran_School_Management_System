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
See `docs/IMPLEMENTATION-STATUS.md`. Currently: bootstrap only.

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
