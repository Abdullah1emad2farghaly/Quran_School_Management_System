import type { ReportRequester } from '../../../37-reports-core/public';
import type { PaymentReportRequest } from '../../application/dto/payment-report';
import type { ReportService } from '../../application/services/report-service';
import { paymentReportTable, type ReportLanguage } from '../../application/services/report-tables';
import { buildCsv } from '../../infrastructure/exports/csv-exporter';
import { buildXlsx } from '../../infrastructure/exports/xlsx-exporter';

export type ReportHandlerService = Pick<ReportService, 'paymentReport'>;

export type ReportFileFormat = 'csv' | 'xlsx';

export interface ReportFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly data: Buffer;
}

export const CSV_MIME = 'text/csv; charset=utf-8';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
      return format === 'csv'
        ? { fileName: `${stem}.csv`, contentType: CSV_MIME, data: buildCsv(table) }
        : { fileName: `${stem}.xlsx`, contentType: XLSX_MIME, data: await buildXlsx(table, language) };
    },
  };
}
