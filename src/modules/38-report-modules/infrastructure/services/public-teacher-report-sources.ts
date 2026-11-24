import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { GroupService } from '../../../20-groups/public';
import type { TeacherReportSources } from '../../application/ports/teacher-report-sources';

export interface PublicTeacherReportSourcesDeps {
  readonly schools: Pick<SchoolLookup, 'findById' | 'listSchoolIdsOfOrganizations'>;
  readonly teachers: Pick<TeacherLookup, 'findById' | 'listActiveSchoolIds'>;
  readonly groups: Pick<GroupService, 'listGroupsTaughtByTeacherForReport'>;
}

/** The TEACHER report's own data, read ONLY through the public contracts of Modules 16, 18 and 20 (never their tables or repositories). The group figures come from the GROUP report. */
export class PublicTeacherReportSources implements TeacherReportSources {
  constructor(private readonly deps: PublicTeacherReportSourcesDeps) {}

  schoolIdsOfOrganizations(organizationIds: readonly string[]) {
    return this.deps.schools.listSchoolIdsOfOrganizations(organizationIds);
  }

  async teacherName(teacherId: string): Promise<string | undefined> {
    return (await this.deps.teachers.findById(teacherId))?.name;
  }

  activeSchoolIdsOfTeacher(teacherId: string) {
    return this.deps.teachers.listActiveSchoolIds(teacherId);
  }

  taughtGroups(query: Parameters<TeacherReportSources['taughtGroups']>[0]) {
    return this.deps.groups.listGroupsTaughtByTeacherForReport(query);
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
