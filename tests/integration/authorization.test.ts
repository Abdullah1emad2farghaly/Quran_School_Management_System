import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createRequirePermission } from '../../src/modules/12-authorization-engine/public';
import { createAuthorizationHarness } from '../helpers/authorization-harness';

/** A route "owned by another module" protected with requireAuthentication + requirePermission. */
function build() {
  registerAllErrorMessages();
  const h = createAuthorizationHarness();
  h.policies.register({ code: 'demo.school.manage', roles: ['SCHOOL_MANAGER'], scope: 'MANAGEMENT' });
  h.policies.register({ code: 'demo.profile.view', roles: ['PARENT', 'TEACHER'], scope: 'UNSCOPED' });
  // school-1 belongs to the manager created in each test through this map
  const managerOf = new Map<string, string[]>();
  h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', {
    covers: async (q) => (managerOf.get(q.userId) ?? []).includes(q.target.id),
  });

  const requireAuthentication = createRequireAuthentication(() => h.sessions);
  const requirePermission = createRequirePermission(() => h.engine);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.get('/profile', requireAuthentication, requirePermission('demo.profile.view'), (req, res) => {
    res.json({ ok: true, role: req.authorization?.role });
  });
  app.get(
    '/schools/:schoolId',
    requireAuthentication,
    requirePermission('demo.school.manage', { target: (req) => ({ type: 'SCHOOL', id: String(req.params.schoolId) }) }),
    (req, res) => res.json({ ok: true, role: req.authorization?.role }),
  );
  app.get('/unregistered', requireAuthentication, requirePermission('demo.nothing.here'), (_req, res) => res.json({ ok: true }));
  app.get('/forgot-authentication', requirePermission('demo.profile.view'), (_req, res) => res.json({ ok: true }));
  app.get('/bad-target', requireAuthentication, requirePermission('demo.school.manage', { target: () => ({ type: 'school', id: '' }) }), (_req, res) => res.json({ ok: true }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  async function tokenFor(...roles: Parameters<typeof h.createUser>) {
    const u = await h.createUser(...roles);
    const login = await h.sessions.login({ phone: u.phone, password: u.password });
    return { user: u, authorization: { Authorization: `Bearer ${login.accessToken}` } };
  }
  return { app, h, tokenFor, managerOf };
}

describe('requirePermission', () => {
  it('answers 401 when the route forgot requireAuthentication (fails closed)', async () => {
    const { app } = build();
    const res = await request(app).get('/forgot-authentication');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('answers 401 without a token', async () => {
    const { app } = build();
    expect((await request(app).get('/profile')).status).toBe(401);
  });

  it('allows a granted role and exposes the authorizing role to the handler', async () => {
    const { app, tokenFor } = build();
    const { authorization } = await tokenFor('TEACHER');
    const res = await request(app).get('/profile').set(authorization);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, role: 'TEACHER' });
  });

  it('answers 403 ACCESS_DENIED, localized, without revealing why', async () => {
    const { app, tokenFor } = build();
    const { authorization } = await tokenFor('SCHOOL_MANAGER'); // not granted demo.profile.view
    const ar = await request(app).get('/profile').set(authorization);
    expect(ar.status).toBe(403);
    expect(ar.body.error.code).toBe('ACCESS_DENIED');
    expect(ar.body.error.message).toBe('ليست لديك صلاحية لتنفيذ هذا الإجراء.');
    const en = await request(app).get('/profile').set(authorization).set('Accept-Language', 'en');
    expect(en.body.error.message).toBe('You are not allowed to perform this action.');
    expect(JSON.stringify(ar.body)).not.toMatch(/PERMISSION_NOT_GRANTED|reason/i);
  });

  it('enforces scope from the route target: own school allowed, another school denied', async () => {
    const { app, tokenFor, managerOf } = build();
    const { user, authorization } = await tokenFor('SCHOOL_MANAGER');
    managerOf.set(user.id, ['school-1']);
    expect((await request(app).get('/schools/school-1').set(authorization)).status).toBe(200);
    const other = await request(app).get('/schools/school-2').set(authorization);
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('ACCESS_DENIED');
  });

  it('denies an unregistered permission and an invalid target', async () => {
    const { app, tokenFor } = build();
    const { authorization } = await tokenFor('SCHOOL_MANAGER');
    expect((await request(app).get('/unregistered').set(authorization)).status).toBe(403);
    expect((await request(app).get('/bad-target').set(authorization)).status).toBe(403);
  });

  it('role revocation takes effect on the next request even with a still-valid token', async () => {
    const { app, tokenFor, h } = build();
    const { user, authorization } = await tokenFor('TEACHER', 'PARENT');
    expect((await request(app).get('/profile').set(authorization)).status).toBe(200);
    await h.roles.revokeRole({ userId: user.id, roleCode: 'TEACHER', revokedBy: null });
    await h.roles.revokeRole({ userId: user.id, roleCode: 'PARENT', revokedBy: null }).catch(() => undefined); // last role cannot be revoked
    await h.roles.assignRole({ userId: user.id, roleCode: 'SCHOOL_MANAGER', assignedBy: null });
    await h.roles.revokeRole({ userId: user.id, roleCode: 'PARENT', revokedBy: null });
    expect((await request(app).get('/profile').set(authorization)).status).toBe(403);
  });

  it('a deactivated user is rejected on the next request', async () => {
    const { app, tokenFor, h } = build();
    const { user, authorization } = await tokenFor('TEACHER');
    await h.identity.deactivateUser(user.id);
    expect([401, 403]).toContain((await request(app).get('/profile').set(authorization)).status);
  });
});
