import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { SCHOOL_TARGET_TYPE } from '../../../16-schools/public';
import { PARENT_TARGET_TYPE, ParentPermissions } from '../../application/services/parent-authorization';
import { createParentHandlers, type ParentHandlerService } from './parent-handlers';
import { sessionAuthRequired } from './session-required';

export interface ParentRouterDeps {
  readonly getService: () => ParentHandlerService;
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
const optionalText = (field: string, max: number): ValidationChain =>
  body(field).optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max }).withMessage('INVALID_VALUE');
const requiredUuid = (field: string): ValidationChain => body(field).isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE');

/** `address` (raw text) and `addressFields` (structured) are both optional at the HTTP edge; the service/handler enforces "exactly one" on creation. */
const addressChains = (): ValidationChain[] => [
  optionalText('address', 600),
  body('addressFields').optional({ values: 'null' }).isObject().withMessage('INVALID_VALUE'),
  body('addressFields.governorateId').if(body('addressFields').exists({ values: 'null' })).isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE'),
  body('addressFields.centerName').if(body('addressFields').exists({ values: 'null' })).optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max: 1000 }).withMessage('INVALID_VALUE'),
  body('addressFields.villageName').if(body('addressFields').exists({ values: 'null' })).optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max: 1000 }).withMessage('INVALID_VALUE'),
];

export const PARENT_LIST_SPEC: ListQuerySpec = {
  sortable: { createdAt: 'createdAt' },
  defaultSort: [{ key: 'createdAt', direction: 'desc' }],
  filters: {},
};

/**
 * /parents. Endpoints (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`):
 *   POST   /parents                          parents.parent.create         SCHOOL_MANAGER of `schoolId`        create (or reuse) a Parent and link it to the school
 *   GET    /parents/me                       parents.parent.read-own       PARENT                              the caller's own profile (no id accepted)
 *   GET    /parents/schools/:schoolId        parents.parent.list           SCHOOL_MANAGER of the school        the Parents linked to the school (paginated)
 *   GET    /parents/:id                      parents.parent.read           SCHOOL_MANAGER of a linked school   one Parent
 *   PATCH  /parents/:id                      parents.parent.update         same                                correct the address (history kept)
 *   DELETE /parents/:id/schools/:schoolId    parents.school-link.remove    SCHOOL_MANAGER of that school       end the Parent-to-School link (account and other links untouched)
 * There is deliberately no deactivate/delete of a Parent (decision D-3 is open). ORGANIZATION_MANAGER and MAIN_ADMIN have no Parent permission.
 * The actor always comes from the verified token. The scope target is the school (creation, listing, link removal) or the Parent (read, update);
 * the scope resolvers load the links from the server and never trust a client-claimed school.
 */
export function createParentRouter(deps: ParentRouterDeps): Router {
  const router = Router();
  const h = createParentHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onParent = { target: (req: Request) => ({ type: PARENT_TARGET_TYPE, id: req.params.id as string }) };
  const onSchoolParam = { target: (req: Request) => ({ type: SCHOOL_TARGET_TYPE, id: req.params.schoolId as string }) };
  const parentId = param('id').isUUID().withMessage('INVALID_VALUE');
  const schoolIdParam = param('schoolId').isUUID().withMessage('INVALID_VALUE');

  router.post(
    '/',
    auth,
    validate(requiredUuid('schoolId'), text('name', 200), text('phone', 40), ...addressChains()),
    guard(ParentPermissions.CREATE, { target: (req) => ({ type: SCHOOL_TARGET_TYPE, id: req.body.schoolId as string }) }),
    handle(async (req, res) => sendCreated(res, await h.createParent(sessionAuthRequired(req), req.body))),
  );

  // `/me` and `/schools/:schoolId` are declared BEFORE `/:id` so they are never read as a parent id.
  router.get(
    '/me',
    auth,
    guard(ParentPermissions.READ_OWN),
    handle(async (req, res) => sendSuccess(res, await h.getOwnProfile(sessionAuthRequired(req)))),
  );

  router.get(
    '/schools/:schoolId',
    auth,
    validate(schoolIdParam),
    guard(ParentPermissions.LIST, onSchoolParam),
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, PARENT_LIST_SPEC);
      sendPaginated(res, await h.listParentsOfSchool({ schoolId: req.params.schoolId as string, sort: query.sort[0] ?? { key: 'createdAt', direction: 'desc' }, page: query.page }));
    }),
  );

  router.get(
    '/:id',
    auth,
    validate(parentId),
    guard(ParentPermissions.READ, onParent),
    handle(async (req, res) => sendSuccess(res, await h.getParent(req.params.id as string))),
  );

  router.patch(
    '/:id',
    auth,
    validate(parentId, ...addressChains()),
    guard(ParentPermissions.UPDATE, onParent),
    handle(async (req, res) => sendSuccess(res, await h.updateParent(req.params.id as string, sessionAuthRequired(req), req.body))),
  );

  router.delete(
    '/:id/schools/:schoolId',
    auth,
    validate(parentId, schoolIdParam),
    guard(ParentPermissions.REMOVE_SCHOOL_LINK, onSchoolParam),
    handle(async (req, res) => sendSuccess(res, await h.removeSchoolLink(req.params.id as string, req.params.schoolId as string, sessionAuthRequired(req)))),
  );

  return router;
}
