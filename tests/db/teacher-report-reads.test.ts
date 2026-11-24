/**
 * Real-database check of the READ-ONLY contract that the Teacher report (Module 38, 0.60.0) added to Module 20: `GroupService.listGroupsTaughtByTeacherForReport` over MariaDB (one SELECT over `school_groups`
 * and `group_history` through the existing `ix_group_history_group` index, no migration), including the multi-school isolation. NOT part of `npm test`. Prerequisite: `npm run db:migrate`. Run: npm run test:db
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

describe('Module 20: listGroupsTaughtByTeacherForReport (real MariaDB)', () => {
  it('derives the stints from the group history, only for the given schools, with the dates the history gives', async () => {
    await inRolledBackTransaction(async (tx, run) => {
      const [teacher, other, actor, org, sa, sb, sc] = Array.from({ length: 7 }, () => randomUUID());
      const insertGroup = (id: string, schoolId: string, name: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') =>
        run(
          `INSERT INTO school_groups (id, school_id, organization_id, name, name_key, teacher_id, learning_mode, progression, starting_surah, status, active, created_by, version, created_at, updated_at)
           VALUES (:id, :schoolId, :org, :name, :name, NULL, 'GROUP', 'FORWARD', 78, :status, :active, :actor, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          { id, schoolId, org, name, status, active: status === 'ACTIVE' ? 1 : null, actor },
        );
      const history = (groupId: string, action: 'CREATED' | 'TEACHER_CHANGED' | 'ARCHIVED', iso: string, newTeacherId: string | null) =>
        run('INSERT INTO group_history (id, group_id, action, actor_id, occurred_at, new_teacher_id) VALUES (:id, :groupId, :action, :actor, :at, :newTeacherId)', {
          id: randomUUID(), groupId, action, actor, at: new Date(iso), newTeacherId,
        });
      const [ga, gb, gc, gOther, gArchived] = Array.from({ length: 5 }, () => randomUUID());
      await insertGroup(ga!, sa!, 'حلقة أ');
      await insertGroup(gb!, sb!, 'حلقة ب');
      await insertGroup(gc!, sc!, 'حلقة ج');
      await insertGroup(gOther!, sa!, 'حلقة أخرى');
      await insertGroup(gArchived!, sa!, 'حلقة مؤرشفة', 'ARCHIVED');
      await history(ga!, 'CREATED', '2026-09-10T08:00:00.000Z', teacher!); // still teaching
      await history(gb!, 'CREATED', '2026-09-10T08:00:00.000Z', other!);
      await history(gb!, 'TEACHER_CHANGED', '2026-10-01T08:00:00.000Z', teacher!); // took over in October
      await history(gc!, 'CREATED', '2026-09-10T08:00:00.000Z', teacher!);
      await history(gc!, 'TEACHER_CHANGED', '2026-10-20T08:00:00.000Z', null); // left school C in October
      await history(gOther!, 'CREATED', '2026-09-10T08:00:00.000Z', other!); // another teacher's group
      await history(gArchived!, 'CREATED', '2026-09-10T08:00:00.000Z', teacher!);
      await history(gArchived!, 'ARCHIVED', '2026-10-05T08:00:00.000Z', null); // an archived group is not taught any more

      const taught = async (schoolIds: string[], range: { from?: Date; toExclusive?: Date } = {}) => service.listGroupsTaughtByTeacherForReport({ teacherId: teacher!, schoolIds, ...range }, tx);
      const summary = (rows: Awaited<ReturnType<typeof taught>>) => rows.map((r) => [r.groupId, r.from.toISOString(), r.to?.toISOString() ?? null, r.stillTeaching]);

      // multi-school isolation: only the given schools are ever read
      expect((await taught([sa!])).map((r) => r.groupId).sort()).toEqual([ga, gArchived].sort());
      expect((await taught([sb!])).map((r) => r.groupId)).toEqual([gb]);
      expect((await taught([sc!])).map((r) => r.groupId)).toEqual([gc]);
      expect(JSON.stringify(await taught([sa!]))).not.toMatch(new RegExp(`${sb}|${sc}|${gb}|${gc}|حلقة ب|حلقة ج`));
      expect(await taught([])).toEqual([]);
      expect(await taught([randomUUID()])).toEqual([]);

      // dates from the history, never from who owns the group now; a teacher keeps the history of a school they left
      expect(summary(await taught([sb!]))).toEqual([[gb, '2026-10-01T08:00:00.000Z', null, true]]);
      expect(summary(await taught([sc!]))).toEqual([[gc, '2026-09-10T08:00:00.000Z', '2026-10-20T08:00:00.000Z', false]]);
      const archived = (await taught([sa!])).find((r) => r.groupId === gArchived)!;
      expect(archived.to?.toISOString()).toBe('2026-10-05T08:00:00.000Z');
      expect(archived.stillTeaching).toBe(false);
      expect(archived.groupName).toBe('حلقة مؤرشفة');

      // clipping to the period, across all three schools
      const november = await taught([sa!, sb!, sc!], { from: new Date('2026-10-31T22:00:00.000Z') });
      expect(november.map((r) => r.groupId).sort()).toEqual([ga, gb].sort());
      expect(await service.listGroupsTaughtByTeacherForReport({ teacherId: randomUUID(), schoolIds: [sa!, sb!, sc!] }, tx)).toEqual([]);
    });
  });
});
