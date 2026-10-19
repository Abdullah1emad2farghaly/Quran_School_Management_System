import type { AuthorizationPolicyRegistry, AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { ParentService } from './parent-service';

/** Permissions of the Parent resource (registered ONLY through the shared Authorization Engine). */
export const ParentPermissions = {
  CREATE: 'parents.parent.create',
  LIST: 'parents.parent.list',
  READ: 'parents.parent.read',
  UPDATE: 'parents.parent.update',
  READ_OWN: 'parents.parent.read-own',
  REMOVE_SCHOOL_LINK: 'parents.school-link.remove',
} as const;

/** Scope target type of a Parent (the SCHOOL target type belongs to Module 16 and its resolver is reused as is). */
export const PARENT_TARGET_TYPE = 'PARENT';

export interface ParentAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly parents: Pick<ParentService, 'listActiveSchoolIds'>;
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
}

/**
 * Module 17 registers what it owns (approved rules only; anything not listed stays denied):
 *   - SCHOOL_MANAGER: create a Parent in THEIR school (scope target SCHOOL, resolved by Module 16: an active manager link to that exact school),
 *     list the Parents of THEIR school, and read / update / remove the school link of a Parent that is linked to a school they manage
 *     (scope target PARENT, resolved below). A Parent linked only to other schools is never reachable.
 *   - PARENT: read their OWN profile only (`GET /parents/me`: the record is derived from the verified token, no id is accepted).
 *   - ORGANIZATION_MANAGER and MAIN_ADMIN: NO Parent permission. Having an organization-wide or platform role grants nothing here; an
 *     organization-wide Parent rule needs its own approval. (MAIN_ADMIN has global scope in the engine configuration, but scope never grants a
 *     permission: the role is simply not granted any `parents.*` permission.)
 * The MANAGEMENT/PARENT scope resolver loads the Parent's ACTIVE school links from the server and answers `true` only on positive proof: the
 * SCHOOL_MANAGER role with an active manager link to at least one of those schools.
 * Call once per process (a second registration is a configuration error by design).
 */
export function registerParentAuthorization(deps: ParentAuthorizationDeps): void {
  const schoolManager = ['SCHOOL_MANAGER'] as const;
  deps.policies.register({ code: ParentPermissions.CREATE, roles: schoolManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ParentPermissions.LIST, roles: schoolManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ParentPermissions.READ, roles: schoolManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ParentPermissions.UPDATE, roles: schoolManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ParentPermissions.REMOVE_SCHOOL_LINK, roles: schoolManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ParentPermissions.READ_OWN, roles: ['PARENT'], scope: 'UNSCOPED' });

  deps.resolvers.registerScopeResolver('MANAGEMENT', PARENT_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== PARENT_TARGET_TYPE || role !== 'SCHOOL_MANAGER') return false;
      for (const schoolId of await deps.parents.listActiveSchoolIds(target.id)) {
        if (await deps.schools.isSchoolManager(userId, schoolId)) return true;
      }
      return false;
    },
  });
}
