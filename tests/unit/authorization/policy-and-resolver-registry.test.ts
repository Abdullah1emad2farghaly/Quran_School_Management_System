import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { createAuthorizationHarness } from '../../helpers/authorization-harness';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : 'NOT_APP_ERROR';
  }
  return 'NO_ERROR';
};

describe('AuthorizationPolicyRegistry', () => {
  it('starts empty: Module 12 defines no permissions', () => {
    const h = createAuthorizationHarness();
    expect(h.policies.codes()).toEqual([]);
    expect(h.permissions.all()).toEqual([]);
  });

  it('stores the grants in Module 09 and the policy here', () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.manage', roles: ['SCHOOL_MANAGER'], scope: 'MANAGEMENT' });
    expect(h.permissions.isRegistered('demo.thing.manage')).toBe(true);
    expect(h.permissions.rolesGranting('demo.thing.manage')).toEqual(['SCHOOL_MANAGER']);
    expect(h.policies.get('demo.thing.manage')).toMatchObject({ scope: 'MANAGEMENT', ownershipRequiredFor: [] });
  });

  it('rejects a duplicate policy', () => {
    const h = createAuthorizationHarness();
    h.policies.register({ code: 'demo.thing.manage', roles: ['TEACHER'], scope: 'UNSCOPED' });
    expect(codeOf(() => h.policies.register({ code: 'demo.thing.manage', roles: ['TEACHER'], scope: 'UNSCOPED' }))).toBe(
      'AUTHORIZATION_CONFIGURATION_ERROR',
    );
  });

  it('requires an explicit, valid scope', () => {
    const h = createAuthorizationHarness();
    expect(codeOf(() => h.policies.register({ code: 'demo.thing.manage', roles: ['TEACHER'], scope: 'GLOBAL' as never }))).toBe(
      'AUTHORIZATION_CONFIGURATION_ERROR',
    );
    expect(codeOf(() => h.policies.register({ code: 'demo.thing.manage', roles: ['TEACHER'] } as never))).toBe('AUTHORIZATION_CONFIGURATION_ERROR');
    expect(h.policies.has('demo.thing.manage')).toBe(false);
  });

  it('ownership roles must be a subset of the granted roles', () => {
    const h = createAuthorizationHarness();
    expect(
      codeOf(() => h.policies.register({ code: 'demo.thing.edit', roles: ['TEACHER'], scope: 'MANAGEMENT', ownershipRequiredFor: ['PARENT'] })),
    ).toBe('AUTHORIZATION_CONFIGURATION_ERROR');
  });

  it('is atomic: a Module 09 rejection (bad code, Student role, empty roles) stores no policy', () => {
    const h = createAuthorizationHarness();
    expect(codeOf(() => h.policies.register({ code: 'BadCode', roles: ['TEACHER'], scope: 'UNSCOPED' }))).not.toBe('NO_ERROR');
    expect(codeOf(() => h.policies.register({ code: 'demo.thing.view', roles: ['STUDENT'], scope: 'UNSCOPED' }))).not.toBe('NO_ERROR');
    expect(codeOf(() => h.policies.register({ code: 'demo.thing.list', roles: [], scope: 'UNSCOPED' }))).not.toBe('NO_ERROR');
    expect(h.policies.codes()).toEqual([]);
  });

  it('rejects a permission already registered directly in Module 09 (it would have no policy)', () => {
    const h = createAuthorizationHarness();
    h.permissions.register({ code: 'demo.thing.manage', roles: ['TEACHER'] });
    expect(codeOf(() => h.policies.register({ code: 'demo.thing.manage', roles: ['TEACHER'], scope: 'UNSCOPED' }))).not.toBe('NO_ERROR');
    expect(h.policies.has('demo.thing.manage')).toBe(false);
  });
});

describe('AuthorizationResolvers', () => {
  const resolver = { covers: async () => true };

  it('registers per (scope kind, target type) and keeps management and reporting separate', () => {
    const h = createAuthorizationHarness();
    h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', resolver);
    expect(h.resolvers.scopeResolverFor('MANAGEMENT', 'SCHOOL')).toBe(resolver);
    expect(h.resolvers.scopeResolverFor('REPORTING', 'SCHOOL')).toBeUndefined();
    expect(h.resolvers.scopeResolverFor('MANAGEMENT', 'VILLAGE')).toBeUndefined();
  });

  it('rejects duplicates and invalid registrations', () => {
    const h = createAuthorizationHarness();
    h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', resolver);
    expect(codeOf(() => h.resolvers.registerScopeResolver('MANAGEMENT', 'SCHOOL', resolver))).toBe('AUTHORIZATION_CONFIGURATION_ERROR');
    expect(codeOf(() => h.resolvers.registerScopeResolver('ALL' as never, 'SCHOOL', resolver))).toBe('AUTHORIZATION_CONFIGURATION_ERROR');
    expect(codeOf(() => h.resolvers.registerScopeResolver('MANAGEMENT', 'school', resolver))).toBe('AUTHORIZATION_CONFIGURATION_ERROR');
    h.resolvers.registerOwnershipResolver('SESSION', { isOwner: async () => true });
    expect(codeOf(() => h.resolvers.registerOwnershipResolver('SESSION', { isOwner: async () => true }))).toBe('AUTHORIZATION_CONFIGURATION_ERROR');
    expect(codeOf(() => h.resolvers.registerOwnershipResolver('x', { isOwner: async () => true }))).toBe('AUTHORIZATION_CONFIGURATION_ERROR');
  });
});
