import { describe, expect, it } from 'vitest';
import { AggregateRoot, FixedClock, type DomainEvent } from '../../../src/modules/00-shared-kernel/public';
import {
  InMemoryOutboxStore,
  OutboxService,
  createDomainEvent,
} from '../../../src/modules/06-domain-events-outbox/public';

const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
const tx = {} as never;
const make = (extra: Partial<Parameters<typeof createDomainEvent>[0]> = {}) =>
  createDomainEvent(
    { eventType: 'SchoolCreated', aggregateType: 'School', aggregateId: 's1', payload: { name: 'مدرسة' }, ...extra },
    clock,
  );

class School extends AggregateRoot<string> {
  static create(id: string) {
    const s = new School(id);
    s.addDomainEvent(createDomainEvent({ eventType: 'SchoolCreated', aggregateType: 'School', aggregateId: id, payload: {} }, clock));
    return s;
  }
}

describe('OutboxService', () => {
  it('stores events as pending records with JSON payload and metadata', async () => {
    const store = new InMemoryOutboxStore();
    await new OutboxService(store, clock).publish([make({ metadata: { requestId: 'req-12345678' } })], tx);
    const m = store.messages[0]!;
    expect(store.messages).toHaveLength(1);
    expect(m.status).toBe('pending');
    expect(JSON.parse(m.payload)).toEqual({ name: 'مدرسة' });
    expect(JSON.parse(m.metadata ?? 'null')).toEqual({ requestId: 'req-12345678' });
    expect(m.nextAttemptAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
  it('stores null metadata when there is none', async () => {
    const store = new InMemoryOutboxStore();
    await new OutboxService(store, clock).publish([make()], tx);
    expect(store.messages[0]?.metadata).toBe(null);
  });
  it('does nothing for an empty list', async () => {
    const store = new InMemoryOutboxStore();
    await new OutboxService(store, clock).publish([], tx);
    expect(store.messages).toHaveLength(0);
  });
  it('rejects invalid events and oversized payloads without writing anything', async () => {
    const store = new InMemoryOutboxStore();
    const service = new OutboxService(store, clock);
    const bad = { ...make(), eventType: 'bad type' } as DomainEvent;
    let failed = 0;
    for (const events of [[make(), bad], [make({ payload: 'x'.repeat(300 * 1024) })]]) {
      try {
        await service.publish(events, tx);
      } catch {
        failed++;
      }
    }
    expect(failed).toBe(2);
    expect(store.messages).toHaveLength(0);
  });
  it('publishFrom pulls and clears an aggregate\'s events', async () => {
    const store = new InMemoryOutboxStore();
    const school = School.create('s1');
    await new OutboxService(store, clock).publishFrom(school, tx);
    expect(store.messages).toHaveLength(1);
    expect(school.pullDomainEvents()).toHaveLength(0);
  });
});
