import { PublicAttendanceReportSources, PublicPaymentReportSources, ReportService } from '../modules/38-report-modules/public';
import { getAttendanceService } from './attendance';
import { getGroupService } from './groups';
import { getPaymentService } from './payments';
import { getReportPeriodService, getReportScopeResolver } from './reports';
import { getSchoolService } from './schools';
import { getStudentService } from './students';
import { getSubscriptionService } from './subscriptions';
import { getTeacherService } from './teachers';

let reports: ReportService | undefined;

/**
 * Report Modules (Module 38), slice 1: the PAYMENT and ATTENDANCE reports. Authorization is Module 37's reporting scope (`getReportScopeResolver`); the data is read ONLY through the public contracts of the
 * owning modules (16 schools, 18 teachers, 19 students, 20 groups, 26 attendance, 33 subscriptions, 34 payments). Module 38 owns no table and registers nothing with the Authorization Engine.
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
    });
  }
  return reports;
}
