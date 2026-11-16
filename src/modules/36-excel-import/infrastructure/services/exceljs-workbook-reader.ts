import { Workbook } from 'exceljs';
import { importError, ImportErrorCodes } from '../../domain/errors/import-errors';
import type { RawCell } from '../../domain/value-objects/cell-text';
import type { SheetData, WorkbookReader } from '../../application/ports/workbook';

/** Reduces whatever ExcelJS hands back for a cell to a primitive. Formulas are read as their stored result and are never evaluated. */
export function toRawCell(value: unknown): RawCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) return (v.richText as Array<{ text?: unknown }>).map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
    if ('result' in v) return toRawCell(v.result);
    if (typeof v.text === 'string') return v.text;
    if (typeof v.error === 'string') return v.error;
  }
  return null;
}

/** ExcelJS implementation of the workbook reader (Module 36's only dependency on the spreadsheet library for reading). */
export class ExcelJsWorkbookReader implements WorkbookReader {
  async read(data: Buffer): Promise<SheetData> {
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(data as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      throw importError(ImportErrorCodes.EXCEL_IMPORT_FILE_UNREADABLE);
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw importError(ImportErrorCodes.EXCEL_IMPORT_FILE_UNREADABLE);
    const rows: Array<{ rowNumber: number; cells: RawCell[] }> = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      // `row.values` is 1-based (index 0 is unused) and sparse; column A becomes index 0 here.
      const values = row.values as unknown[];
      const cells: RawCell[] = [];
      for (let i = 1; i < values.length; i++) cells.push(toRawCell(values[i]));
      if (cells.some((c) => c !== null && String(c).trim() !== '')) rows.push({ rowNumber, cells });
    });
    return { rows };
  }
}
