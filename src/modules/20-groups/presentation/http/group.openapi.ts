import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { GroupPermissions } from '../../application/services/group-authorization';
import { GROUP_STATUSES, LEARNING_MODES, PROGRESSIONS } from '../../domain/value-objects/group-settings';
import { GROUP_LIST_SPEC, GROUP_STUDENTS_SPEC, OWN_GROUPS_SPEC } from './group-routes';

const GROUP_ID = '4c9e1b72-3a58-4d06-9b17-e2f8a0d5c613';
const GROUP2_ID = '8d3f6a15-7c20-4e94-a6b1-0f5e2c9d7a38';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const ORG_ID = '7c1d5e93-2b8a-4f60-a1d4-9e3b6c0f8a21';
const TEACHER_ID = '2f8b5d41-9e07-4a36-8c12-b7d0e6a3f945';
const STUDENT_ID = '2b7f9a40-5c18-4d63-8e02-6a1d3c9f7b85';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const ENTRY_ID = 'e4c2a8b1-93d7-4f06-a5b8-1d70c6e39f42';
const WHEN = '2026-10-21T09:30:00.000Z';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Groups 20); docs/GROUPS.md';
const MANAGER_ENFORCEMENT =
  'Enforced by the Authorization Engine (deny by default): the caller must hold the SCHOOL_MANAGER role AND an active manager link to the group\'s school (loaded server-side, never from the request). ORGANIZATION_MANAGER and MAIN_ADMIN have no Group permission.';

const schoolManager = (permissionId: string, scope: string): AuthorizationDoc => ({ authentication: 'required', roles: ['SCHOOL_MANAGER'], scope, enforcement: MANAGER_ENFORCEMENT, permissionId, decision: 'APPROVED', reference: REFERENCE });

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller lacks the permission or the scope (no reason is given), or the account must first change its initial password.' };
const notFound: ErrorDoc = { status: 404, codes: ['GROUP_NOT_FOUND'], description: 'The group does not exist.' };
const concurrent: ErrorDoc = { status: 409, codes: ['GROUP_CONCURRENT_MODIFICATION'], description: 'A concurrent change could not be resolved; retry.' };
const archived: ErrorDoc = { status: 422, codes: ['GROUP_ARCHIVED'], description: 'The group is ARCHIVED: read-only and final.' };
const validationErrors: ErrorDoc = {
  status: 400,
  codes: ['INVALID_GROUP_NAME', 'INVALID_GROUP_LEARNING_MODE', 'INVALID_GROUP_PROGRESSION', 'INVALID_GROUP_STARTING_SURAH', 'INVALID_GROUP_REASON', 'GROUP_UPDATE_EMPTY'],
  description: 'The name is empty or longer than 200 characters, the learning mode is not GROUP / INDIVIDUAL, the progression is not FORWARD / BACKWARD, the starting surah is not a whole number from 1 to 114, the reason is too long, or an update carries nothing to change.',
};

const teacherSchema = s.object({ id: s.uuid({ example: TEACHER_ID }), name: s.string({ example: 'خالد أحمد حسن' }) }, ['id', 'name'], { description: 'The group\'s Teacher: at most ONE; null while the group has none.' });
const groupSchema = s.object(
  {
    id: s.uuid(),
    schoolId: s.uuid({ description: 'The group\'s ONE school. Never changes.' }),
    organizationId: s.uuid(),
    name: s.string({ description: 'Unique among the ACTIVE groups of the school (an ARCHIVED group\'s name is free again).', example: 'حلقة الفجر' }),
    // An inline object with an explicit `type` (a bare `nullable` next to `allOf` / `$ref` is rejected by the strict schema validator).
    teacher: { ...teacherSchema, nullable: true },
    learningMode: s.string({ enum: LEARNING_MODES, description: 'GROUP: the same session assignment for the group. INDIVIDUAL: student-specific assignments.' }),
    progression: s.string({ enum: PROGRESSIONS, description: 'FORWARD or BACKWARD. A change applies from then on and never rewrites what already happened.' }),
    startingSurah: s.integer({ minimum: 1, maximum: 114, description: 'The surah NUMBER the group starts from (the surah names belong to the Quran-structure module).', example: 78 }),
    status: s.string({ enum: GROUP_STATUSES, description: 'ACTIVE or ARCHIVED (final).' }),
    createdAt: s.dateTime(),
    updatedAt: s.dateTime(),
  },
  ['id', 'schoolId', 'organizationId', 'name', 'teacher', 'learningMode', 'progression', 'startingSurah', 'status', 'createdAt', 'updatedAt'],
);
const parentGroupSchema = s.object({ id: s.uuid(), schoolId: s.uuid(), name: s.string({ example: 'حلقة الفجر' }), teacherName: s.string({ nullable: true, example: 'خالد أحمد حسن' }) }, ['id', 'schoolId', 'name', 'teacherName'], {
  description: 'What the PARENT of a student in the group receives: the name and the Teacher\'s name only.',
});
const groupStudentSchema = s.object(
  { studentId: s.uuid(), fullName: s.string({ example: 'عمر أحمد محمد' }), status: s.string({ description: 'The student\'s status (ACTIVE or INACTIVE).' }), assignedAt: s.dateTime() },
  ['studentId', 'fullName', 'status', 'assignedAt'],
);
const assignmentSchema = s.object(
  {
    id: s.uuid(),
    groupId: s.uuid(),
    groupName: s.string({ nullable: true, description: 'The group\'s CURRENT name.' }),
    assignedAt: s.dateTime(),
    assignedBy: s.uuid(),
    unassignedAt: s.dateTime({ nullable: true }),
    unassignedBy: s.uuid({ nullable: true, description: 'null while current, or when the system ended it (the student was archived).' }),
    endReason: s.string({ nullable: true, description: 'MANUAL, MOVED, GROUP_ARCHIVED or STUDENT_ARCHIVED; null while the period is current.' }),
  },
  ['id', 'groupId', 'groupName', 'assignedAt', 'assignedBy', 'unassignedAt', 'unassignedBy', 'endReason'],
);
const historySchema = s.object(
  {
    id: s.uuid(),
    groupId: s.uuid(),
    action: s.string({ enum: ['CREATED', 'UPDATED', 'TEACHER_CHANGED', 'ARCHIVED'] }),
    actorId: s.uuid(),
    occurredAt: s.dateTime(),
    reason: s.string({ nullable: true }),
    previousName: s.string({ nullable: true }),
    newName: s.string({ nullable: true }),
    previousTeacherId: s.uuid({ nullable: true }),
    newTeacherId: s.uuid({ nullable: true }),
    previousLearningMode: s.string({ nullable: true, description: 'GROUP or INDIVIDUAL; filled only for the attributes that changed.' }),
    newLearningMode: s.string({ nullable: true }),
    previousProgression: s.string({ nullable: true, description: 'FORWARD or BACKWARD; filled only when it changed.' }),
    newProgression: s.string({ nullable: true }),
    previousStartingSurah: s.integer({ nullable: true }),
    newStartingSurah: s.integer({ nullable: true }),
  },
  ['id', 'groupId', 'action', 'actorId', 'occurredAt', 'reason', 'previousName', 'newName', 'previousTeacherId', 'newTeacherId', 'previousLearningMode', 'newLearningMode', 'previousProgression', 'newProgression', 'previousStartingSurah', 'newStartingSurah'],
);

const groupExample = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: GROUP_ID, schoolId: SCHOOL_ID, organizationId: ORG_ID, name: 'حلقة الفجر', teacher: { id: TEACHER_ID, name: 'خالد أحمد حسن' }, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, status: 'ACTIVE', createdAt: WHEN, updatedAt: WHEN, ...over,
});
const studentRowExample = { studentId: STUDENT_ID, fullName: 'عمر أحمد محمد', status: 'ACTIVE', assignedAt: WHEN };

const groupIdParam = { id: { description: 'The group id.', example: GROUP_ID, schema: s.uuid() } };
const studentIdParam = { studentId: { description: 'The student id.', example: STUDENT_ID, schema: s.uuid() } };
const schoolIdParam = { schoolId: { description: 'The school id.', example: SCHOOL_ID, schema: s.uuid() } };
const onGroup = 'The group (the caller must be the active manager of its school; loaded server-side).';

const op = (o: OperationDoc): OperationDoc => o;

/** OpenAPI contract of `/groups` (`group-routes.ts`). Module 20: groups. */
export const groupApiDoc: ModuleApiDoc = {
  moduleId: '20',
  mountPath: '/groups',
  tag: {
    name: 'Groups',
    description:
      'Groups of a school: creation by the School Manager, one Teacher at most, students in ONE group at a time with a full assignment history, learning mode / progression / starting surah, archive (final). Teachers read their own groups; a Parent reads the group of their own child.',
  },
  operations: [
    op({
      method: 'post', path: '/', operationId: 'createGroup', summary: 'Create a group in a school',
      description: 'The School Manager creates a group in THEIR ACTIVE school. The name must be unique among the ACTIVE groups of the school. The Teacher is optional and must be actively linked to the school. The group has no schedule (a later module owns it). The starting surah is the surah NUMBER (1-114).',
      authorization: schoolManager(GroupPermissions.CREATE, 'The school named in the body (the caller must be its active manager).'),
      request: {
        description: 'The school, the name, the learning mode, the progression and the starting surah, and optionally the Teacher.',
        schema: s.object(
          {
            schoolId: s.uuid({ example: SCHOOL_ID }),
            name: s.string({ maxLength: 1000, example: 'حلقة الفجر' }),
            learningMode: s.string({ maxLength: 40, enum: LEARNING_MODES, example: 'GROUP' }),
            progression: s.string({ maxLength: 40, enum: PROGRESSIONS, example: 'FORWARD' }),
            startingSurah: s.integer({ minimum: 1, maximum: 114, example: 78 }),
            teacherId: s.uuid({ nullable: true, example: TEACHER_ID, description: 'Optional: a Teacher actively linked to the school.' }),
          },
          ['schoolId', 'name', 'learningMode', 'progression', 'startingSurah'],
        ),
        examples: { withTeacher: { summary: 'With a Teacher', value: { schoolId: SCHOOL_ID, name: 'حلقة الفجر', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, teacherId: TEACHER_ID } }, withoutTeacher: { summary: 'Without a Teacher', value: { schoolId: SCHOOL_ID, name: 'حلقة الفجر', learningMode: 'INDIVIDUAL', progression: 'BACKWARD', startingSurah: 114 } } },
      },
      success: { status: 201, description: 'The group was created (ACTIVE).', data: ref('Group'), example: groupExample() },
      errors: [
        validationErrors, NOT_ALLOWED,
        { status: 409, codes: ['GROUP_NAME_CONFLICT'], description: 'An ACTIVE group of this school already has this name.' },
        { status: 422, codes: ['GROUP_SCHOOL_NOT_ACTIVE', 'GROUP_TEACHER_NOT_LINKED_TO_SCHOOL'], description: 'The school is not ACTIVE; or the Teacher does not exist, belongs to another organization or is not linked to the school.' },
      ],
    }),
    op({
      method: 'get', path: '/mine', operationId: 'listOwnGroups', summary: 'The caller\'s own groups',
      description: 'A Teacher lists the ACTIVE groups they teach (across their schools). No id is accepted: the Teacher record is the one of the verified token.',
      authorization: { authentication: 'required', roles: ['TEACHER'], scope: 'The caller\'s own Teacher record (derived from the access token).', enforcement: 'Authorization Engine permission (unscoped); the Teacher record is looked up by the verified user id.', permissionId: GroupPermissions.LIST_OWN, decision: 'APPROVED', reference: REFERENCE },
      query: listQueryParameters(OWN_GROUPS_SPEC),
      success: { status: 200, description: 'A page of the caller\'s groups.', paginated: true, data: ref('Group'), example: groupExample() },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/schools/:schoolId', operationId: 'listSchoolGroups', summary: 'List the groups of a school',
      description: 'A paginated list of the groups of the school (filter with `filter[status]`, e.g. `ACTIVE`), newest first by default (`sort=createdAt` or `name`, `-` for descending).',
      authorization: schoolManager(GroupPermissions.LIST, 'The school in the path (the caller must be its active manager).'),
      pathParams: schoolIdParam, query: listQueryParameters(GROUP_LIST_SPEC),
      success: { status: 200, description: 'A page of groups.', paginated: true, data: ref('Group'), example: groupExample() },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/students/:studentId/assignments', operationId: 'listStudentGroupAssignments', summary: 'A student\'s group history',
      description: 'Every period of the student in a group, oldest first: when they joined, who did it, when and why they left. Old periods keep the group they belonged to, so reports of an old date still show the old group.',
      authorization: schoolManager(GroupPermissions.READ_STUDENT_ASSIGNMENTS, 'The student\'s school (the caller must be its active manager; resolved through the student).'),
      pathParams: studentIdParam,
      success: { status: 200, description: 'The periods.', data: s.array(ref('StudentGroupAssignment')), example: [{ id: ENTRY_ID, groupId: GROUP_ID, groupName: 'حلقة الفجر', assignedAt: WHEN, assignedBy: USER_ID, unassignedAt: null, unassignedBy: null, endReason: null }] },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/:id', operationId: 'getGroup', summary: 'Get one group',
      description: 'Read access is granted by role and relationship, all proven from server data: the **School Manager** of the group\'s school; the **Teacher** of the group (ACTIVE groups only, inside a school they are linked to); the **Parent** of a student currently in the group (ACTIVE group only; the Parent receives the minimal view: the name and the Teacher\'s name). Anyone else is `403 ACCESS_DENIED`, including a group that does not exist.',
      authorization: {
        authentication: 'required', roles: ['SCHOOL_MANAGER', 'TEACHER', 'PARENT'],
        scope: 'SCHOOL_MANAGER: the group\'s school. TEACHER: the group they teach. PARENT: a group that currently holds one of their children.',
        enforcement: 'Authorization Engine permission with a role-aware MANAGEMENT/GROUP scope resolver that answers true only on positive proof for the role being checked.',
        permissionId: GroupPermissions.READ, decision: 'APPROVED', reference: REFERENCE,
      },
      pathParams: groupIdParam,
      // The body is the full group (School Manager, Teacher) or the minimal view (Parent): documented as `anyOf` both.
      success: { status: 200, description: 'The group: the full view (School Manager, Teacher of the group) or the minimal Parent view.', data: { anyOf: [ref('Group'), ref('GroupParentView')] }, example: groupExample() },
      errors: [NOT_ALLOWED, notFound],
    }),
    op({
      method: 'patch', path: '/:id', operationId: 'updateGroup', summary: 'Change a group\'s name, learning mode, progression or starting surah',
      description: 'Changes an ACTIVE group. The previous values stay in the history; a learning mode or progression change applies from then on and rewrites nothing. A value equal to the current one changes nothing. The school never changes.',
      authorization: schoolManager(GroupPermissions.UPDATE, onGroup), pathParams: groupIdParam,
      request: {
        description: 'The attributes to change (at least one).',
        schema: s.object({ name: s.string({ maxLength: 1000, example: 'حلقة الظهر' }), learningMode: s.string({ maxLength: 40, enum: LEARNING_MODES }), progression: s.string({ maxLength: 40, enum: PROGRESSIONS }), startingSurah: s.integer({ minimum: 1, maximum: 114 }) }, []),
        examples: { rename: { summary: 'Rename', value: { name: 'حلقة الظهر' } }, change: { summary: 'Change the progression', value: { progression: 'BACKWARD' } } },
      },
      success: { status: 200, description: 'The group after the change.', data: ref('Group'), example: groupExample({ name: 'حلقة الظهر' }) },
      errors: [validationErrors, NOT_ALLOWED, notFound, concurrent, { status: 409, codes: ['GROUP_NAME_CONFLICT'], description: 'Another ACTIVE group of the school has this name.' }, archived],
    }),
    op({
      method: 'put', path: '/:id/teacher', operationId: 'assignGroupTeacher', summary: 'Assign or change the group\'s Teacher',
      description: 'A group has at most ONE Teacher. The Teacher must be actively linked to the group\'s school (the link is locked in the same transaction). A NEW Teacher is also validated against the group\'s schedule slots (Group Schedules, Module 23) before the change commits: the slots must not overlap the Teacher\'s slots in their other active groups in any school (touching boundaries are allowed), otherwise 409 TEACHER_SCHEDULE_CONFLICT and nothing changes. The change is kept in the history and a GroupTeacherChanged event is published.',
      authorization: schoolManager(GroupPermissions.ASSIGN_TEACHER, onGroup), pathParams: groupIdParam,
      request: { description: 'The Teacher.', schema: s.object({ teacherId: s.uuid({ example: TEACHER_ID }) }, ['teacherId']), examples: { teacher: { summary: 'Assign a Teacher', value: { teacherId: TEACHER_ID } } } },
      success: { status: 200, description: 'The group with its Teacher.', data: ref('Group'), example: groupExample() },
      errors: [NOT_ALLOWED, notFound, { status: 409, codes: ['GROUP_CONCURRENT_MODIFICATION', 'TEACHER_SCHEDULE_CONFLICT', 'SCHEDULE_CONCURRENT_MODIFICATION'], description: 'A concurrent change could not be resolved (retry), or the group\'s schedule slots overlap the new Teacher\'s slots in their other active groups (`details.conflicts`).' }, { status: 422, codes: ['GROUP_TEACHER_NOT_LINKED_TO_SCHOOL', 'GROUP_ARCHIVED'], description: 'The Teacher does not exist, belongs to another organization or is not linked to the school; or the group is ARCHIVED.' }],
    }),
    op({
      method: 'delete', path: '/:id/teacher', operationId: 'removeGroupTeacher', summary: 'Leave the group without a Teacher',
      description: 'Allowed: a group can be without a Teacher for a while. The change is kept in the history.',
      authorization: schoolManager(GroupPermissions.ASSIGN_TEACHER, onGroup), pathParams: groupIdParam,
      success: { status: 200, description: 'The group without a Teacher.', data: ref('Group'), example: groupExample({ teacher: null }) },
      errors: [NOT_ALLOWED, notFound, concurrent, { status: 422, codes: ['GROUP_HAS_NO_TEACHER', 'GROUP_ARCHIVED'], description: 'The group has no Teacher, or it is ARCHIVED.' }],
    }),
    op({
      method: 'post', path: '/:id/archive', operationId: 'archiveGroup', summary: 'Archive a group (final)',
      description: 'Archives the group: it becomes read-only, its name is free for a new group of the school, its Teacher no longer depends on the school link, and EVERY student in it is unassigned in the same transaction (reason GROUP_ARCHIVED; the students and their history stay). Its schedule slots are retired in the same transaction (reason GROUP_ARCHIVED) and kept as history. Groups are never deleted.',
      authorization: schoolManager(GroupPermissions.ARCHIVE, onGroup), pathParams: groupIdParam,
      request: { description: 'An optional free-text reason (at most 500 characters), kept in the group history.', schema: s.object({ reason: s.string({ maxLength: 500, nullable: true, example: 'انتهاء الحلقة' }) }, []), examples: { withReason: { summary: 'With a reason', value: { reason: 'انتهاء الحلقة' } } } },
      success: { status: 200, description: 'The archived group.', data: ref('Group'), example: groupExample({ status: 'ARCHIVED' }) },
      errors: [validationErrors, NOT_ALLOWED, notFound, concurrent, archived],
    }),
    op({
      method: 'get', path: '/:id/history', operationId: 'getGroupHistory', summary: 'The group\'s change history',
      description: 'Creation, corrections, Teacher changes and the archive, oldest first: who did it, when, what changed and the previous value. Rows are never updated or deleted.',
      authorization: schoolManager(GroupPermissions.READ_HISTORY, onGroup), pathParams: groupIdParam,
      success: { status: 200, description: 'The history entries.', data: s.array(ref('GroupHistoryEntry')), example: [{ id: ENTRY_ID, groupId: GROUP_ID, action: 'CREATED', actorId: USER_ID, occurredAt: WHEN, reason: null, previousName: null, newName: 'حلقة الفجر', previousTeacherId: null, newTeacherId: TEACHER_ID, previousLearningMode: null, newLearningMode: 'GROUP', previousProgression: null, newProgression: 'FORWARD', previousStartingSurah: null, newStartingSurah: 78 }] },
      errors: [NOT_ALLOWED, notFound],
    }),
    op({
      method: 'get', path: '/:id/students', operationId: 'listGroupStudents', summary: 'The students currently in a group',
      description: 'The students in the group now (sort by `assignedAt`). A student that was just archived and not yet removed by the background consumer is hidden, so a page can be briefly shorter than requested. Available to the School Manager and to the Teacher of the group.',
      authorization: {
        authentication: 'required', roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'SCHOOL_MANAGER: the group\'s school. TEACHER: the group they teach.',
        enforcement: 'Authorization Engine permission with the role-aware MANAGEMENT/GROUP scope resolver (positive proof per role).', permissionId: GroupPermissions.LIST_STUDENTS, decision: 'APPROVED', reference: REFERENCE,
      },
      pathParams: groupIdParam, query: listQueryParameters(GROUP_STUDENTS_SPEC),
      success: { status: 200, description: 'A page of students.', paginated: true, data: ref('GroupStudent'), example: studentRowExample },
      errors: [NOT_ALLOWED, notFound],
    }),
    op({
      method: 'post', path: '/:id/students', operationId: 'assignStudentToGroup', summary: 'Put a student in a group',
      description: 'Puts an ACTIVE student of the group\'s school into the ACTIVE group. A student is in ONE group at a time: a student already in a group must be moved or removed first (`409 GROUP_STUDENT_ALREADY_ASSIGNED`). The period is kept in the assignment history and a GroupStudentAssigned event is published.',
      authorization: schoolManager(GroupPermissions.ASSIGN_STUDENT, onGroup), pathParams: groupIdParam,
      request: { description: 'The student.', schema: s.object({ studentId: s.uuid({ example: STUDENT_ID }) }, ['studentId']), examples: { student: { summary: 'Add a student', value: { studentId: STUDENT_ID } } } },
      success: { status: 201, description: 'The student is now in the group.', data: ref('GroupStudent'), example: studentRowExample },
      errors: [NOT_ALLOWED, notFound, concurrent, { status: 409, codes: ['GROUP_STUDENT_ALREADY_ASSIGNED'], description: 'The student is already in a group.' }, { status: 422, codes: ['GROUP_STUDENT_NOT_IN_SCHOOL', 'GROUP_STUDENT_NOT_ACTIVE', 'GROUP_ARCHIVED'], description: 'The student does not exist or is of another school; is not ACTIVE; or the group is ARCHIVED.' }],
    }),
    op({
      method: 'delete', path: '/:id/students/:studentId', operationId: 'removeStudentFromGroup', summary: 'Take a student out of a group',
      description: 'Ends the student\'s period in the group (reason MANUAL). The student stays a student and the period stays in the history.',
      authorization: schoolManager(GroupPermissions.UNASSIGN_STUDENT, onGroup), pathParams: { ...groupIdParam, ...studentIdParam },
      success: { status: 204, description: 'The student was taken out of the group. No content.' },
      errors: [NOT_ALLOWED, notFound, { status: 404, codes: ['GROUP_STUDENT_NOT_ASSIGNED'], description: 'The student is not in this group.' }, concurrent],
    }),
    op({
      method: 'post', path: '/:id/students/:studentId/move', operationId: 'moveStudentToGroup', summary: 'Move a student to another group of the same school',
      description: 'Ends the student\'s period in this group (reason MOVED) and starts one in the target group, in one transaction. The target must be ANOTHER ACTIVE group of the SAME school. Old periods keep their group.',
      authorization: schoolManager(GroupPermissions.MOVE_STUDENT, 'The source group (the caller must be the active manager of its school); the target must be in the same school.'),
      pathParams: { ...groupIdParam, ...studentIdParam },
      request: { description: 'The target group.', schema: s.object({ targetGroupId: s.uuid({ example: GROUP2_ID }) }, ['targetGroupId']), examples: { target: { summary: 'Move', value: { targetGroupId: GROUP2_ID } } } },
      success: { status: 200, description: 'The student is now in the target group.', data: ref('GroupStudent'), example: studentRowExample },
      errors: [NOT_ALLOWED, notFound, concurrent, { status: 404, codes: ['GROUP_STUDENT_NOT_ASSIGNED'], description: 'The student is not in this group.' }, { status: 422, codes: ['GROUP_MOVE_TARGET_INVALID', 'GROUP_STUDENT_NOT_ACTIVE', 'GROUP_ARCHIVED'], description: 'The target is this same group, does not exist, is of another school or is ARCHIVED; the student is not ACTIVE; or the source group is ARCHIVED.' }],
    }),
  ],
  schemas: { Group: groupSchema, GroupParentView: parentGroupSchema, GroupStudent: groupStudentSchema, StudentGroupAssignment: assignmentSchema, GroupHistoryEntry: historySchema },
};
