import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { StudentHistoryEntry } from '../../domain/entities/student-history-entry';
import type { Student } from '../../domain/entities/student';
import type { StudentStatus } from '../../domain/value-objects/student-status';

export type StudentSortKey = 'createdAt' | 'joinDate' | 'fullName';

export interface StudentListQuery {
  readonly sort: StudentSortKey;
  readonly direction: 'asc' | 'desc';
  readonly status?: readonly StudentStatus[];
  readonly page: PageRequest;
}

export interface StudentRepository {
  /** Inserts a new Student. The unique index on `national_id` (global, every status) is the final guard: a duplicate is STUDENT_NATIONAL_ID_CONFLICT. */
  insert(student: Student, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `student.version`. Throws STUDENT_CONCURRENT_MODIFICATION when it is stale. */
  update(student: Student, tx: TransactionContext): Promise<void>;
  /** Appends history rows (never updated or deleted). */
  insertHistory(entries: readonly StudentHistoryEntry[], tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Student | undefined>;
  /** Locks the row (FOR UPDATE) so two lifecycle changes or updates of the same student are serialized. */
  lockById(id: string, tx: TransactionContext): Promise<Student | undefined>;
  findByNationalId(nationalId: string, tx?: TransactionContext): Promise<Student | undefined>;
  listBySchool(schoolId: string, query: StudentListQuery, tx?: TransactionContext): Promise<{ items: Student[]; total: number }>;
  listByParent(parentId: string, query: StudentListQuery, tx?: TransactionContext): Promise<{ items: Student[]; total: number }>;
  /** Students of the Parent in the school in EVERY status (an archived student still anchors the Parent-to-School relationship). */
  countByParentInSchool(parentId: string, schoolId: string, tx: TransactionContext): Promise<number>;
  listHistory(studentId: string, tx?: TransactionContext): Promise<StudentHistoryEntry[]>;
}
