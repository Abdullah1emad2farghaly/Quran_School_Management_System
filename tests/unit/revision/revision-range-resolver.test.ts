import { describe, expect, it } from 'vitest';
import { QuranRangeEngine } from '../../../src/modules/22-quran-range-engine/public';
import { RevisionRangeResolver } from '../../../src/modules/28-revision/public';
import { createMiniQuran } from '../../helpers/range-mini-quran';

/**
 * The mini Quran (hand-built, see range-mini-quran.ts): surahs S1 = 1..3, S2 = 4..9, S3 = 10..13, S4 = 14..15 (global ayahs); quarters start at g1, g5, g10, g13;
 * page 1 = g1-3, page 2 = g4..g8 (g8 CROSSES onto page 3), page 3 = g8 (rest), g9, g10, page 4 = g11..g15.
 * Surah 2 = global 4..9, surah 3 = global 10..13, surah 4 = global 14..15.
 */
const resolver = () => new RevisionRangeResolver({ engine: new QuranRangeEngine(createMiniQuran()), quran: createMiniQuran() });
const segs = async (input: unknown) => (await resolver().resolve(input)).segments.map((s) => [s.surah, s.firstAyah, s.lastAyah]);
const reject = (input: unknown, code: string) => expect(resolver().resolve(input)).rejects.toMatchObject({ code });

describe('Form A, AYAHS: start = the ayah number inside the required surah', () => {
  it('counts ayahs from that ayah, forward and backward (and may cross surahs)', async () => {
    expect(await segs({ unit: 'AYAHS', surah: 2, start: 2, amount: 3, direction: 'FORWARD' })).toEqual([[2, 2, 4]]);
    expect(await segs({ unit: 'AYAHS', surah: 2, start: 4, amount: 3, direction: 'BACKWARD' })).toEqual([[2, 2, 4]]);
    expect(await segs({ unit: 'AYAHS', surah: 2, start: 5, amount: 3, direction: 'FORWARD' })).toEqual([[2, 5, 6], [3, 1, 1]]);
  });
  it('the surah is required, and an ayah that does not exist is refused by Module 22', async () => {
    await reject({ unit: 'AYAHS', start: 2, amount: 3, direction: 'FORWARD' }, 'REVISION_SURAH_REQUIRED');
    await reject({ unit: 'AYAHS', surah: 2, start: 7, amount: 1, direction: 'FORWARD' }, 'QURAN_RANGE_START_INVALID');
  });
  it('keeps what was entered and the Module 22 request it became', async () => {
    const r = await resolver().resolve({ unit: 'AYAHS', surah: 2, start: 2, amount: 3, direction: 'FORWARD' });
    expect(r.input).toEqual({ form: 'START_UNIT_AMOUNT', unit: 'AYAHS', surah: 2, start: 2, amount: 3, direction: 'FORWARD' });
    expect(r.request).toEqual({ start: { surah: 2, ayah: 2 }, unit: 'AYAHS', amount: 3, direction: 'FORWARD' });
    expect([r.first, r.last, r.ayahCount]).toEqual([{ surah: 2, ayah: 2 }, { surah: 2, ayah: 4 }, 3]);
  });
});

describe('Form A, SURAHS: start = the surah number in Mushaf order (no separate surah)', () => {
  it('counts complete surahs forward and backward', async () => {
    expect(await segs({ unit: 'SURAHS', start: 2, amount: 2, direction: 'FORWARD' })).toEqual([[2, 1, 6], [3, 1, 4]]);
    expect(await segs({ unit: 'SURAHS', start: 3, amount: 2, direction: 'BACKWARD' })).toEqual([[2, 1, 6], [3, 1, 4]]);
  });
  it('a separate surah is not allowed, and a surah that does not exist is refused', async () => {
    await reject({ unit: 'SURAHS', surah: 2, start: 2, amount: 1, direction: 'FORWARD' }, 'REVISION_SURAH_NOT_ALLOWED');
    await reject({ unit: 'SURAHS', start: 9, amount: 1, direction: 'FORWARD' }, 'QURAN_RANGE_START_INVALID');
    await reject({ unit: 'SURAHS', start: 4, amount: 2, direction: 'FORWARD' }, 'QURAN_RANGE_EXCEEDS_QURAN');
  });
});

describe('Form A, PAGES: start = the Mushaf page number (no separate surah)', () => {
  it('forward from a page covers exactly the pages asked for', async () => {
    expect(await segs({ unit: 'PAGES', start: 1, amount: 1, direction: 'FORWARD' })).toEqual([[1, 1, 3]]);
    expect(await segs({ unit: 'PAGES', start: 4, amount: 1, direction: 'FORWARD' })).toEqual([[3, 2, 4], [4, 1, 2]]);
  });
  it('an ayah that began on the previous page is not the anchor: page 3 starts at the first ayah that BEGINS on it (g9)', async () => {
    // g8 (2:5) crosses from page 2 onto page 3, so page 3's first ayah that begins on it is g9 = 2:6; one page then ends at the end of page 3 (g10 = 3:1).
    expect(await segs({ unit: 'PAGES', start: 3, amount: 1, direction: 'FORWARD' })).toEqual([[2, 6, 6], [3, 1, 1]]);
    expect((await resolver().resolve({ unit: 'PAGES', start: 3, amount: 1, direction: 'FORWARD' })).request.start).toEqual({ surah: 2, ayah: 6 });
  });
  it('backward from a page ends at the last ayah that ENDS on it', async () => {
    expect(await segs({ unit: 'PAGES', start: 1, amount: 1, direction: 'BACKWARD' })).toEqual([[1, 1, 3]]);
    // page 2's last text line is g8 which runs on to page 3, so the anchor is g7 (2:4) and one page backward starts where page 2 starts (2:1).
    expect((await resolver().resolve({ unit: 'PAGES', start: 2, amount: 1, direction: 'BACKWARD' })).request.start).toEqual({ surah: 2, ayah: 4 });
    expect(await segs({ unit: 'PAGES', start: 2, amount: 1, direction: 'BACKWARD' })).toEqual([[2, 1, 4]]);
  });
  it('several pages, and a page that does not exist or goes past the Quran', async () => {
    expect(await segs({ unit: 'PAGES', start: 1, amount: 2, direction: 'FORWARD' })).toEqual([[1, 1, 3], [2, 1, 5]]);
    await reject({ unit: 'PAGES', start: 5, amount: 1, direction: 'FORWARD' }, 'QURAN_RANGE_START_INVALID');
    await reject({ unit: 'PAGES', start: 4, amount: 2, direction: 'FORWARD' }, 'QURAN_RANGE_EXCEEDS_QURAN');
    await reject({ unit: 'PAGES', surah: 2, start: 1, amount: 1, direction: 'FORWARD' }, 'REVISION_SURAH_NOT_ALLOWED');
  });
});

describe('Form A, QUARTERS: start = the quarter number (no separate surah)', () => {
  // quarters start at g1, g5, g10, g13 -> Q1 = g1..g4, Q2 = g5..g9, Q3 = g10..g12, Q4 = g13..g15
  it('forward from a quarter begins at its first ayah', async () => {
    expect(await segs({ unit: 'QUARTERS', start: 2, amount: 1, direction: 'FORWARD' })).toEqual([[2, 2, 6]]);
    expect(await segs({ unit: 'QUARTERS', start: 3, amount: 1, direction: 'FORWARD' })).toEqual([[3, 1, 3]]);
    expect(await segs({ unit: 'QUARTERS', start: 3, amount: 2, direction: 'FORWARD' })).toEqual([[3, 1, 4], [4, 1, 2]]);
  });
  it('backward from a quarter ends at its last ayah (the ayah before the next quarter, or the last ayah of the Quran for the last quarter)', async () => {
    expect(await segs({ unit: 'QUARTERS', start: 3, amount: 1, direction: 'BACKWARD' })).toEqual([[3, 1, 3]]);
    expect(await segs({ unit: 'QUARTERS', start: 4, amount: 1, direction: 'BACKWARD' })).toEqual([[3, 4, 4], [4, 1, 2]]);
    expect((await resolver().resolve({ unit: 'QUARTERS', start: 3, amount: 1, direction: 'BACKWARD' })).request.start).toEqual({ surah: 3, ayah: 3 });
  });
  it('a quarter that does not exist, a separate surah, or too many quarters are refused', async () => {
    await reject({ unit: 'QUARTERS', start: 5, amount: 1, direction: 'FORWARD' }, 'QURAN_RANGE_START_INVALID');
    await reject({ unit: 'QUARTERS', surah: 2, start: 1, amount: 1, direction: 'FORWARD' }, 'REVISION_SURAH_NOT_ALLOWED');
    await reject({ unit: 'QUARTERS', start: 4, amount: 2, direction: 'FORWARD' }, 'QURAN_RANGE_EXCEEDS_QURAN');
  });
});

describe('Form B: From Surah X to Surah Y (complete surahs, both ends included)', () => {
  it('is translated to the existing engine: start = X, unit SURAHS, amount = |Y - X| + 1', async () => {
    const forward = await resolver().resolve({ fromSurah: 2, toSurah: 4 });
    expect(forward.request).toEqual({ start: { surah: 2, ayah: null }, unit: 'SURAHS', amount: 3, direction: 'FORWARD' });
    expect(forward.segments.map((x) => [x.surah, x.firstAyah, x.lastAyah])).toEqual([[2, 1, 6], [3, 1, 4], [4, 1, 2]]);
    expect(forward.input).toEqual({ form: 'FROM_SURAH_TO_SURAH', fromSurah: 2, toSurah: 4 });
  });
  it('supports the backward direction (X after Y) and a single surah (X = Y)', async () => {
    const backward = await resolver().resolve({ fromSurah: 4, toSurah: 2 });
    expect(backward.request).toEqual({ start: { surah: 4, ayah: null }, unit: 'SURAHS', amount: 3, direction: 'BACKWARD' });
    expect(backward.segments.map((x) => [x.surah, x.firstAyah, x.lastAyah])).toEqual([[2, 1, 6], [3, 1, 4], [4, 1, 2]]); // always in Quran order
    expect(await segs({ fromSurah: 3, toSurah: 3 })).toEqual([[3, 1, 4]]);
  });
  it('the same ayahs as the equivalent Start + Unit + Amount range (so evaluation against an assignment works across forms)', async () => {
    expect(await segs({ fromSurah: 2, toSurah: 3 })).toEqual(await segs({ unit: 'SURAHS', start: 2, amount: 2, direction: 'FORWARD' }));
  });
  it('a surah that does not exist at either end is refused', async () => {
    await reject({ fromSurah: 2, toSurah: 9 }, 'QURAN_RANGE_START_INVALID');
    await reject({ fromSurah: 9, toSurah: 2 }, 'QURAN_RANGE_START_INVALID');
    await reject({ fromSurah: 0, toSurah: 2 }, 'QURAN_RANGE_START_INVALID');
    await reject({ fromSurah: 'a', toSurah: 2 }, 'QURAN_RANGE_START_INVALID');
    await reject({ fromSurah: 2 }, 'QURAN_RANGE_START_INVALID');
  });
});

describe('Which form, which unit', () => {
  it('exactly one form: none or both are refused', async () => {
    await reject({}, 'REVISION_RANGE_FORM_INVALID');
    await reject({ fromSurah: 1, toSurah: 2, unit: 'SURAHS', start: 1, amount: 2, direction: 'FORWARD' }, 'REVISION_RANGE_FORM_INVALID');
    await reject({ fromSurah: 1, toSurah: 2, amount: 2 }, 'REVISION_RANGE_FORM_INVALID');
  });
  it('a missing or non-object range', async () => {
    await reject(undefined, 'REVISION_RANGE_REQUIRED');
    await reject('2:1', 'REVISION_RANGE_REQUIRED');
    await reject([], 'REVISION_RANGE_REQUIRED');
  });
  it('LINES is not a revision unit; an unknown unit, direction or amount is refused by Module 22\'s codes', async () => {
    await reject({ unit: 'LINES', start: 1, amount: 3, direction: 'FORWARD' }, 'REVISION_UNIT_NOT_SUPPORTED');
    await reject({ unit: 'WORDS', start: 1, amount: 3, direction: 'FORWARD' }, 'QURAN_RANGE_UNIT_INVALID');
    await reject({ unit: 'PAGES', start: 1, amount: 3, direction: 'SIDEWAYS' }, 'QURAN_RANGE_DIRECTION_INVALID');
    await reject({ unit: 'PAGES', start: 1, amount: 0, direction: 'FORWARD' }, 'QURAN_RANGE_AMOUNT_INVALID');
    await reject({ unit: 'PAGES', start: 0, amount: 1, direction: 'FORWARD' }, 'QURAN_RANGE_START_INVALID');
    await reject({ unit: 'PAGES', amount: 1, direction: 'FORWARD' }, 'QURAN_RANGE_START_INVALID');
  });
  it('validates the shape before reading any Quran data', async () => {
    const mini = createMiniQuran();
    const r = new RevisionRangeResolver({ engine: new QuranRangeEngine(mini), quran: mini });
    await expect(r.resolve({ unit: 'LINES', start: 1, amount: 1, direction: 'FORWARD' })).rejects.toMatchObject({ code: 'REVISION_UNIT_NOT_SUPPORTED' });
    await expect(r.resolve({ unit: 'PAGES', start: 1, amount: 0, direction: 'FORWARD' })).rejects.toMatchObject({ code: 'QURAN_RANGE_AMOUNT_INVALID' });
    expect(mini.calls.count).toBe(0);
  });
});
