// Public contract of Module 36 (Excel Import): the Arabic/English template, the analyze-only preview (kept 24 hours), and the all-or-nothing
// confirmation that writes ONLY through the public services of Parents 17, Teachers 18, Students 19, Groups 20 and Group Schedules 23.
// Other modules do not depend on it. Its permissions are registered through the Module 12 engine (SCHOOL_MANAGER only, own school).
export { ExcelImportService, PREVIEW_TTL_MS, type ExcelImportServiceDeps, type CreatePreviewInput, type ImportPreviewLookup } from '../application/services/excel-import-service';
export { analyzeImport, makeIssue, type AnalyzeInput, type AnalyzeResult } from '../application/services/import-analyzer';
export { ImportPermissions, IMPORT_PREVIEW_TARGET_TYPE, registerImportAuthorization, type ImportAuthorizationDeps } from '../application/services/import-authorization';
export { IMPORT_ERROR_MESSAGES } from '../application/services/import-error-messages';
export { toPreviewDto, type ImportPreviewDto, type ImportRowsPage } from '../application/dto/import-dto';
export type { ImportDirectory } from '../application/ports/import-directory';
export type { ImportPreviewRepository } from '../application/ports/import-preview-repository';
export type { WorkbookReader, WorkbookWriter, SheetData } from '../application/ports/workbook';
export type { ImportIssue, IssueSeverity, AnalyzedRow, PreviewSummary, PreviewAnalysis, PlannedRow, ParsedImportRow, ImportPreviewRecord, ImportResultSummary, PreviewStatus, RowStatus, EntityDecision } from '../domain/entities/import-types';
export { ImportErrorCodes, ImportIssueCodes, importError, importErrorKind, type ImportErrorCode, type ImportIssueCode } from '../domain/errors/import-errors';
export { IMPORT_COLUMNS, IMPORT_COLUMN_KEYS, IMPORT_LANGUAGES, COLUMN_BY_KEY, recognizeHeader, recognizeHeaders, isImportLanguage, type ImportColumn, type ImportColumnKey, type ImportLanguage } from '../domain/value-objects/import-columns';
export { parseScheduleCell, describeSlots, DAY_LABELS, type ParsedScheduleSlot, type ScheduleProblem } from '../domain/value-objects/schedule-cell';
export { parseLearningMode, parseProgression, parseStartingSurah } from '../domain/value-objects/option-values';
export { cellText, toLatinDigits, foldWord, type RawCell } from '../domain/value-objects/cell-text';
export { createServiceImportDirectory, type ServiceImportDirectoryDeps } from '../infrastructure/services/service-import-directory';
export { InMemoryImportPreviewRepository } from '../infrastructure/services/in-memory-import-preview-repository';
export { ExcelJsWorkbookReader, toRawCell } from '../infrastructure/services/exceljs-workbook-reader';
export { ExcelJsWorkbookWriter } from '../infrastructure/services/exceljs-workbook-writer';
export { SequelizeImportPreviewRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-import-preview-repository';
export { createExcelImportRouter, type ImportRouterDeps } from '../presentation/http/import-routes';
export { excelImportApiDoc } from '../presentation/http/import.openapi';
