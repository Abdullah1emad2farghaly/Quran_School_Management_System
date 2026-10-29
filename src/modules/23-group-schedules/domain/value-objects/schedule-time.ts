import { scheduleError } from '../errors/schedule-errors';

/** The Egyptian week order: Saturday first. This is the order slots are listed in. */
export const DAYS_OF_WEEK = ['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

/** ISO weekday numbers (Monday = 1 ... Sunday = 7): how the weekday is stored. */
const ISO_NUMBER: Readonly<Record<DayOfWeek, number>> = { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 };

export const isoNumberOf = (day: DayOfWeek): number => ISO_NUMBER[day];
export function dayOfIsoNumber(number: number): DayOfWeek {
  const day = DAYS_OF_WEEK.find((d) => ISO_NUMBER[d] === number);
  if (!day) throw new Error(`not a weekday number: ${number}`);
  return day;
}
/** 0 (Saturday) ... 6 (Friday). */
export const weekOrderOf = (day: DayOfWeek): number => DAYS_OF_WEEK.indexOf(day);

export function parseDayOfWeek(input: unknown): DayOfWeek {
  if (typeof input !== 'string' || !(DAYS_OF_WEEK as readonly string[]).includes(input)) throw scheduleError('SCHEDULE_DAY_INVALID', { allowed: DAYS_OF_WEEK });
  return input as DayOfWeek;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Exactly `HH:MM` on a 24-hour clock (00:00 to 23:59) -> minutes since midnight. Local wall-clock time: no seconds, no zone. */
export function parseMinutes(input: unknown): number {
  const match = typeof input === 'string' ? TIME.exec(input) : null;
  if (!match) throw scheduleError('SCHEDULE_TIME_INVALID');
  return Number(match[1]) * 60 + Number(match[2]);
}
export function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The end must be after the start, on the same day. */
export function assertValidRange(startMinute: number, endMinute: number): void {
  if (endMinute <= startMinute) throw scheduleError('SCHEDULE_TIME_RANGE_INVALID');
}

export interface MinuteRange {
  readonly startMinute: number;
  readonly endMinute: number;
}
/** Two ranges of the SAME day overlap when they share some time. A boundary that merely touches (18:00-19:00 and 19:00-20:00) is not an overlap. */
export const slotsOverlap = (a: MinuteRange, b: MinuteRange): boolean => a.startMinute < b.endMinute && b.startMinute < a.endMinute;
