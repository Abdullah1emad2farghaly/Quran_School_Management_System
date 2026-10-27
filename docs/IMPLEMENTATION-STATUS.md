# Implementation Status

Statuses: NOT_STARTED · IN_PROGRESS · IMPLEMENTED · TESTED · COMPLETED

## Bootstrap (§94 / §116)

Foundation phase (Modules 00–07) is complete: typecheck, build, unit/integration tests and the real-database tests (`npm run test:db`) pass. Modules 08–10 are completed, Module 11 is implemented (real-database verification pending), Modules 12–13 are complete, Module 14 is implemented and Module 15 (with the Module 13 country addition) is implemented (real-database verification pending for 14 and 15); Module 16 is implemented with its REST API (with isolated open blockers listed in `docs/SCHOOLS.md`); Modules 17, 18, 19 and 20 are implemented (see their rows below); Modules 21–40 have not been started and only have skeleton folders. Permanent rule: every module ships with its own REST endpoints, tests and API documentation.

## Modules

| # | Module | Status |
|---|---|---|
| 00 | Shared Kernel | COMPLETED (vitest passing on user machine) |
| 01 | Configuration & Environment | COMPLETED |
| 02 | Database & Transaction Infrastructure | COMPLETED |
| 03 | Error & Localization | COMPLETED |
| 04 | Validation & API Standards | COMPLETED |
| 05 | Logging & Request Context | COMPLETED |
| 06 | Domain Events & Transactional Outbox | COMPLETED |
| 07 | File Infrastructure | COMPLETED |
| 08 | Identity Core | COMPLETED |
| 09 | Roles & Permissions | COMPLETED |
| 10 | Sessions & JWT | COMPLETED |
| 11 | OTP & Password Recovery | IMPLEMENTED (unit and HTTP tests pass; `npm run db:migrate` and `npm run test:db` pending on the user machine) |
| 12 | Authorization Engine | COMPLETE (engine, `requirePermission`, resolver ports, first-Main-Admin CLI; unit, integration and real-database tests pass on the user machine; no permissions defined by design) |
| 13 | Organization Core | IMPLEMENTED, extended: many organizations (required country and own address, system-wide unique name, locked code sequence), organization manager links (organization scope of ORGANIZATION_MANAGER), free-text center/village, registers its own permissions and `ORGANIZATION` scope resolver with the engine, country immutable; unit tests written, real-database verification of the new migrations pending; the registration endpoints live in Module 16 |
| 14 | Geography | IMPLEMENTED (global reference data: countries, governorates, centers/cities, villages with real FKs ON DELETE RESTRICT; read-only `GeographyLookup` with `validateHierarchy`; idempotent seed of Egypt + 27 governorates only; unit tests pass; `npm run db:migrate` and `npm run test:db` pending on the user machine; no endpoints, permissions or events by design) |
| 15 | Unified Address | IMPLEMENTED, extended: Parent Address uses the country of the parent's organization (`organizationId`); `validateOrganizationAddress` validates an organization's own address; no tables, endpoints or permissions by design; unit tests pass |
| 16 | Schools | IMPLEMENTED and corrected (database tests pass, 0.22.2): no Main/Sub distinction (archive migration), every school starts PENDING and is approved/rejected by the owning organization's ORGANIZATION_MANAGER, authorization moved to the Authorization Engine (permissions + `SCHOOL` scope resolver, MAIN_ADMIN has none), free-text center/village, organization registration grants ORGANIZATION_MANAGER. Typecheck, build, unit, integration and API-documentation (`api:verify`) runs pass (0.22.1); the MariaDB runs (`db:migrate`, `test:db`) pass (0.22.2); see `docs/SCHOOLS.md` (open decisions) |
| 17 | Parents | IMPLEMENTED (0.23.1; unit, HTTP, API-conformance and real-database tests pass in the authoring environment): Parent entity (`User -> PARENT -> Parent`), Parent Address with history, Parent-to-School links with history, School Manager registration with same-organization account reuse and identity-conflict rules, own profile, account-level mandatory first-login password change (Modules 08/10, `POST /auth/change-password`); canonical three-part personal name on the account (`users.full_name`) for organization creators, school applicants and Parents; existing-account reuse matched by that stored name; unlink guard for students (temporary guard until Module 19); no global deactivation/deletion (D-3). See `docs/PARENTS.md` |
| 18 | Teachers | IMPLEMENTED (0.24.0; unit, HTTP, API-conformance and real-database tests pass in the authoring environment): Teacher entity (`User -> TEACHER -> Teacher -> school links`), School Manager registration with the APPROVED initial password (last 4 phone digits + account-level mandatory first-login change, same mechanism as Parents) and the APPROVED identity rule (stored exactly-three-part name, `TEACHER_IDENTITY_CONFLICT`; reuse never touches password or `mustChangePassword`), own profile, school-link removal with a temporary groups guard until Module 20; permissions/org scope/no-deactivation are PROVISIONAL pending confirmation. See `docs/TEACHERS.md` |
| 19 | Students | IMPLEMENTED (0.25.0; unit tests pass under a local test stand-in in the authoring environment; HTTP, API-conformance and real-database tests are written but were NOT executed there, see `docs/STUDENTS.md` and the changelog): Student business entity (exactly one Parent, no login), three-part name rule tied to the Parent, GLOBAL unique 14-digit National ID, ACTIVE/INACTIVE/ARCHIVED lifecycle (archived is final) with history, derived Parent address, School Manager management, Parent reads own children, Teacher reads students of assigned groups (temporary fail-closed stand-in until Module 20), the real Module 17 unlink guard. Business decisions approved by the project owner on 2026-10-20 |
| 20 | Groups | IMPLEMENTED (0.26.0; see `docs/GROUPS.md` and the changelog for the verification status): Group entity (one school, one Teacher at most, learning mode, progression, starting surah 1-114), ACTIVE-name uniqueness with reusable archived names, student assignment history (ONE group at a time, move, unassign, archive unassigns all), the REAL Module 18 unlink guard and Module 19 Teacher read access (both stand-ins removed), the Students `ARCHIVED` event consumer, School Manager management, Teacher and Parent reads. Business decisions approved by the project owner on 2026-10-21 |
| 21 | Quran Structure | COMPLETED (0.29.1; see `docs/QURAN-STRUCTURE.md` and `docs/verification/module21/Module21-Final-Verification-Report.md`): official KFGQPC package (text, layout) with juz from its Excel and all 240 quarters from the approved Tanzil file (quarter 106 at 15:50); converter, importer, read-only API (11 endpoints), schema (4 migrations) and tests implemented. Verified on the developer machine: `db:migrate`, `test:db`, `npm test`, `api:verify`, `typecheck`, `build`, real import and `npm run verify:quran`. 0.29.1 fixed four issues found by those runs (OpenAPI nullable reference, `quran_lines` CHECK, DB test fixture, verification-script schema checker) without changing approved data |
| 22 | Quran Position & Range Engine | NOT_STARTED |
| 23 | Group Schedules | NOT_STARTED |
| 24 | Sessions | NOT_STARTED |
| 25 | Smart Guard | NOT_STARTED |
| 26 | Attendance | NOT_STARTED |
| 27 | Memorization | NOT_STARTED |
| 28 | Revision | NOT_STARTED |
| 29 | Evaluations | NOT_STARTED |
| 30 | Exams | NOT_STARTED |
| 31 | Notifications Core | NOT_STARTED |
| 32 | Notification Rules | NOT_STARTED |
| 33 | Subscriptions | NOT_STARTED |
| 34 | Payments & Collection | NOT_STARTED |
| 35 | History & Audit | NOT_STARTED |
| 36 | Excel Import | NOT_STARTED |
| 37 | Reports Core | NOT_STARTED |
| 38 | Report Modules | NOT_STARTED |
| 39 | File / Excel Access Control | NOT_STARTED |
| 40 | Integration & E2E | NOT_STARTED |