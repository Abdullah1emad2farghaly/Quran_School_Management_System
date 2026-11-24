import type { TaughtGroupStintDto } from '../../../20-groups/public';

/**
 * Where the TEACHER report gets what the existing reports do not already provide. Every method is a read through the OWNING module's public contract (Module 38 owns no table, §102). The report passes ONLY the
 * requester's authorized schools wherever a school list is taken, so nothing of another school is ever read.
 */
export interface TeacherReportSources {
  /** Every school of the organizations (any status). */
  schoolIdsOfOrganizations(organizationIds: readonly string[]): Promise<string[]>;
  /** The Teacher's name, or undefined when there is no such Teacher (Module 18). */
  teacherName(teacherId: string): Promise<string | undefined>;
  /** The schools the Teacher is CURRENTLY linked to (Module 18): the caller keeps only the authorized ones. */
  activeSchoolIdsOfTeacher(teacherId: string): Promise<string[]>;
  /** The Teacher's stints in groups of the GIVEN schools only, from the groups' authoritative history, clipped to the range (Module 20). */
  taughtGroups(query: { teacherId: string; schoolIds: readonly string[]; from?: Date; toExclusive?: Date }): Promise<TaughtGroupStintDto[]>;
  schoolNames(schoolIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
