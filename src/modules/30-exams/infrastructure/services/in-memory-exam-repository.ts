import { pageOffset, type PageRequest, type TransactionContext } from '../../../00-shared-kernel/public';
import type { ExamRepository, ExamStudentRow, LockMode, StudentExamOutcomeRow } from '../../application/ports/exam-repository';
import { Exam, type ExamSnapshot } from '../../domain/entities/exam';
import type { ExamResult, ExamResultSnapshot } from '../../domain/entities/exam-result';
import type { ExamStatus } from '../../domain/value-objects/exam-rules';

const copy = (s: ExamSnapshot): ExamSnapshot => ({ ...s, groupIds: [...s.groupIds], examiners: s.examiners.map((e) => ({ ...e })) });
const paged = <T>(all: T[], page: PageRequest) => ({ items: all.slice(pageOffset(page), pageOffset(page) + page.pageSize), total: all.length });

/** In-memory ExamRepository with the same visibility, uniqueness and ordering as the SQL one (no locking: tests of concurrency run on the real database). */
export class InMemoryExamRepository implements ExamRepository {
  readonly exams = new Map<string, ExamSnapshot>();
  readonly students: ExamStudentRow[] = [];
  readonly results = new Map<string, ExamResultSnapshot>();

  private live(): ExamSnapshot[] {
    return [...this.exams.values()].filter((e) => e.deletedAt === null);
  }
  private hydrate(list: ExamSnapshot[]): Exam[] {
    return list.map((s) => Exam.rehydrate(copy(s)));
  }

  async insert(exam: Exam, _tx: TransactionContext): Promise<void> {
    this.exams.set(exam.snapshot.id, copy(exam.snapshot));
  }
  async lockById(examId: string, _mode: LockMode, _tx: TransactionContext): Promise<Exam | undefined> {
    return this.findById(examId);
  }
  async findById(examId: string, _tx?: TransactionContext): Promise<Exam | undefined> {
    const s = this.exams.get(examId);
    return s && s.deletedAt === null ? Exam.rehydrate(copy(s)) : undefined;
  }
  async save(exam: Exam, _tx: TransactionContext): Promise<void> {
    this.exams.set(exam.snapshot.id, copy(exam.snapshot));
  }
  private byStart(list: ExamSnapshot[]): ExamSnapshot[] {
    return list.sort((a, b) => b.startAt.getTime() - a.startAt.getTime() || a.id.localeCompare(b.id));
  }
  async listBySchool(schoolId: string, statuses: readonly ExamStatus[] | undefined, page: PageRequest) {
    const all = this.byStart(this.live().filter((e) => e.schoolId === schoolId && (!statuses || statuses.length === 0 || statuses.includes(e.status))));
    const p = paged(all, page);
    return { items: this.hydrate(p.items), total: p.total };
  }
  async listAssignedToTeacher(teacherId: string, statuses: readonly ExamStatus[], page: PageRequest) {
    const all = this.byStart(this.live().filter((e) => statuses.includes(e.status) && e.examiners.some((x) => x.teacherId === teacherId && x.releasedAt === null)));
    const p = paged(all, page);
    return { items: this.hydrate(p.items), total: p.total };
  }
  async listScheduleOfSchools(schoolIds: readonly string[], page: PageRequest) {
    const all = this.byStart(this.live().filter((e) => schoolIds.includes(e.schoolId) && e.scheduledAt !== null));
    const p = paged(all, page);
    return { items: this.hydrate(p.items), total: p.total };
  }
  async idsDueToStart(now: Date, limit: number, _tx?: TransactionContext): Promise<string[]> {
    return this.live().filter((e) => e.status === 'SCHEDULED' && e.startAt.getTime() <= now.getTime()).sort((a, b) => a.startAt.getTime() - b.startAt.getTime()).slice(0, limit).map((e) => e.id);
  }
  async idsDueToComplete(now: Date, limit: number, _tx?: TransactionContext): Promise<string[]> {
    return this.live().filter((e) => e.status === 'STARTED' && e.endAt !== null && e.endAt.getTime() < now.getTime()).sort((a, b) => a.endAt!.getTime() - b.endAt!.getTime()).slice(0, limit).map((e) => e.id);
  }
  async listScheduledCoveringGroup(schoolId: string, groupId: string, _tx: TransactionContext): Promise<Exam[]> {
    return this.hydrate(this.live().filter((e) => e.schoolId === schoolId && e.status === 'SCHEDULED' && (e.wholeSchool || e.groupIds.includes(groupId))));
  }

  async insertStudents(rows: readonly ExamStudentRow[], _tx: TransactionContext): Promise<void> {
    this.students.push(...rows.map((r) => ({ ...r })));
  }
  private index(examId: string, studentId: string): number {
    return this.students.findIndex((s) => s.examId === examId && s.studentId === studentId);
  }
  async markStudentExamined(examId: string, studentId: string, _tx: TransactionContext) {
    const i = this.index(examId, studentId);
    if (i < 0) return { outcome: 'MISSING' as const };
    const row = this.students[i]!;
    if (row.status !== 'PENDING') return { outcome: 'NOT_PENDING' as const };
    this.students[i] = { ...row, status: 'EXAMINED' };
    return { outcome: 'OK' as const, groupId: row.groupId };
  }
  async markPendingAbsent(examId: string, _tx: TransactionContext): Promise<string[]> {
    const ids: string[] = [];
    this.students.forEach((s, i) => {
      if (s.examId === examId && s.status === 'PENDING') { this.students[i] = { ...s, status: 'ABSENT' }; ids.push(s.studentId); }
    });
    return ids.sort();
  }
  async countStudents(examId: string): Promise<number> {
    return this.students.filter((s) => s.examId === examId).length;
  }
  async listGroupsWithCounts(examId: string) {
    const by = new Map<string, { groupId: string; groupName: string; total: number; pending: number }>();
    for (const s of this.students.filter((x) => x.examId === examId)) {
      const g = by.get(s.groupId) ?? { groupId: s.groupId, groupName: s.groupName, total: 0, pending: 0 };
      by.set(s.groupId, { ...g, total: g.total + 1, pending: g.pending + (s.status === 'PENDING' ? 1 : 0) });
    }
    return [...by.values()].sort((a, b) => a.groupName.localeCompare(b.groupName) || a.groupId.localeCompare(b.groupId));
  }
  async listPendingStudents(examId: string, groupId: string, page: PageRequest) {
    return paged(this.students.filter((s) => s.examId === examId && s.groupId === groupId && s.status === 'PENDING').sort((a, b) => a.fullName.localeCompare(b.fullName) || a.studentId.localeCompare(b.studentId)), page);
  }
  async listAbsentStudents(examId: string): Promise<ExamStudentRow[]> {
    return this.students.filter((s) => s.examId === examId && s.status === 'ABSENT').sort((a, b) => a.groupName.localeCompare(b.groupName) || a.fullName.localeCompare(b.fullName));
  }

  async insertResult(result: ExamResult, _tx: TransactionContext): Promise<boolean> {
    const s = result.snapshot;
    for (const r of this.results.values()) if (r.examId === s.examId && r.studentId === s.studentId) return false;
    this.results.set(s.id, { ...s, scores: [...s.scores] });
    return true;
  }
  async listResultsOfExam(examId: string): Promise<ExamResultSnapshot[]> {
    return [...this.results.values()].filter((r) => r.examId === examId).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id)).map((r) => ({ ...r, scores: [...r.scores] }));
  }
  async listOutcomesOfStudent(studentId: string, page: PageRequest): Promise<{ items: StudentExamOutcomeRow[]; total: number }> {
    const rows = this.students.filter((s) => s.studentId === studentId && (s.status === 'EXAMINED' || s.status === 'ABSENT') && this.exams.get(s.examId)?.deletedAt === null);
    rows.sort((a, b) => this.exams.get(b.examId)!.startAt.getTime() - this.exams.get(a.examId)!.startAt.getTime() || a.examId.localeCompare(b.examId));
    const p = paged(rows, page);
    return {
      total: p.total,
      items: p.items.map((r) => ({
        exam: Exam.rehydrate(copy(this.exams.get(r.examId)!)), status: r.status as 'EXAMINED' | 'ABSENT',
        result: r.status === 'EXAMINED' ? ([...this.results.values()].find((x) => x.examId === r.examId && x.studentId === studentId) ?? null) : null,
      })),
    };
  }
}
