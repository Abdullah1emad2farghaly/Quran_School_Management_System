import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  formatOrganizationCode,
  isOrganizationCode,
  isOrganizationStatus,
  normalizeOrganizationName,
} from '../../../src/modules/13-organization-core/public';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : 'NOT_APP_ERROR';
  }
  return 'NO_ERROR';
};

describe('organization name', () => {
  it('accepts Arabic or English in the same single field', () => {
    expect(normalizeOrganizationName('مؤسسة النور لتحفيظ القرآن')).toBe('مؤسسة النور لتحفيظ القرآن');
    expect(normalizeOrganizationName('Al-Noor Quran Foundation')).toBe('Al-Noor Quran Foundation');
    expect(normalizeOrganizationName('مؤسسة Al-Noor')).toBe('مؤسسة Al-Noor');
  });

  it('trims, collapses whitespace and normalizes to NFC', () => {
    expect(normalizeOrganizationName('  Al   Noor \t Foundation \n')).toBe('Al Noor Foundation');
    expect(normalizeOrganizationName('e\u0301cole')).toBe('\u00e9cole');
  });

  it.each(['', '   ', '\n\t ', '\u00a0'])('rejects empty or whitespace-only %j', (value) => {
    expect(codeOf(() => normalizeOrganizationName(value))).toBe('INVALID_ORGANIZATION_NAME');
  });

  it.each([undefined, null, 5, {}, ['x']])('rejects non-strings %j', (value) => {
    expect(codeOf(() => normalizeOrganizationName(value))).toBe('INVALID_ORGANIZATION_NAME');
  });

  it('rejects control characters and names over the length limit', () => {
    expect(codeOf(() => normalizeOrganizationName('Al\u0000Noor'))).toBe('INVALID_ORGANIZATION_NAME');
    expect(codeOf(() => normalizeOrganizationName('a'.repeat(ORGANIZATION_NAME_MAX_LENGTH)))).toBe('NO_ERROR');
    expect(codeOf(() => normalizeOrganizationName('a'.repeat(ORGANIZATION_NAME_MAX_LENGTH + 1)))).toBe('INVALID_ORGANIZATION_NAME');
  });
});

describe('organization code and status', () => {
  it('formats ORG-000001 style codes', () => {
    expect(formatOrganizationCode(1)).toBe('ORG-000001');
    expect(formatOrganizationCode(123456)).toBe('ORG-123456');
    expect(() => formatOrganizationCode(0)).toThrow();
    expect(() => formatOrganizationCode(1_000_000)).toThrow();
  });

  it('validates the code format and the approved statuses only', () => {
    expect(isOrganizationCode('ORG-000001')).toBe(true);
    for (const bad of ['ORG-1', 'org-000001', 'ORG-0000012', 'ORG000001', '', null]) expect(isOrganizationCode(bad)).toBe(false);
    expect(isOrganizationStatus('ACTIVE')).toBe(true);
    expect(isOrganizationStatus('INACTIVE')).toBe(true);
    for (const bad of ['PENDING', 'active', '', null]) expect(isOrganizationStatus(bad)).toBe(false);
  });
});
