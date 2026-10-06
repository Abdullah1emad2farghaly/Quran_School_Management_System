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
