import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const QuranRangeErrorCodes = {
  /** The unit is not one of SURAHS, AYAHS, QUARTERS, PAGES, LINES. */
  QURAN_RANGE_UNIT_INVALID: 'QURAN_RANGE_UNIT_INVALID',
  /** The direction is not FORWARD or BACKWARD. */
  QURAN_RANGE_DIRECTION_INVALID: 'QURAN_RANGE_DIRECTION_INVALID',
  /** The amount is not a positive integer. */
  QURAN_RANGE_AMOUNT_INVALID: 'QURAN_RANGE_AMOUNT_INVALID',
  /** The start is not a surah (1..114), optionally with an ayah that exists in that surah. */
  QURAN_RANGE_START_INVALID: 'QURAN_RANGE_START_INVALID',
  /** The requested amount goes past the first or the last position of the Quran (never wrapped around, never clamped). `details.boundary` says which. */
  QURAN_RANGE_EXCEEDS_QURAN: 'QURAN_RANGE_EXCEEDS_QURAN',
  /** The imported layout contradicts itself (e.g. an ayah names a text line that does not exist): no range is returned rather than a wrong one. */
  QURAN_RANGE_LAYOUT_INCONSISTENT: 'QURAN_RANGE_LAYOUT_INCONSISTENT',
} as const;
export type QuranRangeErrorCode = (typeof QuranRangeErrorCodes)[keyof typeof QuranRangeErrorCodes];

const KIND: Record<QuranRangeErrorCode, ErrorKind> = {
  QURAN_RANGE_UNIT_INVALID: 'VALIDATION',
  QURAN_RANGE_DIRECTION_INVALID: 'VALIDATION',
  QURAN_RANGE_AMOUNT_INVALID: 'VALIDATION',
  QURAN_RANGE_START_INVALID: 'VALIDATION',
  QURAN_RANGE_EXCEEDS_QURAN: 'BUSINESS_RULE',
  QURAN_RANGE_LAYOUT_INCONSISTENT: 'INTERNAL',
};

export function rangeError(code: QuranRangeErrorCode, details?: unknown): AppError {
  return new AppError(code, KIND[code], details);
}
