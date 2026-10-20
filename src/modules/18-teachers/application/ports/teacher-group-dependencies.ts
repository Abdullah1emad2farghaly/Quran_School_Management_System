import type { TransactionContext } from '../../../00-shared-kernel/public';

/**
 * Groups that depend on a Teacher-to-School relationship. Module 18 never learns about groups itself: Module 20 (Groups) supplies the real
 * implementation through its public contract. The guard runs INSIDE the unlink transaction, after the link row was locked, so a group cannot
 * be assigned concurrently (Module 20's implementation must lock/count consistently).
 */
export interface TeacherGroupDependencies {
  /** How many groups of `schoolId` currently have `teacherId` as their teacher. Any value above zero blocks the unlink. */
  countGroupsOfTeacherInSchool(teacherId: string, schoolId: string, tx: TransactionContext): Promise<number>;
}

/**
 * TEMPORARY, used ONLY while Module 20 does not exist: no group can exist yet, so no group can depend on a relationship. It must be replaced by
 * the Groups module's implementation when Module 20 is implemented; `tests/unit/teachers/teacher-boundaries.test.ts` fails as soon as Module 20
 * contains source files while this guard is still the one wired in `src/config/teachers.ts`.
 */
export const GROUPS_MODULE_NOT_IMPLEMENTED_YET: TeacherGroupDependencies = {
  countGroupsOfTeacherInSchool: async () => 0,
};
