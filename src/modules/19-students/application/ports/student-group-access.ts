/**
 * "A Teacher reads only the Students of the groups assigned to them" (approved Module 19 decision). Groups belong to Module 20, so Module 19
 * only declares this port; Module 20 (Groups) supplies the real implementation through its public contract.
 */
export interface StudentGroupAccess {
  /** True only when the student is currently assigned to a group whose teacher is `teacherId`. */
  isStudentInGroupOfTeacher(studentId: string, teacherId: string): Promise<boolean>;
}

/**
 * TEMPORARY, used ONLY while Module 20 (Groups) does not exist: no group exists, so no Teacher can read any Student (fail closed).
 * It must be replaced by the Groups module's implementation when Module 20 is implemented;
 * `tests/unit/students/student-boundaries.test.ts` fails as soon as Module 20 contains source files while this stand-in is still wired in
 * `src/config/students.ts`.
 */
export const GROUPS_MODULE_NOT_IMPLEMENTED_YET_FOR_STUDENTS: StudentGroupAccess = {
  isStudentInGroupOfTeacher: async () => false,
};
