# Module 33 — Subscriptions

Master Specification §58–§61 (subscriptions, Oldest-Unpaid Rule, payments, roles) and the approved Module 33 decisions of 2026-11-07/08 (recorded as an amendment in the Master Specification, §58). Implemented in release 0.43.0; extended by the approved backend enhancements of release 0.43.1 (group-based statistics; its `mark-paid` / `mark-unpaid` endpoints were REMOVED in release 0.51.0, see "Payment status ownership").

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

## Payment status ownership (release 0.51.0) and the Oldest-Unpaid Rule (§59)
**Module 33 stores and exposes the status; Module 34 exclusively owns PAID ↔ UNPAID** (owner decision 2026-11-17). Module 33 keeps PAID / UNPAID / WAIVED in the database, the enums and the API responses, creates and manages subscriptions, enforces eligibility and **owns WAIVED** (not a payment transaction). `SubscriptionService` has no way to pay, un-pay or reverse, and there are **no HTTP endpoints** for it (the former `POST /subscriptions/:id/mark-paid` and `/mark-unpaid`, their permissions `subscriptions.subscription.mark-paid` / `mark-unpaid`, the `SubscriptionService.markPaid` / `markUnpaid` / `reversePaid` methods and the `SUBSCRIPTION_MONTH_NOT_CURRENT` error were **removed**; no backward-compatibility copy was kept).

**Controlled internal contract:** `SubscriptionPaymentTransitions` (`application/services/subscription-payment-transitions.ts`, exported as `SubscriptionPayments`) with exactly two methods, `applyPaymentRecorded` (UNPAID → PAID) and `applyPaymentReversed` (PAID → UNPAID). It is composed in `src/config/subscriptions.ts` and injected only into Module 34's `PaymentService` (an architecture test fails if anything else imports it). It is not part of `SubscriptionService` / `SubscriptionLookup`, so no other module can reach it by accident. Guards: a **transaction is mandatory** (the payment row and the status change commit or roll back together) and a **Module 34 payment id (UUID) is mandatory** (`SUBSCRIPTION_TRANSITION_NOT_ALLOWED` otherwise); the student's subscriptions are locked (`SELECT … ORDER BY month FOR UPDATE`), so concurrent transitions are serialized.

Rules enforced there:
- **Recording (UNPAID → PAID):** refused with `OLDER_UNPAID_SUBSCRIPTIONS_EXIST` while ANY older month of the student is neither PAID nor WAIVED (a month the student has no subscription for does not count; a newer month never blocks an older one); already PAID → `409 SUBSCRIPTION_ALREADY_PAID` (no duplicate payment); WAIVED → `SUBSCRIPTION_NOT_UNPAID`. Publishes `SubscriptionPaid` (a state event) in the same transaction.
- **Reversal (PAID → UNPAID):** no current-month restriction (the reversal workflow, reason and audit are Module 34's), but refused with `NEWER_PAID_SUBSCRIPTIONS_EXIST` while a NEWER month of the student is PAID, so an older month never becomes UNPAID behind a PAID newer one (§59 after a reversal). Already UNPAID → `SUBSCRIPTION_ALREADY_UNPAID`; WAIVED → `SUBSCRIPTION_NOT_PAID`. `paid_at` / `paid_by` are cleared (the database CHECK requires it). Publishes `SubscriptionMarkedUnpaid`.

Concurrency is tested on real MariaDB (`tests/db/subscriptions.test.ts`, `payments.test.ts`): paying October and September at once never leaves October PAID while September is UNPAID; paying and waiving the same subscription, or paying it twice, lets exactly one operation win; reversing an older month while the next month is paid is serialized and §59 holds in either order.

**Legacy data (flagged, not changed):** before 0.51.0 a subscription could be marked PAID through Module 33 without a payment row (no backfill was made: it would invent actors and times) and be un-paid by the removed correction while its payment row stayed SUCCESSFUL. Module 34 still closes such a stale SUCCESSFUL payment when its subscription is already UNPAID (`SUBSCRIPTION_ALREADY_UNPAID` is tolerated on reversal only). A PAID subscription without a payment row can no longer be reversed through Module 34 (no payment to reverse); whether to backfill is a business decision.


## Group-based subscription statistics (approved enhancement, 0.43.1)
Read-only; both endpoints require `subscriptions.group.list` (School Manager of the school, or a Collector currently linked to it) and are paginated with the project's rules (default 20, maximum 100). `filter[month]=YYYY-MM` selects the month (default: the current Africa/Cairo month; a malformed month is `400 INVALID_SUBSCRIPTION_MONTH`).

- `GET /api/v1/subscriptions/schools/:schoolId/groups` — the school's **existing ACTIVE educational groups** (Module 20, read through its public `GroupService`; nothing is copied or stored) sorted by name (`sort=-name` reverses), each with `groupId`, `groupName`, `month`, `subscriptionsCreated`, `paidStudents`, `unpaidStudents`, `waivedStudents`, `withoutSubscription`, `totalStudents`.
- `GET /api/v1/subscriptions/schools/:schoolId/groups/:groupId/students` — **every** regular/active student of the group (each once), sorted by name, with `studentId`, `studentName`, `month`, `subscriptionId`, `status` (`PAID` / `UNPAID` / `WAIVED` / `null`) and `hasSubscription`. WAIVED students are included. The caller retrieves the complete list by walking `page` up to the last page. A group that does not exist, is not ACTIVE, or belongs to another school or organization is the same `404 SUBSCRIPTION_GROUP_NOT_FOUND` (existence is never revealed); the school in the path is authorized first.

**Counting rules (as implemented):**
1. "Regular/active students of a group" = the students **currently assigned** to the ACTIVE group (Module 20's existing relationship) whose Student status is **ACTIVE**. Module 20 allows a student in **at most one group at a time** (unique active assignment), ARCHIVED students are unassigned, INACTIVE students keep the assignment but are not regular/active; the group's assignment *history* stays in Module 20 and is not used. A student is counted once per group; a student moved to another group is counted only there.
2. `paidStudents` / `unpaidStudents` count students whose **real subscription record for the requested month** is PAID / UNPAID. WAIVED students are in `totalStudents` (and `waivedStudents`) and in **neither** paid nor unpaid.
3. **A missing subscription record is never treated as UNPAID.** A regular/active student with no record for the month (for example a student who joined after the bulk creation and has no individual subscription yet, or any student when the month's bulk creation was never run) is in `totalStudents` and `withoutSubscription` only; in the student list their `status` is `null`, `subscriptionId` is `null`, `hasSubscription` is `false`. `subscriptionsCreated` tells whether the bulk creation of that school and month exists. Invariant: `totalStudents = paidStudents + unpaidStudents + waivedStudents + withoutSubscription`.
4. Statistics are for the requested month only; a student whose subscription was created earlier but who is no longer regular/active is not counted.
5. Each read runs in one transaction (one consistent snapshot).
Interpretation (flagged): "existing groups" = ACTIVE groups; archived groups hold no students. Students not in any group do not appear (the display is organized by groups).

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
| Group summaries / group students | `subscriptions.group.list` | SCHOOL_MANAGER, SUBSCRIPTION_COLLECTOR | the school in the path; the group must belong to it |
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
`SubscriptionsCreated {batchId, schoolId, organizationId, month, count, actorId}`, `SubscriptionCreated`, `SubscriptionPaid`, `SubscriptionWaived`, `SubscriptionMarkedUnpaid` (new in 0.43.1: a PAID subscription of the current month was changed back to UNPAID; history only, nobody consumes it) {subscriptionId, studentId, schoolId, organizationId, month, actorId}, `CollectorSchoolLinked` / `CollectorSchoolLinkRemoved {linkId, userId, schoolId, organizationId, actorId}`. No names, phones or passwords.

## Public contract (`src/modules/33-subscriptions/public`)
`SubscriptionService` (`SubscriptionLookup` read-only for other modules), `SubscriptionPaymentTransitions` (`SubscriptionPayments`: the controlled PAID ↔ UNPAID contract, Module 34 only), `SubscriptionGroupService` (read-only group statistics; reads Module 20 only through the `SchoolGroupRoster` port / `PublicSchoolGroupRoster` adapter over the public `GroupService`), `CollectorService` (`CollectorDirectory` read-only), permissions and the two scope target types, error messages, events, repositories (SQL and in-memory), `createSubscriptionRouter`, `subscriptionApiDoc`. Students are read only through Module 19's public `StudentService` (adapter `PublicStudentRoster`); schools through Module 16's `SchoolLookup`.

## Changes outside Module 33 (smallest compliant additions)
- **Module 32:** new rule handlers (`subscription-handlers.ts`), two reminder kinds and their processor cases, six templates (ar/en), the `SubscriptionDirectory` port and `PublicSubscriptionDirectory` adapter, dedup keys, pure calendar functions in `reminder-rules.ts`, and `RuleDeps.subscriptions`. Module 32 now depends on Module 33's public events (Module 33 never imports Module 32).
- `src/config/subscriptions.ts` (wiring), `src/app/routes/index.ts` (mount `/subscriptions`), `src/app/openapi/api-documents.ts`, `src/app/bootstrap/register-error-messages.ts`, `src/config/notification-rules.ts`.
- Tests: `tests/unit/notification-rules/rules-boundaries.test.ts` (the "lower-numbered modules only" rule now names Module 33 as the one allowed producer and checks that Module 33 never imports Module 32), `tests/helpers/notification-rules-harness.ts` (a `FakeSubscriptions` port), and the three API-documentation gates (`error-kinds`, `request-validation`, new `conformance/subscriptions`).

## Limitations / not in this module
- Parents cannot list subscriptions over HTTP (not approved; they are notified). Reports and payment collection belong to later modules.
- Payments, reversals and every PAID ↔ UNPAID change belong to Module 34 (this module has no such operation). No un-waive and no waive reason (not specified).
- The group reads use the group assignments as they are NOW (not their history); they load the school's groups and members per request (adequate for school-sized data).
- One School Manager per school is notified by rule D (the schema allows one active manager).
