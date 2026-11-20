# Report Modules (Module 38)

Status: slice 1a (PAYMENT report, 0.52.0): the owner reported all tests passing on 2026-11-19. Slice 1b (ATTENDANCE report, 0.53.0): implemented, UNVERIFIED until the owner runs the verification commands (see `PROJECT-CHANGELOG.md`). Master Specification §66-§70, §102.

Module 38 is a read model: it owns no table, no migration and no permission. Every report is computed inside the requester's reporting scope (Module 37, `docs/REPORTS-CORE.md`) from the owning modules' public contracts.

## Owner decisions that shape this module
- 2026-11-17: the recommended availability matrix of `REPORTS-CORE.md`; exports (PDF, XLSX, CSV) approved in principle.
- 2026-11-18: authorized to build; report contents are **data-only** (counts and lists from existing records; no invented scoring, grades or rankings); exports **CSV + XLSX + PDF**; built in **slices**.

## Every report follows the same chain
1. `ReportScopeResolver.authorize(requester, type)`: the ACTIVE role may run this report type and has a current, non-empty scope, else 403 `REPORT_NOT_ALLOWED`.
2. The period is resolved by Module 37 (`THIS_MONTH`, `LAST_MONTH`, `ACROSS_TIME`, `CUSTOM`), else 400 (`INVALID_REPORT_PERIOD` and friends).
3. Requested filters are checked with `restrictToScope` / `authorizeRequestedIds`: 403 `REPORT_SCOPE_FORBIDDEN` for anything outside the scope (existence is never revealed).
4. Only then is data read. The requester comes from the verified session (`req.auth.userId` and `req.auth.activeRole`), never from the request.

A CSV or Excel file is built from the same report object as the JSON response.

## Slice 1: PAYMENT report
`GET /api/v1/reports/payment` (JSON), `/payment/csv`, `/payment/xlsx`.

| Query | Meaning |
|---|---|
| `period` | required: `THIS_MONTH`, `LAST_MONTH`, `ACROSS_TIME`, `CUSTOM` |
| `startDate`, `endDate` | `CUSTOM` only, `YYYY-MM-DD` (Africa/Cairo) |
| `schoolId` | optional, narrows to one school inside the scope |

Rows, one per school and billing month (sorted by school name, then month), all counts:
`paid`, `unpaid`, `waived` (subscription statuses now, Module 33), `subscriptions` (their sum), `paymentsRecorded` (successful payments that stand, Module 34), `paymentsReversed` (reversed payments, kept as history). Plus `totals`. No amount: the system stores none (§60).

Who: ORGANIZATION_MANAGER (schools of their organizations), SCHOOL_MANAGER (schools they actively manage), SUBSCRIPTION_COLLECTOR (schools they are currently linked to). Everyone else is refused.

**Interpretation to confirm:** a billing month is included when it lies inside the period (the months of the period's first and last business dates, inclusive). `ACROSS_TIME` has no bounds. The subscription status counts are the CURRENT statuses of those subscriptions.

CSV: UTF-8 with a byte order mark (Excel reads Arabic), CRLF, headers in the request language (Arabic by default), text that starts with `= + - @` is neutralized against spreadsheet formula injection. Excel: one worksheet, bold header, Arabic sheets right to left, text always written as text.

## Slice 1b: ATTENDANCE report
`GET /api/v1/reports/attendance` (JSON), `/attendance/csv`, `/attendance/xlsx`. Query: `period` (required), `startDate`/`endDate` (CUSTOM only), and the optional narrowing filters `schoolId`, `groupId`, `studentId`.

Rows, one per school, group and subject (sorted by school, group, type, name): `subjectType` (STUDENT or TEACHER), `subjectId`, `subjectName`, `schoolId`/`schoolName`, `groupId`/`groupName`, `present`, `absent`, `total`. Plus `totals` for students and for teachers separately. Counts only: no rate, grade or ranking (owner decision: data-only).

- **Group at the time (§65):** the group of a row is the group stored on the attendance record. A student who changed groups has one row per group.
- **Student effective start (§67):** a student's rows start on the later of the student's join date and the period start; records before the join date are never reported, even with `ACROSS_TIME`; a student who joined after the period ended has no rows. The join date comes from Module 19 (`listReportFacts`); the report re-reads only the students whose first record precedes their start.
- **Who:** ORGANIZATION_MANAGER and SCHOOL_MANAGER (students and teachers of their schools), TEACHER (the students of the groups they currently teach), PARENT (their own children). Everyone else is refused.
- **Filters:** a requested school, group or student must lie inside the scope: an Organization or School Manager's group or student is checked through Modules 20 and 19 (their school must be in the scope); a Teacher's student must currently be in one of the groups they teach; a broader level than the role's own (a school for a Teacher, a school or group for a Parent) is refused. All are checked BEFORE any attendance is read.
- **Interpretations to confirm:** (1) teacher attendance rows are shown to managers only (a Teacher or Parent never sees a teacher's attendance); (2) a Teacher sees the whole history of the groups they currently teach, even before they became their teacher; (3) the report is not paginated (rows = schools x groups x subjects in scope).

## Contracts added to completed modules (read-only, additive)
- Module 33: `SubscriptionService.countStatusesForReport({ schoolIds, fromMonth?, toMonth? })`.
- Module 34: `PaymentService.countPaymentsForReport({ schoolIds, fromMonth?, toMonth? })`.
- Module 16: `SchoolService.listSchoolIdsOfOrganizations(organizationIds)`.
- Module 26: `AttendanceService.summarizeForReport(query)` (+ `AttendanceRepository.summarizeForReport`): counts per school, group, subject and status with the earliest date, filtered by schools, groups, students, subject types and an inclusive date range.
- Module 19: `StudentService.listReportFacts(studentIds)`: name and join date.
- Module 20: `GroupService.listNamesByIds(groupIds)`.

## Remaining slices (not built)
Memorization (next), Revision, Evaluation, Student, Parent, Group, Teacher, School, Performance, Geographic. PDF export for all reports. The Student, Parent and Group reports reuse the student effective start (§67) and the group at the time (§65) as in the ATTENDANCE report; the data modules need the same kind of additive read contracts as above.

## Still open
- PDF: which library (none is installed); Arabic PDF needs right-to-left shaping.
- Geographic managers: no area assignment exists (their reports are denied).
- MAIN_ADMIN report access (denied).
