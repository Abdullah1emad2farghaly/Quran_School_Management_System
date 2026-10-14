import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import { SCHOOL_STATUSES } from '../../domain/value-objects/school-status';
import { SCHOOL_TYPES } from '../../domain/value-objects/school-type';
import { createSchoolHandlers, type SchoolHandlerService } from './school-handlers';
import { sessionAuthRequired } from './session-required';

export interface SchoolRouterDeps {
  readonly getService: () => SchoolHandlerService;
  /** Authenticates the access token (Module 10 `requireAuthentication`). */
  readonly requireAuthentication: RequestHandler;
  /** Abuse limit applied to the two PUBLIC submission endpoints (see `createPublicSubmissionRateLimiter`). */
  readonly publicSubmissionLimit: RequestHandler;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

const text = (field: string, max: number): ValidationChain =>
  body(field).isString().withMessage('INVALID_VALUE').bail().trim().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max }).withMessage('INVALID_VALUE');
const optionalId = (field: string): ValidationChain => body(field).optional({ values: 'null' }).isUUID().withMessage('INVALID_VALUE');
const number = (field: string): ValidationChain =>
  body(field).exists({ values: 'null' }).withMessage('REQUIRED_FIELD').bail().custom((v) => typeof v === 'number' && Number.isFinite(v)).withMessage('INVALID_VALUE');
const gps = (prefix: string): ValidationChain[] => [number(`${prefix}.latitude`), number(`${prefix}.longitude`), number(`${prefix}.accuracyMeters`)];
const schoolId = param('id').isUUID().withMessage('INVALID_VALUE');

/** The Sub-School form: `school` (name, governorate, optional center/village, GPS) and `applicant` (name, phone). */
const submissionChains = (): ValidationChain[] => [
  text('applicant.name', 200),
  text('applicant.phone', 40),
  text('school.name', 200),
  body('school.governorateId').isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE'),
  optionalId('school.countryId'),
  optionalId('school.centerId'),
  optionalId('school.villageId'),
  ...gps('school.gps'),
];

export const SCHOOL_LIST_SPEC: ListQuerySpec = {
  sortable: { createdAt: 'createdAt', code: 'code', name: 'name', status: 'status' },
  defaultSort: [{ key: 'createdAt', direction: 'desc' }],
  filters: {
    status: { type: 'enum', values: SCHOOL_STATUSES, multiple: true },
    type: { type: 'enum', values: SCHOOL_TYPES },
  },
};

/**
 * /schools. Endpoints (all under /api/v1):
 *   POST   /schools                    authenticated + administrator of the organization   create a Main School (ACTIVE)
 *   POST   /schools/sub-submissions    PUBLIC (login optional)  Sub-School form + applicant           -> 201 (PENDING)
 *   GET    /schools                    authenticated            schools the caller may see (paginated)
 *   GET    /schools/:id                authenticated            one school the caller may see
 *   POST   /schools/:id/approve        authenticated + administrator of the school's organization   approve a PENDING Sub-School
 *   POST   /schools/:id/reject         authenticated + administrator of the school's organization   { reason }
 *   POST   /schools/:id/deactivate     authenticated + administrator of the school's organization   ACTIVE -> INACTIVE   (provisional rule, see docs)
 *   POST   /schools/:id/reactivate     authenticated + administrator of the school's organization   INACTIVE -> ACTIVE   (provisional rule)
 *   PATCH  /schools/:id/gps            authenticated + administrator of the school's organization   correct GPS while PENDING (provisional rule)
 *   PUT    /schools/:id/manager        authenticated + administrator of the school's organization   { userId } assign the school manager
 *   DELETE /schools/:id/manager        authenticated + administrator of the school's organization   end the active manager link
 * The permission matrix (D-1/D-2) is not finalized: the checks are enforced by the application service (deny by default: the
 * MAIN_ADMIN role AND an administrator link to the school's organization); there is no permission-registry entry. The actor
 * always comes from the verified token.
 */
export function createSchoolRouter(deps: SchoolRouterDeps): Router {
  const router = Router();
  const h = createSchoolHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  /** Login is optional on the public submissions; an invalid token is still rejected (401), never silently ignored. */
  const optionalAuthentication: RequestHandler = (req, res, next) => {
    if (req.header('authorization')) auth(req, res, next);
    else next();
  };

  router.post(
    '/',
    auth,
    validate(
      body('organizationId').isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE'),
      text('school.name', 200),
      body('school.governorateId').isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE'),
      optionalId('school.countryId'),
      optionalId('school.centerId'),
      optionalId('school.villageId'),
      ...gps('school.gps'),
    ),
    handle(async (req, res) => sendCreated(res, await h.createMainSchool(sessionAuthRequired(req), req.body))),
  );

  router.post(
    '/sub-submissions',
    deps.publicSubmissionLimit,
    optionalAuthentication,
    validate(...submissionChains(), body('parentSchoolId').isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE')),
    handle(async (req, res) => sendCreated(res, await h.submitSubSchool(req.body, req.auth?.userId))),
  );

  router.get(
    '/',
    auth,
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, SCHOOL_LIST_SPEC);
      const status = query.filters.status;
      const type = query.filters.type;
      sendPaginated(
        res,
        await h.listSchools(sessionAuthRequired(req), {
          ...(Array.isArray(status) ? { statuses: status as string[] } : {}),
          ...(typeof type === 'string' ? { type } : {}),
          sort: query.sort[0] ?? { key: 'createdAt', direction: 'desc' },
          page: query.page,
        }),
      );
    }),
  );

  router.get('/:id', auth, validate(schoolId), handle(async (req, res) => sendSuccess(res, await h.getSchool(sessionAuthRequired(req), req.params.id as string))));

  router.post('/:id/approve', auth, validate(schoolId), handle(async (req, res) => sendSuccess(res, await h.approve(sessionAuthRequired(req), req.params.id as string))));

  router.post(
    '/:id/reject',
    auth,
    validate(schoolId, text('reason', 500)),
    handle(async (req, res) => sendSuccess(res, await h.reject(sessionAuthRequired(req), req.params.id as string, req.body))),
  );

  router.post('/:id/deactivate', auth, validate(schoolId), handle(async (req, res) => sendSuccess(res, await h.deactivate(sessionAuthRequired(req), req.params.id as string))));

  router.post('/:id/reactivate', auth, validate(schoolId), handle(async (req, res) => sendSuccess(res, await h.reactivate(sessionAuthRequired(req), req.params.id as string))));

  router.patch(
    '/:id/gps',
    auth,
    validate(schoolId, ...gps('gps')),
    handle(async (req, res) => sendSuccess(res, await h.correctGps(sessionAuthRequired(req), req.params.id as string, req.body))),
  );

  router.put(
    '/:id/manager',
    auth,
    validate(schoolId, body('userId').isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE')),
    handle(async (req, res) => sendSuccess(res, await h.assignManager(sessionAuthRequired(req), req.params.id as string, req.body))),
  );

  router.delete('/:id/manager', auth, validate(schoolId), handle(async (req, res) => sendSuccess(res, await h.revokeManager(sessionAuthRequired(req), req.params.id as string))));

  return router;
}
