# Module 33 enhancements (release 0.43.1): backend only

This ZIP is the complete updated backend project (no `node_modules`, `dist` or `.env`; `package.json` and `package-lock.json` are byte-identical to your original upload, so run `npm ci` or `npm install` as usual). This release adds NO migration (the two Module 33 migrations of release 0.43.0 are still the only ones).

Verify: `npm run db:migrate`, `npm run typecheck`, `npm run build`, `npm test`, `npm run api:verify`, `npm run test:db`.

## Modified files since the previous Module 33 delivery (37)
- docs/AUTHORIZATION-MATRIX.md
- docs/DATABASE.md
- docs/EVENTS-OUTBOX.md
- docs/IMPLEMENTATION-STATUS.md
- docs/MASTER-SPECIFICATION.md
- docs/NOTIFICATION-RULES.md
- docs/PROJECT-CHANGELOG.md
- docs/SUBSCRIPTIONS.md
- src/app/routes/index.ts
- src/config/subscriptions.ts
- src/modules/33-subscriptions/application/dto/subscription-dto.ts
- src/modules/33-subscriptions/application/ports/subscription-repository.ts
- src/modules/33-subscriptions/application/services/subscription-authorization.ts
- src/modules/33-subscriptions/application/services/subscription-error-messages.ts
- src/modules/33-subscriptions/application/services/subscription-service.ts
- src/modules/33-subscriptions/domain/entities/subscription.ts
- src/modules/33-subscriptions/domain/errors/subscription-errors.ts
- src/modules/33-subscriptions/domain/events/subscription-events.ts
- src/modules/33-subscriptions/domain/value-objects/subscription-status.ts
- src/modules/33-subscriptions/infrastructure/persistence/sequelize/repositories/sequelize-subscription-repository.ts
- src/modules/33-subscriptions/infrastructure/services/in-memory-subscription-repositories.ts
- src/modules/33-subscriptions/presentation/http/subscription-handlers.ts
- src/modules/33-subscriptions/presentation/http/subscription-routes.ts
- src/modules/33-subscriptions/presentation/http/subscription-serializer.ts
- src/modules/33-subscriptions/presentation/http/subscription.openapi.ts
- src/modules/33-subscriptions/public/index.ts
- tests/api-docs/conformance/subscriptions.test.ts
- tests/api-docs/request-validation.test.ts
- tests/db/subscriptions.test.ts
- tests/helpers/subscriptions-api-harness.ts
- tests/helpers/subscriptions-harness.ts
- tests/integration/subscriptions.test.ts
- tests/unit/notification-rules/subscription-rules.test.ts
- tests/unit/subscriptions/collector-service.test.ts
- tests/unit/subscriptions/subscription-authorization.test.ts
- tests/unit/subscriptions/subscription-boundaries.test.ts
- tests/unit/subscriptions/subscription-service.test.ts

## Added files (6)
- src/modules/33-subscriptions/application/ports/school-group-roster.ts
- src/modules/33-subscriptions/application/services/subscription-group-service.ts
- src/modules/33-subscriptions/infrastructure/services/public-school-group-roster.ts
- tests/integration/subscription-groups-and-status.test.ts
- tests/unit/subscriptions/subscription-group-service.test.ts
- tests/unit/subscriptions/subscription-status-transitions.test.ts
