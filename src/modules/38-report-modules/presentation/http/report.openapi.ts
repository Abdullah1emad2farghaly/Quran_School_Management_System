import { ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { CSV_MIME, XLSX_MIME } from './report-handlers';

const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const GROUP_ID = '3f1b2c4d-5e6a-4b7c-8d9e-0a1b2c3d4e5f';
const STUDENT_ID = '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const PARENT_ID = '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const TEACHER_ID = '4d5e6f70-8192-4a3b-9c4d-5e6f70819203';

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
  'Subscription statuses and cash payments per school and billing month (Master Specification §60, §68). Data only: counts, no amounts (the system stores none). A billing month is included when it lies inside the period; ACROSS_TIME has no bounds. History is kept: reversed payments are counted separately, never removed. The JSON is paginated like every list (default 20 rows, maximum 100). The `csv` and `xlsx` variants return the SAME report (same scope, same period) as one complete file (no pagination).';


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
  'PRESENT and ABSENT counts per student, teacher and group (Master Specification §51, §65, §67, §68). Data only: counts, no rates or grades. Each row is one subject in one group of one school; the group is the group of the attendance record (the group at the time), so a student who changed groups has one row per group. Student rows never include dates before the student joined (the later of the join date and the period start). Teacher rows are visible to managers only. History is kept: corrected records count with their current status. The JSON is paginated like every list (default 20 rows, maximum 100). The `csv` and `xlsx` variants return the SAME report (same scope, same period) as one complete file (no pagination).';

const MEMORIZATION_ENFORCEMENT =
  "Enforced by Module 37's reporting scope, computed on every request from the verified session (the user and the ACTIVE role): the role must be allowed the MEMORIZATION report and have a current, non-empty scope, otherwise 403 REPORT_NOT_ALLOWED. An Organization Manager reports on the students of the schools of the organizations they manage, a School Manager on the students of the schools they actively manage, a Teacher on the students of the groups they currently teach, a Parent on their own children only. A requested school, group or student outside that scope is 403 REPORT_SCOPE_FORBIDDEN (the same answer whether it exists or not); asking for a broader level than the role's own (for example a school as a Teacher) is refused the same way. Student rows start on the later of the student's join date and the period start, and show the group the student was in at the time. MAIN_ADMIN, the area managers (no area assignment exists yet), the Subscription Collector and Student have no MEMORIZATION report. This is not a Module 12 permission.";

const memorizationReportAuthorization: AuthorizationDoc = {
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'TEACHER', 'PARENT'],
  scope: "The students of the schools of the caller's organizations (Organization Manager), of actively managed schools (School Manager), of the groups they currently teach (Teacher) or their own children (Parent); optionally narrowed with `schoolId`, `groupId` or `studentId` (each inside the scope).",
  enforcement: MEMORIZATION_ENFORCEMENT,
  permissionId: null,
  decision: 'APPROVED',
  reference: REFERENCE,
};

const memorizationQuery: NonNullable<OperationDoc['query']> = [
  ...reportQuery,
  { name: 'groupId', in: 'query', required: false, description: 'Optional: narrow the report to one group (the group of the memorization record, i.e. the group at the time).', schema: { type: 'string', format: 'uuid' }, example: GROUP_ID },
  { name: 'studentId', in: 'query', required: false, description: "Optional: narrow the report to one student (only that student's rows).", schema: { type: 'string', format: 'uuid' }, example: STUDENT_ID },
];

/** The JSON report is one PAGE of rows (standard list pagination, Master Specification: default 20, maximum 100). Same parameter contract as every list endpoint; the CSV and Excel files are complete exports and take no page. */
const memorizationJsonQuery: NonNullable<OperationDoc['query']> = [
  ...memorizationQuery,
  { name: 'page', in: 'query', required: false, description: 'Page of rows, starting at 1 (default 1). Not a positive integer: 400 `INVALID_PAGE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' }, example: '1' },
  { name: 'pageSize', in: 'query', required: false, description: 'Rows per page. Default 20. Values above 100 are capped at 100 (not rejected). Not a positive integer: 400 `INVALID_PAGE_SIZE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '20' }, example: '20' },
];

const memorizationCounts = {
  records: s.integer({ minimum: 0, description: 'Memorization records in the period: fulfilled + notFulfilled + unscheduled.', example: 20 }),
  fulfilled: s.integer({ minimum: 0, description: 'Records whose range is exactly the assigned range (the state Module 27 stored when the record was made).', example: 14 }),
  notFulfilled: s.integer({ minimum: 0, description: 'Records of a different range than the scheduled assignment.', example: 4 }),
  unscheduled: s.integer({ minimum: 0, description: 'Records made when nothing was scheduled for the student in that session.', example: 2 }),
};
const MEMORIZATION_COUNT_KEYS = ['records', 'fulfilled', 'notFulfilled', 'unscheduled'];

const memorizationRowSchema = s.object(
  {
    studentId: s.uuid({ example: STUDENT_ID }),
    studentName: s.string({ nullable: true, description: 'The student name, or null when it could not be read.', example: 'أحمد محمد علي' }),
    schoolId: s.uuid({ example: SCHOOL_ID }),
    schoolName: s.string({ nullable: true, example: 'مدرسة النور' }),
    groupId: s.uuid({ description: 'The group of the memorization record (the group at the time).', example: GROUP_ID }),
    groupName: s.string({ nullable: true, example: 'حلقة الفجر' }),
    ...memorizationCounts,
  },
  ['studentId', 'studentName', 'schoolId', 'schoolName', 'groupId', 'groupName', ...MEMORIZATION_COUNT_KEYS],
);

const memorizationSchema = s.object(
  {
    type: s.string({ enum: ['MEMORIZATION'] }),
    period: periodSchema,
    generatedAt: s.dateTime({ description: 'When the report was produced (UTC).', example: '2026-11-18T10:00:00.000Z' }),
    rows: s.array(memorizationRowSchema, { description: 'The rows of the requested page: one row per school, group and student (sorted by school, group, student).' }),
    totals: s.object({ ...memorizationCounts }, MEMORIZATION_COUNT_KEYS), // over ALL rows of the report, not only the page
  },
  ['type', 'period', 'generatedAt', 'rows', 'totals'],
);

const memorizationExample = {
  type: 'MEMORIZATION',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  rows: [{ studentId: STUDENT_ID, studentName: 'أحمد محمد علي', schoolId: SCHOOL_ID, schoolName: 'مدرسة النور', groupId: GROUP_ID, groupName: 'حلقة الفجر', records: 20, fulfilled: 14, notFulfilled: 4, unscheduled: 2 }],
  totals: { records: 20, fulfilled: 14, notFulfilled: 4, unscheduled: 2 },
};

const MEMORIZATION_DESCRIPTION =
  'The students\' memorization records counted per student and group (Master Specification §48, §65, §67, §68). Data only: counts by the fulfilment state Module 27 stored when each record was made (matched the assignment, did not match it, nothing was scheduled); no score, grade, rate or completion rule. Each row is one student in one group of one school; the group is the group of the record (the group at the time), so a student who changed groups has one row per group. A record belongs to the period of its session\'s scheduled start (Africa/Cairo). Student rows never include dates before the student joined (the later of the join date and the period start). History is kept: a corrected record counts with its current range (the original stays in Module 27\'s correction history). The JSON is paginated like every list (default 20 rows, maximum 100). The `csv` and `xlsx` variants return the SAME report (same scope, same period) as one complete file (no pagination).';

const REVISION_ENFORCEMENT =
  "Enforced by Module 37's reporting scope, computed on every request from the verified session (the user and the ACTIVE role): the role must be allowed the REVISION report and have a current, non-empty scope, otherwise 403 REPORT_NOT_ALLOWED. An Organization Manager reports on the students of the schools of the organizations they manage, a School Manager on the students of the schools they actively manage, a Teacher on the students of the groups they currently teach, a Parent on their own children only. A requested school, group or student outside that scope is 403 REPORT_SCOPE_FORBIDDEN (the same answer whether it exists or not); asking for a broader level than the role's own (for example a school as a Teacher) is refused the same way. Student rows start on the later of the student's join date and the period start, and show the group the student was in at the time. MAIN_ADMIN, the area managers (no area assignment exists yet), the Subscription Collector and Student have no REVISION report. This is not a Module 12 permission.";

const revisionReportAuthorization: AuthorizationDoc = {
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'TEACHER', 'PARENT'],
  scope: "The students of the schools of the caller's organizations (Organization Manager), of actively managed schools (School Manager), of the groups they currently teach (Teacher) or their own children (Parent); optionally narrowed with `schoolId`, `groupId` or `studentId` (each inside the scope).",
  enforcement: REVISION_ENFORCEMENT,
  permissionId: null,
  decision: 'APPROVED',
  reference: REFERENCE,
};

const revisionQuery: NonNullable<OperationDoc['query']> = [
  ...reportQuery,
  { name: 'groupId', in: 'query', required: false, description: 'Optional: narrow the report to one group (the group of the revision record, i.e. the group at the time).', schema: { type: 'string', format: 'uuid' }, example: GROUP_ID },
  { name: 'studentId', in: 'query', required: false, description: "Optional: narrow the report to one student (only that student's rows).", schema: { type: 'string', format: 'uuid' }, example: STUDENT_ID },
];

/** The JSON report is one PAGE of rows (standard list pagination, Master Specification: default 20, maximum 100). Same parameter contract as every list endpoint; the CSV and Excel files are complete exports and take no page. */
const revisionJsonQuery: NonNullable<OperationDoc['query']> = [
  ...revisionQuery,
  { name: 'page', in: 'query', required: false, description: 'Page of rows, starting at 1 (default 1). Not a positive integer: 400 `INVALID_PAGE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' }, example: '1' },
  { name: 'pageSize', in: 'query', required: false, description: 'Rows per page. Default 20. Values above 100 are capped at 100 (not rejected). Not a positive integer: 400 `INVALID_PAGE_SIZE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '20' }, example: '20' },
];

const revisionCounts = {
  records: s.integer({ minimum: 0, description: 'Revision records in the period: fulfilled + notFulfilled + unscheduled.', example: 20 }),
  fulfilled: s.integer({ minimum: 0, description: 'Records whose range is exactly the assigned range (the state Module 28 stored when the record was made).', example: 14 }),
  notFulfilled: s.integer({ minimum: 0, description: 'Records of a different range than the scheduled assignment.', example: 4 }),
  unscheduled: s.integer({ minimum: 0, description: 'Records made when nothing was scheduled for the student in that session.', example: 2 }),
};
const REVISION_COUNT_KEYS = ['records', 'fulfilled', 'notFulfilled', 'unscheduled'];

const revisionRowSchema = s.object(
  {
    studentId: s.uuid({ example: STUDENT_ID }),
    studentName: s.string({ nullable: true, description: 'The student name, or null when it could not be read.', example: 'أحمد محمد علي' }),
    schoolId: s.uuid({ example: SCHOOL_ID }),
    schoolName: s.string({ nullable: true, example: 'مدرسة النور' }),
    groupId: s.uuid({ description: 'The group of the revision record (the group at the time).', example: GROUP_ID }),
    groupName: s.string({ nullable: true, example: 'حلقة الفجر' }),
    ...revisionCounts,
  },
  ['studentId', 'studentName', 'schoolId', 'schoolName', 'groupId', 'groupName', ...REVISION_COUNT_KEYS],
);

const revisionSchema = s.object(
  {
    type: s.string({ enum: ['REVISION'] }),
    period: periodSchema,
    generatedAt: s.dateTime({ description: 'When the report was produced (UTC).', example: '2026-11-18T10:00:00.000Z' }),
    rows: s.array(revisionRowSchema, { description: 'The rows of the requested page: one row per school, group and student (sorted by school, group, student).' }),
    totals: s.object({ ...revisionCounts }, REVISION_COUNT_KEYS), // over ALL rows of the report, not only the page
  },
  ['type', 'period', 'generatedAt', 'rows', 'totals'],
);

const revisionExample = {
  type: 'REVISION',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  rows: [{ studentId: STUDENT_ID, studentName: 'أحمد محمد علي', schoolId: SCHOOL_ID, schoolName: 'مدرسة النور', groupId: GROUP_ID, groupName: 'حلقة الفجر', records: 20, fulfilled: 14, notFulfilled: 4, unscheduled: 2 }],
  totals: { records: 20, fulfilled: 14, notFulfilled: 4, unscheduled: 2 },
};

const REVISION_DESCRIPTION =
  'The students\' revision records counted per student and group (Master Specification §49, §65, §67, §68). Data only: counts by the fulfilment state Module 28 stored when each record was made (matched the assignment, did not match it, nothing was scheduled); no score, grade, rate or completion rule. Each row is one student in one group of one school; the group is the group of the record (the group at the time), so a student who changed groups has one row per group. A record belongs to the period of its session\'s scheduled start (Africa/Cairo). Student rows never include dates before the student joined (the later of the join date and the period start). History is kept: a corrected record counts with its current range (the original stays in Module 28\'s correction history). The JSON is paginated like every list (default 20 rows, maximum 100). The `csv` and `xlsx` variants return the SAME report (same scope, same period) as one complete file (no pagination).';


const EVALUATION_ENFORCEMENT =
  "Enforced by Module 37's reporting scope, computed on every request from the verified session (the user and the ACTIVE role): the role must be allowed the EVALUATION report and have a current, non-empty scope, otherwise 403 REPORT_NOT_ALLOWED. An Organization Manager reports on the students of the schools of the organizations they manage, a School Manager on the students of the schools they actively manage, a Teacher ONLY on the evaluations of their own sessions (Module 29: the Teacher reads the evaluations of sessions assigned to them only) for the groups they currently teach, a Parent on their own children only. A requested school, group or student outside that scope is 403 REPORT_SCOPE_FORBIDDEN (the same answer whether it exists or not); asking for a broader level than the role's own (for example a school as a Teacher) is refused the same way. Student rows start on the later of the student's join date and the period start, and show the group the student was in at the time. The Teacher's note is never part of the report. MAIN_ADMIN, the area managers (no area assignment exists yet), the Subscription Collector and Student have no EVALUATION report. This is not a Module 12 permission.";

const evaluationReportAuthorization: AuthorizationDoc = {
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'TEACHER', 'PARENT'],
  scope: "The students of the schools of the caller's organizations (Organization Manager), of actively managed schools (School Manager), of the groups they currently teach, only the evaluations they recorded (Teacher) or their own children (Parent); optionally narrowed with `schoolId`, `groupId` or `studentId` (each inside the scope).",
  enforcement: EVALUATION_ENFORCEMENT,
  permissionId: null,
  decision: 'APPROVED',
  reference: REFERENCE,
};

const evaluationQuery: NonNullable<OperationDoc['query']> = [
  ...reportQuery,
  { name: 'groupId', in: 'query', required: false, description: 'Optional: narrow the report to one group (the group of the evaluation record, i.e. the group at the time).', schema: { type: 'string', format: 'uuid' }, example: GROUP_ID },
  { name: 'studentId', in: 'query', required: false, description: "Optional: narrow the report to one student (only that student's rows).", schema: { type: 'string', format: 'uuid' }, example: STUDENT_ID },
];

/** The JSON report is one PAGE of rows (standard list pagination, Master Specification: default 20, maximum 100). Same parameter contract as every list endpoint; the CSV and Excel files are complete exports and take no page. */
const evaluationJsonQuery: NonNullable<OperationDoc['query']> = [
  ...evaluationQuery,
  { name: 'page', in: 'query', required: false, description: 'Page of rows, starting at 1 (default 1). Not a positive integer: 400 `INVALID_PAGE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' }, example: '1' },
  { name: 'pageSize', in: 'query', required: false, description: 'Rows per page. Default 20. Values above 100 are capped at 100 (not rejected). Not a positive integer: 400 `INVALID_PAGE_SIZE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '20' }, example: '20' },
];

const evaluationCategoryStatsSchema = s.object(
  {
    count: s.integer({ minimum: 0, description: 'How many evaluations in the period have a score in this category.', example: 12 }),
    average: s.number({ nullable: true, minimum: 0, maximum: 10, description: 'The arithmetic mean of those stored scores, rounded half up to two decimals; null when count is 0 (never a made-up zero).', example: 8.25 }),
  },
  ['count', 'average'],
);
const EVALUATION_CATEGORY_KEYS = ['MEMORIZATION', 'REVISION', 'PERFORMANCE', 'TAJWEED'];
const evaluationScoresSchema = s.object(
  {
    MEMORIZATION: evaluationCategoryStatsSchema,
    REVISION: evaluationCategoryStatsSchema,
    PERFORMANCE: evaluationCategoryStatsSchema,
    TAJWEED: evaluationCategoryStatsSchema,
  },
  EVALUATION_CATEGORY_KEYS,
);

const evaluationRowSchema = s.object(
  {
    studentId: s.uuid({ example: STUDENT_ID }),
    studentName: s.string({ nullable: true, description: 'The student name, or null when it could not be read.', example: 'أحمد محمد علي' }),
    schoolId: s.uuid({ example: SCHOOL_ID }),
    schoolName: s.string({ nullable: true, example: 'مدرسة النور' }),
    groupId: s.uuid({ description: 'The group of the evaluation (the group at the time).', example: GROUP_ID }),
    groupName: s.string({ nullable: true, example: 'حلقة الفجر' }),
    evaluations: s.integer({ minimum: 0, description: 'The number of evaluations (one per student per session) in the period.', example: 12 }),
    scores: evaluationScoresSchema,
  },
  ['studentId', 'studentName', 'schoolId', 'schoolName', 'groupId', 'groupName', 'evaluations', 'scores'],
);

const evaluationSchema = s.object(
  {
    type: s.string({ enum: ['EVALUATION'] }),
    period: periodSchema,
    generatedAt: s.dateTime({ description: 'When the report was produced (UTC).', example: '2026-11-18T10:00:00.000Z' }),
    rows: s.array(evaluationRowSchema, { description: 'The rows of the requested page: one row per school, group and student (sorted by school, group, student).' }),
    totals: s.object(
      { evaluations: s.integer({ minimum: 0, description: 'Evaluations over ALL rows of the report, not only the page.', example: 12 }), scores: evaluationScoresSchema },
      ['evaluations', 'scores'],
    ),
  },
  ['type', 'period', 'generatedAt', 'rows', 'totals'],
);

const evaluationExampleScores = {
  MEMORIZATION: { count: 12, average: 8.25 },
  REVISION: { count: 10, average: 7.5 },
  PERFORMANCE: { count: 12, average: 9 },
  TAJWEED: { count: 12, average: null },
};
const evaluationExample = {
  type: 'EVALUATION',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  rows: [{ studentId: STUDENT_ID, studentName: 'أحمد محمد علي', schoolId: SCHOOL_ID, schoolName: 'مدرسة النور', groupId: GROUP_ID, groupName: 'حلقة الفجر', evaluations: 12, scores: evaluationExampleScores }],
  totals: { evaluations: 12, scores: evaluationExampleScores },
};

const EVALUATION_DESCRIPTION =
  'The students\' evaluations per student and group (Master Specification §52, §65, §67, §68). Data only: how many evaluations, and for each category (Memorization, Revision, Performance, Tajweed) how many scores exist and their arithmetic mean, computed from the scores Module 29 stores (0.00 to 10.00), rounded half up to two decimals. Each category is independent: there is NO combined or overall score, no weighting, grade, rate or ranking, and the Teacher\'s note is never included. Each row is one student in one group of one school; the group is the group of the evaluation (the group at the time), so a student who changed groups has one row per group. An evaluation belongs to the period of its session\'s scheduled start (Africa/Cairo). Student rows never include dates before the student joined (the later of the join date and the period start). The current scores count (Module 29 keeps no score history). The JSON is paginated like every list (default 20 rows, maximum 100); `totals` cover every row. The `csv` and `xlsx` variants return the SAME report (same scope, same period) as one complete file (no pagination).';


const STUDENT_ENFORCEMENT =
  "Enforced by Module 37's reporting scope, computed on every request from the verified session (the user and the ACTIVE role): the role must be allowed the STUDENT report and have a current, non-empty scope, otherwise 403 REPORT_NOT_ALLOWED. The requested `studentId` is then proven inside the scope (404 is never used: a student outside the scope, or that does not exist, is 403 REPORT_SCOPE_FORBIDDEN): a student of the caller's organizations or actively managed schools, a student currently in a group the Teacher teaches, or the Parent's own child. MAIN_ADMIN and geographic managers are refused. The subscription section is returned only to the Organization Manager and the School Manager. A Teacher sees only the groups they currently teach in every section. The request never changes the student (an ARCHIVED or INACTIVE student can be reported).";

const studentReportAuthorization: AuthorizationDoc = {
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'TEACHER', 'PARENT'],
  scope: "ONE student: of the schools of the caller's organizations (Organization Manager), of actively managed schools (School Manager), currently in a group the Teacher teaches (Teacher, only those groups) or the Parent's own child (Parent). The subscription section only for the Organization Manager and the School Manager.",
  enforcement: STUDENT_ENFORCEMENT,
  permissionId: null,
  decision: 'APPROVED',
  reference: REFERENCE,
};

const studentQuery: NonNullable<OperationDoc['query']> = [
  ...reportQuery.filter((q) => q.name !== 'schoolId'),
  { name: 'studentId', in: 'query', required: true, description: 'The student the report is about (required; checked against the caller\'s scope).', schema: { type: 'string', format: 'uuid' }, example: STUDENT_ID },
];

/** The JSON report paginates ONLY the exam list (standard list pagination: default 20, maximum 100); the files are complete and take no page. */
const studentJsonQuery: NonNullable<OperationDoc['query']> = [
  ...studentQuery,
  { name: 'page', in: 'query', required: false, description: 'Page of the EXAM list, starting at 1 (default 1). Not a positive integer: 400 `INVALID_PAGE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' }, example: '1' },
  { name: 'pageSize', in: 'query', required: false, description: 'Exams per page. Default 20. Values above 100 are capped at 100 (not rejected). Not a positive integer: 400 `INVALID_PAGE_SIZE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '20' }, example: '20' },
];

const isoDate = (description: string, example: string, nullable = false) => s.string({ nullable, pattern: '^\\d{4}-\\d{2}-\\d{2}$', description, example });
const groupRef = { groupId: s.uuid({ description: 'The group of the record (the group at the time).', example: GROUP_ID }), groupName: s.string({ nullable: true, example: 'حلقة الفجر' }) };

const studentAttendanceCounts = {
  present: s.integer({ minimum: 0, example: 18 }),
  absent: s.integer({ minimum: 0, example: 2 }),
  total: s.integer({ minimum: 0, example: 20 }),
};
const studentRecordCounts = {
  records: s.integer({ minimum: 0, description: 'fulfilled + notFulfilled + unscheduled.', example: 20 }),
  fulfilled: s.integer({ minimum: 0, description: 'The recorded range matches the assigned range.', example: 15 }),
  notFulfilled: s.integer({ minimum: 0, description: 'A different range was recorded against a scheduled assignment.', example: 3 }),
  unscheduled: s.integer({ minimum: 0, description: 'Nothing was scheduled for the student in that session.', example: 2 }),
};
const STUDENT_RECORD_KEYS = ['records', 'fulfilled', 'notFulfilled', 'unscheduled'];
const studentRecordsSectionSchema = s.object(
  {
    rows: s.array(s.object({ ...groupRef, ...studentRecordCounts }, ['groupId', 'groupName', ...STUDENT_RECORD_KEYS]), { description: 'One row per group of the record (the group at the time).' }),
    totals: s.object(studentRecordCounts, STUDENT_RECORD_KEYS),
  },
  ['rows', 'totals'],
);

const studentExamRowSchema = s.object(
  {
    examId: s.uuid({ example: '5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f' }),
    examDate: isoDate("The exam's start date (Africa/Cairo business day); it decides which period the exam belongs to.", '2026-11-10'),
    startAt: s.dateTime({ description: "The exam's start instant (UTC).", example: '2026-11-10T07:00:00.000Z' }),
    ...groupRef,
    outcome: s.string({ enum: ['EXAMINED', 'ABSENT'], description: 'Only RECORDED outcomes are listed (a student whose outcome is not recorded yet has no row).' }),
    questionCount: s.integer({ minimum: 1, example: 5 }),
    maxScorePerQuestion: s.number({ minimum: 0, description: 'The uniform maximum score of every question of the exam.', example: 10 }),
    scores: s.array(s.number({ minimum: 0 }), { description: 'The recorded score of each question, in order. EMPTY when the outcome is ABSENT.' }),
    total: s.number({ nullable: true, minimum: 0, description: 'The recorded total as Module 30 stored it; null when the outcome is ABSENT. Never summed across exams.', example: 42.5 }),
    maxTotal: s.number({ minimum: 0, description: "The exam's own maximum total (question count x maximum per question).", example: 50 }),
  },
  ['examId', 'examDate', 'startAt', 'groupId', 'groupName', 'outcome', 'questionCount', 'maxScorePerQuestion', 'scores', 'total', 'maxTotal'],
);

const studentSubscriptionsSchema = s.object(
  {
    statusAsOf: s.dateTime({ description: 'When the statuses were read. They are the statuses recorded NOW, not a snapshot of the past.', example: '2026-11-18T10:00:00.000Z' }),
    rows: s.array(s.object({ month: s.string({ pattern: '^\\d{4}-\\d{2}$', description: 'Billing month `YYYY-MM` (Africa/Cairo).', example: '2026-11' }), status: s.string({ enum: ['PAID', 'UNPAID', 'WAIVED'] }) }, ['month', 'status']), {
      description: 'The months inside the period that are not before the student\'s join month, oldest first.',
    }),
    totals: s.object({ paid: s.integer({ minimum: 0 }), unpaid: s.integer({ minimum: 0 }), waived: s.integer({ minimum: 0 }), total: s.integer({ minimum: 0 }) }, ['paid', 'unpaid', 'waived', 'total']),
  },
  ['statusAsOf', 'rows', 'totals'],
  { description: 'ONLY for the Organization Manager and the School Manager; the key is absent for a Teacher or a Parent.' },
);

const studentSchema = s.object(
  {
    type: s.string({ enum: ['STUDENT'] }),
    period: periodSchema,
    generatedAt: s.dateTime({ description: 'When the report was produced (UTC).', example: '2026-11-18T10:00:00.000Z' }),
    student: s.object(
      {
        id: s.uuid({ example: STUDENT_ID }),
        name: s.string({ nullable: true, example: 'أحمد محمد علي' }),
        schoolId: s.uuid({ example: SCHOOL_ID }),
        schoolName: s.string({ nullable: true, example: 'مدرسة النور' }),
        joinDate: isoDate("The student's join date: nothing before it is ever reported.", '2026-09-15'),
      },
      ['id', 'name', 'schoolId', 'schoolName', 'joinDate'],
    ),
    effectiveStartDate: isoDate('MAX(join date, period start); null when the student joined after the period ended (every section is then empty).', '2026-11-01', true),
    sections: s.object(
      {
        attendance: s.object(
          {
            rows: s.array(s.object({ ...groupRef, ...studentAttendanceCounts }, ['groupId', 'groupName', 'present', 'absent', 'total'])),
            totals: s.object(studentAttendanceCounts, ['present', 'absent', 'total']),
          },
          ['rows', 'totals'],
        ),
        memorization: studentRecordsSectionSchema,
        revision: studentRecordsSectionSchema,
        evaluations: s.object(
          {
            rows: s.array(s.object({ ...groupRef, evaluations: s.integer({ minimum: 0, example: 12 }), scores: evaluationScoresSchema }, ['groupId', 'groupName', 'evaluations', 'scores'])),
            totals: s.object({ evaluations: s.integer({ minimum: 0, example: 12 }), scores: evaluationScoresSchema }, ['evaluations', 'scores']),
          },
          ['rows', 'totals'],
        ),
        examResults: s.object(
          {
            counts: s.object(
              {
                examined: s.integer({ minimum: 0, description: 'Exams the student was examined in (ALL exams of the report, not only the page).', example: 3 }),
                absent: s.integer({ minimum: 0, example: 1 }),
                total: s.integer({ minimum: 0, example: 4 }),
              },
              ['examined', 'absent', 'total'],
            ),
            rows: s.array(studentExamRowSchema, { description: 'The exams of the requested page, oldest first. The ONLY paginated part of the report.' }),
          },
          ['counts', 'rows'],
        ),
        subscriptions: studentSubscriptionsSchema,
        groupHistory: s.object(
          {
            rows: s.array(
              s.object(
                {
                  ...groupRef,
                  from: isoDate('First business date inside the effective window.', '2026-11-01'),
                  to: isoDate('Last business date of the period inside the window; null when it has no end inside an unbounded window.', '2026-11-18', true),
                  current: s.boolean({ description: 'True when the student is still in that group when the report is made.' }),
                },
                ['groupId', 'groupName', 'from', 'to', 'current'],
              ),
              { description: 'The student\'s group periods that overlap the effective window, clipped to it, oldest first. A Teacher sees only the groups they currently teach.' },
            ),
          },
          ['rows'],
        ),
      },
      ['attendance', 'memorization', 'revision', 'evaluations', 'examResults', 'groupHistory'],
    ),
  },
  ['type', 'period', 'generatedAt', 'student', 'effectiveStartDate', 'sections'],
);

const studentNoScores = { count: 0, average: null };
const studentExample = {
  type: 'STUDENT',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  student: { id: STUDENT_ID, name: 'أحمد محمد علي', schoolId: SCHOOL_ID, schoolName: 'مدرسة النور', joinDate: '2026-09-15' },
  effectiveStartDate: '2026-11-01',
  sections: {
    attendance: { rows: [{ groupId: GROUP_ID, groupName: 'حلقة الفجر', present: 18, absent: 2, total: 20 }], totals: { present: 18, absent: 2, total: 20 } },
    memorization: { rows: [{ groupId: GROUP_ID, groupName: 'حلقة الفجر', records: 20, fulfilled: 15, notFulfilled: 3, unscheduled: 2 }], totals: { records: 20, fulfilled: 15, notFulfilled: 3, unscheduled: 2 } },
    revision: { rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } },
    evaluations: { rows: [], totals: { evaluations: 0, scores: { MEMORIZATION: studentNoScores, REVISION: studentNoScores, PERFORMANCE: studentNoScores, TAJWEED: studentNoScores } } },
    examResults: {
      counts: { examined: 1, absent: 1, total: 2 },
      rows: [
        { examId: '5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f', examDate: '2026-11-10', startAt: '2026-11-10T07:00:00.000Z', groupId: GROUP_ID, groupName: 'حلقة الفجر', outcome: 'EXAMINED', questionCount: 5, maxScorePerQuestion: 10, scores: [9, 8.5, 10, 7, 8], total: 42.5, maxTotal: 50 },
        { examId: '6e7f8091-ab2c-4d3e-9f40-5b6c7d8e9fa0', examDate: '2026-11-15', startAt: '2026-11-15T07:00:00.000Z', groupId: GROUP_ID, groupName: 'حلقة الفجر', outcome: 'ABSENT', questionCount: 5, maxScorePerQuestion: 10, scores: [], total: null, maxTotal: 50 },
      ],
    },
    subscriptions: { statusAsOf: '2026-11-18T10:00:00.000Z', rows: [{ month: '2026-11', status: 'UNPAID' }], totals: { paid: 0, unpaid: 1, waived: 0, total: 1 } },
    groupHistory: { rows: [{ groupId: GROUP_ID, groupName: 'حلقة الفجر', from: '2026-11-01', to: '2026-11-18', current: true }] },
  },
};

const STUDENT_DESCRIPTION =
  "The report of ONE student (Master Specification §67, §68), data only, in seven sections: attendance, memorization, revision, evaluations, exam results, subscriptions and group history. The first four are exactly the ATTENDANCE, MEMORIZATION, REVISION and EVALUATION reports for that student (same counts, same effective start, same Teacher restrictions). Exam results list one row per exam the student has a recorded outcome in (EXAMINED with the recorded per-question scores and total, or ABSENT with no score); an exam belongs to the period by its start date (Africa/Cairo); nothing is summed across exams. Subscriptions (Organization Manager and School Manager only) show the billing months inside the period that are not before the join month, with the status recorded NOW. Group history lists the student's group periods inside the effective window (MAX(join date, period start)). No score, grade, percentage, ranking or weight is created. Only the exam list is paginated.";


const PARENT_ENFORCEMENT =
  "Enforced by Module 37's reporting scope, computed on every request from the verified session (the user and the ACTIVE role): the role must be allowed the PARENT report and have a current, non-empty scope, otherwise 403 REPORT_NOT_ALLOWED (only the Organization Manager, the School Manager and the Parent may run it; the Teacher, Collector, MAIN_ADMIN, geographic managers and Student are refused). A Parent's report is always their own: `parentId` may be omitted, and any other id is 403 REPORT_SCOPE_FORBIDDEN. A manager MUST send `parentId` (400 `REQUIRED_FIELD`) and the Parent must lie inside the manager's scope (a Parent outside it and a Parent that does not exist are the same 403 REPORT_SCOPE_FORBIDDEN, before any child is read); a manager only ever sees the children in the schools of their scope, even when the Parent has children elsewhere. Every child's report repeats the STUDENT report's authorization chain. ARCHIVED and INACTIVE children are included and their status is never shown. The subscription section is returned only to the Organization Manager and the School Manager; the Parent never receives it.";

const parentReportAuthorization: AuthorizationDoc = {
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'PARENT'],
  scope: "ONE Parent and their children: for the Organization Manager the children in the schools of the organizations they administer, for the School Manager the children in the schools they actively manage, for the Parent all their own children. The subscription section only for the two managers.",
  enforcement: PARENT_ENFORCEMENT,
  permissionId: null,
  decision: 'APPROVED',
  reference: REFERENCE,
};

const parentQuery: NonNullable<OperationDoc['query']> = [
  ...reportQuery.filter((q) => q.name !== 'schoolId'),
  { name: 'parentId', in: 'query', required: false, description: 'The Parent the report is about. REQUIRED for the Organization Manager and the School Manager; a Parent may omit it (their own account) and may only send their own id.', schema: { type: 'string', format: 'uuid' }, example: PARENT_ID },
];

/** The JSON report paginates the CHILDREN (standard list pagination: default 20, maximum 100); the files hold every child and take no page. */
const parentJsonQuery: NonNullable<OperationDoc['query']> = [
  ...parentQuery,
  { name: 'page', in: 'query', required: false, description: 'Page of the CHILDREN, starting at 1 (default 1). Not a positive integer: 400 `INVALID_PAGE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' }, example: '1' },
  { name: 'pageSize', in: 'query', required: false, description: 'Children per page. Default 20. Values above 100 are capped at 100 (not rejected). Not a positive integer: 400 `INVALID_PAGE_SIZE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '20' }, example: '20' },
];

const parentSchema = s.object(
  {
    type: s.string({ enum: ['PARENT'] }),
    period: periodSchema,
    generatedAt: s.dateTime({ description: 'When the report was produced (UTC).', example: '2026-11-18T10:00:00.000Z' }),
    parent: s.object(
      {
        id: s.uuid({ example: PARENT_ID }),
        name: s.string({ example: 'محمد علي حسن' }),
        children: s.array(s.object({ id: s.uuid({ example: STUDENT_ID }), name: s.string({ nullable: true, example: 'أحمد محمد علي' }) }, ['id', 'name']), {
          description: 'EVERY authorized child, ordered by name (never a lifecycle status). Not paginated.',
        }),
      },
      ['id', 'name', 'children'],
      { description: "The Parent header: the name and the children list only (no phone number, no address)." },
    ),
    childReports: s.array(ref('StudentReport'), { description: 'One complete STUDENT report per child of the requested page, in the order of `parent.children`. Every exam of every child is included.' }),
  },
  ['type', 'period', 'generatedAt', 'parent', 'childReports'],
);

const parentExample = {
  type: 'PARENT',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  parent: { id: PARENT_ID, name: 'محمد علي حسن', children: [{ id: STUDENT_ID, name: 'أحمد محمد علي' }] },
  childReports: [studentExample],
};

const PARENT_DESCRIPTION =
  "The report of ONE Parent and ALL their linked children (Master Specification §68: each child with a separate context), data only. `parent` is the name and the list of the authorized children; `childReports` holds, for each child of the requested page, that child's complete STUDENT report (attendance, memorization, revision, evaluations, exam results, group history and, for the Organization Manager and the School Manager only, subscriptions), with the same rules (group at the time, student effective start, no invented score). Only the children are paginated; each child's sections, including every exam, are returned whole.";


const GROUP_ENFORCEMENT =
  "Enforced by Module 37's reporting scope, computed on every request from the verified session (the user and the ACTIVE role): the role must be allowed the GROUP report and have a current, non-empty scope, otherwise 403 REPORT_NOT_ALLOWED (only the Organization Manager, the School Manager and the Teacher may run it; the Parent, Collector, MAIN_ADMIN, geographic managers and Student are refused). The requested `groupId` is proven inside the scope before anything is read (a group outside it and a group that does not exist are the same 403 REPORT_SCOPE_FORBIDDEN): a group of the schools of the caller's organizations, of the schools they actively manage, or, for a Teacher, a group they CURRENTLY teach. The four learning figures are the existing ATTENDANCE, MEMORIZATION, REVISION and EVALUATION reports for that group (so a Teacher only sees evaluations they recorded). No subscription, payment or other financial data is ever returned, for any role.";

const groupReportAuthorization: AuthorizationDoc = {
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'TEACHER'],
  scope: "ONE group: of the schools of the caller's organizations (Organization Manager), of actively managed schools (School Manager) or currently taught by the caller (Teacher). The Teacher's attendance section only for the two managers.",
  enforcement: GROUP_ENFORCEMENT,
  permissionId: null,
  decision: 'APPROVED',
  reference: REFERENCE,
};

const groupQuery: NonNullable<OperationDoc['query']> = [
  ...reportQuery.filter((q) => q.name !== 'schoolId'),
  { name: 'groupId', in: 'query', required: true, description: "The group the report is about (required; checked against the caller's scope).", schema: { type: 'string', format: 'uuid' }, example: GROUP_ID },
];

/** The JSON report paginates the STUDENTS of the roster (standard list pagination: default 20, maximum 100); the files hold every student and take no page. */
const groupJsonQuery: NonNullable<OperationDoc['query']> = [
  ...groupQuery,
  { name: 'page', in: 'query', required: false, description: 'Page of the STUDENT list, starting at 1 (default 1). Not a positive integer: 400 `INVALID_PAGE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' }, example: '1' },
  { name: 'pageSize', in: 'query', required: false, description: 'Students per page. Default 20. Values above 100 are capped at 100 (not rejected). Not a positive integer: 400 `INVALID_PAGE_SIZE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '20' }, example: '20' },
];

const groupAttendanceSchema = s.object(studentAttendanceCounts, ['present', 'absent', 'total']);
const groupRecordsSchema = s.object(studentRecordCounts, STUDENT_RECORD_KEYS);
const groupEvaluationSchema = s.object({ evaluations: s.integer({ minimum: 0, example: 12 }), scores: evaluationScoresSchema }, ['evaluations', 'scores'], {
  description: 'How many evaluations, and PER CATEGORY how many scores exist and their mean. No combined or overall score.',
});
const groupExamCountsSchema = s.object(
  { examined: s.integer({ minimum: 0, example: 3 }), absent: s.integer({ minimum: 0, example: 1 }), total: s.integer({ minimum: 0, example: 4 }) },
  ['examined', 'absent', 'total'],
  { description: 'Counts of recorded exam outcomes only (no exam score).' },
);

const groupSchema = s.object(
  {
    type: s.string({ enum: ['GROUP'] }),
    period: periodSchema,
    generatedAt: s.dateTime({ description: 'When the report was produced (UTC).', example: '2026-11-18T10:00:00.000Z' }),
    group: s.object(
      {
        id: s.uuid({ example: GROUP_ID }),
        name: s.string({ example: 'حلقة الفجر' }),
        schoolId: s.uuid({ example: SCHOOL_ID }),
        schoolName: s.string({ nullable: true, example: 'مدرسة النور' }),
        learningMode: s.string({ example: 'GROUP' }),
        status: s.string({ example: 'ACTIVE' }),
        teacherName: s.string({ nullable: true, description: "The current Teacher's name only (never a phone number).", example: 'محمود حسن علي' }),
      },
      ['id', 'name', 'schoolId', 'schoolName', 'learningMode', 'status', 'teacherName'],
    ),
    students: s.array(
      s.object(
        {
          studentId: s.uuid({ example: STUDENT_ID }),
          name: s.string({ example: 'أحمد محمد علي' }),
          effectiveStartDate: isoDate('MAX(join date, period start): nothing before it is reported for the student.', '2026-11-01'),
          attendance: groupAttendanceSchema,
          memorization: groupRecordsSchema,
          revision: groupRecordsSchema,
          evaluations: groupEvaluationSchema,
          exams: groupExamCountsSchema,
        },
        ['studentId', 'name', 'effectiveStartDate', 'attendance', 'memorization', 'revision', 'evaluations', 'exams'],
      ),
      { description: 'ONE PAGE of the roster: every student assigned to the group at any time inside their effective window (from the authoritative assignment history, with or without activity), ordered by name. The ONLY paginated part.' },
    ),
    totals: s.object(
      {
        students: s.integer({ minimum: 0, description: 'The size of the COMPLETE eligible roster.', example: 25 }),
        attendance: groupAttendanceSchema,
        memorization: groupRecordsSchema,
        revision: groupRecordsSchema,
        evaluations: groupEvaluationSchema,
        exams: groupExamCountsSchema,
      },
      ['students', 'attendance', 'memorization', 'revision', 'evaluations', 'exams'],
      { description: 'Over the COMPLETE roster, never just the page. Nothing is compared between students.' },
    ),
    teacherAttendance: s.object(studentAttendanceCounts, ['present', 'absent', 'total'], {
      description: "The group's Teacher attendance (existing authoritative attendance records). ONLY for the Organization Manager and the School Manager; the key is absent for a Teacher.",
    }),
  },
  ['type', 'period', 'generatedAt', 'group', 'students', 'totals'],
);

const groupNoScores = { count: 0, average: null };
const groupExample = {
  type: 'GROUP',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  group: { id: GROUP_ID, name: 'حلقة الفجر', schoolId: SCHOOL_ID, schoolName: 'مدرسة النور', learningMode: 'GROUP', status: 'ACTIVE', teacherName: 'محمود حسن علي' },
  students: [
    {
      studentId: STUDENT_ID, name: 'أحمد محمد علي', effectiveStartDate: '2026-11-01',
      attendance: { present: 18, absent: 2, total: 20 },
      memorization: { records: 20, fulfilled: 15, notFulfilled: 3, unscheduled: 2 },
      revision: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 },
      evaluations: { evaluations: 2, scores: { MEMORIZATION: { count: 2, average: 8.5 }, REVISION: groupNoScores, PERFORMANCE: groupNoScores, TAJWEED: groupNoScores } },
      exams: { examined: 1, absent: 1, total: 2 },
    },
  ],
  totals: {
    students: 1,
    attendance: { present: 18, absent: 2, total: 20 },
    memorization: { records: 20, fulfilled: 15, notFulfilled: 3, unscheduled: 2 },
    revision: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 },
    evaluations: { evaluations: 2, scores: { MEMORIZATION: { count: 2, average: 8.5 }, REVISION: groupNoScores, PERFORMANCE: groupNoScores, TAJWEED: groupNoScores } },
    exams: { examined: 1, absent: 1, total: 2 },
  },
  teacherAttendance: { present: 19, absent: 1, total: 20 },
};

const GROUP_DESCRIPTION =
  "The report of ONE group (Master Specification §68), data only. `students` is a page of the roster: every student assigned to the group at any time inside their effective window (from the authoritative assignment history, not the current roster; with or without activity; archived and inactive students included, the status never shown), each with attendance, memorization, revision, evaluation (per-category count and mean) and exam counts. `totals` cover the complete roster. `teacherAttendance` (Organization Manager and School Manager only) is the group's Teacher attendance. The four learning figures are exactly the ATTENDANCE, MEMORIZATION, REVISION and EVALUATION reports for the group; no overall score, ranking, weighting, comparison between students or financial datum is created or shown.";


const TEACHER_ENFORCEMENT =
  "Enforced by Module 37's reporting scope, computed on every request from the verified session (the user and the ACTIVE role): only the Organization Manager and the School Manager may run it, otherwise 403 REPORT_NOT_ALLOWED (a Teacher, even for themselves, the Parent, Collector, MAIN_ADMIN, geographic managers and Student are refused). EVERYTHING is limited to the requester's AUTHORIZED SCHOOLS (the schools of the organizations they administer, or the schools they actively manage), however many other schools the Teacher works in: schools, groups, attendance, students and statistics of any other school or organization are never read, counted, paginated, listed or exported, and their existence is not revealed. The Teacher must be currently linked to an authorized school or have taught a group of one at some time (a Teacher who left it keeps their history there); a Teacher outside that and a Teacher that does not exist are the same 403 REPORT_SCOPE_FORBIDDEN, before any report data is read. No financial data.";

const teacherReportAuthorization: AuthorizationDoc = {
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'],
  scope: "ONE Teacher, seen only through the caller's authorized schools: the schools of the organizations the Organization Manager administers, or the schools the School Manager actively manages.",
  enforcement: TEACHER_ENFORCEMENT,
  permissionId: null,
  decision: 'APPROVED',
  reference: REFERENCE,
};

const teacherQuery: NonNullable<OperationDoc['query']> = [
  ...reportQuery.filter((q) => q.name !== 'schoolId'),
  { name: 'teacherId', in: 'query', required: true, description: "The Teacher the report is about (required; checked against the caller's authorized schools).", schema: { type: 'string', format: 'uuid' }, example: TEACHER_ID },
];

/** The JSON report paginates the TAUGHT GROUPS of the authorized schools (standard list pagination: default 20, maximum 100); the files hold every entry and take no page. */
const teacherJsonQuery: NonNullable<OperationDoc['query']> = [
  ...teacherQuery,
  { name: 'page', in: 'query', required: false, description: 'Page of the TAUGHT-GROUP list, starting at 1 (default 1). Not a positive integer: 400 `INVALID_PAGE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' }, example: '1' },
  { name: 'pageSize', in: 'query', required: false, description: 'Entries per page. Default 20. Values above 100 are capped at 100 (not rejected). Not a positive integer: 400 `INVALID_PAGE_SIZE`.', schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '20' }, example: '20' },
];

const teacherSchema = s.object(
  {
    type: s.string({ enum: ['TEACHER'] }),
    period: periodSchema,
    generatedAt: s.dateTime({ description: 'When the report was produced (UTC).', example: '2026-11-18T10:00:00.000Z' }),
    teacher: s.object(
      {
        id: s.uuid({ example: TEACHER_ID }),
        name: s.string({ example: 'محمود حسن علي' }),
        schools: s.array(s.object({ id: s.uuid({ example: SCHOOL_ID }), name: s.string({ nullable: true, example: 'مدرسة النور' }) }, ['id', 'name']), {
          description: "The schools the Teacher is CURRENTLY linked to that lie inside the caller's authorized schools. A school outside them never appears, even if the Teacher works there.",
        }),
      },
      ['id', 'name', 'schools'],
      { description: 'The Teacher header: the name and those schools only (no phone number, no address).' },
    ),
    groups: s.array(
      s.object(
        {
          groupId: s.uuid({ example: GROUP_ID }),
          groupName: s.string({ example: 'حلقة الفجر' }),
          schoolId: s.uuid({ example: SCHOOL_ID }),
          schoolName: s.string({ nullable: true, example: 'مدرسة النور' }),
          learningMode: s.string({ example: 'GROUP' }),
          taughtFrom: isoDate('First day of the stint inside the period (the group history decides when the Teacher started).', '2026-11-01'),
          taughtTo: isoDate('Last day of the stint inside the period.', '2026-11-18'),
          stillTeaching: s.boolean({ description: 'The Teacher still teaches the group when the report is made (nothing in the group history ended the stint).' }),
          teacherAttendance: groupAttendanceSchema,
          students: s.integer({ minimum: 0, description: 'The roster size of the GROUP report for exactly the stint dates.', example: 25 }),
          attendance: groupAttendanceSchema,
          memorization: groupRecordsSchema,
          revision: groupRecordsSchema,
          evaluations: groupEvaluationSchema,
          exams: groupExamCountsSchema,
        },
        ['groupId', 'groupName', 'schoolId', 'schoolName', 'learningMode', 'taughtFrom', 'taughtTo', 'stillTeaching', 'teacherAttendance', 'students', 'attendance', 'memorization', 'revision', 'evaluations', 'exams'],
      ),
      { description: "ONE PAGE of the Teacher's stints in groups of the authorized schools (a group the Teacher left and came back to has one entry per stint). The ONLY paginated part; nothing is combined across groups or schools." },
    ),
  },
  ['type', 'period', 'generatedAt', 'teacher', 'groups'],
);

const teacherExample = {
  type: 'TEACHER',
  period: { kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' },
  generatedAt: '2026-11-18T10:00:00.000Z',
  teacher: { id: TEACHER_ID, name: 'محمود حسن علي', schools: [{ id: SCHOOL_ID, name: 'مدرسة النور' }] },
  groups: [
    {
      groupId: GROUP_ID, groupName: 'حلقة الفجر', schoolId: SCHOOL_ID, schoolName: 'مدرسة النور', learningMode: 'GROUP', taughtFrom: '2026-11-01', taughtTo: '2026-11-18', stillTeaching: true,
      teacherAttendance: { present: 9, absent: 1, total: 10 }, students: 25,
      attendance: { present: 180, absent: 20, total: 200 },
      memorization: { records: 120, fulfilled: 90, notFulfilled: 20, unscheduled: 10 },
      revision: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 },
      evaluations: { evaluations: 2, scores: { MEMORIZATION: { count: 2, average: 8.5 }, REVISION: { count: 0, average: null }, PERFORMANCE: { count: 0, average: null }, TAJWEED: { count: 0, average: null } } },
      exams: { examined: 20, absent: 5, total: 25 },
    },
  ],
};

const TEACHER_DESCRIPTION =
  "The report of ONE Teacher (Master Specification §68), data only, seen ONLY through the caller's authorized schools. `teacher` is the name and the authorized schools the Teacher is currently linked to. `groups` lists, for every stint in which the Teacher taught a group of those schools inside the period (taken from the groups' authoritative history: the first teacher at creation and every TEACHER_CHANGED, never from who owns the group now), the Teacher's own attendance and the GROUP report's figures (roster size, attendance, memorization, revision, evaluation per category, exam counts) for exactly the stint's dates. No score, ranking or comparison between teachers, groups or schools, and no financial datum, is created or shown.";


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
  {
    method: 'get',
    path: '/memorization',
    operationId: 'getMemorizationReport',
    summary: 'The MEMORIZATION report',
    description: MEMORIZATION_DESCRIPTION,
    authorization: memorizationReportAuthorization,
    query: memorizationJsonQuery,
    success: { status: 200, description: 'One page of the report. Beside `data`, the standard envelope carries `meta`: `{ page, pageSize, total, totalPages }`, where `total` is the number of rows of the WHOLE report. `data.totals` always cover every row, not only this page.', data: ref('MemorizationReport'), example: memorizationExample },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/memorization/csv',
    operationId: 'downloadMemorizationReportCsv',
    summary: 'The MEMORIZATION report as a CSV file',
    description: `${MEMORIZATION_DESCRIPTION} Headers are in the language of the request (Arabic by default); the file is UTF-8 with a byte order mark so Excel reads Arabic correctly.`,
    authorization: memorizationReportAuthorization,
    query: memorizationQuery,
    success: { status: 200, description: 'The CSV file (binary).', binary: { contentType: CSV_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/memorization/xlsx',
    operationId: 'downloadMemorizationReportXlsx',
    summary: 'The MEMORIZATION report as an Excel file',
    description: `${MEMORIZATION_DESCRIPTION} Headers are in the language of the request (Arabic by default; Arabic sheets read right to left).`,
    authorization: memorizationReportAuthorization,
    query: memorizationQuery,
    success: { status: 200, description: 'The .xlsx file (binary).', binary: { contentType: XLSX_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/revision',
    operationId: 'getRevisionReport',
    summary: 'The REVISION report',
    description: REVISION_DESCRIPTION,
    authorization: revisionReportAuthorization,
    query: revisionJsonQuery,
    success: { status: 200, description: 'One page of the report. Beside `data`, the standard envelope carries `meta`: `{ page, pageSize, total, totalPages }`, where `total` is the number of rows of the WHOLE report. `data.totals` always cover every row, not only this page.', data: ref('RevisionReport'), example: revisionExample },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/revision/csv',
    operationId: 'downloadRevisionReportCsv',
    summary: 'The REVISION report as a CSV file',
    description: `${REVISION_DESCRIPTION} Headers are in the language of the request (Arabic by default); the file is UTF-8 with a byte order mark so Excel reads Arabic correctly.`,
    authorization: revisionReportAuthorization,
    query: revisionQuery,
    success: { status: 200, description: 'The CSV file (binary).', binary: { contentType: CSV_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/revision/xlsx',
    operationId: 'downloadRevisionReportXlsx',
    summary: 'The REVISION report as an Excel file',
    description: `${REVISION_DESCRIPTION} Headers are in the language of the request (Arabic by default; Arabic sheets read right to left).`,
    authorization: revisionReportAuthorization,
    query: revisionQuery,
    success: { status: 200, description: 'The .xlsx file (binary).', binary: { contentType: XLSX_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/evaluation',
    operationId: 'getEvaluationReport',
    summary: 'The EVALUATION report',
    description: EVALUATION_DESCRIPTION,
    authorization: evaluationReportAuthorization,
    query: evaluationJsonQuery,
    success: { status: 200, description: 'One page of the report. Beside `data`, the standard envelope carries `meta`: `{ page, pageSize, total, totalPages }`, where `total` is the number of rows of the WHOLE report. `data.totals` always cover every row, not only this page.', data: ref('EvaluationReport'), example: evaluationExample },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/evaluation/csv',
    operationId: 'downloadEvaluationReportCsv',
    summary: 'The EVALUATION report as a CSV file',
    description: `${EVALUATION_DESCRIPTION} Headers are in the language of the request (Arabic by default); the file is UTF-8 with a byte order mark so Excel reads Arabic correctly.`,
    authorization: evaluationReportAuthorization,
    query: evaluationQuery,
    success: { status: 200, description: 'The CSV file (binary).', binary: { contentType: CSV_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/evaluation/xlsx',
    operationId: 'downloadEvaluationReportXlsx',
    summary: 'The EVALUATION report as an Excel file',
    description: `${EVALUATION_DESCRIPTION} Headers are in the language of the request (Arabic by default; Arabic sheets read right to left).`,
    authorization: evaluationReportAuthorization,
    query: evaluationQuery,
    success: { status: 200, description: 'The .xlsx file (binary).', binary: { contentType: XLSX_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/student',
    operationId: 'getStudentReport',
    summary: 'The STUDENT report of one student',
    description: STUDENT_DESCRIPTION,
    authorization: studentReportAuthorization,
    query: studentJsonQuery,
    success: { status: 200, description: 'The report. Beside `data`, the standard envelope carries `meta`: `{ page, pageSize, total, totalPages }` for the EXAM list, where `total` is the number of exams of the whole report. Every other section is complete.', data: ref('StudentReport'), example: studentExample },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/student/csv',
    operationId: 'downloadStudentReportCsv',
    summary: 'The STUDENT report as a CSV file',
    description: `${STUDENT_DESCRIPTION} The file is ONE table with the columns section, student, group, item, measure, value (one row per measure); the subscription rows exist only when the report has that section. Headers are in the language of the request (Arabic by default); UTF-8 with a byte order mark so Excel reads Arabic correctly. The file holds every exam.`,
    authorization: studentReportAuthorization,
    query: studentQuery,
    success: { status: 200, description: 'The CSV file (binary).', binary: { contentType: CSV_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/student/xlsx',
    operationId: 'downloadStudentReportXlsx',
    summary: 'The STUDENT report as an Excel file',
    description: `${STUDENT_DESCRIPTION} One worksheet per section the caller may see (up to seven; no subscriptions sheet for a Teacher or a Parent). Headers are in the language of the request (Arabic by default; Arabic sheets read right to left). The file holds every exam.`,
    authorization: studentReportAuthorization,
    query: studentQuery,
    success: { status: 200, description: 'The .xlsx file (binary).', binary: { contentType: XLSX_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/parent',
    operationId: 'getParentReport',
    summary: 'The PARENT report of one Parent and their children',
    description: PARENT_DESCRIPTION,
    authorization: parentReportAuthorization,
    query: parentJsonQuery,
    success: { status: 200, description: 'The report. Beside `data`, the standard envelope carries `meta`: `{ page, pageSize, total, totalPages }` for the CHILDREN, where `total` is the number of authorized children. `data.parent.children` always lists all of them.', data: ref('ParentReport'), example: parentExample },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/parent/csv',
    operationId: 'downloadParentReportCsv',
    summary: 'The PARENT report as a CSV file',
    description: `${PARENT_DESCRIPTION} The file is ONE table with the columns section, student, group, item, measure, value: a short Parent section first (the Parent's name and the children), then every child's rows (the student column says whose). Headers are in the language of the request (Arabic by default); UTF-8 with a byte order mark so Excel reads Arabic correctly. The file holds EVERY authorized child, not just a page.`,
    authorization: parentReportAuthorization,
    query: parentQuery,
    success: { status: 200, description: 'The CSV file (binary).', binary: { contentType: CSV_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/parent/xlsx',
    operationId: 'downloadParentReportXlsx',
    summary: 'The PARENT report as an Excel file',
    description: `${PARENT_DESCRIPTION} One worksheet per section the caller may see (up to seven; no subscriptions sheet for a Parent), each holding the rows of every child (the first column is the child). Headers are in the language of the request (Arabic by default; Arabic sheets read right to left). The file holds EVERY authorized child, not just a page.`,
    authorization: parentReportAuthorization,
    query: parentQuery,
    success: { status: 200, description: 'The .xlsx file (binary).', binary: { contentType: XLSX_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/group',
    operationId: 'getGroupReport',
    summary: 'The GROUP report of one group',
    description: GROUP_DESCRIPTION,
    authorization: groupReportAuthorization,
    query: groupJsonQuery,
    success: { status: 200, description: 'The report. Beside `data`, the standard envelope carries `meta`: `{ page, pageSize, total, totalPages }` for the STUDENT list, where `total` is the size of the complete eligible roster. `data.totals` always covers the whole roster.', data: ref('GroupReport'), example: groupExample },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/group/csv',
    operationId: 'downloadGroupReportCsv',
    summary: 'The GROUP report as a CSV file',
    description: `${GROUP_DESCRIPTION} The file is ONE table with the columns section, student, group, item, measure, value: a short Group section first, then one row per measure for every student, the totals (student column = Total) and, for the two managers, the Teacher's attendance. Headers are in the language of the request (Arabic by default); UTF-8 with a byte order mark so Excel reads Arabic correctly. The file holds EVERY student of the roster, not just a page.`,
    authorization: groupReportAuthorization,
    query: groupQuery,
    success: { status: 200, description: 'The CSV file (binary).', binary: { contentType: CSV_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/group/xlsx',
    operationId: 'downloadGroupReportXlsx',
    summary: 'The GROUP report as an Excel file',
    description: `${GROUP_DESCRIPTION} One worksheet per section (attendance, memorization, revision, evaluations, exam counts and, for the two managers, the Teacher's attendance), with a row per student and a totals row. Headers are in the language of the request (Arabic by default; Arabic sheets read right to left). The file holds EVERY student of the roster, not just a page.`,
    authorization: groupReportAuthorization,
    query: groupQuery,
    success: { status: 200, description: 'The .xlsx file (binary).', binary: { contentType: XLSX_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/teacher',
    operationId: 'getTeacherReport',
    summary: 'The TEACHER report of one teacher',
    description: TEACHER_DESCRIPTION,
    authorization: teacherReportAuthorization,
    query: teacherJsonQuery,
    success: { status: 200, description: "The report. Beside `data`, the standard envelope carries `meta`: `{ page, pageSize, total, totalPages }` for the TAUGHT-GROUP list, where `total` counts only the entries of the caller's authorized schools.", data: ref('TeacherReport'), example: teacherExample },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/teacher/csv',
    operationId: 'downloadTeacherReportCsv',
    summary: 'The TEACHER report as a CSV file',
    description: `${TEACHER_DESCRIPTION} The file is ONE table with the columns section, student, group, item, measure, value: a short Teacher section first, then one row per measure for every stint (the group column holds the group, the item column the school and the stint's dates; the student column is empty). Headers are in the language of the request (Arabic by default); UTF-8 with a byte order mark so Excel reads Arabic correctly. The file holds EVERY entry of the authorized schools, not just a page.`,
    authorization: teacherReportAuthorization,
    query: teacherQuery,
    success: { status: 200, description: 'The CSV file (binary).', binary: { contentType: CSV_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
  {
    method: 'get',
    path: '/teacher/xlsx',
    operationId: 'downloadTeacherReportXlsx',
    summary: 'The TEACHER report as an Excel file',
    description: `${TEACHER_DESCRIPTION} One worksheet per section (groups taught, teacher attendance, attendance, memorization, revision, evaluations, exam counts), a row per stint whose first columns are the school, the group and the dates. Headers are in the language of the request (Arabic by default; Arabic sheets read right to left). The file holds EVERY entry of the authorized schools, not just a page.`,
    authorization: teacherReportAuthorization,
    query: teacherQuery,
    success: { status: 200, description: 'The .xlsx file (binary).', binary: { contentType: XLSX_MIME } },
    errors: [PERIOD_ERRORS, FORBIDDEN],
  },
];

/** OpenAPI contract of `/reports` (`report-routes.ts`). Module 38: report modules (slices 1-8: PAYMENT, ATTENDANCE, MEMORIZATION, REVISION, EVALUATION, STUDENT, PARENT, GROUP and TEACHER). */
export const reportApiDoc: ModuleApiDoc = {
  moduleId: '38',
  mountPath: '/reports',
  tag: {
    name: 'Reports',
    description:
      'Read-only reports (Master Specification §66-§70). Every report is computed inside the caller\'s own reporting scope (Module 37), from the owning modules\' public contracts, with a mandatory period. JSON first; CSV and Excel files return the same report. Slices 1-8 provide the PAYMENT, ATTENDANCE, MEMORIZATION, REVISION, EVALUATION, STUDENT, PARENT, GROUP and TEACHER reports.',
  },
  operations,
  schemas: { PaymentReport: reportSchema, AttendanceReport: attendanceSchema, MemorizationReport: memorizationSchema, RevisionReport: revisionSchema, EvaluationReport: evaluationSchema, StudentReport: studentSchema, ParentReport: parentSchema, GroupReport: groupSchema, TeacherReport: teacherSchema },
};
