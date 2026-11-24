import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCsv, buildXlsxWorkbook, groupReportCsvTable, groupReportTables, type GroupReport } from '../../../src/modules/38-report-modules/public';

const NONE = { count: 0, average: null };
const SCORES = { MEMORIZATION: { count: 2, average: 7.5 }, REVISION: NONE, PERFORMANCE: { count: 1, average: 9 }, TAJWEED: NONE };
const ZERO = { MEMORIZATION: NONE, REVISION: NONE, PERFORMANCE: NONE, TAJWEED: NONE };
const records = (records: number, fulfilled: number, notFulfilled: number, unscheduled: number) => ({ records, fulfilled, notFulfilled, unscheduled });
const manager: GroupReport = {
  type: 'GROUP',
  period: { kind: 'THIS_MONTH' as const, startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  group: { id: 'g1', name: 'حلقة الفجر', schoolId: 'sc1', schoolName: 'مدرسة النور', learningMode: 'GROUP', status: 'ACTIVE', teacherName: 'محمود حسن علي' },
  students: [
    { studentId: 's1', name: 'أحمد محمد علي', effectiveStartDate: '2026-11-01', attendance: { present: 8, absent: 2, total: 10 }, memorization: records(5, 3, 1, 1), revision: records(0, 0, 0, 0), evaluations: { evaluations: 2, scores: SCORES }, exams: { examined: 1, absent: 1, total: 2 } },
    { studentId: 's2', name: 'بلال محمد علي', effectiveStartDate: '2026-11-01', attendance: { present: 0, absent: 0, total: 0 }, memorization: records(0, 0, 0, 0), revision: records(0, 0, 0, 0), evaluations: { evaluations: 0, scores: ZERO }, exams: { examined: 0, absent: 0, total: 0 } },
  ],
  totals: { students: 2, attendance: { present: 8, absent: 2, total: 10 }, memorization: records(5, 3, 1, 1), revision: records(0, 0, 0, 0), evaluations: { evaluations: 2, scores: SCORES }, exams: { examined: 1, absent: 1, total: 2 } },
  teacherAttendance: { present: 19, absent: 1, total: 20 },
};
const { teacherAttendance: _hidden, ...teacherView } = manager;
void _hidden;
const teacher: GroupReport = teacherView;
const empty: GroupReport = { ...manager, students: [], totals: { ...manager.totals, students: 0 } };

describe('GROUP report: Excel worksheets (one per section, a row per student and a totals row)', () => {
  it('a manager gets six worksheets, a Teacher gets no Teacher-attendance sheet', () => {
    expect(groupReportTables(manager, 'en').map((t) => t.sheetName)).toEqual(['Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exams', 'Teacher attendance']);
    expect(groupReportTables(teacher, 'en').map((t) => t.sheetName)).toEqual(['Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exams']);
    expect(groupReportTables(manager, 'ar').map((t) => t.sheetName)).toEqual(['الحضور', 'الحفظ', 'المراجعة', 'التقييمات', 'عدد الاختبارات', 'حضور المعلم']);
  });

  it('every row has as many cells as its sheet has headers; the totals row is last and covers the complete roster', () => {
    for (const table of groupReportTables(manager, 'en')) for (const row of table.rows) expect(row, table.sheetName).toHaveLength(table.headers.length);
    const attendance = groupReportTables(manager, 'en').find((t) => t.sheetName === 'Attendance')!;
    expect(attendance.rows).toEqual([['أحمد محمد علي', 8, 2, 10], ['بلال محمد علي', 0, 0, 0], ['Total', 8, 2, 10]]);
    const exams = groupReportTables(manager, 'en').find((t) => t.sheetName === 'Exams')!;
    expect(exams.headers).toEqual(['Student', 'Examined (count)', 'Absent (count)', 'Total']);
    expect(exams.rows[2]).toEqual(['Total', 1, 1, 2]);
  });

  it('evaluations: per-category counts and means; an empty mean is an empty cell, never zero; no combined column', () => {
    const sheet = groupReportTables(manager, 'en').find((t) => t.sheetName === 'Evaluations')!;
    expect(sheet.headers).toEqual(['Student', 'Evaluations', 'Memorization (scores)', 'Memorization (average)', 'Revision (scores)', 'Revision (average)', 'Performance (scores)', 'Performance (average)', 'Tajweed (scores)', 'Tajweed (average)']);
    expect(sheet.rows[0]).toEqual(['أحمد محمد علي', 2, 2, 7.5, 0, '', 1, 9, 0, '']);
    expect(sheet.rows[1]).toEqual(['بلال محمد علي', 0, 0, '', 0, '', 0, '', 0, '']);
  });

  it('the Teacher-attendance sheet names the Teacher and the group; an empty roster still has its headers and a totals row of zeros', () => {
    const sheet = groupReportTables(manager, 'en').find((t) => t.sheetName === 'Teacher attendance')!;
    expect(sheet.rows).toEqual([['محمود حسن علي', 'حلقة الفجر', 19, 1, 20]]);
    const attendance = groupReportTables(empty, 'en').find((t) => t.sheetName === 'Attendance')!;
    expect(attendance.rows).toEqual([['Total', 8, 2, 10]]); // the fixture keeps its totals; the point is that no student row exists
  });

  it('writes a real workbook with one sheet per table, Arabic right to left', async () => {
    const wb = new Workbook();
    await wb.xlsx.load((await buildXlsxWorkbook(groupReportTables(manager, 'ar'), 'ar')) as never);
    expect(wb.worksheets).toHaveLength(6);
    expect(wb.worksheets[0]!.views[0]).toMatchObject({ rightToLeft: true });
    expect(wb.worksheets[0]!.rowCount).toBe(4); // header + 2 students + totals
  });
});

describe('GROUP report: CSV (one combined table, a short Group section first)', () => {
  it('has the STUDENT columns and starts with the group\'s details', () => {
    const table = groupReportCsvTable(manager, 'en');
    expect(table.headers).toEqual(['Section', 'Student', 'Group', 'Item', 'Measure', 'Value']);
    for (const row of table.rows) expect(row).toHaveLength(6);
    expect(table.rows.slice(0, 7).map((r) => [r[0], r[4], r[5]])).toEqual([
      ['Group', 'Group name', 'حلقة الفجر'], ['Group', 'School', 'مدرسة النور'], ['Group', 'Learning mode', 'GROUP'], ['Group', 'Group status', 'ACTIVE'],
      ['Group', 'Teacher', 'محمود حسن علي'], ['Group', 'Period', '2026-11-01 / 2026-11-18'], ['Group', 'Students', 2],
    ]);
  });

  it('then every student of the complete roster, the totals (student column = Total) and, for managers only, the Teacher attendance', () => {
    const rows = groupReportCsvTable(manager, 'en').rows;
    expect([...new Set(rows.filter((r) => r[0] === 'Attendance').map((r) => r[1]))]).toEqual(['أحمد محمد علي', 'بلال محمد علي', 'Total']);
    expect(rows.filter((r) => r[0] === 'Teacher attendance').map((r) => [r[4], r[5]])).toEqual([['Present', 19], ['Absent', 1], ['Total', 20]]);
    expect(groupReportCsvTable(teacher, 'en').rows.some((r) => r[0] === 'Teacher attendance')).toBe(false);
    expect(rows.filter((r) => r[0] === 'Evaluations' && r[1] === 'بلال محمد علي' && r[4] === 'Memorization (average)').map((r) => r[5])).toEqual(['']);
  });

  it('holds no financial section and neutralizes a formula in a name', () => {
    const evil: GroupReport = { ...manager, group: { ...manager.group, name: '=HYPERLINK("http://evil","x")' } };
    const csv = buildCsv(groupReportCsvTable(evil, 'ar')).toString('utf8');
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain('الحلقة');
    expect(/subscription|payment|الاشتراكات/i.test(csv)).toBe(false);
  });
});
