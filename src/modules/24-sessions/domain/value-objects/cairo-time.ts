import { BUSINESS_TIMEZONE } from '../../../00-shared-kernel/public';

/**
 * Schedule slots are local wall-clock times in the business time zone (Africa/Cairo, Master Specification §71); sessions store UTC instants.
 * Pure functions over the platform time-zone database (Egypt's daylight saving time included).
 */

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset of the business zone from UTC at `instant`, in milliseconds (Cairo is ahead of UTC: positive). */
export function cairoOffsetMs(instant: Date): number {
  const seconds = Math.floor(instant.getTime() / 1000) * 1000;
  const parts: Record<string, number> = {};
  for (const p of formatter.formatToParts(new Date(seconds))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) - seconds;
}

/** The calendar date (YYYY-MM-DD) `days` after (or before, when negative) `isoDate`. Date arithmetic only: no zone involved. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO weekday of a calendar date: Monday 1 ... Sunday 7. */
export function isoWeekdayOfDate(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The UTC instant of a local Cairo wall-clock time (`minuteOfDay` = minutes since midnight) on a calendar date.
 * Daylight-saving edges (technical defaults, documented in docs/CLASS-SESSIONS.md): a wall time that happens twice (clocks go back) is the FIRST
 * occurrence; a wall time that does not exist (clocks go forward) is read with the offset in force before the change, which lands one hour later on the clock.
 */
export function cairoWallClockToUtc(isoDate: string, minuteOfDay: number): Date {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  const before = cairoOffsetMs(new Date(naive - DAY_MS));
  const after = cairoOffsetMs(new Date(naive + DAY_MS));
  const valid = [...new Set([before, after])].map((offset) => naive - offset).filter((t) => cairoOffsetMs(new Date(t)) === naive - t);
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(naive - before);
}
