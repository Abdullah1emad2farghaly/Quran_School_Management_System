/**
 * Real-database checks for stored file metadata (MariaDB via XAMPP). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate` (creates stored_files). Run: npm run test:db
 * Rows use purpose "test_file" and are deleted afterwards.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { newUuid } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize } from '../../src/modules/02-database/public';
import { createLogger } from '../../src/modules/05-logging-request-context/public';
import {
  FileService,
  LocalFileStorage,
  SequelizeStoredFileRepository,
} from '../../src/modules/07-file-infrastructure/public';
import { buildXlsx } from '../helpers/zip-builder';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repository = new SequelizeStoredFileRepository(sequelize);
let root: string;
let service: FileService;
const cleanup = () => sequelize.query("DELETE FROM stored_files WHERE purpose = 'test_file'");

describe('stored files (MariaDB)', () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'qsms-dbfiles-'));
    service = new FileService({ storage: new LocalFileStorage(root), repository, logger: createLogger({ level: 'silent' }) });
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await sequelize.close();
    await rm(root, { recursive: true, force: true });
  });

  const input = { originalName: 'الطلاب.xlsx', data: buildXlsx(), purpose: 'test_file', ownerUserId: newUuid() };

  it('stores metadata (including Arabic names) and reads it back with verified content', async () => {
    const saved = await service.saveExcel(input);
    const found = await service.getMetadata(saved.id);
    expect(found.originalName).toBe('الطلاب.xlsx');
    expect(found.sha256).toBe(saved.sha256);
    expect(found.sizeBytes).toBe(input.data.length);
    expect(found.ownerUserId).toBe(input.ownerUserId);
    const { data } = await service.readContent(saved.id);
    expect(data.equals(input.data)).toBe(true);
  });

  it('metadata is atomic with the caller transaction', async () => {
    let id = '';
    try {
      await uow.run(async (tx) => {
        id = (await service.saveExcel({ ...input, data: buildXlsx([{ name: 'xl/media/a.xml' }]) }, tx)).id;
        throw new Error('rollback');
      });
    } catch {
      /* expected */
    }
    let notFound = false;
    try {
      await service.getMetadata(id);
    } catch {
      notFound = true;
    }
    expect(notFound).toBe(true);
  });

  it('delete hides the file but keeps the row', async () => {
    const saved = await service.saveExcel({ ...input, data: buildXlsx([{ name: 'xl/media/b.xml' }]) });
    await service.delete(saved.id);
    let notFound = false;
    try {
      await service.getMetadata(saved.id);
    } catch {
      notFound = true;
    }
    expect(notFound).toBe(true);
    const [rows] = await sequelize.query('SELECT deleted_at FROM stored_files WHERE id = :id', { replacements: { id: saved.id } });
    expect((rows as Array<{ deleted_at: unknown }>)[0]?.deleted_at).toBeTruthy();
  });
});
