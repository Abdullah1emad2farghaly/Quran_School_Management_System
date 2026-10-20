/**
 * Real-database checks for Module 19 (Students): the schema (GLOBAL unique National ID, the CHECKs, the RESTRICT key to this module's own
 * table only, the history order), the SQL repository, the real StudentService against it (registration, global duplicate, lifecycle,
 * history, join date as a business date), the Module 17 unlink guard with the real locking count, and atomic rollback. NOT part of `npm test`.
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

import { SequelizeStudentRepository, Student, StudentService } from '../../src/modules/19-students/public';

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
  students: StudentService;
  studentRepo: SequelizeStudentRepository;
  school: { id: string };
  school2: { id: string };
  manager: string;
  organizationId: string;
  newParent: (schoolId: string, name?: string) => Promise<{ id: string }>;
}

let counter = 0;
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
        const result = await parents.registerParent({ schoolId, name, phone: phoneOf(), address: { kind: 'raw', text: 'المنيا / سمالوط / برمشا' } }, manager, tx);
        return result.parent;
      };
      await work({ tx, q, run, fails, parents, students, studentRepo, school, school2, manager, organizationId: organization.id, newParent });
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
const NAME = 'عمر أحمد محمد';
const nationalIdOf = () => `3${String(Date.now()).slice(-9)}${String(++counter).padStart(4, '0')}`;
const insertStudentSql = `INSERT INTO students (id, school_id, organization_id, parent_id, full_name, national_id, join_date, status, created_by, version, created_at, updated_at)
  VALUES (:id, :school, :org, :parent, :name, :nid, '2026-10-01', :status, :actor, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;

describe('students schema (migration create-students)', () => {
  it('has both tables, ONE RESTRICT key (student_history -> students), the GLOBAL unique National ID index and the CHECKs', async () => {
    const fks = await sequelize.query<{ TABLE_NAME: string; REFERENCED_TABLE_NAME: string; DELETE_RULE: string; UPDATE_RULE: string }>(
      `SELECT TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE, UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('students','student_history')`,
      { type: QueryTypes.SELECT },
    );
    expect(fks.map((f) => `${f.TABLE_NAME}->${f.REFERENCED_TABLE_NAME}:${f.DELETE_RULE}/${f.UPDATE_RULE}`)).toEqual(['student_history->students:RESTRICT/RESTRICT']);
    const nationalIdIndex = await sequelize.query<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND INDEX_NAME = 'uq_students_national_id' AND NON_UNIQUE = 0`,
      { type: QueryTypes.SELECT },
    );
    expect(nationalIdIndex.map((c) => c.COLUMN_NAME)).toEqual(['national_id']); // alone: no school or organization column in it
    const checks = await sequelize.query<{ CONSTRAINT_NAME: string }>(`SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME LIKE 'ck_student%'`, { type: QueryTypes.SELECT });
    expect(checks.map((c) => c.CONSTRAINT_NAME)).toEqual(expect.arrayContaining(['ck_students_status', 'ck_students_national_id', 'ck_students_full_name', 'ck_student_history_action']));
  });

  it('refuses a duplicate National ID across schools and organizations, and rejects a bad status, a bad National ID and a blank name', async () => {
    await withFixture(async ({ q, run, fails, school, school2, manager, organizationId }) => {
      const nid = nationalIdOf();
      const row = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), school: school.id, org: organizationId, parent: randomUUID(), name: NAME, nid, status: 'ACTIVE', actor: manager, ...over });
      await run(insertStudentSql, row());
      await fails(insertStudentSql, row()); // same school
      await fails(insertStudentSql, row({ school: school2.id })); // another school
      await fails(insertStudentSql, row({ org: randomUUID(), school: randomUUID() })); // another organization
      await fails(insertStudentSql, row({ nid: nationalIdOf(), status: 'DELETED' }));
      for (const bad of ['123', '3000101012345a', '300010101234567']) await fails(insertStudentSql, row({ nid: bad }));
      await fails(insertStudentSql, row({ nid: nationalIdOf(), name: '   ' }));
      expect((await q<{ n: number }>(`SELECT COUNT(*) AS n FROM students WHERE national_id = :nid`, { nid }))[0]!.n).toBe(1);
    });
  });

  it('keeps the history in insertion order (seq) and refuses to delete a student that has history', async () => {
    await withFixture(async ({ q, fails, students, newParent, school, manager, tx }) => {
      const parent = await newParent(school.id);
      const s = await students.registerStudent({ schoolId: school.id, parentId: parent.id, fullName: NAME, nationalId: nationalIdOf() }, manager, tx);
      await students.deactivateStudent(s.id, 'سبب', manager, tx);
      await students.reactivateStudent(s.id, null, manager, tx);
      const rows = await q<{ action: string; new_status: string | null }>(`SELECT action, new_status FROM student_history WHERE student_id = :id ORDER BY seq`, { id: s.id });
      expect(rows.map((r) => `${r.action}:${r.new_status}`)).toEqual(['REGISTERED:ACTIVE', 'STATUS_CHANGED:INACTIVE', 'STATUS_CHANGED:ACTIVE']);
      await fails(`DELETE FROM students WHERE id = :id`, { id: s.id });
    });
  });
});

describe('StudentService against the real database', () => {
  it('registers, reads back a business-date join date, derives the address, and publishes StudentRegistered', async () => {
    await withFixture(async ({ q, students, newParent, school, manager, tx }) => {
      const parent = await newParent(school.id);
      const s = await students.registerStudent({ schoolId: school.id, parentId: parent.id, fullName: NAME, nationalId: nationalIdOf(), joinDate: '2026-09-01' }, manager, tx);
      expect(s).toMatchObject({ status: 'ACTIVE', joinDate: '2026-09-01', fullName: NAME, address: { centerName: 'سمالوط' } });
      expect((await students.getStudent(s.id, tx)).joinDate).toBe('2026-09-01');
      const events = await q<{ eventType: string }>(`SELECT event_type AS eventType FROM outbox_messages WHERE aggregate_id = :id`, { id: s.id });
      expect(events.map((e) => e.eventType)).toEqual(['StudentRegistered']);
    });
  });

  it('refuses a duplicate National ID globally (application check AND the unique index as the final guard) and moves nothing', async () => {
    await withFixture(async ({ q, students, studentRepo, newParent, school, school2, manager, tx }) => {
      const parent = await newParent(school.id);
      const nid = nationalIdOf();
      const first = await students.registerStudent({ schoolId: school.id, parentId: parent.id, fullName: NAME, nationalId: nid }, manager, tx);
      expect(await codeOf(students.registerStudent({ schoolId: school.id, parentId: parent.id, fullName: NAME, nationalId: nid }, manager, tx))).toBe('STUDENT_NATIONAL_ID_CONFLICT');
      // Bypass the application check: the repository maps the database error to the same code.
      const twin = Student.register({ schoolId: school2.id, organizationId: first.organizationId, parentId: parent.id, fullName: NAME, nationalId: nid, joinDate: '2026-09-01', createdBy: manager, clock: new SystemClock() });
      expect(await codeOf(studentRepo.insert(twin, tx))).toBe('STUDENT_NATIONAL_ID_CONFLICT');
      expect((await q<{ n: number }>(`SELECT COUNT(*) AS n FROM students WHERE national_id = :nid`, { nid }))[0]!.n).toBe(1);
      expect((await q<{ school_id: string }>(`SELECT school_id FROM students WHERE national_id = :nid`, { nid }))[0]!.school_id).toBe(school.id);
    });
  });

  it('lifecycle, correction and history; the Parent, school and National ID columns never change', async () => {
    await withFixture(async ({ q, students, newParent, school, manager, tx }) => {
      const parent = await newParent(school.id);
      const nid = nationalIdOf();
      const s = await students.registerStudent({ schoolId: school.id, parentId: parent.id, fullName: NAME, nationalId: nid, joinDate: '2026-09-01' }, manager, tx);
      await students.updateStudent(s.id, { joinDate: '2026-09-15', fullName: 'يوسف أحمد محمد' }, manager, tx);
      await students.deactivateStudent(s.id, 'سبب', manager, tx);
      await students.archiveStudent(s.id, null, manager, tx);
      expect(await codeOf(students.reactivateStudent(s.id, null, manager, tx))).toBe('STUDENT_ARCHIVED');
      expect(await codeOf(students.updateStudent(s.id, { joinDate: '2026-09-16' }, manager, tx))).toBe('STUDENT_ARCHIVED');
      const [row] = await q<{ national_id: string; parent_id: string; school_id: string; status: string; full_name: string; version: number }>(`SELECT national_id, parent_id, school_id, status, full_name, version FROM students WHERE id = :id`, { id: s.id });
      expect(row).toMatchObject({ national_id: nid, parent_id: parent.id, school_id: school.id, status: 'ARCHIVED', full_name: 'يوسف أحمد محمد' });
      const history = await students.listHistory(s.id, tx);
      expect(history.map((h) => h.action)).toEqual(['REGISTERED', 'DETAILS_UPDATED', 'STATUS_CHANGED', 'STATUS_CHANGED']);
      expect(history[1]).toMatchObject({ previousJoinDate: '2026-09-01', newJoinDate: '2026-09-15', previousFullName: NAME, newFullName: 'يوسف أحمد محمد' });
    });
  });

  it('the Module 17 unlink guard (locking count) blocks the unlink in every status, and an unlinked Parent cannot get a new student', async () => {
    await withFixture(async ({ students, parents, newParent, school, manager, tx }) => {
      const parent = await newParent(school.id);
      const s = await students.registerStudent({ schoolId: school.id, parentId: parent.id, fullName: NAME, nationalId: nationalIdOf() }, manager, tx);
      expect(await students.countStudentsOfParentInSchool(parent.id, school.id, tx)).toBe(1);
      expect(await codeOf(parents.removeSchoolLink(parent.id, school.id, manager, tx))).toBe('PARENT_HAS_STUDENTS_IN_SCHOOL');
      await students.archiveStudent(s.id, null, manager, tx);
      expect(await codeOf(parents.removeSchoolLink(parent.id, school.id, manager, tx))).toBe('PARENT_HAS_STUDENTS_IN_SCHOOL');
      const lone = await newParent(school.id, 'سعيد حسن محمود');
      await parents.removeSchoolLink(lone.id, school.id, manager, tx);
      expect(await codeOf(students.registerStudent({ schoolId: school.id, parentId: lone.id, fullName: 'علي سعيد حسن', nationalId: nationalIdOf() }, manager, tx))).toBe('STUDENT_PARENT_NOT_LINKED_TO_SCHOOL');
    });
  });

  it('a failed registration leaves nothing behind (atomic)', async () => {
    await withFixture(async ({ q, students, newParent, school, manager, tx }) => {
      const parent = await newParent(school.id);
      const nid = nationalIdOf();
      await students.registerStudent({ schoolId: school.id, parentId: parent.id, fullName: NAME, nationalId: nid }, manager, tx);
      const before = (await q<{ n: number }>(`SELECT (SELECT COUNT(*) FROM students) + (SELECT COUNT(*) FROM student_history) AS n`))[0]!.n;
      expect(await codeOf(students.registerStudent({ schoolId: school.id, parentId: parent.id, fullName: 'عمر خالد محمد', nationalId: nationalIdOf() }, manager, tx))).toBe('STUDENT_NAME_PARENT_MISMATCH');
      expect((await q<{ n: number }>(`SELECT (SELECT COUNT(*) FROM students) + (SELECT COUNT(*) FROM student_history) AS n`))[0]!.n).toBe(before);
    });
  });
});
