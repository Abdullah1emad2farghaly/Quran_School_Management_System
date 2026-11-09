import type { TransactionContext } from '../../../00-shared-kernel/public';

export interface RosterStudent {
  readonly id: string;
  readonly fullName: string;
  readonly schoolId: string;
  readonly organizationId: string;
  /** The Student lifecycle status of Module 19 (ACTIVE, INACTIVE, ARCHIVED). */
  readonly status: string;
}

/**
 * The narrow, read-only view Module 33 has of the Students module (adapter over the PUBLIC `StudentService`; no other module's table is ever read).
 * "Regular / active students" (approved Module 33 decision) means the Student status ACTIVE.
 */
export interface StudentRoster {
  find(studentId: string, tx?: TransactionContext): Promise<RosterStudent | undefined>;
  /** The ids of EVERY student of the school whose status is ACTIVE right now (all pages), oldest first. */
  listActiveStudentIds(schoolId: string, tx?: TransactionContext): Promise<string[]>;
}
