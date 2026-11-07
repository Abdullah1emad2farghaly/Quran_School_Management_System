import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { Evaluation } from '../../domain/entities/evaluation';

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
}
