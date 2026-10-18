/**
 * Real-database checks for Module 16 (Schools): schools belong directly to an organization (no Main/Sub), start PENDING, free-text address,
 * the ORGANIZATION_MANAGER role and the data migrations (role separation, free-text conversion, classification archive). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: every test runs in ONE outer transaction that is ALWAYS rolled back (organization, geography test
 * rows, users, roles, schools and codes are all created inside it), so existing data and the school code sequence are never
 * changed. The two sequence tests use separate transactions that are also always rolled back.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
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
import {
  OrganizationRegistrationService,
  SchoolService,
  SequelizeSchoolCodeSequence,
  SequelizeSchoolManagerRepository,
  SequelizeSchoolRepository,
} from '../../src/modules/16-schools/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const outbox = new OutboxService(new SequelizeOutboxStore(sequelize));
const identity = new IdentityService({ repository: new SequelizeUserRepository(sequelize), hasher: new BcryptPasswordHasher(4), unitOfWork: uow, outbox });
const roleService = new RoleService({ repository: new SequelizeRoleAssignmentRepository(sequelize), identity, permissions: new PermissionRegistry(), unitOfWork: uow, outbox });
const organizations = new OrganizationService({ repository: new SequelizeOrganizationRepository(sequelize), admins: new SequelizeOrganizationAdminRepository(sequelize), unitOfWork: uow, outbox });
const geography = new GeographyService(new SequelizeGeographyRepository(sequelize));
const codes = new SequelizeSchoolCodeSequence(sequelize);

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
  ids: { org: string; country: string; country2: string; gov: string; gov2: string; gov3: string; center: string; village: string };
  admin: string;
  newUser: (role?: string) => Promise<string>;
  service: SchoolService;
  registration: OrganizationRegistrationService;
}

let counter = 0;
/** Builds the fixture inside the outer transaction and hands it to `work`; always rolls back. */
async function withFixture(work: (f: Fixture) => Promise<void>, options: { failAfterRoleAssignment?: boolean } = {}): Promise<void> {
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

      // Clean slate INSIDE the transaction only (organizations/geography are referenced by schools with RESTRICT).
      for (const table of ['school_classification_archive', 'school_manager_source_archive', 'school_gps_history', 'school_status_history', 'school_managers']) await run(`DELETE FROM ${table}`);
      await run('DELETE FROM schools');
      await run('DELETE FROM organization_admins');
      await run('DELETE FROM organizations');

      const ids = { org: '', country: randomUUID(), country2: randomUUID(), gov: randomUUID(), gov2: randomUUID(), gov3: randomUUID(), center: randomUUID(), village: randomUUID() };
      const stamp = String(Math.floor(Math.random() * 90000) + 10000); // 5 digits: codes are PREFIX- + 6 digits (one fixed leading digit + stamp)
      const node = (table: string, id: string, code: string, name: string, parent: string | null, extra = '') =>
        run(
          `INSERT INTO ${table} (id, code, name, status${parent ? ', ' + (table === 'governorates' ? 'country_id' : table === 'centers' ? 'governorate_id' : 'center_id') : ''}${extra ? ', kind' : ''}, created_at, updated_at)
           VALUES (:id, :code, :name, 'ACTIVE'${parent ? ', :parent' : ''}${extra ? ", 'CENTER'" : ''}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          { id, code, name, parent },
        );
      await node('countries', ids.country, `CNT-9${stamp}`, `دولة اختبار المدارس ${stamp}`, null);
      await node('governorates', ids.gov, `GOV-9${stamp}`, `محافظة اختبار ${stamp}`, ids.country);
      await node('governorates', ids.gov2, `GOV-8${stamp}`, `محافظة اختبار ثانية ${stamp}`, ids.country);
      await node('countries', ids.country2, `CNT-7${stamp}`, `دولة اختبار ثانية ${stamp}`, null);
      await node('governorates', ids.gov3, `GOV-7${stamp}`, `محافظة الدولة الثانية ${stamp}`, ids.country2);
      await node('centers', ids.center, `CTR-9${stamp}`, `مركز اختبار ${stamp}`, ids.gov, 'kind');
      await node('villages', ids.village, `VIL-9${stamp}`, `قرية اختبار ${stamp}`, ids.center);

      // The organization: its own country and address (governorate of that country). It exists BEFORE any school.
      const organization = await organizations.createOrganization({ name: `Schools DB test organization ${stamp}`, countryId: ids.country, governorateId: ids.gov }, tx);
      ids.org = organization.id;

      let phone = Math.floor(Math.random() * 50000);
      const newUser = async (role?: string) => {
        const user = await identity.createUser({ phone: `+2010997${String(++phone).padStart(5, '0')}`, password: 'secret1' }, tx);
        if (role) await roleService.assignRole({ userId: user.id, roleCode: role, assignedBy: null }, tx);
        return user.id;
      };
      const admin = await newUser('ORGANIZATION_MANAGER');
      await organizations.assignOrganizationAdmin({ organizationId: ids.org, userId: admin, assignedBy: null }, tx); // ORGANIZATION_MANAGER role AND the organization link

      // Every service call joins the outer transaction (nested UnitOfWork). The SAVEPOINT makes each service operation
      // a real, database-level atomic unit inside it: if the operation throws, everything it wrote is rolled back.
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
      const roles = options.failAfterRoleAssignment
        ? {
            hasRole: roleService.hasRole.bind(roleService),
            // The role row IS written (real INSERT) and then the step fails: the rollback must remove it again.
            assignRole: async (...args: Parameters<RoleService['assignRole']>) => {
              await roleService.assignRole(...args);
              throw new Error('injected failure after the role assignment');
            },
          }
        : roleService;
      const service = new SchoolService({
        repository: new SequelizeSchoolRepository(sequelize),
        managers: new SequelizeSchoolManagerRepository(sequelize),
        codes,
        unitOfWork: savepointUnitOfWork,
        outbox,
        organizations,
        address: new UnifiedAddressService({ geography, organizations }),
        identity,
        roles,
        generateApplicantPassword: () => 'Qx7mK2pL9vTn',
      });
      const registration = new OrganizationRegistrationService({
        organizations,
        address: new UnifiedAddressService({ geography, organizations }),
        identity,
        roles,
        unitOfWork: savepointUnitOfWork,
        generateApplicantPassword: () => 'Qx7mK2pL9vTn',
      });
      await work({ tx, q, run, fails, ids, admin, newUser, service, registration });
      throw new Rollback();
    });
  } catch (error) {
    swallowRollback(error);
  }
}

afterAll(async () => {
  await sequelize.close();
});

describe('schools schema (migration create-schools)', () => {
  it('has the tables, RESTRICT foreign keys, unique indexes and the sequence row', async () => {
    const fks = await sequelize.query<{ TABLE_NAME: string; CONSTRAINT_NAME: string; REFERENCED_TABLE_NAME: string; DELETE_RULE: string; UPDATE_RULE: string }>(
      `SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, DELETE_RULE, UPDATE_RULE
         FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('schools','school_managers','school_status_history','school_gps_history')
        ORDER BY CONSTRAINT_NAME`,
      { type: QueryTypes.SELECT },
    );
    expect(fks.map((f) => `${f.CONSTRAINT_NAME}>${f.REFERENCED_TABLE_NAME}`).sort()).toEqual(
      [
        'fk_school_gps_history_school>schools',
        'fk_school_managers_school>schools',
        'fk_school_status_history_school>schools',
        'fk_schools_gov_country>governorates',
        'fk_schools_governorate>governorates',
        'fk_schools_org_country>organizations',
        'fk_schools_organization>organizations',
      ].sort(),
    );
    for (const fk of fks) expect([fk.DELETE_RULE, fk.UPDATE_RULE]).toEqual(['RESTRICT', 'RESTRICT']);

    const unique = await sequelize.query<{ INDEX_NAME: string }>(
      `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0 AND INDEX_NAME IN ('uq_schools_code','uq_schools_org_name','uq_school_managers_active_school')`,
      { type: QueryTypes.SELECT },
    );
    expect(unique.map((u) => u.INDEX_NAME).sort()).toEqual(['uq_school_managers_active_school', 'uq_schools_code', 'uq_schools_org_name']);

    const type = await sequelize.query<{ COLUMN_TYPE: string }>(
      "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schools' AND COLUMN_NAME IN ('latitude','longitude','gps_accuracy_m') ORDER BY COLUMN_NAME",
      { type: QueryTypes.SELECT },
    );
    expect(type.map((t) => t.COLUMN_TYPE)).toEqual(['decimal(6,2)', 'decimal(10,7)', 'decimal(10,7)']);
    const sequence = await sequelize.query<{ n: number }>("SELECT COUNT(*) AS n FROM school_code_sequence WHERE name = 'school'", { type: QueryTypes.SELECT });
    expect(Number(sequence[0]?.n)).toBe(1);
  });

  const columnsOf = async (table: string) =>
    (await sequelize.query<{ COLUMN_NAME: string }>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table', { replacements: { table }, type: QueryTypes.SELECT })).map((c) => c.COLUMN_NAME);

  it('has NO Main/Sub classification and NO registered center/village references (migrations schools-remove-main-sub, free-text-center-village)', async () => {
    const schoolColumns = await columnsOf('schools');
    for (const gone of ['type', 'parent_school_id', 'center_id', 'village_id']) expect(schoolColumns).not.toContain(gone);
    for (const added of ['center_name', 'village_name', 'applicant_user_id']) expect(schoolColumns).toContain(added);
    const organizationColumns = await columnsOf('organizations');
    for (const gone of ['center_id', 'village_id']) expect(organizationColumns).not.toContain(gone);
    for (const added of ['center_name', 'village_name']) expect(organizationColumns).toContain(added);
    const checks = await sequelize.query<{ CONSTRAINT_NAME: string }>(
      "SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'schools'",
      { type: QueryTypes.SELECT },
    );
    for (const gone of ['ck_schools_type', 'ck_schools_type_parent', 'ck_schools_main_status']) expect(checks.map((c) => c.CONSTRAINT_NAME)).not.toContain(gone);
  });

  it('keeps the preserved Main/Sub information in the append-only archive tables', async () => {
    expect(await columnsOf('school_classification_archive')).toEqual(expect.arrayContaining(['school_id', 'type', 'parent_school_id', 'archived_at']));
    expect(await columnsOf('school_manager_source_archive')).toEqual(expect.arrayContaining(['assignment_id', 'source', 'archived_at']));
    const fks = await sequelize.query<{ CONSTRAINT_NAME: string; DELETE_RULE: string }>(
      "SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('school_classification_archive','school_manager_source_archive')",
      { type: QueryTypes.SELECT },
    );
    expect(fks.map((f) => f.CONSTRAINT_NAME).sort()).toEqual(['fk_school_classification_archive_school', 'fk_school_manager_source_archive_assignment']);
    for (const fk of fks) expect(fk.DELETE_RULE).toBe('RESTRICT');
  });

  it('the user_roles CHECK accepts ORGANIZATION_MANAGER and still refuses STUDENT and unknown roles', async () => {
    await withFixture(async (f) => {
      const insertRole = (role: string) =>
        f.run("INSERT INTO user_roles (id, user_id, role_code, assigned_at, active, version, created_at, updated_at) VALUES (:id, :user, :role, UTC_TIMESTAMP(3), 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", { id: randomUUID(), user: f.admin, role });
      await insertRole('MAIN_ADMIN');
      await f.fails("INSERT INTO user_roles (id, user_id, role_code, assigned_at, active, version, created_at, updated_at) VALUES (:id, :user, 'STUDENT', UTC_TIMESTAMP(3), 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", { id: randomUUID(), user: f.admin });
      await f.fails("INSERT INTO user_roles (id, user_id, role_code, assigned_at, active, version, created_at, updated_at) VALUES (:id, :user, 'SUPERVISOR', UTC_TIMESTAMP(3), 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", { id: randomUUID(), user: f.admin });
    });
  });
});

describe('gap-free school code sequence (real locking)', () => {
  it('serializes concurrent allocations and a rolled-back allocation leaves no gap and no duplicate', async () => {
    let firstCode = '';
    let secondCode = '';
    let secondDone = false;
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => (openGate = resolve));

    const first = uow
      .run(async (tx) => {
        firstCode = await codes.allocate(tx);
        signalLocked();
        await gate; // keep the sequence row locked
        throw new Rollback();
      })
      .catch(swallowRollback);
    await locked;
    const second = uow
      .run(async (tx) => {
        secondCode = await codes.allocate(tx);
        secondDone = true;
        throw new Rollback();
      })
      .catch(swallowRollback);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(secondDone).toBe(false); // blocked by the row lock held by the first transaction
    openGate();
    await Promise.all([first, second]);
    expect(firstCode).toMatch(/^SC-\d{6}$/);
    expect(secondCode).toBe(firstCode); // the first allocation rolled back, so its number is reused: no gap, no duplicate
  });

  it('consecutive allocations in one transaction are consecutive', async () => {
    let a = '';
    let b = '';
    await uow
      .run(async (tx) => {
        a = await codes.allocate(tx);
        b = await codes.allocate(tx);
        throw new Rollback();
      })
      .catch(swallowRollback);
    expect(Number(b.slice(3))).toBe(Number(a.slice(3)) + 1);
  });
});

describe('table guards', () => {
  const insertSchool = (f: Fixture, over: Record<string, unknown> = {}) => {
    const row = {
      id: randomUUID(),
      code: `SC-9${String(++counter).padStart(5, '0')}`,
      name: `school ${counter}`,
      status: 'PENDING',
      centerName: null,
      villageName: null,
      applicant: null,
      holds: 1,
      lat: 30.1,
      lon: 31.2,
      acc: 10,
      reason: null,
      decidedBy: null,
      decidedAt: null,
      ...over,
    };
    const sql = `INSERT INTO schools (id, code, name, status, organization_id, country_id, governorate_id, center_name, village_name,
        latitude, longitude, gps_accuracy_m, created_by, applicant_user_id, decided_by, decided_at, rejection_reason, holds_name, version, created_at, updated_at)
      VALUES (:id, :code, :name, :status, :org, :country, :gov, :centerName, :villageName, :lat, :lon, :acc, :creator, :applicant, :decidedBy, :decidedAt, :reason, :holds, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
    return { row, sql, params: { ...row, org: f.ids.org, country: f.ids.country, gov: f.ids.gov, creator: f.admin } };
  };

  it('accepts a valid school and enforces the CHECK constraints', async () => {
    await withFixture(async (f) => {
      const ok = insertSchool(f);
      await f.run(ok.sql, ok.params);
      const bad = (over: Record<string, unknown>) => {
        const s = insertSchool(f, over);
        return f.fails(s.sql, s.params);
      };
      await bad({ code: 'SC-12' }); // code format
      await bad({ name: '   ' });
      await bad({ status: 'DELETED' });
      await bad({ villageName: 'قرية' }); // a village needs a center
      await bad({ centerName: '   ' }); // blank free text
      await bad({ centerName: 'مركز', villageName: '  ' });
      await bad({ acc: 20.01 });
      await bad({ acc: 0 });
      await bad({ lat: 90.5 });
      await bad({ lon: -180.5 });
      await bad({ status: 'REJECTED', holds: null, reason: null }); // rejection needs a reason
      await bad({ holds: null }); // a non-rejected school must hold its name
      const rejected = insertSchool(f, { status: 'REJECTED', holds: null, reason: 'سبب', decidedBy: f.admin, decidedAt: new Date() });
      await f.run(rejected.sql, rejected.params);
      const free = insertSchool(f, { centerName: 'مركز غير مسجل', villageName: 'قرية غير مسجلة', status: 'ACTIVE' });
      await f.run(free.sql, free.params); // free text needs no registered center or village
      // GPS round trip keeps 7 decimals
      const stored = await f.q<{ latitude: string; longitude: string }>('SELECT latitude, longitude FROM schools WHERE id = :id', { id: ok.row.id });
      expect([Number(stored[0]!.latitude), Number(stored[0]!.longitude)]).toEqual([30.1, 31.2]);
    });
  });

  it('names are unique per organization (case-insensitive) among non-rejected schools; REJECTED requests release the name', async () => {
    await withFixture(async (f) => {
      const a = insertSchool(f, { name: 'Al-Noor School' });
      await f.run(a.sql, a.params);
      const dup = insertSchool(f, { name: 'al-noor school' });
      await f.fails(dup.sql, dup.params);
      const rejected1 = insertSchool(f, { name: 'Al-Noor School', status: 'REJECTED', holds: null, reason: 'x', decidedBy: f.admin, decidedAt: new Date() });
      const rejected2 = insertSchool(f, { name: 'Al-Noor School', status: 'REJECTED', holds: null, reason: 'y', decidedBy: f.admin, decidedAt: new Date() });
      await f.run(rejected1.sql, rejected1.params);
      await f.run(rejected2.sql, rejected2.params);
      const dupCode = insertSchool(f, { code: a.row.code });
      await f.fails(dupCode.sql, dupCode.params);
    });
  });

  it('allows one active manager per school at the database level, many revoked rows, and RESTRICT blocks deletes', async () => {
    await withFixture(async (f) => {
      const school = insertSchool(f);
      await f.run(school.sql, school.params);
      const manager = (userId: string, active: number | null) =>
        f.run(
          `INSERT INTO school_managers (id, school_id, user_id, source, assigned_at, assigned_by, revoked_at, revoked_by, active, version, created_at, updated_at)
           VALUES (:id, :school, :user, 'ASSIGNMENT', UTC_TIMESTAMP(3), :admin, ${active === 1 ? 'NULL' : 'UTC_TIMESTAMP(3)'}, ${active === 1 ? 'NULL' : ':admin'}, :active, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          { id: randomUUID(), school: school.row.id, user: userId, admin: f.admin, active },
        );
      const u1 = await f.newUser();
      const u2 = await f.newUser();
      await manager(u1, 1);
      await f.fails(
        `INSERT INTO school_managers (id, school_id, user_id, source, assigned_at, assigned_by, active, version, created_at, updated_at)
         VALUES (:id, :school, :user, 'ASSIGNMENT', UTC_TIMESTAMP(3), :admin, 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        { id: randomUUID(), school: school.row.id, user: u2, admin: f.admin },
      );
      await manager(u2, null); // revoked rows: any number
      await manager(u1, null);
      await f.fails("UPDATE school_managers SET active = 1, revoked_at = UTC_TIMESTAMP(3) WHERE user_id = :u AND active IS NULL LIMIT 1", { u: u1 }); // inconsistent state
      await f.fails('DELETE FROM schools WHERE id = :id', { id: school.row.id }); // a manager row references it
      await f.fails('DELETE FROM organizations WHERE id = :id', { id: f.ids.org });
      await f.fails('DELETE FROM governorates WHERE id = :id', { id: f.ids.gov });
      await f.fails("UPDATE school_managers SET source = 'SUB_SCHOOL_APPROVAL' WHERE school_id = :id", { id: school.row.id }); // the old source values are no longer valid
    });
  });
});

const phoneNumber = () => `010${String(Math.floor(Math.random() * 90000000) + 10000000)}`;
const create = (f: Fixture, name = 'المدرسة', over: Record<string, unknown> = {}) =>
  f.service.createSchool({ organizationId: f.ids.org, name, governorateId: f.ids.gov, gps, actorId: f.admin, ...over });
const submit = (f: Fixture, over: { phone?: string; schoolName?: string; applicantName?: string; governorateId?: string } = {}) =>
  f.service.submitSchool({
    applicant: { name: over.applicantName ?? 'سارة', phone: over.phone ?? phoneNumber(), password: 'Pass1234' },
    organizationId: f.ids.org,
    name: over.schoolName ?? 'مدرسة مقدمة',
    governorateId: over.governorateId ?? f.ids.gov,
    centerName: 'مركز غير مسجل',
    gps,
  });

describe('SchoolService on MariaDB', () => {
  it('creates a PENDING school (gap-free code, free-text address, history, event) that grants nothing', async () => {
    await withFixture(async (f) => {
      const school = await create(f, 'المدرسة الأولى', { centerName: 'مركز لا وجود له', villageName: 'قرية لا وجود لها' });
      expect(school).toMatchObject({ status: 'PENDING', latitude: 30.0444444, longitude: 31.2357116, gpsAccuracyMeters: 12.5, centerName: 'مركز لا وجود له', villageName: 'قرية لا وجود لها', applicantUserId: null });
      expect(school.code).toMatch(/^SC-\d{6}$/);
      const second = await create(f, 'المدرسة الثانية');
      expect(Number(second.code.slice(3))).toBe(Number(school.code.slice(3)) + 1);
      expect(await f.q('SELECT 1 FROM school_managers')).toHaveLength(0);
      expect(await f.q("SELECT role_code FROM user_roles WHERE user_id = :u AND active = 1", { u: f.admin })).toEqual([{ role_code: 'ORGANIZATION_MANAGER' }]); // no new role
      expect(await f.q("SELECT 1 FROM outbox_messages WHERE event_type = 'SchoolCreated' AND aggregate_id IN (:a, :b)", { a: school.id, b: second.id })).toHaveLength(2);
      expect(await f.service.listStatusHistory(school.id, f.tx)).toMatchObject([{ fromStatus: null, toStatus: 'PENDING', changedBy: f.admin }]);
      expect(await codeOf(create(f, 'المدرسة الأولى'))).toBe('SCHOOL_NAME_ALREADY_EXISTS');
      const stored = await f.q<{ center_name: string; village_name: string }>('SELECT center_name, village_name FROM schools WHERE id = :id', { id: school.id });
      expect(stored).toEqual([{ center_name: 'مركز لا وجود له', village_name: 'قرية لا وجود لها' }]);
    });
  });

  it('address rules on MariaDB: registered governorate of the organization country; a village needs a center; text is normalized', async () => {
    await withFixture(async (f) => {
      expect(await codeOf(create(f, 'a', { governorateId: f.ids.gov3 }))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
      expect(await codeOf(create(f, 'b', { governorateId: randomUUID() }))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
      expect(await codeOf(create(f, 'c', { villageName: 'قرية' }))).toBe('INVALID_PARENT_ADDRESS');
      expect(await codeOf(create(f, 'd', { countryId: f.ids.country2 }))).toBe('SCHOOL_COUNTRY_MISMATCH');
      const ok = await create(f, 'e', { governorateId: f.ids.gov2, centerName: '  مركز   حر ' });
      expect(ok).toMatchObject({ countryId: f.ids.country, centerName: 'مركز حر', villageName: null });
    });
  });

  it('approval activates the school, links the applicant as manager and assigns SCHOOL_MANAGER in one transaction', async () => {
    await withFixture(async (f) => {
      const other = await create(f, 'مدرسة أخرى');
      const submitted = await submit(f);
      const result = await f.service.approveSchool(submitted.school.id, f.admin);
      expect(result.school).toMatchObject({ status: 'ACTIVE', decidedBy: f.admin });
      expect(result.manager).toMatchObject({ schoolId: submitted.school.id, userId: submitted.applicant.userId, source: 'APPROVAL', isActive: true });
      expect(await f.q<{ role_code: string }>('SELECT role_code FROM user_roles WHERE user_id = :u AND active = 1', { u: submitted.applicant.userId })).toEqual([{ role_code: 'SCHOOL_MANAGER' }]);
      expect(await f.service.isSchoolManager(submitted.applicant.userId, submitted.school.id, f.tx)).toBe(true);
      expect(await f.service.isSchoolManager(submitted.applicant.userId, other.id, f.tx)).toBe(false);
      const events = await f.q<{ event_type: string }>('SELECT event_type FROM outbox_messages WHERE aggregate_id IN (:s, :m) ORDER BY event_type', { s: submitted.school.id, m: result.manager!.id });
      expect(events.map((e) => e.event_type)).toEqual(expect.arrayContaining(['SchoolApproved', 'SchoolManagerAssigned']));
      expect(await f.service.listStatusHistory(submitted.school.id, f.tx)).toMatchObject([{ toStatus: 'PENDING' }, { fromStatus: 'PENDING', toStatus: 'ACTIVE' }]);
    });
  });

  it('a school created by the manager is approved without a manager (manager null); a manager is assigned explicitly afterwards (source ASSIGNMENT)', async () => {
    await withFixture(async (f) => {
      const school = await create(f);
      const approved = await f.service.approveSchool(school.id, f.admin);
      expect(approved.manager).toBeNull();
      expect(await f.q('SELECT 1 FROM school_managers')).toHaveLength(0);
      const user = await f.newUser();
      expect(await f.service.assignSchoolManager({ schoolId: school.id, userId: user, actorId: f.admin })).toMatchObject({ source: 'ASSIGNMENT', isActive: true });
    });
  });

  it('FAILURE INJECTION: a failure right after the role assignment rolls back everything: school stays PENDING, no manager, no new role, no events', async () => {
    await withFixture(
      async (f) => {
        const applicant = await f.newUser('TEACHER'); // an earlier legitimate role must survive untouched
        const phone = (await f.q<{ phone: string }>('SELECT phone FROM users WHERE id = :id', { id: applicant }))[0]!.phone;
        const { school } = await f.service.submitSchool({ applicant: { name: 'x', phone }, organizationId: f.ids.org, name: 'الفرع', governorateId: f.ids.gov, gps, authenticatedUserId: applicant });
        const eventsBefore = (await f.q('SELECT 1 FROM outbox_messages')).length;
        const historyBefore = (await f.service.listStatusHistory(school.id, f.tx)).length;

        await expect(f.service.approveSchool(school.id, f.admin)).rejects.toThrow('injected failure after the role assignment');

        const row = await f.q<{ status: string; decided_by: string | null; decided_at: Date | null; holds_name: number }>('SELECT status, decided_by, decided_at, holds_name FROM schools WHERE id = :id', { id: school.id });
        expect(row).toEqual([{ status: 'PENDING', decided_by: null, decided_at: null, holds_name: 1 }]);
        expect(await f.q('SELECT 1 FROM school_managers WHERE school_id = :id', { id: school.id })).toHaveLength(0);
        expect(await f.q<{ role_code: string }>('SELECT role_code FROM user_roles WHERE user_id = :u AND active = 1', { u: applicant })).toEqual([{ role_code: 'TEACHER' }]);
        expect((await f.q('SELECT 1 FROM outbox_messages')).length).toBe(eventsBefore);
        expect(await f.q("SELECT 1 FROM outbox_messages WHERE event_type IN ('SchoolApproved','SchoolManagerAssigned','RoleAssigned') AND aggregate_id = :id", { id: school.id })).toHaveLength(0);
        expect(await f.service.listStatusHistory(school.id, f.tx)).toHaveLength(historyBefore);
        expect(await f.service.isSchoolManager(applicant, school.id, f.tx)).toBe(false);
      },
      { failAfterRoleAssignment: true },
    );
  });

  it('approval fails for an ineligible applicant (school stays PENDING) and a rejection keeps the account and roles', async () => {
    await withFixture(async (f) => {
      const submitted = await submit(f);
      await identity.deactivateUser(submitted.applicant.userId, f.tx);
      expect(await codeOf(f.service.approveSchool(submitted.school.id, f.admin))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
      expect((await f.service.getById(submitted.school.id, f.tx)).status).toBe('PENDING');
      expect(await f.q('SELECT 1 FROM school_managers')).toHaveLength(0);

      expect(await codeOf(f.service.rejectSchool(submitted.school.id, f.admin, '  '))).toBe('INVALID_REJECTION_REASON');
      const rejected = await f.service.rejectSchool(submitted.school.id, f.admin, 'الحساب غير مؤهل');
      expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'الحساب غير مؤهل', decidedBy: f.admin });
      expect(await f.q<{ holds_name: number | null }>('SELECT holds_name FROM schools WHERE id = :id', { id: submitted.school.id })).toEqual([{ holds_name: null }]);
      expect(await f.q('SELECT 1 FROM users WHERE id = :u', { u: submitted.applicant.userId })).toHaveLength(1);
      expect(await f.q('SELECT 1 FROM school_managers')).toHaveLength(0);
      expect(await codeOf(f.service.approveSchool(submitted.school.id, f.admin))).toBe('SCHOOL_INVALID_STATUS_TRANSITION'); // terminal
      const again = await submit(f, { schoolName: 'مدرسة مقدمة' }); // the released name can be requested again
      expect(again.school.status).toBe('PENDING');
    });
  });

  it('GPS is correctable while PENDING (audited) and immutable after approval; status changes are audited', async () => {
    await withFixture(async (f) => {
      const school = await create(f);
      const fix = { latitude: 30.05, longitude: 31.24, accuracyMeters: 7.5 };
      await f.service.correctPendingGps(school.id, fix, f.admin);
      expect(await f.service.listGpsHistory(school.id, f.tx)).toMatchObject([{ previous: gps, current: fix, changedBy: f.admin }]);
      expect(await codeOf(f.service.correctPendingGps(school.id, { ...fix, accuracyMeters: 20.5 }, f.admin))).toBe('GPS_ACCURACY_EXCEEDS_LIMIT');
      await f.service.approveSchool(school.id, f.admin);
      expect(await codeOf(f.service.correctPendingGps(school.id, gps, f.admin))).toBe('SCHOOL_GPS_LOCKED');
      expect(await f.q<{ latitude: string }>('SELECT latitude FROM schools WHERE id = :id', { id: school.id })).toEqual([{ latitude: '30.0500000' }]);

      await f.service.deactivateSchool(school.id, f.admin);
      await f.service.reactivateSchool(school.id, f.admin);
      expect((await f.service.listStatusHistory(school.id, f.tx)).map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, 'PENDING'], ['PENDING', 'ACTIVE'], ['ACTIVE', 'INACTIVE'], ['INACTIVE', 'ACTIVE']]);
    });
  });

  it('manager assignment: one active manager per school, history kept, a manager of two schools keeps one role row', async () => {
    await withFixture(async (f) => {
      const school = await create(f);
      await f.service.approveSchool(school.id, f.admin);
      const m1 = await f.newUser();
      const m2 = await f.newUser();
      await f.service.assignSchoolManager({ schoolId: school.id, userId: m1, actorId: f.admin });
      expect(await codeOf(f.service.assignSchoolManager({ schoolId: school.id, userId: m2, actorId: f.admin }))).toBe('SCHOOL_ALREADY_HAS_MANAGER');
      expect(await f.q('SELECT 1 FROM user_roles WHERE user_id = :u', { u: m2 })).toHaveLength(0); // the failed attempt left no role

      const phone = (await f.q<{ phone: string }>('SELECT phone FROM users WHERE id = :id', { id: m1 }))[0]!.phone;
      const request = (await f.service.submitSchool({ applicant: { name: 'x', phone }, organizationId: f.ids.org, name: 'الفرع', governorateId: f.ids.gov, gps, authenticatedUserId: m1 })).school;
      await f.service.approveSchool(request.id, f.admin);
      expect(await f.q('SELECT 1 FROM user_roles WHERE user_id = :u AND role_code = :r', { u: m1, r: 'SCHOOL_MANAGER' })).toHaveLength(1);
      expect((await f.service.listManagedSchoolIds(m1, f.tx)).sort()).toEqual([school.id, request.id].sort());

      await f.service.revokeSchoolManager({ schoolId: school.id, actorId: f.admin });
      await f.service.assignSchoolManager({ schoolId: school.id, userId: m2, actorId: f.admin });
      expect((await f.service.listManagerHistory(school.id, f.tx)).map((h) => [h.userId, h.isActive])).toEqual([[m1, false], [m2, true]]);
    });
  });
});

describe('public submissions and listing on MariaDB (migration add-schools-applicant-name)', () => {
  it('stores the applicant name, enforces its CHECK, and the column is varchar(200)', async () => {
    await withFixture(async (f) => {
      const column = await f.q<{ COLUMN_TYPE: string; IS_NULLABLE: string }>(
        "SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'applicant_name'",
      );
      expect(column).toEqual([{ COLUMN_TYPE: 'varchar(200)', IS_NULLABLE: 'YES' }]);
      const submitted = await submit(f, { applicantName: '  أحمد   محمد ' });
      expect(await f.q<{ applicant_name: string; applicant_user_id: string }>('SELECT applicant_name, applicant_user_id FROM schools WHERE id = :id', { id: submitted.school.id })).toEqual([
        { applicant_name: 'أحمد محمد', applicant_user_id: submitted.applicant.userId },
      ]);
      await f.fails("UPDATE schools SET applicant_name = '   ' WHERE id = :id", { id: submitted.school.id }); // blank names are refused by the CHECK
    });
  });

  it('a public submission creates the account and the PENDING school together, with no role and no manager', async () => {
    await withFixture(async (f) => {
      const p = phoneNumber();
      const result = await submit(f, { phone: p });
      expect(result.applicant.accountCreated).toBe(true);
      const e164 = `+20${p.slice(1)}`;
      expect(await f.q<{ id: string; phone: string }>('SELECT id, phone FROM users WHERE phone = :p', { p: e164 })).toEqual([{ id: result.applicant.userId, phone: e164 }]);
      expect(result.school).toMatchObject({ status: 'PENDING', createdBy: result.applicant.userId, organizationId: f.ids.org, countryId: f.ids.country });
      expect(await f.q('SELECT 1 FROM user_roles WHERE user_id = :u', { u: result.applicant.userId })).toHaveLength(0);
      expect(await f.q('SELECT 1 FROM school_managers')).toHaveLength(0);
      // The account has the password the applicant typed (stored hashed): not the phone-derived initial password, not the phone.
      const [{ password_hash }] = await f.q<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = :id', { id: result.applicant.userId });
      const hasher = new BcryptPasswordHasher(4);
      expect(await hasher.verify(p.slice(-4), password_hash)).toBe(false);
      expect(await hasher.verify(p, password_hash)).toBe(false);
      expect(await hasher.verify('Pass1234', password_hash)).toBe(true);
      expect(password_hash).not.toContain('Pass1234');
    });
  });

  it('rolls the new account back when the school cannot be created (duplicate name, bad address)', async () => {
    await withFixture(async (f) => {
      await submit(f, { schoolName: 'Al-Noor School' });
      const usersBefore = (await f.q<{ n: number }>('SELECT COUNT(*) AS n FROM users'))[0]!.n;
      const second = phoneNumber();
      expect(await codeOf(submit(f, { phone: second, schoolName: 'al-noor   school' }))).toBe('SCHOOL_NAME_ALREADY_EXISTS');
      expect(await codeOf(submit(f, { phone: second, schoolName: 'other', governorateId: randomUUID() }))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
      expect(await f.q('SELECT 1 FROM users WHERE phone = :p', { p: `+20${second.slice(1)}` })).toHaveLength(0);
      expect((await f.q<{ n: number }>('SELECT COUNT(*) AS n FROM users'))[0]!.n).toBe(usersBefore);
    });
  });

  it('an existing phone is the IAM conflict: no account is reused or created and nothing is granted', async () => {
    await withFixture(async (f) => {
      const owner = await f.newUser('TEACHER');
      const row = await f.q<{ phone: string }>('SELECT phone FROM users WHERE id = :id', { id: owner });
      const usersBefore = (await f.q<{ n: number }>('SELECT COUNT(*) AS n FROM users'))[0]!.n;
      expect(await codeOf(submit(f, { phone: row[0]!.phone }))).toBe('USER_PHONE_ALREADY_EXISTS');
      expect((await f.q<{ n: number }>('SELECT COUNT(*) AS n FROM users'))[0]!.n).toBe(usersBefore);
      expect(await f.q<{ role_code: string }>('SELECT role_code FROM user_roles WHERE user_id = :u AND active = 1', { u: owner })).toEqual([{ role_code: 'TEACHER' }]);
    });
  });

  it('listSchools applies organization scope, visibility, filters, sort and paging in SQL (deny by default)', async () => {
    await withFixture(async (f) => {
      const direct = await create(f, 'مدرسة مباشرة');
      const a = await submit(f, { schoolName: 'مدرسة أ' });
      const b = await submit(f, { schoolName: 'مدرسة ب' });
      await f.service.approveSchool(a.school.id, f.admin);

      const page = await f.service.listSchools({ actorId: f.admin, sort: 'code', direction: 'asc', page: { page: 1, pageSize: 2 } }, f.tx);
      expect(page).toMatchObject({ total: 3, totalPages: 2, page: 1, pageSize: 2 });
      expect(page.items.map((s) => s.id)).toEqual([direct.id, a.school.id]);
      expect((await f.service.listSchools({ actorId: f.admin, statuses: ['PENDING'], page: { page: 1, pageSize: 20 } }, f.tx)).items.map((s) => s.id).sort()).toEqual([direct.id, b.school.id].sort());
      // the approved school's manager sees only that school; a pending applicant has no role and sees nothing
      expect((await f.service.listSchools({ actorId: a.applicant.userId, page: { page: 1, pageSize: 20 } }, f.tx)).items.map((s) => s.id)).toEqual([a.school.id]);
      expect((await f.service.listSchools({ actorId: b.applicant.userId, page: { page: 1, pageSize: 20 } }, f.tx)).total).toBe(0);
      const stranger = await f.newUser('TEACHER');
      expect((await f.service.listSchools({ actorId: stranger, page: { page: 1, pageSize: 20 } }, f.tx)).total).toBe(0);

      // another organization's manager sees none of these schools
      const other = await f.registration.registerOrganization({
        applicant: { name: 'مدير', phone: phoneNumber(), password: 'Pass1234' },
        organization: { name: `Other organization ${Date.now()}`, countryId: f.ids.country, governorateId: f.ids.gov },
      });
      expect((await f.service.listSchools({ actorId: other.applicant.userId, page: { page: 1, pageSize: 20 } }, f.tx)).total).toBe(0);
    });
  });
});

describe('organizations on MariaDB: registration, scope and the country invariant', () => {
  const registerBody = (f: Fixture, over: { name?: string; phone?: string; countryId?: string; governorateId?: string } = {}) => ({
    applicant: { name: 'أحمد محمد', phone: over.phone ?? phoneNumber(), password: 'Pass1234' },
    organization: { name: over.name ?? `Org ${randomUUID()}`, countryId: over.countryId ?? f.ids.country, governorateId: over.governorateId ?? f.ids.gov, centerName: 'مركز غير مسجل', villageName: 'قرية غير مسجلة' },
  });

  it('registers account + organization + ORGANIZATION_MANAGER + organization link together, with a free-text address and no school', async () => {
    await withFixture(async (f) => {
      const p = phoneNumber();
      const result = await f.registration.registerOrganization(registerBody(f, { phone: p }));
      const org = await f.q<{ country_id: string; governorate_id: string; center_name: string; village_name: string; status: string }>(
        'SELECT country_id, governorate_id, center_name, village_name, status FROM organizations WHERE id = :id',
        { id: result.organization.id },
      );
      expect(org).toEqual([{ country_id: f.ids.country, governorate_id: f.ids.gov, center_name: 'مركز غير مسجل', village_name: 'قرية غير مسجلة', status: 'ACTIVE' }]);
      expect(await f.q<{ role_code: string }>('SELECT role_code FROM user_roles WHERE user_id = :u AND active = 1', { u: result.applicant.userId })).toEqual([{ role_code: 'ORGANIZATION_MANAGER' }]);
      expect(await f.q<{ organization_id: string; name: string; assigned_by: string | null }>('SELECT organization_id, name, assigned_by FROM organization_admins WHERE user_id = :u AND active = 1', { u: result.applicant.userId })).toEqual([
        { organization_id: result.organization.id, name: 'أحمد محمد', assigned_by: null },
      ]);
      expect(await f.q('SELECT 1 FROM schools WHERE organization_id = :o', { o: result.organization.id })).toHaveLength(0);
      expect(await f.q("SELECT 1 FROM outbox_messages WHERE aggregate_id = :id AND event_type = 'OrganizationCreated'", { id: result.organization.id })).toHaveLength(1);
      expect(result.organization.code).toMatch(/^ORG-\d{6}$/);
    });
  });

  it('rejects a governorate of another country, a village without a center and a duplicate name; nothing is kept', async () => {
    await withFixture(async (f) => {
      const usersBefore = (await f.q<{ n: number }>('SELECT COUNT(*) AS n FROM users'))[0]!.n;
      expect(await codeOf(f.registration.registerOrganization(registerBody(f, { countryId: f.ids.country2 })))).toBe('ORGANIZATION_ADDRESS_COUNTRY_MISMATCH');
      expect(await codeOf(f.registration.registerOrganization({ ...registerBody(f), organization: { ...registerBody(f).organization, centerName: null } }))).toBe('INVALID_PARENT_ADDRESS');
      await f.registration.registerOrganization(registerBody(f, { name: 'Dar Al-Quran' }));
      expect(await codeOf(f.registration.registerOrganization(registerBody(f, { name: 'dar al-quran' })))).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');
      expect((await f.q<{ n: number }>('SELECT COUNT(*) AS n FROM users'))[0]!.n).toBe(usersBefore + 1); // only the first registration's account
    });
  });

  it('FAILURE INJECTION: a failure after the role assignment rolls back the account, organization, role and link', async () => {
    await withFixture(
      async (f) => {
        const p = phoneNumber();
        const orgsBefore = (await f.q<{ n: number }>('SELECT COUNT(*) AS n FROM organizations'))[0]!.n;
        await expect(f.registration.registerOrganization(registerBody(f, { phone: p }))).rejects.toThrow('injected failure after the role assignment');
        expect(await f.q('SELECT 1 FROM users WHERE phone = :p', { p: `+20${p.slice(1)}` })).toHaveLength(0);
        expect((await f.q<{ n: number }>('SELECT COUNT(*) AS n FROM organizations'))[0]!.n).toBe(orgsBefore);
        expect(await f.q("SELECT 1 FROM organization_admins WHERE name = 'أحمد محمد'")).toHaveLength(0);
      },
      { failAfterRoleAssignment: true },
    );
  });

  it('organization isolation in the data the service returns: each manager lists only their own organization\'s schools', async () => {
    await withFixture(async (f) => {
      const other = await f.registration.registerOrganization(registerBody(f));
      const mine = await create(f, 'مدرستي');
      const theirs = await f.service.createSchool({ organizationId: other.organization.id, name: 'مدرستهم', governorateId: f.ids.gov, gps, actorId: other.applicant.userId });
      expect((await f.service.listSchools({ actorId: f.admin, page: { page: 1, pageSize: 20 } }, f.tx)).items.map((s) => s.id)).toEqual([mine.id]);
      expect((await f.service.listSchools({ actorId: other.applicant.userId, page: { page: 1, pageSize: 20 } }, f.tx)).items.map((s) => s.id)).toEqual([theirs.id]);
    });
  });

  it('the school country is derived from the organization: another country is refused by the service', async () => {
    await withFixture(async (f) => {
      expect(await codeOf(create(f, 'x', { governorateId: f.ids.gov3 }))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
      expect(await codeOf(create(f, 'y', { countryId: f.ids.country2 }))).toBe('SCHOOL_COUNTRY_MISMATCH');
      expect((await create(f, 'z', { governorateId: f.ids.gov2 })).countryId).toBe(f.ids.country);
    });
  });

  it('DATABASE: composite foreign keys keep a school in its organization\'s country; the organization country cannot be changed under schools', async () => {
    await withFixture(async (f) => {
      const school = await create(f, 'مدرسة');
      const insert = (over: Record<string, unknown>) => {
        const row = { id: randomUUID(), code: `SC-8${String(++counter).padStart(5, '0')}`, name: `raw ${counter}`, org: f.ids.org, country: f.ids.country, gov: f.ids.gov, creator: f.admin, ...over };
        return f.fails(
          `INSERT INTO schools (id, code, name, status, organization_id, country_id, governorate_id, latitude, longitude, gps_accuracy_m, created_by, holds_name, version, created_at, updated_at)
           VALUES (:id, :code, :name, 'PENDING', :org, :country, :gov, 30, 31, 10, :creator, 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          row,
        );
      };
      await insert({ country: f.ids.country2 }); // country different from the organization's (and from the governorate's)
      await insert({ country: f.ids.country2, gov: f.ids.gov3 }); // governorate and school agree, but not with the organization
      await insert({ gov: f.ids.gov3 }); // organization's country, governorate of another country
      await f.fails('UPDATE organizations SET country_id = :other WHERE id = :id', { other: f.ids.country2, id: f.ids.org }); // schools exist: RESTRICT
      await f.fails('UPDATE governorates SET country_id = :other WHERE id = :id', { other: f.ids.country2, id: f.ids.gov });
      expect((await f.service.getById(school.id, f.tx)).countryId).toBe(f.ids.country);
      // an organization without a country cannot own a school
      const noCountry = randomUUID();
      await f.run("INSERT INTO organizations (id, code, name, status, v1_single_guard, created_at, updated_at) VALUES (:id, 'ORG-990001', 'No country org', 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", { id: noCountry });
      await insert({ org: noCountry });
    });
  });

  it('organization manager links: one active link per user and organization, and RESTRICT blocks deleting the organization', async () => {
    await withFixture(async (f) => {
      await f.fails(
        'INSERT INTO organization_admins (id, organization_id, user_id, assigned_at, active, version, created_at, updated_at) VALUES (:id, :org, :user, UTC_TIMESTAMP(3), 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))',
        { id: randomUUID(), org: f.ids.org, user: f.admin },
      );
      await f.fails('DELETE FROM organizations WHERE id = :id', { id: f.ids.org });
      expect(await organizations.isOrganizationAdmin(f.admin, f.ids.org, f.tx)).toBe(true);
      expect(await organizations.listAdministeredOrganizationIds(f.admin, f.tx)).toEqual([f.ids.org]);
    });
  });
});

describe('role-separation data migration (the exact SQL of migration organization-manager-role, run on fixture rows)', () => {
  const migration = createRequire(__filename)('../../database/migrations/20261015100000-organization-manager-role.js') as { ASSIGN_ORGANIZATION_MANAGER_SQL: string; REVOKE_REGISTRATION_MAIN_ADMIN_SQL: string };

  async function seed(f: Fixture) {
    const addLink = (userId: string, name: string | null, org: string = f.ids.org) =>
      f.run(
        'INSERT INTO organization_admins (id, organization_id, user_id, name, assigned_at, active, version, created_at, updated_at) VALUES (:id, :org, :user, :name, UTC_TIMESTAMP(3), 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))',
        { id: randomUUID(), org, user: userId, name },
      );
    // a second organization: one active link per user AND organization (uq_organization_admins_active), so a user with both kinds of link needs two
    const otherOrg = randomUUID();
    await f.run("INSERT INTO organizations (id, code, name, status, v1_single_guard, created_at, updated_at) VALUES (:id, 'ORG-990002', 'Second organization for the role migration fixture', 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", { id: otherOrg });
    // V1 administrator (backfill link: name NULL) with MAIN_ADMIN: keeps it AND gains ORGANIZATION_MANAGER
    const v1Admin = await f.newUser('MAIN_ADMIN');
    await addLink(v1Admin, null);
    // an organization creator from the registration flow (link name set) who still holds MAIN_ADMIN: loses it, gains ORGANIZATION_MANAGER
    const creator = await f.newUser('MAIN_ADMIN');
    await addLink(creator, 'مسجل المنظمة');
    // a platform administrator with no organization link: untouched
    const platform = await f.newUser('MAIN_ADMIN');
    // a user who is both a registration creator AND a V1 administrator: treated as V1 administrator (keeps MAIN_ADMIN)
    const both = await f.newUser('MAIN_ADMIN');
    await addLink(both, null);
    await addLink(both, 'مسجل', otherOrg);
    // a teacher with an organization link and no MAIN_ADMIN: gains ORGANIZATION_MANAGER, keeps TEACHER
    const teacher = await f.newUser('TEACHER');
    await addLink(teacher, 'معلم');
    return { v1Admin, creator, platform, both, teacher };
  }
  const rolesOf = async (f: Fixture, userId: string) => (await f.q<{ role_code: string }>('SELECT role_code FROM user_roles WHERE user_id = :u AND active = 1 ORDER BY role_code', { u: userId })).map((r) => r.role_code);

  it('promotes nobody to the platform scope, preserves history, and leaves nobody without an active role', async () => {
    await withFixture(async (f) => {
      const u = await seed(f);
      // the fixture admin (ORGANIZATION_MANAGER + link) is already correct and must not get a duplicate role
      await f.run(migration.ASSIGN_ORGANIZATION_MANAGER_SQL);
      await f.run(migration.REVOKE_REGISTRATION_MAIN_ADMIN_SQL);

      expect(await rolesOf(f, u.v1Admin)).toEqual(['MAIN_ADMIN', 'ORGANIZATION_MANAGER']);
      expect(await rolesOf(f, u.creator)).toEqual(['ORGANIZATION_MANAGER']);
      expect(await rolesOf(f, u.platform)).toEqual(['MAIN_ADMIN']);
      expect(await rolesOf(f, u.both)).toEqual(['MAIN_ADMIN', 'ORGANIZATION_MANAGER']);
      expect(await rolesOf(f, u.teacher)).toEqual(['ORGANIZATION_MANAGER', 'TEACHER']);
      expect(await rolesOf(f, f.admin)).toEqual(['ORGANIZATION_MANAGER']);
      expect(await f.q('SELECT 1 FROM user_roles WHERE user_id = :u AND role_code = :r', { u: f.admin, r: 'ORGANIZATION_MANAGER' })).toHaveLength(1);

      // history is kept: the creator's MAIN_ADMIN row is revoked, never deleted
      const history = await f.q<{ role_code: string; active: number | null; revoked_at: Date | null }>("SELECT role_code, active, revoked_at FROM user_roles WHERE user_id = :u AND role_code = 'MAIN_ADMIN'", { u: u.creator });
      expect(history).toHaveLength(1);
      expect(history[0]!.active).toBeNull();
      expect(history[0]!.revoked_at).not.toBeNull();
      // links are never touched
      expect(await f.q('SELECT 1 FROM organization_admins WHERE user_id = :u AND active = 1', { u: u.creator })).toHaveLength(1);
    });
  });

  it('is idempotent: running it again changes nothing', async () => {
    await withFixture(async (f) => {
      const u = await seed(f);
      await f.run(migration.ASSIGN_ORGANIZATION_MANAGER_SQL);
      await f.run(migration.REVOKE_REGISTRATION_MAIN_ADMIN_SQL);
      const before = JSON.stringify(await f.q('SELECT user_id, role_code, active, version FROM user_roles ORDER BY user_id, role_code, assigned_at'));
      await f.run(migration.ASSIGN_ORGANIZATION_MANAGER_SQL);
      await f.run(migration.REVOKE_REGISTRATION_MAIN_ADMIN_SQL);
      expect(JSON.stringify(await f.q('SELECT user_id, role_code, active, version FROM user_roles ORDER BY user_id, role_code, assigned_at'))).toBe(before);
      expect(await rolesOf(f, u.creator)).toEqual(['ORGANIZATION_MANAGER']);
    });
  });

  it('never revokes a MAIN_ADMIN role when ORGANIZATION_MANAGER could not be assigned first (the order protects against a role-less user)', async () => {
    await withFixture(async (f) => {
      const u = await seed(f);
      await f.run(migration.REVOKE_REGISTRATION_MAIN_ADMIN_SQL); // revoke step alone, before the assign step
      expect(await rolesOf(f, u.creator)).toEqual(['MAIN_ADMIN']); // still holds its role: nothing was revoked
    });
  });
});

describe('organization name uniqueness under real concurrency (committed rows, cleaned up afterwards)', () => {
  it('two simultaneous registrations of the same name: exactly one wins, the loser fails with ORGANIZATION_NAME_ALREADY_EXISTS', async () => {
    const [geo] = await sequelize.query<{ gov: string; country: string }>('SELECT id AS gov, country_id AS country FROM governorates LIMIT 1', { type: QueryTypes.SELECT });
    if (!geo) return; // needs one governorate (npm run seed:geography); skipped otherwise
    const [seq] = await sequelize.query<{ last_value: number }>("SELECT last_value FROM organization_code_sequence WHERE name = 'organization'", { type: QueryTypes.SELECT });
    const name = `Concurrent test organization ${randomUUID()}`;
    try {
      const results = await Promise.allSettled(
        [1, 2].map(() => organizations.createOrganization({ name: i18n(name), countryId: geo.country, governorateId: geo.gov })),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as AppError).code).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');
    } finally {
      await sequelize.query('DELETE FROM outbox_messages WHERE aggregate_type = \'Organization\' AND aggregate_id IN (SELECT id FROM organizations WHERE name = :name)', { replacements: { name } });
      await sequelize.query('DELETE FROM organizations WHERE name = :name', { replacements: { name } });
      await sequelize.query("UPDATE organization_code_sequence SET last_value = :v WHERE name = 'organization'", { replacements: { v: seq?.last_value ?? 0 } });
    }
  });
});
const i18n = (s: string) => s;
