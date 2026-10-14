import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import { createOrganizationHandlers, type OrganizationHandlerService } from './organization-handlers';
import { sessionAuthRequired } from './session-required';

export interface OrganizationRouterDeps {
  readonly getService: () => OrganizationHandlerService;
  readonly requireAuthentication: RequestHandler;
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
const optionalId = (field: string): ValidationChain => body(field).optional({ values: 'null' }).isUUID().withMessage('INVALID_VALUE');

const LIST_SPEC: ListQuerySpec = { sortable: { name: 'name' }, defaultSort: [{ key: 'name', direction: 'asc' }], filters: {} };

/**
 * /organizations. Endpoints (all under /api/v1):
 *   POST /organizations        PUBLIC (login optional)  register an organization: name, country, own address + applicant -> 201
 *   GET  /organizations        authenticated            the organizations the caller administers (paginated)
 *   GET  /organizations/:id    authenticated            one organization, only for its administrators (otherwise 404)
 * The applicant becomes the MAIN_ADMIN of THIS organization only. Permissions/scope definitions of the permission matrix
 * (D-1/D-2) are not finalized; the organization scope is enforced by the application.
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
      optionalId('organization.centerId'),
      optionalId('organization.villageId'),
    ),
    handle(async (req, res) => sendCreated(res, await h.register(req.body, req.auth?.userId))),
  );

  router.get(
    '/',
    auth,
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, LIST_SPEC);
      sendPaginated(res, await h.list(sessionAuthRequired(req), query.page));
    }),
  );

  router.get('/:id', auth, validate(param('id').isUUID().withMessage('INVALID_VALUE')), handle(async (req, res) => sendSuccess(res, await h.get(sessionAuthRequired(req), req.params.id as string))));

  return router;
}
