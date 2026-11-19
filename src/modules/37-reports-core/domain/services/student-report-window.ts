import { isIsoDate } from '../../../00-shared-kernel/public';
import { reportError } from '../errors/report-errors';
import type { ResolvedReportPeriod } from '../value-objects/report-period';
import { startOfBusinessDay } from './business-calendar';

/** The part of a report period that may contain ONE student's data. */
export interface StudentReportWindow {
  /** Inclusive UTC start: MAX(student join date, requested report start). Never before the join date. */
  readonly start: Date;
  /** Exclusive UTC end, or null when the period is unbounded (ACROSS_TIME). */
  readonly endExclusive: Date | null;
  /** True when the student joined on or after the end of the period: there is nothing to report. */
  readonly isEmpty: boolean;
}

/**
 * Student report effective start (Master Specification §67): `MAX(Student Join Date, Requested Report Start)`. Student data before the join date is never reported.
 * `joinDate` is the student's business join date (`YYYY-MM-DD`, Africa/Cairo); it counts from the start of that day. For ACROSS_TIME (no requested start) the window starts at the join date.
 */
export function studentReportWindow(period: ResolvedReportPeriod, joinDate: string): StudentReportWindow {
  if (!isIsoDate(joinDate)) throw reportError('INVALID_REPORT_DATE');
  const joined = startOfBusinessDay(joinDate);
  const start = period.start !== null && period.start.getTime() > joined.getTime() ? period.start : joined;
  const isEmpty = period.endExclusive !== null && period.endExclusive.getTime() <= start.getTime();
  return { start, endExclusive: period.endExclusive, isEmpty };
}
