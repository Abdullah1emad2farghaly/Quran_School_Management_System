// Public contract of Module 38 (Report Modules). Slices 1-8: the PAYMENT, ATTENDANCE, MEMORIZATION, REVISION, EVALUATION, STUDENT, PARENT, GROUP and TEACHER reports (JSON, CSV, Excel).
// Reports are read models over data owned by other modules (§102): this module owns no table. Every report is authorized by Module 37's reporting scope (never by a client-supplied id).
export { ReportService, type ReportServiceDeps } from '../application/services/report-service';
export type { PaymentReport, PaymentReportRow, PaymentReportTotals, PaymentReportRequest, ReportPeriodDto } from '../application/dto/payment-report';
export type { AttendanceCounts, AttendanceReport, AttendanceReportRequest, AttendanceReportRow, AttendanceSubjectType } from '../application/dto/attendance-report';
export type { MemorizationCounts, MemorizationReport, MemorizationReportRequest, MemorizationReportRow } from '../application/dto/memorization-report';
export type { RevisionCounts, RevisionReport, RevisionReportRequest, RevisionReportRow } from '../application/dto/revision-report';
export type { EvaluationCategoryScores, EvaluationCategoryStats, EvaluationReport, EvaluationReportRequest, EvaluationReportRow, EvaluationReportTotals } from '../application/dto/evaluation-report';
export type {
  StudentAttendanceRow, StudentAttendanceSection, StudentEvaluationRow, StudentEvaluationSection, StudentExamCounts, StudentExamResultRow, StudentExamResultsSection, StudentGroupHistoryRow, StudentRecordsRow,
  StudentRecordsSection, StudentReport, StudentReportRequest, StudentReportSections, StudentReportStudent, StudentSubscriptionRow, StudentSubscriptionsSection,
} from '../application/dto/student-report';
export type { TeacherReport, TeacherReportRequest, TeacherReportSchool, TeacherReportTeacher, TeacherTaughtGroup } from '../application/dto/teacher-report';
export type { TeacherReportSources } from '../application/ports/teacher-report-sources';
export type { GroupEvaluationFigures, GroupReport, GroupReportGroup, GroupReportRequest, GroupReportTotals, GroupStudentRow } from '../application/dto/group-report';
export type { GroupReportSources } from '../application/ports/group-report-sources';
export type { ParentReport, ParentReportChildRef, ParentReportParent, ParentReportRequest } from '../application/dto/parent-report';
export type { ParentReportSources } from '../application/ports/parent-report-sources';
export type { StudentReportSources } from '../application/ports/student-report-sources';
export type { StudentReportPageMeta } from '../application/services/student-report-builder';
export type { PaymentReportSources } from '../application/ports/payment-report-sources';
export type { AttendanceReportSources } from '../application/ports/attendance-report-sources';
export type { MemorizationReportSources } from '../application/ports/memorization-report-sources';
export type { RevisionReportSources } from '../application/ports/revision-report-sources';
export type { EvaluationReportSources } from '../application/ports/evaluation-report-sources';
export { attendanceReportTable, evaluationReportTable, memorizationReportTable, paymentReportTable, revisionReportTable, groupReportCsvTable, groupReportTables, teacherReportCsvTable, teacherReportTables, parentReportCsvTable, parentReportTables, studentReportCsvTable, studentReportTables, type ReportTable, type ReportLanguage } from '../application/services/report-tables';
export { PublicPaymentReportSources, type PublicPaymentReportSourcesDeps } from '../infrastructure/services/public-payment-report-sources';
export { PublicAttendanceReportSources, type PublicAttendanceReportSourcesDeps } from '../infrastructure/services/public-attendance-report-sources';
export { PublicMemorizationReportSources, type PublicMemorizationReportSourcesDeps } from '../infrastructure/services/public-memorization-report-sources';
export { PublicRevisionReportSources, type PublicRevisionReportSourcesDeps } from '../infrastructure/services/public-revision-report-sources';
export { PublicEvaluationReportSources, type PublicEvaluationReportSourcesDeps } from '../infrastructure/services/public-evaluation-report-sources';
export { PublicTeacherReportSources, type PublicTeacherReportSourcesDeps } from '../infrastructure/services/public-teacher-report-sources';
export { PublicGroupReportSources, type PublicGroupReportSourcesDeps } from '../infrastructure/services/public-group-report-sources';
export { PublicParentReportSources, type PublicParentReportSourcesDeps } from '../infrastructure/services/public-parent-report-sources';
export { PublicStudentReportSources, type PublicStudentReportSourcesDeps } from '../infrastructure/services/public-student-report-sources';
export { averageOf } from '../application/services/evaluation-stats';
export { buildCsv } from '../infrastructure/exports/csv-exporter';
export { buildXlsx, buildXlsxWorkbook } from '../infrastructure/exports/xlsx-exporter';
export { createReportRouter, type ReportRouterDeps } from '../presentation/http/report-routes';
export { reportApiDoc } from '../presentation/http/report.openapi';
