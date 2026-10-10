// Public contract of Module 09 (Roles & Permissions): the nine V1 roles, role assignments with
// history, and role -> permission grants (RBAC). It does not authorize its callers and has no HTTP routes.
export {
  RoleService,
  type AssignRoleInput,
  type RevokeRoleInput,
  type RoleServiceDeps,
} from '../application/services/role-service';
export type { RoleAssignmentDto } from '../application/dto/role-assignment-dto';
export type { RoleAssignmentRepository } from '../application/ports/role-assignment-repository';
export {
  ROLE_CODES,
  ROLE_CATALOG,
  ASSIGNABLE_ROLE_CODES,
  isRoleCode,
  isAssignableRole,
  sortRoles,
  type RoleCode,
  type RoleDefinition,
} from '../domain/value-objects/role-code';
export { isPermissionCode, assertPermissionCode } from '../domain/value-objects/permission-code';
export { PermissionRegistry, type PermissionDefinition } from '../domain/services/permission-registry';
export { RoleErrorCodes, roleError, type RoleErrorCode } from '../domain/errors/role-errors';
export {
  RoleEventTypes,
  ROLE_ASSIGNMENT_AGGREGATE_TYPE,
  type RoleEventType,
  type RoleEventPayload,
} from '../domain/events/role-events';
export { ROLE_ERROR_MESSAGES } from '../application/services/role-error-messages';
export { InMemoryRoleAssignmentRepository } from '../infrastructure/services/in-memory-role-assignment-repository';
export { SequelizeRoleAssignmentRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-role-assignment-repository';
