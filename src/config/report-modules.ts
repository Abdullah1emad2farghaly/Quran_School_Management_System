import { PublicPaymentReportSources, ReportService } from '../modules/38-report-modules/public';
import { getPaymentService } from './payments';
import { getReportPeriodService, getReportScopeResolver } from './reports';
import { getSchoolService } from './schools';
import { getSubscriptionService } from './subscriptions';

let reports: ReportService | undefined;

/**
 * Report Modules (Module 38), slice 1: the PAYMENT report. Authorization is Module 37's reporting scope (`getReportScopeResolver`); the data is read ONLY through the public contracts of the
 * owning modules (16 schools, 33 subscriptions, 34 payments). Module 38 owns no table and registers nothing with the Authorization Engine.
 */
export function getReportService(): ReportService {
  if (!reports) {
    reports = new ReportService({
      scopes: getReportScopeResolver(),
      periods: getReportPeriodService(),
      payments: new PublicPaymentReportSources({ schools: getSchoolService(), subscriptions: getSubscriptionService(), payments: getPaymentService() }),
    });
  }
  return reports;
}
