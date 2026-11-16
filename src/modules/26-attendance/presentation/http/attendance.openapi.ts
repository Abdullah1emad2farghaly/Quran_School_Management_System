import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { AttendancePermissions } from '../../application/services/attendance-authorization';
import { ACTOR_ROLES, ATTENDANCE_STATUSES, MAX_BATCH_RECORDS, MAX_REASON_LENGTH, SUBJECT_TYPES } from '../../domain/value-objects/attendance-status';
import { ATTENDANCE_LIST_SPEC } from './attendance-routes';

const SESSION_ID = '5d2a8c41-7b36-4e09-9f15-a3c6e1d08b72';
const GROUP_ID = '4c9e1b72-3a58-4d06-9b17-e2f8a0d5c613';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const TEACHER_ID = '7e1c4a95-2d68-4b03-8f27-c9a0d5e3b164';
const STUDENT_ID = '2b8d4f16-9c57-4a30-8e62-d1f7a3c05b98';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const RECORD_ID = 'c8e2a7d4-1f95-4b36-a0c3-7d5e9b2f4a61';
const WHEN = '2026-11-02T16:05:00.000Z';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Attendance 26); docs/ATTENDANCE.md; Master Specification section 51';

const recordSchema = s.object(
  {
    id: s.uuid(),
    sessionId: s.uuid(),
    schoolId: s.uuid(),
    groupId: s.uuid(),
    subjectType: s.string({ enum: SUBJECT_TYPES, description: 'STUDENT, or TEACHER for the session\'s Teacher.' }),
    subjectId: s.uuid({ description: 'The Student id, or the Teacher id.' }),
    status: s.string({ enum: ATTENDANCE_STATUSES }),
    occurrenceDate: s.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The session\'s calendar date in the business zone (Africa/Cairo).', example: '2026-11-02' }),
    scheduledStart: s.dateTime({ description: 'The session\'s scheduled start (UTC).' }),
    recordedBy: s.uuid({ description: 'The user who made the first marking.' }),
    recordedByRole: s.string({ enum: ACTOR_ROLES }),
    recordedAt: s.dateTime(),
    updatedBy: s.uuid({ description: 'The user who last changed the status (the same as recordedBy until a correction).' }),
    updatedByRole: s.string({ enum: ACTOR_ROLES }),
    updatedAt: s.dateTime(),
  },
  ['id', 'sessionId', 'schoolId', 'groupId', 'subjectType', 'subjectId', 'status', 'occurrenceDate', 'scheduledStart', 'recordedBy', 'recordedByRole', 'recordedAt', 'updatedBy', 'updatedByRole', 'updatedAt'],
);

const batchSchema = s.object(
  {
    sessionId: s.uuid(),
    results: s.array(
      s.object(
        {
          subjectId: s.uuid(),
          outcome: s.string({ enum: ['RECORDED', 'CORRECTED', 'UNCHANGED'], description: 'RECORDED: first marking. CORRECTED: an existing record changed status (history entry written, reason required). UNCHANGED: the same status was sent again; nothing changed.' }),
          record: ref('AttendanceRecord'),
        },
        ['subjectId', 'outcome', 'record'],
      ),
    ),
  },
  ['sessionId', 'results'],
);

const sessionAttendanceSchema = s.object(
  {
    sessionId: s.uuid(),
    teacher: s.nullableRef('AttendanceRecord'),
    students: s.array(ref('AttendanceRecord'), { description: 'Only the students that have a record. A student without a record is UNMARKED: nothing ever marks a student automatically.' }),
  },
  ['sessionId', 'teacher', 'students'],
);

const recordExample = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: RECORD_ID, sessionId: SESSION_ID, schoolId: SCHOOL_ID, groupId: GROUP_ID, subjectType: 'STUDENT', subjectId: STUDENT_ID, status: 'PRESENT', occurrenceDate: '2026-11-02',
  scheduledStart: '2026-11-02T16:00:00.000Z', recordedBy: USER_ID, recordedByRole: 'TEACHER', recordedAt: WHEN, updatedBy: USER_ID, updatedByRole: 'TEACHER', updatedAt: WHEN, ...over,
});
const batchExample = (outcome = 'RECORDED', record: Record<string, unknown> = recordExample()): Record<string, unknown> => ({ sessionId: SESSION_ID, results: [{ subjectId: record.subjectId, outcome, record }] });

const GPS_DOC = s.object(
  { latitude: s.number({ example: 30.0444 }), longitude: s.number({ example: 31.2357 }), accuracyMeters: s.number({ example: 8 }) },
  [],
  { description: 'The Teacher\'s GPS reading. REQUIRED by Smart Guard: sending none gives 400 SMART_GUARD_GPS_REQUIRED, and an invalid one 400 SMART_GUARD_GPS_INVALID (not enforced by the schema so that those codes are returned). Must be within 50 m of the school and accurate to 20 m or better. No fallback exists.' },
);
const reasonField = s.string({ maxLength: MAX_REASON_LENGTH, example: 'سُجّل خطأً', description: 'Required ONLY when an existing record changes status (a correction): non-empty, at most 500 characters. Not needed for a first marking.' });
const statusField = s.string({ enum: ATTENDANCE_STATUSES, example: 'ABSENT' });

const idParam = { id: { description: 'The session id.', example: SESSION_ID, schema: s.uuid() } };
const studentParam = { studentId: { description: 'The student id.', example: STUDENT_ID, schema: s.uuid() } };

const NOT_ALLOWED: ErrorDoc = {
  status: 403,
  codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED', 'SMART_GUARD_NOT_SESSION_TEACHER', 'ATTENDANCE_READ_NOT_ALLOWED'],
  description: 'The caller lacks the permission or the scope (no reason is given; a group or student that does not exist is also 403), or must first change the initial password. SMART_GUARD_NOT_SESSION_TEACHER: the caller is not the Teacher assigned to the session. ATTENDANCE_READ_NOT_ALLOWED: only the session\'s Teacher or the School Manager of its school read a session\'s attendance.',
};
const sessionNotFound: ErrorDoc = { status: 404, codes: ['CLASS_SESSION_NOT_FOUND'], description: 'The session does not exist.' };
const concurrent: ErrorDoc = { status: 409, codes: ['ATTENDANCE_CONCURRENT_CHANGE'], description: 'Another request changed the same record at the same time (after automatic retries). Try again.' };
const validation400 = (extra: string[] = []): ErrorDoc => ({
  status: 400,
  codes: ['ATTENDANCE_RECORDS_REQUIRED', 'ATTENDANCE_TOO_MANY_RECORDS', 'ATTENDANCE_INVALID_RECORD', 'ATTENDANCE_INVALID_STATUS', 'ATTENDANCE_DUPLICATE_STUDENT', 'ATTENDANCE_CORRECTION_REASON_REQUIRED', 'ATTENDANCE_REASON_TOO_LONG', ...extra],
  description: 'The request is invalid. ATTENDANCE_CORRECTION_REASON_REQUIRED: an existing record would change status and no non-empty reason was given (the whole request is rejected).',
});
const business422 = (codes: string[], description: string): ErrorDoc => ({ status: 422, codes, description });

const teacherAuth = (permissionId: string, scope: string): AuthorizationDoc => ({
  authentication: 'required',
  roles: ['TEACHER'],
  scope,
  enforcement: 'Authorization Engine permission with the MANAGEMENT/GROUP scope resolver (Module 20; the group is loaded server-side through the session), then Smart Guard (Module 25: ownership of the session, the time window, GPS distance and accuracy, session not cancelled).',
  permissionId,
  decision: 'APPROVED',
  reference: REFERENCE,
});
const managerAuth: AuthorizationDoc = {
  authentication: 'required',
  roles: ['SCHOOL_MANAGER'],
  scope: 'The school of the session\'s group (loaded server-side through the session).',
  enforcement: 'Authorization Engine permission with the MANAGEMENT/GROUP scope resolver (Module 20). NO GPS and NO time window: a School Manager may record or correct at any time (but never for a cancelled session).',
  permissionId: AttendancePermissions.CORRECT,
  decision: 'APPROVED',
  reference: REFERENCE,
};
const op = (o: OperationDoc): OperationDoc => o;

/** OpenAPI contract of `/attendance` (`attendance-routes.ts`). Module 26: attendance. */
export const attendanceApiDoc: ModuleApiDoc = {
  moduleId: '26',
  mountPath: '/attendance',
  tag: {
    name: 'Attendance',
    description:
      `PRESENT or ABSENT for each student and for the Teacher of a class session, unique per session and subject. The session\'s Teacher records students in one atomic batch with ONE GPS reading through Smart Guard (at most ${MAX_BATCH_RECORDS} students; only students currently assigned to the group) and checks themself in as PRESENT. Students nobody marks stay UNMARKED: students are never marked automatically. ONE automatic rule exists, for the Teacher only: a Teacher who has not recorded their attendance when the session is COMPLETED, or who cancels the session, is recorded ABSENT by the system (actor role SYSTEM). The School Manager may record or correct at any time without GPS. The first marking needs no reason; CHANGING an existing record is a correction that needs a non-empty reason and is kept in an append-only history. Cancelled sessions accept no attendance. Records are never deleted.`,
  },
  schemas: { AttendanceRecord: recordSchema, AttendanceBatchResult: batchSchema, SessionAttendance: sessionAttendanceSchema },
  operations: [
    op({
      method: 'get', path: '/students/:id', operationId: 'listStudentAttendance', summary: 'A student\'s attendance',
      description: 'A paginated list of the student\'s attendance records, by the session\'s start, newest first by default. Read access: the **School Manager** of the student\'s school and the student\'s own **Parent** (linked children only). A Teacher reads attendance through their own sessions; a Student has no direct attendance read access.',
      authorization: { authentication: 'required', roles: ['SCHOOL_MANAGER', 'PARENT'], scope: 'SCHOOL_MANAGER: the student\'s school. PARENT: only their own linked children.', enforcement: 'Authorization Engine permission with the role-aware MANAGEMENT/STUDENT scope resolver (Module 19), which answers true only on positive proof for the role being checked.', permissionId: AttendancePermissions.READ_STUDENT, decision: 'APPROVED', reference: REFERENCE },
      pathParams: { id: { description: 'The student id.', example: STUDENT_ID, schema: s.uuid() } },
      query: listQueryParameters(ATTENDANCE_LIST_SPEC),
      success: { status: 200, description: 'A page of the student\'s attendance records.', paginated: true, data: ref('AttendanceRecord'), example: recordExample() },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/sessions/:id', operationId: 'getSessionAttendance', summary: 'The attendance of a session',
      description: 'The Teacher\'s record and the students\' records of a session. Only students with a record are listed (the others are unmarked). Read access: the **School Manager** of the school and the **Teacher assigned to the session**.',
      authorization: { authentication: 'required', roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'SCHOOL_MANAGER: the school. TEACHER: the ACTIVE group they teach; the application further requires that the session is assigned to them.', enforcement: 'Authorization Engine permission with the MANAGEMENT/GROUP scope resolver (Module 20), then the application check (the session\'s Teacher or the school\'s School Manager).', permissionId: AttendancePermissions.READ_SESSION, decision: 'APPROVED', reference: REFERENCE },
      pathParams: idParam,
      success: { status: 200, description: 'The session\'s attendance.', data: ref('SessionAttendance'), example: { sessionId: SESSION_ID, teacher: recordExample({ subjectType: 'TEACHER', subjectId: TEACHER_ID }), students: [recordExample()] } },
      errors: [NOT_ALLOWED, sessionNotFound],
    }),
    op({
      method: 'post', path: '/sessions/:id/students', operationId: 'recordStudentAttendance', summary: 'Record students\' attendance (assigned Teacher)',
      description: 'The Teacher assigned to the session records or corrects the attendance of several students in ONE ATOMIC batch with ONE GPS reading: either every record is accepted or the whole request is rejected. Protected by Smart Guard (ownership of the session, from 15 minutes before the start through the scheduled end inclusive, within 50 m of the school with GPS accuracy of 20 m or better, session not cancelled). Only students currently assigned to the session\'s group can be included, each at most once. A student without a record is created (RECORDED, no reason needed); an existing record with a different status is a correction (CORRECTED, a non-empty `reason` for that student is required, previous value kept in the history); the same status changes nothing (UNCHANGED).',
      authorization: teacherAuth(AttendancePermissions.RECORD_STUDENTS, 'The ACTIVE group of the session (loaded server-side through the session) the caller teaches; plus Smart Guard.'),
      pathParams: idParam,
      request: {
        description: `The GPS reading and 1 to ${MAX_BATCH_RECORDS} student records.`,
        schema: s.object(
          {
            gps: GPS_DOC,
            records: s.array(s.object({ studentId: s.uuid({ example: STUDENT_ID }), status: statusField, reason: reasonField }, ['studentId', 'status'])),
          },
          ['records'],
        ),
        examples: { first: { summary: 'First marking', value: { gps: { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 }, records: [{ studentId: STUDENT_ID, status: 'PRESENT' }] } } },
      },
      success: { status: 200, description: 'One result per submitted student, in the order submitted.', data: ref('AttendanceBatchResult'), example: batchExample() },
      errors: [
        validation400(['SMART_GUARD_GPS_REQUIRED', 'SMART_GUARD_GPS_INVALID']),
        NOT_ALLOWED,
        sessionNotFound,
        business422(['SMART_GUARD_OUTSIDE_SESSION_WINDOW', 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', 'SMART_GUARD_GPS_ACCURACY_TOO_LOW', 'SMART_GUARD_SESSION_CANCELLED', 'SMART_GUARD_SCHOOL_NOT_ACTIVE', 'ATTENDANCE_SESSION_CANCELLED', 'ATTENDANCE_STUDENT_NOT_IN_GROUP'], 'Smart Guard refused the action (time window, distance, accuracy, cancelled session, school not active), or a submitted student is not currently assigned to the group (`details.studentIds`).'),
        concurrent,
      ],
    }),
    op({
      method: 'post', path: '/sessions/:id/teacher/check-in', operationId: 'checkInTeacher', summary: 'Teacher checks in (PRESENT)',
      description: 'The Teacher assigned to the session records their OWN attendance as PRESENT, through Smart Guard with one GPS reading. The check-in window ends with the session: a Teacher who has not checked in when the session is COMPLETED is recorded ABSENT by the system, and a Teacher who cancels the session is ABSENT in it. If an ABSENT record exists (from the School Manager or the system), a check-in inside the window changes it to PRESENT as a correction and needs a non-empty `reason`.',
      authorization: teacherAuth(AttendancePermissions.CHECK_IN_TEACHER, 'The ACTIVE group of the session the caller teaches; plus Smart Guard.'),
      pathParams: idParam,
      request: { description: 'The GPS reading and, only when correcting an ABSENT record, the reason.', schema: s.object({ gps: GPS_DOC, reason: reasonField }), examples: { checkIn: { summary: 'Check in', value: { gps: { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 } } } } },
      success: { status: 200, description: 'The Teacher\'s record.', data: ref('AttendanceBatchResult'), example: batchExample('RECORDED', recordExample({ subjectType: 'TEACHER', subjectId: TEACHER_ID })) },
      errors: [
        validation400(['SMART_GUARD_GPS_REQUIRED', 'SMART_GUARD_GPS_INVALID']),
        NOT_ALLOWED,
        sessionNotFound,
        business422(['SMART_GUARD_OUTSIDE_SESSION_WINDOW', 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', 'SMART_GUARD_GPS_ACCURACY_TOO_LOW', 'SMART_GUARD_SESSION_CANCELLED', 'SMART_GUARD_SCHOOL_NOT_ACTIVE', 'ATTENDANCE_SESSION_CANCELLED'], 'Smart Guard refused the action.'),
        concurrent,
      ],
    }),
    op({
      method: 'put', path: '/sessions/:id/teacher', operationId: 'setTeacherAttendanceByManager', summary: 'Record or correct the Teacher\'s attendance (School Manager)',
      description: 'The School Manager records the session\'s Teacher as PRESENT or ABSENT, or corrects the Teacher\'s record, at any time and WITHOUT GPS. A first marking needs no reason; changing an existing record needs a non-empty `reason` (kept in the append-only history). Not allowed for a cancelled session.',
      authorization: managerAuth,
      pathParams: idParam,
      request: { description: 'The status and, for a correction, the reason.', schema: s.object({ status: statusField, reason: reasonField }, ['status']), examples: { absent: { summary: 'Teacher absent', value: { status: 'ABSENT' } } } },
      success: { status: 200, description: 'The Teacher\'s record.', data: ref('AttendanceBatchResult'), example: batchExample('RECORDED', recordExample({ subjectType: 'TEACHER', subjectId: TEACHER_ID, status: 'ABSENT', recordedByRole: 'SCHOOL_MANAGER', updatedByRole: 'SCHOOL_MANAGER' })) },
      errors: [validation400(), NOT_ALLOWED, sessionNotFound, business422(['ATTENDANCE_SESSION_CANCELLED'], 'The session is cancelled.'), concurrent],
    }),
    op({
      method: 'put', path: '/sessions/:id/students/:studentId', operationId: 'setStudentAttendanceByManager', summary: 'Record or correct a student\'s attendance (School Manager)',
      description: 'The School Manager records or corrects ONE student\'s attendance at any time and WITHOUT GPS. A first marking needs no reason (the student must currently be assigned to the group); changing an existing record needs a non-empty `reason` (kept in the append-only history; the student may have left the group since). Not allowed for a cancelled session.',
      authorization: managerAuth,
      pathParams: { ...idParam, ...studentParam },
      request: { description: 'The status and, for a correction, the reason.', schema: s.object({ status: statusField, reason: reasonField }, ['status']), examples: { absent: { summary: 'Mark absent', value: { status: 'ABSENT' } } } },
      success: { status: 200, description: 'The student\'s record.', data: ref('AttendanceBatchResult'), example: batchExample('RECORDED', recordExample({ status: 'ABSENT', recordedByRole: 'SCHOOL_MANAGER', updatedByRole: 'SCHOOL_MANAGER' })) },
      errors: [validation400(), NOT_ALLOWED, sessionNotFound, business422(['ATTENDANCE_SESSION_CANCELLED', 'ATTENDANCE_STUDENT_NOT_IN_GROUP'], 'The session is cancelled, or the student has no record and is not currently assigned to the group.'), concurrent],
    }),
  ],
};
