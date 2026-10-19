import { parentError } from '../errors/parent-errors';

export const PARENT_NAME_MAX_LENGTH = 200;
export const PARENT_NAME_MIN_PARTS = 3;

/**
 * The Parent's full name (Master Specification §32: three-part name; the Student rules §37 use the same convention: at least 3 parts,
 * trimmed, extra spaces collapsed). Unicode NFC, whitespace collapsed, no control characters, at most 200 characters. No other rule
 * is invented (no digit or script restriction, no Arabic letter folding).
 */
export function normalizeParentName(input: unknown): string {
  if (typeof input !== 'string') throw parentError('INVALID_PARENT_NAME');
  const name = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name === '' || /\p{Cc}/u.test(name) || [...name].length > PARENT_NAME_MAX_LENGTH) throw parentError('INVALID_PARENT_NAME');
  if (name.split(' ').length < PARENT_NAME_MIN_PARTS) throw parentError('INVALID_PARENT_NAME');
  return name;
}

/**
 * The identity comparison key of an ALREADY normalized name: exact text after NFC/whitespace normalization, compared without regard to
 * Latin letter case. There is deliberately NO Arabic letter normalization/folding (the same approved rule as the governorate match).
 */
export function parentNameKey(normalizedName: string): string {
  return normalizedName.toLowerCase();
}

/** True when two names (normalized or not) are the same full name for identity purposes. Invalid input never matches. */
export function isSameParentName(a: unknown, b: unknown): boolean {
  try {
    return parentNameKey(normalizeParentName(a)) === parentNameKey(normalizeParentName(b));
  } catch {
    return false;
  }
}
