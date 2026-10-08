import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  assertPasswordPolicy,
  initialPasswordFromPhone,
} from '../../../src/modules/08-identity-core/public';

const check = (value: unknown): { ok: boolean; code?: string; params?: unknown } => {
  try {
    assertPasswordPolicy(value);
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, code: e.code, params: e.params };
    throw e;
  }
};

describe('password policy (§23)', () => {
  it('is 4 to 12 characters', () => {
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([4, 12]);
  });

  it.each(['1234', '123456789012', 'abcd', 'abcdefghijkl', 'abc123', 'pa$$w0rd!', 'ab cd', 'كلمةسر', 'كلمة123'])(
    'accepts %j',
    (value) => {
      expect(check(value).ok).toBe(true);
    },
  );

  it.each(['', '1', '123', '1234567890123', 'abcdefghijklm'])('rejects %j by length', (value) => {
    expect(check(value)).toEqual({ ok: false, code: 'INVALID_PASSWORD', params: { min: 4, max: 12 } });
  });

  it('counts characters, not bytes (12 Arabic letters are allowed, 13 are not)', () => {
    expect(check('ا'.repeat(12)).ok).toBe(true);
    expect(check('ا'.repeat(13)).ok).toBe(false);
  });

  it('imposes no composition rule (digits only, letters only)', () => {
    expect(check('0000').ok).toBe(true);
    expect(check('aaaa').ok).toBe(true);
  });

  it.each([undefined, null, 1234, {}, ['1234']])('rejects non-string %j', (value) => {
    expect(check(value).code).toBe('INVALID_PASSWORD');
  });
});

describe('initial password (§24)', () => {
  it('is the last 4 digits of the phone and satisfies the policy', () => {
    const password = initialPasswordFromPhone('010 1234 5678');
    expect(password).toBe('5678');
    expect(check(password).ok).toBe(true);
  });
});
