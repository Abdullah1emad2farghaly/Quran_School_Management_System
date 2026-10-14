import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { PARENT_ADDRESS_TEXT_MAX_LENGTH, normalizeAddressText, parseRawParentAddress } from '../../../src/modules/15-unified-address/public';

const codeOf = (work: () => unknown) => {
  try {
    work();
  } catch (e) {
    return e instanceof AppError ? e.code : 'NOT_APP_ERROR';
  }
  return 'NO_ERROR';
};
const fieldOf = (work: () => unknown) => {
  try {
    work();
  } catch (e) {
    return (e as AppError).details;
  }
  return undefined;
};

describe('normalizeAddressText', () => {
  it('applies NFC, collapses whitespace and trims', () => {
    expect(normalizeAddressText('  قرية   النور \t')).toBe('قرية النور');
    expect(normalizeAddressText('e\u0301')).toBe('\u00e9'); // NFC composes
  });

  it('treats null, undefined and blank text as missing (NULL)', () => {
    for (const blank of [null, undefined, '', '   ', '\t\n']) expect(normalizeAddressText(blank)).toBeNull();
  });

  it('never folds Arabic letter variants', () => {
    expect(normalizeAddressText('أسيوط')).toBe('أسيوط');
    expect(normalizeAddressText('أسيوط')).not.toBe(normalizeAddressText('اسيوط'));
    expect(normalizeAddressText('مدينة')).not.toBe(normalizeAddressText('مدينه'));
  });

  it('accepts exactly 200 characters and rejects 201, counting characters not bytes', () => {
    expect(normalizeAddressText('ق'.repeat(PARENT_ADDRESS_TEXT_MAX_LENGTH))).toHaveLength(200);
    expect(codeOf(() => normalizeAddressText('ق'.repeat(201)))).toBe('INVALID_PARENT_ADDRESS');
  });

  it('rejects non-text and control characters, naming the field', () => {
    expect(codeOf(() => normalizeAddressText(42, 'center'))).toBe('INVALID_PARENT_ADDRESS');
    expect(codeOf(() => normalizeAddressText('a\u0000b'))).toBe('INVALID_PARENT_ADDRESS');
    expect(fieldOf(() => normalizeAddressText({}, 'village'))).toEqual([{ field: 'village', code: 'INVALID_PARENT_ADDRESS' }]);
  });
});

describe('parseRawParentAddress', () => {
  it('accepts A, A/B and A/B/C, trimming each part', () => {
    expect(parseRawParentAddress('المنيا')).toEqual({ governorateName: 'المنيا', centerName: null, villageName: null });
    expect(parseRawParentAddress(' المنيا /  سمالوط ')).toEqual({ governorateName: 'المنيا', centerName: 'سمالوط', villageName: null });
    expect(parseRawParentAddress('المنيا / سمالوط / قرية   النور')).toEqual({ governorateName: 'المنيا', centerName: 'سمالوط', villageName: 'قرية النور' });
  });

  it('rejects every empty component: A//C, A/B/, /A, A/ /C, A/, empty and blank text', () => {
    for (const bad of ['A//C', 'A/B/', '/A', 'A/ /C', 'A/', '/', '', '   ', 'A/B/C/']) {
      expect(codeOf(() => parseRawParentAddress(bad))).toBe('INVALID_PARENT_ADDRESS');
    }
  });

  it('rejects more than three components, non-text input, control characters and over-long parts', () => {
    expect(codeOf(() => parseRawParentAddress('A/B/C/D'))).toBe('INVALID_PARENT_ADDRESS');
    for (const bad of [null, undefined, 7, {}]) expect(codeOf(() => parseRawParentAddress(bad))).toBe('INVALID_PARENT_ADDRESS');
    expect(codeOf(() => parseRawParentAddress('A/B\u0007/C'))).toBe('INVALID_PARENT_ADDRESS');
    expect(codeOf(() => parseRawParentAddress(`A/${'x'.repeat(201)}`))).toBe('INVALID_PARENT_ADDRESS');
  });

  it('uses / as the only separator', () => {
    expect(parseRawParentAddress('المنيا - سمالوط')).toEqual({ governorateName: 'المنيا - سمالوط', centerName: null, villageName: null });
    expect(parseRawParentAddress('المنيا\\سمالوط').centerName).toBeNull();
    expect(parseRawParentAddress('المنيا،سمالوط').centerName).toBeNull();
  });
});
