# Module 35 — History & Audit

Implements Master Specification §64 (AUDIT / HISTORY). **Status: IMPLEMENTED (0.48.0); locally verified by the project owner (confirmed 2026-11-17; no counts were provided, none are recorded here).**

## What it does
An immutable audit trail: every important change in the system leaves one record with **who** (`actorUserId`), **what** (`action`, `module`, `entityType`, `entityId`), **what changed** (`before`, `after`), **from where** (`ipAddress`, `userAgent`) and **when** (`timestamp`). Records are kept indefinitely. Nothing can change or delete them: there is no such endpoint, the module has no UPDATE/DELETE statement, and the table rejects both (see Database).

## How records are written
Modules do not call Module 35. They already publish domain events through the outbox; the handler `audit.record-domain-event` records the events listed in the **catalog** (`domain/value-objects/audit-catalog.ts`, 63 events; a catalog entry = event type → module label + action). An event not in the catalog is never audited. Delivery is at-least-once, so `event_id` is UNIQUE and a redelivery writes nothing. If recording fails, the outbox retries.
- **Actions** (closed list): CREATE, UPDATE, DELETE, ACTIVATE, DEACTIVATE, ROLE_CHANGE, APPROVE, REJECT, PAYMENT, WAIVER, RELATIONSHIP_CHANGE, STATUS_CHANGE, CORRECTION.
- **Not audited, by decision:** `EvaluationScoresUpdated` (approved Module 29 amendment, §64); `AuthSessionStarted/Revoked` (sign-in telemetry, not in §64); high-volume operational records and lifecycle ticks (`ClassSessionCreated/Started/Completed`, `AttendanceRecorded`, `MemorizationRecorded`, `RevisionRecorded`, `EvaluationRecorded`, `ExamStarted/Completed/Ended`) — their corrections are audited. Adding one is a one-line catalog change.
- **before / after:** exactly what the event already carries (approved decision: no other module was changed). `before` = the event's `previousX` fields (named `x`); `after` = the other payload fields except the actor (own column). Most events carry identifiers and statuses only, so `before` is null for them. Secrets and contact data (any key containing password, passcode, token, otp, secret, hash, nationalId, phone, email, endpoint, credential) are never copied. A snapshot over 16,000 characters is replaced by `{"truncated": true}`.
- **actor:** the verified caller in the event metadata (request context), else an actor id in the payload, else null (system-originated: schedulers, jobs).
- **ipAddress / userAgent (approved, additive change to Modules 00/05/06):** the request context now carries `req.ip` (trusted-proxy aware) and the sanitized `User-Agent` (control characters removed, at most 255 characters); `createDomainEvent` copies them into the event metadata (`DomainEventMetadata.ipAddress` / `.userAgent`, optional). Events created outside a request (jobs) carry neither. Events already waiting in the outbox before this version have no address; their audit records have null.
- **scope of a record:** `schoolId` / `organizationId` from the event payload; a School or Organization aggregate is its own scope; if only the school is known, the school's organization is added through the public contract of Module 16 (injected in `src/config/audit.ts`). A record with neither (identity, roles) is visible to the Main Admin only.

## Reading (HTTP, read-only) — approved decision
| Endpoint | Permission | Roles |
|---|---|---|
| `GET /api/v1/audit-logs` | `audit.log.list` | MAIN_ADMIN, ORGANIZATION_MANAGER, SCHOOL_MANAGER |
| `GET /api/v1/audit-logs/:id` | `audit.log.read` | same |

What a permitted caller sees depends on the session's **active role** (0.46.0): MAIN_ADMIN everything; ORGANIZATION_MANAGER the records whose `organizationId` is one of the organizations they administer (Module 13 `listAdministeredOrganizationIds`); SCHOOL_MANAGER the records whose `schoolId` is one of the schools they manage (Module 16 `listManagedSchoolIds`). TEACHER, STUDENT, PARENT, SUBSCRIPTION_COLLECTOR: no permission. GOVERNORATE/CENTER/VILLAGE managers: no permission (no scope link exists for them in the system). The visibility is applied inside every query, so filters can narrow but never widen; a record outside the caller's scope and an unknown id answer the same `404 AUDIT_RECORD_NOT_FOUND`. Responses are `Cache-Control: no-store`.
List: newest first (`sort=-timestamp` / `timestamp`), pagination, filters `module`, `action` (comma list), `entityType`, `entityId`, `actorUserId`, `organizationId`, `schoolId`, `from`, `to` (inclusive UTC calendar days). Fields: `id, actorUserId, action, module, entityType, entityId, before, after, ipAddress, userAgent, organizationId, schoolId, timestamp`.

## Database (migration `20261116100000-create-audit-logs.js`; no existing table changed)
`audit_logs`: id, `event_id` (unique), actor_user_id, action, module, entity_type, entity_id, before_json, after_json, ip_address, user_agent, request_id, organization_id, school_id, occurred_at, recorded_at (UTC, ms). No foreign keys (§14), no `updated_at`, no soft delete. Indexes on time, organization, school, entity, actor and module/action. BEFORE UPDATE and BEFORE DELETE triggers reject any change; if the database user cannot create triggers the migration still succeeds and prints a warning (the application never updates or deletes anyway) — grant TRIGGER and create `audit_logs_no_update` / `audit_logs_no_delete` (see the migration). Test and maintenance scripts therefore cannot delete audit rows.

## Limits
- Only what events carry: most records have no `before`. Richer before/after needs changes in the emitting modules (a separate approval).
- Events that were already in the outbox, or emitted before this version, are audited only if still unprocessed when the handler starts; there is no back-fill of history.
- Audit retention is indefinite; there is no purge.


## Release 0.49.0 (Module 34)
The catalog gained two events, `PaymentRecorded` and `PaymentReversed` (module `payments`, action `PAYMENT`), so it now lists 65 events. The reversal's reason, actor and time are also stored on the payment itself (spec §60). No other change to Module 35.
