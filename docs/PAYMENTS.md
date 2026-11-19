# Payments & Collection (Module 34)

Master Specification §60 (Payments) and §61 (Collection). Implemented in release 0.49.0. **Status: APPROVED by the owner on 2026-11-17 (payment ownership and the V1 rules); updated in release 0.51.0.** Reversal is allowed for the School Manager AND the Subscription Collector of the payment's school (approved 2026-11-17).

## What it does
- Records the **cash payment** of ONE subscription. A payment belongs to **Student + School + Subscription**. **CASH ONLY** (closed list of one, a database CHECK, and the API refuses any other `method`).
- **No amount** is stored or accepted anywhere (the amount is determined outside the system, §58). There is no amount column.
- **One SUCCESSFUL payment per subscription** (§60): Module 33 refuses an already PAID subscription, and a database unique index (`subscription_id` + `active`) is the final guard under concurrency.
- A payment is **never hard-deleted** (§60): there is no delete route, no delete method on the repository and no DELETE statement (architecture test). A reversed payment stays as history.
- **Reversal** needs a **reason** (1 to 500 characters after trimming), the **actor** and the **time**, all stored on the payment, and is **audited** (`PaymentReversed`, Module 35).
- **Module 34 owns the entire payment lifecycle** (record, validate, cancel/reverse, audit history, payment events). Recording and reversing change the subscription **only through Module 33's controlled internal contract** `SubscriptionPaymentTransitions` (`applyPaymentRecorded` / `applyPaymentReversed`, each with the payment id and the payment's transaction), in the SAME transaction (so the Oldest-Unpaid Rule §59 is always enforced and a refused step leaves nothing behind).
- **Collection** (§61): the School Manager and the school's Subscription Collector (assigned-school scope; an ended assignment grants nothing). The Collector cannot waive (Module 33 keeps waiving School-Manager-only) but may reverse a payment of an assigned school.

## Roles and permissions (Authorization Engine, deny by default)
| Operation | Permission | Who | Status |
|---|---|---|---|
| Record a payment | `payments.payment.record` | SCHOOL_MANAGER of the school, SUBSCRIPTION_COLLECTOR currently assigned to the school | APPROVED (§61) |
| List / read payments | `payments.payment.list` / `.read` | same | APPROVED (§61) |
| Reverse a payment | `payments.payment.reverse` | SCHOOL_MANAGER of the payment's school, SUBSCRIPTION_COLLECTOR currently assigned to it | **APPROVED 2026-11-17** (both roles; no other role) |

MAIN_ADMIN, ORGANIZATION_MANAGER, PARENT, TEACHER and STUDENT have no payment permission (including reversal). The scope is always loaded from the SERVER (the subscription's / payment's school); an unknown id answers `403`, never revealing existence.

## API (all under `/api/v1/payments`; see `docs/API-DOCUMENTATION.md`, OpenAPI at `/api-docs`)
| Method and path | Purpose |
|---|---|
| `POST /subscriptions/:subscriptionId` | record the cash payment (body optional; `method`, if sent, must be `CASH`) → 201 |
| `GET /schools/:schoolId` | list the school's payments, newest first (filters `month`, `status`, `studentId`, `subscriptionId`; `sort=recordedAt`/`-recordedAt`; standard pagination) |
| `GET /:id` | read one payment |
| `POST /:id/reverse` | reverse with `{ "reason": "..." }` → 200 |

Errors (Arabic by default, English by locale): `PAYMENT_NOT_FOUND`, `PAYMENT_ALREADY_RECORDED` (409), `PAYMENT_ALREADY_REVERSED` (409), `PAYMENT_REVERSAL_REASON_REQUIRED` / `_TOO_LONG` (400), `PAYMENT_METHOD_NOT_ALLOWED` (400), `INVALID_PAYMENT_MONTH` (400), `PAYMENT_CONCURRENT_MODIFICATION` (409); plus Module 33's `SUBSCRIPTION_ALREADY_PAID` (409), `SUBSCRIPTION_NOT_UNPAID`, `OLDER_UNPAID_SUBSCRIPTIONS_EXIST`, `SUBSCRIPTION_NOT_PAID`, `NEWER_PAID_SUBSCRIPTIONS_EXIST` (422).

## Database (migration `20261117100000-create-payments`)
Table `payments` (no foreign keys to other modules' tables, §14): `id`, `subscription_id`, `student_id`, `school_id`, `organization_id`, `month` (`YYYY-MM` Africa/Cairo, copied from the subscription), `method`, `status` (`SUCCESSFUL` | `REVERSED`), `active` (1 while SUCCESSFUL, NULL once reversed), `recorded_by`, `recorded_at`, `reversed_by`, `reversed_at`, `reversal_reason`, `version` (optimistic lock), `created_at`, `updated_at`.
- `UNIQUE (subscription_id, active)`: one SUCCESSFUL payment per subscription, any number of reversed ones.
- CHECKs: month format; `method` is `CASH` and `status` is one of the two values (compared as BINARY so `'cash '` / `'Cash'` cannot pass under MariaDB's case-insensitive, space-padded collation); reversal columns consistent with the status (a REVERSED row must have actor, time and a non-blank reason; a SUCCESSFUL row must have none).
- Indexes: `(school_id, month, status)`, `(school_id, recorded_at)`, `(student_id, month)`.

## Contract with Module 33 (release 0.51.0: the single, controlled way a status changes)
Module 33 has no public operation that pays, un-pays or reverses (its `mark-paid` / `mark-unpaid` endpoints and the `markPaid` / `markUnpaid` / `reversePaid` methods were removed). `PaymentService` receives `SubscriptionPayments` (= `SubscriptionPaymentTransitions`): `applyPaymentRecorded({ subscriptionId, paymentId, actorId }, tx)` and `applyPaymentReversed(...)`. The payment id is generated first and the payment row is written in the same transaction, so every status change is attributable to one payment; a call without a transaction or a payment id is refused (`SUBSCRIPTION_TRANSITION_NOT_ALLOWED`). The Oldest-Unpaid Rule §59 is enforced there for recording (`OLDER_UNPAID_SUBSCRIPTIONS_EXIST`) and for reversal (`NEWER_PAID_SUBSCRIPTIONS_EXIST`: an older month is never reversed behind a PAID newer one). Duplicate payments are prevented twice: `SUBSCRIPTION_ALREADY_PAID` and the unique index.

## Events and notifications
- `PaymentRecorded` and `PaymentReversed` (Module 34, outbox, same transaction). Identifiers, month, method and (reversal) previous status / status / reason only: no names, phones or amounts. Both are in the audit catalog (Module 35, action `PAYMENT`, module `payments`; the catalog now has 65 events).
- **Notification (release 0.51.0):** the Parent (only) is told that a payment was recorded, **triggered by Module 34's `PaymentRecorded`** (Module 32 consumes it; once per payment, so a subscription paid again after a reversal is a new payment). The Subscription Collector is never notified of an individual payment, and Module 34 creates no notification itself. `SubscriptionPaid` is now only a state event (it still cancels the pending 3-day reminder). The specification (§63) requires no notification for a reversal.

## Decisions (all resolved by the owner on 2026-11-17)
1. **Who may reverse:** the School Manager and the Subscription Collector of the payment's school (each only for a school they manage / are currently linked to). No other role; no approval workflow, refund processing, financial rule or timing restriction.
2. **No amount** is stored (V1): no fee calculation, proration, mid-month charge or partial payment.
3. **After a reversal** the subscription becomes UNPAID and can be paid again by a NEW payment (the reversed one stays as history). A reversal is not limited to the current month, but is refused while a newer month is PAID (§59).
4. **Legacy data, no backfill (owner rejected it explicitly):** subscriptions marked PAID through the removed Module 33 `mark-paid` endpoint before 0.51.0 have NO payment record. No synthetic payment, payment id, actor, timestamp, reversal reason or audit history was or will be created, and no historical subscription status was changed. Module 34 can reverse only a payment that actually exists, so such a subscription cannot be reversed through Module 34 (there is no payment id to reverse; an unknown id is refused by the scope check, `403`). A stale SUCCESSFUL payment whose subscription is already UNPAID (left by the removed `mark-unpaid` correction) can still be closed by a reversal.
5. Payment lists show identifiers, not student names (Module 33's list has the names); adding names needs a read-only Students contract and was left out of scope.

## Tests
- `tests/unit/payments/payment-service.test.ts`, `payment-boundaries.test.ts`: behavior, atomicity, Oldest-Unpaid Rule, reversal rules, no amount, no delete, module boundaries.
- `tests/integration/payments-routes.test.ts` (11): the permission matrix over HTTP (manager, own/foreign Collector, removed Collector, other school, Main Admin, Organization Manager, unauthenticated), validation, Arabic messages, no DELETE/PUT/PATCH.
- `tests/api-docs/conformance/payments.test.ts`: every documented operation against the real handlers (`assertAllExercised('34')`); plus the registrations in the request-validation and error-kind gates.
- `tests/db/payments.test.ts` (12, real MariaDB, `npm run test:db`): schema CHECKs and unique index, SQL repository, real service, atomic rollback and real concurrency (parallel payments / reversals, Oldest-Unpaid Rule).
