import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { lastFourDigitsOf, normalizePhone, tryNormalizePhone } from '../../../src/modules/08-identity-core/public';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
};

describe('normalizePhone: Egyptian local mobiles', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['01112345678', '+201112345678'],
    ['01212345678', '+201212345678'],
    ['01512345678', '+201512345678'],
    ['010 1234 5678', '+201012345678'],
    ['010-1234-5678', '+201012345678'],
    ['(010) 1234.5678', '+201012345678'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it('accepts Arabic-Indic and Persian digits', () => {
    expect(normalizePhone('٠١٠١٢٣٤٥٦٧٨')).toBe('+201012345678');
    expect(normalizePhone('۰۱۰۱۲۳۴۵۶۷۸')).toBe('+201012345678');
  });

  it('ignores invisible direction marks and non-breaking spaces from copy/paste', () => {
    expect(normalizePhone('\u200e010\u00a01234\u200f5678')).toBe('+201012345678');
  });
});

describe('normalizePhone: international numbers', () => {
  it.each([
    ['+201012345678', '+201012345678'],
    ['+20 101 234 5678', '+201012345678'],
    ['00201012345678', '+201012345678'],
    ['0020 101 234 5678', '+201012345678'],
    ['+966501234567', '+966501234567'],
    ['00966501234567', '+966501234567'],
    ['+14155552671', '+14155552671'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it('is idempotent', () => {
    const once = normalizePhone('010 1234 5678');
    expect(normalizePhone(once)).toBe(once);
  });

  it('the same person typed in different formats gets one canonical phone', () => {
    const forms = ['01012345678', '+201012345678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨', '010 1234 5678'];
    expect(new Set(forms.map(normalizePhone)).size).toBe(1);
  });
});

describe('normalizePhone: rejected input', () => {
  it.each([
    '',
    '   ',
    'abc',
    'not a phone',
    '1012345678', // digits only, no 0 / + / 00: country cannot be determined
    '201012345678', // digits only without + : not guessed
    '0212345678', // local landline: only 010/011/012/015 mobiles are local-normalized
    '01312345678', // 013 is not an accepted local mobile prefix
    '0101234567', // too short
    '010123456789', // too long
    '+2001012345678', // trunk "0" after +20
    '+2010123', // too short Egyptian mobile
    '+20101234567890', // too long Egyptian mobile
    '+0123456789', // E.164 never starts with 0
    '+1234567', // fewer than 8 digits
    '+1234567890123456', // more than 15 digits
    '+20 101 234 5678 ext 5',
  ])('rejects %j', (raw) => {
    expect(codeOf(() => normalizePhone(raw))).toBe('INVALID_PHONE_NUMBER');
  });

  it.each([undefined, null, 1012345678, {}, []])('rejects non-string %j', (raw) => {
    expect(codeOf(() => normalizePhone(raw))).toBe('INVALID_PHONE_NUMBER');
  });

  it('tryNormalizePhone returns undefined instead of throwing', () => {
    expect(tryNormalizePhone('01012345678')).toBe('+201012345678');
    expect(tryNormalizePhone('nope')).toBeUndefined();
  });
});

describe('lastFourDigitsOf', () => {
  it('uses the normalized phone, whatever the input format', () => {
    expect(lastFourDigitsOf('01012345678')).toBe('5678');
    expect(lastFourDigitsOf('+20 101 234 5678')).toBe('5678');
    expect(lastFourDigitsOf('٠١٠١٢٣٤٥٦٧٨')).toBe('5678');
  });
});
