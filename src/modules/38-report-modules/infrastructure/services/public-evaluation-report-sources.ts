import type { SchoolLookup } from '../../../16-schools/public';
import type { StudentLookup } from '../../../19-students/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { GroupLookup } from '../../../20-groups/public';
import type { EvaluationReportLookup } from '../../../29-evaluations/public';
import type { EvaluationReportSources } from '../../application/ports/evaluation-report-sources';

export interface PublicEvaluationReportSourcesDeps {
  readonly schools: Pick<SchoolLookup, 'findById' | 'listSchoolIdsOfOrganizations'>;
  readonly students: Pick<StudentLookup, 'findScopeById' | 'listReportFacts'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
  readonly groups: Pick<GroupLookup, 'findScopeById' | 'isStudentInGroupOfTeacher' | 'listNamesByIds'>;
  readonly evaluation: EvaluationReportLookup;
}

/** The REVISION report's data, read ONLY through the public contracts of Modules 16, 18, 19, 20 and 29 (never their tables or repositories). */
export class PublicEvaluationReportSources implements EvaluationReportSources {
  constructor(private readonly deps: PublicEvaluationReportSourcesDeps) {}

  schoolIdsOfOrganizations(organizationIds: readonly string[]) {
    return this.deps.schools.listSchoolIdsOfOrganizations(organizationIds);
  }

  async schoolIdOfGroup(groupId: string): Promise<string | undefined> {
    return (await this.deps.groups.findScopeById(groupId))?.schoolId;
  }

  async schoolIdOfStudent(studentId: string): Promise<string | undefined> {
    return (await this.deps.students.findScopeById(studentId))?.schoolId;
  }

  async isStudentInGroupOfTeacherUser(studentId: string, teacherUserId: string): Promise<boolean> {
    const teacher = await this.deps.teachers.findByUserId(teacherUserId);
    return teacher ? this.deps.groups.isStudentInGroupOfTeacher(studentId, teacher.id) : false;
  }

  evaluationCounts(query: Parameters<EvaluationReportSources['evaluationCounts']>[0]) {
    return this.deps.evaluation.summarizeForReport(query);
  }

  async studentFacts(studentIds: readonly string[]) {
    const facts = await this.deps.students.listReportFacts(studentIds);
    return new Map(facts.map((f) => [f.id, { fullName: f.fullName, joinDate: f.joinDate }] as const));
  }

  groupNames(groupIds: readonly string[]) {
    return this.deps.groups.listNamesByIds(groupIds);
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
