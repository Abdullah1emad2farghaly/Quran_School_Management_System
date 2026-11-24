import { Workbook } from 'exceljs';
import type { ReportLanguage, ReportTable } from '../../application/services/report-tables';

/** One worksheet: a bold header row, then the rows. Text cells are always written as TEXT (never as formulas). Arabic sheets read right to left. */
export async function buildXlsx(table: ReportTable, language: ReportLanguage): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(table.sheetName.slice(0, 31), { views: [{ rightToLeft: language === 'ar' }] });
  const header = sheet.addRow([...table.headers]);
  header.eachCell((cell) => {
    cell.font = { bold: true };
  });
  for (const row of table.rows) sheet.addRow([...row]);
  for (let i = 1; i <= table.headers.length; i += 1) sheet.getColumn(i).width = 20;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** A workbook with ONE worksheet per table (the STUDENT report: one per section the requester may see). Same rules as `buildXlsx`: bold headers, text cells as TEXT, Arabic sheets right to left. Sheet names are unique and at most 31 characters. */
export async function buildXlsxWorkbook(tables: readonly ReportTable[], language: ReportLanguage): Promise<Buffer> {
  const workbook = new Workbook();
  const used = new Set<string>();
  for (const table of tables) {
    let name = table.sheetName.slice(0, 31);
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${table.sheetName.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    const sheet = workbook.addWorksheet(name, { views: [{ rightToLeft: language === 'ar' }] });
    const header = sheet.addRow([...table.headers]);
    header.eachCell((cell) => {
      cell.font = { bold: true };
    });
    for (const row of table.rows) sheet.addRow([...row]);
    for (let i = 1; i <= table.headers.length; i += 1) sheet.getColumn(i).width = 20;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
