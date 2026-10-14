import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { SchoolManagerAssignment } from '../../domain/entities/school-manager-assignment';

export interface SchoolManagerRepository {
  /** Throws SCHOOL_ALREADY_HAS_MANAGER when the school already has an active manager (unique index is the final guard). */
  insert(assignment: SchoolManagerAssignment, tx: TransactionContext): Promise<void>;
  /** Optimistic: throws SCHOOL_CONCURRENT_MODIFICATION when the stored version changed. */
  update(assignment: SchoolManagerAssignment, tx: TransactionContext): Promise<void>;
  /** The active assignment of the school, locked (`FOR UPDATE`) for the rest of the transaction. */
  lockActiveBySchool(schoolId: string, tx: TransactionContext): Promise<SchoolManagerAssignment | undefined>;
  findActiveBySchool(schoolId: string, tx?: TransactionContext): Promise<SchoolManagerAssignment | undefined>;
  /** Full history, oldest first (active and revoked). */
  findHistoryBySchool(schoolId: string, tx?: TransactionContext): Promise<SchoolManagerAssignment[]>;
  isActiveManager(userId: string, schoolId: string, tx?: TransactionContext): Promise<boolean>;
  listActiveSchoolIdsByUser(userId: string, tx?: TransactionContext): Promise<string[]>;
}
