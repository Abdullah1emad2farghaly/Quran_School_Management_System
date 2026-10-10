import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import type { RoleCode } from '../../../src/modules/09-roles-permissions/public';
import type { AuthorizationDecision, ScopeKind } from '../../../src/modules/12-authorization-engine/public';
import { createAuthorizationHarness, type AuthorizationHarness } from '../../helpers/authorization-harness';

const SCHOOL = { type: 'SCHOOL', id: 'school-1' };
const reasonOf = (d: AuthorizationDecision) => (d.allowed ? 'ALLOWED' : d.reason);

/** A resolver that covers exactly the given (role -> school ids) pairs and records its calls. */
function coverage(map: Partial<Record<RoleCode, string[]>>) {
  const calls: { role: RoleCode; kind: ScopeKind; id: string }[] = [];
  return {
    calls,
    resolver: {
      covers: async (q: { role: RoleCode; kind: ScopeKind; target: { id: string } }) => {
        calls.push({ role: q.role, kind: q.kind, id: q.target.id });
        return (map[q.role] ?? []).includes(q.target.id);
      },
    },
  };
}

function scoped(h: AuthorizationHarness, roles: RoleCode[] = ['SCHOOL_MANAGER'], scope: 'MANAGEMENT' | 'REPORTING' = 'MANAGEMENT') {
  h.policies.register({ code: 'demo.thing.manage', roles, scope });
}

describe('deny by default', () => {
  it('denies every permission when nothing is registered', async () => {
    const h = createAuthorizationHarness();
    const u = await h.createUser('MAIN_ADMIN');
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage' }))).toBe('PERMISSION_NOT_REGISTERED');
  });

  it('denies a permission that exists only in Module 09 (no policy)', async () => {
    const h = createAuthorizationHarness();
    h.permissions.register({ code: 'demo.thing.manage', roles: ['TEACHER'] });
    const u = await h.createUser('TEACHER');
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage' }))).toBe('PERMISSION_NOT_REGISTERED');
  });

  it('denies malformed requests', async () => {
    const h = createAuthorizationHarness();
    for (const bad of [null, undefined, {}, { userId: '', permission: 'a.b.c' }, { userId: 'u', permission: '' }, { userId: 5, permission: 'a.b.c' }]) {
      expect(reasonOf(await h.engine.authorize(bad as never))).toBe('INVALID_REQUEST');
    }
  });

  it('a role gains nothing implicitly: a role that is not granted the permission is denied', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.view', roles: ['TEACHER'], scope: 'UNSCOPED' });
    for (const role of ['MAIN_ADMIN', 'SCHOOL_MANAGER', 'PARENT'] as RoleCode[]) {
      const u = await h.createUser(role);
      expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.view' }))).toBe('PERMISSION_NOT_GRANTED');
    }
  });

  it('allows an unscoped permission to a granted role and reports the role', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.view', roles: ['TEACHER'], scope: 'UNSCOPED' });
    const u = await h.createUser('TEACHER');
    expect(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.view' })).toEqual({ allowed: true, role: 'TEACHER' });
  });
});

describe('user and role state', () => {
  it('denies unknown, inactive and role-less users', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.view', roles: ['TEACHER'], scope: 'UNSCOPED' });
    expect(reasonOf(await h.engine.authorize({ userId: 'nobody', permission: 'demo.thing.view' }))).toBe('USER_NOT_FOUND');

    const inactive = await h.createUser('TEACHER');
    await h.identity.deactivateUser(inactive.id);
    expect(reasonOf(await h.engine.authorize({ userId: inactive.id, permission: 'demo.thing.view' }))).toBe('USER_INACTIVE');

    const roleless = await h.identity.createUser({ phone: '01055500000', password: 'secret1' });
    expect(reasonOf(await h.engine.authorize({ userId: roleless.id, permission: 'demo.thing.view' }))).toBe('NO_ACTIVE_ROLE');
  });

  it('takes effect immediately: deactivation and role revocation are seen on the very next call', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.view', roles: ['TEACHER'], scope: 'UNSCOPED' });
    const u = await h.createUser('TEACHER', 'PARENT');
    expect((await h.engine.authorize({ userId: u.id, permission: 'demo.thing.view' })).allowed).toBe(true);
    await h.roles.revokeRole({ userId: u.id, roleCode: 'TEACHER', revokedBy: null });
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.view' }))).toBe('PERMISSION_NOT_GRANTED');
    await h.identity.deactivateUser(u.id);
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.view' }))).toBe('USER_INACTIVE');
  });

  it('a revoked assignment in the history never grants access', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.view', roles: ['TEACHER'], scope: 'UNSCOPED' });
    const u = await h.createUser('TEACHER', 'PARENT');
    await h.roles.revokeRole({ userId: u.id, roleCode: 'TEACHER', revokedBy: null });
    expect((await h.roles.listRoleHistory(u.id)).some((a) => a.roleCode === 'TEACHER')).toBe(true);
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.view' }))).toBe('PERMISSION_NOT_GRANTED');
  });

  it('never turns an infrastructure failure into an allow: it propagates', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.view', roles: ['TEACHER'], scope: 'UNSCOPED' });
    const u = await h.createUser('TEACHER');
    h.roles.listActiveRoles = async () => {
      throw new Error('database down');
    };
    await expect(h.engine.authorize({ userId: u.id, permission: 'demo.thing.view' })).rejects.toThrow('database down');
  });
});

describe('scope', () => {
  it('requires a target for a scoped permission and refuses one for an unscoped permission', async () => {
    const h = createAuthorizationHarness();
    scoped(h);
    h.policies.register({ code: 'demo.thing.view', roles: ['SCHOOL_MANAGER'], scope: 'UNSCOPED' });
    const u = await h.createUser('SCHOOL_MANAGER');
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage' }))).toBe('INVALID_REQUEST');
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.view', target: SCHOOL }))).toBe('INVALID_REQUEST');
    for (const bad of [null, { type: 'school', id: 'x' }, { type: 'SCHOOL', id: '' }, { type: 'SCHOOL', id: 'has space' }, { type: 'SCHOOL' }]) {
      expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage', target: bad as never }))).toBe('INVALID_REQUEST');
    }
  });

  it('missing scope information never means unrestricted: no resolver registered is a denial', async () => {
    const h = createAuthorizationHarness();
    scoped(h);
    const u = await h.createUser('SCHOOL_MANAGER');
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage', target: SCHOOL }))).toBe('SCOPE_RESOLVER_MISSING');
  });

  it('allows only where the owning module proves the scope covers the target (another school is denied)', async () => {
    const h = createAuthorizationHarness();
    scoped(h);
    const c = coverage({ SCHOOL_MANAGER: ['school-1'] });
    h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', c.resolver);
    const u = await h.createUser('SCHOOL_MANAGER');
    expect(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage', target: SCHOOL })).toEqual({ allowed: true, role: 'SCHOOL_MANAGER' });
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage', target: { type: 'SCHOOL', id: 'school-2' } }))).toBe('SCOPE_NOT_COVERED');
    expect(c.calls[0]).toEqual({ role: 'SCHOOL_MANAGER', kind: 'MANAGEMENT', id: 'school-1' });
  });

  it('treats a throwing resolver as a denial and logs only the error name', async () => {
    const h = createAuthorizationHarness();
    scoped(h);
    h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', {
      covers: async () => {
        throw new Error('secret connection string');
      },
    });
    const u = await h.createUser('SCHOOL_MANAGER');
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage', target: SCHOOL }))).toBe('SCOPE_RESOLUTION_FAILED');
    const errorLog = h.logs.find((l) => l.level === 'error');
    expect(errorLog?.fields).toMatchObject({ errorName: 'Error' });
    expect(JSON.stringify(h.logs)).not.toContain('secret connection string');
  });

  it('a truthy non-boolean answer is not proof', async () => {
    const h = createAuthorizationHarness();
    scoped(h);
    h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', { covers: (async () => 'yes') as never });
    const u = await h.createUser('SCHOOL_MANAGER');
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage', target: SCHOOL }))).toBe('SCOPE_NOT_COVERED');
  });

  it('scope never grants a permission: a covered user whose role lacks the permission is denied', async () => {
    const h = createAuthorizationHarness();
    scoped(h, ['SCHOOL_MANAGER']);
    const c = coverage({ TEACHER: ['school-1'] });
    h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', c.resolver);
    const t = await h.createUser('TEACHER');
    expect(reasonOf(await h.engine.authorize({ userId: t.id, permission: 'demo.thing.manage', target: SCHOOL }))).toBe('PERMISSION_NOT_GRANTED');
    expect(c.calls).toHaveLength(0);
  });

  it('scope held through one role does not authorize an action granted to another role', async () => {
    const h = createAuthorizationHarness();
    scoped(h, ['PARENT']);
    const c = coverage({ TEACHER: ['school-1'] }); // the user is covered as TEACHER only
    h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', c.resolver);
    const u = await h.createUser('TEACHER', 'PARENT');
    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage', target: SCHOOL }))).toBe('SCOPE_NOT_COVERED');
    expect(c.calls.map((x) => x.role)).toEqual(['PARENT']);
  });

  it('a multi-role user is allowed through whichever granted role passes', async () => {
    const h = createAuthorizationHarness();
    scoped(h, ['TEACHER', 'PARENT']);
    h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', coverage({ PARENT: ['school-1'] }).resolver);
    const u = await h.createUser('TEACHER', 'PARENT');
    expect(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage', target: SCHOOL })).toEqual({ allowed: true, role: 'PARENT' });
  });
});

describe('management scope and reporting scope are separate', () => {
  it('a reporting-only resolver never satisfies a management permission, and the other way round', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.manage', roles: ['SCHOOL_MANAGER'], scope: 'MANAGEMENT' });
    h.policies.register({ code: 'demo.report.view', roles: ['SCHOOL_MANAGER'], scope: 'REPORTING' });
    const reporting = coverage({ SCHOOL_MANAGER: ['school-1'] });
    h.resolvers.registerScopeResolver('REPORTING', 'SCHOOL', reporting.resolver);
    const u = await h.createUser('SCHOOL_MANAGER');

    expect(reasonOf(await h.engine.authorize({ userId: u.id, permission: 'demo.thing.manage', target: SCHOOL }))).toBe('SCOPE_RESOLVER_MISSING');
    expect((await h.engine.authorize({ userId: u.id, permission: 'demo.report.view', target: SCHOOL })).allowed).toBe(true);
    expect(reporting.calls.every((x) => x.kind === 'REPORTING')).toBe(true);

    const h2 = createAuthorizationHarness();
    h2.policies.register({ code: 'demo.report.view', roles: ['SCHOOL_MANAGER'], scope: 'REPORTING' });
    h2.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', coverage({ SCHOOL_MANAGER: ['school-1'] }).resolver);
    const u2 = await h2.createUser('SCHOOL_MANAGER');
    expect(reasonOf(await h2.engine.authorize({ userId: u2.id, permission: 'demo.report.view', target: SCHOOL }))).toBe('SCOPE_RESOLVER_MISSING');
  });

  it('global scope is per kind and still needs the permission', async () => {
    const h = createAuthorizationHarness({ globalScopeRoles: { MANAGEMENT: ['MAIN_ADMIN'], REPORTING: [] } });
    h.policies.register({ code: 'demo.thing.manage', roles: ['MAIN_ADMIN'], scope: 'MANAGEMENT' });
    h.policies.register({ code: 'demo.report.view', roles: ['MAIN_ADMIN'], scope: 'REPORTING' });
    h.policies.register({ code: 'demo.other.manage', roles: ['SCHOOL_MANAGER'], scope: 'MANAGEMENT' });
    const admin = await h.createUser('MAIN_ADMIN');
    // global management scope: no resolver needed
    expect(await h.engine.authorize({ userId: admin.id, permission: 'demo.thing.manage', target: SCHOOL })).toEqual({ allowed: true, role: 'MAIN_ADMIN' });
    // management does not imply reporting
    expect(reasonOf(await h.engine.authorize({ userId: admin.id, permission: 'demo.report.view', target: SCHOOL }))).toBe('SCOPE_RESOLVER_MISSING');
    // global scope does not grant a permission the role lacks
    expect(reasonOf(await h.engine.authorize({ userId: admin.id, permission: 'demo.other.manage', target: SCHOOL }))).toBe('PERMISSION_NOT_GRANTED');
  });

  it('with no global roles configured (default) even Main Admin is subject to scope resolution', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.manage', roles: ['MAIN_ADMIN'], scope: 'MANAGEMENT' });
    const admin = await h.createUser('MAIN_ADMIN');
    expect(reasonOf(await h.engine.authorize({ userId: admin.id, permission: 'demo.thing.manage', target: SCHOOL }))).toBe('SCOPE_RESOLVER_MISSING');
  });
});

describe('ownership', () => {
  const SESSION = { type: 'SESSION', id: 'session-1' };
  const setup = (owner: (q: { userId: string; role: RoleCode }) => boolean | Promise<boolean>) => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.session.edit', roles: ['TEACHER', 'SCHOOL_MANAGER'], scope: 'MANAGEMENT', ownershipRequiredFor: ['TEACHER'] });
    h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', coverage({ TEACHER: ['school-1'], SCHOOL_MANAGER: ['school-1'] }).resolver);
    h.resolvers.registerOwnershipResolver('SESSION', { isOwner: async (q) => owner(q) as never });
    return h;
  };

  it('requires the resource when the policy has ownership roles', async () => {
    const h = setup(() => true);
    const t = await h.createUser('TEACHER');
    expect(reasonOf(await h.engine.authorize({ userId: t.id, permission: 'demo.session.edit', target: SCHOOL }))).toBe('INVALID_REQUEST');
  });

  it('denies when ownership fails, even if scope and permission pass', async () => {
    const h = setup(() => false);
    const t = await h.createUser('TEACHER');
    expect(reasonOf(await h.engine.authorize({ userId: t.id, permission: 'demo.session.edit', target: SCHOOL, resource: SESSION }))).toBe('OWNERSHIP_NOT_SATISFIED');
  });

  it('allows the owner, and does not require ownership from roles that are not listed', async () => {
    const h = setup((q) => q.role === 'TEACHER');
    const t = await h.createUser('TEACHER');
    const m = await h.createUser('SCHOOL_MANAGER');
    expect((await h.engine.authorize({ userId: t.id, permission: 'demo.session.edit', target: SCHOOL, resource: SESSION })).allowed).toBe(true);
    expect(await h.engine.authorize({ userId: m.id, permission: 'demo.session.edit', target: SCHOOL, resource: SESSION })).toEqual({ allowed: true, role: 'SCHOOL_MANAGER' });
  });

  it('denies when no ownership resolver exists or it throws', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.session.edit', roles: ['TEACHER'], scope: 'UNSCOPED', ownershipRequiredFor: ['TEACHER'] });
    const t = await h.createUser('TEACHER');
    expect(reasonOf(await h.engine.authorize({ userId: t.id, permission: 'demo.session.edit', resource: SESSION }))).toBe('OWNERSHIP_RESOLVER_MISSING');
    h.resolvers.registerOwnershipResolver('SESSION', {
      isOwner: async () => {
        throw new Error('boom');
      },
    });
    expect(reasonOf(await h.engine.authorize({ userId: t.id, permission: 'demo.session.edit', resource: SESSION }))).toBe('OWNERSHIP_RESOLUTION_FAILED');
  });
});

describe('assertAuthorized', () => {
  it('returns the authorizing role, and throws a reason-free 403 ACCESS_DENIED otherwise', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.view', roles: ['TEACHER'], scope: 'UNSCOPED' });
    const t = await h.createUser('TEACHER');
    const p = await h.createUser('PARENT');
    expect(await h.engine.assertAuthorized({ userId: t.id, permission: 'demo.thing.view' })).toBe('TEACHER');
    const error = await h.engine.assertAuthorized({ userId: p.id, permission: 'demo.thing.view' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ACCESS_DENIED', kind: 'FORBIDDEN' });
    expect((error as AppError).details).toBeUndefined();
  });

  it('logs the denial reason (for operators) but not for allowed calls', async () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.view', roles: ['TEACHER'], scope: 'UNSCOPED' });
    const t = await h.createUser('TEACHER');
    const p = await h.createUser('PARENT');
    await h.engine.authorize({ userId: t.id, permission: 'demo.thing.view' });
    expect(h.logs).toHaveLength(0);
    await h.engine.authorize({ userId: p.id, permission: 'demo.thing.view' });
    expect(h.logs[0]).toMatchObject({ level: 'info', fields: { reason: 'PERMISSION_NOT_GRANTED', permission: 'demo.thing.view', userId: p.id } });
  });
});
