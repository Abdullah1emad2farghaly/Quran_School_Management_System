import type { AttendanceReport } from '../dto/attendance-report';
import type { PaymentReport } from '../dto/payment-report';

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
