import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body, param, type ValidationChain } from 'express-validator';
import { parseListQuery, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { STUDENT_TARGET_TYPE } from '../../../19-students/public';
import { GROUP_TARGET_TYPE } from '../../../20-groups/public';
import { AttendancePermissions } from '../../application/services/attendance-authorization';
import { ATTENDANCE_STATUSES, MAX_REASON_LENGTH } from '../../domain/value-objects/attendance-status';
import { createAttendanceHandlers, type AttendanceHandlerService, type AttendanceListRequest } from './attendance-handlers';
import { callerUserId } from './attendance-required';

export interface AttendanceRouterDeps {
  readonly getService: () => AttendanceHandlerService;
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

/** A student's attendance is listed by the session's start, newest first by default (`sort=scheduledStart`, `-` for descending). */
export const ATTENDANCE_LIST_SPEC: ListQuerySpec = {
  sortable: { scheduledStart: 'scheduledStart' },
  defaultSort: [{ key: 'scheduledStart', direction: 'desc' }],
  filters: {},
};

function listRequest(req: Request): AttendanceListRequest {
  const query = parseListQuery(req.query as Record<string, unknown>, ATTENDANCE_LIST_SPEC);
  return { direction: query.sort[0]?.direction ?? 'desc', page: query.page };
}

/**
 * Attendance, mounted under /attendance (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`), then by the application:
 *   GET  /attendance/students/:id                 attendance.student.read    SCHOOL_MANAGER of the school | the student's own PARENT: a student's attendance
 *   GET  /attendance/sessions/:id                 attendance.session.read    SCHOOL_MANAGER | the session's TEACHER: the session's attendance
 *   POST /attendance/sessions/:id/students        attendance.student.record  the session's TEACHER, through Smart Guard (one GPS reading, atomic batch)
 *   POST /attendance/sessions/:id/teacher/check-in attendance.teacher.check-in the session's TEACHER records themself PRESENT, through Smart Guard
 *   PUT  /attendance/sessions/:id/teacher         attendance.record.correct  SCHOOL_MANAGER records or corrects the Teacher's attendance (no GPS)
 *   PUT  /attendance/sessions/:id/students/:studentId attendance.record.correct SCHOOL_MANAGER records or corrects one student's attendance (no GPS)
 * There is deliberately NO endpoint that deletes attendance, marks a STUDENT automatically, or reads the correction history yet (Module 35). The caller always
 * comes from the verified token; the group of a session is loaded on the server.
 */
export function createAttendanceRouter(deps: AttendanceRouterDeps): Router {
  const router = Router();
  const h = createAttendanceHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const onStudent = { target: (req: Request) => ({ type: STUDENT_TARGET_TYPE, id: req.params.id as string }) };
  const onSessionGroup = { target: async (req: Request) => ({ type: GROUP_TARGET_TYPE, id: await h.groupIdOfSession(req.params.id as string) }) };
  const id = param('id').isUUID().withMessage('INVALID_VALUE');
  const studentId = param('studentId').isUUID().withMessage('INVALID_VALUE');
  const reason: ValidationChain = body('reason').optional({ values: 'null' }).isString().withMessage('INVALID_VALUE').bail().isLength({ max: MAX_REASON_LENGTH }).withMessage('INVALID_VALUE');
  const status: ValidationChain = body('status').exists({ values: 'null' }).withMessage('REQUIRED_FIELD').bail().isIn([...ATTENDANCE_STATUSES]).withMessage('INVALID_VALUE');
  const records: ValidationChain = body('records').isArray({ min: 1 }).withMessage('INVALID_VALUE');

  router.get('/students/:id', auth, validate(id), guard(AttendancePermissions.READ_STUDENT, onStudent), handle(async (req, res) => sendPaginated(res, await h.listStudent(req.params.id as string, listRequest(req)))));
  router.get('/sessions/:id', auth, validate(id), guard(AttendancePermissions.READ_SESSION, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.getSession(req.params.id as string, callerUserId(req)))));
  router.post('/sessions/:id/students', auth, validate(id, records, reason), guard(AttendancePermissions.RECORD_STUDENTS, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.recordStudents(req.params.id as string, callerUserId(req), req.body))));
  router.post('/sessions/:id/teacher/check-in', auth, validate(id, reason), guard(AttendancePermissions.CHECK_IN_TEACHER, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.checkInTeacher(req.params.id as string, callerUserId(req), req.body))));
  router.put('/sessions/:id/teacher', auth, validate(id, status, reason), guard(AttendancePermissions.CORRECT, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.setTeacherByManager(req.params.id as string, callerUserId(req), req.body))));
  router.put('/sessions/:id/students/:studentId', auth, validate(id, studentId, status, reason), guard(AttendancePermissions.CORRECT, onSessionGroup), handle(async (req, res) => sendSuccess(res, await h.setStudentByManager(req.params.id as string, req.params.studentId as string, callerUserId(req), req.body))));
  return router;
}
