import type { RawCell } from '../../domain/value-objects/cell-text';
import type { ImportLanguage } from '../../domain/value-objects/import-columns';

/** What the importer needs from a workbook: the cells of ONE sheet as primitives. No spreadsheet library type crosses this port. */
export interface SheetData {
  /** Every non-empty row in order: its 1-based sheet row number and its cells (index 0 = column A). Fully empty rows are omitted. */
  readonly rows: readonly { readonly rowNumber: number; readonly cells: readonly RawCell[] }[];
}

export interface WorkbookReader {
  /** Reads the first worksheet of an .xlsx file. Formulas are read as their stored result and are never evaluated. Throws EXCEL_IMPORT_FILE_UNREADABLE. */
  read(data: Buffer): Promise<SheetData>;
}

export interface WorkbookWriter {
  /** The downloadable template: headers, one example row and an instructions sheet, all in the requested language. */
  buildTemplate(language: ImportLanguage): Promise<Buffer>;
}
