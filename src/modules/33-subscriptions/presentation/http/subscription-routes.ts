import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { SCHOOL_TARGET_TYPE } from '../../../16-schools/public';
import { SUBSCRIPTION_SCHOOL_TARGET_TYPE, SUBSCRIPTION_TARGET_TYPE, SubscriptionPermissions } from '../../application/services/subscription-authorization';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '../../domain/value-objects/subscription-status';
import { createSubscriptionHandlers, type CollectorHandlerService, type SubscriptionHandlerService } from './subscription-handlers';
import { sessionAuthRequired } from './session-required';

export interface SubscriptionRouterDeps {
  readonly getSubscriptions: () => SubscriptionHandlerService;
  readonly getCollectors: () => CollectorHandlerService;
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

export const SUBSCRIPTION_LIST_SPEC: ListQuerySpec = {
  sortable: { month: 'month' },
  defaultSort: [{ key: 'month', direction: 'desc' }],
  filters: {
    status: { type: 'enum', values: SUBSCRIPTION_STATUSES, multiple: true },
    studentId: { type: 'uuid' },
    month: { type: 'string', maxLength: 7 },
  },
};

export const COLLECTOR_LIST_SPEC: ListQuerySpec = {
  sortable: { createdAt: 'createdAt' },
  defaultSort: [{ key: 'createdAt', direction: 'asc' }],
  filters: {},
};

/**
 * /subscriptions. Endpoints (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`):
 *   POST   /subscriptions/schools/:schoolId/monthly                   subscriptions.monthly.create         SCHOOL_MANAGER | the school's Collector   bulk-create the CURRENT month (Africa/Cairo) for every ACTIVE student, once per school and month
 *   POST   /subscriptions/schools/:schoolId/students/:studentId       subscriptions.subscription.create    SCHOOL_MANAGER | the school's Collector   one subscription for a student who joined after the bulk run (current month)
 *   GET    /subscriptions/schools/:schoolId                           subscriptions.subscription.list      SCHOOL_MANAGER | the school's Collector   the school's subscriptions (paginated; filters month, status, studentId)
 *   POST   /subscriptions/schools/:schoolId/collectors                subscriptions.collector.assign       SCHOOL_MANAGER of the school              register (or reuse) a Subscription Collector and link them to the school
 *   GET    /subscriptions/schools/:schoolId/collectors                subscriptions.collector.list         SCHOOL_MANAGER of the school              the school's current Collectors (paginated)
 *   DELETE /subscriptions/schools/:schoolId/collectors/:userId        subscriptions.collector.remove       SCHOOL_MANAGER of the school              end the Collector-to-School link (history kept)
 *   GET    /subscriptions/collectors/me                               subscriptions.collector.read-own     SUBSCRIPTION_COLLECTOR                    the caller's own profile and current schools (no id accepted)
 *   GET    /subscriptions/:id                                         subscriptions.subscription.read      SCHOOL_MANAGER | the school's Collector   one subscription
 *   POST   /subscriptions/:id/waive                                   subscriptions.subscription.waive     SCHOOL_MANAGER of the school ONLY         UNPAID -> WAIVED (a Collector cannot waive)
 * There is deliberately NO endpoint that marks a subscription PAID: Module 34 calls the `markPaid` application contract when a payment is recorded.
 * The actor always comes from the verified token. ORGANIZATION_MANAGER, MAIN_ADMIN, PARENT, TEACHER have no subscription permission.
 */
export function createSubscriptionRouter(deps: SubscriptionRouterDeps): Router {
  const router = Router();
  const h = createSubscriptionHandlers(deps.getSubscriptions, deps.getCollectors);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onSubscriptionSchool = { target: (req: Request) => ({ type: SUBSCRIPTION_SCHOOL_TARGET_TYPE, id: req.params.schoolId as string }) };
  const onSchool = { target: (req: Request) => ({ type: SCHOOL_TARGET_TYPE, id: req.params.schoolId as string }) };
  const onSubscription = { target: (req: Request) => ({ type: SUBSCRIPTION_TARGET_TYPE, id: req.params.id as string }) };
  const schoolIdParam = param('schoolId').isUUID().withMessage('INVALID_VALUE');
  const studentIdParam = param('studentId').isUUID().withMessage('INVALID_VALUE');
  const userIdParam = param('userId').isUUID().withMessage('INVALID_VALUE');
  const idParam = param('id').isUUID().withMessage('INVALID_VALUE');

  router.post(
    '/schools/:schoolId/monthly',
    auth,
    validate(schoolIdParam),
    guard(SubscriptionPermissions.CREATE_MONTHLY, onSubscriptionSchool),
    handle(async (req, res) => sendCreated(res, await h.createMonthly(req.params.schoolId as string, sessionAuthRequired(req)))),
  );

  router.post(
    '/schools/:schoolId/students/:studentId',
    auth,
    validate(schoolIdParam, studentIdParam),
    guard(SubscriptionPermissions.CREATE_INDIVIDUAL, onSubscriptionSchool),
    handle(async (req, res) => sendCreated(res, await h.createIndividual(req.params.schoolId as string, req.params.studentId as string, sessionAuthRequired(req)))),
  );

  router.get(
    '/schools/:schoolId',
    auth,
    validate(schoolIdParam),
    guard(SubscriptionPermissions.LIST, onSubscriptionSchool),
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, SUBSCRIPTION_LIST_SPEC);
      const status = query.filters.status;
      const month = query.filters.month;
      const studentId = query.filters.studentId;
      sendPaginated(
        res,
        await h.list({
          schoolId: req.params.schoolId as string,
          ...(typeof month === 'string' ? { month } : {}),
          ...(Array.isArray(status) ? { status: status as readonly SubscriptionStatus[] } : typeof status === 'string' ? { status: [status as SubscriptionStatus] } : {}),
          ...(typeof studentId === 'string' ? { studentId } : {}),
          direction: query.sort[0]?.direction === 'asc' ? 'asc' : 'desc',
          page: query.page,
        }),
      );
    }),
  );

  router.post(
    '/schools/:schoolId/collectors',
    auth,
    validate(schoolIdParam, text('name', 200), text('phone', 40)),
    guard(SubscriptionPermissions.COLLECTOR_ASSIGN, onSchool),
    handle(async (req, res) => sendCreated(res, await h.registerCollector(req.params.schoolId as string, req.body, sessionAuthRequired(req)))),
  );

  router.get(
    '/schools/:schoolId/collectors',
    auth,
    validate(schoolIdParam),
    guard(SubscriptionPermissions.COLLECTOR_LIST, onSchool),
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, COLLECTOR_LIST_SPEC);
      sendPaginated(res, await h.listCollectors(req.params.schoolId as string, query.page));
    }),
  );

  router.delete(
    '/schools/:schoolId/collectors/:userId',
    auth,
    validate(schoolIdParam, userIdParam),
    guard(SubscriptionPermissions.COLLECTOR_REMOVE, onSchool),
    handle(async (req, res) => sendSuccess(res, await h.removeCollector(req.params.userId as string, req.params.schoolId as string, sessionAuthRequired(req)))),
  );

  // `/collectors/me` and `/schools/...` are declared BEFORE `/:id` so they are never read as a subscription id.
  router.get(
    '/collectors/me',
    auth,
    guard(SubscriptionPermissions.COLLECTOR_READ_OWN),
    handle(async (req, res) => sendSuccess(res, await h.getOwnCollectorProfile(sessionAuthRequired(req)))),
  );

  router.get(
    '/:id',
    auth,
    validate(idParam),
    guard(SubscriptionPermissions.READ, onSubscription),
    handle(async (req, res) => sendSuccess(res, await h.get(req.params.id as string))),
  );

  router.post(
    '/:id/waive',
    auth,
    validate(idParam),
    guard(SubscriptionPermissions.WAIVE, onSubscription),
    handle(async (req, res) => sendSuccess(res, await h.waive(req.params.id as string, sessionAuthRequired(req)))),
  );

  return router;
}
