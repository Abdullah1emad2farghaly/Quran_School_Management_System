import { addDays, cairoWallClockToUtc } from '../../../24-sessions/public';

/**
 * Time-driven reminder rules of Module 32 (Master Specification §57, §63 and the approved Module 32 decisions).
 * Pure functions only: nothing here reads a clock or another module.
 */
export const REMINDER_KINDS = {
  /** Exam reminder, 24 hours before the scheduled start (parents of the target students and the assigned examiners). */
  EXAM_24H: 'EXAM_24H',
  /** Half-session reminder: memorization and/or revision was scheduled and has no record yet (assigned Teacher only). */
  SESSION_HALF_TIME: 'SESSION_HALF_TIME',
  /** Warning 15 minutes before the scheduled session end: present students with an assignment still lack an evaluation (assigned Teacher only). */
  SESSION_EVALUATION: 'SESSION_EVALUATION',
  /** First unpaid-subscription reminder, 3 calendar days (Africa/Cairo) after the subscription was created (the student's Parent only). Subject = subscription id. */
  SUBSCRIPTION_UNPAID_3D: 'SUBSCRIPTION_UNPAID_3D',
  /** End-of-month unpaid reminder, once per school and month at the start of the final five calendar days (Parent, Collectors, School Manager). Subject = the bulk batch id. */
  SUBSCRIPTION_UNPAID_MONTH_END: 'SUBSCRIPTION_UNPAID_MONTH_END',
} as const;
export type ReminderKind = (typeof REMINDER_KINDS)[keyof typeof REMINDER_KINDS];
export const REMINDER_KIND_VALUES: readonly ReminderKind[] = Object.values(REMINDER_KINDS);

/** PENDING: waiting (or due). SENT: the checks passed and the notifications were created. SUPPRESSED: not sent on purpose (cancelled, ended, nothing to remind). FAILED: gave up after repeated technical errors. */
export const REMINDER_STATES = ['PENDING', 'SENT', 'SUPPRESSED', 'FAILED'] as const;
export type ReminderState = (typeof REMINDER_STATES)[number];

export const EXAM_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
export const EVALUATION_WARNING_LEAD_MS = 15 * 60 * 1000;

/** Technical limits of the reminder worker (none of them is a business rule). */
export const REMINDER_LIMITS = {
  batchSize: 50,
  claimLockMs: 60_000,
  /** A session that has not been started by the scheduler yet is checked again after this delay. */
  notStartedRecheckMs: 30_000,
  maxAttempts: 5,
  baseRetryDelayMs: 30_000,
  errorMax: 190,
} as const;

/** Retry delay after the n-th failed attempt (n >= 1): 30 s, 60 s, 120 s, 240 s. */
export const reminderRetryDelayMs = (attempts: number): number => REMINDER_LIMITS.baseRetryDelayMs * 2 ** Math.max(0, attempts - 1);

/** Due at `startAt - 24 h`. When the exam is scheduled less than 24 hours before the start this is already in the past, so the reminder is sent at once (approved decision 3). */
export const examReminderDueAt = (startAt: Date): Date => new Date(startAt.getTime() - EXAM_REMINDER_LEAD_MS);

/** Half of the scheduled duration after the scheduled start. */
export const halfSessionDueAt = (scheduledStart: Date, scheduledEnd: Date): Date =>
  new Date(scheduledStart.getTime() + Math.floor((scheduledEnd.getTime() - scheduledStart.getTime()) / 2));

/** Exactly 15 minutes before the scheduled end (the same instant as `EvaluationService.getSessionEvaluationStatus().warningDueAt`). */
export const evaluationWarningDueAt = (scheduledEnd: Date): Date => new Date(scheduledEnd.getTime() - EVALUATION_WARNING_LEAD_MS);

/** The statuses of Module 24 sessions. Only IN_PROGRESS is "in progress"; SCHEDULED and OPEN have not started yet. */
export type SessionPhase = 'NOT_STARTED' | 'IN_PROGRESS' | 'OVER';
export function sessionPhaseOf(status: string): SessionPhase {
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (status === 'SCHEDULED' || status === 'OPEN') return 'NOT_STARTED';
  return 'OVER'; // COMPLETED, CANCELLED (and anything unknown: never remind)
}

// ---------------------------------------------------------------------------------------------- unpaid subscription reminders (Module 33, approved decisions)

/** The reminders are due at the START of their calendar day in Africa/Cairo (minute 0 of the day). Change this one constant to send later in the day. */
export const SUBSCRIPTION_REMINDER_MINUTE_OF_DAY = 0;
/** First reminder: this many CALENDAR days (not 72 elapsed hours) after the creation date in Africa/Cairo. */
export const UNPAID_REMINDER_CALENDAR_DAYS = 3;
/** End-of-month reminder: the window is the final five calendar days of the month. */
export const MONTH_END_WINDOW_DAYS = 5;

/** The number of calendar days of a `YYYY-MM` month (February by its real length, leap years included). */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** A subscription created on Cairo date D is reminded on D + 3 calendar days (start of that day), whatever the time of day it was created. */
export function firstUnpaidReminderDueAt(createdBusinessDate: string): Date {
  return cairoWallClockToUtc(addDays(createdBusinessDate, UNPAID_REMINDER_CALENDAR_DAYS), SUBSCRIPTION_REMINDER_MINUTE_OF_DAY);
}

/** The first day of the final five calendar days of `month` (30 days -> the 26th, 31 -> the 27th, February by its real length). */
export function monthEndWindowStartDate(month: string): string {
  const day = daysInMonth(month) - (MONTH_END_WINDOW_DAYS - 1);
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** The instant the end-of-month reminder of `month` is due: the start of the first day of the final five calendar days, Africa/Cairo. */
export const monthEndReminderDueAt = (month: string): Date => cairoWallClockToUtc(monthEndWindowStartDate(month), SUBSCRIPTION_REMINDER_MINUTE_OF_DAY);
