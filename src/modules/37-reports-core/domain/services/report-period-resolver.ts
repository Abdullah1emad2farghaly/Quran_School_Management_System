import { businessDateOf, isIsoDate } from '../../../00-shared-kernel/public';
import { reportError } from '../errors/report-errors';
import { isReportPeriodKind, type ReportPeriodRequest, type ResolvedReportPeriod } from '../value-objects/report-period';
import { addDays, firstDayOfMonth, firstDayOfPreviousMonth, startOfBusinessDay } from './business-calendar';

/**
 * Turns a requested period into the half-open UTC interval [start, endExclusive) (Master Specification §66, §71). Pure: `now` is passed in.
 * Strict on purpose: dates sent with a kind that takes none are refused (never silently ignored), CUSTOM needs two real dates and start <= end. A custom period may end in the future
 * (the specification does not forbid it; it simply contains no data yet).
 */
export function resolveReportPeriod(request: ReportPeriodRequest, now: Date): ResolvedReportPeriod {
  if (!isReportPeriodKind(request.kind)) throw reportError('INVALID_REPORT_PERIOD');
  const kind = request.kind;
  const hasDates = request.startDate !== undefined || request.endDate !== undefined;

  if (kind !== 'CUSTOM') {
    if (hasDates) throw reportError('REPORT_PERIOD_DATES_NOT_ALLOWED');
    const today = businessDateOf(now);
    if (kind === 'THIS_MONTH') {
      const first = firstDayOfMonth(today);
      return { kind, start: startOfBusinessDay(first), endExclusive: now, startDate: first, endDate: today };
    }
    if (kind === 'LAST_MONTH') {
      const first = firstDayOfPreviousMonth(today);
      const firstOfThisMonth = firstDayOfMonth(today);
      return { kind, start: startOfBusinessDay(first), endExclusive: startOfBusinessDay(firstOfThisMonth), startDate: first, endDate: addDays(firstOfThisMonth, -1) };
    }
    return { kind, start: null, endExclusive: null, startDate: null, endDate: null }; // ACROSS_TIME
  }

  if (request.startDate === undefined || request.endDate === undefined) throw reportError('REPORT_CUSTOM_DATES_REQUIRED');
  if (!isIsoDate(request.startDate) || !isIsoDate(request.endDate)) throw reportError('INVALID_REPORT_DATE');
  if (request.startDate > request.endDate) throw reportError('REPORT_PERIOD_START_AFTER_END'); // ISO dates compare correctly as text
  return {
    kind,
    start: startOfBusinessDay(request.startDate),
    endExclusive: startOfBusinessDay(addDays(request.endDate, 1)), // [start, end + 1 day)
    startDate: request.startDate,
    endDate: request.endDate,
  };
}
