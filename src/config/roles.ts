import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  PermissionRegistry,
  RoleService,
  SequelizeRoleAssignmentRepository,
} from '../modules/09-roles-permissions/public';
import { getSequelize, getUnitOfWork } from './database';
import { getIdentityService } from './identity';
import { getOutboxService } from './outbox';

// Role -> permission grants are stored here (Module 09), but modules register them through
// `getAuthorizationPolicyRegistry()` in ./authorization (Module 12), which also records scope/ownership policy.
// V1 starts with an empty catalog: nothing is granted until a module defines and gets approval for it.
const permissionRegistry = new PermissionRegistry();
let service: RoleService | undefined;

export function getPermissionRegistry(): PermissionRegistry {
  return permissionRegistry;
}

/** Inject into other modules' use cases (never construct RoleService elsewhere). */
export function getRoleService(): RoleService {
  if (!service) {
    service = new RoleService({
      repository: new SequelizeRoleAssignmentRepository(getSequelize()),
      identity: getIdentityService(),
      permissions: permissionRegistry,
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}
