# Module 33 — Subscriptions: delivery notes (release 0.43.0)

Copy the contents of this zip over your project (same relative paths). Files under "REPLACE" already exist: replace them with the whole file given here. Files under "NEW" are added. `package.json` and `package-lock.json` are unchanged (no new dependency).

After copying: `npm run db:migrate` (two new migrations), then `npm run typecheck`, `npm run build`, `npm test`, `npm run api:verify`, `npm run test:db`.

Still pending from earlier deliveries (not part of this module): delete `src/modules/16-schools/domain/value-objects/school-type.ts` and `docs/CHANGELOG-ENTRY-0.21.0.md` (listed in your DELETE-THESE-FILES.txt).

## REPLACE (23 existing files, whole files)
- docs/AUTHORIZATION-MATRIX.md
- docs/DATABASE.md
- docs/EVENTS-OUTBOX.md
- docs/IMPLEMENTATION-STATUS.md
- docs/MASTER-SPECIFICATION.md
- docs/NOTIFICATION-RULES.md
- docs/PROJECT-CHANGELOG.md
- src/app/bootstrap/register-error-messages.ts
- src/app/openapi/api-documents.ts
- src/app/routes/index.ts
- src/config/notification-rules.ts
- src/modules/32-notification-rules/application/ports/directories.ts
- src/modules/32-notification-rules/application/services/reminder-processor.ts
- src/modules/32-notification-rules/application/services/rule-support.ts
- src/modules/32-notification-rules/application/services/rule-templates.ts
- src/modules/32-notification-rules/domain/value-objects/dedup-keys.ts
- src/modules/32-notification-rules/domain/value-objects/reminder-rules.ts
- src/modules/32-notification-rules/infrastructure/adapters/directory-adapters.ts
- src/modules/32-notification-rules/public/index.ts
- tests/api-docs/error-kinds.test.ts
- tests/api-docs/request-validation.test.ts
- tests/helpers/notification-rules-harness.ts
- tests/unit/notification-rules/rules-boundaries.test.ts

## NEW (41 files)
- database/migrations/20261108100000-create-subscriptions.js
- database/migrations/20261108110000-notification-reminders-subscription-kinds.js
- docs/SUBSCRIPTIONS.md
- src/config/subscriptions.ts
- src/modules/32-notification-rules/application/handlers/subscription-handlers.ts
- src/modules/33-subscriptions/application/dto/subscription-dto.ts
- src/modules/33-subscriptions/application/ports/collector-link-repository.ts
- src/modules/33-subscriptions/application/ports/student-roster.ts
- src/modules/33-subscriptions/application/ports/subscription-repository.ts
- src/modules/33-subscriptions/application/services/collector-service.ts
- src/modules/33-subscriptions/application/services/subscription-authorization.ts
- src/modules/33-subscriptions/application/services/subscription-error-messages.ts
- src/modules/33-subscriptions/application/services/subscription-service.ts
- src/modules/33-subscriptions/domain/entities/collector-school-link.ts
- src/modules/33-subscriptions/domain/entities/subscription-batch.ts
- src/modules/33-subscriptions/domain/entities/subscription.ts
- src/modules/33-subscriptions/domain/errors/subscription-errors.ts
- src/modules/33-subscriptions/domain/events/subscription-events.ts
- src/modules/33-subscriptions/domain/value-objects/billing-month.ts
- src/modules/33-subscriptions/domain/value-objects/subscription-status.ts
- src/modules/33-subscriptions/infrastructure/persistence/sequelize/repositories/sequelize-collector-link-repository.ts
- src/modules/33-subscriptions/infrastructure/persistence/sequelize/repositories/sequelize-subscription-repository.ts
- src/modules/33-subscriptions/infrastructure/services/in-memory-subscription-repositories.ts
- src/modules/33-subscriptions/infrastructure/services/public-student-roster.ts
- src/modules/33-subscriptions/presentation/http/session-required.ts
- src/modules/33-subscriptions/presentation/http/subscription-handlers.ts
- src/modules/33-subscriptions/presentation/http/subscription-routes.ts
- src/modules/33-subscriptions/presentation/http/subscription-serializer.ts
- src/modules/33-subscriptions/presentation/http/subscription.openapi.ts
- src/modules/33-subscriptions/public/index.ts
- tests/api-docs/conformance/subscriptions.test.ts
- tests/db/subscriptions.test.ts
- tests/helpers/subscriptions-api-harness.ts
- tests/helpers/subscriptions-harness.ts
- tests/integration/subscriptions.test.ts
- tests/unit/notification-rules/subscription-rules.test.ts
- tests/unit/subscriptions/collector-service.test.ts
- tests/unit/subscriptions/subscription-authorization.test.ts
- tests/unit/subscriptions/subscription-boundaries.test.ts
- tests/unit/subscriptions/subscription-service.test.ts
- tests/unit/subscriptions/subscription-time-rules.test.ts
