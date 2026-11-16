import type { EvaluationBatchResultDto, EvaluationDto, SessionEvaluationsDto } from '../../application/dto/evaluation-dto';

const iso = (d: Date): string => d.toISOString();

/**
 * The public JSON of an evaluation: current scores, the note and when it was recorded (instants are UTC ISO-8601; `occurrenceDate` is the Cairo business date of the session).
 * Deliberately NO previous values, NO modification time and NO actor: a Parent never sees how an evaluation changed (approved).
 */
export const serializeEvaluation = (e: EvaluationDto) => ({
  id: e.id,
  sessionId: e.sessionId,
  schoolId: e.schoolId,
  groupId: e.groupId,
  studentId: e.studentId,
  occurrenceDate: e.occurrenceDate,
  scheduledStart: iso(e.scheduledStart),
  scores: e.scores.map((s) => ({ category: s.category, score: s.score, memorizationAssignmentId: s.memorizationAssignmentId, revisionAssignmentId: s.revisionAssignmentId })),
  note: e.note,
  recordedAt: iso(e.recordedAt),
});

export const serializeBatch = (b: EvaluationBatchResultDto) => ({
  sessionId: b.sessionId,
  results: b.results.map((r) => ({ studentId: r.studentId, outcome: r.outcome, evaluation: serializeEvaluation(r.evaluation) })),
});

export const serializeSessionEvaluations = (s: SessionEvaluationsDto) => ({ sessionId: s.sessionId, evaluations: s.evaluations.map(serializeEvaluation) });
