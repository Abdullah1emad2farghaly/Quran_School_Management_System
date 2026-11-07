import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, query } from 'express-validator';
import { parseListQuery, sendNoContent, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { SCHOOL_TARGET_TYPE } from '../../../16-schools/public';
import { STUDENT_TARGET_TYPE } from '../../../19-students/public';
import { ExamPermissions } from '../../application/services/exam-authorization';
import { EXAM_TARGET_TYPE } from '../../domain/value-objects/exam-rules';
import { createExamHandlers, type ExamHandlerService } from './exam-handlers';
import { callerUserId } from './exam-required';

export interface ExamRouterDeps {
  readonly getService: () => ExamHandlerService;
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

/** Exams are listed by their start, newest first by default (`sort=startAt`, `-` for descending). */
export const EXAM_LIST_SPEC: ListQuerySpec = { sortable: { startAt: 'startAt' }, defaultSort: [{ key: 'startAt', direction: 'desc' }], filters: {} };

/**
 * Exams, mounted under /exams (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`), then by the application. The caller always comes from
 * the verified token. There is deliberately NO endpoint that edits or deletes a result, reads a result as an examiner, or lets anyone but the School Manager change an exam.
 *   School Manager:  POST /exams, GET /exams/schools/:schoolId, PATCH /exams/:id, POST /exams/:id/{schedule|cancel|complete|end}, DELETE /exams/:id, PUT /exams/:id/end-time,
 *                    POST /exams/:id/examiners, DELETE /exams/:id/examiners/:teacherId, GET /exams/:id/results, GET /exams/students/:id
 *   Examiner:        GET /exams/assigned, GET /exams/:id, GET /exams/:id/groups, GET /exams/:id/groups/:groupId/students (pending only), POST /exams/:id/results (Smart Guard)
 *   Parent:          GET /exams/schedule, GET /exams/students/:id (own children)
 */
export function createExamRouter(deps: ExamRouterDeps): Router {
  const router = Router();
  const h = createExamHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onExam = { target: (req: Request) => ({ type: EXAM_TARGET_TYPE, id: req.params.id as string }) };
  const onSchoolParam = { target: (req: Request) => ({ type: SCHOOL_TARGET_TYPE, id: req.params.schoolId as string }) };
  const onSchoolBody = { target: (req: Request) => ({ type: SCHOOL_TARGET_TYPE, id: String((req.body as { schoolId?: unknown })?.schoolId ?? '') }) };
  const onStudent = { target: (req: Request) => ({ type: STUDENT_TARGET_TYPE, id: req.params.id as string }) };
  const uuid = (name: string) => param(name).isUUID().withMessage('INVALID_VALUE');
  const iso = (name: string) => body(name).isISO8601({ strict: true }).withMessage('INVALID_VALUE');
  const optionalIso = (name: string) => body(name).optional({ values: 'null' }).isISO8601({ strict: true }).withMessage('INVALID_VALUE');
  const configRules = [
    body('questionCount').optional().isInt({ min: 1, max: 200 }).withMessage('INVALID_VALUE').bail().toInt(),
    body('maxScore').optional().isFloat({ gt: 0, max: 1000 }).withMessage('INVALID_VALUE'),
    body('wholeSchool').optional().isBoolean({ strict: true }).withMessage('INVALID_VALUE'),
    body('groupIds').optional().isArray({ max: 200 }).withMessage('INVALID_VALUE'),
    body('groupIds.*').optional().isUUID().withMessage('INVALID_VALUE'),
  ];
  const page = (req: Request) => parseListQuery(req.query as Record<string, unknown>, EXAM_LIST_SPEC).page;
  const send = async (res: Response, data: unknown) => sendSuccess(res, data as never);

  // ---- static paths first
  router.get('/schedule', auth, guard(ExamPermissions.READ_SCHEDULE), handle(async (req, res) => sendPaginated(res, await h.listSchedule(callerUserId(req), page(req)))));
  router.get('/assigned', auth, guard(ExamPermissions.LIST_ASSIGNED), handle(async (req, res) => sendPaginated(res, await h.listAssigned(callerUserId(req), page(req)))));
  router.get('/schools/:schoolId', auth, validate(uuid('schoolId')), guard(ExamPermissions.LIST, onSchoolParam), handle(async (req, res) => sendPaginated(res, await h.listSchool(req.params.schoolId as string, h.parseStatuses(req.query.status), page(req)))));
  router.get('/students/:id', auth, validate(uuid('id')), guard(ExamPermissions.READ_STUDENT, onStudent), handle(async (req, res) => sendPaginated(res, await h.listStudent(req.params.id as string, page(req)))));
  router.post('/', auth, validate(body('schoolId').isUUID().withMessage('INVALID_VALUE'), iso('startAt'), optionalIso('endAt'), body('questionCount').isInt({ min: 1, max: 200 }).withMessage('INVALID_VALUE').bail().toInt(), body('maxScore').isFloat({ gt: 0, max: 1000 }).withMessage('INVALID_VALUE'), body('wholeSchool').optional().isBoolean({ strict: true }).withMessage('INVALID_VALUE'), body('groupIds').optional().isArray({ max: 200 }).withMessage('INVALID_VALUE'), body('groupIds.*').optional().isUUID().withMessage('INVALID_VALUE'), body('examinerTeacherIds').optional().isArray({ max: 50 }).withMessage('INVALID_VALUE'), body('examinerTeacherIds.*').optional().isUUID().withMessage('INVALID_VALUE')), guard(ExamPermissions.CREATE, onSchoolBody), handle(async (req, res) => sendSuccess(res, await h.create(callerUserId(req), req.body), { status: 201 })));

  // ---- one exam
  router.get('/:id', auth, validate(uuid('id')), guard(ExamPermissions.READ, onExam), handle(async (req, res) => send(res, await h.get(req.params.id as string))));
  router.patch('/:id', auth, validate(uuid('id'), optionalIso('startAt'), optionalIso('endAt'), ...configRules), guard(ExamPermissions.UPDATE, onExam), handle(async (req, res) => send(res, await h.update(req.params.id as string, callerUserId(req), req.body))));
  router.delete('/:id', auth, validate(uuid('id')), guard(ExamPermissions.LIFECYCLE, onExam), handle(async (req, res) => { await h.remove(req.params.id as string, callerUserId(req)); sendNoContent(res); }));
  for (const [path, action] of [['schedule', h.schedule], ['cancel', h.cancel], ['complete', h.complete], ['end', h.end]] as const) {
    router.post(`/:id/${path}`, auth, validate(uuid('id')), guard(ExamPermissions.LIFECYCLE, onExam), handle(async (req, res) => send(res, await action(req.params.id as string, callerUserId(req)))));
  }
  router.put('/:id/end-time', auth, validate(uuid('id'), iso('endAt')), guard(ExamPermissions.UPDATE, onExam), handle(async (req, res) => send(res, await h.changeEndTime(req.params.id as string, callerUserId(req), req.body))));
  router.post('/:id/examiners', auth, validate(uuid('id'), body('teacherId').isUUID().withMessage('INVALID_VALUE')), guard(ExamPermissions.MANAGE_EXAMINERS, onExam), handle(async (req, res) => sendSuccess(res, await h.assignExaminer(req.params.id as string, callerUserId(req), req.body), { status: 201 })));
  router.delete('/:id/examiners/:teacherId', auth, validate(uuid('id'), uuid('teacherId')), guard(ExamPermissions.MANAGE_EXAMINERS, onExam), handle(async (req, res) => send(res, await h.removeExaminer(req.params.id as string, callerUserId(req), req.params.teacherId as string))));
  router.get('/:id/results', auth, validate(uuid('id')), guard(ExamPermissions.READ_RESULTS, onExam), handle(async (req, res) => send(res, await h.results(req.params.id as string))));
  router.get('/:id/groups', auth, validate(uuid('id')), guard(ExamPermissions.READ, onExam), handle(async (req, res) => send(res, await h.pendingGroups(req.params.id as string))));
  router.get('/:id/groups/:groupId/students', auth, validate(uuid('id'), uuid('groupId')), guard(ExamPermissions.READ, onExam), handle(async (req, res) => sendPaginated(res, await h.pendingStudents(req.params.id as string, req.params.groupId as string, page(req)))));
  router.post('/:id/results', auth, validate(uuid('id'), body('studentId').isUUID().withMessage('INVALID_VALUE'), body('scores').isArray({ min: 1, max: 200 }).withMessage('INVALID_VALUE')), guard(ExamPermissions.RECORD_RESULT, onExam), handle(async (req, res) => sendSuccess(res, await h.submitResult(req.params.id as string, callerUserId(req), req.body), { status: 201 })));
  void query;
  return router;
}
