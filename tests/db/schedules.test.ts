/**
 * Real-database checks for Module 23 (Group Schedules): the schema (one ACTIVE slot per weekday for a group whatever the times, the CHECKs, the
 * retirement consistency, no foreign keys to other modules), the SQL repository, the real GroupScheduleService against it, and the CONCURRENCY
 * guarantees (two requests for the same group, the same Teacher, or a Teacher assignment racing a slot change never both pass). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database:
 *  - the schema and service tests run in ONE outer transaction that is ALWAYS rolled back;
 *  - the concurrency tests need data that other connections can see, so they COMMIT rows with random identifiers in this module's two tables and in
 *    `school_groups`, and delete exactly those rows afterwards (also when a test fails). Nothing else is read or changed.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, SystemClock, type TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { InMemoryOutboxStore, OutboxService } from '../../src/modules/06-domain-events-outbox/public';
import { Group, GroupService, SequelizeGroupRepository } from '../../src/modules/20-groups/public';
import { GroupScheduleService, GroupScheduleSlot, SequelizeScheduleRepository } from '../../src/modules/23-group-schedules/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const clock = new SystemClock();
const groupRepo = new SequelizeGroupRepository(sequelize);
const slotRepo = new SequelizeScheduleRepository(sequelize);

/** Module 20's real repository and service for the group rows; the Schools / Teachers / Students services are not needed by what Module 23 calls. */
const groups = new GroupService({
  groups: groupRepo,
  schools: {} as never,
  teachers: { findById: async (id: string) => ({ id, name: 'معلم الاختبار' }) } as never,
  students: {} as never,
  unitOfWork: uow,
  outbox: new OutboxService(new InMemoryOutboxStore()),
  clock,
});
const teachersStub = { findByUserId: async () => undefined };
const schedules = new GroupScheduleService({ slots: slotRepo, groups, teachers: teachersStub as never, unitOfWork: uow, outbox: new OutboxService(new InMemoryOutboxStore()), clock });

class Rollback extends Error {}
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `OTHER:${(e as Error).message}`));
const slot = (day: string, startTime: string, endTime: string) => ({ dayOfWeek: day, startTime, endTime });

let counter = 0;
/** Every committed group this file ever created (to prove they are all deleted). */
const everCreated = new Set<string>();
const newGroupEntity = (schoolId: string, teacherId: string | null) =>
  Group.register({ schoolId, organizationId: randomUUID(), name: `حلقة اختبار ${randomUUID().slice(0, 8)} ${++counter}`, teacherId, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, createdBy: randomUUID(), clock });

afterAll(async () => {
  await sequelize.close();
});

// ------------------------------------------------------------------------------------------------------------------------------------------------
// schema and repository: ONE transaction, always rolled back
// ------------------------------------------------------------------------------------------------------------------------------------------------
interface Fixture {
  tx: TransactionContext;
  q: <T extends object>(sql: string, replacements?: Record<string, unknown>) => Promise<T[]>;
  run: (sql: string, replacements?: Record<string, unknown>) => Promise<void>;
  /** The statement must fail (constraint); the transaction stays usable (savepoint). */
  fails: (sql: string, replacements?: Record<string, unknown>) => Promise<void>;
  school: string;
  teacher: string;
  newGroup: (teacherId?: string | null, schoolId?: string) => Promise<string>;
  insertSlot: (over?: Record<string, unknown>) => Promise<void>;
}

async function withFixture(work: (f: Fixture) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx) ?? null;
      const q: Fixture['q'] = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
      const run: Fixture['run'] = async (sql, replacements = {}) => {
        await sequelize.query(sql, { replacements, transaction });
      };
      let sp = 0;
      const fails: Fixture['fails'] = async (sql, replacements = {}) => {
        const name = `sp_${++sp}`;
        await run(`SAVEPOINT ${name}`);
        await expect(run(sql, replacements)).rejects.toThrow();
        await run(`ROLLBACK TO SAVEPOINT ${name}`);
      };
      const school = randomUUID();
      const teacher = randomUUID();
      const newGroup: Fixture['newGroup'] = async (teacherId = null, schoolId = school) => {
        const g = newGroupEntity(schoolId, teacherId);
        await groupRepo.insert(g, tx);
        return g.id;
      };
      const insertSlot: Fixture['insertSlot'] = (over = {}) =>
        run(
          `INSERT INTO group_schedule_slots (id, group_id, school_id, day_of_week, start_minute, end_minute, active, created_at, created_by, retired_at, retired_by, retire_reason, replaced_by_slot_id)
           VALUES (:id, :groupId, :schoolId, :day, :start, :end, :active, NOW(3), :by, :retiredAt, :retiredBy, :reason, :replacedBy)`,
          { id: randomUUID(), groupId: randomUUID(), schoolId: school, day: 1, start: 1080, end: 1140, active: 1, by: randomUUID(), retiredAt: null, retiredBy: null, reason: null, replacedBy: null, ...over },
        );
      await work({ tx, q, run, fails, school, teacher, newGroup, insertSlot });
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

describe('group_schedule_slots schema (migration create-group-schedules)', () => {
  it('has only this module\'s own tables and no foreign key to another module', async () => {
    await withFixture(async ({ q }) => {
      const fks = await q<{ n: string }>("SELECT CONSTRAINT_NAME AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_TYPE = 'FOREIGN KEY' AND TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('group_schedule_slots', 'schedule_teacher_locks')");
      expect(fks).toEqual([]);
      const tables = await q<{ t: string }>("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('group_schedule_slots', 'schedule_teacher_locks')");
      expect(tables.map((r) => r.t).sort()).toEqual(['group_schedule_slots', 'schedule_teacher_locks']);
    });
  });

  it('allows ONE active slot per weekday for a group, whatever the times, and any number of retired ones', async () => {
    await withFixture(async ({ run, fails, insertSlot }) => {
      const groupId = randomUUID();
      await insertSlot({ groupId, day: 2, start: 1080, end: 1140 });
      await fails('INSERT INTO group_schedule_slots (id, group_id, school_id, day_of_week, start_minute, end_minute, active, created_at, created_by) VALUES (UUID(), :g, UUID(), 2, 1080, 1140, 1, NOW(3), UUID())', { g: groupId }); // identical
      await fails('INSERT INTO group_schedule_slots (id, group_id, school_id, day_of_week, start_minute, end_minute, active, created_at, created_by) VALUES (UUID(), :g, UUID(), 2, 1140, 1200, 1, NOW(3), UUID())', { g: groupId }); // only touching
      await fails('INSERT INTO group_schedule_slots (id, group_id, school_id, day_of_week, start_minute, end_minute, active, created_at, created_by) VALUES (UUID(), :g, UUID(), 2, 480, 540, 1, NOW(3), UUID())', { g: groupId }); // completely separate
      await insertSlot({ groupId, day: 3, start: 1080, end: 1140 }); // another weekday
      await insertSlot({ day: 2, start: 1080, end: 1140 }); // another group
      for (const start of [600, 660]) await insertSlot({ groupId, day: 2, start, end: start + 30, active: null, retiredAt: new Date(), retiredBy: randomUUID(), reason: 'REMOVED' }); // retired: many
      await run('SELECT 1');
    });
  });

  it('rejects a bad weekday, bad times and an inconsistent retirement (CHECK constraints)', async () => {
    await withFixture(async ({ fails, insertSlot, run }) => {
      const bad = async (over: Record<string, unknown>) => {
        const name = `chk_${Math.random().toString(16).slice(2)}`;
        await run(`SAVEPOINT ${name}`);
        await expect(insertSlot(over)).rejects.toThrow();
        await run(`ROLLBACK TO SAVEPOINT ${name}`);
      };
      await insertSlot({ day: 1, start: 0, end: 1 }); // the smallest and the largest valid slots
      await insertSlot({ day: 7, start: 1438, end: 1439 });
      await bad({ day: 0 });
      await bad({ day: 8 });
      await bad({ start: 1140, end: 1080 }); // end before start
      await bad({ start: 1080, end: 1080 }); // empty
      await bad({ start: 0, end: 1440 }); // 24:00 is not allowed
      await bad({ active: null }); // retired without a retirement
      await bad({ retiredAt: new Date() }); // active but with a retirement
      await bad({ active: null, retiredAt: new Date(), retiredBy: randomUUID(), reason: 'REPLACED', replacedBy: null }); // REPLACED needs its replacement
      await bad({ active: null, retiredAt: new Date(), retiredBy: randomUUID(), reason: 'REMOVED', replacedBy: randomUUID() }); // REMOVED has none
      await bad({ active: null, retiredAt: new Date(), retiredBy: randomUUID(), reason: 'DELETED' }); // unknown reason
      await insertSlot({ active: null, retiredAt: new Date(), retiredBy: randomUUID(), reason: 'REPLACED', replacedBy: randomUUID() });
      await insertSlot({ active: null, retiredAt: new Date(), retiredBy: randomUUID(), reason: 'GROUP_ARCHIVED' });
      await fails('INSERT INTO schedule_teacher_locks (teacher_id, locked_at) VALUES (NULL, NOW(3))');
    });
  });
});

describe('SequelizeScheduleRepository', () => {
  it('inserts, reads back in insertion order, retires (only the retirement columns change) and never deletes', async () => {
    await withFixture(async ({ tx, school }) => {
      const groupId = randomUUID();
      const a = GroupScheduleSlot.create({ groupId, schoolId: school, dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00', createdBy: randomUUID(), clock });
      const b = GroupScheduleSlot.create({ groupId, schoolId: school, dayOfWeek: 'TUESDAY', startTime: '09:15', endTime: '10:45', createdBy: randomUUID(), clock });
      await slotRepo.insert(a, null, tx);
      await slotRepo.insert(b, null, tx);
      expect((await slotRepo.listAllByGroup(groupId, tx)).map((s) => s.id)).toEqual([a.id, b.id]);
      expect((await slotRepo.listActiveByGroup(groupId, tx, true)).map((s) => s.snapshot.dayOfWeek)).toEqual(['MONDAY', 'TUESDAY']);
      expect((await slotRepo.lockById(b.id, tx))!.snapshot).toMatchObject({ dayOfWeek: 'TUESDAY', startMinute: 555, endMinute: 645, schoolId: school, retiredAt: null });
      const stored = await slotRepo.lockById(a.id, tx);
      const actor = randomUUID();
      stored!.retire({ reason: 'REPLACED', actorId: actor, clock, replacedBySlotId: b.id });
      await slotRepo.retire(stored!, tx);
      expect((await slotRepo.listActiveByGroup(groupId, tx)).map((s) => s.id)).toEqual([b.id]);
      const history = await slotRepo.listAllByGroup(groupId, tx);
      expect(history.map((s) => s.id)).toEqual([a.id, b.id]); // still there, same order
      expect(history[0]!.snapshot).toMatchObject({ dayOfWeek: 'MONDAY', startMinute: 1080, endMinute: 1140, retireReason: 'REPLACED', retiredBy: actor, replacedBySlotId: b.id });
      expect(history[0]!.snapshot.retiredAt).toBeInstanceOf(Date);
      // a retired slot cannot be retired again
      expect(await codeOf(slotRepo.retire(stored!, tx))).toBe('SCHEDULE_SLOT_NOT_FOUND');
      expect(await slotRepo.listActiveByGroups([], tx)).toEqual([]);
      expect((await slotRepo.listActiveByGroups([groupId, randomUUID()], tx)).map((s) => s.id)).toEqual([b.id]);
    });
  });

  it('reports a second ACTIVE slot on the same weekday as SCHEDULE_DAY_ALREADY_HAS_SLOT (the unique index is the last guard)', async () => {
    await withFixture(async ({ tx, school }) => {
      const groupId = randomUUID();
      const make = (start: string, end: string) => GroupScheduleSlot.create({ groupId, schoolId: school, dayOfWeek: 'FRIDAY', startTime: start, endTime: end, createdBy: randomUUID(), clock });
      await slotRepo.insert(make('08:00', '09:00'), null, tx);
      const error = await slotRepo.insert(make('17:00', '18:00'), null, tx).then(() => undefined, (e: unknown) => e as AppError);
      expect(error?.code).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
      expect(error?.details).toEqual({ dayOfWeek: 'FRIDAY' });
    });
  });

  it('locks Teachers: a first lock creates the row, a repeat reuses it, any order and duplicates are fine', async () => {
    await withFixture(async ({ tx, q }) => {
      const [a, b] = [randomUUID(), randomUUID()];
      await slotRepo.lockTeachers([b, a, b], tx);
      await slotRepo.lockTeachers([a], tx);
      expect((await q<{ n: number }>('SELECT COUNT(*) AS n FROM schedule_teacher_locks WHERE teacher_id IN (:ids)', { ids: [a, b] }))[0]!.n).toBe(2);
    });
  });
});

describe('the Teacher of a slot (kept in step with its group, never retiring anything)', () => {
  it('follows the group\'s Teacher: set when a slot is created, changed on assignment, replacement and removal, and only ACTIVE slots are updated', async () => {
    await withFixture(async ({ tx, school }) => {
      const [t1, t2] = [randomUUID(), randomUUID()];
      const groupId = randomUUID();
      const make = (day: string, start: string, end: string) => GroupScheduleSlot.create({ groupId, schoolId: school, dayOfWeek: day, startTime: start, endTime: end, createdBy: randomUUID(), clock });
      const a = make('MONDAY', '18:00', '19:00');
      const b = make('TUESDAY', '18:00', '19:00');
      await slotRepo.insert(a, t1, tx);
      await slotRepo.insert(b, t1, tx);
      expect((await slotRepo.listActiveByTeacher(t1, null, tx, true)).map((s) => s.id)).toEqual([a.id, b.id]);
      expect((await slotRepo.listActiveByTeacher(t1, groupId, tx, true))).toEqual([]); // the group's own slots are excluded on request
      const stored = await slotRepo.lockById(b.id, tx);
      stored!.retire({ reason: 'REMOVED', actorId: randomUUID(), clock });
      await slotRepo.retire(stored!, tx);
      await slotRepo.setTeacherOfGroup(groupId, t2, tx); // replaced: only the ACTIVE slot follows
      expect((await slotRepo.listActiveByTeacher(t1, null, tx)).map((s) => s.id)).toEqual([]);
      expect((await slotRepo.listActiveByTeacher(t2, null, tx)).map((s) => s.id)).toEqual([a.id]);
      await slotRepo.setTeacherOfGroup(groupId, null, tx); // removed: the slot stays, with no Teacher
      expect((await slotRepo.listActiveByTeacher(t2, null, tx))).toEqual([]);
      expect((await slotRepo.listActiveByGroup(groupId, tx)).map((s) => s.id)).toEqual([a.id]);
      expect((await slotRepo.listAllByGroup(groupId, tx))).toHaveLength(2);
    });
  });
});

describe('GroupScheduleService against the real database', () => {
  it('enforces one slot per weekday and the Teacher overlap rule with the real SQL, in the caller\'s transaction', async () => {
    await withFixture(async ({ tx, newGroup, teacher, school }) => {
      const g1 = await newGroup(teacher);
      const g2 = await newGroup(teacher);
      const noTeacher = await newGroup(null);
      const actor = randomUUID();
      await schedules.addSlot(g1, slot('MONDAY', '18:00', '19:00'), actor, tx);
      expect(await codeOf(schedules.addSlot(g1, slot('MONDAY', '08:00', '09:00'), actor, tx))).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT'); // separate times
      expect(await codeOf(schedules.addSlot(g1, slot('MONDAY', '19:00', '20:00'), actor, tx))).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT'); // touching
      expect(await codeOf(schedules.addSlot(noTeacher, slot('MONDAY', '18:00', '19:00'), actor, tx))).toBe('NO_ERROR'); // no Teacher: no conflict
      expect(await codeOf(schedules.addSlot(noTeacher, slot('MONDAY', '20:00', '21:00'), actor, tx))).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT'); // no Teacher: still one per weekday
      expect(await codeOf(schedules.addSlot(g2, slot('MONDAY', '18:30', '19:30'), actor, tx))).toBe('TEACHER_SCHEDULE_CONFLICT');
      expect(await codeOf(schedules.addSlot(g2, slot('MONDAY', '19:00', '20:00'), actor, tx))).toBe('NO_ERROR'); // touching: fine
      const clash = await schedules.addSlot(g2, slot('TUESDAY', '18:00', '19:00'), actor, tx);
      expect(await codeOf(schedules.changeSlot(g2, clash.id, { dayOfWeek: 'MONDAY' }, actor, tx))).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
      const other = await schedules.addSlot(g2, slot('SUNDAY', '18:00', '19:00'), actor, tx);
      expect(school).toBeTruthy();
      expect(other.status).toBe('ACTIVE');
      // replacement keeps the history; removal retires
      const changed = await schedules.changeSlot(g1, (await schedules.listSlots(g1, tx))[0]!.id, { startTime: '17:30' }, actor, tx);
      expect(changed.startTime).toBe('17:30');
      await schedules.removeSlot(g1, changed.id, actor, tx);
      expect((await schedules.listHistory(g1, tx)).map((s) => s.retireReason)).toEqual(['REPLACED', 'REMOVED']);
      expect(await schedules.listSlots(g1, tx)).toEqual([]);
      expect(await codeOf(schedules.listSlots(randomUUID(), tx))).toBe('GROUP_NOT_FOUND');
    });
  });

  it('validates a Teacher assignment against the group\'s slots and retires the slots of an archived group (the Module 20 port)', async () => {
    await withFixture(async ({ tx, newGroup, teacher, school }) => {
      const busy = await newGroup(teacher);
      const target = await newGroup(null);
      const actor = randomUUID();
      await schedules.addSlot(busy, slot('MONDAY', '18:00', '19:00'), actor, tx);
      await schedules.addSlot(target, slot('MONDAY', '18:30', '19:30'), actor, tx);
      expect(await codeOf(schedules.assertTeacherCanTeach({ id: target, schoolId: school }, teacher, tx))).toBe('TEACHER_SCHEDULE_CONFLICT');
      await schedules.retireSlotsOfArchivedGroup(busy, actor, tx);
      expect(await codeOf(schedules.assertTeacherCanTeach({ id: target, schoolId: school }, teacher, tx))).toBe('NO_ERROR');
      expect((await schedules.listHistory(busy, tx)).map((s) => s.retireReason)).toEqual(['GROUP_ARCHIVED']);
    });
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------------------
// concurrency: committed rows with random ids, deleted afterwards
// ------------------------------------------------------------------------------------------------------------------------------------------------
interface Committed {
  groupIds: string[];
  teacherIds: string[];
}

/** Creates the groups (committed) and always deletes everything it created, whatever the outcome. */
async function withCommittedGroups(teacherOf: Array<string | null>, work: (ids: string[], schoolId: string) => Promise<void>): Promise<void> {
  const created: Committed = { groupIds: [], teacherIds: [...new Set(teacherOf.filter((t): t is string => t !== null))] };
  const schoolId = randomUUID();
  try {
    for (const teacherId of teacherOf) {
      const g = newGroupEntity(schoolId, teacherId);
      await uow.run((tx) => groupRepo.insert(g, tx));
      created.groupIds.push(g.id);
      everCreated.add(g.id);
    }
    await work(created.groupIds, schoolId);
  } finally {
    if (created.groupIds.length > 0) {
      await sequelize.query('DELETE FROM group_schedule_slots WHERE group_id IN (:ids)', { replacements: { ids: created.groupIds } });
      await sequelize.query('DELETE FROM school_groups WHERE id IN (:ids)', { replacements: { ids: created.groupIds } });
    }
    if (created.teacherIds.length > 0) await sequelize.query('DELETE FROM schedule_teacher_locks WHERE teacher_id IN (:ids)', { replacements: { ids: created.teacherIds } });
  }
}

interface ActiveRow {
  groupId: string;
  teacherId: string | null;
  slotTeacherId: string | null;
  day: number;
  start: number;
  end: number;
}
/** The invariants of the whole schedule of the given groups: ONE active slot per weekday per group, every slot carries its group's current Teacher, and no overlap in a Teacher's slots. */
async function assertInvariants(ids: string[]): Promise<ActiveRow[]> {
  const rows = await sequelize.query<ActiveRow>(
    `SELECT s.group_id AS groupId, g.teacher_id AS teacherId, s.teacher_id AS slotTeacherId, s.day_of_week AS day, s.start_minute AS start, s.end_minute AS end
       FROM group_schedule_slots s JOIN school_groups g ON g.id = s.group_id WHERE s.active = 1 AND s.group_id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  const perGroupDay = new Set<string>();
  for (const r of rows) {
    expect(r.slotTeacherId, `the slot of group ${r.groupId} carries the group's current Teacher`).toBe(r.teacherId);
    const key = `${r.groupId}:${r.day}`;
    expect(perGroupDay.has(key), `two active slots for ${key}`).toBe(false);
    perGroupDay.add(key);
  }
  for (const a of rows) {
    for (const b of rows) {
      if (a === b || a.teacherId === null || a.teacherId !== b.teacherId || a.day !== b.day) continue;
      const overlap = a.start < b.end && b.start < a.end;
      expect(overlap, `Teacher ${a.teacherId} overlaps on day ${a.day}: ${a.start}-${a.end} vs ${b.start}-${b.end}`).toBe(false);
    }
  }
  return rows;
}

const DOMAIN_ERRORS = new Set(['SCHEDULE_DAY_ALREADY_HAS_SLOT', 'TEACHER_SCHEDULE_CONFLICT']);
async function outcomes(tasks: Array<Promise<unknown>>): Promise<string[]> {
  return (await Promise.allSettled(tasks)).map((r) => (r.status === 'fulfilled' ? 'OK' : r.reason instanceof AppError ? r.reason.code : `OTHER:${String(r.reason)}`));
}
const count = (list: string[], what: string) => list.filter((x) => x === what).length;

/**
 * A run that was KILLED (Ctrl+C, a time limit) cannot clean up after itself, so the next run removes what an interrupted run left behind. Only rows that are
 * unmistakably this file's are touched: the generated name (`حلقة اختبار <8 hex> <n>`), a school that does not exist (a real group always has one), and older
 * than 15 minutes (so a run that is still in progress, even in another process, is never disturbed).
 */
async function removeLeftoversOfInterruptedRuns(): Promise<void> {
  const stale = await sequelize.query<{ id: string; teacherId: string | null }>(
    `SELECT id, teacher_id AS teacherId FROM school_groups
      WHERE name REGEXP '^حلقة اختبار [0-9a-f]{8} [0-9]+$' AND created_at < NOW(3) - INTERVAL 15 MINUTE AND school_id NOT IN (SELECT id FROM schools)`,
    { type: QueryTypes.SELECT },
  );
  if (stale.length === 0) return;
  const ids = stale.map((r) => r.id);
  const teacherIds = [...new Set(stale.map((r) => r.teacherId).filter((t): t is string => t !== null))];
  await sequelize.query('DELETE FROM group_schedule_slots WHERE group_id IN (:ids)', { replacements: { ids } });
  await sequelize.query('DELETE FROM school_groups WHERE id IN (:ids)', { replacements: { ids } });
  if (teacherIds.length > 0) await sequelize.query('DELETE FROM schedule_teacher_locks WHERE teacher_id IN (:ids)', { replacements: { ids: teacherIds } });
}

describe('concurrency (committed rows, cleaned up afterwards)', () => {
  beforeAll(removeLeftoversOfInterruptedRuns);

  it('two simultaneous requests for the SAME group and weekday: exactly one slot is created, the rest are refused', async () => {
    await withCommittedGroups([null, randomUUID()], async ([bare, withTeacher]) => {
      for (const id of [bare!, withTeacher!]) {
        for (let round = 0; round < 3; round += 1) {
          const day = ['MONDAY', 'TUESDAY', 'WEDNESDAY'][round]!;
          const results = await outcomes(
            ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00'].map((start) => schedules.addSlot(id, slot(day, start, `${start.slice(0, 2)}:30`), randomUUID())),
          );
          expect(count(results, 'OK'), `${id} ${day}: ${results.join(',')}`).toBe(1);
          expect(count(results, 'SCHEDULE_DAY_ALREADY_HAS_SLOT')).toBe(5);
        }
        expect(await schedules.listSlots(id)).toHaveLength(3);
      }
      await assertInvariants([bare!, withTeacher!]);
    });
  }, 60_000);

  it('simultaneous OVERLAPPING slots in different groups of the SAME Teacher: exactly one passes, the others get the conflict (never a technical error)', async () => {
    const teacher = randomUUID();
    await withCommittedGroups([teacher, teacher, teacher, teacher, teacher, teacher], async (ids) => {
      for (const day of ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const) {
        const starts = ['18:00', '18:15', '18:30', '18:45', '18:50', '18:58']; // all of them end at 19:59, so every pair overlaps
        const results = await outcomes(ids.map((id, i) => schedules.addSlot(id, slot(day, starts[i]!, '19:59'), randomUUID())));
        const technical = results.filter((r) => r !== 'OK' && !DOMAIN_ERRORS.has(r));
        expect(technical, results.join(',')).toEqual([]);
        expect(count(results, 'OK'), `${day}: ${results.join(',')}`).toBe(1);
        expect(count(results, 'TEACHER_SCHEDULE_CONFLICT')).toBe(5);
      }
      await assertInvariants(ids);
    });
  }, 120_000);

  it('simultaneous slots that only TOUCH never conflict: all of them are created', async () => {
    const teacher = randomUUID();
    await withCommittedGroups([teacher, teacher, teacher, teacher, teacher, teacher], async (ids) => {
      const results = await outcomes(ids.map((id, i) => schedules.addSlot(id, slot('SUNDAY', `${String(8 + i).padStart(2, '0')}:00`, `${String(9 + i).padStart(2, '0')}:00`), randomUUID())));
      expect(results, results.join(',')).toEqual(Array(6).fill('OK'));
      expect(await assertInvariants(ids)).toHaveLength(6);
    });
  }, 60_000);

  it('different Teachers and groups without a Teacher never block each other', async () => {
    const [t1, t2] = [randomUUID(), randomUUID()];
    await withCommittedGroups([t1, t2, null, null], async (ids) => {
      const results = await outcomes(ids.map((id) => schedules.addSlot(id, slot('MONDAY', '18:00', '19:00'), randomUUID())));
      expect(results).toEqual(['OK', 'OK', 'OK', 'OK']);
    });
  }, 60_000);

  it('simultaneous CHANGES (atomic replacement) that would overlap: the Teacher never ends with an overlap and no slot is lost', async () => {
    const teacher = randomUUID();
    await withCommittedGroups([teacher, teacher, teacher, teacher], async (ids) => {
      const created = await Promise.all(ids.map((id, i) => schedules.addSlot(id, slot('MONDAY', `${String(8 + i * 2).padStart(2, '0')}:00`, `${String(9 + i * 2).padStart(2, '0')}:00`), randomUUID())));
      for (let round = 0; round < 4; round += 1) {
        const current = await Promise.all(ids.map((id) => schedules.listSlots(id)));
        const results = await outcomes(current.map(([s], i) => schedules.changeSlot(ids[i]!, s!.id, { startTime: '14:00', endTime: '15:00' }, randomUUID())));
        const technical = results.filter((r) => r !== 'OK' && !DOMAIN_ERRORS.has(r));
        expect(technical, results.join(',')).toEqual([]);
        expect(count(results, 'OK')).toBe(1);
        await assertInvariants(ids);
        // put the winner back where it was so the next round starts from four distinct, non-overlapping slots
        const after = await Promise.all(ids.map((id) => schedules.listSlots(id)));
        for (const [i, [s]] of after.entries()) expect(s, `group ${i} still has exactly one active slot`).toBeDefined();
        for (const [i, [s]] of after.entries()) {
          if (s!.startTime === '14:00') await schedules.changeSlot(ids[i]!, s!.id, { startTime: `${String(8 + i * 2).padStart(2, '0')}:00`, endTime: `${String(9 + i * 2).padStart(2, '0')}:00` }, randomUUID());
        }
      }
      expect(created).toHaveLength(4);
      await assertInvariants(ids);
    });
  }, 120_000);

  it('a Teacher ASSIGNMENT racing a slot change: whichever commits first wins, and the other is refused (the Module 20 lock order: group row, then the Teacher)', async () => {
    for (let round = 0; round < 8; round += 1) {
      const teacher = randomUUID();
      await withCommittedGroups([teacher, null], async ([mine, target]) => {
        await schedules.addSlot(mine!, slot('MONDAY', '18:00', '19:00'), randomUUID());
        await schedules.addSlot(target!, slot('MONDAY', '19:00', '20:00'), randomUUID()); // bare group, only TOUCHING the Teacher's group: the assignment itself can succeed
        // what Module 20's assignTeacher does: lock the group row, validate the new Teacher against the schedule, then change the Teacher
        const assign = async () => {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
              await uow.run(async (tx) => {
                const group = await groups.lockScopeById(target!, tx);
                await schedules.assertTeacherCanTeach({ id: group!.id, schoolId: group!.schoolId }, teacher, tx);
                await sequelize.query('UPDATE school_groups SET teacher_id = :teacher WHERE id = :id', { replacements: { teacher, id: target }, transaction: sequelizeTransactionOf(tx) ?? null });
                await schedules.onTeacherChanged(target!, teacher, tx); // Module 20's saveTeacher: the slots follow the Teacher
              });
              return;
            } catch (error) {
              if (!(error instanceof AppError) || error.code !== 'SCHEDULE_CONCURRENT_MODIFICATION') throw error; // a deadlock victim is retried by the client
            }
          }
          throw new Error('assignment kept losing deadlocks');
        };
        // the slot change that would also conflict with the Teacher's group
        const results = await outcomes([assign(), schedules.addSlot(mine!, slot('TUESDAY', '18:00', '19:00'), randomUUID()), schedules.addSlot(target!, slot('TUESDAY', '18:15', '19:15'), randomUUID())]);
        const technical = results.filter((r) => r !== 'OK' && !DOMAIN_ERRORS.has(r));
        expect(technical, results.join(',')).toEqual([]);
        await assertInvariants([mine!, target!]); // whoever won: no overlap, and every slot carries its group's current Teacher
      });
    }
  }, 180_000);

  it('the Teacher check reads CURRENT data, not the snapshot the transaction started with (Module 20 reads before it calls the check)', async () => {
    const teacher = randomUUID();
    await withCommittedGroups([teacher, null], async ([mine, target]) => {
      await schedules.addSlot(target!, slot('MONDAY', '18:30', '19:30'), randomUUID()); // the group about to get the Teacher
      let release!: () => void;
      let reached!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const atGate = new Promise<void>((resolve) => { reached = resolve; });
      const assignment = uow.run(async (tx) => {
        const transaction = sequelizeTransactionOf(tx) ?? null;
        const group = await groups.lockScopeById(target!, tx); // Module 20: lock the group row...
        await sequelize.query('SELECT COUNT(*) AS n FROM school_groups WHERE id = :id', { replacements: { id: target }, type: QueryTypes.SELECT, transaction }); // ...then a plain read (the Teacher lookup): the snapshot starts HERE
        reached();
        await gate; // meanwhile another request commits an overlapping slot for the Teacher's other group
        await schedules.assertTeacherCanTeach({ id: group!.id, schoolId: group!.schoolId }, teacher, tx);
      });
      await atGate;
      await schedules.addSlot(mine!, slot('MONDAY', '18:00', '19:00'), randomUUID()); // committed after the assignment's snapshot was taken
      release();
      expect(await codeOf(assignment)).toBe('TEACHER_SCHEDULE_CONFLICT'); // it must see that committed slot
    });
  }, 60_000);

  it('a Teacher assignment that succeeds moves the group\'s slots to the new Teacher (Module 20\'s order: validate, change the Teacher, then onTeacherChanged), and a removal frees them', async () => {
    const teacher = randomUUID();
    await withCommittedGroups([teacher, null], async ([mine, target]) => {
      await schedules.addSlot(mine!, slot('MONDAY', '18:00', '19:00'), randomUUID());
      await schedules.addSlot(target!, slot('MONDAY', '19:00', '20:00'), randomUUID()); // touching only
      const change = (teacherId: string | null) =>
        uow.run(async (tx) => {
          const group = await groups.lockScopeById(target!, tx);
          if (teacherId) await schedules.assertTeacherCanTeach({ id: group!.id, schoolId: group!.schoolId }, teacherId, tx);
          await sequelize.query('UPDATE school_groups SET teacher_id = :teacher WHERE id = :id', { replacements: { teacher: teacherId, id: target }, transaction: sequelizeTransactionOf(tx) ?? null });
          await schedules.onTeacherChanged(target!, teacherId, tx);
        });
      await change(teacher);
      expect(await assertInvariants([mine!, target!])).toHaveLength(2);
      expect(await codeOf(schedules.addSlot(target!, slot('MONDAY', '18:30', '19:30'), randomUUID()))).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT'); // the weekday rule still comes first
      expect(await codeOf(schedules.addSlot(target!, slot('TUESDAY', '08:00', '09:00'), randomUUID()))).toBe('NO_ERROR');
      expect(await codeOf(schedules.addSlot(mine!, slot('TUESDAY', '08:30', '09:30'), randomUUID()))).toBe('TEACHER_SCHEDULE_CONFLICT'); // the moved slot counts for the Teacher now
      await change(null);
      expect(await codeOf(schedules.addSlot(mine!, slot('TUESDAY', '08:30', '09:30'), randomUUID()))).toBe('NO_ERROR'); // the former Teacher is free again; the slots stayed
      expect((await schedules.listSlots(target!)).map((s) => s.dayOfWeek)).toEqual(['MONDAY', 'TUESDAY']);
      await assertInvariants([mine!, target!]);
    });
  }, 60_000);

  it('simultaneous removals and additions on the same weekday leave at most one active slot, never a technical error', async () => {
    await withCommittedGroups([null], async ([id]) => {
      const first = await schedules.addSlot(id!, slot('MONDAY', '18:00', '19:00'), randomUUID());
      const results = await outcomes([
        schedules.removeSlot(id!, first.id, randomUUID()),
        schedules.addSlot(id!, slot('MONDAY', '20:00', '21:00'), randomUUID()),
        schedules.addSlot(id!, slot('MONDAY', '21:00', '22:00'), randomUUID()),
      ]);
      const technical = results.filter((r) => r !== 'OK' && !DOMAIN_ERRORS.has(r) && r !== 'SCHEDULE_SLOT_NOT_FOUND');
      expect(technical, results.join(',')).toEqual([]);
      expect((await schedules.listSlots(id!)).length).toBeLessThanOrEqual(1);
      await assertInvariants([id!]);
    });
  }, 60_000);

  it('left nothing behind: none of the groups this file committed, and no slot of theirs, remains', async () => {
    expect(everCreated.size).toBeGreaterThan(0);
    const ids = [...everCreated];
    const [{ groupsLeft }] = await sequelize.query<{ groupsLeft: number }>('SELECT COUNT(*) AS groupsLeft FROM school_groups WHERE id IN (:ids)', { replacements: { ids }, type: QueryTypes.SELECT });
    const [{ slotsLeft }] = await sequelize.query<{ slotsLeft: number }>('SELECT COUNT(*) AS slotsLeft FROM group_schedule_slots WHERE group_id IN (:ids)', { replacements: { ids }, type: QueryTypes.SELECT });
    expect([Number(groupsLeft), Number(slotsLeft)]).toEqual([0, 0]);
  });
});
