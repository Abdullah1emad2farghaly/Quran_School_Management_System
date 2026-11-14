import { isAssignableRole, type RoleCode } from '../../../09-roles-permissions/public';

/**
 * The role a session currently acts as, derived from what is persisted on the session and the account's CURRENT active roles:
 *  - the stored role, while the account still has it (a revoked role can never stay active);
 *  - otherwise the account's only role (the approved single-role rule; also covers sessions created before the active role existed);
 *  - otherwise none: a multi-role account must choose (`POST /auth/switch-role`), and an account without a role has nothing to act as.
 * Never invents a role: with several roles and no valid stored choice the answer is null.
 */
export function effectiveActiveRole(stored: string | null, roles: readonly RoleCode[]): RoleCode | null {
  if (stored !== null && isAssignableRole(stored) && roles.includes(stored)) return stored;
  return roles.length === 1 ? (roles[0] as RoleCode) : null;
}
