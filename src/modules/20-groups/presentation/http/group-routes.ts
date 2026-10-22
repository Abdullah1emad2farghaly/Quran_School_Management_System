import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendNoContent, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { SCHOOL_TARGET_TYPE } from '../../../16-schools/public';
import { STUDENT_TARGET_TYPE } from '../../../19-students/public';
import { GROUP_TARGET_TYPE, GroupPermissions } from '../../application/services/group-authorization';
import { GROUP_STATUSES } from '../../domain/value-objects/group-settings';
import { createGroupHandlers, type GroupHandlerService, type GroupListRequest, type PagedRequest } from './group-handlers';
import { sessionAuthRequired } from './session-required';

export interface GroupRouterDeps {
  readonly getService: () => GroupHandlerService;
  /** Authenticates the access token (Module 10 `requireAuthentication`). Blocks accounts that still must change their initial password. */
  readonly requireAuthentication: RequestHandler;
  /** Authorization Engine route guard (Module 12): roles -> permissions -> scope. */
  readonly requirePermission: RequirePermission;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

const requiredText = (field: string, max: number): ValidationChain =>
  body(field).isString().withMessage('INVALID_VALUE').bail().trim().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max }).withMessage('INVALID_VALUE');
const optionalText = (field: string, max: number): ValidationChain =>
  body(field).optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max }).withMessage('INVALID_VALUE');
const requiredUuid = (field: string): ValidationChain => body(field).isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE');
const optionalUuid = (field: string): ValidationChain => body(field).optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE');
/** A whole number. The 1-114 range is the domain rule (INVALID_GROUP_STARTING_SURAH). */
const requiredInt = (field: string): ValidationChain => body(field).exists({ values: 'null' }).withMessage('REQUIRED_FIELD').bail().isInt().withMessage('INVALID_VALUE');
const optionalInt = (field: string): ValidationChain => body(field).optional({ values: 'null' }).isInt().withMessage('INVALID_VALUE');

export const GROUP_LIST_SPEC: ListQuerySpec = {
  sortable: { createdAt: 'createdAt', name: 'name' },
  defaultSort: [{ key: 'createdAt', direction: 'desc' }],
  filters: { status: { type: 'enum', values: GROUP_STATUSES, multiple: true } },
};
/** The caller's own groups: by name. */
export const OWN_GROUPS_SPEC: ListQuerySpec = { sortable: { name: 'name' }, defaultSort: [{ key: 'name', direction: 'asc' }] };
/** The students of a group: by the time they joined it. */
export const GROUP_STUDENTS_SPEC: ListQuerySpec = { sortable: { assignedAt: 'assignedAt' }, defaultSort: [{ key: 'assignedAt', direction: 'asc' }] };

function groupListRequest(req: Request): GroupListRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, GROUP_LIST_SPEC);
  const status = query.filters.status;
  return { sort: query.sort[0] ?? { key: 'createdAt', direction: 'desc' }, status: Array.isArray(status) ? (status as readonly string[]) : typeof status === 'string' ? [status] : undefined, page: query.page };
}
function pagedRequest(req: Request, spec: ListQuerySpec): PagedRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, spec);
  return { sort: query.sort[0] ?? { key: spec.defaultSort[0]!.key, direction: spec.defaultSort[0]!.direction }, page: query.page };
}

/**
 * /groups. Endpoints (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`); every manager permission
 * below is SCHOOL_MANAGER of the group's school (loaded server-side), and ORGANIZATION_MANAGER / MAIN_ADMIN have none:
 *   POST   /groups                                    groups.group.create            create a group (optional Teacher) in `schoolId`
 *   GET    /groups/mine                               groups.group.list-own          TEACHER: their own ACTIVE groups (token-derived)
 *   GET    /groups/schools/:schoolId                  groups.group.list              the groups of the school (paginated, `filter[status]`)
 *   GET    /groups/students/:studentId/assignments    groups.student.read-assignments a student's group periods (assignment history)
 *   GET    /groups/:id                                groups.group.read              SCHOOL_MANAGER | TEACHER of the group | PARENT of a student in it (minimal view)
 *   PATCH  /groups/:id                                groups.group.update            name, learning mode, progression, starting surah
 *   PUT    /groups/:id/teacher                        groups.group.assign-teacher    assign or change the Teacher
 *   DELETE /groups/:id/teacher                        groups.group.assign-teacher    leave the group without a Teacher
 *   POST   /groups/:id/archive                        groups.group.archive           final; unassigns every student
 *   GET    /groups/:id/history                        groups.group.read-history      the group's change history
 *   GET    /groups/:id/students                       groups.group.list-students     SCHOOL_MANAGER | TEACHER of the group
 *   POST   /groups/:id/students                       groups.group.assign-student    put a student in the group
 *   DELETE /groups/:id/students/:studentId            groups.group.unassign-student  take the student out of the group
 *   POST   /groups/:id/students/:studentId/move       groups.group.move-student      move the student to another group of the same school
 * There is deliberately NO delete of a group (archive instead). The actor always comes from the verified token.
 */
export function createGroupRouter(deps: GroupRouterDeps): Router {
  const router = Router();
  const h = createGroupHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onGroup = { target: (req: Request) => ({ type: GROUP_TARGET_TYPE, id: req.params.id as string }) };
  const onSchoolParam = { target: (req: Request) => ({ type: SCHOOL_TARGET_TYPE, id: req.params.schoolId as string }) };
  const onStudentParam = { target: (req: Request) => ({ type: STUDENT_TARGET_TYPE, id: req.params.studentId as string }) };
  const groupId = param('id').isUUID().withMessage('INVALID_VALUE');
  const studentIdParam = param('studentId').isUUID().withMessage('INVALID_VALUE');
  const schoolIdParam = param('schoolId').isUUID().withMessage('INVALID_VALUE');

  router.post(
    '/',
    auth,
    validate(requiredUuid('schoolId'), requiredText('name', 1000), requiredText('learningMode', 40), requiredText('progression', 40), requiredInt('startingSurah'), optionalUuid('teacherId')),
    guard(GroupPermissions.CREATE, { target: (req) => ({ type: SCHOOL_TARGET_TYPE, id: req.body.schoolId as string }) }),
    handle(async (req, res) => sendCreated(res, await h.createGroup(sessionAuthRequired(req), req.body))),
  );

  // Fixed paths are declared BEFORE `/:id` so they are never read as a group id.
  router.get('/mine', auth, guard(GroupPermissions.LIST_OWN), handle(async (req, res) => sendPaginated(res, await h.listOwnGroups(sessionAuthRequired(req), pagedRequest(req, OWN_GROUPS_SPEC)))));

  router.get('/schools/:schoolId', auth, validate(schoolIdParam), guard(GroupPermissions.LIST, onSchoolParam), handle(async (req, res) => sendPaginated(res, await h.listGroupsOfSchool(req.params.schoolId as string, groupListRequest(req)))));

  router.get('/students/:studentId/assignments', auth, validate(studentIdParam), guard(GroupPermissions.READ_STUDENT_ASSIGNMENTS, onStudentParam), handle(async (req, res) => sendSuccess(res, await h.listStudentAssignments(req.params.studentId as string))));

  router.get('/:id', auth, validate(groupId), guard(GroupPermissions.READ, onGroup), handle(async (req, res) => sendSuccess(res, await h.getGroup(req.params.id as string, req.authorization?.role))));

  router.patch(
    '/:id',
    auth,
    validate(groupId, optionalText('name', 1000), optionalText('learningMode', 40), optionalText('progression', 40), optionalInt('startingSurah')),
    guard(GroupPermissions.UPDATE, onGroup),
    handle(async (req, res) => sendSuccess(res, await h.updateGroup(req.params.id as string, sessionAuthRequired(req), req.body))),
  );

  router.put('/:id/teacher', auth, validate(groupId, requiredUuid('teacherId')), guard(GroupPermissions.ASSIGN_TEACHER, onGroup), handle(async (req, res) => sendSuccess(res, await h.assignTeacher(req.params.id as string, sessionAuthRequired(req), req.body))));
  router.delete('/:id/teacher', auth, validate(groupId), guard(GroupPermissions.ASSIGN_TEACHER, onGroup), handle(async (req, res) => sendSuccess(res, await h.removeTeacher(req.params.id as string, sessionAuthRequired(req)))));

  router.post('/:id/archive', auth, validate(groupId, optionalText('reason', 500)), guard(GroupPermissions.ARCHIVE, onGroup), handle(async (req, res) => sendSuccess(res, await h.archiveGroup(req.params.id as string, sessionAuthRequired(req), req.body))));

  router.get('/:id/history', auth, validate(groupId), guard(GroupPermissions.READ_HISTORY, onGroup), handle(async (req, res) => sendSuccess(res, await h.listHistory(req.params.id as string))));

  router.get('/:id/students', auth, validate(groupId), guard(GroupPermissions.LIST_STUDENTS, onGroup), handle(async (req, res) => sendPaginated(res, await h.listStudents(req.params.id as string, pagedRequest(req, GROUP_STUDENTS_SPEC)))));
  router.post('/:id/students', auth, validate(groupId, requiredUuid('studentId')), guard(GroupPermissions.ASSIGN_STUDENT, onGroup), handle(async (req, res) => sendCreated(res, await h.assignStudent(req.params.id as string, sessionAuthRequired(req), req.body))));
  router.delete('/:id/students/:studentId', auth, validate(groupId, studentIdParam), guard(GroupPermissions.UNASSIGN_STUDENT, onGroup), handle(async (req, res) => {
    await h.unassignStudent(req.params.id as string, req.params.studentId as string, sessionAuthRequired(req));
    sendNoContent(res);
  }));
  router.post('/:id/students/:studentId/move', auth, validate(groupId, studentIdParam, requiredUuid('targetGroupId')), guard(GroupPermissions.MOVE_STUDENT, onGroup), handle(async (req, res) => sendSuccess(res, await h.moveStudent(req.params.id as string, req.params.studentId as string, sessionAuthRequired(req), req.body))));

  return router;
}
