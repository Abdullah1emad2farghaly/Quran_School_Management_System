import type { JuzVerification, LineKind } from '../value-objects/quran-edition';

/**
 * Quran reference data is IMMUTABLE through the application: these are plain read-only records (no behaviour, no setters).
 * `globalAyah` (1..6236) is THE global position of the canonical order; `globalLine` is the global line number in page/line order.
 */
export interface Surah {
  readonly number: number;
  readonly nameAr: string;
  readonly ayahCount: number;
  readonly firstGlobalAyah: number;
}

export interface Ayah {
  readonly globalAyah: number;
  readonly surah: number;
  readonly ayah: number;
  /** The official text, verbatim (it ends with the end-of-ayah mark and number, and starts with the quarter marker when a quarter starts here). */
  readonly text: string;
  /** The first and the last line that carry the ayah (an ayah can span lines and pages). */
  readonly firstPage: number;
  readonly firstLine: number;
  readonly lastPage: number;
  readonly lastLine: number;
  /** The juz of the ayah (the official KFGQPC `jozz` value). */
  readonly juz: number;
  /** The quarter (rub' al-hizb 1..240) containing the ayah, from the approved quarter source. */
  readonly quarter: number;
  /** The official text of this ayah starts with the printed quarter marker (a property of the text; the quarter records are the authority for quarter positions). */
  readonly startsRubMarker: boolean;
}

export interface QuranLine {
  readonly globalLine: number;
  readonly page: number;
  readonly line: number;
  readonly kind: LineKind;
  /** The surah of a SURAH_HEADER / BASMALA line; null for TEXT lines. */
  readonly surah: number | null;
  /** The first and last global ayah touched by a TEXT line (an ayah may continue from / into the neighbouring line); null otherwise. */
  readonly firstGlobalAyah: number | null;
  readonly lastGlobalAyah: number | null;
}

export interface QuranPage {
  readonly page: number;
  readonly lineCount: number;
  readonly firstGlobalAyah: number;
  readonly lastGlobalAyah: number;
}

/** Where a juz or a printed quarter marker starts. */
export interface QuranDivisionStart {
  readonly startGlobalAyah: number;
  readonly startSurah: number;
  readonly startAyah: number;
}
/** A quarter (rub' al-hizb) record of the approved quarter source; `hizb` is the hizb containing it (4 quarters per hizb). */
export interface QuranQuarter extends QuranDivisionStart {
  readonly quarter: number;
  readonly hizb: number;
}
export interface QuranJuz extends QuranDivisionStart {
  readonly juz: number;
  readonly verification: JuzVerification;
}
/** A printed quarter marker symbol of the official text (evidence about the text); `mark` is its ordinal among the printed markers, NOT a quarter number. */
export interface QuranQuarterMark extends QuranDivisionStart {
  readonly mark: number;
}

/** Attribution of the imported dataset (kept with the data). */
export interface QuranSourceInfo {
  readonly provider: string;
  readonly name: string;
  readonly version: string | null;
  readonly url: string | null;
  readonly license: string | null;
  readonly retrievedOn: string | null;
  /** The files of the source package the dataset was built from, with their SHA-256. */
  readonly files: ReadonlyArray<{ readonly name: string; readonly sha256: string }>;
  /** Who supplied which part of the data (text and layout, juz, quarters), with the notice the supplier states. */
  readonly attributions: ReadonlyArray<{ readonly role: string; readonly provider: string; readonly name: string; readonly version: string | null; readonly license: string | null; readonly notice: string | null }>;
}

export interface QuranDatasetInfo {
  readonly id: string;
  readonly editionCode: string;
  readonly source: QuranSourceInfo;
  /** SHA-256 of the imported file. */
  readonly checksum: string;
  readonly counts: { readonly surahs: number; readonly ayahs: number; readonly pages: number; readonly lines: number; readonly quarters: number; readonly quarterMarks: number };
  readonly importedAt: Date;
}

/** A fully validated dataset, ready to be stored: every derived field was computed and cross-checked. */
export interface ValidatedQuranDataset {
  readonly editionCode: string;
  readonly source: QuranSourceInfo;
  readonly surahs: readonly Surah[];
  readonly ayahs: readonly Ayah[];
  readonly pages: readonly QuranPage[];
  readonly lines: readonly QuranLine[];
  readonly juzs: readonly QuranJuz[];
  readonly quarters: readonly QuranQuarter[];
  readonly quarterMarks: readonly QuranQuarterMark[];
}
