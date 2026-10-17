import type { AuthorizationPolicyRegistry, AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { OrganizationLookup } from '../../../13-organization-core/public';
import type { SchoolService } from './school-service';

/** Permissions of the school resource (registered ONLY through the shared Authorization Engine). */
export const SchoolPermissions = {
  CREATE: 'schools.school.create',
  LIST: 'schools.school.list',
  READ: 'schools.school.read',
  APPROVE: 'schools.school.approve',
  REJECT: 'schools.school.reject',
  DEACTIVATE: 'schools.school.deactivate',
  REACTIVATE: 'schools.school.reactivate',
  CORRECT_GPS: 'schools.school.correct-gps',
  ASSIGN_MANAGER: 'schools.manager.assign',
  REVOKE_MANAGER: 'schools.manager.revoke',
} as const;

/** Scope target type of a school. */
export const SCHOOL_TARGET_TYPE = 'SCHOOL';

export interface SchoolAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly schools: Pick<SchoolService, 'findById' | 'isSchoolManager'>;
  readonly organizations: Pick<OrganizationLookup, 'isOrganizationAdmin'>;
}

/**
 * Module 16 registers what it owns (approved rules only; anything not listed stays denied):
 *   - ORGANIZATION_MANAGER: create a school in THEIR organization (scope target ORGANIZATION, resolved by Module 13), and, for the schools
 *     of their organization, read, approve, reject, deactivate, reactivate, correct the GPS (only while PENDING, a business rule), and
 *     assign/revoke the School Manager. Isolation between organizations comes from the scope resolver below.
 *   - SCHOOL_MANAGER: list and read ONLY their own school (an active manager link). No write permission.
 *   - MAIN_ADMIN: no school permission (platform permissions are not approved yet; see docs/AUTHORIZATION-MATRIX.md).
 * The MANAGEMENT/SCHOOL scope resolver loads the school from the server (never trusts a client-claimed organization) and answers `true`
 * only on positive proof: the ORGANIZATION_MANAGER role with an active link to the school's organization, or the SCHOOL_MANAGER role with an
 * active manager link to that exact school.
 * Call once per process (a second registration is a configuration error by design).
 */
export function registerSchoolAuthorization(deps: SchoolAuthorizationDeps): void {
  const orgManager = ['ORGANIZATION_MANAGER'] as const;
  deps.policies.register({ code: SchoolPermissions.CREATE, roles: orgManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: SchoolPermissions.LIST, roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'], scope: 'UNSCOPED' });
  deps.policies.register({ code: SchoolPermissions.READ, roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'], scope: 'MANAGEMENT' });
  for (const code of [
    SchoolPermissions.APPROVE,
    SchoolPermissions.REJECT,
    SchoolPermissions.DEACTIVATE,
    SchoolPermissions.REACTIVATE,
    SchoolPermissions.CORRECT_GPS,
    SchoolPermissions.ASSIGN_MANAGER,
    SchoolPermissions.REVOKE_MANAGER,
  ]) {
    deps.policies.register({ code, roles: orgManager, scope: 'MANAGEMENT' });
  }

  deps.resolvers.registerScopeResolver('MANAGEMENT', SCHOOL_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== SCHOOL_TARGET_TYPE) return false;
      const school = await deps.schools.findById(target.id);
      if (!school) return false;
      if (role === 'ORGANIZATION_MANAGER') return deps.organizations.isOrganizationAdmin(userId, school.organizationId);
      if (role === 'SCHOOL_MANAGER') return deps.schools.isSchoolManager(userId, school.id);
      return false;
    },
  });
}
