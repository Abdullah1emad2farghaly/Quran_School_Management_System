import type { SchoolLookup } from '../../../16-schools/public';
import type { StudentLookup } from '../../../19-students/public';
import type { GroupService } from '../../../20-groups/public';
import type { ExamReportLookup } from '../../../30-exams/public';
import type { GroupReportSources } from '../../application/ports/group-report-sources';

export interface PublicGroupReportSourcesDeps {
  readonly schools: Pick<SchoolLookup, 'findById' | 'listSchoolIdsOfOrganizations'>;
  readonly students: Pick<StudentLookup, 'listReportFacts'>;
  readonly groups: Pick<GroupService, 'findScopeById' | 'getGroup' | 'listAssignmentsOfGroupForReport'>;
  readonly exams: ExamReportLookup;
}

/** The GROUP report's own data, read ONLY through the public contracts of Modules 16, 19, 20 and 30 (never their tables or repositories). The learning figures come from the existing reports. */
export class PublicGroupReportSources implements GroupReportSources {
  constructor(private readonly deps: PublicGroupReportSourcesDeps) {}

  schoolIdsOfOrganizations(organizationIds: readonly string[]) {
    return this.deps.schools.listSchoolIdsOfOrganizations(organizationIds);
  }

  async schoolIdOfGroup(groupId: string): Promise<string | undefined> {
    return (await this.deps.groups.findScopeById(groupId))?.schoolId;
  }

  async groupHeader(groupId: string) {
    if (!(await this.deps.groups.findScopeById(groupId))) return undefined;
    const group = await this.deps.groups.getGroup(groupId);
    return { id: group.id, name: group.name, schoolId: group.schoolId, learningMode: group.learningMode, status: group.status, teacherName: group.teacher?.name ?? null };
  }

  roster(query: Parameters<GroupReportSources['roster']>[0]) {
    return this.deps.groups.listAssignmentsOfGroupForReport(query);
  }

  studentFacts(studentIds: readonly string[]) {
    return this.deps.students.listReportFacts(studentIds);
  }

  examOutcomes(query: Parameters<GroupReportSources['examOutcomes']>[0]) {
    return this.deps.exams.listStudentOutcomesForReport(query);
  }

  async schoolNames(schoolIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const names = new Map<string, string>();
    for (const id of new Set(schoolIds)) {
      const school = await this.deps.schools.findById(id);
      if (school) names.set(id, school.name);
    }
    return names;
  }
}
