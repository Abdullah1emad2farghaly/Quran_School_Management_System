import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { StudentPermissions } from '../../application/services/student-authorization';
import { STUDENT_STATUSES } from '../../domain/value-objects/student-status';
import { STUDENT_LIST_SPEC } from './student-routes';

const STUDENT_ID = '2b7f9a40-5c18-4d63-8e02-6a1d3c9f7b85';
const PARENT_ID = '5d8e2a14-7b36-4c09-9f21-a8c4e6b0d173';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const ORG_ID = '7c1d5e93-2b8a-4f60-a1d4-9e3b6c0f8a21';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const GOVERNORATE_ID = '1e9d4c7b-0a62-4b8f-9c35-d7f1a2b6e840';
const HISTORY_ID = 'e4c2a8b1-93d7-4f06-a5b8-1d70c6e39f42';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Students 19); docs/STUDENTS.md';
const MANAGER_ENFORCEMENT =
  'Enforced by the Authorization Engine (deny by default): the caller must hold the SCHOOL_MANAGER role AND an active manager link to the student\'s school (loaded server-side, never from the request). ORGANIZATION_MANAGER and MAIN_ADMIN have no Student permission.';

const schoolManager = (permissionId: string, scope: string): AuthorizationDoc => ({
  authentication: 'required',
  roles: ['SCHOOL_MANAGER'],
  scope,
  enforcement: MANAGER_ENFORCEMENT,
  permissionId,
  decision: 'APPROVED',
  reference: REFERENCE,
});

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller lacks the permission or the scope (no reason is given), or the account must first change its initial password.' };
const notFound: ErrorDoc = { status: 404, codes: ['STUDENT_NOT_FOUND'], description: 'The Student does not exist.' };

const addressSchema = s.object(
  {
    governorateId: s.uuid({ example: GOVERNORATE_ID }),
    governorateName: s.string({ description: 'The governorate name as stored with the Parent\'s address (a snapshot).', example: 'المنيا' }),
    centerName: s.string({ nullable: true, description: 'Free text (center or city).', example: 'سمالوط' }),
    villageName: s.string({ nullable: true, description: 'Free text.', example: 'برمشا' }),
    since: s.dateTime({ description: 'When this address became the Parent\'s current one.' }),
  },
  ['governorateId', 'governorateName', 'centerName', 'villageName', 'since'],
);

const studentSchema = s.object(
  {
    id: s.uuid(),
    schoolId: s.uuid({ description: 'The Student\'s ONE school. Never changes in V1 (no transfer).' }),
    organizationId: s.uuid({ description: 'The organization of the school.' }),
    parentId: s.uuid({ description: 'The Student\'s ONE Parent (Module 17). Never changes in V1.' }),
    fullName: s.string({ description: 'At least three parts; the second and third parts are the Parent\'s first and second names.', example: 'عمر أحمد محمد' }),
    nationalId: s.string({ description: 'The Egyptian National ID: exactly 14 digits, unique across the whole system. Never changes in V1.', example: '30001010123456' }),
    joinDate: s.string({ format: 'date', description: 'The join date (business date, Africa/Cairo).', example: '2026-10-18' }),
    status: s.string({ enum: STUDENT_STATUSES, description: 'ACTIVE, INACTIVE or ARCHIVED (final).' }),
    address: ref('StudentAddress'),
    createdAt: s.dateTime(),
    updatedAt: s.dateTime(),
  },
  ['id', 'schoolId', 'organizationId', 'parentId', 'fullName', 'nationalId', 'joinDate', 'status', 'address', 'createdAt', 'updatedAt'],
);

const teacherStudentSchema = s.object(
  {
    id: s.uuid(),
    schoolId: s.uuid(),
    fullName: s.string({ example: 'عمر أحمد محمد' }),
    joinDate: s.string({ format: 'date', example: '2026-10-18' }),
    status: s.string({ enum: STUDENT_STATUSES }),
  },
  ['id', 'schoolId', 'fullName', 'joinDate', 'status'],
  { description: 'What a TEACHER receives: no National ID, no Parent reference, no address.' },
);

const historySchema = s.object(
  {
    id: s.uuid(),
    studentId: s.uuid(),
    action: s.string({ enum: ['REGISTERED', 'DETAILS_UPDATED', 'STATUS_CHANGED'] }),
    actorId: s.uuid(),
    occurredAt: s.dateTime(),
    reason: s.string({ nullable: true }),
    // Not an `enum`: in OpenAPI 3.0 a nullable enum must list `null` itself, which the schema helper cannot express; the values are documented instead.
    previousStatus: s.string({ nullable: true, description: 'ACTIVE, INACTIVE or ARCHIVED; null when no status applies (registration, corrections).' }),
    newStatus: s.string({ nullable: true, description: 'ACTIVE, INACTIVE or ARCHIVED; null for a correction of the name or join date.' }),
    previousFullName: s.string({ nullable: true }),
    newFullName: s.string({ nullable: true }),
    previousJoinDate: s.string({ nullable: true, format: 'date' }),
    newJoinDate: s.string({ nullable: true, format: 'date' }),
  },
  ['id', 'studentId', 'action', 'actorId', 'occurredAt', 'reason', 'previousStatus', 'newStatus', 'previousFullName', 'newFullName', 'previousJoinDate', 'newJoinDate'],
);

const addressExample = { governorateId: GOVERNORATE_ID, governorateName: 'المنيا', centerName: 'سمالوط', villageName: 'برمشا', since: '2026-10-18T09:30:00.000Z' };
const studentExample = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: STUDENT_ID,
  schoolId: SCHOOL_ID,
  organizationId: ORG_ID,
  parentId: PARENT_ID,
  fullName: 'عمر أحمد محمد',
  nationalId: '30001010123456',
  joinDate: '2026-10-18',
  status: 'ACTIVE',
  address: addressExample,
  createdAt: '2026-10-18T09:30:00.000Z',
  updatedAt: '2026-10-18T09:30:00.000Z',
  ...overrides,
});

const studentIdParam = { id: { description: 'The Student id.', example: STUDENT_ID, schema: s.uuid() } };
const schoolIdParam = { schoolId: { description: 'The school id.', example: SCHOOL_ID, schema: s.uuid() } };

const validationErrors: ErrorDoc = {
  status: 400,
  codes: ['INVALID_STUDENT_NAME', 'INVALID_STUDENT_NATIONAL_ID', 'INVALID_STUDENT_JOIN_DATE', 'INVALID_STUDENT_REASON', 'STUDENT_UPDATE_EMPTY'],
  description:
    'The name has fewer than three parts or is longer than 200 characters, the National ID is not exactly 14 digits, the join date is not a real YYYY-MM-DD date, the reason is too long, or an update carries neither a name nor a join date.',
};
const concurrent: ErrorDoc = { status: 409, codes: ['STUDENT_CONCURRENT_MODIFICATION'], description: 'A concurrent update could not be resolved; retry.' };
const archivedErrors: ErrorDoc = { status: 422, codes: ['STUDENT_ARCHIVED', 'STUDENT_INVALID_STATUS_TRANSITION'], description: 'The action is not allowed in the Student\'s current status (an ARCHIVED student is read-only and final).' };

const reasonRequest = (summary: string) => ({
  description: 'An optional free-text reason (at most 500 characters), kept in the Student history.',
  schema: s.object({ reason: s.string({ maxLength: 500, nullable: true, example: 'انتقل الطالب إلى خارج المنطقة' }) }, []),
  examples: { withReason: { summary, value: { reason: 'انتقل الطالب إلى خارج المنطقة' } } },
});

const lifecycleOperation = (name: 'deactivate' | 'reactivate' | 'archive', permission: string, from: string, to: string, extra: string, errors: ErrorDoc[]): OperationDoc => ({
  method: 'post',
  path: `/:id/${name}`,
  operationId: `${name}Student`,
  summary: `${name[0]!.toUpperCase()}${name.slice(1)} a Student (${from} → ${to})`,
  description: `${extra} The change, its reason, the actor and the time are kept in the Student history, and a StudentStatusChanged event is published. Students are never deleted.`,
  authorization: schoolManager(permission, 'The Student\'s school (the caller must be its active manager; loaded server-side).'),
  pathParams: studentIdParam,
  request: reasonRequest(`${name} with a reason`),
  success: { status: 200, description: `The Student after the change.`, data: ref('Student'), example: studentExample({ status: to }) },
  errors: [NOT_ALLOWED, notFound, validationErrors, ...errors],
});

/** OpenAPI contract of `/students` (`student-routes.ts`). Module 19: students. */
export const studentApiDoc: ModuleApiDoc = {
  moduleId: '19',
  mountPath: '/students',
  tag: {
    name: 'Students',
    description:
      'Student registration by the School Manager (exactly one Parent, three-part name rule, globally unique National ID), reads by the School Manager, the Student\'s own Parent and a Teacher of the Student\'s group, corrections, and the ACTIVE / INACTIVE / ARCHIVED lifecycle with history.',
  },
  operations: [
    {
      method: 'post',
      path: '/',
      operationId: 'registerStudent',
      summary: 'Register a Student in a school',
      description:
        'The School Manager registers a Student of THEIR school under a Parent who belongs to the school\'s organization and is actively linked to that school. **Name:** at least three parts; the second part is the Parent\'s first name and the third part the Parent\'s second name. **National ID:** exactly 14 digits, unique across the WHOLE system (every organization, school and status): a duplicate is `409 STUDENT_NATIONAL_ID_CONFLICT` and nothing about the existing student is revealed or changed. **Join date:** optional, defaults to today (Africa/Cairo). The Student has no login and no address of their own: the address read back is the Parent\'s current address. The group is assigned later by the Groups module.',
      authorization: schoolManager(StudentPermissions.CREATE, 'The school named in the body (the caller must be its active manager).'),
      request: {
        description: 'The school, the Parent, the Student\'s full name and National ID, and optionally the join date.',
        schema: s.object(
          {
            schoolId: s.uuid({ example: SCHOOL_ID }),
            parentId: s.uuid({ example: PARENT_ID, description: 'A Parent actively linked to the school (see `GET /parents/schools/{schoolId}`).' }),
            fullName: s.string({ maxLength: 1000, description: 'At least three parts; parts 2 and 3 are the Parent\'s first and second names.', example: 'عمر أحمد محمد' }),
            nationalId: s.string({ maxLength: 40, description: 'Exactly 14 digits (Arabic-Indic digits are accepted and converted).', example: '30001010123456' }),
            joinDate: s.string({ maxLength: 40, nullable: true, description: 'YYYY-MM-DD. Optional.', example: '2026-10-18' }),
          },
          ['schoolId', 'parentId', 'fullName', 'nationalId'],
        ),
        examples: {
          minimal: { summary: 'Without a join date', value: { schoolId: SCHOOL_ID, parentId: PARENT_ID, fullName: 'عمر أحمد محمد', nationalId: '30001010123456' } },
          withJoinDate: { summary: 'With a join date', value: { schoolId: SCHOOL_ID, parentId: PARENT_ID, fullName: 'عمر أحمد محمد', nationalId: '30001010123456', joinDate: '2026-10-18' } },
        },
      },
      success: { status: 201, description: 'The Student was registered (ACTIVE).', data: ref('Student'), example: studentExample() },
      errors: [
        validationErrors,
        NOT_ALLOWED,
        { status: 409, codes: ['STUDENT_NATIONAL_ID_CONFLICT'], description: 'The National ID is already registered in the system (any organization, school or status).' },
        { status: 422, codes: ['STUDENT_SCHOOL_NOT_ACTIVE', 'STUDENT_PARENT_NOT_LINKED_TO_SCHOOL', 'STUDENT_NAME_PARENT_MISMATCH'], description: 'The school is not ACTIVE; the Parent does not exist, belongs to another organization or is not linked to the school; or the name does not carry the Parent\'s first and second names as its second and third parts.' },
      ],
    },
    {
      method: 'get',
      path: '/mine',
      operationId: 'listOwnChildren',
      summary: 'The caller\'s own children',
      description: 'A Parent lists the Students linked to THEIR Parent record (any status; filter with `filter[status]`). No id is accepted: the Parent is the one of the verified token. A Parent cannot change anything about a Student.',
      authorization: {
        authentication: 'required',
        roles: ['PARENT'],
        scope: 'The caller\'s own Parent record (derived from the access token).',
        enforcement: 'Authorization Engine permission (unscoped); the Parent record is looked up by the verified user id, never by a client-supplied id.',
        permissionId: StudentPermissions.LIST_OWN_CHILDREN,
        decision: 'APPROVED',
        reference: REFERENCE,
      },
      query: listQueryParameters(STUDENT_LIST_SPEC),
      success: { status: 200, description: 'A page of the caller\'s children.', paginated: true, data: ref('Student'), example: studentExample() },
      errors: [NOT_ALLOWED],
    },
    {
      method: 'get',
      path: '/schools/:schoolId',
      operationId: 'listSchoolStudents',
      summary: 'List the Students of a school',
      description: 'A paginated list of the Students of the school in any status (filter with `filter[status]`, e.g. `ACTIVE,INACTIVE`), newest first by default (`sort=createdAt`, `joinDate` or `fullName`, `-` for descending).',
      authorization: schoolManager(StudentPermissions.LIST, 'The school in the path (the caller must be its active manager).'),
      pathParams: schoolIdParam,
      query: listQueryParameters(STUDENT_LIST_SPEC),
      success: { status: 200, description: 'A page of Students.', paginated: true, data: ref('Student'), example: studentExample() },
      errors: [NOT_ALLOWED],
    },
    {
      method: 'get',
      path: '/:id',
      operationId: 'getStudent',
      summary: 'Get one Student',
      description:
        'Read access is granted by role and relationship, all proven from server data: the **School Manager** of the Student\'s school; the **Parent** of the Student (own children only); a **Teacher** actively linked to the Student\'s school whose group the Student is in (the Teacher receives the minimal view: no National ID, no Parent reference, no address). Anyone else is `403 ACCESS_DENIED`, including a Student that does not exist for a non-manager.',
      authorization: {
        authentication: 'required',
        roles: ['SCHOOL_MANAGER', 'PARENT', 'TEACHER'],
        scope: 'SCHOOL_MANAGER: the Student\'s school. PARENT: the Student\'s own Parent. TEACHER: a group assigned to them that contains the Student (supplied by Module 20; denied for every Teacher until it exists).',
        enforcement: 'Authorization Engine permission with a role-aware MANAGEMENT/STUDENT scope resolver that answers true only on positive proof for the role being checked. No other role has any Student permission.',
        permissionId: StudentPermissions.READ,
        decision: 'APPROVED',
        reference: REFERENCE,
      },
      pathParams: studentIdParam,
      success: { status: 200, description: 'The Student (full view, or the minimal Teacher view).', data: ref('Student'), example: studentExample() },
      errors: [NOT_ALLOWED, notFound],
    },
    {
      method: 'get',
      path: '/:id/history',
      operationId: 'getStudentHistory',
      summary: 'The Student\'s change history',
      description: 'Registration, corrections and lifecycle changes, oldest first: who did it, when, what changed, the previous value and the reason. Rows are never updated or deleted.',
      authorization: schoolManager(StudentPermissions.READ_HISTORY, 'The Student\'s school (the caller must be its active manager).'),
      pathParams: studentIdParam,
      success: {
        status: 200,
        description: 'The history entries.',
        data: s.array(ref('StudentHistoryEntry')),
        example: [{ id: HISTORY_ID, studentId: STUDENT_ID, action: 'REGISTERED', actorId: USER_ID, occurredAt: '2026-10-18T09:30:00.000Z', reason: null, previousStatus: null, newStatus: 'ACTIVE', previousFullName: null, newFullName: 'عمر أحمد محمد', previousJoinDate: null, newJoinDate: '2026-10-18' }],
      },
      errors: [NOT_ALLOWED, notFound],
    },
    {
      method: 'patch',
      path: '/:id',
      operationId: 'updateStudent',
      summary: 'Correct a Student\'s name and/or join date',
      description:
        'Corrects the name and/or the join date of an ACTIVE or INACTIVE Student; the previous values stay in the history. A new name must keep the Parent\'s first and second names as its second and third parts. The **Parent, the school and the National ID never change** (no transfer and no automatic move to another Parent in V1). A value equal to the current one changes nothing. An ARCHIVED Student is read-only.',
      authorization: schoolManager(StudentPermissions.UPDATE, 'The Student\'s school (the caller must be its active manager).'),
      pathParams: studentIdParam,
      request: {
        description: 'The corrected name and/or join date (at least one).',
        schema: s.object(
          {
            fullName: s.string({ maxLength: 1000, example: 'عمر أحمد محمد' }),
            joinDate: s.string({ maxLength: 40, example: '2026-10-20' }),
          },
          [],
        ),
        examples: { correctJoinDate: { summary: 'Correct the join date', value: { joinDate: '2026-10-20' } } },
      },
      success: { status: 200, description: 'The Student after the change.', data: ref('Student'), example: studentExample({ joinDate: '2026-10-20' }) },
      errors: [validationErrors, NOT_ALLOWED, notFound, concurrent, { status: 422, codes: ['STUDENT_NAME_PARENT_MISMATCH', 'STUDENT_ARCHIVED'], description: 'The new name does not carry the Parent\'s first and second names as its second and third parts, or the Student is ARCHIVED.' }],
    },
    lifecycleOperation('deactivate', StudentPermissions.DEACTIVATE, 'ACTIVE', 'INACTIVE', 'Moves an ACTIVE Student to INACTIVE (for example a temporary stop).', [concurrent, archivedErrors]),
    lifecycleOperation('reactivate', StudentPermissions.REACTIVATE, 'INACTIVE', 'ACTIVE', 'Moves an INACTIVE Student back to ACTIVE, only while the school is ACTIVE and the Parent is still linked to it. An ARCHIVED Student can never be reactivated.', [
      concurrent,
      { status: 422, codes: ['STUDENT_SCHOOL_NOT_ACTIVE', 'STUDENT_PARENT_NOT_LINKED_TO_SCHOOL', 'STUDENT_ARCHIVED', 'STUDENT_INVALID_STATUS_TRANSITION'], description: 'The school is not ACTIVE, the Parent relationship is no longer valid, or the Student is not INACTIVE.' },
    ]),
    lifecycleOperation('archive', StudentPermissions.ARCHIVE, 'ACTIVE or INACTIVE', 'ARCHIVED', 'Archives the Student: the record, its National ID and its history are kept forever, and the Student becomes read-only. Archiving is final in V1.', [concurrent, archivedErrors]),
  ],
  schemas: {
    StudentAddress: addressSchema,
    Student: studentSchema,
    StudentTeacherView: teacherStudentSchema,
    StudentHistoryEntry: historySchema,
  },
};
