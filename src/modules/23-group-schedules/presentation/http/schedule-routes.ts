import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { sendCreated, sendNoContent, sendSuccess, validate } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { GROUP_TARGET_TYPE } from '../../../20-groups/public';
import { SchedulePermissions } from '../../application/services/schedule-authorization';
import { createScheduleHandlers, type ScheduleHandlerService } from './schedule-handlers';
import { sessionAuthRequired } from './session-required';

export interface ScheduleRouterDeps {
  readonly getService: () => ScheduleHandlerService;
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

/** Only the TYPE is checked here; the weekday, the HH:MM times and every business rule are the domain's (SCHEDULE_* codes). */
const requiredText = (field: string): ValidationChain => body(field).exists({ values: 'null' }).withMessage('REQUIRED_FIELD').bail().isString().withMessage('INVALID_VALUE').bail().isLength({ max: 20 }).withMessage('INVALID_VALUE');
const optionalText = (field: string): ValidationChain => body(field).optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max: 20 }).withMessage('INVALID_VALUE');

/**
 * The schedule of a group, mounted under /group-schedules (all under /api/v1; one mount path per module). Authorization is enforced by the Authorization Engine (`requirePermission`):
 *   GET    /group-schedules/mine                groups.schedule.list-own      TEACHER: their own weekly schedule across their schools (token-derived)
 *   GET    /group-schedules/:id/slots           groups.schedule.read          SCHOOL_MANAGER | TEACHER of the group | PARENT of a student in it: the ACTIVE slots
 *   GET    /group-schedules/:id/slots/history   groups.schedule.read-history  SCHOOL_MANAGER: every slot, active and retired
 *   POST   /group-schedules/:id/slots           groups.schedule.manage        add a slot (one per weekday; no Teacher overlap)
 *   PATCH  /group-schedules/:id/slots/:slotId   groups.schedule.manage        change a slot (atomic replacement: the old slot is retired)
 *   DELETE /group-schedules/:id/slots/:slotId   groups.schedule.manage        remove a slot (retired, kept as history)
 * There is deliberately no physical delete. The actor always comes from the verified token.
 */
export function createScheduleRouter(deps: ScheduleRouterDeps): Router {
  const router = Router();
  const h = createScheduleHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onGroup = { target: (req: Request) => ({ type: GROUP_TARGET_TYPE, id: req.params.id as string }) };
  const groupId = param('id').isUUID().withMessage('INVALID_VALUE');
  const slotId = param('slotId').isUUID().withMessage('INVALID_VALUE');

  // The fixed path is declared BEFORE `/:id/...` so `mine` is never read as a group id.
  router.get('/mine', auth, guard(SchedulePermissions.LIST_OWN), handle(async (req, res) => sendSuccess(res, await h.listOwn(sessionAuthRequired(req)))));

  router.get('/:id/slots', auth, validate(groupId), guard(SchedulePermissions.READ, onGroup), handle(async (req, res) => sendSuccess(res, await h.listSlots(req.params.id as string))));
  router.get('/:id/slots/history', auth, validate(groupId), guard(SchedulePermissions.READ_HISTORY, onGroup), handle(async (req, res) => sendSuccess(res, await h.listHistory(req.params.id as string))));

  router.post(
    '/:id/slots',
    auth,
    validate(groupId, requiredText('dayOfWeek'), requiredText('startTime'), requiredText('endTime')),
    guard(SchedulePermissions.MANAGE, onGroup),
    handle(async (req, res) => sendCreated(res, await h.addSlot(req.params.id as string, sessionAuthRequired(req), req.body))),
  );
  router.patch(
    '/:id/slots/:slotId',
    auth,
    validate(groupId, slotId, optionalText('dayOfWeek'), optionalText('startTime'), optionalText('endTime')),
    guard(SchedulePermissions.MANAGE, onGroup),
    handle(async (req, res) => sendSuccess(res, await h.changeSlot(req.params.id as string, req.params.slotId as string, sessionAuthRequired(req), req.body))),
  );
  router.delete(
    '/:id/slots/:slotId',
    auth,
    validate(groupId, slotId),
    guard(SchedulePermissions.MANAGE, onGroup),
    handle(async (req, res) => {
      await h.removeSlot(req.params.id as string, req.params.slotId as string, sessionAuthRequired(req));
      sendNoContent(res);
    }),
  );
  return router;
}
