import { describe, expect, it } from 'vitest';
import { sanitizeUserAgent } from '../../../src/app/middleware/request-context.middleware';
import { requestContext } from '../../../src/modules/05-logging-request-context/public';
import { createDomainEvent } from '../../../src/modules/06-domain-events-outbox/public';

describe('request address and user agent reach the event metadata (additive)', () => {
  it('sanitizes the user agent: control characters removed, trimmed, truncated, empty -> undefined', () => {
    expect(sanitizeUserAgent('  Mozilla/5.0\r\nX-Evil: 1 ')).toBe('Mozilla/5.0  X-Evil: 1');
    expect(sanitizeUserAgent('a'.repeat(400))).toHaveLength(255);
    expect(sanitizeUserAgent('   ')).toBeUndefined();
    expect(sanitizeUserAgent(undefined)).toBeUndefined();
  });
  it('an event created inside a request carries ipAddress and userAgent; outside a request it carries none', () => {
    const base = { eventType: 'X', aggregateType: 'T', aggregateId: 'a', payload: {} };
    const inside = requestContext.run({ requestId: 'req-12345678', locale: 'en', actorUserId: 'u1', ipAddress: '203.0.113.7', userAgent: 'UA/1' }, () => createDomainEvent(base));
    expect(inside.metadata).toEqual({ requestId: 'req-12345678', actorUserId: 'u1', ipAddress: '203.0.113.7', userAgent: 'UA/1' });
    expect(createDomainEvent(base).metadata).toBeUndefined();
  });
});
