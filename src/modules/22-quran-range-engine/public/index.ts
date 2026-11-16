// Public contract of Module 22 (Quran Position & Range Engine): a CALCULATION over Module 21's read-only data (Master Specification §47).
// Start (surah, or surah + ayah) + Unit (SURAHS, AYAHS, QUARTERS, PAGES, LINES) + Amount + Direction (FORWARD, BACKWARD) -> End position + the
// generated range as per-surah segments in Quran order. Other modules (memorization, revision, assignments...) depend on `QuranRangeEngine`
// (construct it over a `QuranRangeSource`, i.e. Module 21's `QuranStructureLookup`) and never reach Module 21's internals. The module has no
// tables, no HTTP endpoint, no permission and no domain event: it stores nothing and changes nothing.
export { QuranRangeEngine } from '../application/services/quran-range-engine';
export type { QuranRangeSource } from '../application/ports/quran-range-source';
export type { QuranRangeResult, QuranRangeSegment, QuranRangeTotals } from '../application/dto/range-dto';
export { RANGE_UNITS, RANGE_DIRECTIONS, parseRangeRequest } from '../domain/value-objects/range-request';
export type { RangeUnit, RangeDirection, QuranRangeRequest, QuranRangeStart, ParsedRangeRequest } from '../domain/value-objects/range-request';
export { QuranRangeErrorCodes, rangeError, type QuranRangeErrorCode } from '../domain/errors/range-errors';
export { QURAN_RANGE_ERROR_MESSAGES } from '../application/services/range-error-messages';
