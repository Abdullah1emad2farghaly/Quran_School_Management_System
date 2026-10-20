import { checkPersonName, isSamePersonName } from '../../../08-identity-core/public';
import { teacherError } from '../errors/teacher-errors';

/**
 * The Teacher's personal name: EXACTLY three parts, by the shared Identity rule (Module 08, the same rule as the organization creator, the
 * school applicant and the Parent). It is stored once, on the account (`users.full_name`), never on the Teacher record.
 */
export function normalizeTeacherName(input: unknown): string {
  const checked = checkPersonName(input);
  if (!checked.ok) throw teacherError('INVALID_TEACHER_NAME');
  return checked.name;
}

/** The identity match used when a phone already belongs to an account: the same normalized three-part name (Arabic letters never folded). */
export const isSameTeacherName = isSamePersonName;
