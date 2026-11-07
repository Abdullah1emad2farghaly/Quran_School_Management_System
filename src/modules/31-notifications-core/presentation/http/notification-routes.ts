import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param } from 'express-validator';
import { parseListQuery, sendNoContent, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { NotificationService } from '../../application/services/notification-service';
import type { PushSubscriptionService } from '../../application/services/push-subscription-service';

export interface NotificationRouterDeps {
  readonly getNotifications: () => Pick<NotificationService, 'list' | 'unreadCount' | 'markRead' | 'markAllRead' | 'deleteNotification' | 'clearAll'>;
  readonly getPush: () => Pick<PushSubscriptionService, 'publicKey' | 'subscribe' | 'unsubscribe' | 'list'>;
  /** Authenticates the access token (Module 10 `requireAuthentication`): the account and the session come from it, never from the request. */
  readonly requireAuthentication: RequestHandler;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/** Newest first by default (`sort=createdAt`, `-createdAt`); `filter[unread]=true` lists only unread notifications. */
export const NOTIFICATION_LIST_SPEC: ListQuerySpec = { sortable: { createdAt: 'createdAt' }, defaultSort: [{ key: 'createdAt', direction: 'desc' }], filters: { unread: { type: 'boolean' } } };

const noStore = (res: Response): void => {
  res.setHeader('Cache-Control', 'no-store');
};

/**
 * /notifications. Authentication ONLY: notifications belong to the ACCOUNT in the verified token, so there is no role, permission or scope and no way to name another
 * account. Every operation acts on the account (all its devices see the same state). An id that is unknown, deleted or another account's gets the same answer.
 *   GET /notifications, GET /unread-count, POST /:id/read, POST /read-all, DELETE /:id (hard), DELETE / (clear all, hard)
 *   Web Push: GET /push/public-key, GET|POST /push-subscriptions, POST /push-subscriptions/unsubscribe
 */
export function createNotificationRouter(deps: NotificationRouterDeps): Router {
  const router = Router();
  const auth = deps.requireAuthentication;
  const caller = (req: Request) => {
    if (!req.auth) throw new Error('requireAuthentication must run first');
    return req.auth;
  };
  const uuid = (name: string) => param(name).isUUID().withMessage('INVALID_VALUE');

  router.get('/', auth, handle(async (req, res) => {
    const page = await deps.getNotifications().list(caller(req).userId, parseListQuery(req.query as Record<string, unknown>, NOTIFICATION_LIST_SPEC));
    noStore(res);
    sendPaginated(res, { ...page, items: page.items.map((n) => ({ ...n, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })) });
  }));

  router.get('/unread-count', auth, handle(async (req, res) => {
    const unreadCount = await deps.getNotifications().unreadCount(caller(req).userId);
    noStore(res);
    sendSuccess(res, { unreadCount });
  }));

  router.post('/read-all', auth, handle(async (req, res) => {
    await deps.getNotifications().markAllRead(caller(req).userId);
    noStore(res);
    sendNoContent(res);
  }));

  router.delete('/', auth, handle(async (req, res) => {
    await deps.getNotifications().clearAll(caller(req).userId);
    noStore(res);
    sendNoContent(res);
  }));

  // ---- Web Push (declared before the `/:id` routes) ----
  router.get('/push/public-key', auth, handle(async (_req, res) => {
    const publicKey = deps.getPush().publicKey();
    noStore(res);
    sendSuccess(res, { publicKey });
  }));

  router.get('/push-subscriptions', auth, handle(async (req, res) => {
    const c = caller(req);
    const items = await deps.getPush().list(c.userId, c.sessionId);
    noStore(res);
    sendSuccess(res, { items: items.map((s) => ({ id: s.id, createdAt: s.createdAt.toISOString(), lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null, isCurrentSession: s.isCurrentSession })) });
  }));

  router.post(
    '/push-subscriptions',
    auth,
    validate(
      body('endpoint').isString().withMessage('INVALID_VALUE').isLength({ min: 1, max: 2048 }).withMessage('INVALID_VALUE'),
      body('keys').isObject().withMessage('INVALID_VALUE'),
      body('keys.p256dh').isString().withMessage('INVALID_VALUE').isLength({ min: 16, max: 255 }).withMessage('INVALID_VALUE'),
      body('keys.auth').isString().withMessage('INVALID_VALUE').isLength({ min: 16, max: 255 }).withMessage('INVALID_VALUE'),
    ),
    handle(async (req, res) => {
      const c = caller(req);
      const b = req.body as { endpoint: unknown; keys: { p256dh: unknown; auth: unknown } };
      const s = await deps.getPush().subscribe(c.userId, c.sessionId, { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth });
      noStore(res);
      sendSuccess(res, { id: s.id, createdAt: s.createdAt.toISOString(), lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null, isCurrentSession: s.isCurrentSession });
    }),
  );

  router.post(
    '/push-subscriptions/unsubscribe',
    auth,
    validate(body('endpoint').isString().withMessage('INVALID_VALUE').isLength({ min: 1, max: 2048 }).withMessage('INVALID_VALUE')),
    handle(async (req, res) => {
      await deps.getPush().unsubscribe(caller(req).userId, (req.body as { endpoint: unknown }).endpoint);
      noStore(res);
      sendNoContent(res);
    }),
  );

  // ---- one notification ----
  router.post('/:id/read', auth, validate(uuid('id')), handle(async (req, res) => {
    await deps.getNotifications().markRead(caller(req).userId, req.params.id as string);
    noStore(res);
    sendNoContent(res);
  }));

  router.delete('/:id', auth, validate(uuid('id')), handle(async (req, res) => {
    await deps.getNotifications().deleteNotification(caller(req).userId, req.params.id as string);
    noStore(res);
    sendNoContent(res);
  }));

  return router;
}
