import type { ParentLookup } from '../../../17-parents/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { StudentChildrenReportLookup } from '../../../19-students/public';
import type { ParentReportSources } from '../../application/ports/parent-report-sources';

export interface PublicParentReportSourcesDeps {
  readonly schools: Pick<SchoolLookup, 'listSchoolIdsOfOrganizations'>;
  readonly parents: Pick<ParentLookup, 'findById' | 'findByUserId' | 'listActiveSchoolIds'>;
  readonly students: StudentChildrenReportLookup;
}

/** The PARENT report's own data, read ONLY through the public contracts of Modules 16, 17 and 19 (never their tables or repositories). The children's sections come from the STUDENT report. */
export class PublicParentReportSources implements ParentReportSources {
  constructor(private readonly deps: PublicParentReportSourcesDeps) {}

  schoolIdsOfOrganizations(organizationIds: readonly string[]) {
    return this.deps.schools.listSchoolIdsOfOrganizations(organizationIds);
  }

  async parentOfUser(userId: string): Promise<{ id: string } | undefined> {
    const parent = await this.deps.parents.findByUserId(userId);
    return parent ? { id: parent.id } : undefined;
  }

  async parentName(parentId: string): Promise<string | undefined> {
    return (await this.deps.parents.findById(parentId))?.name;
  }

  activeSchoolIdsOfParent(parentId: string) {
    return this.deps.parents.listActiveSchoolIds(parentId);
  }

  childrenOfParent(query: { parentId: string; schoolIds?: readonly string[] }) {
    return this.deps.students.listChildrenOfParentForReport(query);
  }
}
