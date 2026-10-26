import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const QuranErrorCodes = {
  /** Nothing has been imported yet (`npm run import:quran`): every read answers this until a dataset is imported. */
  QURAN_DATASET_NOT_IMPORTED: 'QURAN_DATASET_NOT_IMPORTED',
  QURAN_SURAH_NOT_FOUND: 'QURAN_SURAH_NOT_FOUND',
  QURAN_AYAH_NOT_FOUND: 'QURAN_AYAH_NOT_FOUND',
  QURAN_PAGE_NOT_FOUND: 'QURAN_PAGE_NOT_FOUND',
  QURAN_QUARTER_NOT_FOUND: 'QURAN_QUARTER_NOT_FOUND',
  /** Import CLI only: a DIFFERENT dataset is already active and the replacement was not confirmed. */
  QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED: 'QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED',
} as const;
export type QuranErrorCode = (typeof QuranErrorCodes)[keyof typeof QuranErrorCodes];

const KIND: Record<QuranErrorCode, ErrorKind> = {
  QURAN_DATASET_NOT_IMPORTED: 'NOT_FOUND',
  QURAN_SURAH_NOT_FOUND: 'NOT_FOUND',
  QURAN_AYAH_NOT_FOUND: 'NOT_FOUND',
  QURAN_PAGE_NOT_FOUND: 'NOT_FOUND',
  QURAN_QUARTER_NOT_FOUND: 'NOT_FOUND',
  QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED: 'CONFLICT',
};

export function quranError(code: QuranErrorCode): AppError {
  return new AppError(code, KIND[code]);
}

/** The dataset is not the approved edition or is incomplete / inconsistent. Carries EVERY problem found (the first ones, capped). Nothing was stored. */
export class QuranDatasetValidationError extends Error {
  constructor(readonly problems: readonly string[], readonly totalProblems: number = problems.length) {
    super(`The Quran dataset is invalid (${totalProblems} problem${totalProblems === 1 ? '' : 's'}).`);
    this.name = 'QuranDatasetValidationError';
  }
}
