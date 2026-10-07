import path from 'node:path';
import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  FileService,
  LocalFileStorage,
  SequelizeStoredFileRepository,
} from '../modules/07-file-infrastructure/public';
import { getSequelize } from './database';
import { env } from './env';
import { logger } from './logger';

let service: FileService | undefined;

/**
 * Private file storage (FILE_STORAGE_PATH, outside any web-served folder).
 * The effective size limit is the smaller of MAX_FILE_SIZE and the 10 MB spec limit.
 */
export function getFileService(): FileService {
  if (!service) {
    service = new FileService({
      storage: new LocalFileStorage(path.resolve(env.files.storagePath)),
      repository: new SequelizeStoredFileRepository(getSequelize()),
      logger: logger.child({ module: 'files' }),
      clock: new SystemClock(),
      maxBytes: env.files.maxFileSize,
    });
  }
  return service;
}
