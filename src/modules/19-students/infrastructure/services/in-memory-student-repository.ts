import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { StudentListQuery, StudentRepository } from '../../application/ports/student-repository';
import { Student, type StudentSnapshot } from '../../domain/entities/student';
import type { StudentHistoryEntry } from '../../domain/entities/student-history-entry';
import { studentError } from '../../domain/errors/student-errors';

/** In-memory StudentRepository with the same uniqueness, ordering and optimistic-lock behavior as the SQL one. For tests of this and other modules. */
export class InMemoryStudentRepository implements StudentRepository {
  readonly rows = new Map<string, StudentSnapshot>();
  readonly history: StudentHistoryEntry[] = [];

  async insert(student: Student, _tx: TransactionContext): Promise<void> {
    for (const row of this.rows.values()) if (row.nationalId === student.snapshot.nationalId) throw studentError('STUDENT_NATIONAL_ID_CONFLICT');
    this.rows.set(student.id, { ...student.snapshot, version: 1 });
  }
  async update(student: Student, _tx: TransactionContext): Promise<void> {
    const row = this.rows.get(student.id);
    if (!row || row.version !== student.version) throw studentError('STUDENT_CONCURRENT_MODIFICATION');
    const s = student.snapshot;
    // Same columns as the SQL update: the parent, the school and the National ID never change.
    this.rows.set(student.id, { ...row, fullName: s.fullName, joinDate: s.joinDate, status: s.status, updatedAt: s.updatedAt, version: row.version + 1 });
  }
  async insertHistory(entries: readonly StudentHistoryEntry[], _tx: TransactionContext): Promise<void> {
    this.history.push(...entries.map((e) => ({ ...e })));
  }
  async findById(id: string, _tx?: TransactionContext): Promise<Student | undefined> {
    const row = this.rows.get(id);
    return row ? Student.rehydrate(row) : undefined;
  }
  lockById(id: string, tx: TransactionContext): Promise<Student | undefined> {
    return this.findById(id, tx);
  }
  async findByNationalId(nationalId: string, _tx?: TransactionContext): Promise<Student | undefined> {
    for (const row of this.rows.values()) if (row.nationalId === nationalId) return Student.rehydrate(row);
    return undefined;
  }

  async listBySchool(schoolId: string, query: StudentListQuery, _tx?: TransactionContext): Promise<{ items: Student[]; total: number }> {
    return this.list((r) => r.schoolId === schoolId, query);
  }
  async listByParent(parentId: string, query: StudentListQuery, _tx?: TransactionContext): Promise<{ items: Student[]; total: number }> {
    return this.list((r) => r.parentId === parentId, query);
  }
  async countByParentInSchool(parentId: string, schoolId: string, _tx: TransactionContext): Promise<number> {
    return [...this.rows.values()].filter((r) => r.parentId === parentId && r.schoolId === schoolId).length;
  }
  async listHistory(studentId: string, _tx?: TransactionContext): Promise<StudentHistoryEntry[]> {
    return this.history.filter((h) => h.studentId === studentId).map((h) => ({ ...h }));
  }

  private list(match: (row: StudentSnapshot) => boolean, query: StudentListQuery): { items: Student[]; total: number } {
    const sign = query.direction === 'asc' ? 1 : -1;
    const key = (r: StudentSnapshot): string | number => (query.sort === 'createdAt' ? r.createdAt.getTime() : query.sort === 'joinDate' ? r.joinDate : r.fullName);
    const all = [...this.rows.values()]
      .filter((r) => match(r) && (!query.status || query.status.length === 0 || query.status.includes(r.status)))
      .sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        return ka < kb ? -sign : ka > kb ? sign : a.id < b.id ? -1 : 1;
      });
    const start = (query.page.page - 1) * query.page.pageSize;
    return { items: all.slice(start, start + query.page.pageSize).map((r) => Student.rehydrate(r)), total: all.length };
  }

  snapshot(): { rows: Array<[string, StudentSnapshot]>; history: StudentHistoryEntry[] } {
    return { rows: [...this.rows], history: [...this.history] };
  }
  restore(saved: { rows: Array<[string, StudentSnapshot]>; history: StudentHistoryEntry[] }): void {
    this.rows.clear();
    saved.rows.forEach(([k, v]) => this.rows.set(k, v));
    this.history.splice(0, this.history.length, ...saved.history);
  }
}
