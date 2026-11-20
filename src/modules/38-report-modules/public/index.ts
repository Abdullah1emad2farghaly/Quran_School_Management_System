// Public contract of Module 38 (Report Modules). Slice 1: the PAYMENT and ATTENDANCE reports (JSON, CSV, Excel).
// Reports are read models over data owned by other modules (§102): this module owns no table. Every report is authorized by Module 37's reporting scope (never by a client-supplied id).
export { ReportService, type ReportServiceDeps } from '../application/services/report-service';
export type { PaymentReport, PaymentReportRow, PaymentReportTotals, PaymentReportRequest, ReportPeriodDto } from '../application/dto/payment-report';
export type { AttendanceCounts, AttendanceReport, AttendanceReportRequest, AttendanceReportRow, AttendanceSubjectType } from '../application/dto/attendance-report';
export type { PaymentReportSources } from '../application/ports/payment-report-sources';
export type { AttendanceReportSources } from '../application/ports/attendance-report-sources';
export { attendanceReportTable, paymentReportTable, type ReportTable, type ReportLanguage } from '../application/services/report-tables';
export { PublicPaymentReportSources, type PublicPaymentReportSourcesDeps } from '../infrastructure/services/public-payment-report-sources';
export { PublicAttendanceReportSources, type PublicAttendanceReportSourcesDeps } from '../infrastructure/services/public-attendance-report-sources';
export { buildCsv } from '../infrastructure/exports/csv-exporter';
export { buildXlsx } from '../infrastructure/exports/xlsx-exporter';
export { createReportRouter, type ReportRouterDeps } from '../presentation/http/report-routes';
export { reportApiDoc } from '../presentation/http/report.openapi';
