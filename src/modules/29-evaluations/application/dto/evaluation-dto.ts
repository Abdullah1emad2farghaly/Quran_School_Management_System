import type { Evaluation } from '../../domain/entities/evaluation';
import type { EvaluationCategory } from '../../domain/value-objects/evaluation-rules';

export interface EvaluationScoreDto {
  readonly category: EvaluationCategory;
  readonly score: number;
  readonly memorizationAssignmentId: string | null;
  readonly revisionAssignmentId: string | null;
}

/**
 * What readers (Teacher, School Manager, Parent) see: the current scores, the note and when it was recorded. Deliberately NO previous values, NO modification details
 * and no actor (approved decisions 2 and 5): a Parent never sees how an evaluation changed.
 */
export interface EvaluationDto {
  readonly id: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  readonly occurrenceDate: string;
  readonly scheduledStart: Date;
  readonly scores: readonly EvaluationScoreDto[];
  readonly note: string | null;
  readonly recordedAt: Date;
}

export const toEvaluationDto = (evaluation: Evaluation): EvaluationDto => {
  const s = evaluation.snapshot;
  return {
    id: s.id, sessionId: s.sessionId, schoolId: s.schoolId, groupId: s.groupId, studentId: s.studentId, occurrenceDate: s.occurrenceDate, scheduledStart: s.scheduledStart,
    scores: s.scores.map((x) => ({ category: x.category, score: x.score, memorizationAssignmentId: x.memorizationAssignmentId, revisionAssignmentId: x.revisionAssignmentId })),
    note: s.note, recordedAt: s.recordedAt,
  };
};

export type EvaluationOutcome = 'RECORDED' | 'UPDATED' | 'UNCHANGED';

export interface EvaluationChangeResultDto {
  readonly studentId: string;
  readonly outcome: EvaluationOutcome;
  readonly evaluation: EvaluationDto;
}

/** One result per submitted student, in the order submitted. */
export interface EvaluationBatchResultDto {
  readonly sessionId: string;
  readonly results: readonly EvaluationChangeResultDto[];
}

export interface SessionEvaluationsDto {
  readonly sessionId: string;
  readonly evaluations: readonly EvaluationDto[];
}

export type AttendanceView = 'PRESENT' | 'ABSENT' | 'UNMARKED';

export interface StudentEvaluationStatusDto {
  readonly studentId: string;
  /** UNMARKED is never read as ABSENT. */
  readonly attendance: AttendanceView;
  /** Empty when the student has no applicable assignment (nothing to evaluate). */
  readonly availableCategories: readonly EvaluationCategory[];
  readonly evaluated: boolean;
  /** true only for a student who is PRESENT, has an assignment, and has no evaluation yet. ABSENT, UNMARKED and students without an assignment are never required. */
  readonly evaluationRequired: boolean;
}

/**
 * The integration data for the pre-end warning (approved decision 6), for the Notifications modules (31-34): who is still missing a REQUIRED evaluation. Creates and changes
 * nothing; a missing evaluation never justifies creating one.
 */
export interface SessionEvaluationStatusDto {
  readonly sessionId: string;
  readonly groupId: string;
  readonly teacherId: string;
  readonly status: string;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  /** Exactly 15 minutes before the scheduled end: when the warning is due. */
  readonly warningDueAt: Date;
  /** 15 minutes after the scheduled end: the last instant the Teacher can still record missing evaluations. */
  readonly graceEndsAt: Date;
  readonly students: readonly StudentEvaluationStatusDto[];
  /** The students that are PRESENT, have an assignment and still have no evaluation: the warning is due only when this is not empty (and the session is not cancelled). */
  readonly incompleteStudentIds: readonly string[];
}
