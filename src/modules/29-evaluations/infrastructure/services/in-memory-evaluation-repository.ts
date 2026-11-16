import { pageOffset, type PageRequest, type TransactionContext } from '../../../00-shared-kernel/public';
import type { EvaluationRepository } from '../../application/ports/evaluation-repository';
import { Evaluation, type EvaluationSnapshot } from '../../domain/entities/evaluation';

const copy = (s: EvaluationSnapshot): EvaluationSnapshot => ({ ...s, scores: s.scores.map((x) => ({ ...x })) });

/** In-memory EvaluationRepository with the same uniqueness and ordering as the SQL one. For tests of this and other modules. */
export class InMemoryEvaluationRepository implements EvaluationRepository {
  readonly rows = new Map<string, EvaluationSnapshot>();

  async insertIfAbsent(evaluation: Evaluation, _tx: TransactionContext): Promise<boolean> {
    const s = evaluation.snapshot;
    for (const row of this.rows.values()) if (row.sessionId === s.sessionId && row.studentId === s.studentId) return false;
    this.rows.set(s.id, copy(s));
    return true;
  }

  async lockBySessionAndStudents(sessionId: string, studentIds: readonly string[], _tx: TransactionContext): Promise<Evaluation[]> {
    const wanted = new Set(studentIds);
    return [...this.rows.values()].filter((r) => r.sessionId === sessionId && wanted.has(r.studentId)).map((r) => Evaluation.rehydrate(copy(r)));
  }

  async saveScores(evaluation: Evaluation, _tx: TransactionContext): Promise<void> {
    const s = evaluation.snapshot;
    const row = this.rows.get(s.id);
    if (!row) throw new Error('evaluation not stored');
    // The note and the identity never change; only the scores and who/when.
    this.rows.set(s.id, { ...row, scores: s.scores.map((x) => ({ ...x })), updatedBy: s.updatedBy, updatedAt: s.updatedAt });
  }

  async lockEvaluatedStudentIds(sessionId: string, studentIds: readonly string[], _tx: TransactionContext): Promise<string[]> {
    const wanted = new Set(studentIds);
    return [...this.rows.values()].filter((r) => r.sessionId === sessionId && wanted.has(r.studentId)).map((r) => r.studentId);
  }

  async listBySession(sessionId: string, _tx?: TransactionContext): Promise<Evaluation[]> {
    return [...this.rows.values()].filter((r) => r.sessionId === sessionId).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id)).map((r) => Evaluation.rehydrate(copy(r)));
  }

  async listByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, _tx?: TransactionContext) {
    const all = [...this.rows.values()]
      .filter((r) => r.studentId === studentId)
      .sort((a, b) => (direction === 'asc' ? 1 : -1) * (a.scheduledStart.getTime() - b.scheduledStart.getTime()) || a.id.localeCompare(b.id));
    return { items: all.slice(pageOffset(page), pageOffset(page) + page.pageSize).map((r) => Evaluation.rehydrate(copy(r))), total: all.length };
  }
}
