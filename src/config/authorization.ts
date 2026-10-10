import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  AuthorizationPolicyRegistry,
  AuthorizationResolvers,
  AuthorizationService,
  BootstrapMainAdmin,
  SequelizeBootstrapGuard,
  createRequirePermission,
  type Authorizer,
  type GlobalScopeRoles,
} from '../modules/12-authorization-engine/public';
import { getSequelize, getUnitOfWork } from './database';
import { getIdentityService } from './identity';
import { logger } from './logger';
import { getPermissionRegistry, getRoleService } from './roles';

/**
 * Roles with GLOBAL scope. Direction given for Module 12: Main Admin has global system scope. The Master Specification
 * does not state it explicitly, so it is PROPOSED in docs/AUTHORIZATION-MATRIX.md until it is confirmed. It only removes
 * the need for a scope resolver for that role; the role still needs the permission itself. Management and reporting are
 * listed separately; nothing else is global.
 */
export const GLOBAL_SCOPE_ROLES: GlobalScopeRoles = Object.freeze({
  MANAGEMENT: Object.freeze(['MAIN_ADMIN'] as const),
  REPORTING: Object.freeze(['MAIN_ADMIN'] as const),
});

// Every module registers ITS OWN permissions and resolvers here when it is implemented (after the grants are approved).
// Module 12 registers none: the V1 catalog is empty, so everything is denied until a module adds an approved permission.
const policyRegistry = new AuthorizationPolicyRegistry(getPermissionRegistry());
const resolvers = new AuthorizationResolvers();
let authorizer: Authorizer | undefined;

/** Register a module's permissions with this (never directly with Module 09's registry). */
export function getAuthorizationPolicyRegistry(): AuthorizationPolicyRegistry {
  return policyRegistry;
}

/** Register a module's scope and ownership resolvers with this. */
export function getAuthorizationResolvers(): AuthorizationResolvers {
  return resolvers;
}

/** Inject into other modules' use cases (never construct AuthorizationService elsewhere). */
export function getAuthorizer(): Authorizer {
  if (!authorizer) {
    authorizer = new AuthorizationService({
      identity: getIdentityService(),
      roles: getRoleService(),
      permissions: getPermissionRegistry(),
      policies: policyRegistry,
      resolvers,
      globalScopeRoles: GLOBAL_SCOPE_ROLES,
      logger,
    });
  }
  return authorizer;
}

/** Route guard: `router.get('/x', requireAuthentication, requirePermission('module.resource.action', {...}), handler)`. */
export const requirePermission = createRequirePermission(getAuthorizer);

/** Only for the one-time CLI (`npm run bootstrap:main-admin`). */
export function getBootstrapMainAdmin(): BootstrapMainAdmin {
  return new BootstrapMainAdmin({
    identity: getIdentityService(),
    roles: getRoleService(),
    guard: new SequelizeBootstrapGuard(getSequelize()),
    unitOfWork: getUnitOfWork(),
    clock: new SystemClock(),
  });
}
