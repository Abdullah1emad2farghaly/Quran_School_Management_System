import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { Exam } from '../../domain/entities/exam';
import type { ExamResult, ExamResultSnapshot } from '../../domain/entities/exam-result';
import type { ExamStatus } from '../../domain/value-objects/exam-rules';

export type ExamStudentStatus = 'PENDING' | 'EXAMINED' | 'ABSENT';

/** One student of the FROZEN target list of an exam (created when the exam STARTED). Only `status` ever changes (PENDING -> EXAMINED or ABSENT). */
export interface ExamStudentRow {
  readonly examId: string;
  readonly studentId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly fullName: string;
  readonly status: ExamStudentStatus;
}

export interface StudentExamOutcomeRow {
  readonly exam: Exam;
  readonly status: 'EXAMINED' | 'ABSENT';
  readonly result: ExamResultSnapshot | null;
}

export type LockMode = 'UPDATE' | 'SHARE';

/**
 * Persistence of exams (Module 30's own tables only). Deleted exams are invisible to every method (they are kept, never shown). A result is NEVER updated or deleted; there is no
 * method that could.
 */
export interface ExamRepository {
  insert(exam: Exam, tx: TransactionContext): Promise<void>;
  /** A locking read of the exam with its groups and examiners: `UPDATE` (changes and transitions) or `SHARE` (result submissions, which may run in parallel but never while a change holds the exam). */
  lockById(examId: string, mode: LockMode, tx: TransactionContext): Promise<Exam | undefined>;
  findById(examId: string, tx?: TransactionContext): Promise<Exam | undefined>;
  /** Writes the exam row, replaces its groups and upserts its examiners. */
  save(exam: Exam, tx: TransactionContext): Promise<void>;
  listBySchool(schoolId: string, statuses: readonly ExamStatus[] | undefined, page: PageRequest, tx?: TransactionContext): Promise<{ items: Exam[]; total: number }>;
  /** Exams the teacher is CURRENTLY assigned to as an examiner, in the given statuses. */
  listAssignedToTeacher(teacherId: string, statuses: readonly ExamStatus[], page: PageRequest, tx?: TransactionContext): Promise<{ items: Exam[]; total: number }>;
  /** Exams that have been scheduled (SCHEDULED, STARTED, COMPLETED, ENDED, or cancelled after being scheduled) of these schools: the schedule a Parent may see. */
  listScheduleOfSchools(schoolIds: readonly string[], page: PageRequest, tx?: TransactionContext): Promise<{ items: Exam[]; total: number }>;
  idsDueToStart(now: Date, limit: number, tx?: TransactionContext): Promise<string[]>;
  idsDueToComplete(now: Date, limit: number, tx?: TransactionContext): Promise<string[]>;
  /** SCHEDULED exams of the school that target this group (or the whole school). */
  listScheduledCoveringGroup(schoolId: string, groupId: string, tx: TransactionContext): Promise<Exam[]>;

  insertStudents(rows: readonly ExamStudentRow[], tx: TransactionContext): Promise<void>;
  /** Atomically takes a PENDING student to EXAMINED (a row lock: the first of two concurrent submissions wins). MISSING: not a target. NOT_PENDING: already examined (or absent). */
  markStudentExamined(examId: string, studentId: string, tx: TransactionContext): Promise<{ outcome: 'OK'; groupId: string } | { outcome: 'MISSING' | 'NOT_PENDING' }>;
  /** Marks every PENDING student ABSENT and returns their ids. */
  markPendingAbsent(examId: string, tx: TransactionContext): Promise<string[]>;
  countStudents(examId: string, tx?: TransactionContext): Promise<number>;
  listGroupsWithCounts(examId: string, tx?: TransactionContext): Promise<Array<{ groupId: string; groupName: string; total: number; pending: number }>>;
  listPendingStudents(examId: string, groupId: string, page: PageRequest, tx?: TransactionContext): Promise<{ items: ExamStudentRow[]; total: number }>;
  listAbsentStudents(examId: string, tx?: TransactionContext): Promise<ExamStudentRow[]>;

  /** false when the (exam, student) already has a result (the unique key). */
  insertResult(result: ExamResult, tx: TransactionContext): Promise<boolean>;
  listResultsOfExam(examId: string, tx?: TransactionContext): Promise<ExamResultSnapshot[]>;
  /** A student's EXAMINED and ABSENT outcomes, by the exam's start, newest first. */
  listOutcomesOfStudent(studentId: string, page: PageRequest, tx?: TransactionContext): Promise<{ items: StudentExamOutcomeRow[]; total: number }>;
}
