import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { Teacher } from '../../domain/entities/teacher';

/** The personal name lives on the account (Module 08), so a Teacher list cannot be sorted by it without reading another module's table. */
export type TeacherSortKey = 'createdAt';

export interface TeacherListQuery {
  readonly schoolId: string;
  readonly sort: TeacherSortKey;
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

export interface TeacherRepository {
  /** Inserts a new Teacher. The unique index on `user_id` is the final guard: one Teacher record per account. */
  insert(teacher: Teacher, tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Teacher | undefined>;
  findByUserId(userId: string, tx?: TransactionContext): Promise<Teacher | undefined>;
  /** Locks the row (FOR UPDATE) so two concurrent registrations of the same phone are serialized. */
  lockByUserId(userId: string, tx: TransactionContext): Promise<Teacher | undefined>;
  lockById(id: string, tx: TransactionContext): Promise<Teacher | undefined>;
  /** Teachers with an ACTIVE link to the school. */
  listBySchool(query: TeacherListQuery, tx?: TransactionContext): Promise<{ items: Teacher[]; total: number }>;
}
