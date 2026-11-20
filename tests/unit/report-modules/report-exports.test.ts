import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCsv, buildXlsx, paymentReportTable, type PaymentReport } from '../../../src/modules/38-report-modules/public';

const report: PaymentReport = {
  type: 'PAYMENT',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  rows: [
    { schoolId: 's1', schoolName: 'مدرسة النور', month: '2026-11', paid: 12, unpaid: 3, waived: 1, subscriptions: 16, paymentsRecorded: 12, paymentsReversed: 1 },
    { schoolId: 's2', schoolName: '=HYPERLINK("http://evil","x"),"quoted"', month: '2026-11', paid: 0, unpaid: 0, waived: 0, subscriptions: 0, paymentsRecorded: 0, paymentsReversed: 0 },
    { schoolId: 's3', schoolName: null, month: '2026-10', paid: 1, unpaid: 0, waived: 0, subscriptions: 1, paymentsRecorded: 1, paymentsReversed: 0 },
  ],
  totals: { paid: 13, unpaid: 3, waived: 1, subscriptions: 17, paymentsRecorded: 13, paymentsReversed: 1 },
};

describe('the report table', () => {
  it('has localized headers, one row per report row and a total row; an unnamed school shows its id', () => {
    const ar = paymentReportTable(report, 'ar');
    const en = paymentReportTable(report, 'en');
    expect(ar.headers[0]).toBe('المدرسة');
    expect(en.headers[0]).toBe('School');
    expect(en.rows).toHaveLength(4);
    expect(en.rows[2]![0]).toBe('s3');
    expect(en.rows[3]).toEqual(['Total', '', 13, 3, 1, 17, 13, 1]);
    expect(ar.rows[3]![0]).toBe('الإجمالي');
  });
});

describe('CSV export', () => {
  const csv = buildCsv(paymentReportTable(report, 'en')).toString('utf8');

  it('starts with a byte order mark (Excel reads Arabic) and uses CRLF line ends', () => {
    expect(csv.startsWith('\uFEFFSchool,Month,Paid,Unpaid,Waived,Subscriptions,Payments recorded,Payments reversed\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('مدرسة النور,2026-11,12,3,1,16,12,1');
  });

  it('neutralizes a formula and escapes quotes and commas in user-entered text', () => {
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"",""x""),""quoted"""');
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe('Excel export', () => {
  it('writes one worksheet with a bold header row, the data and the total; Arabic reads right to left, English left to right', async () => {
    const ar = new Workbook();
    await ar.xlsx.load(await buildXlsx(paymentReportTable(report, 'ar'), 'ar') as never);
    const sheet = ar.worksheets[0]!;
    expect(ar.worksheets).toHaveLength(1);
    expect(sheet.name).toBe('تقرير المدفوعات');
    expect(sheet.getRow(1).getCell(1).value).toBe('المدرسة');
    expect(sheet.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(sheet.getRow(2).getCell(1).value).toBe('مدرسة النور');
    expect(sheet.getRow(2).getCell(3).value).toBe(12);
    expect(sheet.getRow(5).getCell(1).value).toBe('الإجمالي');
    expect(sheet.views[0]).toMatchObject({ rightToLeft: true });

    const en = new Workbook();
    await en.xlsx.load(await buildXlsx(paymentReportTable(report, 'en'), 'en') as never);
    expect(en.worksheets[0]!.views[0]?.rightToLeft ?? false).toBe(false);
  });

  it('writes user-entered text as text, never as a formula', async () => {
    const wb = new Workbook();
    await wb.xlsx.load(await buildXlsx(paymentReportTable(report, 'en'), 'en') as never);
    const cell = wb.worksheets[0]!.getRow(3).getCell(1);
    expect(typeof cell.value).toBe('string');
    expect(cell.formula).toBeUndefined();
  });
});
