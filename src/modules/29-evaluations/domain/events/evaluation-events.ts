/**
 * Evaluation events (outbox, same transaction as the change). They are the integration data the Notifications modules (31-34) need to tell the PARENT about an evaluation
 * (approved decision 7); NOTHING is notified inside Module 29. One evaluation is one student's evaluation for one session.
 *  - EvaluationRecorded: the evaluation was created. Carries all the recorded scores and the Teacher note (when one exists).
 *  - EvaluationScoresUpdated: one or more scores were modified during the permitted window. Carries ALL the current scores (so the notification shows the updated grades).
 *    It never carries a note (the note is immutable) and NEVER carries previous values: no history is kept (approved decision 5).
 * Both carry the identifiers a notification needs to find the student's Parent (the student id and school); the Parent is resolved by the Notifications modules.
 */
export const EvaluationEventTypes = {
  RECORDED: 'EvaluationRecorded',
  SCORES_UPDATED: 'EvaluationScoresUpdated',
} as const;
export type EvaluationEventType = (typeof EvaluationEventTypes)[keyof typeof EvaluationEventTypes];

export const EVALUATION_AGGREGATE_TYPE = 'Evaluation';

export interface EvaluationEventPayload {
  readonly evaluationId: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  readonly occurrenceDate: string;
  readonly scores: ReadonlyArray<{ readonly category: string; readonly score: number }>;
  /** EvaluationRecorded only: the Teacher note, or null when there is none. Absent from EvaluationScoresUpdated. */
  readonly note?: string | null;
  /** The Teacher (user id) who made the change. */
  readonly actorUserId: string;
}
