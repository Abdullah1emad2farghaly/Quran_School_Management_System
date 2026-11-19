import { BUSINESS_TIMEZONE, businessDateOf } from '../../../00-shared-kernel/public';

/**
 * Business-calendar arithmetic for reports (Master Specification §71): dates are `YYYY-MM-DD` calendar dates in Africa/Cairo and instants are UTC.
 * Egypt observes daylight saving time, so a Cairo midnight is NOT a fixed UTC offset: it is found with the platform's time-zone data (Intl), never with a hard-coded offset.
 */

const pad = (n: number): string => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;
const partsOf = (isoDate: string): [number, number, number] => [Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)), Number(isoDate.slice(8, 10))];

/** `isoDate` plus `days` calendar days (negative allowed). Pure calendar arithmetic, no time zone involved. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = partsOf(isoDate);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const firstDayOfMonth = (isoDate: string): string => `${isoDate.slice(0, 8)}01`;

/** The first day of the month before the one `isoDate` is in (January -> December of the previous year). */
export function firstDayOfPreviousMonth(isoDate: string): string {
  const [y, m] = partsOf(isoDate);
  return m === 1 ? toIso(y - 1, 12, 1) : toIso(y, m - 1, 1);
}

/**
 * The first instant (UTC) of the business day `isoDate` in Africa/Cairo: the earliest instant whose Cairo calendar date is `isoDate`. Normally that is 00:00 Cairo; on a day where the clocks
 * jump forward over midnight it is the first instant that exists (for example 01:00). Found by binary search over the monotonic function "Cairo date of an instant".
 */
export function startOfBusinessDay(isoDate: string, timeZone: string = BUSINESS_TIMEZONE): Date {
  const [y, m, d] = partsOf(isoDate);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const HOUR = 3600 * 1000;
  let lo = utcMidnight - 15 * HOUR; // certainly before the day starts in any zone
  let hi = utcMidnight + 15 * HOUR; // certainly inside or after the day
  // invariant: businessDateOf(lo) < isoDate <= businessDateOf(hi)
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (businessDateOf(new Date(mid), timeZone) >= isoDate) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}
