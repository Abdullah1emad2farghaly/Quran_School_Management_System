import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { ORGANIZATION_TARGET_TYPE, OrganizationPermissions } from '../../../13-organization-core/public';
import { createOrganizationHandlers, type OrganizationHandlerService } from './organization-handlers';
import { sessionAuthRequired } from './session-required';

export interface OrganizationRouterDeps {
  readonly getService: () => OrganizationHandlerService;
  readonly requireAuthentication: RequestHandler;
  /** Authorization Engine route guard (Module 12). */
  readonly requirePermission: RequirePermission;
  /** Abuse limit applied to the PUBLIC registration endpoint. */
  readonly publicSubmissionLimit: RequestHandler;
}

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

const text = (field: string, max: number): ValidationChain =>
  body(field).isString().withMessage('INVALID_VALUE').bail().trim().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max }).withMessage('INVALID_VALUE');
const requiredId = (field: string): ValidationChain => body(field).isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE');
const optionalText = (field: string): ValidationChain =>
  body(field).optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max: 1000 }).withMessage('INVALID_VALUE');

const LIST_SPEC: ListQuerySpec = { sortable: { name: 'name' }, defaultSort: [{ key: 'name', direction: 'asc' }], filters: {} };

/**
 * /organizations. Endpoints (all under /api/v1):
 *   POST /organizations        PUBLIC (login optional)  register an organization: name, country, own address + applicant -> 201
 *   GET  /organizations        organizations.organization.list  the organizations the caller manages (paginated)
 *   GET  /organizations/:id    organizations.organization.read  one organization, only for ITS manager (management scope, otherwise 403)
 * The address is: registered country and governorate; `centerName` and `villageName` are FREE TEXT (no registered center/village).
 * The applicant becomes the ORGANIZATION_MANAGER of THIS organization only (never MAIN_ADMIN). Authorization is enforced by the shared
 * Authorization Engine; the registration endpoint is public by design (rate limited).
 */
export function createOrganizationRouter(deps: OrganizationRouterDeps): Router {
  const router = Router();
  const h = createOrganizationHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const optionalAuthentication: RequestHandler = (req, res, next) => {
    if (req.header('authorization')) auth(req, res, next);
    else next();
  };

  router.post(
    '/',
    deps.publicSubmissionLimit,
    optionalAuthentication,
    validate(
      text('applicant.name', 200),
      text('applicant.phone', 40),
      text('organization.name', 200),
      requiredId('organization.countryId'),
      requiredId('organization.governorateId'),
      optionalText('organization.centerName'),
      optionalText('organization.villageName'),
    ),
    handle(async (req, res) => sendCreated(res, await h.register(req.body, req.auth?.userId))),
  );

  router.get(
    '/',
    auth,
    deps.requirePermission(OrganizationPermissions.LIST),
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, LIST_SPEC);
      sendPaginated(res, await h.list(sessionAuthRequired(req), query.page));
    }),
  );

  router.get(
    '/:id',
    auth,
    validate(param('id').isUUID().withMessage('INVALID_VALUE')),
    // The target is checked against the server-side manager link; the id from the URL is never trusted by itself.
    deps.requirePermission(OrganizationPermissions.READ, { target: (req) => ({ type: ORGANIZATION_TARGET_TYPE, id: req.params.id as string }) }),
    handle(async (req, res) => sendSuccess(res, await h.get(req.params.id as string))),
  );

  return router;
}
