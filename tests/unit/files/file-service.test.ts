import { describe, expect, it } from 'vitest';
import { AppError, FixedClock } from '../../../src/modules/00-shared-kernel/public';
import { createLogger } from '../../../src/modules/05-logging-request-context/public';
import {
  FileService,
  InMemoryFileStorage,
  InMemoryStoredFileRepository,
  type StoredFileRepository,
} from '../../../src/modules/07-file-infrastructure/public';
import { buildXlsx } from '../../helpers/zip-builder';

const clock = new FixedClock(new Date('2026-03-05T10:00:00Z'));
const logger = createLogger({ level: 'silent' });

function setup(repository: StoredFileRepository = new InMemoryStoredFileRepository()) {
  const storage = new InMemoryFileStorage();
  const service = new FileService({ storage, repository, logger, clock });
  return { storage, repository, service };
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
}
const input = { originalName: 'الطلاب.xlsx', data: buildXlsx(), purpose: 'excel_import', ownerUserId: 'user-1' };

describe('FileService.saveExcel', () => {
  it('stores bytes under a server-generated key and records metadata', async () => {
    const { service, storage } = setup();
    const file = await service.saveExcel(input);
    expect(file.storageKey).toMatch(/^2026\/03\/[0-9a-f-]{36}\.xlsx$/);
    expect(file.storageKey.includes('الطلاب')).toBe(false);
    expect(file.originalName).toBe('الطلاب.xlsx');
    expect(file.purpose).toBe('excel_import');
    expect(file.ownerUserId).toBe('user-1');
    expect(file.sizeBytes).toBe(input.data.length);
    expect(storage.blobs.get(file.storageKey)?.equals(input.data)).toBe(true);
  });
  it('never lets the client name influence the storage path', async () => {
    const { service } = setup();
    const file = await service.saveExcel({ ...input, originalName: '../../../etc/passwd.xlsx' });
    expect(file.storageKey.includes('..')).toBe(false);
    expect(file.originalName).toBe('passwd.xlsx');
  });
  it('rejects invalid files before storing anything', async () => {
    const { service, storage, repository } = setup();
    expect(await codeOf(service.saveExcel({ ...input, originalName: 'a.pdf' }))).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(await codeOf(service.saveExcel({ ...input, data: Buffer.alloc(0) }))).toBe('FILE_EMPTY');
    expect(storage.blobs.size).toBe(0);
    expect((repository as InMemoryStoredFileRepository).files.size).toBe(0);
  });
  it('rejects an invalid purpose (programmer error)', async () => {
    const { service } = setup();
    let failed = false;
    try {
      await service.saveExcel({ ...input, purpose: 'Bad Purpose!' });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
  it('removes the stored bytes when the metadata insert fails', async () => {
    const failing: StoredFileRepository = {
      insert: async () => { throw new Error('db down'); },
      findById: async () => undefined,
      markDeleted: async () => undefined,
    };
    const { service, storage } = setup(failing);
    let failed = false;
    try {
      await service.saveExcel(input);
    } catch (e) {
      failed = (e as Error).message === 'db down';
    }
    expect(failed).toBe(true);
    expect(storage.blobs.size).toBe(0);
  });
  it('applies a lower configured size limit', async () => {
    const storage = new InMemoryFileStorage();
    const service = new FileService({ storage, repository: new InMemoryStoredFileRepository(), logger, clock, maxBytes: 50 });
    expect(await codeOf(service.saveExcel(input))).toBe('FILE_TOO_LARGE');
  });
});

describe('FileService read / delete', () => {
  it('reads content and verifies integrity', async () => {
    const { service } = setup();
    const saved = await service.saveExcel(input);
    const { file, data } = await service.readContent(saved.id);
    expect(file.id).toBe(saved.id);
    expect(data.equals(input.data)).toBe(true);
  });
  it('detects tampered or missing content', async () => {
    const { service, storage } = setup();
    const saved = await service.saveExcel(input);
    storage.blobs.set(saved.storageKey, Buffer.from('tampered'));
    expect(await codeOf(service.readContent(saved.id))).toBe('FILE_INTEGRITY_FAILED');
    storage.blobs.delete(saved.storageKey);
    expect(await codeOf(service.readContent(saved.id))).toBe('FILE_INTEGRITY_FAILED');
  });
  it('reports unknown files as not found', async () => {
    const { service } = setup();
    expect(await codeOf(service.getMetadata('3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b'))).toBe('FILE_NOT_FOUND');
  });
  it('deletes bytes and hides the file afterwards', async () => {
    const { service, storage } = setup();
    const saved = await service.saveExcel(input);
    await service.delete(saved.id);
    expect(storage.blobs.size).toBe(0);
    expect(await codeOf(service.getMetadata(saved.id))).toBe('FILE_NOT_FOUND');
    expect(await codeOf(service.delete(saved.id))).toBe('FILE_NOT_FOUND');
  });
});
