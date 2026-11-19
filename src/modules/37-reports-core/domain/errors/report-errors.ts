import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const ReportErrorCodes = {
  /** The period kind is not one of THIS_MONTH, LAST_MONTH, ACROSS_TIME, CUSTOM. */
  INVALID_REPORT_PERIOD: 'INVALID_REPORT_PERIOD',
  /** CUSTOM needs a start date and an end date. */
  REPORT_CUSTOM_DATES_REQUIRED: 'REPORT_CUSTOM_DATES_REQUIRED',
  /** A start/end date was sent with a period kind that does not take dates (nothing is silently ignored). */
  REPORT_PERIOD_DATES_NOT_ALLOWED: 'REPORT_PERIOD_DATES_NOT_ALLOWED',
  /** A date is not a real calendar date `YYYY-MM-DD`. */
  INVALID_REPORT_DATE: 'INVALID_REPORT_DATE',
  REPORT_PERIOD_START_AFTER_END: 'REPORT_PERIOD_START_AFTER_END',
  /** The active role may not run this report type at all (deny by default). */
  REPORT_NOT_ALLOWED: 'REPORT_NOT_ALLOWED',
  /** A requested id (school, group, student, area...) is outside the requester's authorized reporting scope. The answer never reveals whether the id exists. */
  REPORT_SCOPE_FORBIDDEN: 'REPORT_SCOPE_FORBIDDEN',
} as const;
export type ReportErrorCode = (typeof ReportErrorCodes)[keyof typeof ReportErrorCodes];

const KIND: Record<ReportErrorCode, ErrorKind> = {
  INVALID_REPORT_PERIOD: 'VALIDATION',
  REPORT_CUSTOM_DATES_REQUIRED: 'VALIDATION',
  REPORT_PERIOD_DATES_NOT_ALLOWED: 'VALIDATION',
  INVALID_REPORT_DATE: 'VALIDATION',
  REPORT_PERIOD_START_AFTER_END: 'VALIDATION',
  REPORT_NOT_ALLOWED: 'FORBIDDEN',
  REPORT_SCOPE_FORBIDDEN: 'FORBIDDEN',
};

export function reportError(code: ReportErrorCode): AppError {
  return new AppError(code, KIND[code]);
}
