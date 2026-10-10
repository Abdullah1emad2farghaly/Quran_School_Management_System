/** `ORG-000001`: stable, unique, human-readable. UUID stays the technical identifier. */
const CODE_PATTERN = /^ORG-\d{6}$/;

export function formatOrganizationCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999_999) throw new RangeError('Organization code sequence out of range');
  return `ORG-${String(sequence).padStart(6, '0')}`;
}

export function isOrganizationCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}
