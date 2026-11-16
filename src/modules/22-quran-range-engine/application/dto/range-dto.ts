import type { AyahRefDto } from '../../../21-quran-structure/public';
import type { RangeDirection, RangeUnit } from '../../domain/value-objects/range-request';

/** The part of one surah that a range covers. Segments are ALWAYS listed in Quran order, whatever the direction. */
export interface QuranRangeSegment {
  readonly surah: number;
  readonly firstAyah: number;
  readonly lastAyah: number;
  readonly ayahCount: number;
  /** The segment is the whole surah. */
  readonly complete: boolean;
}

export interface QuranRangeTotals {
  /** Ayahs in the range. */
  readonly ayahs: number;
  /** Surahs the range touches (= segments). */
  readonly surahs: number;
  /** Pages from the first page of the first ayah to the last page of the last ayah. */
  readonly pages: number;
  /** TEXT lines that carry text of the range (banners and basmala lines are never counted; a line shared with a neighbouring ayah counts). */
  readonly textLines: number;
}

export interface QuranRangeResult {
  /** The request as understood (`start.ayah` is null for a surah-only start). */
  readonly request: { readonly unit: RangeUnit; readonly direction: RangeDirection; readonly amount: number; readonly start: { readonly surah: number; readonly ayah: number | null } };
  /** The ayah the range is anchored at: the requested ayah, or the first (FORWARD) / last (BACKWARD) ayah of a surah-only start. */
  readonly start: AyahRefDto;
  /** The ayah where the count ended, in the direction of travel: the LAST ayah of the range going FORWARD, the FIRST ayah going BACKWARD. */
  readonly end: AyahRefDto;
  /** The first and last ayah of the range in Quran order (independent of the direction). */
  readonly first: AyahRefDto;
  readonly last: AyahRefDto;
  readonly segments: readonly QuranRangeSegment[];
  readonly totals: QuranRangeTotals;
}
