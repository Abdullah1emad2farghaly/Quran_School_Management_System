# Module 18 (Teachers) delivery — version 0.24.0 (delta on top of the 0.23.1 follow-up zip)

Unzip over the project root: REPLACE = the WHOLE updated file; NEW = added. Contains only what changed since `module-17-parents-followup.zip`.

## Then run
    npm install                 # no new dependencies
    npm run db:migrate          # NEW migration: 20261019120000-create-teachers
    npm run typecheck && npm run build && npm test && npm run api:verify && npm run test:db

## Needs your confirmation (PROVISIONAL, marked as such in the API docs, the authorization matrix and the spec amendment)
SCHOOL_MANAGER-only management of Teachers of their own school; ORGANIZATION_MANAGER/MAIN_ADMIN get no Teacher permission; a Teacher reads only their own profile; same-organization reuse only (a Parent record of the account must be of that organization); no other personal data; no update endpoint; the unlink guard for groups (temporary until Module 20); no global deactivation (D-3).

## REPLACE
- README.md
- docs/ARCHITECTURE.md
- docs/AUTHORIZATION-MATRIX.md
- docs/DATABASE.md
- docs/IMPLEMENTATION-STATUS.md
- docs/MASTER-SPECIFICATION.md
- docs/PROJECT-CHANGELOG.md
- src/app/bootstrap/register-error-messages.ts
- src/app/openapi/api-documents.ts
- src/app/routes/index.ts
- tests/api-docs/error-kinds.test.ts
- tests/api-docs/request-validation.test.ts
- tests/helpers/parents-harness.ts

## NEW
- database/migrations/20261019120000-create-teachers.js
- docs/TEACHERS.md
- src/config/teachers.ts
- src/modules/18-teachers/application/dto/teacher-dto.ts
- src/modules/18-teachers/application/ports/teacher-group-dependencies.ts
- src/modules/18-teachers/application/ports/teacher-repository.ts
- src/modules/18-teachers/application/ports/teacher-school-link-repository.ts
- src/modules/18-teachers/application/services/teacher-authorization.ts
- src/modules/18-teachers/application/services/teacher-error-messages.ts
- src/modules/18-teachers/application/services/teacher-service.ts
- src/modules/18-teachers/domain/entities/teacher-school-link.ts
- src/modules/18-teachers/domain/entities/teacher.ts
- src/modules/18-teachers/domain/errors/teacher-errors.ts
- src/modules/18-teachers/domain/events/teacher-events.ts
- src/modules/18-teachers/domain/value-objects/teacher-name.ts
- src/modules/18-teachers/infrastructure/persistence/sequelize/repositories/sequelize-teacher-repository.ts
- src/modules/18-teachers/infrastructure/persistence/sequelize/repositories/sequelize-teacher-school-link-repository.ts
- src/modules/18-teachers/infrastructure/services/in-memory-teacher-repositories.ts
- src/modules/18-teachers/presentation/http/session-required.ts
- src/modules/18-teachers/presentation/http/teacher-handlers.ts
- src/modules/18-teachers/presentation/http/teacher-routes.ts
- src/modules/18-teachers/presentation/http/teacher-serializer.ts
- src/modules/18-teachers/presentation/http/teacher.openapi.ts
- src/modules/18-teachers/public/index.ts
- tests/api-docs/conformance/teachers.test.ts
- tests/db/teachers.test.ts
- tests/helpers/teachers-api-harness.ts
- tests/helpers/teachers-harness.ts
- tests/integration/teachers.test.ts
- tests/unit/teachers/teacher-authorization.test.ts
- tests/unit/teachers/teacher-boundaries.test.ts
- tests/unit/teachers/teacher-service.test.ts
