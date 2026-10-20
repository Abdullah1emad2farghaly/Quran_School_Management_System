import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { SCHOOL_TARGET_TYPE } from '../../../16-schools/public';
import { STUDENT_TARGET_TYPE, StudentPermissions } from '../../application/services/student-authorization';
import { STUDENT_STATUSES } from '../../domain/value-objects/student-status';
import { createStudentHandlers, type StudentHandlerService, type StudentListRequest } from './student-handlers';
import { sessionAuthRequired } from './session-required';

export interface StudentRouterDeps {
  readonly getService: () => StudentHandlerService;
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

export const STUDENT_LIST_SPEC: ListQuerySpec = {
  sortable: { createdAt: 'createdAt', joinDate: 'joinDate', fullName: 'fullName' },
  defaultSort: [{ key: 'createdAt', direction: 'desc' }],
  filters: { status: { type: 'enum', values: STUDENT_STATUSES, multiple: true } },
};

function listRequest(req: Request): StudentListRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, STUDENT_LIST_SPEC);
  const status = query.filters.status;
  return { sort: query.sort[0] ?? { key: 'createdAt', direction: 'desc' }, status: Array.isArray(status) ? (status as readonly string[]) : typeof status === 'string' ? [status] : undefined, page: query.page };
}

/**
 * /students. Endpoints (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`):
 *   POST   /students                      students.student.create             SCHOOL_MANAGER of `schoolId`             register a Student (Parent of the school, global National ID)
 *   GET    /students/mine                 students.student.list-own-children  PARENT                                   the caller's own children (token-derived, no id accepted)
 *   GET    /students/schools/:schoolId    students.student.list               SCHOOL_MANAGER of the school             the Students of the school (paginated, status filter)
 *   GET    /students/:id                  students.student.read               SCHOOL_MANAGER of the school | PARENT of the student | TEACHER of a group the student is in
 *   GET    /students/:id/history          students.student.read-history       SCHOOL_MANAGER of the student's school   the change history
 *   PATCH  /students/:id                  students.student.update             SCHOOL_MANAGER of the student's school   correct the name and/or join date
 *   POST   /students/:id/deactivate       students.student.deactivate         same     ACTIVE -> INACTIVE
 *   POST   /students/:id/reactivate       students.student.reactivate         same     INACTIVE -> ACTIVE
 *   POST   /students/:id/archive          students.student.archive            same     ACTIVE | INACTIVE -> ARCHIVED (final)
 * There is deliberately NO delete. ORGANIZATION_MANAGER and MAIN_ADMIN have no Student permission. The actor always comes from the verified
 * token. The scope target is the school (create, list) or the Student (everything else); resolvers load the data from the server and never
 * trust a client-claimed school or parent.
 */
export function createStudentRouter(deps: StudentRouterDeps): Router {
  const router = Router();
  const h = createStudentHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onStudent = { target: (req: Request) => ({ type: STUDENT_TARGET_TYPE, id: req.params.id as string }) };
  const onSchoolParam = { target: (req: Request) => ({ type: SCHOOL_TARGET_TYPE, id: req.params.schoolId as string }) };
  const studentId = param('id').isUUID().withMessage('INVALID_VALUE');
  const schoolIdParam = param('schoolId').isUUID().withMessage('INVALID_VALUE');
  const reason = optionalText('reason', 500);

  router.post(
    '/',
    auth,
    validate(requiredUuid('schoolId'), requiredUuid('parentId'), requiredText('fullName', 1000), requiredText('nationalId', 40), optionalText('joinDate', 40)),
    guard(StudentPermissions.CREATE, { target: (req) => ({ type: SCHOOL_TARGET_TYPE, id: req.body.schoolId as string }) }),
    handle(async (req, res) => sendCreated(res, await h.createStudent(sessionAuthRequired(req), req.body))),
  );

  // `/mine` and `/schools/:schoolId` are declared BEFORE `/:id` so they are never read as a student id.
  router.get(
    '/mine',
    auth,
    guard(StudentPermissions.LIST_OWN_CHILDREN),
    handle(async (req, res) => sendPaginated(res, await h.listOwnChildren(sessionAuthRequired(req), listRequest(req)))),
  );

  router.get(
    '/schools/:schoolId',
    auth,
    validate(schoolIdParam),
    guard(StudentPermissions.LIST, onSchoolParam),
    handle(async (req, res) => sendPaginated(res, await h.listStudentsOfSchool(req.params.schoolId as string, listRequest(req)))),
  );

  router.get(
    '/:id',
    auth,
    validate(studentId),
    guard(StudentPermissions.READ, onStudent),
    handle(async (req, res) => sendSuccess(res, await h.getStudent(req.params.id as string, req.authorization?.role))),
  );

  router.get(
    '/:id/history',
    auth,
    validate(studentId),
    guard(StudentPermissions.READ_HISTORY, onStudent),
    handle(async (req, res) => sendSuccess(res, await h.listHistory(req.params.id as string))),
  );

  router.patch(
    '/:id',
    auth,
    validate(studentId, optionalText('fullName', 1000), optionalText('joinDate', 40)),
    guard(StudentPermissions.UPDATE, onStudent),
    handle(async (req, res) => sendSuccess(res, await h.updateStudent(req.params.id as string, sessionAuthRequired(req), req.body))),
  );

  router.post(
    '/:id/deactivate',
    auth,
    validate(studentId, reason),
    guard(StudentPermissions.DEACTIVATE, onStudent),
    handle(async (req, res) => sendSuccess(res, await h.deactivateStudent(req.params.id as string, sessionAuthRequired(req), req.body))),
  );
  router.post(
    '/:id/reactivate',
    auth,
    validate(studentId, reason),
    guard(StudentPermissions.REACTIVATE, onStudent),
    handle(async (req, res) => sendSuccess(res, await h.reactivateStudent(req.params.id as string, sessionAuthRequired(req), req.body))),
  );
  router.post(
    '/:id/archive',
    auth,
    validate(studentId, reason),
    guard(StudentPermissions.ARCHIVE, onStudent),
    handle(async (req, res) => sendSuccess(res, await h.archiveStudent(req.params.id as string, sessionAuthRequired(req), req.body))),
  );

  return router;
}
