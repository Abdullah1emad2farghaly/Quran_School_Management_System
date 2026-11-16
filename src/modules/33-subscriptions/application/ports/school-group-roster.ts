import type { TransactionContext } from '../../../00-shared-kernel/public';

export interface RosterGroup {
  readonly id: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly name: string;
}

export interface RosterGroupStudent {
  readonly studentId: string;
  readonly fullName: string;
}

/**
 * The narrow, read-only view Module 33 has of the EXISTING educational groups of Module 20 (adapter over its PUBLIC `GroupService`; no group table or model of another module is read
 * and no group data is copied or stored). The relationships are exactly Module 20's: a student is in at most ONE group at a time (current assignment), only ACTIVE groups hold
 * students, an ARCHIVED student is unassigned, an INACTIVE student keeps the assignment, and the period history stays in Module 20.
 */
export interface SchoolGroupRoster {
  /** Every ACTIVE group of the school (all pages), unsorted. */
  listActiveGroups(schoolId: string, tx?: TransactionContext): Promise<RosterGroup[]>;
  /** An ACTIVE group, or undefined when it does not exist or is not ACTIVE. */
  findActiveGroup(groupId: string, tx?: TransactionContext): Promise<RosterGroup | undefined>;
  /** The students CURRENTLY assigned to the group whose Student status is ACTIVE (the "regular/active students" of the group), each exactly once. */
  listActiveStudentsOfGroup(groupId: string, tx?: TransactionContext): Promise<RosterGroupStudent[]>;
}
