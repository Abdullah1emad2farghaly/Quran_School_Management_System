import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { param, body } from 'express-validator';
import { parseListQuery, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { STUDENT_TARGET_TYPE } from '../../../19-students/public';
import { GROUP_TARGET_TYPE } from '../../../20-groups/public';
import { EvaluationPermissions } from '../../application/services/evaluation-authorization';
import { createEvaluationHandlers, type EvaluationHandlerService, type EvaluationListRequest } from './evaluation-handlers';
import { callerUserId } from './evaluation-required';

export interface EvaluationRouterDeps {
  readonly getService: () => EvaluationHandlerService;
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

/** A student's evaluations are listed by the session's start, newest first by default (`sort=scheduledStart`, `-` for descending). */
export const EVALUATION_LIST_SPEC: ListQuerySpec = {
  sortable: { scheduledStart: 'scheduledStart' },
  defaultSort: [{ key: 'scheduledStart', direction: 'desc' }],
  filters: {},
};

function listRequest(req: Request): EvaluationListRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, EVALUATION_LIST_SPEC);
  return { direction: query.sort[0]?.direction ?? 'desc', page: query.page };
}

/**
 * Evaluations, mounted under /evaluations (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`), then by the application:
 *   GET  /evaluations/students/:id          evaluation.student.read   SCHOOL_MANAGER of the school | the student's own PARENT: a student's evaluations (scores and note)
 *   GET  /evaluations/sessions/:id          evaluation.session.read   SCHOOL_MANAGER | the session's TEACHER: the session's evaluations
 *   POST /evaluations/sessions/:id/records  evaluation.record.record   the session's TEACHER, through Smart Guard (one GPS reading, atomic batch): creates evaluations and modifies scores
 * There is deliberately NO endpoint that deletes an evaluation, edits a note, lets the School Manager write, or reads the (non-existent) modification history. The caller
 * always comes from the verified token; the group of a session is loaded on the server.
 */
export function createEvaluationRouter(deps: EvaluationRouterDeps): Router {
  const router = Router();
  const h = createEvaluationHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onStudent = { target: (req: Request) => ({ type: STUDENT_TARGET_TYPE, id: req.params.id as string }) };
  const onSessionGroup = { target: async (req: Request) => ({ type: GROUP_TARGET_TYPE, id: await h.groupIdOfSession(req.params.id as string) }) };
  const id = param('id').isUUID().withMessage('INVALID_VALUE');
  const records = body('records').isArray({ min: 1 }).withMessage('INVALID_VALUE');

  router.get('/students/:id', auth, validate(id), guard(EvaluationPermissions.READ_STUDENT, onStudent), handle(async (req, res) => sendPaginated(res, await h.listStudent(req.params.id as string, listRequest(req)))));
  router.get('/sessions/:id', auth, validate(id), guard(EvaluationPermissions.READ_SESSION, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.getSession(req.params.id as string, callerUserId(req)))));
  router.post('/sessions/:id/records', auth, validate(id, records), guard(EvaluationPermissions.RECORD, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.recordEvaluations(req.params.id as string, callerUserId(req), req.body))));
  return router;
}
