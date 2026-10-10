import { organizationError } from '../errors/organization-errors';

export const ORGANIZATION_NAME_MAX_LENGTH = 200;

/**
 * One required name field; Arabic OR English (no separate fields, no language required).
 * Normalization: Unicode NFC, trimmed, runs of whitespace collapsed to one space.
 * Rejected: not a string, empty or whitespace-only, control characters, longer than 200 characters.
 */
export function normalizeOrganizationName(input: unknown): string {
  if (typeof input !== 'string') throw organizationError('INVALID_ORGANIZATION_NAME');
  const name = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name === '' || /\p{Cc}/u.test(name) || [...name].length > ORGANIZATION_NAME_MAX_LENGTH) {
    throw organizationError('INVALID_ORGANIZATION_NAME');
  }
  return name;
}
