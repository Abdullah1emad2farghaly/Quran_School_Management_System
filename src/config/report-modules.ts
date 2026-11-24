import { PublicAttendanceReportSources, PublicMemorizationReportSources, PublicEvaluationReportSources, PublicPaymentReportSources, PublicRevisionReportSources, PublicGroupReportSources, PublicParentReportSources, PublicTeacherReportSources, PublicStudentReportSources, ReportService } from '../modules/38-report-modules/public';
import { getAttendanceService } from './attendance';
import { getEvaluationService } from './evaluations';
import { getExamService } from './exams';
import { getGroupService } from './groups';
import { getMemorizationService } from './memorization';
import { getRevisionService } from './revision';
import { getParentService } from './parents';
import { getPaymentService } from './payments';
import { getReportPeriodService, getReportScopeResolver } from './reports';
import { getSchoolService } from './schools';
import { getStudentService } from './students';
import { getSubscriptionService } from './subscriptions';
import { getTeacherService } from './teachers';

let reports: ReportService | undefined;

/**
 * Report Modules (Module 38), slices 1-8: the PAYMENT, ATTENDANCE, MEMORIZATION, REVISION, EVALUATION, STUDENT, PARENT, GROUP and TEACHER reports. Authorization is Module 37's reporting scope (`getReportScopeResolver`); the data is read ONLY through the public contracts of the
 * owning modules (16 schools, 18 teachers, 19 students, 20 groups, 26 attendance, 27 memorization, 28 revision, 29 evaluations, 17 parents, 30 exams, 33 subscriptions, 34 payments). Module 38 owns no table and registers nothing with the Authorization Engine.
 */
export function getReportService(): ReportService {
  if (!reports) {
    reports = new ReportService({
      scopes: getReportScopeResolver(),
      periods: getReportPeriodService(),
      payments: new PublicPaymentReportSources({ schools: getSchoolService(), subscriptions: getSubscriptionService(), payments: getPaymentService() }),
      attendance: new PublicAttendanceReportSources({
        schools: getSchoolService(),
        students: getStudentService(),
        teachers: getTeacherService(),
        groups: getGroupService(),
        attendance: getAttendanceService(),
      }),
      memorization: new PublicMemorizationReportSources({
        schools: getSchoolService(),
        students: getStudentService(),
        teachers: getTeacherService(),
        groups: getGroupService(),
        memorization: getMemorizationService(),
      }),
      revision: new PublicRevisionReportSources({
        schools: getSchoolService(),
        students: getStudentService(),
        teachers: getTeacherService(),
        groups: getGroupService(),
        revision: getRevisionService(),
      }),
      evaluation: new PublicEvaluationReportSources({
        schools: getSchoolService(),
        students: getStudentService(),
        teachers: getTeacherService(),
        groups: getGroupService(),
        evaluation: getEvaluationService(),
      }),
      student: new PublicStudentReportSources({
        schools: getSchoolService(),
        students: getStudentService(),
        teachers: getTeacherService(),
        groups: getGroupService(),
        exams: getExamService(),
        subscriptions: getSubscriptionService(),
      }),
      teacher: new PublicTeacherReportSources({ schools: getSchoolService(), teachers: getTeacherService(), groups: getGroupService() }),
      group: new PublicGroupReportSources({ schools: getSchoolService(), students: getStudentService(), groups: getGroupService(), exams: getExamService() }),
      parent: new PublicParentReportSources({ schools: getSchoolService(), parents: getParentService(), students: getStudentService() }),
    });
  }
  return reports;
}
