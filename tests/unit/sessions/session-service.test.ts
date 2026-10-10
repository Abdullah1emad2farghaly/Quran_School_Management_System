import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  createRevokeSessionsOnUserDeactivatedHandler,
} from '../../../src/modules/10-sessions-jwt/public';
import { createSessionHarness } from '../../helpers/session-harness';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
}
const DAY = 24 * 3600 * 1000;

describe('login', () => {
  it('returns a Bearer access token (15 min), a refresh token (30 days), the user and roles', async () => {
    const h = createSessionHarness();
    const u = await h.createUser({ role: 'TEACHER' });
    const result = await h.service.login({ phone: u.phone, password: u.password });

    expect(result.tokenType).toBe('Bearer');
    expect(result.accessTokenExpiresAt).toEqual(new Date(h.clock.now().getTime() + 15 * 60_000));
    expect(result.refreshTokenExpiresAt).toEqual(new Date(h.clock.now().getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000));
    expect(result.user).toEqual({ id: u.id, phone: `+20${u.phone.slice(1)}` });
    expect(result.roles).toEqual(['TEACHER']);
    expect(await h.service.authenticate(result.accessToken)).toMatchObject({ userId: u.id });
  });

  it('accepts the phone in any supported format', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    for (const phone of [u.phone, `+20${u.phone.slice(1)}`, `0020${u.phone.slice(1)}`]) {
      expect((await h.service.login({ phone, password: u.password })).user.id).toBe(u.id);
    }
  });

  it('stores only a hash of the refresh token, never the token', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const { refreshToken } = await h.service.login({ phone: u.phone, password: u.password });
    const rows = [...h.repository.tokens.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(h.refreshTokenHasher.hash(refreshToken));
    expect(JSON.stringify(rows)).not.toContain(refreshToken);
    expect(JSON.stringify(h.store.messages)).not.toContain(refreshToken);
  });

  it('gives the same error for unknown phone, malformed phone and wrong password (no enumeration)', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    expect(await codeOf(h.service.login({ phone: '01099999999', password: 'secret1' }))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(h.service.login({ phone: 'not a phone', password: 'secret1' }))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(h.service.login({ phone: u.phone, password: 'wrong-pass' }))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(h.service.login({ phone: u.phone, password: undefined }))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(h.service.login({ phone: 123, password: 'secret1' }))).toBe('INVALID_CREDENTIALS');
    expect(h.repository.sessions.size).toBe(0);
  });

  it('rejects an inactive account only after the password was verified', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    await h.identity.deactivateUser(u.id);
    expect(await codeOf(h.service.login({ phone: u.phone, password: u.password }))).toBe('ACCOUNT_INACTIVE');
    expect(await codeOf(h.service.login({ phone: u.phone, password: 'wrong-pass' }))).toBe('INVALID_CREDENTIALS');
    expect(h.repository.sessions.size).toBe(0);
  });

  it('publishes AuthSessionStarted without tokens', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const result = await h.service.login({ phone: u.phone, password: u.password });
    const events = h.sessionEvents();
    expect(events.map((e) => e.type)).toEqual(['AuthSessionStarted']);
    expect(JSON.stringify(events)).not.toContain(result.refreshToken);
    expect(JSON.stringify(events)).not.toContain(result.accessToken);
  });
});

describe('only one active session per user', () => {
  it('a new login revokes the previous session and keeps its history', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const a = await h.service.login({ phone: u.phone, password: u.password });
    h.advance(1000);
    const b = await h.service.login({ phone: u.phone, password: u.password });

    const sessions = [...h.repository.sessions.values()];
    expect(sessions).toHaveLength(2); // history preserved
    expect(sessions.filter((s) => s.revokedAt === null)).toHaveLength(1);
    expect(sessions.find((s) => s.revokedAt !== null)?.revokedReason).toBe('LOGIN_REPLACED');
    expect([...h.repository.tokens.values()].filter((t) => t.revokedAt === null)).toHaveLength(1);

    expect(await codeOf(h.service.authenticate(a.accessToken))).toBe('SESSION_REVOKED');
    expect(await codeOf(h.service.refresh(a.refreshToken))).toBe('SESSION_REVOKED'); // not "reuse": it was revoked with its session
    expect(await h.service.authenticate(b.accessToken)).toMatchObject({ userId: u.id });

    expect(h.sessionEvents().map((e) => [e.type, e.payload.reason])).toEqual([
      ['AuthSessionStarted', undefined],
      ['AuthSessionRevoked', 'LOGIN_REPLACED'],
      ['AuthSessionStarted', undefined],
    ]);
  });

  it('sessions of different users do not affect each other', async () => {
    const h = createSessionHarness();
    const u1 = await h.createUser();
    const u2 = await h.createUser();
    const s1 = await h.service.login({ phone: u1.phone, password: u1.password });
    await h.service.login({ phone: u2.phone, password: u2.password });
    expect(await h.service.authenticate(s1.accessToken)).toMatchObject({ userId: u1.id });
  });
});

describe('refresh token rotation', () => {
  it('issues a new access AND refresh token and revokes the old refresh token', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const first = await h.service.login({ phone: u.phone, password: u.password });
    h.advance(60_000);
    const second = await h.service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshTokenExpiresAt).toEqual(new Date(h.clock.now().getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000));
    expect(second.user.id).toBe(u.id);

    const rows = [...h.repository.tokens.values()];
    const old = rows.find((t) => t.tokenHash === h.refreshTokenHasher.hash(first.refreshToken))!;
    const current = rows.find((t) => t.tokenHash === h.refreshTokenHasher.hash(second.refreshToken))!;
    expect(old.revokedAt).not.toBeNull();
    expect(old.replacedById).toBe(current.id);
    expect(current.revokedAt).toBeNull();
    expect(rows.filter((t) => t.revokedAt === null)).toHaveLength(1);
    expect(h.repository.sessions.size).toBe(1); // same session
  });

  it('can be refreshed repeatedly along the chain', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    let current = await h.service.login({ phone: u.phone, password: u.password });
    for (let i = 0; i < 5; i += 1) {
      h.advance(10 * 60_000);
      current = await h.service.refresh(current.refreshToken);
      expect(await h.service.authenticate(current.accessToken)).toMatchObject({ userId: u.id });
    }
  });

  it('treats reuse of a rotated token as a security violation: rejects and revokes the session', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const first = await h.service.login({ phone: u.phone, password: u.password });
    const second = await h.service.refresh(first.refreshToken);

    expect(await codeOf(h.service.refresh(first.refreshToken))).toBe('REFRESH_TOKEN_REUSED');

    const session = [...h.repository.sessions.values()][0]!;
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokedReason).toBe('REFRESH_TOKEN_REUSE');
    expect([...h.repository.tokens.values()].every((t) => t.revokedAt !== null)).toBe(true);
    // the newest token and its access token are dead too: the user must log in again
    expect(await codeOf(h.service.refresh(second.refreshToken))).toBe('SESSION_REVOKED');
    expect(await codeOf(h.service.authenticate(second.accessToken))).toBe('SESSION_REVOKED');
    expect(h.sessionEvents().at(-1)).toMatchObject({ type: 'AuthSessionRevoked', payload: { reason: 'REFRESH_TOKEN_REUSE' } });
  });

  it('after a reuse the user can log in again', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const first = await h.service.login({ phone: u.phone, password: u.password });
    await h.service.refresh(first.refreshToken);
    await codeOf(h.service.refresh(first.refreshToken));
    const again = await h.service.login({ phone: u.phone, password: u.password });
    expect(await h.service.authenticate(again.accessToken)).toMatchObject({ userId: u.id });
    expect([...h.repository.sessions.values()].filter((s) => s.revokedAt === null)).toHaveLength(1);
  });

  it('expires after 30 days', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const first = await h.service.login({ phone: u.phone, password: u.password });
    const day29 = createSessionHarness();
    const u29 = await day29.createUser();
    const t29 = await day29.service.login({ phone: u29.phone, password: u29.password });

    day29.advance(30 * DAY - 1000);
    expect((await day29.service.refresh(t29.refreshToken)).refreshToken).toBeTruthy();

    h.advance(30 * DAY);
    expect(await codeOf(h.service.refresh(first.refreshToken))).toBe('REFRESH_TOKEN_EXPIRED');
  });

  it('rejects unknown, empty, oversized and non-string tokens', async () => {
    const h = createSessionHarness();
    for (const bad of ['nope', '', 'x'.repeat(201), undefined, null, 42, {}]) {
      expect(await codeOf(h.service.refresh(bad)), String(bad)).toBe('REFRESH_TOKEN_INVALID');
    }
  });

  it('rejects refresh for a deactivated user and ends the session', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const first = await h.service.login({ phone: u.phone, password: u.password });
    await h.identity.deactivateUser(u.id);
    expect(await codeOf(h.service.refresh(first.refreshToken))).toBe('ACCOUNT_INACTIVE');
    expect([...h.repository.sessions.values()][0]!.revokedReason).toBe('USER_DEACTIVATED');
  });
});

describe('authenticate (every protected request)', () => {
  it('rejects expired, invalid and missing access tokens', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const { accessToken } = await h.service.login({ phone: u.phone, password: u.password });
    h.advance(15 * 60_000);
    expect(await codeOf(h.service.authenticate(accessToken))).toBe('ACCESS_TOKEN_EXPIRED');
    expect(await codeOf(h.service.authenticate('garbage'))).toBe('ACCESS_TOKEN_INVALID');
    expect(await codeOf(h.service.authenticate(''))).toBe('AUTHENTICATION_REQUIRED');
    expect(await codeOf(h.service.authenticate(undefined))).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects the access token as soon as the user is deactivated (no waiting for expiry)', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const { accessToken } = await h.service.login({ phone: u.phone, password: u.password });
    await h.identity.deactivateUser(u.id);
    expect(await codeOf(h.service.authenticate(accessToken))).toBe('ACCOUNT_INACTIVE');
  });

  it('does not accept a refresh token as an access token', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const { refreshToken } = await h.service.login({ phone: u.phone, password: u.password });
    expect(await codeOf(h.service.authenticate(refreshToken))).toBe('ACCESS_TOKEN_INVALID');
  });
});

describe('logout', () => {
  it('ends the current session at once and is idempotent', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const r = await h.service.login({ phone: u.phone, password: u.password });
    const { sessionId } = await h.service.authenticate(r.accessToken);

    await h.service.logout(sessionId);
    expect(await codeOf(h.service.authenticate(r.accessToken))).toBe('SESSION_REVOKED');
    expect(await codeOf(h.service.refresh(r.refreshToken))).toBe('SESSION_REVOKED');
    await h.service.logout(sessionId);
    expect(h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked')).toHaveLength(1);
    expect(h.sessionEvents().at(-1)?.payload.reason).toBe('LOGOUT');
    expect(h.repository.sessions.size).toBe(1); // history kept
  });

  it('logout-all ends the user\'s session; revokeAllForUser reports how many and is idempotent', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const other = await h.createUser();
    const r = await h.service.login({ phone: u.phone, password: u.password });
    const o = await h.service.login({ phone: other.phone, password: other.password });

    await h.service.logoutAll(u.id);
    expect(await codeOf(h.service.authenticate(r.accessToken))).toBe('SESSION_REVOKED');
    expect(await h.service.authenticate(o.accessToken)).toMatchObject({ userId: other.id });
    expect(await h.service.revokeAllForUser(u.id, 'PASSWORD_RESET')).toBe(0);
    expect(await h.service.revokeAllForUser(other.id, 'PASSWORD_RESET')).toBe(1);
    expect([...h.repository.sessions.values()].find((s) => s.userId === other.id)?.revokedReason).toBe('PASSWORD_RESET');
  });
});

describe('UserDeactivated handler (§22)', () => {
  it('revokes the user\'s sessions and is safe to run twice', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const r = await h.service.login({ phone: u.phone, password: u.password });
    const handler = createRevokeSessionsOnUserDeactivatedHandler(h.service);
    const event = { payload: { userId: u.id } } as never;

    expect(handler.eventTypes).toEqual(['UserDeactivated']);
    await handler.handle(event);
    await handler.handle(event);
    expect(await codeOf(h.service.authenticate(r.accessToken))).toBe('SESSION_REVOKED');
    expect([...h.repository.sessions.values()][0]!.revokedReason).toBe('USER_DEACTIVATED');
    expect(h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked')).toHaveLength(1);
  });

  it('ignores malformed events', async () => {
    const h = createSessionHarness();
    const handler = createRevokeSessionsOnUserDeactivatedHandler(h.service);
    await handler.handle({ payload: {} } as never);
    await handler.handle({ payload: null } as never);
  });
});
