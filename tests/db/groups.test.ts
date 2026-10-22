/**
 * Real-database checks for Module 20 (Groups): the schema (one ACTIVE name per school, one CURRENT group per student, the CHECKs, the RESTRICT keys to
 * this module's own table only), the SQL repository, the real GroupService against it (create, names, Teacher, assignments, moves, archive, the Students
 * event consumer), the Module 18 unlink guard with the real locking count, the Module 19 Teacher read join, and atomic rollback. NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: every test runs in ONE outer transaction that is ALWAYS rolled back, so existing data is never changed.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, SystemClock, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { OutboxService, SequelizeOutboxStore } from '../../src/modules/06-domain-events-outbox/public';
import { BcryptPasswordHasher, IdentityService, SequelizeUserRepository } from '../../src/modules/08-identity-core/public';
import { PermissionRegistry, RoleService, SequelizeRoleAssignmentRepository } from '../../src/modules/09-roles-permissions/public';
import { OrganizationService, SequelizeOrganizationAdminRepository, SequelizeOrganizationRepository } from '../../src/modules/13-organization-core/public';
import { GeographyService, SequelizeGeographyRepository } from '../../src/modules/14-geography/public';
import { UnifiedAddressService } from '../../src/modules/15-unified-address/public';
import { SchoolService, SequelizeSchoolCodeSequence, SequelizeSchoolManagerRepository, SequelizeSchoolRepository } from '../../src/modules/16-schools/public';
import { ParentService, SequelizeParentRepository, SequelizeParentSchoolLinkRepository } from '../../src/modules/17-parents/public';

import { SequelizeTeacherRepository, SequelizeTeacherSchoolLinkRepository, TeacherService } from '../../src/modules/18-teachers/public';
import { SequelizeStudentRepository, StudentService } from '../../src/modules/19-students/public';
import { Group, GroupService, SequelizeGroupRepository, createStudentArchivedHandler } from '../../src/modules/20-groups/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const outbox = new OutboxService(new SequelizeOutboxStore(sequelize));
const identity = new IdentityService({ repository: new SequelizeUserRepository(sequelize), hasher: new BcryptPasswordHasher(4), unitOfWork: uow, outbox });
const roleService = new RoleService({ repository: new SequelizeRoleAssignmentRepository(sequelize), identity, permissions: new PermissionRegistry(), unitOfWork: uow, outbox });
const organizations = new OrganizationService({ repository: new SequelizeOrganizationRepository(sequelize), admins: new SequelizeOrganizationAdminRepository(sequelize), unitOfWork: uow, outbox });
const geography = new GeographyService(new SequelizeGeographyRepository(sequelize));

class Rollback extends Error {}
const swallowRollback = (error: unknown) => {
  if (!(error instanceof Rollback)) throw error;
};
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `OTHER:${(e as Error).message}`));
const gps = { latitude: 30.0444444, longitude: 31.2357116, accuracyMeters: 12.5 };

interface Fixture {
  tx: TransactionContext;
  q: <T extends object>(sql: string, replacements?: Record<string, unknown>) => Promise<T[]>;
  run: (sql: string, replacements?: Record<string, unknown>) => Promise<void>;
  /** The statement must fail (constraint); the transaction stays usable (savepoint). */
  fails: (sql: string, replacements?: Record<string, unknown>) => Promise<void>;
  parents: ParentService;
  teachers: TeacherService;
  students: StudentService;
  groups: GroupService;
  groupRepo: SequelizeGroupRepository;
  newTeacher: (schoolId: string, name?: string) => Promise<{ id: string }>;
  newStudent: (schoolId: string, parentId: string, over?: Record<string, unknown>) => Promise<{ id: string; fullName: string }>;
  newGroup: (schoolId: string, over?: Record<string, unknown>) => Promise<{ id: string; name: string }>;
  school: { id: string };
  school2: { id: string };
  manager: string;
  organizationId: string;
  newParent: (schoolId: string, name?: string) => Promise<{ id: string }>;
}

let counter = 0;
async function withFixture(work: (f: Fixture) => Promise<void>, options: { failLinkInsert?: boolean } = {}): Promise<void> {
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

      const stamp = String(Math.floor(Math.random() * 90000) + 10000);
      const country = randomUUID();
      const gov = randomUUID();
      const governorateName = `محافظة آباء ${stamp}`;
      await run(`INSERT INTO countries (id, code, name, status, created_at, updated_at) VALUES (:id, :code, :name, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: country, code: `CNT-6${stamp}`, name: `دولة آباء ${stamp}` });
      await run(`INSERT INTO governorates (id, code, name, status, country_id, created_at, updated_at) VALUES (:id, :code, :name, 'ACTIVE', :country, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: gov, code: `GOV-6${stamp}`, name: governorateName, country });
      const organization = await organizations.createOrganization({ name: `Students DB test organization ${stamp}`, countryId: country, governorateId: gov }, tx);

      let phone = Math.floor(Math.random() * 40000);
      const newUser = async (role?: string) => {
        const user = await identity.createUser({ phone: `+2010993${String(++phone).padStart(5, '0')}`, password: 'secret1' }, tx);
        if (role) await roleService.assignRole({ userId: user.id, roleCode: role, assignedBy: null }, tx);
        return user.id;
      };
      const admin = await newUser('ORGANIZATION_MANAGER');
      await organizations.assignOrganizationAdmin({ organizationId: organization.id, userId: admin, assignedBy: null }, tx);

      let operation = 0;
      const savepointUnitOfWork: UnitOfWork = {
        run: async (inner) => {
          const name = `op_${++operation}`;
          await run(`SAVEPOINT ${name}`);
          try {
            const result = await uow.run(inner);
            await run(`RELEASE SAVEPOINT ${name}`);
            return result;
          } catch (error) {
            await run(`ROLLBACK TO SAVEPOINT ${name}`);
            throw error;
          }
        },
      };
      const address = new UnifiedAddressService({ geography, organizations });
      const schools = new SchoolService({
        repository: new SequelizeSchoolRepository(sequelize),
        managers: new SequelizeSchoolManagerRepository(sequelize),
        codes: new SequelizeSchoolCodeSequence(sequelize),
        unitOfWork: savepointUnitOfWork,
        outbox,
        organizations,
        address,
        identity,
        roles: roleService,
        generateApplicantPassword: () => 'Qx7mK2pL9vTn',
      });
      const newSchool = async (name: string) => {
        const created = await schools.createSchool({ actorId: admin, organizationId: organization.id, name: `${name} ${stamp}`, governorateId: gov, gps }, tx);
        await schools.approveSchool(created.id, admin, tx);
        return created;
      };
      const school = await newSchool('مدرسة أ');
      const school2 = await newSchool('مدرسة ب');
      const manager = await newUser('SCHOOL_MANAGER');
      await schools.assignSchoolManager({ schoolId: school.id, userId: manager, actorId: admin }, tx);

      // The real Students guard is installed lazily, exactly like src/config/parents.ts does.
      let students: StudentService | undefined;
      const parents = new ParentService({
        parents: new SequelizeParentRepository(sequelize),
        links: new SequelizeParentSchoolLinkRepository(sequelize),
        schools,
        address,
        identity,
        roles: roleService,
        studentDependencies: { countStudentsOfParentInSchool: (parentId, schoolId, t) => students!.countStudentsOfParentInSchool(parentId, schoolId, t) },
        unitOfWork: savepointUnitOfWork,
        outbox,
      });
      const studentRepo = new SequelizeStudentRepository(sequelize);
      students = new StudentService({ students: studentRepo, schools, parents, unitOfWork: savepointUnitOfWork, outbox });
      const newParent: Fixture['newParent'] = async (schoolId, name = 'أحمد محمد علي') => {
        const result = await parents.registerParent({ schoolId, name, phone: phoneOf(), address: { kind: 'raw', text: `${governorateName} / سمالوط / برمشا` } }, manager, tx);
        return result.parent;
      };
      // The real Groups guard is installed lazily, exactly like src/config/teachers.ts does.
      let groups: GroupService | undefined;
      const teacherLinks = new SequelizeTeacherSchoolLinkRepository(sequelize);
      const teachers = new TeacherService({
        teachers: new SequelizeTeacherRepository(sequelize),
        links: options.failLinkInsert
          ? (Object.assign(Object.create(teacherLinks) as SequelizeTeacherSchoolLinkRepository, {
              insert: async () => {
                throw new Error('injected failure while linking');
              },
            }) as SequelizeTeacherSchoolLinkRepository)
          : teacherLinks,
        schools,
        identity,
        roles: roleService,
        parents,
        groupDependencies: { countGroupsOfTeacherInSchool: (teacherId, schoolId, t) => groups!.countGroupsOfTeacherInSchool(teacherId, schoolId, t) },
        unitOfWork: savepointUnitOfWork,
        outbox,
      });
      const groupRepo = new SequelizeGroupRepository(sequelize);
      groups = new GroupService({ groups: groupRepo, schools, teachers, students, unitOfWork: savepointUnitOfWork, outbox });
      const newTeacher: Fixture['newTeacher'] = async (schoolId, name = 'خالد أحمد حسن') => (await teachers.registerTeacher({ schoolId, name, phone: phoneOf() }, manager, tx)).teacher;
      const newStudent: Fixture['newStudent'] = async (schoolId, parentId, over = {}) =>
        students!.registerStudent({ schoolId, parentId, fullName: 'عمر أحمد محمد', nationalId: nationalIdOf(), ...over }, manager, tx);
      let groupSeq = 0;
      const newGroup: Fixture['newGroup'] = async (schoolId, over = {}) => groups!.createGroup({ schoolId, name: `حلقة ${stamp} ${++groupSeq}`, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, ...over } as never, manager, tx);
      await work({ tx, q, run, fails, parents, teachers, students, groups, groupRepo, newTeacher, newStudent, newGroup, school, school2, manager, organizationId: organization.id, newParent });
      throw new Rollback();
    });
  } catch (error) {
    swallowRollback(error);
  }
}

afterAll(async () => {
  await sequelize.close();
});

const phoneOf = () => `010${String(70000000 + ++counter * 7 + Math.floor(Math.random() * 1000000)).slice(-8)}`;
const nationalIdOf = () => `3${String(Date.now()).slice(-9)}${String(++counter).padStart(4, '0')}`;
const insertGroupSql = `INSERT INTO school_groups (id, school_id, organization_id, name, name_key, teacher_id, learning_mode, progression, starting_surah, status, active, created_by, version, created_at, updated_at)
  VALUES (:id, :school, :org, :name, :key, NULL, :mode, :progression, :surah, :status, :active, :actor, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
const insertAssignmentSql = `INSERT INTO group_students (id, group_id, student_id, school_id, organization_id, assigned_at, assigned_by, unassigned_at, unassigned_by, end_reason, active)
  VALUES (:id, :group, :student, :school, :org, UTC_TIMESTAMP(3), :actor, :unassignedAt, NULL, :endReason, :active)`;

describe('groups schema (migration create-groups)', () => {
  it('has the three tables, ONLY RESTRICT keys to school_groups, the unique indexes and the CHECKs', async () => {
    const fks = await sequelize.query<{ TABLE_NAME: string; REFERENCED_TABLE_NAME: string; DELETE_RULE: string; UPDATE_RULE: string }>(
      `SELECT TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE, UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('school_groups','group_students','group_history') ORDER BY TABLE_NAME`,
      { type: QueryTypes.SELECT },
    );
    expect(fks.map((f) => `${f.TABLE_NAME}->${f.REFERENCED_TABLE_NAME}:${f.DELETE_RULE}/${f.UPDATE_RULE}`)).toEqual(['group_history->school_groups:RESTRICT/RESTRICT', 'group_students->school_groups:RESTRICT/RESTRICT']);
    const indexColumns = async (table: string, index: string) =>
      (await sequelize.query<{ COLUMN_NAME: string }>(`SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND INDEX_NAME = :index AND NON_UNIQUE = 0 ORDER BY SEQ_IN_INDEX`, { replacements: { table, index }, type: QueryTypes.SELECT })).map((c) => c.COLUMN_NAME);
    expect(await indexColumns('school_groups', 'uq_school_groups_active_name')).toEqual(['school_id', 'name_key', 'active']);
    expect(await indexColumns('group_students', 'uq_group_students_current')).toEqual(['student_id', 'active']);
    const checks = await sequelize.query<{ CONSTRAINT_NAME: string }>(`SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND (CONSTRAINT_NAME LIKE 'ck_school_groups%' OR CONSTRAINT_NAME LIKE 'ck_group_%')`, { type: QueryTypes.SELECT });
    expect(checks.map((c) => c.CONSTRAINT_NAME)).toEqual(expect.arrayContaining(['ck_school_groups_status', 'ck_school_groups_mode', 'ck_school_groups_progression', 'ck_school_groups_surah', 'ck_school_groups_name', 'ck_group_students_period', 'ck_group_history_action']));
  });

  it('one ACTIVE name per school (any number of ARCHIVED ones), one CURRENT group per student (any number of ended periods), and the CHECKs', async () => {
    await withFixture(async ({ q, run, fails, school, school2, manager, organizationId }) => {
      const row = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), school: school.id, org: organizationId, name: 'حلقة', key: 'حلقة', mode: 'GROUP', progression: 'FORWARD', surah: 78, status: 'ACTIVE', active: 1, actor: manager, ...over });
      await run(insertGroupSql, row());
      await fails(insertGroupSql, row()); // same school, same ACTIVE name
      await run(insertGroupSql, row({ school: school2.id })); // another school: allowed
      await run(insertGroupSql, row({ status: 'ARCHIVED', active: null })); // archived duplicates are allowed, any number
      await run(insertGroupSql, row({ status: 'ARCHIVED', active: null }));
      await fails(insertGroupSql, row({ key: 'x', status: 'ARCHIVED', active: 1 })); // status / active mismatch
      await fails(insertGroupSql, row({ key: 'y', status: 'ACTIVE', active: null }));
      await fails(insertGroupSql, row({ key: 'z', mode: 'BOTH' }));
      await fails(insertGroupSql, row({ key: 'z', progression: 'SIDEWAYS' }));
      for (const surah of [0, 115]) await fails(insertGroupSql, row({ key: `s${surah}`, surah }));
      await fails(insertGroupSql, row({ key: 'b', name: '   ' }));
      expect((await q<{ n: number }>(`SELECT COUNT(*) AS n FROM school_groups WHERE school_id = :s AND name_key = 'حلقة'`, { s: school.id }))[0]!.n).toBe(3);

      const group = row({ key: 'للطلاب' });
      await run(insertGroupSql, group);
      const student = randomUUID();
      const period = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), group: group.id, student, school: school.id, org: organizationId, actor: manager, unassignedAt: null, endReason: null, active: 1, ...over });
      await run(insertAssignmentSql, period());
      await fails(insertAssignmentSql, period()); // a second CURRENT group for the same student
      await run(insertAssignmentSql, period({ unassignedAt: '2026-10-01 10:00:00.000', endReason: 'MOVED', active: null })); // ended periods: any number
      await run(insertAssignmentSql, period({ unassignedAt: '2026-10-02 10:00:00.000', endReason: 'MANUAL', active: null }));
      await fails(insertAssignmentSql, period({ student: randomUUID(), unassignedAt: '2026-10-01 10:00:00.000', endReason: 'MANUAL', active: 1 })); // current but with an end
      await fails(insertAssignmentSql, period({ student: randomUUID(), unassignedAt: '2026-10-01 10:00:00.000', endReason: 'EXPELLED', active: null })); // unknown reason
      await fails(insertAssignmentSql, period({ student: randomUUID(), unassignedAt: null, endReason: null, active: null })); // ended without an end
    });
  });

  it('refuses to delete a group that has history or assignments (RESTRICT)', async () => {
    await withFixture(async ({ fails, groups, newGroup, newParent, newStudent, school, manager, tx }) => {
      const g = await newGroup(school.id);
      const parent = await newParent(school.id);
      const s = await newStudent(school.id, parent.id);
      await groups.assignStudent(g.id, s.id, manager, tx);
      await fails(`DELETE FROM school_groups WHERE id = :id`, { id: g.id });
    });
  });
});

describe('GroupService against the real database', () => {
  it('creates a group with its Teacher, history and a GroupCreated event; names are unique among ACTIVE groups and the unique index is the final guard', async () => {
    await withFixture(async ({ q, groups, groupRepo, newTeacher, school, school2, manager, organizationId, tx }) => {
      const teacher = await newTeacher(school.id);
      const g = await groups.createGroup({ schoolId: school.id, name: 'حلقة الفجر', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, teacherId: teacher.id }, manager, tx);
      expect(g).toMatchObject({ status: 'ACTIVE', startingSurah: 78, teacher: { id: teacher.id } });
      expect((await groups.listHistory(g.id, tx)).map((h) => h.action)).toEqual(['CREATED']);
      expect((await q<{ eventType: string }>(`SELECT event_type AS eventType FROM outbox_messages WHERE aggregate_id = :id`, { id: g.id })).map((e) => e.eventType)).toEqual(['GroupCreated']);
      expect(await codeOf(groups.createGroup({ schoolId: school.id, name: 'حلقة الفجر', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 1 }, manager, tx))).toBe('GROUP_NAME_CONFLICT');
      // Bypass the application check: the repository maps the database duplicate error to the same code.
      const twin = Group.register({ schoolId: school.id, organizationId, name: 'حلقة الفجر', teacherId: null, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 1, createdBy: manager, clock: new SystemClock() });
      expect(await codeOf(groupRepo.insert(twin, tx))).toBe('GROUP_NAME_CONFLICT');
      expect((await groups.createGroup({ schoolId: school2.id, name: 'حلقة الفجر', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 1 }, manager, tx)).schoolId).toBe(school2.id);
      // Arabic letters are never folded by the database either (byte-for-byte name key).
      await groups.createGroup({ schoolId: school.id, name: 'حلقة أحمد', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 1 }, manager, tx);
      expect((await groups.createGroup({ schoolId: school.id, name: 'حلقة احمد', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 1 }, manager, tx)).name).toBe('حلقة احمد');
    });
  });

  it('an ARCHIVED group frees its name; settings changes keep the previous values; the optimistic lock refuses a stale update', async () => {
    await withFixture(async ({ groups, groupRepo, newGroup, school, manager, tx }) => {
      const g = await newGroup(school.id, { name: 'حلقة العصر' });
      const stale = (await groupRepo.findById(g.id, tx))!;
      await groups.updateGroup(g.id, { progression: 'BACKWARD', startingSurah: 114, learningMode: 'INDIVIDUAL' }, manager, tx);
      const history = await groups.listHistory(g.id, tx);
      expect(history[1]).toMatchObject({ action: 'UPDATED', previousProgression: 'FORWARD', newProgression: 'BACKWARD', previousStartingSurah: 78, newStartingSurah: 114, previousLearningMode: 'GROUP', newLearningMode: 'INDIVIDUAL' });
      stale.updateSettings({ name: 'اسم قديم' }, manager, new SystemClock());
      expect(await codeOf(groupRepo.update(stale, tx))).toBe('GROUP_CONCURRENT_MODIFICATION');
      await groups.archiveGroup(g.id, 'انتهت', manager, tx);
      expect((await groups.createGroup({ schoolId: school.id, name: 'حلقة العصر', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 1 }, manager, tx)).name).toBe('حلقة العصر');
      expect(await codeOf(groups.updateGroup(g.id, { name: 'x' }, manager, tx))).toBe('GROUP_ARCHIVED');
    });
  });

  it('assigns, refuses a second group, moves (one period ends, another starts), unassigns, and keeps every period in the history', async () => {
    await withFixture(async ({ q, groups, newGroup, newParent, newStudent, school, manager, tx }) => {
      const a = await newGroup(school.id, { name: 'A' });
      const b = await newGroup(school.id, { name: 'B' });
      const parent = await newParent(school.id);
      const s = await newStudent(school.id, parent.id);
      await groups.assignStudent(a.id, s.id, manager, tx);
      expect(await codeOf(groups.assignStudent(b.id, s.id, manager, tx))).toBe('GROUP_STUDENT_ALREADY_ASSIGNED');
      await groups.moveStudent(a.id, s.id, b.id, manager, tx);
      await groups.unassignStudent(b.id, s.id, manager, tx);
      const periods = await groups.listAssignmentHistoryOfStudent(s.id, tx);
      expect(periods.map((p) => [p.groupName, p.endReason, p.unassignedBy === manager])).toEqual([['A', 'MOVED', true], ['B', 'MANUAL', true]]);
      expect((await q<{ n: number }>(`SELECT COUNT(*) AS n FROM group_students WHERE student_id = :id AND active = 1`, { id: s.id }))[0]!.n).toBe(0);
      expect((await groups.listStudentsOfGroup(a.id, { page: 1, pageSize: 10 }, 'asc', tx)).items).toEqual([]);
    });
  });

  it('archiving a group unassigns every student atomically (GROUP_ARCHIVED); a failure midway rolls the archive back (row counts compared before and after)', async () => {
    await withFixture(async ({ q, groups, groupRepo, teachers, newGroup, newParent, newStudent, school, manager, tx }) => {
      const g = await newGroup(school.id);
      const parent = await newParent(school.id);
      const s1 = await newStudent(school.id, parent.id);
      const s2 = await newStudent(school.id, parent.id, { fullName: 'يوسف أحمد محمد' });
      await groups.assignStudent(g.id, s1.id, manager, tx);
      await groups.assignStudent(g.id, s2.id, manager, tx);

      const counts = async () => {
        const rows = await q<{ active_groups: number; current: number; history: number; events: number }>(
          `SELECT (SELECT COUNT(*) FROM school_groups WHERE id = :id AND active = 1) AS active_groups, (SELECT COUNT(*) FROM group_students WHERE group_id = :id AND active = 1) AS current,
                  (SELECT COUNT(*) FROM group_history WHERE group_id = :id) AS history, (SELECT COUNT(*) FROM outbox_messages) AS events`,
          { id: g.id },
        );
        return { active_groups: Number(rows[0]!.active_groups), current: Number(rows[0]!.current), history: Number(rows[0]!.history), events: Number(rows[0]!.events) };
      };
      const before = await counts();
      expect(before).toMatchObject({ active_groups: 1, current: 2, history: 1 });

      const failing = new GroupService({
        groups: Object.assign(Object.create(groupRepo) as SequelizeGroupRepository, {
          updateAssignment: async () => {
            throw new Error('injected failure while unassigning');
          },
        }),
        schools: groups['schools'],
        teachers,
        students: groups['students'],
        unitOfWork: groups['unitOfWork'],
        outbox: groups['outbox'],
      });
      // No `tx` here on purpose: a caller that passes its own transaction owns the atomicity; without one the service's unit of work (a savepoint in this
      // fixture) must undo EVERYTHING the failed archive had already written (the group status, its history row and its event).
      await expect(failing.archiveGroup(g.id, null, manager)).rejects.toThrow('injected failure');
      expect(await counts()).toEqual(before); // the group is still ACTIVE, both students still in it, no history row, no event

      await groups.archiveGroup(g.id, null, manager, tx);
      expect(await counts()).toMatchObject({ active_groups: 0, current: 0, history: 2 });
      for (const s of [s1, s2]) expect((await groups.listAssignmentHistoryOfStudent(s.id, tx))[0]).toMatchObject({ endReason: 'GROUP_ARCHIVED', unassignedBy: manager });
    });
  });

  it('the Students event consumer unassigns an ARCHIVED student (STUDENT_ARCHIVED, no actor) idempotently; a deactivated student stays', async () => {
    await withFixture(async ({ groups, students, newGroup, newParent, newStudent, school, manager, tx }) => {
      const g = await newGroup(school.id);
      const parent = await newParent(school.id);
      const s = await newStudent(school.id, parent.id);
      const kept = await newStudent(school.id, parent.id, { fullName: 'يوسف أحمد محمد' });
      await groups.assignStudent(g.id, s.id, manager, tx);
      await groups.assignStudent(g.id, kept.id, manager, tx);
      await students.deactivateStudent(kept.id, null, manager, tx);
      await students.archiveStudent(s.id, null, manager, tx);
      const handler = createStudentArchivedHandler(() => groups);
      const event = (studentId: string, status: string) => ({ eventType: 'StudentStatusChanged', payload: { studentId, status } }) as never;
      await handler.handle(event(kept.id, 'INACTIVE'));
      expect(await groups.unassignArchivedStudent(kept.id, tx)).toBe(false);
      expect(await groups.unassignArchivedStudent(s.id, tx)).toBe(true);
      expect(await groups.unassignArchivedStudent(s.id, tx)).toBe(false); // at-least-once delivery: the second one does nothing
      expect((await groups.listAssignmentHistoryOfStudent(s.id, tx))[0]).toMatchObject({ endReason: 'STUDENT_ARCHIVED', unassignedBy: null });
      expect((await groups.listStudentsOfGroup(g.id, { page: 1, pageSize: 10 }, 'asc', tx)).items.map((x) => x.studentId)).toEqual([kept.id]);
    });
  });

  it('the Module 18 unlink guard (locking count) blocks the unlink while the Teacher has an ACTIVE group, and an archived group no longer blocks; the Module 19 Teacher read join works', async () => {
    await withFixture(async ({ groups, teachers, newGroup, newTeacher, newParent, newStudent, school, manager, tx }) => {
      const teacher = await newTeacher(school.id);
      const other = await newTeacher(school.id, 'سعيد حسن محمود');
      const g = await newGroup(school.id, { teacherId: teacher.id });
      const parent = await newParent(school.id);
      const s = await newStudent(school.id, parent.id);
      await groups.assignStudent(g.id, s.id, manager, tx);
      expect(await groups.countGroupsOfTeacherInSchool(teacher.id, school.id, tx)).toBe(1);
      expect(await codeOf(teachers.removeSchoolLink(teacher.id, school.id, manager, tx))).toBe('TEACHER_HAS_GROUPS_IN_SCHOOL');
      expect(await groups.isStudentInGroupOfTeacher(s.id, teacher.id, tx)).toBe(true);
      expect(await groups.isStudentInGroupOfTeacher(s.id, other.id, tx)).toBe(false);
      await groups.archiveGroup(g.id, null, manager, tx);
      expect(await groups.isStudentInGroupOfTeacher(s.id, teacher.id, tx)).toBe(false);
      expect((await teachers.removeSchoolLink(teacher.id, school.id, manager, tx)).isActive).toBe(false);
      const g2 = await newGroup(school.id);
      expect(await codeOf(groups.assignTeacher(g2.id, teacher.id, manager, tx))).toBe('GROUP_TEACHER_NOT_LINKED_TO_SCHOOL'); // link removed: the lock sees it
    });
  });

  it('lists a school\'s groups with a status filter, sort and pagination, and a Teacher\'s own ACTIVE groups', async () => {
    await withFixture(async ({ groups, newGroup, newTeacher, school, manager, tx }) => {
      const teacher = await newTeacher(school.id);
      const b = await newGroup(school.id, { name: 'ب', teacherId: teacher.id });
      await newGroup(school.id, { name: 'أ' });
      await newGroup(school.id, { name: 'ج', teacherId: teacher.id });
      await groups.archiveGroup(b.id, null, manager, tx);
      const byName = await groups.listGroupsOfSchool(school.id, { sort: 'name', direction: 'asc', page: { page: 1, pageSize: 2 } }, tx);
      expect(byName.items.map((g) => g.name)).toEqual(['أ', 'ب']);
      expect(byName).toMatchObject({ total: 3, totalPages: 2 });
      expect((await groups.listGroupsOfSchool(school.id, { status: ['ARCHIVED'], page: { page: 1, pageSize: 10 } }, tx)).items.map((g) => g.id)).toEqual([b.id]);
      const { userId } = (await groups['teachers'].findById(teacher.id, tx))!;
      expect((await groups.listOwnGroups(userId, { page: 1, pageSize: 10 }, 'asc', tx)).items.map((g) => g.name)).toEqual(['ج']);
    });
  });
});
