import type { EvaluationReportQuery, EvaluationReportRow as EvaluationCountRow } from '../../../29-evaluations/public';

/**
 * Where the EVALUATION report gets its data. Every method is a read through the OWNING module's public contract (Module 38 owns no table, §102); the report has already proven every id lies
 * inside the requester's scope before it asks for evaluations.
 */
export interface EvaluationReportSources {
  /** Every school of the organizations (any status). */
  schoolIdsOfOrganizations(organizationIds: readonly string[]): Promise<string[]>;
  /** The school of a group, or undefined when the group does not exist. */
  schoolIdOfGroup(groupId: string): Promise<string | undefined>;
  /** The school of a student, or undefined when the student does not exist. */
  schoolIdOfStudent(studentId: string): Promise<string | undefined>;
  /** True when the student is CURRENTLY in a group the Teacher (identified by their user id) teaches. */
  isStudentInGroupOfTeacherUser(studentId: string, teacherUserId: string): Promise<boolean>;
  /** Evaluations counted per school, group and student with the count and exact sum of the scores per category (Module 29). */
  evaluationCounts(query: EvaluationReportQuery): Promise<EvaluationCountRow[]>;
  /** The name and JOIN DATE of each student that exists (§67). */
  studentFacts(studentIds: readonly string[]): Promise<ReadonlyMap<string, { fullName: string; joinDate: string }>>;
  groupNames(groupIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  schoolNames(schoolIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
