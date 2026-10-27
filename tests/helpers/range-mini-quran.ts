import type { AyahDto, AyahRefDto, LineDto, PageDto, QuarterDto, SurahDto } from '../../src/modules/21-quran-structure/public';
import type { QuranRangeSource } from '../../src/modules/22-quran-range-engine/public';

/**
 * A tiny, HAND-BUILT Quran (NOT real data) for exact Range Engine tests. Every expectation in the tests is computed by hand from this table.
 *
 *   Surahs (global ayah numbers):  S1 = 1..3   S2 = 4..9   S3 = 10..13   S4 = 14..15      (15 ayahs)
 *   Quarters (start):              Q1 = g1   Q2 = g5 (2:2)   Q3 = g10 (3:1)   Q4 = g13 (3:4)
 *
 *   Page 1:  L1 HEADER(s1) | L2 g1 | L3 g2 | L4 g3
 *   Page 2:  L1 HEADER(s2) | L2 BASMALA(s2) | L3 g4 | L4 g5+g6 (one line, two ayahs) | L5 g7 (first half) | L6 g7 (second half) | L7 g8 (first half)
 *   Page 3:  L1 g8 (second half: g8 CROSSES the page) | L2 g9 | L3 HEADER(s3) | L4 BASMALA(s3) | L5 g10
 *   Page 4:  L1 g11+g12 (one line, two ayahs) | L2 g13 | L3 HEADER(s4) | L4 BASMALA(s4) | L5 g14 | L6 g15
 *
 * (The official layout never lets an ayah cross a page; g8 does here on purpose, to pin down the rounding rule.)
 */
const SURAHS: readonly SurahDto[] = [
  { number: 1, nameAr: 'س١', ayahCount: 3, firstGlobalPosition: 1 },
  { number: 2, nameAr: 'س٢', ayahCount: 6, firstGlobalPosition: 4 },
  { number: 3, nameAr: 'س٣', ayahCount: 4, firstGlobalPosition: 10 },
  { number: 4, nameAr: 'س٤', ayahCount: 2, firstGlobalPosition: 14 },
];

/** global ayah -> [firstPage, firstLine, lastPage, lastLine] */
const AYAH_LAYOUT: Readonly<Record<number, readonly [number, number, number, number]>> = {
  1: [1, 2, 1, 2], 2: [1, 3, 1, 3], 3: [1, 4, 1, 4],
  4: [2, 3, 2, 3], 5: [2, 4, 2, 4], 6: [2, 4, 2, 4], 7: [2, 5, 2, 6], 8: [2, 7, 3, 1], 9: [3, 2, 3, 2],
  10: [3, 5, 3, 5], 11: [4, 1, 4, 1], 12: [4, 1, 4, 1], 13: [4, 2, 4, 2],
  14: [4, 5, 4, 5], 15: [4, 6, 4, 6],
};

const QUARTER_STARTS: readonly number[] = [1, 5, 10, 13];
const quarterOf = (global: number): number => QUARTER_STARTS.filter((start) => start <= global).length;

const refOf = (global: number): AyahRefDto => {
  const surah = [...SURAHS].reverse().find((s) => s.firstGlobalPosition <= global)!;
  return { surah: surah.number, ayah: global - surah.firstGlobalPosition + 1, globalPosition: global };
};

type RawLine = readonly [page: number, line: number, kind: 'TEXT' | 'SURAH_HEADER' | 'BASMALA', surah: number | null, first: number | null, last: number | null];
const RAW_LINES: readonly RawLine[] = [
  [1, 1, 'SURAH_HEADER', 1, null, null], [1, 2, 'TEXT', null, 1, 1], [1, 3, 'TEXT', null, 2, 2], [1, 4, 'TEXT', null, 3, 3],
  [2, 1, 'SURAH_HEADER', 2, null, null], [2, 2, 'BASMALA', 2, null, null], [2, 3, 'TEXT', null, 4, 4], [2, 4, 'TEXT', null, 5, 6],
  [2, 5, 'TEXT', null, 7, 7], [2, 6, 'TEXT', null, 7, 7], [2, 7, 'TEXT', null, 8, 8],
  [3, 1, 'TEXT', null, 8, 8], [3, 2, 'TEXT', null, 9, 9], [3, 3, 'SURAH_HEADER', 3, null, null], [3, 4, 'BASMALA', 3, null, null], [3, 5, 'TEXT', null, 10, 10],
  [4, 1, 'TEXT', null, 11, 12], [4, 2, 'TEXT', null, 13, 13], [4, 3, 'SURAH_HEADER', 4, null, null], [4, 4, 'BASMALA', 4, null, null], [4, 5, 'TEXT', null, 14, 14], [4, 6, 'TEXT', null, 15, 15],
];

const LINES: readonly LineDto[] = RAW_LINES.map(([page, line, kind, surah, first, last], index) => ({
  globalLine: index + 1,
  page,
  line,
  kind,
  surah,
  firstAyah: first === null ? null : refOf(first),
  lastAyah: last === null ? null : refOf(last),
}));

const PAGES: readonly PageDto[] = [1, 2, 3, 4].map((page) => {
  const lines = LINES.filter((l) => l.page === page);
  const text = lines.filter((l) => l.kind === 'TEXT');
  return { page, lineCount: lines.length, firstAyah: text[0]!.firstAyah!, lastAyah: text[text.length - 1]!.lastAyah!, lines };
});

const AYAHS: readonly AyahDto[] = Object.entries(AYAH_LAYOUT).map(([key, [firstPage, firstLine, lastPage, lastLine]]) => {
  const global = Number(key);
  const ref = refOf(global);
  const quarter = quarterOf(global);
  return { globalPosition: global, surah: ref.surah, ayah: ref.ayah, text: '', firstPage, firstLine, lastPage, lastLine, juz: 1, quarter, hizb: Math.ceil(quarter / 4), startsRubMarker: false };
});

const QUARTERS: readonly QuarterDto[] = QUARTER_STARTS.map((start, index) => ({ quarter: index + 1, hizb: 1, start: refOf(start) }));

export const MINI_TOTAL_AYAHS = 15;

/** The read-only source the Range Engine needs, served from the mini Quran above. `calls` counts every read, to prove validation happens first. */
export function createMiniQuran(): QuranRangeSource & { readonly calls: { count: number } } {
  const calls = { count: 0 };
  const touch = <T>(value: T): Promise<T> => {
    calls.count += 1;
    return Promise.resolve(value);
  };
  return {
    calls,
    listSurahs: () => touch([...SURAHS]),
    getAyah: (surah, ayah) => touch(AYAHS.find((a) => a.surah === surah && a.ayah === ayah)),
    getAyahByGlobalPosition: (global) => touch(AYAHS.find((a) => a.globalPosition === global)),
    listQuarters: () => touch([...QUARTERS]),
    getPage: (page) => touch(PAGES.find((p) => p.page === page)),
  };
}
