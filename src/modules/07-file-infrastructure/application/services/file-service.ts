import { createHash } from 'node:crypto';
import { SystemClock, newUuid, type Clock, type TransactionContext } from '../../../00-shared-kernel/public';
import type { Logger } from '../../../05-logging-request-context/public';
import { FileErrorCodes, fileError } from '../../domain/errors/file-errors';
import { validateExcelFile } from '../../domain/services/excel-file-validator';
import { MAX_EXCEL_FILE_BYTES, type StoredFile } from '../../domain/value-objects/stored-file';
import type { FileStorage } from '../ports/file-storage';
import type { StoredFileRepository } from '../ports/stored-file-repository';

const PURPOSE_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;

export interface SaveExcelInput {
  /** As sent by the client; sanitized, display-only. */
  readonly originalName: string;
  readonly data: Buffer;
  /** e.g. "excel_import". */
  readonly purpose: string;
  /** From the authenticated session, never from the request body. */
  readonly ownerUserId?: string;
}

/**
 * Stores and retrieves private files. This service does NOT decide who may
 * access a file: callers must authorize first (Module 39 checks authentication,
 * permission, scope, ownership and visibility). There are no public URLs.
 */
export class FileService {
  private readonly clock: Clock;
  private readonly maxBytes: number;

  constructor(
    private readonly deps: { storage: FileStorage; repository: StoredFileRepository; logger: Logger; clock?: Clock; maxBytes?: number },
  ) {
    this.clock = deps.clock ?? new SystemClock();
    this.maxBytes = Math.min(deps.maxBytes ?? MAX_EXCEL_FILE_BYTES, MAX_EXCEL_FILE_BYTES);
  }

  /**
   * Validates and stores an .xlsx file. Bytes are written first, then metadata;
   * if the metadata insert fails the bytes are removed. If a surrounding
   * transaction later rolls back, the bytes remain as an orphan (no metadata
   * row) and are harmless; a cleanup sweep can remove them.
   */
  async saveExcel(input: SaveExcelInput, tx?: TransactionContext): Promise<StoredFile> {
    if (!PURPOSE_PATTERN.test(input.purpose)) throw new Error(`Invalid file purpose "${input.purpose}"`);
    const validated = validateExcelFile({ originalName: input.originalName, data: input.data }, this.maxBytes);

    const id = newUuid();
    const now = this.clock.now();
    const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${validated.extension}`;
    const file: StoredFile = {
      id,
      originalName: validated.originalName,
      storageKey,
      extension: validated.extension,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      sha256: validated.sha256,
      purpose: input.purpose,
      ownerUserId: input.ownerUserId ?? null,
      createdAt: now,
    };

    await this.deps.storage.put(storageKey, input.data);
    try {
      await this.deps.repository.insert(file, tx);
    } catch (error) {
      await this.deps.storage.delete(storageKey).catch((cleanupError: unknown) => {
        this.deps.logger.error('could not remove file after failed metadata insert', { storageKey, err: cleanupError });
      });
      throw error;
    }
    this.deps.logger.info('file stored', { fileId: id, purpose: input.purpose, sizeBytes: file.sizeBytes });
    return file;
  }

  async getMetadata(id: string): Promise<StoredFile> {
    const file = await this.deps.repository.findById(id);
    if (!file) throw fileError(FileErrorCodes.FILE_NOT_FOUND);
    return file;
  }

  /** Reads the content and verifies its SHA-256 against the stored value. */
  async readContent(id: string): Promise<{ file: StoredFile; data: Buffer }> {
    const file = await this.getMetadata(id);
    const data = await this.deps.storage.get(file.storageKey);
    if (!data) {
      this.deps.logger.error('stored file content is missing', { fileId: id });
      throw fileError(FileErrorCodes.FILE_INTEGRITY_FAILED);
    }
    if (createHash('sha256').update(data).digest('hex') !== file.sha256) {
      this.deps.logger.error('stored file failed its integrity check', { fileId: id });
      throw fileError(FileErrorCodes.FILE_INTEGRITY_FAILED);
    }
    return { file, data };
  }

  /** Removes the bytes and marks the metadata deleted (the row is kept for history). */
  async delete(id: string): Promise<void> {
    const file = await this.getMetadata(id);
    await this.deps.storage.delete(file.storageKey);
    await this.deps.repository.markDeleted(id, this.clock.now());
  }
}
