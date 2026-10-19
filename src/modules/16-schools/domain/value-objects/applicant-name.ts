import { checkPersonName } from '../../../08-identity-core/public';
import { schoolError } from '../errors/school-errors';

export const APPLICANT_NAME_MAX_LENGTH = 200;

/**
 * The PERSONAL name of the person who creates an organization or submits a school request (and becomes its manager). It is NOT the
 * organization's or the school's name. Exactly three parts (the shared Identity rule, Module 08): Unicode NFC, whitespace collapsed,
 * trimmed, no control characters, at most 200 characters. Raises the already documented INVALID_APPLICANT_NAME.
 */
export function normalizeApplicantName(input: unknown): string {
  const checked = checkPersonName(input);
  if (!checked.ok) throw schoolError('INVALID_APPLICANT_NAME');
  return checked.name;
}
