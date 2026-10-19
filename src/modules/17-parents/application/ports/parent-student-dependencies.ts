import type { TransactionContext } from '../../../00-shared-kernel/public';

/**
 * Students that depend on a Parent-to-School relationship. Module 17 never learns about students itself: Module 19 (Students) supplies the
 * real implementation through its public contract. The guard runs INSIDE the unlink transaction, after the link row was locked, so a
 * student cannot be attached concurrently (Module 19's implementation must lock/count consistently).
 */
export interface ParentStudentDependencies {
  /** How many students of `schoolId` currently depend on `parentId`. Any value above zero blocks the unlink. */
  countStudentsOfParentInSchool(parentId: string, schoolId: string, tx: TransactionContext): Promise<number>;
}

/**
 * TEMPORARY, used ONLY while Module 19 does not exist: no student can exist yet, so no student can depend on a relationship. It must be
 * replaced by the Students module's implementation when Module 19 is implemented; `tests/unit/parents/parent-boundaries.test.ts` fails as soon
 * as Module 19 contains source files while this guard is still the one wired in `src/config/parents.ts`.
 */
export const STUDENTS_MODULE_NOT_IMPLEMENTED_YET: ParentStudentDependencies = {
  countStudentsOfParentInSchool: async () => 0,
};
