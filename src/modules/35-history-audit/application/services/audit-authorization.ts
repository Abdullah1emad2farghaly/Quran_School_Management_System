import type { AuthorizationPolicyRegistry } from '../../../12-authorization-engine/public';

/** Permissions of the audit trail (registered ONLY through the shared Authorization Engine). Read-only: nothing writes, changes or deletes audit records over HTTP. */
export const AuditPermissions = {
  LIST: 'audit.log.list',
  READ: 'audit.log.read',
} as const;

export interface AuditAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
}

/**
 * Approved Module 35 rules (anything not listed stays denied):
 *   - MAIN_ADMIN, ORGANIZATION_MANAGER and SCHOOL_MANAGER may list and read audit records. The role only opens the door: WHICH records a caller sees is decided by
 *     `AuditQueryService` from the server's own links (organizations administered / schools managed) and the session's active role.
 *   - TEACHER, STUDENT, PARENT and SUBSCRIPTION_COLLECTOR: nothing. GOVERNORATE/CENTER/VILLAGE managers: no permission (no scope link exists for them in the system yet).
 * The permissions are registered UNSCOPED because they are not tied to one target in the URL; the visibility filter is the scope enforcement. Call once per process.
 */
export function registerAuditAuthorization(deps: AuditAuthorizationDeps): void {
  const roles = ['MAIN_ADMIN', 'ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'] as const;
  deps.policies.register({ code: AuditPermissions.LIST, roles, scope: 'UNSCOPED' });
  deps.policies.register({ code: AuditPermissions.READ, roles, scope: 'UNSCOPED' });
}
