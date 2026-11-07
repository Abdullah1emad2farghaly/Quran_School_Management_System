import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import { pageOffset, type PageRequest, type TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { EvaluationRepository } from '../../../../application/ports/evaluation-repository';
import { Evaluation, type EvaluationScore } from '../../../../domain/entities/evaluation';
import type { EvaluationCategory } from '../../../../domain/value-objects/evaluation-rules';

type Queryable = Pick<Sequelize, 'query'>;
type D = Date | string;

interface EvaluationRow {
  id: string; sessionId: string; schoolId: string; groupId: string; studentId: string; occurrenceDate: string; scheduledStart: D; note: string | null;
  recordedBy: string; recordedAt: D; updatedBy: string; updatedAt: D;
}
interface ScoreRow { evaluationId: string; category: EvaluationCategory; score: number | string; memorizationAssignmentId: string | null; revisionAssignmentId: string | null }

const EVALUATION_SELECT = `
  SELECT id, session_id AS sessionId, school_id AS schoolId, group_id AS groupId, student_id AS studentId, DATE_FORMAT(occurrence_date, '%Y-%m-%d') AS occurrenceDate,
         scheduled_start AS scheduledStart, note, recorded_by AS recordedBy, recorded_at AS recordedAt, updated_by AS updatedBy, updated_at AS updatedAt
    FROM evaluations`;
const SCORE_SELECT = `
  SELECT evaluation_id AS evaluationId, category, score, memorization_assignment_id AS memorizationAssignmentId, revision_assignment_id AS revisionAssignmentId
    FROM evaluation_scores`;

const asDate = (v: D): Date => (v instanceof Date ? v : new Date(v));
/** The DB returns DECIMAL as text ('8.50'): converted to a number with two decimals. */
const toScore = (r: ScoreRow): EvaluationScore => ({ category: r.category, score: Number(r.score), memorizationAssignmentId: r.memorizationAssignmentId, revisionAssignmentId: r.revisionAssignmentId });
const ORDER: Record<EvaluationCategory, number> = { MEMORIZATION: 1, REVISION: 2, PERFORMANCE: 3, TAJWEED: 4 };

/**
 * MariaDB EvaluationRepository (tables `evaluations` and `evaluation_scores`, Module 29 only). There is NO delete and NO history: `saveScores` overwrites the scores and the
 * `updated_*` columns, and nothing in this class ever updates `note` (the note is written once, by the insert). The unique (session, student) index is what makes a second
 * creation for the same student a conflict. Locking reads (`FOR UPDATE`) always read the latest committed state. Timestamps are UTC.
 */
export class SequelizeEvaluationRepository implements EvaluationRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  private async hydrate(rows: EvaluationRow[], scoreSuffix: string, tx?: TransactionContext): Promise<Evaluation[]> {
    if (rows.length === 0) return [];
    const scores = await this.db.query<ScoreRow>(`${SCORE_SELECT} WHERE evaluation_id IN (:ids)${scoreSuffix}`, { replacements: { ids: rows.map((r) => r.id) }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) =>
      Evaluation.rehydrate({
        id: r.id, sessionId: r.sessionId, schoolId: r.schoolId, groupId: r.groupId, studentId: r.studentId, occurrenceDate: r.occurrenceDate, scheduledStart: asDate(r.scheduledStart), note: r.note,
        scores: scores.filter((s) => s.evaluationId === r.id).map(toScore).sort((a, b) => ORDER[a.category] - ORDER[b.category]),
        recordedBy: r.recordedBy, recordedAt: asDate(r.recordedAt), updatedBy: r.updatedBy, updatedAt: asDate(r.updatedAt),
      }),
    );
  }

  async insertIfAbsent(evaluation: Evaluation, tx: TransactionContext): Promise<boolean> {
    const s = evaluation.snapshot;
    try {
      await this.db.query(
        `INSERT INTO evaluations (id, session_id, school_id, group_id, student_id, occurrence_date, scheduled_start, note, recorded_by, recorded_at, updated_by, updated_at)
         VALUES (:id, :sessionId, :schoolId, :groupId, :studentId, :occurrenceDate, :scheduledStart, :note, :recordedBy, :recordedAt, :updatedBy, :updatedAt)`,
        { replacements: { id: s.id, sessionId: s.sessionId, schoolId: s.schoolId, groupId: s.groupId, studentId: s.studentId, occurrenceDate: s.occurrenceDate, scheduledStart: s.scheduledStart, note: s.note, recordedBy: s.recordedBy, recordedAt: s.recordedAt, updatedBy: s.updatedBy, updatedAt: s.updatedAt }, transaction: this.t(tx) },
      );
    } catch (error) {
      if (error instanceof UniqueConstraintError) return false;
      throw error;
    }
    for (const score of s.scores) {
      await this.db.query(
        'INSERT INTO evaluation_scores (evaluation_id, category, score, memorization_assignment_id, revision_assignment_id) VALUES (:evaluationId, :category, :score, :memorizationAssignmentId, :revisionAssignmentId)',
        { replacements: { evaluationId: s.id, category: score.category, score: score.score, memorizationAssignmentId: score.memorizationAssignmentId, revisionAssignmentId: score.revisionAssignmentId }, transaction: this.t(tx) },
      );
    }
    return true;
  }

  async lockBySessionAndStudents(sessionId: string, studentIds: readonly string[], tx: TransactionContext): Promise<Evaluation[]> {
    if (studentIds.length === 0) return [];
    const rows = await this.db.query<EvaluationRow>(`${EVALUATION_SELECT} WHERE session_id = :sessionId AND student_id IN (:studentIds) ORDER BY id ASC FOR UPDATE`, {
      replacements: { sessionId, studentIds: [...studentIds] }, type: QueryTypes.SELECT, transaction: this.t(tx),
    });
    return this.hydrate(rows, ' ORDER BY category ASC FOR UPDATE', tx);
  }

  async saveScores(evaluation: Evaluation, tx: TransactionContext): Promise<void> {
    const s = evaluation.snapshot;
    for (const score of s.scores) {
      await this.db.query('UPDATE evaluation_scores SET score = :score WHERE evaluation_id = :evaluationId AND category = :category', {
        replacements: { score: score.score, evaluationId: s.id, category: score.category }, type: QueryTypes.UPDATE, transaction: this.t(tx),
      });
    }
    const [, affected] = await this.db.query('UPDATE evaluations SET updated_by = :updatedBy, updated_at = :updatedAt WHERE id = :id', {
      replacements: { id: s.id, updatedBy: s.updatedBy, updatedAt: s.updatedAt }, type: QueryTypes.UPDATE, transaction: this.t(tx),
    });
    if (Number(affected) < 1) throw new Error('evaluation not stored');
  }

  async lockEvaluatedStudentIds(sessionId: string, studentIds: readonly string[], tx: TransactionContext): Promise<string[]> {
    if (studentIds.length === 0) return [];
    const rows = await this.db.query<{ studentId: string }>('SELECT student_id AS studentId FROM evaluations WHERE session_id = :sessionId AND student_id IN (:studentIds) ORDER BY id ASC FOR UPDATE', {
      replacements: { sessionId, studentIds: [...studentIds] }, type: QueryTypes.SELECT, transaction: this.t(tx),
    });
    return rows.map((r) => r.studentId);
  }

  async listBySession(sessionId: string, tx?: TransactionContext): Promise<Evaluation[]> {
    const rows = await this.db.query<EvaluationRow>(`${EVALUATION_SELECT} WHERE session_id = :sessionId ORDER BY recorded_at ASC, id ASC`, { replacements: { sessionId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return this.hydrate(rows, '', tx);
  }

  async listByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, tx?: TransactionContext): Promise<{ items: Evaluation[]; total: number }> {
    const order = direction === 'asc' ? 'ASC' : 'DESC';
    const replacements = { studentId, limit: page.pageSize, offset: pageOffset(page) };
    const rows = await this.db.query<EvaluationRow>(`${EVALUATION_SELECT} WHERE student_id = :studentId ORDER BY scheduled_start ${order}, id ASC LIMIT :limit OFFSET :offset`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const counted = await this.db.query<{ total: number | string }>('SELECT COUNT(*) AS total FROM evaluations WHERE student_id = :studentId', { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return { items: await this.hydrate(rows, '', tx), total: Number(counted[0]?.total ?? 0) };
  }
}
