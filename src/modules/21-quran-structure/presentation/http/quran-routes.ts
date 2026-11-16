import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { param } from 'express-validator';
import { parseListQuery, sendPaginated, sendSuccess, validate, type ListQuerySpec } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import { QuranPermissions } from '../../application/services/quran-authorization';
import type { QuranStructureLookup } from '../../application/services/quran-structure-service';
import { quranError } from '../../domain/errors/quran-errors';
import { QURAN_AYAH_COUNT, QURAN_PAGE_COUNT, QURAN_QUARTER_COUNT, QURAN_SURAH_COUNT } from '../../domain/value-objects/quran-edition';

export interface QuranRouterDeps {
  readonly getService: () => QuranStructureLookup;
  /** Authenticates the access token (Module 10 `requireAuthentication`). */
  readonly requireAuthentication: RequestHandler;
  /** Authorization Engine route guard (Module 12). */
  readonly requirePermission: RequirePermission;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

const intParam = (name: string, max: number) => param(name).isInt({ min: 1, max, allow_leading_zeroes: false }).withMessage('INVALID_VALUE');

/** The ayahs of a surah: by ayah number (`sort=-ayah` for descending). */
export const QURAN_AYAHS_SPEC: ListQuerySpec = { sortable: { ayah: 'ayah' }, defaultSort: [{ key: 'ayah', direction: 'asc' }] };

/**
 * /quran. READ-ONLY reference data: there is no POST / PUT / PATCH / DELETE (the data is immutable through the API; it is loaded only by
 * `npm run import:quran`). Every endpoint needs authentication and the unscoped permission `quran.structure.read`, granted to all roles.
 *   GET /quran/dataset                              attribution of the imported dataset
 *   GET /quran/surahs                               the 114 surahs
 *   GET /quran/surahs/:surah                        one surah
 *   GET /quran/surahs/:surah/ayahs                  its ayahs (paginated)
 *   GET /quran/surahs/:surah/ayahs/:ayah            one ayah
 *   GET /quran/ayahs/:position                      one ayah by its global position (1..6236)
 *   GET /quran/pages/:page                          a page / face (1..604) with its lines
 *   GET /quran/juz                                  the 30 juz starts (the official KFGQPC Excel `jozz` values)
 *   GET /quran/quarters, /quran/quarters/:quarter   the 240 quarters (rub' al-hizb) of the approved quarter source, with their hizb
 *   GET /quran/quarter-marks                        the quarter marker symbols printed in the official text (evidence about the text)
 */
export function createQuranRouter(deps: QuranRouterDeps): Router {
  const router = Router();
  const svc = deps.getService;
  const auth = deps.requireAuthentication;
  const read = deps.requirePermission(QuranPermissions.READ);

  router.get('/dataset', auth, read, handle(async (_req, res) => {
    const info = await svc().getDatasetInfo();
    if (!info) throw quranError('QURAN_DATASET_NOT_IMPORTED');
    sendSuccess(res, info);
  }));

  router.get('/surahs', auth, read, handle(async (_req, res) => sendSuccess(res, await svc().listSurahs())));

  router.get('/surahs/:surah', auth, validate(intParam('surah', QURAN_SURAH_COUNT)), read, handle(async (req, res) => {
    const surah = await svc().getSurah(Number(req.params.surah));
    if (!surah) throw quranError('QURAN_SURAH_NOT_FOUND');
    sendSuccess(res, surah);
  }));

  router.get('/surahs/:surah/ayahs', auth, validate(intParam('surah', QURAN_SURAH_COUNT)), read, handle(async (req, res) => {
    const surahNumber = Number(req.params.surah);
    if (!(await svc().getSurah(surahNumber))) throw quranError('QURAN_SURAH_NOT_FOUND');
    const query = parseListQuery(req.query as Record<string, unknown>, QURAN_AYAHS_SPEC);
    const direction = query.sort[0]?.direction ?? 'asc';
    sendPaginated(res, await svc().listAyahsOfSurah(surahNumber, query.page, direction));
  }));

  router.get('/surahs/:surah/ayahs/:ayah', auth, validate(intParam('surah', QURAN_SURAH_COUNT), intParam('ayah', 286)), read, handle(async (req, res) => {
    const ayah = await svc().getAyah(Number(req.params.surah), Number(req.params.ayah));
    if (!ayah) throw quranError('QURAN_AYAH_NOT_FOUND');
    sendSuccess(res, ayah);
  }));

  router.get('/ayahs/:position', auth, validate(intParam('position', QURAN_AYAH_COUNT)), read, handle(async (req, res) => {
    const ayah = await svc().getAyahByGlobalPosition(Number(req.params.position));
    if (!ayah) throw quranError('QURAN_AYAH_NOT_FOUND');
    sendSuccess(res, ayah);
  }));

  router.get('/pages/:page', auth, validate(intParam('page', QURAN_PAGE_COUNT)), read, handle(async (req, res) => {
    const page = await svc().getPage(Number(req.params.page));
    if (!page) throw quranError('QURAN_PAGE_NOT_FOUND');
    sendSuccess(res, page);
  }));

  router.get('/juz', auth, read, handle(async (_req, res) => sendSuccess(res, await svc().listJuzs())));
  router.get('/quarters', auth, read, handle(async (_req, res) => sendSuccess(res, await svc().listQuarters())));

  router.get('/quarters/:quarter', auth, validate(intParam('quarter', QURAN_QUARTER_COUNT)), read, handle(async (req, res) => {
    const quarter = await svc().getQuarter(Number(req.params.quarter));
    if (!quarter) throw quranError('QURAN_QUARTER_NOT_FOUND');
    sendSuccess(res, quarter);
  }));

  router.get('/quarter-marks', auth, read, handle(async (_req, res) => sendSuccess(res, await svc().listQuarterMarks())));

  return router;
}
