import type { QuranDirectory, RangeSnapshot } from '../ports/directories';

/**
 * Turns the stored range of an assignment into the details a Parent is told, according to the UNIT the Teacher defined it in (Master Specification §47-§48; Module 22 units):
 *  - AYAHS:    the surah and ayah range;
 *  - SURAHS:   the surah range, BOTH endpoints included;
 *  - PAGES:    the Mushaf page range;
 *  - QUARTERS: the quarter range;
 *  - LINES:    the number of lines and the Mushaf pages they fall on.
 * Every shape also carries the exact ayah span, so the range is always complete. Nothing is calculated here: the range is the Range Engine's stored result (Modules 27 / 28) and
 * Module 21 is only asked for names and for the page and quarter of the two end ayahs. The values are language-neutral (numbers and the Arabic surah names); the labels live in the templates.
 */
export type RangeShape = 'AYAHS' | 'SURAHS' | 'PAGES' | 'QUARTERS' | 'LINES';
export const RANGE_SHAPES: readonly RangeShape[] = ['AYAHS', 'SURAHS', 'PAGES', 'QUARTERS', 'LINES'];

export interface RangeDescription {
  readonly shape: RangeShape;
  readonly params: Readonly<Record<string, string | number>>;
}

const DASH = '–';
const between = (a: number, b: number): string => (a === b ? String(a) : `${a}${DASH}${b}`);

/** `البقرة 2:5 → 2:10` (one surah) or `الفاتحة 1:6 → البقرة 2:5` (several). */
export async function spanOf(range: RangeSnapshot, quran: QuranDirectory): Promise<string> {
  const first = await quran.surahName(range.first.surah);
  const head = `${first} ${range.first.surah}:${range.first.ayah}`;
  if (range.first.surah === range.last.surah) return `${head} → ${range.last.surah}:${range.last.ayah}`;
  return `${head} → ${await quran.surahName(range.last.surah)} ${range.last.surah}:${range.last.ayah}`;
}

export async function describeRange(range: RangeSnapshot, quran: QuranDirectory): Promise<RangeDescription> {
  const span = await spanOf(range, quran);
  const base = { span, ayahCount: range.ayahCount };
  if (range.unit === 'SURAHS') {
    const firstName = await quran.surahName(range.first.surah);
    const surahs =
      range.first.surah === range.last.surah ? `${firstName} (${range.first.surah})` : `${firstName} (${range.first.surah}) → ${await quran.surahName(range.last.surah)} (${range.last.surah})`;
    return { shape: 'SURAHS', params: { ...base, surahs, surahCount: range.last.surah - range.first.surah + 1 } };
  }
  if (range.unit === 'PAGES' || range.unit === 'QUARTERS' || range.unit === 'LINES') {
    const [from, to] = await Promise.all([quran.ayahLocation(range.first.surah, range.first.ayah), quran.ayahLocation(range.last.surah, range.last.ayah)]);
    if (from && to) {
      const pages = between(from.firstPage, to.lastPage);
      if (range.unit === 'PAGES') return { shape: 'PAGES', params: { ...base, pages } };
      if (range.unit === 'QUARTERS') return { shape: 'QUARTERS', params: { ...base, quarters: between(from.quarter, to.quarter) } };
      return { shape: 'LINES', params: { ...base, lines: range.amount, pages } };
    }
    // The page / quarter data is not available: the exact ayah range is still told (never a guess).
  }
  return { shape: 'AYAHS', params: base };
}
