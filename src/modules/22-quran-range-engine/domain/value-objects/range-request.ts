import { rangeError } from '../errors/range-errors';

/** What is counted. SURAHS: complete surahs. AYAHS: ayahs. QUARTERS: rub' al-hizb units. PAGES: pages/faces of the 604-page edition. LINES: TEXT lines only. */
export const RANGE_UNITS = ['SURAHS', 'AYAHS', 'QUARTERS', 'PAGES', 'LINES'] as const;
export type RangeUnit = (typeof RANGE_UNITS)[number];

/** FORWARD moves toward the end of the Quran, BACKWARD toward its beginning. */
export const RANGE_DIRECTIONS = ['FORWARD', 'BACKWARD'] as const;
export type RangeDirection = (typeof RANGE_DIRECTIONS)[number];

/**
 * Where a range starts: a surah, optionally with an ayah of it.
 *  - with `ayah`: the range is anchored at that ayah (FORWARD begins at it, BACKWARD ends at it);
 *  - without `ayah` (a surah-only start): FORWARD is anchored at the FIRST ayah of the surah, BACKWARD at its LAST ayah.
 */
export interface QuranRangeStart {
  readonly surah: number;
  readonly ayah?: number | null;
}

export interface QuranRangeRequest {
  readonly start: QuranRangeStart;
  readonly unit: RangeUnit;
  /** A positive integer: how many units to count. */
  readonly amount: number;
  readonly direction: RangeDirection;
}

/** A request that passed the shape checks (the data checks, such as "that ayah exists", come with the Quran data). */
export interface ParsedRangeRequest {
  readonly unit: RangeUnit;
  readonly direction: RangeDirection;
  readonly amount: number;
  readonly surah: number;
  /** null = a surah-only start. */
  readonly ayah: number | null;
}

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value);
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/** Validates the SHAPE of a request without reading any Quran data. Throws a VALIDATION AppError naming the first problem. */
export function parseRangeRequest(input: unknown): ParsedRangeRequest {
  const request = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  if (!isOneOf(RANGE_UNITS, request.unit)) throw rangeError('QURAN_RANGE_UNIT_INVALID', { allowed: RANGE_UNITS });
  if (!isOneOf(RANGE_DIRECTIONS, request.direction)) throw rangeError('QURAN_RANGE_DIRECTION_INVALID', { allowed: RANGE_DIRECTIONS });
  if (!isPositiveInteger(request.amount)) throw rangeError('QURAN_RANGE_AMOUNT_INVALID');
  const start = request.start;
  if (typeof start !== 'object' || start === null || Array.isArray(start)) throw rangeError('QURAN_RANGE_START_INVALID');
  const { surah, ayah } = start as Record<string, unknown>;
  if (!isPositiveInteger(surah)) throw rangeError('QURAN_RANGE_START_INVALID');
  if (ayah !== undefined && ayah !== null && !isPositiveInteger(ayah)) throw rangeError('QURAN_RANGE_START_INVALID');
  return { unit: request.unit, direction: request.direction, amount: request.amount, surah, ayah: ayah ?? null };
}
