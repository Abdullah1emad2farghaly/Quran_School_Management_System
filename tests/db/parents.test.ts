/**
 * Real-database checks for Module 17 (Parents) and the account-level `users.must_change_password` flag (Modules 08/10): the schema
 * (unique account, one CURRENT address, one ACTIVE school link, CHECK constraints, RESTRICT keys), the SQL repositories, the real
 * ParentService against them, password-change flag persistence, and atomic rollback. NOT part of `npm test`.
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
  parentRepo: SequelizeParentRepository;
  links: SequelizeParentSchoolLinkRepository;
  school: { id: string };
  school2: { id: string };
  manager: string;
  governorateName: string;
  newManagerOfSchool: (schoolId: string) => Promise<string>;
  studentCounts: Map<string, number>;
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
      await work({ tx, q, run, fails, parents, parentRepo, links, school, school2, manager, governorateName, newManagerOfSchool, studentCounts });
      throw new Rollback();
    });
  } catch (error) {
    swallowRollback(error);
  }
}

afterAll(async () => {
  await sequelize.close();
});

const NAME = 'أحمد محمد علي';
const phoneOf = () => `010${String(80000000 + ++counter * 7 + Math.floor(Math.random() * 1000000)).slice(-8)}`;

describe('parents schema (migration create-parents) and the users flag (migration users-must-change-password)', () => {
  it('has the tables, RESTRICT keys to parents only, the unique/current/active indexes and the CHECK constraints', async () => {
    const fks = await sequelize.query<{ TABLE_NAME: string; REFERENCED_TABLE_NAME: string; DELETE_RULE: string; UPDATE_RULE: string }>(
      `SELECT TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE, UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('parents','parent_addresses','parent_schools')`,
      { type: QueryTypes.SELECT },
    );
    // no foreign key to another module's table (§14): only the module's own parent_id keys
    expect(fks.map((f) => `${f.TABLE_NAME}->${f.REFERENCED_TABLE_NAME}:${f.DELETE_RULE}/${f.UPDATE_RULE}`).sort()).toEqual(['parent_addresses->parents:RESTRICT/RESTRICT', 'parent_schools->parents:RESTRICT/RESTRICT']);
    const idx = await sequelize.query<{ INDEX_NAME: string; NON_UNIQUE: number }>(
      `SELECT DISTINCT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('parents','parent_addresses','parent_schools')`,
      { type: QueryTypes.SELECT },
    );
    const unique = idx.filter((i) => Number(i.NON_UNIQUE) === 0).map((i) => i.INDEX_NAME);
    expect(unique).toEqual(expect.arrayContaining(['uq_parents_user', 'uq_parent_addresses_current', 'uq_parent_schools_active']));
    const checks = await sequelize.query<{ CONSTRAINT_NAME: string }>(`SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME LIKE 'ck_parent%'`, { type: QueryTypes.SELECT });
    expect(checks.map((c) => c.CONSTRAINT_NAME).sort()).toEqual(['ck_parent_addresses_active', 'ck_parent_addresses_village', 'ck_parent_schools_active']);
    const column = await sequelize.query<{ IS_NULLABLE: string; COLUMN_DEFAULT: string | null }>(
      `SELECT IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'must_change_password'`,
      { type: QueryTypes.SELECT },
    );
    expect(column[0]).toMatchObject({ IS_NULLABLE: 'NO' });
    expect(String(column[0]!.COLUMN_DEFAULT)).toBe('0');
  });

  it('enforces one Parent per account, one CURRENT address per Parent, one ACTIVE link per (parent, school) and the CHECKs', async () => {
    await withFixture(async (f) => {
      const user = randomUUID();
      const id = randomUUID();
      const insertParent = (parentId: string, userId: string) =>
        f.run(`INSERT INTO parents (id, user_id, organization_id, created_by, version, created_at, updated_at) VALUES (:id, :userId, :org, :by, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: parentId, userId, org: randomUUID(), by: randomUUID() });
      await insertParent(id, user);
      await f.fails(`INSERT INTO parents (id, user_id, organization_id, created_by, version, created_at, updated_at) VALUES (:id, :userId, :org, :by, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: randomUUID(), userId: user, org: randomUUID(), by: randomUUID() });

      const address = (active: string, ended: string, village: string | null, center: string | null) =>
        f.run(`INSERT INTO parent_addresses (id, parent_id, governorate_id, governorate_name, center_name, village_name, created_by, created_at, ended_at, active) VALUES (:id, :p, :g, 'م', ${center ? ':c' : 'NULL'}, ${village ? ':v' : 'NULL'}, :by, UTC_TIMESTAMP(3), ${ended}, ${active})`, { id: randomUUID(), p: id, g: randomUUID(), c: center, v: village, by: randomUUID() });
      await address('1', 'NULL', null, 'مركز');
      await f.fails(`INSERT INTO parent_addresses (id, parent_id, governorate_id, governorate_name, created_by, created_at, ended_at, active) VALUES (:id, :p, :g, 'م', :by, UTC_TIMESTAMP(3), NULL, 1)`, { id: randomUUID(), p: id, g: randomUUID(), by: randomUUID() }); // a second CURRENT row
      await address('NULL', 'UTC_TIMESTAMP(3)', null, null); // many ended rows are fine
      await address('NULL', 'UTC_TIMESTAMP(3)', null, null);
      await f.fails(`INSERT INTO parent_addresses (id, parent_id, governorate_id, governorate_name, village_name, created_by, created_at, ended_at, active) VALUES (:id, :p, :g, 'م', 'قرية', :by, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)`, { id: randomUUID(), p: id, g: randomUUID(), by: randomUUID() }); // village without center
      await f.fails(`INSERT INTO parent_addresses (id, parent_id, governorate_id, governorate_name, created_by, created_at, ended_at, active) VALUES (:id, :p, :g, 'م', :by, UTC_TIMESTAMP(3), NULL, NULL)`, { id: randomUUID(), p: id, g: randomUUID(), by: randomUUID() }); // not current and not ended

      const school = randomUUID();
      const link = (active: string, unlinked: string) =>
        f.run(`INSERT INTO parent_schools (id, parent_id, school_id, linked_at, linked_by, unlinked_at, unlinked_by, active, version, created_at, updated_at) VALUES (:id, :p, :s, UTC_TIMESTAMP(3), :by, ${unlinked}, ${unlinked === 'NULL' ? 'NULL' : ':by'}, ${active}, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: randomUUID(), p: id, s: school, by: randomUUID() });
      await link('1', 'NULL');
      await f.fails(`INSERT INTO parent_schools (id, parent_id, school_id, linked_at, linked_by, active, version, created_at, updated_at) VALUES (:id, :p, :s, UTC_TIMESTAMP(3), :by, 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: randomUUID(), p: id, s: school, by: randomUUID() }); // second ACTIVE link
      await link('NULL', 'UTC_TIMESTAMP(3)');
      await link('NULL', 'UTC_TIMESTAMP(3)'); // ended links accumulate (history)
      await f.fails(`DELETE FROM parents WHERE id = :id`, { id }); // RESTRICT: history rows exist
    });
  });
});

describe('REGRESSION: a row that is neither current nor ended is rejected by the real database (NULL-safe CHECK constraints)', () => {
  // The first draft of the CHECK constraints used `active = 1 ...`: for `active` NULL and `ended_at` NULL that evaluates to NULL, which a CHECK
  // ACCEPTS, so a row that was neither current nor ended could be stored. The constraints now use the NULL-safe `<=>`.
  it('parent_addresses: neither current (active NULL) nor ended (ended_at NULL) is refused; current-and-ended and ended-without-date are refused too', async () => {
    await withFixture(async (f) => {
      const parent = randomUUID();
      await f.run(`INSERT INTO parents (id, user_id, organization_id, created_by, version, created_at, updated_at) VALUES (:id, :u, :o, :by, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: parent, u: randomUUID(), o: randomUUID(), by: randomUUID() });
      const insert = (active: string, ended: string) =>
        `INSERT INTO parent_addresses (id, parent_id, governorate_id, governorate_name, created_by, created_at, ended_at, active) VALUES ('${randomUUID()}', '${parent}', '${randomUUID()}', 'م', '${randomUUID()}', UTC_TIMESTAMP(3), ${ended}, ${active})`;
      await f.fails(insert('NULL', 'NULL')); // the defect: neither current nor ended
      await f.fails(insert('1', 'UTC_TIMESTAMP(3)')); // current AND ended
      await f.fails(insert('0', 'NULL')); // not the 1/NULL convention
      await f.run(insert('1', 'NULL')); // current: accepted
      await f.run(insert('NULL', 'UTC_TIMESTAMP(3)')); // ended: accepted
    });
  });

  it('parent_schools: neither active nor removed is refused; active-but-removed and removed-without-who are refused too', async () => {
    await withFixture(async (f) => {
      const parent = randomUUID();
      await f.run(`INSERT INTO parents (id, user_id, organization_id, created_by, version, created_at, updated_at) VALUES (:id, :u, :o, :by, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: parent, u: randomUUID(), o: randomUUID(), by: randomUUID() });
      const insert = (active: string, unlinkedAt: string, unlinkedBy: string) =>
        `INSERT INTO parent_schools (id, parent_id, school_id, linked_at, linked_by, unlinked_at, unlinked_by, active, version, created_at, updated_at)
         VALUES ('${randomUUID()}', '${parent}', '${randomUUID()}', UTC_TIMESTAMP(3), '${randomUUID()}', ${unlinkedAt}, ${unlinkedBy}, ${active}, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
      await f.fails(insert('NULL', 'NULL', 'NULL')); // the defect: neither active nor removed
      await f.fails(insert('1', 'UTC_TIMESTAMP(3)', `'${randomUUID()}'`)); // active AND removed
      await f.fails(insert('NULL', 'UTC_TIMESTAMP(3)', 'NULL')); // removed without who
      await f.run(insert('1', 'NULL', 'NULL')); // active: accepted
      await f.run(insert('NULL', 'UTC_TIMESTAMP(3)', `'${randomUUID()}'`)); // removed: accepted
    });
  });
});

describe('the real ParentService over the SQL repositories', () => {
  it('registers a new Parent: account with the initial password and the pending change, role, parent, address history row and link', async () => {
    await withFixture(async (f) => {
      const phone = phoneOf();
      const result = await f.parents.registerParent({ schoolId: f.school.id, name: `  ${NAME} `, phone, address: { kind: 'raw', text: `${f.governorateName} / سمالوط / برمشا` } }, f.manager);
      expect(result.accountCreated).toBe(true);
      expect(result.parent).toMatchObject({ name: NAME, schoolIds: [f.school.id], address: { governorateName: f.governorateName, centerName: 'سمالوط', villageName: 'برمشا' } });

      const user = (await identity.findByPhone(phone, f.tx))!;
      expect(user.mustChangePassword).toBe(true);
      const [stored] = await f.q<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = :id', { id: user.id });
      expect(await new BcryptPasswordHasher(4).verify(phone.slice(-4), stored!.password_hash)).toBe(true); // the initial password: last four digits, stored only as a hash
      expect(await roleService.hasRole(user.id, 'PARENT', f.tx)).toBe(true);
      const [named] = await f.q<{ full_name: string }>('SELECT full_name FROM users WHERE id = :id', { id: user.id });
      expect(named!.full_name).toBe(NAME); // the canonical name is stored on the account, once
      expect(await f.q('SHOW COLUMNS FROM parents LIKE \'full_name\'')).toHaveLength(0); // and not copied onto the Parent record
      const [row] = await f.q<{ must_change_password: number }>('SELECT must_change_password FROM users WHERE id = :id', { id: user.id });
      expect(Number(row!.must_change_password)).toBe(1);

      const events = await f.q<{ event_type: string }>(`SELECT event_type FROM outbox_messages WHERE aggregate_id IN (:ids)`, { ids: [result.parent.id, result.link.id] });
      expect(events.map((e) => e.event_type).sort()).toEqual(['ParentRegistered', 'ParentSchoolLinked']);
    });
  });

  it('clears the pending change only when the password is replaced (the flag is persisted)', async () => {
    await withFixture(async (f) => {
      const phone = phoneOf();
      await f.parents.registerParent({ schoolId: f.school.id, name: NAME, phone, address: { kind: 'raw', text: f.governorateName } }, f.manager);
      const user = (await identity.findByPhone(phone, f.tx))!;
      await identity.changePassword(user.id, 'brand-new1', f.tx);
      expect((await identity.findById(user.id, f.tx))!.mustChangePassword).toBe(false);
      const [row] = await f.q<{ must_change_password: number }>('SELECT must_change_password FROM users WHERE id = :id', { id: user.id });
      expect(Number(row!.must_change_password)).toBe(0);
    });
  });

  it('reuses the parent for a second school of the same organization and never touches the account', async () => {
    await withFixture(async (f) => {
      const phone = phoneOf();
      const first = await f.parents.registerParent({ schoolId: f.school.id, name: NAME, phone, address: { kind: 'raw', text: f.governorateName } }, f.manager);
      const manager2 = await f.newManagerOfSchool(f.school2.id);
      const second = await f.parents.registerParent({ schoolId: f.school2.id, name: NAME, phone, address: { kind: 'raw', text: f.governorateName } }, manager2);
      expect(second.accountCreated).toBe(false);
      expect(second.parent.id).toBe(first.parent.id);
      expect([...second.parent.schoolIds].sort()).toEqual([f.school.id, f.school2.id].sort());
      expect(await codeOf(f.parents.registerParent({ schoolId: f.school2.id, name: NAME, phone, address: { kind: 'raw', text: f.governorateName } }, manager2))).toBe('PARENT_ALREADY_LINKED_TO_SCHOOL');
      expect(await codeOf(f.parents.registerParent({ schoolId: f.school2.id, name: 'محمود خالد سعيد', phone, address: { kind: 'raw', text: f.governorateName } }, manager2))).toBe('PARENT_IDENTITY_CONFLICT');
      // an existing account WITHOUT a Parent record (the school manager) is matched by its stored name: none stored -> identity conflict
      const managerPhone = (await identity.findById(f.manager, f.tx))!.phone;
      const asManager = { schoolId: f.school.id, name: NAME, phone: managerPhone, address: { kind: 'raw' as const, text: f.governorateName } };
      expect(await codeOf(f.parents.registerParent(asManager, f.manager))).toBe('PARENT_IDENTITY_CONFLICT');
      await identity.ensureFullName(f.manager, 'محمود خالد سعيد', f.tx);
      expect(await codeOf(f.parents.registerParent(asManager, f.manager))).toBe('PARENT_IDENTITY_CONFLICT'); // a different stored name
      const hashBefore = (await f.q<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = :id', { id: f.manager }))[0]!.password_hash;
      expect((await f.parents.registerParent({ ...asManager, name: 'محمود خالد سعيد' }, f.manager)).accountCreated).toBe(false); // the same stored name: reused
      const after = await f.q<{ password_hash: string; must_change_password: number; full_name: string }>('SELECT password_hash, must_change_password, full_name FROM users WHERE id = :id', { id: f.manager });
      expect(after[0]).toMatchObject({ password_hash: hashBefore, full_name: 'محمود خالد سعيد' });
      expect(Number(after[0]!.must_change_password)).toBe(0);
      expect((await roleService.listActiveRoles(f.manager, f.tx)).sort()).toEqual(['PARENT', 'SCHOOL_MANAGER']);
    });
  });

  it('keeps the address history (with the governorate name as stored), lists by school, removes one link and keeps the rest', async () => {
    await withFixture(async (f) => {
      const phone = phoneOf();
      const { parent } = await f.parents.registerParent({ schoolId: f.school.id, name: NAME, phone, address: { kind: 'raw', text: `${f.governorateName} / سمالوط` } }, f.manager);
      await f.parents.updateParent(parent.id, { address: { kind: 'raw', text: `${f.governorateName} / مطاي / قرية` } }, f.manager);
      const history = await f.parents.listAddressHistory(parent.id, f.tx);
      expect(history.map((h) => h.centerName)).toEqual(['سمالوط', 'مطاي']);
      expect(history[0]!.endedAt).not.toBeNull();
      expect(history[1]!.endedAt).toBeNull();
      const rows = await f.q<{ n: number }>('SELECT COUNT(*) AS n FROM parent_addresses WHERE parent_id = :id AND active = 1', { id: parent.id });
      expect(Number(rows[0]!.n)).toBe(1);

      const page = await f.parents.listParentsOfSchool({ schoolId: f.school.id, sort: 'createdAt', direction: 'asc', page: { page: 1, pageSize: 10 } }, f.tx);
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({ id: parent.id, phone: (await identity.findByPhone(phone, f.tx))!.phone });
      expect((await f.parents.listParentsOfSchool({ schoolId: f.school2.id, sort: 'createdAt', direction: 'asc', page: { page: 1, pageSize: 10 } }, f.tx)).total).toBe(0);

      await f.parents.removeSchoolLink(parent.id, f.school.id, f.manager);
      expect((await f.parents.getParent(parent.id, f.tx)).schoolIds).toEqual([]);
      expect(await identity.findByPhone(phone, f.tx)).toBeTruthy(); // the account survives
      expect((await f.parents.listSchoolLinkHistory(parent.id, f.tx)).map((l) => l.isActive)).toEqual([false]);
      expect((await f.parents.listParentsOfSchool({ schoolId: f.school.id, sort: 'createdAt', direction: 'asc', page: { page: 1, pageSize: 10 } }, f.tx)).total).toBe(0);
      expect(await codeOf(f.parents.removeSchoolLink(parent.id, f.school.id, f.manager))).toBe('PARENT_SCHOOL_LINK_NOT_FOUND');
      // re-linking after removal works and the history keeps both rows
      await f.parents.registerParent({ schoolId: f.school.id, name: NAME, phone, address: { kind: 'raw', text: f.governorateName } }, f.manager);
      expect((await f.parents.listSchoolLinkHistory(parent.id, f.tx)).map((l) => l.isActive).sort()).toEqual([false, true]);
    });
  });

  it('refuses to remove a school link while students depend on it (guard inside the transaction), and keeps every row', async () => {
    await withFixture(async (f) => {
      const { parent } = await f.parents.registerParent({ schoolId: f.school.id, name: NAME, phone: phoneOf(), address: { kind: 'raw', text: f.governorateName } }, f.manager);
      f.studentCounts.set(`${parent.id}:${f.school.id}`, 3);
      expect(await codeOf(f.parents.removeSchoolLink(parent.id, f.school.id, f.manager))).toBe('PARENT_HAS_STUDENTS_IN_SCHOOL');
      const rows = await f.q<{ active: number | null; unlinked_at: string | null }>('SELECT active, unlinked_at FROM parent_schools WHERE parent_id = :id', { id: parent.id });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.active)).toBe(1);
      expect(rows[0]!.unlinked_at).toBeNull();
    });
  });

  it('is atomic: a failure while linking rolls back the account, role, parent and address', async () => {
    await withFixture(
      async (f) => {
        const phone = phoneOf();
        await expect(f.parents.registerParent({ schoolId: f.school.id, name: NAME, phone, address: { kind: 'raw', text: f.governorateName } }, f.manager)).rejects.toThrow('injected failure');
        expect(await identity.findByPhone(phone, f.tx)).toBeUndefined();
        const left = await f.q<{ n: number }>(`SELECT (SELECT COUNT(*) FROM parents) AS n`);
        expect(Number(left[0]!.n)).toBe(0);
        const addresses = await f.q<{ n: number }>(`SELECT COUNT(*) AS n FROM parent_addresses`);
        expect(Number(addresses[0]!.n)).toBe(0);
      },
      { failLinkInsert: true },
    );
  });
});
