import { geographyError } from '../errors/geography-errors';

export const GEOGRAPHY_NAME_MAX_LENGTH = 200;

/**
 * One required name field per node, Arabic OR English (same rules as the Main Organization name).
 * Normalization: Unicode NFC, trimmed, whitespace runs collapsed. Rejected: not a string, empty/whitespace-only,
 * control characters, more than 200 characters.
 */
export function normalizeGeographyName(input: unknown): string {
  if (typeof input !== 'string') throw geographyError('INVALID_GEOGRAPHY_NAME');
  const name = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name === '' || /\p{Cc}/u.test(name) || [...name].length > GEOGRAPHY_NAME_MAX_LENGTH) {
    throw geographyError('INVALID_GEOGRAPHY_NAME');
  }
  return name;
}
