import { studentError } from '../errors/student-errors';

export const NATIONAL_ID_LENGTH = 14;

/** Arabic-Indic (U+0660..0669) and Eastern Arabic-Indic (U+06F0..06F9) digits are the same digits typed on an Arabic keyboard. */
const toAsciiDigits = (text: string): string =>
  text.replace(/[\u0660-\u0669\u06F0-\u06F9]/gu, (c) => String(c.codePointAt(0)! >= 0x06f0 ? c.codePointAt(0)! - 0x06f0 : c.codePointAt(0)! - 0x0660));

/**
 * The Egyptian National ID (Master Specification §38): required, EXACTLY 14 digits. Surrounding whitespace is trimmed and Arabic-Indic digits
 * are converted to ASCII; nothing else is accepted (no spaces or dashes inside, no letters). Only the format is validated: no century,
 * birth-date or governorate-code rule is invented. Anything else is INVALID_STUDENT_NATIONAL_ID.
 */
export function normalizeNationalId(input: unknown): string {
  if (typeof input !== 'string') throw studentError('INVALID_STUDENT_NATIONAL_ID');
  const value = toAsciiDigits(input.trim());
  if (!/^[0-9]{14}$/.test(value)) throw studentError('INVALID_STUDENT_NATIONAL_ID');
  return value;
}
