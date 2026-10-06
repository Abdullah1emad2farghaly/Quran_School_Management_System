import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

/** Timestamps are stored in UTC; business dates are evaluated in this timezone. */
export const BUSINESS_TIMEZONE = 'Africa/Cairo';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** Calendar date (YYYY-MM-DD) of an instant in the business timezone. */
export function businessDateOf(instant: Date, timeZone: string = BUSINESS_TIMEZONE): string {
  if (Number.isNaN(instant.getTime())) throw new AppError(ErrorCodes.INVALID_DATE, 'VALIDATION');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
