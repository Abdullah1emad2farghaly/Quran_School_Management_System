import type { GroupLookup } from '../../../20-groups/public';
import type { OrganizationService } from '../../../13-organization-core/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { StudentService } from '../../../19-students/public';
import type { CollectorDirectory } from '../../../33-subscriptions/public';
import type { ReportScopeSources } from '../../application/ports/report-scope-sources';
import type { GeographicLevel } from '../../domain/value-objects/report-scope';

const PAGE_SIZE = 100;

export interface PublicReportScopeSourcesDeps {
  readonly organizations: Pick<OrganizationService, 'listAdministeredOrganizationIds'>;
  readonly schools: Pick<SchoolLookup, 'listManagedSchoolIds'>;
  readonly collectors: Pick<CollectorDirectory, 'listActiveSchoolIds'>;
  readonly groups: Pick<GroupLookup, 'listCurrentGroupIdsOfTeacherUser'>;
  readonly students: Pick<StudentService, 'listChildrenOfParentUser'>;
}

/**
 * The production adapter: every answer comes from an assignment that its OWNING module stores and exposes through its public contract (Organizations 13, Schools 16, Subscriptions 33 Collector links,
 * Groups 20, Students 19). Module 37 reads no table. Geographic managers: NO module stores which governorate, center or village a user manages (evidence: no table, no service and no
 * permission in Modules 13, 14, 15 or 16 links a user to a geographic area; the Governorate/Center/Village manager roles of Module 09 are only role codes), so this adapter answers
 * `undefined` and the resolver denies. Nothing is invented: when an authoritative, owner-approved assignment exists, only `geographicAreasOfManager` changes.
 */
export class PublicReportScopeSources implements ReportScopeSources {
  constructor(private readonly deps: PublicReportScopeSourcesDeps) {}

  organizationIdsOfAdmin(userId: string): Promise<string[]> {
    return this.deps.organizations.listAdministeredOrganizationIds(userId);
  }

  schoolIdsOfManager(userId: string): Promise<string[]> {
    return this.deps.schools.listManagedSchoolIds(userId);
  }

  schoolIdsOfCollector(userId: string): Promise<string[]> {
    return this.deps.collectors.listActiveSchoolIds(userId);
  }

  groupIdsOfTeacher(userId: string): Promise<string[]> {
    return this.deps.groups.listCurrentGroupIdsOfTeacherUser(userId);
  }

  async studentIdsOfParent(userId: string): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.deps.students.listChildrenOfParentUser(userId, { page: { page, pageSize: PAGE_SIZE } });
      ids.push(...result.items.map((s) => s.id));
      if (result.items.length === 0 || ids.length >= result.total) break;
    }
    return ids;
  }

  async geographicAreasOfManager(_userId: string, _level: GeographicLevel): Promise<string[] | undefined> {
    return undefined;
  }
}
