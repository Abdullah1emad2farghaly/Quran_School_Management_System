/**
 * Real-database check of the READ-ONLY contract that the Group report (Module 38, 0.59.0) added to Module 20: `GroupService.listAssignmentsOfGroupForReport` over MariaDB (one SELECT over `group_students`
 * through the existing `ix_group_students_group` index, no migration). NOT part of `npm test`. Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Everything runs inside ONE outer transaction that is ALWAYS rolled back (random ids, no other table is touched), so it is safe on any database.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import type { TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { GroupService, SequelizeGroupRepository } from '../../src/modules/20-groups/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const service = new GroupService({ groups: new SequelizeGroupRepository(sequelize) } as never); // only the read-only report method is used here

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

describe('Module 20: listAssignmentsOfGroupForReport (real MariaDB)', () => {
  it('returns the group\'s assignment periods (ended ones included) that overlap the range, oldest first, and no other group\'s', async () => {
    await inRolledBackTransaction(async (tx, run) => {
      const [school, org, actor, group, other] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      for (const [id, name] of [[group, 'حلقة الفجر'], [other, 'حلقة العصر']] as const) {
        await run(
          `INSERT INTO school_groups (id, school_id, organization_id, name, name_key, teacher_id, learning_mode, progression, starting_surah, status, active, created_by, version, created_at, updated_at)
           VALUES (:id, :school, :org, :name, :name, NULL, 'GROUP', 'FORWARD', 78, 'ACTIVE', 1, :actor, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          { id, school, org, name, actor },
        );
      }
      const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const assign = (groupId: string, student: string, assignedAt: string, unassignedAt: string | null) =>
        run(
          `INSERT INTO group_students (id, group_id, student_id, school_id, organization_id, assigned_at, assigned_by, unassigned_at, unassigned_by, end_reason, active)
           VALUES (:id, :groupId, :student, :school, :org, :assignedAt, :actor, :unassignedAt, NULL, :endReason, :active)`,
          { id: randomUUID(), groupId, student, school, org, actor, assignedAt: new Date(`${assignedAt}Z`), unassignedAt: unassignedAt ? new Date(`${unassignedAt}Z`) : null, endReason: unassignedAt ? 'MOVED' : null, active: unassignedAt ? null : 1 },
        );
      await assign(group, a, '2026-09-05T08:00:00.000', null); // still in the group
      await assign(group, b, '2026-09-05T08:00:00.000', '2026-10-10T08:00:00.000'); // moved out in October
      await assign(group, c, '2026-11-12T08:00:00.000', null); // joined in November
      await assign(other, d, '2026-09-05T08:00:00.000', null); // another group

      const students = async (q: { from?: Date; toExclusive?: Date }) => (await service.listAssignmentsOfGroupForReport({ groupId: group, ...q }, tx)).map((r) => r.studentId);
      expect(await students({})).toEqual([a, b, c]);
      const all = await service.listAssignmentsOfGroupForReport({ groupId: group }, tx);
      expect(all[0]).toMatchObject({ studentId: a, unassignedAt: null });
      expect(all[1]!.unassignedAt).toBeInstanceOf(Date);
      expect(all[1]!.assignedAt).toBeInstanceOf(Date);
      // November only: B left in October, C is there (assigned 12 Nov, before the end of the range), A is still there
      expect(await students({ from: new Date('2026-10-31T22:00:00.000Z'), toExclusive: new Date('2026-11-30T22:00:00.000Z') })).toEqual([a, c]);
      // October only: C had not joined yet
      expect(await students({ from: new Date('2026-09-30T21:00:00.000Z'), toExclusive: new Date('2026-10-31T22:00:00.000Z') })).toEqual([a, b]);
      // boundaries: a period ending exactly at `from` does not overlap; one starting exactly at `toExclusive` does not overlap
      expect(await students({ from: new Date('2026-10-10T08:00:00.000Z') })).toEqual([a, c]);
      expect(await students({ toExclusive: new Date('2026-09-05T08:00:00.000Z') })).toEqual([]);
      expect(await service.listAssignmentsOfGroupForReport({ groupId: randomUUID() }, tx)).toEqual([]);
    });
  });
});
