import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { SessionPermissions } from '../../application/services/session-authorization';
import { CANCEL_SOURCES, SESSION_STATUSES, SLOT_RETIREMENT_REASONS } from '../../domain/value-objects/session-status';
import { SESSION_LIST_SPEC } from './session-routes';

const SESSION_ID = '5d2a8c41-7b36-4e09-9f15-a3c6e1d08b72';
const GROUP_ID = '4c9e1b72-3a58-4d06-9b17-e2f8a0d5c613';
const SLOT_ID = 'b1f4d7a2-6c39-4e85-9a10-3d8e5c2b7f46';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const TEACHER_ID = '7e1c4a95-2d68-4b03-8f27-c9a0d5e3b164';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Class Sessions 24); docs/CLASS-SESSIONS.md; Master Specification section 45';

const sessionSchema = s.object(
  {
    id: s.uuid(),
    schoolId: s.uuid(),
    groupId: s.uuid(),
    teacherId: s.uuid({ description: 'The Teacher (Module 18 record) the session belongs to: the group\'s Teacher when the session was created.' }),
    slotId: s.uuid({ description: 'The group schedule slot (Module 23) this session is an occurrence of.' }),
    occurrenceDate: s.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The calendar date of the occurrence in the business zone (Africa/Cairo).', example: '2026-11-02' }),
    scheduledStart: s.dateTime({ description: 'UTC instant derived from the slot (the slot\'s local Cairo time).' }),
    scheduledEnd: s.dateTime(),
    status: s.string({ enum: SESSION_STATUSES, description: 'OPEN (created 15 minutes before the start), IN_PROGRESS (from the start), COMPLETED (from the end) or CANCELLED. The system moves a session through these states; nobody does it by hand.' }),
    createdAt: s.dateTime(),
    startedAt: s.dateTime({ nullable: true, description: 'When the system moved it to IN_PROGRESS.' }),
    completedAt: s.dateTime({ nullable: true, description: 'When the system moved it to COMPLETED.' }),
    cancelledAt: s.dateTime({ nullable: true }),
    cancelledBy: s.uuid({ nullable: true, description: 'The Teacher\'s user id; null when the system cancelled.' }),
    cancelSource: { type: 'string', nullable: true, enum: [...CANCEL_SOURCES, null], description: 'TEACHER, or SCHEDULE_SLOT_RETIRED (the system, because the group\'s schedule slot was retired before the session started); null while not cancelled.' },
    cancelReason: s.string({ nullable: true, description: 'The Teacher\'s reason (never empty); null for a system cancellation or a session that is not cancelled.' }),
    slotRetireReason: { type: 'string', nullable: true, enum: [...SLOT_RETIREMENT_REASONS, null], description: 'For SCHEDULE_SLOT_RETIRED: why the slot was retired (REPLACED, REMOVED, GROUP_ARCHIVED).' },
  },
  ['id', 'schoolId', 'groupId', 'teacherId', 'slotId', 'occurrenceDate', 'scheduledStart', 'scheduledEnd', 'status', 'createdAt', 'startedAt', 'completedAt', 'cancelledAt', 'cancelledBy', 'cancelSource', 'cancelReason', 'slotRetireReason'],
);

const sessionExample = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: SESSION_ID, schoolId: SCHOOL_ID, groupId: GROUP_ID, teacherId: TEACHER_ID, slotId: SLOT_ID, occurrenceDate: '2026-11-02', scheduledStart: '2026-11-02T16:00:00.000Z', scheduledEnd: '2026-11-02T17:00:00.000Z',
  status: 'OPEN', createdAt: '2026-11-02T15:45:00.000Z', startedAt: null, completedAt: null, cancelledAt: null, cancelledBy: null, cancelSource: null, cancelReason: null, slotRetireReason: null, ...over,
});

const NOT_ALLOWED: ErrorDoc = {
  status: 403,
  codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED', 'CLASS_SESSION_NOT_ASSIGNED_TEACHER'],
  description: 'The caller lacks the permission or the scope (no reason is given; a group that does not exist is also 403), or the account must first change its initial password. CLASS_SESSION_NOT_ASSIGNED_TEACHER: a Teacher other than the one assigned to the session tried to cancel it.',
};
const sessionNotFound: ErrorDoc = { status: 404, codes: ['CLASS_SESSION_NOT_FOUND'], description: 'The session does not exist.' };

const teacherOrManager: AuthorizationDoc = {
  authentication: 'required',
  roles: ['SCHOOL_MANAGER', 'TEACHER'],
  scope: 'SCHOOL_MANAGER: the group\'s school. TEACHER: the ACTIVE group they teach. The group is loaded server-side (through the session when the path names a session).',
  enforcement: 'Authorization Engine permission with the role-aware MANAGEMENT/GROUP scope resolver (Module 20), which answers true only on positive proof for the role being checked. PARENT, ORGANIZATION_MANAGER and MAIN_ADMIN have no session permission.',
  permissionId: SessionPermissions.READ,
  decision: 'PROVISIONAL',
  reference: REFERENCE,
};

const idParam = { id: { description: 'The session id.', example: SESSION_ID, schema: s.uuid() } };
const groupIdParam = { id: { description: 'The group id.', example: GROUP_ID, schema: s.uuid() } };
const op = (o: OperationDoc): OperationDoc => o;

/** OpenAPI contract of `/sessions` (`session-routes.ts`). Module 24: class sessions. */
export const classSessionApiDoc: ModuleApiDoc = {
  moduleId: '24',
  mountPath: '/sessions',
  tag: {
    name: 'Class Sessions',
    description:
      'The sessions of a group: one occurrence of a schedule slot (NO GROUP SCHEDULE = NO SESSION). The system creates each session 15 minutes before its scheduled start (never earlier, never by hand), moves it to IN_PROGRESS at its start and to COMPLETED at its end, and cancels it automatically when its slot is retired before the start. The assigned Teacher may cancel a session with a mandatory reason; a completed session cannot be cancelled. Sessions are never deleted. There is no endpoint to create, start, complete, edit or delete a session.',
  },
  schemas: { ClassSession: sessionSchema },
  operations: [
    op({
      method: 'get', path: '/mine', operationId: 'listOwnClassSessions', summary: 'My sessions (Teacher)',
      description: 'The calling Teacher\'s sessions, newest first by default (`sort=scheduledStart`, `-` for descending), optionally filtered with `filter[status]`. The Teacher is derived from the access token. Empty for a Teacher without sessions.',
      authorization: { authentication: 'required', roles: ['TEACHER'], scope: 'The caller\'s own Teacher record (derived from the access token).', enforcement: 'Authorization Engine permission (unscoped); the Teacher record is looked up by the verified user id.', permissionId: SessionPermissions.LIST_OWN, decision: 'PROVISIONAL', reference: REFERENCE },
      query: listQueryParameters(SESSION_LIST_SPEC),
      success: { status: 200, description: 'A page of the caller\'s sessions.', paginated: true, data: ref('ClassSession'), example: sessionExample() },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/groups/:id', operationId: 'listGroupClassSessions', summary: 'The sessions of a group',
      description: 'A paginated list of the group\'s sessions, newest first by default, optionally filtered with `filter[status]`. Read access is by role and relationship, proven from server data: the **School Manager** of the group\'s school and the **Teacher** of the group (ACTIVE groups only). Anyone else is `403 ACCESS_DENIED`.',
      authorization: teacherOrManager, pathParams: groupIdParam, query: listQueryParameters(SESSION_LIST_SPEC),
      success: { status: 200, description: 'A page of the group\'s sessions.', paginated: true, data: ref('ClassSession'), example: sessionExample() },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/:id', operationId: 'getClassSession', summary: 'One session',
      description: 'A session with its status, times and, when cancelled, who or what cancelled it, when and why. The caller must be allowed to read the session\'s group (School Manager of its school, or the Teacher of the group).',
      authorization: teacherOrManager, pathParams: idParam,
      success: { status: 200, description: 'The session.', data: ref('ClassSession'), example: sessionExample() },
      errors: [NOT_ALLOWED, sessionNotFound],
    }),
    op({
      method: 'post', path: '/:id/cancel', operationId: 'cancelClassSession', summary: 'Cancel a session (assigned Teacher)',
      description: 'The Teacher assigned to the session cancels it with a mandatory, non-empty reason; the Teacher, the time and the reason are recorded. Only an OPEN or IN_PROGRESS session can be cancelled: a COMPLETED session cannot, and an already CANCELLED session keeps its original cancellation (reason and source). A session that has already reached its scheduled end is COMPLETED and cannot be cancelled. The Teacher is derived from the access token.',
      authorization: { authentication: 'required', roles: ['TEACHER'], scope: 'The ACTIVE group the session belongs to (loaded server-side through the session); in addition the caller must be the Teacher assigned to the session.', enforcement: 'Authorization Engine permission with the MANAGEMENT/GROUP scope resolver (Module 20), plus the application check that the caller\'s Teacher record is the session\'s Teacher.', permissionId: SessionPermissions.CANCEL, decision: 'APPROVED', reference: REFERENCE },
      pathParams: idParam,
      request: {
        description: 'The reason for the cancellation (required, not empty, at most 500 characters).',
        schema: s.object({ reason: s.string({ description: 'Why the session is cancelled.', example: 'المعلم في إجازة مرضية' }) }, ['reason']),
        examples: { sick: { summary: 'Teacher unavailable', value: { reason: 'المعلم في إجازة مرضية' } } },
      },
      success: { status: 200, description: 'The cancelled session.', data: ref('ClassSession'), example: sessionExample({ status: 'CANCELLED', cancelledAt: '2026-11-02T15:50:00.000Z', cancelledBy: USER_ID, cancelSource: 'TEACHER', cancelReason: 'المعلم في إجازة مرضية' }) },
      errors: [
        { status: 400, codes: ['CLASS_SESSION_CANCEL_REASON_REQUIRED', 'CLASS_SESSION_CANCEL_REASON_TOO_LONG'], description: 'The reason is empty (or only blanks) or longer than 500 characters.' },
        NOT_ALLOWED,
        sessionNotFound,
        { status: 409, codes: ['CLASS_SESSION_NOT_CANCELLABLE'], description: 'The session is COMPLETED or already CANCELLED (`details.status`); nothing changes.' },
      ],
    }),
  ],
};
