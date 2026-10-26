import { ASSIGNABLE_ROLE_CODES } from '../../../09-roles-permissions/public';
import type { AuthorizationPolicyRegistry } from '../../../12-authorization-engine/public';

/** The only permission of Module 21: reading the Quran structure. There is deliberately NO write permission (the data is immutable through the API). */
export const QuranPermissions = { READ: 'quran.structure.read' } as const;

/**
 * Approved decision: ALL authenticated users may read the Quran structure. It is global reference data (no organization, school or
 * ownership), so the policy is UNSCOPED and granted to every role that can be assigned to an account (the Student role is a business entity
 * with no login, so it cannot hold a permission). Authentication is still mandatory (and an account that must change its initial password
 * is blocked by authentication first, as everywhere). Call once per process.
 */
export function registerQuranAuthorization(deps: { readonly policies: Pick<AuthorizationPolicyRegistry, 'register'> }): void {
  deps.policies.register({ code: QuranPermissions.READ, roles: ASSIGNABLE_ROLE_CODES, scope: 'UNSCOPED' });
}
