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

/**
 * A memorization range as the Quran Range Engine (Module 22) calculated it: the request that produced it (start + unit + amount + direction, Master Specification §48)
 * and the result (first/last ayah in Quran order, per-surah segments). Stored as a snapshot, so a later change to nothing in the engine can alter history.
 */
export interface MemorizationRange {
  readonly request: { readonly start: { readonly surah: number; readonly ayah: number | null }; readonly unit: RangeUnit; readonly amount: number; readonly direction: RangeDirection };
  readonly first: AyahRef;
  readonly last: AyahRef;
  readonly segments: readonly RangeSegment[];
  readonly ayahCount: number;
}

export function toMemorizationRange(result: QuranRangeResult): MemorizationRange {
  return {
    request: { start: { surah: result.request.start.surah, ayah: result.request.start.ayah }, unit: result.request.unit, amount: result.request.amount, direction: result.request.direction },
    first: { surah: result.first.surah, ayah: result.first.ayah },
    last: { surah: result.last.surah, ayah: result.last.ayah },
    segments: result.segments.map((s) => ({ surah: s.surah, firstAyah: s.firstAyah, lastAyah: s.lastAyah })),
    ayahCount: result.totals.ayahs,
  };
}

/** Two ranges are the SAME when they cover exactly the same ayahs (whatever unit or direction produced them). */
export function sameQuranRange(a: MemorizationRange, b: MemorizationRange): boolean {
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
