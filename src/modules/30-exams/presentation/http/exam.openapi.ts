import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { ExamPermissions } from '../../application/services/exam-authorization';
import { EXAM_STATUSES, MAX_QUESTION_COUNT, MAX_SCORE_PER_QUESTION } from '../../domain/value-objects/exam-rules';
import { EXAM_LIST_SPEC } from './exam-routes';

const EXAM_ID = '7b1e4c92-3d58-4a06-9e1f-c2d5a8b03f64';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const GROUP_ID = '4c9e1b72-3a58-4d06-9b17-e2f8a0d5c613';
const STUDENT_ID = '2b8d4f16-9c57-4a30-8e62-d1f7a3c05b98';
const TEACHER_ID = 'c8e2a7d4-1f95-4b36-a0c3-7d5e9b2f4a61';
const RESULT_ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Exams 30); docs/EXAMS.md; Master Specification sections 53-57 (approved Module 30 decisions)';
const START = '2026-12-01T09:00:00.000Z';
const END = '2026-12-01T11:00:00.000Z';

const examSchema = s.object(
  {
    id: s.uuid(),
    schoolId: s.uuid(),
    status: s.string({ enum: EXAM_STATUSES, description: 'DRAFT, SCHEDULED, STARTED (automatic at the start time), COMPLETED (automatic at the end time, or manual when there is no end time), ENDED (manual, final), CANCELLED.' }),
    wholeSchool: s.boolean({ description: 'true: every student who belongs to a group of the school. false: the students of `groupIds`.' }),
    groupIds: s.array(s.uuid(), { description: 'The targeted groups (empty for a whole-school exam).' }),
    startAt: s.dateTime({ description: 'Scheduled start (UTC). The schedule is entered in Africa/Cairo.' }),
    endAt: s.dateTime({ nullable: true, description: 'Scheduled end, or null: the School Manager completes the exam.' }),
    questionCount: s.integer({ minimum: 1, maximum: MAX_QUESTION_COUNT }),
    maxScore: s.number({ description: 'ONE uniform maximum score for every question.', example: 10 }),
    maxTotal: s.number({ description: 'questionCount x maxScore.', example: 50 }),
    examiners: s.array(s.object({ teacherId: s.uuid(), assignedAt: s.dateTime() }, ['teacherId', 'assignedAt']), { description: 'The examiners CURRENTLY assigned (the exam-scoped permission).' }),
    createdAt: s.dateTime(),
  },
  ['id', 'schoolId', 'status', 'wholeSchool', 'groupIds', 'startAt', 'endAt', 'questionCount', 'maxScore', 'maxTotal', 'examiners', 'createdAt'],
);
const scheduleSchema = s.object(
  { id: s.uuid(), schoolId: s.uuid(), status: s.string({ enum: EXAM_STATUSES }), wholeSchool: s.boolean(), startAt: s.dateTime(), endAt: s.dateTime({ nullable: true }) },
  ['id', 'schoolId', 'status', 'wholeSchool', 'startAt', 'endAt'],
);
const resultsSchema = s.object(
  {
    examId: s.uuid(),
    status: s.string({ enum: EXAM_STATUSES }),
    results: s.array(
      s.object(
        { id: s.uuid(), examId: s.uuid(), studentId: s.uuid(), groupId: s.uuid(), scores: s.array(s.number(), { description: 'One score per question, in order.' }), total: s.number(), maxTotal: s.number(), recordedAt: s.dateTime() },
        ['id', 'examId', 'studentId', 'groupId', 'scores', 'total', 'maxTotal', 'recordedAt'],
      ),
    ),
    absent: s.array(s.object({ studentId: s.uuid(), groupId: s.uuid(), fullName: s.string() }, ['studentId', 'groupId', 'fullName']), { description: 'The students marked ABSENT when the exam COMPLETED. They have no result and no score.' }),
  },
  ['examId', 'status', 'results', 'absent'],
);
const outcomeSchema = s.object(
  {
    exam: s.object({ id: s.uuid(), schoolId: s.uuid(), status: s.string({ enum: EXAM_STATUSES }), wholeSchool: s.boolean(), startAt: s.dateTime(), endAt: s.dateTime({ nullable: true }), questionCount: s.integer(), maxScore: s.number() }, ['id', 'schoolId', 'status', 'wholeSchool', 'startAt', 'endAt', 'questionCount', 'maxScore']),
    outcome: s.string({ enum: ['EXAMINED', 'ABSENT'] }),
    result: { ...s.object({ scores: s.array(s.number()), total: s.number(), maxTotal: s.number(), recordedAt: s.dateTime() }, ['scores', 'total', 'maxTotal', 'recordedAt'], { description: 'null for ABSENT.' }), nullable: true },
  },
  ['exam', 'outcome', 'result'],
);
const pendingGroupSchema = s.object({ groupId: s.uuid(), groupName: s.string(), total: s.integer(), pending: s.integer() }, ['groupId', 'groupName', 'total', 'pending']);
const pendingStudentSchema = s.object({ studentId: s.uuid(), fullName: s.string(), groupId: s.uuid(), groupName: s.string(), examinationStatus: s.string({ enum: ['PENDING'] }) }, ['studentId', 'fullName', 'groupId', 'groupName', 'examinationStatus']);
const receiptSchema = s.object({ examId: s.uuid(), studentId: s.uuid(), groupId: s.uuid() }, ['examId', 'studentId', 'groupId']);

const examExample = (over: Record<string, unknown> = {}) => ({
  id: EXAM_ID, schoolId: SCHOOL_ID, status: 'SCHEDULED', wholeSchool: false, groupIds: [GROUP_ID], startAt: START, endAt: END, questionCount: 5, maxScore: 10, maxTotal: 50,
  examiners: [{ teacherId: TEACHER_ID, assignedAt: '2026-11-20T08:00:00.000Z' }], createdAt: '2026-11-20T08:00:00.000Z', ...over,
});
const scheduleExample = { id: EXAM_ID, schoolId: SCHOOL_ID, status: 'SCHEDULED', wholeSchool: false, startAt: START, endAt: END };

const GPS_DOC = s.object(
  { latitude: s.number({ example: 30.0444 }), longitude: s.number({ example: 31.2357 }), accuracyMeters: s.number({ example: 8 }) },
  [],
  { description: 'The examiner\'s GPS reading. REQUIRED by Smart Guard (sending none gives 400 SMART_GUARD_GPS_REQUIRED, an invalid one 400 SMART_GUARD_GPS_INVALID; not enforced by the schema so that those codes are returned). Must be within 50 m of the school and accurate to 20 m or better. No fallback exists.' },
);

const idParam = { id: { description: 'The exam id.', example: EXAM_ID, schema: s.uuid() } };
const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller lacks the permission or the scope (no reason is given; an exam, school or student that does not exist is also 403), or must first change the initial password.' };
const notFound: ErrorDoc = { status: 404, codes: ['EXAM_NOT_FOUND'], description: 'The exam does not exist (or was deleted).' };
const transition: ErrorDoc = { status: 422, codes: ['EXAM_INVALID_TRANSITION'], description: 'The exam\'s current status does not allow this action (`details.status`).' };
const op = (o: OperationDoc): OperationDoc => o;
const auth = (roles: string[], scope: string, enforcement: string, permissionId: string): AuthorizationDoc => ({ authentication: 'required', roles, scope, enforcement, permissionId, decision: 'APPROVED', reference: REFERENCE });
const managerAuth = (permissionId: string, what: string): AuthorizationDoc => auth(['SCHOOL_MANAGER'], 'The School Manager of the exam\'s school (the exam is loaded server-side).', `Authorization Engine permission with the MANAGEMENT/EXAM scope resolver (Module 30). ${what}`, permissionId);
const managerOnly = (summary: string, description: string, o: Omit<OperationDoc, 'summary' | 'description' | 'authorization'> & { permission: string; what: string }): OperationDoc => {
  const { permission, what, ...rest } = o;
  return op({ ...rest, summary, description, authorization: managerAuth(permission, what) });
};
const examQuery = listQueryParameters(EXAM_LIST_SPEC);

/** OpenAPI contract of `/exams` (`exam-routes.ts`). Module 30: exams. */
export const examApiDoc: ModuleApiDoc = {
  moduleId: '30',
  mountPath: '/exams',
  tag: {
    name: 'Exams',
    description:
      'Exams of a school, created and managed ONLY by its School Manager. Lifecycle: DRAFT, SCHEDULED, STARTED (automatic at the start time; the target list is FROZEN), COMPLETED (automatic at the end time, or manual when the exam has no end time; every unexamined target student is marked ABSENT, with no invented score), ENDED (manual, final; every examiner\'s exam-scoped permission is removed). CANCELLED only from DRAFT or SCHEDULED; deletion (a separate operation) only while DRAFT or SCHEDULED. Before STARTED all the configuration is editable and the target list follows the groups\' current students; after STARTED only the end time (strictly in the future) and the examiners can change. An exam has a question count and ONE uniform maximum score per question. Examiners are Teachers registered in the same school; they record ONE student\'s result at a time (all the question scores, atomically, rounded to two decimals; the total is the sum) ONLY while the exam is STARTED and through Smart Guard + GPS; the first of two concurrent submissions wins. Results are IMMUTABLE for everyone and can never be deleted. An examiner sees the exam and the PENDING students by group, never any result. A Parent sees the schedule of their children\'s school and only their own children\'s recorded results or ABSENT status. The Organization and geographic managers read exams through the future Reports module. Notifications are published as events and delivered by the Notifications modules.',
  },
  schemas: { Exam: examSchema, ExamSchedule: scheduleSchema, ExamResults: resultsSchema, StudentExamOutcome: outcomeSchema, ExamPendingGroup: pendingGroupSchema, ExamPendingStudent: pendingStudentSchema, ExamResultReceipt: receiptSchema },
  operations: [
    managerOnly('Create an exam (DRAFT)', 'Creates an exam in DRAFT. Any number of exams at any time. Target one group, several groups, or the whole school (`wholeSchool: true` with no groups). Examiners must be Teachers registered in the exam\'s school (a School Manager qualifies only as such a Teacher). Scheduling (a separate action) requires a start strictly in the future.', {
      method: 'post', path: '/', operationId: 'createExam', permission: ExamPermissions.CREATE, what: 'The school is the body\'s `schoolId`.',
      request: {
        description: 'The exam configuration.',
        schema: s.object(
          {
            schoolId: s.uuid({ example: SCHOOL_ID }),
            startAt: s.dateTime({ example: START }),
            endAt: s.dateTime({ nullable: true, example: END, description: 'Optional. Must be after `startAt`.' }),
            questionCount: s.integer({ minimum: 1, maximum: MAX_QUESTION_COUNT, example: 5 }),
            maxScore: s.number({ minimum: 0, maximum: MAX_SCORE_PER_QUESTION, example: 10, description: 'Above 0, at most 1000; rounded to two decimals.' }),
            wholeSchool: s.boolean({ example: false }),
            groupIds: s.array(s.uuid(), { description: 'Required (at least one) unless `wholeSchool` is true; then it must be empty. The groups must be ACTIVE and of the school.' }),
            examinerTeacherIds: s.array(s.uuid(), { description: 'Optional. Teachers registered in the school.' }),
          },
          ['schoolId', 'startAt', 'questionCount', 'maxScore'],
        ),
        examples: { groups: { summary: 'One group, two examiners', value: { schoolId: SCHOOL_ID, startAt: START, endAt: END, questionCount: 5, maxScore: 10, groupIds: [GROUP_ID], examinerTeacherIds: [TEACHER_ID] } }, school: { summary: 'Whole school, no end time', value: { schoolId: SCHOOL_ID, startAt: START, questionCount: 10, maxScore: 5, wholeSchool: true } } },
      },
      success: { status: 201, description: 'The exam, in DRAFT.', data: ref('Exam'), example: examExample({ status: 'DRAFT' }) },
      errors: [
        { status: 400, codes: ['EXAM_INVALID_START', 'EXAM_INVALID_END', 'EXAM_INVALID_QUESTION_COUNT', 'EXAM_INVALID_MAX_SCORE', 'EXAM_TARGET_REQUIRED'], description: 'The configuration is not valid.' },
        NOT_ALLOWED,
        { status: 422, codes: ['EXAM_INVALID_TARGET', 'EXAM_EXAMINER_NOT_ELIGIBLE'], description: 'A group is not an ACTIVE group of the school, or an examiner is not a Teacher registered in the school (`details.groupIds` / `details.teacherIds`).' },
      ],
    }),
    managerOnly('List the exams of a school', 'The school\'s exams (not deleted), newest start first by default, optionally filtered by `status` (comma separated). Drafts are included: this is the School Manager\'s view.', {
      method: 'get', path: '/schools/:schoolId', operationId: 'listSchoolExams', permission: ExamPermissions.LIST, what: 'The target is the school.',
      pathParams: { schoolId: { description: 'The school id.', example: SCHOOL_ID, schema: s.uuid() } },
      query: [...examQuery, { name: 'status', in: 'query', required: false, description: 'Comma separated statuses to keep.', schema: { type: 'string', example: 'SCHEDULED,STARTED' } }],
      success: { status: 200, description: 'A page of exams.', paginated: true, data: ref('Exam'), example: examExample() },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/schedule', operationId: 'listExamSchedule', summary: 'The exam schedule of my children\'s schools (Parent)',
      description: 'The exams of the schools where the caller has children that have been scheduled (SCHEDULED, STARTED, COMPLETED, ENDED, or cancelled after being scheduled): when, for which school, and the status. Nothing about targets, examiners or other students. A DRAFT or a deleted exam is never shown.',
      authorization: auth(['PARENT'], 'UNSCOPED: the application restricts the list to the schools of the caller\'s own children.', 'Authorization Engine permission; the application filters by the caller\'s linked children.', ExamPermissions.READ_SCHEDULE),
      query: examQuery, success: { status: 200, description: 'A page of exam schedule entries.', paginated: true, data: ref('ExamSchedule'), example: scheduleExample }, errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/assigned', operationId: 'listAssignedExams', summary: 'The exams I am assigned to (examiner)',
      description: 'The exams the caller is CURRENTLY assigned to as an examiner, in SCHEDULED, STARTED or COMPLETED. After ENDED (or when removed) the exam is gone from this list: the examiner has lost the exam-scoped permission.',
      authorization: auth(['TEACHER'], 'UNSCOPED: the application lists only exams where the caller is a currently assigned examiner.', 'Authorization Engine permission; the application filters by the caller\'s examiner assignments.', ExamPermissions.LIST_ASSIGNED),
      query: examQuery, success: { status: 200, description: 'A page of exams. No results are ever included.', paginated: true, data: ref('Exam'), example: examExample() }, errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/students/:id', operationId: 'listStudentExamOutcomes', summary: 'A student\'s recorded exam results and absences',
      description: 'The student\'s recorded results (all question scores and the total) and ABSENT statuses, newest first. Read access: the **School Manager** of the student\'s school and the student\'s own **Parent** (linked children only; never another student). Pending exams and unrecorded information are never shown.',
      authorization: auth(['SCHOOL_MANAGER', 'PARENT'], 'SCHOOL_MANAGER: the student\'s school. PARENT: only their own linked children.', 'Authorization Engine permission with the role-aware MANAGEMENT/STUDENT scope resolver (Module 19), which answers true only on positive proof for the role being checked.', ExamPermissions.READ_STUDENT),
      pathParams: { id: { description: 'The student id.', example: STUDENT_ID, schema: s.uuid() } },
      query: examQuery,
      success: { status: 200, description: 'A page of outcomes.', paginated: true, data: ref('StudentExamOutcome'), example: { exam: { ...scheduleExample, status: 'COMPLETED', questionCount: 5, maxScore: 10 }, outcome: 'EXAMINED', result: { scores: [8, 9.5, 7, 10, 6.25], total: 40.75, maxTotal: 50, recordedAt: '2026-12-01T09:40:00.000Z' } } },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/:id', operationId: 'getExam', summary: 'An exam',
      description: 'The exam configuration, its targets and its current examiners. Read access: the School Manager of the school and a **currently assigned examiner** (from SCHEDULED until ENDED). It never contains a result.',
      authorization: auth(['SCHOOL_MANAGER', 'TEACHER'], 'SCHOOL_MANAGER: the exam\'s school. TEACHER: only as a currently assigned examiner of this exam.', 'Authorization Engine permission with the MANAGEMENT/EXAM scope resolver (Module 30): the examiner scope is true only for an assignment that is still active.', ExamPermissions.READ),
      pathParams: idParam, success: { status: 200, description: 'The exam.', data: ref('Exam'), example: examExample() }, errors: [NOT_ALLOWED, notFound],
    }),
    managerOnly('Edit an exam (DRAFT or SCHEDULED)', 'Changes any configuration field (start, end, question count, maximum score, targets) while the exam is DRAFT or SCHEDULED. A SCHEDULED exam\'s start must stay in the future. After STARTED the configuration is locked (422 EXAM_CONFIG_LOCKED); only the end time (`PUT /exams/{id}/end-time`) and the examiners can change.', {
      method: 'patch', path: '/:id', operationId: 'updateExam', permission: ExamPermissions.UPDATE, what: 'The target is the exam.', pathParams: idParam,
      request: { description: 'Any of the configuration fields.', schema: s.object({ startAt: s.dateTime(), endAt: s.dateTime({ nullable: true }), questionCount: s.integer({ minimum: 1, maximum: MAX_QUESTION_COUNT }), maxScore: s.number(), wholeSchool: s.boolean(), groupIds: s.array(s.uuid()) }, []), examples: { reschedule: { summary: 'Move the exam', value: { startAt: '2026-12-02T09:00:00.000Z', endAt: '2026-12-02T11:00:00.000Z' } } } },
      success: { status: 200, description: 'The exam.', data: ref('Exam'), example: examExample() },
      errors: [{ status: 400, codes: ['EXAM_INVALID_START', 'EXAM_INVALID_END', 'EXAM_INVALID_QUESTION_COUNT', 'EXAM_INVALID_MAX_SCORE', 'EXAM_TARGET_REQUIRED'], description: 'The configuration is not valid.' }, NOT_ALLOWED, notFound,
        { status: 422, codes: ['EXAM_CONFIG_LOCKED', 'EXAM_LOCKED', 'EXAM_INVALID_TRANSITION', 'EXAM_START_NOT_IN_FUTURE', 'EXAM_INVALID_TARGET'], description: 'The exam is past DRAFT/SCHEDULED, the new start is not in the future, or a group is not valid.' }],
    }),
    managerOnly('Delete an exam (before it starts)', 'Deletion (a separate operation from cancellation) is only possible while the exam is DRAFT or SCHEDULED. The exam disappears from every read; its record is kept. After STARTED it can never be deleted.', {
      method: 'delete', path: '/:id', operationId: 'deleteExam', permission: ExamPermissions.LIFECYCLE, what: 'The target is the exam.', pathParams: idParam,
      success: { status: 204, description: 'The exam was deleted. No content.' }, errors: [NOT_ALLOWED, notFound, transition],
    }),
    managerOnly('Schedule an exam (DRAFT to SCHEDULED)', 'Moves a DRAFT exam to SCHEDULED. The start must be strictly in the future. The exam then starts automatically at its start time (Africa/Cairo).', {
      method: 'post', path: '/:id/schedule', operationId: 'scheduleExam', permission: ExamPermissions.LIFECYCLE, what: 'The target is the exam.', pathParams: idParam,
      success: { status: 200, description: 'The exam, SCHEDULED.', data: ref('Exam'), example: examExample() }, errors: [NOT_ALLOWED, notFound, { status: 422, codes: ['EXAM_INVALID_TRANSITION', 'EXAM_START_NOT_IN_FUTURE', 'EXAM_INVALID_TARGET'], description: 'The exam is not a DRAFT, its start is not in the future, or a group is not valid.' }],
    }),
    managerOnly('Cancel an exam (before it starts)', 'Cancels a DRAFT or SCHEDULED exam. It cannot be cancelled once STARTED, whatever the permission (422 EXAM_INVALID_TRANSITION).', {
      method: 'post', path: '/:id/cancel', operationId: 'cancelExam', permission: ExamPermissions.LIFECYCLE, what: 'The target is the exam.', pathParams: idParam,
      success: { status: 200, description: 'The exam, CANCELLED.', data: ref('Exam'), example: examExample({ status: 'CANCELLED' }) }, errors: [NOT_ALLOWED, notFound, transition],
    }),
    managerOnly('Complete an exam without an end time', 'Completes a STARTED exam that has NO end time (an exam with an end time completes automatically at it). Every unexamined target student is marked ABSENT (no score, no result); no new result can be submitted afterwards, and the end time can no longer be extended.', {
      method: 'post', path: '/:id/complete', operationId: 'completeExam', permission: ExamPermissions.LIFECYCLE, what: 'The target is the exam.', pathParams: idParam,
      success: { status: 200, description: 'The exam, COMPLETED.', data: ref('Exam'), example: examExample({ status: 'COMPLETED' }) }, errors: [NOT_ALLOWED, notFound, { status: 422, codes: ['EXAM_INVALID_TRANSITION', 'EXAM_END_TIME_DEFINED'], description: 'The exam is not STARTED, or it has an end time.' }],
    }),
    managerOnly('End an exam (COMPLETED to ENDED)', 'The final, one-way closure, only after COMPLETED and never automatic. Everything about the exam is locked permanently, every examiner\'s exam-scoped permission is removed (their Teacher role is untouched), and all records and results are preserved.', {
      method: 'post', path: '/:id/end', operationId: 'endExam', permission: ExamPermissions.LIFECYCLE, what: 'The target is the exam.', pathParams: idParam,
      success: { status: 200, description: 'The exam, ENDED.', data: ref('Exam'), example: examExample({ status: 'ENDED', examiners: [] }) }, errors: [NOT_ALLOWED, notFound, transition],
    }),
    managerOnly('Change the end time of a started exam', 'While the exam is STARTED the School Manager may extend or reduce the end time. The new end time must be strictly in the future (and after the start); the start time is immutable and the end time cannot be cleared. The updated end time decides the automatic completion. Not possible once COMPLETED.', {
      method: 'put', path: '/:id/end-time', operationId: 'changeExamEndTime', permission: ExamPermissions.UPDATE, what: 'The target is the exam.', pathParams: idParam,
      request: { description: 'The new end time.', schema: s.object({ endAt: s.dateTime({ example: '2026-12-01T12:00:00.000Z' }) }, ['endAt']), examples: { extend: { summary: 'Extend by one hour', value: { endAt: '2026-12-01T12:00:00.000Z' } } } },
      success: { status: 200, description: 'The exam.', data: ref('Exam'), example: examExample({ status: 'STARTED', endAt: '2026-12-01T12:00:00.000Z' }) },
      errors: [{ status: 400, codes: ['EXAM_INVALID_END'], description: 'Not a valid date.' }, NOT_ALLOWED, notFound, { status: 422, codes: ['EXAM_END_NOT_IN_FUTURE', 'EXAM_END_TIME_NOT_EDITABLE', 'EXAM_LOCKED'], description: 'The new end is not strictly in the future, or the exam is not STARTED.' }],
    }),
    managerOnly('Assign an examiner', 'Adds a Teacher as an examiner at any time until the exam ENDED, also after it STARTED. The Teacher must be registered in the exam\'s school; a Teacher of another school is not eligible even in the same organization.', {
      method: 'post', path: '/:id/examiners', operationId: 'assignExamExaminer', permission: ExamPermissions.MANAGE_EXAMINERS, what: 'The target is the exam.', pathParams: idParam,
      request: { description: 'The Teacher.', schema: s.object({ teacherId: s.uuid({ example: TEACHER_ID }) }, ['teacherId']), examples: { one: { summary: 'Add a Teacher', value: { teacherId: TEACHER_ID } } } },
      success: { status: 201, description: 'The exam with its current examiners.', data: ref('Exam'), example: examExample() },
      errors: [NOT_ALLOWED, notFound, { status: 409, codes: ['EXAM_EXAMINER_ALREADY_ASSIGNED'], description: 'The Teacher is already an examiner.' }, { status: 422, codes: ['EXAM_EXAMINER_NOT_ELIGIBLE', 'EXAM_LOCKED', 'EXAM_INVALID_TRANSITION'], description: 'Not a Teacher of the school, or the exam is ENDED/CANCELLED.' }],
    }),
    managerOnly('Remove an examiner', 'Removes an examiner at any time until the exam ENDED. Results the examiner already recorded are untouched; they can no longer submit new ones.', {
      method: 'delete', path: '/:id/examiners/:teacherId', operationId: 'removeExamExaminer', permission: ExamPermissions.MANAGE_EXAMINERS, what: 'The target is the exam.',
      pathParams: { ...idParam, teacherId: { description: 'The Teacher id.', example: TEACHER_ID, schema: s.uuid() } },
      success: { status: 200, description: 'The exam with its remaining examiners.', data: ref('Exam'), example: examExample({ examiners: [] }) }, errors: [NOT_ALLOWED, notFound, { status: 422, codes: ['EXAM_EXAMINER_NOT_ASSIGNED', 'EXAM_LOCKED', 'EXAM_INVALID_TRANSITION'], description: 'The Teacher is not a current examiner, or the exam is ENDED/CANCELLED.' }],
    }),
    managerOnly('The recorded results of an exam (School Manager)', 'ALL the recorded results of the exam (every question score, the total) and the students marked ABSENT. School Manager only: an examiner never reads a result, not even one they recorded.', {
      method: 'get', path: '/:id/results', operationId: 'getExamResults', permission: ExamPermissions.READ_RESULTS, what: 'The target is the exam.', pathParams: idParam,
      success: { status: 200, description: 'The results and the absent students.', data: ref('ExamResults'), example: { examId: EXAM_ID, status: 'COMPLETED', results: [{ id: RESULT_ID, examId: EXAM_ID, studentId: STUDENT_ID, groupId: GROUP_ID, scores: [8, 9.5, 7, 10, 6.25], total: 40.75, maxTotal: 50, recordedAt: '2026-12-01T09:40:00.000Z' }], absent: [] } },
      errors: [NOT_ALLOWED, notFound],
    }),
    op({
      method: 'get', path: '/:id/groups', operationId: 'listExamPendingGroups', summary: 'The groups of an exam with their pending students',
      description: 'The target groups with how many students are still pending (before STARTED: the live list; afterwards: the frozen list). The examiner picks a group first, then reads its pending students. Read access: the School Manager and a currently assigned examiner.',
      authorization: auth(['SCHOOL_MANAGER', 'TEACHER'], 'SCHOOL_MANAGER: the exam\'s school. TEACHER: only as a currently assigned examiner.', 'Authorization Engine permission with the MANAGEMENT/EXAM scope resolver (Module 30).', ExamPermissions.READ),
      pathParams: idParam, success: { status: 200, description: 'The groups.', data: s.array(ref('ExamPendingGroup')), example: [{ groupId: GROUP_ID, groupName: 'مجموعة أ', total: 12, pending: 9 }] }, errors: [NOT_ALLOWED, notFound],
    }),
    op({
      method: 'get', path: '/:id/groups/:groupId/students', operationId: 'listExamPendingStudents', summary: 'The pending students of one group',
      description: 'The students of ONE group who have not been examined yet, each with the group and the examination status (always PENDING). Never a flat list of all groups. An examined student leaves the list immediately; no result is ever shown here.',
      authorization: auth(['SCHOOL_MANAGER', 'TEACHER'], 'SCHOOL_MANAGER: the exam\'s school. TEACHER: only as a currently assigned examiner.', 'Authorization Engine permission with the MANAGEMENT/EXAM scope resolver (Module 30).', ExamPermissions.READ),
      pathParams: { ...idParam, groupId: { description: 'The group id.', example: GROUP_ID, schema: s.uuid() } }, query: examQuery,
      success: { status: 200, description: 'A page of pending students.', paginated: true, data: ref('ExamPendingStudent'), example: { studentId: STUDENT_ID, fullName: 'أحمد محمد', groupId: GROUP_ID, groupName: 'مجموعة أ', examinationStatus: 'PENDING' } }, errors: [NOT_ALLOWED, notFound],
    }),
    op({
      method: 'post', path: '/:id/results', operationId: 'submitExamResult', summary: 'Record one student\'s result (assigned examiner)',
      description:
        'A currently assigned examiner records ONE student\'s result: one score per question, in order, all of them in ONE atomic operation (nothing is stored on any failure). Only while the exam is STARTED and before its end, only through Smart Guard + GPS (window: 15 minutes before the start through the effective end; ownership, GPS distance <= 50 m, accuracy <= 20 m, active school). Each score is 0 to the maximum score per question and is rounded to two decimals; the total is the exact sum (no pass mark, percentage or ranking). The student must be a target of the exam and not yet examined: the first of two concurrent submissions wins, the other gets 409 EXAM_RESULT_ALREADY_RECORDED. A recorded result can never be edited or deleted by anyone.',
      authorization: auth(['TEACHER'], 'Only a Teacher who is a currently assigned examiner of this exam (the exam-scoped permission); plus Smart Guard.', 'Authorization Engine permission with the MANAGEMENT/EXAM scope resolver (Module 30), then Smart Guard (Module 25 `checkProtectedAction`), then the status/time/target rules inside one transaction under the exam lock (re-checking that the examiner is still assigned).', ExamPermissions.RECORD_RESULT),
      pathParams: idParam,
      request: {
        description: 'The student, the question scores and the GPS reading.',
        schema: s.object({ studentId: s.uuid({ example: STUDENT_ID }), scores: s.array(s.number({ minimum: 0, example: 8 }), { description: 'Exactly one score per question, in order.' }), gps: GPS_DOC }, ['studentId', 'scores']),
        examples: { five: { summary: 'Five questions, maximum 10', value: { studentId: STUDENT_ID, scores: [8, 9.5, 7, 10, 6.25], gps: { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 } } } },
      },
      success: { status: 201, description: 'The result was recorded; the student left the pending list. The Parent is notified immediately (event).', data: ref('ExamResultReceipt'), example: { examId: EXAM_ID, studentId: STUDENT_ID, groupId: GROUP_ID } },
      errors: [
        { status: 400, codes: ['EXAM_INVALID_SCORES', 'EXAM_SCORE_OUT_OF_RANGE', 'SMART_GUARD_GPS_REQUIRED', 'SMART_GUARD_GPS_INVALID'], description: 'The scores are not one number per question, a score is outside 0..maximum, or the GPS reading is missing or invalid.' },
        { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED', 'EXAM_NOT_EXAMINER'], description: 'The caller is not a currently assigned examiner of this exam (also when removed, or released at ENDED).' },
        notFound,
        { status: 409, codes: ['EXAM_RESULT_ALREADY_RECORDED', 'EXAM_CONCURRENT_CHANGE'], description: 'The student already has a result (a concurrent submission won), or the request could not be completed after retries.' },
        { status: 422, codes: ['SMART_GUARD_OUTSIDE_SESSION_WINDOW', 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', 'SMART_GUARD_GPS_ACCURACY_TOO_LOW', 'SMART_GUARD_SCHOOL_NOT_ACTIVE', 'EXAM_NOT_STARTED', 'EXAM_SUBMISSION_CLOSED', 'EXAM_STUDENT_NOT_TARGET'], description: 'Smart Guard refused the action, the exam is not STARTED (not started yet, completed, ended), or the student is not a target of the exam.' },
      ],
    }),
  ],
};
void transition;
