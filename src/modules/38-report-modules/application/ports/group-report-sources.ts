import type { GroupRosterReportQuery, GroupRosterReportRowDto } from '../../../20-groups/public';
import type { StudentExamReportQuery, StudentExamReportRowDto } from '../../../30-exams/public';

/**
 * Where the GROUP report gets what the existing reports do not already provide. Every method is a read through the OWNING module's public contract (Module 38 owns no table, §102); the report has already proven the
 * group inside the requester's scope before it asks for anything here.
 */
export interface GroupReportSources {
  /** Every school of the organizations (any status). */
  schoolIdsOfOrganizations(organizationIds: readonly string[]): Promise<string[]>;
  /** The school of a group, or undefined when there is no such group. */
  schoolIdOfGroup(groupId: string): Promise<string | undefined>;
  /** The group header (Module 20), or undefined when there is no such group. */
  groupHeader(groupId: string): Promise<{ id: string; name: string; schoolId: string; learningMode: string; status: string; teacherName: string | null } | undefined>;
  /** The authoritative assignment periods of the group that overlap the range (Module 20). */
  roster(query: GroupRosterReportQuery): Promise<GroupRosterReportRowDto[]>;
  /** The name and JOIN DATE of each student that exists (Module 19), any lifecycle status. */
  studentFacts(studentIds: readonly string[]): Promise<Array<{ id: string; fullName: string; joinDate: string }>>;
  /** One student's recorded exam outcomes inside the range, optionally limited to groups (Module 30). */
  examOutcomes(query: StudentExamReportQuery): Promise<StudentExamReportRowDto[]>;
  schoolNames(schoolIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
