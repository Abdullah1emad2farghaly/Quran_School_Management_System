import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import type { AyahDto, PageDto } from '../../../src/modules/21-quran-structure/public';
import { QuranRangeEngine, type QuranRangeRequest, type QuranRangeResult, type RangeDirection, type RangeUnit } from '../../../src/modules/22-quran-range-engine/public';
import { createQuranHarness } from '../../helpers/quran-service-harness';

/**
 * The engine over the full SYNTHETIC structure (114 surahs with the real Hafs ayah counts, 604 pages, 240 quarters, banner and basmala lines,
 * lines holding two ayahs, ayahs spanning lines; placeholder text). The surah/ayah counts are real, so the examples below are real facts.
 * The line/page/quarter layout is synthetic: those expectations come from independent brute-force oracles over the same data.
 */
const TOTAL = 6236;

async function setup() {
  const { service, importSynthetic } = createQuranHarness();
  await importSynthetic();
  const engine = new QuranRangeEngine(service);
  const ayahs: AyahDto[] = [];
  for (let g = 1; g <= TOTAL; g += 1) ayahs.push((await service.getAyahByGlobalPosition(g))!);
  const pages: PageDto[] = [];
  for (let p = 1; p <= 604; p += 1) pages.push((await service.getPage(p))!);
  const quarters = await service.listQuarters();
  return { service, engine, ayahs, pages, quarters };
}

const show = (r: QuranRangeResult): string => r.segments.map((s) => `${s.surah}:${s.firstAyah}-${s.lastAyah}`).join(' ');
const request = (unit: RangeUnit, direction: RangeDirection, amount: number, start: QuranRangeRequest['start']): QuranRangeRequest => ({ unit, direction, amount, start });
async function outcome(engine: QuranRangeEngine, req: QuranRangeRequest): Promise<{ first: number; last: number; start: number } | 'EXCEEDS'> {
  try {
    const r = await engine.calculate(req);
    return { first: r.first.globalPosition, last: r.last.globalPosition, start: r.start.globalPosition };
  } catch (error) {
    if (error instanceof AppError && error.code === 'QURAN_RANGE_EXCEEDS_QURAN') return 'EXCEEDS';
    throw error;
  }
}

describe('the approved examples (real Hafs ayah counts)', () => {
  it('10 AYAHS BACKWARD from the surah An-Nas (surah-only start) = all 6 ayahs of An-Nas and the preceding 4 of Al-Falaq, in Quran order', async () => {
    const { engine } = await setup();
    const r = await engine.calculate(request('AYAHS', 'BACKWARD', 10, { surah: 114 }));
    expect(show(r)).toBe('113:2-5 114:1-6');
    expect(r.start).toMatchObject({ surah: 114, ayah: 6 });
    expect(r.end).toMatchObject({ surah: 113, ayah: 2 });
    expect(r.segments.map((s) => s.ayahCount)).toEqual([4, 6]);
    expect(r.totals.ayahs).toBe(10);
  });

  it('3 SURAHS BACKWARD from An-Nas = An-Nas, Al-Falaq and Al-Ikhlas, complete, in Quran order', async () => {
    const { engine } = await setup();
    const r = await engine.calculate(request('SURAHS', 'BACKWARD', 3, { surah: 114 }));
    expect(show(r)).toBe('112:1-4 113:1-5 114:1-6');
    expect(r.segments.every((s) => s.complete)).toBe(true);
    expect(r.totals.surahs).toBe(3);
  });

  it('an explicit ayah anchors at that ayah: 10 AYAHS BACKWARD from 114:1 ends at 114:1', async () => {
    const { engine } = await setup();
    expect(show(await engine.calculate(request('AYAHS', 'BACKWARD', 10, { surah: 114, ayah: 1 })))).toBe('112:1-4 113:1-5 114:1-1');
  });

  it('one SURAH from anywhere inside Al-Baqarah is the complete Al-Baqarah (286 ayahs), never a partial range', async () => {
    const { engine } = await setup();
    for (const ayah of [1, 2, 142, 255, 286]) {
      for (const direction of ['FORWARD', 'BACKWARD'] as const) {
        const r = await engine.calculate(request('SURAHS', direction, 1, { surah: 2, ayah }));
        expect(show(r)).toBe('2:1-286');
        expect(r.start.ayah).toBe(ayah);
        expect(r.segments[0]!.complete).toBe(true);
      }
    }
  });

  it('crossing surah boundaries in both directions with real counts', async () => {
    const { engine } = await setup();
    expect(show(await engine.calculate(request('AYAHS', 'FORWARD', 10, { surah: 1, ayah: 5 })))).toBe('1:5-7 2:1-7');
    expect(show(await engine.calculate(request('AYAHS', 'BACKWARD', 10, { surah: 2, ayah: 3 })))).toBe('1:1-7 2:1-3');
    expect(show(await engine.calculate(request('AYAHS', 'FORWARD', TOTAL, { surah: 1, ayah: 1 }))).split(' ')).toHaveLength(114);
  });

  it('the Quran has exactly the documented boundaries (no wrap, no clamp)', async () => {
    const { engine } = await setup();
    expect(await outcome(engine, request('AYAHS', 'FORWARD', TOTAL + 1, { surah: 1, ayah: 1 }))).toBe('EXCEEDS');
    expect(await outcome(engine, request('AYAHS', 'FORWARD', 2, { surah: 114, ayah: 6 }))).toBe('EXCEEDS');
    expect(await outcome(engine, request('AYAHS', 'BACKWARD', 2, { surah: 1, ayah: 1 }))).toBe('EXCEEDS');
    expect(await outcome(engine, request('SURAHS', 'FORWARD', 115, { surah: 1 }))).toBe('EXCEEDS');
    expect(await outcome(engine, request('SURAHS', 'BACKWARD', 2, { surah: 1 }))).toBe('EXCEEDS');
    expect(show(await engine.calculate(request('SURAHS', 'FORWARD', 114, { surah: 1 }))).split(' ')).toHaveLength(114);
    expect(await outcome(engine, request('QUARTERS', 'FORWARD', 241, { surah: 1, ayah: 1 }))).toBe('EXCEEDS');
    expect(await outcome(engine, request('PAGES', 'FORWARD', 605, { surah: 1, ayah: 1 }))).toBe('EXCEEDS');
    expect(await outcome(engine, request('PAGES', 'BACKWARD', 100, { surah: 1, ayah: 1 }))).toBe('EXCEEDS');
  });

});

describe('independent oracles over every surah, page, quarter and line of the structure', () => {
  it('SURAHS: every start surah, both directions, several amounts', async () => {
    const { engine, service } = await setup();
    const surahs = await service.listSurahs();
    for (const s of surahs) {
      for (const amount of [1, 2, 5, 114]) {
        const forwardEnd = s.number + amount - 1;
        const got = await outcome(engine, request('SURAHS', 'FORWARD', amount, { surah: s.number }));
        if (forwardEnd > 114) expect(got).toBe('EXCEEDS');
        else expect(got).toMatchObject({ first: s.firstGlobalPosition, last: surahs[forwardEnd - 1]!.firstGlobalPosition + surahs[forwardEnd - 1]!.ayahCount - 1 });
        const backwardStart = s.number - amount + 1;
        const back = await outcome(engine, request('SURAHS', 'BACKWARD', amount, { surah: s.number }));
        if (backwardStart < 1) expect(back).toBe('EXCEEDS');
        else expect(back).toMatchObject({ first: surahs[backwardStart - 1]!.firstGlobalPosition, last: s.firstGlobalPosition + s.ayahCount - 1 });
      }
    }
  });

  it('QUARTERS: every ayah sampled, both directions, several amounts', async () => {
    const { engine, ayahs, quarters } = await setup();
    const start = (q: number) => quarters[q - 1]!.start.globalPosition;
    for (let g = 1; g <= TOTAL; g += 53) {
      const a = ayahs[g - 1]!;
      for (const amount of [1, 2, 8, 240]) {
        const fwd = a.quarter + amount - 1;
        const got = await outcome(engine, request('QUARTERS', 'FORWARD', amount, { surah: a.surah, ayah: a.ayah }));
        if (fwd > 240) expect(got).toBe('EXCEEDS');
        else expect(got).toMatchObject({ first: g, last: fwd === 240 ? TOTAL : start(fwd + 1) - 1 });
        const bwd = a.quarter - amount + 1;
        const back = await outcome(engine, request('QUARTERS', 'BACKWARD', amount, { surah: a.surah, ayah: a.ayah }));
        if (bwd < 1) expect(back).toBe('EXCEEDS');
        else expect(back).toMatchObject({ first: start(bwd), last: g });
      }
    }
  });

  it('PAGES: every ayah sampled, both directions, several amounts (the range ends at the page\'s last/first ayah)', async () => {
    const { engine, ayahs, pages } = await setup();
    for (let g = 1; g <= TOTAL; g += 47) {
      const a = ayahs[g - 1]!;
      for (const amount of [1, 2, 7, 604]) {
        const endPage = a.firstPage + amount - 1;
        const got = await outcome(engine, request('PAGES', 'FORWARD', amount, { surah: a.surah, ayah: a.ayah }));
        if (endPage > 604) expect(got).toBe('EXCEEDS');
        else expect(got).toMatchObject({ first: g, last: pages[endPage - 1]!.lastAyah.globalPosition });
        const beginPage = a.lastPage - amount + 1;
        const back = await outcome(engine, request('PAGES', 'BACKWARD', amount, { surah: a.surah, ayah: a.ayah }));
        if (beginPage < 1) expect(back).toBe('EXCEEDS');
        else expect(back).toMatchObject({ first: pages[beginPage - 1]!.firstAyah.globalPosition, last: g });
      }
    }
  });

  it('LINES: a flat list of ALL text lines is the oracle; banners and basmala lines are never counted', async () => {
    const { engine, ayahs, pages } = await setup();
    const text = pages.flatMap((p) => p.lines).filter((l) => l.kind === 'TEXT');
    expect(text.length).toBe(pages.flatMap((p) => p.lines).length - 114 - 112);
    const indexOf = (page: number, line: number) => text.findIndex((l) => l.page === page && l.line === line);
    for (let g = 1; g <= TOTAL; g += 31) {
      const a = ayahs[g - 1]!;
      const first = indexOf(a.firstPage, a.firstLine);
      const last = indexOf(a.lastPage, a.lastLine);
      expect(first).toBeGreaterThanOrEqual(0);
      for (const amount of [1, 2, 5, 15, 40, 100]) {
        const fwd = first + amount - 1;
        const got = await outcome(engine, request('LINES', 'FORWARD', amount, { surah: a.surah, ayah: a.ayah }));
        if (fwd >= text.length) expect(got, `${g} fwd ${amount}`).toBe('EXCEEDS');
        else expect(got, `${g} fwd ${amount}`).toMatchObject({ first: g, last: text[fwd]!.lastAyah!.globalPosition });
        const bwd = last - amount + 1;
        const back = await outcome(engine, request('LINES', 'BACKWARD', amount, { surah: a.surah, ayah: a.ayah }));
        if (bwd < 0) expect(back, `${g} bwd ${amount}`).toBe('EXCEEDS');
        else expect(back, `${g} bwd ${amount}`).toMatchObject({ first: text[bwd]!.firstAyah!.globalPosition, last: g });
      }
    }
  });
});

describe('invariants that hold for every unit, direction and start', () => {
  it('segments are in ascending Quran order, contiguous, inside their surahs, and add up to the totals', async () => {
    const { engine, ayahs } = await setup();
    const units: RangeUnit[] = ['SURAHS', 'AYAHS', 'QUARTERS', 'PAGES', 'LINES'];
    for (const unit of units) {
      for (const direction of ['FORWARD', 'BACKWARD'] as const) {
        for (let g = 1; g <= TOTAL; g += 211) {
          const a = ayahs[g - 1]!;
          let r: QuranRangeResult;
          try {
            r = await engine.calculate(request(unit, direction, 3, { surah: a.surah, ayah: a.ayah }));
          } catch (error) {
            expect((error as AppError).code).toBe('QURAN_RANGE_EXCEEDS_QURAN');
            continue;
          }
          expect(r.segments.reduce((sum, s) => sum + s.ayahCount, 0)).toBe(r.totals.ayahs);
          expect(r.totals.ayahs).toBe(r.last.globalPosition - r.first.globalPosition + 1);
          expect(r.totals.surahs).toBe(r.segments.length);
          r.segments.forEach((s, i) => {
            expect(s.ayahCount).toBe(s.lastAyah - s.firstAyah + 1);
            if (i > 0) expect(s.surah).toBe(r.segments[i - 1]!.surah + 1);
            if (i > 0) expect(s.firstAyah).toBe(1);
            if (i < r.segments.length - 1) expect(s.lastAyah).toBe(ayahs.filter((x) => x.surah === s.surah).length);
          });
          // the start ayah is always inside the range, and FORWARD/BACKWARD end where they should
          expect(r.first.globalPosition).toBeLessThanOrEqual(r.start.globalPosition);
          expect(r.last.globalPosition).toBeGreaterThanOrEqual(r.start.globalPosition);
          expect(r.end.globalPosition).toBe(direction === 'FORWARD' ? r.last.globalPosition : r.first.globalPosition);
          if (unit !== 'SURAHS') expect(direction === 'FORWARD' ? r.first.globalPosition : r.last.globalPosition).toBe(r.start.globalPosition);
        }
      }
    }
  });

  it('chaining ranges (next start = the ayah after the end) walks the whole Quran exactly once: AYAHS, QUARTERS, PAGES, SURAHS and LINES, FORWARD', async () => {
    const { engine, ayahs } = await setup();
    for (const [unit, amount] of [['AYAHS', 100], ['QUARTERS', 1], ['PAGES', 1], ['SURAHS', 3], ['LINES', 9]] as const) {
      const covered: number[] = [];
      let next = 1;
      while (next <= TOTAL) {
        const a = ayahs[next - 1]!;
        let r: QuranRangeResult;
        try {
          r = await engine.calculate(request(unit, 'FORWARD', amount, { surah: a.surah, ayah: a.ayah }));
        } catch (error) {
          expect((error as AppError).code).toBe('QURAN_RANGE_EXCEEDS_QURAN');
          r = await engine.calculate(request(unit, 'FORWARD', 1, { surah: a.surah, ayah: a.ayah })); // the tail: one unit at a time
        }
        expect(r.first.globalPosition).toBe(next);
        for (let g = r.first.globalPosition; g <= r.last.globalPosition; g += 1) covered.push(g);
        next = r.last.globalPosition + 1;
        if (unit === 'SURAHS') expect(r.segments.every((s) => s.complete)).toBe(true);
        if (unit === 'SURAHS') expect(r.first.ayah).toBe(1);
      }
      expect(covered).toHaveLength(TOTAL);
      expect(covered.every((g, i) => g === i + 1)).toBe(true);
    }
  });

  it('chaining BACKWARD from the end of the Quran also walks it exactly once (AYAHS, QUARTERS, PAGES, LINES)', async () => {
    const { engine, ayahs } = await setup();
    for (const [unit, amount] of [['AYAHS', 100], ['QUARTERS', 1], ['PAGES', 1], ['LINES', 9]] as const) {
      const covered: number[] = [];
      let next = TOTAL;
      while (next >= 1) {
        const a = ayahs[next - 1]!;
        let r: QuranRangeResult;
        try {
          r = await engine.calculate(request(unit, 'BACKWARD', amount, { surah: a.surah, ayah: a.ayah }));
        } catch (error) {
          expect((error as AppError).code).toBe('QURAN_RANGE_EXCEEDS_QURAN');
          r = await engine.calculate(request(unit, 'BACKWARD', 1, { surah: a.surah, ayah: a.ayah }));
        }
        expect(r.last.globalPosition).toBe(next);
        for (let g = r.last.globalPosition; g >= r.first.globalPosition; g -= 1) covered.push(g);
        next = r.first.globalPosition - 1;
      }
      expect(covered).toHaveLength(TOTAL);
      expect(covered.every((g, i) => g === TOTAL - i)).toBe(true);
    }
  });
});
