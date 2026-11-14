/**
 * Real-database checks for the SESSION-LEVEL ACTIVE ROLE (Module 10, `auth_sessions.active_role`). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate` (creates users, auth_sessions, refresh_tokens, outbox_messages).
 * Run: npm run test:db. JWT secrets are fixed test values (not read from .env).
 * Test users use phones starting with +2010997 followed by 5 digits (never real numbers); they and their
 * sessions, tokens and outbox rows are deleted afterwards.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize } from '../../src/modules/02-database/public';
import { OutboxService, SequelizeOutboxStore } from '../../src/modules/06-domain-events-outbox/public';
import { BcryptPasswordHasher, IdentityService, SequelizeUserRepository } from '../../src/modules/08-identity-core/public';
import { PermissionRegistry, RoleService, SequelizeRoleAssignmentRepository } from '../../src/modules/09-roles-permissions/public';
import {
  CryptoRefreshTokenGenerator,
  HmacRefreshTokenHasher,
  JwtAccessTokenService,
  SequelizeSessionRepository,
  SessionService,
} from '../../src/modules/10-sessions-jwt/public';
import { ACCESS_SECRET, REFRESH_SECRET } from '../helpers/session-harness';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const outbox = new OutboxService(new SequelizeOutboxStore(sequelize));
const identity = new IdentityService({
  repository: new SequelizeUserRepository(sequelize),
  hasher: new BcryptPasswordHasher(4),
  unitOfWork: uow,
  outbox,
});
const roles = new RoleService({
  repository: new SequelizeRoleAssignmentRepository(sequelize),
  identity,
  permissions: new PermissionRegistry(),
  unitOfWork: uow,
  outbox,
});
const repository = new SequelizeSessionRepository(sequelize);
const tokenHasher = new HmacRefreshTokenHasher(REFRESH_SECRET);
const service = new SessionService({
  repository,
  identity,
  roles,
  accessTokens: new JwtAccessTokenService(ACCESS_SECRET),
  refreshTokenHasher: tokenHasher,
  refreshTokenGenerator: new CryptoRefreshTokenGenerator(),
  passwordHasher: new BcryptPasswordHasher(4),
  unitOfWork: uow,
  outbox,
});

const PREFIX = '+2010996';
let counter = Math.floor(Math.random() * 50000);
async function newUser(...roleCodes: ('PARENT' | 'TEACHER' | 'SCHOOL_MANAGER' | 'ORGANIZATION_MANAGER')[]) {
  const phone = `${PREFIX}${String(++counter).padStart(5, '0')}`;
  const user = await identity.createUser({ phone, password: 'secret1' });
  for (const roleCode of roleCodes) await roles.assignRole({ userId: user.id, roleCode, assignedBy: null });
  return { id: user.id, phone, password: 'secret1' };
}

const TEST_USERS = `SELECT id FROM users WHERE phone LIKE '${PREFIX}%'`;
async function cleanup() {
  await sequelize.query(
    `DELETE FROM outbox_messages WHERE aggregate_type = 'AuthSession'
       AND aggregate_id IN (SELECT id FROM auth_sessions WHERE user_id IN (${TEST_USERS}))`,
  );
  await sequelize.query(
    `DELETE FROM outbox_messages WHERE aggregate_type = 'RoleAssignment'
       AND aggregate_id IN (SELECT id FROM user_roles WHERE user_id IN (${TEST_USERS}))`,
  );
  await sequelize.query(`DELETE FROM outbox_messages WHERE aggregate_type = 'User' AND aggregate_id IN (${TEST_USERS})`);
  await sequelize.query(`DELETE FROM refresh_tokens WHERE user_id IN (${TEST_USERS})`);
  await sequelize.query(`DELETE FROM auth_sessions WHERE user_id IN (${TEST_USERS})`);
  await sequelize.query(`DELETE FROM user_roles WHERE user_id IN (${TEST_USERS})`);
  await sequelize.query(`DELETE FROM users WHERE phone LIKE '${PREFIX}%'`);
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
}
const sessionsOf = (userId: string) =>
  sequelize.query<{ id: string; active: number | null; slot: number | null; device_label: string | null; revoked_reason: string | null; revoked_at: Date | null }>(
    'SELECT id, active, slot, device_label, revoked_reason, revoked_at FROM auth_sessions WHERE user_id = :userId ORDER BY created_at, id',
    { replacements: { userId }, type: QueryTypes.SELECT },
  );

const storedRole = async (sessionId: string) =>
  (await sequelize.query<{ active_role: string | null }>('SELECT active_role FROM auth_sessions WHERE id = :sessionId', { replacements: { sessionId }, type: QueryTypes.SELECT }))[0]!.active_role;
const sessionIdOf = async (accessToken: string) => (await service.authenticate(accessToken)).sessionId;

describe('session-level active role (MariaDB)', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await sequelize.close();
  });

  it('a single-role account stores its role on the session at login; a multi-role account stores NULL', async () => {
    const single = await newUser('TEACHER');
    const multi = await newUser('TEACHER', 'PARENT');
    const s = await service.login({ phone: single.phone, password: single.password });
    const m = await service.login({ phone: multi.phone, password: multi.password });
    expect(s.activeRole).toBe('TEACHER');
    expect(await storedRole(await sessionIdOf(s.accessToken))).toBe('TEACHER');
    expect(m.activeRole).toBeNull();
    expect(m.roles.slice().sort()).toEqual(['PARENT', 'TEACHER']);
    expect(await storedRole(await sessionIdOf(m.accessToken))).toBeNull();
  });

  it('three sessions of one account keep independent active roles; switching one changes only its row; all stay active', async () => {
    const u = await newUser('TEACHER', 'PARENT', 'SCHOOL_MANAGER', 'ORGANIZATION_MANAGER');
    const logins = [await service.login({ phone: u.phone, password: u.password }), await service.login({ phone: u.phone, password: u.password }), await service.login({ phone: u.phone, password: u.password })];
    const [a, b, c] = await Promise.all(logins.map((l) => sessionIdOf(l.accessToken))) as [string, string, string];
    await service.switchRole(u.id, a, 'PARENT');
    await service.switchRole(u.id, b, 'TEACHER');
    await service.switchRole(u.id, c, 'SCHOOL_MANAGER');
    expect([await storedRole(a), await storedRole(b), await storedRole(c)]).toEqual(['PARENT', 'TEACHER', 'SCHOOL_MANAGER']);

    await service.switchRole(u.id, a, 'ORGANIZATION_MANAGER');
    expect([await storedRole(a), await storedRole(b), await storedRole(c)]).toEqual(['ORGANIZATION_MANAGER', 'TEACHER', 'SCHOOL_MANAGER']);
    await service.switchRole(u.id, b, 'PARENT');
    expect([await storedRole(a), await storedRole(b), await storedRole(c)]).toEqual(['ORGANIZATION_MANAGER', 'PARENT', 'SCHOOL_MANAGER']);

    const rows = await sessionsOf(u.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.active === 1 && r.revoked_reason === null && r.slot !== null)).toBe(true);
    expect((await Promise.all(logins.map((l) => service.authenticate(l.accessToken)))).map((p) => p.activeRole)).toEqual(['ORGANIZATION_MANAGER', 'PARENT', 'SCHOOL_MANAGER']);
  });

  it('the active role survives a refresh-token rotation', async () => {
    const u = await newUser('TEACHER', 'PARENT');
    const login = await service.login({ phone: u.phone, password: u.password });
    const sessionId = await sessionIdOf(login.accessToken);
    await service.switchRole(u.id, sessionId, 'PARENT');
    const refreshed = await service.refresh(login.refreshToken);
    expect(refreshed.activeRole).toBe('PARENT');
    expect(await storedRole(sessionId)).toBe('PARENT');
    expect((await service.authenticate(refreshed.accessToken)).activeRole).toBe('PARENT');
  });

  it('is idempotent and bumps the session version only when the role really changes', async () => {
    const u = await newUser('TEACHER', 'PARENT');
    const sessionId = await sessionIdOf((await service.login({ phone: u.phone, password: u.password })).accessToken);
    const version = async () => Number((await sequelize.query<{ version: number }>('SELECT version FROM auth_sessions WHERE id = :sessionId', { replacements: { sessionId }, type: QueryTypes.SELECT }))[0]!.version);
    const v0 = await version();
    await service.switchRole(u.id, sessionId, 'PARENT');
    const v1 = await version();
    await service.switchRole(u.id, sessionId, 'PARENT');
    expect(v1).toBe(v0 + 1);
    expect(await version()).toBe(v1);
  });

  it('refuses a role never assigned and a role revoked since; never changes the stored role', async () => {
    const u = await newUser('TEACHER', 'PARENT', 'SCHOOL_MANAGER');
    const sessionId = await sessionIdOf((await service.login({ phone: u.phone, password: u.password })).accessToken);
    await service.switchRole(u.id, sessionId, 'PARENT');
    expect(await codeOf(service.switchRole(u.id, sessionId, 'ORGANIZATION_MANAGER'))).toBe('ROLE_NOT_ASSIGNED');
    await roles.revokeRole({ userId: u.id, roleCode: 'SCHOOL_MANAGER', revokedBy: null });
    expect(await codeOf(service.switchRole(u.id, sessionId, 'SCHOOL_MANAGER'))).toBe('ROLE_NOT_ASSIGNED');
    expect(await storedRole(sessionId)).toBe('PARENT');
  });

  it('refuses a revoked session, an expired session, and another account\'s session', async () => {
    const u = await newUser('TEACHER', 'PARENT');
    const other = await newUser('TEACHER', 'PARENT');
    const login = await service.login({ phone: u.phone, password: u.password });
    const sessionId = await sessionIdOf(login.accessToken);
    const otherSession = await sessionIdOf((await service.login({ phone: other.phone, password: other.password })).accessToken);

    expect(await codeOf(service.switchRole(u.id, otherSession, 'PARENT'))).toBe('SESSION_REVOKED'); // not the caller's session
    expect(await storedRole(otherSession)).toBeNull();

    await sequelize.query("UPDATE refresh_tokens SET issued_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 31 DAY), expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY) WHERE user_id = :id", { replacements: { id: u.id } });
    expect(await codeOf(service.switchRole(u.id, sessionId, 'PARENT'))).toBe('SESSION_REVOKED'); // expired
    expect(await storedRole(sessionId)).toBeNull();

    const v = await newUser('TEACHER', 'PARENT');
    const vl = await service.login({ phone: v.phone, password: v.password });
    const vSession = await sessionIdOf(vl.accessToken);
    await service.logout(vSession);
    expect(await codeOf(service.switchRole(v.id, vSession, 'PARENT'))).toBe('SESSION_REVOKED'); // revoked
    expect(await storedRole(vSession)).toBeNull();
  });

  it('concurrent switches of the same session serialize safely: no error, one final role, other sessions untouched', async () => {
    const u = await newUser('TEACHER', 'PARENT', 'SCHOOL_MANAGER');
    const a = await sessionIdOf((await service.login({ phone: u.phone, password: u.password })).accessToken);
    const b = await sessionIdOf((await service.login({ phone: u.phone, password: u.password })).accessToken);
    await service.switchRole(u.id, b, 'TEACHER');
    const results = await Promise.allSettled([service.switchRole(u.id, a, 'PARENT'), service.switchRole(u.id, a, 'SCHOOL_MANAGER'), service.switchRole(u.id, a, 'TEACHER'), service.switchRole(u.id, a, 'PARENT')]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(['PARENT', 'SCHOOL_MANAGER', 'TEACHER']).toContain(await storedRole(a));
    expect(await storedRole(b)).toBe('TEACHER');
    expect((await sessionsOf(u.id)).filter((r) => r.active === 1)).toHaveLength(2);
  });

  it('the three-session limit is unchanged: switching roles never consumes a slot', async () => {
    const u = await newUser('TEACHER', 'PARENT');
    const logins = [await service.login({ phone: u.phone, password: u.password }), await service.login({ phone: u.phone, password: u.password }), await service.login({ phone: u.phone, password: u.password })];
    for (const l of logins) await service.switchRole(u.id, await sessionIdOf(l.accessToken), 'PARENT');
    expect(await codeOf(service.login({ phone: u.phone, password: u.password }))).toBe('SESSION_LIMIT_REACHED');
    expect((await sessionsOf(u.id)).filter((r) => r.active === 1)).toHaveLength(3);
  });

  it('a session created before the column existed (NULL) keeps working for a single-role account and must choose for a multi-role one', async () => {
    const single = await newUser('TEACHER');
    const multi = await newUser('TEACHER', 'PARENT');
    const s = await service.login({ phone: single.phone, password: single.password });
    const m = await service.login({ phone: multi.phone, password: multi.password });
    await sequelize.query('UPDATE auth_sessions SET active_role = NULL WHERE user_id IN (:ids)', { replacements: { ids: [single.id, multi.id] } });
    expect((await service.authenticate(s.accessToken)).activeRole).toBe('TEACHER');
    expect((await service.authenticate(m.accessToken)).activeRole).toBeNull();
  });
});
