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
