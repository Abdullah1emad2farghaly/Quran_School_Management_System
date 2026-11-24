/**
 * Real-database check of the READ-ONLY contract that the Parent report (Module 38, 0.58.0) added to Module 19: `StudentService.listChildrenOfParentForReport` over MariaDB (the existing
 * `listByParent` / `listByParentInSchools` queries, no new SQL, no migration). NOT part of `npm test`. Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Everything runs inside ONE outer transaction that is ALWAYS rolled back (random ids, no other table is touched), so it is safe on any database.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import type { TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { SequelizeStudentRepository, StudentService } from '../../src/modules/19-students/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const service = new StudentService({ students: new SequelizeStudentRepository(sequelize) } as never); // only the read-only report method is used here

class Rollback extends Error {}
afterAll(async () => {
  await sequelize.close();
});

async function inRolledBackTransaction(work: (tx: TransactionContext, run: (sql: string, replacements?: Record<string, unknown>) => Promise<void>) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx) ?? null;
      await work(tx, async (sql, replacements = {}) => {
        await sequelize.query(sql, { replacements, transaction, type: QueryTypes.RAW });
      });
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

describe('Module 19: listChildrenOfParentForReport (real MariaDB)', () => {
  let nationalId = 40000000000000 + (Date.now() % 1000000) * 10;
  const insertStudent = (run: (sql: string, r?: Record<string, unknown>) => Promise<void>, id: string, parentId: string, schoolId: string, fullName: string, status: string) => {
    nationalId += 1;
    return run(
      `INSERT INTO students (id, school_id, organization_id, parent_id, full_name, national_id, join_date, status, created_by, version, created_at, updated_at)
       VALUES (:id, :schoolId, :organizationId, :parentId, :fullName, :nationalId, '2026-09-01', :status, :createdBy, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      { id, schoolId, organizationId: randomUUID(), parentId, fullName, nationalId: String(nationalId), status, createdBy: randomUUID() },
    );
  };

  it('returns ALL the Parent\'s children of any status, ordered by name, optionally only in the given schools, and never the status', async () => {
    await inRolledBackTransaction(async (tx, run) => {
      const [parent, other, s1, s2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      await insertStudent(run, a, parent, s1, 'زياد محمد علي', 'ARCHIVED');
      await insertStudent(run, b, parent, s1, 'أحمد محمد علي', 'ACTIVE');
      await insertStudent(run, c, parent, s2, 'بلال محمد علي', 'INACTIVE');
      await insertStudent(run, d, other, s1, 'سعيد خالد علي', 'ACTIVE');

      const all = await service.listChildrenOfParentForReport({ parentId: parent }, tx);
      expect(all.map((x) => x.id)).toEqual([b, c, a]);
      expect(all[0]).toEqual({ id: b, schoolId: s1, fullName: 'أحمد محمد علي', joinDate: '2026-09-01' });
      expect(all.every((x) => !('status' in x))).toBe(true);
      expect((await service.listChildrenOfParentForReport({ parentId: parent, schoolIds: [s1] }, tx)).map((x) => x.id)).toEqual([b, a]);
      expect((await service.listChildrenOfParentForReport({ parentId: parent, schoolIds: [s2] }, tx)).map((x) => x.id)).toEqual([c]);
      expect(await service.listChildrenOfParentForReport({ parentId: parent, schoolIds: [] }, tx)).toEqual([]);
      expect(await service.listChildrenOfParentForReport({ parentId: parent, schoolIds: [randomUUID()] }, tx)).toEqual([]);
      expect((await service.listChildrenOfParentForReport({ parentId: other }, tx)).map((x) => x.id)).toEqual([d]);
      expect(await service.listChildrenOfParentForReport({ parentId: randomUUID() }, tx)).toEqual([]);
    });
  });
});
