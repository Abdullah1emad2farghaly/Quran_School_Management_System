import type { Request } from 'express';
import type { ExcelImportService } from '../../application/services/excel-import-service';
import type { ImportLanguage } from '../../domain/value-objects/import-columns';

export type ImportHandlerService = Pick<ExcelImportService, 'getTemplate' | 'createPreview' | 'getPreview' | 'confirmPreview' | 'cancelPreview'>;

/** The language of the caller: the resolved request locale (account preference, then Accept-Language, then the system default). */
export const languageOf = (req: Request): ImportLanguage => ((req as Request & { locale?: string }).locale === 'en' ? 'en' : 'ar');

/**
 * multer decodes multipart file names as latin1. When the bytes are really UTF-8 (an Arabic file name), decoding them again gives the real name;
 * a name that is not valid UTF-8 after the round trip is left as it came.
 */
export function decodeFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

/** Framework-free handlers behind the Excel Import routes. The actor and the school were already authorized by the Authorization Engine. */
export function createImportHandlers(getService: () => ImportHandlerService) {
  return {
    template: (language: ImportLanguage) => getService().getTemplate(language),
    createPreview: (actorId: string, schoolId: string, file: { buffer: Buffer; originalname: string }, language: ImportLanguage) =>
      getService().createPreview({ actorId, schoolId, fileName: decodeFileName(file.originalname), data: file.buffer, language }),
    getPreview: (actorId: string, previewId: string, page: number | undefined, pageSize: number | undefined) =>
      getService().getPreview(previewId, actorId, { ...(page !== undefined ? { page } : {}), ...(pageSize !== undefined ? { pageSize } : {}) }),
    confirm: (actorId: string, previewId: string, language: ImportLanguage) => getService().confirmPreview(previewId, actorId, language),
    cancel: (actorId: string, previewId: string) => getService().cancelPreview(previewId, actorId),
  };
}
