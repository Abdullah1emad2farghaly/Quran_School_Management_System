import { PERSON_NAME_MAX_LENGTH, personNameKey } from '../../../08-identity-core/public';
import { studentError } from '../errors/student-errors';

export const STUDENT_NAME_MIN_PARTS = 3;
export const STUDENT_NAME_MAX_LENGTH = PERSON_NAME_MAX_LENGTH;

/**
 * The Student's full name (Master Specification §37): AT LEAST three parts. Normalized like every person name in the system: Unicode NFC,
 * every run of whitespace collapsed to one space, trimmed, no control characters, at most 200 characters. No Arabic letter folding.
 */
export function normalizeStudentName(input: unknown): string {
  if (typeof input !== 'string') throw studentError('INVALID_STUDENT_NAME');
  const name = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name === '' || /\p{Cc}/u.test(name) || [...name].length > STUDENT_NAME_MAX_LENGTH) throw studentError('INVALID_STUDENT_NAME');
  if (name.split(' ').length < STUDENT_NAME_MIN_PARTS) throw studentError('INVALID_STUDENT_NAME');
  return name;
}

/**
 * §37: the Student's SECOND name is the Parent's FIRST name and the THIRD name is the Parent's SECOND name. `parentName` is the Parent's
 * canonical three-part account name. Same comparison as identity matching (exact text, Latin case ignored, Arabic letters never folded).
 */
export function studentNameMatchesParent(studentName: string, parentName: string): boolean {
  const student = studentName.split(' ');
  const parent = parentName.split(' ');
  if (student.length < STUDENT_NAME_MIN_PARTS || parent.length < 2) return false;
  return personNameKey(student[1]!) === personNameKey(parent[0]!) && personNameKey(student[2]!) === personNameKey(parent[1]!);
}

/** Free-text reason of a lifecycle change (optional, at most 500 characters, no control characters). */
export const STUDENT_REASON_MAX_LENGTH = 500;
export function normalizeReason(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') throw studentError('INVALID_STUDENT_REASON');
  const reason = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (reason === '') return null;
  if (/\p{Cc}/u.test(reason) || [...reason].length > STUDENT_REASON_MAX_LENGTH) throw studentError('INVALID_STUDENT_REASON');
  return reason;
}
