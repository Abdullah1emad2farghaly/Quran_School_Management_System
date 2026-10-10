// Public contract of Module 12 (Authorization Engine): the reusable authorization infrastructure.
//   Roles -> Permissions -> Scope -> Ownership (Master Specification §20), deny by default, fail closed.
// Dependent modules: register permissions with AuthorizationPolicyRegistry, register scope/ownership resolvers for the
// data they own with AuthorizationResolvers, inject `Authorizer`, and protect routes with `requirePermission`.
// It defines NO permissions and NO HTTP endpoints; permissions are approved module by module (docs/AUTHORIZATION-MATRIX.md).
export type { Authorizer, AuthorizationRequest } from '../application/services/authorizer';
export {
  AuthorizationService,
  NO_GLOBAL_SCOPE,
  type AuthorizationServiceDeps,
  type GlobalScopeRoles,
} from '../application/services/authorization-service';
export {
  AuthorizationPolicyRegistry,
  type RegisterPolicyInput,
} from '../application/services/authorization-policy-registry';
export { AuthorizationResolvers } from '../application/services/authorization-resolvers';
export type { ScopeResolver, ScopeQuery } from '../application/ports/scope-resolver';
export type { OwnershipResolver, OwnershipQuery } from '../application/ports/ownership-resolver';
export type { BootstrapGuard } from '../application/ports/bootstrap-guard';
export type { AuthorizationPolicy } from '../domain/value-objects/authorization-policy';
export {
  DENY_REASONS,
  type AuthorizationDecision,
  type DenyReason,
} from '../domain/value-objects/authorization-decision';
export {
  SCOPE_KINDS,
  POLICY_SCOPES,
  isScopeKind,
  isPolicyScope,
  type ScopeKind,
  type PolicyScope,
} from '../domain/value-objects/scope-kind';
export {
  isEntityRef,
  isEntityType,
  type EntityRef,
  type ScopeTarget,
  type ResourceRef,
} from '../domain/value-objects/entity-ref';
export {
  AuthorizationErrorCodes,
  authorizationError,
  type AuthorizationErrorCode,
} from '../domain/errors/authorization-errors';
export { AUTHORIZATION_ERROR_MESSAGES } from '../application/services/authorization-error-messages';
export {
  BootstrapMainAdmin,
  type BootstrapMainAdminDeps,
  type BootstrapMainAdminInput,
  type BootstrapMainAdminResult,
} from '../application/use-cases/bootstrap-main-admin';
export { InMemoryBootstrapGuard } from '../infrastructure/services/in-memory-bootstrap-guard';
export { SequelizeBootstrapGuard } from '../infrastructure/persistence/sequelize/repositories/sequelize-bootstrap-guard';
export {
  createRequirePermission,
  type RequirePermission,
  type RequirePermissionOptions,
} from '../presentation/http/require-permission.middleware';
