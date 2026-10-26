/**
 * The ONE approved Quran edition of V1 (project owner, Module 21 decisions): Madinah Mushaf, Hafs narration from Asim, the standard
 * 604-page edition. Nothing here is Quran DATA: these are the invariants a dataset must satisfy to be accepted as that edition.
 * Quran data itself (surah names, ayah text, line layout, juz starts, quarter markers) only ever comes from an imported source file.
 */
export const QURAN_EDITION_CODE = 'MADINAH_MUSHAF_HAFS_604';
export const QURAN_MUSHAF = 'MADINAH_MUSHAF';
export const QURAN_NARRATION = 'HAFS_AN_ASIM';

export const QURAN_SURAH_COUNT = 114;
export const QURAN_AYAH_COUNT = 6236;
export const QURAN_PAGE_COUNT = 604;
/** The expected total of hizb-quarters of the Quran. NOT a V1 completion requirement: V1 stores only the quarter starts the approved package can evidence. */
export const QURAN_QUARTER_COUNT = 240;
export const QURAN_HIZB_COUNT = 60;
export const QURAN_JUZ_COUNT = 30;
export const QUARTERS_PER_HIZB = 4;
export const QUARTERS_PER_JUZ = 8;
/** U+06DD ARABIC END OF AYAH: every official ayah text ends with it followed by the ayah number in Arabic-Indic digits. */
export const AYAH_END_MARK = '\u06DD';
/** U+06DE ARABIC START OF RUB EL HIZB: the printed quarter marker; in the official text it is the first character of the ayah it starts. */
export const RUB_EL_HIZB_MARK = '\u06DE';

/**
 * How a juz start (the official KFGQPC Excel `jozz` value, authoritative by decision) relates to the quarter markers printed in the same official text.
 * INFORMATIONAL: it never changes or replaces the juz value.
 *  MARKER_CONFIRMED      the start ayah's text starts with a printed quarter marker;
 *  SURAH_START_NO_MARKER the start is ayah 1 of a surah, where the official text prints no marker;
 *  MARKER_CONFLICT       the start is mid-surah and its text carries no marker (the printed marker is at another ayah). The juz value stays as the Excel states it.
 */
export const JUZ_VERIFICATIONS = ['MARKER_CONFIRMED', 'SURAH_START_NO_MARKER', 'MARKER_CONFLICT'] as const;
export type JuzVerification = (typeof JUZ_VERIFICATIONS)[number];

/** Surahs with no separate basmala line: Al-Fatiha (the basmala is its first ayah) and At-Tawbah (it has none). */
export const SURAHS_WITHOUT_BASMALA_LINE: readonly number[] = Object.freeze([1, 9]);

/** Ayahs per surah in the Hafs count (Kufan numbering, the Madinah Mushaf). Verification oracle only; 114 entries summing to 6236 (unit-tested). */
export const SURAH_AYAH_COUNTS: readonly number[] = Object.freeze([
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37,
  35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19,
  5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
]);

export const LINE_KINDS = ['TEXT', 'SURAH_HEADER', 'BASMALA'] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const isLineKind = (value: unknown): value is LineKind => typeof value === 'string' && (LINE_KINDS as readonly string[]).includes(value);

/** Facts of the edition verified against the approved package itself (official CSV, DOCX layout and PDF). A dataset that contradicts one is NOT this edition and is rejected. */
export interface EditionAnchors {
  /** The page on which the ayah STARTS (its first line). */
  readonly ayahFirstPage: ReadonlyArray<{ readonly surah: number; readonly ayah: number; readonly page: number }>;
}

export interface EditionProfile {
  readonly code: string;
  readonly mushaf: string;
  readonly narration: string;
  readonly pageCount: number;
  readonly anchors: EditionAnchors;
}

export const MADINAH_HAFS_604_PROFILE: EditionProfile = Object.freeze({
  code: QURAN_EDITION_CODE,
  mushaf: QURAN_MUSHAF,
  narration: QURAN_NARRATION,
  pageCount: QURAN_PAGE_COUNT,
  anchors: Object.freeze({
    ayahFirstPage: Object.freeze([
      { surah: 1, ayah: 1, page: 1 },
      { surah: 2, ayah: 1, page: 2 },
      { surah: 2, ayah: 142, page: 22 }, // first ayah of Juz 2
      { surah: 78, ayah: 1, page: 582 }, // first ayah of Juz 30
    ]),
  }),
});

/** Hizb and Juz of a quarter: the fixed structure of the Quran (4 quarters per hizb, 2 hizb per juz). */
export const hizbOfQuarter = (quarter: number): number => Math.ceil(quarter / QUARTERS_PER_HIZB);
export const juzOfQuarter = (quarter: number): number => Math.ceil(quarter / QUARTERS_PER_JUZ);

export const isSurahNumber = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= QURAN_SURAH_COUNT;

/** First global ayah of each surah (index = surah number; index 0 unused), from the edition's ayah counts. */
const FIRST_GLOBAL_AYAH: readonly number[] = (() => {
  const result: number[] = [0];
  let next = 1;
  for (const count of SURAH_AYAH_COUNTS) {
    result.push(next);
    next += count;
  }
  return result;
})();
const SURAH_OF_GLOBAL: Uint16Array = (() => {
  const array = new Uint16Array(QURAN_AYAH_COUNT + 1);
  for (let surah = 1; surah <= QURAN_SURAH_COUNT; surah += 1) for (let a = 0; a < SURAH_AYAH_COUNTS[surah - 1]!; a += 1) array[FIRST_GLOBAL_AYAH[surah]! + a] = surah;
  return array;
})();

export const firstGlobalAyahOf = (surah: number): number => FIRST_GLOBAL_AYAH[surah]!;
/** The global position (1..6236) of surah:ayah, or undefined when it is not an ayah of the Hafs count. */
export function globalPositionOf(surah: number, ayah: number): number | undefined {
  if (!isSurahNumber(surah) || !Number.isInteger(ayah) || ayah < 1 || ayah > SURAH_AYAH_COUNTS[surah - 1]!) return undefined;
  return FIRST_GLOBAL_AYAH[surah]! + ayah - 1;
}
/** The surah and ayah number of a global position (1..6236), or undefined. */
export function ayahPositionOf(globalPosition: number): { readonly surah: number; readonly ayah: number } | undefined {
  if (!Number.isInteger(globalPosition) || globalPosition < 1 || globalPosition > QURAN_AYAH_COUNT) return undefined;
  const surah = SURAH_OF_GLOBAL[globalPosition]!;
  return { surah, ayah: globalPosition - FIRST_GLOBAL_AYAH[surah]! + 1 };
}
