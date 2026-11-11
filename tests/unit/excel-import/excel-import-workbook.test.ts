import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ExcelJsWorkbookReader, ExcelJsWorkbookWriter, IMPORT_COLUMNS, cellText, recognizeHeaders, toRawCell } from '../../../src/modules/36-excel-import/public';
import { ImportErrorCodes } from '../../../src/modules/36-excel-import/public';

// These tests use the REAL ExcelJS library (installed by `npm install`): they build and read genuine .xlsx files.

async function sheetOf(buffer: Buffer, index = 0) {
  const wb = new Workbook();
  await wb.xlsx.load(buffer as never);
  return wb.worksheets[index]!;
}

describe('the downloadable templates', () => {
  for (const language of ['ar', 'en'] as const) {
    it(`the ${language === 'ar' ? 'Arabic' : 'English'} template has every header in that language, an instructions sheet, text-formatted phone and ID columns and drop-downs`, async () => {
      const buffer = await new ExcelJsWorkbookWriter().buildTemplate(language);
      expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK'); // a real zip/xlsx
      const data = await sheetOf(buffer, 0);
      const headers = (data.getRow(1).values as unknown[]).slice(1).map((v) => cellText(toRawCell(v)));
      expect(headers).toHaveLength(IMPORT_COLUMNS.length);
      IMPORT_COLUMNS.forEach((c, i) => expect(headers[i], c.key).toBe(`${c.header[language]}${c.required ? ' *' : ''}`));
      // the importer recognizes exactly what the template wrote
      const recognized = recognizeHeaders(headers);
      expect(recognized.missing).toEqual([]);
      expect(recognized.unknown).toEqual([]);
      expect(recognized.duplicated).toEqual([]);
      expect(data.getColumn(IMPORT_COLUMNS.findIndex((c) => c.key === 'studentNationalId') + 1).numFmt ?? data.getColumn(2).style.numFmt).toBe('@');
      expect(data.views[0]?.rightToLeft).toBe(language === 'ar');

      const help = await sheetOf(buffer, 1);
      const text: string[] = [];
      help.eachRow((row) => (row.values as unknown[]).forEach((v) => text.push(cellText(toRawCell(v)))));
      const joined = text.join('\n');
      expect(joined).toContain(IMPORT_COLUMNS[0]!.help[language]);
      expect(joined).toContain(IMPORT_COLUMNS[11]!.example[language]);
      if (language === 'ar') expect(joined).toContain('السبت');
      else expect(joined).toContain('SAT');
      // no example row on the data sheet: a template left as it is imports nothing
      expect(data.actualRowCount).toBe(1);
    });
  }
});

describe('the workbook reader', () => {
  const buildFile = async (rows: unknown[][]) => {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Sheet1');
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  };

  it('reads cells as primitives: text, numbers, formulas (their stored result, never evaluated), rich text and hyperlinks; empty rows are omitted', async () => {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['اسم', 'رقم']);
    ws.addRow(['عمر أحمد محمد', 30001010123456]);
    ws.addRow([]);
    ws.addRow([{ richText: [{ text: 'خالد ' }, { text: 'أحمد' }] }, { formula: '1+1', result: 2 }]);
    ws.addRow([{ text: 'رابط', hyperlink: 'https://example.com' }, null]);
    const sheet = await new ExcelJsWorkbookReader().read(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer));
    expect(sheet.rows.map((r) => r.rowNumber)).toEqual([1, 2, 4, 5]);
    expect(sheet.rows[1]!.cells).toEqual(['عمر أحمد محمد', 30001010123456]);
    expect(sheet.rows[2]!.cells).toEqual(['خالد أحمد', 2]);
    expect(sheet.rows[3]!.cells[0]).toBe('رابط');
  });

  it('keeps Arabic text and text-formatted numbers intact', async () => {
    const sheet = await new ExcelJsWorkbookReader().read(await buildFile([['٠١٠١٢٣٤٥٦٧٨', '01012345678', 'السبت 16:00-17:00؛ الاثنين 16:00-17:00']]));
    expect(sheet.rows[0]!.cells).toEqual(['٠١٠١٢٣٤٥٦٧٨', '01012345678', 'السبت 16:00-17:00؛ الاثنين 16:00-17:00']);
  });

  it('refuses bytes that are not a workbook', async () => {
    await expect(new ExcelJsWorkbookReader().read(Buffer.from('not an xlsx'))).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_FILE_UNREADABLE });
  });
});
