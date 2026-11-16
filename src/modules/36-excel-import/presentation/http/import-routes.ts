import multer from 'multer';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { param, query } from 'express-validator';
import { AppError } from '../../../00-shared-kernel/public';
import { MAX_EXCEL_FILE_BYTES } from '../../../07-file-infrastructure/public';
import { sendCreated, sendSuccess, validate } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { SCHOOL_TARGET_TYPE, type SchoolLookup } from '../../../16-schools/public';
import { IMPORT_PREVIEW_TARGET_TYPE, ImportPermissions } from '../../application/services/import-authorization';
import { ImportErrorCodes, importError } from '../../domain/errors/import-errors';
import { createImportHandlers, languageOf, type ImportHandlerService } from './import-handlers';
import { sessionAuthRequired } from './session-required';

export interface ImportRouterDeps {
  readonly getService: () => ImportHandlerService;
  /** Server-side school lookup: the importing school is derived from the caller's own manager links. */
  readonly getSchools: () => Pick<SchoolLookup, 'listManagedSchoolIds'>;
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

/** A school id that matches no school: the Authorization Engine denies it (a caller who manages no school gets the normal 403). */
const NO_SCHOOL = '00000000-0000-0000-0000-000000000000';
type ImportRequest = Request & { importSchoolId?: string };
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** One memory-stored file of at most 10 MB (Module 07's limit); no other file and no other field is accepted. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_EXCEL_FILE_BYTES, files: 1, fields: 0, parts: 2 } }).single('file');
const receiveFile: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return next(new AppError('FILE_TOO_LARGE', 'PAYLOAD_TOO_LARGE', undefined, { maxMb: MAX_EXCEL_FILE_BYTES / (1024 * 1024) }));
    if (error instanceof multer.MulterError) return next(importError(ImportErrorCodes.EXCEL_IMPORT_FILE_REQUIRED));
    return next(error);
  });
};

/**
 * /excel-imports. Endpoints (all under /api/v1). Authorization is enforced by the Authorization Engine (`requirePermission`):
 *   GET  /excel-imports/template?language=ar|en       excel-import.template.download   SCHOOL_MANAGER   the Arabic or English .xlsx template
 *   POST /excel-imports/previews[?schoolId=]          excel-import.preview.create      SCHOOL_MANAGER of the school   upload a file (multipart `file`), get the preview
 *   GET  /excel-imports/previews/:id                  excel-import.preview.read        the preview's creator (still the school's manager)
 *   POST /excel-imports/previews/:id/confirm          excel-import.preview.confirm     same     all-or-nothing import
 *   POST /excel-imports/previews/:id/cancel           excel-import.preview.cancel      same
 * The target school is NEVER read from the file. It is the one school the caller manages; a caller who manages several selects ONE of them with
 * `?schoolId=` and the Authorization Engine still verifies they are its active manager (a school they do not manage is a 403).
 */
export function createExcelImportRouter(deps: ImportRouterDeps): Router {
  const router = Router();
  const h = createImportHandlers(deps.getService);
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const previewId = param('id').isUUID().withMessage('INVALID_VALUE');
  const onPreview = { target: (req: Request) => ({ type: IMPORT_PREVIEW_TARGET_TYPE, id: req.params.id as string }) };

  /** Derives the target school from the CALLER's own manager links (server data); `?schoolId=` only selects among schools the engine then verifies. */
  const resolveSchool: RequestHandler = (req, _res, next) => {
    void (async () => {
      const userId = sessionAuthRequired(req);
      const requested = req.query.schoolId;
      if (typeof requested === 'string') (req as ImportRequest).importSchoolId = requested;
      else {
        const managed = await deps.getSchools().listManagedSchoolIds(userId);
        if (managed.length > 1) throw importError(ImportErrorCodes.EXCEL_IMPORT_SCHOOL_SELECTION_REQUIRED);
        (req as ImportRequest).importSchoolId = managed[0] ?? NO_SCHOOL;
      }
    })().then(() => next(), next);
  };

  router.get(
    '/template',
    auth,
    validate(query('language').optional().isIn(['ar', 'en']).withMessage('INVALID_VALUE')),
    guard(ImportPermissions.DOWNLOAD_TEMPLATE),
    handle(async (req, res) => {
      const language = typeof req.query.language === 'string' ? (req.query.language as 'ar' | 'en') : languageOf(req);
      const file = await h.template(language);
      res.setHeader('Content-Type', XLSX_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="${language === 'ar' ? 'students-import-template-ar.xlsx' : 'students-import-template-en.xlsx'}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(file.data);
    }),
  );

  router.post(
    '/previews',
    auth,
    validate(query('schoolId').optional().isUUID().withMessage('INVALID_VALUE')),
    resolveSchool,
    guard(ImportPermissions.CREATE_PREVIEW, { target: (req: Request) => ({ type: SCHOOL_TARGET_TYPE, id: (req as ImportRequest).importSchoolId ?? NO_SCHOOL }) }),
    receiveFile,
    handle(async (req, res) => {
      const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
      if (!file) throw importError(ImportErrorCodes.EXCEL_IMPORT_FILE_REQUIRED);
      sendCreated(res, await h.createPreview(sessionAuthRequired(req), (req as ImportRequest).importSchoolId ?? NO_SCHOOL, file, languageOf(req)));
    }),
  );

  router.get(
    '/previews/:id',
    auth,
    validate(previewId, query('page').optional().isInt({ min: 1 }).withMessage('INVALID_VALUE'), query('pageSize').optional().isInt({ min: 1, max: 500 }).withMessage('INVALID_VALUE')),
    guard(ImportPermissions.READ_PREVIEW, onPreview),
    handle(async (req, res) => {
      const page = req.query.page === undefined ? undefined : Number(req.query.page);
      const pageSize = req.query.pageSize === undefined ? undefined : Number(req.query.pageSize);
      sendSuccess(res, await h.getPreview(sessionAuthRequired(req), req.params.id as string, page, pageSize));
    }),
  );

  router.post(
    '/previews/:id/confirm',
    auth,
    validate(previewId),
    guard(ImportPermissions.CONFIRM, onPreview),
    handle(async (req, res) => sendSuccess(res, await h.confirm(sessionAuthRequired(req), req.params.id as string, languageOf(req)))),
  );

  router.post(
    '/previews/:id/cancel',
    auth,
    validate(previewId),
    guard(ImportPermissions.CANCEL, onPreview),
    handle(async (req, res) => sendSuccess(res, await h.cancel(sessionAuthRequired(req), req.params.id as string))),
  );

  return router;
}
