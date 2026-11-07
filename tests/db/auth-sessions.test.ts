/**
 * Real-database checks for Module 10 sessions (MariaDB via XAMPP). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate` (creates users, auth_sessions, refresh_tokens, outbox_messages).
 * Run: npm run test:db. JWT secrets are fixed test values (not read from .env).
 * Test users use phones starting with +2010997 followed by 5 digits (never real numbers); they and their
 * sessions, tokens and outbox rows are deleted afterwards.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, SystemClock } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize } from '../../src/modules/02-database/public';
import { OutboxService, SequelizeOutboxStore } from '../../src/modules/06-domain-events-outbox/public';
import { BcryptPasswordHasher, IdentityService, SequelizeUserRepository } from '../../src/modules/08-identity-core/public';
import { PermissionRegistry, RoleService, SequelizeRoleAssignmentRepository } from '../../src/modules/09-roles-permissions/public';
import { AuthSession } from '../../src/modules/10-sessions-jwt/domain/entities/auth-session';
import { RefreshTokenRecord } from '../../src/modules/10-sessions-jwt/domain/entities/refresh-token-record';
import {
  CryptoRefreshTokenGenerator,
  HmacRefreshTokenHasher,
  JwtAccessTokenService,
  SequelizeSessionRepository,
  SessionService,
  createRevokeSessionsOnUserDeactivatedHandler,
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

const PREFIX = '+2010997';
let counter = Math.floor(Math.random() * 50000);
async function newUser() {
  const phone = `${PREFIX}${String(++counter).padStart(5, '0')}`;
  const user = await identity.createUser({ phone, password: 'secret1' });
  await roles.assignRole({ userId: user.id, roleCode: 'PARENT', assignedBy: null });
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
const tokensOf = (userId: string) =>
  sequelize.query<{ id: string; token_hash: string; active: number | null; revoked_at: Date | null; replaced_by_id: string | null; expires_at: Date; issued_at: Date }>(
    'SELECT id, token_hash, active, revoked_at, replaced_by_id, expires_at, issued_at FROM refresh_tokens WHERE user_id = :userId ORDER BY issued_at, id',
    { replacements: { userId }, type: QueryTypes.SELECT },
  );

describe('auth sessions (MariaDB)', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await sequelize.close();
  });

  it('logs in, stores only a hash of the refresh token (30 days), and authenticates the access token', async () => {
    const u = await newUser();
    const result = await service.login({ phone: u.phone.replace('+20', '0'), password: u.password });

    const [token] = await tokensOf(u.id);
    expect(token!.token_hash).toBe(tokenHasher.hash(result.refreshToken));
    expect(JSON.stringify(token)).not.toContain(result.refreshToken);
    expect(token!.active).toBe(1);
    expect(new Date(token!.expires_at).getTime() - new Date(token!.issued_at).getTime()).toBe(30 * 24 * 3600 * 1000);
    expect(await service.authenticate(result.accessToken)).toMatchObject({ userId: u.id });
    expect(result.roles).toEqual(['PARENT']);
  });

  it('keeps up to three active sessions: a new login never revokes another one, each has its own slot and tokens', async () => {
    const u = await newUser();
    const a = await service.login({ phone: u.phone, password: u.password, deviceLabel: 'Chrome on Android' });
    const b = await service.login({ phone: u.phone, password: u.password });
    const c = await service.login({ phone: u.phone, password: u.password });

    const sessions = await sessionsOf(u.id);
    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.active === 1 && s.revoked_reason === null)).toBe(true);
    expect(sessions.map((s) => s.slot).sort()).toEqual([1, 2, 3]);
    expect(sessions.find((s) => s.device_label === 'Chrome on Android')).toBeDefined();
    expect((await tokensOf(u.id)).filter((t) => t.active === 1)).toHaveLength(3);
    for (const r of [a, b, c]) expect(await service.authenticate(r.accessToken)).toMatchObject({ userId: u.id });
  });

  it('refuses the fourth login with SESSION_LIMIT_REACHED, after the password check, and revokes nothing', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i += 1) await service.login({ phone: u.phone, password: u.password });
    expect(await codeOf(service.login({ phone: u.phone, password: 'wrong-pass' }))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(service.login({ phone: u.phone, password: u.password }))).toBe('SESSION_LIMIT_REACHED');

    const sessions = await sessionsOf(u.id);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.active === 1)).toHaveLength(3);
  });

  it('enforces the three-session limit in the database itself (unique slot, slot range, state CHECK)', async () => {
    const u = await newUser();
    await service.login({ phone: u.phone, password: u.password }); // takes slot 1
    const intruder = AuthSession.start({ userId: u.id, slot: 1, clock: new SystemClock() });
    expect(await codeOf(uow.run((tx) => repository.insertSession(intruder, tx)))).toBe('SESSION_CONCURRENT_MODIFICATION');

    const raw = (slot: number | null, active: number | null, revokedAt: string | null, reason: string | null) =>
      sequelize.query(
        `INSERT INTO auth_sessions (id, user_id, revoked_at, revoked_reason, active, slot, version, created_at, updated_at)
         VALUES (UUID(), :user, :revokedAt, :reason, :active, :slot, 1, NOW(3), NOW(3))`,
        { replacements: { user: u.id, slot, active, revokedAt, reason } },
      );
    await expect(raw(4, 1, null, null)).rejects.toThrow(); // slot above the maximum
    await expect(raw(0, 1, null, null)).rejects.toThrow(); // slot below 1
    await expect(raw(null, 1, null, null)).rejects.toThrow(); // active without a slot
    await expect(raw(2, null, '2026-01-01 00:00:00', 'LOGOUT')).rejects.toThrow(); // revoked but still holding a slot
    expect((await sessionsOf(u.id)).filter((s) => s.active === 1)).toHaveLength(1);
  });

  it('accepts the new revoke reasons and any number of revoked sessions (slot NULL never collides)', async () => {
    const u = await newUser();
    const revoked = (reason: string) =>
      sequelize.query(
        `INSERT INTO auth_sessions (id, user_id, revoked_at, revoked_reason, active, slot, version, created_at, updated_at)
         VALUES (UUID(), :user, '2026-01-01 00:00:00', :reason, NULL, NULL, 1, NOW(3), NOW(3))`,
        { replacements: { user: u.id, reason } },
      );
    for (const reason of ['SESSION_EXPIRED', 'DEVICE_REVOKED', 'PASSWORD_CHANGED', 'LOGIN_REPLACED', 'SESSION_EXPIRED']) await revoked(reason);
    expect(await sessionsOf(u.id)).toHaveLength(5);
  });

  it('survives many simultaneous logins of the same user: never more than three sessions, the rest are refused', async () => {
    const u = await newUser();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => service.login({ phone: u.phone, password: u.password })));
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    for (const r of rejected) expect(['SESSION_LIMIT_REACHED', 'SESSION_CONCURRENT_MODIFICATION']).toContain((r.reason as AppError).code);

    const active = (await sessionsOf(u.id)).filter((s) => s.active === 1);
    expect(active.length).toBeLessThanOrEqual(3);
    expect(active).toHaveLength(fulfilled.length);
    expect(new Set(active.map((s) => s.slot)).size).toBe(active.length);
    expect((await tokensOf(u.id)).filter((t) => t.active === 1)).toHaveLength(active.length);
  });

  it('releases an expired session at login and in the periodic job (SESSION_EXPIRED + AuthSessionRevoked), never touching valid ones', async () => {
    const u = await newUser();
    const logins = [] as Awaited<ReturnType<typeof service.login>>[];
    for (let i = 0; i < 3; i += 1) logins.push(await service.login({ phone: u.phone, password: u.password }));
    const [first] = await sessionsOf(u.id);
    // Make the first session's refresh token expire 10 days ago (still satisfying CHECK expires_at > issued_at).
    await sequelize.query(
      'UPDATE refresh_tokens SET issued_at = NOW(3) - INTERVAL 40 DAY, expires_at = NOW(3) - INTERVAL 10 DAY WHERE session_id = :id AND active = 1',
      { replacements: { id: first!.id } },
    );

    // Login evaluates the limit: the expired session is released, so the 4th login succeeds.
    const fourth = await service.login({ phone: u.phone, password: u.password });
    const sessions = await sessionsOf(u.id);
    expect(sessions.find((s) => s.id === first!.id)).toMatchObject({ active: null, slot: null, revoked_reason: 'SESSION_EXPIRED' });
    expect(sessions.filter((s) => s.active === 1)).toHaveLength(3);
    for (const r of [logins[1]!, logins[2]!, fourth]) expect(await service.authenticate(r.accessToken)).toMatchObject({ userId: u.id });

    // The periodic job: expire the second session and check idempotency.
    const [, second] = await sessionsOf(u.id);
    await sequelize.query(
      'UPDATE refresh_tokens SET issued_at = NOW(3) - INTERVAL 40 DAY, expires_at = NOW(3) - INTERVAL 10 DAY WHERE session_id = :id AND active = 1',
      { replacements: { id: second!.id } },
    );
    expect((await service.expireSessions()).expired).toBeGreaterThanOrEqual(1);
    expect((await service.expireSessions()).expired).toBe(0);
    expect((await sessionsOf(u.id)).find((s) => s.id === second!.id)).toMatchObject({ active: null, slot: null, revoked_reason: 'SESSION_EXPIRED' });
    expect((await sessionsOf(u.id)).filter((s) => s.active === 1)).toHaveLength(2);

    const events = await sequelize.query<{ payload: string }>(
      "SELECT payload FROM outbox_messages WHERE event_type = 'AuthSessionRevoked' AND aggregate_id IN (:ids)",
      { replacements: { ids: [first!.id, second!.id] }, type: QueryTypes.SELECT },
    );
    expect(events.map((e) => JSON.parse(e.payload).reason)).toEqual(['SESSION_EXPIRED', 'SESSION_EXPIRED']);
  });

  it('change password keeps the current session and revokes the others (PASSWORD_CHANGED)', async () => {
    const u = await newUser();
    const a = await service.login({ phone: u.phone, password: u.password });
    const b = await service.login({ phone: u.phone, password: u.password });
    const principalB = await service.authenticate(b.accessToken);
    await service.changePassword(u.id, principalB.sessionId, { currentPassword: u.password, newPassword: 'brand-new1' });

    expect(await codeOf(service.authenticate(a.accessToken))).toBe('SESSION_REVOKED');
    expect(await service.authenticate(b.accessToken)).toMatchObject({ userId: u.id });
    const sessions = await sessionsOf(u.id);
    expect(sessions.filter((s) => s.active === 1)).toHaveLength(1);
    expect(sessions.filter((s) => s.revoked_reason === 'PASSWORD_CHANGED')).toHaveLength(1);
  });

  it('My devices lists safe information and revokes only the selected session', async () => {
    const u = await newUser();
    const other = await newUser();
    const a = await service.login({ phone: u.phone, password: u.password, deviceLabel: 'Chrome on Android' });
    const b = await service.login({ phone: u.phone, password: u.password, deviceLabel: 'Safari on iOS' });
    const o = await service.login({ phone: other.phone, password: other.password });
    const principalA = await service.authenticate(a.accessToken);
    const principalB = await service.authenticate(b.accessToken);
    const principalO = await service.authenticate(o.accessToken);

    const list = await service.listDevices(u.id, principalA.sessionId);
    expect(list.items.map((d) => d.deviceLabel)).toEqual(['Chrome on Android', 'Safari on iOS']);
    expect(list.items.map((d) => d.isCurrent)).toEqual([true, false]);
    expect(JSON.stringify(list)).not.toContain(a.refreshToken);
    expect(JSON.stringify(list)).not.toContain(tokenHasher.hash(a.refreshToken));

    expect(await codeOf(service.revokeDevice(u.id, principalO.sessionId, principalA.sessionId))).toBe('SESSION_NOT_FOUND');
    await service.revokeDevice(u.id, principalB.sessionId, principalA.sessionId);
    expect(await codeOf(service.authenticate(b.accessToken))).toBe('SESSION_REVOKED');
    expect(await service.authenticate(a.accessToken)).toMatchObject({ userId: u.id });
    expect(await service.authenticate(o.accessToken)).toMatchObject({ userId: other.id });
    expect((await sessionsOf(u.id)).find((s) => s.revoked_reason === 'DEVICE_REVOKED')).toBeDefined();
  });

  it('rotates the refresh token and persists the chain', async () => {
    const u = await newUser();
    const first = await service.login({ phone: u.phone, password: u.password });
    const second = await service.refresh(first.refreshToken);

    const tokens = await tokensOf(u.id);
    const old = tokens.find((t) => t.token_hash === tokenHasher.hash(first.refreshToken))!;
    const current = tokens.find((t) => t.token_hash === tokenHasher.hash(second.refreshToken))!;
    expect(old).toMatchObject({ active: null, replaced_by_id: current.id });
    expect(old.revoked_at).toBeInstanceOf(Date);
    expect(current.active).toBe(1);
    expect(tokens).toHaveLength(2);
    expect((await sessionsOf(u.id)).filter((s) => s.active === 1)).toHaveLength(1);
  });

  it('commits the session revocation when a rotated token is reused, even though the request fails', async () => {
    const u = await newUser();
    const first = await service.login({ phone: u.phone, password: u.password });
    const second = await service.refresh(first.refreshToken);

    expect(await codeOf(service.refresh(first.refreshToken))).toBe('REFRESH_TOKEN_REUSED');

    const [session] = await sessionsOf(u.id);
    expect(session).toMatchObject({ active: null, revoked_reason: 'REFRESH_TOKEN_REUSE' });
    expect((await tokensOf(u.id)).every((t) => t.active === null)).toBe(true);
    expect(await codeOf(service.refresh(second.refreshToken))).toBe('SESSION_REVOKED');
    expect(await codeOf(service.authenticate(second.accessToken))).toBe('SESSION_REVOKED');
  });

  it('lets only one of two simultaneous refreshes with the same token succeed', async () => {
    const u = await newUser();
    const first = await service.login({ phone: u.phone, password: u.password });
    const results = await Promise.allSettled([service.refresh(first.refreshToken), service.refresh(first.refreshToken)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe('REFRESH_TOKEN_REUSED');
    expect((await tokensOf(u.id)).filter((t) => t.active === 1).length).toBeLessThanOrEqual(1);
  });

  it('logout and logout-all end the session and keep the row', async () => {
    const u = await newUser();
    const r = await service.login({ phone: u.phone, password: u.password });
    const { sessionId } = await service.authenticate(r.accessToken);
    await service.logout(sessionId);
    expect(await sessionsOf(u.id)).toMatchObject([{ active: null, revoked_reason: 'LOGOUT' }]);

    const again = await service.login({ phone: u.phone, password: u.password });
    await service.logoutAll(u.id);
    expect(await codeOf(service.authenticate(again.accessToken))).toBe('SESSION_REVOKED');
    // the two sessions may share the same millisecond, so compare the reasons without depending on row order
    expect((await sessionsOf(u.id)).map((s) => s.revoked_reason).sort()).toEqual(['LOGOUT', 'LOGOUT_ALL']);
  });

  it('revokes sessions when the user is deactivated (event handler) and blocks access immediately', async () => {
    const u = await newUser();
    const r = await service.login({ phone: u.phone, password: u.password });
    await identity.deactivateUser(u.id);
    expect(await codeOf(service.authenticate(r.accessToken))).toBe('ACCOUNT_INACTIVE');

    await createRevokeSessionsOnUserDeactivatedHandler(service).handle({ payload: { userId: u.id } } as never);
    expect(await sessionsOf(u.id)).toMatchObject([{ active: null, revoked_reason: 'USER_DEACTIVATED' }]);
  });

  it('writes session changes and their events atomically (no tokens in events)', async () => {
    const u = await newUser();
    const r = await service.login({ phone: u.phone, password: u.password });
    const [session] = await sessionsOf(u.id);
    await service.logoutAll(u.id);
    const events = await sequelize.query<{ event_type: string; payload: string }>(
      "SELECT event_type, payload FROM outbox_messages WHERE aggregate_type = 'AuthSession' AND aggregate_id = :id ORDER BY id",
      { replacements: { id: session!.id }, type: QueryTypes.SELECT },
    );
    expect(events.map((e) => e.event_type)).toEqual(['AuthSessionStarted', 'AuthSessionRevoked']);
    expect(JSON.stringify(events)).not.toContain(r.refreshToken);
    expect(JSON.stringify(events)).not.toContain(r.accessToken);
    expect(JSON.parse(events[1]!.payload)).toMatchObject({ sessionId: session!.id, userId: u.id, reason: 'LOGOUT_ALL' });
  });

  it('is protected by database constraints (reason list, state, expiry, unique hash)', async () => {
    const u = await newUser();
    const sessionSql = `INSERT INTO auth_sessions (id, user_id, revoked_at, revoked_reason, active, slot, version, created_at, updated_at)
                        VALUES (UUID(), :user, :revokedAt, :reason, :active, :slot, 1, NOW(3), NOW(3))`;
    const insertSession = (revokedAt: string | null, reason: string | null, active: number | null) =>
      sequelize.query(sessionSql, { replacements: { user: u.id, revokedAt, reason, active, slot: active === 1 ? 1 : null } });
    await expect(insertSession('2026-01-01 00:00:00', 'NOT_A_REASON', null)).rejects.toThrow();
    await expect(insertSession(null, null, null)).rejects.toThrow(); // inactive without revoked_at
    await expect(insertSession('2026-01-01 00:00:00', 'LOGOUT', 1)).rejects.toThrow(); // active but revoked
    await expect(insertSession('2026-01-01 00:00:00', null, null)).rejects.toThrow(); // revoked without a reason

    const login = await service.login({ phone: u.phone, password: u.password });
    const [session] = await sessionsOf(u.id);
    const clone = RefreshTokenRecord.issue({ sessionId: session!.id, userId: u.id, tokenHash: tokenHasher.hash(login.refreshToken), clock: new SystemClock() });
    expect(await codeOf(uow.run((tx) => repository.insertRefreshToken(clone, tx)))).toBe('SESSION_CONCURRENT_MODIFICATION'); // duplicate hash
    await expect(
      sequelize.query(
        `INSERT INTO refresh_tokens (id, session_id, user_id, token_hash, issued_at, expires_at, revoked_at, active, version, created_at, updated_at)
         VALUES (UUID(), :session, :user, :hash, NOW(3), NOW(3), NULL, 1, 1, NOW(3), NOW(3))`,
        { replacements: { session: session!.id, user: u.id, hash: 'f'.repeat(64) } },
      ),
    ).rejects.toThrow(); // expires_at must be after issued_at
  });
});
