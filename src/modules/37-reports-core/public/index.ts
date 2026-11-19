// Public contract of Module 37 (Reports Core), first slice: the report PERIOD rules (Master Specification §66, §71) and the student effective start (§67).
// Reports are read models over data owned by other modules (§102); this module owns no business data and no table. Module 38 (Report Modules) uses ONLY this contract for periods.
// Release 0.51.0 adds the shared reporting-scope foundation (owner decisions of 2026-11-17): the ReportScope of a requester (every role reports ONLY inside its own organizational scope), the report
// availability matrix and the scope checks every report endpoint and export of Module 38 must use. Report endpoints, the catalog and exports are Module 38's, not this module's.
export { ReportPeriodService, type ReportPeriodServiceDeps } from '../application/services/report-period-service';
export { REPORT_ERROR_MESSAGES } from '../application/services/report-error-messages';
export { resolveReportPeriod } from '../domain/services/report-period-resolver';
export { studentReportWindow, type StudentReportWindow } from '../domain/services/student-report-window';
export { addDays, firstDayOfMonth, firstDayOfPreviousMonth, startOfBusinessDay } from '../domain/services/business-calendar';
export { REPORT_PERIOD_KINDS, isReportPeriodKind, type ReportPeriodKind, type ReportPeriodRequest, type ResolvedReportPeriod } from '../domain/value-objects/report-period';
export { ReportErrorCodes, reportError, type ReportErrorCode } from '../domain/errors/report-errors';
export { ReportScopeResolver, authorizeRequestedIds, restrictToScope, type ReportRequester, type RequestedReportTargets, type ScopedReportTargets } from '../application/services/report-scope-resolver';
export type { ReportScopeSources } from '../application/ports/report-scope-sources';
export { GEOGRAPHIC_LEVELS, isEmptyScope, type GeographicLevel, type ReportScope, type ReportScopeDenialReason } from '../domain/value-objects/report-scope';
export { REPORT_TYPES, REPORT_AVAILABILITY, isReportType, isReportAvailableTo, type ReportType } from '../domain/value-objects/report-types';
export { PublicReportScopeSources, type PublicReportScopeSourcesDeps } from '../infrastructure/services/public-report-scope-sources';
