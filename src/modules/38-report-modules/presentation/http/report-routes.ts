import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { query } from 'express-validator';
import { sendSuccess, validate } from '../../../04-validation-api/public';
import type { AttendanceReportRequest } from '../../application/dto/attendance-report';
import type { PaymentReportRequest } from '../../application/dto/payment-report';
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

function sendFile(res: Response, file: { fileName: string; contentType: string; data: Buffer }): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(file.data);
}

/**
 * /reports (Module 38, slice 1: the PAYMENT and ATTENDANCE reports). Endpoints (all under /api/v1), every one a read:
 *   GET /reports/payment        the report as JSON
 *   GET /reports/payment/csv    the same report as a CSV file
 *   GET /reports/payment/xlsx   the same report as an Excel file
 *   GET /reports/attendance, /attendance/csv, /attendance/xlsx   the ATTENDANCE report, the same way (also `groupId`, `studentId`)
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

  return router;
}
