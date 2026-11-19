# Report Modules (Module 38)

Status: slice 1 (PAYMENT report) implemented in 0.52.0, UNVERIFIED until the owner runs the verification commands (see `PROJECT-CHANGELOG.md`). Master Specification §66-§70, §102.

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

## Contracts added to completed modules (read-only, additive)
- Module 33: `SubscriptionService.countStatusesForReport({ schoolIds, fromMonth?, toMonth? })`.
- Module 34: `PaymentService.countPaymentsForReport({ schoolIds, fromMonth?, toMonth? })`.
- Module 16: `SchoolService.listSchoolIdsOfOrganizations(organizationIds)`.

## Remaining slices (not built)
Attendance (next), Memorization, Revision, Evaluation, Student, Parent, Group, Teacher, School, Performance, Geographic. PDF export for all reports. Student reports must apply the student effective start (§67) and show the group at the time (§65); the data modules need the same kind of additive read contracts as above.

## Still open
- PDF: which library (none is installed); Arabic PDF needs right-to-left shaping.
- Geographic managers: no area assignment exists (their reports are denied).
- MAIN_ADMIN report access (denied).
