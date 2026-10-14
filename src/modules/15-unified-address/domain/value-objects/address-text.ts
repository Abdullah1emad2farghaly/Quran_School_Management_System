import { unifiedAddressError, type ParentAddressField } from '../errors/unified-address-errors';

/** Maximum length (in characters) of each free-text address component; same as the geography and organization names. */
export const PARENT_ADDRESS_TEXT_MAX_LENGTH = 200;

/**
 * Normalizes ONE address component (Governorate name, Center/City or Village).
 * Unicode NFC, runs of whitespace collapsed to one space, trimmed. Arabic letter variants (أ/ا, ة/ه, ى/ي) are NEVER
 * folded. Returns `null` for a missing or blank value (`null`, `undefined`, whitespace only).
 * Rejected (INVALID_PARENT_ADDRESS): not a string, a control character, more than 200 characters.
 */
export function normalizeAddressText(input: unknown, field: ParentAddressField = 'address'): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') throw unifiedAddressError('INVALID_PARENT_ADDRESS', field);
  const text = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (text === '') return null;
  if (/\p{Cc}/u.test(text) || [...text].length > PARENT_ADDRESS_TEXT_MAX_LENGTH) throw unifiedAddressError('INVALID_PARENT_ADDRESS', field);
  return text;
}
