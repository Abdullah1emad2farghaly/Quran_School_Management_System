import { ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { CSV_MIME, XLSX_MIME } from './report-handlers';

const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const GROUP_ID = '3f1b2c4d-5e6a-4b7c-8d9e-0a1b2c3d4e5f';
const STUDENT_ID = '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

const REFERENCE = 'docs/REPORT-MODULES.md; docs/REPORTS-CORE.md; Master Specification §66-§70; docs/AUTHORIZATION-MATRIX.md (Report Modules 38)';
const ENFORCEMENT =
  "Enforced by Module 37's reporting scope, computed on every request from the verified session (the user and the ACTIVE role): the role must be allowed the PAYMENT report and have a current, non-empty scope, otherwise 403 REPORT_NOT_ALLOWED. An Organization Manager reports on the schools of the organizations they manage, a School Manager on the schools they actively manage, a Subscription Collector on the schools they are CURRENTLY linked to (an ended link grants nothing). A school outside that scope is 403 REPORT_SCOPE_FORBIDDEN (the same answer whether it exists or not). MAIN_ADMIN, the area managers (no area assignment exists yet), Teacher, Parent and Student have no PAYMENT report. This is not a Module 12 permission.";

const paymentReportAuthorization: AuthorizationDoc = {
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'SUBSCRIPTION_COLLECTOR'],
  scope: "The schools of the caller's organizations (Organization Manager), actively managed schools (School Manager) or currently linked schools (Collector); optionally narrowed with `schoolId`.",
  enforcement: ENFORCEMENT,
  permissionId: null,
  decision: 'APPROVED',
  reference: REFERENCE,
};

const FORBIDDEN: ErrorDoc = {
  status: 403,
  codes: ['REPORT_NOT_ALLOWED', 'REPORT_SCOPE_FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
  description: 'The role may not run this report or has no current scope, a requested school is outside the scope (existence is never revealed), or the account must first change its initial password.',
};

const PERIOD_ERRORS: ErrorDoc = {
  status: 400,
  codes: ['INVALID_REPORT_PERIOD', 'REPORT_CUSTOM_DATES_REQUIRED', 'REPORT_PERIOD_DATES_NOT_ALLOWED', 'INVALID_REPORT_DATE', 'REPORT_PERIOD_START_AFTER_END'],
  description: 'The period kind or dates are not valid (a CUSTOM period needs both dates; the other kinds take none).',
};

const reportQuery: NonNullable<OperationDoc['query']> = [
  { name: 'period', in: 'query', required: true, description: 'THIS_MONTH, LAST_MONTH, ACROSS_TIME or CUSTOM (Master Specification §66).', schema: { type: 'string', enum: ['THIS_MONTH', 'LAST_MONTH', 'ACROSS_TIME', 'CUSTOM'] }, example: 'THIS_MONTH' },
  { name: 'startDate', in: 'query', required: false, description: 'CUSTOM only: the first day, `YYYY-MM-DD` (Africa/Cairo).', schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, example: '2026-09-01' },
  { name: 'endDate', in: 'query', required: false, description: 'CUSTOM only: the last day included, `YYYY-MM-DD`.', schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, example: '2026-10-31' },
  { name: 'schoolId', in: 'query', required: false, description: 'Optional: narrow the report to one school inside the caller\'s scope.', schema: { type: 'string', format: 'uuid' }, example: SCHOOL_ID },
];

const periodSchema = s.object(
  {
    kind: s.string({ enum: ['THIS_MONTH', 'LAST_MONTH', 'ACROSS_TIME', 'CUSTOM'] }),
    startDate: s.string({ nullable: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The first business date covered (null for ACROSS_TIME).', example: '2026-11-01' }),
    endDate: s.string({ nullable: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The last business date covered (null for ACROSS_TIME).', example: '2026-11-18' }),
  },
  ['kind', 'startDate', 'endDate'],
);

const counts = {
  paid: s.integer({ minimum: 0, description: 'Subscriptions of that school and month that are PAID now.', example: 12 }),
  unpaid: s.integer({ minimum: 0, description: 'Subscriptions UNPAID now.', example: 3 }),
  waived: s.integer({ minimum: 0, description: 'Subscriptions WAIVED now.', example: 1 }),
  subscriptions: s.integer({ minimum: 0, description: 'paid + unpaid + waived.', example: 16 }),
  paymentsRecorded: s.integer({ minimum: 0, description: 'Successful payments that stand.', example: 12 }),
  paymentsReversed: s.integer({ minimum: 0, description: 'Payments that were reversed (kept as history).', example: 1 }),
};
const COUNT_KEYS = ['paid', 'unpaid', 'waived', 'subscriptions', 'paymentsRecorded', 'paymentsReversed'];

const rowSchema = s.object(
  {
    schoolId: s.uuid({ example: SCHOOL_ID }),
    schoolName: s.string({ nullable: true, description: 'The school name, or null when it could not be read.', example: 'مدرسة النور' }),
    month: s.string({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'The billing month `YYYY-MM` (Africa/Cairo).', example: '2026-11' }),
    ...counts,
  },
  ['schoolId', 'schoolName', 'month', ...COUNT_KEYS],
);

const reportSchema = s.object(
  {
    type: s.string({ enum: ['PAYMENT'] }),
    period: periodSchema,
    generatedAt: s.dateTime({ description: 'When the report was produced (UTC).', example: '2026-11-18T10:00:00.000Z' }),
    rows: s.array(rowSchema, { description: 'One row per school and billing month that has subscriptions or payments in the period (sorted by school name, then month).' }),
    totals: s.object({ ...counts }, COUNT_KEYS),
  },
  ['type', 'period', 'generatedAt', 'rows', 'totals'],
);

const reportExample = {
  type: 'PAYMENT',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  rows: [{ schoolId: SCHOOL_ID, schoolName: 'مدرسة النور', month: '2026-11', paid: 12, unpaid: 3, waived: 1, subscriptions: 16, paymentsRecorded: 12, paymentsReversed: 1 }],
  totals: { paid: 12, unpaid: 3, waived: 1, subscriptions: 16, paymentsRecorded: 12, paymentsReversed: 1 },
};

const DESCRIPTION =
  'Subscription statuses and cash payments per school and billing month (Master Specification §60, §68). Data only: counts, no amounts (the system stores none). A billing month is included when it lies inside the period; ACROSS_TIME has no bounds. History is kept: reversed payments are counted separately, never removed. The `csv` and `xlsx` variants return the SAME report (same scope, same period) as a file.';


const ATTENDANCE_ENFORCEMENT =
  "Enforced by Module 37's reporting scope, computed on every request from the verified session (the user and the ACTIVE role): the role must be allowed the ATTENDANCE report and have a current, non-empty scope, otherwise 403 REPORT_NOT_ALLOWED. An Organization Manager reports on the schools of the organizations they manage, a School Manager on the schools they actively manage, a Teacher on the students of the groups they currently teach (never other teachers' attendance), a Parent on their own children only. A requested school, group or student outside that scope is 403 REPORT_SCOPE_FORBIDDEN (the same answer whether it exists or not); asking for a broader level than the role's own (for example a school as a Teacher) is refused the same way. Student rows start on the later of the student's join date and the period start, and show the group the student was in at the time. MAIN_ADMIN, the area managers (no area assignment exists yet), the Subscription Collector and Student have no ATTENDANCE report. This is not a Module 12 permission.";

const attendanceReportAuthorization: AuthorizationDoc = {
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'TEACHER', 'PARENT'],
  scope: "The schools of the caller's organizations (Organization Manager), actively managed schools (School Manager), the groups they currently teach (Teacher) or their own children (Parent); optionally narrowed with `schoolId`, `groupId` or `studentId` (each inside the scope).",
  enforcement: ATTENDANCE_ENFORCEMENT,
  permissionId: null,
  decision: 'APPROVED',
  reference: REFERENCE,
};

const attendanceQuery: NonNullable<OperationDoc['query']> = [
  ...reportQuery,
  { name: 'groupId', in: 'query', required: false, description: "Optional: narrow the report to one group (the group of the attendance record, i.e. the group at the time).", schema: { type: 'string', format: 'uuid' }, example: GROUP_ID },
  { name: 'studentId', in: 'query', required: false, description: 'Optional: narrow the report to one student (only that student\'s rows, no teacher rows).', schema: { type: 'string', format: 'uuid' }, example: STUDENT_ID },
];

const attendanceCounts = {
  present: s.integer({ minimum: 0, description: 'Sessions recorded PRESENT.', example: 18 }),
  absent: s.integer({ minimum: 0, description: 'Sessions recorded ABSENT.', example: 2 }),
  total: s.integer({ minimum: 0, description: 'present + absent.', example: 20 }),
};
const ATTENDANCE_COUNT_KEYS = ['present', 'absent', 'total'];

const attendanceRowSchema = s.object(
  {
    subjectType: s.string({ enum: ['STUDENT', 'TEACHER'], description: 'Whether the row counts a student or a teacher.', example: 'STUDENT' }),
    subjectId: s.uuid({ description: 'The student id, or the teacher id for a teacher row.', example: STUDENT_ID }),
    subjectName: s.string({ nullable: true, description: 'The name, or null when it could not be read.', example: 'أحمد محمد علي' }),
    schoolId: s.uuid({ example: SCHOOL_ID }),
    schoolName: s.string({ nullable: true, example: 'مدرسة النور' }),
    groupId: s.uuid({ description: 'The group of the attendance record (the group at the time).', example: GROUP_ID }),
    groupName: s.string({ nullable: true, example: 'حلقة الفجر' }),
    ...attendanceCounts,
  },
  ['subjectType', 'subjectId', 'subjectName', 'schoolId', 'schoolName', 'groupId', 'groupName', ...ATTENDANCE_COUNT_KEYS],
);

const attendanceSchema = s.object(
  {
    type: s.string({ enum: ['ATTENDANCE'] }),
    period: periodSchema,
    generatedAt: s.dateTime({ description: 'When the report was produced (UTC).', example: '2026-11-18T10:00:00.000Z' }),
    rows: s.array(attendanceRowSchema, { description: 'One row per school, group and subject (sorted by school, group, type, name).' }),
    totals: s.object({ students: s.object({ ...attendanceCounts }, ATTENDANCE_COUNT_KEYS), teachers: s.object({ ...attendanceCounts }, ATTENDANCE_COUNT_KEYS) }, ['students', 'teachers']),
  },
  ['type', 'period', 'generatedAt', 'rows', 'totals'],
);

const attendanceExample = {
  type: 'ATTENDANCE',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  rows: [{ subjectType: 'STUDENT', subjectId: STUDENT_ID, subjectName: 'أحمد محمد علي', schoolId: SCHOOL_ID, schoolName: 'مدرسة النور', groupId: GROUP_ID, groupName: 'حلقة الفجر', present: 18, absent: 2, total: 20 }],
  totals: { students: { present: 18, absent: 2, total: 20 }, teachers: { present: 0, absent: 0, total: 0 } },
};

const ATTENDANCE_DESCRIPTION =
  'PRESENT and ABSENT counts per student, teacher and group (Master Specification §51, §65, §67, §68). Data only: counts, no rates or grades. Each row is one subject in one group of one school; the group is the group of the attendance record (the group at the time), so a student who changed groups has one row per group. Student rows never include dates before the student joined (the later of the join date and the period start). Teacher rows are visible to managers only. History is kept: corrected records count with their current status. The `csv` and `xlsx` variants return the SAME report (same scope, same period) as a file.';

const operations: OperationDoc[] = [
  {
    method: 'get',
    path: '/payment',
    operationId: 'getPaymentReport',
    summary: 'The PAYMENT report',
    description: DESCRIPTION,
    authorization: paymentReportAuthorization,
    query: reportQuery,
    success: { status: 200, description: 'The report.', data: ref('PaymentReport'), example: reportExample },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/payment/csv',
    operationId: 'downloadPaymentReportCsv',
    summary: 'The PAYMENT report as a CSV file',
    description: `${DESCRIPTION} Headers are in the language of the request (Arabic by default); the file is UTF-8 with a byte order mark so Excel reads Arabic correctly.`,
    authorization: paymentReportAuthorization,
    query: reportQuery,
    success: { status: 200, description: 'The CSV file (binary).', binary: { contentType: CSV_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/payment/xlsx',
    operationId: 'downloadPaymentReportXlsx',
    summary: 'The PAYMENT report as an Excel file',
    description: `${DESCRIPTION} Headers are in the language of the request (Arabic by default; Arabic sheets read right to left).`,
    authorization: paymentReportAuthorization,
    query: reportQuery,
    success: { status: 200, description: 'The .xlsx file (binary).', binary: { contentType: XLSX_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/attendance',
    operationId: 'getAttendanceReport',
    summary: 'The ATTENDANCE report',
    description: ATTENDANCE_DESCRIPTION,
    authorization: attendanceReportAuthorization,
    query: attendanceQuery,
    success: { status: 200, description: 'The report.', data: ref('AttendanceReport'), example: attendanceExample },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/attendance/csv',
    operationId: 'downloadAttendanceReportCsv',
    summary: 'The ATTENDANCE report as a CSV file',
    description: `${ATTENDANCE_DESCRIPTION} Headers are in the language of the request (Arabic by default); the file is UTF-8 with a byte order mark so Excel reads Arabic correctly.`,
    authorization: attendanceReportAuthorization,
    query: attendanceQuery,
    success: { status: 200, description: 'The CSV file (binary).', binary: { contentType: CSV_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/attendance/xlsx',
    operationId: 'downloadAttendanceReportXlsx',
    summary: 'The ATTENDANCE report as an Excel file',
    description: `${ATTENDANCE_DESCRIPTION} Headers are in the language of the request (Arabic by default; Arabic sheets read right to left).`,
    authorization: attendanceReportAuthorization,
    query: attendanceQuery,
    success: { status: 200, description: 'The .xlsx file (binary).', binary: { contentType: XLSX_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
];

/** OpenAPI contract of `/reports` (`report-routes.ts`). Module 38: report modules (slice 1: PAYMENT and ATTENDANCE). */
export const reportApiDoc: ModuleApiDoc = {
  moduleId: '38',
  mountPath: '/reports',
  tag: {
    name: 'Reports',
    description:
      'Read-only reports (Master Specification §66-§70). Every report is computed inside the caller\'s own reporting scope (Module 37), from the owning modules\' public contracts, with a mandatory period. JSON first; CSV and Excel files return the same report. Slice 1 provides the PAYMENT and ATTENDANCE reports.',
  },
  operations,
  schemas: { PaymentReport: reportSchema, AttendanceReport: attendanceSchema },
};
