import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { EvaluationPermissions } from '../../application/services/evaluation-authorization';
import { EVALUATION_CATEGORIES, GRACE_MINUTES, MAX_BATCH_STUDENTS, MAX_NOTE_LENGTH } from '../../domain/value-objects/evaluation-rules';
import { EVALUATION_LIST_SPEC } from './evaluation-routes';

const SESSION_ID = '5d2a8c41-7b36-4e09-9f15-a3c6e1d08b72';
const GROUP_ID = '4c9e1b72-3a58-4d06-9b17-e2f8a0d5c613';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const STUDENT_ID = '2b8d4f16-9c57-4a30-8e62-d1f7a3c05b98';
const EVALUATION_ID = 'c8e2a7d4-1f95-4b36-a0c3-7d5e9b2f4a61';
const MEMORIZATION_ASSIGNMENT_ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const REVISION_ASSIGNMENT_ID = 'b2c3d4e5-6f70-4b8c-9d0e-1f2a3b4c5d6e';
const WHEN = '2026-11-02T16:05:00.000Z';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Evaluations 29); docs/EVALUATIONS.md; Master Specification section 52 (approved Module 29 decisions)';

const scoreSchema = s.object(
  {
    category: s.string({ enum: EVALUATION_CATEGORIES }),
    score: s.number({ minimum: 0, maximum: 10, description: 'From 0.00 to 10.00, two decimal places.', example: 8.5 }),
    memorizationAssignmentId: s.uuid({ nullable: true, description: 'The Memorization assignment this score is associated with (always set for MEMORIZATION; set for PERFORMANCE and TAJWEED when one applies), else null.' }),
    revisionAssignmentId: s.uuid({ nullable: true, description: 'The Revision assignment this score is associated with (always set for REVISION; set for PERFORMANCE and TAJWEED when one applies), else null.' }),
  },
  ['category', 'score', 'memorizationAssignmentId', 'revisionAssignmentId'],
);

const evaluationSchema = s.object(
  {
    id: s.uuid(),
    sessionId: s.uuid(),
    schoolId: s.uuid(),
    groupId: s.uuid(),
    studentId: s.uuid(),
    occurrenceDate: s.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The session\'s calendar date in the business zone (Africa/Cairo).', example: '2026-11-02' }),
    scheduledStart: s.dateTime({ description: 'The session\'s scheduled start (UTC).' }),
    scores: s.array(scoreSchema, { description: 'One independent score per category available to the student. Performance and Tajweed appear once each.' }),
    note: s.string({ nullable: true, maxLength: MAX_NOTE_LENGTH, description: 'The ONE optional Teacher note of the evaluation, shared by all categories. Saved once; never edited or deleted.' }),
    recordedAt: s.dateTime({ description: 'When the evaluation was first recorded (UTC). No modification time, previous values or modification details are ever exposed.' }),
  },
  ['id', 'sessionId', 'schoolId', 'groupId', 'studentId', 'occurrenceDate', 'scheduledStart', 'scores', 'note', 'recordedAt'],
);

const batchSchema = s.object(
  {
    sessionId: s.uuid(),
    results: s.array(
      s.object(
        {
          studentId: s.uuid(),
          outcome: s.string({ enum: ['RECORDED', 'UPDATED', 'UNCHANGED'], description: 'RECORDED: the evaluation was created. UPDATED: one or more scores of an existing evaluation changed (only while the session lasts). UNCHANGED: the same scores were sent again; nothing changed.' }),
          evaluation: ref('Evaluation'),
        },
        ['studentId', 'outcome', 'evaluation'],
      ),
    ),
  },
  ['sessionId', 'results'],
);

const sessionEvaluationsSchema = s.object(
  { sessionId: s.uuid(), evaluations: s.array(ref('Evaluation'), { description: 'Only the students that have an evaluation. A missing evaluation is simply absent: nothing ever creates a default or zero score.' }) },
  ['sessionId', 'evaluations'],
);

const evaluationExample = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: EVALUATION_ID, sessionId: SESSION_ID, schoolId: SCHOOL_ID, groupId: GROUP_ID, studentId: STUDENT_ID, occurrenceDate: '2026-11-02', scheduledStart: '2026-11-02T16:00:00.000Z',
  scores: [
    { category: 'MEMORIZATION', score: 8.5, memorizationAssignmentId: MEMORIZATION_ASSIGNMENT_ID, revisionAssignmentId: null },
    { category: 'REVISION', score: 9, memorizationAssignmentId: null, revisionAssignmentId: REVISION_ASSIGNMENT_ID },
    { category: 'PERFORMANCE', score: 9.25, memorizationAssignmentId: MEMORIZATION_ASSIGNMENT_ID, revisionAssignmentId: REVISION_ASSIGNMENT_ID },
    { category: 'TAJWEED', score: 7.75, memorizationAssignmentId: MEMORIZATION_ASSIGNMENT_ID, revisionAssignmentId: REVISION_ASSIGNMENT_ID },
  ],
  note: 'أداء ممتاز', recordedAt: WHEN, ...over,
});
const batchExample = (outcome = 'RECORDED'): Record<string, unknown> => ({ sessionId: SESSION_ID, results: [{ studentId: STUDENT_ID, outcome, evaluation: evaluationExample() }] });

const GPS_DOC = s.object(
  { latitude: s.number({ example: 30.0444 }), longitude: s.number({ example: 31.2357 }), accuracyMeters: s.number({ example: 8 }) },
  [],
  { description: 'The Teacher\'s GPS reading. REQUIRED by Smart Guard, also during the post-completion grace period: sending none gives 400 SMART_GUARD_GPS_REQUIRED, and an invalid one 400 SMART_GUARD_GPS_INVALID (not enforced by the schema so that those codes are returned). Must be within 50 m of the school and accurate to 20 m or better. No fallback exists.' },
);

const idParam = { id: { description: 'The session id.', example: SESSION_ID, schema: s.uuid() } };

const NOT_ALLOWED: ErrorDoc = {
  status: 403,
  codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED', 'SMART_GUARD_NOT_SESSION_TEACHER', 'EVALUATION_READ_NOT_ALLOWED'],
  description: 'The caller lacks the permission or the scope (no reason is given; a group or student that does not exist is also 403), or must first change the initial password. SMART_GUARD_NOT_SESSION_TEACHER: the caller is not the Teacher assigned to the session. EVALUATION_READ_NOT_ALLOWED: only the session\'s Teacher or the School Manager of its school read a session\'s evaluations.',
};
const sessionNotFound: ErrorDoc = { status: 404, codes: ['CLASS_SESSION_NOT_FOUND'], description: 'The session does not exist.' };

const op = (o: OperationDoc): OperationDoc => o;
const readAuth = (roles: string[], scope: string, enforcement: string, permissionId: string): AuthorizationDoc => ({ authentication: 'required', roles, scope, enforcement, permissionId, decision: 'APPROVED', reference: REFERENCE });

/** OpenAPI contract of `/evaluations` (`evaluation-routes.ts`). Module 29: evaluations. */
export const evaluationApiDoc: ModuleApiDoc = {
  moduleId: '29',
  mountPath: '/evaluations',
  tag: {
    name: 'Evaluations',
    description:
      `One evaluation per student per session, recorded ONLY by the Teacher assigned to the session, in one atomic batch with ONE GPS reading through Smart Guard (at most ${MAX_BATCH_STUDENTS} students; only students currently assigned to the group). The School Manager cannot create, modify or correct evaluations. An evaluation exists only for a student with a Memorization and/or Revision ASSIGNMENT for the session (the assignment is enough; no execution record is needed): Memorization only gives MEMORIZATION, PERFORMANCE, TAJWEED; Revision only gives REVISION, PERFORMANCE, TAJWEED; both give all four; neither gives none. Creation needs EVERY available category, each with its own score from 0.00 to 10.00 (rounded to two decimals, not rejected), plus ONE optional note of at most ${MAX_NOTE_LENGTH} characters, saved once and never changed. A student marked ABSENT cannot be evaluated, and a student who already has an evaluation cannot be marked ABSENT (Attendance rejects it). Until the scheduled end the Teacher may record and modify scores; for ${GRACE_MINUTES} minutes after the scheduled end only MISSING evaluations can be recorded (Smart Guard and GPS still required); then every write is closed for good. No history of score changes is kept and nothing is ever deleted. The Parent is notified of an evaluation and of each score change by the Notifications modules from the published events (nothing is sent by this module).`,
  },
  schemas: { Evaluation: evaluationSchema, EvaluationBatchResult: batchSchema, SessionEvaluations: sessionEvaluationsSchema },
  operations: [
    op({
      method: 'get', path: '/students/:id', operationId: 'listStudentEvaluations', summary: 'A student\'s evaluations',
      description: 'A paginated list of the student\'s evaluations (current scores and the note), by the session\'s start, newest first by default. Read access: the **School Manager** of the student\'s school and the student\'s own **Parent** (linked children only). The Parent never sees previous values or modification details (none are stored). The Organization Manager and the geographic managers read through the future Reports module, not here. A Student has no login.',
      authorization: readAuth(['SCHOOL_MANAGER', 'PARENT'], 'SCHOOL_MANAGER: the student\'s school. PARENT: only their own linked children.', 'Authorization Engine permission with the role-aware MANAGEMENT/STUDENT scope resolver (Module 19), which answers true only on positive proof for the role being checked.', EvaluationPermissions.READ_STUDENT),
      pathParams: { id: { description: 'The student id.', example: STUDENT_ID, schema: s.uuid() } },
      query: listQueryParameters(EVALUATION_LIST_SPEC),
      success: { status: 200, description: 'A page of the student\'s evaluations.', paginated: true, data: ref('Evaluation'), example: evaluationExample() },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/sessions/:id', operationId: 'getSessionEvaluations', summary: 'The evaluations of a session',
      description: 'The evaluations recorded for a session. Only students with an evaluation are listed. Read access: the **School Manager** of the school and the **Teacher assigned to the session**.',
      authorization: readAuth(['SCHOOL_MANAGER', 'TEACHER'], 'SCHOOL_MANAGER: the school. TEACHER: the ACTIVE group they teach; the application further requires that the session is assigned to them.', 'Authorization Engine permission with the MANAGEMENT/GROUP scope resolver (Module 20), then the application check (the session\'s Teacher or the school\'s School Manager).', EvaluationPermissions.READ_SESSION),
      pathParams: idParam,
      success: { status: 200, description: 'The session\'s evaluations.', data: ref('SessionEvaluations'), example: { sessionId: SESSION_ID, evaluations: [evaluationExample()] } },
      errors: [NOT_ALLOWED, sessionNotFound],
    }),
    op({
      method: 'post', path: '/sessions/:id/records', operationId: 'recordEvaluations', summary: 'Record evaluations and modify scores (assigned Teacher)',
      description:
        `The Teacher assigned to the session creates the evaluations of students that have none and modifies scores of existing ones, in ONE ATOMIC batch with ONE GPS reading: either everything is accepted or the whole request is rejected. Protected by Smart Guard (ownership, GPS distance and accuracy, session not cancelled). Time (by the SCHEDULED end, Africa/Cairo): from 15 minutes before the start through the scheduled end the Teacher records and may modify scores; from the end through ${GRACE_MINUTES} minutes later ONLY missing evaluations can be recorded (an evaluation that already exists cannot be touched: 422 EVALUATION_GRACE_CREATE_ONLY); after that 422 SMART_GUARD_OUTSIDE_SESSION_WINDOW / EVALUATION_WRITE_WINDOW_CLOSED. Only students currently in the group, each at most once. A student marked ABSENT is refused (EVALUATION_STUDENT_ABSENT); an unmarked student is not treated as absent. A student without a Memorization or Revision assignment for the session has nothing to evaluate (EVALUATION_NO_APPLICABLE_ASSIGNMENT). CREATION needs exactly the categories available to the student, each once, each with a score from 0 to 10 (rounded to two decimals). The \`note\` (optional, at most ${MAX_NOTE_LENGTH} characters) is accepted only with the creation; a different or later note is refused (EVALUATION_NOTE_IMMUTABLE). A MODIFICATION sends any subset of the categories the evaluation already has; the same scores again are UNCHANGED. Previous values are not kept. Each created or changed evaluation publishes an event for the Parent notification.`,
      authorization: { authentication: 'required', roles: ['TEACHER'], scope: 'The ACTIVE group of the session (loaded server-side through the session) the caller teaches; plus Smart Guard.', enforcement: 'Authorization Engine permission with the MANAGEMENT/GROUP scope resolver (Module 20), then Smart Guard (Module 25: ownership of the session, the time window with the narrow post-completion grace exception for this module only, GPS distance and accuracy, session not cancelled), then the attendance/assignment/window rules of Module 29 inside one transaction under the session row lock.', permissionId: EvaluationPermissions.RECORD, decision: 'APPROVED', reference: REFERENCE },
      pathParams: idParam,
      request: {
        description: `The GPS reading and 1 to ${MAX_BATCH_STUDENTS} students, each with scores and an optional note.`,
        schema: s.object(
          {
            gps: GPS_DOC,
            records: s.array(
              s.object(
                {
                  studentId: s.uuid({ example: STUDENT_ID }),
                  scores: s.array(s.object({ category: s.string({ enum: EVALUATION_CATEGORIES, example: 'MEMORIZATION' }), score: s.number({ minimum: 0, maximum: 10, example: 8.5 }) }, ['category', 'score'])),
                  note: s.string({ maxLength: MAX_NOTE_LENGTH, example: 'أداء ممتاز', description: 'Optional. Accepted only when the evaluation is created; never edited, added later or deleted.' }),
                },
                ['studentId', 'scores'],
              ),
            ),
          },
          ['records'],
        ),
        examples: {
          create: { summary: 'Create (memorization assignment only)', value: { gps: { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 }, records: [{ studentId: STUDENT_ID, scores: [{ category: 'MEMORIZATION', score: 8.5 }, { category: 'PERFORMANCE', score: 9 }, { category: 'TAJWEED', score: 7.75 }], note: 'أداء ممتاز' }] } },
          modify: { summary: 'Modify a score while the session lasts', value: { gps: { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 }, records: [{ studentId: STUDENT_ID, scores: [{ category: 'TAJWEED', score: 8 }] }] } },
        },
      },
      success: { status: 200, description: 'One result per submitted student, in the order submitted.', data: ref('EvaluationBatchResult'), example: batchExample() },
      errors: [
        {
          status: 400,
          codes: ['EVALUATION_RECORDS_REQUIRED', 'EVALUATION_TOO_MANY_RECORDS', 'EVALUATION_INVALID_RECORD', 'EVALUATION_DUPLICATE_STUDENT', 'EVALUATION_INVALID_CATEGORY', 'EVALUATION_DUPLICATE_CATEGORY', 'EVALUATION_INVALID_SCORE', 'EVALUATION_INVALID_NOTE', 'EVALUATION_NOTE_TOO_LONG', 'SMART_GUARD_GPS_REQUIRED', 'SMART_GUARD_GPS_INVALID'],
          description: 'The request is invalid (the whole request is rejected). EVALUATION_INVALID_SCORE: not a number from 0 to 10. EVALUATION_NOTE_TOO_LONG: more than 200 characters.',
        },
        NOT_ALLOWED,
        sessionNotFound,
        {
          status: 422,
          codes: ['SMART_GUARD_OUTSIDE_SESSION_WINDOW', 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', 'SMART_GUARD_GPS_ACCURACY_TOO_LOW', 'SMART_GUARD_SESSION_CANCELLED', 'SMART_GUARD_SCHOOL_NOT_ACTIVE', 'EVALUATION_SESSION_CANCELLED', 'EVALUATION_WRITE_WINDOW_CLOSED', 'EVALUATION_GRACE_CREATE_ONLY', 'EVALUATION_STUDENT_NOT_IN_GROUP', 'EVALUATION_STUDENT_ABSENT', 'EVALUATION_NO_APPLICABLE_ASSIGNMENT', 'EVALUATION_CATEGORIES_MISMATCH', 'EVALUATION_NOTE_IMMUTABLE'],
          description: 'Smart Guard refused the action, or a business rule refused it: `details.studentIds` names the students for EVALUATION_STUDENT_NOT_IN_GROUP, EVALUATION_STUDENT_ABSENT, EVALUATION_NO_APPLICABLE_ASSIGNMENT and EVALUATION_GRACE_CREATE_ONLY; EVALUATION_CATEGORIES_MISMATCH carries the student, the available and the submitted categories.',
        },
        { status: 409, codes: ['EVALUATION_CONCURRENT_CHANGE'], description: 'Another request changed the same evaluation at the same time (after automatic retries). Try again.' },
      ],
    }),
  ],
};
