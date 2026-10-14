import { unifiedAddressError } from '../errors/unified-address-errors';
import { normalizeAddressText } from '../value-objects/address-text';

export interface RawParentAddressParts {
  /** Matched exactly (after NFC + whitespace normalization) against the registered Governorates. */
  readonly governorateName: string;
  readonly centerName: string | null;
  readonly villageName: string | null;
}

/**
 * Parses the raw text `Governorate / Center or City / Village` (Excel cell or any raw input). Pure: no lookups.
 * - `/` is the ONLY separator; each component is NFC-normalized, trimmed and whitespace-collapsed.
 * - One to three components: `A`, `A/B` and `A/B/C` are accepted.
 * - Rejected (INVALID_PARENT_ADDRESS): not a string, an empty component (`A//C`, `A/B/`, `/A`, `A/ /C`, empty text),
 *   more than three components, a control character, a component longer than 200 characters.
 * A village without a center cannot be written in this format (the center position is mandatory before it).
 */
export function parseRawParentAddress(raw: unknown): RawParentAddressParts {
  if (typeof raw !== 'string') throw unifiedAddressError('INVALID_PARENT_ADDRESS', 'address');
  const components = raw.split('/').map((part) => normalizeAddressText(part, 'address'));
  if (components.length > 3 || components.some((part) => part === null)) throw unifiedAddressError('INVALID_PARENT_ADDRESS', 'address');
  const [governorateName, centerName, villageName] = components as string[];
  return { governorateName: governorateName as string, centerName: centerName ?? null, villageName: villageName ?? null };
}
