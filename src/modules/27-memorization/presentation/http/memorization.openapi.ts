import { QURAN_READ_ROLES, QuranPermissions } from '../../../21-quran-structure/public';
import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { MemorizationPermissions } from '../../application/services/memorization-authorization';
import { ASSIGNMENT_STATUSES, MAX_BATCH_RECORDS, MAX_REASON_LENGTH } from '../../domain/value-objects/memorization-range';
import { MEMORIZATION_AYAHS_SPEC, MEMORIZATION_LIST_SPEC } from './memorization-routes';

const SESSION_ID = '5d2a8c41-7b36-4e09-9f15-a3c6e1d08b72';
const GROUP_ID = '4c9e1b72-3a58-4d06-9b17-e2f8a0d5c613';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const STUDENT_ID = '2b8d4f16-9c57-4a30-8e62-d1f7a3c05b98';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const RECORD_ID = 'c8e2a7d4-1f95-4b36-a0c3-7d5e9b2f4a61';
const ASSIGNMENT_ID = 'e1a4b7c2-5d38-4f90-8a16-3c9d0b2e7f55';
const NEXT_SESSION_ID = 'a7c3e915-2b64-4d08-9f31-5e8a1c6d0b24';
const WHEN = '2026-11-02T16:05:00.000Z';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Memorization 27); docs/MEMORIZATION.md; Master Specification sections 48 and 63';

const rangeExample = { request: { start: { surah: 2, ayah: 1 }, unit: 'AYAHS', amount: 5, direction: 'FORWARD' }, first: { surah: 2, ayah: 1 }, last: { surah: 2, ayah: 5 }, segments: [{ surah: 2, firstAyah: 1, lastAyah: 5 }], ayahCount: 5 };
const requestExample = { start: { surah: 2, ayah: 1 }, unit: 'AYAHS', amount: 5, direction: 'FORWARD' };

const ayahRef = s.object({ surah: s.integer({ example: 2 }), ayah: s.integer({ example: 1 }) }, ['surah', 'ayah']);
const rangeSchema = s.object(
  {
    request: s.object(
      { start: s.object({ surah: s.integer(), ayah: s.integer({ nullable: true }) }, ['surah', 'ayah']), unit: s.string({ enum: ['SURAHS', 'AYAHS', 'QUARTERS', 'PAGES', 'LINES'] }), amount: s.integer(), direction: s.string({ enum: ['FORWARD', 'BACKWARD'] }) },
      ['start', 'unit', 'amount', 'direction'],
      { description: 'The request that produced the range (Module 22: start + unit + amount + direction).' },
    ),
    first: ayahRef,
    last: ayahRef,
    segments: s.array(s.object({ surah: s.integer(), firstAyah: s.integer(), lastAyah: s.integer() }, ['surah', 'firstAyah', 'lastAyah']), { description: 'The ayahs covered, per surah, in Quran order.' }),
    ayahCount: s.integer(),
  },
  ['request', 'first', 'last', 'segments', 'ayahCount'],
  { description: 'The range exactly as Module 22 (Quran Range Engine) calculated it. Two ranges are the same when they cover the same ayahs.' },
);

const assignmentSchema = s.object(
  {
    id: s.uuid(),
    schoolId: s.uuid(),
    groupId: s.uuid(),
    studentId: s.uuid({ nullable: true, description: 'null = the ONE shared assignment of a GROUP-mode (collective) group. An INDIVIDUAL group has one independent assignment per student.' }),
    definedInSessionId: s.uuid({ description: 'The session during which the Teacher defined it, for the group\'s NEXT actual session.' }),
    definedByUserId: s.uuid(),
    range: rangeSchema,
    status: s.string({ enum: ASSIGNMENT_STATUSES, description: 'CANCELLED assignments are kept; nothing is deleted.' }),
    createdAt: s.dateTime(),
    updatedAt: s.dateTime(),
  },
  ['id', 'schoolId', 'groupId', 'studentId', 'definedInSessionId', 'definedByUserId', 'range', 'status', 'createdAt', 'updatedAt'],
);

const recordSchema = s.object(
  {
    id: s.uuid(),
    sessionId: s.uuid(),
    schoolId: s.uuid(),
    groupId: s.uuid(),
    studentId: s.uuid(),
    assignmentId: s.uuid({ nullable: true, description: 'The scheduled assignment the record was evaluated against; null when nothing was scheduled for the student.' }),
    range: rangeSchema,
    matchesAssignment: s.boolean({ nullable: true, description: 'Computed by the system: true only when the range is EXACTLY the assigned range (fulfilment); false = a different range, NOT fulfilment; null = no scheduled assignment. Never sent by a client.' }),
    recordedBy: s.uuid(),
    recordedAt: s.dateTime(),
    updatedBy: s.uuid({ description: 'The same as recordedBy until a correction.' }),
    updatedAt: s.dateTime(),
  },
  ['id', 'sessionId', 'schoolId', 'groupId', 'studentId', 'assignmentId', 'range', 'matchesAssignment', 'recordedBy', 'recordedAt', 'updatedBy', 'updatedAt'],
);

const sessionSchema = s.object(
  {
    sessionId: s.uuid(),
    scheduled: s.array(ref('MemorizationAssignment'), { description: 'The assignments SCHEDULED for this session (explicitly defined before it started). Empty = nothing is scheduled: no session is assumed to include memorization.' }),
    defined: s.array(ref('MemorizationAssignment'), { description: 'The assignments defined DURING this session for the next one (including cancelled ones).' }),
    records: s.array(ref('MemorizationRecord')),
  },
  ['sessionId', 'scheduled', 'defined', 'records'],
);
const batchSchema = s.object(
  { sessionId: s.uuid(), results: s.array(s.object({ studentId: s.uuid(), outcome: s.string({ enum: ['RECORDED'] }), record: ref('MemorizationRecord') }, ['studentId', 'outcome', 'record'])) },
  ['sessionId', 'results'],
);
const correctionSchema = s.object(
  { outcome: s.string({ enum: ['CORRECTED', 'UNCHANGED'], description: 'CORRECTED: the range changed (the original is kept in the append-only history). UNCHANGED: the same ayahs were sent again; nothing changed.' }), record: ref('MemorizationRecord') },
  ['outcome', 'record'],
);

const assignmentExample = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ASSIGNMENT_ID, schoolId: SCHOOL_ID, groupId: GROUP_ID, studentId: null, definedInSessionId: SESSION_ID, definedByUserId: USER_ID, range: rangeExample, status: 'ACTIVE', createdAt: WHEN, updatedAt: WHEN, ...over,
});
const recordExample = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: RECORD_ID, sessionId: SESSION_ID, schoolId: SCHOOL_ID, groupId: GROUP_ID, studentId: STUDENT_ID, assignmentId: ASSIGNMENT_ID, range: rangeExample, matchesAssignment: true, recordedBy: USER_ID,
  recordedAt: WHEN, updatedBy: USER_ID, updatedAt: WHEN, ...over,
});

const GPS_DOC = s.object(
  { latitude: s.number({ example: 30.0444 }), longitude: s.number({ example: 31.2357 }), accuracyMeters: s.number({ example: 8 }) },
  [],
  { description: 'The Teacher\'s GPS reading. REQUIRED by Smart Guard: none gives 400 SMART_GUARD_GPS_REQUIRED, an invalid one 400 SMART_GUARD_GPS_INVALID (not enforced by the schema so that those codes are returned). Within 50 m of the school and accurate to 20 m or better. No fallback exists.' },
);
const rangeField = s.object(
  { start: s.object({ surah: s.integer({ example: 2 }), ayah: s.integer({ nullable: true, example: 1 }) }, ['surah']), unit: s.string({ enum: ['SURAHS', 'AYAHS', 'QUARTERS', 'PAGES', 'LINES'], example: 'AYAHS' }), amount: s.integer({ minimum: 1, example: 5 }), direction: s.string({ enum: ['FORWARD', 'BACKWARD'], example: 'FORWARD' }) },
  ['start', 'unit', 'amount', 'direction'],
  { description: 'Validated and calculated by Module 22 (Quran Range Engine): QURAN_RANGE_* errors are returned for an invalid range.' },
);

const sessionParam = { id: { description: 'The session id.', example: SESSION_ID, schema: s.uuid() } };
const assignmentParam = { id: { description: 'The assignment id.', example: ASSIGNMENT_ID, schema: s.uuid() } };
const recordParam = { id: { description: 'The record id.', example: RECORD_ID, schema: s.uuid() } };
const studentParam = { id: { description: 'The student id.', example: STUDENT_ID, schema: s.uuid() } };

const NOT_ALLOWED: ErrorDoc = {
  status: 403,
  codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED', 'SMART_GUARD_NOT_SESSION_TEACHER', 'MEMORIZATION_NOT_SESSION_TEACHER', 'MEMORIZATION_READ_NOT_ALLOWED'],
  description: 'The caller lacks the permission or the scope (no reason is given; a group, session, assignment, record or student that does not exist is also 403 at the route guard), or must first change the initial password. MEMORIZATION_NOT_SESSION_TEACHER / SMART_GUARD_NOT_SESSION_TEACHER: the caller is not the Teacher assigned to the session. MEMORIZATION_READ_NOT_ALLOWED: only the session\'s Teacher or the School Manager of its school read a session\'s memorization.',
};
const notFound = (codes: string[], description: string): ErrorDoc => ({ status: 404, codes, description });
const validation400 = (extra: string[] = []): ErrorDoc => ({
  status: 400,
  codes: ['MEMORIZATION_RANGE_REQUIRED', 'MEMORIZATION_RECORDS_REQUIRED', 'MEMORIZATION_TOO_MANY_RECORDS', 'MEMORIZATION_INVALID_RECORD', 'MEMORIZATION_REASON_TOO_LONG', 'MEMORIZATION_STUDENT_REQUIRED', 'QURAN_RANGE_UNIT_INVALID', 'QURAN_RANGE_DIRECTION_INVALID', 'QURAN_RANGE_AMOUNT_INVALID', 'QURAN_RANGE_START_INVALID', ...extra],
  description: 'The request is invalid (including an invalid range, which Module 22 rejects).',
});
const business422 = (codes: string[], description: string): ErrorDoc => ({ status: 422, codes, description });
const conflict409 = (codes: string[], description: string): ErrorDoc => ({ status: 409, codes, description });

const teacherAuth = (permissionId: string, scope: string, extra = ''): AuthorizationDoc => ({
  authentication: 'required',
  roles: ['TEACHER'],
  scope,
  enforcement: `Authorization Engine permission with the MANAGEMENT/GROUP scope resolver (Module 20; the group is loaded server-side), then the application requires the Teacher assigned to the session.${extra} A School Manager has NO permission to record, correct or define assignments.`,
  permissionId,
  decision: 'APPROVED',
  reference: REFERENCE,
});
const op = (o: OperationDoc): OperationDoc => o;

const AYAH_EXAMPLE = { globalPosition: 1, surah: 1, ayah: 1, text: 'Example official text ۝١', firstPage: 1, firstLine: 2, lastPage: 1, lastLine: 2, juz: 1, quarter: 1, hizb: 1, startsRubMarker: false };
/** The Quran selection answer: Module 21's own contract (the `QuranAyah` schema), the SAME in Memorization and Revision. */
const quranAyahsOperation: OperationDoc = {
  method: 'get',
  path: '/ayahs',
  operationId: 'getMemorizationAyahs',
  summary: 'The Quran ayahs for the memorization selection',
  description:
    'A paginated list of the ayahs of the approved Quran edition (Madinah Mushaf, Hafs from Asim) in canonical order (surah, then ayah; `sort=-globalPosition` reverses it), for the memorization selection interface. The data is read through the public contract of Module 21 (the only source of Quran data): the same complete dataset, the same identifiers (`surah`, `ayah`, `globalPosition`, page, line, juz, quarter) and the exact official text as `GET /quran/surahs/{surah}/ayahs`. It is NOT filtered by any student progress and has no student-specific structure. The same data is returned by the Memorization and the Revision operation: Revision chooses its own range types (Module 28) but not a different Quran. Readable by every authenticated role through the existing `quran.structure.read` permission. Quran text is not localized; only error messages follow the request language.',
  authorization: {
    authentication: 'required',
    roles: [...QURAN_READ_ROLES],
    scope: 'None: global reference data (no organization, school or ownership).',
    enforcement: 'Authorization Engine permission `quran.structure.read` (unscoped, granted to every assignable role); no new permission. The data cannot be changed through this endpoint.',
    permissionId: QuranPermissions.READ,
    decision: 'APPROVED',
    reference: 'docs/AUTHORIZATION-MATRIX.md (Quran structure 21); docs/QURAN-STRUCTURE.md; docs/MEMORIZATION.md',
  },
  query: listQueryParameters(MEMORIZATION_AYAHS_SPEC),
  success: { status: 200, description: 'A page of ayahs.', paginated: true, data: ref('QuranAyah'), example: AYAH_EXAMPLE },
  errors: [
    { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller has no role that may read the Quran structure, or the account must first change its initial password.' },
    { status: 404, codes: ['QURAN_DATASET_NOT_IMPORTED'], description: 'The Quran dataset has not been imported yet.' },
  ],
};

/** OpenAPI contract of `/memorization` (`memorization-routes.ts`). Module 27: memorization. */
export const memorizationApiDoc: ModuleApiDoc = {
  moduleId: '27',
  mountPath: '/memorization',
  tag: {
    name: 'Memorization',
    description:
      `The next-session memorization assignment and the students' memorization records. The session's Teacher defines the assignment of the NEXT session during the current session and may modify or cancel it only while that session is IN_PROGRESS; afterwards it is final. A collective (GROUP-mode) group has ONE shared assignment; an INDIVIDUAL group has one per student. An assignment stays available for the next actual session: a cancelled, rescheduled or Teacher-absent session never discards it. Only the assigned Teacher records memorization, through Smart Guard with GPS (at most ${MAX_BATCH_RECORDS} records per request, atomic); a School Manager cannot record or correct. Overlapping ranges are valid and every record is independent. The Teacher may correct a record only during the same session; the original is kept in an append-only history. Nothing is ever deleted. Reminders are NOT sent here (that is for Modules 31-34).`,
  },
  schemas: { MemorizationAssignment: assignmentSchema, MemorizationRecord: recordSchema, SessionMemorization: sessionSchema, MemorizationBatchResult: batchSchema, MemorizationCorrectionResult: correctionSchema },
  operations: [
    quranAyahsOperation,
    op({
      method: 'get', path: '/students/:id/records', operationId: 'listStudentMemorizationRecords', summary: 'A student\'s memorization records',
      description: 'A paginated list of the student\'s memorization records, by the session\'s start, newest first by default. Read access: the **School Manager** of the student\'s school and the student\'s own **Parent** (linked children only). A Student has no direct read access in this module.',
      authorization: { authentication: 'required', roles: ['SCHOOL_MANAGER', 'PARENT'], scope: 'SCHOOL_MANAGER: the student\'s school. PARENT: only their own linked children.', enforcement: 'Authorization Engine permission with the role-aware MANAGEMENT/STUDENT scope resolver (Module 19).', permissionId: MemorizationPermissions.READ_STUDENT, decision: 'APPROVED', reference: REFERENCE },
      pathParams: studentParam,
      query: listQueryParameters(MEMORIZATION_LIST_SPEC),
      success: { status: 200, description: 'A page of the student\'s records.', paginated: true, data: ref('MemorizationRecord'), example: recordExample() },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/sessions/:id', operationId: 'getSessionMemorization', summary: 'The memorization of a session',
      description: 'What is scheduled for the session, what its Teacher defined during it for the next session, and its records. Read access: the **School Manager** of the school and the **Teacher assigned to the session**.',
      authorization: { authentication: 'required', roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'SCHOOL_MANAGER: the school. TEACHER: the ACTIVE group they teach; the application further requires that the session is assigned to them.', enforcement: 'Authorization Engine permission with the MANAGEMENT/GROUP scope resolver (Module 20), then the application check.', permissionId: MemorizationPermissions.READ_SESSION, decision: 'APPROVED', reference: REFERENCE },
      pathParams: sessionParam,
      success: { status: 200, description: 'The session\'s memorization.', data: ref('SessionMemorization'), example: { sessionId: SESSION_ID, scheduled: [assignmentExample({ definedInSessionId: NEXT_SESSION_ID })], defined: [assignmentExample()], records: [recordExample()] } },
      errors: [NOT_ALLOWED, notFound(['CLASS_SESSION_NOT_FOUND'], 'The session does not exist.')],
    }),
    op({
      method: 'post', path: '/sessions/:id/assignments', operationId: 'defineMemorizationAssignment', summary: 'Define the next session\'s assignment (assigned Teacher)',
      description: 'The session\'s Teacher defines the memorization assignment of the NEXT session, DURING this session (it must be IN_PROGRESS). **GROUP-mode (collective) group:** one shared assignment; `studentId` must be omitted. **INDIVIDUAL group:** `studentId` is required (a student currently in the group) and each student has an independent assignment. At most one active assignment per student (or shared) per session: change or cancel it instead. In an INDIVIDUAL group, a student who did not fulfil their assignment in this session must get the ENTIRE original assignment again (422 MEMORIZATION_REPEAT_REQUIRED for any other range). No GPS is required for defining an assignment.',
      authorization: teacherAuth(MemorizationPermissions.MANAGE_ASSIGNMENT, 'The ACTIVE group of the session the caller teaches.'),
      pathParams: sessionParam,
      request: {
        description: 'The range and, for an INDIVIDUAL group, the student.',
        schema: s.object({ studentId: s.uuid({ example: STUDENT_ID, nullable: true, description: 'Required for an INDIVIDUAL group; must be absent for a GROUP-mode group.' }), range: rangeField }, ['range']),
        examples: { shared: { summary: 'Collective group: shared assignment', value: { range: requestExample } }, individual: { summary: 'Individual group: one student', value: { studentId: STUDENT_ID, range: requestExample } } },
      },
      success: { status: 201, description: 'The new assignment.', data: ref('MemorizationAssignment'), example: assignmentExample() },
      errors: [
        validation400(),
        NOT_ALLOWED,
        notFound(['CLASS_SESSION_NOT_FOUND'], 'The session does not exist.'),
        conflict409(['MEMORIZATION_ASSIGNMENT_ALREADY_DEFINED'], 'An active assignment already exists from this session for the same student or group.'),
        business422(['MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED', 'MEMORIZATION_GROUP_ASSIGNMENT_NO_STUDENT', 'MEMORIZATION_STUDENT_NOT_IN_GROUP', 'MEMORIZATION_REPEAT_REQUIRED', 'QURAN_RANGE_EXCEEDS_QURAN'], 'The session is not in progress, a collective group cannot have a per-student assignment, the student is not in the group, the entire original assignment must be repeated, or the range goes past the Quran.'),
      ],
    }),
    op({
      method: 'put', path: '/assignments/:id', operationId: 'modifyMemorizationAssignment', summary: 'Modify an assignment (assigned Teacher, during its defining session)',
      description: 'Changes the range of an assignment, only while the session in which it was defined is still IN_PROGRESS. After that session ends the assignment is final and immutable. The change is kept in an append-only history.',
      authorization: teacherAuth(MemorizationPermissions.MANAGE_ASSIGNMENT, 'The ACTIVE group of the assignment (loaded server-side) the caller teaches.'),
      pathParams: assignmentParam,
      request: { description: 'The new range.', schema: s.object({ range: rangeField }, ['range']), examples: { change: { summary: 'Change the range', value: { range: requestExample } } } },
      success: { status: 200, description: 'The updated assignment.', data: ref('MemorizationAssignment'), example: assignmentExample() },
      errors: [
        validation400(),
        NOT_ALLOWED,
        notFound(['MEMORIZATION_ASSIGNMENT_NOT_FOUND'], 'The assignment does not exist.'),
        business422(['MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED', 'MEMORIZATION_ASSIGNMENT_CANCELLED', 'MEMORIZATION_REPEAT_REQUIRED', 'QURAN_RANGE_EXCEEDS_QURAN'], 'The defining session is no longer in progress (the assignment is final), the assignment is cancelled, or the entire original assignment must be repeated.'),
      ],
    }),
    op({
      method: 'post', path: '/assignments/:id/cancel', operationId: 'cancelMemorizationAssignment', summary: 'Cancel an assignment (assigned Teacher, during its defining session)',
      description: 'Cancels an assignment, only while the session in which it was defined is still IN_PROGRESS. It is kept with status CANCELLED and its history; nothing is deleted. After that session ends the assignment is final.',
      authorization: teacherAuth(MemorizationPermissions.MANAGE_ASSIGNMENT, 'The ACTIVE group of the assignment (loaded server-side) the caller teaches.'),
      pathParams: assignmentParam,
      success: { status: 200, description: 'The cancelled assignment.', data: ref('MemorizationAssignment'), example: assignmentExample({ status: 'CANCELLED' }) },
      errors: [NOT_ALLOWED, notFound(['MEMORIZATION_ASSIGNMENT_NOT_FOUND'], 'The assignment does not exist.'), business422(['MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED', 'MEMORIZATION_ASSIGNMENT_CANCELLED'], 'The defining session is no longer in progress, or the assignment is already cancelled.')],
    }),
    op({
      method: 'post', path: '/sessions/:id/records', operationId: 'recordMemorization', summary: 'Record students\' memorization (assigned Teacher)',
      description: `The Teacher assigned to the session records the memorization of several students in ONE ATOMIC batch with ONE GPS reading: either every record is accepted or the whole request is rejected. Protected by Smart Guard (ownership, from 15 minutes before the start through the scheduled end, within 50 m of the school, accuracy 20 m or better, session not cancelled). Each record is evaluated against the assignment in effect for the student (\`matchesAssignment\` is computed from the ranges: only exactly the assigned range fulfils it). Overlapping ranges are valid and a student may have several records; nothing is overwritten. 1 to ${MAX_BATCH_RECORDS} records; only students currently in the group.`,
      authorization: teacherAuth(MemorizationPermissions.RECORD, 'The ACTIVE group of the session the caller teaches; plus Smart Guard.', ' Smart Guard (Module 25) checks ownership, the time window, GPS distance and accuracy.'),
      pathParams: sessionParam,
      request: {
        description: 'The GPS reading and the records.',
        schema: s.object({ gps: GPS_DOC, records: s.array(s.object({ studentId: s.uuid({ example: STUDENT_ID }), range: rangeField }, ['studentId', 'range'])) }, ['records']),
        examples: { first: { summary: 'One student', value: { gps: { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 }, records: [{ studentId: STUDENT_ID, range: requestExample }] } } },
      },
      success: { status: 200, description: 'One result per submitted record, in the order submitted.', data: ref('MemorizationBatchResult'), example: { sessionId: SESSION_ID, results: [{ studentId: STUDENT_ID, outcome: 'RECORDED', record: recordExample() }] } },
      errors: [
        validation400(['SMART_GUARD_GPS_REQUIRED', 'SMART_GUARD_GPS_INVALID']),
        NOT_ALLOWED,
        notFound(['CLASS_SESSION_NOT_FOUND'], 'The session does not exist.'),
        business422(['SMART_GUARD_OUTSIDE_SESSION_WINDOW', 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', 'SMART_GUARD_GPS_ACCURACY_TOO_LOW', 'SMART_GUARD_SESSION_CANCELLED', 'SMART_GUARD_SCHOOL_NOT_ACTIVE', 'MEMORIZATION_SESSION_CANCELLED', 'MEMORIZATION_STUDENT_NOT_IN_GROUP', 'MEMORIZATION_RECORD_CONFLICTS_WITH_NEXT_ASSIGNMENT', 'QURAN_RANGE_EXCEEDS_QURAN'], 'Smart Guard refused the action, the session is cancelled, a student is not in the group, or the record would leave a different next assignment for a student who did not fulfil theirs.'),
      ],
    }),
    op({
      method: 'put', path: '/records/:id', operationId: 'correctMemorizationRecord', summary: 'Correct a record (assigned Teacher, during the same session)',
      description: 'The Teacher assigned to the session corrects the range of a record, only DURING the same session in which it was created (through Smart Guard with GPS). After that session ends the record is immutable. The original value and every correction stay in an append-only history; nothing is overwritten silently or deleted. A School Manager cannot correct. The same ayahs again change nothing (outcome UNCHANGED).',
      authorization: teacherAuth(MemorizationPermissions.CORRECT, 'The ACTIVE group of the record (loaded server-side) the caller teaches; plus Smart Guard.', ' Smart Guard (Module 25) checks ownership, the time window, GPS distance and accuracy.'),
      pathParams: recordParam,
      request: {
        description: 'The GPS reading, the corrected range and an optional reason.',
        schema: s.object({ gps: GPS_DOC, range: rangeField, reason: s.string({ maxLength: MAX_REASON_LENGTH, nullable: true, description: 'Optional (at most 500 characters).' }) }, ['range']),
        examples: { fix: { summary: 'Correct the range', value: { gps: { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 }, range: requestExample } } },
      },
      success: { status: 200, description: 'The record after the correction.', data: ref('MemorizationCorrectionResult'), example: { outcome: 'CORRECTED', record: recordExample({ matchesAssignment: false }) } },
      errors: [
        validation400(['SMART_GUARD_GPS_REQUIRED', 'SMART_GUARD_GPS_INVALID']),
        NOT_ALLOWED,
        notFound(['MEMORIZATION_RECORD_NOT_FOUND'], 'The record does not exist.'),
        business422(['SMART_GUARD_OUTSIDE_SESSION_WINDOW', 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', 'SMART_GUARD_GPS_ACCURACY_TOO_LOW', 'SMART_GUARD_SESSION_CANCELLED', 'SMART_GUARD_SCHOOL_NOT_ACTIVE', 'MEMORIZATION_CORRECTION_WINDOW_CLOSED', 'MEMORIZATION_RECORD_CONFLICTS_WITH_NEXT_ASSIGNMENT', 'QURAN_RANGE_EXCEEDS_QURAN'], 'Smart Guard refused the action, the session has ended (the record is final), or the correction would leave a different next assignment for a student who did not fulfil theirs.'),
      ],
    }),
  ],
};
