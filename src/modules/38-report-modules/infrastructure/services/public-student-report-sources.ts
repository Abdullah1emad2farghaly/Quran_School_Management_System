import type { SchoolLookup } from '../../../16-schools/public';
import type { StudentLookup } from '../../../19-students/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { GroupService } from '../../../20-groups/public';
import type { ExamReportLookup } from '../../../30-exams/public';
import type { SubscriptionService } from '../../../33-subscriptions/public';
import type { StudentReportSources } from '../../application/ports/student-report-sources';

export interface PublicStudentReportSourcesDeps {
  readonly schools: Pick<SchoolLookup, 'findById' | 'listSchoolIdsOfOrganizations'>;
  readonly students: Pick<StudentLookup, 'findScopeById' | 'listReportFacts'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
  readonly groups: Pick<GroupService, 'isStudentInGroupOfTeacher' | 'listNamesByIds' | 'listAssignmentHistoryOfStudent'>;
  readonly exams: ExamReportLookup;
  readonly subscriptions: Pick<SubscriptionService, 'listStudentSubscriptionsForReport'>;
}

/** The STUDENT report's own data, read ONLY through the public contracts of Modules 16, 18, 19, 20, 30 and 33 (never their tables or repositories). Learning sections come from the existing report sources. */
export class PublicStudentReportSources implements StudentReportSources {
  constructor(private readonly deps: PublicStudentReportSourcesDeps) {}

  schoolIdsOfOrganizations(organizationIds: readonly string[]) {
    return this.deps.schools.listSchoolIdsOfOrganizations(organizationIds);
  }

  /** Module 19 answers for a student of ANY lifecycle status (ARCHIVED and INACTIVE included): a report never changes a student's status. */
  async schoolIdOfStudent(studentId: string): Promise<string | undefined> {
    return (await this.deps.students.findScopeById(studentId))?.schoolId;
  }

  async isStudentInGroupOfTeacherUser(studentId: string, teacherUserId: string): Promise<boolean> {
    const teacher = await this.deps.teachers.findByUserId(teacherUserId);
    return teacher ? this.deps.groups.isStudentInGroupOfTeacher(studentId, teacher.id) : false;
  }

  async studentFacts(studentId: string) {
    const [fact] = await this.deps.students.listReportFacts([studentId]);
    return fact ? { fullName: fact.fullName, joinDate: fact.joinDate } : undefined;
  }

  assignmentHistoryOfStudent(studentId: string) {
    return this.deps.groups.listAssignmentHistoryOfStudent(studentId);
  }

  examOutcomes(query: Parameters<StudentReportSources['examOutcomes']>[0]) {
    return this.deps.exams.listStudentOutcomesForReport(query);
  }

  subscriptions(query: Parameters<StudentReportSources['subscriptions']>[0]) {
    return this.deps.subscriptions.listStudentSubscriptionsForReport(query);
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
