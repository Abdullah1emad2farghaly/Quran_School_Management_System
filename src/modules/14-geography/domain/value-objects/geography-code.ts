import { CODE_PREFIX, type GeographyLevel } from './geography-level';

/** `GOV-000001`: stable, unique per table, human-readable. The UUID stays the technical identifier. */
export function formatGeographyCode(level: GeographyLevel, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999_999) throw new RangeError('Geography code sequence out of range');
  return `${CODE_PREFIX[level]}-${String(sequence).padStart(6, '0')}`;
}

export function isGeographyCode(level: GeographyLevel, value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^${CODE_PREFIX[level]}-\\d{6}$`).test(value);
}
