import type { RevisionReportQuery, RevisionReportRow as RevisionCountRow } from '../../../28-revision/public';

/**
 * Where the REVISION report gets its data. Every method is a read through the OWNING module's public contract (Module 38 owns no table, §102); the report has already proven every id
 * lies inside the requester's scope before it asks for revision records.
 */
export interface RevisionReportSources {
  /** Every school of the organizations (any status). */
  schoolIdsOfOrganizations(organizationIds: readonly string[]): Promise<string[]>;
  /** The school of a group, or undefined when the group does not exist. */
  schoolIdOfGroup(groupId: string): Promise<string | undefined>;
  /** The school of a student, or undefined when the student does not exist. */
  schoolIdOfStudent(studentId: string): Promise<string | undefined>;
  /** True when the student is CURRENTLY in a group the Teacher (identified by their user id) teaches. */
  isStudentInGroupOfTeacherUser(studentId: string, teacherUserId: string): Promise<boolean>;
  /** Revision records counted per school, group, student and fulfilment state (Module 28). */
  revisionCounts(query: RevisionReportQuery): Promise<RevisionCountRow[]>;
  /** The name and JOIN DATE of each student that exists (§67). */
  studentFacts(studentIds: readonly string[]): Promise<ReadonlyMap<string, { fullName: string; joinDate: string }>>;
  groupNames(groupIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  schoolNames(schoolIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
