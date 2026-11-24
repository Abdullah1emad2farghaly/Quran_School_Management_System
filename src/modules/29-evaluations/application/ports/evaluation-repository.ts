import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { Evaluation } from '../../domain/entities/evaluation';
import type { EvaluationCategory } from '../../domain/value-objects/evaluation-rules';

/**
 * Persistence of evaluations (Module 29's own tables only). An evaluation is NEVER deleted. There is NO history table: a score change overwrites the score (approved
 * decision 5), and the note is never updated after the insert.
 */
export interface EvaluationRepository {
  /** Inserts the evaluation and its scores unless (session, student) already has one (unique index). Returns whether it was inserted. */
  insertIfAbsent(evaluation: Evaluation, tx: TransactionContext): Promise<boolean>;
  /** FOR UPDATE: the existing evaluations (with their scores) of these students for the session. */
  lockBySessionAndStudents(sessionId: string, studentIds: readonly string[], tx: TransactionContext): Promise<Evaluation[]>;
  /** Writes the CURRENT scores of an evaluation loaded with `lockBySessionAndStudents` (and who/when). It never touches the note or the identity. */
  saveScores(evaluation: Evaluation, tx: TransactionContext): Promise<void>;
  /** FOR UPDATE: the student ids, among these, that have an evaluation for the session. A LOCKING read, on purpose (see Module 26's `StudentEvaluationGuard`). */
  lockEvaluatedStudentIds(sessionId: string, studentIds: readonly string[], tx: TransactionContext): Promise<string[]>;
  listBySession(sessionId: string, tx?: TransactionContext): Promise<Evaluation[]>;
  /** A student's evaluations, by the session's start (newest first by default). */
  listByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, tx?: TransactionContext): Promise<{ items: Evaluation[]; total: number }>;
  /**
   * Read-only aggregate for reports (Module 38): the evaluations matching EVERY given filter, counted per school, group (the group of the evaluation, i.e. the group at the time) and student,
   * with, per category, how many scores exist and their SUM in hundredths (an exact integer: no floating point). The CURRENT scores count (no history exists). Notes are never part of it.
   * An omitted list or instant is not a filter; an empty list matches nothing.
   */
  summarizeForReport(query: EvaluationReportQuery, tx?: TransactionContext): Promise<EvaluationReportRow[]>;
}

export interface EvaluationReportQuery {
  readonly schoolIds?: readonly string[];
  readonly groupIds?: readonly string[];
  readonly studentIds?: readonly string[];
  /** Only evaluations recorded by one of these users (the Teacher's own sessions: only the session's Teacher records an evaluation). */
  readonly recordedByUserIds?: readonly string[];
  /** Inclusive lower bound on the session's scheduled start (UTC instant). */
  readonly from?: Date;
  /** Exclusive upper bound on the session's scheduled start (UTC instant). */
  readonly toExclusive?: Date;
}

export interface EvaluationReportCategoryTotals {
  readonly category: EvaluationCategory;
  /** How many evaluations have a score in this category (an evaluation only has the categories available to the student). */
  readonly count: number;
  /** The sum of those scores in hundredths of a point (score 8.50 = 850), an integer. */
  readonly sumHundredths: number;
}

export interface EvaluationReportRow {
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  /** The number of evaluations (one per student per session). */
  readonly evaluations: number;
  /** The earliest scheduled session start among the counted evaluations (lets the report prove a student's evaluations start on or after the join date, §67). */
  readonly firstStart: Date;
  /** Only the categories that have at least one score, in the fixed category order. */
  readonly categories: readonly EvaluationReportCategoryTotals[];
}
