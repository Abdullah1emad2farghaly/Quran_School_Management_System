import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCsv, buildXlsx, evaluationReportTable, memorizationReportTable, paymentReportTable, revisionReportTable, type EvaluationReport, type MemorizationReport, type PaymentReport, type RevisionReport } from '../../../src/modules/38-report-modules/public';

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

describe('the memorization report table', () => {
  const memorization: MemorizationReport = {
    type: 'MEMORIZATION',
    period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
    generatedAt: '2026-11-18T10:00:00.000Z',
    rows: [
      { studentId: 'st1', studentName: 'أحمد محمد علي', schoolId: 's1', schoolName: 'مدرسة النور', groupId: 'g1', groupName: 'حلقة الفجر', records: 20, fulfilled: 14, notFulfilled: 4, unscheduled: 2 },
      { studentId: 'st2', studentName: null, schoolId: 's1', schoolName: null, groupId: 'g2', groupName: null, records: 1, fulfilled: 0, notFulfilled: 0, unscheduled: 1 },
    ],
    totals: { records: 21, fulfilled: 14, notFulfilled: 4, unscheduled: 3 },
  };

  it('has localized headers, one row per report row and a total row; an unnamed student, group or school shows its id', () => {
    const ar = memorizationReportTable(memorization, 'ar');
    const en = memorizationReportTable(memorization, 'en');
    expect(ar.headers[0]).toBe('المدرسة');
    expect(en.headers).toEqual(['School', 'Group', 'Student', 'Records', 'Matched the assignment', 'Did not match the assignment', 'No assignment']);
    expect(en.rows).toHaveLength(3);
    expect(en.rows[0]).toEqual(['مدرسة النور', 'حلقة الفجر', 'أحمد محمد علي', 20, 14, 4, 2]);
    expect(en.rows[1]).toEqual(['s1', 'g2', 'st2', 1, 0, 0, 1]);
    expect(en.rows[2]).toEqual(['Total', '', '', 21, 14, 4, 3]);
    expect(ar.rows[2]![0]).toBe('الإجمالي');
  });

  it('exports to CSV and Excel through the same table', async () => {
    const csv = buildCsv(memorizationReportTable(memorization, 'en')).toString('utf8');
    expect(csv.startsWith('\uFEFFSchool,Group,Student,Records,Matched the assignment,Did not match the assignment,No assignment\r\n')).toBe(true);
    expect(csv).toContain('مدرسة النور,حلقة الفجر,أحمد محمد علي,20,14,4,2');
    const workbook = new Workbook();
    await workbook.xlsx.load((await buildXlsx(memorizationReportTable(memorization, 'ar'), 'ar')) as never);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.name).toBe('تقرير الحفظ');
    expect(sheet.getRow(1).getCell(1).value).toBe('المدرسة');
    expect(sheet.getRow(2).getCell(4).value).toBe(20);
  });
});

describe('the revision report table', () => {
  const revision: RevisionReport = {
    type: 'REVISION',
    period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
    generatedAt: '2026-11-18T10:00:00.000Z',
    rows: [
      { studentId: 'st1', studentName: 'أحمد محمد علي', schoolId: 's1', schoolName: 'مدرسة النور', groupId: 'g1', groupName: 'حلقة الفجر', records: 20, fulfilled: 14, notFulfilled: 4, unscheduled: 2 },
      { studentId: 'st2', studentName: null, schoolId: 's1', schoolName: null, groupId: 'g2', groupName: null, records: 1, fulfilled: 0, notFulfilled: 0, unscheduled: 1 },
    ],
    totals: { records: 21, fulfilled: 14, notFulfilled: 4, unscheduled: 3 },
  };

  it('has localized headers, one row per report row and a total row; an unnamed student, group or school shows its id', () => {
    const ar = revisionReportTable(revision, 'ar');
    const en = revisionReportTable(revision, 'en');
    expect(ar.headers[0]).toBe('المدرسة');
    expect(en.headers).toEqual(['School', 'Group', 'Student', 'Records', 'Matched the assignment', 'Did not match the assignment', 'No assignment']);
    expect(en.rows).toHaveLength(3);
    expect(en.rows[0]).toEqual(['مدرسة النور', 'حلقة الفجر', 'أحمد محمد علي', 20, 14, 4, 2]);
    expect(en.rows[1]).toEqual(['s1', 'g2', 'st2', 1, 0, 0, 1]);
    expect(en.rows[2]).toEqual(['Total', '', '', 21, 14, 4, 3]);
    expect(ar.rows[2]![0]).toBe('الإجمالي');
  });

  it('exports to CSV and Excel through the same table', async () => {
    const csv = buildCsv(revisionReportTable(revision, 'en')).toString('utf8');
    expect(csv.startsWith('\uFEFFSchool,Group,Student,Records,Matched the assignment,Did not match the assignment,No assignment\r\n')).toBe(true);
    expect(csv).toContain('مدرسة النور,حلقة الفجر,أحمد محمد علي,20,14,4,2');
    const workbook = new Workbook();
    await workbook.xlsx.load((await buildXlsx(revisionReportTable(revision, 'ar'), 'ar')) as never);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.name).toBe('تقرير المراجعة');
    expect(sheet.getRow(1).getCell(1).value).toBe('المدرسة');
    expect(sheet.getRow(2).getCell(4).value).toBe(20);
  });
});

describe('the evaluation report table', () => {
  const stats = (count: number, average: number | null) => ({ count, average });
  const evaluation: EvaluationReport = {
    type: 'EVALUATION',
    period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
    generatedAt: '2026-11-18T10:00:00.000Z',
    rows: [
      { studentId: 'st1', studentName: 'أحمد محمد علي', schoolId: 's1', schoolName: 'مدرسة النور', groupId: 'g1', groupName: 'حلقة الفجر', evaluations: 12, scores: { MEMORIZATION: stats(12, 8.25), REVISION: stats(10, 7.5), PERFORMANCE: stats(12, 9), TAJWEED: stats(0, null) } },
      { studentId: 'st2', studentName: null, schoolId: 's1', schoolName: null, groupId: 'g2', groupName: null, evaluations: 1, scores: { MEMORIZATION: stats(1, 4), REVISION: stats(0, null), PERFORMANCE: stats(0, null), TAJWEED: stats(0, null) } },
    ],
    totals: { evaluations: 13, scores: { MEMORIZATION: stats(13, 7.96), REVISION: stats(10, 7.5), PERFORMANCE: stats(12, 9), TAJWEED: stats(0, null) } },
  };

  it('has localized headers, one row per report row and a total row; no score shows an empty cell, never a zero; an unnamed student, group or school shows its id', () => {
    const ar = evaluationReportTable(evaluation, 'ar');
    const en = evaluationReportTable(evaluation, 'en');
    expect(ar.headers[0]).toBe('المدرسة');
    expect(en.headers).toHaveLength(12);
    expect(en.headers.slice(0, 5)).toEqual(['School', 'Group', 'Student', 'Evaluations', 'Memorization (scores)']);
    expect(en.rows).toHaveLength(3);
    expect(en.rows[0]).toEqual(['مدرسة النور', 'حلقة الفجر', 'أحمد محمد علي', 12, 12, 8.25, 10, 7.5, 12, 9, 0, '']);
    expect(en.rows[1]).toEqual(['s1', 'g2', 'st2', 1, 1, 4, 0, '', 0, '', 0, '']);
    expect(en.rows[2]).toEqual(['Total', '', '', 13, 13, 7.96, 10, 7.5, 12, 9, 0, '']);
    expect(ar.rows[2]![0]).toBe('الإجمالي');
    for (const r of en.rows) expect(r).toHaveLength(en.headers.length);
  });

  it('exports to CSV and Excel through the same table', async () => {
    const csv = buildCsv(evaluationReportTable(evaluation, 'en')).toString('utf8');
    expect(csv.startsWith('\uFEFFSchool,Group,Student,Evaluations,Memorization (scores),')).toBe(true);
    expect(csv).toContain('مدرسة النور,حلقة الفجر,أحمد محمد علي,12,12,8.25,10,7.5,12,9,0,');
    const workbook = new Workbook();
    await workbook.xlsx.load((await buildXlsx(evaluationReportTable(evaluation, 'ar'), 'ar')) as never);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.name).toBe('تقرير التقييم');
    expect(sheet.getRow(1).getCell(1).value).toBe('المدرسة');
    expect(sheet.getRow(2).getCell(4).value).toBe(12);
    expect(sheet.getRow(2).getCell(6).value).toBe(8.25);
  });
});
