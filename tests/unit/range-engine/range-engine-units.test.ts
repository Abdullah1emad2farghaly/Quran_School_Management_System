import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { QuranRangeEngine, type QuranRangeRequest, type QuranRangeResult, type RangeDirection, type RangeUnit } from '../../../src/modules/22-quran-range-engine/public';
import { createMiniQuran } from '../../helpers/range-mini-quran';

/**
 * Exact, HAND-COMPUTED expectations over the mini Quran in `tests/helpers/range-mini-quran.ts` (read its header first):
 *   S1 = g1..3, S2 = g4..9, S3 = g10..13, S4 = g14..15 | Q1 = g1..4, Q2 = g5..9, Q3 = g10..12, Q4 = g13..15 | pages 1..4 (g8 crosses pages 2/3).
 * Rules under test (approved): the start ayah is INCLUDED; FORWARD starts at it, BACKWARD ends at it; a surah-only start anchors at the surah's
 * first ayah (FORWARD) or last ayah (BACKWARD); SURAHS are whole surahs; QUARTERS/PAGES count the unit that contains the start and finish at the
 * end of the final unit in the direction of travel; LINES count TEXT lines only and round the boundary out to the whole ayah touched by the last
 * counted line; segments are always in Quran order; going past the Quran is a domain error (no wrap, no clamp).
 */
const engine = () => new QuranRangeEngine(createMiniQuran());
const run = (unit: RangeUnit, direction: RangeDirection, amount: number, start: QuranRangeRequest['start']) => engine().calculate({ unit, direction, amount, start });
const show = (r: QuranRangeResult): string => r.segments.map((s) => `${s.surah}:${s.firstAyah}-${s.lastAyah}`).join(' ');
const at = (r: QuranRangeResult) => ({ start: r.start.globalPosition, end: r.end.globalPosition, first: r.first.globalPosition, last: r.last.globalPosition });

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the request to be rejected');
}
const exceeds = async (unit: RangeUnit, direction: RangeDirection, amount: number, start: QuranRangeRequest['start']) => {
  const error = await failure(run(unit, direction, amount, start));
  expect(error.code).toBe('QURAN_RANGE_EXCEEDS_QURAN');
  expect(error.kind).toBe('BUSINESS_RULE');
  return error;
};

describe('AYAHS', () => {
  it('counts complete ayahs, including the starting ayah (FORWARD)', async () => {
    const r = await run('AYAHS', 'FORWARD', 3, { surah: 2, ayah: 2 });
    expect(show(r)).toBe('2:2-4');
    expect(at(r)).toEqual({ start: 5, end: 7, first: 5, last: 7 });
  });

  it('crosses a surah boundary going FORWARD; segments are per surah', async () => {
    const r = await run('AYAHS', 'FORWARD', 4, { surah: 1, ayah: 3 });
    expect(show(r)).toBe('1:3-3 2:1-3');
    expect(at(r)).toEqual({ start: 3, end: 6, first: 3, last: 6 });
  });

  it('crosses a surah boundary going BACKWARD: the start is the LAST ayah, the end is the earliest, segments stay in Quran order', async () => {
    const r = await run('AYAHS', 'BACKWARD', 4, { surah: 3, ayah: 1 });
    expect(show(r)).toBe('2:4-6 3:1-1');
    expect(at(r)).toEqual({ start: 10, end: 7, first: 7, last: 10 });
  });

  it('a surah-only start anchors at the surah\'s first ayah (FORWARD) or last ayah (BACKWARD)', async () => {
    const forward = await run('AYAHS', 'FORWARD', 6, { surah: 3 });
    expect(show(forward)).toBe('3:1-4 4:1-2');
    expect(at(forward)).toEqual({ start: 10, end: 15, first: 10, last: 15 });
    const backward = await run('AYAHS', 'BACKWARD', 6, { surah: 3 });
    expect(show(backward)).toBe('2:5-6 3:1-4'); // g13 back 6 = g8..g13 (g8 is 2:5)
    expect(at(backward)).toEqual({ start: 13, end: 8, first: 8, last: 13 });
  });

  it('an explicit ayah always anchors at that ayah, even ayah 1 (BACKWARD from 3:1 is NOT the end of surah 3)', async () => {
    expect(show(await run('AYAHS', 'BACKWARD', 1, { surah: 3, ayah: 1 }))).toBe('3:1-1');
    expect(show(await run('AYAHS', 'BACKWARD', 1, { surah: 3 }))).toBe('3:4-4');
  });

  it('can cover the whole Quran, in either direction, and nothing more', async () => {
    expect(show(await run('AYAHS', 'FORWARD', 15, { surah: 1, ayah: 1 }))).toBe('1:1-3 2:1-6 3:1-4 4:1-2');
    expect(show(await run('AYAHS', 'BACKWARD', 15, { surah: 4 }))).toBe('1:1-3 2:1-6 3:1-4 4:1-2');
    await exceeds('AYAHS', 'FORWARD', 16, { surah: 1, ayah: 1 });
  });

  it('rejects a range that leaves the Quran: no wrap-around, no clamping', async () => {
    const forward = await exceeds('AYAHS', 'FORWARD', 3, { surah: 4, ayah: 1 });
    expect(forward.details).toMatchObject({ unit: 'AYAHS', direction: 'FORWARD', amount: 3, boundary: 'END_OF_QURAN' });
    expect(show(await run('AYAHS', 'FORWARD', 2, { surah: 4, ayah: 1 }))).toBe('4:1-2');
    const backward = await exceeds('AYAHS', 'BACKWARD', 3, { surah: 1, ayah: 2 });
    expect(backward.details).toMatchObject({ direction: 'BACKWARD', boundary: 'BEGINNING_OF_QURAN' });
    expect(show(await run('AYAHS', 'BACKWARD', 2, { surah: 1, ayah: 2 }))).toBe('1:1-2');
  });
});

describe('SURAHS', () => {
  it('returns the COMPLETE surah that contains the start, not a partial range from the start ayah', async () => {
    const r = await run('SURAHS', 'FORWARD', 1, { surah: 2, ayah: 3 });
    expect(show(r)).toBe('2:1-6');
    expect(at(r)).toEqual({ start: 6, end: 9, first: 4, last: 9 });
    expect(r.segments[0]!.complete).toBe(true);
    expect(show(await run('SURAHS', 'FORWARD', 1, { surah: 2, ayah: 6 }))).toBe('2:1-6'); // the last ayah of the surah does not move on to the next
    expect(show(await run('SURAHS', 'BACKWARD', 1, { surah: 2, ayah: 1 }))).toBe('2:1-6');
  });

  it('counts the requested number of complete surahs FORWARD', async () => {
    expect(show(await run('SURAHS', 'FORWARD', 2, { surah: 2, ayah: 3 }))).toBe('2:1-6 3:1-4');
    expect(show(await run('SURAHS', 'FORWARD', 4, { surah: 1 }))).toBe('1:1-3 2:1-6 3:1-4 4:1-2');
  });

  it('counts the requested number of complete surahs BACKWARD, returned in Quran order, ending at the start surah', async () => {
    const r = await run('SURAHS', 'BACKWARD', 2, { surah: 3, ayah: 2 });
    expect(show(r)).toBe('2:1-6 3:1-4');
    expect(at(r)).toEqual({ start: 11, end: 4, first: 4, last: 13 });
    expect(show(await run('SURAHS', 'BACKWARD', 3, { surah: 4 }))).toBe('2:1-6 3:1-4 4:1-2');
  });

  it('flags a segment as complete only when it is the whole surah', async () => {
    expect((await run('AYAHS', 'FORWARD', 3, { surah: 2, ayah: 1 })).segments[0]!.complete).toBe(false);
    expect((await run('AYAHS', 'FORWARD', 6, { surah: 2, ayah: 1 })).segments[0]!.complete).toBe(true);
  });

  it('rejects counts beyond the first or last surah', async () => {
    await exceeds('SURAHS', 'FORWARD', 4, { surah: 2, ayah: 1 });
    await exceeds('SURAHS', 'FORWARD', 2, { surah: 4, ayah: 1 });
    await exceeds('SURAHS', 'BACKWARD', 3, { surah: 2, ayah: 1 });
    expect(show(await run('SURAHS', 'BACKWARD', 2, { surah: 2 }))).toBe('1:1-3 2:1-6');
    expect(show(await run('SURAHS', 'FORWARD', 1, { surah: 4, ayah: 1 }))).toBe('4:1-2');
  });
});

describe('QUARTERS (Q1 = g1..4, Q2 = g5..9, Q3 = g10..12, Q4 = g13..15)', () => {
  it('FORWARD begins AT the start ayah (inside its quarter) and finishes at the end of the final quarter', async () => {
    const one = await run('QUARTERS', 'FORWARD', 1, { surah: 1, ayah: 2 });
    expect(show(one)).toBe('1:2-3 2:1-1');
    expect(at(one)).toEqual({ start: 2, end: 4, first: 2, last: 4 });
    expect(show(await run('QUARTERS', 'FORWARD', 2, { surah: 1, ayah: 2 }))).toBe('1:2-3 2:1-6');
    expect(show(await run('QUARTERS', 'FORWARD', 1, { surah: 2, ayah: 4 }))).toBe('2:4-6');
    expect(show(await run('QUARTERS', 'FORWARD', 3, { surah: 2, ayah: 4 }))).toBe('2:4-6 3:1-4 4:1-2'); // the last quarter ends at the end of the Quran
  });

  it('BACKWARD ends AT the start ayah and reaches back to the start of the final quarter', async () => {
    const one = await run('QUARTERS', 'BACKWARD', 1, { surah: 2, ayah: 4 });
    expect(show(one)).toBe('2:2-4');
    expect(at(one)).toEqual({ start: 7, end: 5, first: 5, last: 7 });
    expect(show(await run('QUARTERS', 'BACKWARD', 2, { surah: 2, ayah: 4 }))).toBe('1:1-3 2:1-4');
  });

  it('starting exactly on a quarter start', async () => {
    expect(show(await run('QUARTERS', 'FORWARD', 1, { surah: 3, ayah: 1 }))).toBe('3:1-3');
    expect(show(await run('QUARTERS', 'BACKWARD', 1, { surah: 3, ayah: 1 }))).toBe('3:1-1');
    expect(show(await run('QUARTERS', 'BACKWARD', 2, { surah: 3, ayah: 1 }))).toBe('2:2-6 3:1-1');
  });

  it('a surah-only start anchors first/last ayah of the surah, then uses that ayah\'s quarter', async () => {
    expect(show(await run('QUARTERS', 'FORWARD', 1, { surah: 3 }))).toBe('3:1-3'); // anchor g10 (Q3)
    expect(show(await run('QUARTERS', 'BACKWARD', 1, { surah: 3 }))).toBe('3:4-4'); // anchor g13 (Q4)
    expect(show(await run('QUARTERS', 'BACKWARD', 2, { surah: 3 }))).toBe('3:1-4');
  });

  it('rejects counts beyond the first or last quarter', async () => {
    await exceeds('QUARTERS', 'FORWARD', 4, { surah: 2, ayah: 4 });
    await exceeds('QUARTERS', 'BACKWARD', 3, { surah: 2, ayah: 4 });
    expect(show(await run('QUARTERS', 'FORWARD', 1, { surah: 3, ayah: 4 }))).toBe('3:4-4 4:1-2');
    await exceeds('QUARTERS', 'FORWARD', 2, { surah: 3, ayah: 4 });
  });
});

describe('PAGES (p1 = g1..3, p2 = g4..8, p3 = g8..10, p4 = g11..15; g8 crosses pages 2 and 3)', () => {
  it('FORWARD begins at the start ayah (inside its page) and finishes at the end of the final page, rounded up to the whole ayah on its last line', async () => {
    const one = await run('PAGES', 'FORWARD', 1, { surah: 2, ayah: 1 });
    expect(show(one)).toBe('2:1-5'); // page 2 ends in g8, which continues on page 3: the whole ayah is included
    expect(at(one)).toEqual({ start: 4, end: 8, first: 4, last: 8 });
    expect(show(await run('PAGES', 'FORWARD', 2, { surah: 2, ayah: 1 }))).toBe('2:1-6 3:1-1');
    expect(show(await run('PAGES', 'FORWARD', 1, { surah: 2, ayah: 5 }))).toBe('2:5-5'); // mid-page start: ends at the end of THAT page
    expect(show(await run('PAGES', 'FORWARD', 4, { surah: 1, ayah: 1 }))).toBe('1:1-3 2:1-6 3:1-4 4:1-2');
  });

  it('BACKWARD ends at the start ayah and reaches back to the start of the final page, rounded out to the whole ayah on its first line', async () => {
    const one = await run('PAGES', 'BACKWARD', 1, { surah: 2, ayah: 6 }); // g9 is on page 3
    expect(show(one)).toBe('2:5-6'); // page 3 begins with the end of g8: the whole ayah is included
    expect(at(one)).toEqual({ start: 9, end: 8, first: 8, last: 9 });
    expect(show(await run('PAGES', 'BACKWARD', 2, { surah: 2, ayah: 6 }))).toBe('2:1-6');
    expect(show(await run('PAGES', 'BACKWARD', 3, { surah: 2, ayah: 6 }))).toBe('1:1-3 2:1-6');
    expect(show(await run('PAGES', 'BACKWARD', 1, { surah: 2, ayah: 5 }))).toBe('2:5-5'); // g8: its last page is 3
  });

  it('a surah-only start anchors first/last ayah of the surah, then uses that ayah\'s page', async () => {
    expect(show(await run('PAGES', 'FORWARD', 1, { surah: 2 }))).toBe('2:1-5'); // anchor g4 (page 2)
    expect(show(await run('PAGES', 'BACKWARD', 1, { surah: 2 }))).toBe('2:5-6'); // anchor g9 (page 3)
  });

  it('rejects counts beyond the first or last page', async () => {
    await exceeds('PAGES', 'FORWARD', 5, { surah: 1, ayah: 1 });
    await exceeds('PAGES', 'FORWARD', 2, { surah: 4, ayah: 1 });
    await exceeds('PAGES', 'BACKWARD', 4, { surah: 2, ayah: 6 });
    expect(show(await run('PAGES', 'FORWARD', 1, { surah: 4, ayah: 1 }))).toBe('4:1-2');
  });
});

describe('LINES (TEXT lines only: surah banners and basmala lines are never counted)', () => {
  it('FORWARD counts TEXT lines from the first line of the start ayah and skips banner and basmala lines', async () => {
    expect(show(await run('LINES', 'FORWARD', 1, { surah: 1, ayah: 1 }))).toBe('1:1-1');
    expect(show(await run('LINES', 'FORWARD', 3, { surah: 1, ayah: 1 }))).toBe('1:1-3');
    expect(show(await run('LINES', 'FORWARD', 4, { surah: 1, ayah: 1 }))).toBe('1:1-3 2:1-1'); // 4th TEXT line = g4, after the banner and basmala of surah 2
    expect(show(await run('LINES', 'FORWARD', 15, { surah: 1, ayah: 1 }))).toBe('1:1-3 2:1-6 3:1-4 4:1-2');
    await exceeds('LINES', 'FORWARD', 16, { surah: 1, ayah: 1 });
  });

  it('rounds the end up to the last ayah ON the last counted line (a line holding two ayahs includes both)', async () => {
    expect(show(await run('LINES', 'FORWARD', 1, { surah: 2, ayah: 2 }))).toBe('2:2-3'); // line P2L4 holds g5 and g6
    expect(show(await run('LINES', 'FORWARD', 1, { surah: 2, ayah: 3 }))).toBe('2:3-3'); // g6 also STARTS on P2L4
    expect(show(await run('LINES', 'FORWARD', 5, { surah: 1, ayah: 1 }))).toBe('1:1-3 2:1-3');
    expect(show(await run('LINES', 'FORWARD', 2, { surah: 3, ayah: 2 }))).toBe('3:2-4'); // g11 + g12 share P4L1, g13 next
    expect(show(await run('LINES', 'FORWARD', 1, { surah: 3, ayah: 2 }))).toBe('3:2-3');
    expect(show(await run('LINES', 'FORWARD', 1, { surah: 3, ayah: 3 }))).toBe('3:3-3');
  });

  it('an ayah that spans two lines is counted line by line and always included whole', async () => {
    expect(show(await run('LINES', 'FORWARD', 1, { surah: 2, ayah: 4 }))).toBe('2:4-4'); // g7 first half
    expect(show(await run('LINES', 'FORWARD', 2, { surah: 2, ayah: 4 }))).toBe('2:4-4'); // g7 second half
    expect(show(await run('LINES', 'FORWARD', 3, { surah: 2, ayah: 4 }))).toBe('2:4-5');
    expect(show(await run('LINES', 'FORWARD', 3, { surah: 2, ayah: 1 }))).toBe('2:1-4'); // 3rd line is g7's first half: g7 is finished
    expect(show(await run('LINES', 'FORWARD', 2, { surah: 2, ayah: 5 }))).toBe('2:5-5'); // g8 spans pages 2/3
    expect(show(await run('LINES', 'FORWARD', 3, { surah: 2, ayah: 5 }))).toBe('2:5-6');
    expect(show(await run('LINES', 'FORWARD', 4, { surah: 2, ayah: 5 }))).toBe('2:5-6 3:1-1'); // skips the banner and basmala of surah 3
    expect(show(await run('LINES', 'FORWARD', 5, { surah: 2, ayah: 5 }))).toBe('2:5-6 3:1-3');
  });

  it('BACKWARD counts TEXT lines from the LAST line of the start ayah and rounds the beginning out to the whole ayah on the earliest counted line', async () => {
    expect(show(await run('LINES', 'BACKWARD', 1, { surah: 2, ayah: 6 }))).toBe('2:6-6');
    expect(show(await run('LINES', 'BACKWARD', 2, { surah: 2, ayah: 6 }))).toBe('2:5-6');
    expect(show(await run('LINES', 'BACKWARD', 4, { surah: 2, ayah: 6 }))).toBe('2:4-6');
    expect(show(await run('LINES', 'BACKWARD', 6, { surah: 2, ayah: 6 }))).toBe('2:2-6'); // earliest line holds g5 and g6: g5 is included
    expect(show(await run('LINES', 'BACKWARD', 7, { surah: 2, ayah: 6 }))).toBe('2:1-6');
    expect(show(await run('LINES', 'BACKWARD', 3, { surah: 3, ayah: 1 }))).toBe('2:5-6 3:1-1'); // skips surah 3's banner and basmala
    expect(show(await run('LINES', 'BACKWARD', 2, { surah: 3, ayah: 1 }))).toBe('2:6-6 3:1-1');
    expect(show(await run('LINES', 'BACKWARD', 1, { surah: 2, ayah: 3 }))).toBe('2:2-3'); // g6 ends on the line that also holds g5
    expect(show(await run('LINES', 'BACKWARD', 1, { surah: 2, ayah: 2 }))).toBe('2:2-2');
    expect(show(await run('LINES', 'BACKWARD', 3, { surah: 2, ayah: 4 }))).toBe('2:2-4');
    expect(show(await run('LINES', 'BACKWARD', 2, { surah: 3, ayah: 4 }))).toBe('3:2-4');
  });

  it('surah-only starts anchor at the surah\'s first (FORWARD) or last (BACKWARD) ayah', async () => {
    expect(show(await run('LINES', 'FORWARD', 2, { surah: 3 }))).toBe('3:1-3');
    expect(show(await run('LINES', 'FORWARD', 1, { surah: 2 }))).toBe('2:1-1');
    expect(show(await run('LINES', 'BACKWARD', 1, { surah: 4 }))).toBe('4:2-2');
    expect(show(await run('LINES', 'BACKWARD', 3, { surah: 4 }))).toBe('3:4-4 4:1-2'); // skips the banner and basmala of surah 4
  });

  it('rejects counts beyond the first or last TEXT line', async () => {
    expect(show(await run('LINES', 'FORWARD', 2, { surah: 4, ayah: 1 }))).toBe('4:1-2');
    await exceeds('LINES', 'FORWARD', 3, { surah: 4, ayah: 1 });
    await exceeds('LINES', 'FORWARD', 2, { surah: 4, ayah: 2 });
    expect(show(await run('LINES', 'BACKWARD', 1, { surah: 1, ayah: 1 }))).toBe('1:1-1');
    await exceeds('LINES', 'BACKWARD', 2, { surah: 1, ayah: 1 }); // the banner of surah 1 is not a text line
  });
});

describe('the result', () => {
  it('echoes the request and reports the totals (ayahs, surahs, pages, text lines)', async () => {
    const pages = await run('PAGES', 'FORWARD', 1, { surah: 2, ayah: 1 });
    expect(pages.request).toEqual({ unit: 'PAGES', direction: 'FORWARD', amount: 1, start: { surah: 2, ayah: 1 } });
    expect(pages.totals).toEqual({ ayahs: 5, surahs: 1, pages: 2, textLines: 6 });
    const ayahs = await run('AYAHS', 'FORWARD', 4, { surah: 1, ayah: 3 });
    expect(ayahs.totals).toEqual({ ayahs: 4, surahs: 2, pages: 2, textLines: 3 });
    expect((await run('AYAHS', 'FORWARD', 1, { surah: 3 })).request.start).toEqual({ surah: 3, ayah: null });
  });

  it('describes every segment with its surah, ayah numbers and ayah count, and lists segments in Quran order for both directions', async () => {
    const r = await run('AYAHS', 'BACKWARD', 15, { surah: 4 });
    expect(r.segments).toEqual([
      { surah: 1, firstAyah: 1, lastAyah: 3, ayahCount: 3, complete: true },
      { surah: 2, firstAyah: 1, lastAyah: 6, ayahCount: 6, complete: true },
      { surah: 3, firstAyah: 1, lastAyah: 4, ayahCount: 4, complete: true },
      { surah: 4, firstAyah: 1, lastAyah: 2, ayahCount: 2, complete: true },
    ]);
    expect(r.first).toEqual({ surah: 1, ayah: 1, globalPosition: 1 });
    expect(r.last).toEqual({ surah: 4, ayah: 2, globalPosition: 15 });
  });

  it('is deterministic and does not modify the request', async () => {
    const request: QuranRangeRequest = { unit: 'LINES', direction: 'BACKWARD', amount: 3, start: { surah: 3, ayah: 1 } };
    const frozen = JSON.stringify(request);
    const a = await engine().calculate(request);
    const b = await engine().calculate(request);
    expect(b).toEqual(a);
    expect(JSON.stringify(request)).toBe(frozen);
  });
});
