import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { GROUP_TARGET_TYPE } from '../../../20-groups/public';
import { SessionPermissions } from '../../application/services/session-authorization';
import { SESSION_STATUSES } from '../../domain/value-objects/session-status';
import { createSessionHandlers, type SessionHandlerService, type SessionListRequest } from './session-handlers';
import { callerUserId } from './session-required';

export interface SessionRouterDeps {
  readonly getService: () => SessionHandlerService;
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

/** Sessions are listed by their scheduled start, newest first by default (`sort=scheduledStart`, `-` for descending), filtered by `filter[status]`. */
export const SESSION_LIST_SPEC: ListQuerySpec = {
  sortable: { scheduledStart: 'scheduledStart' },
  defaultSort: [{ key: 'scheduledStart', direction: 'desc' }],
  filters: { status: { type: 'enum', values: SESSION_STATUSES, multiple: true } },
};

function listRequest(req: Request): SessionListRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, SESSION_LIST_SPEC);
  const status = query.filters.status;
  return {
    status: Array.isArray(status) ? (status as SessionListRequest['status']) : typeof status === 'string' ? ([status] as SessionListRequest['status']) : undefined,
    direction: query.sort[0]?.direction ?? 'desc',
    page: query.page,
  };
}

/**
 * Class sessions, mounted under /sessions (all under /api/v1; one mount path per module). Authorization is enforced by the Authorization Engine (`requirePermission`):
 *   GET   /sessions/mine              sessions.session.list-own  TEACHER: their own sessions (the Teacher comes from the token)
 *   GET   /sessions/groups/:id        sessions.session.read      SCHOOL_MANAGER of the group's school | TEACHER of the group: the group's sessions
 *   GET   /sessions/:id               sessions.session.read      the same audience, resolved through the session's group
 *   POST  /sessions/:id/cancel        sessions.session.cancel    the assigned TEACHER cancels with a mandatory reason
 * There is deliberately NO endpoint to create, start, complete, edit or delete a session: the system creates sessions from the schedule and moves them through
 * their lifecycle; a session is never deleted. The caller always comes from the verified token.
 */
export function createSessionRouter(deps: SessionRouterDeps): Router {
  const router = Router();
  const h = createSessionHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onGroup = { target: (req: Request) => ({ type: GROUP_TARGET_TYPE, id: req.params.id as string }) };
  /** The group is loaded from the session on the server (never from the request); an unknown session is a 404 from the owning module. */
  const onSessionGroup = { target: async (req: Request) => ({ type: GROUP_TARGET_TYPE, id: await h.groupIdOf(req.params.id as string) }) };
  const id = param('id').isUUID().withMessage('INVALID_VALUE');
  const reason: ValidationChain = body('reason').exists({ values: 'null' }).withMessage('REQUIRED_FIELD').bail().isString().withMessage('INVALID_VALUE');

  // The fixed paths are declared BEFORE `/:id` so `mine` and `groups` are never read as a session id.
  router.get('/mine', auth, guard(SessionPermissions.LIST_OWN), handle(async (req, res) => sendPaginated(res, await h.listOwnSessions(callerUserId(req), listRequest(req)))));
  router.get('/groups/:id', auth, validate(id), guard(SessionPermissions.READ, onGroup), handle(async (req, res) => sendPaginated(res, await h.listGroupSessions(req.params.id as string, listRequest(req)))));
  router.get('/:id', auth, validate(id), guard(SessionPermissions.READ, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.getSession(req.params.id as string))));
  router.post('/:id/cancel', auth, validate(id, reason), guard(SessionPermissions.CANCEL, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.cancelSession(req.params.id as string, callerUserId(req), req.body))));
  return router;
}
