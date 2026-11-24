import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { query } from 'express-validator';
import { normalizePageRequest } from '../../../00-shared-kernel/public';
import { sendSuccess, validate } from '../../../04-validation-api/public';
import type { AttendanceReportRequest } from '../../application/dto/attendance-report';
import type { MemorizationReportRequest } from '../../application/dto/memorization-report';
import type { EvaluationReportRequest } from '../../application/dto/evaluation-report';
import type { RevisionReportRequest } from '../../application/dto/revision-report';
import type { PaymentReportRequest } from '../../application/dto/payment-report';
import type { GroupReportRequest } from '../../application/dto/group-report';
import type { ParentReportRequest } from '../../application/dto/parent-report';
import type { TeacherReportRequest } from '../../application/dto/teacher-report';
import type { StudentReportRequest } from '../../application/dto/student-report';
import type { ReportLanguage } from '../../application/services/report-tables';
import { createReportHandlers, type ReportFileFormat, type ReportHandlerService } from './report-handlers';
import { reportRequesterOf } from './session-required';

export interface ReportRouterDeps {
  readonly getReports: () => ReportHandlerService;
  /** Authenticates the access token (Module 10 `requireAuthentication`). Blocks accounts that still must change their initial password. */
  readonly requireAuthentication: RequestHandler;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/** The language of the caller: the resolved request locale (account preference, then Accept-Language, then the system default). */
const languageOf = (req: Request): ReportLanguage => ((req as Request & { locale?: string }).locale === 'en' ? 'en' : 'ar');

const period = query('period').exists({ values: 'falsy' }).withMessage('REQUIRED_FIELD').bail().isString().withMessage('INVALID_VALUE');
const startDate = query('startDate').optional().isString().withMessage('INVALID_VALUE');
const endDate = query('endDate').optional().isString().withMessage('INVALID_VALUE');
const schoolId = query('schoolId').optional().isUUID().withMessage('INVALID_VALUE');
const groupId = query('groupId').optional().isUUID().withMessage('INVALID_VALUE');
const studentId = query('studentId').optional().isUUID().withMessage('INVALID_VALUE');
/** The STUDENT report is about ONE student: the id is required. */
/** The PARENT report: a Parent may omit it (their own account); a manager must send it (the report answers 400 REQUIRED_FIELD otherwise). */
const parentId = query('parentId').optional().isUUID().withMessage('INVALID_VALUE');
/** The GROUP report is about ONE group: the id is required. */
const requiredGroupId = query('groupId').exists({ values: 'falsy' }).withMessage('REQUIRED_FIELD').bail().isUUID().withMessage('INVALID_VALUE');
/** The TEACHER report is about ONE teacher: the id is required. */
const requiredTeacherId = query('teacherId').exists({ values: 'falsy' }).withMessage('REQUIRED_FIELD').bail().isUUID().withMessage('INVALID_VALUE');
const requiredStudentId = query('studentId').exists({ values: 'falsy' }).withMessage('REQUIRED_FIELD').bail().isUUID().withMessage('INVALID_VALUE');
/** Standard list pagination (Master Specification: default 20, maximum 100). Same rule and codes as `parseListQuery`: a positive integer, otherwise INVALID_PAGE / INVALID_PAGE_SIZE; a size above 100 is capped, not rejected. */
const positiveInteger = (value: unknown): boolean => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const page = query('page').optional().custom(positiveInteger).withMessage('INVALID_PAGE');
const pageSize = query('pageSize').optional().custom(positiveInteger).withMessage('INVALID_PAGE_SIZE');

/** The period kind and dates are validated by Module 37 (INVALID_REPORT_PERIOD and friends); here they are only checked to be single strings. */
const paymentRequestOf = (req: Request): PaymentReportRequest => ({
  period: { kind: req.query.period as string, startDate: req.query.startDate as string | undefined, endDate: req.query.endDate as string | undefined },
  schoolId: req.query.schoolId as string | undefined,
});

const attendanceRequestOf = (req: Request): AttendanceReportRequest => ({
  ...paymentRequestOf(req),
  groupId: req.query.groupId as string | undefined,
  studentId: req.query.studentId as string | undefined,
});

const studentRequestOf = (req: Request): StudentReportRequest => ({
  period: { kind: req.query.period as string, startDate: req.query.startDate as string | undefined, endDate: req.query.endDate as string | undefined },
  studentId: req.query.studentId as string,
});

const groupRequestOf = (req: Request): GroupReportRequest => ({
  period: { kind: req.query.period as string, startDate: req.query.startDate as string | undefined, endDate: req.query.endDate as string | undefined },
  groupId: req.query.groupId as string,
});

const teacherRequestOf = (req: Request): TeacherReportRequest => ({
  period: { kind: req.query.period as string, startDate: req.query.startDate as string | undefined, endDate: req.query.endDate as string | undefined },
  teacherId: req.query.teacherId as string,
});

const parentRequestOf = (req: Request): ParentReportRequest => ({
  period: { kind: req.query.period as string, startDate: req.query.startDate as string | undefined, endDate: req.query.endDate as string | undefined },
  parentId: req.query.parentId as string | undefined,
});

const memorizationRequestOf = (req: Request): MemorizationReportRequest => attendanceRequestOf(req);
const revisionRequestOf = (req: Request): RevisionReportRequest => attendanceRequestOf(req);
const evaluationRequestOf = (req: Request): EvaluationReportRequest => attendanceRequestOf(req);

function sendFile(res: Response, file: { fileName: string; contentType: string; data: Buffer }): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(file.data);
}

/**
 * /reports (Module 38, slices 1-8: the PAYMENT, ATTENDANCE, MEMORIZATION, REVISION, EVALUATION, STUDENT, PARENT, GROUP and TEACHER reports). Endpoints (all under /api/v1), every one a read:
 *   GET /reports/payment        the report as JSON
 *   GET /reports/payment/csv    the same report as a CSV file
 *   GET /reports/payment/xlsx   the same report as an Excel file
 *   GET /reports/attendance, /attendance/csv, /attendance/xlsx   the ATTENDANCE report, the same way (also `groupId`, `studentId`)
 *   GET /reports/student, /student/csv, /student/xlsx   the STUDENT report of ONE student (`studentId` required): seven data-only sections; the JSON paginates only the exam list (`page`, `pageSize`), the files are complete (XLSX one worksheet per section, CSV one table with a `section` column)
 *   GET /reports/teacher, /teacher/csv, /teacher/xlsx   the TEACHER report of ONE teacher (`teacherId` required), limited to the requester's authorized schools: the groups the teacher taught (from the group history) with their own attendance and the group figures for exactly those dates; the JSON paginates the taught groups (`page`, `pageSize`), the files hold every one
 *   GET /reports/group, /group/csv, /group/xlsx   the GROUP report of ONE group (`groupId` required): the roster of every student assigned at any time in the period with counts, totals over the whole roster and (managers) the Teacher's attendance; the JSON paginates the STUDENTS (`page`, `pageSize`), the files hold every student
 *   GET /reports/parent, /parent/csv, /parent/xlsx   the PARENT report: one Parent and all their children, each with a full STUDENT report (a manager sends `parentId`; a Parent may omit it); the JSON paginates the CHILDREN (`page`, `pageSize`), the files hold every child
 *   GET /reports/evaluation, /evaluation/csv, /evaluation/xlsx   the EVALUATION report, like the MEMORIZATION report (paginated JSON, complete files)
 *   GET /reports/revision, /revision/csv, /revision/xlsx   the REVISION report, exactly like the MEMORIZATION report (paginated JSON, complete files)
 *   GET /reports/memorization, /memorization/csv, /memorization/xlsx   the MEMORIZATION report, the same way (`schoolId`, `groupId`, `studentId`); the JSON is ONE PAGE of rows (`page`, `pageSize`: default 20, maximum 100, `meta` = page, pageSize, total, totalPages; `totals` cover all rows), the files are complete
 * Query: `period` (THIS_MONTH | LAST_MONTH | ACROSS_TIME | CUSTOM, required), `startDate` / `endDate` (CUSTOM only), `schoolId` (optional narrowing).
 * Authorization is Module 37's reporting scope, computed from the verified session (user + ACTIVE role) on every request; it is NOT a Module 12 permission:
 * Organization Manager, School Manager and Subscription Collector may run it, only over their own scope. Every other role, including MAIN_ADMIN, is refused with 403 REPORT_NOT_ALLOWED.
 */
export function createReportRouter(deps: ReportRouterDeps): Router {
  const router = Router();
  const h = createReportHandlers(deps.getReports);
  const auth = deps.requireAuthentication;
  const inputs = [period, startDate, endDate, schoolId];

  router.get(
    '/payment',
    auth,
    validate(...inputs),
    handle(async (req, res) => sendSuccess(res, await h.payment(reportRequesterOf(req), paymentRequestOf(req)))),
  );

  for (const format of ['csv', 'xlsx'] as const satisfies readonly ReportFileFormat[]) {
    router.get(
      `/payment/${format}`,
      auth,
      validate(...inputs),
      handle(async (req, res) => sendFile(res, await h.paymentFile(reportRequesterOf(req), paymentRequestOf(req), format, languageOf(req)))),
    );
  }

  const attendanceInputs = [period, startDate, endDate, schoolId, groupId, studentId];
  router.get(
    '/attendance',
    auth,
    validate(...attendanceInputs),
    handle(async (req, res) => sendSuccess(res, await h.attendance(reportRequesterOf(req), attendanceRequestOf(req)))),
  );

  for (const format of ['csv', 'xlsx'] as const satisfies readonly ReportFileFormat[]) {
    router.get(
      `/attendance/${format}`,
      auth,
      validate(...attendanceInputs),
      handle(async (req, res) => sendFile(res, await h.attendanceFile(reportRequesterOf(req), attendanceRequestOf(req), format, languageOf(req)))),
    );
  }

  router.get(
    '/memorization',
    auth,
    validate(...attendanceInputs, page, pageSize),
    handle(async (req, res) => {
      const { report, meta } = await h.memorization(reportRequesterOf(req), memorizationRequestOf(req), normalizePageRequest({ page: req.query.page, pageSize: req.query.pageSize }));
      sendSuccess(res, report, { meta });
    }),
  );

  for (const format of ['csv', 'xlsx'] as const satisfies readonly ReportFileFormat[]) {
    router.get(
      `/memorization/${format}`,
      auth,
      validate(...attendanceInputs),
      handle(async (req, res) => sendFile(res, await h.memorizationFile(reportRequesterOf(req), memorizationRequestOf(req), format, languageOf(req)))),
    );
  }

  router.get(
    '/revision',
    auth,
    validate(...attendanceInputs, page, pageSize),
    handle(async (req, res) => {
      const { report, meta } = await h.revision(reportRequesterOf(req), revisionRequestOf(req), normalizePageRequest({ page: req.query.page, pageSize: req.query.pageSize }));
      sendSuccess(res, report, { meta });
    }),
  );

  for (const format of ['csv', 'xlsx'] as const satisfies readonly ReportFileFormat[]) {
    router.get(
      `/revision/${format}`,
      auth,
      validate(...attendanceInputs),
      handle(async (req, res) => sendFile(res, await h.revisionFile(reportRequesterOf(req), revisionRequestOf(req), format, languageOf(req)))),
    );
  }

  router.get(
    '/evaluation',
    auth,
    validate(...attendanceInputs, page, pageSize),
    handle(async (req, res) => {
      const { report, meta } = await h.evaluation(reportRequesterOf(req), evaluationRequestOf(req), normalizePageRequest({ page: req.query.page, pageSize: req.query.pageSize }));
      sendSuccess(res, report, { meta });
    }),
  );

  for (const format of ['csv', 'xlsx'] as const satisfies readonly ReportFileFormat[]) {
    router.get(
      `/evaluation/${format}`,
      auth,
      validate(...attendanceInputs),
      handle(async (req, res) => sendFile(res, await h.evaluationFile(reportRequesterOf(req), evaluationRequestOf(req), format, languageOf(req)))),
    );
  }

  const studentInputs = [period, startDate, endDate, requiredStudentId];
  router.get(
    '/student',
    auth,
    validate(...studentInputs, page, pageSize),
    handle(async (req, res) => {
      const { report, meta } = await h.student(reportRequesterOf(req), studentRequestOf(req), normalizePageRequest({ page: req.query.page, pageSize: req.query.pageSize }));
      sendSuccess(res, report, { meta });
    }),
  );

  for (const format of ['csv', 'xlsx'] as const satisfies readonly ReportFileFormat[]) {
    router.get(
      `/student/${format}`,
      auth,
      validate(...studentInputs),
      handle(async (req, res) => sendFile(res, await h.studentFile(reportRequesterOf(req), studentRequestOf(req), format, languageOf(req)))),
    );
  }

  const parentInputs = [period, startDate, endDate, parentId];
  router.get(
    '/parent',
    auth,
    validate(...parentInputs, page, pageSize),
    handle(async (req, res) => {
      const { report, meta } = await h.parent(reportRequesterOf(req), parentRequestOf(req), normalizePageRequest({ page: req.query.page, pageSize: req.query.pageSize }));
      sendSuccess(res, report, { meta });
    }),
  );

  for (const format of ['csv', 'xlsx'] as const satisfies readonly ReportFileFormat[]) {
    router.get(
      `/parent/${format}`,
      auth,
      validate(...parentInputs),
      handle(async (req, res) => sendFile(res, await h.parentFile(reportRequesterOf(req), parentRequestOf(req), format, languageOf(req)))),
    );
  }

  const groupInputs = [period, startDate, endDate, requiredGroupId];
  router.get(
    '/group',
    auth,
    validate(...groupInputs, page, pageSize),
    handle(async (req, res) => {
      const { report, meta } = await h.group(reportRequesterOf(req), groupRequestOf(req), normalizePageRequest({ page: req.query.page, pageSize: req.query.pageSize }));
      sendSuccess(res, report, { meta });
    }),
  );

  for (const format of ['csv', 'xlsx'] as const satisfies readonly ReportFileFormat[]) {
    router.get(
      `/group/${format}`,
      auth,
      validate(...groupInputs),
      handle(async (req, res) => sendFile(res, await h.groupFile(reportRequesterOf(req), groupRequestOf(req), format, languageOf(req)))),
    );
  }

  const teacherInputs = [period, startDate, endDate, requiredTeacherId];
  router.get(
    '/teacher',
    auth,
    validate(...teacherInputs, page, pageSize),
    handle(async (req, res) => {
      const { report, meta } = await h.teacher(reportRequesterOf(req), teacherRequestOf(req), normalizePageRequest({ page: req.query.page, pageSize: req.query.pageSize }));
      sendSuccess(res, report, { meta });
    }),
  );

  for (const format of ['csv', 'xlsx'] as const satisfies readonly ReportFileFormat[]) {
    router.get(
      `/teacher/${format}`,
      auth,
      validate(...teacherInputs),
      handle(async (req, res) => sendFile(res, await h.teacherFile(reportRequesterOf(req), teacherRequestOf(req), format, languageOf(req)))),
    );
  }

  return router;
}
