import { PublicReportScopeSources, ReportPeriodService, ReportScopeResolver } from '../modules/37-reports-core/public';
import { getOrganizationService } from './organization';
import { getGroupService } from './groups';
import { getSchoolService } from './schools';
import { getStudentService } from './students';
import { getCollectorService } from './subscriptions';

let resolver: ReportScopeResolver | undefined;
let periods: ReportPeriodService | undefined;

/**
 * The shared reporting foundation (Module 37): the scope resolver every report endpoint and export of Module 38 must use. It reads the user's CURRENT assignments through the owning modules'
 * public contracts only. Module 37 has no table, no endpoint and no permission of its own.
 */
export function getReportScopeResolver(): ReportScopeResolver {
  if (!resolver) {
    resolver = new ReportScopeResolver(
      new PublicReportScopeSources({
        organizations: getOrganizationService(),
        schools: getSchoolService(),
        collectors: getCollectorService(),
        groups: getGroupService(),
        students: getStudentService(),
      }),
    );
  }
  return resolver;
}

export function getReportPeriodService(): ReportPeriodService {
  if (!periods) periods = new ReportPeriodService({});
  return periods;
}
