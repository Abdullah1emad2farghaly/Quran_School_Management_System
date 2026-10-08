import { identityError } from '../errors/identity-errors';
import { lastFourDigitsOf } from './phone-number';

/** Master Specification §23: 4-12 characters, no mandatory composition rule. */
export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 12;

/** Length is counted in characters (code points), so Arabic letters count as one each. */
export function assertPasswordPolicy(plain: unknown): asserts plain is string {
  if (typeof plain !== 'string') {
    throw identityError('INVALID_PASSWORD', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH });
  }
  const length = Array.from(plain).length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw identityError('INVALID_PASSWORD', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH });
  }
}

/**
 * Master Specification §24: initial password = last 4 digits of the phone number.
 * It does not force a password change. Used by the parent-creation workflow.
 */
export function initialPasswordFromPhone(phone: string): string {
  return lastFourDigitsOf(phone);
}
