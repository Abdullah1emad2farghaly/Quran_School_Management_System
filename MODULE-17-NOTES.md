# Module 17 (Parents) delivery — version 0.23.0

Unzip over the project root. Files marked NEW are added; files marked REPLACE are the WHOLE updated file (overwrite the existing one).

## Then run
    npm install            # no new dependencies
    npm run db:migrate     # 2 new migrations: 20261018100000-users-must-change-password, 20261018110000-create-parents
    npm run typecheck && npm run build && npm test && npm run api:verify && npm run test:db

## Optional cleanup
The empty-folder placeholders `.gitkeep` of these Module 17 folders are no longer needed (they now hold files):
application/dto, application/ports, application/services, domain/entities, domain/events, domain/value-objects.

## REPLACE (existing files, whole file)
- README.md
- docs/ARCHITECTURE.md
- docs/AUTHORIZATION-MATRIX.md
- docs/DATABASE.md
- docs/IDENTITY.md
- docs/IMPLEMENTATION-STATUS.md
- docs/MASTER-SPECIFICATION.md
- docs/PROJECT-CHANGELOG.md
- docs/SESSIONS.md
- src/app/bootstrap/register-error-messages.ts
- src/app/openapi/api-documents.ts
- src/app/routes/index.ts
- src/config/sessions.ts
- src/modules/08-identity-core/application/dto/user-dto.ts
- src/modules/08-identity-core/application/services/identity-service.ts
- src/modules/08-identity-core/domain/entities/user.ts
- src/modules/08-identity-core/infrastructure/persistence/sequelize/repositories/sequelize-user-repository.ts
- src/modules/08-identity-core/infrastructure/services/in-memory-user-repository.ts
- src/modules/10-sessions-jwt/application/dto/auth-result.ts
- src/modules/10-sessions-jwt/application/services/session-error-messages.ts
- src/modules/10-sessions-jwt/application/services/session-service.ts
- src/modules/10-sessions-jwt/domain/errors/session-errors.ts
- src/modules/10-sessions-jwt/presentation/http/auth.openapi.ts
- src/modules/10-sessions-jwt/presentation/http/auth.routes.ts
- src/modules/10-sessions-jwt/presentation/http/authentication.middleware.ts
- src/modules/10-sessions-jwt/public/index.ts
- tests/api-docs/conformance/auth-recovery.test.ts
- tests/api-docs/error-kinds.test.ts
- tests/api-docs/request-validation.test.ts
- tests/helpers/schools-api-harness.ts
- tests/helpers/session-harness.ts
- tests/integration/auth.test.ts
- tests/unit/identity/identity-service.test.ts

## NEW
- database/migrations/20261018100000-users-must-change-password.js
- database/migrations/20261018110000-create-parents.js
- docs/PARENTS.md
- src/config/parents.ts
- src/modules/17-parents/application/dto/parent-dto.ts
- src/modules/17-parents/application/ports/parent-repository.ts
- src/modules/17-parents/application/ports/parent-school-link-repository.ts
- src/modules/17-parents/application/ports/verified-account-names.ts
- src/modules/17-parents/application/services/parent-authorization.ts
- src/modules/17-parents/application/services/parent-error-messages.ts
- src/modules/17-parents/application/services/parent-service.ts
- src/modules/17-parents/domain/entities/parent-school-link.ts
- src/modules/17-parents/domain/entities/parent.ts
- src/modules/17-parents/domain/errors/parent-errors.ts
- src/modules/17-parents/domain/events/parent-events.ts
- src/modules/17-parents/domain/value-objects/parent-name.ts
- src/modules/17-parents/infrastructure/persistence/sequelize/repositories/sequelize-parent-repository.ts
- src/modules/17-parents/infrastructure/persistence/sequelize/repositories/sequelize-parent-school-link-repository.ts
- src/modules/17-parents/infrastructure/services/in-memory-parent-repositories.ts
- src/modules/17-parents/presentation/http/parent-handlers.ts
- src/modules/17-parents/presentation/http/parent-routes.ts
- src/modules/17-parents/presentation/http/parent-serializer.ts
- src/modules/17-parents/presentation/http/parent.openapi.ts
- src/modules/17-parents/presentation/http/session-required.ts
- src/modules/17-parents/public/index.ts
- tests/api-docs/conformance/parents.test.ts
- tests/db/parents.test.ts
- tests/helpers/parents-api-harness.ts
- tests/helpers/parents-harness.ts
- tests/integration/parents.test.ts
- tests/unit/parents/parent-authorization.test.ts
- tests/unit/parents/parent-boundaries.test.ts
- tests/unit/parents/parent-domain.test.ts
- tests/unit/parents/parent-service.test.ts

