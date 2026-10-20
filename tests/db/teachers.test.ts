/**
 * Real-database checks for Module 18 (Teachers): the schema
 * (unique account, one ACTIVE school link, the NULL-safe CHECK, RESTRICT key), the SQL repositories, the real
 * TeacherService against them (initial password stored as a hash, the pending-change flag, account reuse), and atomic rollback. NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: every test runs in ONE outer transaction that is ALWAYS rolled back, so existing data is never changed.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
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
  parentRepo: SequelizeParentRepository;
  links: SequelizeParentSchoolLinkRepository;
  school: { id: string };
  school2: { id: string };
  manager: string;
  governorateName: string;
  newManagerOfSchool: (schoolId: string) => Promise<string>;
  studentCounts: Map<string, number>;
  groupCounts: Map<string, number>;
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
      const organization = await organizations.createOrganization({ name: `Parents DB test organization ${stamp}`, countryId: country, governorateId: gov }, tx);

      let phone = Math.floor(Math.random() * 40000);
      const newUser = async (role?: string) => {
        const user = await identity.createUser({ phone: `+2010995${String(++phone).padStart(5, '0')}`, password: 'secret1' }, tx);
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
      const newManagerOfSchool = async (schoolId: string) => {
        const user = await newUser('SCHOOL_MANAGER');
        await schools.assignSchoolManager({ schoolId, userId: user, actorId: admin }, tx);
        return user;
      };
      const manager = await newManagerOfSchool(school.id);

      const studentCounts = new Map<string, number>();
      const parentRepo = new SequelizeParentRepository(sequelize);
      const links = new SequelizeParentSchoolLinkRepository(sequelize);
      const parents = new ParentService({
        parents: parentRepo,
        links: options.failLinkInsert
          ? Object.assign(Object.create(links) as SequelizeParentSchoolLinkRepository, {
              insert: async () => {
                throw new Error('injected failure while linking');
              },
            })
          : links,
        schools,
        address,
        identity,
        roles: roleService,
        studentDependencies: { countStudentsOfParentInSchool: async (parentId, schoolId) => studentCounts.get(`${parentId}:${schoolId}`) ?? 0 },
        unitOfWork: savepointUnitOfWork,
        outbox,
      });
      const groupCounts = new Map<string, number>();
      const teachers = new TeacherService({
        teachers: new SequelizeTeacherRepository(sequelize),
        links: options.failLinkInsert
          ? Object.assign(Object.create(new SequelizeTeacherSchoolLinkRepository(sequelize)) as SequelizeTeacherSchoolLinkRepository, {
              insert: async () => {
                throw new Error('injected failure while linking');
              },
            })
          : new SequelizeTeacherSchoolLinkRepository(sequelize),
        schools,
        identity,
        roles: roleService,
        parents,
        groupDependencies: { countGroupsOfTeacherInSchool: async (teacherId, schoolId) => groupCounts.get(`${teacherId}:${schoolId}`) ?? 0 },
        unitOfWork: savepointUnitOfWork,
        outbox,
      });
      await work({ tx, q, run, fails, parents, teachers, parentRepo, links, school, school2, manager, governorateName, newManagerOfSchool, studentCounts, groupCounts });
      throw new Rollback();
    });
  } catch (error) {
    swallowRollback(error);
  }
}

afterAll(async () => {
  await sequelize.close();
});

const NAME = 'خالد أحمد حسن';
const phoneOf = () => `010${String(80000000 + ++counter * 7 + Math.floor(Math.random() * 1000000)).slice(-8)}`;

describe('teachers schema (migration create-teachers)', () => {
  it('has the tables, one RESTRICT key to teachers only, the unique indexes and the NULL-safe CHECK', async () => {
    const fks = await sequelize.query<{ TABLE_NAME: string; REFERENCED_TABLE_NAME: string; DELETE_RULE: string; UPDATE_RULE: string }>(
      `SELECT TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE, UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('teachers','teacher_schools')`,
      { type: QueryTypes.SELECT },
    );
    expect(fks.map((f) => `${f.TABLE_NAME}->${f.REFERENCED_TABLE_NAME}:${f.DELETE_RULE}/${f.UPDATE_RULE}`)).toEqual(['teacher_schools->teachers:RESTRICT/RESTRICT']);
    const idx = await sequelize.query<{ INDEX_NAME: string; NON_UNIQUE: number }>(
      `SELECT DISTINCT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('teachers','teacher_schools')`,
      { type: QueryTypes.SELECT },
    );
    expect(idx.filter((i) => Number(i.NON_UNIQUE) === 0).map((i) => i.INDEX_NAME)).toEqual(expect.arrayContaining(['uq_teachers_user', 'uq_teacher_schools_active']));
    const checks = await sequelize.query<{ CONSTRAINT_NAME: string }>(`SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME LIKE 'ck_teacher%'`, { type: QueryTypes.SELECT });
    expect(checks.map((c) => c.CONSTRAINT_NAME)).toEqual(['ck_teacher_schools_active']);
    expect(await sequelize.query(`SHOW COLUMNS FROM teachers LIKE 'full_name'`, { type: QueryTypes.SELECT })).toHaveLength(0); // the name lives on the account
  });

  it('enforces one Teacher per account, one ACTIVE link per (teacher, school); REGRESSION: a row that is neither active nor removed is refused', async () => {
    await withFixture(async (f) => {
      const user = randomUUID();
      const id = randomUUID();
      const insertTeacher = (teacherId: string, userId: string) =>
        f.run(`INSERT INTO teachers (id, user_id, organization_id, created_by, version, created_at, updated_at) VALUES (:id, :userId, :org, :by, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: teacherId, userId, org: randomUUID(), by: randomUUID() });
      await insertTeacher(id, user);
      await f.fails(`INSERT INTO teachers (id, user_id, organization_id, created_by, version, created_at, updated_at) VALUES (:id, :userId, :org, :by, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: randomUUID(), userId: user, org: randomUUID(), by: randomUUID() });

      const school = randomUUID();
      const insert = (active: string, unlinkedAt: string, unlinkedBy: string, schoolId = school) =>
        `INSERT INTO teacher_schools (id, teacher_id, school_id, linked_at, linked_by, unlinked_at, unlinked_by, active, version, created_at, updated_at)
         VALUES ('${randomUUID()}', '${id}', '${schoolId}', UTC_TIMESTAMP(3), '${randomUUID()}', ${unlinkedAt}, ${unlinkedBy}, ${active}, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
      await f.run(insert('1', 'NULL', 'NULL'));
      await f.fails(insert('1', 'NULL', 'NULL')); // a second ACTIVE link to the same school
      await f.fails(insert('NULL', 'NULL', 'NULL', randomUUID())); // the defect: neither active nor removed
      await f.fails(insert('1', 'UTC_TIMESTAMP(3)', `'${randomUUID()}'`, randomUUID())); // active AND removed
      await f.fails(insert('NULL', 'UTC_TIMESTAMP(3)', 'NULL', randomUUID())); // removed without who
      await f.run(insert('NULL', 'UTC_TIMESTAMP(3)', `'${randomUUID()}'`)); // ended links accumulate (history)
      await f.run(insert('NULL', 'UTC_TIMESTAMP(3)', `'${randomUUID()}'`));
      await f.fails(`DELETE FROM teachers WHERE id = :id`, { id }); // RESTRICT: link history exists
    });
  });
});

describe('the real TeacherService over the SQL repositories', () => {
  it('registers a new Teacher: name on the account, initial password stored ONLY as a bcrypt hash of the last four digits, the pending change, the role, the link and the events', async () => {
    await withFixture(async (f) => {
      const phone = phoneOf();
      const result = await f.teachers.registerTeacher({ schoolId: f.school.id, name: `  ${NAME} `, phone }, f.manager);
      expect(result.accountCreated).toBe(true);
      expect(result.teacher).toMatchObject({ name: NAME, schoolIds: [f.school.id] });

      const user = (await identity.findByPhone(phone, f.tx))!;
      expect(user.mustChangePassword).toBe(true);
      expect(await roleService.hasRole(user.id, 'TEACHER', f.tx)).toBe(true);
      const [row] = await f.q<{ password_hash: string; must_change_password: number; full_name: string }>('SELECT password_hash, must_change_password, full_name FROM users WHERE id = :id', { id: user.id });
      expect(row!.full_name).toBe(NAME);
      expect(Number(row!.must_change_password)).toBe(1);
      expect(row!.password_hash).not.toContain(phone.slice(-4));
      expect(await new BcryptPasswordHasher(4).verify(phone.slice(-4), row!.password_hash)).toBe(true);
      const events = await f.q<{ event_type: string; payload: string }>(`SELECT event_type, payload FROM outbox_messages WHERE aggregate_id IN (:ids)`, { ids: [result.teacher.id, result.link.id] });
      expect(events.map((e) => e.event_type).sort()).toEqual(['TeacherRegistered', 'TeacherSchoolLinked']);
      expect(events.map((e) => String(e.payload)).join('')).not.toMatch(/password|hash/i);
    });
  });

  it('reusing an account never changes its password hash or its mustChangePassword state (cleared, pending, or a Parent account)', async () => {
    await withFixture(async (f) => {
      // (1) a Teacher who changed the password, linked to a second school
      const phone = phoneOf();
      const first = await f.teachers.registerTeacher({ schoolId: f.school.id, name: NAME, phone }, f.manager);
      const user = (await identity.findByPhone(phone, f.tx))!;
      await identity.changePassword(user.id, 'brand-new1', f.tx);
      const before = (await f.q<{ password_hash: string; must_change_password: number }>('SELECT password_hash, must_change_password FROM users WHERE id = :id', { id: user.id }))[0]!;
      const manager2 = await f.newManagerOfSchool(f.school2.id);
      const second = await f.teachers.registerTeacher({ schoolId: f.school2.id, name: NAME, phone }, manager2);
      expect(second.accountCreated).toBe(false);
      expect(second.teacher.id).toBe(first.teacher.id);
      const after = (await f.q<{ password_hash: string; must_change_password: number }>('SELECT password_hash, must_change_password FROM users WHERE id = :id', { id: user.id }))[0]!;
      expect(after.password_hash).toBe(before.password_hash);
      expect(Number(after.must_change_password)).toBe(0);
      expect(await codeOf(f.teachers.registerTeacher({ schoolId: f.school2.id, name: NAME, phone }, manager2))).toBe('TEACHER_ALREADY_LINKED_TO_SCHOOL');
      expect(await codeOf(f.teachers.registerTeacher({ schoolId: f.school2.id, name: 'محمود خالد سعيد', phone }, manager2))).toBe('TEACHER_IDENTITY_CONFLICT');

      // (2) a Parent account with a PENDING change becomes a Teacher too: one account, flag and hash untouched
      const parentPhone = phoneOf();
      const parent = await f.parents.registerParent({ schoolId: f.school.id, name: 'سارة أحمد حسن', phone: parentPhone, address: { kind: 'raw', text: f.governorateName } }, f.manager);
      const pBefore = (await f.q<{ password_hash: string; must_change_password: number }>('SELECT password_hash, must_change_password FROM users WHERE id = :id', { id: parent.parent.userId }))[0]!;
      const asTeacher = await f.teachers.registerTeacher({ schoolId: f.school.id, name: 'سارة أحمد حسن', phone: parentPhone }, f.manager);
      expect(asTeacher.teacher.userId).toBe(parent.parent.userId);
      const pAfter = (await f.q<{ password_hash: string; must_change_password: number }>('SELECT password_hash, must_change_password FROM users WHERE id = :id', { id: parent.parent.userId }))[0]!;
      expect(pAfter.password_hash).toBe(pBefore.password_hash);
      expect(Number(pAfter.must_change_password)).toBe(1);
      expect((await roleService.listActiveRoles(parent.parent.userId, f.tx)).sort()).toEqual(['PARENT', 'TEACHER']);

      // (3) a school manager account without a stored name is an identity conflict; nothing changes
      const managerPhone = (await identity.findById(f.manager, f.tx))!.phone;
      expect(await codeOf(f.teachers.registerTeacher({ schoolId: f.school.id, name: NAME, phone: managerPhone }, f.manager))).toBe('TEACHER_IDENTITY_CONFLICT');
      expect(await roleService.listActiveRoles(f.manager, f.tx)).toEqual(['SCHOOL_MANAGER']);
    });
  });

  it('lists by school, removes one link and keeps the rest (history kept), and the groups guard blocks removal', async () => {
    await withFixture(async (f) => {
      const phone = phoneOf();
      const { teacher } = await f.teachers.registerTeacher({ schoolId: f.school.id, name: NAME, phone }, f.manager);
      const page = await f.teachers.listTeachersOfSchool({ schoolId: f.school.id, sort: 'createdAt', direction: 'asc', page: { page: 1, pageSize: 10 } }, f.tx);
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({ id: teacher.id, name: NAME });
      expect((await f.teachers.listTeachersOfSchool({ schoolId: f.school2.id, sort: 'createdAt', direction: 'asc', page: { page: 1, pageSize: 10 } }, f.tx)).total).toBe(0);

      f.groupCounts.set(`${teacher.id}:${f.school.id}`, 2);
      expect(await codeOf(f.teachers.removeSchoolLink(teacher.id, f.school.id, f.manager))).toBe('TEACHER_HAS_GROUPS_IN_SCHOOL');
      const rows = await f.q<{ active: number | null }>('SELECT active FROM teacher_schools WHERE teacher_id = :id', { id: teacher.id });
      expect(rows.map((r) => Number(r.active))).toEqual([1]);
      f.groupCounts.set(`${teacher.id}:${f.school.id}`, 0);

      await f.teachers.removeSchoolLink(teacher.id, f.school.id, f.manager);
      expect((await f.teachers.getTeacher(teacher.id, f.tx)).schoolIds).toEqual([]);
      expect(await identity.findByPhone(phone, f.tx)).toBeTruthy(); // the account survives
      expect(await codeOf(f.teachers.removeSchoolLink(teacher.id, f.school.id, f.manager))).toBe('TEACHER_SCHOOL_LINK_NOT_FOUND');
      await f.teachers.registerTeacher({ schoolId: f.school.id, name: NAME, phone }, f.manager); // re-link
      expect((await f.teachers.listSchoolLinkHistory(teacher.id, f.tx)).map((l) => l.isActive).sort()).toEqual([false, true]);
    });
  });

  it('is atomic: a failure while linking rolls back the account, role and teacher', async () => {
    await withFixture(
      async (f) => {
        const phone = phoneOf();
        await expect(f.teachers.registerTeacher({ schoolId: f.school.id, name: NAME, phone }, f.manager)).rejects.toThrow('injected failure');
        expect(await identity.findByPhone(phone, f.tx)).toBeUndefined();
        const left = await f.q<{ n: number }>(`SELECT COUNT(*) AS n FROM teachers`);
        expect(Number(left[0]!.n)).toBe(0);
      },
      { failLinkInsert: true },
    );
  });
});
