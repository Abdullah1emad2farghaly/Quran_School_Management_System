# Module 17 follow-up delivery — version 0.23.1 (cumulative: includes everything from 0.23.0)

Unzip over the project root: files marked REPLACE are the WHOLE updated file; NEW files are added. This zip is cumulative against the original
repository, so it also replaces the earlier `module-17-parents.zip`.

## Delete (no longer used)
- src/modules/17-parents/application/ports/verified-account-names.ts   (the stand-in name source was removed)
- Optional: the `.gitkeep` files of Module 17 folders that now hold code (application/dto, ports, services, domain/entities, events, value-objects)

## Then run
    npm install                 # no new dependencies
    npm run db:migrate          # NEW migrations: 20261019100000-users-full-name, 20261019110000-parents-use-account-name
    npm run person-names:report # accounts created before the name existed (read-only); person-names:apply fills only the unambiguous ones
    npm run typecheck && npm run build && npm test && npm run api:verify && npm run test:db

IMPORTANT: if you already ran the 0.23.0 migrations with Parent records in your database, `20261019110000-parents-use-account-name` copies
exactly-three-part Parent names to their accounts and STOPS (dropping nothing) if any Parent name is not exactly three parts or differs from
its account; it lists the affected Parent ids. Fix them and run it again.

## REPLACE
- README.md
- docs/ARCHITECTURE.md
- docs/AUTHORIZATION-MATRIX.md
- docs/DATABASE.md
- docs/IDENTITY.md
- docs/IMPLEMENTATION-STATUS.md
- docs/MASTER-SPECIFICATION.md
- docs/PROJECT-CHANGELOG.md
- docs/SESSIONS.md
- package.json
- src/app/bootstrap/register-error-messages.ts
- src/app/openapi/api-documents.ts
- src/app/routes/index.ts
- src/config/sessions.ts
- src/modules/08-identity-core/application/dto/user-dto.ts
- src/modules/08-identity-core/application/services/identity-error-messages.ts
- src/modules/08-identity-core/application/services/identity-service.ts
- src/modules/08-identity-core/domain/entities/user.ts
- src/modules/08-identity-core/domain/errors/identity-errors.ts
- src/modules/08-identity-core/infrastructure/persistence/sequelize/repositories/sequelize-user-repository.ts
- src/modules/08-identity-core/infrastructure/services/in-memory-user-repository.ts
- src/modules/08-identity-core/public/index.ts
- src/modules/10-sessions-jwt/application/dto/auth-result.ts
- src/modules/10-sessions-jwt/application/services/session-error-messages.ts
- src/modules/10-sessions-jwt/application/services/session-service.ts
- src/modules/10-sessions-jwt/domain/errors/session-errors.ts
- src/modules/10-sessions-jwt/presentation/http/auth.openapi.ts
- src/modules/10-sessions-jwt/presentation/http/auth.routes.ts
- src/modules/10-sessions-jwt/presentation/http/authentication.middleware.ts
- src/modules/10-sessions-jwt/public/index.ts
- src/modules/16-schools/application/services/applicant-account-resolver.ts
- src/modules/16-schools/application/services/organization-registration-service.ts
- src/modules/16-schools/application/services/school-service.ts
- src/modules/16-schools/domain/value-objects/applicant-name.ts
- tests/api-docs/conformance/auth-recovery.test.ts
- tests/api-docs/conformance/schools.test.ts
- tests/api-docs/error-kinds.test.ts
- tests/api-docs/request-validation.test.ts
- tests/db/schools.test.ts
- tests/helpers/schools-api-harness.ts
- tests/helpers/schools-harness.ts
- tests/helpers/session-harness.ts
- tests/integration/auth.test.ts
- tests/integration/schools.test.ts
- tests/unit/identity/identity-service.test.ts
- tests/unit/schools/organization-registration.test.ts
- tests/unit/schools/school-http-layer.test.ts
- tests/unit/schools/school-submission.test.ts

## NEW
- database/migrations/20261018100000-users-must-change-password.js
- database/migrations/20261018110000-create-parents.js
- database/migrations/20261019100000-users-full-name.js
- database/migrations/20261019110000-parents-use-account-name.js
- docs/PARENTS.md
- src/app/cli/person-names-cli.ts
- src/app/cli/person-names.ts
- src/config/parents.ts
- src/modules/08-identity-core/domain/value-objects/person-name.ts
- src/modules/17-parents/application/dto/parent-dto.ts
- src/modules/17-parents/application/ports/parent-repository.ts
- src/modules/17-parents/application/ports/parent-school-link-repository.ts
- src/modules/17-parents/application/ports/parent-student-dependencies.ts
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
- tests/unit/cli/person-names.test.ts
- tests/unit/identity/person-name.test.ts
- tests/unit/parents/parent-authorization.test.ts
- tests/unit/parents/parent-boundaries.test.ts
- tests/unit/parents/parent-domain.test.ts
- tests/unit/parents/parent-multi-role.test.ts
- tests/unit/parents/parent-service.test.ts
- tests/unit/schools/person-name-persistence.test.ts
