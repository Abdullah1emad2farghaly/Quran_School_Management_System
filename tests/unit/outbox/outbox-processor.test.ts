import { describe, expect, it } from 'vitest';
import { FixedClock, type DomainEvent } from '../../../src/modules/00-shared-kernel/public';
import { createLogger, requestContext } from '../../../src/modules/05-logging-request-context/public';
import {
  EventHandlerRegistry,
  InMemoryOutboxStore,
  OutboxProcessor,
  OutboxService,
  createDomainEvent,
  type EventHandler,
} from '../../../src/modules/06-domain-events-outbox/public';

const T0 = new Date('2026-01-01T00:00:00Z');
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);
const tx = {} as never;
const silent = createLogger({ level: 'silent' });

function setup(handlers: EventHandler[] = [], options: ConstructorParameters<typeof OutboxProcessor>[1] = {}) {
  const clock = new FixedClock(T0);
  const store = new InMemoryOutboxStore();
  const registry = new EventHandlerRegistry();
  handlers.forEach((h) => registry.register(h));
  const service = new OutboxService(store, clock);
  const processor = new OutboxProcessor({ store, registry, clock, logger: silent }, options);
  const publish = async (type = 'StudentEnrolled', extra: Record<string, unknown> = {}) => {
    const event = createDomainEvent({ eventType: type, aggregateType: 'Student', aggregateId: 'a1', payload: { type }, ...extra }, clock);
    await service.publish([event], tx);
    return event;
  };
  return { clock, store, registry, service, processor, publish };
}

const handler = (name: string, eventTypes: string[], fn: (e: DomainEvent) => Promise<void> = async () => undefined): EventHandler => ({
  name,
  eventTypes,
  handle: fn,
});

describe('OutboxProcessor delivery', () => {
  it('delivers to matching handlers and marks the message processed', async () => {
    const seen: DomainEvent[] = [];
    const other: string[] = [];
    const { processor, publish, store } = setup([
      handler('a', ['StudentEnrolled'], async (e) => void seen.push(e)),
      handler('b', ['Other'], async (e) => void other.push(e.eventType)),
    ]);
    const event = await publish();
    const result = await processor.processBatch();
    expect(result).toEqual({ claimed: 1, processed: 1, retried: 0, dead: 0 });
    expect(seen[0]?.eventId).toBe(event.eventId);
    expect(seen[0]?.payload).toEqual({ type: 'StudentEnrolled' });
    expect(seen[0]?.occurredAt instanceof Date).toBe(true);
    expect(other).toHaveLength(0);
    expect(store.messages[0]?.status).toBe('processed');
  });
  it('"*" handlers receive every event', async () => {
    const seen: string[] = [];
    const { processor, publish } = setup([handler('all', ['*'], async (e) => void seen.push(e.eventType))]);
    await publish('A');
    await publish('B');
    await processor.processBatch();
    expect(seen).toEqual(['A', 'B']);
  });
  it('messages with no subscribers are marked processed', async () => {
    const { processor, publish, store } = setup();
    await publish();
    expect((await processor.processBatch()).processed).toBe(1);
    expect(store.messages[0]?.status).toBe('processed');
  });
  it('processed messages are not delivered again', async () => {
    const calls: string[] = [];
    const { processor, publish } = setup([handler('a', ['*'], async (e) => void calls.push(e.eventId))]);
    await publish();
    await processor.processBatch();
    expect((await processor.processBatch()).claimed).toBe(0);
    expect(calls).toHaveLength(1);
  });
  it('runs handlers inside the original request context', async () => {
    let seenRequestId: string | undefined;
    const { processor, publish } = setup([handler('a', ['*'], async () => { seenRequestId = requestContext.requestId(); })]);
    await publish('X', { metadata: { requestId: 'orig-request-1' } });
    await processor.processBatch();
    expect(seenRequestId).toBe('orig-request-1');
  });
});

describe('OutboxProcessor failures', () => {
  it('schedules a retry with backoff, records a sanitized error, and does not redeliver early', async () => {
    const { processor, publish, store, clock } = setup([
      handler('flaky', ['*'], async () => { throw new Error('failed with Bearer topsecret123'); }),
    ]);
    await publish();
    expect(await processor.processBatch()).toEqual({ claimed: 1, processed: 0, retried: 1, dead: 0 });
    const m = store.messages[0]!;
    expect(m.status).toBe('pending');
    expect(m.attempts).toBe(1);
    expect(m.nextAttemptAt.toISOString()).toBe('2026-01-01T00:00:30.000Z');
    expect(m.lastError?.startsWith('flaky:')).toBe(true);
    expect(m.lastError?.includes('topsecret123')).toBe(false);
    expect((await processor.processBatch()).claimed).toBe(0);
    clock.set(new Date(T0.getTime() + 31_000));
    expect((await processor.processBatch()).claimed).toBe(1);
  });
  it('a failing handler does not stop the other handlers', async () => {
    const ran: string[] = [];
    const { processor, publish } = setup([
      handler('bad', ['*'], async () => { throw new Error('x'); }),
      handler('good', ['*'], async () => void ran.push('good')),
    ]);
    await publish();
    await processor.processBatch();
    expect(ran).toEqual(['good']);
  });
  it('marks the message dead after the maximum attempts', async () => {
    const { processor, publish, store, clock } = setup(
      [handler('bad', ['*'], async () => { throw new Error('always'); })],
      { retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 2000 } },
    );
    await publish();
    const results = [];
    for (let i = 1; i <= 3; i++) {
      clock.set(hours(i));
      results.push(await processor.processBatch());
    }
    expect(results.map((r) => [r.retried, r.dead])).toEqual([[1, 0], [1, 0], [0, 1]]);
    expect(store.messages[0]?.status).toBe('dead');
    expect(store.messages[0]?.attempts).toBe(3);
    clock.set(hours(10));
    expect((await processor.processBatch()).claimed).toBe(0);
  });
  it('treats a corrupt payload as a failed delivery', async () => {
    const { processor, store } = setup([handler('a', ['*'])]);
    await store.append([{ eventId: 'e1', eventType: 'X', aggregateType: 'A', aggregateId: '1', payload: '{not json', metadata: null, occurredAt: T0, nextAttemptAt: T0 }], tx);
    const result = await processor.processBatch();
    expect(result.retried).toBe(1);
    expect(store.messages[0]?.lastError?.startsWith('dispatch:')).toBe(true);
  });
});

describe('OutboxProcessor concurrency and locking', () => {
  it('two workers never deliver the same message twice', async () => {
    const deliveries: string[] = [];
    const clock = new FixedClock(T0);
    const store = new InMemoryOutboxStore();
    const registry = new EventHandlerRegistry();
    registry.register(handler('a', ['*'], async (e) => void deliveries.push(e.eventId)));
    const service = new OutboxService(store, clock);
    for (let i = 0; i < 5; i++) {
      await service.publish([createDomainEvent({ eventType: 'E', aggregateType: 'A', aggregateId: String(i), payload: {} }, clock)], tx);
    }
    const make = () => new OutboxProcessor({ store, registry, clock, logger: silent }, { batchSize: 3 });
    const [r1, r2] = await Promise.all([make().processBatch(), make().processBatch()]);
    expect(r1.claimed + r2.claimed).toBe(5);
    expect(deliveries).toHaveLength(5);
    expect(new Set(deliveries).size).toBe(5);
  });
  it('a locked message is skipped until its lock expires (crashed worker recovery)', async () => {
    const { processor, publish, store, clock } = setup([handler('a', ['*'])], { lockMs: 60_000 });
    await publish();
    await store.claim({ claimId: 'dead-worker', now: T0, lockUntil: new Date(T0.getTime() + 60_000), limit: 10 });
    expect((await processor.processBatch()).claimed).toBe(0);
    clock.set(new Date(T0.getTime() + 61_000));
    expect((await processor.processBatch()).claimed).toBe(1);
  });
  it('delivers in publication order', async () => {
    const order: string[] = [];
    const { processor, publish } = setup([handler('a', ['*'], async (e) => void order.push(e.eventType))]);
    for (const t of ['One', 'Two', 'Three']) await publish(t);
    await processor.processBatch();
    expect(order).toEqual(['One', 'Two', 'Three']);
  });
});

describe('EventHandlerRegistry', () => {
  it('rejects duplicate names, empty names and handlers without events', () => {
    const r = new EventHandlerRegistry();
    r.register(handler('a', ['X']));
    expect(() => r.register(handler('a', ['Y']))).toThrow();
    expect(() => r.register(handler('', ['Y']))).toThrow();
    expect(() => r.register(handler('b', []))).toThrow();
    expect(r.names()).toEqual(['a']);
  });
});
