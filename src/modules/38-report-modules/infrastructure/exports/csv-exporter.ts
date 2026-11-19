import type { ReportTable } from '../../application/services/report-tables';

/** A cell that starts with one of these is read as a formula by spreadsheet programs; a school name is user-entered text, so it is made harmless (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

const cell = (value: string | number): string => {
  const text = typeof value === 'number' ? String(value) : FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** UTF-8 CSV with a byte order mark (so Excel reads Arabic correctly) and CRLF line ends. */
export function buildCsv(table: ReportTable): Buffer {
  const lines = [table.headers, ...table.rows].map((row) => row.map(cell).join(','));
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}
