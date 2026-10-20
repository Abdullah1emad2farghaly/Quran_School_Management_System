import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc } from '../../../04-validation-api/public';
import { TeacherPermissions } from '../../application/services/teacher-authorization';
import { TEACHER_LIST_SPEC } from './teacher-routes';

const TEACHER_ID = '6e2f9a40-1c57-4d83-b0a6-3f7d8c1e5b92';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const OTHER_SCHOOL_ID = 'c47a19e0-3d58-4e6b-b2f1-90a7d5c3e812';
const ORG_ID = '7c1d5e93-2b8a-4f60-a1d4-9e3b6c0f8a21';
const LINK_ID = 'b81f3c60-2e94-4a75-8d06-f1e2a9c47b35';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Teachers 18); docs/TEACHERS.md';
const MANAGER_ENFORCEMENT =
  'Enforced by the Authorization Engine (deny by default): the caller must hold the SCHOOL_MANAGER role AND an active manager link to the school (for a Teacher: to at least one school the Teacher is actively linked to). The scope is loaded server-side. ORGANIZATION_MANAGER and MAIN_ADMIN have no Teacher permission.';

const schoolManager = (permissionId: string, scope: string): AuthorizationDoc => ({
  authentication: 'required',
  roles: ['SCHOOL_MANAGER'],
  scope,
  enforcement: MANAGER_ENFORCEMENT,
  permissionId,
  decision: 'PROVISIONAL',
  reference: REFERENCE,
});

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller lacks the permission or the scope (no reason is given), or the account must first change its initial password.' };
const notFound: ErrorDoc = { status: 404, codes: ['TEACHER_NOT_FOUND'], description: 'The Teacher does not exist.' };

const teacherSchema = s.object(
  {
    id: s.uuid(),
    userId: s.uuid({ description: 'The login account (Module 08).' }),
    organizationId: s.uuid({ description: 'The organization of the school that registered the Teacher. Never changes.' }),
    name: s.string({ description: 'The account\'s canonical personal name: exactly three parts (stored once, on the account).', example: 'خالد أحمد حسن' }),
    phone: s.string({ description: 'The normalized phone number (the login identifier).', example: '+201001234568' }),
    schoolIds: s.array(s.uuid(), { description: 'The schools the Teacher is currently linked to (all in the same organization).' }),
    createdAt: s.dateTime(),
    updatedAt: s.dateTime(),
  },
  ['id', 'userId', 'organizationId', 'name', 'phone', 'schoolIds', 'createdAt', 'updatedAt'],
);

const linkSchema = s.object(
  {
    id: s.uuid(),
    teacherId: s.uuid(),
    schoolId: s.uuid(),
    linkedAt: s.dateTime(),
    linkedBy: s.uuid(),
    unlinkedAt: s.dateTime({ nullable: true }),
    unlinkedBy: s.uuid({ nullable: true }),
    isActive: s.boolean(),
  },
  ['id', 'teacherId', 'schoolId', 'linkedAt', 'linkedBy', 'unlinkedAt', 'unlinkedBy', 'isActive'],
);

const teacherExample = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: TEACHER_ID,
  userId: USER_ID,
  organizationId: ORG_ID,
  name: 'خالد أحمد حسن',
  phone: '+201001234568',
  schoolIds: [SCHOOL_ID],
  createdAt: '2026-10-19T09:30:00.000Z',
  updatedAt: '2026-10-19T09:30:00.000Z',
  ...overrides,
});
const linkExample = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: LINK_ID,
  teacherId: TEACHER_ID,
  schoolId: SCHOOL_ID,
  linkedAt: '2026-10-19T09:30:00.000Z',
  linkedBy: USER_ID,
  unlinkedAt: null,
  unlinkedBy: null,
  isActive: true,
  ...overrides,
});

const teacherIdParam = { id: { description: 'The Teacher id.', example: TEACHER_ID, schema: s.uuid() } };
const schoolIdParam = { schoolId: { description: 'The school id.', example: SCHOOL_ID, schema: s.uuid() } };

/** OpenAPI contract of `/teachers` (`teacher-routes.ts`). Module 18: teachers. */
export const teacherApiDoc: ModuleApiDoc = {
  moduleId: '18',
  mountPath: '/teachers',
  tag: {
    name: 'Teachers',
    description: 'Teacher registration by the School Manager (new account with the mandatory first-login password change, or identity-matched account reuse inside the same organization), the Teacher-to-School relationship, and the Teacher\'s own profile.',
  },
  operations: [
    {
      method: 'post',
      path: '/',
      operationId: 'registerTeacher',
      summary: 'Register a Teacher (or reuse the existing account) for a school',
      description:
        'The School Manager registers a Teacher of THEIR school with a three-part personal name and a phone number. **New phone:** a new account is created with the name stored on it, the last four digits of the phone as its initial password and the mandatory first-login password change (the Teacher can use nothing but `POST /auth/change-password` and logout until it is changed); the TEACHER role is assigned. **Existing phone:** the account is never merged, overwritten or given a new password, and its `mustChangePassword` state is never touched. It is reused only when the name stored on the account equals the submitted name (a Parent, an organization manager or a school manager of the same person, for example), which then also receives the TEACHER role; a missing or different stored name is `TEACHER_IDENTITY_CONFLICT`, a deactivated account is `TEACHER_ACCOUNT_INACTIVE`, and a Teacher or Parent record of another organization is `TEACHER_ORGANIZATION_CONFLICT`. A matching name is the approved matching criterion, not independent proof of identity. Linking the same school twice is `TEACHER_ALREADY_LINKED_TO_SCHOOL`. The password is never returned.',
      authorization: schoolManager(TeacherPermissions.CREATE, 'The school named in the body (the caller must be its active manager).'),
      request: {
        description: 'The school and the Teacher\'s personal name and phone.',
        schema: s.object(
          {
            schoolId: s.uuid({ example: SCHOOL_ID }),
            name: s.string({ maxLength: 200, description: 'The Teacher\'s personal name: EXACTLY three parts (two or four parts are `INVALID_TEACHER_NAME`).', example: 'خالد أحمد حسن' }),
            phone: s.string({ maxLength: 40, description: 'Any accepted phone format; normalized to E.164.', example: '01001234568' }),
          },
          ['schoolId', 'name', 'phone'],
        ),
        examples: { newTeacher: { summary: 'Register a Teacher', value: { schoolId: SCHOOL_ID, name: 'خالد أحمد حسن', phone: '01001234568' } } },
      },
      success: { status: 201, description: 'The Teacher was registered (or reused) and linked to the school.', data: ref('TeacherRegistration'), example: { teacher: teacherExample(), link: linkExample(), accountCreated: true } },
      errors: [
        { status: 400, codes: ['INVALID_TEACHER_NAME', 'INVALID_PHONE_NUMBER'], description: 'The name does not have exactly three parts, or the phone is malformed.' },
        NOT_ALLOWED,
        { status: 409, codes: ['TEACHER_IDENTITY_CONFLICT', 'TEACHER_ORGANIZATION_CONFLICT', 'TEACHER_ALREADY_LINKED_TO_SCHOOL', 'TEACHER_CONCURRENT_MODIFICATION', 'USER_PHONE_ALREADY_EXISTS'], description: 'The phone belongs to an account that cannot be reused for this Teacher, the Teacher is already linked, or a concurrent registration could not be resolved (retry).' },
        { status: 422, codes: ['TEACHER_SCHOOL_NOT_ACTIVE', 'TEACHER_ACCOUNT_INACTIVE'], description: 'The school does not exist or is not ACTIVE, or the existing account is deactivated.' },
      ],
    },
    {
      method: 'get',
      path: '/me',
      operationId: 'getOwnTeacherProfile',
      summary: 'The caller\'s own Teacher profile',
      description: 'A Teacher reads their own profile (name, phone, linked schools). No id is accepted: the record is the one of the verified token.',
      authorization: {
        authentication: 'required',
        roles: ['TEACHER'],
        scope: 'The caller\'s own Teacher record (derived from the access token).',
        enforcement: 'Authorization Engine permission (unscoped); the record is looked up by the verified user id, never by a client-supplied id.',
        permissionId: TeacherPermissions.READ_OWN,
        decision: 'PROVISIONAL',
        reference: REFERENCE,
      },
      success: { status: 200, description: 'The caller\'s Teacher profile.', data: ref('Teacher'), example: teacherExample() },
      errors: [NOT_ALLOWED, notFound],
    },
    {
      method: 'get',
      path: '/schools/:schoolId',
      operationId: 'listSchoolTeachers',
      summary: 'List the Teachers of a school',
      description: 'A paginated list of the Teachers with an ACTIVE link to the school, newest first by default (`sort=createdAt` or `-createdAt`; the name cannot be sorted: it lives on the account, data of another module).',
      authorization: schoolManager(TeacherPermissions.LIST, 'The school in the path (the caller must be its active manager).'),
      pathParams: schoolIdParam,
      query: listQueryParameters(TEACHER_LIST_SPEC),
      success: { status: 200, description: 'A page of Teachers.', paginated: true, data: ref('Teacher'), example: teacherExample() },
      errors: [NOT_ALLOWED],
    },
    {
      method: 'get',
      path: '/:id',
      operationId: 'getTeacher',
      summary: 'Get one Teacher',
      description: 'Returns the Teacher to a School Manager of any school the Teacher is actively linked to. A Teacher linked only to other schools is `403 ACCESS_DENIED`.',
      authorization: schoolManager(TeacherPermissions.READ, 'A school the Teacher is actively linked to (loaded server-side).'),
      pathParams: teacherIdParam,
      success: { status: 200, description: 'The Teacher.', data: ref('Teacher'), example: teacherExample() },
      errors: [NOT_ALLOWED, notFound],
    },
    {
      method: 'delete',
      path: '/:id/schools/:schoolId',
      operationId: 'removeTeacherSchoolLink',
      summary: 'End a Teacher\'s link to one school',
      description:
        'Ends the Teacher-to-School relationship for THIS school only, and only while the Teacher has no groups in this school (`TEACHER_HAS_GROUPS_IN_SCHOOL`; enforced through the Groups module guard). The login account, the Teacher record and the links to other schools are untouched, and the ended link stays in the history. There is no global deactivation or deletion of a Teacher in V1.',
      authorization: schoolManager(TeacherPermissions.REMOVE_SCHOOL_LINK, 'The school in the path (the caller must be its active manager).'),
      pathParams: { ...teacherIdParam, ...schoolIdParam },
      success: { status: 200, description: 'The ended link.', data: ref('TeacherSchoolLink'), example: linkExample({ schoolId: OTHER_SCHOOL_ID, unlinkedAt: '2026-10-20T08:00:00.000Z', unlinkedBy: USER_ID, isActive: false }) },
      errors: [
        NOT_ALLOWED,
        { status: 404, codes: ['TEACHER_NOT_FOUND', 'TEACHER_SCHOOL_LINK_NOT_FOUND'], description: 'The Teacher does not exist, or is not linked to this school.' },
        { status: 409, codes: ['TEACHER_CONCURRENT_MODIFICATION'], description: 'A concurrent update could not be resolved; retry.' },
        { status: 422, codes: ['TEACHER_HAS_GROUPS_IN_SCHOOL'], description: 'The Teacher still has groups in this school; the relationship cannot be removed.' },
      ],
    },
  ],
  schemas: {
    Teacher: teacherSchema,
    TeacherSchoolLink: linkSchema,
    TeacherRegistration: s.object(
      {
        teacher: ref('Teacher'),
        link: ref('TeacherSchoolLink'),
        accountCreated: s.boolean({ description: 'True when a NEW login account was created (initial password + mandatory first-login change); false when an existing account was reused.' }),
      },
      ['teacher', 'link', 'accountCreated'],
    ),
  },
};
