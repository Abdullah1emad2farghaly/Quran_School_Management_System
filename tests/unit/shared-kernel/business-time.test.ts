import { describe, expect, it } from 'vitest';
import { businessDateOf, FixedClock, isIsoDate } from '../../../src/modules/00-shared-kernel/public';

describe('businessDateOf (Africa/Cairo)', () => {
  it('rolls over to the next day after local midnight', () => {
    // 2026-01-10T22:30Z is 00:30 on Jan 11 in Cairo (UTC+2 in winter)
    expect(businessDateOf(new Date('2026-01-10T22:30:00Z'))).toBe('2026-01-11');
    expect(businessDateOf(new Date('2026-01-10T21:30:00Z'))).toBe('2026-01-10');
  });
  it('rejects invalid dates', () => {
    expect(() => businessDateOf(new Date('invalid'))).toThrow();
  });
});

describe('isIsoDate', () => {
  it('validates real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26-02-28')).toBe(false);
  });
});

describe('FixedClock', () => {
  it('returns the fixed instant', () => {
    const c = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    expect(c.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
