import type { JuzVerification, LineKind } from '../../domain/value-objects/quran-edition';

/** An ayah position: the surah and ayah numbers and the global position (1..6236) of the canonical order. */
export interface AyahRefDto {
  readonly surah: number;
  readonly ayah: number;
  readonly globalPosition: number;
}

export interface SurahDto {
  readonly number: number;
  readonly nameAr: string;
  readonly ayahCount: number;
  readonly firstGlobalPosition: number;
}

export interface AyahDto {
  readonly globalPosition: number;
  readonly surah: number;
  readonly ayah: number;
  /** The official text, verbatim. */
  readonly text: string;
  readonly firstPage: number;
  readonly firstLine: number;
  readonly lastPage: number;
  readonly lastLine: number;
  /** The juz of the ayah (the official KFGQPC Excel `jozz` value). */
  readonly juz: number;
  /** The quarter (rub' al-hizb, 1..240) containing the ayah, from the approved quarter source, and its hizb. */
  readonly quarter: number;
  readonly hizb: number;
  /** The official text of this ayah starts with the printed quarter marker (a property of the text, not a quarter position). */
  readonly startsRubMarker: boolean;
}

export interface LineDto {
  readonly globalLine: number;
  readonly page: number;
  readonly line: number;
  readonly kind: LineKind;
  readonly surah: number | null;
  readonly firstAyah: AyahRefDto | null;
  readonly lastAyah: AyahRefDto | null;
}

export interface PageDto {
  readonly page: number;
  readonly lineCount: number;
  readonly firstAyah: AyahRefDto;
  readonly lastAyah: AyahRefDto;
  readonly lines: readonly LineDto[];
}

/** A juz start (the official KFGQPC Excel `jozz` value) and, informationally, how it relates to the quarter markers printed in the text. */
export interface JuzDto {
  readonly juz: number;
  readonly start: AyahRefDto;
  readonly verification: JuzVerification;
}

/** A quarter (rub' al-hizb) record of the approved quarter source. */
export interface QuarterDto {
  readonly quarter: number;
  readonly hizb: number;
  readonly start: AyahRefDto;
}

/** A quarter marker symbol printed in the official text (evidence about the text). `mark` is the ordinal among the printed markers, NOT a quarter number. */
export interface QuarterMarkDto {
  readonly mark: number;
  readonly start: AyahRefDto;
}

export interface QuranDatasetInfoDto {
  readonly editionCode: string;
  readonly source: { readonly provider: string; readonly name: string; readonly version: string | null; readonly url: string | null; readonly license: string | null; readonly retrievedOn: string | null; readonly files: ReadonlyArray<{ readonly name: string; readonly sha256: string }>; readonly attributions: ReadonlyArray<{ readonly role: string; readonly provider: string; readonly name: string; readonly version: string | null; readonly license: string | null; readonly notice: string | null }> };
  readonly checksum: string;
  readonly counts: { readonly surahs: number; readonly ayahs: number; readonly pages: number; readonly lines: number; readonly quarters: number; readonly quarterMarks: number };
  /** What the dataset contains: the quarter records imported against the 240 of the Quran, the printed marker symbols, and how the juz starts relate to those markers. */
  readonly coverage: {
    readonly quarters: { readonly expected: number; readonly imported: number };
    readonly printedQuarterMarkers: number;
    readonly juz: { readonly total: number; readonly markerConfirmed: number; readonly surahStartNoMarker: number; readonly markerConflict: number };
  };
  readonly importedAt: string;
}
