import { ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { SchedulePermissions } from '../../application/services/schedule-authorization';
import { SLOT_RETIRE_REASONS } from '../../domain/entities/group-schedule-slot';
import { DAYS_OF_WEEK } from '../../domain/value-objects/schedule-time';

const GROUP_ID = '4c9e1b72-3a58-4d06-9b17-e2f8a0d5c613';
const SLOT_ID = 'b1f4d7a2-6c39-4e85-9a10-3d8e5c2b7f46';
const SLOT2_ID = 'c6a9e3d5-1b72-4f08-8d34-7e0a2b5c9f13';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const WHEN = '2026-10-28T09:30:00.000Z';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Group Schedules 23); docs/GROUP-SCHEDULES.md; Master Specification sections 35 and 44';
const MANAGER_ENFORCEMENT =
  'Enforced by the Authorization Engine (deny by default): the caller must hold the SCHOOL_MANAGER role AND an active manager link to the group\'s school (loaded server-side, never from the request). ORGANIZATION_MANAGER and MAIN_ADMIN have no schedule permission.';
const onGroup = 'The group (the caller must be the active manager of its school; loaded server-side).';

const schoolManager = (permissionId: string): AuthorizationDoc => ({ authentication: 'required', roles: ['SCHOOL_MANAGER'], scope: onGroup, enforcement: MANAGER_ENFORCEMENT, permissionId, decision: 'APPROVED', reference: REFERENCE });

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller lacks the permission or the scope (no reason is given; a group that does not exist is also 403), or the account must first change its initial password.' };
const groupNotFound: ErrorDoc = { status: 404, codes: ['GROUP_NOT_FOUND'], description: 'The group does not exist.' };
const slotNotFound: ErrorDoc = { status: 404, codes: ['SCHEDULE_SLOT_NOT_FOUND'], description: 'The slot does not exist in this group, or it is already retired.' };
const archived: ErrorDoc = { status: 422, codes: ['GROUP_ARCHIVED'], description: 'The group is ARCHIVED: its schedule is read-only and final.' };
const dayAndTimeErrors: ErrorDoc = {
  status: 400,
  codes: ['SCHEDULE_DAY_INVALID', 'SCHEDULE_TIME_INVALID', 'SCHEDULE_TIME_RANGE_INVALID', 'SCHEDULE_UPDATE_EMPTY'],
  description: 'The weekday is not SATURDAY ... FRIDAY, a time is not exactly HH:MM (00:00 to 23:59), the end is not after the start on the same day, or a change names nothing to change.',
};
const conflicts: ErrorDoc = {
  status: 409,
  codes: ['SCHEDULE_DAY_ALREADY_HAS_SLOT', 'TEACHER_SCHEDULE_CONFLICT', 'SCHEDULE_CONCURRENT_MODIFICATION'],
  description:
    'SCHEDULE_DAY_ALREADY_HAS_SLOT: a group has at most ONE slot per weekday, whatever the times (they may overlap, touch or be completely separate), with or without a Teacher. TEACHER_SCHEDULE_CONFLICT: the group\'s Teacher would teach two overlapping slots across their ACTIVE groups in any school (boundaries that merely touch are allowed); `details.conflicts` lists the conflicting day and time, and names the other group only when it is in the same school. SCHEDULE_CONCURRENT_MODIFICATION: retry.',
};

const slotSchema = s.object(
  {
    id: s.uuid(),
    groupId: s.uuid(),
    dayOfWeek: s.string({ enum: DAYS_OF_WEEK, description: 'The weekday. Weeks are listed Saturday first.', example: 'MONDAY' }),
    startTime: s.string({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Local wall-clock start, HH:MM on a 24-hour clock. No zone: Sessions convert it.', example: '18:00' }),
    endTime: s.string({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Local wall-clock end, after the start on the same day.', example: '19:00' }),
    status: s.string({ enum: ['ACTIVE', 'RETIRED'], description: 'RETIRED slots are history: replaced, removed, or retired when the group was archived.' }),
    createdAt: s.dateTime(),
    createdBy: s.uuid(),
    retiredAt: s.dateTime({ nullable: true }),
    retiredBy: s.uuid({ nullable: true }),
    // OpenAPI 3.0: a nullable enum lists null explicitly.
    retireReason: { type: 'string', nullable: true, enum: [...SLOT_RETIRE_REASONS, null], description: 'REPLACED (a change), REMOVED, or GROUP_ARCHIVED; null while the slot is ACTIVE.' },
    replacedBySlotId: s.uuid({ nullable: true, description: 'For REPLACED: the slot that took its place.' }),
  },
  ['id', 'groupId', 'dayOfWeek', 'startTime', 'endTime', 'status', 'createdAt', 'createdBy', 'retiredAt', 'retiredBy', 'retireReason', 'replacedBySlotId'],
);
const ownItemSchema = s.object(
  {
    id: s.uuid({ description: 'The slot id.' }),
    groupId: s.uuid(),
    groupName: s.string({ example: 'حلقة الفجر' }),
    schoolId: s.uuid(),
    dayOfWeek: s.string({ enum: DAYS_OF_WEEK }),
    startTime: s.string({ example: '18:00' }),
    endTime: s.string({ example: '19:00' }),
  },
  ['id', 'groupId', 'groupName', 'schoolId', 'dayOfWeek', 'startTime', 'endTime'],
);

const slotExample = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: SLOT_ID, groupId: GROUP_ID, dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00', status: 'ACTIVE', createdAt: WHEN, createdBy: USER_ID, retiredAt: null, retiredBy: null, retireReason: null, replacedBySlotId: null, ...over,
});

const groupIdParam = { id: { description: 'The group id.', example: GROUP_ID, schema: s.uuid() } };
const slotIdParam = { slotId: { description: 'The slot id.', example: SLOT_ID, schema: s.uuid() } };
const op = (o: OperationDoc): OperationDoc => o;

/** OpenAPI contract of `/group-schedules` (`schedule-routes.ts`). Module 23: group schedules. */
export const scheduleApiDoc: ModuleApiDoc = {
  moduleId: '23',
  mountPath: '/group-schedules',
  tag: {
    name: 'Group Schedules',
    description:
      'The recurring weekly slots of a group (a weekday with a start and an end). A group has at most ONE slot per weekday; a Teacher\'s slots must not overlap across their active groups in any school (touching boundaries are allowed). Slots are never edited or deleted: a change replaces the slot, a removal retires it, archiving the group retires them, and retired slots stay as history. Managed by the School Manager; readable by the Teacher and the Parents of the group.',
  },
  schemas: { ScheduleSlot: slotSchema, OwnScheduleItem: ownItemSchema },
  operations: [
    op({
      method: 'get', path: '/mine', operationId: 'listOwnScheduleSlots', summary: 'My weekly schedule (Teacher)',
      description: 'The ACTIVE slots of every ACTIVE group the calling Teacher teaches, across all their schools, in week order (Saturday first). The Teacher is derived from the access token. Empty for a Teacher without groups.',
      authorization: { authentication: 'required', roles: ['TEACHER'], scope: 'The caller\'s own Teacher record (derived from the access token).', enforcement: 'Authorization Engine permission (unscoped); the Teacher record is looked up by the verified user id.', permissionId: SchedulePermissions.LIST_OWN, decision: 'APPROVED', reference: REFERENCE },
      success: { status: 200, description: 'The Teacher\'s slots with their group.', data: s.array(ref('OwnScheduleItem')), example: [{ id: SLOT_ID, groupId: GROUP_ID, groupName: 'حلقة الفجر', schoolId: SCHOOL_ID, dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }] },
      errors: [NOT_ALLOWED],
    }),
    op({
      method: 'get', path: '/:id/slots', operationId: 'listGroupScheduleSlots', summary: 'The group\'s schedule',
      description: 'The ACTIVE slots of the group in week order (Saturday first), then by start time. Read access is by role and relationship, proven from server data: the **School Manager** of the group\'s school, the **Teacher** of the group (ACTIVE groups only) and the **Parent** of a student currently in the group (ACTIVE group only). Anyone else is `403 ACCESS_DENIED`.',
      authorization: {
        authentication: 'required', roles: ['SCHOOL_MANAGER', 'TEACHER', 'PARENT'],
        scope: 'SCHOOL_MANAGER: the group\'s school. TEACHER: the group they teach. PARENT: a group that currently holds one of their children.',
        enforcement: 'Authorization Engine permission with the role-aware MANAGEMENT/GROUP scope resolver (Module 20), which answers true only on positive proof for the role being checked.',
        permissionId: SchedulePermissions.READ, decision: 'APPROVED', reference: REFERENCE,
      },
      pathParams: groupIdParam,
      success: { status: 200, description: 'The group\'s active slots.', data: s.array(ref('ScheduleSlot')), example: [slotExample(), slotExample({ id: SLOT2_ID, dayOfWeek: 'WEDNESDAY' })] },
      errors: [NOT_ALLOWED, groupNotFound],
    }),
    op({
      method: 'get', path: '/:id/slots/history', operationId: 'getGroupScheduleHistory', summary: 'The group\'s schedule history',
      description: 'Every slot of the group, active and retired, oldest first: when each was created, and who retired it, when and why (REPLACED with the id of its replacement, REMOVED, or GROUP_ARCHIVED). Rows are never updated (apart from being retired) or deleted.',
      authorization: schoolManager(SchedulePermissions.READ_HISTORY), pathParams: groupIdParam,
      success: { status: 200, description: 'Every slot of the group.', data: s.array(ref('ScheduleSlot')), example: [slotExample({ status: 'RETIRED', retiredAt: WHEN, retiredBy: USER_ID, retireReason: 'REPLACED', replacedBySlotId: SLOT2_ID }), slotExample({ id: SLOT2_ID, startTime: '18:30', endTime: '19:30' })] },
      errors: [NOT_ALLOWED, groupNotFound],
    }),
    op({
      method: 'post', path: '/:id/slots', operationId: 'addGroupScheduleSlot', summary: 'Add a slot to the group\'s schedule',
      description: 'Adds a recurring weekly slot to an ACTIVE group. A group has at most ONE slot per weekday: a second slot on a weekday that already has one is refused even when the times do not overlap or merely touch, whether or not the group has a Teacher (409 SCHEDULE_DAY_ALREADY_HAS_SLOT). When the group has a Teacher, the slot must not overlap the Teacher\'s slots in their other active groups in any school (409 TEACHER_SCHEDULE_CONFLICT); touching boundaries (18:00-19:00 and 19:00-20:00) are allowed.',
      authorization: schoolManager(SchedulePermissions.MANAGE), pathParams: groupIdParam,
      request: {
        description: 'The weekday and the start and end as local HH:MM times; the end must be after the start on the same day.',
        schema: s.object({ dayOfWeek: s.string({ enum: DAYS_OF_WEEK, example: 'MONDAY' }), startTime: s.string({ example: '18:00' }), endTime: s.string({ example: '19:00' }) }, ['dayOfWeek', 'startTime', 'endTime']),
        examples: { evening: { summary: 'Monday evening', value: { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' } } },
      },
      success: { status: 201, description: 'The new active slot.', data: ref('ScheduleSlot'), example: slotExample() },
      errors: [dayAndTimeErrors, NOT_ALLOWED, groupNotFound, conflicts, archived],
    }),
    op({
      method: 'patch', path: '/:id/slots/:slotId', operationId: 'changeGroupScheduleSlot', summary: 'Change a slot (atomic replacement)',
      description: 'Changes the weekday and/or times of an ACTIVE slot. The slot is never edited in place: it is retired (REPLACED, pointing at its replacement) and a new slot is created in the same transaction, after the same rules as adding (one slot per weekday, no Teacher overlap). A refused change leaves the old slot untouched. A change that changes nothing returns the slot unchanged. The response is the new slot (a new id).',
      authorization: schoolManager(SchedulePermissions.MANAGE), pathParams: { ...groupIdParam, ...slotIdParam },
      request: {
        description: 'At least one of the weekday and the start and end times; the rest is kept.',
        schema: s.object({ dayOfWeek: s.string({ enum: DAYS_OF_WEEK, example: 'TUESDAY' }), startTime: s.string({ example: '18:30' }), endTime: s.string({ example: '19:30' }) }, []),
        examples: { later: { summary: 'Start and end half an hour later', value: { startTime: '18:30', endTime: '19:30' } } },
      },
      success: { status: 200, description: 'The new active slot that replaced the old one.', data: ref('ScheduleSlot'), example: slotExample({ id: SLOT2_ID, startTime: '18:30', endTime: '19:30' }) },
      errors: [dayAndTimeErrors, NOT_ALLOWED, groupNotFound, slotNotFound, conflicts, archived],
    }),
    op({
      method: 'delete', path: '/:id/slots/:slotId', operationId: 'removeGroupScheduleSlot', summary: 'Remove a slot (retired, kept as history)',
      description: 'Removes an ACTIVE slot from the schedule. It is retired (REMOVED) and kept as history, never physically deleted; its weekday is free again.',
      authorization: schoolManager(SchedulePermissions.MANAGE), pathParams: { ...groupIdParam, ...slotIdParam },
      success: { status: 204, description: 'The slot was retired. No content.' },
      errors: [NOT_ALLOWED, groupNotFound, slotNotFound, archived],
    }),
  ],
};
