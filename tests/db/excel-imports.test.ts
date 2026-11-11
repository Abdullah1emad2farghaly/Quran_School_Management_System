/**
 * Real-database checks for Module 36 (Excel Import): the `excel_import_previews` schema (the status CHECK, the indexes, no foreign key to another
 * module's table) and the SQL repository (insert, read with its JSON and dates, FOR UPDATE, optimistic update, expiry purge that removes the personal
 * data). NOT part of `npm test`. Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: every test runs in ONE outer transaction that is ALWAYS rolled back, so existing data is never changed.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { SequelizeImportPreviewRepository, type ImportPreviewRecord } from '../../src/modules/36-excel-import/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repo = new SequelizeImportPreviewRepository(sequelize);

class Rollback extends Error {}

const summary = { totalRows: 1, rowsOk: 1, rowsWithWarnings: 0, rowsWithErrors: 0, rowsWithConflicts: 0, newUsers: 2, existingUsers: 0, newStudents: 1, existingStudents: 0, newParents: 1, existingParents: 0, newTeachers: 1, existingTeachers: 0, newGroups: 1, existingGroups: 0, errors: 0, conflicts: 0, warnings: 0 };
const record = (over: Partial<ImportPreviewRecord> = {}): ImportPreviewRecord => ({
  id: randomUUID(),
  schoolId: randomUUID(),
  organizationId: randomUUID(),
  createdBy: randomUUID(),
  fileId: randomUUID(),
  originalName: 'طلاب.xlsx',
  language: 'ar',
  status: 'PENDING',
  canConfirm: true,
  blocking: 0,
  summary,
  sourceRows: [{ rowNumber: 2, studentName: 'عمر أحمد محمد' } as never],
  analysis: { rows: [], issues: [{ rowNumber: 2, column: 'groupName', severity: 'WARNING', code: 'X', params: { a: 'ب' }, message: { ar: 'نص', en: 'text' } }] },
  result: null,
  createdAt: new Date('2026-11-10T09:30:00.000Z'),
  expiresAt: new Date('2026-11-11T09:30:00.000Z'),
  decidedAt: null,
  decidedBy: null,
  version: 1,
  ...over,
});

async function inRolledBackTransaction(work: (tx: Parameters<typeof repo.insert>[1], q: (sql: string, r?: Record<string, unknown>) => Promise<unknown[]>) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx) ?? null;
      await work(tx, (sql, replacements) => sequelize.query(sql, { replacements: replacements ?? {}, type: QueryTypes.SELECT, transaction }));
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

afterAll(async () => {
  await sequelize.close();
});

describe('excel_import_previews schema', () => {
  it('has the status CHECK, the expected indexes and no foreign key to another table', async () => {
    await inRolledBackTransaction(async (tx) => {
      const base = record();
      await repo.insert(base, tx);
      await expect(
        sequelize.query("UPDATE excel_import_previews SET status = 'BOGUS' WHERE id = :id", { replacements: { id: base.id }, transaction: sequelizeTransactionOf(tx) ?? null }),
      ).rejects.toBeTruthy();
    });
    const indexes = (await sequelize.query("SELECT DISTINCT index_name AS name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'excel_import_previews'", { type: QueryTypes.SELECT })) as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual(expect.arrayContaining(['PRIMARY', 'ix_excel_import_previews_owner', 'ix_excel_import_previews_expiry', 'ix_excel_import_previews_school']));
    const fks = await sequelize.query("SELECT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'excel_import_previews' AND constraint_type = 'FOREIGN KEY'", { type: QueryTypes.SELECT });
    expect(fks).toEqual([]);
  });
});

describe('SequelizeImportPreviewRepository', () => {
  it('round-trips a record (Arabic text, JSON and dates) and updates it with an optimistic lock', async () => {
    await inRolledBackTransaction(async (tx) => {
      const base = record();
      await repo.insert(base, tx);
      const read = (await repo.findById(base.id, tx))!;
      expect(read).toMatchObject({ id: base.id, originalName: 'طلاب.xlsx', language: 'ar', status: 'PENDING', canConfirm: true, blocking: 0, version: 1 });
      expect(read.summary).toEqual(summary);
      expect(read.analysis!.issues[0]!.message.ar).toBe('نص');
      expect(read.expiresAt.toISOString()).toBe('2026-11-11T09:30:00.000Z');
      expect((await repo.lockById(base.id, tx))!.id).toBe(base.id);

      const confirmed: ImportPreviewRecord = { ...read, status: 'CONFIRMED', canConfirm: false, sourceRows: null, analysis: null, result: { studentsCreated: 1 } as never, decidedAt: new Date('2026-11-10T10:00:00.000Z'), decidedBy: randomUUID(), version: 2 };
      await repo.update(confirmed, tx);
      const after = (await repo.findById(base.id, tx))!;
      expect(after).toMatchObject({ status: 'CONFIRMED', canConfirm: false, sourceRows: null, analysis: null, version: 2 });
      // a stale writer (still at version 1) is refused
      await expect(repo.update({ ...read, status: 'CANCELLED', version: 2 }, tx)).rejects.toThrow('IMPORT_PREVIEW_CONCURRENT_MODIFICATION');
    });
  });

  it('expires only the PENDING previews that are due, removing their personal data and returning their file ids', async () => {
    await inRolledBackTransaction(async (tx) => {
      const due = record({ expiresAt: new Date('2026-11-10T08:00:00.000Z') });
      const notDue = record({ expiresAt: new Date('2026-11-12T08:00:00.000Z') });
      const decided = record({ status: 'CANCELLED', expiresAt: new Date('2026-11-10T08:00:00.000Z'), sourceRows: null, analysis: null });
      for (const r of [due, notDue, decided]) await repo.insert(r, tx);
      const files = await repo.expireDue(new Date('2026-11-10T12:00:00.000Z'), 100, tx);
      expect(files).toContain(due.fileId);
      expect(files).not.toContain(notDue.fileId);
      expect(files).not.toContain(decided.fileId);
      expect(await repo.findById(due.id, tx)).toMatchObject({ status: 'EXPIRED', canConfirm: false, sourceRows: null, analysis: null, fileId: null });
      expect((await repo.findById(notDue.id, tx))!.status).toBe('PENDING');
      expect((await repo.findById(decided.id, tx))!.status).toBe('CANCELLED');
    });
  });
});
