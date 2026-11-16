import type { TransactionContext } from '../../../00-shared-kernel/public';

/**
 * A veto Module 26 asks BEFORE it marks a student ABSENT (approved Module 29 rule: a student who already has an evaluation for a session cannot be marked ABSENT for it).
 * It is a PORT owned by Module 26 so that Attendance does not import Evaluations (Evaluations is a later module that depends on Attendance, never the reverse): the
 * composition root plugs Module 29's implementation in. It is optional so that Module 26 keeps working, and keeps being tested, without it.
 */
export interface StudentEvaluationGuard {
  /**
   * The ids, among `studentIds`, that already have an evaluation for the session. It MUST read with a LOCKING read (the caller holds the session row lock), so a
   * concurrent evaluation that has just committed is seen: a plain snapshot read could miss it.
   */
  findEvaluatedStudents(sessionId: string, studentIds: readonly string[], tx: TransactionContext): Promise<readonly string[]>;
}
