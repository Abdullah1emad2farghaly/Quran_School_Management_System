import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCsv, buildXlsxWorkbook, teacherReportCsvTable, teacherReportTables, type TeacherReport } from '../../../src/modules/38-report-modules/public';

const NONE = { count: 0, average: null };
const entry = (over: Partial<TeacherReport['groups'][number]>): TeacherReport['groups'][number] => ({
  groupId: 'g1', groupName: 'حلقة أ', schoolId: 'sa', schoolName: 'مدرسة النور', learningMode: 'GROUP', taughtFrom: '2026-09-10', taughtTo: '2026-11-18', stillTeaching: true,
  teacherAttendance: { present: 9, absent: 1, total: 10 }, students: 25, attendance: { present: 180, absent: 20, total: 200 }, memorization: { records: 120, fulfilled: 90, notFulfilled: 20, unscheduled: 10 },
  revision: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 }, evaluations: { evaluations: 2, scores: { MEMORIZATION: { count: 2, average: 8.5 }, REVISION: NONE, PERFORMANCE: NONE, TAJWEED: NONE } },
  exams: { examined: 20, absent: 5, total: 25 }, ...over,
});
const report: TeacherReport = {
  type: 'TEACHER',
  period: { kind: 'ACROSS_TIME' as const, startDate: null, endDate: null },
  generatedAt: '2026-11-18T10:00:00.000Z',
  teacher: { id: 't1', name: 'محمود حسن علي', schools: [{ id: 'sa', name: 'مدرسة النور' }, { id: 'sb', name: 'مدرسة الهدى' }] },
  groups: [
    entry({}),
    entry({ groupId: 'g1', taughtFrom: '2026-09-10', taughtTo: '2026-10-01', stillTeaching: false, teacherAttendance: { present: 1, absent: 0, total: 1 } }),
    entry({ groupId: 'g2', groupName: 'حلقة ب', schoolId: 'sb', schoolName: 'مدرسة الهدى', taughtFrom: '2026-10-01', students: 12 }),
  ],
};
const empty: TeacherReport = { ...report, groups: [] };

describe('TEACHER report: Excel worksheets (a row per stint, the school and the group first)', () => {
  it('has the sections in a fixed order', () => {
    expect(teacherReportTables(report, 'en').map((t) => t.sheetName)).toEqual(['Groups taught', 'Teacher attendance', 'Attendance', 'Memorization', 'Revision', 'Evaluations', 'Exams']);
    expect(teacherReportTables(report, 'ar').map((t) => t.sheetName)).toEqual(['الحلقات التي درّسها', 'حضور المعلم', 'الحضور', 'الحفظ', 'المراجعة', 'التقييمات', 'عدد الاختبارات']);
  });

  it('every row names its school, group and dates (schools are never mixed), has as many cells as headers, and no sheet totals across groups or schools', () => {
    for (const table of teacherReportTables(report, 'en')) {
      for (const row of table.rows) expect(row, table.sheetName).toHaveLength(table.headers.length);
      expect(table.rows).toHaveLength(3); // one row per stint, no totals row
      expect(table.rows.some((r) => r[0] === 'Total' || r[1] === 'Total'), table.sheetName).toBe(false);
    }
    const taught = teacherReportTables(report, 'en').find((t) => t.sheetName === 'Groups taught')!;
    expect(taught.headers).toEqual(['School', 'Group', 'From', 'To', 'Learning mode', 'Still teaching', 'Students']);
    expect(taught.rows).toEqual([
      ['مدرسة النور', 'حلقة أ', '2026-09-10', '2026-11-18', 'GROUP', 'Yes', 25],
      ['مدرسة النور', 'حلقة أ', '2026-09-10', '2026-10-01', 'GROUP', 'No', 25],
      ['مدرسة الهدى', 'حلقة ب', '2026-10-01', '2026-11-18', 'GROUP', 'Yes', 12],
    ]);
  });

  it('the Teacher\'s own attendance is its own sheet; empty means are empty cells, never zero', () => {
    const tables = teacherReportTables(report, 'en');
    expect(tables.find((t) => t.sheetName === 'Teacher attendance')!.rows[0]).toEqual(['محمود حسن علي', 'مدرسة النور', 'حلقة أ', '2026-09-10', '2026-11-18', 9, 1, 10]);
    expect(tables.find((t) => t.sheetName === 'Evaluations')!.rows[0]).toEqual(['مدرسة النور', 'حلقة أ', '2026-09-10', '2026-11-18', 2, 2, 8.5, 0, '', 0, '', 0, '']);
  });

  it('an empty report keeps the sheets and their headers with no rows', () => {
    for (const table of teacherReportTables(empty, 'en')) {
      expect(table.headers.length).toBeGreaterThan(0);
      expect(table.rows).toEqual([]);
    }
  });

  it('writes a real workbook with one sheet per table', async () => {
    const wb = new Workbook();
    await wb.xlsx.load((await buildXlsxWorkbook(teacherReportTables(report, 'ar'), 'ar')) as never);
    expect(wb.worksheets).toHaveLength(7);
    expect(wb.worksheets[0]!.rowCount).toBe(4);
  });
});

describe('TEACHER report: CSV (one combined table, a short Teacher section first)', () => {
  it('has the STUDENT columns and starts with the Teacher section: name, only the authorized schools, period, number of entries', () => {
    const table = teacherReportCsvTable(report, 'en');
    expect(table.headers).toEqual(['Section', 'Student', 'Group', 'Item', 'Measure', 'Value']);
    for (const row of table.rows) expect(row).toHaveLength(6);
    expect(table.rows.slice(0, 5).map((r) => [r[0], r[4], r[5]])).toEqual([
      ['Teacher', 'Teacher name', 'محمود حسن علي'], ['Teacher', 'School', 'مدرسة النور'], ['Teacher', 'School', 'مدرسة الهدى'], ['Teacher', 'Period', 'ACROSS_TIME'], ['Teacher', 'Taught groups', 3],
    ]);
  });

  it('then every stint: the group column holds the group, the item column the school and the dates, the student column is empty', () => {
    const rows = teacherReportCsvTable(report, 'en').rows.slice(5);
    expect(rows.every((r) => r[1] === '')).toBe(true);
    expect([...new Set(rows.map((r) => r[3]))]).toEqual(['مدرسة النور (2026-09-10 → 2026-11-18)', 'مدرسة النور (2026-09-10 → 2026-10-01)', 'مدرسة الهدى (2026-10-01 → 2026-11-18)']);
    expect(rows.filter((r) => r[0] === 'Teacher attendance' && r[2] === 'حلقة ب').map((r) => [r[4], r[5]])).toEqual([['Present', 9], ['Absent', 1], ['Total', 10]]);
    expect(rows.some((r) => r[0] === 'Subscriptions')).toBe(false);
  });

  it('serializes to CSV and neutralizes a formula in the Teacher\'s name', () => {
    const evil: TeacherReport = { ...report, teacher: { ...report.teacher, name: '=HYPERLINK("http://evil","x")' } };
    const csv = buildCsv(teacherReportCsvTable(evil, 'ar')).toString('utf8');
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain('المعلم');
  });
});
