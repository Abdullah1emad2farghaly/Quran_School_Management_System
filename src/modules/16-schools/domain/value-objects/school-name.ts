import { schoolError } from '../errors/school-errors';

export const SCHOOL_NAME_MAX_LENGTH = 200;

/**
 * School name policy: Unicode NFC, runs of whitespace collapsed to one space, trimmed, 1..200 characters, no control
 * characters. Uniqueness is per organization (REJECTED requests do not hold their name) and is compared by the
 * database under `utf8mb4_unicode_ci`: case-insensitive and accent/diacritic-insensitive (so Arabic names that differ only by
 * hamza forms or tashkeel collide). The in-memory repository approximates this with NFC + lower case.
 */
export function normalizeSchoolName(input: unknown): string {
  if (typeof input !== 'string') throw schoolError('INVALID_SCHOOL_NAME');
  const name = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name === '' || /\p{Cc}/u.test(name) || [...name].length > SCHOOL_NAME_MAX_LENGTH) throw schoolError('INVALID_SCHOOL_NAME');
  return name;
}

/** Comparison key used by the in-memory repository (the database uses its collation). */
export const schoolNameKey = (name: string): string => name.normalize('NFC').toLowerCase();
