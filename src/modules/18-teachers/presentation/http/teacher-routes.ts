import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { SCHOOL_TARGET_TYPE } from '../../../16-schools/public';
import { TEACHER_TARGET_TYPE, TeacherPermissions } from '../../application/services/teacher-authorization';
import { createTeacherHandlers, type TeacherHandlerService } from './teacher-handlers';
import { sessionAuthRequired } from './session-required';

export interface TeacherRouterDeps {
  readonly getService: () => TeacherHandlerService;
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

const text = (field: string, max: number): ValidationChain =>
  body(field).isString().withMessage('INVALID_VALUE').bail().trim().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max }).withMessage('INVALID_VALUE');
const requiredUuid = (field: string): ValidationChain => body(field).isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE');

export const TEACHER_LIST_SPEC: ListQuerySpec = {
  sortable: { createdAt: 'createdAt' },
  defaultSort: [{ key: 'createdAt', direction: 'desc' }],
  filters: {},
};

/**
 * /teachers. Endpoints (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`):
 *   POST   /teachers                          teachers.teacher.create         SCHOOL_MANAGER of `schoolId`        register (or reuse) a Teacher and link it to the school
 *   GET    /teachers/me                       teachers.teacher.read-own       TEACHER                             the caller's own profile (no id accepted)
 *   GET    /teachers/schools/:schoolId        teachers.teacher.list           SCHOOL_MANAGER of the school        the Teachers linked to the school (paginated)
 *   GET    /teachers/:id                      teachers.teacher.read           SCHOOL_MANAGER of a linked school   one Teacher
 *   DELETE /teachers/:id/schools/:schoolId    teachers.school-link.remove     SCHOOL_MANAGER of that school       end the Teacher-to-School link (account and other links untouched)
 * There is deliberately no update (name and phone are the account's) and no deactivate/delete of a Teacher (decision D-3 is open).
 * ORGANIZATION_MANAGER and MAIN_ADMIN have no Teacher permission. The actor always comes from the verified token.
 */
export function createTeacherRouter(deps: TeacherRouterDeps): Router {
  const router = Router();
  const h = createTeacherHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onTeacher = { target: (req: Request) => ({ type: TEACHER_TARGET_TYPE, id: req.params.id as string }) };
  const onSchoolParam = { target: (req: Request) => ({ type: SCHOOL_TARGET_TYPE, id: req.params.schoolId as string }) };
  const teacherId = param('id').isUUID().withMessage('INVALID_VALUE');
  const schoolIdParam = param('schoolId').isUUID().withMessage('INVALID_VALUE');

  router.post(
    '/',
    auth,
    validate(requiredUuid('schoolId'), text('name', 200), text('phone', 40)),
    guard(TeacherPermissions.CREATE, { target: (req) => ({ type: SCHOOL_TARGET_TYPE, id: req.body.schoolId as string }) }),
    handle(async (req, res) => sendCreated(res, await h.createTeacher(sessionAuthRequired(req), req.body))),
  );

  // `/me` and `/schools/:schoolId` are declared BEFORE `/:id` so they are never read as a teacher id.
  router.get(
    '/me',
    auth,
    guard(TeacherPermissions.READ_OWN),
    handle(async (req, res) => sendSuccess(res, await h.getOwnProfile(sessionAuthRequired(req)))),
  );

  router.get(
    '/schools/:schoolId',
    auth,
    validate(schoolIdParam),
    guard(TeacherPermissions.LIST, onSchoolParam),
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, TEACHER_LIST_SPEC);
      sendPaginated(res, await h.listTeachersOfSchool({ schoolId: req.params.schoolId as string, sort: query.sort[0] ?? { key: 'createdAt', direction: 'desc' }, page: query.page }));
    }),
  );

  router.get(
    '/:id',
    auth,
    validate(teacherId),
    guard(TeacherPermissions.READ, onTeacher),
    handle(async (req, res) => sendSuccess(res, await h.getTeacher(req.params.id as string))),
  );

  router.delete(
    '/:id/schools/:schoolId',
    auth,
    validate(teacherId, schoolIdParam),
    guard(TeacherPermissions.REMOVE_SCHOOL_LINK, onSchoolParam),
    handle(async (req, res) => sendSuccess(res, await h.removeSchoolLink(req.params.id as string, req.params.schoolId as string, sessionAuthRequired(req)))),
  );

  return router;
}
