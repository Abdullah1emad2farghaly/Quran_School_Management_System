/**
 * Real-database checks for Module 11 (MariaDB via XAMPP). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db. The OTP secret and JWT secrets are fixed test values.
 * Test users use phones starting with +2010996 followed by 5 digits (never real numbers); they and their roles, sessions,
 * recoveries, request-log rows, lock rows and outbox rows are deleted afterwards.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, SystemClock } from '../../src/modules/00-shared-kernel/public';
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
import { PasswordRecovery } from '../../src/modules/11-otp-password-recovery/domain/entities/password-recovery';
import {
  CryptoRecoverySecrets,
  HmacRecoveryCrypto,
  InMemoryOtpSender,
  PasswordRecoveryService,
  SequelizeRecoveryRepository,
} from '../../src/modules/11-otp-password-recovery/public';
import { OTP_SECRET } from '../helpers/recovery-harness';
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
const sessions = new SessionService({
  repository: new SequelizeSessionRepository(sequelize),
  identity,
  roles,
  accessTokens: new JwtAccessTokenService(ACCESS_SECRET),
  refreshTokenHasher: new HmacRefreshTokenHasher(REFRESH_SECRET),
  refreshTokenGenerator: new CryptoRefreshTokenGenerator(),
  passwordHasher: new BcryptPasswordHasher(4),
  unitOfWork: uow,
  outbox,
});
const repository = new SequelizeRecoveryRepository(sequelize);
const crypto = new HmacRecoveryCrypto(OTP_SECRET);
const sender = new InMemoryOtpSender();
const pending: Promise<void>[] = [];
const runInBackground = (task: () => Promise<void>) => {
  pending.push(task().catch(() => undefined));
};
const flush = async () => {
  await Promise.all(pending.splice(0));
};
const makeService = (sessionsDep: Pick<SessionService, 'revokeAllForUser'> = sessions) =>
  new PasswordRecoveryService({
    repository,
    identity,
    sessions: sessionsDep,
    crypto,
    secrets: new CryptoRecoverySecrets(),
    sender,
    runInBackground,
    unitOfWork: uow,
    outbox,
  });
const recovery = makeService();

const PREFIX = '+2010996';
let counter = Math.floor(Math.random() * 50000);
const createdPhones: string[] = [];
async function newUser() {
  const e164 = `${PREFIX}${String(++counter).padStart(5, '0')}`;
  createdPhones.push(e164);
  const user = await identity.createUser({ phone: e164, password: 'secret1' });
  await roles.assignRole({ userId: user.id, roleCode: 'PARENT', assignedBy: null });
  return { id: user.id, phone: e164, password: 'secret1' };
}
async function requestOtp(phone: string, ip = '203.0.113.5') {
  await recovery.requestRecovery({ phone, clientIp: ip });
  await flush();
  return sender.lastFor(phone)!.otp;
}

const TEST_USERS = `SELECT id FROM users WHERE phone LIKE '${PREFIX}%'`;
async function cleanup() {
  const keys = createdPhones.map((p) => crypto.phoneKey(p));
  if (keys.length > 0) {
    await sequelize.query('DELETE FROM password_recovery_requests WHERE phone_key IN (:keys)', { replacements: { keys } });
    await sequelize.query('DELETE FROM password_recovery_locks WHERE phone_key IN (:keys)', { replacements: { keys } });
  }
  await sequelize.query(
    `DELETE FROM outbox_messages WHERE aggregate_type = 'PasswordRecovery'
       AND aggregate_id IN (SELECT id FROM password_recoveries WHERE user_id IN (${TEST_USERS}))`,
  );
  await sequelize.query(
    `DELETE FROM outbox_messages WHERE aggregate_type = 'AuthSession'
       AND aggregate_id IN (SELECT id FROM auth_sessions WHERE user_id IN (${TEST_USERS}))`,
  );
  await sequelize.query(
    `DELETE FROM outbox_messages WHERE aggregate_type = 'RoleAssignment'
       AND aggregate_id IN (SELECT id FROM user_roles WHERE user_id IN (${TEST_USERS}))`,
  );
  await sequelize.query(`DELETE FROM outbox_messages WHERE aggregate_type = 'User' AND aggregate_id IN (${TEST_USERS})`);
  await sequelize.query(`DELETE FROM password_recoveries WHERE user_id IN (${TEST_USERS})`);
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
interface RecoveryRow {
  id: string;
  status: string;
  live: number | null;
  attempts: number;
  version: number;
  otp_hash: string;
  reset_token_hash: string | null;
  otp_expires_at: Date;
  created_at: Date;
}
const recoveriesOf = (userId: string) =>
  sequelize.query<RecoveryRow>(
    'SELECT id, status, live, attempts, version, otp_hash, reset_token_hash, otp_expires_at, created_at FROM password_recoveries WHERE user_id = :userId ORDER BY created_at, id',
    { replacements: { userId }, type: QueryTypes.SELECT },
  );
const requestCount = async (phone: string) =>
  Number(
    (
      await sequelize.query<{ n: number | string }>('SELECT COUNT(*) AS n FROM password_recovery_requests WHERE phone_key = :k', {
        replacements: { k: crypto.phoneKey(phone) },
        type: QueryTypes.SELECT,
      })
    )[0]!.n,
  );

describe('password recovery (MariaDB)', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await sequelize.close();
  });

  it('stores only hashes: no OTP, reset token, phone or IP in any recovery table', async () => {
    const u = await newUser();
    const otp = await requestOtp(u.phone, '203.0.113.77');
    const { resetToken } = await recovery.verifyOtp({ phone: u.phone, otp });

    const [row] = await recoveriesOf(u.id);
    expect(row).toMatchObject({ status: 'VERIFIED', live: 1, attempts: 0, otp_hash: crypto.hashOtp(row!.id, otp) });
    expect(row!.reset_token_hash).toBe(crypto.hashResetToken(resetToken));
    expect(new Date(row!.otp_expires_at).getTime() - new Date(row!.created_at).getTime()).toBe(5 * 60 * 1000);

    const dump = JSON.stringify([
      await sequelize.query('SELECT * FROM password_recoveries WHERE user_id = :id', { replacements: { id: u.id }, type: QueryTypes.SELECT }),
      await sequelize.query('SELECT * FROM password_recovery_requests WHERE phone_key = :k', { replacements: { k: crypto.phoneKey(u.phone) }, type: QueryTypes.SELECT }),
      await sequelize.query('SELECT * FROM password_recovery_locks WHERE phone_key = :k', { replacements: { k: crypto.phoneKey(u.phone) }, type: QueryTypes.SELECT }),
    ]);
    for (const secret of [otp, resetToken, u.phone, u.phone.slice(3), '203.0.113.77']) expect(dump).not.toContain(secret);
  });

  it('keeps ONE live recovery: a resend supersedes the previous one', async () => {
    const u = await newUser();
    await requestOtp(u.phone);
    await requestOtp(u.phone);
    const rows = await recoveriesOf(u.id);
    expect(rows.map((r) => r.status).sort()).toEqual(['PENDING', 'SUPERSEDED']);
    expect(rows.filter((r) => r.live === 1)).toHaveLength(1);
  });

  it('enforces the hour limit atomically: 10 simultaneous requests for one phone -> exactly 4 succeed, 6 get 429', async () => {
    const u = await newUser();
    const before = sender.messages.length;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => recovery.requestRecovery({ phone: u.phone, clientIp: `198.51.100.${i}` })),
    );
    await flush();

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(6);
    for (const r of rejected) expect((r.reason as AppError).code).toBe('RATE_LIMITED');
    expect(await requestCount(u.phone)).toBe(4);
    expect(sender.messages.length - before).toBe(4);
    expect((await recoveriesOf(u.id)).filter((r) => r.live === 1)).toHaveLength(1);
  });

  it('limits an unknown phone the same way (no account information in the limits)', async () => {
    const phone = `${PREFIX}${String(++counter).padStart(5, '0')}`; // never created as a user
    createdPhones.push(phone);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => recovery.requestRecovery({ phone, clientIp: '203.0.113.9' })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    expect(await requestCount(phone)).toBe(4);
    expect(sender.lastFor(phone)).toBeUndefined();
  });

  it('commits wrong attempts even though the request fails, and locks after the 5th', async () => {
    const u = await newUser();
    const otp = await requestOtp(u.phone);
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 3; i += 1) {
      expect(await codeOf(recovery.verifyOtp({ phone: u.phone, otp: wrong }))).toBe('OTP_INVALID');
      expect((await recoveriesOf(u.id))[0]!.attempts).toBe(i);
    }
    await codeOf(recovery.verifyOtp({ phone: u.phone, otp: wrong }));
    await codeOf(recovery.verifyOtp({ phone: u.phone, otp: wrong }));
    expect((await recoveriesOf(u.id))[0]).toMatchObject({ status: 'LOCKED', live: null, attempts: 5 });
    expect(await codeOf(recovery.verifyOtp({ phone: u.phone, otp }))).toBe('OTP_INVALID');
  });

  it('cannot be guessed past the 5-attempt limit with simultaneous attempts', async () => {
    const u = await newUser();
    const otp = await requestOtp(u.phone);
    const wrong = otp === '000000' ? '111111' : '000000';
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => recovery.verifyOtp({ phone: u.phone, otp: wrong })));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect((await recoveriesOf(u.id))[0]).toMatchObject({ status: 'LOCKED', attempts: 5 });
  });

  it('lets only one of two simultaneous verifications of the right OTP succeed', async () => {
    const u = await newUser();
    const otp = await requestOtp(u.phone);
    const results = await Promise.allSettled([recovery.verifyOtp({ phone: u.phone, otp }), recovery.verifyOtp({ phone: u.phone, otp })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('resets the password, closes the recovery and revokes the sessions in one transaction', async () => {
    const u = await newUser();
    const login = await sessions.login({ phone: u.phone, password: u.password });
    const otp = await requestOtp(u.phone);
    const { resetToken } = await recovery.verifyOtp({ phone: u.phone, otp });

    await recovery.resetPassword({ resetToken, newPassword: 'newpass9' });

    expect((await recoveriesOf(u.id))[0]).toMatchObject({ status: 'CONSUMED', live: null });
    expect(await codeOf(sessions.authenticate(login.accessToken))).toBe('SESSION_REVOKED');
    const [session] = await sequelize.query<{ revoked_reason: string }>('SELECT revoked_reason FROM auth_sessions WHERE user_id = :id', {
      replacements: { id: u.id },
      type: QueryTypes.SELECT,
    });
    expect(session!.revoked_reason).toBe('PASSWORD_RESET');
    expect(await codeOf(sessions.login({ phone: u.phone, password: u.password }))).toBe('INVALID_CREDENTIALS');
    expect((await sessions.login({ phone: u.phone, password: 'newpass9' })).user.id).toBe(u.id);

    const events = await sequelize.query<{ event_type: string; payload: string }>(
      "SELECT event_type, payload FROM outbox_messages WHERE aggregate_type = 'PasswordRecovery' AND aggregate_id = :id",
      { replacements: { id: (await recoveriesOf(u.id))[0]!.id }, type: QueryTypes.SELECT },
    );
    expect(events.map((e) => e.event_type)).toEqual(['PasswordResetCompleted']);
    for (const secret of [otp, resetToken, 'newpass9']) expect(JSON.stringify(events)).not.toContain(secret);
  });

  it('rolls EVERYTHING back if a step of the reset fails (password, recovery and sessions unchanged)', async () => {
    const u = await newUser();
    const login = await sessions.login({ phone: u.phone, password: u.password });
    const otp = await requestOtp(u.phone);
    const { resetToken } = await recovery.verifyOtp({ phone: u.phone, otp });

    const failing = makeService({
      revokeAllForUser: async () => {
        throw new Error('simulated failure while revoking sessions');
      },
    });
    await expect(failing.resetPassword({ resetToken, newPassword: 'newpass9' })).rejects.toThrow('simulated failure');

    expect((await recoveriesOf(u.id))[0]).toMatchObject({ status: 'VERIFIED', live: 1 });
    expect(await sessions.authenticate(login.accessToken)).toMatchObject({ userId: u.id }); // session still alive
    expect((await sessions.login({ phone: u.phone, password: u.password })).user.id).toBe(u.id); // old password still works
    const events = await sequelize.query("SELECT 1 FROM outbox_messages WHERE aggregate_type = 'PasswordRecovery' AND aggregate_id = :id", {
      replacements: { id: (await recoveriesOf(u.id))[0]!.id },
      type: QueryTypes.SELECT,
    });
    expect(events).toHaveLength(0);
    await recovery.resetPassword({ resetToken, newPassword: 'newpass9' }); // the token was not used up
  });

  it('lets only one of two simultaneous resets with the same token succeed', async () => {
    const u = await newUser();
    const otp = await requestOtp(u.phone);
    const { resetToken } = await recovery.verifyOtp({ phone: u.phone, otp });
    const results = await Promise.allSettled([
      recovery.resetPassword({ resetToken, newPassword: 'newpass1' }),
      recovery.resetPassword({ resetToken, newPassword: 'newpass2' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe('RESET_TOKEN_INVALID');
  });

  it('is protected by database constraints (one live recovery, attempts, status, token, state)', async () => {
    const u = await newUser();
    await requestOtp(u.phone);
    const intruder = PasswordRecovery.issue({ id: PasswordRecovery.newId(), userId: u.id, otpHash: 'f'.repeat(64), clock: new SystemClock() });
    expect(await codeOf(uow.run((tx) => repository.insert(intruder, tx)))).toBe('RECOVERY_CONCURRENT_MODIFICATION');

    const insert = (over: { status: string; live: number | null; attempts?: number; token?: string | null; closedAt?: string | null }) =>
      sequelize.query(
        `INSERT INTO password_recoveries (id, user_id, otp_hash, attempts, otp_expires_at, status, live, reset_token_hash,
           reset_token_expires_at, closed_at, version, created_at, updated_at)
         VALUES (UUID(), :user, :hash, :attempts, NOW(3), :status, :live, :token, IF(:token IS NULL, NULL, NOW(3)), :closedAt, 1, NOW(3), NOW(3))`,
        { replacements: { user: u.id, hash: 'a'.repeat(64), attempts: over.attempts ?? 0, status: over.status, live: over.live, token: over.token ?? null, closedAt: over.closedAt ?? null } },
      );
    await expect(insert({ status: 'BOGUS', live: null, closedAt: '2026-01-01 00:00:00' })).rejects.toThrow();
    await expect(insert({ status: 'LOCKED', live: null, attempts: 6, closedAt: '2026-01-01 00:00:00' })).rejects.toThrow();
    await expect(insert({ status: 'LOCKED', live: 1, closedAt: null })).rejects.toThrow(); // closed but still "live"
    await expect(insert({ status: 'LOCKED', live: null, closedAt: null })).rejects.toThrow(); // closed without closed_at
    await expect(insert({ status: 'VERIFIED', live: 1, token: null })).rejects.toThrow(); // verified without a reset token
    await expect(insert({ status: 'CONSUMED', live: null, token: null, closedAt: '2026-01-01 00:00:00' })).rejects.toThrow();
  });

  it('purges old closed recoveries, request-log rows and lock rows, never live or recent ones', async () => {
    // Backdated to the year 2000 and purged with a 2001 cutoff, so this can only ever touch the test's own rows.
    const u = await newUser();
    const key = crypto.phoneKey(u.phone);
    await requestOtp(u.phone); // a live, recent recovery + a recent request-log row
    await sequelize.query(
      `INSERT INTO password_recoveries (id, user_id, otp_hash, attempts, otp_expires_at, status, live, closed_at, version, created_at, updated_at)
       VALUES (UUID(), :user, :hash, 0, '2000-01-01 00:05:00.000', 'SUPERSEDED', NULL, '2000-01-01 00:01:00.000', 1, '2000-01-01 00:00:00.000', '2000-01-01 00:00:00.000')`,
      { replacements: { user: u.id, hash: 'b'.repeat(64) } },
    );
    await sequelize.query(
      "INSERT INTO password_recovery_requests (phone_key, ip_key, requested_at) VALUES (:key, :ip, '2000-01-01 00:00:00.000')",
      { replacements: { key, ip: 'c'.repeat(64) } },
    );
    await sequelize.query("INSERT INTO password_recovery_locks (phone_key, touched_at) VALUES (:key, '2000-01-01 00:00:00.000') ON DUPLICATE KEY UPDATE touched_at = touched_at", {
      replacements: { key: 'd'.repeat(64) },
    });

    const removed = await repository.purgeOlderThan(new Date('2001-01-01T00:00:00Z'));
    expect(removed).toBe(3);
    await sequelize.query("DELETE FROM password_recovery_locks WHERE phone_key = :key", { replacements: { key: 'd'.repeat(64) } });

    expect((await recoveriesOf(u.id)).map((r) => r.status)).toEqual(['PENDING']); // the live one survives
    expect(await requestCount(u.phone)).toBe(1); // the recent request survives
  });
});
