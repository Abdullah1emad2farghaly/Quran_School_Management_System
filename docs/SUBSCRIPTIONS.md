# Module 33 — Subscriptions

Master Specification §58–§61 (subscriptions, Oldest-Unpaid Rule, payments, roles) and the approved Module 33 decisions of 2026-11-07/08 (recorded as an amendment in the Master Specification, §58). Implemented in release 0.43.0.

## What a subscription is
**Student + Month + Status**, and nothing else. Statuses: `PAID`, `UNPAID`, `WAIVED`. There is no amount, fee, proration, partial month or enrollment-date charge anywhere (the migration has no money column and a boundary test fails if one appears). A student who enrolls mid-month does not change the model.

The month is `YYYY-MM` in **Africa/Cairo**. It is NEVER chosen by the caller: it is the current month of the server clock, converted to Cairo (so an instant that is 00:30 on the 1st in Cairo belongs to the new month even though it is still the previous day in UTC; both Egyptian UTC offsets are covered by tests).

## Monthly creation (manual, bulk, per school)
`POST /api/v1/subscriptions/schools/:schoolId/monthly`, by the School Manager of the school or a Subscription Collector currently linked to it.
1. The month is the current Africa/Cairo month.
2. If the school already has that month → `409 SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH` ("the subscriptions for the current month have already been created"); nothing is created.
3. Otherwise one **UNPAID** subscription is created for every **ACTIVE** student of the school (INACTIVE and ARCHIVED students are excluded) in ONE transaction, together with one `subscription_batches` row and one `SubscriptionsCreated` outbox event.
4. A school with no ACTIVE student → `422 SUBSCRIPTION_NO_ACTIVE_STUDENTS` (the month is not marked as created).

**Concurrency.** `subscription_batches` has `UNIQUE (school_id, month)` and `subscriptions` has `UNIQUE (student_id, month)`. The batch row is inserted first, so a second simultaneous run waits for the first transaction and then fails with `SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH`; of N simultaneous runs exactly one wins and nothing is duplicated (real-MariaDB tests with parallel connections). A failure while inserting rolls back the batch too, so the run can be retried.

## Individual creation (a student who joined later)
`POST /api/v1/subscriptions/schools/:schoolId/students/:studentId`. Creates ONE UNPAID subscription for the current month without touching the others; refuses a second subscription for the same Student + Month (`409 SUBSCRIPTION_ALREADY_EXISTS`, also under concurrency through the unique index); the student must be ACTIVE and belong to the school.
**Interpretation (flagged):** the approved text allows an individual subscription "after bulk creation". It is therefore refused with `422 SUBSCRIPTIONS_NOT_CREATED_FOR_MONTH` until the bulk creation of that school and month exists. Otherwise an early individual row would make the bulk operation believe the month "already exists" and leave the other students without a subscription.

## Waiving
`POST /api/v1/subscriptions/:id/waive` (School Manager of the subscription's school ONLY; a Collector cannot waive, §61). UNPAID → WAIVED, records who and when, publishes `SubscriptionWaived`. A PAID or already WAIVED subscription is `422 SUBSCRIPTION_NOT_UNPAID`. PAID and WAIVED are final in V1. A waived month no longer blocks newer months.

## The Oldest-Unpaid Rule (§59) and `markPaid`
> A newer month cannot be paid until every older month is PAID or WAIVED.

Implemented exactly, in `SubscriptionService.markPaid(subscriptionId, actorId, tx?)`: the student's subscriptions are locked (`SELECT … ORDER BY month FOR UPDATE`, one statement), and the payment is refused with `OLDER_UNPAID_SUBSCRIPTIONS_EXIST` while ANY older month of the SAME student is neither PAID nor WAIVED. A newer month never blocks an older one; a month the student has no subscription for does not count. Already PAID → `SUBSCRIPTION_ALREADY_PAID` (one successful payment per subscription, §60); WAIVED → `SUBSCRIPTION_NOT_UNPAID`. On success: status PAID, `paid_at`/`paid_by`, outbox event `SubscriptionPaid`, all in one transaction.

`markPaid` is the **application contract Module 34 (Payments & Collection) will call** when a payment is recorded; pass its transaction as `tx` to make "payment recorded" and "subscription PAID" one unit of work (`SubscriptionPayments = Pick<SubscriptionService, 'markPaid'>`). Module 33 collects nothing and has **no HTTP endpoint that marks a subscription PAID** (tested: no such route, and no permission whose code mentions paying). A payment reversal (§60) is a Module 34 concern and is not part of this module.
Concurrency is tested on real MariaDB: paying October and September at once never leaves October PAID while September is UNPAID; paying and waiving the same subscription, or paying it twice, lets exactly one operation win.

## Subscription Collectors (approved Option A)
`User → SUBSCRIPTION_COLLECTOR role → collector_school_links`. No other authentication mechanism, no other personal data.
- `POST /subscriptions/schools/:schoolId/collectors` (School Manager of the school): the Teacher conventions of Module 18. Name: exactly three parts (stored on the account, `users.full_name`); phone normalized to E.164.
  - **New phone:** a new account is created with the **initial password = last four digits of the normalized phone** and the mandatory first-login password change (Module 08 flag, enforced by Module 10, like Parents and Teachers); the role is assigned; the school link is created.
  - **Existing account:** reused without a duplicate only when its stored three-part name equals the submitted one (`COLLECTOR_IDENTITY_CONFLICT` otherwise); its password and first-login flag are never touched; the role is added only if missing. Never reused across organizations (`COLLECTOR_ORGANIZATION_CONFLICT`: other Collector links, a Parent record or a Teacher record of another organization), never when inactive.
- A Collector may be linked to several schools of the **same organization**. History is kept (`collector_school_links` rows are never deleted); at most one ACTIVE link per account and school.
- `DELETE /subscriptions/schools/:schoolId/collectors/:userId` ends the link to that school only; access ends at once (only ACTIVE links grant access; history grants nothing); the account, the role and other links remain.
- `GET /subscriptions/schools/:schoolId/collectors` lists current Collectors; `GET /subscriptions/collectors/me` returns the caller's own profile and schools.

## Authorization matrix (Authorization Engine, deny by default)
| Action | Permission | Roles | Scope |
|---|---|---|---|
| Bulk create / individual create / list | `subscriptions.monthly.create` / `subscriptions.subscription.create` / `subscriptions.subscription.list` | SCHOOL_MANAGER, SUBSCRIPTION_COLLECTOR | the school; Collector only with an ACTIVE link |
| Read one | `subscriptions.subscription.read` | SCHOOL_MANAGER, SUBSCRIPTION_COLLECTOR | the subscription's school (loaded server-side) |
| Waive | `subscriptions.subscription.waive` | SCHOOL_MANAGER only | the subscription's school |
| Assign / list / remove Collectors | `subscriptions.collector.assign` / `.list` / `.remove` | SCHOOL_MANAGER only | the school (Module 16 `SCHOOL` scope) |
| Own Collector profile | `subscriptions.collector.read-own` | SUBSCRIPTION_COLLECTOR | the caller's own account |
ORGANIZATION_MANAGER, MAIN_ADMIN, PARENT and TEACHER have no subscription permission. Module 33 registers two scope target types (`SUBSCRIPTION_SCHOOL`, `SUBSCRIPTION`) whose resolvers answer true only on positive proof (manager link or ACTIVE Collector link to that exact school).

## Notifications (Modules 31 and 32; no second notification system)
Module 33 only publishes events (identifiers only). Module 32 consumes them and creates notifications ONLY through Module 31.
| Rule | Trigger | Recipients | Once-only |
|---|---|---|---|
| A. Monthly creation | `SubscriptionsCreated` (successful bulk creation) | the school's CURRENT Collectors | per event |
| B. Payment recorded | `SubscriptionPaid` | the student's Parent ONLY | per subscription |
| C. First unpaid reminder | 3 calendar days after creation (00:00 Africa/Cairo of creation date + 3); status re-checked, sent only if still UNPAID | Parent ONLY | per subscription, ever |
| D. End-of-month reminder | once per school and month at the start of the final five calendar days (30-day month: 26th; 31-day: 27th; February by real length, leap years included) | each unpaid student's Parent (own child), the school's CURRENT Collectors and School Manager (one message listing the unpaid students) | per school and month |
Rules C and D use the existing `notification_reminders` scheduler (kinds `SUBSCRIPTION_UNPAID_3D` per subscription and `SUBSCRIPTION_UNPAID_MONTH_END` per bulk batch; migration `20261108110000` widens the table's kind CHECK, additive). Scheduling is an upsert on (kind, subject), so a redelivered event creates nothing twice; every notification also has a once-only key per recipient. PAID and WAIVED subscriptions are excluded; with nothing unpaid nothing is sent. A delayed scheduler sends a due reminder at the next pass only while the conditions still hold.
Interpretations (flagged, easy to change): reminders are due at the START of their calendar day (`SUBSCRIPTION_REMINDER_MINUTE_OF_DAY = 0` in `reminder-rules.ts`); a bulk run made inside the final-five-days window sends rule D at the next pass; if the month is already over when the reminder would fire, rule D is suppressed; the unpaid student names in rule D are limited to the first 20 followed by "(+N)".

## Database (migrations `20261108100000-create-subscriptions`, `20261108110000-notification-reminders-subscription-kinds`)
- `subscription_batches(id, school_id, organization_id, month CHAR(7), record_count, created_by, created_at, updated_at)`; UNIQUE (school_id, month); CHECK month format.
- `subscriptions(id, student_id, school_id, organization_id, month CHAR(7), status, batch_id → subscription_batches RESTRICT, created_by, paid_at, paid_by, waived_at, waived_by, version, created_at, updated_at)`; UNIQUE (student_id, month); index (school_id, month, status); CHECKs: status in (PAID, UNPAID, WAIVED), month format, and the paid/waived audit columns consistent with the status.
- `collector_school_links(id, user_id, organization_id, school_id, linked_at, linked_by, unlinked_at, unlinked_by, active, version, …)`; UNIQUE (user_id, school_id, active) with `active` 1 while current and NULL once ended (history); NULL-safe CHECK. No foreign keys to other modules' tables.

## Events (outbox)
`SubscriptionsCreated {batchId, schoolId, organizationId, month, count, actorId}`, `SubscriptionCreated`, `SubscriptionPaid`, `SubscriptionWaived {subscriptionId, studentId, schoolId, organizationId, month, actorId}`, `CollectorSchoolLinked` / `CollectorSchoolLinkRemoved {linkId, userId, schoolId, organizationId, actorId}`. No names, phones or passwords.

## Public contract (`src/modules/33-subscriptions/public`)
`SubscriptionService` (`SubscriptionLookup` read-only for other modules, `SubscriptionPayments.markPaid` for Module 34), `CollectorService` (`CollectorDirectory` read-only), permissions and the two scope target types, error messages, events, repositories (SQL and in-memory), `createSubscriptionRouter`, `subscriptionApiDoc`. Students are read only through Module 19's public `StudentService` (adapter `PublicStudentRoster`); schools through Module 16's `SchoolLookup`.

## Changes outside Module 33 (smallest compliant additions)
- **Module 32:** new rule handlers (`subscription-handlers.ts`), two reminder kinds and their processor cases, six templates (ar/en), the `SubscriptionDirectory` port and `PublicSubscriptionDirectory` adapter, dedup keys, pure calendar functions in `reminder-rules.ts`, and `RuleDeps.subscriptions`. Module 32 now depends on Module 33's public events (Module 33 never imports Module 32).
- `src/config/subscriptions.ts` (wiring), `src/app/routes/index.ts` (mount `/subscriptions`), `src/app/openapi/api-documents.ts`, `src/app/bootstrap/register-error-messages.ts`, `src/config/notification-rules.ts`.
- Tests: `tests/unit/notification-rules/rules-boundaries.test.ts` (the "lower-numbered modules only" rule now names Module 33 as the one allowed producer and checks that Module 33 never imports Module 32), `tests/helpers/notification-rules-harness.ts` (a `FakeSubscriptions` port), and the three API-documentation gates (`error-kinds`, `request-validation`, new `conformance/subscriptions`).

## Limitations / not in this module
- Parents cannot list subscriptions over HTTP (not approved; they are notified). Reports and payment collection belong to later modules.
- No payment reversal (Module 34), no un-waive, no waive reason (not specified).
- One School Manager per school is notified by rule D (the schema allows one active manager).
