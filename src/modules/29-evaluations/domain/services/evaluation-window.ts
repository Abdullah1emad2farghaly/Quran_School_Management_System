import { GRACE_MINUTES, PRE_END_WARNING_MINUTES } from '../value-objects/evaluation-rules';

/**
 * The write window of evaluations (approved decision 6), judged ONLY by the session's SCHEDULED end (the instant Module 24 computed from the Africa/Cairo schedule), never by
 * the time a background job happened to run:
 *   IN_SESSION  now <= scheduledEnd                        record, and modify previously recorded scores (the end instant is still inside, like Smart Guard)
 *   GRACE       scheduledEnd < now <= scheduledEnd + 15 min  record MISSING evaluations only; nothing already recorded changes
 *   CLOSED      after that                                  every evaluation write is permanently closed
 * (The lower bound, 15 minutes before the start, is Smart Guard's general window and is not repeated here.)
 */
export type EvaluationPhase = 'IN_SESSION' | 'GRACE' | 'CLOSED';

export const graceEndsAt = (scheduledEnd: Date): Date => new Date(scheduledEnd.getTime() + GRACE_MINUTES * 60_000);
/** The instant the pre-end warning is due (exactly 15 minutes before the scheduled end). */
export const warningDueAt = (scheduledEnd: Date): Date => new Date(scheduledEnd.getTime() - PRE_END_WARNING_MINUTES * 60_000);

export function evaluationPhaseAt(now: Date, scheduledEnd: Date): EvaluationPhase {
  if (now.getTime() <= scheduledEnd.getTime()) return 'IN_SESSION';
  if (now.getTime() <= graceEndsAt(scheduledEnd).getTime()) return 'GRACE';
  return 'CLOSED';
}
