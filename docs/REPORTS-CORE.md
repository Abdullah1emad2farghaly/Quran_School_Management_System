# Reports Core (Module 37)

Master Specification §66-§71 (reporting rules), §102 (reports are read models, not the source of truth), §97 (selective CQRS). Release 0.50.0.
**Status: shared reporting foundation implemented (0.50.0 period rules, locally verified by the owner; 0.51.0 scope foundation). Module 38 (endpoints, reports, exports) is deferred.**

## What this slice contains (everything here is decided by the specification)
- **Report periods (§66):** `THIS_MONTH` (first day of the current month in Africa/Cairo -> now), `LAST_MONTH` (the previous full calendar month), `ACROSS_TIME` (no date bounds; the authorized scope, never the period, limits the data), `CUSTOM` (inclusive start and end dates, internally the half-open interval `[start, end + 1 day)`).
- **Student effective start (§67):** `MAX(student join date, requested report start)`; student data before the join date is never reported. A student who joined after the period ended has an empty window.
- **Time (§71):** instants are UTC, business dates are Africa/Cairo. Egypt observes daylight saving time, so a Cairo midnight is found with the platform time-zone data, never a fixed offset: a day can be 23 hours (2026-04-24, the clocks skip midnight) or 25 hours (2026-10-29). Tested.
- **Public contract** (`src/modules/37-reports-core/public`): `ReportPeriodService` (`resolvePeriod`, `studentWindow`), the pure functions `resolveReportPeriod` / `studentReportWindow` / `startOfBusinessDay`, and the error codes `INVALID_REPORT_PERIOD`, `REPORT_CUSTOM_DATES_REQUIRED`, `REPORT_PERIOD_DATES_NOT_ALLOWED`, `INVALID_REPORT_DATE`, `REPORT_PERIOD_START_AFTER_END` (Arabic and English messages registered). Module 38 must use this contract for periods so no report re-implements them.
- It owns **no table, no HTTP endpoint and no permission** (architecture test). The period rules read no data; the scope foundation reads only assignments through public contracts.

## Technical choices I made (not business rules; tell me if you disagree)
- Strict input: dates sent with `THIS_MONTH` / `LAST_MONTH` / `ACROSS_TIME` are refused (`REPORT_PERIOD_DATES_NOT_ALLOWED`) instead of silently ignored; unknown or wrongly-cased kinds are refused.
- `THIS_MONTH` ends at the moment the report is generated (exclusive end = now).
- A `CUSTOM` period may end in the future (the specification does not forbid it; it simply contains no data yet).
- The student's join date is a business date and counts from the first instant of that day.

## Release 0.51.0: the shared reporting foundation (owner decisions of 2026-11-17)
Module 37 is the **shared reporting foundation**: it owns the rules, scope and authorization checks every report must use. It contains **no report-specific endpoint, service or migration**, owns **no table, no endpoint and no permission**, and registers nothing with the Authorization Engine. Report endpoints, the 12 report types and exports belong to Module 38, which is **NOT STARTED / DEFERRED (awaiting explicit user authorization)**.

### Reporting scope (`ReportScope`, `ReportScopeResolver`)
Principle: every role reports, and reads the underlying data, **only inside its own authorized organizational scope**; deny by default; computed on the server from the verified user id and the **ACTIVE role** (a multi-role user gets the scope of the role in use, never the union); a client-supplied id is only a request checked against the scope, never a source of authorization.

| Role | Reporting scope | Source (owning module, public contract) |
|---|---|---|
| ORGANIZATION_MANAGER | the organization(s) they administer | Module 13 `listAdministeredOrganizationIds` |
| GOVERNORATE_MANAGER / CENTER_MANAGER / VILLAGE_MANAGER | assigned governorate / center / village (target behavior) | **none exists: DENIED for now** (below) |
| SCHOOL_MANAGER | the school(s) they manage | Module 16 `listManagedSchoolIds` |
| TEACHER | the groups they currently teach, and those groups' students | Module 20 `listCurrentGroupIdsOfTeacherUser` (new, read-only) |
| PARENT | their own children only | Module 19 `listChildrenOfParentUser` |
| SUBSCRIPTION_COLLECTOR | the schools they are CURRENTLY assigned to (an ended link grants nothing) | Module 33 `listActiveSchoolIds` |
| MAIN_ADMIN | **no reporting access** until a separate decision | n/a |
| STUDENT | no reporting access in V1 | n/a |

- `ReportScopeResolver.resolve` returns the scope or `NONE` (with a reason); `authorize(requester, reportType)` also checks the availability matrix and refuses with `REPORT_NOT_ALLOWED` (403).
- `restrictToScope(scope, requestedTargets)` / `authorizeRequestedIds` are the single place where requested ids are checked: the same dimension must be a subset of the scope; a **broader** dimension (an organization for a School Manager, a school for a Teacher, a group for a Parent) is refused with `REPORT_SCOPE_FORBIDDEN` (403, the same answer whether the id exists or not); a **finer** dimension is returned as `mustBeContained` and can never widen what is read. With no request the report covers exactly the whole scope. Reports must apply the resulting ids to every query: filters, pagination, counts, aggregates and summaries (nothing may be computed over a wider set and then filtered).
- Production adapter: `PublicReportScopeSources` (reads other modules only through their public contracts; no SQL).

### Temporary restriction: geographic managers
Evidence from the code (inspected 2026-11-17): the role codes `GOVERNORATE_MANAGER`, `CENTER_MANAGER` and `VILLAGE_MANAGER` exist in Module 09, but **no module stores which governorate, center or village a user manages** (no table, service or permission links a user to a geographic area in Modules 13, 14, 15 or 16; a school only records its own governorate). Nothing was invented (no assignment table, endpoint, permission or workflow). **These three roles are denied all report access until an authoritative, owner-approved assignment source exists**; the intended scopes in the table remain the approved target. When that source exists only `PublicReportScopeSources.geographicAreasOfManager` changes.

### Temporary restriction: Main Admin
`MAIN_ADMIN` is a separate system-level role, never an Organization Manager, and has **no reporting access**; explicit reporting authorization for it is pending a separate owner decision. (The resolver does not even consult the organization source for it.)

### Report availability matrix (`REPORT_AVAILABILITY`)
Starting point: the recommended matrix of this document (role lines) verified against the approved scopes above; the doc listed roles and scopes but no per-type table, so the per-type table below is the deny-by-default reading of those lines (nothing broader than them). It is applied TOGETHER with the scope.
| Role | Report types (§68) |
|---|---|
| ORGANIZATION_MANAGER, GOVERNORATE/CENTER/VILLAGE_MANAGER (once assignable) | all 12: Student, Parent, Group, Teacher, School, Geographic, Attendance, Memorization, Revision, Evaluation, Performance, Payment |
| SCHOOL_MANAGER | all except Geographic |
| TEACHER | Student, Group, Attendance, Memorization, Revision, Evaluation, Performance |
| PARENT | Parent, Student, Attendance, Memorization, Revision, Evaluation, Performance (each child with its own context, §68) |
| SUBSCRIPTION_COLLECTOR | Payment only |
| MAIN_ADMIN, STUDENT | none |
If the owner wants a different per-type table, only `REPORT_AVAILABILITY` changes.

### Export
Approved (2026-11-17) as part of Module 38 (PDF, XLSX, CSV, same authorization and scope as the report). **Not started.** Module 37 only provides the scope rules exports must reuse.

### Open items
- Authoritative geographic-manager assignment source (needed before those roles can report).
- Explicit reporting authorization for MAIN_ADMIN.
- Module 38 (report endpoints, the 12 reports, exports): NOT STARTED / DEFERRED.

## Tests
`tests/unit/reports/report-period.test.ts` (25) and `report-boundaries.test.ts` (period rules, 0.50.0); `tests/unit/reports/report-scope.test.ts` (13: scope per role, MAIN_ADMIN/STUDENT/unknown denied, geographic managers denied while no assignment exists and scoped once one exists, empty assignment denies, active role only, availability matrix, requested-id checks, public adapter) and the extended `report-boundaries.test.ts` (no table/route/permission/report-specific code, adapter uses public contracts only, only `src/config/reports.ts` builds the resolver, Module 38 has no source files). Module 20: `tests/unit/groups/group-service.test.ts` (`listCurrentGroupIdsOfTeacherUser`).

## Module 38 (slice 1, 0.52.0)
The first report built on this foundation is the PAYMENT report; see `docs/REPORT-MODULES.md`. It uses `ReportScopeResolver.authorize`, `restrictToScope`, `authorizeRequestedIds` and `ReportPeriodService` exactly as described above and adds no rule to this module.
