# Domain Events & Transactional Outbox

Owned by Module 06 (`src/modules/06-domain-events-outbox`).

```
Business action → Domain event → Outbox row (same DB transaction) → Processor → Handlers
```
- The business change and its outbox rows **commit or roll back together** (`OutboxService.publish` requires the caller's transaction).
- Delivery happens afterwards. A handler failure **never rolls back** the business transaction.
- Persistence is the source of truth: events are stored before anything is delivered.

## Publishing
```ts
await unitOfWork.run(async (tx) => {
  await repo.save(student, tx);
  await outbox.publishFrom(student, tx);          // events recorded on the aggregate (addDomainEvent)
  // or: await outbox.publish([createDomainEvent({ eventType: 'StudentEnrolled', aggregateType: 'Student', aggregateId: id, payload: { ... } })], tx);
});
```
`createDomainEvent` assigns a UUID `eventId`, the time, and metadata (`requestId`, `actorUserId`) from the request context. Payloads must be JSON (max 256 KB) and must never contain passwords, OTPs, or tokens. Event/aggregate types use letters, digits, `_` and `.`.

## Handling
```ts
getEventHandlerRegistry().register({
  name: 'notifications.student-enrolled',
  eventTypes: ['StudentEnrolled'],      // or ['*'] for all events
  async handle(event) { /* must be idempotent: de-duplicate on event.eventId */ },
});
```
- Delivery is **at least once**. Retries re-run all handlers of a message, so handlers must be idempotent.
- Handlers run inside the original request context (same `requestId` in logs).
- One failing handler does not stop the others. A message with no subscribers is marked processed (it stays stored).

## Retries
Failure → retry after 30 s, 60 s, 120 s … (cap 1 h). After 5 attempts the message is marked `dead` with the last error (sanitized). Dead messages stay in the table for inspection.

## Processing
`OutboxScheduler` polls the table every 5 s (no Redis required) from `startOutbox()` in `server.ts`; `stopOutbox()` waits for the batch in flight on shutdown. Workers claim messages with a single `UPDATE … ORDER BY id LIMIT n` plus a lock lease (60 s), so several workers never take the same message and a crashed worker's messages are picked up after the lease expires (MariaDB 10.4 has no `SKIP LOCKED`).
BullMQ/Redis can later replace the polling trigger without changing the processor or the store; it will be added when a module needs delayed/scheduled jobs (OTP expiry, subscriptions, reminders).

## Table `outbox_messages`
Migration `20261007120000-create-outbox-messages.js` (run `npm run db:migrate`). BIGINT sequence id (delivery order) + unique `event_id`; payload/metadata as text; `status` pending | processed | dead; `attempts`, `next_attempt_at`, `locked_by`, `locked_until`, `last_error`, `processed_at`.

## Testing other modules
Use `InMemoryOutboxStore` (same claim semantics) with `OutboxService`/`OutboxProcessor` and a `FixedClock`. Real-database checks: `npm run test:db` (after migrating).
