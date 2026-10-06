/**
 * Real-database checks for the outbox (MariaDB via XAMPP). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate` (creates outbox_messages).
 * Run with: npm run test:db
 * Test rows use event types starting with "Test." and ancient timestamps (year 2001),
 * so they can never claim or disturb real outbox messages; they are deleted afterwards.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { FixedClock } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize } from '../../src/modules/02-database/public';
import { createLogger } from '../../src/modules/05-logging-request-context/public';
import {
  EventHandlerRegistry,
  OutboxProcessor,
  OutboxService,
  SequelizeOutboxStore,
  createDomainEvent,
} from '../../src/modules/06-domain-events-outbox/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const store = new SequelizeOutboxStore(sequelize);
const T0 = new Date('2001-01-01T00:00:00Z');
const clock = new FixedClock(T0);
const service = new OutboxService(store, clock);
const logger = createLogger({ level: 'silent' });

const makeEvent = (name: string, payload: unknown = { ok: true }) =>
  createDomainEvent({ eventType: `Test.${name}`, aggregateType: 'Test', aggregateId: 't1', payload }, clock);

async function row(eventId: string) {
  const rows = await sequelize.query<{ status: string; attempts: number; last_error: string | null }>(
    'SELECT status, attempts, last_error FROM outbox_messages WHERE event_id = :eventId',
    { replacements: { eventId }, type: QueryTypes.SELECT },
  );
  return rows[0];
}
const cleanup = () => sequelize.query("DELETE FROM outbox_messages WHERE event_type LIKE 'Test.%'");

describe('outbox (MariaDB)', () => {
  beforeAll(async () => {
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await sequelize.close();
  });

  it('persists the event when the business transaction commits', async () => {
    const event = makeEvent('commit', { name: 'مدرسة' });
    await uow.run(async (tx) => service.publish([event], tx));
    expect((await row(event.eventId))?.status).toBe('pending');
  });

  it('discards the event when the business transaction rolls back', async () => {
    const event = makeEvent('rollback');
    try {
      await uow.run(async (tx) => {
        await service.publish([event], tx);
        throw new Error('business failure');
      });
    } catch {
      /* expected */
    }
    expect(await row(event.eventId)).toBe(undefined);
  });

  it('claims each message once, oldest first, and respects locks', async () => {
    await cleanup(); // earlier tests leave pending rows; start from a clean slate so ordering is deterministic
    const events = [makeEvent('claim1'), makeEvent('claim2'), makeEvent('claim3')];
    await uow.run(async (tx) => service.publish(events, tx));
    const now = new Date(T0.getTime() + 86_400_000);
    const lockUntil = new Date(now.getTime() + 60_000);
    const first = await store.claim({ claimId: 'c1-' + Date.now(), now, lockUntil, limit: 2 });
    const second = await store.claim({ claimId: 'c2-' + Date.now(), now, lockUntil, limit: 10 });
    const ids = [...first, ...second].map((r) => r.eventId);
    expect(first).toHaveLength(2);
    expect(second.some((r) => first.some((f) => f.id === r.id))).toBe(false);
    for (const e of events) expect(ids.includes(e.eventId)).toBe(true);
    expect(first[0]?.eventId).toBe(events[0]?.eventId);
    // release for later tests
    for (const r of [...first, ...second]) await store.markProcessed(r.id, now);
  });

  it('delivers end to end, retries failures, then marks the message dead', async () => {
    const okEvent = makeEvent('delivered');
    const badEvent = makeEvent('failing');
    await uow.run(async (tx) => service.publish([okEvent, badEvent], tx));

    const received: string[] = [];
    const registry = new EventHandlerRegistry();
    registry.register({ name: 'ok', eventTypes: ['Test.delivered'], handle: async (e) => void received.push(e.eventId) });
    registry.register({ name: 'bad', eventTypes: ['Test.failing'], handle: async () => { throw new Error('nope'); } });

    const workClock = new FixedClock(new Date(T0.getTime() + 2 * 86_400_000));
    const processor = new OutboxProcessor(
      { store, registry, clock: workClock, logger },
      { retry: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 1000 } },
    );

    await processor.processBatch();
    expect(received).toEqual([okEvent.eventId]);
    expect((await row(okEvent.eventId))?.status).toBe('processed');
    expect(await row(badEvent.eventId)).toMatchObject({ status: 'pending', attempts: 1 });

    workClock.set(new Date(workClock.now().getTime() + 5000));
    await processor.processBatch();
    expect(await row(badEvent.eventId)).toMatchObject({ status: 'dead', attempts: 2 });
    expect((await row(badEvent.eventId))?.last_error?.includes('bad: nope')).toBe(true);
  });
});
