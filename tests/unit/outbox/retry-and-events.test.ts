import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../../src/modules/00-shared-kernel/public';
import { requestContext } from '../../../src/modules/05-logging-request-context/public';
import {
  DEFAULT_RETRY_POLICY,
  assertValidDomainEvent,
  computeRetryDelayMs,
  createDomainEvent,
} from '../../../src/modules/06-domain-events-outbox/public';

describe('computeRetryDelayMs', () => {
  it('backs off exponentially from 30s and caps at 1h', () => {
    expect([1, 2, 3, 4].map((n) => computeRetryDelayMs(n))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(computeRetryDelayMs(20)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });
  it('never returns less than the base delay', () => {
    expect(computeRetryDelayMs(0)).toBe(30_000);
  });
});

describe('createDomainEvent', () => {
  const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
  const base = { eventType: 'StudentEnrolled', aggregateType: 'Student', aggregateId: 'abc', payload: { n: 1 } };

  it('creates an event with a uuid, clock time and payload', () => {
    const e = createDomainEvent(base, clock);
    expect(e.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.occurredAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(e.payload).toEqual({ n: 1 });
    expect('metadata' in e).toBe(false);
  });
  it('takes metadata from the current request context', () => {
    const e = requestContext.run({ requestId: 'req-12345678', locale: 'ar', actorUserId: 'u1' }, () =>
      createDomainEvent(base, clock),
    );
    expect(e.metadata).toEqual({ requestId: 'req-12345678', actorUserId: 'u1' });
  });
  it('explicit metadata wins', () => {
    const e = createDomainEvent({ ...base, metadata: { requestId: 'explicit-1' } }, clock);
    expect(e.metadata).toEqual({ requestId: 'explicit-1' });
  });
  it('rejects invalid event data', () => {
    expect(() => createDomainEvent({ ...base, eventType: 'bad type!' }, clock)).toThrow();
    expect(() => createDomainEvent({ ...base, aggregateType: '' }, clock)).toThrow();
    expect(() => createDomainEvent({ ...base, aggregateId: '' }, clock)).toThrow();
    expect(() => createDomainEvent({ ...base, aggregateId: 'x'.repeat(65) }, clock)).toThrow();
    expect(() => createDomainEvent({ ...base, occurredAt: new Date('invalid') }, clock)).toThrow();
  });
  it('assertValidDomainEvent rejects a non-uuid eventId', () => {
    const e = createDomainEvent(base, clock);
    expect(() => assertValidDomainEvent({ ...e, eventId: 'nope' })).toThrow();
  });
});
