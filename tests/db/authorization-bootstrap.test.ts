/**
 * Real-database checks for the first-Main-Admin bootstrap (Module 12) and RoleService.countActiveByRole (Module 09).
 * NOT part of `npm test`. Prerequisite: `npm run db:migrate` (creates authorization_bootstrap_lock). Run: npm run test:db
 * IMPORTANT: run against a database with NO active Main Admin (a fresh development database). The first test refuses to
 * run otherwise, because the bootstrap must refuse when one exists. Test users use phones starting with +2010995
 * (never real numbers); they, their role rows and their outbox rows are deleted afterwards.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize } from '../../src/modules/02-database/public';
import { OutboxService, SequelizeOutboxStore } from '../../src/modules/06-domain-events-outbox/public';
import { BcryptPasswordHasher, IdentityService, SequelizeUserRepository } from '../../src/modules/08-identity-core/public';
import { PermissionRegistry, RoleService, SequelizeRoleAssignmentRepository } from '../../src/modules/09-roles-permissions/public';
import { BootstrapMainAdmin, SequelizeBootstrapGuard } from '../../src/modules/12-authorization-engine/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const outbox = new OutboxService(new SequelizeOutboxStore(sequelize));
const identity = new IdentityService({ repository: new SequelizeUserRepository(sequelize), hasher: new BcryptPasswordHasher(4), unitOfWork: uow, outbox });
const roles = new RoleService({
  repository: new SequelizeRoleAssignmentRepository(sequelize),
  identity,
  permissions: new PermissionRegistry(),
  unitOfWork: uow,
  outbox,
});
const makeBootstrap = () => new BootstrapMainAdmin({ identity, roles, guard: new SequelizeBootstrapGuard(sequelize), unitOfWork: uow });

// Each DB test file owns a distinct prefix (users 999, roles 998, sessions 997, recovery 996, this file 995): files run in parallel against one database.
const PREFIX = '+2010995';
const TEST_USERS = `SELECT id FROM users WHERE phone LIKE '${PREFIX}%'`;
let counter = Math.floor(Math.random() * 50000);
const phone = () => `${PREFIX}${String(++counter).padStart(5, '0')}`;

async function cleanup() {
  await sequelize.query(
    `DELETE FROM outbox_messages WHERE aggregate_type = 'RoleAssignment'
       AND aggregate_id IN (SELECT id FROM user_roles WHERE user_id IN (${TEST_USERS}))`,
  );
  await sequelize.query(`DELETE FROM outbox_messages WHERE aggregate_type = 'User' AND aggregate_id IN (${TEST_USERS})`);
  await sequelize.query(`DELETE FROM user_roles WHERE user_id IN (${TEST_USERS})`);
  await sequelize.query(`DELETE FROM users WHERE phone LIKE '${PREFIX}%'`);
  await sequelize.query('UPDATE authorization_bootstrap_lock SET last_bootstrap_user_id = NULL, last_bootstrapped_at = NULL WHERE id = 1');
}
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

beforeAll(async () => {
  await cleanup();
  const existing = await roles.countActiveByRole('MAIN_ADMIN');
  if (existing > 0) throw new Error('This database already has an active Main Admin; run these tests on a fresh development database.');
});
afterAll(async () => {
  await cleanup();
  await sequelize.close();
});

describe('authorization_bootstrap_lock', () => {
  it('has exactly one row (id = 1) and a CHECK that forbids any other', async () => {
    const rows = await sequelize.query<{ id: number }>('SELECT id FROM authorization_bootstrap_lock', { type: QueryTypes.SELECT });
    expect(rows.map((r) => Number(r.id))).toEqual([1]);
    await expect(
      sequelize.query('INSERT INTO authorization_bootstrap_lock (id, created_at, updated_at) VALUES (2, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))'),
    ).rejects.toThrow();
  });
});

describe('BootstrapMainAdmin (real database)', () => {
  it('creates the user and the active MAIN_ADMIN assignment atomically, and records the trace', async () => {
    const adminPhone = phone();
    const { userId } = await makeBootstrap().execute({ phone: adminPhone, password: 'Adm1n-pw' });
    expect(await roles.listActiveRoles(userId)).toEqual(['MAIN_ADMIN']);
    expect(await roles.countActiveByRole('MAIN_ADMIN')).toBe(1);
    const [lock] = await sequelize.query<{ last_bootstrap_user_id: string }>('SELECT last_bootstrap_user_id FROM authorization_bootstrap_lock WHERE id = 1', { type: QueryTypes.SELECT });
    expect(lock?.last_bootstrap_user_id).toBe(userId);
  });

  it('refuses a second bootstrap while an active Main Admin exists', async () => {
    expect(await codeOf(makeBootstrap().execute({ phone: phone(), password: 'Adm1n-pw' }))).toBe('MAIN_ADMIN_ALREADY_EXISTS');
  });

  it('allows a new bootstrap only after the Main Admin role was revoked, and a failure rolls everything back', async () => {
    const [{ id }] = await sequelize.query<{ id: string }>(`SELECT user_id AS id FROM user_roles WHERE role_code = 'MAIN_ADMIN' AND active = 1 AND user_id IN (${TEST_USERS})`, { type: QueryTypes.SELECT });
    await roles.assignRole({ userId: id!, roleCode: 'PARENT', assignedBy: null });
    await roles.revokeRole({ userId: id!, roleCode: 'MAIN_ADMIN', revokedBy: null });
    expect(await roles.countActiveByRole('MAIN_ADMIN')).toBe(0);

    // A phone that already exists fails AFTER the lock: nothing new may remain.
    const usersBefore = await sequelize.query<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE phone LIKE '${PREFIX}%'`, { type: QueryTypes.SELECT });
    const taken = (await identity.findById(id!))!.phone;
    expect(await codeOf(makeBootstrap().execute({ phone: taken, password: 'Adm1n-pw' }))).toBe('USER_PHONE_ALREADY_EXISTS');
    const usersAfter = await sequelize.query<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE phone LIKE '${PREFIX}%'`, { type: QueryTypes.SELECT });
    expect(Number(usersAfter[0]!.n)).toBe(Number(usersBefore[0]!.n));
    expect(await roles.countActiveByRole('MAIN_ADMIN')).toBe(0);

    await expect(makeBootstrap().execute({ phone: phone(), password: 'Adm1n-pw' })).resolves.toHaveProperty('userId');
    expect(await roles.countActiveByRole('MAIN_ADMIN')).toBe(1);
  });

  it('serializes concurrent bootstraps: with no Main Admin, exactly one of several parallel runs succeeds', async () => {
    // Start from "no active Main Admin".
    // Resolve this file's user ids first, then update by explicit ids only (no range locks that could collide with other files).
    const mine = await sequelize.query<{ id: string }>(TEST_USERS, { type: QueryTypes.SELECT });
    if (mine.length > 0) {
      await sequelize.query(
        "UPDATE user_roles SET revoked_at = UTC_TIMESTAMP(3), active = NULL WHERE role_code = 'MAIN_ADMIN' AND active = 1 AND user_id IN (:ids)",
        { replacements: { ids: mine.map((r) => r.id) } },
      );
    }
    expect(await roles.countActiveByRole('MAIN_ADMIN')).toBe(0);

    const results = await Promise.allSettled([1, 2, 3].map(() => makeBootstrap().execute({ phone: phone(), password: 'Adm1n-pw' })));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected' && (r.reason as AppError).code === 'MAIN_ADMIN_ALREADY_EXISTS');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(2);
    expect(await roles.countActiveByRole('MAIN_ADMIN')).toBe(1);
  });
});
