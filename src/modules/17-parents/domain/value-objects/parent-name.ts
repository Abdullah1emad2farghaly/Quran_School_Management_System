import { checkPersonName, isSamePersonName, PERSON_NAME_MAX_LENGTH, PERSON_NAME_PARTS } from '../../../08-identity-core/public';
import { parentError } from '../errors/parent-errors';

export const PARENT_NAME_MAX_LENGTH = PERSON_NAME_MAX_LENGTH;
export const PARENT_NAME_PARTS = PERSON_NAME_PARTS;

/**
 * The Parent's personal name: EXACTLY three parts, by the shared Identity rule (Module 08, one rule for the organization creator, the school
 * applicant and the Parent). The name is stored once, on the account (`users.full_name`), never on the Parent record.
 */
export function normalizeParentName(input: unknown): string {
  const checked = checkPersonName(input);
  if (!checked.ok) throw parentError('INVALID_PARENT_NAME');
  return checked.name;
}

/** The identity match used when a phone already belongs to an account: the same normalized three-part name (Arabic letters never folded). */
export const isSameParentName = isSamePersonName;
