import { identityError } from '../errors/identity-errors';

/**
 * Phone normalization is SHARED infrastructure: every module that stores or compares
 * a phone number must go through `normalizePhone` first (Master Specification §21).
 *
 * Canonical form: E.164 ("+" followed by 8-15 digits, no leading zero after the "+").
 *
 * Accepted inputs:
 *  - International with "+" or "00" prefix:      "+20 101 234 5678", "0020 101 234 5678", "+966 50 123 4567"
 *  - Egyptian local mobile (010/011/012/015):    "01012345678"  ->  "+201012345678"
 * Arabic-Indic / Persian digits and common separators (spaces, "-", ".", parentheses,
 * invisible direction marks) are accepted and removed.
 *
 * Anything else (for example digits-only numbers that do not start with 010/011/012/015)
 * is rejected, because the country cannot be determined without guessing.
 */
const EGYPT_CODE = '20';
const EGYPT_LOCAL_MOBILE = /^01[0125]\d{8}$/;
const E164_DIGITS = /^[1-9]\d{7,14}$/;
const SEPARATORS = /[\s\-.()\u00a0\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function toLatinDigits(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Returns the E.164 number, or throws INVALID_PHONE_NUMBER. */
export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string') throw identityError('INVALID_PHONE_NUMBER');
  const cleaned = toLatinDigits(raw).replace(SEPARATORS, '');

  let digits: string;
  if (cleaned.startsWith('+')) digits = cleaned.slice(1);
  else if (cleaned.startsWith('00')) digits = cleaned.slice(2);
  else if (EGYPT_LOCAL_MOBILE.test(cleaned)) digits = EGYPT_CODE + cleaned.slice(1);
  else throw identityError('INVALID_PHONE_NUMBER');

  if (!E164_DIGITS.test(digits)) throw identityError('INVALID_PHONE_NUMBER');

  if (digits.startsWith(EGYPT_CODE)) {
    const national = digits.slice(EGYPT_CODE.length);
    // No trunk "0" after +20 (a common typing mistake), and Egyptian mobiles are exactly 10 digits.
    if (national.startsWith('0')) throw identityError('INVALID_PHONE_NUMBER');
    if (/^1[0125]/.test(national) && national.length !== 10) throw identityError('INVALID_PHONE_NUMBER');
  }
  return `+${digits}`;
}

export function tryNormalizePhone(raw: unknown): string | undefined {
  try {
    return normalizePhone(raw);
  } catch {
    return undefined;
  }
}

/** Last 4 digits of the normalized phone (used for the §24 initial password). */
export function lastFourDigitsOf(phone: string): string {
  return normalizePhone(phone).slice(-4);
}
