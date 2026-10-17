<!-- Append this entry to docs/PROJECT-CHANGELOG.md (top or bottom, following that file's convention).
     It is delivered as a separate file because the project archive's local PROJECT-CHANGELOG.md differs from the last commit
     and could not be read when this change was prepared; replacing it would have discarded your local edits. -->

## 0.21.0: role separation, no Main/Sub school, PENDING-first approval, engine-based authorization, free-text address

**Status: implemented and statically checked only.** The authoring environment had no installed dependencies, no network and no MariaDB, so `npm run typecheck`, `npm run build`, `npm test`, `npm run db:migrate` and `npm run test:db` were **not run**. What was run: a TypeScript diagnostic diff (before/after, ignoring missing-dependency noise: zero new diagnostics except the missing `@types/node` ones) and `node --check` on every migration. Swagger/OpenAPI is a separate workstream and is not touched; its verification stays pending until merged.

### Implemented
- **Roles:** `ORGANIZATION_MANAGER` added (catalog, DB CHECK, docs). `MAIN_ADMIN` is the platform administrator with no school or organization permission. Organization registration assigns ORGANIZATION_MANAGER (never MAIN_ADMIN). `bootstrap:main-admin` is platform-level and no longer creates or links an organization.
- **Authorization:** Module 16 no longer checks roles itself. Permissions `schools.school.{create,list,read,approve,reject,deactivate,reactivate,correct-gps}`, `schools.manager.{assign,revoke}` (Module 16) and `organizations.organization.{list,read}` (Module 13) are registered through the Module 12 registry, with `ORGANIZATION` and `SCHOOL` MANAGEMENT scope resolvers that load data server-side and fail closed. Routes use `requirePermission`; denials are `403 ACCESS_DENIED`.
- **Schools:** no Main/Sub; every school starts PENDING; the owning organization's manager approves or rejects; `applicant_user_id` replaces the implicit "Sub-School requester"; `POST /schools/sub-submissions` became `POST /schools/submissions` (with `organizationId`); `SCHOOL_PARENT_INVALID` and `SCHOOL_ACTION_NOT_ALLOWED` removed.
- **Address:** organizations and schools use the Parent Address contract: registered governorate, free-text `centerName`/`villageName`. New `UnifiedAddressService.validateSchoolAddress`; `validateOrganizationAddress` takes free text.

### Migrations (forward-only; `down` refuses)
`20261015100000-organization-manager-role`, `20261015110000-free-text-center-village`, `20261015120000-schools-remove-main-sub` (archive tables `school_classification_archive`, `school_manager_source_archive`; `schools.applicant_user_id`). Run `npm run db:migrate` on a COPY of real data first and review the role-migration judgment call in `docs/ORGANIZATION.md`.

### Tests (written, not run)
Rewritten or extended: `tests/unit/schools/*` (incl. new `school-authorization.test.ts`), `tests/unit/{organization,unified-address,roles}`, `tests/integration/schools.test.ts`, `tests/db/schools.test.ts` (incl. the role-migration SQL on fixture rows), `tests/db/organizations.test.ts`; helpers `schools-harness.ts`, `schools-api-harness.ts`.

### Known issues and open decisions
See `docs/SCHOOLS.md` (OPEN DECISIONS): MAIN_ADMIN platform permissions (D-1), D-2, D-3 (partial), applicant visibility of a PENDING school, ORGANIZATION_MANAGER granted before phone verification, self-approval. Module 17 is not started.
