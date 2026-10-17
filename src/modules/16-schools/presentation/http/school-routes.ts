import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { ORGANIZATION_TARGET_TYPE } from '../../../13-organization-core/public';
import { SCHOOL_TARGET_TYPE, SchoolPermissions } from '../../application/services/school-authorization';
import { SCHOOL_STATUSES } from '../../domain/value-objects/school-status';
import { createSchoolHandlers, type SchoolHandlerService } from './school-handlers';
import { sessionAuthRequired } from './session-required';

export interface SchoolRouterDeps {
  readonly getService: () => SchoolHandlerService;
  /** Authenticates the access token (Module 10 `requireAuthentication`). */
  readonly requireAuthentication: RequestHandler;
  /** Authorization Engine route guard (Module 12): roles -> permissions -> scope. */
  readonly requirePermission: RequirePermission;
  /** Abuse limit applied to the PUBLIC submission endpoint (see `createPublicSubmissionRateLimiter`). */
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
/** Free text: only the type and a generous size cap are checked here; normalization and the 200-character rule are the address rules (Module 15). */
const optionalText = (field: string): ValidationChain => body(field).optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max: 1000 }).withMessage('INVALID_VALUE');
const requiredUuid = (field: string): ValidationChain => body(field).isString().withMessage('INVALID_VALUE').bail().isUUID().withMessage('INVALID_VALUE');
const number = (field: string): ValidationChain =>
  body(field).exists({ values: 'null' }).withMessage('REQUIRED_FIELD').bail().custom((v) => typeof v === 'number' && Number.isFinite(v)).withMessage('INVALID_VALUE');
const gps = (prefix: string): ValidationChain[] => [number(`${prefix}.latitude`), number(`${prefix}.longitude`), number(`${prefix}.accuracyMeters`)];
const schoolId = param('id').isUUID().withMessage('INVALID_VALUE');

/** The school part of a form: name, registered governorate, free-text center/village, GPS. */
const schoolChains = (): ValidationChain[] => [
  text('school.name', 200),
  requiredUuid('school.governorateId'),
  optionalId('school.countryId'),
  optionalText('school.centerName'),
  optionalText('school.villageName'),
  ...gps('school.gps'),
];

export const SCHOOL_LIST_SPEC: ListQuerySpec = {
  sortable: { createdAt: 'createdAt', code: 'code', name: 'name', status: 'status' },
  defaultSort: [{ key: 'createdAt', direction: 'desc' }],
  filters: {
    status: { type: 'enum', values: SCHOOL_STATUSES, multiple: true },
  },
};

/**
 * /schools. Endpoints (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`):
 *   POST   /schools                  schools.school.create         ORGANIZATION_MANAGER of `organizationId`   create a school (always PENDING)
 *   POST   /schools/submissions      PUBLIC (login optional, rate limited)  school form + applicant + organizationId -> 201 (PENDING)
 *   GET    /schools                  schools.school.list           ORGANIZATION_MANAGER / SCHOOL_MANAGER      the caller's own schools only (paginated)
 *   GET    /schools/:id              schools.school.read           manager of the school's organization, or the school's manager
 *   POST   /schools/:id/approve      schools.school.approve        ORGANIZATION_MANAGER of the school's organization   PENDING -> ACTIVE
 *   POST   /schools/:id/reject       schools.school.reject          same     { reason }   PENDING -> REJECTED
 *   POST   /schools/:id/deactivate   schools.school.deactivate      same     ACTIVE -> INACTIVE
 *   POST   /schools/:id/reactivate   schools.school.reactivate      same     INACTIVE -> ACTIVE
 *   PATCH  /schools/:id/gps          schools.school.correct-gps     same     correct the GPS while PENDING
 *   PUT    /schools/:id/manager      schools.manager.assign         same     { userId } assign the School Manager of an ACTIVE school
 *   DELETE /schools/:id/manager      schools.manager.revoke         same     end the active manager link
 * The address is a registered governorate plus FREE-TEXT `centerName` / `villageName`; the country is the organization's.
 * The actor always comes from the verified token. For a school operation the scope target is the school (loaded server-side by the
 * scope resolver); for creation it is the organization, proven against the caller's own organization link.
 */
export function createSchoolRouter(deps: SchoolRouterDeps): Router {
  const router = Router();
  const h = createSchoolHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onSchool = { target: (req: Request) => ({ type: SCHOOL_TARGET_TYPE, id: req.params.id as string }) };
  /** Login is optional on the public submission; an invalid token is still rejected (401), never silently ignored. */
  const optionalAuthentication: RequestHandler = (req, res, next) => {
    if (req.header('authorization')) auth(req, res, next);
    else next();
  };

  router.post(
    '/',
    auth,
    validate(requiredUuid('organizationId'), ...schoolChains()),
    guard(SchoolPermissions.CREATE, { target: (req) => ({ type: ORGANIZATION_TARGET_TYPE, id: req.body.organizationId as string }) }),
    handle(async (req, res) => sendCreated(res, await h.createSchool(sessionAuthRequired(req), req.body))),
  );

  router.post(
    '/submissions',
    deps.publicSubmissionLimit,
    optionalAuthentication,
    validate(text('applicant.name', 200), text('applicant.phone', 40), requiredUuid('organizationId'), ...schoolChains()),
    handle(async (req, res) => sendCreated(res, await h.submitSchool(req.body, req.auth?.userId))),
  );

  router.get(
    '/',
    auth,
    guard(SchoolPermissions.LIST),
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, SCHOOL_LIST_SPEC);
      const status = query.filters.status;
      sendPaginated(
        res,
        await h.listSchools(sessionAuthRequired(req), {
          ...(Array.isArray(status) ? { statuses: status as string[] } : {}),
          sort: query.sort[0] ?? { key: 'createdAt', direction: 'desc' },
          page: query.page,
        }),
      );
    }),
  );

  router.get('/:id', auth, validate(schoolId), guard(SchoolPermissions.READ, onSchool), handle(async (req, res) => sendSuccess(res, await h.getSchool(req.params.id as string))));

  router.post('/:id/approve', auth, validate(schoolId), guard(SchoolPermissions.APPROVE, onSchool), handle(async (req, res) => sendSuccess(res, await h.approve(sessionAuthRequired(req), req.params.id as string))));

  router.post(
    '/:id/reject',
    auth,
    validate(schoolId, text('reason', 500)),
    guard(SchoolPermissions.REJECT, onSchool),
    handle(async (req, res) => sendSuccess(res, await h.reject(sessionAuthRequired(req), req.params.id as string, req.body))),
  );

  router.post('/:id/deactivate', auth, validate(schoolId), guard(SchoolPermissions.DEACTIVATE, onSchool), handle(async (req, res) => sendSuccess(res, await h.deactivate(sessionAuthRequired(req), req.params.id as string))));

  router.post('/:id/reactivate', auth, validate(schoolId), guard(SchoolPermissions.REACTIVATE, onSchool), handle(async (req, res) => sendSuccess(res, await h.reactivate(sessionAuthRequired(req), req.params.id as string))));

  router.patch(
    '/:id/gps',
    auth,
    validate(schoolId, ...gps('gps')),
    guard(SchoolPermissions.CORRECT_GPS, onSchool),
    handle(async (req, res) => sendSuccess(res, await h.correctGps(sessionAuthRequired(req), req.params.id as string, req.body))),
  );

  router.put(
    '/:id/manager',
    auth,
    validate(schoolId, requiredUuid('userId')),
    guard(SchoolPermissions.ASSIGN_MANAGER, onSchool),
    handle(async (req, res) => sendSuccess(res, await h.assignManager(sessionAuthRequired(req), req.params.id as string, req.body))),
  );

  router.delete(
    '/:id/manager',
    auth,
    validate(schoolId),
    guard(SchoolPermissions.REVOKE_MANAGER, onSchool),
    handle(async (req, res) => sendSuccess(res, await h.revokeManager(sessionAuthRequired(req), req.params.id as string))),
  );

  return router;
}
