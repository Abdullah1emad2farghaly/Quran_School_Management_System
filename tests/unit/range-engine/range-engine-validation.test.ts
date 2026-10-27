import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { quranError } from '../../../src/modules/21-quran-structure/public';
import { QuranRangeEngine, type QuranRangeRequest, type QuranRangeSource } from '../../../src/modules/22-quran-range-engine/public';
import { createMiniQuran } from '../../helpers/range-mini-quran';

const valid: QuranRangeRequest = { unit: 'AYAHS', direction: 'FORWARD', amount: 3, start: { surah: 2, ayah: 1 } };
const bad = (patch: Record<string, unknown>) => ({ ...valid, ...patch }) as unknown as QuranRangeRequest;

async function codeOf(source: QuranRangeSource, request: QuranRangeRequest): Promise<{ code: string; kind: string }> {
  try {
    await new QuranRangeEngine(source).calculate(request);
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, kind: error.kind };
    throw error;
  }
  return { code: 'OK', kind: 'OK' };
}

describe('request validation (nothing is read from the Quran until the request itself is valid)', () => {
  const cases: Array<[string, QuranRangeRequest, string]> = [
    ['an unknown unit', bad({ unit: 'WORDS' }), 'QURAN_RANGE_UNIT_INVALID'],
    ['a lower-case unit', bad({ unit: 'ayahs' }), 'QURAN_RANGE_UNIT_INVALID'],
    ['a missing unit', bad({ unit: undefined }), 'QURAN_RANGE_UNIT_INVALID'],
    ['the old name "FACES"', bad({ unit: 'FACES' }), 'QURAN_RANGE_UNIT_INVALID'],
    ['an unknown direction', bad({ direction: 'SIDEWAYS' }), 'QURAN_RANGE_DIRECTION_INVALID'],
    ['a missing direction', bad({ direction: undefined }), 'QURAN_RANGE_DIRECTION_INVALID'],
    ['amount 0', bad({ amount: 0 }), 'QURAN_RANGE_AMOUNT_INVALID'],
    ['a negative amount', bad({ amount: -2 }), 'QURAN_RANGE_AMOUNT_INVALID'],
    ['a fractional amount', bad({ amount: 1.5 }), 'QURAN_RANGE_AMOUNT_INVALID'],
    ['an amount given as text', bad({ amount: '3' }), 'QURAN_RANGE_AMOUNT_INVALID'],
    ['NaN', bad({ amount: Number.NaN }), 'QURAN_RANGE_AMOUNT_INVALID'],
    ['Infinity', bad({ amount: Number.POSITIVE_INFINITY }), 'QURAN_RANGE_AMOUNT_INVALID'],
    ['an amount beyond the safe integers', bad({ amount: Number.MAX_SAFE_INTEGER + 2 }), 'QURAN_RANGE_AMOUNT_INVALID'],
    ['a missing amount', bad({ amount: undefined }), 'QURAN_RANGE_AMOUNT_INVALID'],
    ['a missing start', bad({ start: undefined }), 'QURAN_RANGE_START_INVALID'],
    ['a null start', bad({ start: null }), 'QURAN_RANGE_START_INVALID'],
    ['a start without a surah', bad({ start: { ayah: 1 } }), 'QURAN_RANGE_START_INVALID'],
    ['surah 0', bad({ start: { surah: 0 } }), 'QURAN_RANGE_START_INVALID'],
    ['a surah the Quran does not have', bad({ start: { surah: 5 } }), 'QURAN_RANGE_START_INVALID'],
    ['a fractional surah', bad({ start: { surah: 1.5 } }), 'QURAN_RANGE_START_INVALID'],
    ['a surah given as text', bad({ start: { surah: '2' } }), 'QURAN_RANGE_START_INVALID'],
    ['ayah 0', bad({ start: { surah: 2, ayah: 0 } }), 'QURAN_RANGE_START_INVALID'],
    ['an ayah beyond the surah (2:7)', bad({ start: { surah: 2, ayah: 7 } }), 'QURAN_RANGE_START_INVALID'],
    ['a fractional ayah', bad({ start: { surah: 2, ayah: 1.5 } }), 'QURAN_RANGE_START_INVALID'],
    ['an ayah given as text', bad({ start: { surah: 2, ayah: '1' } }), 'QURAN_RANGE_START_INVALID'],
    ['a null ayah is not "no ayah" for a non-surah-only form (it is accepted as surah-only)', bad({ start: { surah: 2, ayah: null } }), 'OK'],
  ];
  it.each(cases)('%s', async (_name, request, code) => {
    const source = createMiniQuran();
    const outcome = await codeOf(source, request);
    expect(outcome.code).toBe(code);
    if (code !== 'OK') expect(outcome.kind).toBe('VALIDATION');
  });

  it('checks unit, direction, amount and the SHAPE of the start before reading the Quran', async () => {
    for (const request of [bad({ unit: 'WORDS' }), bad({ direction: 'X' }), bad({ amount: 0 }), bad({ start: null }), bad({ start: { surah: '2' } })]) {
      const source = createMiniQuran();
      await codeOf(source, request);
      expect(source.calls.count).toBe(0);
    }
  });

  it('accepts all five units and both directions', async () => {
    for (const unit of ['SURAHS', 'AYAHS', 'QUARTERS', 'PAGES', 'LINES'] as const) {
      for (const direction of ['FORWARD', 'BACKWARD'] as const) {
        expect((await codeOf(createMiniQuran(), { unit, direction, amount: 1, start: { surah: 2, ayah: 3 } })).code).toBe('OK');
      }
    }
  });
});

describe('the dataset', () => {
  it('passes Module 21\'s QURAN_DATASET_NOT_IMPORTED through unchanged', async () => {
    const notImported = (): never => { throw quranError('QURAN_DATASET_NOT_IMPORTED'); };
    const source: QuranRangeSource = { listSurahs: notImported, getAyah: notImported, getAyahByGlobalPosition: notImported, listQuarters: notImported, getPage: notImported };
    expect(await codeOf(source, valid)).toEqual({ code: 'QURAN_DATASET_NOT_IMPORTED', kind: 'NOT_FOUND' });
  });

  it('reports a layout that contradicts itself as an internal error instead of returning a wrong range', async () => {
    const mini = createMiniQuran();
    // the ayah says it starts on page 2 line 3, but that page no longer has such a text line
    const broken: QuranRangeSource = { ...mini, getPage: async (page) => { const p = await mini.getPage(page); return p && { ...p, lines: p.lines.filter((l) => !(l.page === 2 && l.line === 3)) }; } };
    expect(await codeOf(broken, { unit: 'LINES', direction: 'FORWARD', amount: 2, start: { surah: 2, ayah: 1 } })).toEqual({ code: 'QURAN_RANGE_LAYOUT_INCONSISTENT', kind: 'INTERNAL' });
  });
});
