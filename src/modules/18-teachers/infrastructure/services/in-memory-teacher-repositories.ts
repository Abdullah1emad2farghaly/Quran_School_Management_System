import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { TeacherListQuery, TeacherRepository } from '../../application/ports/teacher-repository';
import type { TeacherSchoolLinkRepository } from '../../application/ports/teacher-school-link-repository';
import { Teacher, type TeacherSnapshot } from '../../domain/entities/teacher';
import { TeacherSchoolLink, type TeacherSchoolLinkSnapshot } from '../../domain/entities/teacher-school-link';
import { teacherError } from '../../domain/errors/teacher-errors';

/** In-memory TeacherRepository with the same uniqueness and ordering behavior as the SQL one. For tests of this and other modules. */
export class InMemoryTeacherRepository implements TeacherRepository {
  readonly rows = new Map<string, TeacherSnapshot>();
  /** Set by the composition (tests) so `listBySchool` can see the links; the SQL version joins `teacher_schools`. */
  activeTeacherIdsOfSchool: (schoolId: string) => string[] = () => [];

  async insert(teacher: Teacher, _tx: TransactionContext): Promise<void> {
    for (const row of this.rows.values()) if (row.userId === teacher.userId) throw teacherError('TEACHER_CONCURRENT_MODIFICATION');
    this.rows.set(teacher.id, { ...teacher.snapshot, version: 1 });
  }
  async findById(id: string, _tx?: TransactionContext): Promise<Teacher | undefined> {
    const row = this.rows.get(id);
    return row ? Teacher.rehydrate(row) : undefined;
  }
  async findByUserId(userId: string, _tx?: TransactionContext): Promise<Teacher | undefined> {
    for (const row of this.rows.values()) if (row.userId === userId) return Teacher.rehydrate(row);
    return undefined;
  }
  lockByUserId(userId: string, tx: TransactionContext): Promise<Teacher | undefined> {
    return this.findByUserId(userId, tx);
  }
  lockById(id: string, tx: TransactionContext): Promise<Teacher | undefined> {
    return this.findById(id, tx);
  }
  async listBySchool(query: TeacherListQuery, _tx?: TransactionContext): Promise<{ items: Teacher[]; total: number }> {
    const ids = new Set(this.activeTeacherIdsOfSchool(query.schoolId));
    const key = (r: TeacherSnapshot) => r.createdAt.getTime();
    const sign = query.direction === 'asc' ? 1 : -1;
    const all = [...this.rows.values()]
      .filter((r) => ids.has(r.id))
      .sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        return ka < kb ? -sign : ka > kb ? sign : a.id < b.id ? -1 : 1;
      });
    const start = (query.page.page - 1) * query.page.pageSize;
    return { items: all.slice(start, start + query.page.pageSize).map((r) => Teacher.rehydrate(r)), total: all.length };
  }

  snapshot(): Array<[string, TeacherSnapshot]> {
    return [...this.rows];
  }
  restore(saved: Array<[string, TeacherSnapshot]>): void {
    this.rows.clear();
    saved.forEach(([k, v]) => this.rows.set(k, v));
  }
}

export class InMemoryTeacherSchoolLinkRepository implements TeacherSchoolLinkRepository {
  readonly rows = new Map<string, TeacherSchoolLinkSnapshot>();

  async insert(link: TeacherSchoolLink, _tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    for (const r of this.rows.values()) if (r.teacherId === s.teacherId && r.schoolId === s.schoolId && r.unlinkedAt === null) throw teacherError('TEACHER_ALREADY_LINKED_TO_SCHOOL');
    this.rows.set(s.id, { ...s, version: 1 });
  }
  async update(link: TeacherSchoolLink, _tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    const row = this.rows.get(s.id);
    if (!row || row.version !== s.version) throw teacherError('TEACHER_CONCURRENT_MODIFICATION');
    this.rows.set(s.id, { ...s, version: s.version + 1 });
  }
  async findActive(teacherId: string, schoolId: string, _tx?: TransactionContext): Promise<TeacherSchoolLink | undefined> {
    for (const r of this.rows.values()) if (r.teacherId === teacherId && r.schoolId === schoolId && r.unlinkedAt === null) return TeacherSchoolLink.rehydrate(r);
    return undefined;
  }
  lockActive(teacherId: string, schoolId: string, tx: TransactionContext): Promise<TeacherSchoolLink | undefined> {
    return this.findActive(teacherId, schoolId, tx);
  }
  async listActiveByTeacher(teacherId: string, _tx?: TransactionContext): Promise<TeacherSchoolLink[]> {
    return [...this.rows.values()].filter((r) => r.teacherId === teacherId && r.unlinkedAt === null).sort(byLinked).map((r) => TeacherSchoolLink.rehydrate(r));
  }
  async listActiveByTeachers(teacherIds: readonly string[], _tx?: TransactionContext): Promise<Map<string, TeacherSchoolLink[]>> {
    const result = new Map<string, TeacherSchoolLink[]>();
    for (const r of [...this.rows.values()].filter((x) => x.unlinkedAt === null && teacherIds.includes(x.teacherId)).sort(byLinked)) {
      const list = result.get(r.teacherId) ?? [];
      list.push(TeacherSchoolLink.rehydrate(r));
      result.set(r.teacherId, list);
    }
    return result;
  }
  async listHistoryByTeacher(teacherId: string, _tx?: TransactionContext): Promise<TeacherSchoolLink[]> {
    return [...this.rows.values()].filter((r) => r.teacherId === teacherId).sort(byLinked).map((r) => TeacherSchoolLink.rehydrate(r));
  }
  activeTeacherIdsOfSchool(schoolId: string): string[] {
    return [...this.rows.values()].filter((r) => r.schoolId === schoolId && r.unlinkedAt === null).map((r) => r.teacherId);
  }

  snapshot(): Array<[string, TeacherSchoolLinkSnapshot]> {
    return [...this.rows];
  }
  restore(saved: Array<[string, TeacherSchoolLinkSnapshot]>): void {
    this.rows.clear();
    saved.forEach(([k, v]) => this.rows.set(k, v));
  }
}

const byLinked = (a: TeacherSchoolLinkSnapshot, b: TeacherSchoolLinkSnapshot): number => a.linkedAt.getTime() - b.linkedAt.getTime() || (a.id < b.id ? -1 : 1);
