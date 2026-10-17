import { type AuthorizationPolicyRegistry, type AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { OrganizationLookup } from './organization-service';

/** Permissions of the organization resource (registered ONLY through the shared Authorization Engine). */
export const OrganizationPermissions = {
  /** List the organizations the caller manages (unscoped: the list is derived from the caller's own organization links). */
  LIST: 'organizations.organization.list',
  /** Read one organization: management scope over THAT organization. */
  READ: 'organizations.organization.read',
} as const;

/** Scope target type used by every module that scopes an operation to an organization. */
export const ORGANIZATION_TARGET_TYPE = 'ORGANIZATION';

export interface OrganizationAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly organizations: Pick<OrganizationLookup, 'isOrganizationAdmin'>;
}

/**
 * Module 13 registers what it owns: the permissions of the organization resource (approved grants only: the ORGANIZATION_MANAGER of the
 * organization) and the MANAGEMENT scope resolver for `ORGANIZATION` targets. The resolver answers `true` ONLY on positive proof: the
 * caller acts through the ORGANIZATION_MANAGER role AND has an ACTIVE manager link to exactly that organization. MAIN_ADMIN is not
 * granted these permissions (platform permissions are registered explicitly, one by one, when approved).
 * Call once per process (a second registration is a configuration error by design).
 */
export function registerOrganizationAuthorization(deps: OrganizationAuthorizationDeps): void {
  deps.policies.register({ code: OrganizationPermissions.LIST, roles: ['ORGANIZATION_MANAGER'], scope: 'UNSCOPED' });
  deps.policies.register({ code: OrganizationPermissions.READ, roles: ['ORGANIZATION_MANAGER'], scope: 'MANAGEMENT' });
  deps.resolvers.registerScopeResolver('MANAGEMENT', ORGANIZATION_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) =>
      kind === 'MANAGEMENT' && role === 'ORGANIZATION_MANAGER' && target.type === ORGANIZATION_TARGET_TYPE && (await deps.organizations.isOrganizationAdmin(userId, target.id)),
  });
}
