import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCsv, buildXlsxWorkbook, parentReportCsvTable, parentReportTables, type ParentReport, type StudentReport } from '../../../src/modules/38-report-modules/public';

const NONE = { count: 0, average: null };
const ZERO = { MEMORIZATION: NONE, REVISION: NONE, PERFORMANCE: NONE, TAJWEED: NONE };
const period = { kind: 'THIS_MONTH' as const, startDate: '2026-11-01', endDate: '2026-11-18' };
const child = (id: string, name: string, over: Partial<StudentReport['sections']> = {}): StudentReport => ({
  type: 'STUDENT', period, generatedAt: '2026-11-18T10:00:00.000Z',
  student: { id, name, schoolId: 'sc1', schoolName: 'مدرسة النور', joinDate: '2026-09-15' }, effectiveStartDate: '2026-11-01',
  sections: {
    attendance: { rows: [{ groupId: 'g1', groupName: 'حلقة الفجر', present: 3, absent: 1, total: 4 }], totals: { present: 3, absent: 1, total: 4 } },
    memorization: { rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } },
    revision: { rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } },
    evaluations: { rows: [], totals: { evaluations: 0, scores: ZERO } },
    examResults: { counts: { examined: 0, absent: 0, total: 0 }, rows: [] },
    subscriptions: { statusAsOf: '2026-11-18T10:00:00.000Z', rows: [{ month: '2026-11', status: 'UNPAID' }], totals: { paid: 0, unpaid: 1, waived: 0, total: 1 } },
    groupHistory: { rows: [{ groupId: 'g1', groupName: 'حلقة الفجر', from: '2026-11-01', to: '2026-11-18', current: true }] },
    ...over,
  },
});
const exam = (id: string, date: string, scores: number[]) => ({ examId: id, examDate: date, startAt: `${date}T07:00:00.000Z`, groupId: 'g1', groupName: 'حلقة الفجر', outcome: 'EXAMINED' as const, questionCount: scores.length, maxScorePerQuestion: 10, scores, total: scores.reduce((a, b) => a + b, 0), maxTotal: scores.length * 10 });
const ahmed = child('c1', 'أحمد محمد علي', { examResults: { counts: { examined: 1, absent: 0, total: 1 }, rows: [exam('e1', '2026-11-02', [9, 8])] } });
const bilal = child('c2', 'بلال محمد علي', { examResults: { counts: { examined: 1, absent: 0, total: 1 }, rows: [exam('e2', '2026-11-03', [5, 6, 7, 8])] } });
const manager: ParentReport = { type: 'PARENT', period, generatedAt: '2026-11-18T10:00:00.000Z', parent: { id: 'p1', name: 'محمد علي حسن', children: [{ id: 'c1', name: 'أحمد محمد علي' }, { id: 'c2', name: 'بلال محمد علي' }] }, childReports: [ahmed, bilal] };
const { subscriptions: _a, ...ahmedSections } = ahmed.sections;
const { subscriptions: _b, ...bilalSections } = bilal.sections;
void _a;
void _b;
const parentView: ParentReport = { ...manager, childReports: [{ ...ahmed, sections: ahmedSections }, { ...bilal, sections: bilalSections }] };
const empty: ParentReport = { ...manager, parent: { ...manager.parent, children: [] }, childReports: [] };

describe('PARENT report: Excel worksheets (the STUDENT sheets with the rows of every child)', () => {
  it('a manager gets up to seven worksheets, a Parent gets no subscription sheet', () => {
    expect(parentReportTables(manager, 'en').map((t) => t.sheetName)).toEqual(['Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exam results', 'Subscriptions', 'Group history']);
    expect(parentReportTables(parentView, 'en').map((t) => t.sheetName)).toEqual(['Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exam results', 'Group history']);
    expect(parentReportTables(manager, 'ar').map((t) => t.sheetName)).toEqual(['الحضور', 'الحفظ', 'المراجعة', 'التقييمات', 'الاختبارات', 'الاشتراكات', 'تاريخ الحلقات']);
  });

  it('every sheet holds the rows of EVERY child, the first column says whose, and each totals row names its child', () => {
    const attendance = parentReportTables(manager, 'en').find((t) => t.sheetName === 'Attendance')!;
    expect(attendance.headers[0]).toBe('Student');
    expect(attendance.rows).toEqual([
      ['أحمد محمد علي', 'حلقة الفجر', 3, 1, 4],
      ['Total (أحمد محمد علي)', '', 3, 1, 4],
      ['بلال محمد علي', 'حلقة الفجر', 3, 1, 4],
      ['Total (بلال محمد علي)', '', 3, 1, 4],
    ]);
    const history = parentReportTables(manager, 'en').find((t) => t.sheetName === 'Group history')!;
    expect(history.rows.map((r) => r[0])).toEqual(['أحمد محمد علي', 'بلال محمد علي']);
  });

  it('the exam sheet has as many question columns as the child with the most questions, so the columns line up', () => {
    const sheet = parentReportTables(manager, 'en').find((t) => t.sheetName === 'Exam results')!;
    expect(sheet.headers.filter((h) => h.startsWith('Question '))).toEqual(['Question 1', 'Question 2', 'Question 3', 'Question 4']);
    for (const row of sheet.rows) expect(row).toHaveLength(sheet.headers.length);
    expect(sheet.rows[0]).toEqual(['أحمد محمد علي', '2026-11-02', 'حلقة الفجر', 'Examined', 2, 10, 9, 8, '', '', 17, 20]);
    expect(sheet.rows[2]).toEqual(['بلال محمد علي', '2026-11-03', 'حلقة الفجر', 'Examined', 4, 10, 5, 6, 7, 8, 26, 40]);
    expect(String(sheet.rows[1]![0])).toBe('Exams (أحمد محمد علي)');
  });

  it('a Parent with no child gets the sheets with their headers and no rows (no subscription sheet)', () => {
    const tables = parentReportTables(empty, 'en');
    expect(tables.map((t) => t.sheetName)).toEqual(['Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exam results', 'Group history']);
    for (const table of tables) {
      expect(table.headers.length).toBeGreaterThan(0);
      expect(table.rows).toEqual([]);
    }
  });

  it('writes a real workbook with one sheet per table', async () => {
    const wb = new Workbook();
    await wb.xlsx.load((await buildXlsxWorkbook(parentReportTables(manager, 'ar'), 'ar')) as never);
    expect(wb.worksheets).toHaveLength(7);
    expect(wb.worksheets[0]!.rowCount).toBe(5); // header + 2 children x (row + totals)
  });
});

describe('PARENT report: CSV (one combined table, a short Parent section first)', () => {
  it('has the STUDENT columns; the Parent section is first and lists the name and every child', () => {
    const table = parentReportCsvTable(manager, 'en');
    expect(table.headers).toEqual(['Section', 'Student', 'Group', 'Item', 'Measure', 'Value']);
    for (const row of table.rows) expect(row).toHaveLength(6);
    expect(table.rows.slice(0, 3)).toEqual([
      ['Parent', '', '', '', 'Parent name', 'محمد علي حسن'],
      ['Parent', '', '', '', 'Child', 'أحمد محمد علي'],
      ['Parent', '', '', '', 'Child', 'بلال محمد علي'],
    ]);
  });

  it('then every child\'s rows, told apart by the student column; a Parent file has no subscription rows', () => {
    const rows = parentReportCsvTable(manager, 'en').rows;
    expect([...new Set(rows.filter((r) => r[0] !== 'Parent').map((r) => r[1]))]).toEqual(['أحمد محمد علي', 'بلال محمد علي']);
    expect(rows.some((r) => r[0] === 'Subscriptions')).toBe(true);
    expect(parentReportCsvTable(parentView, 'en').rows.some((r) => r[0] === 'Subscriptions')).toBe(false);
    expect(parentReportCsvTable(empty, 'en').rows.map((r) => r[0])).toEqual(['Parent']);
  });

  it('serializes to CSV and neutralizes a formula in the Parent name', () => {
    const evil: ParentReport = { ...manager, parent: { ...manager.parent, name: '=HYPERLINK("http://evil","x")' } };
    const csv = buildCsv(parentReportCsvTable(evil, 'ar')).toString('utf8');
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain('ولي الأمر');
  });
});
