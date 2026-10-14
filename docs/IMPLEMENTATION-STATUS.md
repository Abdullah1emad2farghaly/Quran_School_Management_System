# Implementation Status

Statuses: NOT_STARTED · IN_PROGRESS · IMPLEMENTED · TESTED · COMPLETED

## Bootstrap (§94 / §116)

Foundation phase (Modules 00–07) is complete: typecheck, build, unit/integration tests and the real-database tests (`npm run test:db`) pass. Modules 08–10 are completed, Module 11 is implemented (real-database verification pending), Modules 12–13 are complete, Module 14 is implemented and Module 15 (with the Module 13 country addition) is implemented (real-database verification pending for 14 and 15); Module 16 is implemented with its REST API (with isolated open blockers listed in `docs/SCHOOLS.md`); Modules 17–40 have not been started and only have skeleton folders. Permanent rule: every module ships with its own REST endpoints, tests and API documentation.

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
| 13 | Organization Core | IMPLEMENTED, extended: many organizations (required country and own address, system-wide unique name, locked code sequence), organization administrator links (organization scope of MAIN_ADMIN), country immutable; unit tests pass, real-database verification of the new migrations pending; the registration endpoints live in Module 16 |
| 14 | Geography | IMPLEMENTED (global reference data: countries, governorates, centers/cities, villages with real FKs ON DELETE RESTRICT; read-only `GeographyLookup` with `validateHierarchy`; idempotent seed of Egypt + 27 governorates only; unit tests pass; `npm run db:migrate` and `npm run test:db` pending on the user machine; no endpoints, permissions or events by design) |
| 15 | Unified Address | IMPLEMENTED, extended: Parent Address uses the country of the parent's organization (`organizationId`); `validateOrganizationAddress` validates an organization's own address; no tables, endpoints or permissions by design; unit tests pass |
| 16 | Schools | IMPLEMENTED with REST API, extended: organization registration (`POST /organizations`) with applicant account and organization-scoped MAIN_ADMIN, organization-scoped school operations and reads, school country always the organization's country (service and composite foreign keys), each school keeps its own address; `POST /schools` for Main Schools (authenticated, no longer public); public Sub-School submission, approval/rejection, lifecycle, GPS, manager endpoints. Unit tests pass; API and real-database tests written, pending on the project machine. Open decisions in `docs/SCHOOLS.md` |
| 17 | Parents | NOT_STARTED |
| 18 | Teachers | NOT_STARTED |
| 19 | Students | NOT_STARTED |
| 20 | Groups | NOT_STARTED |
| 21 | Quran Structure | NOT_STARTED |
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
