import type { RoleCode } from '../../../09-roles-permissions/public';
import type { PolicyScope } from './scope-kind';

/**
 * How one permission is evaluated. The role grants themselves live in Module 09's PermissionRegistry; this adds
 * what the engine needs on top of them. Every module declares its own policies (and gets the role grants approved)
 * when it is implemented. Module 12 declares none.
 */
export interface AuthorizationPolicy {
  /** `<module>.<resource>.<action>`, for example `schools.school.create`. */
  readonly code: string;
  /** Roles granted the permission (RBAC). */
  readonly roles: readonly RoleCode[];
  /** Which scope kind a caller's scope is checked as, or `UNSCOPED`. Always stated explicitly. */
  readonly scope: PolicyScope;
  /** Roles for which resource OWNERSHIP must also hold (for example a Teacher acting on their own session). */
  readonly ownershipRequiredFor: readonly RoleCode[];
}
