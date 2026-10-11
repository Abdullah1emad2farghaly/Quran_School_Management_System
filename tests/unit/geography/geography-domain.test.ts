import { describe, expect, it } from 'vitest';
import { AppError, type Clock } from '../../../src/modules/00-shared-kernel/public';
import {
  EGYPT_COUNTRY_NAME,
  EGYPT_GOVERNORATE_NAMES,
  GEOGRAPHY_NAME_MAX_LENGTH,
  GeographyNode,
  formatGeographyCode,
  isGeographyCode,
  normalizeGeographyName,
} from '../../../src/modules/14-geography/public';

const clock: Clock = { now: () => new Date('2026-10-10T10:00:00Z') };
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : e instanceof RangeError ? 'RANGE_ERROR' : 'NOT_APP_ERROR';
  }
  return 'NO_ERROR';
};

describe('geography name', () => {
  it('accepts Arabic or English, trims, collapses whitespace, NFC', () => {
    expect(normalizeGeographyName('  كفر   الشيخ ')).toBe('كفر الشيخ');
    expect(normalizeGeographyName('Port Said')).toBe('Port Said');
    expect(normalizeGeographyName('e\u0301')).toBe('\u00e9');
  });
  it.each(['', '   ', '\n\t', 5, null, undefined, 'a\u0000b', 'x'.repeat(GEOGRAPHY_NAME_MAX_LENGTH + 1)])('rejects %j', (value) => {
    expect(codeOf(() => normalizeGeographyName(value))).toBe('INVALID_GEOGRAPHY_NAME');
  });
});

describe('geography codes', () => {
  it('uses a per-level prefix and six digits, case-sensitively', () => {
    expect(formatGeographyCode('COUNTRY', 1)).toBe('CNT-000001');
    expect(formatGeographyCode('GOVERNORATE', 27)).toBe('GOV-000027');
    expect(formatGeographyCode('CENTER', 5)).toBe('CTR-000005');
    expect(formatGeographyCode('VILLAGE', 123456)).toBe('VIL-123456');
    expect(isGeographyCode('GOVERNORATE', 'GOV-000001')).toBe(true);
    for (const bad of ['gov-000001', 'Gov-000001', 'GOV-1', 'CTR-000001', 'GOV-00000A']) expect(isGeographyCode('GOVERNORATE', bad)).toBe(false);
    expect(() => formatGeographyCode('VILLAGE', 0)).toThrow();
  });
});

describe('GeographyNode', () => {
  const make = (over: Partial<Parameters<typeof GeographyNode.create>[0]> = {}) =>
    GeographyNode.create({ level: 'GOVERNORATE', name: 'القاهرة', code: 'GOV-000001', parentId: 'country-1', clock, ...over });

  it('is created ACTIVE with only the approved fields', () => {
    const node = make();
    expect(node).toMatchObject({ level: 'GOVERNORATE', code: 'GOV-000001', name: 'القاهرة', status: 'ACTIVE', parentId: 'country-1', kind: null });
  });
  it('a country has no parent; every other level needs one', () => {
    expect(make({ level: 'COUNTRY', code: 'CNT-000001', parentId: null }).parentId).toBeNull();
    expect(codeOf(() => make({ level: 'COUNTRY', code: 'CNT-000001', parentId: 'x' }))).toBe('GEOGRAPHY_PARENT_NOT_FOUND');
    for (const level of ['GOVERNORATE', 'CENTER', 'VILLAGE'] as const) {
      expect(codeOf(() => make({ level, code: `${{ GOVERNORATE: 'GOV', CENTER: 'CTR', VILLAGE: 'VIL' }[level]}-000001`, parentId: null, kind: 'CENTER' }))).toBe('GEOGRAPHY_PARENT_NOT_FOUND');
    }
  });
  it('kind exists only for the Center/City level and must be CENTER or CITY', () => {
    expect(make({ level: 'CENTER', code: 'CTR-000001', kind: 'CITY' }).kind).toBe('CITY');
    expect(codeOf(() => make({ level: 'CENTER', code: 'CTR-000001' }))).toBe('RANGE_ERROR');
    expect(codeOf(() => make({ level: 'CENTER', code: 'CTR-000001', kind: 'TOWN' as never }))).toBe('RANGE_ERROR');
    expect(codeOf(() => make({ kind: 'CITY' }))).toBe('RANGE_ERROR'); // a governorate has no kind
  });
  it('rejects a code of another level and an invalid name', () => {
    expect(codeOf(() => make({ code: 'CTR-000001' }))).toBe('RANGE_ERROR');
    expect(codeOf(() => make({ name: '  ' }))).toBe('INVALID_GEOGRAPHY_NAME');
  });
});

describe('Egypt reference data', () => {
  it('is exactly Egypt and 27 distinct, valid governorate names (no centers, cities or villages)', () => {
    expect(EGYPT_COUNTRY_NAME).toBe('مصر');
    expect(EGYPT_GOVERNORATE_NAMES).toHaveLength(27);
    expect(new Set(EGYPT_GOVERNORATE_NAMES).size).toBe(27);
    for (const name of EGYPT_GOVERNORATE_NAMES) expect(normalizeGeographyName(name)).toBe(name);
  });
});
