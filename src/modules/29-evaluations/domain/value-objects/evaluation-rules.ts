/**
 * Evaluation categories and rules (Master Specification §52 and the approved Module 29 decisions).
 * The four categories are fixed. Which of them a student can be evaluated on depends on the student's assignments for the session (see `availableCategories`).
 */
export const EVALUATION_CATEGORIES = ['MEMORIZATION', 'REVISION', 'PERFORMANCE', 'TAJWEED'] as const;
export type EvaluationCategory = (typeof EVALUATION_CATEGORIES)[number];

export const isEvaluationCategory = (value: unknown): value is EvaluationCategory => typeof value === 'string' && (EVALUATION_CATEGORIES as readonly string[]).includes(value);

/** Approved: one optional Teacher note per student's evaluation, at most 200 characters, never editable or deletable once saved. */
export const MAX_NOTE_LENGTH = 200;
/** Approved: each score is from 0.00 to 10.00, rounded (not rejected) to two decimal places. */
export const MIN_SCORE = 0;
export const MAX_SCORE = 10;
/** Approved: the Teacher may record MISSING evaluations (only) for 15 minutes after the scheduled session end. */
export const GRACE_MINUTES = 15;
/** Approved: the Teacher is warned exactly 15 minutes before the scheduled end when required evaluations are still missing (delivered by the Notifications modules). */
export const PRE_END_WARNING_MINUTES = 15;
/** A technical limit (not a business rule): students per request. */
export const MAX_BATCH_STUDENTS = 200;

export interface AssignmentContext {
  /** The Module 27 assignment that applies to the student for the session, or null. */
  readonly memorizationAssignmentId: string | null;
  /** The Module 28 assignment that applies to the student for the session, or null. */
  readonly revisionAssignmentId: string | null;
}

/**
 * The categories a student can be evaluated on, from the assignments that apply to the student for the session (approved decision 3). The EXISTENCE of an assignment is
 * enough (no execution record is needed). Performance and Tajweed appear once, even when both assignments exist. Neither assignment: no category at all.
 *   Memorization only  -> MEMORIZATION, PERFORMANCE, TAJWEED
 *   Revision only      -> REVISION, PERFORMANCE, TAJWEED
 *   Both               -> MEMORIZATION, REVISION, PERFORMANCE, TAJWEED
 *   Neither            -> none
 */
export function availableCategories(context: AssignmentContext): EvaluationCategory[] {
  if (context.memorizationAssignmentId === null && context.revisionAssignmentId === null) return [];
  return EVALUATION_CATEGORIES.filter((category) => {
    if (category === 'MEMORIZATION') return context.memorizationAssignmentId !== null;
    if (category === 'REVISION') return context.revisionAssignmentId !== null;
    return true;
  });
}

/** The assignment association of one category's score: the Memorization score to the memorization assignment, the Revision score to the revision assignment, Performance and Tajweed to the applicable assignment context (both ids that exist). */
export function assignmentRefsOf(category: EvaluationCategory, context: AssignmentContext): AssignmentContext {
  if (category === 'MEMORIZATION') return { memorizationAssignmentId: context.memorizationAssignmentId, revisionAssignmentId: null };
  if (category === 'REVISION') return { memorizationAssignmentId: null, revisionAssignmentId: context.revisionAssignmentId };
  return { ...context };
}

/**
 * Rounds a score to two decimal places, half away from zero, on its SHORTEST DECIMAL TEXT (so 1.005 is 1.01, as the Teacher typed it, and not 1.00 as binary floating point
 * would give). Only called with a value already validated to be within 0..10.
 */
export function roundScore(value: number): number {
  const text = value.toString();
  if (text.includes('e')) return Math.round(value * 100) / 100; // only values below 0.000001 reach here: they round to 0
  return Number(`${Math.round(Number(`${text}e2`))}e-2`);
}

/** Is this a score the API accepts? A finite JSON number within 0..10 BEFORE rounding (so 10.004 is refused, 9.999 is accepted and stored as 10.00). */
export const isAcceptableScore = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= MIN_SCORE && value <= MAX_SCORE;

/** Scores compare by hundredths so that two decimal places never suffer from floating point noise. */
export const sameScore = (a: number, b: number): boolean => Math.round(a * 100) === Math.round(b * 100);
