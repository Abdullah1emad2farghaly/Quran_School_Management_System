import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import { pageOffset, type PageRequest, type TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { ExamRepository, ExamStudentRow, LockMode, StudentExamOutcomeRow } from '../../../../application/ports/exam-repository';
import { Exam, type ExaminerAssignment } from '../../../../domain/entities/exam';
import type { ExamResult, ExamResultSnapshot } from '../../../../domain/entities/exam-result';
import type { ExamStatus } from '../../../../domain/value-objects/exam-rules';

type Queryable = Pick<Sequelize, 'query'>;
type D = Date | string;
interface ExamRow {
  id: string; schoolId: string; wholeSchool: number | boolean; status: ExamStatus; startAt: D; endAt: D | null; questionCount: number; maxScore: number | string; createdBy: string; createdAt: D; updatedAt: D;
  scheduledAt: D | null; startedAt: D | null; completedAt: D | null; endedAt: D | null; cancelledAt: D | null; deletedAt: D | null;
}
const asDate = (v: D): Date => (v instanceof Date ? v : new Date(v));
const asDateOrNull = (v: D | null): Date | null => (v === null ? null : asDate(v));
const EXAM_SELECT = `SELECT id, school_id AS schoolId, whole_school AS wholeSchool, status, start_at AS startAt, end_at AS endAt, question_count AS questionCount, max_score AS maxScore, created_by AS createdBy,
  created_at AS createdAt, updated_at AS updatedAt, scheduled_at AS scheduledAt, started_at AS startedAt, completed_at AS completedAt, ended_at AS endedAt, cancelled_at AS cancelledAt, deleted_at AS deletedAt FROM exams`;
const LOCK: Record<LockMode, string> = { UPDATE: ' FOR UPDATE', SHARE: ' LOCK IN SHARE MODE' };

/**
 * MariaDB ExamRepository (Module 30's own tables). Deleted exams (`deleted_at IS NOT NULL`) are invisible to every method. There is NO UPDATE and NO DELETE statement on
 * `exam_results` or `exam_result_scores` anywhere in this class: a result is written once, by `insertResult`. `exam_students.status` is the only field of a target row that changes.
 * Locking reads (`FOR UPDATE` / `LOCK IN SHARE MODE`) always read the latest committed state. Timestamps are UTC.
 */
export class SequelizeExamRepository implements ExamRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  private async hydrate(rows: ExamRow[], suffix: string, tx?: TransactionContext): Promise<Exam[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const groups = await this.db.query<{ examId: string; groupId: string }>(`SELECT exam_id AS examId, group_id AS groupId FROM exam_groups WHERE exam_id IN (:ids) ORDER BY group_id${suffix}`, { replacements: { ids }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const examiners = await this.db.query<{ examId: string; teacherId: string; assignedAt: D; assignedBy: string; releasedAt: D | null; releaseReason: ExaminerAssignment['releaseReason'] }>(
      `SELECT exam_id AS examId, teacher_id AS teacherId, assigned_at AS assignedAt, assigned_by AS assignedBy, released_at AS releasedAt, release_reason AS releaseReason FROM exam_examiners WHERE exam_id IN (:ids) ORDER BY assigned_at, teacher_id${suffix}`,
      { replacements: { ids }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    return rows.map((r) =>
      Exam.rehydrate({
        id: r.id, schoolId: r.schoolId, wholeSchool: Boolean(r.wholeSchool), groupIds: groups.filter((g) => g.examId === r.id).map((g) => g.groupId), startAt: asDate(r.startAt), endAt: asDateOrNull(r.endAt),
        questionCount: Number(r.questionCount), maxScore: Number(r.maxScore), status: r.status,
        examiners: examiners.filter((e) => e.examId === r.id).map((e) => ({ teacherId: e.teacherId, assignedAt: asDate(e.assignedAt), assignedBy: e.assignedBy, releasedAt: asDateOrNull(e.releasedAt), releaseReason: e.releaseReason })),
        createdBy: r.createdBy, createdAt: asDate(r.createdAt), updatedAt: asDate(r.updatedAt), scheduledAt: asDateOrNull(r.scheduledAt), startedAt: asDateOrNull(r.startedAt), completedAt: asDateOrNull(r.completedAt),
        endedAt: asDateOrNull(r.endedAt), cancelledAt: asDateOrNull(r.cancelledAt), deletedAt: asDateOrNull(r.deletedAt),
      }),
    );
  }

  async insert(exam: Exam, tx: TransactionContext): Promise<void> {
    const s = exam.snapshot;
    await this.db.query(
      `INSERT INTO exams (id, school_id, whole_school, status, start_at, end_at, question_count, max_score, created_by, created_at, updated_at, scheduled_at, started_at, completed_at, ended_at, cancelled_at, deleted_at)
       VALUES (:id, :schoolId, :wholeSchool, :status, :startAt, :endAt, :questionCount, :maxScore, :createdBy, :createdAt, :updatedAt, :scheduledAt, :startedAt, :completedAt, :endedAt, :cancelledAt, :deletedAt)`,
      { replacements: { ...s, wholeSchool: s.wholeSchool ? 1 : 0 }, transaction: this.t(tx) },
    );
    await this.writeChildren(exam, tx);
  }

  async lockById(examId: string, mode: LockMode, tx: TransactionContext): Promise<Exam | undefined> {
    const rows = await this.db.query<ExamRow>(`${EXAM_SELECT} WHERE id = :examId AND deleted_at IS NULL${LOCK[mode]}`, { replacements: { examId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return (await this.hydrate(rows, LOCK[mode], tx))[0];
  }

  async findById(examId: string, tx?: TransactionContext): Promise<Exam | undefined> {
    const rows = await this.db.query<ExamRow>(`${EXAM_SELECT} WHERE id = :examId AND deleted_at IS NULL`, { replacements: { examId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return (await this.hydrate(rows, '', tx))[0];
  }

  async save(exam: Exam, tx: TransactionContext): Promise<void> {
    const s = exam.snapshot;
    await this.db.query(
      `UPDATE exams SET whole_school = :wholeSchool, status = :status, start_at = :startAt, end_at = :endAt, question_count = :questionCount, max_score = :maxScore, updated_at = :updatedAt, scheduled_at = :scheduledAt,
         started_at = :startedAt, completed_at = :completedAt, ended_at = :endedAt, cancelled_at = :cancelledAt, deleted_at = :deletedAt WHERE id = :id`,
      { replacements: { ...s, wholeSchool: s.wholeSchool ? 1 : 0 }, type: QueryTypes.UPDATE, transaction: this.t(tx) },
    );
    await this.db.query('DELETE FROM exam_groups WHERE exam_id = :id', { replacements: { id: s.id }, type: QueryTypes.DELETE, transaction: this.t(tx) });
    await this.writeChildren(exam, tx);
  }

  private async writeChildren(exam: Exam, tx: TransactionContext): Promise<void> {
    const s = exam.snapshot;
    for (const groupId of s.groupIds) await this.db.query('INSERT INTO exam_groups (exam_id, group_id) VALUES (:examId, :groupId)', { replacements: { examId: s.id, groupId }, transaction: this.t(tx) });
    for (const e of s.examiners) {
      await this.db.query(
        `INSERT INTO exam_examiners (exam_id, teacher_id, assigned_at, assigned_by, released_at, release_reason) VALUES (:examId, :teacherId, :assignedAt, :assignedBy, :releasedAt, :releaseReason)
         ON DUPLICATE KEY UPDATE assigned_at = VALUES(assigned_at), assigned_by = VALUES(assigned_by), released_at = VALUES(released_at), release_reason = VALUES(release_reason)`,
        { replacements: { examId: s.id, ...e }, transaction: this.t(tx) },
      );
    }
  }

  private async page(where: string, replacements: Record<string, unknown>, orderBy: string, page: PageRequest, tx?: TransactionContext): Promise<{ items: Exam[]; total: number }> {
    const rows = await this.db.query<ExamRow>(`${EXAM_SELECT} WHERE deleted_at IS NULL AND ${where} ORDER BY ${orderBy} LIMIT :limit OFFSET :offset`, {
      replacements: { ...replacements, limit: page.pageSize, offset: pageOffset(page) }, type: QueryTypes.SELECT, transaction: this.t(tx),
    });
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM exams WHERE deleted_at IS NULL AND ${where}`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return { items: await this.hydrate(rows, '', tx), total: Number(counted[0]?.total ?? 0) };
  }

  listBySchool(schoolId: string, statuses: readonly ExamStatus[] | undefined, page: PageRequest, tx?: TransactionContext) {
    const filter = statuses && statuses.length > 0 ? ' AND status IN (:statuses)' : '';
    return this.page(`school_id = :schoolId${filter}`, { schoolId, ...(filter ? { statuses: [...statuses!] } : {}) }, 'start_at DESC, id ASC', page, tx);
  }

  listAssignedToTeacher(teacherId: string, statuses: readonly ExamStatus[], page: PageRequest, tx?: TransactionContext) {
    return this.page('status IN (:statuses) AND id IN (SELECT exam_id FROM exam_examiners WHERE teacher_id = :teacherId AND released_at IS NULL)', { teacherId, statuses: [...statuses] }, 'start_at DESC, id ASC', page, tx);
  }

  listScheduleOfSchools(schoolIds: readonly string[], page: PageRequest, tx?: TransactionContext) {
    return this.page('school_id IN (:schoolIds) AND scheduled_at IS NOT NULL', { schoolIds: [...schoolIds] }, 'start_at DESC, id ASC', page, tx);
  }

  async idsDueToStart(now: Date, limit: number, tx?: TransactionContext): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>("SELECT id FROM exams WHERE status = 'SCHEDULED' AND deleted_at IS NULL AND start_at <= :now ORDER BY start_at, id LIMIT :limit", { replacements: { now, limit }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) => r.id);
  }

  async idsDueToComplete(now: Date, limit: number, tx?: TransactionContext): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>("SELECT id FROM exams WHERE status = 'STARTED' AND deleted_at IS NULL AND end_at IS NOT NULL AND end_at < :now ORDER BY end_at, id LIMIT :limit", { replacements: { now, limit }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) => r.id);
  }

  async listScheduledCoveringGroup(schoolId: string, groupId: string, tx: TransactionContext): Promise<Exam[]> {
    const rows = await this.db.query<ExamRow>(
      `${EXAM_SELECT} WHERE school_id = :schoolId AND status = 'SCHEDULED' AND deleted_at IS NULL AND (whole_school = 1 OR id IN (SELECT exam_id FROM exam_groups WHERE group_id = :groupId)) ORDER BY id`,
      { replacements: { schoolId, groupId }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    return this.hydrate(rows, '', tx);
  }

  async insertStudents(rows: readonly ExamStudentRow[], tx: TransactionContext): Promise<void> {
    for (const r of rows) {
      await this.db.query('INSERT INTO exam_students (exam_id, student_id, group_id, group_name, full_name, status) VALUES (:examId, :studentId, :groupId, :groupName, :fullName, :status)', { replacements: { ...r }, transaction: this.t(tx) });
    }
  }

  async markStudentExamined(examId: string, studentId: string, tx: TransactionContext): Promise<{ outcome: 'OK'; groupId: string } | { outcome: 'MISSING' | 'NOT_PENDING' }> {
    // A row lock: of two concurrent submissions for the same student the first takes the PENDING row, the second waits and then finds it no longer pending.
    const rows = await this.db.query<{ groupId: string; status: string }>('SELECT group_id AS groupId, status FROM exam_students WHERE exam_id = :examId AND student_id = :studentId FOR UPDATE', {
      replacements: { examId, studentId }, type: QueryTypes.SELECT, transaction: this.t(tx),
    });
    const row = rows[0];
    if (!row) return { outcome: 'MISSING' };
    if (row.status !== 'PENDING') return { outcome: 'NOT_PENDING' };
    await this.db.query("UPDATE exam_students SET status = 'EXAMINED' WHERE exam_id = :examId AND student_id = :studentId AND status = 'PENDING'", { replacements: { examId, studentId }, type: QueryTypes.UPDATE, transaction: this.t(tx) });
    return { outcome: 'OK', groupId: row.groupId };
  }

  async markPendingAbsent(examId: string, tx: TransactionContext): Promise<string[]> {
    const rows = await this.db.query<{ studentId: string }>("SELECT student_id AS studentId FROM exam_students WHERE exam_id = :examId AND status = 'PENDING' ORDER BY student_id FOR UPDATE", { replacements: { examId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    if (rows.length > 0) await this.db.query("UPDATE exam_students SET status = 'ABSENT' WHERE exam_id = :examId AND status = 'PENDING'", { replacements: { examId }, type: QueryTypes.UPDATE, transaction: this.t(tx) });
    return rows.map((r) => r.studentId);
  }

  async countStudents(examId: string, tx?: TransactionContext): Promise<number> {
    const rows = await this.db.query<{ n: number | string }>('SELECT COUNT(*) AS n FROM exam_students WHERE exam_id = :examId', { replacements: { examId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return Number(rows[0]?.n ?? 0);
  }

  async listGroupsWithCounts(examId: string, tx?: TransactionContext) {
    const rows = await this.db.query<{ groupId: string; groupName: string; total: number | string; pending: number | string }>(
      "SELECT group_id AS groupId, MAX(group_name) AS groupName, COUNT(*) AS total, SUM(status = 'PENDING') AS pending FROM exam_students WHERE exam_id = :examId GROUP BY group_id ORDER BY MAX(group_name), group_id",
      { replacements: { examId }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    return rows.map((r) => ({ groupId: r.groupId, groupName: r.groupName, total: Number(r.total), pending: Number(r.pending) }));
  }

  async listPendingStudents(examId: string, groupId: string, page: PageRequest, tx?: TransactionContext) {
    const replacements = { examId, groupId, limit: page.pageSize, offset: pageOffset(page) };
    const rows = await this.db.query<ExamStudentRow>(
      "SELECT exam_id AS examId, student_id AS studentId, group_id AS groupId, group_name AS groupName, full_name AS fullName, status FROM exam_students WHERE exam_id = :examId AND group_id = :groupId AND status = 'PENDING' ORDER BY full_name, student_id LIMIT :limit OFFSET :offset",
      { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    const counted = await this.db.query<{ n: number | string }>("SELECT COUNT(*) AS n FROM exam_students WHERE exam_id = :examId AND group_id = :groupId AND status = 'PENDING'", { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return { items: rows, total: Number(counted[0]?.n ?? 0) };
  }

  listAbsentStudents(examId: string, tx?: TransactionContext): Promise<ExamStudentRow[]> {
    return this.db.query<ExamStudentRow>("SELECT exam_id AS examId, student_id AS studentId, group_id AS groupId, group_name AS groupName, full_name AS fullName, status FROM exam_students WHERE exam_id = :examId AND status = 'ABSENT' ORDER BY group_name, full_name, student_id", {
      replacements: { examId }, type: QueryTypes.SELECT, transaction: this.t(tx),
    });
  }

  async insertResult(result: ExamResult, tx: TransactionContext): Promise<boolean> {
    const s = result.snapshot;
    try {
      await this.db.query(
        `INSERT INTO exam_results (id, exam_id, school_id, group_id, student_id, total_score, examiner_teacher_id, examiner_user_id, recorded_at)
         VALUES (:id, :examId, :schoolId, :groupId, :studentId, :total, :examinerTeacherId, :examinerUserId, :recordedAt)`,
        { replacements: { ...s }, transaction: this.t(tx) },
      );
    } catch (error) {
      if (error instanceof UniqueConstraintError) return false;
      throw error;
    }
    for (let i = 0; i < s.scores.length; i += 1) {
      await this.db.query('INSERT INTO exam_result_scores (result_id, question_number, score) VALUES (:id, :question, :score)', { replacements: { id: s.id, question: i + 1, score: s.scores[i] }, transaction: this.t(tx) });
    }
    return true;
  }

  private async hydrateResults(rows: Array<Omit<ExamResultSnapshot, 'scores' | 'total' | 'recordedAt'> & { total: number | string; recordedAt: D }>, tx?: TransactionContext): Promise<ExamResultSnapshot[]> {
    if (rows.length === 0) return [];
    const scores = await this.db.query<{ resultId: string; question: number; score: number | string }>('SELECT result_id AS resultId, question_number AS question, score FROM exam_result_scores WHERE result_id IN (:ids) ORDER BY result_id, question_number', {
      replacements: { ids: rows.map((r) => r.id) }, type: QueryTypes.SELECT, transaction: this.t(tx),
    });
    return rows.map((r) => ({ ...r, total: Number(r.total), recordedAt: asDate(r.recordedAt), scores: scores.filter((s) => s.resultId === r.id).map((s) => Number(s.score)) }));
  }

  async listResultsOfExam(examId: string, tx?: TransactionContext): Promise<ExamResultSnapshot[]> {
    const rows = await this.db.query<never>('SELECT id, exam_id AS examId, school_id AS schoolId, group_id AS groupId, student_id AS studentId, total_score AS total, examiner_teacher_id AS examinerTeacherId, examiner_user_id AS examinerUserId, recorded_at AS recordedAt FROM exam_results WHERE exam_id = :examId ORDER BY recorded_at, id', {
      replacements: { examId }, type: QueryTypes.SELECT, transaction: this.t(tx),
    });
    return this.hydrateResults(rows, tx);
  }

  async listOutcomesOfStudent(studentId: string, page: PageRequest, tx?: TransactionContext): Promise<{ items: StudentExamOutcomeRow[]; total: number }> {
    const base = "FROM exam_students s JOIN exams e ON e.id = s.exam_id WHERE s.student_id = :studentId AND s.status IN ('EXAMINED', 'ABSENT') AND e.deleted_at IS NULL";
    const replacements = { studentId, limit: page.pageSize, offset: pageOffset(page) };
    const rows = await this.db.query<{ examId: string; status: 'EXAMINED' | 'ABSENT' }>(`SELECT s.exam_id AS examId, s.status AS status ${base} ORDER BY e.start_at DESC, e.id LIMIT :limit OFFSET :offset`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const counted = await this.db.query<{ n: number | string }>(`SELECT COUNT(*) AS n ${base}`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const out: StudentExamOutcomeRow[] = [];
    for (const row of rows) {
      const exam = await this.findById(row.examId, tx);
      if (!exam) continue;
      let result: ExamResultSnapshot | null = null;
      if (row.status === 'EXAMINED') {
        const found = await this.db.query<never>('SELECT id, exam_id AS examId, school_id AS schoolId, group_id AS groupId, student_id AS studentId, total_score AS total, examiner_teacher_id AS examinerTeacherId, examiner_user_id AS examinerUserId, recorded_at AS recordedAt FROM exam_results WHERE exam_id = :examId AND student_id = :studentId', {
          replacements: { examId: row.examId, studentId }, type: QueryTypes.SELECT, transaction: this.t(tx),
        });
        result = (await this.hydrateResults(found, tx))[0] ?? null;
      }
      out.push({ exam, status: row.status, result });
    }
    return { items: out, total: Number(counted[0]?.n ?? 0) };
  }
}
