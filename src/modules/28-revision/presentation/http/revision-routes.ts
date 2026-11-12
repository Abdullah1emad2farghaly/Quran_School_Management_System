import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { STUDENT_TARGET_TYPE } from '../../../19-students/public';
import { GROUP_TARGET_TYPE } from '../../../20-groups/public';
import { QuranPermissions, type QuranStructureLookup } from '../../../21-quran-structure/public';
import { RevisionPermissions } from '../../application/services/revision-authorization';
import { createRevisionHandlers, type RevisionHandlerService, type StudentRecordsRequest } from './revision-handlers';
import { callerUserId } from './revision-required';

export interface RevisionRouterDeps {
  /** Module 21's read-only public contract: the ONE source of Quran data (this module keeps no Quran data and no Quran query). */
  readonly getQuran: () => Pick<QuranStructureLookup, 'listAyahs'>;
  readonly getService: () => RevisionHandlerService;
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

/** A student's records are listed by the session's start, newest first by default (`sort=scheduledStart`, `-` for descending). */
export const REVISION_LIST_SPEC: ListQuerySpec = {
  sortable: { scheduledStart: 'scheduledStart' },
  defaultSort: [{ key: 'scheduledStart', direction: 'desc' }],
  filters: {},
};

/** The Quran ayahs are listed in the canonical Quran order (`sort=globalPosition`, `-` for descending); the same contract in Memorization and Revision. */
export const REVISION_AYAHS_SPEC: ListQuerySpec = {
  sortable: { globalPosition: 'globalPosition' },
  defaultSort: [{ key: 'globalPosition', direction: 'asc' }],
  filters: {},
};

function ayahsRequest(req: Request): StudentRecordsRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, REVISION_AYAHS_SPEC);
  return { direction: query.sort[0]?.direction ?? 'asc', page: query.page };
}

function listRequest(req: Request): StudentRecordsRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, REVISION_LIST_SPEC);
  return { direction: query.sort[0]?.direction ?? 'desc', page: query.page };
}

/**
 * Revision, mounted under /revision (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`), then by the application:
 *   GET  /revision/sessions/:id               revision.session.read      SCHOOL_MANAGER | the session's TEACHER: scheduled assignments, assignments defined in it, records
 *   POST /revision/sessions/:id/assignments   revision.assignment.manage the session's TEACHER, while the session is IN_PROGRESS: define the NEXT session's assignment
 *   PUT  /revision/assignments/:id            revision.assignment.manage the session's TEACHER, only while the defining session is IN_PROGRESS
 *   POST /revision/assignments/:id/cancel     revision.assignment.manage the session's TEACHER, only while the defining session is IN_PROGRESS (kept, never deleted)
 *   POST /revision/sessions/:id/records       revision.record.record     the session's TEACHER, through Smart Guard (one GPS reading, atomic batch)
 *   PUT  /revision/records/:id                revision.record.correct    the session's TEACHER, through Smart Guard, only during that session
 *   GET  /revision/ayahs                             quran.structure.read           ANY authenticated role: the approved Quran ayahs (Module 21, paginated) for the revision selection UI; the same dataset in Memorization and Revision
 *   GET  /revision/students/:id/records       revision.student.read      SCHOOL_MANAGER of the school | the student's own PARENT
 * There is deliberately NO endpoint that deletes anything, lets a School Manager record or correct, or reads the histories yet (Module 35). The caller always comes from the
 * verified token; the group of a session, assignment or record is loaded on the server.
 */
export function createRevisionRouter(deps: RevisionRouterDeps): Router {
  const router = Router();
  const h = createRevisionHandlers(deps.getService, deps.getQuran);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onStudent = { target: (req: Request) => ({ type: STUDENT_TARGET_TYPE, id: req.params.id as string }) };
  const onSessionGroup = { target: async (req: Request) => ({ type: GROUP_TARGET_TYPE, id: await h.groupIdOfSession(req.params.id as string) }) };
  const onAssignmentGroup = { target: async (req: Request) => ({ type: GROUP_TARGET_TYPE, id: await h.groupIdOfAssignment(req.params.id as string) }) };
  const onRecordGroup = { target: async (req: Request) => ({ type: GROUP_TARGET_TYPE, id: await h.groupIdOfRecord(req.params.id as string) }) };
  const id = param('id').isUUID().withMessage('INVALID_VALUE');
  /** The range has two forms (see `RevisionRangeResolver`); the route only requires an object, the resolver and Module 22 validate its parts and values. */
  const range: ValidationChain[] = [body('range').exists({ values: 'null' }).withMessage('REQUIRED_FIELD').bail().isObject().withMessage('INVALID_VALUE')];
  const studentId: ValidationChain = body('studentId').optional({ values: 'null' }).isUUID().withMessage('INVALID_VALUE');
  const records: ValidationChain = body('records').isArray({ min: 1 }).withMessage('INVALID_VALUE');
  const reason: ValidationChain = body('reason').optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max: 500 }).withMessage('INVALID_VALUE');

  // The Quran ayahs for the revision selection UI: any authenticated role with the EXISTING `quran.structure.read` permission (no new permission, no scope); data from Module 21.
  router.get('/ayahs', auth, guard(QuranPermissions.READ), handle(async (req, res) => sendPaginated(res, await h.listAyahs(ayahsRequest(req)))));
  router.get('/students/:id/records', auth, validate(id), guard(RevisionPermissions.READ_STUDENT, onStudent), handle(async (req, res) => sendPaginated(res, await h.listStudent(req.params.id as string, listRequest(req)))));
  router.get('/sessions/:id', auth, validate(id), guard(RevisionPermissions.READ_SESSION, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.getSession(req.params.id as string, callerUserId(req)))));
  router.post('/sessions/:id/assignments', auth, validate(id, ...range, studentId), guard(RevisionPermissions.MANAGE_ASSIGNMENT, onSessionGroup), handle(async (req, res) => sendCreated(res, await h.defineAssignment(req.params.id as string, callerUserId(req), req.body))));
  router.put('/assignments/:id', auth, validate(id, ...range), guard(RevisionPermissions.MANAGE_ASSIGNMENT, onAssignmentGroup), handle(async (req, res) => sendSuccess(res, await h.modifyAssignment(req.params.id as string, callerUserId(req), req.body))));
  router.post('/assignments/:id/cancel', auth, validate(id), guard(RevisionPermissions.MANAGE_ASSIGNMENT, onAssignmentGroup), handle(async (req, res) => sendSuccess(res, await h.cancelAssignment(req.params.id as string, callerUserId(req)))));
  router.post('/sessions/:id/records', auth, validate(id, records), guard(RevisionPermissions.RECORD, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.recordRevision(req.params.id as string, callerUserId(req), req.body))));
  router.put('/records/:id', auth, validate(id, ...range, reason), guard(RevisionPermissions.CORRECT, onRecordGroup), handle(async (req, res) => sendSuccess(res, await h.correctRecord(req.params.id as string, callerUserId(req), req.body))));
  return router;
}
