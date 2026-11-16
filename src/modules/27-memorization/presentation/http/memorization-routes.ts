import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendCreated, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { STUDENT_TARGET_TYPE } from '../../../19-students/public';
import { GROUP_TARGET_TYPE } from '../../../20-groups/public';
import { QuranPermissions, type QuranStructureLookup } from '../../../21-quran-structure/public';
import { MemorizationPermissions } from '../../application/services/memorization-authorization';
import { createMemorizationHandlers, type MemorizationHandlerService, type StudentRecordsRequest } from './memorization-handlers';
import { callerUserId } from './memorization-required';

export interface MemorizationRouterDeps {
  /** Module 21's read-only public contract: the ONE source of Quran data (this module keeps no Quran data and no Quran query). */
  readonly getQuran: () => Pick<QuranStructureLookup, 'listAyahs'>;
  readonly getService: () => MemorizationHandlerService;
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
export const MEMORIZATION_LIST_SPEC: ListQuerySpec = {
  sortable: { scheduledStart: 'scheduledStart' },
  defaultSort: [{ key: 'scheduledStart', direction: 'desc' }],
  filters: {},
};

/** The Quran ayahs are listed in the canonical Quran order (`sort=globalPosition`, `-` for descending); the same contract in Memorization and Revision. */
export const MEMORIZATION_AYAHS_SPEC: ListQuerySpec = {
  sortable: { globalPosition: 'globalPosition' },
  defaultSort: [{ key: 'globalPosition', direction: 'asc' }],
  filters: {},
};

function ayahsRequest(req: Request): StudentRecordsRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, MEMORIZATION_AYAHS_SPEC);
  return { direction: query.sort[0]?.direction ?? 'asc', page: query.page };
}

function listRequest(req: Request): StudentRecordsRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, MEMORIZATION_LIST_SPEC);
  return { direction: query.sort[0]?.direction ?? 'desc', page: query.page };
}

/**
 * Memorization, mounted under /memorization (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`), then by the application:
 *   GET  /memorization/sessions/:id               memorization.session.read      SCHOOL_MANAGER | the session's TEACHER: scheduled assignments, assignments defined in it, records
 *   POST /memorization/sessions/:id/assignments   memorization.assignment.manage the session's TEACHER, while the session is IN_PROGRESS: define the NEXT session's assignment
 *   PUT  /memorization/assignments/:id            memorization.assignment.manage the session's TEACHER, only while the defining session is IN_PROGRESS
 *   POST /memorization/assignments/:id/cancel     memorization.assignment.manage the session's TEACHER, only while the defining session is IN_PROGRESS (kept, never deleted)
 *   POST /memorization/sessions/:id/records       memorization.record.record     the session's TEACHER, through Smart Guard (one GPS reading, atomic batch)
 *   PUT  /memorization/records/:id                memorization.record.correct    the session's TEACHER, through Smart Guard, only during that session
 *   GET  /memorization/ayahs                             quran.structure.read           ANY authenticated role: the approved Quran ayahs (Module 21, paginated) for the memorization selection UI; the same dataset in Memorization and Revision
 *   GET  /memorization/students/:id/records       memorization.student.read      SCHOOL_MANAGER of the school | the student's own PARENT
 * There is deliberately NO endpoint that deletes anything, lets a School Manager record or correct, or reads the histories yet (Module 35). The caller always comes from the
 * verified token; the group of a session, assignment or record is loaded on the server.
 */
export function createMemorizationRouter(deps: MemorizationRouterDeps): Router {
  const router = Router();
  const h = createMemorizationHandlers(deps.getService, deps.getQuran);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onStudent = { target: (req: Request) => ({ type: STUDENT_TARGET_TYPE, id: req.params.id as string }) };
  const onSessionGroup = { target: async (req: Request) => ({ type: GROUP_TARGET_TYPE, id: await h.groupIdOfSession(req.params.id as string) }) };
  const onAssignmentGroup = { target: async (req: Request) => ({ type: GROUP_TARGET_TYPE, id: await h.groupIdOfAssignment(req.params.id as string) }) };
  const onRecordGroup = { target: async (req: Request) => ({ type: GROUP_TARGET_TYPE, id: await h.groupIdOfRecord(req.params.id as string) }) };
  const id = param('id').isUUID().withMessage('INVALID_VALUE');
  const required = (field: string): ValidationChain => body(field).exists({ values: 'null' }).withMessage('REQUIRED_FIELD');
  /** The documented required parts of a range; their VALUES (unit, direction, amount, ayah) are validated and calculated by Module 22. */
  const range: ValidationChain[] = [
    required('range').bail().isObject().withMessage('INVALID_VALUE'),
    required('range.start').bail().isObject().withMessage('INVALID_VALUE'),
    required('range.start.surah'),
    required('range.unit'),
    required('range.amount'),
    required('range.direction'),
  ];
  const studentId: ValidationChain = body('studentId').optional({ values: 'null' }).isUUID().withMessage('INVALID_VALUE');
  const records: ValidationChain = body('records').isArray({ min: 1 }).withMessage('INVALID_VALUE');
  const reason: ValidationChain = body('reason').optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max: 500 }).withMessage('INVALID_VALUE');

  // The Quran ayahs for the memorization selection UI: any authenticated role with the EXISTING `quran.structure.read` permission (no new permission, no scope); data from Module 21.
  router.get('/ayahs', auth, guard(QuranPermissions.READ), handle(async (req, res) => sendPaginated(res, await h.listAyahs(ayahsRequest(req)))));
  router.get('/students/:id/records', auth, validate(id), guard(MemorizationPermissions.READ_STUDENT, onStudent), handle(async (req, res) => sendPaginated(res, await h.listStudent(req.params.id as string, listRequest(req)))));
  router.get('/sessions/:id', auth, validate(id), guard(MemorizationPermissions.READ_SESSION, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.getSession(req.params.id as string, callerUserId(req)))));
  router.post('/sessions/:id/assignments', auth, validate(id, ...range, studentId), guard(MemorizationPermissions.MANAGE_ASSIGNMENT, onSessionGroup), handle(async (req, res) => sendCreated(res, await h.defineAssignment(req.params.id as string, callerUserId(req), req.body))));
  router.put('/assignments/:id', auth, validate(id, ...range), guard(MemorizationPermissions.MANAGE_ASSIGNMENT, onAssignmentGroup), handle(async (req, res) => sendSuccess(res, await h.modifyAssignment(req.params.id as string, callerUserId(req), req.body))));
  router.post('/assignments/:id/cancel', auth, validate(id), guard(MemorizationPermissions.MANAGE_ASSIGNMENT, onAssignmentGroup), handle(async (req, res) => sendSuccess(res, await h.cancelAssignment(req.params.id as string, callerUserId(req)))));
  router.post('/sessions/:id/records', auth, validate(id, records), guard(MemorizationPermissions.RECORD, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.recordMemorization(req.params.id as string, callerUserId(req), req.body))));
  router.put('/records/:id', auth, validate(id, ...range, reason), guard(MemorizationPermissions.CORRECT, onRecordGroup), handle(async (req, res) => sendSuccess(res, await h.correctRecord(req.params.id as string, callerUserId(req), req.body))));
  return router;
}
