import type { StudentChildReportDto } from '../../../19-students/public';

/**
 * Where the PARENT report gets what the STUDENT report does not already provide. Every method is a read through the OWNING module's public contract (Module 38 owns no table, §102); the report proves the Parent and
 * the children lie inside the requester's scope before it reads a child's data.
 */
export interface ParentReportSources {
  /** Every school of the organizations (any status). */
  schoolIdsOfOrganizations(organizationIds: readonly string[]): Promise<string[]>;
  /** The Parent record of a login account (the PARENT role), or undefined. */
  parentOfUser(userId: string): Promise<{ id: string } | undefined>;
  /** The Parent's name, or undefined when there is no such Parent. */
  parentName(parentId: string): Promise<string | undefined>;
  /** The schools the Parent is CURRENTLY linked to (Module 17). */
  activeSchoolIdsOfParent(parentId: string): Promise<string[]>;
  /** The Parent's children of ANY lifecycle status, optionally only in the given schools (Module 19). */
  childrenOfParent(query: { parentId: string; schoolIds?: readonly string[] }): Promise<StudentChildReportDto[]>;
}
