import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { SUBSCRIPTION_SCHOOL_TARGET_TYPE, SUBSCRIPTION_TARGET_TYPE } from '../../../33-subscriptions/public';
import { PAYMENT_TARGET_TYPE, PaymentPermissions } from '../../application/services/payment-authorization';
import { PAYMENT_STATUSES, type PaymentStatus } from '../../domain/value-objects/payment-vocabulary';
import { createPaymentHandlers, type PaymentHandlerService } from './payment-handlers';
import { sessionAuthRequired } from './session-required';

export interface PaymentRouterDeps {
  readonly getPayments: () => PaymentHandlerService;
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

export const PAYMENT_LIST_SPEC: ListQuerySpec = {
  sortable: { recordedAt: 'recordedAt' },
  defaultSort: [{ key: 'recordedAt', direction: 'desc' }],
  filters: {
    status: { type: 'enum', values: PAYMENT_STATUSES, multiple: true },
    studentId: { type: 'uuid' },
    subscriptionId: { type: 'uuid' },
    month: { type: 'string', maxLength: 7 },
  },
};

/**
 * /payments. Endpoints (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`):
 *   POST /payments/subscriptions/:subscriptionId  payments.payment.record   SCHOOL_MANAGER | the school's Collector   record the CASH payment of a subscription (UNPAID -> PAID through Module 33's controlled `applyPaymentRecorded`)
 *   GET  /payments/schools/:schoolId              payments.payment.list     SCHOOL_MANAGER | the school's Collector   the school's payments (paginated; filters month, status, studentId, subscriptionId)
 *   GET  /payments/:id                            payments.payment.read     SCHOOL_MANAGER | the school's Collector   one payment
 *   POST /payments/:id/reverse                    payments.payment.reverse  SCHOOL_MANAGER of the school ONLY         reverse a payment with a mandatory reason (PAID -> UNPAID through `applyPaymentReversed`)
 * There is NO delete endpoint (a payment is never hard-deleted) and no amount anywhere. The actor always comes from the verified token.
 * ORGANIZATION_MANAGER, MAIN_ADMIN, PARENT, TEACHER, STUDENT have no payment permission.
 */
export function createPaymentRouter(deps: PaymentRouterDeps): Router {
  const router = Router();
  const h = createPaymentHandlers(deps.getPayments);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onSubscription = { target: (req: Request) => ({ type: SUBSCRIPTION_TARGET_TYPE, id: req.params.subscriptionId as string }) };
  const onSubscriptionSchool = { target: (req: Request) => ({ type: SUBSCRIPTION_SCHOOL_TARGET_TYPE, id: req.params.schoolId as string }) };
  const onPayment = { target: (req: Request) => ({ type: PAYMENT_TARGET_TYPE, id: req.params.id as string }) };
  const subscriptionIdParam = param('subscriptionId').isUUID().withMessage('INVALID_VALUE');
  const schoolIdParam = param('schoolId').isUUID().withMessage('INVALID_VALUE');
  const idParam = param('id').isUUID().withMessage('INVALID_VALUE');
  const methodField = body('method').optional().isString().withMessage('INVALID_VALUE');
  const reasonField = body('reason').exists({ values: 'null' }).withMessage('REQUIRED_FIELD').bail().isString().withMessage('INVALID_VALUE');

  router.post(
    '/subscriptions/:subscriptionId',
    auth,
    validate(subscriptionIdParam, methodField),
    guard(PaymentPermissions.RECORD, onSubscription),
    handle(async (req, res) => sendCreated(res, await h.record(req.params.subscriptionId as string, sessionAuthRequired(req), (req.body as Record<string, unknown> | undefined)?.method))),
  );

  router.get(
    '/schools/:schoolId',
    auth,
    validate(schoolIdParam),
    guard(PaymentPermissions.LIST, onSubscriptionSchool),
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, PAYMENT_LIST_SPEC);
      const status = query.filters.status;
      const month = query.filters.month;
      const studentId = query.filters.studentId;
      const subscriptionId = query.filters.subscriptionId;
      sendPaginated(
        res,
        await h.list({
          schoolId: req.params.schoolId as string,
          ...(typeof month === 'string' ? { month } : {}),
          ...(Array.isArray(status) ? { status: status as readonly PaymentStatus[] } : typeof status === 'string' ? { status: [status as PaymentStatus] } : {}),
          ...(typeof studentId === 'string' ? { studentId } : {}),
          ...(typeof subscriptionId === 'string' ? { subscriptionId } : {}),
          direction: query.sort[0]?.direction === 'asc' ? 'asc' : 'desc',
          page: query.page,
        }),
      );
    }),
  );

  router.get('/:id', auth, validate(idParam), guard(PaymentPermissions.READ, onPayment), handle(async (req, res) => sendSuccess(res, await h.get(req.params.id as string))));

  router.post(
    '/:id/reverse',
    auth,
    validate(idParam, reasonField),
    guard(PaymentPermissions.REVERSE, onPayment),
    handle(async (req, res) => sendSuccess(res, await h.reverse(req.params.id as string, sessionAuthRequired(req), (req.body as Record<string, unknown> | undefined)?.reason))),
  );

  return router;
}
