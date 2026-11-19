/**
 * What Module 35 needs to know about places and who manages them, answered by the composition root from the public contracts of Modules 13 and 16
 * (Module 35 never reads another module's tables).
 */
export interface AuditScopeDirectory {
  /** Organizations this user administers (an ORGANIZATION_MANAGER's scope). */
  organizationIdsOf(userId: string): Promise<string[]>;
  /** Schools this user currently manages (a SCHOOL_MANAGER's scope). */
  schoolIdsOf(userId: string): Promise<string[]>;
  /** The organization a school belongs to, or null when the school is unknown. */
  organizationOfSchool(schoolId: string): Promise<string | null>;
}
