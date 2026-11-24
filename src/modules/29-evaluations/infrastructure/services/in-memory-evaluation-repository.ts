import { pageOffset, type PageRequest, type TransactionContext } from '../../../00-shared-kernel/public';
import type { EvaluationReportCategoryTotals, EvaluationReportQuery, EvaluationReportRow, EvaluationRepository } from '../../application/ports/evaluation-repository';
import { Evaluation, type EvaluationSnapshot } from '../../domain/entities/evaluation';
import { EVALUATION_CATEGORIES } from '../../domain/value-objects/evaluation-rules';

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

  async summarizeForReport(query: EvaluationReportQuery, _tx?: TransactionContext): Promise<EvaluationReportRow[]> {
    const schools = query.schoolIds && new Set(query.schoolIds);
    const groups = query.groupIds && new Set(query.groupIds);
    const students = query.studentIds && new Set(query.studentIds);
    const recorders = query.recordedByUserIds && new Set(query.recordedByUserIds);
    const rows = new Map<string, { schoolId: string; groupId: string; studentId: string; evaluations: number; firstStart: Date; totals: Map<string, { count: number; sum: number }> }>();
    for (const r of this.rows.values()) {
      if (schools && !schools.has(r.schoolId)) continue;
      if (groups && !groups.has(r.groupId)) continue;
      if (students && !students.has(r.studentId)) continue;
      if (recorders && !recorders.has(r.recordedBy)) continue;
      if (query.from !== undefined && r.scheduledStart.getTime() < query.from.getTime()) continue;
      if (query.toExclusive !== undefined && r.scheduledStart.getTime() >= query.toExclusive.getTime()) continue;
      const key = `${r.schoolId}|${r.groupId}|${r.studentId}`;
      let row = rows.get(key);
      if (!row) {
        row = { schoolId: r.schoolId, groupId: r.groupId, studentId: r.studentId, evaluations: 0, firstStart: r.scheduledStart, totals: new Map() };
        rows.set(key, row);
      }
      row.evaluations += 1;
      if (r.scheduledStart.getTime() < row.firstStart.getTime()) row.firstStart = r.scheduledStart;
      for (const s of r.scores) {
        const t = row.totals.get(s.category) ?? { count: 0, sum: 0 };
        t.count += 1;
        t.sum += Math.round(s.score * 100);
        row.totals.set(s.category, t);
      }
    }
    return [...rows.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, r]) => ({
        schoolId: r.schoolId, groupId: r.groupId, studentId: r.studentId, evaluations: r.evaluations, firstStart: r.firstStart,
        categories: EVALUATION_CATEGORIES.filter((c) => r.totals.has(c)).map((c): EvaluationReportCategoryTotals => ({ category: c, count: r.totals.get(c)!.count, sumHundredths: r.totals.get(c)!.sum })),
      }));
  }

  async listByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, _tx?: TransactionContext) {
    const all = [...this.rows.values()]
      .filter((r) => r.studentId === studentId)
      .sort((a, b) => (direction === 'asc' ? 1 : -1) * (a.scheduledStart.getTime() - b.scheduledStart.getTime()) || a.id.localeCompare(b.id));
    return { items: all.slice(pageOffset(page), pageOffset(page) + page.pageSize).map((r) => Evaluation.rehydrate(copy(r))), total: all.length };
  }
}
