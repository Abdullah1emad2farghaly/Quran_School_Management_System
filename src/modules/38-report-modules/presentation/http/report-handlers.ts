import type { ReportRequester } from '../../../37-reports-core/public';
import type { AttendanceReportRequest } from '../../application/dto/attendance-report';
import type { PageRequest } from '../../../00-shared-kernel/public';
import type { MemorizationReportRequest } from '../../application/dto/memorization-report';
import type { EvaluationReportRequest } from '../../application/dto/evaluation-report';
import type { RevisionReportRequest } from '../../application/dto/revision-report';
import type { PaymentReportRequest } from '../../application/dto/payment-report';
import type { GroupReportRequest } from '../../application/dto/group-report';
import type { ParentReportRequest } from '../../application/dto/parent-report';
import type { TeacherReportRequest } from '../../application/dto/teacher-report';
import type { StudentReportRequest } from '../../application/dto/student-report';
import type { ReportService } from '../../application/services/report-service';
import { attendanceReportTable, evaluationReportTable, memorizationReportTable, paymentReportTable, revisionReportTable, groupReportCsvTable, groupReportTables, parentReportCsvTable, parentReportTables, teacherReportCsvTable, teacherReportTables, studentReportCsvTable, studentReportTables, type ReportLanguage, type ReportTable } from '../../application/services/report-tables';
import { buildCsv } from '../../infrastructure/exports/csv-exporter';
import { buildXlsx, buildXlsxWorkbook } from '../../infrastructure/exports/xlsx-exporter';

export type ReportHandlerService = Pick<ReportService, 'paymentReport' | 'attendanceReport' | 'memorizationReport' | 'memorizationReportPage' | 'revisionReport' | 'revisionReportPage' | 'evaluationReport' | 'evaluationReportPage' | 'studentReport' | 'studentReportPage' | 'parentReport' | 'parentReportPage' | 'groupReport' | 'groupReportPage' | 'teacherReport' | 'teacherReportPage'>;

export type ReportFileFormat = 'csv' | 'xlsx';

export interface ReportFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly data: Buffer;
}

export const CSV_MIME = 'text/csv; charset=utf-8';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function toFile(stem: string, table: ReportTable, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> {
  return format === 'csv'
    ? { fileName: `${stem}.csv`, contentType: CSV_MIME, data: buildCsv(table) }
    : { fileName: `${stem}.xlsx`, contentType: XLSX_MIME, data: await buildXlsx(table, language) };
}

/**
 * Framework-free handlers behind the report routes. A file is built from the SAME report the JSON endpoint returns (same authorization, same scope, same period), so an export
 * can never contain more than the report. The requester always comes from the verified session.
 */
export function createReportHandlers(getReports: () => ReportHandlerService) {
  return {
    payment: (requester: ReportRequester, request: PaymentReportRequest) => getReports().paymentReport(requester, request),

    paymentFile: async (requester: ReportRequester, request: PaymentReportRequest, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> => {
      const report = await getReports().paymentReport(requester, request);
      const table = paymentReportTable(report, language);
      const stem = `payment-report-${report.period.kind.toLowerCase().replace(/_/g, '-')}`;
      return toFile(stem, table, format, language);
    },

    attendance: (requester: ReportRequester, request: AttendanceReportRequest) => getReports().attendanceReport(requester, request),

    attendanceFile: async (requester: ReportRequester, request: AttendanceReportRequest, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> => {
      const report = await getReports().attendanceReport(requester, request);
      const table = attendanceReportTable(report, language);
      const stem = `attendance-report-${report.period.kind.toLowerCase().replace(/_/g, '-')}`;
      return toFile(stem, table, format, language);
    },

    memorization: (requester: ReportRequester, request: MemorizationReportRequest, page: PageRequest) => getReports().memorizationReportPage(requester, request, page),

    memorizationFile: async (requester: ReportRequester, request: MemorizationReportRequest, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> => {
      const report = await getReports().memorizationReport(requester, request);
      const table = memorizationReportTable(report, language);
      const stem = `memorization-report-${report.period.kind.toLowerCase().replace(/_/g, '-')}`;
      return toFile(stem, table, format, language);
    },

    revision: (requester: ReportRequester, request: RevisionReportRequest, page: PageRequest) => getReports().revisionReportPage(requester, request, page),

    revisionFile: async (requester: ReportRequester, request: RevisionReportRequest, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> => {
      const report = await getReports().revisionReport(requester, request);
      const table = revisionReportTable(report, language);
      const stem = `revision-report-${report.period.kind.toLowerCase().replace(/_/g, '-')}`;
      return toFile(stem, table, format, language);
    },

    evaluation: (requester: ReportRequester, request: EvaluationReportRequest, page: PageRequest) => getReports().evaluationReportPage(requester, request, page),

    evaluationFile: async (requester: ReportRequester, request: EvaluationReportRequest, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> => {
      const report = await getReports().evaluationReport(requester, request);
      const table = evaluationReportTable(report, language);
      const stem = `evaluation-report-${report.period.kind.toLowerCase().replace(/_/g, '-')}`;
      return toFile(stem, table, format, language);
    },
    student: (requester: ReportRequester, request: StudentReportRequest, page: PageRequest) => getReports().studentReportPage(requester, request, page),

    /** The files hold the COMPLETE report (every exam): XLSX one worksheet per section the requester may see, CSV one combined table with a `section` column. */
    studentFile: async (requester: ReportRequester, request: StudentReportRequest, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> => {
      const report = await getReports().studentReport(requester, request);
      const stem = `student-report-${report.period.kind.toLowerCase().replace(/_/g, '-')}`;
      return format === 'csv'
        ? { fileName: `${stem}.csv`, contentType: CSV_MIME, data: buildCsv(studentReportCsvTable(report, language)) }
        : { fileName: `${stem}.xlsx`, contentType: XLSX_MIME, data: await buildXlsxWorkbook(studentReportTables(report, language), language) };
    },
    parent: (requester: ReportRequester, request: ParentReportRequest, page: PageRequest) => getReports().parentReportPage(requester, request, page),

    /** The files hold EVERY authorized child (not just a JSON page): XLSX the STUDENT report's worksheets with the rows of all children, CSV one table with a Parent section first. */
    parentFile: async (requester: ReportRequester, request: ParentReportRequest, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> => {
      const report = await getReports().parentReport(requester, request);
      const stem = `parent-report-${report.period.kind.toLowerCase().replace(/_/g, '-')}`;
      return format === 'csv'
        ? { fileName: `${stem}.csv`, contentType: CSV_MIME, data: buildCsv(parentReportCsvTable(report, language)) }
        : { fileName: `${stem}.xlsx`, contentType: XLSX_MIME, data: await buildXlsxWorkbook(parentReportTables(report, language), language) };
    },
    group: (requester: ReportRequester, request: GroupReportRequest, page: PageRequest) => getReports().groupReportPage(requester, request, page),

    /** The files hold EVERY student of the roster (not just a JSON page): XLSX one worksheet per section, CSV one table with a Group section first. */
    groupFile: async (requester: ReportRequester, request: GroupReportRequest, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> => {
      const report = await getReports().groupReport(requester, request);
      const stem = `group-report-${report.period.kind.toLowerCase().replace(/_/g, '-')}`;
      return format === 'csv'
        ? { fileName: `${stem}.csv`, contentType: CSV_MIME, data: buildCsv(groupReportCsvTable(report, language)) }
        : { fileName: `${stem}.xlsx`, contentType: XLSX_MIME, data: await buildXlsxWorkbook(groupReportTables(report, language), language) };
    },
    teacher: (requester: ReportRequester, request: TeacherReportRequest, page: PageRequest) => getReports().teacherReportPage(requester, request, page),

    /** The files hold EVERY stint of the authorized schools (not just a JSON page): XLSX one worksheet per section, CSV one table with a Teacher section first. */
    teacherFile: async (requester: ReportRequester, request: TeacherReportRequest, format: ReportFileFormat, language: ReportLanguage): Promise<ReportFile> => {
      const report = await getReports().teacherReport(requester, request);
      const stem = `teacher-report-${report.period.kind.toLowerCase().replace(/_/g, '-')}`;
      return format === 'csv'
        ? { fileName: `${stem}.csv`, contentType: CSV_MIME, data: buildCsv(teacherReportCsvTable(report, language)) }
        : { fileName: `${stem}.xlsx`, contentType: XLSX_MIME, data: await buildXlsxWorkbook(teacherReportTables(report, language), language) };
    },
  };
}
