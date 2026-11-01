import type { QuranRangeResult, RangeDirection, RangeUnit } from '../../../22-quran-range-engine/public';

export interface AyahRef {
  readonly surah: number;
  readonly ayah: number;
}
export interface RangeSegment {
  readonly surah: number;
  readonly firstAyah: number;
  readonly lastAyah: number;
}

/** The units a revision range may be entered in (Master Specification §49 and the approved Module 28 decisions). LINES is not offered for revision. */
export const REVISION_UNITS = ['AYAHS', 'PAGES', 'QUARTERS', 'SURAHS'] as const;
export type RevisionUnit = (typeof REVISION_UNITS)[number];

/**
 * What the Teacher entered, kept as entered (historical context):
 *  - START_UNIT_AMOUNT: `start` is a number whose meaning depends on the unit (AYAHS: the ayah number inside `surah`, which is then required; PAGES: the Mushaf page;
 *    QUARTERS: the quarter number; SURAHS: the surah number), `amount` units, `direction`.
 *  - FROM_SURAH_TO_SURAH: complete surahs from `fromSurah` to `toSurah`, both included; FORWARD when fromSurah <= toSurah, BACKWARD otherwise.
 */
export type RevisionRangeInput =
  | { readonly form: 'START_UNIT_AMOUNT'; readonly unit: RevisionUnit; readonly surah: number | null; readonly start: number; readonly amount: number; readonly direction: RangeDirection }
  | { readonly form: 'FROM_SURAH_TO_SURAH'; readonly fromSurah: number; readonly toSurah: number };

/**
 * A revision range: what was entered (`input`), the Module 22 request it was translated to (`request`: always a surah/ayah anchor, a unit, an amount, a direction) and the
 * result Module 22 calculated (first/last ayah in Quran order, per-surah segments). Stored as a snapshot, so history never changes.
 */
export interface RevisionRange {
  readonly input: RevisionRangeInput;
  readonly request: { readonly start: { readonly surah: number; readonly ayah: number | null }; readonly unit: RangeUnit; readonly amount: number; readonly direction: RangeDirection };
  readonly first: AyahRef;
  readonly last: AyahRef;
  readonly segments: readonly RangeSegment[];
  readonly ayahCount: number;
}

export function toRevisionRange(input: RevisionRangeInput, result: QuranRangeResult): RevisionRange {
  return {
    input,
    request: { start: { surah: result.request.start.surah, ayah: result.request.start.ayah }, unit: result.request.unit, amount: result.request.amount, direction: result.request.direction },
    first: { surah: result.first.surah, ayah: result.first.ayah },
    last: { surah: result.last.surah, ayah: result.last.ayah },
    segments: result.segments.map((s) => ({ surah: s.surah, firstAyah: s.firstAyah, lastAyah: s.lastAyah })),
    ayahCount: result.totals.ayahs,
  };
}

/** Two ranges are the SAME when they cover exactly the same ayahs (whatever form, unit or direction produced them). */
export function sameQuranRange(a: RevisionRange, b: RevisionRange): boolean {
  if (a.segments.length !== b.segments.length) return false;
  return a.segments.every((s, i) => {
    const o = b.segments[i] as RangeSegment;
    return s.surah === o.surah && s.firstAyah === o.firstAyah && s.lastAyah === o.lastAyah;
  });
}

export const ASSIGNMENT_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const ASSIGNMENT_ACTIONS = ['DEFINED', 'MODIFIED', 'CANCELLED'] as const;
export type AssignmentAction = (typeof ASSIGNMENT_ACTIONS)[number];

export const MAX_BATCH_RECORDS = 200;
export const MAX_REASON_LENGTH = 500;
/** Key of the shared (group-wide) assignment of a GROUP-mode group; an INDIVIDUAL assignment uses the student id. */
export const GROUP_SUBJECT_KEY = 'GROUP';
