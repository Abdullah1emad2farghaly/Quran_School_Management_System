/**
 * Report periods (Master Specification §66). The four kinds and what each means:
 *  - THIS_MONTH : the first day of the current month (Africa/Cairo) -> now
 *  - LAST_MONTH : the previous full calendar month
 *  - ACROSS_TIME: all historical data within the caller's authorized scope (no date bounds; the scope is enforced by the reports that use it, never by the period)
 *  - CUSTOM     : inclusive start and end DATES; internally the half-open interval [start, end + 1 day)
 */
export const REPORT_PERIOD_KINDS = ['THIS_MONTH', 'LAST_MONTH', 'ACROSS_TIME', 'CUSTOM'] as const;
export type ReportPeriodKind = (typeof REPORT_PERIOD_KINDS)[number];
export const isReportPeriodKind = (value: unknown): value is ReportPeriodKind => typeof value === 'string' && (REPORT_PERIOD_KINDS as readonly string[]).includes(value);

/** What a caller asks for. `startDate` / `endDate` (`YYYY-MM-DD`, Cairo business dates) belong to CUSTOM only. */
export interface ReportPeriodRequest {
  readonly kind: ReportPeriodKind | string;
  readonly startDate?: string | undefined;
  readonly endDate?: string | undefined;
}

/**
 * A resolved period: the HALF-OPEN UTC interval [start, endExclusive) that queries use, plus the business dates to display. `null` means unbounded on that side (ACROSS_TIME).
 * `startDate` / `endDate` are inclusive Africa/Cairo calendar dates for display (`endDate` is the last day INCLUDED, not the exclusive bound).
 */
export interface ResolvedReportPeriod {
  readonly kind: ReportPeriodKind;
  readonly start: Date | null;
  readonly endExclusive: Date | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
}
