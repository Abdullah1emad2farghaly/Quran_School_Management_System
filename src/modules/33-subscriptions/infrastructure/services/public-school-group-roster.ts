import { AppError, type TransactionContext } from '../../../00-shared-kernel/public';
import type { GroupService } from '../../../20-groups/public';
import type { RosterGroup, RosterGroupStudent, SchoolGroupRoster } from '../../application/ports/school-group-roster';

const PAGE_SIZE = 100;

const toRosterGroup = (g: { id: string; schoolId: string; organizationId: string; name: string }): RosterGroup => ({ id: g.id, schoolId: g.schoolId, organizationId: g.organizationId, name: g.name });

/**
 * Adapter from Module 33's `SchoolGroupRoster` port to the PUBLIC `GroupService` of Module 20. It adds no membership behavior: it reads the groups and the current assignments
 * Module 20 already owns and keeps only the students whose status is ACTIVE.
 */
export class PublicSchoolGroupRoster implements SchoolGroupRoster {
  constructor(private readonly groups: Pick<GroupService, 'listGroupsOfSchool' | 'getGroup' | 'listStudentsOfGroup'>) {}

  async listActiveGroups(schoolId: string, tx?: TransactionContext): Promise<RosterGroup[]> {
    const out: RosterGroup[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.groups.listGroupsOfSchool(schoolId, { status: ['ACTIVE'], sort: 'name', direction: 'asc', page: { page, pageSize: PAGE_SIZE } }, tx);
      out.push(...result.items.map(toRosterGroup));
      if (page * PAGE_SIZE >= result.total || result.items.length === 0) return out;
    }
  }

  async findActiveGroup(groupId: string, tx?: TransactionContext): Promise<RosterGroup | undefined> {
    try {
      const group = await this.groups.getGroup(groupId, tx);
      return group.status === 'ACTIVE' ? toRosterGroup(group) : undefined;
    } catch (error) {
      if (error instanceof AppError && error.code === 'GROUP_NOT_FOUND') return undefined;
      throw error;
    }
  }

  async listActiveStudentsOfGroup(groupId: string, tx?: TransactionContext): Promise<RosterGroupStudent[]> {
    const seen = new Map<string, RosterGroupStudent>();
    for (let page = 1; ; page += 1) {
      const result = await this.groups.listStudentsOfGroup(groupId, { page, pageSize: PAGE_SIZE }, 'asc', tx);
      for (const s of result.items) if (s.status === 'ACTIVE' && !seen.has(s.studentId)) seen.set(s.studentId, { studentId: s.studentId, fullName: s.fullName });
      // `total` counts the current assignments (a page can hold fewer students than `pageSize` when an ARCHIVED student is skipped), so stop by the assignment count.
      if (page * PAGE_SIZE >= result.total) return [...seen.values()];
    }
  }
}
