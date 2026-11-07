import { roundScore } from '../../../29-evaluations/public';

/**
 * Exam statuses (Master Specification §54 as amended by the approved Module 30 decisions):
 *   DRAFT -> SCHEDULED -> STARTED -> COMPLETED -> ENDED, or CANCELLED (only from DRAFT or SCHEDULED).
 * STARTED is automatic at the start time, COMPLETED is automatic at the end time (or manual when the exam has no end time), ENDED is manual and final.
 */
export const EXAM_STATUSES = ['DRAFT', 'SCHEDULED', 'STARTED', 'COMPLETED', 'ENDED', 'CANCELLED'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];
export const isExamStatus = (value: unknown): value is ExamStatus => typeof value === 'string' && (EXAM_STATUSES as readonly string[]).includes(value);

/** Approved: result entry is a Smart Guard action whose window starts 15 minutes before the scheduled start (and runs through the effective end). */
export const EXAM_SMART_GUARD_LEAD_MINUTES = 15;
/** Approved (Master Specification §57): the reminder is due 24 hours before the exam. */
export const EXAM_REMINDER_HOURS = 24;

/** Technical limits (not business rules). */
export const MAX_QUESTION_COUNT = 200;
export const MAX_SCORE_PER_QUESTION = 1000;
export const MAX_TARGET_GROUPS = 200;

export const EXAM_TARGET_TYPE = 'EXAM';

/** Scores are kept in hundredths so that two decimal places never suffer from floating point noise. */
export const toHundredths = (value: number): number => Math.round(value * 100);
export const fromHundredths = (value: number): number => value / 100;

/** The uniform maximum score of every question: a finite number above 0 and at most 1000, ROUNDED to two decimals (consistently with Module 29); a value that rounds to 0 is refused. */
export function parseMaxScore(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_SCORE_PER_QUESTION) return undefined;
  const rounded = roundScore(value);
  return rounded > 0 ? rounded : undefined;
}

export const isValidQuestionCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_QUESTION_COUNT;

/** The sum of the (already rounded) question scores, exact to two decimals. */
export const totalOf = (scores: readonly number[]): number => fromHundredths(scores.reduce((sum, s) => sum + toHundredths(s), 0));
