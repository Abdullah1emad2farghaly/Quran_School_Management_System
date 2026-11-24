import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCsv, buildXlsxWorkbook, studentReportCsvTable, studentReportTables, type StudentReport } from '../../../src/modules/38-report-modules/public';

const NONE = { count: 0, average: null };
const SCORES = { MEMORIZATION: { count: 2, average: 7.5 }, REVISION: NONE, PERFORMANCE: { count: 1, average: 9 }, TAJWEED: NONE };
const manager: StudentReport = {
  type: 'STUDENT',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  student: { id: 's1', name: 'أحمد محمد علي', schoolId: 'sc1', schoolName: 'مدرسة النور', joinDate: '2026-09-15' },
  effectiveStartDate: '2026-11-01',
  sections: {
    attendance: { rows: [{ groupId: 'g1', groupName: 'حلقة الفجر', present: 18, absent: 2, total: 20 }], totals: { present: 18, absent: 2, total: 20 } },
    memorization: { rows: [{ groupId: 'g1', groupName: 'حلقة الفجر', records: 20, fulfilled: 15, notFulfilled: 3, unscheduled: 2 }], totals: { records: 20, fulfilled: 15, notFulfilled: 3, unscheduled: 2 } },
    revision: { rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } },
    evaluations: { rows: [{ groupId: 'g1', groupName: 'حلقة الفجر', evaluations: 3, scores: SCORES }], totals: { evaluations: 3, scores: SCORES } },
    examResults: {
      counts: { examined: 2, absent: 1, total: 3 },
      rows: [
        { examId: 'e1', examDate: '2026-11-02', startAt: '2026-11-02T07:00:00.000Z', groupId: 'g1', groupName: 'حلقة الفجر', outcome: 'EXAMINED', questionCount: 3, maxScorePerQuestion: 10, scores: [9, 8.5, 10], total: 27.5, maxTotal: 30 },
        { examId: 'e2', examDate: '2026-11-09', startAt: '2026-11-09T07:00:00.000Z', groupId: 'g1', groupName: 'حلقة الفجر', outcome: 'ABSENT', questionCount: 2, maxScorePerQuestion: 10, scores: [], total: null, maxTotal: 20 },
        { examId: 'e3', examDate: '2026-11-12', startAt: '2026-11-12T07:00:00.000Z', groupId: 'g1', groupName: 'حلقة الفجر', outcome: 'EXAMINED', questionCount: 2, maxScorePerQuestion: 10, scores: [5, 6], total: 11, maxTotal: 20 },
      ],
    },
    subscriptions: { statusAsOf: '2026-11-18T10:00:00.000Z', rows: [{ month: '2026-11', status: 'UNPAID' }], totals: { paid: 0, unpaid: 1, waived: 0, total: 1 } },
    groupHistory: { rows: [{ groupId: 'g1', groupName: 'حلقة الفجر', from: '2026-11-01', to: '2026-11-18', current: true }] },
  },
};
const { subscriptions: _hidden, ...teacherSections } = manager.sections;
void _hidden;
const teacher: StudentReport = { ...manager, sections: teacherSections };

describe('STUDENT report: Excel worksheets (one per section the requester may see)', () => {
  it('a manager gets up to seven worksheets in a fixed order, a Teacher or Parent gets no subscription sheet', () => {
    expect(studentReportTables(manager, 'en').map((t) => t.sheetName)).toEqual(['Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exam results', 'Subscriptions', 'Group history']);
    expect(studentReportTables(manager, 'ar').map((t) => t.sheetName)).toEqual(['الحضور', 'الحفظ', 'المراجعة', 'التقييمات', 'الاختبارات', 'الاشتراكات', 'تاريخ الحلقات']);
    expect(studentReportTables(teacher, 'en').map((t) => t.sheetName)).toEqual(['Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exam results', 'Group history']);
  });

  it('every row has exactly as many cells as its sheet has headers; sheet names fit Excel (31 characters)', () => {
    for (const language of ['ar', 'en'] as const) {
      for (const table of studentReportTables(manager, language)) {
        expect(table.sheetName.length).toBeLessThanOrEqual(31);
        for (const row of table.rows) expect(row, `${table.sheetName}`).toHaveLength(table.headers.length);
      }
    }
  });

  it('exam sheet: the recorded scores in question columns, an absent exam without scores, the counts, and no sum across exams', () => {
    const sheet = studentReportTables(manager, 'en').find((t) => t.sheetName === 'Exam results')!;
    expect(sheet.headers).toEqual(['Student', 'Exam date', 'Group', 'Outcome', 'Questions', 'Maximum per question', 'Question 1', 'Question 2', 'Question 3', 'Recorded total', 'Maximum total']);
    expect(sheet.rows[0]).toEqual(['أحمد محمد علي', '2026-11-02', 'حلقة الفجر', 'Examined', 3, 10, 9, 8.5, 10, 27.5, 30]);
    expect(sheet.rows[1]).toEqual(['أحمد محمد علي', '2026-11-09', 'حلقة الفجر', 'Absent', 2, 10, '', '', '', '', 20]);
    expect(sheet.rows[2]).toEqual(['أحمد محمد علي', '2026-11-12', 'حلقة الفجر', 'Examined', 2, 10, 5, 6, '', 11, 20]);
    const counts = sheet.rows[3]!;
    expect(counts[3]).toBe('Examined: 2 / Absent: 1');
    expect(counts.slice(6)).toEqual(['', '', '', '', '']); // no total score is invented for the counts row
  });

  it('subscription sheet shows the month and the CURRENT status; evaluation averages are empty, never zero, when there is no score', () => {
    const tables = studentReportTables(manager, 'en');
    expect(tables.find((t) => t.sheetName === 'Subscriptions')!.headers).toEqual(['Student', 'Month', 'Status (current)']);
    expect(tables.find((t) => t.sheetName === 'Subscriptions')!.rows[0]).toEqual(['أحمد محمد علي', '2026-11', 'Unpaid']);
    const evaluations = tables.find((t) => t.sheetName === 'Evaluations')!;
    expect(evaluations.rows[0]).toEqual(['أحمد محمد علي', 'حلقة الفجر', 3, 2, 7.5, 0, '', 1, 9, 0, '']);
  });

  it('writes a real workbook: one sheet per table, Arabic right to left, student names as text never as a formula', async () => {
    const formulaName: StudentReport = { ...manager, student: { ...manager.student, name: '=HYPERLINK("http://evil","x")' } };
    const wb = new Workbook();
    await wb.xlsx.load((await buildXlsxWorkbook(studentReportTables(formulaName, 'ar'), 'ar')) as never);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['الحضور', 'الحفظ', 'المراجعة', 'التقييمات', 'الاختبارات', 'الاشتراكات', 'تاريخ الحلقات']);
    expect(wb.worksheets[0]!.views[0]).toMatchObject({ rightToLeft: true });
    expect(wb.worksheets[0]!.getRow(1).getCell(1).font?.bold).toBe(true);
    const cell = wb.worksheets[0]!.getRow(2).getCell(1);
    expect(typeof cell.value).toBe('string');
    expect(cell.formula).toBeUndefined();

    const en = new Workbook();
    await en.xlsx.load((await buildXlsxWorkbook(studentReportTables(teacher, 'en'), 'en')) as never);
    expect(en.worksheets).toHaveLength(6);
    expect(en.worksheets.some((s) => s.name === 'Subscriptions')).toBe(false);
  });

  it('keeps sheet names unique even if two tables share a name', async () => {
    const wb = new Workbook();
    const table = studentReportTables(manager, 'en')[0]!;
    await wb.xlsx.load((await buildXlsxWorkbook([table, table], 'en')) as never);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Attendance', 'Attendance 2']);
  });
});

describe('STUDENT report: CSV (one combined table with a section column)', () => {
  it('has the columns section, student, group, item, measure, value, and every row has six cells', () => {
    const table = studentReportCsvTable(manager, 'en');
    expect(table.headers).toEqual(['Section', 'Student', 'Group', 'Item', 'Measure', 'Value']);
    for (const row of table.rows) expect(row).toHaveLength(6);
    expect(studentReportCsvTable(manager, 'ar').headers).toEqual(['القسم', 'الطالب', 'الحلقة', 'البند', 'المقياس', 'القيمة']);
  });

  it('starts with the student, then carries all seven sections; a Teacher or Parent file has no subscription row', () => {
    const sections = (r: StudentReport) => [...new Set(studentReportCsvTable(r, 'en').rows.map((row) => row[0]))];
    expect(sections(manager)).toEqual(['Student', 'Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exam results', 'Subscriptions', 'Group history']);
    expect(sections(teacher)).toEqual(['Student', 'Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exam results', 'Group history']);
  });

  it('exam rows: the recorded scores per question and total; an absent exam has the outcome and the maximum only', () => {
    const rows = studentReportCsvTable(manager, 'en').rows.filter((r) => r[0] === 'Exam results');
    const of = (date: string) => rows.filter((r) => r[3] === date).map((r) => [r[4], r[5]]);
    expect(of('2026-11-02')).toEqual([['Outcome', 'Examined'], ['Questions', 3], ['Maximum per question', 10], ['Question 1', 9], ['Question 2', 8.5], ['Question 3', 10], ['Recorded total', 27.5], ['Maximum total', 30]]);
    expect(of('2026-11-09')).toEqual([['Outcome', 'Absent'], ['Questions', 2], ['Maximum per question', 10], ['Recorded total', ''], ['Maximum total', 20]]);
    expect(rows.filter((r) => r[2] === 'Total').map((r) => [r[4], r[5]])).toEqual([['Examined (count)', 2], ['Absent (count)', 1]]);
  });

  it('totals rows are labelled and subscription statuses are the current ones', () => {
    const rows = studentReportCsvTable(manager, 'en').rows;
    expect(rows.filter((r) => r[0] === 'Attendance' && r[2] === 'Total').map((r) => [r[4], r[5]])).toEqual([['Present', 18], ['Absent', 2], ['Total', 20]]);
    expect(rows.filter((r) => r[0] === 'Subscriptions').map((r) => [r[3], r[4], r[5]])).toEqual([['2026-11', 'Status (current)', 'Unpaid'], ['', 'Paid', 0], ['', 'Unpaid', 1], ['', 'Waived', 0], ['', 'Total', 1]]);
  });

  it('serializes to CSV and neutralizes a formula in the student name', () => {
    const formulaName: StudentReport = { ...manager, student: { ...manager.student, name: '=HYPERLINK("http://evil","x")' } };
    const csv = buildCsv(studentReportCsvTable(formulaName, 'en')).toString('utf8');
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain('حلقة الفجر');
  });
});
