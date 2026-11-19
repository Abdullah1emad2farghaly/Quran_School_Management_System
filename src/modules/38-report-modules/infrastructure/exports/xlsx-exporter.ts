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
