import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createRequirePermission } from '../../src/modules/12-authorization-engine/public';
import type { RoleCode } from '../../src/modules/09-roles-permissions/public';
import { createAuthorizationHarness } from '../helpers/authorization-harness';
import { createSessionHarness } from '../helpers/session-harness';

const AUTH = '/api/v1/auth';

/** The auth router plus one protected "business" route per role, all guarded by requireAuthentication + requirePermission. */
function build() {
  registerAllErrorMessages();
  const h = createAuthorizationHarness();
  const only = { PARENT: 'demo.parent.only', TEACHER: 'demo.teacher.only', SCHOOL_MANAGER: 'demo.school.only', ORGANIZATION_MANAGER: 'demo.org.only' } as const;
  for (const [role, code] of Object.entries(only)) h.policies.register({ code, roles: [role as RoleCode], scope: 'UNSCOPED' });
  const requireAuthentication = createRequireAuthentication(() => h.sessions);
  const requirePermission = createRequirePermission(() => h.engine);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(
    AUTH,
    createAuthRouter({
      getService: () => h.sessions,
      requireAuthentication,
      requireAuthenticationAllowingPasswordChange: createRequireAuthentication(() => h.sessions, { allowPasswordChangePending: true }),
    }),
  );
  for (const [role, code] of Object.entries(only)) {
    app.get(`/as/${role}`, requireAuthentication, requirePermission(code), (req, res) => res.json({ ok: true, role: req.authorization?.role }));
  }
  app.use(notFoundHandler);
  app.use(errorHandler);

  const login = async (u: { phone: string; password: string }) => {
    const res = await request(app).post(`${AUTH}/login`).send({ phone: u.phone, password: u.password });
    return { res, body: res.body.data, auth: { Authorization: `Bearer ${res.body.data?.accessToken}` } };
  };
  const switchRole = (auth: Record<string, string>, role: unknown) => request(app).post(`${AUTH}/switch-role`).set(auth).send({ role });
  const status = async (auth: Record<string, string>, role: string, headers: Record<string, string> = {}) => (await request(app).get(`/as/${role}`).set(auth).set(headers)).status;
  /** The role a session acts as, read the way every request reads it: from the persisted session. */
  const actingAs = async (auth: Record<string, string>) => (await h.sessions.authenticate(auth.Authorization!.slice(7))).activeRole;
  return { app, h, login, switchRole, status, actingAs };
}

const FOUR: RoleCode[] = ['TEACHER', 'PARENT', 'ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'];

describe('login: roles and the initial active role', () => {
  it('a single-role account starts with that role already active (no extra request)', async () => {
    const { h, login, status } = build();
    const { res, body, auth } = await login(await h.createUser('TEACHER'));
    expect(res.status).toBe(200);
    expect(body.roles).toEqual(['TEACHER']);
    expect(body.activeRole).toBe('TEACHER');
    expect(await status(auth, 'TEACHER')).toBe(200);
  });

  it('a multi-role account gets EVERY assigned role, activeRole null, and no business access until it chooses', async () => {
    const { h, login, status } = build();
    const { body, auth } = await login(await h.createUser(...FOUR));
    expect([...body.roles].sort()).toEqual([...FOUR].sort());
    expect(body.activeRole).toBeNull();
    for (const role of FOUR) expect(await status(auth, role)).toBe(403);
    expect(body.accessToken).toBeTruthy(); // the session itself is authenticated: it can still select a role
  });

  it('never returns a role the account does not hold, and keeps the existing fields', async () => {
    const { h, login } = build();
    const { body } = await login(await h.createUser('TEACHER', 'PARENT'));
    expect(body.roles).not.toContain('SCHOOL_MANAGER');
    expect(body).toMatchObject({ tokenType: 'Bearer', mustChangePassword: false, schoolId: null });
    expect(body.user.phone).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it('an account without any role logs in with roles [] and activeRole null (and reaches nothing protected)', async () => {
    const { h, login, status } = build();
    const u = await h.createUser();
    const { body, auth } = await login(u);
    expect(body.roles).toEqual([]);
    expect(body.activeRole).toBeNull();
    expect(await status(auth, 'PARENT')).toBe(403);
  });
});

describe('POST /auth/switch-role', () => {
  it('switches Teacher -> Parent -> Teacher and answers with the persisted state', async () => {
    const { h, login, switchRole, actingAs } = build();
    const { auth } = await login(await h.createUser('TEACHER', 'PARENT'));

    const toParent = await switchRole(auth, 'PARENT');
    expect(toParent.status).toBe(200);
    expect(toParent.body.data).toMatchObject({ activeRole: 'PARENT', schoolId: null });
    expect([...toParent.body.data.roles].sort()).toEqual(['PARENT', 'TEACHER']);
    expect(await actingAs(auth)).toBe('PARENT');

    const toTeacher = await switchRole(auth, 'TEACHER');
    expect(toTeacher.body.data.activeRole).toBe('TEACHER');
    expect(await actingAs(auth)).toBe('TEACHER');
  });

  it('is idempotent: choosing the active role again changes nothing and rotates nothing', async () => {
    const { h, login, switchRole, actingAs } = build();
    const user = await h.createUser('TEACHER', 'PARENT');
    const { auth } = await login(user);
    await switchRole(auth, 'PARENT');
    const again = await switchRole(auth, 'PARENT');
    expect(again.status).toBe(200);
    expect(again.body.data.activeRole).toBe('PARENT');
    expect(await actingAs(auth)).toBe('PARENT');
    expect(again.body.data.accessToken).toBeUndefined(); // no token rotation
    expect((await h.sessions.listDevices(user.id, (await h.sessions.authenticate(auth.Authorization!.slice(7))).sessionId)).items).toHaveLength(1);
  });

  it('refuses a role the account never held (403 ROLE_NOT_ASSIGNED) and leaves the active role alone', async () => {
    const { h, login, switchRole, actingAs } = build();
    const { auth } = await login(await h.createUser('TEACHER', 'PARENT'));
    await switchRole(auth, 'PARENT');
    const res = await switchRole(auth, 'SCHOOL_MANAGER');
    expect([res.status, res.body.error.code]).toEqual([403, 'ROLE_NOT_ASSIGNED']);
    expect(await actingAs(auth)).toBe('PARENT');
  });

  it('refuses unknown role codes and malformed values', async () => {
    const { h, login, switchRole } = build();
    const { auth } = await login(await h.createUser('TEACHER', 'PARENT'));
    expect((await switchRole(auth, 'GOD_MODE')).status).toBe(403);
    expect((await switchRole(auth, 'teacher')).status).toBe(403); // codes are upper case; never guessed
    for (const bad of [undefined, null, 5, '', '   ', ['PARENT'], { role: 'PARENT' }, 'X'.repeat(33)]) {
      const res = await switchRole(auth, bad);
      expect([bad, res.status, res.body.error.code]).toEqual([bad, 400, 'VALIDATION_FAILED']);
    }
  });

  it('refuses a role whose assignment was revoked, and a revoked active role stops authorizing at once', async () => {
    const { h, login, switchRole, status } = build();
    const user = await h.createUser('TEACHER', 'PARENT', 'SCHOOL_MANAGER');
    const { auth } = await login(user);
    await switchRole(auth, 'PARENT');
    expect(await status(auth, 'PARENT')).toBe(200);

    await h.roles.revokeRole({ userId: user.id, roleCode: 'PARENT', revokedBy: null });
    expect(await status(auth, 'PARENT')).toBe(403); // the stored choice is no longer held: nothing is active
    const res = await switchRole(auth, 'PARENT');
    expect([res.status, res.body.error.code]).toEqual([403, 'ROLE_NOT_ASSIGNED']);
    expect((await switchRole(auth, 'TEACHER')).status).toBe(200);
  });

  it('is authenticated only: no token is 401, and a revoked session is refused', async () => {
    const { app, h, login, switchRole } = build();
    const user = await h.createUser('TEACHER', 'PARENT');
    expect((await request(app).post(`${AUTH}/switch-role`).send({ role: 'PARENT' })).status).toBe(401);
    const { auth } = await login(user);
    expect((await request(app).post(`${AUTH}/logout`).set(auth)).status).toBe(204);
    expect((await switchRole(auth, 'PARENT')).status).toBe(401);
  });

  it('an account with a pending mandatory password change cannot switch roles yet', async () => {
    const { h, login, switchRole } = build();
    const u = await h.identity.createUser({ phone: '01077770001', password: '4567', mustChangePassword: true });
    await h.roles.assignRole({ userId: u.id, roleCode: 'TEACHER', assignedBy: null });
    await h.roles.assignRole({ userId: u.id, roleCode: 'PARENT', assignedBy: null });
    const { auth } = await login({ phone: '01077770001', password: '4567' });
    const res = await switchRole(auth, 'PARENT');
    expect([res.status, res.body.error.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED']);
  });

  it('an EXPIRED session cannot switch roles', async () => {
    const s = createSessionHarness();
    const user = await s.createUser({ role: 'TEACHER' });
    await s.roles.assignRole({ userId: user.id, roleCode: 'PARENT', assignedBy: null });
    const login = await s.service.login({ phone: user.phone, password: user.password });
    const { sessionId } = await s.service.authenticate(login.accessToken).catch(async () => ({ sessionId: '' }));
    s.advance(31 * 24 * 60 * 60 * 1000); // past the 30-day refresh token (the session's lifetime)
    await expect(s.service.switchRole(user.id, sessionId, 'PARENT')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });
});

describe('the active role belongs to the SESSION (three devices)', () => {
  it('each of three sessions keeps its own active role; switching one never touches the others; all stay active', async () => {
    const { h, login, switchRole, actingAs, app } = build();
    const user = await h.createUser(...FOUR);
    const A = (await login(user)).auth;
    const B = (await login(user)).auth;
    const C = (await login(user)).auth;

    expect((await switchRole(A, 'PARENT')).status).toBe(200);
    expect((await switchRole(B, 'TEACHER')).status).toBe(200);
    expect((await switchRole(C, 'SCHOOL_MANAGER')).status).toBe(200);
    expect([await actingAs(A), await actingAs(B), await actingAs(C)]).toEqual(['PARENT', 'TEACHER', 'SCHOOL_MANAGER']);

    await switchRole(A, 'ORGANIZATION_MANAGER');
    expect([await actingAs(A), await actingAs(B), await actingAs(C)]).toEqual(['ORGANIZATION_MANAGER', 'TEACHER', 'SCHOOL_MANAGER']);

    await switchRole(B, 'PARENT');
    expect([await actingAs(A), await actingAs(B), await actingAs(C)]).toEqual(['ORGANIZATION_MANAGER', 'PARENT', 'SCHOOL_MANAGER']);

    // All three sessions are still active.
    const devices = await request(app).get(`${AUTH}/sessions`).set(A);
    expect(devices.body.data.items).toHaveLength(3);
  });

  it('each session is authorized ONLY as its own role, on the very same account', async () => {
    const { h, login, switchRole, status } = build();
    const user = await h.createUser('TEACHER', 'PARENT');
    const mobile = (await login(user)).auth;
    const laptop = (await login(user)).auth;
    await switchRole(mobile, 'PARENT');
    await switchRole(laptop, 'TEACHER');
    expect([await status(mobile, 'PARENT'), await status(mobile, 'TEACHER')]).toEqual([200, 403]);
    expect([await status(laptop, 'TEACHER'), await status(laptop, 'PARENT')]).toEqual([200, 403]);
  });

  it('the three-session limit is unchanged: switching roles is not a new session', async () => {
    const { app, h, login, switchRole } = build();
    const user = await h.createUser('TEACHER', 'PARENT');
    const sessions = [await login(user), await login(user), await login(user)];
    for (const s of sessions) await switchRole(s.auth, 'PARENT');
    for (const s of sessions) await switchRole(s.auth, 'TEACHER');
    const fourth = await request(app).post(`${AUTH}/login`).send({ phone: user.phone, password: user.password });
    expect([fourth.status, fourth.body.error.code]).toEqual([422, 'SESSION_LIMIT_REACHED']);
    expect((await request(app).get(`${AUTH}/sessions`).set(sessions[0]!.auth)).body.data.items).toHaveLength(3);
  });
});

describe('stale role context and client-supplied roles', () => {
  it('after a switch the SAME access token acts as the new role only: the previous role can no longer authorize', async () => {
    const { h, login, switchRole, status } = build();
    const { auth } = await login(await h.createUser('TEACHER', 'PARENT'));
    await switchRole(auth, 'PARENT');
    expect(await status(auth, 'PARENT')).toBe(200);
    await switchRole(auth, 'TEACHER');
    expect([await status(auth, 'PARENT'), await status(auth, 'TEACHER')]).toEqual([403, 200]); // the old context is dead at once
  });

  it('a role sent in a header or in the body can never override the session role', async () => {
    const { app, h, login, switchRole, status } = build();
    const { auth } = await login(await h.createUser('TEACHER', 'PARENT'));
    const forged = { 'x-active-role': 'PARENT', 'x-role': 'PARENT', role: 'PARENT' };
    expect(await status(auth, 'PARENT', forged)).toBe(403); // none selected yet
    await switchRole(auth, 'TEACHER');
    expect(await status(auth, 'PARENT', forged)).toBe(403);
    const withBody = await request(app).get('/as/PARENT').set(auth).set(forged).send({ role: 'PARENT', activeRole: 'PARENT' });
    expect(withBody.status).toBe(403);
  });

  it('a user cannot activate or use another account\'s roles', async () => {
    const { h, login, switchRole } = build();
    await h.createUser('SCHOOL_MANAGER');
    const { auth } = await login(await h.createUser('TEACHER', 'PARENT'));
    expect((await switchRole(auth, 'SCHOOL_MANAGER')).status).toBe(403);
  });
});

describe('refresh, logout and password change keep working per session', () => {
  it('refresh preserves the active role (and never derives one from the account globally)', async () => {
    const { app, h, login, switchRole } = build();
    const user = await h.createUser(...FOUR);
    const first = await login(user);
    const second = await login(user);
    await switchRole(first.auth, 'TEACHER');
    await switchRole(second.auth, 'PARENT');

    const refreshed = await request(app).post(`${AUTH}/refresh`).send({ refreshToken: first.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.activeRole).toBe('TEACHER');
    const stillUnset = await login(user); // a brand-new session of the same account starts unset, not copied from the others
    expect(stillUnset.body.activeRole).toBeNull();
    const refreshedSecond = await request(app).post(`${AUTH}/refresh`).send({ refreshToken: second.body.refreshToken });
    expect(refreshedSecond.body.data.activeRole).toBe('PARENT');
  });

  it('switching roles rotates no token and keeps the other sessions\' refresh tokens valid', async () => {
    const { app, h, login, switchRole } = build();
    const user = await h.createUser('TEACHER', 'PARENT');
    const a = await login(user);
    const b = await login(user);
    await switchRole(a.auth, 'PARENT');
    // a's own refresh token is still the current one (not rotated by the switch) and b is untouched.
    expect((await request(app).post(`${AUTH}/refresh`).send({ refreshToken: a.body.refreshToken })).status).toBe(200);
    expect((await request(app).post(`${AUTH}/refresh`).send({ refreshToken: b.body.refreshToken })).status).toBe(200);
  });

  it('logout ends only the current session; the others keep their roles', async () => {
    const { app, h, login, switchRole, status } = build();
    const user = await h.createUser('TEACHER', 'PARENT');
    const a = await login(user);
    const b = await login(user);
    await switchRole(a.auth, 'PARENT');
    await switchRole(b.auth, 'TEACHER');
    expect((await request(app).post(`${AUTH}/logout`).set(a.auth)).status).toBe(204);
    expect((await switchRole(a.auth, 'TEACHER')).status).toBe(401);
    expect(await status(b.auth, 'TEACHER')).toBe(200);
  });

  it('change-password keeps the current session (and its active role) and revokes the others', async () => {
    const { app, h, login, switchRole, status } = build();
    const user = await h.createUser('TEACHER', 'PARENT');
    const current = await login(user);
    const other = await login(user);
    await switchRole(current.auth, 'PARENT');
    await switchRole(other.auth, 'TEACHER');
    const changed = await request(app).post(`${AUTH}/change-password`).set(current.auth).send({ currentPassword: user.password, newPassword: 'newpass12' });
    expect(changed.status).toBe(204);
    expect(await status(current.auth, 'PARENT')).toBe(200); // current session, same role
    expect(await status(other.auth, 'TEACHER')).toBe(401); // the other session was revoked
  });
});

describe('sessions that existed before the active role (stored role NULL)', () => {
  it('a single-role account keeps working; a multi-role account must choose', async () => {
    const s = createSessionHarness();
    const single = await s.createUser({ role: 'TEACHER' });
    const multi = await s.createUser({ role: 'TEACHER' });
    await s.roles.assignRole({ userId: multi.id, roleCode: 'PARENT', assignedBy: null });
    const singleLogin = await s.service.login({ phone: single.phone, password: single.password });
    const multiLogin = await s.service.login({ phone: multi.phone, password: multi.password });
    // Simulate a pre-migration session: the stored role is NULL.
    for (const l of [singleLogin, multiLogin]) {
      const principal = await s.service.authenticate(l.accessToken);
      const session = (await s.repository.findSessionById(principal.sessionId))!;
      (session as unknown as { state: { activeRole: string | null } }).state.activeRole = null;
      await s.unitOfWork.run((tx) => s.repository.updateSession(session, tx));
    }
    expect((await s.service.authenticate(singleLogin.accessToken)).activeRole).toBe('TEACHER');
    expect((await s.service.authenticate(multiLogin.accessToken)).activeRole).toBeNull();
  });
});
