import type { AnalyzedRow, ImportIssue, ImportPreviewRecord, ImportResultSummary, PreviewStatus, PreviewSummary } from '../../domain/entities/import-types';
import type { ImportLanguage } from '../../domain/value-objects/import-columns';

export interface ImportPreviewDto {
  readonly id: string;
  readonly schoolId: string;
  readonly status: PreviewStatus;
  readonly language: ImportLanguage;
  readonly fileName: string;
  /** True only while the preview is PENDING, not expired, and has no error and no conflict (all-or-nothing). */
  readonly canConfirm: boolean;
  /** Errors + conflicts. Warnings never block. */
  readonly blocking: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly summary: PreviewSummary;
  /** Every finding of the file, each with its Arabic and English message. Empty once the preview is no longer pending (the personal data is removed). */
  readonly issues: readonly ImportIssue[];
  readonly rows: { readonly items: readonly AnalyzedRow[]; readonly page: number; readonly pageSize: number; readonly total: number };
  readonly result: ImportResultSummary | null;
}

export interface ImportRowsPage {
  readonly page: number;
  readonly pageSize: number;
}
export const DEFAULT_ROWS_PAGE: ImportRowsPage = { page: 1, pageSize: 100 };
export const MAX_ROWS_PAGE_SIZE = 500;

export function toPreviewDto(record: ImportPreviewRecord, paging: ImportRowsPage = DEFAULT_ROWS_PAGE, now: Date = new Date()): ImportPreviewDto {
  const rows = record.analysis?.rows ?? [];
  const start = (paging.page - 1) * paging.pageSize;
  return {
    id: record.id,
    schoolId: record.schoolId,
    status: record.status,
    language: record.language,
    fileName: record.originalName,
    canConfirm: record.status === 'PENDING' && record.canConfirm && record.expiresAt.getTime() > now.getTime(),
    blocking: record.blocking,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    summary: record.summary,
    issues: record.analysis?.issues ?? [],
    rows: { items: rows.slice(start, start + paging.pageSize), page: paging.page, pageSize: paging.pageSize, total: rows.length },
    result: record.result,
  };
}
