// Public contract of Module 07 (File Infrastructure).
// Storing/reading files does NOT authorize access; Module 39 does (permission, scope, ownership, visibility).
export { FileService, type SaveExcelInput } from '../application/services/file-service';
export type { FileStorage } from '../application/ports/file-storage';
export type { StoredFileRepository } from '../application/ports/stored-file-repository';
export {
  EXCEL_EXTENSION,
  EXCEL_MIME_TYPE,
  MAX_EXCEL_FILE_BYTES,
  MAX_EXCEL_ROWS,
  type StoredFile,
} from '../domain/value-objects/stored-file';
export { FileErrorCodes, fileError, type FileErrorCode } from '../domain/errors/file-errors';
export { validateExcelFile, type ValidatedExcelFile } from '../domain/services/excel-file-validator';
export { sanitizeFileName, extensionOf } from '../domain/services/file-name';
export { inspectZip, ZipFormatError, type ZipInfo } from '../domain/services/zip-inspector';
export { FILE_ERROR_MESSAGES } from '../application/services/file-error-messages';
export { LocalFileStorage } from '../infrastructure/services/local-file-storage';
export { InMemoryFileStorage, InMemoryStoredFileRepository } from '../infrastructure/services/in-memory-file-adapters';
export { SequelizeStoredFileRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-stored-file-repository';
