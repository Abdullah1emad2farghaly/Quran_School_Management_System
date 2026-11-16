import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { ASSIGNABLE_ROLE_CODES } from '../../../src/modules/09-roles-permissions/public';
import {
  MAX_ACTIVE_SESSIONS,
  REFRESH_TOKEN_TTL_SECONDS,
  SessionExpiryScheduler,
  UNKNOWN_DEVICE_LABEL,
  createRevokeSessionsOnUserDeactivatedHandler,
  deviceLabelFromUserAgent,
  firstFreeSlot,
  normalizeDeviceLabel,
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
async function errorOf(p: Promise<unknown>): Promise<AppError | undefined> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  return undefined;
}
const DAY = 24 * 3600 * 1000;
type Harness = ReturnType<typeof createSessionHarness>;

async function loginN(h: Harness, user: { phone: string; password: string }, n: number) {
  const results = [];
  for (let i = 0; i < n; i += 1) {
    results.push(await h.service.login({ phone: user.phone, password: user.password, deviceLabel: `Device ${i + 1}` }));
    h.advance(1000);
  }
  return results;
}
const active = (h: Harness) => [...h.repository.sessions.values()].filter((s) => s.revokedAt === null);

describe('session policy', () => {
  it('allows exactly three sessions and finds the lowest free slot', () => {
    expect(MAX_ACTIVE_SESSIONS).toBe(3);
    expect(firstFreeSlot([])).toBe(1);
    expect(firstFreeSlot([1, 3])).toBe(2);
    expect(firstFreeSlot([2])).toBe(1);
    expect(firstFreeSlot([1, 2, 3])).toBeUndefined();
  });
});

describe('up to three concurrent sessions', () => {
  it('lets one account hold three sessions at once, each in its own slot, with its own tokens', async () => {
    const h = createSessionHarness();
    const u = await h.createUser({ role: 'TEACHER' });
    const [a, b, c] = await loginN(h, u, 3);

    expect(active(h).map((s) => s.slot).sort()).toEqual([1, 2, 3]);
    expect([...h.repository.tokens.values()].filter((t) => t.revokedAt === null)).toHaveLength(3);
    for (const r of [a!, b!, c!]) expect(await h.service.authenticate(r.accessToken)).toMatchObject({ userId: u.id });
    expect(new Set([a!.refreshToken, b!.refreshToken, c!.refreshToken]).size).toBe(3);
    expect(h.sessionEvents().map((e) => e.type)).toEqual(['AuthSessionStarted', 'AuthSessionStarted', 'AuthSessionStarted']);
  });

  it('applies to every role', async () => {
    for (const role of ASSIGNABLE_ROLE_CODES) {
      const h = createSessionHarness();
      const u = await h.createUser({ role });
      await loginN(h, u, 3);
      expect(active(h)).toHaveLength(3);
      expect(await codeOf(h.service.login({ phone: u.phone, password: u.password }))).toBe('SESSION_LIMIT_REACHED');
    }
  });

  it('rejects the fourth login with SESSION_LIMIT_REACHED and revokes nothing', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const sessions = await loginN(h, u, 3);
    const eventsBefore = h.sessionEvents().length;

    const error = await errorOf(h.service.login({ phone: u.phone, password: u.password }));
    expect(error?.code).toBe('SESSION_LIMIT_REACHED');
    expect(error?.kind).toBe('BUSINESS_RULE');
    expect(error?.details).toEqual({ maxActiveSessions: 3 });

    expect(active(h)).toHaveLength(3);
    expect(h.repository.sessions.size).toBe(3); // no history row was added either
    expect(h.sessionEvents()).toHaveLength(eventsBefore);
    for (const r of sessions) expect(await h.service.authenticate(r.accessToken)).toMatchObject({ userId: u.id });
  });

  it('verifies the password BEFORE revealing the limit (no session information for someone without the password)', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    await loginN(h, u, 3);
    expect(await codeOf(h.service.login({ phone: u.phone, password: 'wrong-pass' }))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(h.service.login({ phone: u.phone, password: undefined }))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(h.service.login({ phone: '01099999999', password: 'secret1' }))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(h.service.login({ phone: u.phone, password: u.password }))).toBe('SESSION_LIMIT_REACHED');
  });

  it('reports an inactive account before the limit', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    await loginN(h, u, 3);
    await h.identity.deactivateUser(u.id);
    expect(await codeOf(h.service.login({ phone: u.phone, password: u.password }))).toBe('ACCOUNT_INACTIVE');
  });

  it('the limit is per account: another account is not affected', async () => {
    const h = createSessionHarness();
    const u1 = await h.createUser();
    const u2 = await h.createUser();
    await loginN(h, u1, 3);
    await expect(h.service.login({ phone: u2.phone, password: u2.password })).resolves.toBeDefined();
  });

  it('logging out one device frees exactly one slot and the freed slot is reused; the others stay valid', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const [a, b, c] = await loginN(h, u, 3);
    const principalB = await h.service.authenticate(b!.accessToken);

    await h.service.logout(principalB.sessionId);
    expect(await codeOf(h.service.authenticate(b!.accessToken))).toBe('SESSION_REVOKED');
    expect(await h.service.authenticate(a!.accessToken)).toMatchObject({ userId: u.id });
    expect(await h.service.authenticate(c!.accessToken)).toMatchObject({ userId: u.id });
    expect(h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked').map((e) => e.payload.reason)).toEqual(['LOGOUT']);

    const d = await h.service.login({ phone: u.phone, password: u.password });
    expect(await h.service.authenticate(d.accessToken)).toMatchObject({ userId: u.id });
    expect(active(h).map((s) => s.slot).sort()).toEqual([1, 2, 3]);
    expect(await codeOf(h.service.login({ phone: u.phone, password: u.password }))).toBe('SESSION_LIMIT_REACHED');
  });

  it('simultaneous logins can never exceed three sessions', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const settled = await Promise.allSettled(Array.from({ length: 6 }, () => h.service.login({ phone: u.phone, password: u.password })));

    const ok = settled.filter((r) => r.status === 'fulfilled');
    const refused = settled.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(3);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(((r as PromiseRejectedResult).reason as AppError).code).toBe('SESSION_LIMIT_REACHED');
    expect(active(h)).toHaveLength(3);
    expect(active(h).map((s) => s.slot).sort()).toEqual([1, 2, 3]);
  });
});

describe('session isolation (refresh and revocation)', () => {
  it('refreshing one session does not touch the others', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const [a, b] = await loginN(h, u, 2);
    const refreshedA = await h.service.refresh(a!.refreshToken);
    expect(refreshedA.refreshToken).not.toBe(a!.refreshToken);
    expect(await h.service.authenticate(b!.accessToken)).toMatchObject({ userId: u.id });
    const refreshedB = await h.service.refresh(b!.refreshToken);
    expect(refreshedB.refreshToken).not.toBe(b!.refreshToken);
    expect(active(h)).toHaveLength(2);
  });

  it('reuse of a rotated token revokes ONLY that session', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const [a, b, c] = await loginN(h, u, 3);
    await h.service.refresh(a!.refreshToken);
    expect(await codeOf(h.service.refresh(a!.refreshToken))).toBe('REFRESH_TOKEN_REUSED');

    expect(await h.service.authenticate(b!.accessToken)).toMatchObject({ userId: u.id });
    expect(await h.service.authenticate(c!.accessToken)).toMatchObject({ userId: u.id });
    expect(active(h)).toHaveLength(2);
    expect(h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked').map((e) => e.payload.reason)).toEqual(['REFRESH_TOKEN_REUSE']);
  });
});

describe('account-wide revocations keep revoking every session', () => {
  it('logout-all revokes all three sessions, one event each', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const sessions = await loginN(h, u, 3);
    await h.service.logoutAll(u.id);
    for (const r of sessions) expect(await codeOf(h.service.authenticate(r.accessToken))).toBe('SESSION_REVOKED');
    expect(h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked').map((e) => e.payload.reason)).toEqual(['LOGOUT_ALL', 'LOGOUT_ALL', 'LOGOUT_ALL']);
    expect(active(h)).toHaveLength(0);
    // History kept, slots freed: the user can log in again.
    expect(h.repository.sessions.size).toBe(3);
    await expect(h.service.login({ phone: u.phone, password: u.password })).resolves.toBeDefined();
  });

  it('password reset (revokeAllForUser) and account deactivation revoke all sessions', async () => {
    const h = createSessionHarness();
    const reset = await h.createUser();
    await loginN(h, reset, 3);
    expect(await h.service.revokeAllForUser(reset.id, 'PASSWORD_RESET')).toBe(3);
    expect(await h.service.revokeAllForUser(reset.id, 'PASSWORD_RESET')).toBe(0);

    const deactivated = await h.createUser();
    const sessions = await loginN(h, deactivated, 3);
    const handler = createRevokeSessionsOnUserDeactivatedHandler(h.service);
    await handler.handle({ payload: { userId: deactivated.id } } as never);
    for (const r of sessions) expect(await codeOf(h.service.authenticate(r.accessToken))).toBe('SESSION_REVOKED');
    expect(h.sessionEvents().filter((e) => e.payload.reason === 'USER_DEACTIVATED')).toHaveLength(3);
  });
});

describe('change password revokes the other sessions', () => {
  it('keeps the session that made the change and revokes every other one (PASSWORD_CHANGED, one event each)', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const [a, b, c] = await loginN(h, u, 3);
    const principalB = await h.service.authenticate(b!.accessToken);

    await h.service.changePassword(u.id, principalB.sessionId, { currentPassword: u.password, newPassword: 'brand-new1' });

    expect(await h.service.authenticate(b!.accessToken)).toMatchObject({ userId: u.id });
    expect(await codeOf(h.service.authenticate(a!.accessToken))).toBe('SESSION_REVOKED');
    expect(await codeOf(h.service.authenticate(c!.accessToken))).toBe('SESSION_REVOKED');
    expect(active(h)).toHaveLength(1);
    expect(h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked').map((e) => e.payload.reason)).toEqual(['PASSWORD_CHANGED', 'PASSWORD_CHANGED']);
    // The session that made the change can still refresh, and the new password works for a new login.
    await expect(h.service.refresh(b!.refreshToken)).resolves.toBeDefined();
    await expect(h.service.login({ phone: u.phone, password: 'brand-new1' })).resolves.toBeDefined();
  });

  it('revokes nothing when the change fails (wrong current password, same password, bad policy)', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const [a, b] = await loginN(h, u, 2);
    const principalA = await h.service.authenticate(a!.accessToken);

    expect(await codeOf(h.service.changePassword(u.id, principalA.sessionId, { currentPassword: 'wrong-pass', newPassword: 'brand-new1' }))).toBe('CURRENT_PASSWORD_INCORRECT');
    expect(await codeOf(h.service.changePassword(u.id, principalA.sessionId, { currentPassword: u.password, newPassword: u.password }))).toBe('NEW_PASSWORD_SAME_AS_CURRENT');
    expect(await codeOf(h.service.changePassword(u.id, principalA.sessionId, { currentPassword: u.password, newPassword: '12' }))).toBe('INVALID_PASSWORD');
    expect(active(h)).toHaveLength(2);
    expect(await h.service.authenticate(b!.accessToken)).toMatchObject({ userId: u.id });
  });

  it('does not touch the sessions of other accounts', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const other = await h.createUser();
    const [a] = await loginN(h, u, 2);
    const o = await h.service.login({ phone: other.phone, password: other.password });
    const principalA = await h.service.authenticate(a!.accessToken);
    await h.service.changePassword(u.id, principalA.sessionId, { currentPassword: u.password, newPassword: 'brand-new1' });
    expect(await h.service.authenticate(o.accessToken)).toMatchObject({ userId: other.id });
  });
});

describe('expired sessions (30-day refresh token)', () => {
  it('login releases an expired session instead of refusing: SESSION_EXPIRED + AuthSessionRevoked; valid sessions are untouched', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const a = await h.service.login({ phone: u.phone, password: u.password }); // day 0: expires on day 30
    h.advance(20 * DAY);
    const b = await h.service.login({ phone: u.phone, password: u.password });
    const c = await h.service.login({ phone: u.phone, password: u.password });
    h.advance(11 * DAY); // day 31: A expired, B and C are 11 days old
    expect(active(h)).toHaveLength(3); // nothing cleaned yet: it happens at login or in the job

    const d = await h.service.login({ phone: u.phone, password: u.password });
    expect(await h.service.authenticate(d.accessToken)).toMatchObject({ userId: u.id });
    const revoked = h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked');
    expect(revoked.map((e) => e.payload.reason)).toEqual(['SESSION_EXPIRED']);
    expect(await codeOf(h.service.refresh(a.refreshToken))).toBe('SESSION_REVOKED');
    await expect(h.service.refresh(b.refreshToken)).resolves.toBeDefined();
    await expect(h.service.refresh(c.refreshToken)).resolves.toBeDefined();
    expect(active(h)).toHaveLength(3);
    expect(active(h).map((s) => s.slot).sort()).toEqual([1, 2, 3]);
  });

  it('a session that is refreshed in time does not expire', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const a = await h.service.login({ phone: u.phone, password: u.password });
    h.advance(20 * DAY);
    await h.service.refresh(a.refreshToken);
    h.advance(20 * DAY); // day 40, but refreshed on day 20 -> valid until day 50
    expect(await h.service.expireSessions()).toEqual({ expired: 0, failed: 0 });
    expect(active(h)).toHaveLength(1);
  });

  it('the periodic job revokes only expired sessions, publishes AuthSessionRevoked, is idempotent and frees the slots', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    await loginN(h, u, 2); // day 0
    h.advance(REFRESH_TOKEN_TTL_SECONDS * 1000 - 5000); // both are still valid, a few seconds before their expiry
    const fresh = await h.service.login({ phone: u.phone, password: u.password });
    h.advance(DAY); // the first two are expired, the fresh one is valid

    expect(await h.service.expireSessions()).toEqual({ expired: 2, failed: 0 });
    expect(await h.service.expireSessions()).toEqual({ expired: 0, failed: 0 }); // idempotent
    expect(active(h)).toHaveLength(1);
    await expect(h.service.refresh(fresh.refreshToken)).resolves.toBeDefined(); // the valid session still works
    const revoked = h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked');
    expect(revoked.map((e) => e.payload.reason)).toEqual(['SESSION_EXPIRED', 'SESSION_EXPIRED']);
    expect([...h.repository.tokens.values()].filter((t) => t.revokedAt === null)).toHaveLength(1);
    expect(h.repository.sessions.size).toBe(3); // history kept
  });

  it('the job processes more sessions than one batch and never loops forever', async () => {
    const h = createSessionHarness();
    for (let i = 0; i < 5; i += 1) {
      const u = await h.createUser();
      await h.service.login({ phone: u.phone, password: u.password });
    }
    h.advance(31 * DAY);
    expect(await h.service.expireSessions({ limit: 2 })).toEqual({ expired: 5, failed: 0 });
    expect(active(h)).toHaveLength(0);
  });

  it('the scheduler runs a pass, never overlaps and survives an error', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const errors: unknown[] = [];
    const scheduler = new SessionExpiryScheduler({
      job: {
        expireSessions: () => {
          calls += 1;
          if (calls === 1) return new Promise((resolve) => { release = () => resolve({ expired: 1, failed: 0 }); });
          return Promise.reject(new Error('boom'));
        },
      },
      onError: (e) => errors.push(e),
    });
    const first = scheduler.tick();
    expect(await scheduler.tick()).toBe(false); // a pass is running
    release?.();
    expect(await first).toBe(true);
    expect(await scheduler.tick()).toBe(true);
    expect(errors).toHaveLength(1);
    scheduler.stop();
  });
});

describe('My devices', () => {
  it('lists the caller\'s active sessions with safe information only', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const [a, b, c] = await loginN(h, u, 3);
    const principalB = await h.service.authenticate(b!.accessToken);

    const list = await h.service.listDevices(u.id, principalB.sessionId);
    expect(list.maxActiveSessions).toBe(3);
    expect(list.items).toHaveLength(3);
    expect(list.items.map((d) => d.deviceLabel)).toEqual(['Device 1', 'Device 2', 'Device 3']);
    expect(list.items.filter((d) => d.isCurrent).map((d) => d.id)).toEqual([principalB.sessionId]);
    for (const d of list.items) expect(Object.keys(d).sort()).toEqual(['createdAt', 'deviceLabel', 'expiresAt', 'id', 'isCurrent', 'lastActiveAt']);

    const text = JSON.stringify(list);
    for (const secret of [a!.refreshToken, b!.refreshToken, c!.refreshToken, a!.accessToken, b!.accessToken]) expect(text).not.toContain(secret);
    expect(text).not.toContain(h.refreshTokenHasher.hash(a!.refreshToken));
  });

  it('shows the last refresh time and the expiry, and hides expired and revoked sessions and other accounts', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const other = await h.createUser();
    await h.service.login({ phone: other.phone, password: other.password });
    const a = await h.service.login({ phone: u.phone, password: u.password }); // will expire
    h.advance(20 * DAY);
    const b = await h.service.login({ phone: u.phone, password: u.password });
    const principalB = await h.service.authenticate(b.accessToken);
    h.advance(11 * DAY);
    const refreshed = await h.service.refresh(b.refreshToken);

    const list = await h.service.listDevices(u.id, principalB.sessionId);
    expect(list.items).toHaveLength(1); // A expired, the other account's session is not listed
    expect(list.items[0]!.lastActiveAt).toEqual(h.clock.now());
    expect(list.items[0]!.expiresAt).toEqual(refreshed.refreshTokenExpiresAt);
    expect(await codeOf(h.service.refresh(a.refreshToken))).toBe('REFRESH_TOKEN_EXPIRED');
  });

  it('revokes ONE selected session; the others stay active; the event carries DEVICE_REVOKED', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const [a, b, c] = await loginN(h, u, 3);
    const principalA = await h.service.authenticate(a!.accessToken);
    const principalB = await h.service.authenticate(b!.accessToken);

    await h.service.revokeDevice(u.id, principalB.sessionId, principalA.sessionId);
    expect(await codeOf(h.service.authenticate(b!.accessToken))).toBe('SESSION_REVOKED');
    expect(await codeOf(h.service.refresh(b!.refreshToken))).toBe('SESSION_REVOKED');
    expect(await h.service.authenticate(a!.accessToken)).toMatchObject({ userId: u.id });
    expect(await h.service.authenticate(c!.accessToken)).toMatchObject({ userId: u.id });
    expect(h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked').map((e) => e.payload.reason)).toEqual(['DEVICE_REVOKED']);
    // The freed slot can be used by a new device.
    await expect(h.service.login({ phone: u.phone, password: u.password })).resolves.toBeDefined();
  });

  it('revoking the caller\'s own session behaves like logout', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const [a, b] = await loginN(h, u, 2);
    const principalA = await h.service.authenticate(a!.accessToken);
    await h.service.revokeDevice(u.id, principalA.sessionId, principalA.sessionId);
    expect(await codeOf(h.service.authenticate(a!.accessToken))).toBe('SESSION_REVOKED');
    expect(await h.service.authenticate(b!.accessToken)).toMatchObject({ userId: u.id });
    expect(h.sessionEvents().filter((e) => e.type === 'AuthSessionRevoked').map((e) => e.payload.reason)).toEqual(['LOGOUT']);
  });

  it('answers SESSION_NOT_FOUND for another account\'s session, an unknown id and an already ended session, and revokes nothing', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    const other = await h.createUser();
    const [a, b] = await loginN(h, u, 2);
    const o = await h.service.login({ phone: other.phone, password: other.password });
    const principalA = await h.service.authenticate(a!.accessToken);
    const principalB = await h.service.authenticate(b!.accessToken);
    const principalO = await h.service.authenticate(o.accessToken);

    expect(await codeOf(h.service.revokeDevice(u.id, principalO.sessionId, principalA.sessionId))).toBe('SESSION_NOT_FOUND');
    expect(await codeOf(h.service.revokeDevice(u.id, '00000000-0000-4000-8000-000000000000', principalA.sessionId))).toBe('SESSION_NOT_FOUND');
    expect(await codeOf(h.service.revokeDevice(u.id, '', principalA.sessionId))).toBe('SESSION_NOT_FOUND');
    await h.service.revokeDevice(u.id, principalB.sessionId, principalA.sessionId);
    expect(await codeOf(h.service.revokeDevice(u.id, principalB.sessionId, principalA.sessionId))).toBe('SESSION_NOT_FOUND');
    expect(await h.service.authenticate(o.accessToken)).toMatchObject({ userId: other.id });
  });
});

describe('device label', () => {
  it('derives a coarse, safe label from the User-Agent', () => {
    const chromeAndroid = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    const safariIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const edgeWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
    const firefoxLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';
    const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    expect(deviceLabelFromUserAgent(chromeAndroid)).toBe('Chrome on Android');
    expect(deviceLabelFromUserAgent(safariIos)).toBe('Safari on iOS');
    expect(deviceLabelFromUserAgent(edgeWindows)).toBe('Edge on Windows');
    expect(deviceLabelFromUserAgent(firefoxLinux)).toBe('Firefox on Linux');
    expect(deviceLabelFromUserAgent(chromeMac)).toBe('Chrome on macOS');
    // No version number, build, model or raw header is kept.
    for (const ua of [chromeAndroid, safariIos, edgeWindows]) expect(deviceLabelFromUserAgent(ua)).not.toMatch(/\d/);
  });

  it('never throws and never echoes an unknown header', () => {
    expect(deviceLabelFromUserAgent(undefined)).toBe(UNKNOWN_DEVICE_LABEL);
    expect(deviceLabelFromUserAgent('')).toBe(UNKNOWN_DEVICE_LABEL);
    expect(deviceLabelFromUserAgent(42)).toBe(UNKNOWN_DEVICE_LABEL);
    expect(deviceLabelFromUserAgent('curl-secret-agent/1.0 token=abc123')).toBe(UNKNOWN_DEVICE_LABEL);
    expect(deviceLabelFromUserAgent('x'.repeat(100_000))).toBe(UNKNOWN_DEVICE_LABEL);
  });

  it('normalizes a stored label: printable, trimmed, at most 100 characters; empty becomes null', () => {
    expect(normalizeDeviceLabel('  Chrome \n on\tAndroid ')).toBe('Chrome on Android');
    expect(normalizeDeviceLabel('x'.repeat(300))).toHaveLength(100);
    expect(normalizeDeviceLabel('   ')).toBeNull();
    expect(normalizeDeviceLabel(undefined)).toBeNull();
    expect(normalizeDeviceLabel(null)).toBeNull();
  });

  it('login stores the label on the session', async () => {
    const h = createSessionHarness();
    const u = await h.createUser();
    await h.service.login({ phone: u.phone, password: u.password, deviceLabel: 'Chrome on Android' });
    await h.service.login({ phone: u.phone, password: u.password });
    expect([...h.repository.sessions.values()].map((s) => s.deviceLabel)).toEqual(['Chrome on Android', null]);
  });
});
