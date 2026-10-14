import { schoolError } from '../errors/school-errors';

export const APPLICANT_NAME_MAX_LENGTH = 200;

/**
 * The applicant's name from the school submission form: Unicode NFC, whitespace collapsed, trimmed, 1..200 characters,
 * no control characters (the same convention as every other name in the project). No other rule is invented.
 */
export function normalizeApplicantName(input: unknown): string {
  if (typeof input !== 'string') throw schoolError('INVALID_APPLICANT_NAME');
  const name = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name === '' || /\p{Cc}/u.test(name) || [...name].length > APPLICANT_NAME_MAX_LENGTH) throw schoolError('INVALID_APPLICANT_NAME');
  return name;
}
