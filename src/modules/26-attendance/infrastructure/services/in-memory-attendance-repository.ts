import { pageOffset, type PageRequest, type TransactionContext } from '../../../00-shared-kernel/public';
import type { AttendanceReportQuery, AttendanceReportRow, AttendanceRepository } from '../../application/ports/attendance-repository';
import { AttendanceRecord, type AttendanceCorrection, type AttendanceRecordSnapshot } from '../../domain/entities/attendance-record';
import type { SubjectType } from '../../domain/value-objects/attendance-status';

/** In-memory AttendanceRepository with the same uniqueness and ordering as the SQL one. For tests of this and other modules. */
export class InMemoryAttendanceRepository implements AttendanceRepository {
  readonly rows = new Map<string, AttendanceRecordSnapshot>();
  readonly corrections: AttendanceCorrection[] = [];

  async insertIfAbsent(record: AttendanceRecord, _tx: TransactionContext): Promise<boolean> {
    const s = record.snapshot;
    for (const row of this.rows.values()) if (row.sessionId === s.sessionId && row.subjectType === s.subjectType && row.subjectId === s.subjectId) return false;
    this.rows.set(s.id, { ...s });
    return true;
  }

  async lockSubjects(sessionId: string, subjectType: SubjectType, subjectIds: readonly string[], _tx: TransactionContext): Promise<AttendanceRecord[]> {
    const wanted = new Set(subjectIds);
    return [...this.rows.values()].filter((r) => r.sessionId === sessionId && r.subjectType === subjectType && wanted.has(r.subjectId)).map((r) => AttendanceRecord.rehydrate({ ...r }));
  }

  async applyCorrection(record: AttendanceRecord, correction: AttendanceCorrection, _tx: TransactionContext): Promise<void> {
    const s = record.snapshot;
    const row = this.rows.get(s.id);
    if (!row) throw new Error('attendance record not stored');
    this.rows.set(s.id, { ...row, status: s.status, updatedBy: s.updatedBy, updatedByRole: s.updatedByRole, updatedAt: s.updatedAt });
    this.corrections.push({ ...correction });
  }

  async listBySession(sessionId: string, _tx?: TransactionContext): Promise<AttendanceRecord[]> {
    return [...this.rows.values()].filter((r) => r.sessionId === sessionId).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime()).map((r) => AttendanceRecord.rehydrate({ ...r }));
  }

  async listByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, _tx?: TransactionContext) {
    const all = [...this.rows.values()]
      .filter((r) => r.subjectType === 'STUDENT' && r.subjectId === studentId)
      .sort((a, b) => (direction === 'asc' ? 1 : -1) * (a.scheduledStart.getTime() - b.scheduledStart.getTime()) || a.id.localeCompare(b.id));
    return { items: all.slice(pageOffset(page), pageOffset(page) + page.pageSize).map((r) => AttendanceRecord.rehydrate({ ...r })), total: all.length };
  }

  async summarizeForReport(query: AttendanceReportQuery): Promise<AttendanceReportRow[]> {
    const types = new Set<string>(query.subjectTypes);
    const schools = query.schoolIds && new Set(query.schoolIds);
    const groups = query.groupIds && new Set(query.groupIds);
    const students = query.studentIds && new Set(query.studentIds);
    const totals = new Map<string, AttendanceReportRow>();
    for (const r of this.rows.values()) {
      if (!types.has(r.subjectType)) continue;
      if (schools && !schools.has(r.schoolId)) continue;
      if (groups && !groups.has(r.groupId)) continue;
      if (students && !students.has(r.subjectId)) continue;
      if (query.fromDate !== undefined && r.occurrenceDate < query.fromDate) continue;
      if (query.toDate !== undefined && r.occurrenceDate > query.toDate) continue;
      const key = `${r.schoolId}|${r.groupId}|${r.subjectType}|${r.subjectId}|${r.status}`;
      const found = totals.get(key);
      totals.set(key, {
        schoolId: r.schoolId,
        groupId: r.groupId,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        status: r.status,
        count: (found?.count ?? 0) + 1,
        firstDate: found && found.firstDate < r.occurrenceDate ? found.firstDate : r.occurrenceDate,
      });
    }
    const key = (r: AttendanceReportRow) => `${r.schoolId}|${r.groupId}|${r.subjectType}|${r.subjectId}|${r.status}`;
    return [...totals.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }

  async listCorrectionsOfSession(sessionId: string, _tx?: TransactionContext): Promise<AttendanceCorrection[]> {
    return this.corrections.filter((c) => c.sessionId === sessionId).map((c) => ({ ...c }));
  }

  snapshot() {
    return { rows: [...this.rows], corrections: this.corrections.map((c) => ({ ...c })) };
  }
}
