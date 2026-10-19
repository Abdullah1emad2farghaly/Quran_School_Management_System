import { identityError } from '../errors/identity-errors';

export const PERSON_NAME_PARTS = 3;
export const PERSON_NAME_MAX_LENGTH = 200;

export type PersonNameFailure = 'NOT_TEXT' | 'EMPTY' | 'CONTROL_CHARACTERS' | 'TOO_LONG' | 'WRONG_PART_COUNT';

/**
 * The single rule for a person's name wherever one is collected or compared in the system (organization creator, school applicant /
 * School Manager, Parent): EXACTLY three non-empty parts separated by whitespace (approved decision). Unicode NFC, every run of
 * whitespace collapsed to one space, trimmed, no control characters, at most 200 characters. No other rule is invented (no digit or
 * script restriction) and no Arabic letter folding is applied: أحمد and احمد are different names.
 * A whitespace-only or missing part cannot exist: after collapsing, "a  b" is two parts, not three with an empty one.
 * Returns the failure reason instead of throwing so each caller can raise its own, already documented, error code.
 */
export function checkPersonName(input: unknown): { ok: true; name: string } | { ok: false; reason: PersonNameFailure } {
  if (typeof input !== 'string') return { ok: false, reason: 'NOT_TEXT' };
  const name = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name === '') return { ok: false, reason: 'EMPTY' };
  if (/\p{Cc}/u.test(name)) return { ok: false, reason: 'CONTROL_CHARACTERS' };
  if ([...name].length > PERSON_NAME_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  if (name.split(' ').length !== PERSON_NAME_PARTS) return { ok: false, reason: 'WRONG_PART_COUNT' };
  return { ok: true, name };
}

/** Normalizes a person name or throws INVALID_PERSON_NAME (VALIDATION). */
export function normalizePersonName(input: unknown): string {
  const checked = checkPersonName(input);
  if (!checked.ok) throw identityError('INVALID_PERSON_NAME');
  return checked.name;
}

/** Comparison key of an ALREADY normalized name: exact text, Latin letter case ignored, Arabic letters never folded. */
export function personNameKey(normalizedName: string): string {
  return normalizedName.toLowerCase();
}

/** True when both values are valid person names and the same name for identity matching. Anything invalid never matches. */
export function isSamePersonName(a: unknown, b: unknown): boolean {
  const x = checkPersonName(a);
  const y = checkPersonName(b);
  return x.ok && y.ok && personNameKey(x.name) === personNameKey(y.name);
}
