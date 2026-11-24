import type { AttendanceReport } from '../dto/attendance-report';
import type { MemorizationReport } from '../dto/memorization-report';
import type { EvaluationReport } from '../dto/evaluation-report';
import type { RevisionReport } from '../dto/revision-report';
import type { PaymentReport } from '../dto/payment-report';
import type { GroupReport } from '../dto/group-report';
import type { ParentReport } from '../dto/parent-report';
import type { TeacherReport } from '../dto/teacher-report';
import type { StudentReport } from '../dto/student-report';

export type ReportLanguage = 'ar' | 'en';

/** A report flattened for a spreadsheet or a CSV file: localized headers and plain cell values. Built from the SAME report DTO the JSON endpoint returns, so an export can never show more than the report. */
export interface ReportTable {
  readonly sheetName: string;
  readonly headers: readonly string[];
  readonly rows: ReadonlyArray<ReadonlyArray<string | number>>;
}

const L = {
  ar: { sheet: 'تقرير المدفوعات', school: 'المدرسة', month: 'الشهر', paid: 'مدفوع', unpaid: 'غير مدفوع', waived: 'معفى', subscriptions: 'الاشتراكات', recorded: 'المدفوعات المسجلة', reversed: 'المدفوعات الملغاة', total: 'الإجمالي' },
  en: { sheet: 'Payment report', school: 'School', month: 'Month', paid: 'Paid', unpaid: 'Unpaid', waived: 'Waived', subscriptions: 'Subscriptions', recorded: 'Payments recorded', reversed: 'Payments reversed', total: 'Total' },
} as const;

export function paymentReportTable(report: PaymentReport, language: ReportLanguage): ReportTable {
  const t = L[language];
  const rows: Array<Array<string | number>> = report.rows.map((r) => [r.schoolName ?? r.schoolId, r.month, r.paid, r.unpaid, r.waived, r.subscriptions, r.paymentsRecorded, r.paymentsReversed]);
  const s = report.totals;
  rows.push([t.total, '', s.paid, s.unpaid, s.waived, s.subscriptions, s.paymentsRecorded, s.paymentsReversed]);
  return { sheetName: t.sheet, headers: [t.school, t.month, t.paid, t.unpaid, t.waived, t.subscriptions, t.recorded, t.reversed], rows };
}

const A = {
  ar: { sheet: 'تقرير الحضور', school: 'المدرسة', group: 'الحلقة', type: 'النوع', name: 'الاسم', present: 'حاضر', absent: 'غائب', total: 'الإجمالي', student: 'طالب', teacher: 'معلم', students: 'إجمالي الطلاب', teachers: 'إجمالي المعلمين' },
  en: { sheet: 'Attendance report', school: 'School', group: 'Group', type: 'Type', name: 'Name', present: 'Present', absent: 'Absent', total: 'Total', student: 'Student', teacher: 'Teacher', students: 'Total students', teachers: 'Total teachers' },
} as const;

export function attendanceReportTable(report: AttendanceReport, language: ReportLanguage): ReportTable {
  const t = A[language];
  const rows: Array<Array<string | number>> = report.rows.map((r) => [
    r.schoolName ?? r.schoolId,
    r.groupName ?? r.groupId,
    r.subjectType === 'STUDENT' ? t.student : t.teacher,
    r.subjectName ?? r.subjectId,
    r.present,
    r.absent,
    r.total,
  ]);
  const { students, teachers } = report.totals;
  rows.push([t.students, '', '', '', students.present, students.absent, students.total]);
  rows.push([t.teachers, '', '', '', teachers.present, teachers.absent, teachers.total]);
  return { sheetName: t.sheet, headers: [t.school, t.group, t.type, t.name, t.present, t.absent, t.total], rows };
}

const M = {
  ar: { sheet: 'تقرير الحفظ', school: 'المدرسة', group: 'الحلقة', student: 'الطالب', records: 'عدد السجلات', fulfilled: 'مطابق للمقرر', notFulfilled: 'غير مطابق للمقرر', unscheduled: 'بلا مقرر', total: 'الإجمالي' },
  en: { sheet: 'Memorization report', school: 'School', group: 'Group', student: 'Student', records: 'Records', fulfilled: 'Matched the assignment', notFulfilled: 'Did not match the assignment', unscheduled: 'No assignment', total: 'Total' },
} as const;

export function memorizationReportTable(report: MemorizationReport, language: ReportLanguage): ReportTable {
  const t = M[language];
  const rows: Array<Array<string | number>> = report.rows.map((r) => [r.schoolName ?? r.schoolId, r.groupName ?? r.groupId, r.studentName ?? r.studentId, r.records, r.fulfilled, r.notFulfilled, r.unscheduled]);
  const s = report.totals;
  rows.push([t.total, '', '', s.records, s.fulfilled, s.notFulfilled, s.unscheduled]);
  return { sheetName: t.sheet, headers: [t.school, t.group, t.student, t.records, t.fulfilled, t.notFulfilled, t.unscheduled], rows };
}

const RV = {
  ar: { sheet: 'تقرير المراجعة', school: 'المدرسة', group: 'الحلقة', student: 'الطالب', records: 'عدد السجلات', fulfilled: 'مطابق للمقرر', notFulfilled: 'غير مطابق للمقرر', unscheduled: 'بلا مقرر', total: 'الإجمالي' },
  en: { sheet: 'Revision report', school: 'School', group: 'Group', student: 'Student', records: 'Records', fulfilled: 'Matched the assignment', notFulfilled: 'Did not match the assignment', unscheduled: 'No assignment', total: 'Total' },
} as const;

export function revisionReportTable(report: RevisionReport, language: ReportLanguage): ReportTable {
  const t = RV[language];
  const rows: Array<Array<string | number>> = report.rows.map((r) => [r.schoolName ?? r.schoolId, r.groupName ?? r.groupId, r.studentName ?? r.studentId, r.records, r.fulfilled, r.notFulfilled, r.unscheduled]);
  const s = report.totals;
  rows.push([t.total, '', '', s.records, s.fulfilled, s.notFulfilled, s.unscheduled]);
  return { sheetName: t.sheet, headers: [t.school, t.group, t.student, t.records, t.fulfilled, t.notFulfilled, t.unscheduled], rows };
}

const EV = {
  ar: { sheet: 'تقرير التقييم', school: 'المدرسة', group: 'الحلقة', student: 'الطالب', evaluations: 'عدد التقييمات', memorizationCount: 'الحفظ (عدد)', memorizationAverage: 'الحفظ (المتوسط)', revisionCount: 'المراجعة (عدد)', revisionAverage: 'المراجعة (المتوسط)', performanceCount: 'الأداء (عدد)', performanceAverage: 'الأداء (المتوسط)', tajweedCount: 'التجويد (عدد)', tajweedAverage: 'التجويد (المتوسط)', total: 'الإجمالي' },
  en: { sheet: 'Evaluation report', school: 'School', group: 'Group', student: 'Student', evaluations: 'Evaluations', memorizationCount: 'Memorization (scores)', memorizationAverage: 'Memorization (average)', revisionCount: 'Revision (scores)', revisionAverage: 'Revision (average)', performanceCount: 'Performance (scores)', performanceAverage: 'Performance (average)', tajweedCount: 'Tajweed (scores)', tajweedAverage: 'Tajweed (average)', total: 'Total' },
} as const;

type EvaluationScores = EvaluationReport['totals']['scores'];
/** Per category its score count and average; an empty cell where there is no score (never a made-up zero). */
const evaluationScoreCells = (s: EvaluationScores): Array<string | number> => [
  s.MEMORIZATION.count, s.MEMORIZATION.average ?? '',
  s.REVISION.count, s.REVISION.average ?? '',
  s.PERFORMANCE.count, s.PERFORMANCE.average ?? '',
  s.TAJWEED.count, s.TAJWEED.average ?? '',
];

export function evaluationReportTable(report: EvaluationReport, language: ReportLanguage): ReportTable {
  const t = EV[language];
  const rows: Array<Array<string | number>> = report.rows.map((r) => [r.schoolName ?? r.schoolId, r.groupName ?? r.groupId, r.studentName ?? r.studentId, r.evaluations, ...evaluationScoreCells(r.scores)]);
  rows.push([t.total, '', '', report.totals.evaluations, ...evaluationScoreCells(report.totals.scores)]);
  return {
    sheetName: t.sheet,
    headers: [t.school, t.group, t.student, t.evaluations, t.memorizationCount, t.memorizationAverage, t.revisionCount, t.revisionAverage, t.performanceCount, t.performanceAverage, t.tajweedCount, t.tajweedAverage],
    rows,
  };
}

const ST = {
  ar: {
    sheets: { attendance: 'الحضور', memorization: 'الحفظ', revision: 'المراجعة', evaluations: 'التقييمات', exams: 'الاختبارات', subscriptions: 'الاشتراكات', groupHistory: 'تاريخ الحلقات' },
    student: 'الطالب', group: 'الحلقة', total: 'الإجمالي', present: 'حاضر', absent: 'غائب', records: 'عدد السجلات', fulfilled: 'مطابق للمقرر', notFulfilled: 'غير مطابق للمقرر', unscheduled: 'بلا مقرر',
    evaluations: 'عدد التقييمات', memorizationCount: 'الحفظ (عدد)', memorizationAverage: 'الحفظ (المتوسط)', revisionCount: 'المراجعة (عدد)', revisionAverage: 'المراجعة (المتوسط)', performanceCount: 'الأداء (عدد)',
    performanceAverage: 'الأداء (المتوسط)', tajweedCount: 'التجويد (عدد)', tajweedAverage: 'التجويد (المتوسط)',
    examDate: 'تاريخ الاختبار', outcome: 'النتيجة', examined: 'تم الاختبار', absentOutcome: 'غائب', questions: 'عدد الأسئلة', maxPerQuestion: 'الدرجة العظمى للسؤال', question: 'السؤال', examTotal: 'المجموع المسجل', maxTotal: 'المجموع الأعظم',
    month: 'الشهر', status: 'الحالة (الحالية)', paid: 'مدفوع', unpaid: 'غير مدفوع', waived: 'معفى', from: 'من', to: 'إلى', current: 'حالية', yes: 'نعم', no: 'لا',
    section: 'القسم', item: 'البند', measure: 'المقياس', value: 'القيمة', school: 'المدرسة', joinDate: 'تاريخ الالتحاق', period: 'الفترة', effectiveStart: 'بداية الفترة الفعلية', statusAsOf: 'تاريخ قراءة الحالات',
    examCounts: 'عدد الاختبارات', examinedCount: 'تم الاختبار (عدد)', absentCount: 'غائب (عدد)',
    parent: 'ولي الأمر', parentName: 'اسم ولي الأمر', child: 'ابن', parentReportSheet: 'تقرير ولي الأمر',
    groupName: 'اسم الحلقة', learningMode: 'نمط التعلم', groupStatus: 'حالة الحلقة', teacher: 'المعلم', studentsCount: 'عدد الطلاب', teacherAttendance: 'حضور المعلم', groupReportSheet: 'تقرير الحلقة',
    teacherName: 'اسم المعلم', groupsTaught: 'الحلقات التي درّسها', stillTeaching: 'يدرّسها حاليًا', taughtGroupsCount: 'عدد الحلقات', teacherReportSheet: 'تقرير المعلم',
  },
  en: {
    sheets: { attendance: 'Attendance', memorization: 'Memorization', revision: 'Revision', evaluations: 'Evaluations', exams: 'Exam results', subscriptions: 'Subscriptions', groupHistory: 'Group history' },
    student: 'Student', group: 'Group', total: 'Total', present: 'Present', absent: 'Absent', records: 'Records', fulfilled: 'Matched the assignment', notFulfilled: 'Did not match the assignment', unscheduled: 'No assignment',
    evaluations: 'Evaluations', memorizationCount: 'Memorization (scores)', memorizationAverage: 'Memorization (average)', revisionCount: 'Revision (scores)', revisionAverage: 'Revision (average)', performanceCount: 'Performance (scores)',
    performanceAverage: 'Performance (average)', tajweedCount: 'Tajweed (scores)', tajweedAverage: 'Tajweed (average)',
    examDate: 'Exam date', outcome: 'Outcome', examined: 'Examined', absentOutcome: 'Absent', questions: 'Questions', maxPerQuestion: 'Maximum per question', question: 'Question', examTotal: 'Recorded total', maxTotal: 'Maximum total',
    month: 'Month', status: 'Status (current)', paid: 'Paid', unpaid: 'Unpaid', waived: 'Waived', from: 'From', to: 'To', current: 'Current', yes: 'Yes', no: 'No',
    section: 'Section', item: 'Item', measure: 'Measure', value: 'Value', school: 'School', joinDate: 'Join date', period: 'Period', effectiveStart: 'Effective start', statusAsOf: 'Statuses read at',
    examCounts: 'Exams', examinedCount: 'Examined (count)', absentCount: 'Absent (count)',
    parent: 'Parent', parentName: 'Parent name', child: 'Child', parentReportSheet: 'Parent report',
    groupName: 'Group name', learningMode: 'Learning mode', groupStatus: 'Group status', teacher: 'Teacher', studentsCount: 'Students', teacherAttendance: 'Teacher attendance', groupReportSheet: 'Group report',
    teacherName: 'Teacher name', groupsTaught: 'Groups taught', stillTeaching: 'Still teaching', taughtGroupsCount: 'Taught groups', teacherReportSheet: 'Teacher report',
  },
} as const;

type Cells = Array<string | number>;
type StudentScores = StudentReport['sections']['evaluations']['totals']['scores'];

const studentLabel = (report: StudentReport): string => report.student.name ?? report.student.id;
const subscriptionStatusLabel = (t: (typeof ST)[ReportLanguage], status: 'PAID' | 'UNPAID' | 'WAIVED'): string => (status === 'PAID' ? t.paid : status === 'UNPAID' ? t.unpaid : t.waived);
const evaluationMeasures = (t: (typeof ST)[ReportLanguage], s: StudentScores): Array<[string, string | number]> => [
  [t.memorizationCount, s.MEMORIZATION.count], [t.memorizationAverage, s.MEMORIZATION.average ?? ''],
  [t.revisionCount, s.REVISION.count], [t.revisionAverage, s.REVISION.average ?? ''],
  [t.performanceCount, s.PERFORMANCE.count], [t.performanceAverage, s.PERFORMANCE.average ?? ''],
  [t.tajweedCount, s.TAJWEED.count], [t.tajweedAverage, s.TAJWEED.average ?? ''],
];

/**
 * The STUDENT report as one worksheet per section the requester may see (up to seven; the subscription sheet exists only when the report has that section). Built from the SAME report the JSON returns,
 * so a file can never show more than the report. Empty cells (never a made-up zero) where no value exists.
 */
export function studentReportTables(report: StudentReport, language: ReportLanguage, minQuestionColumns = 0): ReportTable[] {
  const t = ST[language];
  const name = studentLabel(report);
  const sec = report.sections;
  const tables: ReportTable[] = [];

  const attendance: Cells[] = sec.attendance.rows.map((r) => [name, r.groupName ?? r.groupId, r.present, r.absent, r.total]);
  attendance.push([t.total, '', sec.attendance.totals.present, sec.attendance.totals.absent, sec.attendance.totals.total]);
  tables.push({ sheetName: t.sheets.attendance, headers: [t.student, t.group, t.present, t.absent, t.total], rows: attendance });

  for (const [sheetName, section] of [[t.sheets.memorization, sec.memorization], [t.sheets.revision, sec.revision]] as const) {
    const rows: Cells[] = section.rows.map((r) => [name, r.groupName ?? r.groupId, r.records, r.fulfilled, r.notFulfilled, r.unscheduled]);
    rows.push([t.total, '', section.totals.records, section.totals.fulfilled, section.totals.notFulfilled, section.totals.unscheduled]);
    tables.push({ sheetName, headers: [t.student, t.group, t.records, t.fulfilled, t.notFulfilled, t.unscheduled], rows });
  }

  const evaluationHeaders = [t.student, t.group, t.evaluations, t.memorizationCount, t.memorizationAverage, t.revisionCount, t.revisionAverage, t.performanceCount, t.performanceAverage, t.tajweedCount, t.tajweedAverage];
  const evaluations: Cells[] = sec.evaluations.rows.map((r) => [name, r.groupName ?? r.groupId, r.evaluations, ...evaluationMeasures(t, r.scores).map(([, v]) => v)]);
  evaluations.push([t.total, '', sec.evaluations.totals.evaluations, ...evaluationMeasures(t, sec.evaluations.totals.scores).map(([, v]) => v)]);
  tables.push({ sheetName: t.sheets.evaluations, headers: evaluationHeaders, rows: evaluations });

  // Exam results: one row per exam; the per-question scores are spread over fixed columns (as many as the most questions of any exam). No sum across exams.
  const questionColumns = sec.examResults.rows.reduce((n, r) => Math.max(n, r.scores.length), minQuestionColumns);
  const questionHeaders = Array.from({ length: questionColumns }, (_, i) => `${t.question} ${i + 1}`);
  const exams: Cells[] = sec.examResults.rows.map((r) => [
    name, r.examDate, r.groupName ?? r.groupId, r.outcome === 'EXAMINED' ? t.examined : t.absentOutcome, r.questionCount, r.maxScorePerQuestion,
    ...Array.from({ length: questionColumns }, (_, i) => r.scores[i] ?? ''), r.total ?? '', r.maxTotal,
  ]);
  exams.push([t.examCounts, '', '', `${t.examined}: ${sec.examResults.counts.examined} / ${t.absentOutcome}: ${sec.examResults.counts.absent}`, '', '', ...questionHeaders.map(() => ''), '', '']);
  tables.push({ sheetName: t.sheets.exams, headers: [t.student, t.examDate, t.group, t.outcome, t.questions, t.maxPerQuestion, ...questionHeaders, t.examTotal, t.maxTotal], rows: exams });

  if (sec.subscriptions) {
    const subs: Cells[] = sec.subscriptions.rows.map((r) => [name, r.month, subscriptionStatusLabel(t, r.status)]);
    const x = sec.subscriptions.totals;
    subs.push([t.total, '', `${t.paid}: ${x.paid} / ${t.unpaid}: ${x.unpaid} / ${t.waived}: ${x.waived}`]);
    tables.push({ sheetName: t.sheets.subscriptions, headers: [t.student, t.month, t.status], rows: subs });
  }

  tables.push({
    sheetName: t.sheets.groupHistory,
    headers: [t.student, t.group, t.from, t.to, t.current],
    rows: sec.groupHistory.rows.map((r) => [name, r.groupName ?? r.groupId, r.from, r.to ?? '', r.current ? t.yes : t.no]),
  });
  return tables;
}

/**
 * The STUDENT report as ONE CSV table (a CSV file has no sheets): `section | student | group | item | measure | value`. One row per measure, so every section fits the same columns. The student's details come first
 * (section STUDENT). The subscription section appears only when the report has it. Empty value (never a made-up zero) where none exists.
 */
export function studentReportCsvTable(report: StudentReport, language: ReportLanguage): ReportTable {
  const t = ST[language];
  const name = studentLabel(report);
  const sec = report.sections;
  const rows: Cells[] = [];
  const add = (section: string, group: string, item: string, measure: string, value: string | number): void => {
    rows.push([section, name, group, item, measure, value]);
  };
  const period = report.period.startDate === null ? report.period.kind : `${report.period.startDate} / ${report.period.endDate ?? ''}`;

  add(t.student, '', '', t.school, report.student.schoolName ?? report.student.schoolId);
  add(t.student, '', '', t.joinDate, report.student.joinDate);
  add(t.student, '', '', t.period, period);
  add(t.student, '', '', t.effectiveStart, report.effectiveStartDate ?? '');

  for (const r of sec.attendance.rows) for (const [m, v] of [[t.present, r.present], [t.absent, r.absent], [t.total, r.total]] as const) add(t.sheets.attendance, r.groupName ?? r.groupId, '', m, v);
  for (const [m, v] of [[t.present, sec.attendance.totals.present], [t.absent, sec.attendance.totals.absent], [t.total, sec.attendance.totals.total]] as const) add(t.sheets.attendance, t.total, '', m, v);

  for (const [label, section] of [[t.sheets.memorization, sec.memorization], [t.sheets.revision, sec.revision]] as const) {
    const measures = (c: { records: number; fulfilled: number; notFulfilled: number; unscheduled: number }) => [[t.records, c.records], [t.fulfilled, c.fulfilled], [t.notFulfilled, c.notFulfilled], [t.unscheduled, c.unscheduled]] as const;
    for (const r of section.rows) for (const [m, v] of measures(r)) add(label, r.groupName ?? r.groupId, '', m, v);
    for (const [m, v] of measures(section.totals)) add(label, t.total, '', m, v);
  }

  for (const r of sec.evaluations.rows) {
    add(t.sheets.evaluations, r.groupName ?? r.groupId, '', t.evaluations, r.evaluations);
    for (const [m, v] of evaluationMeasures(t, r.scores)) add(t.sheets.evaluations, r.groupName ?? r.groupId, '', m, v);
  }
  add(t.sheets.evaluations, t.total, '', t.evaluations, sec.evaluations.totals.evaluations);
  for (const [m, v] of evaluationMeasures(t, sec.evaluations.totals.scores)) add(t.sheets.evaluations, t.total, '', m, v);

  for (const r of sec.examResults.rows) {
    const group = r.groupName ?? r.groupId;
    add(t.sheets.exams, group, r.examDate, t.outcome, r.outcome === 'EXAMINED' ? t.examined : t.absentOutcome);
    add(t.sheets.exams, group, r.examDate, t.questions, r.questionCount);
    add(t.sheets.exams, group, r.examDate, t.maxPerQuestion, r.maxScorePerQuestion);
    r.scores.forEach((score, i) => add(t.sheets.exams, group, r.examDate, `${t.question} ${i + 1}`, score));
    add(t.sheets.exams, group, r.examDate, t.examTotal, r.total ?? '');
    add(t.sheets.exams, group, r.examDate, t.maxTotal, r.maxTotal);
  }
  add(t.sheets.exams, t.total, '', t.examinedCount, sec.examResults.counts.examined);
  add(t.sheets.exams, t.total, '', t.absentCount, sec.examResults.counts.absent);

  if (sec.subscriptions) {
    for (const r of sec.subscriptions.rows) add(t.sheets.subscriptions, '', r.month, t.status, subscriptionStatusLabel(t, r.status));
    for (const [m, v] of [[t.paid, sec.subscriptions.totals.paid], [t.unpaid, sec.subscriptions.totals.unpaid], [t.waived, sec.subscriptions.totals.waived], [t.total, sec.subscriptions.totals.total]] as const) add(t.sheets.subscriptions, t.total, '', m, v);
  }

  for (const r of sec.groupHistory.rows) {
    const group = r.groupName ?? r.groupId;
    add(t.sheets.groupHistory, group, r.from, t.to, r.to ?? '');
    add(t.sheets.groupHistory, group, r.from, t.current, r.current ? t.yes : t.no);
  }
  return { sheetName: language === 'ar' ? 'تقرير الطالب' : 'Student report', headers: [t.section, t.student, t.group, t.item, t.measure, t.value], rows };
}

/** The empty-families case: the section sheets with their headers and no rows (the subscription sheet only exists when a child has that section). */
const emptyStudentReport = (report: ParentReport): StudentReport => ({
  type: 'STUDENT',
  period: report.period,
  generatedAt: report.generatedAt,
  student: { id: '', name: null, schoolId: '', schoolName: null, joinDate: '' },
  effectiveStartDate: null,
  sections: {
    attendance: { rows: [], totals: { present: 0, absent: 0, total: 0 } },
    memorization: { rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } },
    revision: { rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } },
    evaluations: { rows: [], totals: { evaluations: 0, scores: { MEMORIZATION: { count: 0, average: null }, REVISION: { count: 0, average: null }, PERFORMANCE: { count: 0, average: null }, TAJWEED: { count: 0, average: null } } } },
    examResults: { counts: { examined: 0, absent: 0, total: 0 }, rows: [] },
    groupHistory: { rows: [] },
  },
});

/**
 * The PARENT report as the STUDENT report's worksheets with the rows of EVERY child (the first column of each sheet is the child). The exam sheet uses as many question columns as the child with the most questions, so the
 * columns line up. Each child's totals row says whose totals it is. Built from the SAME report the JSON returns (the files hold every child).
 */
export function parentReportTables(report: ParentReport, language: ReportLanguage): ReportTable[] {
  const t = ST[language];
  if (report.childReports.length === 0) return studentReportTables(emptyStudentReport(report), language).map((table) => ({ ...table, rows: [] }));
  const questionColumns = report.childReports.reduce((n, child) => Math.max(n, child.sections.examResults.rows.reduce((m, e) => Math.max(m, e.scores.length), 0)), 0);
  const merged = new Map<string, ReportTable>();
  for (const child of report.childReports) {
    const name = studentLabel(child);
    for (const table of studentReportTables(child, language, questionColumns)) {
      const rows = table.rows.map((row) => (row[0] === t.total || row[0] === t.examCounts ? [`${row[0]} (${name})`, ...row.slice(1)] : row));
      const existing = merged.get(table.sheetName);
      merged.set(table.sheetName, existing ? { ...existing, rows: [...existing.rows, ...rows] } : { ...table, rows });
    }
  }
  return [...merged.values()];
}

/**
 * The PARENT report as ONE CSV table with the STUDENT report's columns (`section | student | group | item | measure | value`): a short Parent section first (the Parent's name and the list of the children), then every
 * child's rows (the `student` column says whose). The file holds every child.
 */
export function parentReportCsvTable(report: ParentReport, language: ReportLanguage): ReportTable {
  const t = ST[language];
  const rows: Cells[] = [[t.parent, '', '', '', t.parentName, report.parent.name]];
  for (const child of report.parent.children) rows.push([t.parent, '', '', '', t.child, child.name ?? child.id]);
  for (const child of report.childReports) rows.push(...studentReportCsvTable(child, language).rows.map((row) => [...row]));
  return { sheetName: t.parentReportSheet, headers: [t.section, t.student, t.group, t.item, t.measure, t.value], rows };
}

/**
 * The GROUP report as one worksheet per section (attendance, memorization, revision, evaluations, exam counts and, only when the report has it, the Teacher's attendance): a row per student of the COMPLETE roster and a
 * totals row over the whole roster. Built from the SAME report the JSON returns (files hold every student). Empty cell (never a made-up zero) where no mean exists.
 */
export function groupReportTables(report: GroupReport, language: ReportLanguage): ReportTable[] {
  const t = ST[language];
  const tables: ReportTable[] = [];
  const rows = report.students;
  const totals = report.totals;

  tables.push({ sheetName: t.sheets.attendance, headers: [t.student, t.present, t.absent, t.total], rows: [...rows.map((r): Cells => [r.name, r.attendance.present, r.attendance.absent, r.attendance.total]), [t.total, totals.attendance.present, totals.attendance.absent, totals.attendance.total]] });
  for (const [sheetName, key] of [[t.sheets.memorization, 'memorization'], [t.sheets.revision, 'revision']] as const) {
    tables.push({
      sheetName,
      headers: [t.student, t.records, t.fulfilled, t.notFulfilled, t.unscheduled],
      rows: [...rows.map((r): Cells => [r.name, r[key].records, r[key].fulfilled, r[key].notFulfilled, r[key].unscheduled]), [t.total, totals[key].records, totals[key].fulfilled, totals[key].notFulfilled, totals[key].unscheduled]],
    });
  }
  tables.push({
    sheetName: t.sheets.evaluations,
    headers: [t.student, t.evaluations, t.memorizationCount, t.memorizationAverage, t.revisionCount, t.revisionAverage, t.performanceCount, t.performanceAverage, t.tajweedCount, t.tajweedAverage],
    rows: [
      ...rows.map((r): Cells => [r.name, r.evaluations.evaluations, ...evaluationMeasures(t, r.evaluations.scores).map(([, v]) => v)]),
      [t.total, totals.evaluations.evaluations, ...evaluationMeasures(t, totals.evaluations.scores).map(([, v]) => v)],
    ],
  });
  tables.push({ sheetName: t.examCounts, headers: [t.student, t.examinedCount, t.absentCount, t.total], rows: [...rows.map((r): Cells => [r.name, r.exams.examined, r.exams.absent, r.exams.total]), [t.total, totals.exams.examined, totals.exams.absent, totals.exams.total]] });
  if (report.teacherAttendance) {
    tables.push({ sheetName: t.teacherAttendance, headers: [t.teacher, t.group, t.present, t.absent, t.total], rows: [[report.group.teacherName ?? '', report.group.name, report.teacherAttendance.present, report.teacherAttendance.absent, report.teacherAttendance.total]] });
  }
  return tables;
}

/**
 * The GROUP report as ONE CSV table with the STUDENT report's columns (`section | student | group | item | measure | value`): a short Group section first (the group's details), then one row per measure for every
 * student of the COMPLETE roster, the totals of each section (student column = Total) and, only when the report has it, the Teacher's attendance.
 */
export function groupReportCsvTable(report: GroupReport, language: ReportLanguage): ReportTable {
  const t = ST[language];
  const rows: Cells[] = [];
  const group = report.group.name;
  const add = (section: string, student: string, item: string, measure: string, value: string | number): void => {
    rows.push([section, student, group, item, measure, value]);
  };
  const period = report.period.startDate === null ? report.period.kind : `${report.period.startDate} / ${report.period.endDate ?? ''}`;
  add(t.group, '', '', t.groupName, group);
  add(t.group, '', '', t.school, report.group.schoolName ?? report.group.schoolId);
  add(t.group, '', '', t.learningMode, report.group.learningMode);
  add(t.group, '', '', t.groupStatus, report.group.status);
  add(t.group, '', '', t.teacher, report.group.teacherName ?? '');
  add(t.group, '', '', t.period, period);
  add(t.group, '', '', t.studentsCount, report.totals.students);

  const lines = (student: string, a: GroupReport['totals']): void => {
    for (const [m, v] of [[t.present, a.attendance.present], [t.absent, a.attendance.absent], [t.total, a.attendance.total]] as const) add(t.sheets.attendance, student, '', m, v);
    for (const [label, key] of [[t.sheets.memorization, 'memorization'], [t.sheets.revision, 'revision']] as const) {
      for (const [m, v] of [[t.records, a[key].records], [t.fulfilled, a[key].fulfilled], [t.notFulfilled, a[key].notFulfilled], [t.unscheduled, a[key].unscheduled]] as const) add(label, student, '', m, v);
    }
    add(t.sheets.evaluations, student, '', t.evaluations, a.evaluations.evaluations);
    for (const [m, v] of evaluationMeasures(t, a.evaluations.scores)) add(t.sheets.evaluations, student, '', m, v);
    for (const [m, v] of [[t.examinedCount, a.exams.examined], [t.absentCount, a.exams.absent], [t.total, a.exams.total]] as const) add(t.examCounts, student, '', m, v);
  };
  for (const r of report.students) lines(r.name, { students: 1, attendance: r.attendance, memorization: r.memorization, revision: r.revision, evaluations: r.evaluations, exams: r.exams });
  lines(t.total, report.totals);
  if (report.teacherAttendance) for (const [m, v] of [[t.present, report.teacherAttendance.present], [t.absent, report.teacherAttendance.absent], [t.total, report.teacherAttendance.total]] as const) add(t.teacherAttendance, report.group.teacherName ?? '', '', m, v);
  return { sheetName: t.groupReportSheet, headers: [t.section, t.student, t.group, t.item, t.measure, t.value], rows };
}

type TeacherGroupRow = TeacherReport['groups'][number];
const teacherWindow = (g: TeacherGroupRow): string => `${g.taughtFrom} → ${g.taughtTo}`;

/**
 * The TEACHER report as one worksheet per section, a row per stint in which the Teacher taught a group (the first columns say the SCHOOL and the GROUP and the dates, so schools are never mixed up; no totals row, nothing is
 * combined across groups or schools): Groups taught, Teacher attendance and the GROUP report's sections for each stint. Built from the SAME report the JSON returns (files hold every stint of the authorized schools).
 */
export function teacherReportTables(report: TeacherReport, language: ReportLanguage): ReportTable[] {
  const t = ST[language];
  const where = (g: TeacherGroupRow): Cells => [g.schoolName ?? g.schoolId, g.groupName, g.taughtFrom, g.taughtTo];
  const whereHeaders = [t.school, t.group, t.from, t.to];
  const rows = report.groups;
  const tables: ReportTable[] = [];
  tables.push({
    sheetName: t.groupsTaught,
    headers: [...whereHeaders, t.learningMode, t.stillTeaching, t.studentsCount],
    rows: rows.map((g): Cells => [...where(g), g.learningMode, g.stillTeaching ? t.yes : t.no, g.students]),
  });
  tables.push({ sheetName: t.teacherAttendance, headers: [t.teacher, ...whereHeaders, t.present, t.absent, t.total], rows: rows.map((g): Cells => [report.teacher.name, ...where(g), g.teacherAttendance.present, g.teacherAttendance.absent, g.teacherAttendance.total]) });
  tables.push({ sheetName: t.sheets.attendance, headers: [...whereHeaders, t.present, t.absent, t.total], rows: rows.map((g): Cells => [...where(g), g.attendance.present, g.attendance.absent, g.attendance.total]) });
  for (const [sheetName, key] of [[t.sheets.memorization, 'memorization'], [t.sheets.revision, 'revision']] as const) {
    tables.push({ sheetName, headers: [...whereHeaders, t.records, t.fulfilled, t.notFulfilled, t.unscheduled], rows: rows.map((g): Cells => [...where(g), g[key].records, g[key].fulfilled, g[key].notFulfilled, g[key].unscheduled]) });
  }
  tables.push({
    sheetName: t.sheets.evaluations,
    headers: [...whereHeaders, t.evaluations, t.memorizationCount, t.memorizationAverage, t.revisionCount, t.revisionAverage, t.performanceCount, t.performanceAverage, t.tajweedCount, t.tajweedAverage],
    rows: rows.map((g): Cells => [...where(g), g.evaluations.evaluations, ...evaluationMeasures(t, g.evaluations.scores).map(([, v]) => v)]),
  });
  tables.push({ sheetName: t.examCounts, headers: [...whereHeaders, t.examinedCount, t.absentCount, t.total], rows: rows.map((g): Cells => [...where(g), g.exams.examined, g.exams.absent, g.exams.total]) });
  return tables;
}

/**
 * The TEACHER report as ONE CSV table with the STUDENT report's columns (`section | student | group | item | measure | value`): a short Teacher section first (name, the authorized schools, period, number of entries),
 * then, for every stint of the authorized schools, one row per measure; the `group` column holds the group and the `item` column holds the SCHOOL and the stint's dates, so schools stay distinguishable.
 * The `student` column is empty (the figures are the group's, not a student's). Nothing is combined across groups or schools.
 */
export function teacherReportCsvTable(report: TeacherReport, language: ReportLanguage): ReportTable {
  const t = ST[language];
  const rows: Cells[] = [];
  const period = report.period.startDate === null ? report.period.kind : `${report.period.startDate} / ${report.period.endDate ?? ''}`;
  rows.push([t.teacher, '', '', '', t.teacherName, report.teacher.name]);
  for (const school of report.teacher.schools) rows.push([t.teacher, '', '', '', t.school, school.name ?? school.id]);
  rows.push([t.teacher, '', '', '', t.period, period]);
  rows.push([t.teacher, '', '', '', t.taughtGroupsCount, report.groups.length]);
  for (const g of report.groups) {
    const item = `${g.schoolName ?? g.schoolId} (${teacherWindow(g)})`;
    const add = (section: string, measure: string, value: string | number): void => {
      rows.push([section, '', g.groupName, item, measure, value]);
    };
    add(t.groupsTaught, t.learningMode, g.learningMode);
    add(t.groupsTaught, t.from, g.taughtFrom);
    add(t.groupsTaught, t.to, g.taughtTo);
    add(t.groupsTaught, t.stillTeaching, g.stillTeaching ? t.yes : t.no);
    add(t.groupsTaught, t.studentsCount, g.students);
    for (const [m, v] of [[t.present, g.teacherAttendance.present], [t.absent, g.teacherAttendance.absent], [t.total, g.teacherAttendance.total]] as const) add(t.teacherAttendance, m, v);
    for (const [m, v] of [[t.present, g.attendance.present], [t.absent, g.attendance.absent], [t.total, g.attendance.total]] as const) add(t.sheets.attendance, m, v);
    for (const [label, key] of [[t.sheets.memorization, 'memorization'], [t.sheets.revision, 'revision']] as const) {
      for (const [m, v] of [[t.records, g[key].records], [t.fulfilled, g[key].fulfilled], [t.notFulfilled, g[key].notFulfilled], [t.unscheduled, g[key].unscheduled]] as const) add(label, m, v);
    }
    add(t.sheets.evaluations, t.evaluations, g.evaluations.evaluations);
    for (const [m, v] of evaluationMeasures(t, g.evaluations.scores)) add(t.sheets.evaluations, m, v);
    for (const [m, v] of [[t.examinedCount, g.exams.examined], [t.absentCount, g.exams.absent], [t.total, g.exams.total]] as const) add(t.examCounts, m, v);
  }
  return { sheetName: t.teacherReportSheet, headers: [t.section, t.student, t.group, t.item, t.measure, t.value], rows };
}
